# 上传 ICS 日历来源收敛验收

## 状态

- 结论：ICS 上传、精确重放、显式更新、连续修订、撤回、重启回读和 packaged server 已验收通过；整体产品仍为“L4 功能收敛中”。
- Core：[#174](https://github.com/Intellinfinity/edupi/pull/174) 合并为 `897b1b07fc4472f0ee5934adbd13f4bfe59e234b`，[#175](https://github.com/Intellinfinity/edupi/pull/175) 合并为 `a1b8c159afa163eb520fd3d3c37c87846ae88f4c`，[#176](https://github.com/Intellinfinity/edupi/pull/176) 合并为 `b2c2bb809d4c4f8c09af7bc0e2741c025985dd3e`。
- Desktop 交付为 [#222](https://github.com/Intellinfinity/edupi-desktop/pull/222)，实现提交为 `e097865`、`1e4c2c8`、`1402691`、`ee71640`；最终 Core pin 为 `b2c2bb809d4c4f8c09af7bc0e2741c025985dd3e`，Desktop/Runtime component hash 分别为 `sha256:9c1b834004842b76a49f4f52c5272daae28a976709e0d8396ce850c6a25f6da0` 与 `sha256:34ae1d53d166af1a6535a93dd208dfef2bd01ce5e4c560492de2ab35a7b53ede`。
- 环境：macOS 26.5.1、Node.js 22.23.1；所有写入均使用隔离临时数据根，未切换真实教师数据根、launchd 或安装版。

## 实际行为

| 流程 | 预期 | 实际 |
| --- | --- | --- |
| 首次上传 | 严格验证 ICS，确定性解析 UID、时区、时段、地点并保存原始证据 | 通过；不调用模型，Core 保存原始 `.ics`，`external_send=false` |
| 精确重放 | 同字节改名上传不新增 occurrence 或 evidence artifact | 通过 |
| 显式更新 | 用户选择既有来源；full snapshot 撤回普通遗漏项，REQUEST/PUBLISH 仅撤回 EXDATE 或 STATUS:CANCELLED | 通过；页面显示“更新可能撤回该来源的旧安排，请确认来源”，成功结果报告实际撤回数 |
| 连续修订 | `A,B → B,C → C,D`，旧 tombstone 不污染后续来源指纹 | 通过；最终只投影 `C,D`，两次撤回各绑定对应 ICS evidence |
| 循环修订 | EXDATE、standalone RECURRENCE-ID CANCEL、整组 CANCEL 和系列改时使用同一碰撞安全身份族 | 通过；支持 recurring↔single、系列改时、单次/整组撤回；其他 UID 保持，首次 EXDATE 不误报未知撤回 |
| 混合来源 | 手工 occurrence 与 uploaded calendar source 同时存在 | 通过；手工 issuer 不进入上传来源列表，错误或混合 `calendar-source-*` 仍 fail closed |
| 并发与漂移 | 无关 ambient 状态不阻塞；同源漂移、混源 target、旧文件回滚和并发恢复必须拒绝 | 通过；取消重放绑定 source+evidence、batch request、active tombstone 和未截断 history；最终 source→ledger 复核封闭恢复竞态 |
| 重启 | 关闭并重启 Runtime/packaged server 后保持相同当前日历 | 通过 |
| UI | 材料页可见 staged ICS、新建/更新来源、警示和单一确认动作 | 通过；首次导入和更新均返回成功，浏览器 console error/warn 为 0 |

## 验证证据

- Core：`npm test`、`npm run test:schedule-upload-dedupe`、`node --disable-warning=ExperimentalWarning scripts/test_entity_delete_store.mjs`、`npm run test:core-runtime-writer-c3`、`npm run check:core-runtime-manifest` 通过；#174/#175/#176 `core-quality` 分别通过，#176 run `35820672560` 用时 6 分 58 秒。
- Desktop：`npm test` 共 1509 项，1483 passed / 26 skipped / 0 failed；`node_modules/.bin/tsc --noEmit`、`npm run lint`、`npm audit --omit=dev`（0 vulnerabilities）和 `actionlint .github/workflows/release.yml` 通过。
- 配对源码：`npm run test:edupi-uploaded-calendar-e2` 通过，包含确定性解析、精确重放、两次连续 full-snapshot 更新、EXDATE 首导/更新、单次/整组 CANCEL、系列改时、整组撤回丢响应重试、同来源其他 UID 保持、手工 occurrence 共存、删除传播和 Runtime 重启。
- 打包资源：`npm run desktop:prepare` 写入 Core `b2c2bb8`；staged uploaded-calendar、schedule occurrence、schedule conflict、teacher feedback、desktop runtime 全部通过。
- 打包闭包：`packaged-core-bundle.test.mjs` 3/3、`runtime-model-host-files.test.mjs` 2/2 通过；staged status 回读 Core/projection ready、occurrence contract 1.2、`externalSend=false`。
- 页面操作：隔离 packaged 页面实际上传 `校历.ics` 与修订文件；首次确认导入 1 项，选择“更新 教研会”后显示“更新可能撤回该来源的旧安排，请确认来源。”，无冲突替换真实完成“导入 1 项日程，撤回 1 项旧安排”，console error/warn 为 0。临时测试根已移入废纸篓，可恢复，不含真实教师数据。

## 安全边界

- ICS 最大 1 MiB、最多 200 个 occurrence；浮动时间、未知时区、DST gap/fold、跨日 timed event、无限或高频 recurrence、RDATE/DURATION/EXRULE、`THISANDFUTURE` 和损坏输入均 fail closed。
- 全日 `DTEND` 按 RFC 5545 exclusive 解释并转换为 Core inclusive `end_date`；全日 recurrence 当前 fail closed。
- METHOD:REQUEST/PUBLISH 是增量 upsert，普通 omission 不删除；只有 EXDATE/STATUS:CANCELLED 产生精确撤回。无 METHOD 的 full snapshot 才按来源撤回普通 omission。
- 循环 occurrence 使用 `ics-series:<UID SHA-256>#<UTC recurrence instant>`；保留命名空间不能由原始 UID 伪造。整组取消的精确重放只在 source+evidence hash、batch request、完整未截断 history 和全部 active tombstone 同时成立时作为 no-op。
- Desktop 不保存第二套日历业务基线；来源、occurrence、证据、tombstone 和反馈均由 Core 投影。
- 当前内容 revision 替换 current evidence；只有完全相同内容的副本才合并可互换 evidence。删除旧 evidence 不支撑新内容，删除当前 evidence 会隐藏当前事项。
- 默认仍不外发；点击、导入或生成草稿不等于教师接受、正式 Fact 或对外发送。

## Risk

- 本批最终独立复审未发现剩余 ICS P0/P1/P2；复审覆盖 source CAS、错源/混源拒绝、系列身份、history 截断、active tombstone、恢复竞态、current evidence、连续 tombstone 和 packaged pin。
- 更新既有来源可能产生撤回，页面在确认前提示核对来源；实际规则区分 full snapshot 与 delta，撤回仍进入 Core 可恢复 tombstone，不直接物理删除原始证据。

## Unverified

- PDF、图片和 Word 的模型识别仍没有可信 UID/RECURRENCE-ID、时区/地点 occurrence 身份和同来源遗漏撤回合同；现有近似语义去重不能记为“所有上传行程已闭环”。
- 扫描 PDF 超过三页会安全拒绝；Windows 安装包尚未携带并实测 `pdftotext`、`pdfinfo`、`pdftoppm`，legacy `.doc` 仍依赖 macOS `textutil`。
- ICS packaged 功能已在 macOS staged server 验证；Windows 安装版内的 ICS 实际解析、旧版升级、通知点击、真实睡眠补跑和数据保持未验证。
- 正式 60 故事/360 时间点盲测、模型语义评估以及真实教师 5 日基线、至少 10 日试用和不少于 20 个机会未开始；合成结果不代填这些门。
