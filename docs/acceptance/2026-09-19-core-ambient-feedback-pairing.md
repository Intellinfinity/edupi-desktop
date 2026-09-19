# 2026-09-19 Core 执行反馈配对验收

## 范围

- Desktop 固定 Core main merge commit `d05cf89df067a78602883c6bd95a37f8b0c122f7`（Core PR #145）。
- Core PR #145 将 G1 `draft_ready`、失败、恢复和 stale 结果追加回流 Ambient planning；Today 投影可从自动准备收敛到 `already_ready`，失败进入明确等待/升级，stale 重新打开为 `update`。
- Ambient planning 仍默认关闭；Decision 仍为 `apply=false`，attention 仍为 `desktop_only`，`external_send=false`。

## 证据

- Core 身份：Desktop component `sha256:f9393d0db6f773feeb0c2ff59ac19078fe8a45e6ae96613d0450407e6f12d133`，Runtime component `sha256:409f93e72a10ff7a15c939607e0decf34016e65969e3641c1dac1d2ba8fa5cdc`；Bridge schema 与 fixture manifest 保持 `d4702e...` / `455ca9...` 不变。
- `EDUPI_CORE_ROOT=<core-d05> node --test lib/edupi-bridge-contract.test.mjs`：通过，3 passed / 6 条件跳过 / 0 failed。
- `EDUPI_CORE_ROOT=<core-d05> node --test scripts/packaged-core-bundle.test.mjs`：3 passed / 0 failed。
- `EDUPI_CORE_ROOT=<core-d05> node scripts/test-edupi-c2-e2.mjs` 与 `...c3-e2.mjs`：均 GREEN，pin 显示 Core `d05cf89...`。
- `EDUPI_CORE_ROOT=<core-d05> node scripts/test-edupi-ambient-today-runtime.mjs`：通过，1 个 Goal、1 个 Opportunity、`external_send=false`。
- `npm test`：1268 tests、1243 passed、25 条件跳过、0 failed。
- `node_modules/.bin/tsc --noEmit`、`npm run lint`、`npm audit --audit-level=high`、`GITHUB_TOKEN="$(gh auth token)" npm run release:verify`：全部通过；audit 为 0 vulnerabilities。

## 边界

- 这是源码开发版与外部固定 Core 的配对验收；未构建 v0.3.26 安装包。
- 安装版冷启动、托盘、睡眠唤醒、通知点击、升级数据保持、真实教师价值和 L4 established 仍未验收。
