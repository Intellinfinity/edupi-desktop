# Desktop 与 Core G6 配对验收

## 范围

- Desktop `0.3.31` 分支提交 `78ac6c3`，Core 独立干净 checkout `acce81e3b59ae93a998e7c1e9d1f008059ec3e85`，macOS arm64、Node 22、隔离 `/tmp` 数据根。
- Bridge 仍为 `edupi-bridge-v1.1`、`education_workspace`、12 个命令；Runtime schema hash `sha256:87a14fdd7a11a65434e70cd958cb9f4dfde1c704eeb90dbeee9aeee5d4cf396a`。未开启家校外发，JEV 不参与对话。
- Core 主工作树有未提交内容，没有作为打包源；Desktop 生产资源从上述 detached checkout 生成。

## 已验证

| 操作 | 实际结果 |
| --- | --- |
| `npm run test:teacher-feedback` 和 `npm run test:schedule-upload-dedupe` 于 Core G6 checkout | 6 个反馈领域、可信范围、跨班拒绝、准确重放、重启、歧义日程与旧写入围栏测试均通过；`external_send=false`。 |
| `EDUPI_CORE_ROOT=<G6> EDUPI_CORE_ALLOWED_ROOT=/tmp npm run test:edupi-c1-e2`、`test:edupi-c2-e2`、`test:edupi-c3-e2`、`test:edupi-calendar-dedupe-e2` | 精确身份、回执、修订与重启回读通过；来源顺序变化不复制日程，未知日期保持待核。 |
| `EDUPI_CORE_ROOT=<G6> EDUPI_CORE_ALLOWED_ROOT=/tmp npm test` | 1376 通过、9 跳过、0 失败；跳过项不算通过。`tsc --noEmit`、`npm run lint`、`npm run release:verify` 通过。 |
| `EDUPI_CORE_ROOT=<G6> npm run desktop:prepare` 于隔离 Desktop checkout | standalone Server、Node 与 2159 个 G6 Core 文件生成成功；Next export route 保留原有 critical dependency warning，未改当前开发工作区 `.next`。 |
| `EDUPI_STAGED_RESOURCES=<G6 包资源> npm run test:staged-desktop-runtime` | 冷启动 Core 和教育投影 ready，主动运行默认关闭，`externalSend=false`。 |
| `EDUPI_STAGED_RESOURCES=<G6 包资源> npm run test:staged-feedback-runtime` | 真实课表目标回读的 `domain/scope` 匹配；未授权拒绝、跨班反馈拒绝、隔离合成反馈写入、同命令重放和重读通过；合成反馈不计入真实教师指标。 |
| `EDUPI_STAGED_RESOURCES=<G6 包资源> EDUPI_CORE_ROOT=<G6> node --test scripts/runtime-model-host-files.test.mjs` | 完整打包模型依赖在独立 localhost 服务执行并回读；2 项通过，无跳过。 |

## 未验收

- 这是源码与隔离生产资源验收，不是 v0.3.31 公共安装版。三平台 CI、Apple 公证、Raw feed、应用内验签升级、教师数据与模型配置保持仍须按 R22 执行。
- Today 原生页面的教师反馈提交、通知点击、真实睡眠唤醒和六领域真实教学价值未由上述 API 测试证明；R21 和 L4 保持未验收。
- G6 的安全围栏禁止未知来源/范围的正向评价；桌面端提交前已拒绝目标回读与教师输入不一致的领域、班级或学科，不自动补造缺失范围。
- Today 仅对 Core 已验证领域的课前工作候选展示评价；目标失效时关闭重试入口并要求刷新，其他类型工作候选保留决定操作但不伪造评价资格。
