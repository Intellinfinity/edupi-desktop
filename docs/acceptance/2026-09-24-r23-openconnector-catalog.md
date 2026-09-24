# R23 OpenConnector 只读目录资源验收

状态：源码、本机 staged 与 macOS/Windows 无签名预览打包验收通过；未作为公开安装版发布。此子项不等于 R23 Action 执行完成。

## 版本、环境与范围

- Desktop [PR #243](https://github.com/Intellinfinity/edupi-desktop/pull/243) 当前提交 `59e2ce6`；Core 固定 `68004b2c0294159eef4f88bcbf4a921ef6978037`；OpenConnector headless package 精确 `1.6.5`，随包保留 Apache-2.0 LICENSE 与 NOTICE。本机 macOS/Node 22.23.1，真实打包资源在 `src-tauri/resources/open-connector`，隔离 Core checkout 为干净的同一 pin。
- 本次只打包一个无 HTTP 监听的 catalog host。IPC 只接受 `providers/search/inspect` 三种 GET 请求，最多 8 KiB 输入帧、512 KiB 输出帧、8 秒请求截止；未知命令、额外字段、Action POST 与代理均拒绝。底层 runtime 另设 `blockedActions:["*"]`、`blockedProxies:["*"]`。没有连接管理、账号凭据或真实 Provider Action 执行入口；host 尚未由正式应用生命周期启动。

## 已执行的检查

| 操作与预期 | 实际结果 |
| --- | --- |
| `EDUPI_CORE_ROOT=<隔离 Core> npm run desktop:prepare`，生成独立资源且不污染正式教师数据 | 完成；Core bundle 精确为 `68004b2`。OpenConnector 资源约 245 MB、约 2 万文件；按 Windows runner 前缀模拟的最长文件路径 228 字符，低于当前 260 门禁。 |
| `EDUPI_STAGED_RESOURCES=<本机资源> npm run test:staged-openconnector`，以包内实际 host/依赖启动目录进程 | 通过；返回 1554 个 Provider、10 个 calendar 搜索结果、`npm.get_package` schema，`execute` 请求为 `invalid_catalog_request`；关闭 stdin 后进程退出，临时数据目录清理。用 bundled macOS Node helper 再跑同一测试也通过。 |
| 与 OpenConnector 1.6.5 headless runtime 的隔离直连试验 | `GET` catalog 正常；即使绕过 host 直接向该 runtime 发送 `POST /v1/actions/npm.get_package`，部署策略返回 `action_blocked`，没有执行 Provider Action。 |
| staged Desktop/Core/OCR/DOCX 与质量门 | `test:staged-desktop-runtime` 的 Core/投影 ready、`externalSend=false`；真实图片 OCR 与 DOCX 提取 smoke 均通过。最终预览配置下本机 `npm test` 1672 passed、26 skipped、0 failed；TypeScript、lint、npm audit（0 漏洞）、release verify、Cargo metadata 和 actionlint 通过。 |
| macOS/Windows 预览打包 | 首轮 [35949833763](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35949833763) 在包任务安装 Desktop 依赖前跑 Core 测试而缺 `jiti`；第二轮 [35950351105](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35950351105) 的 macOS 预览 DMG 通过，Windows 命中预览专有的 `writer_admission_invalid_root`。第三轮 [35951702275](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35951702275) 的 Windows NSIS 通过；macOS Tauri DMG 构建成功，但 `--bundles dmg` 清理中间 `.app`，使最终资源检查失败。本机改 `app,dmg` 实测最终 `.app` 内 host 成功启动。最后一轮 [35954665492](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35954665492) 的质量、macOS 与 Windows 包任务均成功；macOS 最终 `.app` 目录 smoke、Windows staged 目录 smoke、Windows exe 产品版本检查及两份预览资产上传步骤均成功。macOS DMG 压缩资产 207,893,867 字节，Windows NSIS 压缩资产 125,599,716 字节。 |

## 未验证与门禁

- 预览包不是 Developer ID 公证的正式包。macOS runner 最终 `.app` 目录 host 已验；Windows 只在打包前 staged 目录启动了 host，NSIS 安装后资源与 Linux deb/AppImage 中的 host 运行仍须等下一正式包和公开安装测试给证据。
- 当前 App 不会启动这个 host；没有持久数据目录管理、崩溃恢复、连接账号、Core WorkCase grant/Receipt、人手确认防合成输入或模型 shell 隔离。只读目录不应被写成“OpenConnector 已可供教师执行动作”。真实 `no_auth` Action 也可能有外部副作用，在这些门禁完成前一律禁止。
- JEV 仍只负责浏览器决策，未接入受管浏览器执行器；手机异地 HTTPS 服务仍按路线图最后推进。权威执行合同见 [R23 规格](../architecture/R23-external-action-authority-spec.md)。
