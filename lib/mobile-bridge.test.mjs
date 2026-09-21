import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

process.env.PI_DESKTOP_STATE_DIR = mkdtempSync(join(tmpdir(), "edupi-mobile-"));
const jiti = createJiti(import.meta.url);
const bridge = await jiti.import("./mobile-bridge.ts");

test("mobile pairing requires explicit approval and expires into a scoped token", () => {
  const created = bridge.createMobilePairing();
  assert.equal(bridge.listMobilePairings()[0].status, "waiting");
  const requested = bridge.requestMobilePairing(created.code, "老师的手机");
  assert.equal(requested.status, "requested");
  assert.equal(bridge.completeMobilePairing(created.id, created.code).status, "requested");
  bridge.approveMobilePairing(created.id);
  const completed = bridge.completeMobilePairing(created.id, created.code);
  assert.equal(completed.status, "active");
  assert.match(completed.token, /^[A-Za-z0-9_-]{40,}$/);
  const request = new Request("http://192.168.1.20:38471/api/mobile/sessions", { headers: { "x-edupi-mobile-token": completed.token } });
  assert.equal(bridge.authorizeMobileRequest(request, "mobile:read").deviceLabel, "老师的手机");
  const cookieRequest = new Request("http://192.168.1.20:38471/api/mobile/sessions", { headers: { cookie: `edupi_mobile_token=${completed.token}` } });
  assert.equal(bridge.authorizeMobileRequest(cookieRequest, "mobile:read").deviceLabel, "老师的手机");
  assert.equal(bridge.authorizeMobileRequest(new Request("http://192.168.1.20:38471/api/mobile/sessions", { headers: { "x-edupi-mobile-token": "wrong-token" } }), "mobile:read"), null);
});

test("desktop pairing administration is loopback-only", () => {
  assert.equal(bridge.isLoopbackRequest(new Request("http://127.0.0.1:38471/api/mobile/pairing", { headers: { host: "127.0.0.1:38471" } })), true);
  assert.equal(bridge.isLoopbackRequest(new Request("http://192.168.1.20:38471/api/mobile/pairing", { headers: { host: "192.168.1.20:38471" } })), false);
});

test("pairing attempts are rate limited per host", () => {
  const now = Date.now() + 10_000;
  for (let index = 0; index < 120; index += 1) assert.equal(bridge.allowMobilePairAttempt("192.168.1.40", now), true);
  assert.equal(bridge.allowMobilePairAttempt("192.168.1.40", now), false);
  assert.equal(bridge.allowMobilePairAttempt("192.168.1.41", now), true);
});
