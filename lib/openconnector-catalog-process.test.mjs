import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { runCatalogQuery } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./openconnector-catalog-process.ts");
const fixtureRoot = path.resolve("desktop");

test("catalog child returns a bounded query without inheriting runtime secrets", async () => {
  const previous = process.env.EDUPI_OPENCONNECTOR_RUNTIME_TOKEN;
  process.env.EDUPI_OPENCONNECTOR_RUNTIME_TOKEN = "test-token-must-not-reach-child";
  try {
    const search = await runCatalogQuery({ op: "search", query: "safe" }, { root: fixtureRoot, hostFile: "catalog-test-host.mjs" });
    assert.equal(search.kind, "search");
    assert.equal(search.actions[0].description, "Safe");
    const inspect = await runCatalogQuery({ op: "inspect", actionId: "test.lookup" }, { root: fixtureRoot, hostFile: "catalog-test-host.mjs" });
    assert.equal(inspect.kind, "inspect");
    assert.equal(inspect.action.id, "test.lookup");
  } finally {
    if (previous === undefined) delete process.env.EDUPI_OPENCONNECTOR_RUNTIME_TOKEN;
    else process.env.EDUPI_OPENCONNECTOR_RUNTIME_TOKEN = previous;
  }
});

test("catalog child has a deadline and refuses malformed or unavailable roots", async () => {
  await assert.rejects(runCatalogQuery({ op: "search", query: "hang" }, { root: fixtureRoot, hostFile: "catalog-test-host.mjs", timeoutMs: 150 }), { code: "catalog_timeout" });
  await assert.rejects(runCatalogQuery({ op: "search", query: "crash" }, { root: fixtureRoot, hostFile: "catalog-test-host.mjs" }), { code: "catalog_unavailable" });
  await assert.rejects(runCatalogQuery({ op: "search", query: "oversize" }, { root: fixtureRoot, hostFile: "catalog-test-host.mjs" }), { code: "catalog_invalid_response" });
  await assert.rejects(runCatalogQuery({ op: "search", query: "safe" }, { root: "/definitely/missing/catalog" }), { code: "catalog_unavailable" });
  await assert.rejects(runCatalogQuery({ op: "execute", actionId: "test.lookup" }, { root: fixtureRoot, hostFile: "catalog-test-host.mjs" }), { code: "invalid_catalog_request" });
});

test("catalog process admits only one heavy runtime at a time and releases the gate after failure", async () => {
  const hanging = runCatalogQuery({ op: "search", query: "hang" }, { root: fixtureRoot, hostFile: "catalog-test-host.mjs", timeoutMs: 150 });
  await assert.rejects(
    runCatalogQuery({ op: "search", query: "safe" }, { root: fixtureRoot, hostFile: "catalog-test-host.mjs" }),
    { code: "catalog_busy" },
  );
  await assert.rejects(hanging, { code: "catalog_timeout" });
  const recovered = await runCatalogQuery({ op: "search", query: "safe" }, { root: fixtureRoot, hostFile: "catalog-test-host.mjs" });
  assert.equal(recovered.kind, "search");
});

test("production runner names only the staged host and passes no token-shaped environment", async () => {
  const [source, shell] = await Promise.all([
    readFile(new URL("./openconnector-catalog-process.ts", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
  ]);
  assert.match(source, /hostFile = "host\.mjs"/);
  assert.match(source, /env: \{ NODE_ENV: "production", PATH: process\.env\.PATH \|\| "" \}/);
  assert.doesNotMatch(source, /EDUPI_OPENCONNECTOR_RUNTIME_TOKEN:|EDUPI_OPENCONNECTOR_ADMIN_TOKEN:/);
  assert.match(shell, /\.env\(\s*"EDUPI_OPENCONNECTOR_CATALOG_ROOT",\s*resource_dir\.join\("resources\/open-connector"\),?\s*\)/);
});
