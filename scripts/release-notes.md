EduPi Desktop 0.3.44。

- OpenConnector 在管理中心有独立页面：浏览服务、查看操作列表、按范围搜索和查看参数。它仍是只读目录；账号连接和外部 Action 没有开放。
- JEV 增加离线可复核的教师意图预检工具；只使用合成短句，不作为聊天模型，也不改变 Core 决策。正式教师语义盲测仍待进行。
- Core 固定 `86a49de`；G2 与共享执行器仍待接入，`external_send=false`。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 提供 NSIS 安装程序，Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
