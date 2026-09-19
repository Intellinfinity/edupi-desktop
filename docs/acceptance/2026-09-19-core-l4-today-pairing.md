# 2026-09-19 Core L4 Today 投影配对验收

## 范围

- Desktop 固定使用 Core commit `e8623a34715a96a1ad94cc2971727c037886fbbd`，并以 external 模式校验 Desktop/Runtime 组件与 Bridge schema。
- Today 消费 Core `education_workspace.l4_preparation` 投影，按“已准备好 / 自动进行 / 需要判断”显示目标、机会和决策，不新增执行按钮。
- Ambient planning 默认关闭；仅设置 `EDUPI_AMBIENT_PLANNING=1` 时传给受管 Core runtime。所有 Decision 仍为 `apply=false`，Attention delivery 仍为 `desktop_only`，不外发、不自动执行。
- 直接读取 education snapshot 时，若 ambient planning 已显式开启且调用方未提供 roots，先确保受管 runtime，避免竞态回落到一次性 Core 进程。

## 证据

- 组件身份：Desktop component `sha256:b3475c904d31bb928841dd3e11262ef738634ffc635889bc8f3f87d863f41699`，Runtime component `sha256:41f630677371db59184ecd2ead4ddf97f19c38aff9bd90baa0dbbdd3a68235a6`，Bridge schema `sha256:d4702ef3bb303996cea137f9f1337a20a8c6853b0b7d215cca64265bf2cd4daa`，fixture manifest `sha256:455ca9489f582b3a41223ce2518436445ec1b25ec4fdd8e5d10e35b3387a253e`。
- `EDUPI_CORE_ROOT=<core-worktree> node scripts/test-edupi-ambient-today-runtime.mjs`：通过；1 个 Goal、1 个 Opportunity、Core commit 精确匹配，`external_send=false`，并覆盖无预传 roots 的直接 snapshot 竞态。
- `node --test lib/edupi-l4-preparation.test.mjs components/EduPiTodayWork.test.mjs desktop/core-runtime-host.test.mjs lib/edupi-runtime-supervisor.test.mjs`：9 passed / 0 failed。
- `npm test`：1266 tests、1241 passed、25 skipped、0 failed。跳过项为仓库既有的外部/bundled 条件用例，不以跳过冒充通过。
- `node_modules/.bin/tsc --noEmit`、`npm run lint`、`npm audit --audit-level=high`、`node --test scripts/release-workflows.test.mjs`：全部通过；audit 为 0 vulnerabilities。
- `GITHUB_TOKEN="$(gh auth token)" npm run release:verify`：通过，EduPi Desktop 0.3.25、pi 0.84.1 pinned、pi-web 0.8.7 pinned。无凭据时的 GitHub Releases API 403 是匿名限额，不是组件校验失败。
- 干净 Next dev server、固定 Core、隔离数据根和全新 headless Chrome 153：Today 显示“自动准备 / 1 个目标 / 自动进行 / 1 项 / Ambient preparation goal”；`/api/edupi/workspace`、`/api/edupi/materials/staging`、`/api/edupi/kernel` 和 reminders 均 200；控制台 error/warning 为 0。截图证据保留在本地 `output/ambient-today-final-clean.png`。
- 初次 dev 验证中的 staging 503 由测试命令漏传打包环境必需的绝对 `PI_DESKTOP_STATE_DIR` 引起；补上后同一接口为 200，不是本批代码回归。

## 边界

- 这是源码开发版与外部固定 Core 的隔离验收；v0.3.25 尚未发布，安装版冷启动、托盘、睡眠唤醒、系统通知点击和升级保留为发布验收项。
- 本批只展示 Core 投影；通知 outbox、真实执行回执、教师接受/修改闭环和外部载体延续不在本批完成，不因 Today 可见而记为完成。
- 合成 Ambient preparation goal 只证明 Desktop/Core 合同、runtime 归属和安全边界，不代表真实教师价值或 L4 established。
