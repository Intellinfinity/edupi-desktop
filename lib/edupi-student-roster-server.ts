import { createHash } from "node:crypto";
import { runCoreProcess } from "./edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { normalizeStudentProfileMutationReceipt, type StudentProfileMutationReceipt } from "./edupi-student-profile-versions";
import type { StudentRosterRow } from "./edupi-student-roster-model";

type StudentRosterResponse = {
  ok: boolean;
  operation?: string;
  code?: string;
  created?: number;
  updated?: number;
  imported?: number;
  total?: number;
  external_send?: boolean;
  student_name?: string;
  student_id?: string;
  updated_at?: string;
};

export type StudentProfileUpdateInput = {
  name: string;
  studentId: string;
  className?: string | null;
  traits: string[];
  parentNotes: string[];
  expectedUpdatedAt: string;
  expectedRevision: number;
};

export class StudentProfileUpdateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "StudentProfileUpdateError";
  }
}

export function buildStudentProfileUpdateRequest(input: StudentProfileUpdateInput, requestId: string) {
  return {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "students",
    request_id: requestId,
    action: "update",
    expected_updated_at: input.expectedUpdatedAt,
    expected_revision: input.expectedRevision,
    student: { name: input.name, student_id: input.studentId, traits: input.traits, parent_notes: input.parentNotes, ...(input.className !== undefined ? {class_name:input.className} : {}) },
  } as const;
}

export function studentProfileUpdateRequestId(input: StudentProfileUpdateInput): string {
  const identity = JSON.stringify({
    name: input.name,
    student_id: input.studentId,
    class_name: input.className === undefined ? "__preserve__" : input.className,
    traits: input.traits,
    parent_notes: input.parentNotes,
    expected_updated_at: input.expectedUpdatedAt,
    expected_revision: input.expectedRevision,
  });
  return `student-profile-update-${createHash("sha256").update(identity).digest("base64url")}`;
}

export async function importStudentRoster({ students, sourceName, signal }: { students: StudentRosterRow[]; sourceName: string; signal?: AbortSignal }): Promise<StudentRosterResponse> {
  const roots = resolveEduPiBridgeRoots();
  const requestId = `student-roster-${Date.now().toString(36)}`;
  const response = await runCoreProcess<StudentRosterResponse>({
    runtime: roots.runtime,
    dataRoot: roots.dataRoot,
    timeoutMs: 15_000,
    signal,
    request: {
      protocol: "edupi-desktop-bridge",
      protocol_version: 1,
      producer: "edupi-desktop",
      operation: "students",
      request_id: requestId,
      action: "import",
      source_name: sourceName,
      students: students.map((student) => ({ name: student.name, traits: student.traits, parent_notes: student.parentNotes,...(student.className?{class_name:student.className}:{}) })),
    },
  });
  if (response.code === "ambiguous_student") throw new Error("同名学生的班级不同，请核对身份，避免覆盖原档案。");
  if (response.ok !== true || response.operation !== "students" || response.external_send !== false || response.imported !== students.length) throw new Error(response.code || "学生名单导入失败。");
  return response;
}

export async function updateStudentProfile({ signal, ...input }: StudentProfileUpdateInput & { signal?: AbortSignal }): Promise<StudentProfileMutationReceipt> {
  const roots = resolveEduPiBridgeRoots();
  const requestId = studentProfileUpdateRequestId(input);
  const response = await runCoreProcess<Record<string, unknown>>({
    runtime: roots.runtime,
    dataRoot: roots.dataRoot,
    timeoutMs: 15_000,
    signal,
    request: buildStudentProfileUpdateRequest(input, requestId),
  });
  if (response.ok !== true) {
    const code = typeof response.code === "string" ? response.code : "unavailable";
    const message = code === "stale_student" ? "学生档案已更新，请刷新后重试。"
      : code === "student_not_found" ? "学生档案不存在。"
        : code === "student_deleted" ? "学生档案已删除。"
          : code === "idempotency_conflict" ? "修改请求与先前操作冲突，请刷新后重试。"
            : code === "invalid_state" ? "学生档案数据需要修复。"
              : "学生档案修改失败。";
    throw new StudentProfileUpdateError(code, message);
  }
  try {
    return normalizeStudentProfileMutationReceipt(response, {
      requestId,
      action: "update",
      studentId: input.studentId,
      studentName: input.name,
      expectedRevision: input.expectedRevision,
    });
  } catch (error) {
    throw new StudentProfileUpdateError("invalid_response", error instanceof Error ? error.message : "学生档案修改结果无效。");
  }
}
