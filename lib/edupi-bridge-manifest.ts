import manifestJson from "../contracts/edupi-core-compat.json";
import { BRIDGE_COMMAND_TYPES, type CoreCommandType } from "./edupi-bridge-contract";

export type EduPiCompatManifest = {
  compat_manifest_version: "1.0";
  core_repository: "edupi";
  core_runtime: { core_commit: "e8623a34715a96a1ad94cc2971727c037886fbbd"; component_manifest_path: "contracts/edupi-desktop-component-manifest.json"; component_manifest_hash: "sha256:b3475c904d31bb928841dd3e11262ef738634ffc635889bc8f3f87d863f41699"; runtime_component_manifest_hash: "sha256:41f630677371db59184ecd2ead4ddf97f19c38aff9bd90baa0dbbdd3a68235a6" };
  contract_identities: Array<{ contract_id: "edupi-bridge-v1.1"; contract_version: "1.1"; schema_hash: "sha256:d4702ef3bb303996cea137f9f1337a20a8c6853b0b7d215cca64265bf2cd4daa"; fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json"; fixture_manifest_hash: "sha256:455ca9489f582b3a41223ce2518436445ec1b25ec4fdd8e5d10e35b3387a253e"; supported_commands: CoreCommandType[]; supported_projections: ["education_workspace"]; depends_on: string[] }>;
  cumulative_projection_manifest: null | Record<string, unknown>;
  supported_commands: CoreCommandType[];
  supported_projections: string[];
  unsupported_command_reasons: Record<Exclude<CoreCommandType, "review_observation" | "review_memory_candidate" | "review_teacher_context" | "review_work_candidate" | "review_task" | "import_calendar" | "import_timetable" | "intake_material" | "create_task" | "move_task_stage" | "update_memory">, string>;
  unsupported_projection_reasons: Record<string, string>;
  paired_prs: string[];
  change_note: string;
};

export function loadEduPiCompatManifest(): EduPiCompatManifest {
  const manifest = manifestJson as unknown as EduPiCompatManifest;
  if (manifest.compat_manifest_version !== "1.0" || manifest.core_repository !== "edupi") throw new Error("Invalid EduPi compatibility manifest");
  if (!manifest.core_runtime || manifest.core_runtime.core_commit !== "e8623a34715a96a1ad94cc2971727c037886fbbd" || manifest.core_runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json" || manifest.core_runtime.component_manifest_hash !== "sha256:b3475c904d31bb928841dd3e11262ef738634ffc635889bc8f3f87d863f41699" || manifest.core_runtime.runtime_component_manifest_hash !== "sha256:41f630677371db59184ecd2ead4ddf97f19c38aff9bd90baa0dbbdd3a68235a6") throw new Error("Invalid EduPi core_runtime identity");
  const identity = manifest.contract_identities[0];
  if (manifest.contract_identities.length !== 1 || identity.contract_id !== "edupi-bridge-v1.1" || identity.contract_version !== "1.1" || identity.schema_hash !== "sha256:d4702ef3bb303996cea137f9f1337a20a8c6853b0b7d215cca64265bf2cd4daa" || identity.fixture_manifest_path !== "fixtures/bridge/v1.1/fixture-manifest.json" || identity.fixture_manifest_hash !== "sha256:455ca9489f582b3a41223ce2518436445ec1b25ec4fdd8e5d10e35b3387a253e") throw new Error("Invalid EduPi contract identities");
  const supportedCommands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"] as const;
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
  return { runtime: manifest.core_runtime, contract: manifest.contract_identities[0] };
}
