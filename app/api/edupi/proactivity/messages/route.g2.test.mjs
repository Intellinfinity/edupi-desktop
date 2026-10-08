import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const actualLedger = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../../lib/edupi-ambient-message-ledger.ts");

function fixture({g1=true,g2=true,g3=false,g3Legacy=false,isolated=true,g2Active=true,g3Active=true,failG1=false,g1Recorded=false,g1Applied=false,lostG1Reply=false,lostG2Reply=false,lostG3Reply=false}={}) {
  const prepared=[],captured=[],confirmed=[],uncertain=[],settled=[];
  let recoverG1=false,recoverG2=false;
  let premarked=0;
  let bodyReads=0;
  class AmbientError extends Error {constructor(code){super(code);this.code=code;this.stage="owner";}}
  const modules={
    "next/server":{NextResponse:{json:(value,options={})=>({status:options.status??200,json:async()=>value})}},
    "node:crypto":crypto,
    "@/lib/desktop-api-auth":{isDesktopApiRequestAllowed:()=>true},
    "@/lib/bounded-form-data":{parseJsonWithinLimit:async r=>{bodyReads++;return r.json();},RequestBodyTooLargeError:class extends Error{}},
    "@/lib/edupi-core-snapshot":{resolveEduPiBridgeRoots:()=>({runtime:{coreCommit:"synthetic-exact-pin"},dataRoot:{root:"/synthetic-root"}})},
    "@/lib/safe-mode":{canStartEduPiStudentFollowup:()=>isolated,canStartEduPiCapabilityCanary:()=>isolated},
    "@/lib/edupi-proactivity-config":{readEduPiProactivityActivation:({domain})=>({enabled:domain==="student_followup"?g2
      :domain==="calendar_administration"?g3:domain==="teaching_preparation"?g1:false,
      source:"desktop_canary",configurationStatus:"ready",grantId:domain==="calendar_administration"
        ?g3Legacy?"desktop_canary_v2_wrong_domain":"cap-calendar-administration-exact":domain,
      scope:{classId:"class-1",subject:"数学"}})},
    "@/lib/session-reader":{resolveSessionPath:async()=>"synthetic-session"},
    "@/lib/edupi-ambient-session-lock":{withEduPiAmbientSessionLock:async(_id,operation)=>operation()},
    "@/lib/edupi-proactivity-runtime":{readProactivityOwnerContext:async()=>({status:"active"})},
    "@/lib/edupi-runtime-supervisor":{isEduPiG3ExactRuntimeSupported:()=>isolated,
      ensureEduPiRuntime:async()=>({call:async()=>({ok:true,result:{data_root_fingerprint:`sha256:${"a".repeat(64)}`,capabilities:{ambient_planning:"active",owner_intent:"active",g2_processor:g2Active?"active":"activation_pending",g3_processor:g3Active?"active":"activation_pending"}}})})},
    "@/lib/edupi-proactivity-control":{isCapabilityGrantBindingIdentity:(_domain,_scope,grantId)=>grantId==="cap-calendar-administration-exact"},
    "@/lib/edupi-ambient-message-ledger":{
      prepareEduPiAmbientMessageBinding:value=>prepared.push(value),
      confirmEduPiAmbientMessageBinding:(sessionId,messageId,messageRef)=>confirmed.push({sessionId,messageId,messageRef}),
      markEduPiAmbientMessageWithdrawn:()=>{},
      markEduPiAmbientMessageOutcomeUnknown:(sessionId,messageRef)=>{
        const matched=prepared.find(item=>item.sessionId===sessionId&&item.messageRef===messageRef);
        assert.ok(matched);
        if(!uncertain.some(item=>item.sessionId===sessionId&&item.messageRef===messageRef)) uncertain.push({...matched,status:"outcome_unknown"});
      },
      readUnsettledEduPiAmbientMessages:sessionId=>uncertain.filter(item=>item.sessionId===sessionId),
      readSettledEduPiAmbientMessages:sessionId=>settled.filter(item=>item.sessionId===sessionId),
      markEduPiAmbientMessageOutcomeSettled:(sessionId,messageRef)=>{
        const index=uncertain.findIndex(item=>item.sessionId===sessionId&&item.messageRef===messageRef);
        if(index>=0)uncertain.splice(index,1);
        const matched=prepared.find(item=>item.sessionId===sessionId&&item.messageRef===messageRef);
        assert.ok(matched);settled.push({...matched,status:"settled"});
      },
      markEduPiAmbientMessageOutcomeVerified:(sessionId,messageRef)=>{
        const index=uncertain.findIndex(item=>item.sessionId===sessionId&&item.messageRef===messageRef);
        assert.ok(index>=0);settled.push({...uncertain[index],status:"settled"});uncertain.splice(index,1);
      },
    },
    "@/lib/edupi-ambient-message-recovery":{readExactEduPiAmbientGoalBinding:async()=>recoverG1
      ?{status:"applied",goalId:"goal-1",goalVersion:1,workCaseId:"work-1"}:{status:"outcome_unknown"},
      readExactEduPiG2Execution:async()=>recoverG2
        ?{status:"applied",goalId:"goal-g2",goalVersion:1,followUpId:"followup-g2",executionId:"execution-g2"}:{status:"outcome_unknown"}},
    "@/lib/edupi-ambient-message-runtime":{EduPiAmbientMessageError:AmbientError,
      predictEduPiOwnerMessageRef:(_root,_owner,_message,domain)=>`owner_message:${(domain==="student_followup"?"b":"a").repeat(64)}`,
      captureAndApplyAmbientMessage:async(_host,input,callbacks)=>{
      captured.push(input);
      if(failG1&&input.domain==="teaching_preparation")throw new AmbientError("proactivity_grant_unavailable");
      const binding={messageRef:`owner_message:${(input.domain==="student_followup"?"b":"a").repeat(64)}`,ownerId:"owner-1",grantId:input.grantId,captureGrantVersion:1};
      await callbacks.onPrepared(binding);await callbacks.onCaptured(binding);
      if(lostG1Reply&&input.domain==="teaching_preparation"){
        assert.equal(typeof callbacks.onApplyPending,"function");
        await callbacks.onApplyPending(binding);
        premarked++;
        assert.equal(uncertain.length,1,"the private marker is durable before Core route_apply");
        throw new Error("synthetic_lost_reply");
      }
      if(input.domain==="student_followup"){
        await callbacks.onApplyPending(binding);
        if(lostG2Reply)throw new Error("synthetic_g2_reply_lost_after_enqueue");
      }
      if(input.domain==="calendar_administration"){
        await callbacks.onApplyPending(binding);
        if(lostG3Reply)throw new Error("synthetic_g3_reply_lost");
        return {status:"queued",goalId:"goal-g3",workCaseId:"work-g3",routedDomain:input.domain,externalSend:false};
      }
      return {status:input.domain==="student_followup"?"queued":g1Recorded?"recorded":g1Applied?"applied":"captured",
        ...(g1Recorded&&input.domain==="teaching_preparation"?{goalId:"goal-synthetic",workCaseId:null,
          resolutionStatus:"needs_verification",reason:"work_case_unverified"}:{}),externalSend:false};
    }},
  };
  const exports={};
  const code=ts.transpileModule(fs.readFileSync(new URL("./route.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,URL,require:name=>{assert.ok(modules[name],name);return modules[name];}});
  const request=()=>new Request("http://localhost/api/edupi/proactivity/messages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:"session-1",messageId:"message-1",text:"Synthetic teacher message",occurredAt:"2026-10-04T00:00:00.000Z"})});
  return {route:exports,request,prepared,captured,confirmed,uncertain,premarked:()=>premarked,
    setRecoverG1:value=>{recoverG1=value;},setRecoverG2:value=>{recoverG2=value;},bodyReads:()=>bodyReads};
}

test("one message keeps independent G1/G2 receipts under the same session withdrawal ledger",async()=>{
  const f=fixture();
  assert.equal((await(await f.route.GET(f.request())).json()).status,"enabled");
  const response=await f.route.POST(f.request());
  const result=await response.json();
  assert.equal(response.status,200);assert.equal(result.status,"queued");
  assert.equal(result.domainResults.length,2);
  assert.equal(f.captured[0].messageId,"message-1");assert.equal(f.captured[1].messageId,"message-1");
  assert.equal(new Set(f.prepared.map(x=>x.messageRef)).size,2);
  assert.ok(f.prepared.every(x=>x.sessionId==="session-1"));
  assert.equal(f.confirmed.length,2);
});

test("G2 Core enqueue loss stays durable before write and cannot be replayed after restart",async()=>{
  const f=fixture({g1:false,g2:true,lostG2Reply:true});
  const first=await f.route.POST(f.request());
  assert.equal(first.status,200);
  assert.equal((await first.json()).status,"outcome_unknown");
  assert.equal(f.uncertain.length,1);
  assert.equal(f.uncertain[0].messageId,"message-1");
  const reopened=await f.route.GET(new Request("http://localhost/api/edupi/proactivity/messages?sessionId=session-1"));
  assert.equal((await reopened.json()).status,"outcome_unknown");
  const repeated=await f.route.POST(f.request());
  assert.equal((await repeated.json()).status,"outcome_unknown");
  assert.equal(f.captured.length,1,"reentry cannot enqueue the same G2 message twice");
  f.setRecoverG2(true);
  const verified=await f.route.GET(new Request("http://localhost/api/edupi/proactivity/messages?sessionId=session-1&verify=1"));
  const state=await verified.json();
  assert.equal(state.status,"applied");
  assert.equal(state.pending.length,0);
  assert.equal(JSON.stringify(state.recovered),JSON.stringify([{messageId:f.uncertain[0]?.messageId??f.prepared[0].messageId,
    goalId:"goal-g2",followUpId:"followup-g2",executionId:"execution-g2"}]));
  assert.equal(f.captured.length,1,"the read-only proof cannot enqueue again");
});

test("an earlier successful G1 result cannot mask a later G2 unknown outcome",async()=>{
  const f=fixture({g1Applied:true,lostG2Reply:true});
  const response=await f.route.POST(f.request());
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.status,"outcome_unknown");
  assert.equal(body.domain,"student_followup");
  assert.equal(JSON.stringify(body.domainResults.map(item=>item.status)),JSON.stringify(["applied","outcome_unknown"]));
  assert.equal(f.uncertain.length,1);
});

test("G2 cannot capture outside an isolated root or while its processor is off",async()=>{
  for(const options of [{g1:false,isolated:false},{g1:false,g2Active:false}]){
    const f=fixture(options);
    assert.equal((await(await f.route.GET(f.request())).json()).status,"disabled");
    const response=await f.route.POST(f.request());
    assert.notEqual((await response.json()).status,"queued");
    assert.equal(f.captured.length,0);
    if(!options.isolated&&Object.hasOwn(options,"isolated"))assert.equal(f.bodyReads(),0);
  }
});

test("an unavailable G1 grant does not drop an independently authorized G2 message",async()=>{
  const f=fixture({failG1:true});
  const response=await f.route.POST(f.request());
  const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.status,"queued");
  assert.equal(body.domainResults[0].code,"proactivity_grant_unavailable");
  assert.equal(f.prepared.length,1);assert.equal(f.prepared[0].grantId,"student_followup");
});

test("a persisted G1 receipt needing verification stops before a second-domain enqueue",async()=>{
  const f=fixture({g1Recorded:true});
  const response=await f.route.POST(f.request());
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.status,"recorded");
  assert.equal(body.goalId,"goal-synthetic");
  assert.equal(body.workCaseId,null);
  assert.equal(f.captured.length,1);
  assert.equal(f.captured[0].domain,"teaching_preparation");
  assert.equal(Object.hasOwn(body,"domainResults"),false);
});

test("a lost Core reply stays durable, survives session reentry and never retries apply",async()=>{
  const f=fixture({lostG1Reply:true});
  const first=await f.route.POST(f.request());
  assert.equal(first.status,200);
  assert.equal((await first.json()).status,"outcome_unknown");
  assert.equal(f.captured.length,1);
  assert.equal(f.uncertain.length,1);
  assert.equal(f.premarked(),1);
  const reopened=await f.route.GET(new Request("http://localhost/api/edupi/proactivity/messages?sessionId=session-1"));
  const pending=await reopened.json();
  assert.equal(reopened.status,200);
  assert.equal(pending.status,"outcome_unknown");
  assert.equal(pending.pending.length,1);
  assert.equal(pending.pending[0].messageId,"message-1");
  const replay=await f.route.POST(f.request());
  assert.equal((await replay.json()).status,"outcome_unknown");
  assert.equal(f.captured.length,1,"an exact repeated POST cannot issue a second Core route_apply");
  const different=new Request("http://localhost/api/edupi/proactivity/messages",{method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:"session-1",messageId:"message-2",
      text:"Synthetic teacher message",occurredAt:"2026-10-04T00:00:01.000Z"})});
  const blocked=await f.route.POST(different);
  assert.equal((await blocked.json()).status,"verification_pending");
  assert.equal(f.captured.length,1,"a different message cannot create another Goal while the first result is unknown");
});

test("a read-only exact Core binding clears one durable unknown outcome after reentry",async()=>{
  const f=fixture({lostG1Reply:true});
  await f.route.POST(f.request());
  const before=await f.route.GET(new Request("http://localhost/api/edupi/proactivity/messages?sessionId=session-1&verify=1"));
  assert.equal((await before.json()).status,"outcome_unknown");
  f.setRecoverG1(true);
  const after=await f.route.GET(new Request("http://localhost/api/edupi/proactivity/messages?sessionId=session-1&verify=1"));
  const result=await after.json();
  assert.equal(after.status,200);
  assert.equal(result.status,"applied");
  assert.equal(result.pending.length,0);
  assert.equal(JSON.stringify(result.recovered),JSON.stringify([{messageId:"message-1",goalId:"goal-1",workCaseId:"work-1"}]));
  assert.equal(f.captured.length,1,"read-only recovery must not repeat capture or route_apply");
});

test("an isolated ready G3 domain reaches only Core-owned routing and clears its write fence",async()=>{
  const f=fixture({g1:false,g2:false,g3:true});
  assert.equal((await(await f.route.GET(f.request())).json()).status,"enabled");
  const response=await f.route.POST(f.request());
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.status,"queued");
  assert.equal(body.goalId,"goal-g3");
  assert.equal(f.captured.length,1);
  assert.equal(f.captured[0].domain,"calendar_administration");
  assert.equal(f.uncertain.length,0,"a complete Core receipt clears the pre-write unknown marker");
  const inactive=fixture({g1:false,g2:false,g3:true,g3Active:false});
  assert.equal((await(await inactive.route.GET(inactive.request())).json()).status,"disabled");
  assert.notEqual((await(await inactive.route.POST(inactive.request())).json()).status,"queued");
  assert.equal(inactive.captured.length,0);
});

test("an old G3 config sharing a G1-shaped grant is not an active natural-message binding",async()=>{
  const f=fixture({g1:false,g2:false,g3:true,g3Legacy:true});
  assert.equal((await(await f.route.GET(f.request())).json()).status,"disabled");
  assert.equal((await(await f.route.POST(f.request())).json()).status,"disabled");
  assert.equal(f.captured.length,0);
});

test("G3 lost apply reply keeps one durable unknown and blocks a new domain message",async()=>{
  const f=fixture({g1:false,g2:false,g3:true,lostG3Reply:true});
  const first=await f.route.POST(f.request());
  assert.equal((await first.json()).status,"outcome_unknown");
  assert.equal(f.uncertain.length,1);
  assert.equal(f.captured.length,1);
  const repeated=await f.route.POST(f.request());
  assert.equal((await repeated.json()).status,"outcome_unknown");
  assert.equal(f.captured.length,1);
});

test("the actual private ledger accepts all five domain captures for one Pi message", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-multidomain-route-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  const domains = ["teaching_preparation", "student_followup", "calendar_administration", "lesson_reflection", "parent_communication"];
  const captureIds = [];
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => ({ status: options.status ?? 200, json: async () => body }) } },
    "node:crypto": crypto,
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ runtime: { coreCommit: "synthetic-exact-pin" }, dataRoot: { root: dataRoot } }) },
    "@/lib/safe-mode": { canStartEduPiStudentFollowup: () => true },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: ({ domain }) => ({ enabled: true,
      source: "desktop_canary", configurationStatus: "ready", grantId: `grant-${domain}`,
      scope: { classId: "class-1", subject: domain === "calendar_administration" ? "administration" : "数学" } }) },
    "@/lib/session-reader": { resolveSessionPath: async () => "synthetic-session" },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_id, operation) => operation() },
    "@/lib/edupi-proactivity-runtime": { readProactivityOwnerContext: async () => ({ status: "active" }) },
    "@/lib/edupi-runtime-supervisor": { isEduPiG3ExactRuntimeSupported: () => true,
      ensureEduPiRuntime: async () => ({ call: async () => ({ ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
        capabilities: { ambient_planning: "active", owner_intent: "active", g2_processor: "active", g3_processor: "active" } } }) }) },
    "@/lib/edupi-proactivity-control": { isCapabilityGrantBindingIdentity: () => true },
    "@/lib/edupi-ambient-message-ledger": Object.fromEntries([
      "prepareEduPiAmbientMessageBinding", "confirmEduPiAmbientMessageBinding", "markEduPiAmbientMessageOutcomeUnknown",
      "markEduPiAmbientMessageOutcomeVerified", "markEduPiAmbientMessageOutcomeSettled",
      "readUnsettledEduPiAmbientMessages", "readSettledEduPiAmbientMessages",
    ].map(name => [name, (...args) => actualLedger[name](...args.slice(0, -1), { stateDir, dataRoot })])),
    "@/lib/edupi-ambient-message-recovery": { readExactEduPiAmbientGoalBinding: async () => ({ status: "outcome_unknown" }),
      readExactEduPiG2Execution: async () => ({ status: "outcome_unknown" }) },
    "@/lib/edupi-ambient-message-runtime": { EduPiAmbientMessageError: class extends Error {},
      predictEduPiOwnerMessageRef: () => "",
      captureAndApplyAmbientMessage: async (_host, input, callbacks) => {
        captureIds.push(input.messageId);
        const binding = { messageRef: `owner_message:${crypto.createHash("sha256").update(input.domain).digest("hex")}`,
          ownerId: "owner-1", grantId: input.grantId, captureGrantVersion: 1 };
        await callbacks.onPrepared(binding); await callbacks.onCaptured(binding);
        if (input.domain === "lesson_reflection") {
          await callbacks.onApplyPending(binding);
          return { status: "queued", goalId: "goal-reflection", workCaseId: "work-reflection", routedDomain: input.domain, externalSend: false };
        }
        return { status: "captured", resolutionStatus: "held", reason: "different_domain", routedDomain: input.domain, externalSend: false };
      } },
  };
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URL, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  const request = new Request("http://localhost/api/edupi/proactivity/messages", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "session-1", messageId: "prompt-stable",
      text: "合成课后反思", occurredAt: "2026-10-08T00:00:00.000Z" }) });
  const response = await exports.POST(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "queued");
  assert.equal(body.routedDomain, "lesson_reflection");
  assert.deepEqual(captureIds, Array(5).fill("prompt-stable"));
  const saved = actualLedger.readWithdrawableEduPiAmbientMessages("session-1", { stateDir, dataRoot });
  assert.equal(saved.length, domains.length);
  assert.equal(new Set(saved.map(item => item.messageRef)).size, domains.length);
  assert.deepEqual(new Set(saved.map(item => item.messageId)), new Set(["prompt-stable"]));
  assert.ok(saved.every(item => item.status === "settled"));
  const coldRead = await exports.GET(new Request("http://localhost/api/edupi/proactivity/messages?sessionId=session-1"));
  const coldState = await coldRead.json();
  assert.equal(coldState.status, "clear");
  assert.equal(JSON.stringify(coldState.settled), JSON.stringify([{ messageId: "prompt-stable", occurredAt: "2026-10-08T00:00:00.000Z" }]));
  const duplicate = await exports.POST(new Request("http://localhost/api/edupi/proactivity/messages", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "session-1", messageId: "prompt-stable",
      text: "合成课后反思", occurredAt: "2026-10-08T00:00:00.000Z" }) }));
  assert.equal((await duplicate.json()).resolutionStatus, "settled");
  assert.equal(captureIds.length, domains.length, "a lost HTTP ACK cannot trigger a second Core route_apply");
  actualLedger.recordEduPiAmbientMessageBinding({ sessionId: "session-crashed", messageId: "prompt-crashed",
    messageRef: `owner_message:${"f".repeat(64)}`, ownerId: "owner-1", grantId: "grant-lesson_reflection",
    captureGrantVersion: 1, occurredAt: "2026-10-08T00:00:01.000Z" }, { stateDir, dataRoot });
  const crashed = await exports.GET(new Request("http://localhost/api/edupi/proactivity/messages?sessionId=session-crashed"));
  assert.equal((await crashed.json()).status, "outcome_unknown", "capture ACK without a final outcome must remain visible");
  const crashReplay = await exports.POST(new Request("http://localhost/api/edupi/proactivity/messages", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "session-crashed", messageId: "prompt-crashed",
      text: "合成课后反思", occurredAt: "2026-10-08T00:00:01.000Z" }) }));
  assert.equal((await crashReplay.json()).status, "outcome_unknown");
  assert.equal(captureIds.length, domains.length, "an incomplete capture cannot be blindly replayed");
});
