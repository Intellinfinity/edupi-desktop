import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the EduPi shell owns the default desktop surface and embeds Agent collaboration", async () => {
  const appShell = await read("./AppShell.tsx");
  assert.match(appShell, /display: edupiEducationModule \? "none" : "flex"/);
  assert.match(appShell, /chatPanel=\{edupiChatWindow\}/);
  assert.doesNotMatch(appShell, /agentPanel=\{edupiChatWindow\}/);
  assert.match(appShell, /chatSidebar=\{renderSessionSidebar\("embedded-chat"\)\}/);
  assert.match(appShell, /onSessionCreated=\{handleEducationSessionCreated\}/);
  assert.match(appShell, /renderFilePreview=/);
  assert.doesNotMatch(appShell, /<EduPiEducationHome/);
});

test("the teacher workbench exposes the complete task and review workflow", async () => {
  const appShell = await read("./AppShell.tsx");
  const panel = await read("./EduPiEducationPanel.tsx");
  const rail = await read("./EduPiNavigationRail.tsx");
  const taskStage = await read("./EduPiTaskStage.tsx");
  const taskWorkspace = await read("./EduPiTaskWorkspace.tsx");
  const inspector = await read("./EduPiInspector.tsx");
  const objectSider = await read("./EduPiObjectSider.tsx");
  const calendarWorkspace = await read("./EduPiCalendarWorkspace.tsx");
  const calendarModule = await read("./EduPiCalendarModule.tsx");
  const taskBoard = await read("./EduPiWorkspaceBoard.tsx");
  const taskBoardModel = await read("../lib/edupi-task-board.ts");
  const calendarModel = await read("../lib/edupi-calendar-model.ts");
  const workspaceViews = await read("./EduPiWorkspaceViews.tsx");
  const teaching = await read("./EduPiTeachingWorkspace.tsx");
  const memoryDatabase = await read("./EduPiMemoryDatabase.tsx");
  const insightDatabase = await read("./EduPiInsightDatabase.tsx");
  const growth = await read("./EduPiGrowthWorkspace.tsx");
  const workbench = await read("../lib/edupi-workbench.ts");
  assert.match(panel, /readEduPiWorkspace\(\{ signal \}\)/);
  assert.doesNotMatch(panel, /edupi-teacher-topbar/);
  assert.doesNotMatch(panel, /本地工作区 · 已连接/);
  assert.match(panel, /method: "POST"/);
  assert.match(panel, /\/api\/edupi\/tasks\/\$\{encodeURIComponent\(activeTask\.id\)\}\/review/);
  assert.match(panel, /expectedRevision: activeTask\.revision/);
  assert.match(panel, /commitEducationSnapshot\(result\.data\)/);
  assert.match(taskStage, /task\.reviewHistory\.at\(-1\)\?\.action !== "rollback"/);
  for (const label of ["AI 协作", "今天", "工作区", "教学", "班级", "日程", "教育记忆", "观察与洞察", "成长", "材料", "待我确认"]) {
    assert.match(`${rail}\n${workbench}`, new RegExp(label));
  }
  assert.match(workbench, /id: "calendar", label: "日程", shortLabel: "日程"/);
  assert.match(workbench, /id: "workspace", label: "工作区", shortLabel: "任务板"/);
  assert.match(objectSider, /calendar: "日程"/);
  assert.match(workspaceViews, /EduPiCalendarWorkspace/);
  assert.match(workspaceViews, /EduPiWorkspaceBoard/);
  assert.match(workbench, /export function taskPresentation/);
  assert.match(taskBoard, /taskPresentation\(task\)/);
  assert.match(calendarModel, /taskPresentation\(task\)/);
  assert.doesNotMatch(calendarModel, /taskContentStatusLabel\(task\)/);
  for (const label of ["待处理", "进行中", "待我确认", "已完成"]) assert.match(`${taskBoard}\n${taskBoardModel}`, new RegExp(label));
  for (const label of ["新建任务", "移动到", "创建任务", "取消"]) assert.match(taskBoard, new RegExp(label));
  for (const label of ["自动准备教学产物", "课次", "上课日期", "材料", "产物", "创建并准备"]) assert.match(taskBoard, new RegExp(label));
  assert.match(taskBoard, /preparationSource: managedPreparation/);
  assert.match(taskBoard, /pendingCreateRef/);
  assert.match(taskBoard, /clientRequestId: pendingCreateRef\.current\.id/);
  assert.match(taskBoard, /material\.subject === activeSubject/);
  assert.match(taskBoard, /material\.class_id === activeClass/);
  assert.match(taskBoard, /lessonDateMatchesSlot/);
  assert.match(taskBoard, /dueDateManuallyEditedRef/);
  assert.match(taskBoard, /MAX_PREPARATION_MATERIALS/);
  assert.match(taskBoard, /materialIds\.every\(\(id\) => compatibleMaterialIds\.has\(id\)\)/);
  assert.match(taskBoard, /current\.filter\(\(id\) => compatibleMaterialIds\.has\(id\)\)/);
  assert.match(taskBoard, /deliverableValidation\.error/);
  assert.match(panel, /pollBoardPreparation/);
  assert.match(panel, /isTerminalPreparationRead\(next\)/);
  assert.match(panel, /workspaceHasReadyPreparation\(refreshed, taskId\)/);
  assert.match(panel, /next\.state === "idle"/);
  assert.match(panel, /!refreshed\.tasks\.some\(\(task\) => task\.id === taskId\)/);
  assert.match(panel, /stopTaskTracking\(id\)/);
  assert.match(panel, /fetch\(`\/api\/edupi\/preparation\?taskId=/);
  assert.doesNotMatch(panel, /fetch\("\/api\/edupi\/preparation"[^\n]+method: "POST"/);
  assert.match(panel, /refreshCommittedTask/);
  assert.match(panel, /refreshUntilTaskVisible/);
  assert.match(panel, /durableTaskIdsRef\.current\.add\(result\.taskId\)/);
  assert.match(panel, /hasEveryTrackedTask\(nextEducation, durableTaskIdsRef\.current\)/);
  assert.match(panel, /durableTaskIdsRef\.current\.delete\(taskId\)/);
  assert.match(panel, /sequence < workspaceMinimumApplySequenceRef\.current/);
  assert.match(panel, /workspaceLoadSequenceRef\.current \+ 1/);
  assert.match(panel, /const commitEducationSnapshot/);
  assert.match(panel, /onEducation=\{commitEducationSnapshot\}/);
  assert.match(panel, /Math\.max\(workspaceMinimumApplySequenceRef\.current, sequence\)/);
  assert.match(panel, /result\.preparation\?\.taskId !== result\.taskId/);
  assert.match(panel, /!result\.data\?\.tasks\.some/);
  assert.match(taskWorkspace, /props\.task\.trigger === "teaching_before_class"/);
  assert.match(taskBoard, /onPointerDown/);
  assert.match(taskBoard, /onPointerMove/);
  assert.match(taskBoard, /dragTarget/);
  assert.match(taskBoard, /onInput/);
  assert.match(taskBoard, /await onMoveTask/);
  assert.doesNotMatch(workspaceViews, /EduPiRhythmImporter/);
  for (const label of ["行事历", "待确认", "今天", "上一时段", "下一时段", "日", "周", "月", "新建日程", "添加课表", "上传文件", "日期待确认"]) assert.match(calendarWorkspace, new RegExp(label));
  assert.match(calendarWorkspace, /compact=\{entry\.kind !== "task"\}/);
  assert.match(calendarWorkspace, /entry\.sourceLabel/);
  assert.match(calendarWorkspace, /entry\.statusLabel/);
  assert.match(objectSider, /isRecognizedTimetableNote\(slot\.notes\)/);
  assert.match(calendarModule, /isRecognizedTimetableNote\(slot\.notes\) \? " · 待确认"/);
  for (const group of ["协作", "教师工作", "长期积累", "控制"]) assert.match(rail, new RegExp(group));
  assert.doesNotMatch(rail, /views: \[[^\]]*"tasks"/);
  assert.doesNotMatch(rail, /views: \[[^\]]*"artifacts"/);
  assert.doesNotMatch(rail, /views: \[[^\]]*"students"/);
  assert.match(workbench, /id: "tasks", label: "教学任务"/);
  assert.match(workbench, /id: "artifacts", label: "教学产物"/);
  assert.match(workspaceViews, /EduPiTeachingWorkspace/);
  assert.match(workspaceViews, /EduPiStudentWorkspace/);
  assert.match(workspaceViews, /EduPiMemoryDatabase/);
  assert.match(workspaceViews, /EduPiInsightDatabase/);
  assert.match(workspaceViews, /calendarFactSelection/);
  assert.match(workspaceViews, /onCalendarSelection\(calendarFactSelection\(event\)\)/);
  assert.match(workspaceViews, /onNavigate\("insights", `insights:\$\{insightCategory\(latestInsight\.content\)\}:surfaced`\)/);
  assert.match(workspaceViews, /EduPiGrowthWorkspace/);
  assert.match(memoryDatabase, /edupi-database/);
  assert.match(insightDatabase, /edupi-database/);
  assert.match(teaching, /continuity\.subjectKnowledge/);
  assert.match(await read("./EduPiStudentWorkspace.tsx"), /continuity\.familyContacts/);
  assert.match(growth, /continuity\.documents/);
  assert.match(teaching, /taskCategory\(task\) === "teaching"/);
  assert.match(await read("./EduPiStudentWorkspace.tsx"), /task\.student === selectedName/);
  for (const label of ["教学首页", "课程表", "教学重点", "备课任务", "教学记忆"]) assert.match(`${teaching}\n${await read("../lib/edupi-domain-navigation.ts")}`, new RegExp(label));
  for (const section of ["交给 EduPi", "早安简报", "今天要判断", "接下来", "值得留意"]) assert.match(`${workspaceViews}\n${await read("./EduPiTodayWork.tsx")}`, new RegExp(section));
  assert.match(workspaceViews, /onStartAgent/);
  assert.match(workspaceViews, /event !== currentWeek/);
  assert.match(panel, /showObjectSider/);
  assert.match(panel, /activeView === "tasks" && activeTask \? <EduPiTaskWorkspace/);
  assert.match(panel, /onStartAgent=/);
  assert.match(panel, /pendingAgentPrompt/);
  assert.match(panel, /requestAnimationFrame/);
  assert.match(panel, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(panel, /runningAgentCount/);
  assert.match(panel, /activeAgentSessionId/);
  assert.match(panel, /useEduPiContentSiderCollapse/);
  assert.match(`${panel}\n${objectSider}`, /收起列表/);
  assert.match(panel, /aria-label="展开列表"/);
  assert.doesNotMatch(panel, />列表<\/button>/);
  assert.match(panel, /\/api\/edupi\/tasks\/\$\{encodeURIComponent\(pendingTaskBinding\.taskId\)\}\/session/);
  assert.match(appShell, /onActivateAgentSession=/);
  assert.match(appShell, /params\.set\("stage", stage\)/);
  assert.match(panel, /stage: activeStage/);
  for (const label of ["Agent 正在运行", "继续协作", "开始协作", "恢复协作"]) assert.match(taskStage, new RegExp(label));
  assert.match(workspaceViews, /Agent 就绪/);
  assert.match(workspaceViews, /个 Agent 运行中/);
  assert.match(panel, /searchParams\.get\("inspector"\) === "1"/);
  assert.match(panel, /inspectorOpen \? "收起检查" : "检查"/);
  assert.doesNotMatch(inspector, /edupi-inspector-reopen/);
  assert.doesNotMatch(workspaceViews, /edupi-dashboard-columns/);
  for (const action of ["accept", "modify", "hold", "reject", "rollback"]) {
    assert.match(taskStage, new RegExp(`submit\\(\"${action}\"\\)`));
  }
});

test("the dashboard wires the Core work-candidate inbox with six receipt-bound actions", async () => {
  const component = await read("./EduPiTodayWork.tsx");
  const workspaceViews = await read("./EduPiWorkspaceViews.tsx");
  const css = await read("../app/edupi-workbench.css");
  const helper = await read("../lib/edupi-today-work.ts");
  assert.match(workspaceViews, /EduPiTodayWork/);
  assert.match(component, /data\.workCandidates/);
  for (const label of ["今天要判断", "待你决定", "稍后处理", "已记录", "接受", "调整", "暂缓", "稍后", "停止提示", "拒绝"]) assert.match(component, new RegExp(label));
  assert.match(component, /教师工作/);
  assert.doesNotMatch(component, /Core Today|Core 尚未开放/);
  assert.match(component, /<h3 id=/);
  assert.match(component, /<h4>/);
  for (const id of ["edupi-today-work-edit-title", "edupi-today-work-edit-summary", "edupi-today-work-edit-due", "edupi-today-work-snooze-until", "edupi-today-work-suppression-scope", "edupi-today-work-suppression-note"]) {
    assert.match(component, new RegExp(`htmlFor=\\"${id}\\"`));
    assert.match(component, new RegExp(`id=\\"${id}\\"`));
  }
  assert.match(component, /workCandidateReasonLabel\(candidate\.reason\)/);
  assert.match(component, /taskById\.get\(candidate\.taskId\)/);
  assert.match(component, /onTaskDetail\(task\)/);
  assert.match(component, /aria-label=\{`打开任务：\$\{candidate\.title\}`\}/);
  assert.match(component, /min=\{tomorrow\(\)\}/);
  assert.match(css, /\.edupi-today-work__group > header h3/);
  assert.doesNotMatch(css, /\.edupi-today-work__group > header h2/);
  assert.doesNotMatch(css, /edupi-today-work__guide/);
  assert.match(css, /\.edupi-today-work__item h4/);
  assert.match(helper, /review_work_candidate/);
  assert.match(helper, /expectedSnapshotId/);
  assert.match(helper, /expectedRevision/);
  assert.match(component, /onEducation\(result\.data/);
  assert.match(component, /useSyncExternalStore/);
  assert.match(component, /aria-busy=\{busy\}/);
  assert.match(component, /setFeedback\(null\)/);
  assert.match(component, /DECISION_EFFECTS/);
  assert.match(component, /移到“已记录”/);
  assert.doesNotMatch(component, /回执 \$\{receiptId\}/);
  assert.match(component, /setRetryReview/);
  assert.match(component, />重试<\/button>/);
  assert.match(component, />刷新待办<\/button>/);
  assert.match(component, /edupi-education-refresh/);
  assert.match(component, /title=\{ACTION_TITLES\.accept\}/);
  assert.match(component, /正在接受/);
  assert.doesNotMatch(component, /edupi-today-work__guide/);
  assert.doesNotMatch(component, /result\??\.reason/);
  assert.doesNotMatch(component, /setCandidates/);
  assert.doesNotMatch(component, /body\.(?:externalSend|sourceIds|evidenceIds|reviewer|issuedAt|provider|model|token)/);
});

test("insight provenance keeps shared evidence rows and only opens reviewable observations", async () => {
  const insightDatabase = await read("./EduPiInsightDatabase.tsx");
  assert.match(insightDatabase, /function isReviewableObservation\(item: EducationObservation\)/);
  assert.match(insightDatabase, /pending_review.*held/);
  for (const state of ["not_required", "pending_review", "accepted", "modified", "rejected", "held"]) {
    assert.match(insightDatabase, new RegExp(`${state}:`));
  }
  assert.match(insightDatabase, /new Map<string, EducationContract\["observations"\]\[number\]\[\]>/);
  assert.match(insightDatabase, /observationsByEvidence\.get\(evidenceId\) \|\| \[\]/);
  assert.match(insightDatabase, /linkedObservations\.filter\(isReviewableObservation\)/);
  assert.match(insightDatabase, /reviewTarget: isReviewableObservation\(item\)/);
});

test("refreshes education data after Core imports without remounting chat", async () => {
  const appShell = await read("./AppShell.tsx");
  const panel = await read("./EduPiEducationPanel.tsx");
  const conversationFiles = await read("./EduPiConversationFiles.tsx");
  const loadEffect = panel.slice(
    panel.indexOf("useEffect(() => {"),
    panel.indexOf("useEffect(() => {", panel.indexOf("useEffect(() => {") + 1),
  );
  const agentEndHandler = appShell.slice(
    appShell.indexOf("const handleAgentEnd"),
    appShell.indexOf("const handleEducationImportCompleted"),
  );

  assert.match(appShell, /const \[educationRefreshKey, setEducationRefreshKey\] = useState\(0\)/);
  assert.match(agentEndHandler, /setEducationRefreshKey\(\(key\) => key \+ 1\)/);
  assert.match(agentEndHandler, /window\.dispatchEvent\(new Event\("edupi-artifacts-updated"\)\)/);
  assert.match(conversationFiles, /window\.addEventListener\("edupi-artifacts-updated", refreshFiles\)/);
  assert.match(conversationFiles, /setRefresh\(value => value \+ 1\)/);
  assert.match(appShell, /const handleEducationImportCompleted = useCallback\(\(\) => \{/);
  assert.match(appShell, /onEducationImportCompleted=\{handleEducationImportCompleted\}/);
  assert.match(appShell, /refreshKey=\{educationRefreshKey\}/);
  assert.match(appShell, /key=\{`edupi-chat-\$\{sessionKey\}`\}/);
  assert.doesNotMatch(appShell, /edupi-chat-\$\{educationRefreshKey\}/);
  assert.match(panel, /refreshKey\?: number/);
  assert.match(loadEffect, /\}, \[loadWorkspace, refreshKey\]\);/);
});

test("keeps the existing Chat subtree mounted during background education refreshes", async () => {
  const panel = await read("./EduPiEducationPanel.tsx");

  assert.match(panel, /shouldShowBlockingEducationLoad\(/);
  assert.match(panel, /aria-busy=\{loading \? true : undefined\}/);
  assert.match(panel, /onClick=\{retryLoadWorkspace\}/);
  assert.match(panel, /title=\{loadError\}>重试/);
  assert.match(panel, /className=\{`edupi-teacher-shell is-loading\$\{desktopChrome\.isDesktop \? " has-desktop-drag-region" : ""\}`\}/);
  assert.match(panel, /<EduPiPersistentChatHost/);
  assert.equal((panel.match(/\{chatPanel\}/g) || []).length, 1);
  assert.match(panel, /mode=\{drawer === "agent" \? "drawer" : activeView === "chat" \? "main" : "hidden"\}/);
  assert.doesNotMatch(panel, /activeView === "chat" \? <div className="edupi-chat-surface">\{chatPanel\}/);
  assert.doesNotMatch(panel, /if \(loading \|\| loadError \|\| !education\)/);
});

test("routes education uploads through Desktop staging without Core paths or auto-send", async () => {
  const panel = await read("./EduPiEducationPanel.tsx");
  const workspaceViews = await read("./EduPiWorkspaceViews.tsx");
  const materials = await read("./EduPiMaterialsWorkspace.tsx");
  const home = await read("./EduPiEducationHome.tsx");
  const explorer = await read("./FileExplorer.tsx");
  const sidebar = await read("./SessionSidebar.tsx");
  const appShell = await read("./AppShell.tsx");
  const openUpload = panel.slice(
    panel.indexOf("const openUpload"),
    panel.indexOf("const openFile"),
  );

  assert.match(openUpload, /stageDesktopMaterialPaths|materialUploadInputRef/);
  assert.match(panel, /stageBrowserMaterialFiles/);
  assert.match(panel, /showStagedMaterials/);
  assert.doesNotMatch(panel, /processStagedMaterials/);
  assert.match(panel, /recognize: true/);
  assert.match(panel, /loadStagedMaterials|listDesktopStagedMaterials/);
  assert.match(panel, /type="file"/);
  assert.match(workspaceViews, /stagedMaterials/);
  assert.match(materials, /接入 EduPi/);
  for (const label of ["材料名称", "材料类型", "学科", "班级", "确认接入"]) assert.match(materials, new RegExp(label));
  assert.match(materials, /defaultMaterialIntakeMetadata/);
  assert.match(panel, /fetch\("\/api\/edupi\/intake"/);
  assert.doesNotMatch(openUpload, /selectView\("chat"\)|setPendingAgentPrompt|handleSend|sendAgentCommand/);
  for (const source of [panel, home, explorer, sidebar, appShell]) {
    assert.doesNotMatch(source, /\.edupi\/inbox\/teacher-materials/);
  }
});

test("calendar entries and sidebar nodes open a right-side raw detail drawer without exposing hashes", async () => {
  const panel = await read("./EduPiEducationPanel.tsx");
  const calendarWorkspace = await read("./EduPiCalendarWorkspace.tsx");
  const intakeRoute = await read("../app/api/edupi/intake/route.ts");
  const objectSider = await read("./EduPiObjectSider.tsx");
  const workspaceViews = await read("./EduPiWorkspaceViews.tsx");
  const css = `${await read("../app/edupi-workspace.css")}\n${await read("../app/edupi-workbench.css")}`;
  assert.match(panel, /calendarSelection/);
  assert.match(calendarWorkspace, /CalendarDetailDrawer/);
  assert.match(calendarWorkspace, /className="is-edit"[\s\S]*>编辑<\/button>/);
  assert.match(calendarWorkspace, /eventId: calendarEvent\?\.id \|\| null/);
  assert.match(calendarWorkspace, /calendarEvent\?\.notes \|\| ""/);
  assert.match(calendarWorkspace, /editingCalendarId/);
  assert.match(calendarWorkspace, /保存更改/);
  assert.match(panel, /eventId: string \| null/);
  assert.match(panel, /events: \[\{ \.\.\.event, confidence: "teacher_confirmed" \}\]/);
  assert.doesNotMatch(panel, /preservedEvents/);
  assert.match(intakeRoute, /eventId/);
  assert.match(calendarWorkspace, /onSelect\(\{ kind: entry\.kind, sourceId:/);
  assert.match(calendarWorkspace, /className=\{`\$\{entryClass\(entry\)\}/);
  assert.match(objectSider, /onCalendarItem/);
  assert.match(objectSider, /edupi-object-fact is-interactive/);
  assert.match(css, /\.edupi-calendar-detail/);
  assert.match(css, /\.edupi-calendar-intake textarea/);
  assert.match(css, /translateX/);
  assert.doesNotMatch(workspaceViews, /source_hash\.slice|sourceHash\.slice/);
});

test("timetable entries patch only the selected Core object", async () => {
  const calendarWorkspace = await read("./EduPiCalendarWorkspace.tsx");
  const panel = await read("./EduPiEducationPanel.tsx");
  const workspaceViews = await read("./EduPiWorkspaceViews.tsx");

  for (const source of [calendarWorkspace, panel, workspaceViews]) {
    assert.match(source, /slotId: string \| null/);
  }
  assert.match(calendarWorkspace, /editingTimetableId/);
  assert.match(calendarWorkspace, /timetableSlot/);
  assert.match(calendarWorkspace, /slotId: rawText\(timetableSlot\?\.slot_id \?\? timetableSlot\?\.id\)/);
  assert.match(calendarWorkspace, /defaultValue=\{rawText\(timetableSlot\?\.day_of_week \?\? timetableSlot\?\.dayOfWeek\)/);
  assert.match(calendarWorkspace, /defaultValue=\{rawText\(timetableSlot\?\.period\)/);
  assert.match(calendarWorkspace, /defaultValue=\{rawText\(timetableSlot\?\.subject\)/);
  assert.match(calendarWorkspace, /defaultValue=\{rawText\(timetableSlot\?\.class_name \?\? timetableSlot\?\.className\)/);
  assert.match(calendarWorkspace, /defaultValue=\{timetableSlot\?\.kind === "routine" \? "routine" : "class"\}/);
  assert.match(calendarWorkspace, /visibleTimetableNote\(timetableSlot\?\.notes\) \|\| ""/);
  assert.match(calendarWorkspace, /selection\.kind === "timetable"/);
  assert.match(calendarWorkspace, /编辑课表/);
  assert.match(panel, /slots: \[slot\]/);
  assert.doesNotMatch(panel, /preservedSlots/);
});

test("board and calendar task entries share a mounted task peek drawer", async () => {
  const panel = await read("./EduPiEducationPanel.tsx");
  const board = await read("./EduPiWorkspaceBoard.tsx");
  const calendar = await read("./EduPiCalendarWorkspace.tsx");
  const workspaceViews = await read("./EduPiWorkspaceViews.tsx");
  const drawer = await read("./EduPiTaskDetailDrawer.tsx");
  const objectSider = await read("./EduPiObjectSider.tsx");
  const taskStage = await read("./EduPiTaskStage.tsx");
  const css = await read("../app/edupi-workbench.css");

  assert.match(board, /onTaskDetail/);
  assert.match(board, /taskPresentation\(task\)\.label/);
  assert.doesNotMatch(board, /if \(task\.boardStage === "done"\)/);
  assert.match(board, /onOpen=\{\(\) => onTaskDetail\(task\)\}/);
  assert.doesNotMatch(board, /onTask\(task, cardStage/);
  assert.match(calendar, /taskForCalendarEntry/);
  assert.match(calendar, /entry\.kind === "task" \? onTaskDetail\(entry\)/);
  assert.match(calendar, /onTaskDetail=\{openTaskDetail\}/);
  assert.match(workspaceViews, /onTaskDetail: \(task: TeacherTask\)/);
  assert.match(workspaceViews, /<EduPiWorkspaceBoard[^>]+onTaskDetail=\{props\.onTaskDetail\}/);
  assert.match(workspaceViews, /<EduPiCalendarWorkspace[^>]+onTaskDetail=\{onTaskDetail\}/);
  assert.match(panel, /const \[taskDetailTask, setTaskDetailTask\]/);
  assert.match(panel, /const openTaskDetail = useCallback/);
  assert.match(panel, /<EduPiTaskDetailDrawer/);
  assert.match(panel, /files=\{education\.generatedArtifacts\}/);
  assert.match(panel, /onTaskDetail=\{openTaskDetail\}/);
  assert.match(panel, /const openAgentForTask = useCallback\(\(task: TeacherTask\) =>/);
  assert.match(panel, /const openAgent = useCallback\(\(\) =>/);
  assert.match(panel, /activateAgent\(task, "tasks", "run"\)/);
  assert.match(panel, /onOpenTask=\{selectTask\}/);
  assert.match(panel, /onOpenAgent=\{openAgentForTask\}/);
  assert.doesNotMatch(panel, /continueTask/);
  assert.match(panel, /<EduPiPersistentChatHost/);

  for (const label of ["任务进度", "已准备", "计划交付", "依据", "教师反馈", "打开产物", "进入任务", "继续让 EduPi 做"]) assert.match(drawer, new RegExp(label));
  assert.doesNotMatch(`${drawer}\n${await read("./EduPiTodayWork.tsx")}`, /EduPi 流/);
  assert.match(drawer, /次流转/);
  assert.match(drawer, /const flowStatus = taskWorkStatusLabel\(task, workCase\)/);
  assert.match(drawer, /reviewer === "teacher" \? "教师"/);
  assert.match(drawer, /reviewTime \? flowTime\(reviewTime\)/);
  assert.match(drawer, /taskAgentSteps\(task\)/);
  assert.match(drawer, /taskArtifacts\(task\)/);
  assert.match(drawer, /preparedFilesById/);
  assert.match(drawer, /workCase\?\.artifacts/);
  assert.match(drawer, /artifact\.relativePath/);
  assert.match(drawer, /taskEvidenceRows\(task\)/);
  assert.match(drawer, /taskStatusLabel\(task\)/);
  assert.match(drawer, /taskContentReady\(task\)/);
  assert.match(drawer, /taskArtifactFile\(task, workspace\)/);
  assert.match(drawer, /onOpenTask\(task\)/);
  assert.match(drawer, /onOpenAgent\(task\)/);
  assert.doesNotMatch(drawer, /onStartAgent/);
  assert.match(drawer, /useModalDismiss<HTMLElement>\(onClose\)/);
  assert.match(drawer, /data-autofocus/);
  assert.match(drawer, /event\.target === event\.currentTarget/);
  assert.doesNotMatch(drawer, /addEventListener\("keydown"/);
  assert.doesNotMatch(drawer, /file_sha256|sha256|复制/i);
  assert.match(drawer, /disabled=\{deleteBusy \|\| !task\.id\}/);
  assert.doesNotMatch(drawer, /artifact\.revision|版本/);
  assert.match(objectSider, /taskArtifacts\(task\)/);
  assert.doesNotMatch(objectSider, /const artifacts = tasks\.filter\(\(task\) => task\.deliverables\.length > 0\)/);
  assert.doesNotMatch(taskStage, /artifact\.revision|版本/);
  assert.doesNotMatch(workspaceViews, /artifact\.revision|v\{artifact\.revision\}/);
  assert.match(css, /\.edupi-task-detail-layer/);
  assert.match(css, /\.edupi-task-detail-drawer/);
  assert.match(css, /width: min\(420px/);
  assert.match(css, /\.edupi-task-detail-drawer \{ width: 100%/);

  const openTaskDetail = panel.slice(panel.indexOf("const openTaskDetail"), panel.indexOf("const openTaskFile"));
  assert.doesNotMatch(openTaskDetail, /updateLocation|setActiveView|setActiveStage/);
});

test("every EduPi module accepts one education material drop without handing it to Chat", async () => {
  const panel = await read("./EduPiEducationPanel.tsx");
  const desktop = await read("../lib/desktop-native.ts");
  const tauri = await read("../src-tauri/src/lib.rs");
  const css = await read("../app/edupi-workbench.css");

  assert.match(panel, /useDragDrop/);
  assert.match(panel, /Array\.from\(event\.dataTransfer\.types\)\.includes\("Files"\)/);
  for (const handler of ["onDragEnterCapture", "onDragOverCapture", "onDragLeaveCapture", "onDropCapture"]) assert.match(panel, new RegExp(handler));
  assert.match(panel, /event\.stopPropagation\(\)/);
  assert.match(panel, /stageDesktopMaterialFiles\(files\)/);
  assert.match(panel, /stageBrowserMaterialFiles\(files\)/);
  assert.match(panel, /showStagedMaterials\(staged\)/);
  assert.match(panel, /上一批材料正在处理/);
  assert.match(panel, /edupi-global-material-drop/);
  assert.doesNotMatch(panel.slice(panel.indexOf("const stageBrowserFiles"), panel.indexOf("const openUpload")), /onPrepareAgentPrompt|sendAgentCommand|\/api\/agent/);
  assert.match(desktop, /stageDesktopMaterialFiles/);
  assert.match(desktop, /desktopApiHeaders\(\)/);
  assert.match(tauri, /disable_drag_drop_handler\(\)/);
  assert.match(css, /\.edupi-global-material-drop/);
});

test("AppShell monitors Core completion without restoring the removed global top strip", async () => {
  const appShell = await read("./AppShell.tsx");
  const panel = await read("./EduPiEducationPanel.tsx");
  const inbox = await read("./EduPiCompletionInbox.tsx");
  const hook = await read("../hooks/useEduPiCompletionMonitor.ts");
  const helper = await read("../lib/edupi-completion-monitor.ts");

  assert.match(appShell, /useEduPiCompletionMonitor/);
  assert.match(appShell, /onRefresh: handleEducationProjectionChanged/);
  assert.match(appShell, /setEducationRefreshKey\(\(key\) => key \+ 1\)/);
  assert.doesNotMatch(panel, /EduPiCompletionInbox|edupi-teacher-topbar/);
  assert.match(inbox, /EduPi 已完成/);
  assert.match(inbox, /completionInboxItems\(tasks\)/);
  assert.match(hook, /readEduPiEducation/);
  assert.doesNotMatch(hook, /fetch\("\/api\/edupi\/education"/);
  assert.match(panel, /readEduPiWorkspace\(\{ signal \}\)/);
  assert.match(hook, /setTimeout/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /baseline === null/);
  assert.match(hook, /notifyDesktop\(notificationCopy\(changes\)\)/);
  assert.match(helper, /taskArtifactFile\(task, workspace\)/);
  for (const source of [appShell, panel, inbox, hook, helper]) assert.doesNotMatch(source, /localStorage|sessionStorage|\.edupi\/output\/.*completion/i);
});

test("Cmd K and the tray open one EduPi quick entry across tasks, calendar, artifacts, and Chat", async () => {
  const appShell = await read("./AppShell.tsx");
  const panel = await read("./EduPiEducationPanel.tsx");
  const component = await read("./EduPiQuickEntry.tsx");
  const helper = await read("../lib/edupi-quick-entry.ts");
  const keyboard = await read("../hooks/useKeyboardShortcuts.ts");

  assert.match(appShell, /const \[quickEntryOpen, setQuickEntryOpen\]/);
  assert.match(appShell, /quickEntryOpenRef\.current = quickEntryOpen/);
  assert.match(appShell, /event\.stopImmediatePropagation\(\)/);
  assert.match(appShell, /window\.addEventListener\("keydown", closeTopmostQuickEntry, true\)/);
  assert.match(appShell, /onQuickEntry: openQuickEntry/);
  assert.match(appShell, /listenQuickEntryNative\(openQuickEntry\)/);
  assert.match(appShell, /quickEntryOpen=\{quickEntryOpen\}/);
  assert.match(panel, /<EduPiQuickEntry/);
  assert.match(panel, /item\.kind === "chat"/);
  assert.match(panel, /item\.kind === "artifact" \? "artifact" : "brief"/);
  assert.match(panel, /calendarQuickEntryKey/);
  assert.match(component, /role="combobox"/);
  assert.match(component, /role="listbox"/);
  assert.match(component, /event\.key === "ArrowDown"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /onKeyDownCapture/);
  assert.match(component, /querySelectorAll<HTMLElement>/);
  assert.match(component, /event\.stopPropagation\(\)/);
  assert.match(component, /previousFocusRef/);
  assert.match(helper, /taskArtifacts\(task\)/);
  assert.match(keyboard, /isQuickEntryShortcut/);
  assert.match(keyboard, /e\.defaultPrevented/);
});

test("the CSS defines a harness workspace with an optional object browser and responsive fallback", async () => {
  const css = await read("../app/edupi-workbench.css");
  assert.match(css, /grid-template-columns: 220px minmax\(0, 1fr\)/);
  assert.match(css, /\.edupi-teacher-body\.has-object-sider/);
  assert.match(css, /\.edupi-command-center/);
  assert.match(css, /\.edupi-today-layout/);
  assert.match(css, /\.edupi-memory-groups/);
  assert.match(css, /\.edupi-insight-layout/);
  assert.match(css, /\.edupi-growth-grid/);
  assert.match(css, /\.edupi-semester-ledger/);
  assert.match(css, /\.edupi-task-inspector/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 1000px\)[\s\S]*\.edupi-task-board-create\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.edupi-task-board-create\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.edupi-task-board-create__source\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /Notion-inspired surface language/);
});

test("background jobs expose every available artifact for native opening", async () => {
  const jobs = await read("./EduPiBackgroundJobs.tsx");
  const css = await read("../app/edupi-admin.css");
  assert.match(jobs, /job\.artifacts\.map/);
  assert.match(jobs, /workspaceFile\(data\.workspace, file\.relative_path\)/);
  assert.match(jobs, /openPathNative/);
  assert.match(css, /\.edupi-background-job-artifacts/);
});
