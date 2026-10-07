import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { calendarResultSummary } = await createJiti(import.meta.url).import("./edupi-calendar-result.ts");
const result = (id, state = "confirmed") => ({ role:"toolResult",toolName:"calendar_add",toolCallId:id,content:[],details:{ok:true,verified:true,external_send:false,receipt:{status:"accepted"},events:[{id:"event-1",state}]} });
test("assistant prose and memory receipts never count as a calendar write",()=>{
  assert.equal(calendarResultSummary([{role:"assistant",content:[{type:"text",text:"已记下，以后自动补录"}]}]),null);
  assert.equal(calendarResultSummary([{...result("call-1"),toolName:"memory_write"}]),null);
});
test("verified Core readback is counted once and held entries remain pending",()=>{
  assert.equal(calendarResultSummary([result("call-1"),result("call-2")]).text,"1 条日程已确认");
  assert.equal(calendarResultSummary([result("call-3","held")]).text,"1 条日程待确认");
});
test("failed or unverifiable writes stay visible outside collapsed processing details",()=>{
  const failed = {role:"toolResult",toolName:"calendar_add",toolCallId:"failed",content:[],isError:true};
  assert.deepEqual(calendarResultSummary([failed]),{text:"日程写入未确认",uncertain:true});
  assert.deepEqual(calendarResultSummary([{...result("unknown"),details:{ok:true}}]),{text:"日程写入未确认",uncertain:true});
  assert.match(calendarResultSummary([result("confirmed"),failed]).text,/已确认.*写入未确认/);
});
