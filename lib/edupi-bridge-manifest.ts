import manifestJson from "../contracts/edupi-core-compat.json";
import { BRIDGE_COMMAND_TYPES, type CoreCommandType } from "./edupi-bridge-contract";

export type EduPiCompatManifest = {
  compat_manifest_version: "1.0";
  core_repository: "edupi";
  core_runtime: { core_commit: "75cba8d4a331722ea2b34fb78e4e1943d02b79fb"; component_manifest_path: "contracts/edupi-desktop-component-manifest.json"; component_manifest_hash: "sha256:44d84b04262cd198db92f60edc18e31214f5918af0f580e0db11cea1329c0bfb"; runtime_component_manifest_hash: "sha256:b9ccf03ef155cbdf35c39bdfd6500829ddb72abc285be19c5cb260b1bbfcef42" };
  contract_identities: Array<{ contract_id: "edupi-bridge-v1.1"; contract_version: "1.1"; schema_hash: "sha256:b410c8708e28a76e6e0f86a4d3386227d00d3eafc50475d3d78f4bf9c9f96bca"; fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json"; fixture_manifest_hash: "sha256:f05c3d9abf69919277f4845e95fcc1e01e8657f7d1ba32bf9319e4db93209c33"; supported_commands: CoreCommandType[]; supported_projections: ["education_workspace"]; depends_on: string[] }>;
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
  if (!manifest.core_runtime || manifest.core_runtime.core_commit !== "75cba8d4a331722ea2b34fb78e4e1943d02b79fb" || manifest.core_runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json" || manifest.core_runtime.component_manifest_hash !== "sha256:44d84b04262cd198db92f60edc18e31214f5918af0f580e0db11cea1329c0bfb" || manifest.core_runtime.runtime_component_manifest_hash !== "sha256:b9ccf03ef155cbdf35c39bdfd6500829ddb72abc285be19c5cb260b1bbfcef42") throw new Error("Invalid EduPi core_runtime identity");
  const identity = manifest.contract_identities[0];
  if (manifest.contract_identities.length !== 1 || identity.contract_id !== "edupi-bridge-v1.1" || identity.contract_version !== "1.1" || identity.schema_hash !== "sha256:b410c8708e28a76e6e0f86a4d3386227d00d3eafc50475d3d78f4bf9c9f96bca" || identity.fixture_manifest_path !== "fixtures/bridge/v1.1/fixture-manifest.json" || identity.fixture_manifest_hash !== "sha256:f05c3d9abf69919277f4845e95fcc1e01e8657f7d1ba32bf9319e4db93209c33") throw new Error("Invalid EduPi contract identities");
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
