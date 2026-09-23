type StudentProfilePromptInput = {
  name: string;
  studentId?: string;
  className?: string;
  traits: string[];
  parentNotes: string[];
  patternCount: number;
  trajectoryCount: number;
};

export function buildStudentProfileConversationPrompt(input: StudentProfilePromptInput): string {
  return [
    `学生档案：${input.name}`,
    ...(input.studentId ? [`学生 ID：${input.studentId}`] : []),
    ...(input.className ? [`班级：${input.className}`] : []),
    `当前特征：${input.traits.join("、") || "暂无"}`,
    `当前家校备注：${input.parentNotes.join("、") || "暂无"}`,
    `系统记录：${input.patternCount} 条学习模式 · ${input.trajectoryCount} 个成长节点。`,
  ].join("\n");
}
