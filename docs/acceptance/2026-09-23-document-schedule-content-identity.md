# PDF、图片与 Word 日程来源身份验收

## 状态

- 结论：非 ICS 材料的 schedule issuer 已改为内容哈希优先；同字节文件改名后保持同一来源，同名不同字节不再误共享来源。该项为“部分实现已验收”，整体仍是“L4 功能收敛中”。
- Desktop 交付为 [#223](https://github.com/Intellinfinity/edupi-desktop/pull/223)，实现提交为 `c8cb6f0`，基于已合并的 ICS PR [#222](https://github.com/Intellinfinity/edupi-desktop/pull/222) 与 Core `b2c2bb809d4c4f8c09af7bc0e2741c025985dd3e`。

## 行为与证据

- `stableFileScheduleIssuer` 在存在合法 SHA-256 时只以内容哈希生成技术来源；文件名仅在旧调用没有内容哈希时作为兼容回退。
- PDF、图片和 Word 的材料接入一律传入暂存阶段已校验的 `source_hash`。同字节改名上传会复用 schedule issuer、语义日程 ID、课表 ID 和 schedule evidence；材料本体仍按每次暂存保留独立 provenance。
- 不同字节即使文件名相同也生成不同 schedule issuer，避免两个无关“通知.pdf”共享来源。
- 定向 RED→GREEN：`app/api/edupi/intake/route.test.mjs` 与 `lib/edupi-material-intake-flow.test.mjs` 15/15 通过。
- 全量：`npm test` 1509 项，1483 passed / 26 skipped / 0 failed；`node_modules/.bin/tsc --noEmit` 与 `npm run lint` 通过。

## Risk

- 这次只改变技术来源身份，不自动删除旧 issuer，也不改既有日程/课表的语义 ID；已有用户数据不会被批量迁移或重写。
- 相同内容用于不同班级时仍共享文件级 schedule issuer，但课表的班级、学科、星期和节次继续进入语义 ID；材料 provenance 保持独立。

## Unverified

- 模型识别结果本身仍可能在两次调用间发生语义漂移；本批没有建立 Core 持久的 content-addressed recognition receipt。
- PDF、图片和 Word 仍没有可验证的 occurrence ref、带时区时间段、地点证据或同来源 omission 撤回合同；不能据此宣称“所有上传行程已完整闭环”。
- Windows 安装版识别组件、正式盲测与真实教师价值未验证。
