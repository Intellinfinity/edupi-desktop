import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXPECTED_C1_COMMANDS,
  EXPECTED_C1_REVIEW_COMMANDS,
  buildLaunchEnvironment,
  buildNextLaunchSpec,
  cleanupVisibleCheckpoint,
  createVisibleCheckpointWorkspace,
  isDescendantPath,
  isReadyForVisibleCheckpoint,
  runVisibleCheckpoint,
  seedVisibleTargets,
  stopChildAndWait,
  validateCoreRoot,
  validatePort,
} from "./run-edupi-c1-visible-checkpoint.mjs";

const DESKTOP_ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));

function tempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeDataRoot(parent) {
  const dataRoot = path.join(parent, "core-data");
  for (const relative of [".edupi/memory", ".edupi/output", ".edupi/locks"]) {
    fs.mkdirSync(path.join(dataRoot, relative), { recursive: true });
  }
  return dataRoot;
}

test("rejects a missing or relative Core root before touching the filesystem", () => {
  assert.throws(() => validateCoreRoot({ coreRoot: "" }), /EDUPI_CORE_ROOT is required/);
  assert.throws(() => validateCoreRoot({ coreRoot: "./core" }), /absolute path/);
});

test("rejects a Core checkout whose commit is not the pinned commit", () => {
  const root = tempDirectory("edupi-c1-visible-core-");
  try {
    const gitCalls = [];
    assert.throws(
      () => validateCoreRoot({
        coreRoot: root,
        gitExec: (args) => {
          gitCalls.push(args);
          return args.at(-1) === "--is-inside-work-tree" ? "true\n" : "0000000000000000000000000000000000000000\n";
        },
      }),
      /Core commit mismatch/,
    );
    assert.deepEqual(gitCalls.map((args) => args.at(-1)), ["--is-inside-work-tree", "HEAD"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("accepts only usable non-production TCP ports", () => {
  assert.equal(validatePort(30142), 30142);
  assert.equal(validatePort("65535"), 65535);
  for (const value of [0, -1, 65536, 1.5, "not-a-port", 30141]) {
    assert.throws(() => validatePort(value), /port/i);
  }
});

test("seeds eight independent labeled targets through the Core adapter and restores the caller environment", async () => {
  const parent = tempDirectory("edupi-c1-visible-seed-");
  const dataRoot = makeDataRoot(parent);
  const realDataRoot = tempDirectory("edupi-c1-visible-real-data-");
  const before = process.env.EDUPI_DATA_ROOT;
  const calls = [];
  let importedWithTemporaryRoots = false;
  let admissionReleased = false;
  try {
    process.env.EDUPI_DATA_ROOT = realDataRoot;
    const seeded = await seedVisibleTargets({
      coreRoot: path.join(parent, "pinned-core"),
      dataRoot,
      prepareWriterRoot: (root) => ({ ok: true, root }),
      acquireWriterAdmission: async ({ root, kind }) => {
        assert.equal(root.root, dataRoot);
        assert.equal(kind, "legacy_desktop_c1_visible");
        return { release: async () => { admissionReleased = true; } };
      },
      jitiFactory: () => ({
        import: async () => {
          importedWithTemporaryRoots = process.env.EDUPI_DATA_ROOT === dataRoot
            && process.env.EDUPI_MEMORY_DIR === path.join(dataRoot, ".edupi", "memory")
            && process.env.EDUPI_OUTPUT_DIR === path.join(dataRoot, ".edupi", "output")
            && process.env.EDUPI_LOCK_DIR === path.join(dataRoot, ".edupi", "locks")
            && process.env.EDUPI_HOME === path.join(dataRoot, ".edupi");
          return {
            captureTeacherObservation(input) {
              calls.push(input);
              return {
                created: true,
                observation_id: `observation-${calls.length}`,
                candidate_id: `candidate-${calls.length}`,
              };
            },
          };
        },
      }),
    });

    assert.equal(importedWithTemporaryRoots, true);
    assert.equal(admissionReleased, true);
    assert.equal(calls.length, 8);
    assert.equal(new Set(calls.map((call) => call.source_message_id)).size, 8);
    assert.equal(seeded.observations.length, 8);
    assert.equal(seeded.memoryCandidates.length, 8);
    assert.equal(seeded.observations.length, 8);
    assert.equal(seeded.memoryCandidates.length, 8);
    assert.deepEqual(seeded.reviewTargets.slice(0, 4).map((target) => target.label), [
      "observation/accept",
      "observation/modify",
      "observation/reject",
      "observation/hold",
    ]);
    assert.deepEqual(seeded.reviewTargets.slice(4).map((target) => target.label), [
      "memory-candidate/accept",
      "memory-candidate/modify",
      "memory-candidate/reject",
      "memory-candidate/hold",
    ]);
    assert.equal(fs.existsSync(path.join(realDataRoot, ".edupi")), false);
    assert.equal(fs.existsSync(path.join(dataRoot, ".edupi", "output", "teacher_review_state.json")), false);
  } finally {
    if (before === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = before;
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(realDataRoot, { recursive: true, force: true });
  }
});

test("restores the caller environment when writer admission release fails", async () => {
  const parent = tempDirectory("edupi-c1-visible-release-failure-");
  const dataRoot = makeDataRoot(parent);
  const originalDataRoot = process.env.EDUPI_DATA_ROOT;
  const originalHome = process.env.EDUPI_HOME;
  const sentinelDataRoot = path.join(parent, "caller-data");
  const sentinelHome = path.join(parent, "caller-home");
  let captureCount = 0;
  try {
    process.env.EDUPI_DATA_ROOT = sentinelDataRoot;
    process.env.EDUPI_HOME = sentinelHome;
    await assert.rejects(seedVisibleTargets({
      coreRoot: path.join(parent, "pinned-core"),
      dataRoot,
      prepareWriterRoot: (root) => ({ ok: true, root }),
      acquireWriterAdmission: async () => ({ release: async () => { throw new Error("release failed"); } }),
      jitiFactory: () => ({ import: async () => ({ captureTeacherObservation: () => ({ created: true, observation_id: `observation-${++captureCount}`, candidate_id: `candidate-${captureCount}` }) }) }),
    }), /release failed/);
    assert.equal(process.env.EDUPI_DATA_ROOT, sentinelDataRoot);
    assert.equal(process.env.EDUPI_HOME, sentinelHome);
  } finally {
    if (originalDataRoot === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = originalDataRoot;
    if (originalHome === undefined) delete process.env.EDUPI_HOME;
    else process.env.EDUPI_HOME = originalHome;
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("creates one temporary data root, detached Desktop worktree, and node_modules link", async () => {
  const calls = [];
  const symlinks = [];
  const workspace = createVisibleCheckpointWorkspace({
    desktopRoot: DESKTOP_ROOT,
    gitExec(args, options) {
      calls.push({ args, options });
      if (args.at(-1) === "HEAD") return "desktop-head-for-test\n";
      return "";
    },
    symlink(source, target, type) {
      symlinks.push({ source, target, type });
    },
  });
  try {
    assert.equal(isDescendantPath(workspace.parentRoot, workspace.dataRoot), true);
    assert.equal(isDescendantPath(workspace.parentRoot, workspace.desktopWorktree), true);
    assert.equal(workspace.nodeModulesSource, path.join(DESKTOP_ROOT, "node_modules"));
    assert.equal(symlinks.length, 1);
    assert.equal(symlinks[0].source, workspace.nodeModulesSource);
    assert.equal(symlinks[0].target, path.join(workspace.desktopWorktree, "node_modules"));
    assert.deepEqual(calls.find((call) => call.args.includes("worktree"))?.args, [
      "worktree",
      "add",
      "--detach",
      workspace.desktopWorktree,
      "desktop-head-for-test",
    ]);
  } finally {
    await cleanupVisibleCheckpoint(workspace, {
      gitExec(args) {
        calls.push({ args });
        return "";
      },
    });
    await cleanupVisibleCheckpoint(workspace, { gitExec: () => { throw new Error("duplicate worktree removal"); } });
  }
  assert.equal(fs.existsSync(workspace.parentRoot), false);
  assert.equal(calls.filter((call) => call.args.join(" ") === `worktree remove --force ${workspace.desktopWorktree}`).length, 1);
});

test("preserves setup recovery state when linking fails and Git cannot remove the registered worktree", () => {
  const calls = [];
  let parentRoot = null;
  try {
    assert.throws(() => createVisibleCheckpointWorkspace({
      desktopRoot: DESKTOP_ROOT,
      mkdtemp(prefix) {
        parentRoot = fs.mkdtempSync(prefix);
        return parentRoot;
      },
      gitExec(args) {
        calls.push(args);
        if (args[0] === "rev-parse") return "desktop-head-for-setup-failure\n";
        if (args[0] === "worktree" && args[1] === "add") {
          fs.mkdirSync(args[3], { recursive: true });
          return "";
        }
        if (args[0] === "worktree" && args[1] === "remove") throw new Error("git worktree removal failed");
        return "";
      },
      symlink() {
        throw new Error("symlink setup failed");
      },
    }), (error) => {
      assert.match(error.message, /symlink setup failed/);
      assert.match(error.message, /git worktree removal failed/);
      assert.equal(error.cleanupPath, parentRoot);
      return true;
    });
    assert.ok(parentRoot);
    assert.equal(fs.existsSync(parentRoot), true);
    assert.equal(fs.existsSync(path.join(parentRoot, "desktop-worktree")), true);
    assert.deepEqual(calls.filter((args) => args[0] === "worktree").map((args) => args.slice(0, 3)), [
      ["worktree", "add", "--detach"],
      ["worktree", "remove", "--force"],
    ]);
  } finally {
    if (parentRoot) fs.rmSync(parentRoot, { recursive: true, force: true });
  }
});

test("builds the fixed shell-free Next argv in the temporary worktree", () => {
  const parent = tempDirectory("edupi-c1-visible-next-");
  const worktree = path.join(parent, "worktree");
  const nextBin = path.join(worktree, "node_modules", "next", "dist", "bin", "next");
  fs.mkdirSync(path.dirname(nextBin), { recursive: true });
  fs.writeFileSync(nextBin, "#!/usr/bin/env node\n");
  try {
    const launch = buildNextLaunchSpec(worktree, 30142);
    assert.deepEqual(launch.argv, [
      nextBin,
    "dev",
    "--webpack",
    "-H",
    "127.0.0.1",
    "-p",
    "30142",
    ]);
    assert.equal(launch.options.shell, false);
    assert.equal(launch.options.cwd, worktree);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("forwards every Core/data root explicitly to the secondary Desktop process", () => {
  const workspace = {
    dataRoot: "/tmp/c1-data",
    dataAllowedRoot: "/tmp",
    memoryDir: "/tmp/c1-data/.edupi/memory",
    outputDir: "/tmp/c1-data/.edupi/output",
    lockDir: "/tmp/c1-data/.edupi/locks",
  };
  const environment = buildLaunchEnvironment({
    core: { root: "/tmp/pinned-core", allowedRoot: "/tmp" },
    workspace,
    environment: { EDUPI_DATA_ROOT: "/real/data", EDUPI_CORE_ROOT: "/real/core", PATH: "/bin" },
  });
  assert.deepEqual(
    Object.fromEntries(["EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_HOME"].map((key) => [key, environment[key]])),
    {
      EDUPI_CORE_ROOT: "/tmp/pinned-core",
      EDUPI_CORE_ALLOWED_ROOT: "/tmp",
      EDUPI_DATA_ROOT: "/tmp/c1-data",
      EDUPI_DATA_ALLOWED_ROOT: "/tmp",
      EDUPI_MEMORY_DIR: "/tmp/c1-data/.edupi/memory",
      EDUPI_OUTPUT_DIR: "/tmp/c1-data/.edupi/output",
      EDUPI_LOCK_DIR: "/tmp/c1-data/.edupi/locks",
      EDUPI_HOME: "/tmp/c1-data/.edupi",
    },
  );
});

function readyStatus() {
  return {
    core: {
      status: "ready",
      supportedCommands: [...EXPECTED_C1_COMMANDS],
    },
    projection: { status: "ready", projection: "education_workspace" },
  };
}

function readyEducation() {
  return {
    externalSend: false,
    observations: Array.from({ length: 8 }, (_, index) => ({ observationId: `observation-${index}` })),
    memoryCandidates: Array.from({ length: 8 }, (_, index) => ({ candidateId: `candidate-${index}` })),
    capabilities: {
      c1Review: {
        enabled: true,
        commands: [...EXPECTED_C1_REVIEW_COMMANDS],
        actions: ["accept", "modify", "reject", "hold"],
      },
    },
  };
}

test("requires exact Core readiness, C1 capability, and 8+8 projected targets", () => {
  assert.equal(isReadyForVisibleCheckpoint({ status: readyStatus(), education: readyEducation() }), true);
  assert.equal(isReadyForVisibleCheckpoint({
    status: { ...readyStatus(), core: { ...readyStatus().core, supportedCommands: [...EXPECTED_C1_COMMANDS, "unexpected"] } },
    education: readyEducation(),
  }), false);
  assert.equal(isReadyForVisibleCheckpoint({
    status: readyStatus(),
    education: { ...readyEducation(), observations: readyEducation().observations.slice(0, 7) },
  }), false);
  assert.equal(isReadyForVisibleCheckpoint({
    status: readyStatus(),
    education: { ...readyEducation(), capabilities: { c1Review: { ...readyEducation().capabilities.c1Review, enabled: false } } },
  }), false);
});

test("prepare-only cleans its exact parent and leaves no worktree registration", async () => {
  const parentRoot = tempDirectory("edupi-c1-visible-prepare-");
  const dataRoot = makeDataRoot(parentRoot);
  const workspace = {
    parentRoot,
    dataRoot,
    dataAllowedRoot: parentRoot,
    memoryDir: path.join(dataRoot, ".edupi", "memory"),
    outputDir: path.join(dataRoot, ".edupi", "output"),
    lockDir: path.join(dataRoot, ".edupi", "locks"),
    desktopRoot: DESKTOP_ROOT,
    desktopWorktree: path.join(parentRoot, "desktop-worktree"),
    worktreeRegistered: true,
    child: null,
    cleaned: false,
  };
  let cleanupCalls = 0;
  try {
    const summary = await runVisibleCheckpoint({
      coreRoot: "/pinned-core-for-test",
      prepareOnly: true,
      writeLine: () => {},
      dependencies: {
        validateCoreRoot: () => ({ root: "/pinned-core-for-test", allowedRoot: "/pinned-core-parent", coreCommit: "pinned", componentManifestHash: "sha256:pinned" }),
        createWorkspace: () => workspace,
        seedTargets: async () => ({ observations: Array(8).fill({}), memoryCandidates: Array(8).fill({}), reviewTargets: [], counts: { observations: 8, memoryCandidates: 8, memories: 0 } }),
        assertPreparedProjection: () => ({ counts: { observations: 8, memoryCandidates: 8, memories: 0 } }),
        cleanupWorkspace: async (value) => {
          cleanupCalls += 1;
          assert.equal(value.worktreeRegistered, true);
          value.worktreeRegistered = false;
          value.cleaned = true;
          fs.rmSync(value.parentRoot, { recursive: true, force: true });
        },
      },
    });
    assert.equal(summary.status, "prepared");
  } finally {
    fs.rmSync(parentRoot, { recursive: true, force: true });
  }
  assert.equal(cleanupCalls, 1);
  assert.equal(fs.existsSync(parentRoot), false);
  assert.equal(workspace.worktreeRegistered, false);
});

test("does not claim a child exited when SIGINT, SIGTERM, and SIGKILL are ignored", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const signals = [];
  child.kill = (signal) => signals.push(signal);
  await assert.rejects(stopChildAndWait(child, { timeoutMs: 2 }), /exit timeout|exit could not be confirmed/i);
  assert.deepEqual(signals, ["SIGINT", "SIGTERM", "SIGKILL"]);
});

test("cleans after a readiness failure that occurs after the child launches", async () => {
  const child = new EventEmitter();
  child.exitCode = 1;
  child.signalCode = null;
  const parentRoot = tempDirectory("edupi-c1-visible-ready-failure-");
  const dataRoot = makeDataRoot(parentRoot);
  const workspace = {
    parentRoot,
    dataRoot,
    dataAllowedRoot: parentRoot,
    memoryDir: path.join(dataRoot, ".edupi/memory"),
    outputDir: path.join(dataRoot, ".edupi/output"),
    lockDir: path.join(dataRoot, ".edupi/locks"),
    desktopWorktree: path.join(parentRoot, "desktop-worktree"),
    desktopRoot: DESKTOP_ROOT,
    worktreeRegistered: true,
    child: null,
    cleaned: false,
  };
  let launched = false;
  let cleaned = false;
  try {
    await assert.rejects(runVisibleCheckpoint({
      coreRoot: "/pinned-core-for-test",
      writeLine: () => {},
      dependencies: {
        validateCoreRoot: () => ({ root: "/pinned-core-for-test", allowedRoot: "/pinned-core-parent", coreCommit: "pinned", componentManifestHash: "sha256:pinned" }),
        createWorkspace: () => workspace,
        seedTargets: async () => ({ observations: [], memoryCandidates: [], counts: { observations: 8, memoryCandidates: 8, memories: 0 } }),
        spawnDesktop: () => { launched = true; return { child }; },
        waitForReadiness: async () => { throw new Error("readiness failed"); },
        cleanupWorkspace: async () => { cleaned = true; },
      },
    }), /readiness failed/);
    assert.equal(launched, true);
    assert.equal(cleaned, true);
  } finally {
    fs.rmSync(workspace.parentRoot, { recursive: true, force: true });
  }
});

test("does not suppress a signal-path cleanup failure", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    child.exitCode = 130;
    child.signalCode = "SIGTERM";
    child.emit("exit", null, "SIGTERM");
  };
  const parentRoot = tempDirectory("edupi-c1-visible-signal-failure-");
  const dataRoot = makeDataRoot(parentRoot);
  const workspace = {
    parentRoot,
    dataRoot,
    dataAllowedRoot: parentRoot,
    memoryDir: path.join(dataRoot, ".edupi/memory"),
    outputDir: path.join(dataRoot, ".edupi/output"),
    lockDir: path.join(dataRoot, ".edupi/locks"),
    desktopWorktree: path.join(parentRoot, "desktop-worktree"),
    desktopRoot: DESKTOP_ROOT,
    worktreeRegistered: true,
    child: null,
    cleaned: false,
  };
  try {
    await assert.rejects(runVisibleCheckpoint({
      coreRoot: "/pinned-core-for-test",
      writeLine: () => {},
      dependencies: {
        validateCoreRoot: () => ({ root: "/pinned-core-for-test", allowedRoot: "/pinned-core-parent", coreCommit: "pinned", componentManifestHash: "sha256:pinned" }),
        createWorkspace: () => workspace,
        seedTargets: async () => ({ observations: [], memoryCandidates: [], counts: { observations: 8, memoryCandidates: 8, memories: 0 } }),
        spawnDesktop: () => ({ child }),
        waitForReadiness: async () => {
          process.emit("SIGTERM");
          return new Promise(() => {});
        },
        cleanupWorkspace: async () => { throw new Error("cleanup failed at temporary parent"); },
      },
    }), /cleanup failed/);
  } finally {
    fs.rmSync(workspace.parentRoot, { recursive: true, force: true });
  }
});

test("preserves the registered worktree and parent when Git removal fails, then retries cleanly", async () => {
  const calls = [];
  const workspace = createVisibleCheckpointWorkspace({
    desktopRoot: DESKTOP_ROOT,
    gitExec(args) {
      calls.push(args);
      if (args[0] === "rev-parse") return "desktop-head-for-retry\n";
      return "";
    },
    symlink() {},
  });
  let failRemoval = true;
  try {
    await assert.rejects(cleanupVisibleCheckpoint(workspace, {
      gitExec(args) {
        calls.push(args);
        if (failRemoval) throw new Error("git worktree removal failed");
      },
    }), /git worktree removal failed/);
    assert.equal(workspace.worktreeRegistered, true);
    assert.equal(workspace.cleaned, false);
    assert.equal(fs.existsSync(workspace.parentRoot), true);

    failRemoval = false;
    await cleanupVisibleCheckpoint(workspace, {
      gitExec(args) {
        calls.push(args);
      },
    });
    assert.equal(workspace.worktreeRegistered, false);
    assert.equal(workspace.cleaned, true);
    assert.equal(fs.existsSync(workspace.parentRoot), false);
    assert.equal(calls.filter((args) => args.join(" ") === `worktree remove --force ${workspace.desktopWorktree}`).length, 2);
  } finally {
    fs.rmSync(workspace.parentRoot, { recursive: true, force: true });
  }
});

test("does not delete the parent before a child exit is confirmed", async () => {
  const workspace = createVisibleCheckpointWorkspace({
    desktopRoot: DESKTOP_ROOT,
    gitExec(args) {
      if (args[0] === "rev-parse") return "desktop-head-for-child\n";
      return "";
    },
    symlink() {},
  });
  workspace.child = { exitCode: null, signalCode: null };
  let exited = false;
  let gitRemovals = 0;
  try {
    const stopChild = async () => {
      if (!exited) throw new Error("child exit was not confirmed");
    };
    await assert.rejects(cleanupVisibleCheckpoint(workspace, {
      stopChild,
      gitExec: (args) => {
        if (args[0] === "worktree" && args[1] === "remove") gitRemovals += 1;
      },
    }), /child exit was not confirmed/);
    assert.equal(gitRemovals, 0);
    assert.equal(workspace.worktreeRegistered, true);
    assert.equal(workspace.cleaned, false);
    assert.equal(fs.existsSync(workspace.parentRoot), true);

    exited = true;
    await cleanupVisibleCheckpoint(workspace, {
      stopChild,
      gitExec: (args) => {
        if (args[0] === "worktree" && args[1] === "remove") gitRemovals += 1;
      },
    });
    assert.equal(gitRemovals, 1);
    assert.equal(fs.existsSync(workspace.parentRoot), false);
  } finally {
    fs.rmSync(workspace.parentRoot, { recursive: true, force: true });
  }
});
