import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const stateDir = mkdtempSync(join(tmpdir(), "edupi-mobile-admin-"));
const previousStateDir = process.env.PI_DESKTOP_STATE_DIR;
const previousToken = process.env.PI_DESKTOP_API_TOKEN;
const token = "a".repeat(64);
process.env.PI_DESKTOP_STATE_DIR = stateDir;
process.env.PI_DESKTOP_API_TOKEN = token;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const route = await jiti.import("./route.ts");
const itemRoute = await jiti.import("./[id]/route.ts");

after(() => {
  if (previousStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
  else process.env.PI_DESKTOP_STATE_DIR = previousStateDir;
  if (previousToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
  else process.env.PI_DESKTOP_API_TOKEN = previousToken;
  rmSync(stateDir, { recursive: true, force: true });
});

function request(path, method = "GET", providedToken, body) {
  return new Request(`http://127.0.0.1:38471${path}`, {
    method,
    headers: {
      host: "127.0.0.1:38471",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(providedToken ? { "x-pi-desktop-token": providedToken } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("desktop pairing administration requires the per-process native token", async () => {
  assert.equal((await route.GET(request("/api/mobile/pairing"))).status, 403);
  assert.equal((await route.POST(request("/api/mobile/pairing", "POST", null, {}))).status, 403);
  assert.equal((await route.POST(request("/api/mobile/pairing", "POST", "b".repeat(64), {}))).status, 403);

  const created = await route.POST(request("/api/mobile/pairing", "POST", token, {}));
  assert.equal(created.status, 200);
  const pairing = await created.json();
  assert.match(pairing.code, /^[A-Z0-9]{8}$/u);
  assert.equal((await route.GET(request("/api/mobile/pairing", "GET", token))).status, 200);

  const params = { params: Promise.resolve({ id: pairing.id }) };
  assert.equal((await itemRoute.POST(request(`/api/mobile/pairing/${pairing.id}`, "POST", null, { action: "revoke" }), params)).status, 403);
  assert.equal((await itemRoute.POST(request(`/api/mobile/pairing/${pairing.id}`, "POST", token, { action: "revoke" }), params)).status, 200);
});
