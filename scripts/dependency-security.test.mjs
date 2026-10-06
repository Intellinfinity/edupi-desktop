import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Linter } from "eslint";
import semver from "semver";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = nextRequire("./utils/get-root-dirs.js");

test("the complete lockfile excludes affected runtime and glob dependency versions", async () => {
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const patched = { next: ">=16.3.6", undici: ">=8.10.2", nodemailer: ">=10.0.9", "brace-expansion": "^1.1.21 || ^3.0.9 || >=5.0.12", dompurify: ">=3.4.16", sharp: ">=0.35.5" };
  for (const [location, entry] of Object.entries(lock.packages)) {
    const name = location.split("node_modules/").at(-1);
    assert.notEqual(name, "braces", `${location} restores the unpatched dependency`);
    if (patched[name]) assert.ok(semver.satisfies(entry.version, patched[name]), `${location}: ${entry.version}`);
  }
});

test("patched sharp renders a bounded SVG through its prebuilt image library", async () => {
  const sharp = require("sharp");
  assert.ok(semver.gte(sharp.versions.sharp, "0.35.5"));
  assert.ok(semver.gte(sharp.versions.rsvg, "2.63.2"));
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#ff0000"/></svg>')).png().toBuffer();
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [2, 2, 4]);
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255]);
});

test("Next root matching preserves static, absolute, brace and stepped patterns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-next-root-"));
  try {
    for (const directory of ["app", "app/nested", "app-01", "app-02", "app-03", "app-10", "app-11", "app-12", ".hidden"]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }
    const resolve = pattern => getRootDirs({ cwd: root, settings: { next: { rootDir: pattern } } }).sort();
    assert.deepEqual(getRootDirs({ cwd: root, settings: {} }), [root]);
    assert.deepEqual(resolve(`${root}/app`), [`${root}/app`]);
    assert.deepEqual(resolve(`${root}/app/`), [`${root}/app`]);
    assert.deepEqual(resolve(`${root}/app-{01..03}`), ["01", "02", "03"].map(n => `${root}/app-${n}`));
    assert.deepEqual(resolve(`${root}/app-{10..12}`), ["10", "11", "12"].map(n => `${root}/app-${n}`));
    assert.deepEqual(resolve(`${root}/app-{10..12..2}`), ["10", "12"].map(n => `${root}/app-${n}`));
    assert.deepEqual(resolve(`${root}/{app,.hidden}`), [`${root}/.hidden`, `${root}/app`]);
    assert.deepEqual(resolve([`${root}/app`, `${root}/missing`]), [`${root}/app`]);
    assert.deepEqual(resolve(`${root}/app`.replaceAll("/", "\\")), [`${root}/app`]);
    assert.deepEqual(resolve("vendor/next-root-glob"), ["vendor/next-root-glob"]);
    assert.throws(() => nextRequire("fast-glob").globSync("app", { onlyFiles: true }), /Unsupported Next/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Pi 1.0.2 is pinned consistently and resolves secure packages without installation patches", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  for (const name of ["pi-ai", "pi-agent-core", "pi-coding-agent", "pi-tui"]) {
    const packageName = `@earendil-works/${name}`;
    const installed = JSON.parse(await readFile(new URL(`../node_modules/${packageName}/package.json`, import.meta.url), "utf8"));
    assert.equal(manifest.dependencies[packageName], "1.0.2");
    assert.equal(lock.packages[`node_modules/${packageName}`].version, "1.0.2");
    assert.equal(installed.version, "1.0.2");
  }
  const sdkRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
  assert.ok(semver.gte(sdkRequire("undici/package.json").version, "8.10.2"));
  assert.ok(semver.gte(sdkRequire("brace-expansion/package.json").version, "5.0.12"));
  assert.ok(semver.gte(sdkRequire("minimatch/package.json").version, "10.2.6"));
  const sdk = await import("@earendil-works/pi-coding-agent");
  assert.equal(typeof sdk.createAgentSessionRuntime, "function");
  assert.equal(typeof sdk.createAgentSessionFromServices, "function");
});

test("the actual Next internal-link lint rule still rejects a plain anchor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-next-lint-"));
  try {
    await mkdir(path.join(root, "pages"));
    await writeFile(path.join(root, "pages", "about.js"), "export default function About() { return null; }");
    const linter = new Linter();
    const config = {
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      settings: { next: { rootDir: root } },
      plugins: { "@next/next": nextRequire("./index.js") },
      rules: { "@next/next/no-html-link-for-pages": "error" },
    };
    const results = linter.verify('const page = <a href="/about">About</a>;', config);
    assert.equal(results.length, 1);
    assert.equal(results[0].ruleId, "@next/next/no-html-link-for-pages");
    assert.deepEqual(linter.verify('const page = <a href="https://example.com">About</a>;', config), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("OpenConnector resolves patched Nodemailer and still composes readable mail without sending", async () => {
  const connectorRequire = createRequire(import.meta.resolve("@oomol-lab/open-connector"));
  const mailer = connectorRequire("nodemailer");
  const { simpleParser } = connectorRequire("mailparser");
  assert.ok(semver.gte(connectorRequire("nodemailer/package.json").version, "10.0.9"));
  const transport = mailer.createTransport({ streamTransport: true, buffer: true });
  try {
    const result = await transport.sendMail({ from: "teacher@example.invalid", to: "test@example.invalid",
      subject: "隔离依赖兼容测试", text: "Only in-memory MIME, no SMTP connection.", disableFileAccess: true, disableUrlAccess: true });
    const parsed = await simpleParser(result.message);
    assert.equal(parsed.subject, "隔离依赖兼容测试");
    assert.equal(parsed.to.value[0].address, "test@example.invalid");
    assert.match(parsed.text, /Only in-memory MIME/);
  } finally { transport.close(); }
});
