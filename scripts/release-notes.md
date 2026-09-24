EduPi Desktop 0.3.40。

- Today 的“待你决定 / 稍后处理 / 已记录”每列默认显示 4 项，其余按需展开；候选总数、Core 状态、来源和教师决定不变。
- “待你决定”优先显示截止日期距离今天最近的事项，减少旧积压占满首页；完整队列仍可展开处理。
- 延续 v0.3.39 的本机 HTTP 更新代理。可保存 `http://127.0.0.1:7897`，只用于版本检查、签名清单和安装包下载，不改变 Core 或模型网络。
- 代理设置只接受本机无凭据地址；配置损坏时停止更新检查，可显式恢复系统网络。保存代理不会修改教师数据。
- Core 仍固定到 `68004b2`，OpenConnector 外部 Action 保持关闭，只读目录可用；主动运行默认关闭，`external_send=false`。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 为 NSIS 安装程序；Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
