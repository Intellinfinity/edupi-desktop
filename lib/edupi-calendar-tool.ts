import { resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { parseCalendarIntakeCommand } from "./edupi-calendar-intake-request";
import { contentHash, issueEducationIntake, type CalendarImportEvent } from "./edupi-education-intake";

const eventParameters = Type.Object({
  event_id: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  source_occurrence_ref: Type.Optional(Type.String({ minLength: 1, maxLength: 160, description: "确认或改期已有事项时复用原发生身份；新增事项可省略" })),
  date: Type.String({ maxLength: 32, description: "明确日期 YYYY-MM-DD；无法确认时填日期待确认" }),
  end_date: Type.Optional(Type.String({ maxLength: 32 })),
  name: Type.String({ minLength: 1, maxLength: 240 }),
  type: Type.Union(["exam", "activity", "meeting", "holiday", "festival", "teaching", "custom"].map(value => Type.Literal(value))),
  confidence: Type.Optional(Type.Union([Type.Literal("confirmed"), Type.Literal("teacher_confirmed"), Type.Literal("inferred")])),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
}, { additionalProperties: false });
type EventInput = Static<typeof eventParameters>;
type Dependencies = { projectRoot: string; issue?: typeof issueEducationIntake };
type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const includes = (value: unknown, id: string) => Array.isArray(value) && value.includes(id);

function matchesInput(actual: Row, expected: CalendarImportEvent): boolean {
  if (actual.name !== expected.name || actual.type !== expected.type) return false;
  if (actual.date_status === "explicit") {
    return actual.date === expected.date && (actual.end_date ?? null) === expected.end_date
      && (actual.notes ?? null) === expected.notes;
  }
  // Core retains unresolved dates as held records with their original date in
  // notes. Read them back as drafts, without claiming an effective schedule.
  return actual.state === "held" && typeof actual.notes === "string"
    && actual.notes.includes(`日期原文：${expected.date || "未提供"}`)
    && (!expected.end_date || actual.notes.includes(`至 ${expected.end_date}`))
    && (!expected.notes || actual.notes.includes(expected.notes));
}

export function createEduPiCalendarTools({ projectRoot, issue = issueEducationIntake }: Dependencies) {
  const execute = async (callId: string, inputs: EventInput[], defaultConfidence: string, signal: AbortSignal | undefined, ctx: Parameters<ReturnType<typeof defineTool>["execute"]>[4]) => {
    if (resolve(ctx.cwd) !== resolve(projectRoot)) throw new Error("请在 EduPi 工作区保存日程。");
    signal?.throwIfAborted();
    const message = [...ctx.sessionManager.getBranch()].reverse().find(entry => entry.type === "message" && entry.message.role === "user");
    if (!message) throw new Error("日程未保存：没有可关联的教师消息。");
    const command = parseCalendarIntakeCommand({ kind: "calendar", events: inputs.map(input => ({
      eventId: input.event_id, date: input.date, endDate: input.end_date, name: input.name, type: input.type,
      confidence: input.confidence ?? defaultConfidence, notes: input.notes,
      sourceOccurrenceRef: input.source_occurrence_ref ?? (input.event_id ? undefined
        : `chat-calendar-${contentHash({ date: input.date.trim(), endDate: input.end_date?.trim() || null, name: input.name.trim(), type: input.type }).slice(7, 47)}`),
    })) });
    if (command.command_type !== "import_calendar") throw new Error("日程导入类型无效。");
    // Occurrence identity includes its issuer. Keep the canonical manual issuer
    // stable so another call can replay or revise the same occurrence, while
    // different dates with the same title remain distinct occurrences.
    const sourceId = command.events.some(event => event.source_occurrence_ref)
      ? command.source.source_id
      : `calendar-chat-${contentHash({ session: ctx.sessionManager.getSessionId(), message: message.id, callId }).slice(7, 31)}`;
    command.source = {
      ...command.source, source_id: sourceId,
      source_hash: contentHash({ session_id: ctx.sessionManager.getSessionId(), message_id: message.id, tool_call_id: callId, events: command.events }),
      evidence_ids: [message.id, callId],
    };
    signal?.throwIfAborted();
    let result: Awaited<ReturnType<typeof issueEducationIntake>>;
    try {
      result = await issue(command);
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "unavailable";
      throw new Error(`日程写入未确认：${error instanceof Error ? error.message : "Core 暂不可用。"}\n错误代码：${code}。没有安排自动补录。`);
    }
    if (!["accepted", "modified", "held"].includes(String(result.receipt.status))) throw new Error("Core 未确认日程写入，请在事务中核对。没有安排自动补录。");
    const calendar = result.data?.education_workspace.calendar;
    const rows = Array.isArray(calendar) ? calendar.map(row).filter((item): item is Row => item !== null) : [];
    const verified = command.events.map(expected => {
      const matches = rows.filter(actual => (actual.event_id === expected.event_id || includes(actual.source_ids, sourceId))
        && includes(actual.evidence_ids, callId) && matchesInput(actual, expected));
      if (matches.length !== 1) throw new Error("日程写入后的读取结果未确认，请在事务中核对。没有安排自动补录。");
      const actual = matches[0];
      if (!["confirmed", "pending_review", "held"].includes(String(actual.state))) throw new Error("日程状态未确认，请在事务中核对。");
      return { id: String(actual.event_id), sourceOccurrenceRef: expected.source_occurrence_ref ?? null, name: String(actual.name), date: actual.date ?? null, endDate: actual.end_date ?? null, state: actual.state };
    });
    const confirmed = verified.filter(event => event.state === "confirmed").length;
    const pending = verified.length - confirmed;
    return {
      content: [{ type: "text" as const, text: `${confirmed ? `已保存 ${confirmed} 条日程。` : ""}${pending ? `已保留 ${pending} 条待确认日程。` : ""}\n${verified.map(event => `${event.name}：${event.date || "日期待确认"}；${event.state === "confirmed" ? "已确认" : "待确认"}；ID ${event.id}${event.sourceOccurrenceRef ? `；source_occurrence_ref ${event.sourceOccurrenceRef}` : ""}`).join("\n")}` }],
      details: { ok: true, verified: true, events: verified, receipt: result.receipt, external_send: false },
    };
  };
  return [
    defineTool({
      name: "calendar_add", label: "添加事件", parameters: eventParameters, executionMode: "sequential",
      description: "通过 Core 正式保存教师明确提供的单个日程并回读。日期不确定会保留待确认；文件或图片推断的日程使用 inferred。只以工具返回的已确认或待确认状态回复；失败或读取未确认时不可说已保存，不自动补录。",
      promptSnippet: "calendar_add: 正式写入并核对日程回执与读取结果",
      execute: (callId, params, signal, _update, ctx) => execute(callId, [params], "teacher_confirmed", signal, ctx),
    }),
    defineTool({
      name: "calendar_import", label: "导入行事历", parameters: Type.Object({ events: Type.Array(eventParameters, { minItems: 1, maxItems: 200 }) }, { additionalProperties: false }), executionMode: "sequential",
      description: "通过 Core 正式导入日程并逐条回读。文件、图片和通知解析默认待确认；教师明确确认后使用 teacher_confirmed，官方校历使用 confirmed。按工具实际返回的状态报告，未确认不说已安排，失败不许诺自动补录。",
      promptSnippet: "calendar_import: 导入日程，核对回执与逐条读取的确认状态",
      execute: (callId, params, signal, _update, ctx) => execute(callId, params.events, "inferred", signal, ctx),
    }),
  ];
}
