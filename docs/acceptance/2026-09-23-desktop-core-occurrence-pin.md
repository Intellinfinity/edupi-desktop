# Core 860594a 与 Desktop occurrence 配对验收

## 范围

- Core merge：`860594a05c5d32617fffdbdf03d56e6ade6dc211`，PR #173；其父级 #172 为 ambient snapshot hotfix。
- Desktop 基线：PR #212 合并 occurrence 配对，PR #215/#216 完成发布前风险修复；最终发布 merge 为 `c492aea8e50b3aadd207be9bae40a34e0412dedc`。
- 环境：macOS arm64，Node.js 22.23.1，隔离临时数据根；未读取或修改真实教师数据，`external_send=false`。

## 结果

| 验收项 | 操作 | 实际结果 |
| --- | --- | --- |
| Core 质量 | `npm test`、`npm run typecheck`、定向 ambient/schedule/bridge 测试、远端 `core-quality` | #172/#173 均通过；runs `35782721446`、`35788428478` |
| Desktop 静态与单元回归 | `npm test`、`node_modules/.bin/tsc --noEmit`、`npm run lint` | 1451 tests，1425 passed / 26 skipped / 0 failed；类型和 lint 通过 |
| source occurrence | `EDUPI_CORE_ROOT=<Core 860594a> npm run test:edupi-schedule-occurrence-e2` | 首次启动即启用 ambient；导入、精确重放、typed projection、改期 hold、same-ref keep-both 拒绝、replace、重启回读通过 |
| source 默认审核 | `EDUPI_CORE_ROOT=<Core 860594a> npm run test:edupi-schedule-conflicts-e2` | ambient 未设置；owner bootstrap、冲突读取、决定、重放、过期拒绝、重启回读与丢失凭据 fail closed 通过 |
| packaged resources | `EDUPI_CORE_ROOT=<Core 860594a> npm run desktop:prepare` | Next standalone、Node runtime 与 2165 个 Core 文件生成成功，Core commit 精确为 `860594a…` |
| staged runtime | `npm run test:staged-desktop-runtime` | Core ready、projection ready、occurrence 1.2、external send 关闭 |
| staged risk workflows | `npm run test:staged-schedule-conflicts-runtime`、`npm run test:staged-feedback-runtime`、`npm run test:staged-schedule-occurrence-runtime` | owner/CAS/重放/错误范围拒绝/反馈回读/occurrence 全流程通过 |
| bundle closure | `EDUPI_CORE_ROOT=<Core 860594a> node --test scripts/packaged-core-bundle.test.mjs` | 3/3 通过；无 `.git`，缺失或篡改依赖拒绝 |
| isolated model host | `EDUPI_CORE_ROOT=<Core 860594a> EDUPI_STAGED_RESOURCES=<resources> node --test scripts/runtime-model-host-files.test.mjs` | 2/2 通过；复制文件均为普通文件，localhost 模型调用成功 |
| mutation overlay continuity | occurrence intake 后执行无关教师资料保存/审核，再检查 mutation 响应 | `occurrenceRef`、`startsAt`、`endsAt`、`timeZone`、`location` 全部保持；随后改期冲突、replace 与重启回读继续通过 |
| 旧 owner key 升级 | 用旧随机 token 创建有效 authorization state，丢弃 token，再启动当前 Desktop Runtime | 默认模式 health ready；owner 调用返回 `owner_control_credential_unavailable`；ambient 显式开启时阻止启动；旧状态字节不变且没有生成替代 key |

## 发布前补强

- 审计发现所有 review/task/memory/delete/restore mutation 的即时响应最初只投影 v1.1 workspace，会暂时丢失 occurrence v1.2 字段。现在统一先验证 Core mutation payload，再从同一 Core/data roots 请求当前 occurrence v1.2 快照并投影；删除/恢复继续传播原请求的取消信号。
- 审计发现 v0.3.33 之前曾启用 ambient 的用户可能已有旧 owner state，但没有持久 Desktop key。当前实现不自动重绑或删除历史授权：默认模式降级为 owner-control unavailable，普通 Core 与教育工作区继续启动；owner 操作 fail closed；ambient 明确开启仍要求有效持久 key。
- 首次 v0.3.34 run `35804036187` 在 source conflict E2 的旧凭据路径暴露错误映射：降级 Runtime 的 `owner_read` 被误报为 `owner_uninitialized` 409。冲突与教师反馈的 owner read 现在也必须走 Desktop `callOwnerControl` 边界；缺 key 统一返回 503 `owner_control_credential_unavailable`。该 run 在上传前取消，空 draft `394218266` 已删除。
- 最终补强后 `npm test` 为 1451 项、1425 passed / 26 skipped / 0 failed；TypeScript、lint、audit、release verify、actionlint、Cargo metadata 与 28 项 Rust tests 通过。source occurrence E2 输出 `mutation_overlay_retained=true`，conflict E2 输出 `lost_credential_rejected=true`；独立 Core `860594a` checkout 的 conflicts/occurrence/ambient/C2/C3/bundle 均通过。

## 状态边界

- 已发布并完成 Linux/Windows 公共安装：v0.3.34 固定 merge `c492aea`，11 项资产、7 个签名 updater 键、DMG 公证/装订和 Linux/Windows 安装启动通过；完整证据见 [v0.3.34 发布验收](2026-09-23-v0.3.34-core-occurrence-release.md)。
- 未验证：PDF/image/ICS 的可信 occurrence 提取；macOS 本机应用内升级、通知点击、睡眠恢复与数据保持；Windows/Linux 旧版应用内升级；六领域真实内容人工核对；正式盲测；真实教师价值。
- 判定：`L4 功能收敛中`，不能写 `L4 established`。
