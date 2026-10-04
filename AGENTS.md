# EduPi 执行与验收规则

本节针对已发生的问题：把局部修改当作完整交付，用测试总数代替实际验收，在用户明确要求连续执行后仍反复结束回复。后续执行必须遵守以下规则。

## 连续执行与停止条件

- 用户要求“全部做完”“连续执行”“不要停”时，执行单位是用户确认的完整范围，不是一个函数、一次测试、一个 commit 或一个 PR。
- 小步实现、小步提交用于可回退和定位问题；完成一个 checkpoint 后继续下一项，不因此发送 final，不等待用户再次说“继续”。
- 进展、测试结果、提交记录用 commentary 简短告知。禁止只承诺“马上继续”后结束回复；能够执行时必须接着执行。
- 只有以下情况可以结束当前执行：已确认范围全部达到验收条件；用户明确暂停或改变任务；剩余所有工作都被已核实的外部条件或必要授权阻塞，且没有其他可推进的范围内工作。
- 一个项目缺账号、实机或权限时，记录该项阻塞并继续其他项目。不得把局部阻塞扩大为整轮停工，也不得把受阻项目勾为完成。
- 不因任务耗时、工作量大或已有若干通过测试自行缩小范围。不得通过重新命名、拆成更小任务、推到“下一阶段”来隐藏尚未完成的验收条件。
- 上下文压缩或运行环境中断时，保存当前状态、失败证据和准确恢复入口；恢复后从未完成处继续，不重做已验证内容。不声称结束回复后仍在后台工作，除非确有运行机制。
- 连续执行不扩大授权边界；仍遵守系统权限、秘密保护和用户数据保护要求。

## 唯一任务账本

- 当前路线图：`docs/plans/2026-09-06-product-closure-roadmap.md`。发布验收：`docs/plans/2026-09-07-signed-updates.md`。
- 开始或恢复工作时先核对账本、当前分支和真实代码状态。沿用原任务编号，不另建互相冲突的计划。
- 每项分别记录：未实现、部分实现、已实现待验收、验收通过、外部阻塞。合并、发布和用户验收另外记录，不能混为同一状态。
- 只有该项全部验收条件有证据才勾选完成。新增需求挂回原任务或明确新增项，不能让原欠项消失。
- 每项证据至少包含：代码版本、运行环境、操作或命令、预期结果、实际结果、证据位置、未验证条件。新记录明确取代旧状态，避免顶部说已完成、表格仍写待开始。

## 验收不能降级

- 以老师能完成的用户流程定义交付，不以代码行数、耗时或提交数量定义交付。没有最低工作时长要求；快慢均以证据判断。
- typecheck 和 lint 证明静态检查通过；单元测试证明被测试的局部行为；HTTP 200 证明请求成功。三者都不能单独证明端到端功能可用。
- 源码字符串或正则断言只用于结构约束和回归哨兵，不能替代交互、数据写入、会话续接、通知或安装验收。
- 引用全套测试数时必须说明本功能的针对性证据。禁止以“大量测试通过”掩盖本功能未测试；skipped、未运行、失败、无结论均不算通过。
- 用户可见改动必须在实际页面或应用中操作，并观察最终结果。只打开入口、看到按钮、发出请求或走到中间页面不算完成。
- 涉及持久化时，写入后重新读取；涉及重启时实际重启；涉及跨模块联动时从另一个入口核对同一对象。失败、取消、重试、重复操作等路径按本次改动影响验证。
- AI 生成任务分别验收运行交付与内容质量。提示词增加“核对答案”、模型自称正确、文件存在或状态 completed，都不能证明教学内容正确。超时或无输出记录为无结论。
- 只检查开发版不能宣称安装版通过；只检查 macOS 不能宣称 Windows/Linux 通过。用户明确延后安装包时，记录开发验收与待发布状态，不提前打包，也不宣称已安装。
- 测试使用隔离数据或明确标记的测试材料，不能向真实学生档案写入虚构观察、关系或成长证据。

## EduPi 必须验证的完整流程

按改动涉及的场景选用，不能只完成其中一步就勾选整个功能。

| 场景 | 最低端到端证据 |
| --- | --- |
| 提醒续聊 | 真实事项触发提醒 → 点开 → 输入并发送 → 会话绑定 → 离开再进入原会话；原草稿不丢、不串任务 |
| 系统通知 | 真实触发 → 后台系统通知 → 点击返回对应事项；权限拒绝或发送失败仍可在应用内处理；重复触发不重复通知 |
| 学生网络 | 对话或手动记录 → 持久化 → 对应学生图和列表可见 → 修订/删除后同步；同名、转班和跨班事件不串档 |
| 课前准备 | 课程和教学重点加可用学情、材料 → 真实生成 → 任务/材料/日程能打开同一产物 → 人工核对内容与答案 |
| 编辑与删除 | 页面保存/取消/删除 → 重新读取 → 其他相关模块同步；支持历史恢复的对象实际恢复一次 |
| 发布升级 | 从公开 Release 下载 → 各目标系统安装启动；旧客户端检测新版 → 下载验签 → 安装重启 → 版本、教师数据和模型配置核对 |

## 每次准备结束前

静默核对：用户要求的范围还有什么未完成？哪些只有代码、哪些缺运行证据？是否仍有可执行的下一项？

若仍有已授权且可执行的工作，继续工具操作，不用总结代替执行。允许结束时，只报告有证据的结果、剩余项和具体阻塞；禁止宣称“全部完成”“已打通”后又列出该功能的核心步骤未完成。

---

# Pi Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

## EduPi UI Content Contract

- Operational surfaces use restrained, Notion-like hierarchy. First-run moments use Apple setup-style progressive reveal.
- One screen gets one primary action. Do not add feature lists, principle lists, marketing blocks, footer slogans, or repeated explanations.
- Do not explain what the interaction already shows. Keep default helper copy to one short line at most; move additional help behind an explicit user action.
- Prefer motion, state transitions, direct labels, and real content over instructional prose.
- Before shipping a user-facing view, delete every sentence that is not required to decide or complete the current action.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET currently-running session ids
  agent/running/events/route.ts   GET SSE stream of currently-running session ids
  auth/all-providers/route.ts     GET API-key provider list
  auth/api-key/[provider]/route.ts GET/POST/DELETE provider API key status/storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth provider list
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/catalog/route.ts  GET models.dev pricing presets
  models-config/discover/route.ts POST fetch a configured provider's upstream model list
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  worktrees/route.ts              GET/POST/DELETE git worktrees
  desktop/read-images/route.ts    POST read natively-picked images into attachment payloads
  desktop/save/route.ts           POST copy a file to, or write bytes at, a natively-picked path

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  app-prefs.ts         APP_PREF_KEYS + typed localStorage accessors (SSR/private-mode safe)
  desktop-connection.ts useDesktopConnection() — local server health probe for the reconnect banner
  desktop-native.ts    native dialogs, open/reveal path, external links, save/import, window lifecycle
  desktop-notify.ts    native completion notifications (skipped while the window is focused)
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  markdown.ts          shared markdown helpers
  npx.ts               npx runner used by skill install
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  tool-presets.ts     PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  workspace-state.ts  persisted session/cwd/file-tab restore for desktop cold starts
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Pi 1 session replacement and history
`AgentSessionRuntime.fork(entryId, { position: "before" })` preserves the Desktop fork boundary before the selected user message. The runtime replaces the inner session; the wrapper rebinds subscriptions and extensions, captures the new ID, then shuts down so the old registry key cannot point to the new session. Replacement or persistence failures also remove the old wrapper.

`SessionManager.buildSessionContext()` is the authoritative history, including for title generation. Do not write `agent.state.messages`, `systemPrompt` or `thinkingLevel`; Pi 1 exposes read-only state. Wait for `session.waitForIdle()` before consuming settled history.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### A new session has no file until pi flushes it
Pi delays the first flush of a new session until an assistant message exists, so a run that just started is invisible to the disk scan behind `/api/sessions`. The sidebar list is derived purely from `.jsonl` files, so without help the session the user is actively watching cannot be found in the list until the turn ends.
- `AgentSessionWrapper.getLiveSnapshot()` builds a `SessionInfo`-shaped row from the in-memory `sessionManager`; `/api/sessions` merges those for ids the scan did not return. The snapshot returns `null` until a user message exists, otherwise an untouched "new chat" runtime renders a row that later vanishes.
- `SessionManager.open()` on a missing file returns an **empty history rather than throwing**, so a read path that opens the file blindly silently shows an empty chat. Session reads go through `openSessionManagerForRead()`, which falls back to the live runtime's manager. Rename and delete of an unflushed session likewise go through the runtime — there is no file to append to or unlink.
- The sidebar refetches the list once per running id it has no row for, because a session can start running between list fetches.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When all tools are off, `rpc-resource-loader.ts` disables third-party resources and supplies an empty prompt through a host-owned `before_agent_start` hook. Reloads reuse the per-mode loader so extension code caches refresh; explicit re-enabling uses the normal loader. The active tool set remains empty after binding and reload.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions. Explicit browser model/thinking selections are applied atomically during AgentSession construction, then `lib/startup-preferences.ts` persists their effective values without replaying `set_model`/`set_thinking_level`; implicit `enabledModels` fallbacks and thinking pins are not persisted.

### `enabledModels` scoping
The `enabledModels` setting uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix. Never compare those patterns as literal strings — `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so pi-web and the TUI agree on the visible model list, and falls back to all available models when patterns resolve to nothing. `startRpcSession()` resolves that scope before creating an AgentSession and passes the selected initial model, thinking pin, and SDK-native `scopedModels` atomically; `GET /api/models` reuses the helper only for selector data, `thinkingLevelPins`, and `modelScopeWarnings` display.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and pauses polling in background tabs. The session-list response remains the initial fallback.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Per-session scroll restore must be saved before the render-phase reset
Switching sessions resets chat state *during render* (`sessionIdentity !== appliedIdentity` in `useAgentSession`), so the message list is emptied in the same commit — the browser clamps the container's `scrollTop` to 0 before any effect cleanup runs. Saving the position from an effect cleanup therefore records 0 for every switch (which restores as "top of the chat"). The save lives inside the render-phase reset block; an unmount-only cleanup covers ChatWindow remounts (there the DOM is still intact when cleanup runs). Positions and the lazy-load `visibleCount` are cached per session in module-level LRUs (`lib/scroll-memory.ts`): `scrollTop` is a pixel offset into the render window that existed at save time, so `visibleCount` must be restored with it or the offset lands on the wrong message. A viewport at the bottom is deliberately not saved — the restore path then falls back to scroll-to-bottom so users following the tail keep following it.

### The session load must have a deadline
Switching chats does **not** remount `ChatWindow` — `AppShell.handleSelectSession` deliberately keeps `sessionKey` stable so the input dock does not flash. That makes the single `GET /api/sessions/[id]` in `loadSession()` the only thing that ever clears `loading`, and the retry button only appears once the load *fails*. A bare `fetch` there is a hang away from leaving "loading session" on screen permanently, which is exactly what desktop users hit on the first switches after a cold start. It goes through `fetchWithRetry()` (`lib/fetch-timeout.ts`): a hung first attempt is abandoned, then retried once with a longer deadline — the server finishes its cold-start work regardless of the client giving up, so the retry usually lands warm.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so dual-auth providers (anthropic and github-copilot today — which providers declare both changes between SDK releases, so never assume it from an id) appear exactly once and never fall through both lists (#309). `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to those pure helpers.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is. The delete routes therefore use `removeStoredCredentialIfType()` to compare and delete under the same file lock used by pi's auth storage. `ModelsConfig` also refreshes *both* provider lists after any auth change — refreshing one leaves a dual-auth provider rendered twice.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

### Desktop shell (Tauri)
- `lib/desktop-native.ts` is the only place the UI touches Tauri APIs; every entry point checks `isTauriDesktop()` and degrades to a web equivalent. Tauri commands are declared in `src-tauri/src/lib.rs`, their permissions in `src-tauri/permissions/desktop-shell.toml`, and both must be listed in `src-tauri/capabilities/desktop-dialog.json` or the call fails at runtime only.
- `/api/desktop/read-images`, `/api/desktop/save`, and `/api/files?...type=import` deliberately accept absolute paths selected by native dialogs, so the normal `lib/file-access.ts` source/destination allow-list cannot cover them (`save` still allow-lists its *source*). They require a loopback Host, normal request-security checks, and the per-process desktop token from `lib/desktop-api-auth.ts`. The Tauri shell passes the token to the packaged server and exposes it to the trusted WebView through the capability-scoped `get_desktop_api_token` command. Never fall back to a static token or User-Agent detection.
- `read-images` caps the file count at `MAX_ATTACHED_IMAGES` from `lib/image-attachments.ts`. Keep it derived from that constant; a separate literal silently 400s selections the composer considered valid.
- Open a local path with `explorer.exe` on Windows, never `cmd.exe /C start` — Rust's argument escaping does not apply to the cmd parser, so a legal path like `C:\src\R&D\x.txt` would split into commands.
- `lib/app-prefs.ts` owns every `localStorage` key. Theme is additionally mirrored into the app config dir via the `set_ui_theme` command, because the packaged server's port (and therefore the WebView origin, and therefore `localStorage`) can change between cold starts.
- `lib/workspace-state.ts` restores the last session/cwd/file tabs on cold start. URL params always win over the persisted workspace.
- `useDesktopConnection` polls `/api/home` only in Tauri to drive the offline banner. Its cleanup must stop in-flight probes from rescheduling, otherwise an unmount leaves a timer nobody owns and it pings forever.

### Upstream merge sentinels (not the same "fork" as session fork)
This repo is a fork of `agegr/pi-web` and periodically merges upstream. `components/fork-extractions.test.mjs` guards the failure mode that a clean merge can still be wrong: code this fork *moved* to another file reappears at its origin, or a fork change is silently reverted. Git does not track cross-file moves, so neither shows up in `tsc`, eslint, or the upstream suite.

When one of those assertions fails, the default is to restore the behaviour, not to delete the assertion. A failure saying a marker is "absent from the origin but also from the extraction targets — it looks deleted, not moved" means the feature is probably gone: that is exactly how the project-picker filter box was found missing after a restyle had left every project past the 7-row cap unreachable. Risk levels live in `scripts/fork-ownership.json`; the reasoning is in `docs/ownership-boundaries.md`.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
