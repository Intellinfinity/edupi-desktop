import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { desktopUpgradeErrorDetails, desktopUpgradeErrorKind, downloadVerifiedUpdate, DesktopUpgradeError } = await jiti.import("./desktop-updater.ts");

test("an interrupted signed update download retries before any install step", async () => {
  let downloads = 0;
  let resets = 0;
  const delays = [];
  await downloadVerifiedUpdate(
    async () => {
      downloads += 1;
      if (downloads < 3) throw "error decoding response body";
    },
    () => { resets += 1; },
    async (milliseconds) => { delays.push(milliseconds); },
  );
  assert.equal(downloads, 3);
  assert.equal(resets, 2);
  assert.deepEqual(delays, [750, 1500]);
});

test("signature failures do not retry a different download", async () => {
  let downloads = 0;
  await assert.rejects(
    downloadVerifiedUpdate(async () => { downloads += 1; throw new Error("Invalid signature"); }, () => { throw new Error("must not retry"); }),
    /Invalid signature/,
  );
  assert.equal(downloads, 1);
});

test("persistent network interruption returns the final failure without installing", async () => {
  let downloads = 0;
  await assert.rejects(
    downloadVerifiedUpdate(async () => { downloads += 1; throw new Error("error decoding response body"); }, () => {}, async () => {}),
    /error decoding response body/,
  );
  assert.equal(downloads, 3);
  assert.equal(desktopUpgradeErrorKind("error decoding response body"), "download");
  assert.equal(desktopUpgradeErrorKind(new Error("Invalid signature")), "signature");
});

test("stage details expose only safe updater diagnostics", () => {
  const error = new DesktopUpgradeError("request included a secret=do-not-show", {
    stage: "download",
    phase: "downloading",
    host: "api.github.com",
    retryCount: 2,
  });
  const details = desktopUpgradeErrorDetails(error);
  assert.deepEqual(details, {
    stage: "download",
    phase: "downloading",
    host: "api.github.com",
    retryCount: 2,
    errorCode: details.errorCode,
  });
  assert.match(details.errorCode, /^UPD-[0-9a-f]{8}$/);
  assert.doesNotMatch(details.errorCode, /secret|do-not-show/);
});
