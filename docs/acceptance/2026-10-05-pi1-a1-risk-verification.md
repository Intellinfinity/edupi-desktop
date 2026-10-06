# Pi 1 与暂缓草稿风险验收

最新状态：`.56`已按用户明确授权完成三平台构建并正式发布，公开更新源为`.56`、七个平台键。高危门为0，余6低/3中仍记录；Core仍`a84590c`。完整安装、真实睡眠、真人质量和六领域Live验收后置，不能据此计路线1全部通过。下方Mac-only候选及不发布的段落是历史状态。

## 2026-10-07 v0.3.56 三平台正式发布

- 用户明确选择“补齐三平台构建并发布，安装验收仍后置”，取代此前Windows构建延期和不发布的对应范围。没有改真实教师根、模型凭据、launchd或正式安装；Core #223/Durable独立配对、Univer和远程手机仍保持原范围。
- 原发布门要求同一次三平台成功，因此在精确源码`6d8e696995040a2dd0191f178460dae5b24f7d99`上执行一次全平台构建；tag`v0.3.56`已精确固定该源码。首次dispatch返回HTTP500且没有生成run，核对后仅重试一次。[构建37521682413](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37521682413)三平台、draft-proof均成功；Windows/Linux桌面壳测试通过，macOS公证Accepted、App/DMG装订、严格签名和Gatekeeper通过。Windows的包内身份检查不替代正式根启动验收。
- 资产指纹`sha256:cf3594cc12877aee7928c44588b2828e04787953a79318ac28d5f332064f2d0f`由原验证脚本计算并回验。该字段表示本次用户授权发布的资产身份，**不表示安装验收已完成**；原发布脚本和签名/摘要/三平台检查没有削弱。
- 原Mac-only三个远端Draft资产在本机完整备份并核对ID/名称/大小/SHA后移出，避免旧时间戳混入全平台证明。原DMG、archive/sig及删除前快照保留在`~/edupi-install-checkpoints/v0.3.56`与新发布检查点，可恢复；不覆盖旧本机文件，不沿用旧资产ID或摘要。
- 新DMG asset`616584630`，209186885字节，SHA256`c8c7bee8239f99b02613c905355350f2abd382c5b25d58d3bd533fc47951519a`；archive/sig为`616570895`/`616571202`，摘要分别`5b05d7c701583911ffd6ba9d52d735630021fffeb309b0a14ab1124c4e41fef6`/`f122db6f8bd74a8306da977a8be735c35e285e4a2e78db2d4b476dc8f405bb74`。九个完整下载均与GitHub摘要及长度匹配。
- 本机从正式`.45`可执行文件只读提取公开更新公钥，以离线缓存的minisign-verify0.2.5核验四种updater格式，正常签名全部通过，一字节内存篡改全部被拒绝。新DMG本机codesign和Gatekeeper均通过，source=Notarized Developer ID。没有安装或修改认证文件。
- [发布37527490223](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37527490223)成功；[Release](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.56)为Latest、非Draft、非prerelease，UTC2026-10-06T20:35:37Z发布，共11资产。公开Raw普通URL不加缓存参数即返回`.56`、七键；四种API资产端点不带token返回206及正确gzip/ELF/ar/MZ二进制前缀。
- 更新说明旧“Mac-only、不更新feed”文本已校正；仅改变manifest的notes字段，九项签名资产、URL、签名、版本和日期均不变。Release的派生latest.json原文留作恢复记录，feed修订为`239c19d68054c334d06e47542630d7b73b81c521`。教师降级仍须保留新数据并恢复升级前完整备份，不能删除审核字段强行兼容。
- 原生工具本轮实际返回锁屏，未绕过、未重复要求解锁，也未点击安装。唯一`/Applications/EduPi.app`回读仍`.45`、PID45102；客户端界面检测提示与实际升级未验，公开源与匿名二进制探针不替代它们。G2/G3/G4及外发不因发布自动启用，G5关系、未核实材料和课次归属不计已验证。
- 可恢复证据在`~/edupi-install-checkpoints/v0.3.56-publish/RESUME.md`和`evidence`：全量build/publish日志、draft-run/jobs/assets、download-signature-checks、publication-authorization、published-release、public-verification、notes-correction。编译用Actions机器，本机执行离线验签及一次性发布脚本；没有新增模型驱动子任务。

## 2026-10-07 v0.3.56 MCP 补丁与构建

- `.55`最终文档push警告触发复核，npm审计和GitHub alert31共同确认新高危[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)。来源仅为OpenConnector1.6.5的client2.1.0，EduPi Core依赖/清单不含该包。官方修复最低2.2.0；npm初次浮动解析2.3.1后收敛为OpenConnector scoped override精确2.2.0，其私有core同为2.2.0，server/rootcore2.1.0未受该公告影响并保持。
- 独立只读复审确认MCP工厂仅传HTTP/SSE fetch/headers/redirect/signal，不使用SDK authProvider/withOAuth/内置provider或SDK凭据schema；自有OAuth使用目录token URL和manual redirect。目录/Console受限GET、临时数据根与Action/Proxy禁用，不能据此推断历史连接一定无泄露，但本轮无需清空用户连接或迁移issuer。没有访问真实凭据、发出真实MCP调用或改Core pin。
- 安全组7/7含真实withMcpClient内存HTTP现代server/discover/tools/call，最终全量1983 pass、27 skipped、0 fail，类型/lint/高危审计/42发布检查/locked metadata/组件pin通过。最初测试夹具路径和现代协议字段不完整导致失败，按已安装SDK真实schema修正后通过，未改生产协议或降低验证。PR [#312](https://github.com/Intellinfinity/edupi-desktop/pull/312)源码`6d8e696995040a2dd0191f178460dae5b24f7d99`的CI`37509377920`双绿，合并为`1400ede8a842957879d3867dfc167e630739be59`。
- `.56` [macOS-only CI37509562059](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37509562059)成功：1982 pass、28 skipped、0 fail，Core配对、打包真实服务、OCR/DOCX/OpenConnector目录/Mac集成、签名后运行/updater公钥及App/DMG公证装订、strict签名/Gatekeeper通过，Apple状态Accepted。Windows未构建，Cargo Test desktop shell步骤未执行，不冒充通过。
- Draft`405013321`固定原始源码`6d8e696`，最终DMG asset`616378660`，209185115字节、SHA256`e3cb98da3fceca9021d3b8317ac7bababef01a7bb6e55254f67c5a3b1c19fd02`。首轮10个分片均完成，拼接后本机摘要匹配。App archive/sig资产`616365839`/`616366141`远端摘要`1ce2ad41b5ac4b2f08bd5ba1d8247490a9a266d459cf3110f8abba5fe6245785`/`5e168836189b11885ca9a7a27ae42690acf8ce350dec6edc36d027d1494fcca3`，本机updater安装验签仍未做。
- 本机DMG/App签名与Gatekeeper均accepted，source=Notarized Developer ID，签名团队与`.45`一致。只读挂载核对版本`.56`、bundled Core`a84590c`、SDK1.0.2、组件/文件闭包及MCPclient/core2.2.0、sharp0.35.5、source-map-js1.2.2。核验脚本最初误读server依赖路径报ENOENT，实际MCP位于独立OpenConnector资源；改为真实路径后严格版本断言通过，非包内缺依赖。镜像已卸载，候选未启动，唯一正式安装仍`.45`。
- 原始证据在`~/edupi-install-checkpoints/v0.3.56/evidence`的`run.json`、`release.json`、`build-success.log`、`download.log`、`candidate-identity-final.json`、`final-audit.log`；DMG在同目录上一层。状态监听曾TLS/EOF退出，但实际run继续，恢复查询后只跟进同一候选。最终高危门通过，6低/3中保留；本机stapler旧TLS、安装交互、真实睡眠/质量/六领域Live、其他平台仍未验，不发布Release/feed或改真实根/凭据/launchd。`.54`/`.55`检查点不覆盖。

2026-10-07已按用户要求完成`.55` macOS签名候选构建，固定源码`d3107c4`与Core`a84590c`。CI公证/装订、App/DMG签名/Gatekeeper及本机完整资产摘要与包内身份通过；构建不替代安装/真人验收，详见[签名更新记录](../plans/2026-09-07-signed-updates.md#2026-10-07-v0355-macos-候选)。

前三项任务呈现整合已通过源码与隔离开发页验收，功能提交为 `6868648c8dc5180513ee83f3d151e568ab3210b1`，包含 `e2bb44a` 的 sharp 补丁。新UI与补丁已进入`.55`候选，未进入既有 `.54` 包；安装版和公开发布继续分别记录。

## 2026-10-07 v0.3.55 构建核验

- 版本PR #310/source CI37498670567成功并合并；macOS-only签名CI37498750385固定源码`d3107c4`、Core`a84590c`、Pi/PiDurable1.0.2。质量门1981 pass、28 skipped、0 fail；Core配对、打包运行、离线OCR、DOCX、OpenConnector目录与Mac集成通过。Windows未构建，Test desktop shell步骤未运行，不计为Cargo测试通过。
- App构建签名及包内真实服务运行、updater公钥检查通过；DMG公证为Accepted，App/DMG装订与最终签名、Gatekeeper均通过。Draft`404950486`保留3项资产，不执行draft-proof/manifest/notify发布步骤，不更改公开feed。
- DMG asset`616184804`，209005219字节、SHA256`9fdd3e46d8bc3ad49533eb7d0744e9d76facbfbc119643a9523f740b11bf077a`。首次下载有9个完整分片和1个未完成分片，保留原件；只补缺失片后全量摘要匹配，不把部分文件当通过。App archive asset`616172355`、sig`616172716`的远端摘要分别为`aca612c4868b4c340ee074f2b02c3e415bc7d050edad567a932828fea6d7fb67`、`0c87d96f3c42c99d8fbaf477ed371759b4b5805e7234c2751ddef2541aff3f4a`；本机updater安装验签另列未验。
- 本机DMG签名与Gatekeeper accepted，只读无Finder挂载后App strict/deep codesign与Gatekeeper accepted，source均为Notarized Developer ID；签名团队与公开`.45`一致。包内版本`.55`、bundled Core`a84590c`、SDK1.0.2、Desktop组件清单与完整文件闭包核对通过，sharp0.35.5和source-map-js1.2.2确实随包。未启动候选App，核验后已卸载镜像，唯一正式App版本仍`.45`。
- 证据位于`~/edupi-install-checkpoints/v0.3.55/evidence`：`run.json`、`release.json`、`build-success.log`、`download.log`、`download-resume.log`、`candidate-identity-final.json`及只读挂载记录。下载文件为同目录上一层`EduPi_0.3.55_aarch64.dmg`。状态查询通过7897曾TLS超时，改为只读直连后同一run继续，不触发重复候选。
- 本机stapler旧CloudKit TLS边界仍未解决，此轮未重复联网验证。6低危/3中危依赖问题保留；新UI安装、任务分叉/真实扩展过滤安装补验、真实睡眠、真人质量、六领域Live和其他平台未据此通过。正式数据根/凭据/launchd/安装与公开Release/feed未改，`.54`检查点保持。

状态：`.54` macOS签名构建成功，DMG完整摘要、App/DMG严格签名与本机Gatekeeper、包内Core身份均核验通过；用户“先构建”的交付已完成。正式安装仍为 `.45`，`.54`安装交互另行待验。`.52`既有安装证据保持，真实睡眠、真人质量及公开更新门仍欠证。本机stapler联网复核边界单列。本文补充原R01/R20/R22，不替代发布门。

## 2026-10-06 任务卡右栏与真实文件

- 对应原R01/R02/R04/R18/R20，沿用当前分支和账本。源码基线 `7975253`，最终功能提交 `6868648`；Core精确 `a84590cbd62ada4f75fa10e109f0cdc07a13368e`、Pi/PiDurable1.0.2、两份组件清单与schema不变。未复制ZCode代码，未新增调度器、任务数据库、阶段百分比或子Agent计数。
- 交付：[Desktop #308](https://github.com/Intellinfinity/edupi-desktop/pull/308) 的 [CI 37487513876](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37487513876) 绑定精确源码 `6868648`，audit与rust-audit均成功；2026-10-06 UTC15:33:22已合并为 `c4bde1545553d774b5f139a603e589fa7d7738e6`。安装版与发布状态仍独立未验。

| 验收条件 | 操作与预期 | 实际结果 |
| --- | --- | --- |
| 任务身份 | 从已绑定会话打开卡片；切另一任务/新对话不保留旧详情 | 两任务根 `~/edupi-route1-canary-llGmUw` 中卡片仅按Core Session绑定显示；第二任务切入后旧详情0，新对话卡片/详情均0；返回第一会话草稿保留 |
| 键盘与布局 | Enter/Space打开，Tab/Escape关闭及恢复焦点；1440×900和800×900 | 宽窗为complementary右栏，聊天可继续输入、聊天中的Escape不关闭右栏；窄窗为dialog且Tab循环，关闭返回卡片；实测无横向溢出 |
| 实际文件 | 计划名称不算文件；任务页、详情与预览打开同一对象 | 空任务为0文件并独立列计划；新Core夹具生成检测卷/参考答案2文件，任务页和右栏一致，正文预览确实读到题目 |
| 文件往返与保稿 | 任务内聊天→卡片→文件→返回→关闭 | 路由保留Session，聊天保持单一实例；文件在同一侧栏位置打开，返回原任务，未发送要求全文保留 |
| 审核与只读 | 右栏审核入口进入原审核流程并暂缓，另一个入口回读 | 只写回指定任务；审核历史1，卡片“已暂缓”，2文件仍可打开且显示只读，编辑/AI修订按钮不出现，历史版本1可见 |
| 断连和重载 | 阻断工作区请求→重载→重试→返回聊天 | 页面显示“教育工作区暂不可用，请重试”，未显示假空列表；取消浏览器阻断后重试成功，任务、2文件、暂缓意见和未发送要求保持 |

- 文件夹具复用现有 `test-edupi-teacher-created-preparation-e2.mjs` 的公开Core/受控G1流程，保留在 `~/edupi-task-surface-nrvf0F/fixture-6RV7Ng/teacher-data`。唯一任务 `teacher-task-22222222-2222-4222-8222-222222222222`，703/数学，课次2026-10-07、截止2026-10-06；合成材料的人工确认摘录不计PDF识别或真人教学证据。G1仅该范围，G2/G3/G4关闭、外发false；1次备课调用、execution attempt=1、2份文件，创建/运行重放未重做。页面只发送1次本机合成聊天，Session为 `01a111b8-6060-747e-9c23-d9501954a507`，审核暂缓1次。生成由测试脚本准备，续聊、文件打开/返回、审核和重载由Codex浏览器实际操作；不称为安装版生成验收。
- 保留失败：旧隔离根 `~/edupi-route1-canary-s8QOeo` 的Runtime返回 `runtime_root_invalid`，只读核对当前根指纹与writer-admission持久指纹不一致；没有改写指纹、删除数据库或修补历史证据。新夹具首次准备的Core snapshot超时也保留，第二个独立新根按原门验证成功。初次页面沿用了另一隔离项目选择，出现project trust拒绝；任务入口选入正确合成根后续聊成功，未放宽文件允许根。
- 回归：新增当前Session/跨任务、真实文件去重/路径与权限、键盘模式/焦点、教师较新看板操作和网络失败后重试的行为验证。看板时序回归先失败、修复后通过；最后定向39/39。首次全量1976 pass、3 fail、27 skipped，其中2个旧结构哨兵按新共享组件更新，另1个进程测试在高负载下先超时、独立重跑通过。UI收口全量1981 pass、0 fail、27 skipped；sharp补丁后最终 `npm test -- --test-concurrency=4` 为1982 pass、0 fail、27 skipped，跳过项不计验收。TypeScript、lint和diff通过；保留原intake未使用导入warning。
- 依赖门：最终审计新披露 [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)，sharp0.35.4使高危门失败。`npm update sharp --ignore-scripts` 只更新sharp家族27个锁条目，sharp0.35.5/libvips1.3.4；本机librsvg2.63.2，实际小SVG→PNG→RGBA与像素检验通过，安全依赖组6/6。安装尚在写入时过早运行检查曾读到不完整库，完整安装后该问题消失；新版不导出package.json导致的测试入口错误已改用公开 `sharp.versions`。最终审计高危/严重为0，剩6低危、3中危，不执行force或相关Dependabot PR。页面证据在补丁前取得，UI源码未再改变；补丁后单独验证原生图像行为和全套检查。
- 原始证据在 `~/edupi-task-surface-nrvf0F`：`after-held-workspace.json`、`final-wide-state.json`、`held-details-1440.jpg`、`held-file-narrow.jpg`、`read-failure-chinese.jpg`、`final-recovered.jpg`、`post-sharp-full-tests.log`。辅助夹具与恢复入口同目录保留。全轮服务/模型已退出，浏览器网络阻断和viewport覆盖已撤销；正式App只读版本回查为 `.45`，未启动或替换，不改真实教师数据根、凭据或launchd。
- 未验：本批安装交互、各平台图片原生库及完整Office格式、失败/取消后的安装版恢复、真实睡眠、真人质量和六领域Live。Core #223/Durable独立适配、Windows、Univer、远程手机和公开更新保持原边界。既有 `.54` Draft的签名身份不因源代码补丁改变，本轮不触发构建、发布或feed更新；R01–R23整体不能据此勾为完成。

## 2026-10-06 v0.3.54 签名包交付

- 代码 `c861347625be8ec477a8aa8f82790204a5eff845`，Core `a84590c`、Pi/PiDurable1.0.2。PR [#305](https://github.com/Intellinfinity/edupi-desktop/pull/305) 经CI `37408183426` 质量/Rust审计通过，合并为 `414716b4f0c1ef1ab8b18094ec4de5c58ff909f6`。本批只更新source-map-js安全补丁和版本元数据。
- macOS-only [run 37408179317](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37408179317) 成功；质量门1953 pass、28 skipped、0 fail，Core配对、打包服务、OCR/DOCX/OpenConnector、macOS资源及签名后运行验证通过。App与DMG公证、装订、stapler、严格签名、Gatekeeper核验成功；DMG的Apple结果为Accepted。本次没有Windows/Linux构建，不能据此计三平台发布门通过。
- Draft Release `404276650` 绑定精确代码。最终DMG asset `614416762`，208962272字节，SHA-256 `50139f5e0f42cb405d6372d4adbc708c65430f0946f9a8e8e91b77128df619b8`。App archive/sig为 `614406612` / `614406786`，远端摘要分别为 `d76d786d3de740ce6d889818fda021cdb24488b2228a9510f717357a9fa81993` / `32a4ba3800a54b4dc761e5558d47461ae92f99a1bb2e94d7d248cb7ac91e6a17`；后两项未执行本机updater安装验签。
- 代理单流与直连单流下载均曾超时，保留部分文件。复用分段下载脚本，逐段验证Content-Range和长度后拼接，最终完整SHA-256精确匹配。可交付文件为 `~/edupi-install-checkpoints/v0.3.54/EduPi_0.3.54_aarch64.dmg`，没有把中间文件当作安装包。
- 只读、无Finder浏览地挂载后，App `codesign --verify --deep --strict`、DMG签名，以及两者`spctl --assess`均通过，source均为Notarized Developer ID。包内版本`.54`、Core `a84590c`、双清单/文件闭包与固定合同核对通过。没有启动挂载App，检查后已卸载镜像，正式`/Applications/EduPi.app`回读仍`.45`。
- 原始构建日志与本机身份记录保留在持久检查点 `evidence/build-success.log` 和 `evidence/candidate-identity.json`；分段原件亦保留。本机先前CloudKit TLS导致的stapler问题未重复运行，不把CI同资产装订验证误称本机stapler已通过。
- “先构建”已完成，构建心跳暂停。`.54`真实安装、分叉修复与扩展/技能过滤交互、真实睡眠、真人价值、Core #223独立适配及公开更新仍待各自验证；Release保持Draft，feed不更新。6低危/3中危依赖项仍按上一节记录，不宣称零漏洞。

## 2026-10-06 恢复构建与依赖修复

- 用户明确要求“先构建吧”，本次重新授权后对同一 `.53` run进行attempt3。macOS job `112080499229` 实际获得runner并执行依赖安装，1953测试通过、28跳过、0失败，TypeScript/lint通过。北京时间10:40，`npm audit --audit-level=high` 报1项高危而失败，尚未进入签名或公证；这次失败原因与前两次runner容量不足不同。
- 高危为 [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)：source-map-js的indexed source map行偏移未限制，可能阻塞事件循环。官方首个修复版本1.2.2。`npm update source-map-js --ignore-scripts` 只更新锁文件对应版本、tarball和完整性摘要三行；Next/Tailwind/PostCSS共享此补丁，Core固定依赖树未包含此包。
- 本机 `npm run security:audit` 高危门通过，剩6低危、3中危，来自KaTeX和sprintf-js传播链。自动建议涉及KaTeX破坏性升级或Mammoth降级，本批不执行force；后续依赖批次单独评估，不能写成0漏洞。原始审计和失败日志在 `.53` 持久检查点的 `evidence/current-audit.json`、`attempt3-failed.log`。
- 定向运行验证巨大indexed行偏移立即被拒绝、正常indexed定位及PostCSS映射/输出保持；版本清单校验、Cargo locked metadata和diff检查通过。临时验证初版使用IndexedConsumer转换入口时缺sourceRoot报错，改为直接验证indexed读取和普通flat-map的PostCSS处理后通过，未把该夹具错误记成应用回归。
- `.53` 保留原提交和失败记录；依赖补丁采用 `.54`，Core仍为 `a84590c`、Pi/PiDurable1.0.2，macOS-only签名构建。当前按用户优先级只构建和核验资产，不替换正式安装、不发布Release或更新feed。

## 2026-10-06 签名构建外部阻塞

- [run 37363416800](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37363416800) 的代码始终为 `a163987e49ed73e265c22ea6732a74b175ef7289`，版本 `.53`、Core `a84590c` 不变。attempt1在UTC19:41:41因release准备job没有runner失败，已对同一run做一次failed重试，没有新建候选。
- attempt2的release准备于UTC20:03:05成功，创建 Draft `404064845`；macOS ARM构建job `111955498823` 等待15分钟后，于UTC20:18:07取消，整个run结果为failure。GitHub注释再次明确 “The job was not acquired by Runner of type hosted even after multiple attempts”，并提示macOS arm64容量不足。steps为空，没有进入编译、签名或公证，不应归类为这些检查失败。
- UTC20:21核对 Draft 仍为true、资产0、target精确为上述提交。本机唯一安装版本仍为 `.45`；本次未启动或替换App，也没有发布Release或更新feed。没有重跑已通过的源码CI或测试。
- 按本轮事先约定，第二次同类runner失败后停止自动重试并暂停 `edupi-1`。恢复入口与原始失败摘要保留在 `~/edupi-fork-route-QNdXqV/RESUME.md` 和 `signed-attempt2-runner-failure.json`。后续重新推进须先确认runner恢复及该固定候选的状态；只有成功生成并核验资产后才可继续安装流程。
- `.53` 两任务分叉和扩展/技能过滤安装补验均未执行，`.52`证据不替代它们；真实睡眠、真人质量、Windows与Core #223的独立配对边界保持。

## 2026-10-06 原生安装交互与分叉修复

以下结果取代上一轮“锁屏未完成”的对应项目；未覆盖的验收条件不据此补勾。

- 安装身份：唯一 `/Applications/EduPi.app` 为 `.52`，代码 `072f2fa`、Core `a84590c`。原生工具实际读到解锁桌面后，将严格签名核验通过的公开 `.45` 保留到持久检查点，再切换候选。隔离根仍为 `~/edupi-route1-canary-s8QOeo`，课次 2026-10-06 09:00，在本次 02:23 生成时尚未开始；没有改时钟或教师数据。
- 原生点击自动运行中 703/数学“启用试用”，只启用 G1，生成两份合成草稿；Core execution attempt=1，模型日志只有一次 preparation 调用，预算剩余11。G2/G3/G4 和外发未启用，模型仅监听 loopback。
- 从今天→任务详情打开检测卷，原生编辑增加检验题，保存为 revision=2；再次输入后取消，正文仍为已保存修订。填写意见并点击暂缓，页面显示已暂缓、审核历史1，无“已写入却报失败”。任务产物与材料列表分别打开同一 artifact，最新修订和只读状态一致；历史下拉可查看 revision=1，没有编辑、保存或恢复入口。安装服务补充负例返回409 `artifact_read_only`，拒写前后正文/版本完全一致。
- 从任务打开协作，参考卡片与老师输入分开；关闭工具后发两轮，收到合成模型回复。原生从第二轮前分叉，子会话不含第二轮，原会话不含子消息，关闭工具保持。父/子为 `01a10d55-2f8f-7704-8df4-e84ce9e3b2cb` / `01a10d58-03ec-7704-8df4-e84fcb933b5a`。
- 正常退出 PID38261 后实际启动新 App PID68833；任务、意见、两稿和会话历史保留，工具回读关闭，再发送成功。以 `--safe-mode` 启动 PID90690，横幅显示“第三方扩展已暂停”，诊断为空，Core和基础对话可用。点击“恢复正常启动”后原生观察短暂超时，实际重启为 PID4045；页面横幅消失、safeMode=false，仍为隔离根。该根没有第三方插件，此安装证据不单独证明真实插件过滤。
- 全轮结束仍只有1条 execution、attempt=1、两稿 revision=2/1、审核历史1；合计1次 preparation 和5次 chat，重启未重做备课。证据在持久检查点 `evidence/installed-interaction-checks.json`、`installed-after-held-20261006.json`、`installed-after-restart-20261006.json`、`installed-safe-mode-20261006.json`、`installed-restored-normal-20261006.json`；原生AX/画面在本任务工具记录。
- 已正常退出测试 App、停止精确模型进程，恢复严格签名复核过的 `.45`。前后173项中172项相同，唯一变化为既有 `feishu-bridge.error.log`；教师业务、模型/认证配置、真实根偏好保持。指纹为 `real-data-before-installed-resume-20261006.json` 和 `real-data-after-installed-resume-20261006.json`，未声称全根摘要不变。
- 新发现：任务内 fork 按既有服务端合同允许任务跟随合法副本，但 Desktop 删除 URL task、保留 tasks/run 和抽屉，导致多任务时 activeTask 可回退到另一任务。修复保留 tasks/review 的显式 task，自动重绑只针对路由与抽屉 agentTask 相符的对象；普通/提醒聊天继续清除关联。生产代码只改两处守卫，不改 Core schema、pin 或绑定存储。
- 新增13项实际回调/effect回归，旧代码8项失败、修复后全部通过；相关组37/37、TypeScript、lint和独立复审通过。全量首次1952 pass、2 fail、27 skipped；失败为旧结构断言和上一轮文档的本机绝对路径，修正后相关21/21通过。未把 skipped 或首次失败计为通过，最终CI另记。
- 新隔离根 `~/edupi-route1-canary-llGmUw` 的两任务开发页面：从第二任务发两轮、分叉、发送子消息、关闭再续聊；URL保留task，第一任务会话 `01a10d79-6b9c-75de-91bb-dacc982b0775` 不变，第二任务合法子会话为 `01a10d7a-cf45-75de-91bb-dad130051d1d`，历史不串。该根最初准备脚本 owner bootstrap 返回503 `runtime_unavailable`；保留失败，之后服务 Core ready，此轮仅验会话路由，不计主动运行验收。证据目录 `~/edupi-fork-route-QNdXqV`。
- 最终代码 `a163987e49ed73e265c22ea6732a74b175ef7289` 的 [CI 37363398268](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37363398268) 质量与Rust审计通过：CI全量1953 pass、28 skipped、0 fail，跳过项不计验收；本机版本核验、`cargo metadata --locked --no-deps` 和npm审计0漏洞。PR [#302](https://github.com/Intellinfinity/edupi-desktop/pull/302) 合并为 `42dec58504f124f988d0a7ca0e2e3c9f860a00a8`。
- `.52` tag/资产不覆盖；`.53` macOS-only [Draft run 37363416800](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37363416800) 绑定 `a163987`。UTC 19:35仍queued，release job `111943052091` 的runner为空、steps为空，尚未生成可安装资产；未据此触发重复候选。恢复入口 `~/edupi-fork-route-QNdXqV/RESUME.md`，另备无网络合成扩展/技能以补安装过滤验证。Windows、Univer、远程手机仍延期，公开Release/feed不推进。

## 2026-10-06 安装版冷启动与恢复

- 用户解锁后，Codex 原生工具正常退出空闲公开 `.45`；退出前 `runningSessionIds=[]`，实际原 PID 63552 消失。建立新的真实资料基线 173 文件，摘要 `90f471d0df1a3ea532889a572e9fb04a92a1cd6ced9be7af6078d680dcfb3256`。
- 经已核验的 DMG 复制至唯一 `/Applications/EduPi.app`，版本回读 `.52`，安装路径严格签名校验通过。以 canary 环境启动实际 Tauri App，PID 77648，数据根 `~/edupi-route1-canary-s8QOeo`；没有运行第二个 EduPi UI 副本。
- 原生窗口显示 `.52`、隔离教师工作区和测试事项。安装服务独立回读：Core ready、bundled、commit `a84590c`，双组件和 Bridge schema 与 pin 一致；1 个合成任务、0 个学生、0 份产物；G1/G2/G3 为 activation_pending，外发 false。环境为正常模式，启动诊断为空。证据 `installed-cold-start.json`；这是实际安装版冷启动证据，不是包内独立服务替代。
- 点击管理中心与自动运行成功；后续原生 `getAXState` 再次返回 “Mac is locked and automatic unlock could not unlock it”。未点击启用试用，模型调用仍为 0，草稿生成、审核、续聊、分叉、Safe Mode 与安装版重启保留未补验。已请求保持解锁，没有用 HTTP 写入替代受阻的 UI 操作。
- 冷启动后 171/173 项摘要相同，仅飞书错误日志和应用版本缓存变化；教师业务文件、模型/认证配置和真实数据根偏好保持。证据 `real-data-after-installed-cold-start.json`。
- 回收本轮自己启动的 canary App 与本机模型后，发现临时 `.45` App 备份缺少 Info.plist 等文件，已不完整，原因未确认。保留该副本作为证据，未将其用作恢复来源。`.52` 移至持久目录 `~/edupi-install-checkpoints/v0.3.52/EduPi-candidate-052.app`，避免误启动到真实根。
- 改从公开 Release `396929237` 下载 `.45` DMG asset `589341637`，210255357 字节、SHA-256 `54de27d5c9e0663b334afb7679e027072914ef43424d29233a821ef183f25160`。慢速下载中断时保留前缀并按经校验的 Content-Range 补齐；最终完整摘要精确匹配后只读挂载、验签并恢复 `/Applications/EduPi.app`。恢复后的版本为 `.45`，严格 codesign 与 Gatekeeper 均通过，主程序与原副本尚存的主程序字节一致。
- 恢复后仍为 171/173 项摘要相同，变动仍仅是飞书错误日志与应用版本缓存；没有恢复覆盖真实教师数据。测试 App、模型和两个挂载卷已停止，未在锁屏期间自动重开公开 App。最终证据 `real-data-after-public-restore-20261006.json`。
- 后续回退使用持久目录中的官方 `.45` DMG，避免依赖 `/tmp` 下的展开 App。`.52` 候选和证据保留在 `~/edupi-install-checkpoints/v0.3.52`，并非第二个正在运行的安装。原临时备份缺文件的原因仍未确认，不计作已解决的根因。
- 原生控制的恢复入口为该持久目录下 `RESUME.md`；模型脚本支持 `--resume-model`，启动脚本强制 `.52` 与指定 canary 根。只读指纹与安装状态已另存到持久 evidence 目录，不依赖旧临时路径继续存在。

## 原生控制与历史检查点

- 用户要求改用 Codex 原生 computer use 并先固定历史检查点。已用 `/Applications/EduPi.app` 完整路径成功读取公开 `.45` 的原生窗口；bundle ID 选择会命中多个历史 helper，因此本轮使用精确安装路径。无需把 Orca 的访问失败当作所有桌面工具不可用。
- 远端 annotated tag `v0.3.52` 已创建并回读，tag object `3d55d6e031f2e193a020796fa545ce14adafb3ab`，目标为已构建源码 `072f2fa8dcfd0618ae2391312f18dfd6ff82436e`。注释记录 Core `a84590c`、成功 CI `37281905644`、Draft Release `403498252`、DMG asset `612017261` 和完整摘要；没有重建或覆盖同版本包，也没有更新公开 feed。
- 原生退出前只读核对正式 App 没有运行中的 Agent 会话。退出动作返回 “The Mac is locked and automatic unlock could not unlock it”，随后 PID 80004 与 `.45` 版本仍在；尚未备份移动或替换安装。已请求手动解锁，不用终端退出代替受阻的 UI 动作。
- 已准备独立合成根 `~/edupi-route1-canary-s8QOeo`、703 班数学、任务 `teacher-task-52525252-5252-4252-8252-525252525252`。准备过程通过原 intake/任务接口形成测试材料与待处理任务，G1 未启用、模型调用为 0；此步骤仅为数据准备，不计安装运行证据。配置记录为本轮临时证据目录的 `installed-fixture.json`。

## 基线

- 初始 Desktop `0972f4f`；v0.3.51 候选 `8fdd2a1a066a64308a04d50361cd73b769026941`；Core `fb2bb9f8caa1b9633ea9954ca8fdde168856754f`，Pi/PiDurable `1.0.2`。
- Core 快照修复 [#222](https://github.com/Intellinfinity/edupi/pull/222) 经 CI `37275916396` 通过后合并为 `a84590cbd62ada4f75fa10e109f0cdc07a13368e`。Desktop 精确 pin 和双组件摘要已同步，带真实 Core 根的合同/打包检查 15/15 通过、0 skipped，schema 与 SDK 版本不变。
- macOS arm64、Node 22.23.1。开发页面仅使用 `edupi-teacher-created-e2-RsDTcf` 合成根、703 班数学与本机确定性模型；没有向真实学生档案写入。
- 真实数据/配置只读基线：173 文件，SHA-256 `26b1fd1e114f39986a3bcc75d37ecfeb43d2d08d41534731374e3c0928a87f6a`。中途仅既有 `feishu-bridge.error.log` 内容变化，另 172 文件相同；不能称整个 173 文件摘要未变。脚本与逐文件摘要位于 `/private/tmp/edupi-pi1-acceptance-18lQMA`，偏好中的运行端口单独排除。
- 开发验收结束时，公开 `.45` 已于北京时间 15:58:31 启动，PID 80004；本任务没有启动该公开实例。之后摘要比对为 169 项一致，变动为提醒状态、飞书错误日志、`last-version.json` 与 `ui-prefs.json`。未据此宣称真实根全量无变化，未回滚这些变动；全部模型配置仍一致。证据为 `real-data-after-dev.json`。测试临时根已备份为该证据目录内的 `first-page-evidence`、`final-tools-page-evidence`、`held-fixed-page-evidence`、`dirty-held-page-evidence`，测试服务和浏览器均已退出。

## A1 历史拒绝与恢复

新 Core `fb2bb9f` 与旧 Core `00d05a1` 在真实隔离子进程、loopback HTTP 上完成六阶段演练：旧版两任务各四稿；新版本明确暂缓；旧版拒绝新账本；同根恢复旧备份；同根恢复完整新版备份。六个子进程均正常退出，复制或恢复前全部关闭句柄。

| 核对 | 实际结果 |
| --- | --- |
| 新字段被旧版读取 | `invalid_state`，整根 28 文件字节摘要不变 |
| 恢复旧版完整备份 | 8 稿可读，反馈、预算及领域文件与备份一致 |
| 恢复新版完整备份 | 有原始完成历史的 4 稿只读；缺历史的 4 稿仍 `stale_source`，原文件保留 |
| 拒绝写入 | 只读修订返回 `artifact_read_only` |
| 去重与预算 | 两任务 attempt=1、artifact revision=1；used=2、remaining=2；恢复期间无模型调用 |

恢复阶段 G1 已暂停，此证据不代表启用中的真实模型自动恢复。旧版仍不支持新字段，降级必须恢复升级前完整备份；新版备份另外保留升级后的数据，不删字段伪造兼容。

演练命令与脚本见 Core `scripts/test_a1_version_rollback.mjs --old-core <旧版树>` 和 `docs/loop/evidence/2026-10-05-a1-version-rollback.md`。原始证据：`/private/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/edupi-a1-rollback-NtzdJN/evidence.json`。

## 开发页面

从任务板打开同一任务，实际显示两份草稿。编辑检测卷，增加检验题并保存为 revision=2；填写暂缓意见并点击暂缓。随后从任务教学产物和材料列表分别打开同一 artifact，均看到相同修订正文及“只读”；编辑、保存、AI 修订入口消失。历史选择 revision=1 可查看原文，未提供恢复按钮。800×900 与 1440×900 无横向溢出，截图已人工查看。

- 页面证据：`output/playwright/pi1-a1-held-history-800.png`、`output/playwright/pi1-a1-materials-readonly-1440.png`。
- 实际缺陷：暂缓已写入一次、历史只有一条，但 `/api/edupi/education` 返回 `invalid_envelope`。Core 审核预览用新状态，产物读取却使用旧磁盘候选，造成回执 after-snapshot 与落盘后快照不一致。
- 复现证据：`edupi-a1-snapshot-repro-rFPbTN/evidence.json`；同一 after state 的 preview 无产物，persisted 有两份产物。修复后的 `edupi-a1-snapshot-repro-9wqyWq/evidence.json` 两者 snapshot hash 一致。
- 修复后使用新合成根 `edupi-teacher-created-e2-eGGYu7` 重新生成两稿，从真实页面填写审核意见并点击一次暂缓：POST 返回 200，页面显示已暂缓、审核历史 1 条，无失败提示；截图 `output/playwright/pi1-held-review-fixed.png`。再次打开检测卷是只读，直接修订负例返回 409 `artifact_read_only`，attempt=1、两稿 revision=1 均保持。
- 首次“编辑中遇暂缓”试验被开发热重载中断。代码稳定后在新根 `edupi-teacher-created-e2-bvTuBA` 重验：页面输入未保存文字，再通过实际 Core 审核 API 暂缓，页面点击保存收到 409，只读状态保留整段可复制输入，保存按钮消失；重新读取仍保留，只有明确点击“放弃修改”才清除，原产物未写入这段文字。截图 `output/playwright/pi1-held-dirty-preserved.png`；暂缓按钮本身已由上一项真实 UI 操作覆盖。
- Desktop 对无法核对的回执改为“审核结果未能确认，请刷新任务后核对”，提供只读刷新；不再保证“没有写入”，不自动重发审核。
- Pi 1 页面关闭工具后发送合成消息、服务重启后续聊、从第二条消息前分叉并在子会话发送、回原会话核对均通过。父会话 `01a10ad2-22c9-719b-a8d4-2b7b202e3bac`，子会话 `01a10af6-7921-7631-bbbe-f29f4bdf65aa`；父会话不含子消息，子会话不含被截去的第二条，截图 `output/playwright/pi1-fork-child.png`。这属于本地模型接线与开发页面证据。
- 同时发现原有工具选择持久化缺口：显式关闭在重启/空闲释放后恢复默认工具，分叉亦会丢失。修复将显式选择写入原会话 JSONL，资源加载前恢复，不另建状态库或改全局配置。两个导航入口完成后读取最新选择，避免导航中的关闭被旧值覆盖；只读工具选择不再自动多启用 PowerShell。
- 真 SDK 定向回归覆盖冷启动、分叉、两类导航与并发、保存失败停会话、坏偏好拒绝、教师背景恢复及全局配置不变。工具偏好最终 11/11、相关 Pi 会话组、TypeScript/lint 通过。独立复审发现的导航覆盖及背景遗漏均已修。
- 页面曾出现后端全部关闭但工具按钮显示默认，定位为初始 `get_tools` 晚到覆盖人工选择；两个修改入口失效旧读取，回归验证新读取仍可同步。修复后从 UI 选择关闭，实际停止/重启 Next/Core，再打开原会话，显示关闭，`get_tools` 活跃数组为 `[]`，原两轮对话保留；截图 `output/playwright/pi1-tools-disabled-after-restart.png`。没有持久化记录的旧会话仍沿用旧默认，无法倒推出过去的选择。

## G2 真实模型

独立隔离根、单合成教师/学生/班级、数学；模型 `zai-coding-cn/glm-5.3-flash`。证据代码仍绑定 `8fdd2a1`/`fb2bb9f`，属于 Core HTTP 与 Desktop 合同消费者层，未冒充 Desktop 页面或安装证据。

默认关闭及未授权入队拒绝通过。明确授予一次模型预算后，自然消息形成跟进草稿与 `next_step`；一次真实请求成功，execution completed、attempt=1。Desktop 消费者修改摘要和下一步，经真实 bridge 写回并重读 revision=2；synthetic 反馈 1 条，真人反馈 0 条。重复事件返回同一 execution；实际关闭重启及暂停授权后草稿、反馈、used=1 保持，模型未重跑。只读预算/执行投影前后账本字节相同。

原始证据：`/private/tmp/edupi-g2-real-final-20261005.AqEHIb/report.json` 与 `acceptance.md`。真实 settings/models/auth 三文件摘要不变，G3/G4 与新 Durable 试点未启用，外发为 false。

本轮共 3 次真实请求尝试：两次有效输出，一次 `model_unavailable`。首轮失败后 Core 自动重试成功，但演练脚本对调用次数的错误假设导致提前退出，且丢失内存控制身份，续跑被正确拒绝。该失败根原样保留；最终验收使用新根并封存 0600 恢复材料，没有重签旧授权。尚无首轮底层错误与计费用量，不武断归因网络；有限合成材料不能证明真人教学质量。

## 签名候选与门禁

- Desktop 本轮审核相关测试 17 项、公证与 workflow 测试 40 项、迟到工具读取回归通过；加入工具偏好修复后的最终全量 `npm test` 为 1941 通过、27 skipped、0 失败，skipped 不计验收。带 Core 根的合同/打包 15/15 另行通过。`tsc --noEmit --incremental false`、完整 lint及新增文件定向 lint、`npm run security:audit`、diff 检查通过，npm 审计 0 漏洞；lint 保留未修改 intake route 的 1 条 unused-import 警告。
- [PR #298](https://github.com/Intellinfinity/edupi-desktop/pull/298) 的版本元数据 CI `37267587024` 质量与 Rust 审计通过。
- 最终代码 `072f2fa` 的 PR CI `37281657664` 质量与 Rust 审计通过；#298 已合并为 `bffbd9198296ee1e15599c409c24e409c2b284e8`。macOS-only `.52` Draft CI `37281905644` 绑定该代码并成功，安装与签名结果在下方单列，不从合并推定通过。
- macOS-only [Draft CI 37267593584](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37267593584) 的编译、签名、包内运行、OCR/DOCX/OpenConnector、updater key 与公证提交通过；最终 App `stapler validate` 连接 CloudKit 报 `NSURLErrorDomain -1009`/exit 68，整次 CI 失败。
- Release `403389428` 保持 Draft，绑定 `8fdd2a1`。DMG asset `611680481` 预期 SHA-256 `231b27f36b9bb61fb2a59cebdc75f5c2f3d1b781a1c85134a37340ddb4067030`；首次本机下载中断且摘要不匹配，未安装该文件。
- 后续修复采用新版本 `.52`，不覆盖 `.51` 资产。公证校验仅对已观察到的 CloudKit `-1009` 最多重试三次，仍必须得到成功结果；票据错误立即失败。
- 唯一 `/Applications/EduPi.app` 仍是公开 `.45`。Orca 桌面控制两次实际返回 `permission_denied`，权限面板虽显示 granted，重试仍失败；已请求用户重新切换辅助功能授权。未绕过该拒绝，未改真实数据根或 launchd。
- 安装前对正在运行的 EduPi 再查：先返回 `window_not_found`，按工具指引尝试一次 `--restore-window` 后仍为 `permission_denied`。公开实例继续保留，尚未退出或替换安装；需要恢复 Orca Computer Use 的辅助功能访问才能执行安装交互验收。

## v0.3.52 实际资产核验

- Draft Release `403498252`，代码 `072f2fa8dcfd0618ae2391312f18dfd6ff82436e`。macOS CI 的 App/DMG 公证 Accepted、装订、严格签名、stapler 与 Gatekeeper 全部通过；签名后的包内服务、OCR/DOCX/OpenConnector 和 updater 公钥核验亦通过。仅 macOS 构建，三平台 draft-proof 与发布 manifest 步骤未执行。
- DMG asset `612017261`，208953199 字节，SHA-256 `ad416f27d16cee418f0b7d80aee65e8ee5a490cdd54db025c5abb4d188316087`。API 下载首次 TLS 连接超时，有限重试后成功；本机摘要完全匹配。App archive 与 `.sig` 的资产 ID 为 `612002677` / `612003050`，本轮仅记录远端摘要，没有本机 updater 安装验签演练。
- 只读挂载下载的 DMG 后，App 严格 `codesign --verify --deep --strict` 通过；App 与 DMG 的 `spctl --assess` 均 accepted，source 为 Notarized Developer ID。没有从挂载卷启动 App。
- `CFBundleShortVersionString` 与内嵌组件版本均为 `.52`；内嵌 compat 与源码逐项一致。按 bundled 模式核对 Core 文件闭包通过，Core 为 `a84590cbd62ada4f75fa10e109f0cdc07a13368e`、Pi/PiDurable 1.0.2、Desktop component 摘要 `e9db9a19be023e6c7c57d9079f199caaa5d7b9b5ebd229c8c2022563b9933c35`。本机记录为 `candidate-identity.json`。
- 本机对 App 与 DMG 运行 `xcrun stapler validate` 均因 Apple CloudKit TLS `NSURLErrorDomain -1200` 失败，exit 68。这不计通过，也不覆盖 CI 同资产的成功装订核验与本机 Gatekeeper 接受结果；未关闭证书校验或改系统网络设置。
- `.52` 留在 Draft。回读公开 Latest 与 raw feed 仍为 `.45`、7 个 updater 平台键；唯一 `/Applications/EduPi.app` 仍是运行中的公开 `.45`。下载包与证据保留于 `/private/tmp/edupi-pi1-acceptance-18lQMA`，挂载验证完成后卸载该卷。

Windows 安装继续延期。真实跨到期睡眠、真人价值、六领域 Live 和公开更新安装仍未通过，不由本轮合成验收代替。
