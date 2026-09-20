import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("mobile routes keep the first phase read-only except scoped continuation", () => {
  const files = [
    "pairing/route.ts",
    "pair/route.ts",
    "sessions/route.ts",
    "sessions/[id]/route.ts",
    "sessions/[id]/messages/route.ts",
    "summary/route.ts",
    "logout/route.ts",
  ];
  for (const file of files) assert.ok(fs.existsSync(new URL(`./${file}`, import.meta.url)), file);
  const message = fs.readFileSync(new URL("./sessions/[id]/messages/route.ts", import.meta.url), "utf8");
  assert.match(message, /mobile_prompt/);
  assert.match(message, /accessMode: "approval"/);
  assert.doesNotMatch(message, /edupi_.*create|edupi_.*update|openconnector/i);
  const mobilePage = fs.readFileSync(new URL("../../mobile/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(mobilePage, /localStorage/);
});
