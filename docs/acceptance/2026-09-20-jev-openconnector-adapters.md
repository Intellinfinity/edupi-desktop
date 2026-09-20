# JEV / OpenConnector Adapter 验收记录

## 版本与环境

- Desktop branch：`feat/jev-openconnector-integration`
- Desktop baseline：`03f02b2`
- Node：`22.23.1`
- JEV source：`browser-use/jev-ultrafast@1231850a0bf1a0c0341fe408ef1668dbbfdfac46`
- OpenConnector source：`oomol-lab/open-connector@036ebd77f445897ebee83466df5bd5379ff9e130`
- OpenConnector headless package：`1.6.1`
- 测试数据：临时目录、无真实教师/学生数据、无真实 Provider 凭据、无外部写入

## 针对性行为验证

命令：

```bash
node --test \
  lib/integrations/browser-decision.test.mjs \
  lib/integrations/open-connector.test.mjs \
  lib/edupi-external-connector-tool.test.mjs \
  lib/rpc-openconnector-session.test.mjs
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint \
  lib/integrations/browser-decision.ts \
  lib/integrations/browser-decision.test.mjs \
  lib/integrations/open-connector.ts \
  lib/integrations/open-connector.test.mjs \
  lib/edupi-external-connector-tool.ts \
  lib/edupi-external-connector-tool.test.mjs \
  lib/rpc-manager.ts
git diff --check
```

实际结果：JEV、OpenConnector、Agent 工具和真实 AgentSession 注册共 42 项针对性测试通过；TypeScript、定向 ESLint 与 diff check 通过。覆盖默认关闭、安全服务 URL、动态 Action Space、精确下拉选项、完整概率校验、低置信度/超时/连续失败 fallback、高风险确认、runtime `operationType` 覆盖与缺失时 fail-closed、capability 裁剪、挂载前缀、输入深度、幂等键字节限制、成功/失败回执、错误脱敏、审计回读、工作区限制，以及开关启停时的实际工具注册。

仓库级门禁：新增设置入口后，`npm test` 共 1321 tests、1296 passed、25 skipped、0 failed；`npm run lint`、`node_modules/.bin/tsc --noEmit`、`npm audit --audit-level=high` 和 `npm run release:verify` 均通过。release verify 回读 Desktop `0.3.26`、Pi `0.84.1`、pi-web `0.8.7`。

## 设置入口

- 设置窗口新增“快速浏览器决策”，默认关闭，固定说明“只用于浏览器下一步判断，不参与对话或模型选择”。
- 页面可维护 JEV URL、API Key、模型、最低置信度和超时；没有把 JEV 注册成聊天 Provider。
- API Key 只写入临时 `auth.json` 的 `edupi-jev` 项，非秘密配置写入 `edupi-desktop/jev.json`；两个文件权限均为 0600。GET 和保存响应只返回 `keyConfigured=true`，配置文件和页面均未回显假密钥。
- 隔离页面实际保存假密钥，把 endpoint 改到本机 TypeSafe 兼容服务，再点击“测试连接”；页面显示“连接成功 · 13ms”。本机服务确认收到 Bearer key，返回 JEV `WAIT` 决策后已关闭。
- 存储、路由、组件与原决策 Adapter 共 24 项定向测试通过；跨站、LAN、非 JSON、未知字段、过长字段、远端明文 HTTP、环境覆盖和密钥清除均有回归。页面把状态显示为“已配置”，并在 URL 或参数有未保存变化时禁用“测试连接”。

## 官方 headless runtime 实测

在 `/tmp` 安装 `@oomol-lab/open-connector@1.6.1`，使用 `createConnectorRuntime()`、临时 SQLite、临时 admin/runtime token 和带 `/connector` 前缀的 `publicOrigin`。Adapter 通过 runtime 自带 `fetch` 边界完成：

1. 读取 1511 个 Provider。
2. 搜索并 inspect `npm.get_package`。
3. 发布包 `1.6.1` 的 Action metadata 未携带 `operationType`，Adapter 将该 Action 判为高风险；隔离验收生成与 action/input/connection 精确绑定的本地确认记录后，用幂等键执行 `npm.get_package({ packageName: "@oomol-lab/open-connector" })`。
4. 返回成功回执，结果包名为 `@oomol-lab/open-connector`，版本为 `1.6.1`。
5. 通过 `/api/runs/:executionId` 回读同一成功审计，execution id 一致，`auditPersisted=true`。

另用 `hackernews.get_top_stories` 验证失败链路。当前环境访问 Hacker News 超时，runtime 返回 `provider_error` 与 502 详情；Adapter 保留同一 `executionId`，审计回读为失败且错误消息已由 runtime 脱敏。该结果不算 Hacker News Action 成功，只证明已开始执行的失败不会丢失回执。

## 未验证边界

- 当前环境没有 `EDUPI_JEV_API_KEY`，未调用付费 JEV 服务。
- Desktop 目前没有受管理浏览器执行器，尚不能做 DOM 采集 → JEV → policy → Browser Executor → 页面结果核对的端到端操作。
- 未使用 Gmail/GitHub 等真实 OAuth 或 API Key 账号；没有发送、删除、发布或修改任何外部数据。
- OpenConnector 尚未作为安装版受管 sidecar 或进程内 runtime 打包；本批验证的是 Adapter 与官方 headless runtime 合同。
- capability 标签尚未由 Core WorkCase 签发；当前 Agent 只能在部署配置和 runtime token 的交集内选标签，Core 级任务绑定仍待配对合同。
- 外部执行回执尚未写入 Core WorkCase/Evidence/Receipt；当前证据在 Pi 会话与 OpenConnector 审计中。

这些项目保持“待验收”，不能由当前源码测试或无账号 runtime 实测替代。
