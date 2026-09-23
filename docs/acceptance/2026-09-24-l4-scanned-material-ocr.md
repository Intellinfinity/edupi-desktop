# L4 扫描材料 OCR 来源验收

状态：源码与本机 staged 桌面资源验收通过；未发布或安装。Desktop 提交 `77e88f8`，Core 固定 `c1edefd2a2b77e3d10dfc9f0a47eceb7b5f7b1de`，公开 Latest 仍为 v0.3.36。

## 行为与边界

- 图片和三页内的扫描 PDF 在独立、限时的本地进程里用打包的 Tesseract.js、中英文语言数据及 PDF.js 渲染，不在运行时下载语言文件；扫描原图不发给识别模型。Tesseract TSV 的词级置信度与区域在识别期校验，Core 的稳定引文只写原文行、页码和材料 SHA-256。实现依据为 [Tesseract TSV 输出](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html#tsv-output)、[Tesseract.js 本地安装](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) 与 [PDF.js Node 渲染示例](https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.mjs)。
- 仅单条高置信行同时证明事项名称与完整有效日期时，生成 `inferred` 日程候选；模型遗漏引文、日期缺年/无效/数字前缀、多日期混淆、跨行拼接、OCR typed 时间地点和课表均不自动导入。无可信 OCR 时只接入材料，界面明确提示文字识别未完成，不宣称“未发现日程”。
- 有系统 `pdftotext -layout` 时继续使用原文字 PDF 路径；无系统组件的干净环境使用打包 PDF.js，以坐标重建行并要求同一行列引文。该 fallback 不读写旧 PDF 识别缓存，超 30,000 字直接拒绝，不导入截断的部分日程。

## 实际证据

- macOS Apple Silicon、Node 22.23.1；`npm test`：1616 tests，1590 passed、26 skipped、0 failed。针对 OCR/PDF、模型提示和发布工作流的 96 项测试全部通过。`tsc --noEmit`、`npm run lint`、`npm audit --audit-level=high`、`npm run release:verify`、`cargo metadata --locked`、两份工作流 `actionlint` 与 `git diff --check` 通过；audit 为 0 vulnerabilities。
- 在隔离的、精确固定的 Core checkout 运行 `npm run test:edupi-ocr-schedule-e2`：真实本地 OCR 处理一张合成图片和一份图片版 PDF，Core 回读两条日程，均为 `inferred`、`preparation_status=hold`、`external_send=false`。测试根使用临时目录，未写教师档案。
- `npm run desktop:prepare` 生成 Core `c1edefd…` 与离线 OCR 资源；`npm run test:staged-ocr` 使用打包 Node、PDF 渲染、WASM 与中英文数据实际完成图片和 PDF 页面 OCR；`npm run test:staged-desktop-runtime` 回读 Core/投影 ready、occurrence v1.2、proactivity disabled、externalSend false。
- staged server 的隔离浏览器在材料页接入两张空白合成图片：页面显示“文字识别未完成，日程和课表未导入”，两份材料刷新后仍在列表；800×900 视口折叠材料侧栏后警示文字完整可读，页面 `scrollWidth=800`，控制台 error/warn 为 0。未因空白图片生成日程。测试页面截图与 AX 回读在本次 Codex 任务记录中。

## 尚未验收

- 这不是正式签名安装包或 Windows/Linux 实机结果；新 OCR 依赖尚未通过三平台 Release、Apple 签名后的应用、干净安装与旧版应用内升级。
- OCR 的真实中文教学材料质量、真实模型的语义提取和老师逐项核对未完成。没有完整年份、低置信或多页部分失败时保守拒绝；OCR 的结构化时段/地点和课表仍等待更强的 Core 证据合同。
- 材料接入后警示只在当前页面会话可见；刷新后材料仍可回读，但 OCR 失败状态没有进入 Core 材料投影。扫描 PDF 的 OCR 引文跨识别版本变化仍可能使同名多项配对进入人工核对；不应伪称多项同时变化已自动解决。
