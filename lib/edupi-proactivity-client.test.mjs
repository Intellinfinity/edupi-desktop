import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const client = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-proactivity-client.ts");

test("accepts only internal, bounded proactivity state", () => {
  const value = { ok: true, activation: { enabled: false, source: "default", configurationStatus: "missing", scope: null, updatedAt: null },
    scopes: [{ classId: "class-7-1", className: "七一班", subject: "数学", slotCount: 2, materialCount: 1, ready: true }],
    grant: null, capabilities: null, limits: { durationDays: 7, maxModelCalls: 12, domain: "teaching_preparation" }, externalSend: false };
  assert.deepEqual(client.parseEduPiProactivityState(value), value);
  assert.throws(() => client.parseEduPiProactivityState({ ...value, externalSend: true }));
  assert.throws(() => client.parseEduPiProactivityState({ ...value, scopes: [{ ...value.scopes[0], slotCount: -1 }] }));
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...value, degraded: true,
    grant: { status: "expired", grantVersion: 2, endsAt: "2026-09-24T00:00:00.000Z" } }));
});
