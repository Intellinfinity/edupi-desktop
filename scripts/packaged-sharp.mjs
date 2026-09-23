import { rm } from "node:fs/promises";
import { join } from "node:path";

// Traced optional dependencies include both libc variants; linuxdeploy tries
// to link even unused musl ELF files when building on glibc.
export async function removeUnusedMuslNativePackages(serverRoot, {
  platform = process.platform,
  arch = process.arch,
  glibc = Boolean(process.report?.getReport().header.glibcVersionRuntime),
} = {}) {
  if (platform !== "linux" || !glibc || !["x64", "arm64"].includes(arch)) return;
  for (const name of [`sharp-linuxmusl-${arch}`, `sharp-libvips-linuxmusl-${arch}`]) {
    await rm(join(serverRoot, "node_modules", "@img", name), { recursive: true, force: true });
  }
  await rm(join(serverRoot, "node_modules", "@napi-rs", `canvas-linux-${arch}-musl`), { recursive: true, force: true });
}
