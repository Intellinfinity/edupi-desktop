import assert from "node:assert/strict";
import { mkdtemp, mkdir, access, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { removeUnusedMuslNativePackages } from "./packaged-sharp.mjs";

test("glibc packaging removes only the unused musl native variants", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "edupi-sharp-"));
  const sharpMusl = ["sharp-linuxmusl-x64", "sharp-libvips-linuxmusl-x64"];
  const sharpGnu = ["sharp-linux-x64", "sharp-libvips-linux-x64"];
  const canvasMusl = join("@napi-rs", "canvas-linux-x64-musl");
  const canvasGnu = join("@napi-rs", "canvas-linux-x64-gnu");
  try {
    for (const name of [...sharpMusl, ...sharpGnu]) await mkdir(join(root, "node_modules", "@img", name), { recursive: true });
    for (const name of [canvasMusl, canvasGnu]) await mkdir(join(root, "node_modules", name), { recursive: true });
    await removeUnusedMuslNativePackages(root, { platform: "linux", arch: "x64", glibc: false });
    for (const name of [...sharpMusl, ...sharpGnu]) await access(join(root, "node_modules", "@img", name));
    for (const name of [canvasMusl, canvasGnu]) await access(join(root, "node_modules", name));
    await removeUnusedMuslNativePackages(root, { platform: "linux", arch: "x64", glibc: true });
    for (const name of sharpMusl) await assert.rejects(access(join(root, "node_modules", "@img", name)));
    await assert.rejects(access(join(root, "node_modules", canvasMusl)));
    for (const name of sharpGnu) await access(join(root, "node_modules", "@img", name));
    await access(join(root, "node_modules", canvasGnu));
  } finally { await rm(root, { recursive: true, force: true }); }
});
