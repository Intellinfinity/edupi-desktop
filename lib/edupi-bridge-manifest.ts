import manifestJson from "../contracts/edupi-core-compat.json";
import { BRIDGE_COMMAND_TYPES, type CoreCommandType } from "./edupi-bridge-contract";

export type EduPiBridgeContractIdentity = {
  contract_id: "edupi-bridge-v1.1";
  contract_version: "1.1";
  schema_hash: "sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8";
  fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json";
  fixture_manifest_hash: "sha256:807f27fd5ebb13e9eb40055aba5825d85df4b2bc04dbe92a3a5dc830534ebc91";
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
  core_runtime: { core_commit: "b195512fb9a96ae04c35340ebdea78eddd816152"; component_manifest_path: "contracts/edupi-desktop-component-manifest.json"; component_manifest_hash: "sha256:e62be5ddc0ed1cde02a96c033aafcd09940a2fb46f76ecb73314638058a651a7"; runtime_component_manifest_hash: "sha256:ca757d41bdb2c0d5e48162a42db58bce8b8ead25aead6e0a035268eb90b64d63"; runtime_schema_hash: "sha256:4749a9e921e1a0537270f2b2a024018304e231d9029385fabdefbb2ae380f82f" };
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
  if (!manifest.core_runtime || manifest.core_runtime.core_commit !== "b195512fb9a96ae04c35340ebdea78eddd816152" || manifest.core_runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json" || manifest.core_runtime.component_manifest_hash !== "sha256:e62be5ddc0ed1cde02a96c033aafcd09940a2fb46f76ecb73314638058a651a7" || manifest.core_runtime.runtime_component_manifest_hash !== "sha256:ca757d41bdb2c0d5e48162a42db58bce8b8ead25aead6e0a035268eb90b64d63" || manifest.core_runtime.runtime_schema_hash !== "sha256:4749a9e921e1a0537270f2b2a024018304e231d9029385fabdefbb2ae380f82f") throw new Error("Invalid EduPi core_runtime identity");
  const identity = manifest.contract_identities.find((item) => item.contract_id === "edupi-bridge-v1.1") as EduPiBridgeContractIdentity | undefined;
  const occurrence = manifest.contract_identities.find((item) => item.contract_id === "edupi-schedule-occurrence-v1.2") as ScheduleOccurrenceContractIdentity | undefined;
  if (manifest.contract_identities.length !== 2 || !identity || identity.contract_version !== "1.1" || identity.schema_hash !== "sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8" || identity.fixture_manifest_path !== "fixtures/bridge/v1.1/fixture-manifest.json" || identity.fixture_manifest_hash !== "sha256:807f27fd5ebb13e9eb40055aba5825d85df4b2bc04dbe92a3a5dc830534ebc91" || identity.depends_on.length !== 0) throw new Error("Invalid EduPi v1.1 contract identity");
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
