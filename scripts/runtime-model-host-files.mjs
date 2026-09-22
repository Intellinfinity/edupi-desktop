import { copyFile, cp, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export const RUNTIME_MODEL_HOST_FILES = Object.freeze([
  "core_runtime_model_adapter.mjs",
  "core_runtime_isolated_model.mjs",
  "core_runtime_model_worker.mjs",
  "calendar_work_model_runner.mjs",
  "core_runtime_harness.mjs",
  "core_runtime_g1_live_contract.mjs",
  "ambient_safety_policy.mjs",
]);

export async function copyRuntimeModelHostFiles(coreRoot, serverRoot) {
  const sourceRoot = await realpath(coreRoot);
  const sourceDirectory = path.join(sourceRoot, "scripts");
  if ((await lstat(sourceDirectory)).isSymbolicLink()) throw new Error("Runtime model host source must be a regular directory");
  const destination = path.join(serverRoot, "scripts");
  await mkdir(destination, { recursive: true });
  for (const name of RUNTIME_MODEL_HOST_FILES) {
    const source = path.join(sourceDirectory, name);
    if (!(await lstat(source)).isFile()) throw new Error("Runtime model host source must be a regular file");
    await copyFile(source, path.join(destination, name));
  }
  // These host-only files import typebox directly; standalone tracing may only
  // retain a nested SDK copy. Materialize the direct dependency without links.
  const typebox = await realpath(path.resolve(import.meta.dirname, "../node_modules/typebox"));
  await cp(typebox, path.join(serverRoot, "node_modules/typebox"), { recursive: true, dereference: true });
}
