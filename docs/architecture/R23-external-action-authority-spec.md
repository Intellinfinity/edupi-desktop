# R23 外部 Action 权限与受管 Runtime 规格

状态：设计约束；尚未实现或验收。唯一任务账本仍是 [产品闭环路线图](../plans/2026-09-06-product-closure-roadmap.md)。

## 目标与假设

老师可以从明确的事项发起外部 Action，先看见实际连接、目标和完整输入，再逐次确认；Core 决定是否允许执行，持久化成功、失败或结果不明的回执。JEV 只提供浏览器下一步建议，不进入对话模型或本合同。

当前设计假设：保留 `edupi-bridge-v1.1` 的教育工作区语义；新的外部执行合同独立版本化。OpenConnector headless runtime 由 Desktop 管理生命周期。首个可打包阶段只验证目录/inspect 与隔离假 Provider 的 POST，不对真实 Provider 执行 Action；`no_auth` 也可能产生外部副作用。不开放入站 Action HTTP 端口。私有管道减少网络暴露，但同用户 Agent shell 仍可能接触管道或凭据，不能独自构成授权隔离。

## 合同

1. Core 创建外部 WorkCase，绑定教师意图、当前来源快照、Action capability、连接的稳定 ID、连接修订与账号身份、到期时间和预期输入范围；Agent 提供的 `capability` 字符串仅是查找标签，不是授权。连接管理必须经唯一 broker；替换同 ID 的凭据也递增修订，确认到 dispatch 期间与连接变更串行化，或由 runtime 原子检查预期修订。
2. 执行前，可信教师界面展示 Action、连接账号、完整输入和可能产生的外部效果。Core 只接受来自独立可信界面的确认凭证，不接受 Agent 参数中的 `teacher_confirmation=true`。授权必须绑定 WorkCase 修订、来源快照、Action ID、连接 ID/修订/账号身份、规范化输入 SHA-256、幂等键、确认 ID 和短时有效期。
3. Core 原子消费一次授权并生成 `pending` Receipt，之后受管 runtime 才能开始 Action。取消、来源变化、连接变化、过期、重复确认和不同幂等键均在 runtime 调用前拒绝。网络超时或崩溃使 Receipt 进入 `unknown`，不自动重发 POST。已知 `executionId` 才能按 ID 回读审计；只有幂等键时没有官方查询接口，必须人工核对。runtime 同键响应只保证 24 小时内重放；过窗永久禁止用旧键再次 POST，保持 `unknown` 待人工对账。
4. runtime 返回执行 ID 后，Core 以同一 WorkCase 和幂等键落账脱敏结果。成功、失败、结果不明均可重新读取；会话历史和 runtime 审计是辅助证据，不取代 Core Receipt。失败落账不能伪装成成功，未落账不能显示“已完成”。
5. 受管执行进程不开放 Action HTTP 入站，默认关闭；独立数据目录和日志目录，退出时关闭 runtime。凭据与加密钥匙不得经环境变量、命令行、公开端口或 Agent 可读文件传递。受管进程的包资产、迁移和退出行为须在 macOS/Windows/Linux 安装版验证。OAuth 需要提供商可达的 `<publicOrigin>/oauth/callback`，首阶段不支持；以后只能增加受控回调入口，不得顺带开放 Action API。

输入只由 Core 生成一次不可变快照：拒绝重复 JSON 属性、不合法 Unicode、非 I-JSON 数值及不可完整展示的内容，按 [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785) 生成 UTF-8 规范字节并计算 SHA-256。可信界面展示该快照的同一语义对象，broker 将相同快照派发给 runtime；Desktop 不再独立 `JSON.stringify` 重算授权哈希。键顺序、数字、Unicode 与拒绝样例用 Core/Desktop/macOS/Windows/Linux 共用的合同 fixture 锁定。

## 安全边界

- 当前 `edupi_external_connector` 的 UI 确认和 bash 子进程环境过滤只是止血。只要同用户无限制 shell 能读父进程环境、凭据文件或进程管道，就不能宣称“外部写入必须确认”。
- 私有 pipe/socket 不等于权限边界。启用有凭据 Action 前，必须在三平台证明 Agent 运行在独立 OS principal/可验证的沙箱，且不能读写 Core WorkCase/授权/Receipt store 或 runtime 凭据；或者在连接器开启的整个进程生命周期内移除所有模型 shell、`read/edit/write/grep/find/ls`、computer-use、第三方等价工具及并发无限制会话。仅从子进程环境删 token 不算通过。
- 原生确认弹窗也不等于人手确认：Agent 可能通过桌面自动化合成点击。确认凭证不得返回 WebView 或 Agent 工具；必须实测合成输入无法签发授权，否则有凭据执行保持关闭。
- 不把现有 G3 内部草稿 grant 的 `external_send=false` 改成 true，也不把 v1.1 的 unsupported command 偷换为外部执行。
- 不把 runtime bootstrap/admin token 暴露给模型、WebView、局域网手机网关或普通桌面 API。管理连接与执行 Action 分权；默认 capability 白名单还须受 Core WorkCase 约束。
- 没有经过跨平台验证的授权与隔离时，可先打包目录和受管 runtime，并对本机隔离假 Provider 测试 POST；真实 `no_auth`、API Key、OAuth Action 一律不开放，也不宣称 R23 完成。

## 代码位置与风格

- Core：新增版本化外部 Action schema、WorkCase/授权/Receipt store 和 bridge handler；不修改旧教育 Receipt 的 `external_send:false` 含义。
- Desktop：`desktop/` 放受管进程入口，`lib/integrations/` 放生命周期与私有传输，`src-tauri/` 放不能由 Agent 冒充的本机确认边界；页面只展示 Core 返回的可执行状态。
- 对外失败使用稳定安全错误码，日志只保留阶段、组件和哈希，不保存 token、完整请求体或敏感响应。示例：

```ts
if (grant.inputHash !== hash(canonicalInput) || grant.idempotencyKey !== key) {
  return { ok: false, code: "external_authorization_stale" };
}
```

## 验证命令与验收

- Core：在隔离数据根运行 `npm test`、`npm run typecheck`、`npm run check:core-runtime-contract` 和 `npm run check:core-runtime-manifest`，并以新 WorkCase 实测确认、并发消费、同 ID 账号替换、取消、崩溃恢复、24 小时重放窗口越界、异键拒绝和 Receipt 重启回读。当前 Core package 没有 `lint` 脚本。
- Desktop：运行 `npm test`、`node_modules/.bin/tsc --noEmit`、`npm run lint`、`npm audit --audit-level=high`、`npm run desktop:prepare`、staged runtime 和 `cargo metadata --locked --no-deps --manifest-path src-tauri/Cargo.toml --format-version 1`。
- 安全负测：Agent 的 shell、全部文件工具、computer-use 和第三方工具不能读 runtime 凭据、连接数据库密钥、可信 UI 凭证或私有传输句柄，不能合成确认、直连 Action POST，或直接篡改 Core WorkCase/授权/Receipt store；重启后还要证明篡改不会被当作真实授权或成功回执。在三平台安装版重新执行，任何一项可绕过即保持 Action 执行关闭。
- 集成验收：凭据隔离门禁通过后，隔离账号完成一次只读和一次写入 Action，教师确认前 runtime 无执行，确认后 Core `pending → succeeded/failed/unknown` 与 runtime 审计一致；失败、取消、重启和网络中断路径均可回读，不自动产生第二次外部效果。只持有幂等键却丢失执行 ID 时如实保留 `unknown`；OAuth 还需独立验证回调代理和拒绝未授权入站。

## 尚待落定

跨平台可信人手确认、凭据加密钥匙的持有者、Agent 全部执行工具的操作系统级隔离方式，以及 OAuth 回调代理尚未验证。它们是启用相应有凭据 Action 的门禁，不以子进程环境过滤、私有管道、普通原生弹窗或“默认关闭”冒充解决。正式 JEV 浏览器执行器与真实付费服务另按 R23 验收。

参考：[OpenConnector headless runtime](https://github.com/oomol-lab/open-connector/blob/main/docs/headless.md)、[runtime API](https://github.com/oomol-lab/open-connector/blob/main/docs/runtime-api.md)、[programmatic connections](https://github.com/oomol-lab/open-connector/blob/main/docs/programmatic-connections.md)。
