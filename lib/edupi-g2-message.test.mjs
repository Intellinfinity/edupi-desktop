import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";

const runtime = await createJiti(import.meta.url, {tsconfigPaths:true}).import("./edupi-ambient-message-runtime.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
const ownerId = "teacher-test";
const input = {rootRef, grantId:"g2-grant", messageId:"g2-message", text:"合成观察", occurredAt:"2026-10-04T00:00:00.000Z", domain:"student_followup"};
const queued = {version:1,follow_up_id:"followup-1",goal_id:"goal-1",goal_version:1,opportunity_id:"opportunity-1",execution_id:"execution-1",
  status:"queued",attempt:0,execution_started:true,model_execute:true,notify:false,live_authority:false,external_send:false};

function host(output = {ok:true,result:queued}, routeReason = "student_followup_not_found", readProof = null) {
  const calls = [];
  const messageRef = runtime.predictEduPiOwnerMessageRef(rootRef,ownerId,input.messageId,"student_followup");
  return {calls,messageRef,
    call:async()=>({ok:true,result:{root_ref:rootRef,owner:{id:ownerId},grants:[{id:input.grantId,version:1,status:"active",ends_at:"2099-01-01T00:00:00.000Z"}]}}),
    callOwnerControl:async(operation,payload)=>{
      calls.push([operation,payload]);
      if(operation==="owner_message") return {ok:true,result:{replayed:false,receipt:{message_ref:messageRef,owner_id:ownerId,capture_grant_version:1,apply:false,live_authority:false,external_send:false}}};
      if(operation==="owner_intent_route_read") return {ok:true,result:{version:1,intent_id:`owner_intent:${"1".repeat(64)}`,
        message_ref:messageRef,domain:"student_followup",status:"needs_input",reason:routeReason,interaction:"clarify",
        next_operation:null,required_inputs:[],target:null,expected_goal_version:null,source_basis_hash:rootRef,
        observed_at:input.occurredAt,automatic_continuation_allowed:false,apply:false,live_authority:false,
        model_execute:false,external_send:false}};
      if(operation==="student_followup_intent_execution_read") return readProof ?? {ok:true,result:{version:1,status:"current",
        follow_up_id:queued.follow_up_id,goal_id:queued.goal_id,goal_version:queued.goal_version,
        execution_id:queued.execution_id,apply:false,model_execute:false,live_authority:false,external_send:false}};
      assert.equal(operation,"student_followup_intent_execution_enqueue");
      return output;
    }};
}

test("G2 captures under its own source and enqueues without inventing a G1 work case", async()=>{
  const model = host();
  const result = await runtime.captureAndApplyAmbientMessage(model,input,{controlScope:{classId:"class-1",subject:"数学"}});
  assert.equal(model.calls[0][1].conversation_id,"desktop-student-followup-canary-v1");
  assert.deepEqual(model.calls[1],["owner_intent_route_read",{root_ref:rootRef,expected_owner_id:ownerId,message_ref:model.messageRef}]);
  assert.deepEqual(model.calls[2],["student_followup_intent_execution_enqueue",{root_ref:rootRef,expected_owner_id:ownerId,message_ref:model.messageRef}]);
  assert.deepEqual(model.calls[3],["student_followup_intent_execution_read",{root_ref:rootRef,expected_owner_id:ownerId,
    grant_id:input.grantId,expected_grant_version:1,message_ref:model.messageRef}]);
  assert.equal(result.status,"queued");
  assert.equal(result.followUpId,"followup-1");
  assert.equal(result.executionId,"execution-1");
  assert.equal(result.workCaseId,null);
  assert.equal(result.externalSend,false);
  assert.notEqual(model.messageRef,runtime.predictEduPiOwnerMessageRef(rootRef,ownerId,input.messageId));
});

test("G2 persists unknown before enqueue and never repeats a lost committed write", async()=>{
  const model=host();
  let marked=false;
  const write=model.callOwnerControl;
  model.callOwnerControl=async(operation,payload)=>{
    if(operation==="student_followup_intent_execution_enqueue"){
      assert.equal(marked,true,"the private marker must precede Core enqueue");
      throw new Error("synthetic_reply_lost_after_commit");
    }
    return write(operation,payload);
  };
  const result=await runtime.captureAndApplyAmbientMessage(model,input,{controlScope:{classId:"class-1",subject:"数学"},
    onApplyPending:async()=>{marked=true;model.calls.push(["ledger:outcome_unknown",null]);}});
  assert.equal(result.status,"outcome_unknown");
  assert.equal(marked,true);
  assert.deepEqual(model.calls.map(([operation])=>operation),["owner_message","owner_intent_route_read",
    "ledger:outcome_unknown"]);
});

test("G2 cannot clear its unknown marker from a queued ACK without exact current readback", async()=>{
  const model=host(undefined,"student_followup_not_found",{ok:true,result:{version:1,status:"unknown",
    follow_up_id:null,goal_id:null,goal_version:null,execution_id:null,
    apply:false,model_execute:false,live_authority:false,external_send:false}});
  let marked=0;
  const result=await runtime.captureAndApplyAmbientMessage(model,input,{controlScope:{classId:"class-1",subject:"数学"},
    onApplyPending:async()=>{marked++;}});
  assert.equal(marked,1);
  assert.equal(result.status,"recorded");
  assert.equal(result.resolutionStatus,"needs_verification");
  assert.equal(result.goalId,queued.goal_id);
  assert.equal(result.executionId,queued.execution_id);
});

test("G2 leaves an ambiguous target in Core clarification without enqueue",async()=>{
  const model=host({ok:true,result:queued},"student_followup_ambiguous");
  const result=await runtime.captureAndApplyAmbientMessage(model,input,{controlScope:{classId:"class-1",subject:"数学"}});
  assert.equal(result.status,"captured");
  assert.equal(result.resolutionStatus,"needs_input");
  assert.equal(result.reason,"student_followup_ambiguous");
  assert.deepEqual(model.calls.map(([operation])=>operation),["owner_message","owner_intent_route_read"]);
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
