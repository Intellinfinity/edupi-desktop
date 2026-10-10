import { DESKTOP_API_TOKEN_ENV } from "./desktop-api";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { readEduPiProactivityActivation } from "./edupi-proactivity-config";
import { canStartEduPiProactivity, canStartEduPiStudentFollowup } from "./safe-mode";

/** Direct Pi message routes may not bypass an enabled Core-first capture. */
export function eduPiDirectPromptGate(dependencies: {
  desktopToken?: string;
  dataRoot?: () => string;
  activation?: (dataRoot: string, domain: "teaching_preparation" | "student_followup") => boolean;
  g1Allowed?: boolean;
  g2Allowed?: boolean;
} = {}): "allowed" | "core_first_required" | "unavailable" {
  if (!(dependencies.desktopToken ?? process.env[DESKTOP_API_TOKEN_ENV])) return "allowed";
  try {
    const dataRoot = dependencies.dataRoot?.() ?? resolveEduPiBridgeRoots().dataRoot.root;
    const active = dependencies.activation ?? ((root: string, domain: "teaching_preparation" | "student_followup") =>
      readEduPiProactivityActivation({ dataRoot: root, domain }).enabled);
    const g1 = (dependencies.g1Allowed ?? canStartEduPiProactivity()) && active(dataRoot, "teaching_preparation");
    const g2 = (dependencies.g2Allowed ?? canStartEduPiStudentFollowup()) && active(dataRoot, "student_followup");
    return g1 || g2 ? "core_first_required" : "allowed";
  } catch { return "unavailable"; }
}
