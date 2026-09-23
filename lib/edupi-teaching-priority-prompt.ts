type TeachingPriorityPromptInput = {
  subject: string | null;
  grade: string | null;
  currentTopics: string[];
};

export function buildTeachingPriorityConversationPrompt(input: TeachingPriorityPromptInput): string {
  const context = [input.subject?.trim(), input.grade?.trim()].filter(Boolean).join(" · ") || "教学上下文待补充";
  const topics = Array.from(new Set(input.currentTopics.map((topic) => topic.trim()).filter(Boolean))).slice(0, 5);
  return [
    "教学重点",
    `当前教学：${context}`,
    topics.length > 0 ? `已有重点：${topics.join("、")}` : null,
  ].filter(Boolean).join("\n");
}
