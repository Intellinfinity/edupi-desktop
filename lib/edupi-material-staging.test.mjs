import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const staging = await jiti.import("./edupi-material-staging.ts");
const route = await jiti.import("../app/api/edupi/materials/staging/route.ts");

const temporaryRoots = [];
const environmentKeys = [
  "PI_DESKTOP_STATE_DIR",
  "PI_DESKTOP_API_TOKEN",
  "EDUPI_DATA_ROOT",
  "EDUPI_CORE_ROOT",
];
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function makeRoots() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "edupi-material-staging-"));
  temporaryRoots.push(root);
  const stateDir = path.join(root, "desktop-state");
  const dataRoot = path.join(root, "edupi-data");
  const coreRoot = path.join(root, "edupi-core");
  const sourceRoot = path.join(root, "teacher-files");
  fs.mkdirSync(path.join(dataRoot, ".edupi", "memory"), { recursive: true });
  fs.mkdirSync(coreRoot, { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  return { root, stateDir, dataRoot, coreRoot, sourceRoot };
}

function options(roots, ids = []) {
  let index = 0;
  return {
    stateDir: roots.stateDir,
    dataRoot: roots.dataRoot,
    coreRoot: roots.coreRoot,
    idFactory: () => ids[index++] ?? `stg_${String(index).padStart(32, "0")}`,
  };
}

const fixtures = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]),
  webp: Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBPVP8 ", "binary"),
  pdf: Buffer.from("%PDF-1.7\nfixture"),
  doc: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x01]),
  docx: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x01]),
  ics: Buffer.from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//EduPi Test//EN\r\nEND:VCALENDAR\r\n"),
};

function input(name, mimeType, bytes) {
  return { name, mimeType, bytes: new Uint8Array(bytes) };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected ${code}`);
}

test("stages allowed material bytes with generated identities, hashes, containment, and 0600 files", () => {
  const roots = makeRoots();
  const ids = [
    "stg_00000000000000000000000000000001",
    "stg_00000000000000000000000000000002",
    "stg_00000000000000000000000000000003",
    "stg_00000000000000000000000000000004",
    "stg_00000000000000000000000000000005",
    "stg_00000000000000000000000000000006",
    "stg_00000000000000000000000000000007",
  ];
  const descriptors = staging.stageMaterialInputs([
    input("board.png", "image/png", fixtures.png),
    input("photo.jpg", "image/jpeg", fixtures.jpeg),
    input("diagram.webp", "image/webp", fixtures.webp),
    input("notice.pdf", "application/pdf", fixtures.pdf),
    input("legacy.doc", "application/msword", fixtures.doc),
    input("lesson.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fixtures.docx),
    input("calendar.ics", "text/calendar", fixtures.ics),
  ], options(roots, ids));

  assert.deepEqual(descriptors.map((item) => item.kind), ["image", "image", "image", "pdf", "word", "word", "calendar"]);
  assert.deepEqual(descriptors.map((item) => item.original_name), ["board.png", "photo.jpg", "diagram.webp", "notice.pdf", "legacy.doc", "lesson.docx", "calendar.ics"]);
  for (const [index, descriptor] of descriptors.entries()) {
    assert.deepEqual(Object.keys(descriptor).sort(), [
      "expected_size_bytes", "kind", "original_name", "source_hash", "source_scope", "staging_id", "staging_path",
    ]);
    assert.equal(descriptor.staging_id, ids[index]);
    assert.equal(descriptor.source_scope, "desktop_staging");
    assert.match(descriptor.source_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(descriptor.source_hash, `sha256:${crypto.createHash("sha256").update(fs.readFileSync(descriptor.staging_path)).digest("hex")}`);
    assert.equal(descriptor.expected_size_bytes, fs.statSync(descriptor.staging_path).size);
    assert.equal(path.relative(path.join(roots.stateDir, "material-staging"), descriptor.staging_path).startsWith(".."), false);
    if (process.platform !== "win32") assert.equal(fs.statSync(descriptor.staging_path).mode & 0o777, 0o600);
    const descriptorPath = path.join(path.dirname(descriptor.staging_path), "descriptor.json");
    assert.equal(fs.existsSync(descriptorPath), true);
    if (process.platform !== "win32") assert.equal(fs.statSync(descriptorPath).mode & 0o777, 0o600);
  }
  assert.deepEqual(staging.listStagedMaterials(options(roots)), descriptors);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(roots.stateDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(roots.stateDir, "material-staging")).mode & 0o777, 0o700);
  }
});

test("rejects unsafe names, unsupported or forged types, empty input, count overflow, and per-file size overflow before writes", () => {
  const roots = makeRoots();
  const config = options(roots);
  for (const invalid of [
    input("../escape.png", "image/png", fixtures.png),
    input("folder\\escape.png", "image/png", fixtures.png),
    input("bad\0name.png", "image/png", fixtures.png),
    input(".", "image/png", fixtures.png),
    input(`${"a".repeat(241)}.png`, "image/png", fixtures.png),
  ]) expectCode(() => staging.stageMaterialInputs([invalid], config), "invalid_name");
  expectCode(() => staging.stageMaterialInputs([], config), "invalid_count");
  expectCode(() => staging.stageMaterialInputs(Array.from({ length: 11 }, (_, index) => input(`${index}.png`, "image/png", fixtures.png)), config), "invalid_count");
  expectCode(() => staging.stageMaterialInputs([input("malware.exe", "application/octet-stream", fixtures.pdf)], config), "unsupported_type");
  expectCode(() => staging.stageMaterialInputs([input("forged.pdf", "application/pdf", fixtures.png)], config), "unsupported_type");
  expectCode(() => staging.stageMaterialInputs([input("forged.png", "application/pdf", fixtures.png)], config), "unsupported_type");
  expectCode(() => staging.stageMaterialInputs([input("forged.ics", "text/calendar", Buffer.from("BEGIN:VEVENT\r\nEND:VEVENT\r\n"))], config), "unsupported_type");
  expectCode(() => staging.stageMaterialInputs([input("nul.ics", "text/calendar", Buffer.from("BEGIN:VCALENDAR\n\0\nEND:VCALENDAR\n"))], config), "unsupported_type");
  expectCode(() => staging.stageMaterialInputs([input("bare-cr.ics", "text/calendar", Buffer.from("BEGIN:VCALENDAR\rVERSION:2.0\rEND:VCALENDAR\r"))], config), "unsupported_type");
  expectCode(() => staging.stageMaterialInputs([input("large.ics", "text/calendar", Buffer.concat([fixtures.ics, Buffer.alloc(staging.MATERIAL_STAGING_MAX_CALENDAR_BYTES)]))], config), "too_large");
  expectCode(() => staging.stageMaterialInputs([input("empty.pdf", "application/pdf", Buffer.alloc(0))], config), "unsupported_type");
  expectCode(() => staging.stageMaterialInputs([input("huge.pdf", "application/pdf", Buffer.concat([fixtures.pdf, Buffer.alloc(staging.MATERIAL_STAGING_MAX_FILE_BYTES)]))], config), "too_large");
  const stageRoot = path.join(roots.stateDir, "material-staging");
  assert.equal(fs.existsSync(stageRoot) ? fs.readdirSync(stageRoot).some((name) => name.startsWith("stg_")) : false, false);
});

test("accepts BOM or LF calendar envelopes and a native empty MIME type", () => {
  const roots = makeRoots();
  try {
    const descriptors = staging.stageMaterialInputs([
      input("bom.ics", "text/calendar", Buffer.from(`\uFEFFBEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//EduPi//EN\nEND:VCALENDAR\n`)),
      input("native.ics", "", Buffer.from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//EduPi//EN\r\nEND:VCALENDAR\r\n")),
    ], options(roots, ["stg_10000000000000000000000000000001", "stg_10000000000000000000000000000002"]));
    assert.deepEqual(descriptors.map((item) => item.kind), ["calendar", "calendar"]);
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test("rejects missing, relative, managed, or symbolic staging roots and unsafe native source paths", () => {
  const roots = makeRoots();
  expectCode(() => staging.prepareMaterialStagingRoot({ ...options(roots), stateDir: "relative-state" }), "configuration");
  const stateInsideData = path.join(roots.dataRoot, "desktop-state");
  const stateInsideCore = path.join(roots.coreRoot, "desktop-state");
  expectCode(() => staging.prepareMaterialStagingRoot({ ...options(roots), stateDir: stateInsideData }), "forbidden_root");
  expectCode(() => staging.prepareMaterialStagingRoot({ ...options(roots), stateDir: stateInsideCore }), "forbidden_root");
  assert.equal(fs.existsSync(stateInsideData), false, "a rejected data-root staging path must not be created");
  assert.equal(fs.existsSync(stateInsideCore), false, "a rejected Core-root staging path must not be created");

  const linkedParentTarget = path.join(roots.dataRoot, "linked-parent-target");
  const linkedParent = path.join(roots.root, "linked-parent");
  fs.mkdirSync(linkedParentTarget);
  fs.symlinkSync(linkedParentTarget, linkedParent);
  const stateThroughLinkedParent = path.join(linkedParent, "desktop-state");
  expectCode(() => staging.prepareMaterialStagingRoot({ ...options(roots), stateDir: stateThroughLinkedParent }), "forbidden_root");
  assert.equal(fs.existsSync(path.join(linkedParentTarget, "desktop-state")), false, "a rejected symlink-parent path must not write before validation");

  const external = path.join(roots.root, "external-state");
  fs.mkdirSync(external);
  fs.symlinkSync(external, roots.stateDir);
  expectCode(() => staging.prepareMaterialStagingRoot(options(roots)), "symlink");
  fs.unlinkSync(roots.stateDir);
  fs.mkdirSync(roots.stateDir);
  fs.symlinkSync(external, path.join(roots.stateDir, "material-staging"));
  expectCode(() => staging.prepareMaterialStagingRoot(options(roots)), "symlink");

  fs.rmSync(roots.stateDir, { recursive: true, force: true });
  const coreFile = path.join(roots.coreRoot, "secret.pdf");
  fs.writeFileSync(coreFile, fixtures.pdf);
  expectCode(() => staging.stageMaterialPaths([coreFile], options(roots)), "forbidden_source");
  const managedFile = path.join(roots.dataRoot, ".edupi", "memory", "calendar.pdf");
  fs.writeFileSync(managedFile, fixtures.pdf);
  expectCode(() => staging.stageMaterialPaths([managedFile], options(roots)), "forbidden_source");
  const teacherFile = path.join(roots.sourceRoot, "notice.pdf");
  const linkedFile = path.join(roots.sourceRoot, "linked.pdf");
  fs.writeFileSync(teacherFile, fixtures.pdf);
  fs.symlinkSync(teacherFile, linkedFile);
  expectCode(() => staging.stageMaterialPaths([linkedFile], options(roots)), "symlink");
});

test("restart preparation removes only incomplete transactions and settlement retains failures but removes accepted or teacher-cleaned staging", () => {
  const roots = makeRoots();
  const config = options(roots, [
    "stg_10000000000000000000000000000001",
    "stg_10000000000000000000000000000002",
  ]);
  const first = staging.stageMaterialInputs([input("notice.pdf", "application/pdf", fixtures.pdf)], config)[0];
  const stageRoot = path.join(roots.stateDir, "material-staging");
  const incomplete = path.join(stageRoot, ".pending-stg_ffffffffffffffffffffffffffffffff");
  fs.mkdirSync(incomplete);
  fs.writeFileSync(path.join(incomplete, "partial"), "partial");
  staging.prepareMaterialStagingRoot(config);
  assert.equal(fs.existsSync(incomplete), false);
  assert.equal(fs.existsSync(first.staging_path), true);
  assert.deepEqual(staging.listStagedMaterials(config), [first]);
  assert.deepEqual(staging.settleStagedMaterial(first.staging_id, "failed", config), { removed: false, retained: true });
  assert.equal(fs.existsSync(first.staging_path), true);
  assert.deepEqual(staging.settleStagedMaterial(first.staging_id, "accepted_receipt", config), { removed: true, retained: false });
  assert.equal(fs.existsSync(path.dirname(first.staging_path)), false);

  const second = staging.stageMaterialInputs([input("lesson.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fixtures.docx)], config)[0];
  assert.deepEqual(staging.settleStagedMaterial(second.staging_id, "teacher_cleanup", config), { removed: true, retained: false });
  assert.equal(fs.existsSync(path.dirname(second.staging_path)), false);
});

test("listing fails closed when staged descriptor metadata or bytes are tampered", () => {
  const roots = makeRoots();
  const config = options(roots, ["stg_20000000000000000000000000000001"]);
  const descriptor = staging.stageMaterialInputs([input("notice.pdf", "application/pdf", fixtures.pdf)], config)[0];
  fs.appendFileSync(descriptor.staging_path, "tamper");
  expectCode(() => staging.listStagedMaterials(config), "unavailable");
});

function configureRoute(roots, token) {
  process.env.PI_DESKTOP_STATE_DIR = roots.stateDir;
  process.env.EDUPI_DATA_ROOT = roots.dataRoot;
  process.env.EDUPI_CORE_ROOT = roots.coreRoot;
  if (token) process.env.PI_DESKTOP_API_TOKEN = token;
  else delete process.env.PI_DESKTOP_API_TOKEN;
}

function multipartRequest(form, headers = {}) {
  return new Request("http://localhost/api/edupi/materials/staging", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin", ...headers },
    body: form,
  });
}

test("multipart route stages bounded browser files and rejects cross-site, unknown fields, and oversized wire bodies", async () => {
  const roots = makeRoots();
  configureRoute(roots);
  const form = new FormData();
  form.append("files", new File([fixtures.png], "board.png", { type: "image/png" }));
  const response = await route.POST(multipartRequest(form));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.staged.length, 1);
  assert.equal(body.staged[0].original_name, "board.png");
  assert.deepEqual(Object.keys(body.staged[0]).sort(), [
    "expected_size_bytes", "kind", "original_name", "source_hash", "source_scope", "staging_id", "staging_path",
  ]);
  const listed = await route.GET(multipartRequest(new FormData()));
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).staged, body.staged);

  const crossSite = new FormData();
  crossSite.append("files", new File([fixtures.png], "board.png", { type: "image/png" }));
  assert.equal((await route.POST(multipartRequest(crossSite, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).status, 403);
  const unknown = new FormData();
  unknown.append("files", new File([fixtures.png], "board.png", { type: "image/png" }));
  unknown.append("destination", "/tmp/escape");
  assert.equal((await route.POST(multipartRequest(unknown))).status, 400);

  const oversized = new Request("http://localhost/api/edupi/materials/staging", {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      "content-type": "multipart/form-data; boundary=x",
      "content-length": String(staging.MATERIAL_STAGING_MAX_REQUEST_BYTES + 1),
    },
    body: "--x--\r\n",
  });
  assert.equal((await route.POST(oversized)).status, 413);
});

test("native source-path staging requires the desktop token and never accepts caller destinations", async () => {
  const roots = makeRoots();
  const token = "a".repeat(64);
  configureRoute(roots, token);
  const sourcePath = path.join(roots.sourceRoot, "notice.pdf");
  fs.writeFileSync(sourcePath, fixtures.pdf);
  const base = {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ sourcePaths: [sourcePath] }),
  };
  assert.equal((await route.POST(new Request("http://localhost/api/edupi/materials/staging", base))).status, 403);
  const authorized = new Request("http://localhost/api/edupi/materials/staging", {
    ...base,
    headers: { ...base.headers, "x-pi-desktop-token": token },
  });
  const response = await route.POST(authorized);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.staged[0].kind, "pdf");
  assert.equal(body.staged[0].staging_path.startsWith(path.join(roots.stateDir, "material-staging")), true);

  const forbiddenDestination = new Request("http://localhost/api/edupi/materials/staging", {
    ...base,
    headers: { ...base.headers, "x-pi-desktop-token": token },
    body: JSON.stringify({ sourcePaths: [sourcePath], destination: roots.dataRoot }),
  });
  assert.equal((await route.POST(forbiddenDestination)).status, 400);
});
