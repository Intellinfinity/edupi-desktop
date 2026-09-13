import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const roots = await createJiti(import.meta.url).import("./allowed-roots.ts");

test("scoped file roots replace stale education roots and invalidate the cache", () => {
  globalThis.__piAllowedRootsCache = { roots: new Set(["/old/cache"]), expiresAt: Date.now() + 1000 };
  roots.setScopedAllowedFileRoots("test-education", ["/tmp/old/.edupi/output"]);
  assert.equal(globalThis.__piAllowedRootsCache, undefined);
  assert.ok(roots.getScopedAllowedFileRoots().has("/tmp/old/.edupi/output"));
  roots.setScopedAllowedFileRoots("test-education", ["/tmp/new/.edupi/output", "/tmp/new/.edupi/inbox/teacher-materials"]);
  const current = roots.getScopedAllowedFileRoots();
  assert.equal(current.has("/tmp/old/.edupi/output"), false);
  assert.ok(current.has("/tmp/new/.edupi/output"));
  roots.setScopedAllowedFileRoots("test-education", []);
});
