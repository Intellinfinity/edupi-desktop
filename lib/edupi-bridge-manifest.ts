import manifestJson from "../contracts/edupi-core-compat.json";
import { BRIDGE_COMMAND_TYPES, type CoreCommandType } from "./edupi-bridge-contract";

export type EduPiBridgeContractIdentity = {
  contract_id: "edupi-bridge-v1.1";
  contract_version: "1.1";
  schema_hash: "sha256:f61408ae1cf040abbf8e24e7f9b68c1f307215dd6141f55110fdabf1b2612d74";
  fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json";
  fixture_manifest_hash: "sha256:16960512e7088be0342a1e1f549e7e062b48132453b2fdacf01e94a59b981c47";
  supported_commands: CoreCommandType[];
  supported_projections: ["education_workspace"];
  depends_on: [];
};

export type ScheduleOccurrenceContractIdentity = {
  contract_id: "edupi-schedule-occurrence-v1.2";
  contract_version: "1.2";
  schema_path: "contracts/edupi-schedule-occurrence-v1.2.schema.json";
  schema_hash: "sha256:b739852f427520f787ad32c7f41b258976a3b41d60fa6116439696c1495b97cb";
  supported_commands: ["import_calendar"];
  supported_projections: ["schedule_occurrence"];
  depends_on: ["edupi-bridge-v1.1"];
};

export type EduPiCompatManifest = {
  compat_manifest_version: "1.0";
  core_repository: "edupi";
  core_sdk: { pi: "1.0.2"; pi_durable: "1.0.2" };
  core_runtime: { core_commit: "fb2bb9f8caa1b9633ea9954ca8fdde168856754f"; component_manifest_path: "contracts/edupi-desktop-component-manifest.json"; component_manifest_hash: "sha256:4cbd73946f3af1becbd8ac4b27baa99190405a274b2694b438ff1f539943f834"; runtime_component_manifest_hash: "sha256:6926a207465b53c1101a20e2ebe46cfb9d321add41fa1492be2d815dcc0e4f37"; runtime_schema_hash: "sha256:5d7080f29011969c134a8b84e2e3497dcae1d27ee6531db04d8e51105d53c521" };
  contract_identities: [EduPiBridgeContractIdentity, ScheduleOccurrenceContractIdentity];
  cumulative_projection_manifest: null | Record<string, unknown>;
  supported_commands: CoreCommandType[];
  supported_projections: string[];
  unsupported_command_reasons: Record<Exclude<CoreCommandType, "review_observation" | "review_memory_candidate" | "review_teacher_context" | "review_work_candidate" | "review_follow_up" | "review_task" | "import_calendar" | "import_timetable" | "intake_material" | "create_task" | "move_task_stage" | "update_memory">, string>;
  unsupported_projection_reasons: Record<string, string>;
  paired_prs: string[];
  change_note: string;
};

export function loadEduPiCompatManifest(): EduPiCompatManifest {
  const manifest = manifestJson as unknown as EduPiCompatManifest;
  if (manifest.compat_manifest_version !== "1.0" || manifest.core_repository !== "edupi") throw new Error("Invalid EduPi compatibility manifest");
  if (manifest.core_sdk?.pi !== "1.0.2" || manifest.core_sdk.pi_durable !== "1.0.2") throw new Error("Invalid EduPi Core SDK pairing");
  if (!manifest.core_runtime || manifest.core_runtime.core_commit !== "fb2bb9f8caa1b9633ea9954ca8fdde168856754f" || manifest.core_runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json" || manifest.core_runtime.component_manifest_hash !== "sha256:4cbd73946f3af1becbd8ac4b27baa99190405a274b2694b438ff1f539943f834" || manifest.core_runtime.runtime_component_manifest_hash !== "sha256:6926a207465b53c1101a20e2ebe46cfb9d321add41fa1492be2d815dcc0e4f37" || manifest.core_runtime.runtime_schema_hash !== "sha256:5d7080f29011969c134a8b84e2e3497dcae1d27ee6531db04d8e51105d53c521") throw new Error("Invalid EduPi core_runtime identity");
  const identity = manifest.contract_identities.find((item) => item.contract_id === "edupi-bridge-v1.1") as EduPiBridgeContractIdentity | undefined;
  const occurrence = manifest.contract_identities.find((item) => item.contract_id === "edupi-schedule-occurrence-v1.2") as ScheduleOccurrenceContractIdentity | undefined;
  if (manifest.contract_identities.length !== 2 || !identity || identity.contract_version !== "1.1" || identity.schema_hash !== "sha256:f61408ae1cf040abbf8e24e7f9b68c1f307215dd6141f55110fdabf1b2612d74" || identity.fixture_manifest_path !== "fixtures/bridge/v1.1/fixture-manifest.json" || identity.fixture_manifest_hash !== "sha256:16960512e7088be0342a1e1f549e7e062b48132453b2fdacf01e94a59b981c47" || identity.depends_on.length !== 0) throw new Error("Invalid EduPi v1.1 contract identity");
  if (!occurrence || occurrence.contract_version !== "1.2" || occurrence.schema_path !== "contracts/edupi-schedule-occurrence-v1.2.schema.json" || occurrence.schema_hash !== "sha256:b739852f427520f787ad32c7f41b258976a3b41d60fa6116439696c1495b97cb" || occurrence.supported_commands.length !== 1 || occurrence.supported_commands[0] !== "import_calendar" || occurrence.supported_projections.length !== 1 || occurrence.supported_projections[0] !== "schedule_occurrence" || occurrence.depends_on.length !== 1 || occurrence.depends_on[0] !== "edupi-bridge-v1.1") throw new Error("Invalid EduPi v1.2 occurrence contract identity");
  const supportedCommands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"] as const;
  const hasExactCommands = (value: unknown): boolean => Array.isArray(value)
    && value.length === supportedCommands.length
    && value.every((command, index) => command === supportedCommands[index]);
  if (!hasExactCommands(manifest.supported_commands) || !hasExactCommands(identity.supported_commands)) throw new Error("EduPi C1 command capability identity is incomplete");
  if (manifest.supported_projections.length !== 1 || manifest.supported_projections[0] !== "education_workspace" || identity.supported_projections.length !== 1 || identity.supported_projections[0] !== "education_workspace") throw new Error("EduPi education projection identity is incomplete");
  const expectedUnsupportedCommands = BRIDGE_COMMAND_TYPES.filter((command) => !supportedCommands.includes(command as typeof supportedCommands[number]));
  if (Object.keys(manifest.unsupported_command_reasons).sort().join("|") !== [...expectedUnsupportedCommands].sort().join("|")) throw new Error("EduPi command reason set is incomplete");
  return manifest;
}

export function activeBridgeIdentity() {
  const manifest = loadEduPiCompatManifest();
  const contract = manifest.contract_identities.find((item) => item.contract_id === "edupi-bridge-v1.1") as EduPiBridgeContractIdentity;
  return { runtime: manifest.core_runtime, contract };
}

export function scheduleOccurrenceIdentity(): ScheduleOccurrenceContractIdentity {
  const manifest = loadEduPiCompatManifest();
  return manifest.contract_identities.find((item) => item.contract_id === "edupi-schedule-occurrence-v1.2") as ScheduleOccurrenceContractIdentity;
}
