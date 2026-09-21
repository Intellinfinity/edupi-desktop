import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function copyPreparationDependencies(root, destination) {
  const require = createRequire(join(root,"package.json"));
  const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
  const trace = await nodeFileTrace([
    join(root,"desktop/preparation-materials.mjs"),
    join(root,"desktop/preparation-source-text.mjs"),
    join(root,"desktop/office-archive.mjs"),
    join(root,"desktop/preparation-skills.mjs"),
  ],{base:root});
  if (trace.warnings.size) throw new Error("Preparation dependency tracing failed");
  for (const file of trace.fileList) {
    if (!/^node_modules[\\/]/.test(file)) continue;
    const target = join(destination,file);
    await mkdir(dirname(target),{recursive:true});
    await copyFile(join(root,file),target);
  }
}
