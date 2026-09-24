# R23 未受管 Action 生产隔离验收

## 状态

- 结论：开发态风险门通过，尚未发布；R23 仍为部分实现。
- 目标：在 Core WorkCase、一次性 grant、Receipt、受管 runtime 和可信人工确认全部就绪前，真实 OpenConnector Action 保持零执行面。

## 已验证

- 生产 `rpc-manager` 不导入旧环境 Provider 工厂，也不注册 `edupi_external_connector`。即使同时配置 enable、runtime/admin token、URL 与 capability policy，真实 AgentSession 的工具表仍无该工具。
- `rpc-manager` 模块加载时先清除服务端 OpenConnector runtime/admin token；隔离测试证明它发生在任何 AgentSession/扩展资源创建前，其他配置与 JEV 独立密钥不受影响。
- `OpenConnectorProvider` 默认是 catalog-only：`executeAction`、连接管理、连接列表和执行回读在网络前返回 `core_authority_required`。旧 HTTP Adapter 的副作用路径需要源码显式 `allowUnmanagedActionsForTesting:true`，只在隔离合同测试中使用；环境工厂已删除。
- 打包的 `open-connector-catalog-host.mjs` 仍只接受 `providers/search/inspect`，并以 runtime policy 阻断全部 Action 与 proxy；本改动未扩大其协议。

## 证据

- RED：修改注册期望后，旧实现的 2 项测试失败，证明环境配置确实会注册工具；新增默认 Provider 负测先以 `Missing expected rejection` 失败。
- GREEN：OpenConnector/Session/环境隔离/运行时绑定 43 项定向测试通过；全量 1705 项中 1679 passed / 26 skipped / 0 failed；TypeScript、ESLint/branding、Cargo metadata 与依赖审计通过。
- 结构化结果：[R23 Action 隔离记录](../loop/evidence/2026-09-24-r23-action-quarantine.json)。

## Risk

- 当前开发分支消除了旧生产入口，但公开 v0.3.37 尚未包含此变更；正式包发布前仍按 v0.3.37 的默认关闭与凭据不配置边界运行。
- 原型类仍保留隔离假 Provider 的 POST 合同测试。任何未来生产调用若显式打开测试开关都必须被代码审查和回归门拒绝。

## Unverified

- Core 外部 WorkCase/授权/Receipt、RFC 8785 输入快照、连接修订原子核对、未知回执恢复、受管 sidecar、可信人工确认与三平台 OS 隔离尚未实现。
- Windows/Linux/macOS 下一签名安装版尚未复验旧环境变量无法注册工具；真实 Provider 一律未调用。
