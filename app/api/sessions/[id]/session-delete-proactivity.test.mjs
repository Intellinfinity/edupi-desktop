import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("session deletion withdraws Core-owned sources before destroying memory, rewriting children, or unlinking disk", () => {
  const deletion = source.slice(source.indexOf("export async function DELETE"));
  const lock = deletion.indexOf("withEduPiAmbientSessionLock(id");
  const withdrawal = deletion.indexOf("await withdrawEduPiAmbientMessagesForSession(id)");
  assert.ok(lock > 0 && lock < withdrawal);
  assert.ok(withdrawal < deletion.indexOf("live.destroy()"));
  assert.ok(withdrawal < deletion.indexOf("writeFileSync(childPath"));
  assert.ok(withdrawal < deletion.indexOf("unlinkSync(filePath)"));
  assert.match(deletion, /EduPiAmbientMessageWithdrawalError[\s\S]*status:\s*503/);
});
