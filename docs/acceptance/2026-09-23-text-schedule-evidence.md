# 文本材料时间与地点证据验收

## 状态

- 结论：文本 PDF 与 DOCX 可以把原文明确证明的日期、起止时间、时区和地点写入 Core v1.2；结果始终为 `inferred / hold`，不自动接受、不外发。该项工程验收通过，整体仍为“L4 功能收敛中”。
- Desktop 交付为 [#225](https://github.com/Intellinfinity/edupi-desktop/pull/225)，实现提交为 `fe53b51`，基于已合并的内容来源身份 [#223](https://github.com/Intellinfinity/edupi-desktop/pull/223) 和 Core `b2c2bb809d4c4f8c09af7bc0e2741c025985dd3e`。

## 证据合同

- `time_interval` 与非空 `location` 必须原子同时存在；同一条不超过 300 字的 `evidence_quote` 必须能在重新提取的原文中归一化匹配，并同时包含事项名称、日期、完整起止时段、明确 IANA 时区或 UTC 偏移及地点。
- start/end 分别校验本地时间、IANA zone 和实际 offset；DST gap/fold 均 fail closed，合法同日跨 DST offset 变化可通过。`Z` 在验证后规范为 Core 接受的 `+00:00`。
- UTC/GMT、裸 offset、半小时 offset、Unicode minus 和冲突 offset 均做有界解析；任一显式 offset 与 start/end 实际集合矛盾即拒绝。数值日期和时段表达使用边界匹配，不能由长数字或 offset 冒充。
- 图片、扫描 PDF、legacy `.doc`、缺少地点或时间任一字段、跨日 timed event 和无法复核正文的缓存均拒绝 typed 字段。
- typed recognition cache 保存原始模型 JSON，不直接信任结构化结果；命中时先重新提取 PDF/DOCX，再用当前策略重放 JSON 和证据验证。源文件字节变化会在 cache 前被 source hash 拒绝。

## 验证

- 定向识别、身份、缓存、发布门和材料接入测试通过；独立终审未发现剩余 P0/P1/P2。
- `npm test`：1520 项，1494 passed / 26 skipped / 0 failed；TypeScript、lint、audit、actionlint 通过。
- `npm run test:edupi-text-schedule-evidence-e2` 使用真实 DOCX 提取与受控模型 JSON，完成两条 typed 事项写入 Core、同字节改名重放仍为两项、cache 重新提取重放、改源拒绝及 Runtime 投影回读；上海时区和纽约跨 DST 时段均保持，全部 `inferred / hold / external_send=false`。
- release workflow 已加入该 E2 及对应 sentinel；`desktop:prepare`、packaged Core closure 3/3、model host 2/2 通过；symlink worktree 打包补齐 direct external `undici` 闭包，独立 staged server 回读 Core/projection ready、occurrence 1.2、`externalSend=false`。

## Risk

- 模型只能提出候选；证据字符串匹配和时区校验不能替代教师对原文语义的判断，因此不会自动转为 confirmed/teacher_confirmed。
- recognition cache 留在 0700/0600 的暂存目录并随材料结算删除；typed cache 可能包含最多 300 字的原文摘录，不进入 UI 业务投影。

## Unverified

- 视觉图片与扫描 PDF 尚无可信 OCR 坐标/文字证据，仍不允许 typed time/location。
- PDF/DOCX 仍未建立跨修订 logical source、稳定 occurrence ref 或 omission 撤回合同；同字节改名可去重，不等于任意修订可自动合并或删除。
- 真实 provider 输出质量、Windows 安装版提取组件、正式盲测和真实教师价值未验证。
