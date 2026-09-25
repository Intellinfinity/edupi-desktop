EduPi Desktop 0.3.41。

- 提醒列表首次读取时显示“正在读取提醒”，不再短暂误报“0 条”或“暂无提醒”；读取失败时只显示“提醒暂不可用”。
- 延续 v0.3.40 的 Today 注意力预算和 v0.3.39 的本机 HTTP 更新代理；已保存的 `http://127.0.0.1:7897` 可用于本次签名更新。
- Core 仍固定到 `68004b2`，OpenConnector 外部 Action 保持关闭，只读目录可用；主动运行默认关闭，`external_send=false`。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 为 NSIS 安装程序；Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
