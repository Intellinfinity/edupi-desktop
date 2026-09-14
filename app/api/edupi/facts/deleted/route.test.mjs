import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./route.ts");

test("deleted fact route rejects foreign origins and unbounded pages", async () => {
  assert.equal((await GET(new Request("http://localhost/api/edupi/facts/deleted?offset=0&limit=101", { headers: { host: "localhost", origin: "http://localhost" } }))).status, 400);
  assert.equal((await GET(new Request("http://localhost/api/edupi/facts/deleted?offset=0&limit=20", { headers: { host: "localhost", origin: "https://untrusted.example" } }))).status, 403);
});

test("deleted fact route reads only the paginated Core ledger", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /parseDeletedFactPage/);
  assert.match(source, /readDeletedEducationFacts/);
  assert.doesNotMatch(source, /writeFile|education_facts_v1\.json|AgentSession/);
});
