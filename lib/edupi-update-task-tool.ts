import { resolve } from "node:path";
import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { EducationContract } from "./edupi-education-contract";
import { issueTaskBoardCommand, taskBoardContentHash } from "./edupi-task-board-command";

const parameters = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("start"), Type.Literal("complete"), Type.Literal("reopen")]),
  task_id: Type.Optional(Type.String({ minLength: 1 })),
  query: Type.Optional(Type.String({ description: "按标题查找任务；重名时使用查询结果中的 task_id" })),
  note: Type.Optional(Type.String({ maxLength: 1000 })),
}, { additionalProperties: false });

type Task = EducationContract["tasks"][number];
type Dependencies = {
  projectRoot: string;
  read?: () => Promise<Pick<EducationContract, "tasks">>;
  issue?: typeof issueTaskBoardCommand;
};

export function createEduPiUpdateTaskTool({ projectRoot, read = async () => (await import("./edupi-education-server")).readEducationContract(), issue = issueTaskBoardCommand }: Dependencies) {
  return defineTool<typeof parameters, { tasks: Array<Pick<Task, "id" | "title" | "boardStage" | "boardRevision">>; updated: boolean }>({
    name: "edupi_update_task",
    label: "更新 EduPi 任务",
    description: "查询现有任务并同步任务板状态。list 查询，start 开始，complete 完成，reopen 重开。教师明确说已经完成，或当前会话实际完成了该任务要求的完整工作流程后，调用 complete 同步状态；不能仅凭计划、开始执行或生成候选材料宣称完成。生成候选材料不代表教师审核通过，本工具不批准教学内容。目标不明确时先查询；重名必须确认任务 ID。不要只在回复中声称更新。",
    promptSnippet: "edupi_update_task: 查询任务并将实际开始、完成、重开同步到任务板；候选材料生成不等于审核通过",
    parameters,
    executionMode: "sequential",
    execute: async (toolCallId, params: Static<typeof parameters>, signal, _onUpdate, ctx) => {
      if (resolve(ctx.cwd) !== resolve(projectRoot)) throw new Error("请在 EduPi 工作区更新任务。");
      signal?.throwIfAborted();
      const { tasks } = await read();
      signal?.throwIfAborted();
      const taskId = params.task_id?.trim();
      const query = params.query?.trim().toLocaleLowerCase();
      const matches = tasks.filter(task => task.id && (taskId ? task.id === taskId : !query || task.title.toLocaleLowerCase().includes(query)));
      const summarize = (task: Task) => ({ id: task.id, title: task.title, boardStage: task.boardStage, boardRevision: task.boardRevision });
      if (params.action === "list") return { content: [{ type: "text", text: JSON.stringify(matches.map(summarize)) }], details: { tasks: matches.map(summarize), updated: false } };
      if (!taskId && !query) throw new Error("请先查询并指定要更新的任务。");
      if (!matches.length) throw new Error("未找到任务，请重新查询。");
      if (matches.length !== 1) throw new Error(`找到多个任务，请指定 task_id：${JSON.stringify(matches.map(summarize))}`);
      const task = matches[0];
      const toStage = params.action === "complete" ? "done" : "progress";
      const stageLabel = toStage === "done" ? "已完成" : "进行中";
      if (task.boardStage === toStage) return { content: [{ type: "text", text: `任务已处于${stageLabel}：${task.title}` }], details: { tasks: [summarize(task)], updated: false } };
      const message = [...ctx.sessionManager.getBranch()].reverse().find(entry => entry.type === "message" && entry.message.role === "user");
      const sourceId = message?.id || toolCallId;
      signal?.throwIfAborted();
      const result = await issue({
        command_type: "move_task_stage", task_id: task.id!, expected_revision: task.boardRevision, to_stage: toStage, note: params.note?.trim() || null,
        source: { source_id: sourceId, source_kind: "teacher_message", source_hash: taskBoardContentHash(message || { toolCallId }), evidence_ids: [sourceId, ...(sourceId === toolCallId ? [] : [toolCallId])] },
      });
      // The command layer verifies the receipt and reads the persisted task back.
      if (!result.task || result.task.task_id !== task.id || result.task.board_stage !== toStage || result.task.board_revision !== task.boardRevision + 1) throw new Error("任务更新后读取结果不一致。");
      const updated = { ...summarize(task), boardStage: toStage, boardRevision: task.boardRevision + 1 } as ReturnType<typeof summarize>;
      return { content: [{ type: "text", text: `已更新任务：${task.title} → ${stageLabel}。` }], details: { tasks: [updated], updated: true } };
    },
  });
}
