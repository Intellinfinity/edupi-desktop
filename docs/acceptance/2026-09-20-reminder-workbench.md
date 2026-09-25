# 提醒工作台验收

## 2026-09-25 macOS 安装版通知呈现条件

- 已安装 v0.3.40 和升级后的 v0.3.41 均在教师设置点击“测试通知跳转”，页面回读“系统已接受通知；点击通知应打开提醒”，系统通知状态为“已开启”。macOS 系统设置中 EduPi 通知为“标记、声音和桌面”，但全局“当镜像或共享屏幕时”为“关闭通知”；当前共享环境未出现可点击通知。此结果只验收请求被系统接受，不验收通知实际展示和点击路由。
- 保留用户原有共享屏幕隐私设置；没有为测试开启其他应用通知预览。Apple [通知设置说明](https://support.apple.com/en-my/guide/mac-help/mchl205da693/mac) 说明共享/镜像时可以整体暂停通知。待可安全展示通知的环境再从系统通知本身点击并核对提醒事项。

## 2026-09-25 首次读取状态修正（源码与隔离页面，未发布）

- 在 v0.3.40 包内 server、隔离 Core `68004b2` 中先创建两条到期任务并回读提醒存储 `2` 条，页面初次打开却短暂显示“没有待处理提醒 / 0 条”，下一次可访问状态才变为 `2`。这是首次异步 GET 前把初始空数组当作真实空结果，非 Core 丢数据。
- Desktop `4536d03` 增加首次加载状态：未收到首个提醒响应且没有旧列表时，队列只显示“正在读取提醒”，不显示虚假的空结果或 `0` 计数；成功/失败后结束加载。提醒路由判断改用稳定布尔依赖，避免重渲染让加载态反复出现。首次读取失败且没有旧列表时也不再显示“没有/暂无待处理提醒”，只显示“提醒暂不可用”。两项行为回归均先确认旧实现失败，修复后 `components/EduPiReminderInbox.test.mjs` 5/5 通过。
- 使用相同隔离根另起当前源码 Next 服务 `127.0.0.1:30243`，只拦截该标签页 `/api/edupi/reminders` 的 Fetch/XHR 请求：响应暂停期间可访问树显示“正在读取提醒”且无错误 `0` 计数，放行后显示 `2 条待处理`；模拟读取失败时显示“提醒暂不可用”且不再显示空列表结论，重新加载后恢复显示原有 2 条。800×900 实际页面 `scrollWidth=clientWidth=800`，正常路径控制台 error/warn 为 0。全量 `npm test` 为 1739 total / 1713 passed / 26 skipped / 0 failed；TypeScript、lint、`git diff --check` 通过。
- 提醒续聊的发送、Core 会话绑定、离开再进入和两种草稿隔离证据见 [AI 协作输入验收](2026-09-23-ai-collaboration-composer.md)。本修正尚未进入公开 v0.3.40 签名安装包；真实 macOS 系统通知点击、睡眠唤醒与 Windows/Linux 原位升级仍未验证。

## 范围

- Desktop PR [#196](https://github.com/PIGU-PPPgu/edupi-desktop/pull/196)，实现提交 `40bdd5f`；发布 PR [#197](https://github.com/PIGU-PPPgu/edupi-desktop/pull/197)，主线发布提交 `d3b96f96f9344a98dfba1cc145c84309c9dbf08d`。
- 只调整提醒页的信息架构、布局、状态选择和动作呈现；提醒生成、Core 所有权、持久化文件与 API 动作保持原合同。
- 真实教师数据未写入。浏览器写操作使用 `/tmp/edupi-reminder-ui.qQTXAt` 的隔离副本，Core 固定为 `d05cf89df067a78602883c6bd95a37f8b0c122f7`。

## 根因与实现

- 旧提醒组件直接渲染原生 `select + details`，缺少列表宽度、选中态和详情面；标题在约 300px 内容列中连续断行。
- 提醒入口复用 `view=chat`，外层 `.edupi-teacher-body.is-chat` 即使不渲染会话侧栏也保留 `280px + 1fr` 两列；提醒主区被自动放入第一列，右侧保持空白。
- 新实现为主从工作台：状态按钮组、每页八条的滚动队列、当前提醒详情及原有四类动作。提醒模式向外层增加 `is-reminders`，桌面改为单列全宽；820px 以下纵向排列队列与详情。

## 运行证据

运行环境：Next 开发服务、Chromium 153、隔离数据根、固定 Core；首配浮层仅在浏览器上下文中通过既有本地偏好关闭。

- 1440×900：提醒外层和 surface 宽度均为 `1220px`；工作台实际列宽为 `406.016px / 705.828px`，页面无横向溢出。5 条提醒标题在队列单行截断、详情完整显示。
- 选择第二条提醒后详情标题从默认项切换为“第3周 · 保持平常心准备”；提醒接口记录 `GET 200 / GET 200 / POST 200`，控制台 error/warning 为 0。
- 800×900：提醒 surface 高 `840px`，队列/详情高 `275.86px / 364.95px`；5 条 DOM 记录均保持可见或可滚动，无横向溢出。
- 390×844：提醒 surface 高 `784px`，队列/详情高 `233.47px / 364.95px`；状态按钮与动作区均无横向溢出。
- 亮色与暗色均实际截图检查；键盘从“待处理”依次 Tab 到“稍后提醒”“已移除”，焦点顺序正确，控制台 error/warning 为 0。截图因包含教师工作上下文，仅作本地检查，未提交到公开仓库。
- 在隔离副本点击“稍后提醒”：POST 返回 200，待处理 `5 → 4`、稍后提醒 `0 → 1`；刷新页面后仍为 `4 / 1`，证明写入后回读生效。

## 自动检查

- `npm test`：1322 total / 1297 passed / 25 skipped / 0 failed。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- `npm audit --audit-level=high`：0 vulnerabilities。
- `git diff --check`：通过。

## 边界

- 正式 Latest [`v0.3.28`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.28) 已发布。Workflow [`35505373874`](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35505373874) 的 macOS、Linux、Windows 和 manifest 全部成功；Release 非草稿、非预发布，含 11 项资产，`latest.json` 为 `0.3.28` 且有 7 个 updater 平台键，组件清单为 Desktop `0.3.28`、Pi `0.84.1`、pi-web `0.8.7`。
- 未在已安装应用中验收。本机安装版仍是 v0.3.25，`github.com:443` 连接在 5 秒内超时，尚不能下载、验签、替换或重启到 v0.3.28；macOS Release 仍为 ad-hoc 签名。
- 未重复执行提醒续聊的真实消息发送、会话绑定、离开返回和重启恢复；这些链路由既有提醒验收覆盖，本次没有改动其实现。
- 系统通知显示、通知点击回到同一事项、真实睡眠唤醒仍归 R21，不能由应用内提醒页面通过代替。
