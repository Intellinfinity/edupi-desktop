import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const G1 = "teaching_preparation";
const G2 = "student_followup";
const rootRef = `sha256:${"a".repeat(64)}`;
const occurredAt = "2026-10-10T08:00:00.000Z";

function fixture({ authorized = true, g2 = false, registrationFailure = null,
  captureFailure = null, piError = false, piAsyncFailure = false,
  settleFailure = false, settleStatus = "sealed_absent", reconciliationEvidence = "confirmed" } = {}) {
  // An in-memory transport proves route ordering only: no Core daemon, Pi
  // model, teacher files, or installed app is touched by these tests.
  const events = [];
  let piListener = () => {};
  const outbox = new Map();
  const ledger = new Map();
  let domains = g2 ? [G1, G2] : [G1];
  const key = (sessionId, clientRequestId) => `${sessionId}\0${clientRequestId}`;
  const get = (sessionId, clientRequestId) => outbox.get(key(sessionId, clientRequestId)) ?? null;
  const mutate = (sessionId, clientRequestId, change) => {
    const entry = get(sessionId, clientRequestId);
    assert.ok(entry, "outbox must already contain the whole prompt");
    change(entry);
    return entry;
  };
  const host = { call: async (operation) => {
    assert.equal(operation, "health");
    events.push("health");
    return { ok: true, result: { data_root_fingerprint: rootRef, capabilities: {
      ambient_planning: "active", owner_message_registration: "active", g1_processor: "active", g2_processor: "active",
    } } };
  } };
  const modules = {
    "node:crypto": { createHash },
    "node:util": { isDeepStrictEqual },
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status ?? 200 }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: async (request) => {
      events.push("body_read"); return request.json();
    }, RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => authorized },
    "@/lib/edupi-ambient-message-ledger": {
      prepareEduPiAmbientMessageBinding: ({ messageRef }) => { events.push("ledger_prepared"); ledger.set(messageRef, { messageRef, status: "pending" }); },
      confirmEduPiAmbientMessageBinding: (_session, _message, messageRef) => { events.push("ledger_confirmed"); ledger.get(messageRef).status = "captured"; },
      markEduPiAmbientMessageWithdrawn: (_session, messageRef) => { events.push("ledger_withdrawn"); ledger.get(messageRef).status = "withdrawn"; },
      markEduPiAmbientMessageAbandoned: (_session, messageRef) => { events.push("ledger_abandoned"); ledger.get(messageRef).status = "abandoned"; },
      readEduPiAmbientMessagesForSession: () => [...ledger.values()],
    },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_sessionId, callback) => callback() },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/isolated/synthetic" } }) },
    "@/lib/edupi-prompt-intent": {
      listEduPiPromptIntents: () => [{ sessionId: "session-1", clientRequestId: "request-1",
        occurredAt, message: "请准备数学课", cwd: "/synthetic", status: "pending" }],
      readEduPiPromptIntent: (sessionId, clientRequestId) => sessionId === "session-1" && clientRequestId === "request-1"
        ? { sessionId, clientRequestId, occurredAt, message: "请准备数学课", cwd: "/synthetic", status: "pending" } : null,
      resolveEduPiPromptIntent: () => events.push("intent_resolved"),
    },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: ({ domain }) => ({
      enabled: domains.includes(domain), grantId: `grant-${domain}`, scope: { classId: "703", subject: "数学" },
    }) },
    "@/lib/edupi-proactivity-runtime": { readProactivityOwnerContext: async (_host, _rootRef, grantId) => ({
      status: "active", ownerId: "owner-fixture", grantId, grantVersion: 2,
    }) },
    "@/lib/edupi-registered-prompt": { registerAndCapturePrompt: async (_host, input, hooks) => {
      events.push(`register:${input.domain}`);
      if (registrationFailure === input.domain) throw new Error("synthetic_registration_failure");
      const proof = { messageRef: `owner_message:${(input.domain === G1 ? "b" : "c").repeat(64)}`,
        registration: { producer_epoch: "d".repeat(64), sequence: 1 },
        fencingGeneration: 1, instanceNonce: "nonce-1" };
      // The real helper validates the complete affirmative Core receipt
      // before invoking onCaptured. Simulate that boundary, not a HTTP 200.
      hooks.onRegistered(proof);
      events.push(`capture:${input.domain}`);
      if (captureFailure === input.domain) throw new Error("synthetic_capture_failure");
      hooks.onCaptured(proof);
      return proof;
    }, settleRegisteredPrompt: async (_host, input, hooks) => {
      events.push(`settle:${input.domain}`);
      if (settleFailure) throw new Error("synthetic_settle_unknown");
      const proof = { messageRef: `owner_message:${(input.domain === G1 ? "b" : "c").repeat(64)}`,
        registration: { producer_epoch: "d".repeat(64), sequence: 1 },
        fencingGeneration: 1, instanceNonce: "nonce-1" };
      if (!input.previousRegistration) hooks.onRegistered(proof);
      return { status: settleStatus, messageRef: proof.messageRef,
        recordedAt: settleStatus === "withdrawn" ? "2026-10-10T08:01:00.000Z" : null };
    } },
    "@/lib/edupi-prompt-reconciliation": { inspectEduPiPromptSession: () => reconciliationEvidence },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host },
    "@/lib/rpc-manager": { getRpcSession: () => ({ isAlive: () => true,
      ensureSessionPersisted: () => events.push("session_persisted"),
      onEvent: listener => { piListener = listener; return () => { piListener = () => {}; }; },
      recordEduPiPromptDispatch: () => events.push("pi_session_marker"), sendCoreCapturedPrompt: async command => {
        events.push("pi_send"); if (piError) throw new Error("synthetic_pi_uncertain");
        queueMicrotask(() => piListener(piAsyncFailure
          ? { type: "prompt_error", clientRequestId: command.clientRequestId }
          : { type: "message_end", clientRequestId: command.clientRequestId,
            entryId: "entry-1", message: { role: "user" } }));
      } }) },
    "@/lib/session-reader": { resolveSessionPath: async () => { events.push("session_path"); return "synthetic-session"; } },
    "@/lib/harness/runtime": { startHarnessSession: async () => { throw new Error("unexpected harness start"); } },
    "@/lib/safe-mode": { canStartEduPiProactivity: () => true, canStartEduPiStudentFollowup: () => g2 },
    "@/lib/image-attachments": { validateAgentImages: () => null },
    "@/lib/edupi-prompt-outbox": {
      listEduPiPromptOutbox: () => [...outbox.values()].map(item => ({ sessionId: item.sessionId,
        clientRequestId: item.clientRequestId, stage: item.stage })),
      readEduPiPromptOutbox: get,
      prepareEduPiPromptOutbox: (input) => {
        events.push("outbox_prepared");
        const id = key(input.sessionId, input.clientRequestId);
        const existing = outbox.get(id);
        if (existing) {
          assert.equal(existing.messageId, input.messageId, "retry must reuse identity");
          assert.deepEqual(existing.command, input.command, "retry must reuse exact Pi command");
          return existing;
        }
        const entry = { ...input, stage: "prepared", bindings: input.bindings.map(binding => ({
          ...binding, captured: false, registration: null, messageRef: null,
        })) };
        outbox.set(id, entry);
        return entry;
      },
      recordEduPiPromptOutboxRegistration: (sessionId, clientRequestId, domain, registration) => mutate(sessionId, clientRequestId, entry => {
        events.push(`outbox_registered:${domain}`);
        const binding = entry.bindings.find(item => item.domain === domain);
        assert.ok(binding);
        binding.registration = registration;
        binding.messageRef = registration.messageRef;
        entry.stage = entry.bindings.every(item => item.registration) ? "registered" : "prepared";
      }),
      recordEduPiPromptOutboxCapture: (sessionId, clientRequestId, domain, receipt) => mutate(sessionId, clientRequestId, entry => {
        events.push(`outbox_captured:${domain}`);
        const binding = entry.bindings.find(item => item.domain === domain);
        assert.equal(binding.messageRef, receipt.messageRef);
        binding.captured = true;
        entry.stage = entry.bindings.every(item => item.captured) ? "captured" : "registered";
      }),
      markEduPiPromptOutboxPiDispatching: (sessionId, clientRequestId) => mutate(sessionId, clientRequestId, entry => {
        assert.equal(entry.stage, "captured");
        events.push("pi_dispatch_committed"); entry.stage = "pi_dispatching";
      }),
      markEduPiPromptOutboxPiAccepted: (sessionId, clientRequestId) => mutate(sessionId, clientRequestId, entry => {
        events.push("pi_accepted"); entry.stage = entry.stage === "pi_unverified_withdrawn"
          ? "pi_accepted_withdrawn" : "pi_accepted";
      }),
      markEduPiPromptOutboxPiUnknown: (sessionId, clientRequestId) => mutate(sessionId, clientRequestId, entry => {
        events.push("pi_unknown"); entry.stage = "pi_unknown";
      }),
      markEduPiPromptOutboxCancelled: (sessionId, clientRequestId, proofs) => mutate(sessionId, clientRequestId, entry => {
        assert.equal(proofs.length, entry.bindings.length);
        events.push("outbox_cancelled"); entry.stage = "cancelled";
      }),
      markEduPiPromptOutboxSourceWithdrawn: (sessionId, clientRequestId, proofs) => mutate(sessionId, clientRequestId, entry => {
        assert.equal(proofs.length, entry.bindings.length);
        assert.ok(proofs.every(proof => proof.status === "withdrawn"));
        events.push("outbox_source_withdrawn"); entry.stage = "pi_unverified_withdrawn";
      }),
    },
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected dependency ${name}`);
    return modules[name];
  }, routeModule, routeModule.exports);
  const body = { sessionId: "session-1", messageId: "message-1", occurredAt,
    command: { type: "prompt", message: "请准备数学课", clientRequestId: "request-1" } };
  const post = (payload = body) => routeModule.exports.POST(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }));
  const put = () => routeModule.exports.PUT(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: body.sessionId, clientRequestId: body.command.clientRequestId }),
  }));
  const patch = () => routeModule.exports.PATCH(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: body.sessionId, clientRequestId: body.command.clientRequestId }),
  }));
  const cancel = () => routeModule.exports.DELETE(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "DELETE", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: body.sessionId, clientRequestId: body.command.clientRequestId }),
  }));
  return { events, outbox, body, post, put, patch, cancel, deactivate: () => { domains = []; },
    entry: () => get(body.sessionId, body.command.clientRequestId) };
}

test("unauthorized request never reads private body or touches Core and Pi", async () => {
  const f = fixture({ authorized: false });
  const result = await f.post();
  assert.equal(result.status, 403);
  assert.equal((await result.json()).status, "rejected");
  assert.deepEqual(f.events, []);
  assert.equal(f.entry(), null);
});

test("G1 affirmative capture is durable before the sole Pi dispatch", async () => {
  const f = fixture();
  const result = await f.post();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).status, "accepted");
  assert.equal(f.entry().stage, "pi_accepted");
  const position = label => f.events.indexOf(label);
  assert.ok(position("outbox_prepared") < position(`register:${G1}`));
  assert.ok(position("session_persisted") < position(`register:${G1}`));
  assert.ok(position(`outbox_registered:${G1}`) < position(`capture:${G1}`));
  assert.ok(position(`outbox_captured:${G1}`) < position("pi_dispatch_committed"));
  assert.ok(position("pi_dispatch_committed") < position("pi_send"));
  assert.ok(position("pi_session_marker") < position("pi_send"));
  assert.ok(position("pi_accepted") < position("intent_resolved"));
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
  assert.equal(f.events.includes("pi_accepted"), true);
});

test("G1 and G2 both capture before Pi dispatch in isolated canary", async () => {
  const f = fixture({ g2: true });
  const result = await f.post();
  assert.equal(result.status, 200);
  assert.deepEqual(f.entry().bindings.map(binding => binding.domain), [G1, G2]);
  assert.equal(f.entry().bindings.every(binding => binding.captured), true);
  assert.ok(f.events.indexOf(`outbox_captured:${G2}`) < f.events.indexOf("pi_send"));
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
});

test("registration or capture failure never dispatches Pi", async () => {
  for (const failure of [{ registrationFailure: G1 }, { captureFailure: G1 }, { captureFailure: G2, g2: true }]) {
    const f = fixture(failure);
    const result = await f.post();
    assert.equal(result.status, 202);
    assert.equal((await result.json()).status, "uncertain");
    assert.equal(f.events.includes("pi_send"), false);
    assert.equal(f.events.includes("pi_dispatch_committed"), false);
    assert.notEqual(f.entry().stage, "pi_accepted");
  }
});

test("a later disabled grant never replays a prepared Core source as plain Pi chat", async () => {
  const f = fixture({ captureFailure: G1 });
  assert.equal((await f.post()).status, 202);
  f.deactivate();
  const retry = await f.post();
  assert.equal(retry.status, 202);
  assert.equal((await retry.json()).status, "uncertain");
  assert.equal(f.events.includes("pi_send"), false);
});

test("Pi error is uncertain and a repeated request never blindly replays it", async () => {
  const f = fixture({ piError: true });
  const first = await f.post();
  assert.equal(first.status, 202);
  assert.equal((await first.json()).status, "uncertain");
  assert.equal(f.entry().stage, "pi_unknown");
  const second = await f.post();
  assert.equal(second.status, 202);
  assert.equal((await second.json()).status, "uncertain");
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
  assert.equal(f.events.filter(event => event === `register:${G1}`).length, 1);
  const manual = await f.put();
  assert.equal(manual.status, 202);
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
});

test("a new request ID cannot bypass an unresolved prompt in the same session", async () => {
  const f = fixture({ piError: true });
  assert.equal((await f.post()).status, 202);
  const replacement = await f.post({ ...f.body, messageId: "message-2",
    command: { ...f.body.command, clientRequestId: "request-2" } });
  assert.equal(replacement.status, 409);
  assert.equal((await replacement.json()).status, "prior_unresolved");
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
});

test("an async Pi preflight failure after RPC scheduling never becomes an accepted outbox entry", async () => {
  const f = fixture({ piAsyncFailure: true });
  const result = await f.post();
  assert.equal(result.status, 202);
  assert.equal((await result.json()).status, "uncertain");
  assert.equal(f.entry().stage, "pi_unknown");
  assert.equal(f.events.filter(event => event === "pi_accepted").length, 0);
});

test("only exact Pi session evidence settles an uncertain send after restart", async () => {
  const confirmed = fixture({ piError: true });
  assert.equal((await confirmed.post()).status, 202);
  assert.equal((await confirmed.patch()).status, 200);
  assert.equal(confirmed.entry().stage, "pi_accepted");
  assert.equal(confirmed.events.filter(event => event === "pi_send").length, 1);
  const missing = fixture({ piError: true, reconciliationEvidence: "marker_only" });
  assert.equal((await missing.post()).status, 202);
  const result = await missing.patch();
  assert.equal(result.status, 202);
  assert.equal((await result.json()).evidence, "marker_only");
  assert.equal(missing.entry().stage, "pi_unknown");
});

test("an uncertain Pi dispatch may withdraw Core sources without claiming Pi was absent", async () => {
  const f = fixture({ piError: true, reconciliationEvidence: "marker_only", settleStatus: "withdrawn" });
  assert.equal((await f.post()).status, 202);
  assert.equal((await f.patch()).status, 202);
  const withdrawn = await f.cancel();
  assert.equal(withdrawn.status, 200);
  assert.equal((await withdrawn.json()).status, "source_withdrawn");
  assert.equal(f.entry().stage, "pi_unverified_withdrawn");
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
  assert.equal(f.events.includes("ledger_withdrawn"), true);
  assert.equal((await f.put()).status, 409);
  assert.equal((await f.post()).status, 409);
  assert.equal((await f.patch()).status, 202);
});

test("a Core-withdrawn prompt becomes settled only after exact Pi session evidence", async () => {
  const f = fixture({ piError: true, settleStatus: "withdrawn", reconciliationEvidence: "confirmed" });
  assert.equal((await f.post()).status, 202);
  assert.equal((await f.cancel()).status, 200);
  assert.equal((await f.patch()).status, 200);
  assert.equal(f.entry().stage, "pi_accepted_withdrawn");
  assert.equal((await f.post()).status, 200);
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
});

test("an uncertain Pi dispatch cannot be relabelled as withdrawn without Core proof", async () => {
  const f = fixture({ piError: true, settleStatus: "sealed_absent" });
  assert.equal((await f.post()).status, 202);
  assert.equal((await f.cancel()).status, 503);
  assert.equal(f.entry().stage, "pi_unknown");
});

test("explicit cancellation seals a pre-Pi registration; unknown settlement preserves it", async () => {
  const sealed = fixture({ registrationFailure: G1 });
  assert.equal((await sealed.post()).status, 202);
  const cancelled = await sealed.cancel();
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).status, "cancelled");
  assert.equal(sealed.entry().stage, "cancelled");
  assert.equal(sealed.events.includes("pi_send"), false);
  const uncertain = fixture({ registrationFailure: G1, settleFailure: true });
  assert.equal((await uncertain.post()).status, 202);
  assert.equal((await uncertain.cancel()).status, 503);
  assert.equal(uncertain.entry().stage, "prepared");
});

test("accepted request is idempotent and unsupported body cannot start a capture", async () => {
  const accepted = fixture();
  assert.equal((await accepted.post()).status, 200);
  assert.equal((await accepted.post()).status, 200);
  const altered = await accepted.post({ ...accepted.body,
    command: { ...accepted.body.command, message: "不同内容" } });
  assert.equal(altered.status, 409);
  assert.equal((await altered.json()).status, "conflict");
  assert.equal(accepted.events.filter(event => event === "pi_send").length, 1);
  const invalid = fixture();
  const result = await invalid.post({ ...invalid.body, command: { ...invalid.body.command, type: "steer" } });
  assert.equal(result.status, 400);
  assert.equal((await result.json()).status, "invalid");
  assert.equal(invalid.events.includes("outbox_prepared"), false);
  assert.equal(invalid.events.includes("pi_send"), false);
});
