import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";

const runtime = await createJiti(import.meta.url, {tsconfigPaths:true}).import("./edupi-ambient-message-runtime.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
const ownerId = "teacher-test";
const input = {rootRef, grantId:"g2-grant", messageId:"g2-message", text:"合成观察", occurredAt:"2026-10-04T00:00:00.000Z", domain:"student_followup"};
const queued = {version:1,follow_up_id:"followup-1",goal_id:"goal-1",goal_version:1,opportunity_id:"opportunity-1",execution_id:"execution-1",
  status:"queued",attempt:0,execution_started:true,model_execute:true,notify:false,live_authority:false,external_send:false};

function host(output = {ok:true,result:queued}) {
  const calls = [];
  const messageRef = runtime.predictEduPiOwnerMessageRef(rootRef,ownerId,input.messageId,"student_followup");
  return {calls,messageRef,
    call:async()=>({ok:true,result:{root_ref:rootRef,owner:{id:ownerId},grants:[{id:input.grantId,version:1,status:"active",ends_at:"2099-01-01T00:00:00.000Z"}]}}),
    callOwnerControl:async(operation,payload)=>{
      calls.push([operation,payload]);
      if(operation==="owner_message") return {ok:true,result:{replayed:false,receipt:{message_ref:messageRef,owner_id:ownerId,capture_grant_version:1,apply:false,live_authority:false,external_send:false}}};
      assert.equal(operation,"student_followup_intent_execution_enqueue");
      return output;
    }};
}

test("G2 captures under its own source and enqueues without inventing a G1 work case", async()=>{
  const model = host();
  const result = await runtime.captureAndApplyAmbientMessage(model,input,{controlScope:{classId:"class-1",subject:"数学"}});
  assert.equal(model.calls[0][1].conversation_id,"desktop-student-followup-canary-v1");
  assert.deepEqual(model.calls[1],["student_followup_intent_execution_enqueue",{root_ref:rootRef,expected_owner_id:ownerId,message_ref:model.messageRef}]);
  assert.equal(result.status,"queued");
  assert.equal(result.followUpId,"followup-1");
  assert.equal(result.executionId,"execution-1");
  assert.equal(result.workCaseId,null);
  assert.equal(result.externalSend,false);
  assert.notEqual(model.messageRef,runtime.predictEduPiOwnerMessageRef(rootRef,ownerId,input.messageId));
});

test("a non-actionable G2 statement is held without withdrawing its canonical source", async()=>{
  const model = host({ok:false,error_code:"invalid_candidate",result:null});
  const result = await runtime.captureAndApplyAmbientMessage(model,input);
  assert.equal(result.status,"captured");
  assert.equal(result.resolutionStatus,"held");
  assert.equal(result.reason,"invalid_candidate");
  assert.deepEqual(model.calls.map(([operation])=>operation),["owner_message","student_followup_intent_execution_enqueue"]);
});

test("enqueue replies cannot claim completion or enable external effects", async()=>{
  for(const change of [{status:"completed"},{external_send:true},{notify:true},{execution_id:null}]) {
    await assert.rejects(runtime.captureAndApplyAmbientMessage(host({ok:true,result:{...queued,...change}}),input),{code:"proactivity_response_invalid"});
  }
});
