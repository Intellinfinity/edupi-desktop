# PDF/DOCX 日程修订来源验收

## 状态

- 结论：文本 PDF/DOCX 日程已经具备 Core 单一事实来源上的 logical source、稳定 occurrence、显式跨格式去重、旧状态接管、删除传播和 CAS 防护；文档修订只做增量 upsert，模型遗漏不会撤回旧安排。该项工程验收通过，整体仍为“L4 功能收敛中”。
- 交付载体为 [Desktop #226](https://github.com/Intellinfinity/edupi-desktop/pull/226)，实现提交 `0f9ec30`，风险修正提交 `f255674`，packaged trace cleanup 修正提交 `bd10438`；固定 Core 仍为 `b2c2bb809d4c4f8c09af7bc0e2741c025985dd3e`。
- 本批没有生成或安装正式 Release；公开 Latest 仍为 v0.3.36/Core `860594a…`。

## 来源与去重合同

- 新 PDF/DOCX 来源使用 `document-source-*`，来源与 occurrence 只从 Core v1.2 当前投影重建；Desktop 不建立第二份来源 baseline。
- 模型不能提供 `source_occurrence_ref`。Desktop 只在同一来源内 `name + type` 唯一时生成确定性 ref；同名同类多项、错源、多来源或无法唯一映射均 fail closed。
- 同字节改名保持来源；不同字节修订必须显式选择既有来源。来源 fingerprint 是 Core 当前 occurrence 内容的 CAS，stale fingerprint 在写入前拒绝。
- PDF/DOCX 与 ICS 的相同事项不会自动跨信任域合并：页面同时列出“日历”和“材料”来源，教师明确选择后才复用既有 occurrence。文档只可为完全一致的 ICS 事项补证，不得用 `inferred` 覆盖已确认日历；ICS 明确替换材料来源时继续使用全量撤回语义。
- 教师已确认的文档事项不能被后续模型降级。精确重放保留较高 confidence；有实质内容差异时先拒绝或进入 Core 冲突审核。

## 旧状态、遗漏与删除

- #223 前后的旧 `desktop-file-schedule-*` 行都可被识别。content-hash issuer 直接绑定；更早的 filename-only issuer 必须由 Core 中匹配当前 `source_hash` 的 `schedule-evidence-*` 证明，同字节改名可接管，错 hash 拒绝。
- 旧行不被后台删除或静默改写。首次接管复用 legacy canonical event ID，让 Core 形成 held conflict；教师明确 replace 后才完成 bound occurrence。首次接管必须完整覆盖该旧 issuer 的全部可见 anchors，多 lineage、半迁移漏项和跨字节 unresolved legacy 均拒绝。
- 普通文档更新永不把 omission 当撤回；旧事项继续存在。需要删除时仍走 Core 软删除与恢复。
- 接入前读取与 source snapshot 同 revision 的 Core deletion ledger。当前 tombstone 的 ID，或 baseline 缺失事项的删除标签，都会阻止同语义不同字节文件复活；只有明确 restore 后才能继续更新。旧无标签 tombstone 存在时，新 document occurrence 同样 fail closed。

## 验证

- 真实 DOCX E2 从文字提取、受控模型 JSON、Core v1.2、真实 `/api/edupi/intake` POST 到重启读取，覆盖新建与 source update、精确重放、遗漏保留、stale CAS、改期 held、PDF/DOCX↔ICS 去重、pre-c8 filename issuer、legacy held adoption、删除后跨字节重传拒绝及明确恢复；最终 `external_send=false`。
- 隔离浏览器实际打开材料页，来源选择器同时显示“日历”和“材料”，选择修订来源后显示“未识别到的旧安排不会自动撤回”；控制台 error/warn 为 0。
- `desktop:prepare`、staged desktop、staged uploaded-calendar、staged occurrence 通过；packaged Core closure、依赖闭包与独立 model host 8/8 通过。
- 全量 1543 tests，1517 passed / 26 skipped / 0 failed；TypeScript、lint、npm audit、release workflow actionlint 和独立只读终审通过，终审无剩余 P0/P1 合并阻断，P2 边界列在下方 Unverified。
- symlink worktree 的 Next trace 曾在仓库根生成 `edupi-desktop/node_modules`。packaging 现在用 exclusive directory、dev/ino 与随机 0600 marker 绑定 cleanup；预存或被 swap 的目录拒绝删除。真实 `desktop:prepare` 后工作树无 trace leak。

## Risk

- 删除标签 guard 在 baseline 缺失时采取保守阻断；同名但确为新事项的文件可能需要先处理删除记录。
- 进程被不可捕获的 SIGKILL 终止时可能留下带 marker 的生成目录；下一次 build 会安全拒绝，不会自动删除或覆盖。

## Unverified

- occurrence ref 目前只有 `name + type`。同一文件中两次不同日期的同名同类事项会整份 409；尚无教师逐项消歧界面，不能宣称覆盖所有日程文件。
- H2 首次显式绑定到 H 后没有持久化 H2→H source-hash alias；以后 exact replay H2 仍需再次选择来源，影响无感和丢响应自动恢复。
- 图片、扫描 PDF 和 legacy `.doc` 尚无可信 OCR 坐标/文字证据，仍不能输出 typed time/location。
- 真实 provider 质量、Windows/macOS 正式安装版、公开升级、正式盲测和真实教师价值尚未验证。
