import type { EducationContract } from "./edupi-education-contract";
import type { TeacherContextSnapshot } from "./edupi-onboarding-types";

type EducationResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
};

type EducationFetcher = (url: string, init?: { cache?: RequestCache }) => Promise<EducationResponse>;

export type EduPiWorkspaceBundle = { context: TeacherContextSnapshot; data: EducationContract };

let inFlightWorkspaceRequest: Promise<EduPiWorkspaceBundle> | null = null;

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function waitForCaller<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function readEduPiWorkspace({
  fetcher = fetch as unknown as EducationFetcher,
  signal,
}: {
  fetcher?: EducationFetcher;
  signal?: AbortSignal;
} = {}): Promise<EduPiWorkspaceBundle> {
  if (!inFlightWorkspaceRequest) {
    const request = fetcher("/api/edupi/workspace", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`教育工作区读取失败（HTTP ${response.status ?? "unknown"}）`);
      const bundle = await response.json() as EduPiWorkspaceBundle;
      if (!bundle?.context || !bundle?.data) throw new Error("教育工作区数据无效。");
      return bundle;
    });
    inFlightWorkspaceRequest = request;
    void request.finally(() => {
      if (inFlightWorkspaceRequest === request) inFlightWorkspaceRequest = null;
    }).catch(() => {});
  }
  return waitForCaller(inFlightWorkspaceRequest, signal);
}

export async function readEduPiEducation(options: { fetcher?: EducationFetcher; signal?: AbortSignal } = {}): Promise<EducationContract> {
  return (await readEduPiWorkspace(options)).data;
}

export function preserveUnavailableWorkspaceResources(previous: EducationContract, next: EducationContract): EducationContract {
  if (!next.workspaceResourcesUnavailable) return next;
  const previousStudents = new Map(previous.students.map((student) => [student.student_id, student]));
  return {
    ...next,
    students: next.students.map((student) => {
      const prior = previousStudents.get(student.student_id);
      return !student.class_name && prior?.class_name ? { ...student, class_name: prior.class_name } : student;
    }),
    studentNameCounts: previous.studentNameCounts,
    teacherMaterials: previous.teacherMaterials,
    generatedArtifacts: previous.generatedArtifacts,
  };
}

export function resetEduPiEducationRequestForTest(): void {
  inFlightWorkspaceRequest = null;
}
