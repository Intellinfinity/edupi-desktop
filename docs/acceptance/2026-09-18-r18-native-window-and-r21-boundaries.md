# R18/R21 v0.3.20 窄窗复核与通知边界

- 状态：1458×900 与 800×900 安装版页面键盘/焦点/重叠复核通过；原生 800px 需要等待 v0.3.21。通知送达可进入原生等待线程，但通知中心和点击跳转仍未能验收。
- 代码版本：Desktop v0.3.20，Release commit 3b173f6a95cb566bc69188542a5268d44c11c199；800px 原生修复 PR #172，merge commit 1747af87bbb46e8d9dce516fa5b91bf04f2d357c。
- 环境：macOS 安装版内置 server、Chrome DevTools 精确视口、Orca 原生窗口与系统通知数据库。

## 操作与结果

| 范围 | 实际操作 | 结果 |
| --- | --- | --- |
| 1458×900 页面 | CDP 设置精确视口，遍历全部可操作控件 | 通过；37 个可见控件重叠 0；Tab 从输入区经附件、权限、模型、推理、工具、压缩、声音、主导航、会话列表回到输入区形成循环 |
| 800×900 页面 | CDP 设置精确视口并考虑 overflow 裁剪后的实际可点击矩形 | 通过；33 个可见控件重叠 0；Tab 从主导航经会话、主动协作、输入区和底部控件循环；未将滚动裁剪外的会话行误判为重叠 |
| 浮层 Escape | 在两个视口聚焦聊天右上主动协作入口后打开浮层，再发送真实 Escape 键 | 通过；浮层关闭，焦点返回“主动协作，16 项动态”入口 |
| 原生 1458×900 | AppleScript 设置 EduPi 原生窗口为 1458×900，Orca 逐次 Tab | 通过；窗口实际 1458×900，焦点从输入区经底部控件、主导航、会话列表、主动协作后回到输入区 |
| 原生 800×900 | AppleScript 设置 800×900 | 未通过；macOS 实际返回 900×900。源码为 min_inner_size(900,600)，PR #172 已改为 800×600 并加常量回归 |
| 通知发送 | 在教师设置点击“测试通知跳转” | 原生命令返回“已请求发送”；进程采样出现 edupi-notification 线程并停在等待交互，说明进入原生等待路径 |
| 通知显示与点击 | 立即截屏/Vision OCR、打开通知中心、查询 usernoted DB 与系统通知设置 | 未验收；屏幕 OCR 未见 EduPi 通知，usernoted 未新增 com.abcwyc.pi-agent 记录，系统通知应用列表可见部分未找到 EduPi。不能证明通知中心实际显示或 edupi://reminder-open 点击回调 |
| 真实睡眠唤醒 | 检查 sudo、pmset 与既有唤醒计划 | 外部阻塞；sudo 需要密码，系统睡眠当前被 powerd 阻止，已有系统唤醒计划不属于本测试，不能安全强制睡眠后保证唤醒 |

## 关键证据

- 精确视口：1458×900 scrollWidth/Height 均等于视口；800×900 同样无横向溢出。
- 页面控件重叠检查把 ancestor overflow 裁剪和 elementFromPoint 命中纳入计算，避免把被会话列表滚动裁剪的行误报为可见重叠。
- 原生窗口实际尺寸来自 Orca accessibility snapshot。
- 通知等待线程来自 macOS sample 86074，线程名为 edupi-notification，栈位于 pthread cond wait。
- 修复验证：cargo metadata --locked --no-deps 与 cargo fmt --check 通过；定向 Rust 测试因本机 TUNA Cargo 索引停留在 rustls 0.23.42 而 0.3.20 锁需要 0.23.45，无法离线解析，交给 release CI 编译验证。

## 未验证条件

- v0.3.21 发布安装并通过应用内更新前，不能宣称原生 800×900 已通过。
- 本轮未持续采集浏览器 console/network 事件；键盘、焦点和重叠为实际 DOM/原生 accessibility 证据，不冒充零脚本错误。
- Windows/Linux 原生窗口、通知中心和睡眠唤醒仍待目标系统实测。
