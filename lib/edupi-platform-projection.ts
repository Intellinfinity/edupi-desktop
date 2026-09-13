export const EDUPI_PLATFORM_PROJECTIONS = [
  { operation: "teaching-skills", key: "teachingSkills", kind: "teaching_skill_lifecycle" },
  { operation: "connectors", key: "connectors", kind: "connector_registry" },
  { operation: "agent-computer", key: "agentComputer", kind: "persistent_agent_computer" },
  { operation: "platform", key: "platform", kind: "hosted_core_harness_registry" },
] as const;

export function projectPlatformResults(results: PromiseSettledResult<Record<string, unknown>>[]) {
  const body: Record<string, unknown> = { scope: "teacher_internal", externalSend: false };
  const status: Record<string, "ready" | "unavailable"> = {};
  let ready = 0;
  EDUPI_PLATFORM_PROJECTIONS.forEach((definition, index) => {
    const result = results[index];
    const response = result?.status === "fulfilled" ? result.value : null;
    const projection = response?.projection as { projection_kind?: unknown } | undefined;
    const valid = response?.ok === true && projection?.projection_kind === definition.kind;
    body[definition.key] = valid ? projection : null;
    status[definition.key] = valid ? "ready" : "unavailable";
    if (valid) ready += 1;
  });
  return { ...body, status: ready === EDUPI_PLATFORM_PROJECTIONS.length ? "ready" : ready > 0 ? "partial" : "unavailable", projections: status };
}
