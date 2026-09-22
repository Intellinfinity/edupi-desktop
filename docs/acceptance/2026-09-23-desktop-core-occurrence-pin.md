# Core 860594a 与 Desktop occurrence 配对验收

## 范围

- Core merge：`860594a05c5d32617fffdbdf03d56e6ade6dc211`，PR #173；其父级 #172 为 ambient snapshot hotfix。
- Desktop 基线：`9f33463fc5298ea54a361e809419f8d315c19b22`；交付分支与远端审查为 Desktop PR #212。
- 环境：macOS arm64，Node.js 22.23.1，隔离临时数据根；未读取或修改真实教师数据，`external_send=false`。

## 结果

| 验收项 | 操作 | 实际结果 |
| --- | --- | --- |
| Core 质量 | `npm test`、`npm run typecheck`、定向 ambient/schedule/bridge 测试、远端 `core-quality` | #172/#173 均通过；runs `35782721446`、`35788428478` |
| Desktop 静态与单元回归 | `npm test`、`node_modules/.bin/tsc --noEmit`、`npm run lint` | 1447 tests，1421 passed / 26 skipped / 0 failed；类型和 lint 通过 |
| source occurrence | `EDUPI_CORE_ROOT=<Core 860594a> npm run test:edupi-schedule-occurrence-e2` | 首次启动即启用 ambient；导入、精确重放、typed projection、改期 hold、same-ref keep-both 拒绝、replace、重启回读通过 |
| source 默认审核 | `EDUPI_CORE_ROOT=<Core 860594a> npm run test:edupi-schedule-conflicts-e2` | ambient 未设置；owner bootstrap、冲突读取、决定、重放、过期拒绝、重启回读与丢失凭据 fail closed 通过 |
| packaged resources | `EDUPI_CORE_ROOT=<Core 860594a> npm run desktop:prepare` | Next standalone、Node runtime 与 2165 个 Core 文件生成成功，Core commit 精确为 `860594a…` |
| staged runtime | `npm run test:staged-desktop-runtime` | Core ready、projection ready、occurrence 1.2、external send 关闭 |
| staged risk workflows | `npm run test:staged-schedule-conflicts-runtime`、`npm run test:staged-feedback-runtime`、`npm run test:staged-schedule-occurrence-runtime` | owner/CAS/重放/错误范围拒绝/反馈回读/occurrence 全流程通过 |
| bundle closure | `EDUPI_CORE_ROOT=<Core 860594a> node --test scripts/packaged-core-bundle.test.mjs` | 3/3 通过；无 `.git`，缺失或篡改依赖拒绝 |
| isolated model host | `EDUPI_CORE_ROOT=<Core 860594a> EDUPI_STAGED_RESOURCES=<resources> node --test scripts/runtime-model-host-files.test.mjs` | 2/2 通过；复制文件均为普通文件，localhost 模型调用成功 |

## 状态边界

- 已实现待远端验收：Desktop 分支推送、PR CI 和合并。
- 未验证：PDF/image/ICS 的可信 occurrence 提取；macOS/Windows 安装版通知点击、睡眠恢复、升级与数据保持；六领域真实内容人工核对；正式盲测；真实教师价值。
- 判定：`L4 功能收敛中`，不能写 `L4 established`。
