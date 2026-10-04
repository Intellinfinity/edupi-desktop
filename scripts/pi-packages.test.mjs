import assert from "node:assert/strict";
import test from "node:test";
import { assertCoreSdkAlignment, assertDesktopPiVersion } from "./pi-packages.mjs";

const pi = "1.0.2";
const desktopPackage = { dependencies: Object.fromEntries(["pi-ai", "pi-agent-core", "pi-coding-agent", "pi-tui"].map(name => [`@earendil-works/${name}`, pi])) };
const corePackage = { dependencies: Object.fromEntries(["pi-ai", "pi-coding-agent", "chord", "pi-durable"].map(name => [`@earendil-works/${name}`, pi])) };
const output = "scripts/vendor/pi-durable-v1.0.2.mjs";
const durableBuild = { sdk_version: pi, output, output_hash: `sha256:${"a".repeat(64)}`, size_bytes: 123 };
const runtimeManifest = { modules: [{ path: output, sha256: durableBuild.output_hash, size: 123 },
  { path: "scripts/vendor/pi-durable-v1.0.2.build.json" }], assets: [] };
const fixture = () => structuredClone({ desktopPackage, corePackage, identity: { pi, pi_durable: pi }, durableBuild, runtimeManifest });

test("Desktop Pi packages cannot lag the paired Core version or use floating ranges", () => {
  assert.doesNotThrow(() => assertDesktopPiVersion(desktopPackage, pi));
  for (const version of ["0.84.1", "^1.0.2", undefined]) {
    const candidate = structuredClone(desktopPackage);
    candidate.dependencies["@earendil-works/pi-ai"] = version;
    assert.throws(() => assertDesktopPiVersion(candidate, pi), /must match Core/);
  }
  assert.throws(() => assertDesktopPiVersion(desktopPackage, undefined), /exact Core Pi version/);
});

test("Core SDK and fixed Durable bytes must be paired in the same runtime closure", () => {
  assert.doesNotThrow(() => assertCoreSdkAlignment(fixture()));
  for (const mutate of [
    value => { value.corePackage.dependencies["@earendil-works/pi-coding-agent"] = "0.84.1"; },
    value => { value.corePackage.dependencies["@earendil-works/chord"] = "1.0.3"; },
    value => { value.corePackage.dependencies["@earendil-works/pi-durable"] = "1.0.3"; },
    value => { value.durableBuild.sdk_version = "1.0.3"; },
    value => { value.durableBuild.output_hash = `sha256:${"b".repeat(64)}`; },
    value => { value.durableBuild.size_bytes++; },
    value => { value.runtimeManifest.modules.pop(); },
    value => { value.runtimeManifest.modules = []; },
  ]) {
    const candidate = fixture(); mutate(candidate);
    assert.throws(() => assertCoreSdkAlignment(candidate));
  }
});
