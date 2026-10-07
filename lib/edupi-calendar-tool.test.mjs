import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createEduPiCalendarTools } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-calendar-tool.ts");
const ctx = { cwd: "/synthetic/edupi", sessionManager: { getSessionId: () => "session", getBranch: () => [{ type: "message", id: "user-message", message: { role: "user", content: "synthetic calendar request" } }] } };
const input = { date: "2026-10-08", name: "合成会议", type: "meeting" };
const resultFor = (command, overrides = {}) => ({
  receipt: { status: "accepted", receipt_id: "receipt", external_send: false },
  data: { education_workspace: { calendar: command.events.map(event => ({
    ...event, state: event.confidence === "inferred" ? "pending_review" : "confirmed", date_status: "explicit",
    source_ids: [command.source.source_id], evidence_ids: command.source.evidence_ids,
  })) } },
  ...overrides,
});

test("calendar_add uses the canonical command and acknowledges only its source-bound readback", async () => {
  let submitted;
  const [tool] = createEduPiCalendarTools({ projectRoot: ctx.cwd, issue: async command => { submitted = command; return resultFor(command); } });
  const result = await tool.execute("call-add", input, undefined, undefined, ctx);
  assert.equal(submitted.command_type, "import_calendar");
  assert.equal(submitted.events[0].confidence, "teacher_confirmed");
  assert.ok(submitted.events[0].source_occurrence_ref);
  assert.deepEqual(submitted.source.evidence_ids, ["user-message", "call-add"]);
  assert.equal(result.details.verified, true);
  assert.equal(result.details.events[0].state, "confirmed");
  assert.match(result.content[0].text, /已保存 1 条日程/);
});

test("new same-title dates carry distinct occurrences and replay keeps the original occurrence", async () => {
  const submitted = [];
  const [tool] = createEduPiCalendarTools({ projectRoot: ctx.cwd, issue: async command => { submitted.push(command); return resultFor(command); } });
  for (const [index, date] of ["2026-10-08", "2026-10-09", "2026-10-08"].entries()) await tool.execute(`call-${index}`, { ...input, date }, undefined, undefined, ctx);
  assert.notEqual(submitted[0].events[0].source_occurrence_ref, submitted[1].events[0].source_occurrence_ref);
  assert.equal(submitted[0].events[0].source_occurrence_ref, submitted[2].events[0].source_occurrence_ref);
  assert.equal(submitted[0].events[0].event_id, submitted[2].events[0].event_id);
  assert.equal(new Set(submitted.map(command => command.source.source_id)).size, 1, "the manual issuer stays stable across calls");
  assert.notEqual(submitted[0].source.source_hash, submitted[2].source.source_hash, "a new call carries its own evidence fingerprint without changing occurrence identity");
});

test("calendar_import retains inferred items as pending review", async () => {
  const [, tool] = createEduPiCalendarTools({ projectRoot: ctx.cwd, issue: async command => resultFor(command) });
  const result = await tool.execute("call-import", { events: [input] }, undefined, undefined, ctx);
  assert.equal(result.details.events[0].state, "pending_review");
  assert.match(result.content[0].text, /已保留 1 条待确认/);
  assert.doesNotMatch(result.content[0].text, /已保存|已安排/);
});

test("an unresolved date is read back as held and never claimed as an effective schedule", async () => {
  const [tool] = createEduPiCalendarTools({ projectRoot: ctx.cwd, issue: async command => {
    const result = resultFor(command);
    const event = result.data.education_workspace.calendar[0];
    Object.assign(event, { state: "held", date_status: "invalid", date: null, notes: "日期原文：日期待确认" });
    result.receipt.status = "held";
    return result;
  } });
  const result = await tool.execute("call-held", { ...input, date: "日期待确认" }, undefined, undefined, ctx);
  assert.equal(result.details.events[0].state, "held");
  assert.equal(result.details.events[0].date, null);
  assert.match(result.content[0].text, /待确认/);
  assert.doesNotMatch(result.content[0].text, /已保存|已安排/);
});

test("failed, missing and unbound readbacks cannot produce a saved acknowledgment", async () => {
  for (const mutate of [
    result => ({ ...result, receipt: { status: "failed" } }),
    result => ({ ...result, data: null }),
    result => { result.data.education_workspace.calendar[0].evidence_ids = ["unrelated-call"]; return result; },
    result => { result.data.education_workspace.calendar[0].name = "different event"; return result; },
  ]) {
    const [tool] = createEduPiCalendarTools({ projectRoot: ctx.cwd, issue: async command => mutate(resultFor(command)) });
    await assert.rejects(tool.execute("call-invalid", input, undefined, undefined, ctx), /未确认/);
  }
});

test("writer failure preserves its real code and creates no automatic retry promise", async () => {
  let calls = 0;
  const [tool] = createEduPiCalendarTools({ projectRoot: ctx.cwd, issue: async () => { calls++; throw Object.assign(new Error("Core writer unavailable"), { code: "writer_admission_unavailable" }); } });
  await assert.rejects(tool.execute("call-failed", input, undefined, undefined, ctx), error => {
    assert.match(error.message, /写入未确认/);
    assert.match(error.message, /writer_admission_unavailable/);
    assert.match(error.message, /没有安排自动补录/);
    return true;
  });
  assert.equal(calls, 1);
});

test("a canonical alias is acknowledged only when the actual source and content read back match", async () => {
  const [tool] = createEduPiCalendarTools({ projectRoot: ctx.cwd, issue: async command => {
    const result = resultFor(command);
    result.data.education_workspace.calendar[0].event_id = "canonical-existing-id";
    return result;
  } });
  const result = await tool.execute("call-alias", input, undefined, undefined, ctx);
  assert.equal(result.details.events[0].id, "canonical-existing-id");
});

test("wrong workspace, missing teacher source and cancellation fail before a write", async () => {
  let writes = 0;
  const [tool] = createEduPiCalendarTools({ projectRoot: ctx.cwd, issue: async command => { writes++; return resultFor(command); } });
  await assert.rejects(tool.execute("call", input, undefined, undefined, { ...ctx, cwd: "/other" }), /工作区/);
  await assert.rejects(tool.execute("call", input, undefined, undefined, { ...ctx, sessionManager: { ...ctx.sessionManager, getBranch: () => [] } }), /教师消息/);
  await assert.rejects(tool.execute("call", input, AbortSignal.abort(), undefined, ctx), { name: "AbortError" });
  assert.equal(writes, 0);
});
