import crypto from "node:crypto";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { runCoreProcess } from "./edupi-core-process-client";

export type StudentEvent = {
  student_ids?: string[];
  student_labels?: string[];
  class_name?: string | null;
  canonical_topic?: string | null;
  id:string;kind:"learning"|"interaction";students:string[];summary:string;topic:string|null;observed_on:string|null;
  recorded_at:string;updated_at:string;revision:number;
  source:{session_id:string;message_id:string;text:string};
  history:Array<{summary:string;topic:string|null;observed_on:string|null;revision:number;updated_at:string}>;
  history_count?:number;
};
export type StudentEventsResult = {ok:boolean;records?:StudentEvent[];total?:number;record_ids?:string[];revision?:number;replayed?:boolean;code?:string};
const messages:Record<string,string>={ambiguous_student:"存在同名学生，请指定班级或学生 ID",unknown_student:"名单中找不到该学生，请先核对姓名",stale_event:"记录已更新，请刷新后重试",invalid_event:"记录内容不完整",invalid_date:"日期无效",source_conflict:"这段对话已经记录，请修改原记录",event_not_found:"记录不存在或已删除"};

export async function studentEventRequest(input:Record<string,unknown>, signal?:AbortSignal):Promise<StudentEventsResult> {
  signal?.throwIfAborted();
  const {runtime,dataRoot}=resolveEduPiBridgeRoots();
  const requestId=crypto.randomUUID();
  const result=await runCoreProcess<StudentEventsResult & {operation:string;request_id:string;external_send:boolean}>({runtime,dataRoot,signal,timeoutMs:15_000,request:{...input,protocol:"edupi-desktop-bridge",protocol_version:1,producer:"edupi-desktop",operation:"students",request_id:requestId}});
  if (!result.ok || result.operation!=="students" || result.request_id!==requestId || result.external_send!==false) throw new Error(messages[result.code || ""] || "学生记录暂不可用");
  return result;
}
