# ADR-005: JEV 决策与 OpenConnector 外部连接采用独立适配层

## 状态

已接受，分阶段接入。

## 日期

2026-09-20

## 背景

EduPi 需要两类新能力：浏览器操作前的快速结构化决策，以及外部 SaaS/API 的统一连接。两者都不能绕过 EduPi Core 的权限、状态、审核和证据边界，也不能替换现有 Pi 模型、Browser/Computer Executor 或已有连接器。

核对基线：

- JEV 参考 `browser-use/jev-ultrafast` commit `1231850a0bf1a0c0341fe408ef1668dbbfdfac46`。
- OpenConnector 参考 `oomol-lab/open-connector` commit `036ebd77f445897ebee83466df5bd5379ff9e130` 与 headless package `1.6.1`。
- Desktop 运行时为 Node `22.23.1`，项目要求 Node `>=22.19.0`；OpenConnector headless package 要求 Node `>=22.18.0`。

## 决策

### JEV 只负责建议

`DecisionProvider`、`JevDecisionProvider`、`DecisionPolicy` 和 `BrowserDecisionAdapter` 位于 `lib/integrations/browser-decision.ts`。

输入只能是浏览器结构化快照：URL、标题、可见文本、页面指纹、可交互元素及其允许操作。默认决策请求不发送截图。每轮动态生成 `CLICK`、`TYPE_TEXT`、`SELECT`、滚动、等待、完成和阻塞选择；没有可用目标的元素操作不会进入 Action Space。下拉选择绑定到观测到的精确 option，不允许模型生成选择器、坐标、JavaScript、Shell 或文件操作。

策略层校验完整概率集合、目标存在性、元素支持的操作、置信度和高风险标签。总体置信度取 operation 与 target 置信度的较低值。`TYPE_TEXT` 只有在 JEV 已选中可编辑元素后才调用小型文本模型，并受同一超时约束。

服务不可用、超时、低置信度、`BLOCKED`、页面不可读、无效响应、文本生成失败和连续失败均进入现有浏览器 Provider fallback。JEV 返回 `DONE` 仍需执行器独立核对页面结果。

当前 Desktop 尚无可接入的受管理浏览器执行器，因此本批不注册 JEV Agent 工具，也不把它接到桌面无障碍执行器。接口保留 `surface`，未来可扩展桌面 GUI，但扩展前必须另做权限与执行验收。

### OpenConnector 使用自托管 Runtime HTTP 边界

`ExternalConnectorProvider` 与 `OpenConnectorProvider` 位于 `lib/integrations/open-connector.ts`。本批连接本地或自托管 OpenConnector runtime，不依赖第三方托管业务控制面。

不把 `@oomol-lab/open-connector` 直接加入 Desktop 生产依赖。该包当前解包约 102 MB、每进程只允许一个 runtime，还需要持有数据目录、加密密钥、迁移、关闭和打包资产生命周期。Desktop 先通过官方 `/v1` runtime API 与本地 `/api` 审计端点接入；独立 runtime 或未来受管 sidecar 都可复用同一 Adapter。`baseUrl` 支持 OpenConnector `publicOrigin` 的挂载前缀。

OpenConnector 负责 Provider/Action 目录、OAuth/API Key、凭据存储、连接、执行和脱敏运行日志。Agent 只得到 `search`、`inspect`、`execute`、`receipt` 四个动作，不得到连接或凭据管理能力。连接管理方法留在服务端 Provider 接口，要求管理员 token。

Action 必须同时通过 capability 白名单与 runtime token 自身策略。当前 capability 标签由 Agent 工具参数选择，但只能命中管理员配置的 Action 子集；把该标签绑定到 Core WorkCase 的权威 capability grant 仍需配对 Core 合同。搜索结果在 capability 过滤后最多返回 50 项。只有 runtime metadata 明确给出 `operationType=read` 的 Action 才自动执行；`write`、`destructive`、未知或缺少该字段的 Action 均为高风险。发布包 `1.6.1` 尚未暴露 GitHub `main` 已有的 `operationType`，因此该版本的所有 Action 默认要求确认。高风险执行使用现有可见确认界面，并把 action id、输入哈希、连接名、确认标识和十分钟时限绑定在一起。无 UI、拒绝确认或确认内容变化均不执行。

每次执行使用 runtime 级幂等键。成功和已开始执行的失败都转换为 `ExternalExecutionReceipt`；回执保留 `executionId`、Action、连接、风险、状态、审计持久化结果和脱敏输出/错误。审计回读再次应用 capability 白名单，不能用已知 execution id 跨任务读取其他 Action。当前回执保存在 Pi 会话工具结果与 OpenConnector 审计中；写入 Core WorkCase/Evidence/Receipt 仍需配对 Core 合同后再启用。

### 默认关闭

未显式启用或缺少必要密钥时，两项能力都不注册、不发网络请求、不改变现有会话工具和执行链。OpenConnector 仅在 EduPi 数据根会话注册。

JEV 设置通过普通设置窗口中的“快速浏览器决策”卡片维护，不进入聊天模型 Provider 或模型选择器。非秘密配置原子写入 `~/.pi/agent/edupi-desktop/jev.json`；API Key 复用 Pi 的 `auth.json` 锁定凭据存储，Provider ID 为 `edupi-jev`。GET、PUT、DELETE 和测试接口只接受受信 Host 与同源请求，公开响应只包含 `keyConfigured`。环境变量优先于文件设置，存在环境覆盖时界面只读。

## 配置

| 变量 | 用途 |
| --- | --- |
| `EDUPI_JEV_ENABLED` | 显式启用 JEV Adapter |
| `EDUPI_JEV_ENDPOINT` | TypeSafe SystemOne 地址，默认官方地址 |
| `EDUPI_JEV_API_KEY` | JEV 服务密钥 |
| `EDUPI_JEV_MODEL` | JEV 模型，默认 `jev-latest` |
| `EDUPI_JEV_TIMEOUT_MS` | 单次决策及文本生成超时 |
| `EDUPI_JEV_MIN_CONFIDENCE` | 最低可执行置信度 |
| `EDUPI_JEV_MAX_CONSECUTIVE_FAILURES` | 打开 fallback circuit 前的连续失败数 |
| `EDUPI_JEV_TEXT_MODEL_BASE_URL` | `TYPE_TEXT` 小模型 OpenAI-compatible 地址 |
| `EDUPI_JEV_TEXT_MODEL_API_KEY` | 文本模型密钥 |
| `EDUPI_JEV_TEXT_MODEL` | 文本模型 ID |
| `EDUPI_OPENCONNECTOR_ENABLED` | 显式启用 OpenConnector Agent 工具 |
| `EDUPI_OPENCONNECTOR_BASE_URL` | 自托管 runtime 的 `publicOrigin`，可带挂载前缀 |
| `EDUPI_OPENCONNECTOR_RUNTIME_TOKEN` | `/v1` 执行 token |
| `EDUPI_OPENCONNECTOR_ADMIN_TOKEN` | 连接管理与审计回读 token |
| `EDUPI_OPENCONNECTOR_CAPABILITY_ACTIONS` | capability 到 Action glob 数组的 JSON 对象 |
| `EDUPI_OPENCONNECTOR_TIMEOUT_MS` | runtime 请求超时 |

推荐由 OpenConnector persistent runtime token 继续收窄 `allowedActions` 与 `allowedConnections`。Desktop capability 白名单是额外一层，不替代 runtime 策略。

## 后果

- 未配置环境保持原行为，JEV 或 OpenConnector 故障不会让已有 Browser/Computer Executor 消失。
- JEV 和 OpenConnector 互不调用，统一等待 Core/Capability Runtime 编排。
- OpenConnector 能在不把 Provider 凭据交给 Agent 的情况下执行外部 Action。
- JEV 实际浏览器闭环、OAuth 真实账号、Core 回执落账和安装版 sidecar 生命周期仍需后续配对验收，不能由本批单元测试代替。

## 依据

- [JEV action space 与执行边界](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/README.md)
- [JEV TypeSafe 请求、概率校验与文本模型实现](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/model.py)
- [OpenConnector runtime API、幂等与审计合同](https://github.com/oomol-lab/open-connector/blob/036ebd77f445897ebee83466df5bd5379ff9e130/docs/runtime-api.md)
- [OpenConnector programmatic connection API](https://github.com/oomol-lab/open-connector/blob/036ebd77f445897ebee83466df5bd5379ff9e130/docs/programmatic-connections.md)
- [OpenConnector headless runtime 生命周期](https://github.com/oomol-lab/open-connector/blob/036ebd77f445897ebee83466df5bd5379ff9e130/docs/headless.md)

## 备选方案

### 把 JEV 接到桌面无障碍执行器

拒绝。当前目标是浏览器 DOM/ARIA 决策，桌面 GUI 没有同等目标稳定性与 freshness guard，会扩大权限面。

### 把 OpenConnector 所有 Actions 直接注册为 Agent 工具

拒绝。Action 目录规模很大，静态暴露会绕过任务 capability、增加提示上下文并扩大误执行面。

### 本批直接嵌入 headless package

暂缓。嵌入式 runtime 可行，但会新增约 102 MB 包、存储迁移和进程生命周期职责。先完成可替换的 HTTP Adapter 和真实 headless contract 验证，再决定安装版采用 sidecar 或进程内 runtime。
