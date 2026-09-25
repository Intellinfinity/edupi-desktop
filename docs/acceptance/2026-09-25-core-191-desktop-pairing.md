# Core #191 与 Desktop 配对验收

## 当前边界

- Desktop 目标为 Core [#191](https://github.com/Intellinfinity/edupi/pull/191) merge `86a49de9278704b3b64ad637c13acc03f21d34b5`；C1 桥接仍为 `edupi-bridge-v1.1`，组件哈希 `sha256:d878f2fb5127f0874636975172ae0630b67b6b42957e7718b1983309e3e9632f`，Runtime schema `sha256:9c8c287a8d8eeaea2905fb83b64742a5841e664d766cfa58b0791bf17caf88dc`，Runtime 组件哈希 `sha256:e2790002f558026ddf316ba259ffb3626468e63469a4ec05023c75dc67a56452`。三项均从精确 Core commit 的合同文件回读，不采用未提交的 Core 主工作树。
- Core #185–#190 的 owner intent、G2 intent 入队、无处理器时提前返回 `activation_pending` 与 G1 唤醒补扫已包含在此 pin。#191 提供受约束的 G2 live 入口，但 Desktop 本批未配置模型主机或启用 G2；共享能力 G3–G5 仍缺生产处理器。仅从 `supported_operations` 推断“可执行”是不正确的。
- 这批是源码、隔离 Core 与 staged bundle 验收；公开和本机签名安装版仍为 v0.3.41/Core `68004b2`，不能把本记录写成安装版升级或 L4 整体完成。

## 变更与原因

- Desktop 精确 pin 到 #191，保持旧 bridge/occurrence 合同不变；健康解析要求 G1/G2/共享处理器三个状态齐全，缺字段拒绝。管理中心“系统”只按实际 processor Health 显示“课前准备可运行 · 学生跟进待接入 · 其他任务待接入”，而不是将内核就绪等同全部自动任务可用。
- 新 Core 启动即补扫暴露隔离目标缺少 canonical 课次绑定：`timer_error_code=binding_incomplete`。旧 Desktop 会把单项来源缺口报成“自动检查异常”；现将其归为可处理的课前事项状态，管理中心“自动运行”显示“有课前任务缺少课次关联”，Core 与定时器仍可报告 ready。定向回归先失败再通过。
- 旧 `test:edupi-status` 还检查初版的 `student_profiles.json` 等本地文件；现改为结构哨兵，确认状态路由读取 Core 健康/投影/Kernel，且不会用本地 JSON 回退。它不冒充 HTTP E2，真实写入/回读另由 C1 与 staged 测试证明。

## 隔离证据

- 环境：macOS、Node 22.23.1；Core detached 检出 `/tmp/edupi-core-pair-041.J4JCC2/core` 为精确 #191，Desktop 另在 `/tmp/edupi-desktop-stage-190.r8Gs7w/desktop` 的 detached 检出运行 `desktop:prepare`。打包复制 2171 个 Core 文件；当前真实教师根没有测试写入。
- Core #191 自身的 `test_core_runtime_g1_wake_continuity.mjs` 对 cold-start/suspend-resume/无重复调用通过；`test_student_followup_execution_daemon.mjs` 对自然 G2 入队、取消、收窄授权、重启/重放与合成模型调用通过。后者不是 Desktop 安装版 G2 已启用证据。
- Desktop 对 #191 的 `test:edupi-c1-e2`、`test:edupi-ambient-today-runtime`、`test:edupi-proactivity-canary-e2`、`test:edupi-slot-alias-e2`、`test:edupi-teacher-created-preparation-e2` 通过，均 `external_send=false`。隔离真实进程 Health 为 G1 `active`、G2/共享能力 `activation_pending`；打包后 `test:staged-desktop-runtime` 仍为 Core/投影 ready、v1.2 occurrence、默认 `proactivity=disabled`、同一 processor 状态。staged occurrence 与反馈回读通过。
- 隔离当前源码页面在 800×900 显示 #191/Core/Runtime 清单，系统页准确列出三个执行器状态；自动运行页显示“有课前任务缺少课次关联”。页面与文档 `scrollWidth=800`，控制台 error/warn 为 0。该检查不是签名 Tauri 窗口验收。
- 全量 `EDUPI_CORE_ROOT=<精确 #191> npm test` 为 1741 total / 1732 passed / 9 skipped / 0 failed；TypeScript、lint、`npm audit --audit-level=high`（0 漏洞）、`release:verify`、Cargo locked metadata 与 `git diff --check` 通过。独立构建的 Next 导出路由出现既有动态依赖 warning，但 build 和 staged smoke 完成；不把构建称为“零 warning”。

## 未完成

- G2 需要独立的默认关闭单教师 canary、受信任且可取消的模型主机，以及同一安装版上的当前来源/授权、撤回、重启、睡眠跨触发、教师审核和无重复执行证明；真实学生标识不得在未经具体授权的情况下送外部模型。G3–G5 共享执行器继续 `activation_pending`，不能凭 Core API 名称启用。真实教材/教师价值与正式模型盲评仍由原路线图约束。
- 当前签名 v0.3.41 仍运行旧 Core；此 pin 与只读目录修复需经下一版三平台签名发布和安装后才能关闭安装版验收。
