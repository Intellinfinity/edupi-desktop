# OpenConnector 独立管理页与 JEV 意图预检

## 范围

- Desktop `feat/jev-openconnector-integration`，Core 固定 `86a49de9278704b3b64ad637c13acc03f21d34b5`。OpenConnector 使用已固定的 `@oomol-lab/open-connector@1.6.5`；没有复制上游 Console 或打开其管理端口。官方 [headless 说明](https://github.com/oomol-lab/open-connector/blob/main/docs/headless.md) 指出 NPM 嵌入包不含 Web Console，所以在 EduPi 管理中心单列 OpenConnector 页。
- 页面可按服务名筛选 Provider、查看服务的 Action、跨服务或单服务搜索 Action、查看输入参数；服务端只接受 `providers/actions/search/inspect`。桌面令牌、同源/loopback、私有临时目录、单并发门和 `blockedActions/blockedProxies` 保持；不提供账号、密钥、执行按钮或 Agent Action。Core WorkCase/grant/Receipt 和可信人工授权未完成前，R23 状态仍为部分实现。
- 从 [jev-chat-windows](https://github.com/jev-chat/jev-chat-windows) 借鉴“固定候选意图 + 选择/置信度 + 弃答”的评测形态；没有复制其 Windows/微信截图、OCR、对话草稿或 UI，也没有让 JEV 进入教师对话。新预检只发送仓库中 21 条合成教师语句到已有 JEV TypeSafe endpoint；六个类别与 Core 安全域一致，另有 `unclear`。标签另存文件，调用时不发送标签。

## 验证

- `npm run test:jev-intent-preflight`：21 条合成 fixture、7 个候选类别，每类固定 3 条；8 项测试通过，0 次服务调用。测试覆盖类别退化、概率不完整、低置信度、弃答、HTTP/传输失败脱敏、调用上限、安全域误路由计数与标签分离。
- `npm run run:jev-intent-preflight -- --max-calls=1`：现有 JEV 配置对一条合成备课语句返回 `teaching_preparation`，768 ms；没有发送真实教师数据或调用聊天模型。
- `npm run run:jev-intent-preflight -- --max-calls=21`：21 次实服请求全部得到有效回答，六领域各 3/3 命中，三条无足够语境的语句均选 `unclear`。本轮 18 个接受、3 个弃答、21/21 参考标签一致、宏 F1=1、`safetyFalseNegative=0`；单次延迟 237–962 ms。全部样本都是自拟短句，这些数字仅描述该预检样本，不是泛化准确率。
- 临时隔离 Core/数据根 `/tmp/edupi-admin-ui-042.h2Fh0g` 的 IAB 页面实际从管理中心打开独立 OpenConnector 入口；1280×720 和 800×900 截图/AX 均可见单页布局。800 宽时 `body.scrollWidth=document.documentElement.scrollWidth=800`，控制台 error/warn 为 0。非 Tauri 浏览器的目录控件按预期禁用。用临时 staged host + 官方 NPM 包运行 `npm run test:staged-openconnector`，`providers/actions/inspect/scoped search` 成功且 `execute` 阻断；实际返回 1554 个 Provider。桌面令牌 API 的定向测试也通过。快速离开页面会取消服务端子进程并释放单并发门；定向回归已验证取消后立即可重查，短暂 429 另有有界客户端重试。
- 发布候选 `0.3.44` 的完整 `npm test` 为 1753 total / 1727 passed / 26 skipped / 0 failed；TypeScript、lint、`npm audit --audit-level=high`（0 漏洞）、`cargo metadata --locked`、`npm run release:verify` 和 `git diff --check` 通过。代码复审提出的取消竞态与标签覆盖门禁均已修复并补定向测试。此处是源码/隔离资源证据，不替代三平台 Release 工作流或安装版体验。

## 未验收

- 该 JEV 预检不是正式盲测：标签是合成规格、没有两名独立教师裁决，也未覆盖 60 故事/360 时点的真实语义、真实材料和五日基线/十日试用。`formal_blind_status=not_run`，不能把 21/21 外推为教学质量或 L4 established。
- 新 OpenConnector 页在浏览器只能验证布局；签名安装版 WebView 的真实服务选择、Action 搜索/参数查看和 800×900 原生窗口仍待操作。当前 `/Applications/EduPi.app` 为 v0.3.42，Mac 锁屏期间不触碰现有安装。真实账号/OAuth、Action 执行、Core Receipt 和跨平台旧版原位升级继续未完成。
