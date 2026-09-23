import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildTeachingPriorityConversationPrompt } = await jiti.import("./edupi-teaching-priority-prompt.ts");

test("builds factual teaching-priority context without a fixed request", () => {
  const prompt = buildTeachingPriorityConversationPrompt({
    subject: "数学",
    grade: "七年级",
    currentTopics: ["有理数", "整式", "有理数", "一元一次方程"],
  });

  assert.match(prompt, /数学 · 七年级/);
  assert.match(prompt, /已有重点：有理数、整式、一元一次方程/);
  assert.match(prompt, /^教学重点\n/);
  assert.doesNotMatch(prompt, /如果这一栏留空|输入或口述|不要直接写入/);
});

test("keeps the dialogue useful before teaching context exists", () => {
  const prompt = buildTeachingPriorityConversationPrompt({ subject: null, grade: null, currentTopics: [] });
  assert.match(prompt, /教学上下文待补充/);
  assert.doesNotMatch(prompt, /已有重点：/);
  assert.equal(prompt, "教学重点\n当前教学：教学上下文待补充");
});
