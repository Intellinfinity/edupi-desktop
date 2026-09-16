# R20 模块对象路由连续性验收

- 状态：开发版验收通过；尚未进入公开安装包。
- 代码版本：Desktop `7948a2ea15d39095db54376a307595c744f5aaee`，PR [#159](https://github.com/PIGU-PPPgu/edupi-desktop/pull/159)。
- 环境：macOS、Next.js development server、Codex in-app browser、公开 `v0.3.18` 固定 Core `19c0fd5182c6c20d6534973e506d6fa36acc1b06`；教师数据临时副本，验收后删除。

## 操作与结果

| 操作 | 预期 | 实际 |
| --- | --- | --- |
| 打开只有 `module=materials`、没有 `view` 的材料详情深链 | 首帧按材料模块解析并恢复精确 Core 对象 | 通过；URL 保留稳定 `item`，同一每日简报详情出现 |
| 刷新上述深链 | 不丢对象、不回默认分类 | 通过 |
| 在材料模块打开 `item=memory:teaching` | 拒绝跨模块对象，不显示假详情 | 通过；`item` 自动清理并回全部材料列表 |
| 浏览器控制台 | 无脚本错误 | 通过；`error` 日志为空 |

## 命令证据

- `npm test`：1250 tests，1225 passed，25 skipped，0 failed。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。

## 未验证条件

- 本轮实际页面选取材料作为代表；教学、记忆、洞察和成长共用同一个 `objectItemForView` 边界并有单元回归，尚未逐一做安装版视觉操作。
- 普通浏览器缺少桌面 API token，材料暂存请求返回 503；不作为安装版无失败请求证据。
