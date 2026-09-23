# L4 课表材料来源别名验收

状态：Desktop 源码与 macOS staged server 验收通过；正式安装包与真实老师材料未验收。Core 固定为合并提交 `68004b2c0294159eef4f88bcbf4a921ef6978037`，公开 Latest 仍为 v0.3.36，未包含本次 Desktop 改动。

## 合同与边界

- Core [#182](https://github.com/Intellinfinity/edupi/pull/182) 只给权威课表行投影可选的 `source_ids`、`evidence_ids`，不为旧行虚构来源；修复两份材料共用逻辑来源时的删除可见性，并要求被部分删除的共享来源在当前行、任务或能力引用上有可验证的活证据。Core [#184](https://github.com/Intellinfinity/edupi/pull/184) 修复全部重复及部分重复加新增的课表命令重放；完整命令指纹不同时仍返回 `source_conflict`。
- Desktop 仅在当前材料 target、当前课表 import target、同一 hash 的 schedule evidence、逐项课表内容与唯一来源全都吻合时自动复用来源。历史证据残留、材料已删除、遗漏同源项、教师更正或多来源均不能自动绑定。
- 教师可从当前 Core 课表投影选择来源；选项使用当前行指纹，且新材料须与所选来源有可核对的班级/课程锚点。若另一个来源同样匹配则拒绝归属；保留原有课次并新增课次可以作为增量交给 Core。旧版 `desktop-file-schedule-*` 可用于纯课表重放，不把新增日程写进该旧 ID。
- 纯课表自动或显式绑定与第一条 Core 写入使用同一快照 CAS，来源证明后发生并发删除会在材料/课表写入前失败。日历与课表来源分别读取、各自 8 秒截止；课表读取失败或悬挂时文档接入禁用，但可用的日历来源不受阻。用户可显式重试，不会把更新意图静默降为新来源。

## 实际证据

| 环境与操作 | 预期 | 实际与证据位置 |
| --- | --- | --- |
| macOS Apple Silicon、隔离数据、合并 Core `68004b2`；`EDUPI_CORE_ROOT=/tmp/edupi-core-slot-v3HIe7 npm run test:edupi-slot-alias-e2` | 相同材料复用逻辑来源，增量不造重复行，删除旧证据后保留有效课表，并发变化拒写 | 首份导入、第二份显式绑定与自动重放、第三份保留一节并新增一节及再次重放均成功；最终只有 2 个权威槽位。删除旧材料后 2 个槽位仍可见；旧材料重传被拒；证明后删除课表再提交返回 `stale_snapshot`，`external_send=false`。脚本：`scripts/test-edupi-slot-alias-e2.mjs`。 |
| macOS staged bundle；`npm run desktop:prepare`、`npm run test:staged-desktop-runtime` | 打包 Node/Core 与 WebView 服务遵守同一 pin，新 API 可读取 | 打包 Core `68004b2`、投影与 Kernel ready、`externalSend=false`；`/api/edupi/timetable-sources` 返回 200、`Cache-Control: no-store`，仅包含安全来源选项。打包 DOCX 与离线 OCR smoke 同批通过。 |
| 隔离 staged server、Chrome 独立配置、800×900；页面上传合成 PDF/ICS，模拟课表 API 503 与永久悬挂 | PDF 禁提交并可重试；日历来源可独立可用；无整页横向溢出 | 正常时下拉包含当前日历和课表来源；ICS 实际导入 1 项。503 时 PDF 确认禁用、日历确认可用；悬挂时日历来源先出现，8 秒后 PDF 显示重试，日历表单不误显课表错误。两种路径 `scrollWidth=800`、page error 0；可复查 [800px 选源截图](./assets/2026-09-24-slot-source-selected-800.png) 和 [800px 故障截图](./assets/2026-09-24-slot-source-503-800.png)。测试只写隔离数据，未写入真实教师档案。 |

同一 Desktop 源码和 Core pin 的 `npm test` 为 1637 项中 1611 passed、26 skipped、0 failed；`tsc --noEmit`、`npm run lint`、`npm audit --audit-level=high`（0 vulnerabilities）、`cargo metadata --locked`、`cargo test --locked`（28 passed）、`git diff --check` 均通过。Core #184 的本地全量 `npm test` 与 GitHub Core Quality run `35918598114` 均通过。打包过程仍报告既有的 session HTML export 动态依赖 warning，本次未修改该模块，不将 warning 记成无警告构建。

## 尚未验收

- 正式签名 macOS 安装包、Windows/Linux 安装和旧版应用内升级未执行；staged server 不等于安装版。
- 真实教师 PDF/DOCX、真实模型课表识别质量、课表冲突的教师最终决议与六领域教学内容人工核对未完成；不能据此标记整体 L4 通过。
- 来源 API 的故障注入使用隔离浏览器路由拦截；真实学校网络抖动和并发教师设备仍需另行验收。手机离开局域网的服务器接入仍按路线图放最后。
