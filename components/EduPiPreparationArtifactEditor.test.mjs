import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
const tick = () => new Promise(resolve => setImmediate(resolve));
test("editor retains a conflicting draft and restores history through versioned Core submission", async () => {
  const slots = [], effects = new Map(), writes = [], saved = []; let cursor = 0, dirty, tree, rejectSave = true;
  const current = { artifact_id: "a", task_id: "task", title: "教案", content: "原正文", revision: 2, current_revision: 2, relative_path: ".edupi/output/a.md", history: [{ revision: 2, actor: "teacher" }, { revision: 1, actor: "agent" }] };
  const react = { useState(value) { const i=cursor++;slots[i]??={value};return[slots[i].value,next=>{slots[i].value=typeof next==="function"?next(slots[i].value):next;dirty=true;}]; }, useRef(value){const i=cursor++;slots[i]??={current:value};return slots[i];}, useEffect(callback,deps){const i=cursor++;if(!slots[i]||deps.some((d,n)=>d!==slots[i].deps[n]))effects.set(i,{callback,deps});} };
  const client = {
    readPreparationArtifact: async (_id, revision) => revision === 1 ? { ...current, revision: 1, content: "历史正文" } : { ...current },
    revisePreparationArtifact: async (id, revision, content) => { writes.push({id,revision,content});if(rejectSave)throw Object.assign(new Error("版本冲突"),{code:"stale_revision"});return {...current,content,revision:4,current_revision:4,relative_path:".edupi/output/revised.md"}; },
  };
  const exports={};const jsx=(type,props)=>({type,props});
  const code=ts.transpileModule(fs.readFileSync(new URL("./EduPiPreparationArtifactEditor.tsx",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,TextEncoder,AbortController,require:name=>name==="react"?react:name.includes("jsx-runtime")?{jsx,jsxs:jsx}:name.includes("artifact-client")?client:undefined});
  const render=()=>{do{dirty=false;cursor=0;tree=exports.EduPiPreparationArtifactEditor({artifactId:"a",preview:"原预览",onSaved:value=>saved.push(value),onAgent(){}});}while(dirty);for(const[i,e]of effects){slots[i]?.cleanup?.();slots[i]={deps:e.deps,cleanup:e.callback()};}effects.clear();return tree;};
  const nodes=node=>!node||typeof node!=="object"?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
  const find=(type,label)=>nodes(render()).find(node=>node.type===type&&(node.props.children===label||node.props["aria-label"]===label));
  render();await tick();find("button","编辑正文").props.onClick();
  find("textarea","产物正文").props.onChange({target:{value:"保留的草稿"}});
  find("button","保存候选").props.onClick();await tick();
  assert.equal(find("textarea","产物正文").props.value,"保留的草稿");assert.equal(saved.length,0);
  current.revision=3;current.current_revision=3;current.content="他人修订";
  find("button","重新读取版本").props.onClick();await tick();
  assert.equal(find("textarea","产物正文").props.value,"保留的草稿");
  find("select","产物历史版本").props.onChange({target:{value:"1"}});await tick();
  assert.equal(find("textarea","产物正文").props.value,"历史正文");
  rejectSave=false;find("button","恢复此版本").props.onClick();await tick();
  assert.deepEqual(writes.at(-1),{id:"a",revision:3,content:"历史正文"});assert.equal(saved[0].relative_path,".edupi/output/revised.md");
  find("button","编辑正文").props.onClick();find("textarea","产物正文").props.onChange({target:{value:"未保存"}});find("button","取消").props.onClick();await tick();
  assert.equal(find("textarea","产物正文"),undefined);assert.equal(writes.length,2);
});
