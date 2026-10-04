import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";

function fixture({g1=true,g2=true,isolated=true,g2Active=true,failG1=false}={}) {
  const prepared=[],captured=[],confirmed=[];
  let bodyReads=0;
  class AmbientError extends Error {constructor(code){super(code);this.code=code;this.stage="owner";}}
  const modules={
    "next/server":{NextResponse:{json:(value,options={})=>({status:options.status??200,json:async()=>value})}},
    "node:crypto":crypto,
    "@/lib/desktop-api-auth":{isDesktopApiRequestAllowed:()=>true},
    "@/lib/bounded-form-data":{parseJsonWithinLimit:async r=>{bodyReads++;return r.json();},RequestBodyTooLargeError:class extends Error{}},
    "@/lib/edupi-core-snapshot":{resolveEduPiBridgeRoots:()=>({dataRoot:{root:"/synthetic-root"}})},
    "@/lib/safe-mode":{canStartEduPiStudentFollowup:()=>isolated},
    "@/lib/edupi-proactivity-config":{readEduPiProactivityActivation:({domain})=>({enabled:domain==="student_followup"?g2:g1,grantId:domain,scope:{classId:"class-1",subject:"数学"}})},
    "@/lib/session-reader":{resolveSessionPath:async()=>"synthetic-session"},
    "@/lib/edupi-ambient-session-lock":{withEduPiAmbientSessionLock:async(_id,operation)=>operation()},
    "@/lib/edupi-proactivity-runtime":{readProactivityOwnerContext:async()=>({status:"active"})},
    "@/lib/edupi-runtime-supervisor":{ensureEduPiRuntime:async()=>({call:async()=>({ok:true,result:{data_root_fingerprint:`sha256:${"a".repeat(64)}`,capabilities:{ambient_planning:"active",owner_intent:"active",g2_processor:g2Active?"active":"activation_pending"}}})})},
    "@/lib/edupi-ambient-message-ledger":{
      prepareEduPiAmbientMessageBinding:value=>prepared.push(value),
      confirmEduPiAmbientMessageBinding:(sessionId,messageId,messageRef)=>confirmed.push({sessionId,messageId,messageRef}),
      markEduPiAmbientMessageWithdrawn:()=>{},
    },
    "@/lib/edupi-ambient-message-runtime":{EduPiAmbientMessageError:AmbientError,captureAndApplyAmbientMessage:async(_host,input,callbacks)=>{
      captured.push(input);
      if(failG1&&input.domain==="teaching_preparation")throw new AmbientError("proactivity_grant_unavailable");
      const binding={messageRef:`owner_message:${(input.domain==="student_followup"?"b":"a").repeat(64)}`,ownerId:"owner-1",grantId:input.grantId,captureGrantVersion:1};
      await callbacks.onPrepared(binding);await callbacks.onCaptured(binding);
      return {status:input.domain==="student_followup"?"queued":"captured",externalSend:false};
    }},
  };
  const exports={};
  const code=ts.transpileModule(fs.readFileSync(new URL("./route.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>{assert.ok(modules[name],name);return modules[name];}});
  const request=()=>new Request("http://localhost/api/edupi/proactivity/messages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:"session-1",messageId:"message-1",text:"Synthetic teacher message",occurredAt:"2026-10-04T00:00:00.000Z"})});
  return {route:exports,request,prepared,captured,confirmed,bodyReads:()=>bodyReads};
}

test("one message keeps independent G1/G2 receipts under the same session withdrawal ledger",async()=>{
  const f=fixture();
  assert.equal((await(await f.route.GET(f.request())).json()).status,"enabled");
  const response=await f.route.POST(f.request());
  const result=await response.json();
  assert.equal(response.status,200);assert.equal(result.status,"queued");
  assert.equal(result.domainResults.length,2);
  assert.equal(f.captured[0].messageId,"message-1");assert.match(f.captured[1].messageId,/^g2_[a-f0-9]{64}$/);
  assert.equal(new Set(f.prepared.map(x=>x.messageId)).size,2);
  assert.ok(f.prepared.every(x=>x.sessionId==="session-1"));
  assert.equal(f.confirmed.length,2);
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
