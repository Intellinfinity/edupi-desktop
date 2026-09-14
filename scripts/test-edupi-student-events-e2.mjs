import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createJiti} from "jiti";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"edupi-events-e2-"));
Object.assign(process.env,{EDUPI_DATA_ROOT:root,EDUPI_DATA_ALLOWED_ROOT:os.tmpdir(),EDUPI_PROJECT_ROOT:root,EDUPI_MEMORY_DIR:path.join(root,"memory"),EDUPI_OUTPUT_DIR:path.join(root,"output"),EDUPI_LOCK_DIR:path.join(root,"locks")});
for(const key of ["EDUPI_MEMORY_DIR","EDUPI_OUTPUT_DIR","EDUPI_LOCK_DIR"])fs.mkdirSync(process.env[key],{recursive:true});
try{
  const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
  const {importStudentRoster}=await jiti.import("../lib/edupi-student-roster-server.ts");
  await importStudentRoster({students:[{name:"测试甲",traits:[],parentNotes:[],className:"703"},{name:"测试乙",traits:[],parentNotes:[],className:"704"}],sourceName:"fixture"});
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,".edupi","memory","student_profiles.json"),"utf8")).students["测试甲"].class_name,"703");
  const {createStudentEventTool}=await jiti.import("../lib/edupi-student-event-tool.ts");
  const {GET,POST}=await jiti.import("../app/api/edupi/student-events/route.ts");
  const tool=createStudentEventTool(root);
  const ctx={cwd:root,sessionManager:{getSessionId:()=>"fixture-session",getBranch:()=>[{id:"fixture-message",type:"message",message:{role:"user",content:"测试甲移项出错，测试乙帮助他讲解。"}}]}};
  const input={action:"record",records:[{kind:"learning",students:["测试甲"],summary:"移项出错",topic:"移项"},{kind:"interaction",students:["测试乙","测试甲"],summary:"测试乙帮助测试甲讲解",topic:"移项"}]};
  assert.equal((await tool.execute("call",input,undefined,undefined,ctx)).details.record_ids.length,2);
  const read=async()=>{const response=await GET(new Request("http://localhost/api/edupi/student-events?student=测试甲",{headers:{host:"localhost",origin:"http://localhost"}}));assert.equal(response.status,200);return response.json();};
  const first=await read();assert.equal(first.total,2);assert.equal(first.records[0].source.message_id,"fixture-message");
  const item=first.records[0];
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>tool.execute("abort",{action:"update",event_id:item.id,expected_revision:0,summary:"不应保存"},controller.signal,undefined,ctx),/abort/i);
  assert.equal((await read()).records[0].summary,item.summary);
  const request=body=>new Request("http://localhost/api/edupi/student-events",{method:"POST",headers:{host:"localhost",origin:"http://localhost","Content-Type":"application/json"},body:JSON.stringify(body)});
  assert.equal((await POST(request({action:"update_event",event_id:item.id,expected_revision:0,summary:"在课堂上互相讲解",topic:"移项",observed_on:"2026-09-05"}))).status,200);
  const updated=(await read()).records[0];assert.equal(updated.revision,1);assert.equal(updated.history_count,1);assert.equal(updated.history[0].summary,item.summary);
  assert.equal((await POST(request({action:"update_event",event_id:item.id,expected_revision:updated.revision,summary:updated.history[0].summary,topic:updated.history[0].topic,observed_on:updated.history[0].observed_on}))).status,200);
  const restored=(await read()).records[0];assert.equal(restored.revision,2);assert.equal(restored.summary,item.summary);assert.equal(restored.topic,item.topic);assert.equal(restored.observed_on,item.observed_on);assert.equal(restored.history_count,2);
  assert.equal((await POST(request({action:"delete_event",event_id:item.id,expected_revision:2}))).status,200);
  assert.equal((await tool.execute("call",input,undefined,undefined,ctx)).details.replayed,true);
  assert.equal((await read()).total,1);
  console.log("student records E2: capture, source, manual edit, history restore, delete and replay passed");
}finally{fs.rmSync(root,{recursive:true,force:true});}
