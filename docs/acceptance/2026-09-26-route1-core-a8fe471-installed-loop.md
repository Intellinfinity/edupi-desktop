# 路线 1：Core a8fe471 安装版主动闭环验收

## 当前状态

- Desktop 独立 `codex/route1-core-a8fe471-20260926` 从 `main` 的 `9ff46e58e2adf07030d91bdd0e711a42c220cc9c` 创建；原 Desktop 工作树未改。Core 使用 detached `a8fe4711419fe3f36a19fd342e17abe33a7825b9` 的干净检出，原 Core 主工作树的大量未提交改动未动。真实教师数据根和 launchd 未操作。
- 本记录的当前 checkpoint **仅为配对源码与隔离包闭包通过**，不等于主动闭环、安装版或 PR 已完成。主验收路径与逐项状态见[路线 1 计划](../plans/2026-09-26-route1-core-a8fe471-installed-loop.md)。

## 合同核对

| 合同 | 原 #191 pin | Core a8fe471 | 处理 |
| --- | --- | --- | --- |
| Runtime schema | `sha256:9c8c287a…` | 相同 | 不改 schema pin |
| Bridge v1.1 / 课次 v1.2 schema | `sha256:7f0cffd2…` / `sha256:b739852f…` | 相同 | 不扩 supported commands |
| Runtime component manifest | `sha256:e2790002…` | `sha256:844eebaf4339062f0189df2af66762152780db043c8ea0b6baefa45fb118c851` | 精确更新 |
| Desktop component manifest | `sha256:d878f2fb…` | `sha256:8092bd3d10af41683433e87e6a06d0da4d9fdc2e83a631eb1b9e59c267486bf7` | 精确更新 |

- Core [#192](https://github.com/Intellinfinity/edupi/pull/192) 的功能 merge `79049fb` 是 a8fe471 祖先；[#193](https://github.com/Intellinfinity/edupi/pull/193) 仅补文档。`contracts/edupi-core-compat.json` 和解析器的强 pin 同时更新，并记入两项配对 PR。

## 当前证据

- Core clean checkout：`npm run test:core-runtime-g1-live` 通过，结果含 cold start、重启无额外模型调用、Unix SIGSTOP/SIGCONT 补扫；`npm run test:capability-live` 通过，G3/G4 仅当前 owner/accepted Fact 内部草稿，G5 未核实关系拒绝入队、material hold、`external_send=false`；`npm run check:core-runtime-manifest` 报模块 148、资产 201，Runtime component hash 与上述一致；`npm run typecheck` 通过。这些是 Core 工程证据，不是 macOS/Windows 系统睡眠或 Desktop installed 证据。
- Desktop pin 定向测试先因旧 `86a49de` 失败，更新后 `lib/edupi-bridge-contract.test.mjs` 在 `EDUPI_CORE_ROOT` 指向 clean a8 检出时 10/10 通过；`scripts/packaged-core-bundle.test.mjs` 3/3 通过，完整闭包复制、无 `.git` 校验、坏依赖拒绝和隔离 Runtime 启动均有证据。仍须完整 staged/安装版草稿—提醒—反馈验证。

## 不越界

- Desktop 包内 `core-runtime-host.mjs` 经 factory 注入 G1 Live；Core CLI 不开放 Live 环境开关。G2/G3/G4 默认保持 `activation_pending`，仅在隔离 canary 且满足 owner/ambient/model permit 时可试；不将 G3/G4 artifact 当作已具备反馈 scope 的目标。G5 监护关系、未核实材料、课次/学期归属仍无充分证明。
- `attention_delivery_record` 的送达回执不是 `teacher_feedback_record`。真实反馈须由教师先审核、再按当前 revision/fingerprint 明确提交并回读；synthetic 反馈不计入真人价值。
