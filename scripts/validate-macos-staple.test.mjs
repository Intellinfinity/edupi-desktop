import assert from "node:assert/strict";
import test from "node:test";
import { validateMacOSStaple } from "./validate-macos-staple.mjs";

const offline = { status: 68, stderr: 'Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline."' };
function harness(results) {
  const calls = [], waits = [];
  return { calls, waits, options: {
    run: (...args) => { calls.push(args); return results[Math.min(calls.length - 1, results.length - 1)]; },
    wait: async delay => { waits.push(delay); }, log() {},
  } };
}

test("retries the observed CloudKit offline failure and still requires successful validation", async () => {
  const { calls, waits, options } = harness([offline, { status: 0 }]);
  await validateMacOSStaple("signed/EduPi.app", options);
  assert.deepEqual(calls.map(call => call.slice(0, 2)), Array(2).fill(["xcrun", ["stapler", "validate", "signed/EduPi.app"]]));
  assert.deepEqual(waits, [5_000]);
});

test("persistent CloudKit failure does not pass after the retry limit", async () => {
  const { calls, waits, options } = harness([offline]);
  await assert.rejects(validateMacOSStaple("EduPi.dmg", options), /status 68/);
  assert.equal(calls.length, 3);
  assert.equal(waits.length, 2);
});

test("invalid tickets and unrecognized failures are not retried", async () => {
  for (const result of [{ status: 65, stderr: "The ticket is invalid" }, { status: null, error: new Error("missing xcrun") }]) {
    const { calls, waits, options } = harness([result]);
    await assert.rejects(validateMacOSStaple("EduPi.app", options), /Staple validation failed/);
    assert.equal(calls.length, 1);
    assert.equal(waits.length, 0);
  }
});
