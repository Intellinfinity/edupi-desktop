import manifestJson from "../contracts/edupi-core-compat.json";
import { BRIDGE_COMMAND_TYPES, type CoreCommandType } from "./edupi-bridge-contract";

export type EduPiBridgeContractIdentity = {
  contract_id: "edupi-bridge-v1.1";
  contract_version: "1.1";
  schema_hash: "sha256:7f0cffd21c60f9ffa3409dcdb56c3b6683e81377ca3290741344c87a80123e7f";
  fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json";
  fixture_manifest_hash: "sha256:7e32693b41dbcaa724f62b97babdd2c015b2f4b2afcb0027f933ba6489ee4f18";
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
  core_runtime: { core_commit: "68004b2c0294159eef4f88bcbf4a921ef6978037"; component_manifest_path: "contracts/edupi-desktop-component-manifest.json"; component_manifest_hash: "sha256:d878f2fb5127f0874636975172ae0630b67b6b42957e7718b1983309e3e9632f"; runtime_component_manifest_hash: "sha256:87d742475908524522328869f7c4d402e06b6fc61f4f196989d7b174a13b1183"; runtime_schema_hash: "sha256:815f827e4a1d87c3e42c5a301b34c5eda5520b8bfbf79686f4c910f0a8dae700" };
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
  if (!manifest.core_runtime || manifest.core_runtime.core_commit !== "68004b2c0294159eef4f88bcbf4a921ef6978037" || manifest.core_runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json" || manifest.core_runtime.component_manifest_hash !== "sha256:d878f2fb5127f0874636975172ae0630b67b6b42957e7718b1983309e3e9632f" || manifest.core_runtime.runtime_component_manifest_hash !== "sha256:87d742475908524522328869f7c4d402e06b6fc61f4f196989d7b174a13b1183" || manifest.core_runtime.runtime_schema_hash !== "sha256:815f827e4a1d87c3e42c5a301b34c5eda5520b8bfbf79686f4c910f0a8dae700") throw new Error("Invalid EduPi core_runtime identity");
  const identity = manifest.contract_identities.find((item) => item.contract_id === "edupi-bridge-v1.1") as EduPiBridgeContractIdentity | undefined;
  const occurrence = manifest.contract_identities.find((item) => item.contract_id === "edupi-schedule-occurrence-v1.2") as ScheduleOccurrenceContractIdentity | undefined;
  if (manifest.contract_identities.length !== 2 || !identity || identity.contract_version !== "1.1" || identity.schema_hash !== "sha256:7f0cffd21c60f9ffa3409dcdb56c3b6683e81377ca3290741344c87a80123e7f" || identity.fixture_manifest_path !== "fixtures/bridge/v1.1/fixture-manifest.json" || identity.fixture_manifest_hash !== "sha256:7e32693b41dbcaa724f62b97babdd2c015b2f4b2afcb0027f933ba6489ee4f18" || identity.depends_on.length !== 0) throw new Error("Invalid EduPi v1.1 contract identity");
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
