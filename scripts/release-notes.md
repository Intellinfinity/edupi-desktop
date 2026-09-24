EduPi Desktop 0.3.39。

- 桌面设置新增可持久保存的本机 HTTP 更新代理。保存 `http://127.0.0.1:7897` 后，版本检查、更新清单和安装包下载走该代理；Core 与模型对话网络不受影响。
- 代理设置只接受本机无凭据地址；配置损坏时停止更新检查，可在设置中显式恢复系统网络。保存代理不会修改教师数据。
- v0.3.38 及更早的已安装客户端没有此设置，首次取得 v0.3.39 仍依赖其现有更新链路，或经核验的一次手动安装。保存的代理用于此后的升级。
- Core 仍固定到 `68004b2`，OpenConnector 外部 Action 保持关闭，只读目录可用；主动运行默认关闭，`external_send=false`。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 为 NSIS 安装程序；Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
