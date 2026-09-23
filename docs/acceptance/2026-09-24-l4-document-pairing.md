# L4 同名多项日程逐项配对验收

状态：源码与 macOS staged server 验收通过；未发布或安装。Desktop 提交 `b029a45`，Core 固定 `c1edefd2a2b77e3d10dfc9f0a47eceb7b5f7b1de`；公开 Latest 仍为 v0.3.36。

## 行为与安全边界

- PDF/DOCX 修订中同名同类的多条事项同时变化时，原自动导入继续以 `ambiguous_schedule` 拒绝。老师明确选择原材料日程来源后，可以只读预览新旧事项，再逐条选旧事项或“这是新增事项”。来源不存在、类型不符或 Core 指纹过期时，在模型识别前拒绝；预览本身不写 Core。
- 提交携带识别事实指纹、来源指纹和逐条选择。服务端重新识别、校验 Core CAS、逐项唯一性、同名锚点及候选所属来源；重复配对、外来事项、旧预览或变化中的来源均在导入前拒绝。成功配对沿用原 `source_occurrence_ref` 和 Core `event_id`；改期仍由 Core 按既有规则保持 `held`，不绕过教师冲突审核。未配对的旧事项不自动撤回。
- 预览显示日期范围、完整备注、时区和 UTC 偏移；同日同名同时间而仅备注不同的两项在视觉和可访问名称中均可区分。选择框只传 UI 索引，再映射到精确 Core 引用；合法旧引用 `__new` 不会误当新增。
- DOCX 解析移到随包的独立限时 helper，避免 Next 编译后动态解析 Mammoth 入口失败。worker 只接收私有临时文件和最小环境，日志只记录安全错误码与信号，不记录路径或正文。

## 实际证据

- macOS Apple Silicon、Node 22.23.1；`npm test`：1627 tests，1601 passed、26 skipped、0 failed；`tsc --noEmit`、`npm run lint`、release/preview `actionlint`、`git diff --check` 通过。依赖未变，上一 OCR 批同一锁文件的 `npm audit --audit-level=high` 为 0 vulnerabilities。
- 隔离 Core 的 `npm run test:edupi-document-revision-e2` 覆盖真实 DOCX 初次导入、两项同时改动、未配对 409、只读预览 2→2、错误候选指纹 409、显式配对后两条原 ID 保持且改期仍待审；无第三条重复，`external_send=false`。独立单元/路由测试覆盖 stale 来源不调用模型、重复/外来/缺失配对、`__new` 旧引用、仅备注/结束日期/时区差异及跨站和无效请求。
- `npm run desktop:prepare` 固定同一 Core；`npm run test:staged-docx` 用打包 Node/Mammoth 提取真实合成 DOCX，`npm run test:staged-ocr` 的图片/PDF OCR 与 `npm run test:staged-desktop-runtime` 的 Core/投影 ready、proactivity disabled、externalSend false 均通过。
- staged server 的隔离材料页实际完成“选来源→预览→两项分别选不同旧事项→确认接入”：Core 回读仍为两条原 ID，日程未擅自改期；服务重启后再次回读仍是两条，`external_send=false`，控制台 error/warn 为 0。另一份同日同名同时间、仅“一年级/二年级”备注不同的隔离夹具在 800×900 页面显示完整新旧备注；两个选择框 AX 名称分别带“修订”备注，`scrollWidth=800`。页面截图和 AX 回读在本次 Codex 任务记录中。

## 尚未验收

- 正式签名 macOS 安装包与 Windows/Linux 的实际 packaged/installed 流程尚未跑本提交；原有 v0.3.36 不包含它。
- 真实老师材料、真实模型输出稳定性、多人同时更新和学校环境仍需独立验收；PDF.js 文字 fallback 不缓存识别结果，模型结果在预览与提交间变化时会安全拒绝并要求重做预览。
- 本轮证明了逐项绑定与 Core 待审回读，但没有在打包页面继续点日历冲突的最终决议；那一步仍归 R21/L4 完整教师工作流验收。手机离开局域网的服务器接入仍排最后。
