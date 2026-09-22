# L4 Mechanism Distance

这不是模型质量评分，而是当前闭环距离 L4 验收的工程门审计。`通过`表示已有可重放证据，`部分`表示机制存在但还有边界，`未验证`表示不能用合成结果代替。

| L4 门 | 当前状态 | 证据或缺口 |
| --- | --- | --- |
| 规范事件、稳定身份、上传去重 | 通过 | Core C4 schedule dedupe + Desktop stable schedule IDs；重排上传保持 canonical count |
| Goal/Opportunity、CAS、幂等、lease、重启恢复 | 通过/部分 | C2/C3、Ambient Today、staged bundle recovery 通过；真实睡眠唤醒仍未实测 |
| 安全、权限、来源、删除、`external_send=false` | 通过/部分 | Core six-domain policy 与 Desktop boundary 通过；G5 尚未合并，安装版授权收窄传播仍需实机 |
| 教师审核与反馈闭环 | 部分 | staged feedback 以合成标签完成令牌、target recheck 和回读；G4 Desktop 只在教师主动评价且证据含明确班级/学科时记录价值，真实教师连续反馈尚未发生 |
| 注意力交付与无感行为 | 部分 | delivery receipt、重试、去重、当前状态已可见；系统通知实际显示/点击、睡眠后补跑未验证 |
| 六领域完整消费 | 部分 | G1–G4 已配对；Core G5 PR #166 未合并且 CI billing 阻塞，G6 Desktop 消费仍待做 |
| 安装版连续性 | 部分 | 当前 G4 `.app` bundle 的后台恢复通过；签名、干净安装、升级、Windows/macOS 原生窗口仍未全部通过 |
| 教师价值与正式 L4 指标 | 未验证 | 需要真实教师、held-out 机会、precision/recall、时间节省和安全零事故证据 |

## 距离判断

按机制门计，核心控制系统约已完成四分之三；按“可对外宣称的 L4”计，仍约在一半以下，因为安装版连续性、系统交付和真人价值是硬门，不会被单测或模型自评替代。剩余工作主要是状态机/权限/证据/交付/回滚的验收与补齐，模型只影响产物内容质量和部分路由召回，不是当前最大瓶颈。

## 下一顺序

1. Risk：完成 Desktop 反馈令牌和真实评价边界；Core G5 的未评价决策从价值分母排除，CI billing 恢复前不绕过失败门。
2. Unverified：为 Core 任务投影补权威班级/学科范围，验证 Today 原生评价、失败重试和跨重启回读；再用安装版完成通知显示/点击、托盘、睡眠唤醒、升级与权限收窄后的撤回。
3. L4：Core G5 真实 CI 通过并合并后重新 pin，补 G6 跨领域安全 veto 和六领域 Desktop 消费；冻结正式盲测，再由真实教师完成基线、连续试用和价值核对。

当前结论仍是：`L4 功能收敛中`，不是 `L4 established`。
