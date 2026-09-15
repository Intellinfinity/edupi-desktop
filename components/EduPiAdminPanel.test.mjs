import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("management center is a full admin workspace with persistent navigation", async () => {
  const [admin, appShell, panel, rail, workspace, materials, css, compatibility] = await Promise.all([
    read("./EduPiAdminPanel.tsx"),
    read("./AppShell.tsx"),
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiNavigationRail.tsx"),
    read("./EduPiWorkspaceViews.tsx"),
    read("./EduPiMaterialsWorkspace.tsx"),
    read("../app/edupi-admin.css"),
    read("./EduPiCoreCompatibility.tsx"),
  ]);

  for (const endpoint of ["/api/edupi/workspace", "/api/edupi/status", "/api/models"]) assert.match(admin, new RegExp(endpoint.replaceAll("/", "\\/")));
  assert.doesNotMatch(admin, /\/api\/edupi\/(?:onboarding|education)/);
  for (const label of ["管理中心", "EduPi 就绪度", "自动运行", "教学能力", "连接与后台", "学校平台", "AI 与模型", "教师与学生", "校历与课表", "上传内容", "任务与产物", "系统"]) assert.match(admin, new RegExp(label));
  for (const label of ["运行中", "待确认", "已完成", "最近自动运行"]) assert.match(admin, new RegExp(label));
  assert.match(admin, /formatCoreSchedulerStatus/);
  assert.doesNotMatch(admin, /formatNextScheduledRun/);
  assert.match(admin, /ADMIN_SECTIONS/);
  assert.match(admin, /has-desktop-drag-region/);
  assert.match(admin, /edupi-window-drag-region/);
  assert.match(admin, /startWindowDragging/);
  assert.match(admin, /EduPiConnectorSetup/);
  assert.match(admin, /setSelectedConnector/);
  assert.match(admin, /initialSection\?: AdminSectionId/);
  assert.match(admin, /useState<AdminSectionId>\(initialSection\)/);
  assert.match(admin, /setActiveSection\(initialSection\)/);
  assert.match(admin, /useState\(false\);[\s\S]+?activeSection === "models"[\s\S]+?setModelsMounted\(true\)/);
  assert.match(admin, /hidden=\{activeSection !== "models"\}/);
  assert.match(admin, /workspaceRef\.current\?\.scrollTo\(\{ top: 0 \}\)/);
  assert.match(admin, /modelSettingsDirty && !window\.confirm/);
  assert.match(admin, /coreConnected && projectionConnected/);
  assert.match(admin, /systemStatusLabel/);
  assert.match(admin, /EduPiCoreCompatibility/);
  assert.match(admin, /snapshot\.compatibility/);
  assert.match(compatibility, /runtimeComponentManifestHash/);
  assert.match(admin, /await readJson<AdminSnapshot\["models"\]>\("\/api\/models", controller\.signal\)/);
  assert.match(admin, /Boolean\(snapshot\.context && snapshot\.education && snapshot\.status\)/);
  assert.match(admin, /className="edupi-admin-sidebar"/);
  assert.match(admin, /className="edupi-admin-workspace"/);
  assert.match(admin, /APP_VERSION_DISPLAY/);
  assert.match(admin, /当前安装版本/);
  assert.match(admin, />刷新状态<\/button>/);
  assert.match(admin, /reconnectEduPiCore/);
  assert.match(admin, /onClick=\{coreConnected \? refresh : \(\) => void reconnectCore\(\)\}/);
  assert.match(admin, /coreConnected \? "已连接" : "重新连接"/);
  assert.match(admin, /aria-current=\{activeSection === section\.id \? "page" : undefined\}/);
  assert.match(admin, /modelsPanel/);
  assert.doesNotMatch(admin, /role="dialog"|aria-modal="true"/);
  assert.doesNotMatch(admin, /edupi-admin-grid/);
  assert.doesNotMatch(admin, /onOpenModels/);
  assert.match(admin, /onNavigate\("students"\)/);
  assert.match(admin, /onAskStudentUpdate/);
  assert.match(admin, /onNavigate\("calendar"\)/);
  assert.match(admin, /onNavigate\("materials"\)/);
  assert.match(admin, /onNavigate\("workspace"\)/);
  assert.equal((admin.match(/<p(?:\s|>)/g) || []).length, 0);
  assert.match(admin, /FALLBACK_CHECKLIST/);
  assert.match(admin, /数据读取失败/);
  assert.match(admin, /模型数据不可用/);
  assert.match(admin, /默认模型待配置/);
  assert.doesNotMatch(admin, /education\?\.[a-zA-Z]+\.length \|\| 0/);
  assert.doesNotMatch(admin, /snapshot\.models\?\.modelList\?\.length \|\| 0/);
  assert.doesNotMatch(admin, /配置模块即将接入/);
  assert.match(admin, /configurableConnectors = new Set\(\["feishu", "dingtalk"\]\)/);
  assert.match(admin, /status === "configured"\) return "已配置"/);

  assert.match(rail, /APP_VERSION_DISPLAY/);
  assert.match(rail, /当前版本 v/);
  assert.doesNotMatch(rail, /aria-label="教育设置"|aria-label="应用设置"/);
  assert.match(panel, /onOpenAdmin/);
  assert.match(panel, /打开管理中心/);
  assert.match(panel, /<EduPiNavigationRail[\s\S]+?onOpenAdmin=\{onOpenAdmin\}/);
  assert.match(appShell, /openEduPiAdmin/);
  assert.match(appShell, /onOpenAdmin=\{\(\) => openEduPiAdmin\(\)\}/);
  assert.match(appShell, /edupiAdminOpen && <EduPiAdminPanel/);
  assert.match(appShell, /modelsPanel=\{<ModelsConfig[\s\S]+?embedded[\s\S]+?onDirtyChange=\{setAdminModelsDirty\}[\s\S]+?onSaved=/);
  assert.match(appShell, /inert=\{edupiAdminOpen \? true : undefined\}/);
  assert.match(appShell, /aria-hidden=\{edupiAdminOpen \? true : undefined\}/);
  assert.match(appShell, /onAskStudentUpdate=\{askEduPiToUpdateStudents\}/);
  assert.match(appShell, /onOpenSettings=\{\(\) => \{ setEduPiAdminOpen\(false\); setAppSettingsOpen\(true\); \}\}/);
  assert.match(admin, /<strong>应用更新<\/strong><small>检查、下载并安装新版本<\/small><\/span><em>检查更新<\/em>/);
  assert.ok(admin.indexOf('className="edupi-admin-list"', admin.indexOf('activeSection === "system"')) < admin.indexOf("<EduPiCoreCompatibility", admin.indexOf('activeSection === "system"')));
  assert.match(appShell, /params\.set\("view", view\)/);
  assert.doesNotMatch(workspace, /edupi-dashboard-readiness/);
  assert.match(workspace, /onOpenAdmin/);
  assert.match(workspace, /onRemoveStagedMaterial/);
  assert.match(materials, />移除</);
  assert.match(css, /\.edupi-admin-sidebar/);
  assert.match(css, /\.edupi-admin-workspace/);
  assert.match(css, /\.edupi-admin-section/);
  assert.doesNotMatch(css, /\.edupi-admin-grid/);
  assert.match(css, /\.edupi-admin-readiness/);
  assert.match(css, /\.edupi-core-compatibility/);
  assert.match(compatibility, /COMMAND_LABELS/);
});

test("management center preserves typed boundaries for unsupported destructive operations", async () => {
  const admin = await read("./EduPiAdminPanel.tsx");
  assert.doesNotMatch(admin, /fetch\([^)]*method:\s*["'](?:PUT|POST|PATCH|DELETE)/s);
  assert.doesNotMatch(admin, /localStorage|sessionStorage|writeFile|\.edupi\/memory/);
  assert.doesNotMatch(admin, /删除学生|删除校历|删除已接入/);
});
