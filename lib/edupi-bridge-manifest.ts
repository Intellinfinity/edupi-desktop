import manifestJson from "../contracts/edupi-core-compat.json";
import { BRIDGE_COMMAND_TYPES, type CoreCommandType } from "./edupi-bridge-contract";

export type EduPiCompatManifest = {
  compat_manifest_version: "1.0";
  core_repository: "edupi";
  core_runtime: { core_commit: "156ee8ec5daa11d5f1e38dbdee3e60799f46b3a1"; component_manifest_path: "contracts/edupi-desktop-component-manifest.json"; component_manifest_hash: "sha256:d131daa7f6d42adcaeca9db478394180c64da510b14dcb547a9690e25694035e"; runtime_component_manifest_hash: "sha256:44cafdb91843a5690ea20b4bda138cc23d3eaf165a8a034a75019c4bd2313276" };
  contract_identities: Array<{ contract_id: "edupi-bridge-v1.1"; contract_version: "1.1"; schema_hash: "sha256:7861fffd15d32074a8021ad98e7e082c841910118cfc50918f812816e5710da6"; fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json"; fixture_manifest_hash: "sha256:18bc0a493e0f414c2726965d38fb56be6723b840a1483c1ad55adff114b01555"; supported_commands: CoreCommandType[]; supported_projections: ["education_workspace"]; depends_on: string[] }>;
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
  if (!manifest.core_runtime || manifest.core_runtime.core_commit !== "156ee8ec5daa11d5f1e38dbdee3e60799f46b3a1" || manifest.core_runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json" || manifest.core_runtime.component_manifest_hash !== "sha256:d131daa7f6d42adcaeca9db478394180c64da510b14dcb547a9690e25694035e" || manifest.core_runtime.runtime_component_manifest_hash !== "sha256:44cafdb91843a5690ea20b4bda138cc23d3eaf165a8a034a75019c4bd2313276") throw new Error("Invalid EduPi core_runtime identity");
  const identity = manifest.contract_identities[0];
  if (manifest.contract_identities.length !== 1 || identity.contract_id !== "edupi-bridge-v1.1" || identity.contract_version !== "1.1" || identity.schema_hash !== "sha256:7861fffd15d32074a8021ad98e7e082c841910118cfc50918f812816e5710da6" || identity.fixture_manifest_path !== "fixtures/bridge/v1.1/fixture-manifest.json" || identity.fixture_manifest_hash !== "sha256:18bc0a493e0f414c2726965d38fb56be6723b840a1483c1ad55adff114b01555") throw new Error("Invalid EduPi contract identities");
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
  return { runtime: manifest.core_runtime, contract: manifest.contract_identities[0] };
}
