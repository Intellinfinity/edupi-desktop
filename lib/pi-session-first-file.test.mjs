import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { persistInitialPiSessionFile } = await createJiti(import.meta.url).import("./pi-session-first-file.ts");

test("first Pi session header is complete before Core capture and remains idempotent", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-pi-first-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "session.jsonl");
  const header = { type: "session", version: 3, id: "synthetic-session", cwd: root };
  const manager = { getSessionFile: () => file, getHeader: () => header, getEntries: () => [] };
  assert.equal(persistInitialPiSessionFile(manager, header.id), file);
  assert.equal(fs.readFileSync(file, "utf8"), `${JSON.stringify(header)}\n`);
  assert.equal(persistInitialPiSessionFile(manager, header.id), file);
  assert.equal(fs.readdirSync(root).length, 1);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o077, 0);
});

test("a partial or wrong first Pi file cannot authorize Core capture", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-pi-partial-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "session.jsonl");
  const manager = { getSessionFile: () => file,
    getHeader: () => ({ type: "session", version: 3, id: "synthetic-session", cwd: root }), getEntries: () => [] };
  fs.writeFileSync(file, '{"type":"session"');
  assert.throws(() => persistInitialPiSessionFile(manager, "synthetic-session"), /session_persist_conflict/);
  assert.equal(fs.readFileSync(file, "utf8"), '{"type":"session"');
  assert.throws(() => persistInitialPiSessionFile(manager, "another-session"), /session_persist_unavailable/);
});
