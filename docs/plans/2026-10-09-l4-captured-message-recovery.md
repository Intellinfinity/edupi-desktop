# L4 已捕获消息恢复实施计划

状态：R21.1/R21.2 本地实现与隔离验收通过，R21.3 待 Draft/CI；归属现有 R21/L4 任务账本。基线为 Core Draft #256 `a1f28c2` 与 Desktop Draft #328 `5e5cafd9`，实现提交 `87546fbb`。本计划不改变六领域、安装、盲测和教师价值的验收状态。

## 目标与选择

Core 已经持久捕获 owner message，但 Desktop 在收到后续 Goal 结果前退出时，当前只读 Goal 证明为空，整条消息保持待核验。`captured` 不能等同于 Goal 已完成；空 Goal 也不能证明以后不会执行。

- 仅凭 `captured` 清原生 outbox：延迟最低，但会把尚未处理的请求误记为完成，拒绝。
- 继续永久阻断：安全，但日常提问和引用也会妨碍后续无感使用，只保留为证据不足时的兜底。
- **本轮选择**：Core 当前实例的精确 `owner_message_settle=captured` 回执，加同一来源的 `owner_intent_read` 当前、内在不可执行意图证明；首版只认 `question`/`quote` 与相应 abstain 原因。Core 可执行请求、撤权/过期、空读或字段不符仍为 unknown。此做法不增加模型、调度器或 Core schema。

## 本轮合同

1. Desktop 仅对已有 v2/v3 计划中 `unknown` 的精确领域执行核验。复用当前 health 的 root、fencing generation 和 instance nonce；校验 capture receipt 的 root/owner/grant/version/source/message/revision、时间及所有不执行/不外发位。
2. 正向捕获后读取 `owner_intent_read`，要求同一 message ref、`status=current`、`action=abstain`、`candidate.evidence_ids=[message_ref]`、固定 policy version、`interpretation=question|quote` 与对应 reason。任何可执行/模糊/动态 held 路由均不得成为负工作证明。这里证明的是当前规则下不需自动行动，不是证明旧 Core 请求从未写入。
3. 单次私有账本原子写入把该领域记为已捕获且无自动工作；若后续领域尚未开始，将其标为 `unavailable` 并保留整条消息待核对但不硬挡新消息。只有所有领域都有真实完成或精确证明时，才能清原生 outbox；重复 POST 不能把无 Goal 说成 Goal 已应用。
4. 旧 Core、错误根、换 owner/grant、来源修订、撤权、超时、重复请求、跨域同 ID、进程重启、账本满额和回退解析失败均保持 fail-closed。测试使用隔离根，不调用付费模型或外发。

## 实施与证据步骤

### R21.1 精确证明

- 文件：`lib/edupi-ambient-message-recovery.ts`、`lib/edupi-ambient-message-recovery.test.mjs`。
- 先加 RED 测试：真实形状的 Core captured 回执加 question/quote 当前候选可结清；伪造 root、nonce、grant、ref、reason、evidence、政策或执行位不能结清；ready/held 仍 unknown。
- 再在已有 `owner_message_settle` 消费函数旁最小扩展，不重新实现 Core 分类。运行 `node --test lib/edupi-ambient-message-recovery.test.mjs`，预期先失败后通过。

### R21.2 持久计划与 API

- 文件：`lib/edupi-ambient-message-ledger.ts`、对应测试、`app/api/edupi/proactivity/messages/route.ts` 与该路由的隔离 VM 测试。
- 先用磁盘账本测试证明捕获但无动作的单域/多域原子状态、冷读、重复 POST、非阻塞未处理领域和删除前仍可撤回该真实来源。再将核验接入 `GET ?verify=1`，正向 Goal 证明优先，只有 Goal 未证实时才尝试内在不可执行证明。
- 完成后执行针对性 Node、`tsc --noEmit`、lint、全套 `npm test`；同一源码与 Core #256 的 loopback daemon 做失联→重启→核验、无第二次 Goal/模型/外发的可重放证据。

### R21.3 固定 handoff

- 更新 `docs/acceptance/2026-10-08-desktop-six-domain-route-source.md` 的代码身份、命令、预期/实际、未验证条件；独立复审差异与风险，推送叠在 #328 的 Draft PR。
- 正式 Core/Desktop CI、Windows 和签名安装仍由现有发布门控制。GitHub Actions 当前在 runner 启动前因账单状态失败，不把本机通过升级为 CI 通过。

## 后续顺序

1. Core-owned 可执行意图续接：已捕获但 route ready 且无 Goal 时，使用同一 Core durable 权威和原队列恢复，证明晚到/重复 apply 不造成第二个 Goal；不能用 Desktop 重发正文替代。
2. 首次消息的预登记：在 Pi 发送前由 Core 持久登记每个计划来源与 producer epoch，使从未到达 Core 的消息也能获得受审 `sealed_absent`；不能把当前空查询当负证明。
3. 在上述工程门和三平台安装/回滚通过后，再进行六域内容语义、正式盲测与教师价值验收。此前保持“L4 功能收敛中”。
