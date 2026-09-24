# L4 教师价值与漏报反馈通道验收

## 状态

- 结论：合同、隔离 Core 写入/回读和组件浏览器布局通过，已进入公开 v0.3.38；尚未获得真实教师价值或签名安装版表单操作证据。
- 分支：`codex/l4-teacher-feedback-value-20260924`，基于 Desktop `main` merge `97fa5c4`，Core `68004b2`。
- 范围：反馈通道本身；不扩展主动运行授权，不调用模型，不自动外发。

## 已实现

- G1 work-candidate 决定完成后渐进显示价值表单：有用性、实际使用、再次使用意愿、原流程预计分钟、本次投入分钟和说明。时间必须同时填写；0、超过 1440、半对时间和拒绝后声称已使用均在客户端合同层拒绝。
- 写入前继续从 Core 重读当前 target，绑定 revision、fingerprint、领域、scope 和交叉 evidence；不从页面任务字段推断 scope。请求超时、owner credential 不可用或响应不确定时保留同一已绑定 command，教师重试不会生成第二条。
- 管理中心自动运行区域增加默认折叠的“报告漏掉的事项”。六领域共用 Core `missed_opportunity` 合同，绑定当前候选班级/学科；漏报不伪造当前目标，不填写 usefulness、used 或时间字段。

## 证据

- RED/GREEN：新增价值字段与 missed helper 测试先分别因未校验时间和函数不存在失败；新增漏报 UI 测试先因组件不存在失败。最终客户端、Today、Canary、反馈 route 共 23 项定向测试通过；全量 1708 项中 1682 passed / 26 skipped / 0 failed，TypeScript、lint、Cargo metadata 与依赖审计通过。
- 隔离 Core HTTP E2：显式启用 `class-7-1/数学` canary；创建无模型会话并由自然请求生成当前 Goal；`target_read` 返回 `teaching_preparation` 和同一 scope。价值记录首次 `replayed=false`，相同 command 再写 `replayed=true`；回读 `real_teacher_current=1`、`surfaced_useful=1`、`used=1`、`timed_runs=1`、`baseline_minutes=30`、`review_minutes=6`、`time_saved_minutes=24`。
- 同一隔离根的漏报记录首次写入和 exact replay 后仍仅一条；回读 `teacher_reported_missed=1`。停止、服务进程重启和重新建立 canary 后两条记录仍可读；原 Goal 因旧 grant/来源不再当前而转为 historical，30/6/24 不再计入当前汇总，证明陈旧价值不会冒充当前样本。两条测试记录的 note 明确写为隔离验收，不能用于真人指标；结束后 canary 已恢复 disabled，全部 `external_send=false`。
- 组件浏览器验收：桌面宽度与 360 像素 iframe 均显示完整标签；窄宽 `clientWidth=360`、`scrollWidth=360`，无横向溢出。Accessibility tree 包含两个有用性/复用选择器、实际使用 checkbox、两项分钟 stepper、说明、六领域 selector 和唯一漏报提交按钮。
- 生产 Next bundle 与 Core `68004b2` 完整 staged 成功；staged Desktop 为 Core/Projection ready、proactivity disabled、`external_send=false`。staged feedback runtime 通过 owner bootstrap、target recheck、verified scope、wrong-scope rejection、bound replay、surfaced/missed 写入、回读和 synthetic exclusion；只读 OpenConnector staged host 继续拒绝 execute。
- 结构化结果：[教师价值反馈记录](../loop/evidence/2026-09-24-teacher-value-feedback.json)。

## Risk

- `evidence_level=real_teacher` 的工程 E2 仅用于覆盖真实协议分支，运行在隔离根且 note 明确标记；它不构成教师价值样本，路线图和正式门槛不得引用其数值为真人结果。
- 漏报依赖可验证的班级/学科候选；没有稳定 class ID 的数据根不展示表单，避免把随意文本 scope 计入 recall。

## Unverified

- 真实教师连续试用、真实使用/耗时、主动机会 precision/recall 和六领域内容价值仍由用户组织人员验证。
- 公开 v0.3.38 已包含本批。Tauri Next dev WebView 在全新 `.next` 与独立 bundle identifier 下仍出现既有 React interop 失败，故原生开发窗口无结论；macOS/Windows/Linux 签名安装版仍须实际提交评价/漏报并重启回读。
