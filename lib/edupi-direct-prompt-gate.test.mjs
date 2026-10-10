import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { eduPiDirectPromptGate } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-direct-prompt-gate.ts");
const base = { desktopToken: "synthetic-token", dataRoot: () => "/isolated/data",
  g1Allowed: true, g2Allowed: true };

test("only an installed Core-active process blocks direct Pi message routes", () => {
  assert.equal(eduPiDirectPromptGate({ ...base, desktopToken: "", activation: () => true }), "allowed");
  assert.equal(eduPiDirectPromptGate({ ...base, activation: () => false }), "allowed");
  assert.equal(eduPiDirectPromptGate({ ...base,
    activation: (_root, domain) => domain === "teaching_preparation" }), "core_first_required");
  assert.equal(eduPiDirectPromptGate({ ...base, g1Allowed: false,
    activation: (_root, domain) => domain === "student_followup" }), "core_first_required");
});

test("unknown installed Core activation fails closed before Pi queueing", () => {
  assert.equal(eduPiDirectPromptGate({ ...base, activation: () => { throw new Error("unavailable"); } }), "unavailable");
});
