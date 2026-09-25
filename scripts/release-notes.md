EduPi Desktop 0.3.45。

- OpenConnector 改为上游 v1.6.5 Console 的独立桌面窗口，可查看 Overview、Providers、Actions 与 Runs；不再以 EduPi 自建目录页充当官方界面。账号连接、OAuth 与外部 Action 仍未开放。
- Console 只使用独立 loopback 只读服务，窗口不继承 EduPi 主窗口的 Tauri 权限；官方源码与构建差异、许可和资产摘要随包记录。
- Core 固定 `86a49de`；G2 与共享执行器仍待接入，`external_send=false`。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 提供 NSIS 安装程序，Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
