import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildEducationContract, buildEducationContractFromWorkspace } = await jiti.import("../lib/edupi-education-contract.ts");
const navigation = await jiti.import("../lib/edupi-domain-navigation.ts");
const feedback = await jiti.import("../lib/edupi-teacher-feedback.ts");
const COMMANDS = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function publicTarget({ revision = 0, status = "pending_review", summary = "下节课核对移项时的符号。" } = {}) {
  const reviewed = ["accepted", "modified", "rejected", "held"].includes(status);
  return {
    projection_kind: "follow_up", target: { target_kind: "follow_up", target_id: "synthetic-follow-up", command_type: "review_follow_up" },
    revision, title: "合成学生跟进", summary: "合成观察：移项漏写负号。", internal_draft_summary: summary,
    status, source_ids: ["synthetic-follow-up"], evidence_ids: ["synthetic-evidence"], observed_event_ids: ["synthetic-observation"],
    permission_state: "not_required", external_send: false,
    teacher_review: { state: status, revision, reviewer_id: reviewed ? "synthetic-teacher" : null,
      reviewed_at: reviewed ? "2026-10-04T01:00:00.000Z" : null, note: null },
  };
}

function dataFor(options = {}, transform = value => value) {
  const payload = transform({ snapshot_id: `snapshot-follow-up-${options.revision || 0}`, state_hash: `sha256:${"a".repeat(64)}`,
    capabilities: { supported_commands: COMMANDS }, review_targets: [publicTarget(options)] });
  return buildEducationContract({ snapshotPayload: payload, supportedCommands: COMMANDS });
}

// Synthetic component/hook VM only. No browser, Core daemon, or installed-app evidence.
function componentHarness(file, exportName, initialProps, fetcher = async () => response({})) {
  const slots = [], effects = new Map();
  let cursor = 0, dirty = false, props = initialProps, tree;
  const sameDeps = (left, right) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = next => { const value = typeof next === "function" ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useMemo(factory, deps) { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: factory(), deps }; return slots[index].value; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect(callback, deps) { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].deps, deps)) effects.set(index, { callback, deps }); else effects.delete(index); },
    useLayoutEffect(callback, deps) { react.useEffect(callback, deps); },
  };
  const jsx = (type, props) => typeof type === "function" ? type(props) : { type, props };
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "./EduPiFollowUpFeedback": { EduPiFollowUpFeedback: value => ({ type: "follow-up-feedback", props: value }) },
    "./EduPiTodayWork": { EduPiTeacherValueForm: value => ({ type: "teacher-value-form", props: value }) },
    "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/desktop-native": { desktopApiHeaders: async extra => extra || {} },
    "@/lib/edupi-teacher-feedback": { ...feedback,
      prepareTeacherFeedbackCapture: input => feedback.prepareTeacherFeedbackCapture(input, fetcher, async extra => extra || {}),
      recordTeacherFeedback: input => feedback.recordTeacherFeedback(input, fetcher, async extra => extra || {}),
    },
    "@/lib/edupi-domain-navigation": navigation,
    "@/lib/edupi-workbench": {}, "@/lib/edupi-work-case": {}, "@/lib/edupi-fact-lifecycle-model": {}, "./EduPiFactActions": {},
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Error, AbortSignal, crypto: crypto.webcrypto, fetch: fetcher,
    require: name => { assert.ok(modules[name], `Unexpected import: ${name}`); return modules[name]; } });
  const render = () => {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 40, "Component effects did not settle");
      dirty = false; cursor = 0; tree = exports[exportName](props);
      if (dirty) continue;
      const pending = [...effects]; effects.clear();
      for (const [index] of pending) slots[index]?.cleanup?.();
      for (const [index, effect] of pending) slots[index] = { deps: effect.deps, cleanup: effect.callback() };
    } while (dirty);
    return tree;
  };
  const find = (type, label) => nodes(render()).find(node => node.type === type && (label === undefined || node.props["aria-label"] === label || textOf(node.props.children) === label));
  const get = (type, label) => { const node = find(type, label); assert.ok(node, `Missing ${type}: ${label}`); return node; };
  return { render, find, get,
    click(label) { const node = get("button", label); assert.ok(!node.props.disabled, `${label} is disabled`); node.props.onClick(); render(); },
    change(type, label, value) { get(type, label).props.onChange({ target: { value } }); render(); },
    update(next) { props = { ...props, ...next }; render(); },
    async settle() { await tick(); render(); },
  };
}
function nodes(value) { return !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)]; }
function textOf(value) { return typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(textOf).join("") : value && typeof value === "object" ? textOf(value.props?.children) : ""; }

test("projects only public follow-up summaries with current review identity in both contract builders", () => {
  const data = dataFor({}, payload => ({ ...payload, student_follow_ups: [{ follow_up_id: "private-only", next_step: "不得展示" }] }));
  assert.equal(data.followUps.length, 1);
  const item = data.followUps[0];
  assert.equal(item.internalDraftSummary, "下节课核对移项时的符号。");
  assert.equal(item.snapshotId, "snapshot-follow-up-0");
  assert.equal(item.revision, 0);
  assert.equal(Object.hasOwn(item, "nextStep"), false);
  assert.equal(data.capabilities.followUpReview.enabled, true);
  assert.equal(data.capabilities.c1Review.enabled, true);
  const fromWorkspace = buildEducationContractFromWorkspace({}, { workspacePath: "synthetic", supportedCommands: COMMANDS,
    snapshotPayload: { snapshot_id: "snapshot-follow-up-0", state_hash: `sha256:${"a".repeat(64)}`, capabilities: { supported_commands: COMMANDS }, review_targets: [publicTarget()] } });
  assert.deepEqual(fromWorkspace.followUps, data.followUps);
  assert.deepEqual(dataFor({}, payload => ({ ...payload, review_targets: [], student_follow_ups: [publicTarget()] })).followUps, []);
});

test("invalid, withdrawn, duplicate and unsupported follow-up projections stay unavailable", () => {
  for (const mutate of [
    item => { item.status = "withdrawn"; }, item => { item.external_send = true; },
    item => { item.teacher_review.revision = 1; }, item => { item.source_ids = ["another-target"]; },
    item => { item.observed_event_ids = []; }, item => { item.next_step = "private field"; },
  ]) assert.deepEqual(dataFor({}, payload => { mutate(payload.review_targets[0]); return payload; }).followUps, []);
  assert.deepEqual(dataFor({}, payload => { payload.review_targets.push(structuredClone(payload.review_targets[0])); return payload; }).followUps, []);
  assert.equal(dataFor({}, payload => { payload.capabilities.supported_commands = COMMANDS.filter(value => value !== "review_follow_up"); return payload; }).capabilities.followUpReview.enabled, false);
});

test("follow-up route and review board retain the public object for review and later feedback", () => {
  const target = { kind: "follow_up", id: "synthetic:follow-up/1" };
  assert.deepEqual(navigation.reviewTargetRoute(navigation.reviewTargetObjectId(target)), target);
  const chosen = [];
  const app = componentHarness("./EduPiReviewBoard.tsx", "EduPiReviewBoard", { data: dataFor(), query: "", onReviewTarget: value => chosen.push(value) });
  const row = nodes(app.render()).find(node => node.type === "button" && textOf(node).includes("合成学生跟进"));
  assert.ok(row); row.props.onClick();
  assert.deepEqual(chosen.map(value => ({ ...value })), [{ kind: "follow_up", id: "synthetic-follow-up" }]);
  app.update({ data: dataFor({ revision: 1, status: "accepted" }) });
  assert.match(textOf(app.render()), /已审核/);
});

test("follow-up summary editing sends CAS fields, preserves conflict input, and verifies refreshed content", async () => {
  let current = dataFor(), fail = true, refreshes = 0;
  const writes = [];
  let app;
  app = componentHarness("./EduPiC1Review.tsx", "EduPiC1Review", {
    data: current, reviewerId: "synthetic-teacher", selectedTarget: { kind: "follow_up", id: "synthetic-follow-up" },
    onRefresh: async () => { refreshes += 1; app.update({ data: current }); },
  }, async (_url, init) => {
    const body = JSON.parse(init.body); writes.push(body);
    if (fail) return response({ reason: "Core 快照已变化" }, 409);
    current = dataFor({ revision: 3, status: "modified", summary: body.patch.internalDraftSummary });
    return response({ data: current, receipt: { receipt_id: "receipt-follow-up", command_type: "review_follow_up",
      target: { target_kind: "follow_up", target_id: "synthetic-follow-up", command_type: "review_follow_up" }, decision: "modify", status: "modified",
      teacher_review: { revision: 3 }, after_snapshot_id: current.followUps[0].snapshotId, external_send: false } });
  });
  app.render(); app.click("修改");
  assert.equal(nodes(app.render()).filter(node => node.type === "textarea").length, 1);
  assert.doesNotMatch(textOf(app.render()), /下一步/);
  app.change("textarea", "跟进草稿摘要", "核对一道移项练习。");
  app.click("保存修改"); await app.settle();
  assert.equal(app.get("textarea", "跟进草稿摘要").props.value, "核对一道移项练习。");
  assert.equal(refreshes, 0); assert.equal(writes.length, 1);
  current = dataFor({ revision: 2 });
  app.click("刷新"); await app.settle();
  assert.equal(writes.length, 1, "Refresh must never replay a review POST");
  fail = false; app.click("保存修改"); await app.settle();
  assert.equal(writes[1].targetKind, "follow_up");
  assert.equal(writes[1].expectedSnapshotId, "snapshot-follow-up-2");
  assert.equal(writes[1].expectedRevision, 2);
  assert.deepEqual(writes[1].patch, { internalDraftSummary: "核对一道移项练习。" });
  assert.equal(app.find("textarea", "跟进草稿摘要"), undefined);
  assert.equal(app.get("follow-up-feedback").props.followUp.revision, 3);
  assert.match(textOf(app.render()), /已记录回执/);
  app.update({ data: dataFor({}, payload => ({ ...payload, review_targets: [] })) });
  assert.equal(app.find("follow-up-feedback"), undefined, "Withdrawn public targets must not leave an active feedback entry");
});

test("observation and memory edits retain their original review route and patch fields", async () => {
  for (const kind of ["observation", "memory_candidate"]) {
    const data = dataFor({}, payload => ({ ...payload, review_targets: [],
      observations: [{ observation_id: "synthetic-observation", text: "原观察", observed_at: "2026-10-04T00:00:00.000Z", evidence_ids: ["synthetic-evidence"], provenance: [], teacher_review: publicTarget().teacher_review }],
      memory_candidates: [{ candidate_id: "synthetic-memory", category: "teaching", proposed_content: "原记忆候选", tags: [], based_on_observation_ids: ["synthetic-observation"], evidence_ids: ["synthetic-evidence"], inference_status: "candidate_only", external_send: false, teacher_review: publicTarget().teacher_review }],
    }));
    const writes = [], id = kind === "observation" ? "synthetic-observation" : "synthetic-memory";
    const app = componentHarness("./EduPiC1Review.tsx", "EduPiC1Review", { data, reviewerId: "teacher", selectedTarget: { kind, id }, onRefresh: async () => {} }, async (_url, init) => {
      const body = JSON.parse(init.body); writes.push(body);
      return response({ receipt: { receipt_id: "receipt-c1", command_type: `review_${kind}`, target: { target_kind: kind, target_id: id, command_type: `review_${kind}` }, status: "modified", after_snapshot_id: "snapshot-c1", external_send: false } });
    });
    app.render(); app.click("修改"); app.change("textarea", "修改内容", "修订内容"); app.click("保存修改"); await app.settle();
    assert.equal(writes[0].targetKind, kind);
    assert.deepEqual(writes[0].patch, kind === "observation" ? { text: "修订内容" } : { proposed_content: "修订内容" });
    assert.equal(Object.hasOwn(writes[0], "expectedRevision"), false);
  }
});

test("a review receipt without the requested public summary does not claim success", async () => {
  let refreshes = 0;
  const changed = dataFor({ revision: 1, status: "modified", summary: "回读的另一份摘要。" });
  const app = componentHarness("./EduPiC1Review.tsx", "EduPiC1Review", {
    data: dataFor(), reviewerId: "teacher", selectedTarget: { kind: "follow_up", id: "synthetic-follow-up" },
    onRefresh: async () => { refreshes += 1; },
  }, async () => response({ data: changed, receipt: { receipt_id: "receipt-unconfirmed", command_type: "review_follow_up",
    target: { target_kind: "follow_up", target_id: "synthetic-follow-up", command_type: "review_follow_up" }, decision: "modify", status: "modified",
    teacher_review: { revision: 1 }, after_snapshot_id: changed.followUps[0].snapshotId, external_send: false } }));
  app.render(); app.click("修改"); app.change("textarea", "跟进草稿摘要", "教师要求保留的摘要。"); app.click("保存修改"); await app.settle();
  assert.equal(app.get("textarea", "跟进草稿摘要").props.value, "教师要求保留的摘要。");
  assert.equal(refreshes, 0);
  assert.doesNotMatch(textOf(app.render()), /已记录回执/);
  assert.match(textOf(app.render()), /未核对跟进草稿的新版本/);
});

test("a late review completion cannot clear another object draft or a later visit to the same object", async () => {
  for (const returnToFirst of [false, true]) {
    const pending = deferred();
    let refreshes = 0;
    const second = publicTarget(); second.target.target_id = "synthetic-second"; second.source_ids = ["synthetic-second"];
    const data = dataFor({}, payload => ({ ...payload, review_targets: [...payload.review_targets, second] }));
    const app = componentHarness("./EduPiC1Review.tsx", "EduPiC1Review", {
      data, reviewerId: "teacher", selectedTarget: { kind: "follow_up", id: "synthetic-follow-up" }, onRefresh: async () => { refreshes += 1; },
    }, () => pending.promise);
    app.render(); app.click("修改"); app.change("textarea", "跟进草稿摘要", "第一个对象提交的摘要"); app.click("保存修改");
    app.update({ selectedTarget: { kind: "follow_up", id: "synthetic-second" } });
    app.click("修改"); app.change("textarea", "跟进草稿摘要", "第二个对象未提交的摘要");
    if (returnToFirst) {
      app.update({ selectedTarget: { kind: "follow_up", id: "synthetic-follow-up" } });
      app.click("修改"); app.change("textarea", "跟进草稿摘要", "返回第一个对象后的新草稿");
    }
    const refreshed = dataFor({ revision: 1, status: "modified", summary: "第一个对象提交的摘要" });
    pending.resolve(response({ data: refreshed, receipt: { receipt_id: "late-first-receipt", command_type: "review_follow_up",
      target: { target_kind: "follow_up", target_id: "synthetic-follow-up", command_type: "review_follow_up" }, decision: "modify", status: "modified",
      teacher_review: { revision: 1 }, after_snapshot_id: refreshed.followUps[0].snapshotId, external_send: false } }));
    await app.settle();
    assert.equal(app.get("textarea", "跟进草稿摘要").props.value, returnToFirst ? "返回第一个对象后的新草稿" : "第二个对象未提交的摘要");
    assert.equal(refreshes, 0, "A stale completion must not trigger a refresh in the current view");
    assert.doesNotMatch(textOf(app.render()), /late-first-receipt|已记录回执/);
  }
});

test("a stale review failure cannot finish the next object's pending submission", async () => {
  const first = deferred(), secondRequest = deferred();
  let requests = 0;
  const second = publicTarget(); second.target.target_id = "synthetic-second"; second.source_ids = ["synthetic-second"];
  const data = dataFor({}, payload => ({ ...payload, review_targets: [...payload.review_targets, second] }));
  const app = componentHarness("./EduPiC1Review.tsx", "EduPiC1Review", { data, reviewerId: "teacher",
    selectedTarget: { kind: "follow_up", id: "synthetic-follow-up" }, onRefresh: async () => {},
  }, () => ++requests === 1 ? first.promise : secondRequest.promise);
  app.render(); app.click("修改"); app.change("textarea", "跟进草稿摘要", "第一个提交"); app.click("保存修改");
  app.update({ selectedTarget: { kind: "follow_up", id: "synthetic-second" } });
  app.click("修改"); app.change("textarea", "跟进草稿摘要", "第二个提交"); app.click("保存修改");
  first.resolve(response({ reason: "旧对象失败" }, 503)); await app.settle();
  assert.ok(app.get("button", "处理中…").props.disabled);
  assert.equal(app.get("textarea", "跟进草稿摘要").props.value, "第二个提交");
  assert.doesNotMatch(textOf(app.render()), /旧对象失败/);
  secondRequest.resolve(response({ reason: "当前对象需要重试" }, 503)); await app.settle();
  assert.match(textOf(app.render()), /当前对象需要重试/);
});

test("switching targets during a review refresh preserves the new draft", async () => {
  const pendingRefresh = deferred();
  const second = publicTarget(); second.target.target_id = "synthetic-second"; second.source_ids = ["synthetic-second"];
  const data = dataFor({}, payload => ({ ...payload, review_targets: [...payload.review_targets, second] }));
  const refreshed = dataFor({ revision: 1, status: "modified", summary: "第一个提交" });
  const app = componentHarness("./EduPiC1Review.tsx", "EduPiC1Review", { data, reviewerId: "teacher",
    selectedTarget: { kind: "follow_up", id: "synthetic-follow-up" }, onRefresh: () => pendingRefresh.promise,
  }, async () => response({ data: refreshed, receipt: { receipt_id: "before-refresh-receipt", command_type: "review_follow_up",
    target: { target_kind: "follow_up", target_id: "synthetic-follow-up", command_type: "review_follow_up" }, decision: "modify", status: "modified",
    teacher_review: { revision: 1 }, after_snapshot_id: refreshed.followUps[0].snapshotId, external_send: false } }));
  app.render(); app.click("修改"); app.change("textarea", "跟进草稿摘要", "第一个提交"); app.click("保存修改"); await app.settle();
  app.update({ selectedTarget: { kind: "follow_up", id: "synthetic-second" } });
  app.click("修改"); app.change("textarea", "跟进草稿摘要", "刷新期间的新对象草稿");
  pendingRefresh.resolve(); await app.settle();
  assert.equal(app.get("textarea", "跟进草稿摘要").props.value, "刷新期间的新对象草稿");
  assert.doesNotMatch(textOf(app.render()), /before-refresh-receipt|已记录回执/);
});

test("the panel counts follow-ups and keeps valid follow-up details until their source disappears", () => {
  const source = fs.readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const c1PendingCount ="), end = source.indexOf("  const updateLocation =", start);
  assert.ok(start > 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = (education, selectedC1Target = { kind: "follow_up", id: "synthetic-follow-up" }) => {
    const modes = [];
    const context = { education, selectedC1Target, activeView: "review", reviewMode: "c1", pendingCount: 0, context: null,
      useEffect: effect => effect(), setReviewMode: mode => modes.push(mode) };
    vm.runInNewContext(`${code}\nglobalThis.pending = c1PendingCount;`, context);
    return { pending: context.pending, modes };
  };
  assert.deepEqual(run(null), { pending: 0, modes: [] }, "Cold loading must not discard a selected review route");
  assert.deepEqual(run(dataFor()), { pending: 1, modes: [] });
  assert.deepEqual(run(dataFor({ revision: 1, status: "accepted" })), { pending: 0, modes: [] });
  const withdrawn = dataFor({}, payload => ({ ...payload, review_targets: [] }));
  assert.deepEqual(run(withdrawn), { pending: 0, modes: ["board"] });
  assert.deepEqual(run(withdrawn, { kind: "observation", id: "missing" }), { pending: 0, modes: ["board"] });
  assert.deepEqual(run(dataFor(), { kind: "follow_up", id: "withdrawn-other-target" }), { pending: 1, modes: ["board"] });
});

test("follow-up feedback binds its own domain and current target, retries the same record, and reads it back", async () => {
  const followUp = dataFor({ revision: 1, status: "accepted" }).followUps[0];
  const events = [], records = [];
  let recorded = false, rejectReadback = true;
  const fetcher = async (_url, init = {}) => {
    if (init.method !== "POST") {
      if (recorded && rejectReadback) return response({ ok: false }, 503);
      return response({ ok: true, result: { feedback: recorded ? [{ feedback_id: "feedback-follow-up", session_id: "desktop-follow-up", current: true, source_status: "current",
        target: { kind: "follow_up", target_id: followUp.followUpId, revision: 1 } }] : [] } });
    }
    const body = JSON.parse(init.body); events.push(body.action);
    if (body.action === "target_read") return response({ ok: true, result: { kind: "follow_up", target_id: followUp.followUpId,
      revision: 1, fingerprint: `sha256:${"b".repeat(64)}`, domain: "student_followup", scope: { class_id: "703", subject: "数学" }, evidence_ids: followUp.evidenceIds } });
    assert.equal(body.action, "record"); records.push(body.record); recorded = true;
    return response({ ok: true, result: { feedback_id: "feedback-follow-up", replayed: records.length > 1, current: true } });
  };
  const app = componentHarness("./EduPiFollowUpFeedback.tsx", "EduPiFollowUpFeedback", { followUp }, fetcher);
  app.render(); await app.settle(); app.click("评价本次跟进");
  const form = app.get("teacher-value-form"); form.props.onChange({ ...form.props.draft, usefulness: "useful", used: true });
  app.get("teacher-value-form").props.onSubmit(); await app.settle();
  assert.deepEqual(events, ["target_read", "record"]);
  assert.equal(records[0].domain, "student_followup");
  assert.equal(records[0].target.kind, "follow_up");
  assert.equal(records[0].target.target_id, followUp.followUpId);
  assert.equal(records[0].target.expected_revision, 1);
  assert.doesNotMatch(textOf(app.render()), /已评价/);
  rejectReadback = false; app.click("重试记录"); await app.settle();
  assert.deepEqual(events, ["target_read", "record", "record"]);
  assert.equal(records[1].command_id, records[0].command_id);
  assert.match(textOf(app.render()), /已评价/);
});

test("feedback refuses a changed follow-up revision before recording", async () => {
  const events = [];
  const app = componentHarness("./EduPiFollowUpFeedback.tsx", "EduPiFollowUpFeedback", { followUp: dataFor({ revision: 1, status: "accepted" }).followUps[0] }, async (_url, init = {}) => {
    if (init.method !== "POST") return response({ ok: true, result: { feedback: [] } });
    const body = JSON.parse(init.body); events.push(body.action);
    return response({ ok: true, result: { kind: "follow_up", target_id: "synthetic-follow-up", revision: 2,
      fingerprint: `sha256:${"b".repeat(64)}`, domain: "student_followup", scope: { class_id: "703", subject: "数学" }, evidence_ids: ["synthetic-evidence"] } });
  });
  app.render(); await app.settle(); app.click("评价本次跟进");
  const form = app.get("teacher-value-form"); form.props.onChange({ ...form.props.draft, usefulness: "useful" });
  app.get("teacher-value-form").props.onSubmit(); await app.settle();
  assert.deepEqual(events, ["target_read"]);
  assert.match(textOf(app.render()), /目标已变化/);
});

test("historical and unverified feedback records never mark a follow-up as currently evaluated", async () => {
  const followUp = dataFor({ revision: 1, status: "accepted" }).followUps[0];
  for (const sourceStatus of ["historical", "unverified", undefined]) {
    const app = componentHarness("./EduPiFollowUpFeedback.tsx", "EduPiFollowUpFeedback", { followUp }, async () => response({ ok: true, result: { feedback: [
      { feedback_id: "old-feedback", session_id: "desktop-follow-up", current: true, source_status: sourceStatus,
        target: { kind: "follow_up", target_id: followUp.followUpId, revision: followUp.revision } },
    ] } }));
    app.render(); await app.settle();
    assert.ok(app.get("button", "评价本次跟进"));
    assert.doesNotMatch(textOf(app.render()), /已评价/);
  }
});

test("a fresh historical source read removes an existing current-feedback badge", async () => {
  const followUp = dataFor({ revision: 1, status: "accepted" }).followUps[0];
  let sourceStatus = "current";
  const app = componentHarness("./EduPiFollowUpFeedback.tsx", "EduPiFollowUpFeedback", { followUp }, async () => response({ ok: true, result: { feedback: [
    { feedback_id: "feedback-follow-up", session_id: "desktop-follow-up", current: true, source_status: sourceStatus,
      target: { kind: "follow_up", target_id: followUp.followUpId, revision: 1 } },
  ] } }));
  app.render(); await app.settle();
  assert.match(textOf(app.render()), /已评价/);
  sourceStatus = "historical"; app.update({ followUp: { ...followUp } }); await app.settle();
  assert.doesNotMatch(textOf(app.render()), /已评价/);
  assert.ok(app.get("button", "评价本次跟进"));
});

test("feedback readback must confirm the source is current after recording", async () => {
  const followUp = dataFor({ revision: 1, status: "accepted" }).followUps[0];
  let recorded = false;
  const app = componentHarness("./EduPiFollowUpFeedback.tsx", "EduPiFollowUpFeedback", { followUp }, async (_url, init = {}) => {
    if (init.method !== "POST") return response({ ok: true, result: { feedback: recorded ? [{ feedback_id: "feedback-unverified", session_id: "desktop-follow-up",
      current: true, source_status: "unverified", target: { kind: "follow_up", target_id: followUp.followUpId, revision: 1 } }] : [] } });
    const body = JSON.parse(init.body);
    if (body.action === "target_read") return response({ ok: true, result: { kind: "follow_up", target_id: followUp.followUpId, revision: 1,
      fingerprint: `sha256:${"b".repeat(64)}`, domain: "student_followup", scope: { class_id: "703", subject: "数学" }, evidence_ids: followUp.evidenceIds } });
    assert.equal(body.action, "record"); recorded = true;
    return response({ ok: true, result: { feedback_id: "feedback-unverified", replayed: false, current: true } });
  });
  app.render(); await app.settle(); app.click("评价本次跟进");
  const form = app.get("teacher-value-form"); form.props.onChange({ ...form.props.draft, usefulness: "useful" });
  app.get("teacher-value-form").props.onSubmit(); await app.settle();
  assert.equal(recorded, true);
  assert.doesNotMatch(textOf(app.render()), /已评价/);
  assert.match(textOf(app.render()), /目标已变化/);
});

test("older feedback source reads cannot replace a newer historical result or leave submission busy", async () => {
  for (const phase of ["before-record", "after-record"]) {
    const followUp = dataFor({ revision: 1, status: "accepted" }).followUps[0];
    const delayed = deferred(), actions = [];
    let reads = 0, delayedReadStarted = false;
    const feedbackResponse = sourceStatus => response({ ok: true, result: { feedback: [{ feedback_id: "feedback-race", session_id: "desktop-follow-up",
      current: true, source_status: sourceStatus, target: { kind: "follow_up", target_id: followUp.followUpId, revision: 1 } }] } });
    const app = componentHarness("./EduPiFollowUpFeedback.tsx", "EduPiFollowUpFeedback", { followUp }, async (_url, init = {}) => {
      if (init.method !== "POST") {
        reads += 1;
        if (reads === 1 || phase === "after-record" && reads === 2) return response({ ok: true, result: { feedback: [] } });
        if (reads === (phase === "before-record" ? 2 : 3)) { delayedReadStarted = true; return delayed.promise; }
        return feedbackResponse("historical");
      }
      const body = JSON.parse(init.body); actions.push(body.action);
      if (body.action === "target_read") return response({ ok: true, result: { kind: "follow_up", target_id: followUp.followUpId, revision: 1,
        fingerprint: `sha256:${"b".repeat(64)}`, domain: "student_followup", scope: { class_id: "703", subject: "数学" }, evidence_ids: followUp.evidenceIds } });
      assert.equal(body.action, "record");
      return response({ ok: true, result: { feedback_id: "feedback-race", replayed: false, current: true } });
    });
    app.render(); await app.settle(); app.click("评价本次跟进");
    const form = app.get("teacher-value-form"); form.props.onChange({ ...form.props.draft, usefulness: "useful" });
    app.get("teacher-value-form").props.onSubmit(); await app.settle();
    assert.equal(delayedReadStarted, true);
    app.update({ followUp: { ...followUp } }); await app.settle();
    assert.doesNotMatch(textOf(app.render()), /已评价/);
    delayed.resolve(feedbackResponse("current")); await app.settle();
    assert.doesNotMatch(textOf(app.render()), /已评价/, phase);
    if (phase === "before-record") {
      assert.deepEqual(actions, []);
      assert.equal(app.get("teacher-value-form").props.busy, false);
    } else {
      assert.deepEqual(actions, ["target_read", "record"]);
      assert.ok(!app.get("button", "重试记录").props.disabled);
    }
  }
});
