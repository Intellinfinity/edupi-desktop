# Univer 在 EduPi 桌面端的嵌入判断

状态：已评估，未实施。路线 1 的安全和正式安装验收优先；本条不改变 Core pin、教师数据或发布包。

## 结论

把 Univer 当成教学产物页中的按需编辑器，不把 Univer CLI、Workspace 服务或新的 Office 数据库当作 EduPi Core。先验证开源 Sheets 编辑器的单文件内嵌；Word/PPT 的文件生成继续使用现有 `edupi_make_document`、`edupi_make_ppt`，不能把 Univer 开源编辑器说成已具备完整 DOCX/PPTX 导入导出。

依据：Univer 主仓库为 Apache-2.0 SDK，Sheets 的开源编辑能力最成熟；Docs 有开源模型/UI，Slides 开源模型/UI仍在演进。Office 文件导入导出、Slides 高级能力、协作与服务端转换分别列在 Pro 范围。Docs 的 DOCX 转换文档明确要求 Pro exchange client 与转换后端。Univer CLI 另需 Node.js 24 和浏览器渲染依赖，其 `execute` 运行受信任 JavaScript，不是给老师材料用的沙箱；其开发运行许可轮换也不应混入现有 Desktop Node 22 包。

来源：[Univer OSS/Pro 范围](https://github.com/dream-num/univer#-open-source-and-pro)、[Next.js 嵌入方式](https://docs.univer.ai/guides/sheets/getting-started/integrations/nextjs)、[Docs 导入导出](https://docs.univer.ai/guides/docs/features/import-export)、[Univer CLI](https://github.com/dream-num/univer-cli)。

## 建议接入顺序

1. 在“教学产物”打开现有文件标签，不新增后台管理入口。先为 EduPi 原生结构化表格草稿提供只读/编辑切换；Next.js Client Component 用 `dynamic(..., { ssr: false })` 按需加载，在 `useEffect` 初始化并在卸载时销毁。不开启协作或远端服务。
2. Core 继续持有产物身份、范围、版本与审核决定。编辑器只维护暂存视图；保存须通过 Core 明确的版本 CAS/回执，重新读取后才显示“已保存”。失效来源、撤销对象、跨班范围和重启冲突一律保留草稿并阻止覆盖。
3. 对“生成 Word/PPT”仍先走现有 DOCX/PPTX 工具和预览/下载。若要在桌面内编辑真实 `.docx/.xlsx/.pptx` 并保持格式往返，先单独评估 Pro 转换许可、后端部署、离线要求和学校数据边界；未满足前不展示“可编辑 Office 文件”的承诺。

## 验收门

隔离数据下，老师从对话生成表格草稿 → 产物页打开 → 修改一个单元格 → Core CAS 保存并重读 → 审核 → 重启仍同一版本；并验证冲突、撤销来源、跨班拒绝、800×900/1440×900、macOS WebKit 与 Windows WebView2 的输入法/滚动/性能。Word/PPT 另核对实际导出文件的排版与答案，不能以编辑器能显示内容替代教学内容或 Office 格式验收。
