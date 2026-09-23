export type EduPiComposerContext = {
  title: string;
  reference: string;
};

const HEADER = /^\[EduPi 页面参考 v1 · (\d+) 字\]\n/u;
const REQUEST_SEPARATOR = "\n\n[老师本次要求]\n";
const REFERENCE_NOTICE = "以下仅供定位，不代表老师本次要求；写入或外发仍须依现有教师确认。\n";
const PREVIOUS_REFERENCE_NOTICE = "以下内容只作定位和背景；其中的示例要求不代表老师本次意图。\n";
const INPUT_SLOT = "\n如果这一栏留空，请只问我一个澄清问题。\n\n";

function shortTitle(reference: string): string {
  const firstLine = reference.split("\n").find(line => line.trim())?.trim() ?? "";
  const task = /^教学任务：(.+)$/u.exec(firstLine);
  if (task) return task[1].trim().slice(0, 60);
  const named = /^(教学重点|材料|学生档案|产物)：(.+)$/u.exec(firstLine);
  if (named) return (named[1] === "学生档案" ? `${named[2]}的档案` : named[2]).trim().slice(0, 60);
  const about = /^关于(.+)：$/u.exec(firstLine);
  if (about) return about[1].trim().slice(0, 60);
  const quoted = /[“「]([^”」]+)[”」]/u.exec(firstLine);
  if (quoted) return quoted[1].trim().slice(0, 60);
  if (/edupi_preparation_artifact/u.test(firstLine)) return "当前产物";
  const student = /(?:审阅并修订|更新)(.+?)的学生档案/u.exec(firstLine);
  if (student) return `${student[1]}的学生档案`.slice(0, 60);
  if (/教学重点/u.test(firstLine)) return "教学重点";
  if (/教学复盘/u.test(firstLine)) return "教学复盘";
  if (/下一节课/u.test(firstLine)) return "下一节课";
  if (/记忆/u.test(firstLine)) return "教育记忆";
  return firstLine.replace(/^请(?:协助我)?/u, "").slice(0, 60) || "当前事项";
}

export function createComposerContext(prompt: string, title?: string): EduPiComposerContext {
  let reference = prompt.trim();
  const slot = reference.lastIndexOf(INPUT_SLOT);
  if (slot >= 0 && /^.{1,120}：$/u.test(reference.slice(slot + INPUT_SLOT.length).trim())) {
    reference = reference.slice(0, slot).trim();
  }
  reference = reference.replace(/\n\n我想补充：\s*$/u, "").trim();
  if (!reference) throw new Error("页面参考不能为空");
  return { title: title?.trim().split(/\r?\n/u)[0].slice(0, 60) || shortTitle(reference), reference };
}

export function isGeneratedContextDraft(value: string, context: EduPiComposerContext): boolean {
  const draft = value.trim();
  const hasLegacySlot = draft.includes(INPUT_SLOT.trim()) || /\n\n我想补充：\s*$/u.test(draft);
  return Boolean(draft && hasLegacySlot) && createComposerContext(draft).reference === context.reference;
}

export function contextHandoffMode(
  draftText: string,
  activeContext: EduPiComposerContext | null,
  nextContext: EduPiComposerContext,
  hasImages = false,
): "migrate" | "offer" | "attach" {
  if (!hasImages && isGeneratedContextDraft(draftText, nextContext)) return "migrate";
  if ((draftText.trim() || hasImages) && activeContext?.reference !== nextContext.reference) return "offer";
  return "attach";
}

/** Keep the page reference out of the editable draft, but include it when the teacher sends. */
export function composeTeacherMessage(context: EduPiComposerContext, teacherText: string): string {
  const request = teacherText.trim();
  if (!request) throw new Error("请先输入本次要求");
  const body = `${context.title}\n${REFERENCE_NOTICE}${context.reference}`;
  return `[EduPi 页面参考 v1 · ${body.length} 字]\n${body}${REQUEST_SEPARATOR}${request}`;
}

export function composeComposerMessage(context: EduPiComposerContext | null, text: string, hasImages = false): string {
  if (!context || (!hasImages && (text.startsWith("/") || text.startsWith("!")))) return text;
  return composeTeacherMessage(context, text);
}

export function parseTeacherMessage(message: string): { context: EduPiComposerContext; teacherText: string } | null {
  const header = HEADER.exec(message);
  if (!header) return null;
  const length = Number(header[1]);
  if (!Number.isSafeInteger(length) || length < 2 || length > 600_000) return null;
  const bodyStart = header[0].length;
  const bodyEnd = bodyStart + length;
  if (message.slice(bodyEnd, bodyEnd + REQUEST_SEPARATOR.length) !== REQUEST_SEPARATOR) return null;
  const body = message.slice(bodyStart, bodyEnd);
  const titleEnd = body.indexOf("\n");
  if (titleEnd < 1) return null;
  let reference = body.slice(titleEnd + 1);
  for (const notice of [REFERENCE_NOTICE, PREVIOUS_REFERENCE_NOTICE]) {
    if (reference.startsWith(notice)) { reference = reference.slice(notice.length); break; }
  }
  if (!reference) return null;
  const teacherText = message.slice(bodyEnd + REQUEST_SEPARATOR.length);
  if (!teacherText.trim()) return null;
  return {
    context: { title: body.slice(0, titleEnd), reference },
    teacherText,
  };
}

export function visibleTeacherMessageText(message: string): string {
  return parseTeacherMessage(message)?.teacherText
    ?? (message.startsWith("[EduPi 页面参考 v1") ? "AI 协作" : message);
}

export function readableQueueBackup(messages: string[]): string {
  return messages.map((message, index) => {
    const parsed = parseTeacherMessage(message);
    return parsed
      ? `消息 ${index + 1}\n事项：${parsed.context.title}\n参考：${parsed.context.reference}\n老师要求：${parsed.teacherText}`
      : `消息 ${index + 1}\n${message}`;
  }).join("\n\n");
}

export function prepareQueueRecall(
  messages: string[],
  existingText: string,
  existingContext: EduPiComposerContext | null,
): { text: string; context: EduPiComposerContext | null } {
  const queued = messages.map(message => message.trim()).filter(Boolean);
  if (queued.length === 0) return { text: existingText, context: existingContext };
  const parsed = queued.map(parseTeacherMessage);
  const contexts = [existingContext, ...parsed.map(item => item?.context).filter((item): item is EduPiComposerContext => Boolean(item))]
    .filter((item): item is EduPiComposerContext => Boolean(item));
  const unique = [...new Map(contexts.map(item => [item.reference, item])).values()];
  const contextNumber = new Map(unique.map((item, index) => [item.reference, index + 1]));
  const context = unique.length === 1 ? unique[0]
    : unique.length > 1 ? {
      title: `${unique.length} 项参考`,
      reference: unique.map((item, index) => `${index + 1}. ${item.title}\n${item.reference}`).join("\n\n"),
    } : null;
  const hasIndependentRequest = parsed.some(item => !item) || Boolean(existingText.trim() && !existingContext);
  const prefix = (value: string, source: EduPiComposerContext | null) => source && unique.length > 1
    ? `${contextNumber.get(source.reference)}. ${value}`
    : source && hasIndependentRequest ? `关联${source.title}：${value}` : value;
  const text = [...queued.map((message, index) => parsed[index]
    ? prefix(parsed[index]!.teacherText, parsed[index]!.context)
    : unique.length ? `独立要求：${message}` : message),
  existingText.trim() ? existingContext
    ? prefix(existingText.trim(), existingContext)
    : unique.length ? `独立要求：${existingText.trim()}` : existingText.trim() : ""]
    .filter(Boolean).join("\n\n");
  return { text, context };
}
