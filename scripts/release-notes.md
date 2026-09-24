EduPi Desktop 0.3.38。

- OpenConnector 外部 Action 继续关闭：生产 Agent 不再注册旧执行工具，旧 runtime/admin 环境令牌会在扩展加载前清除，HTTP Adapter 默认只读并在所有副作用前要求尚未实现的 Core 权威授权。
- 设置中新增 OpenConnector 只读目录，可搜索 Action 名称并查看输入字段。每次查询使用隔离临时目录和最小环境，同时只允许一个目录进程；不能配置账号、传入凭据或执行 Action。
- 课前准备决定后可记录是否实际使用、下次是否复用，以及原流程预计时间和本次投入时间。管理中心可以按班级、学科和六个领域报告系统漏掉的主动事项。
- 教师反馈继续由 Core 绑定当前 revision、fingerprint、领域、scope 和 evidence；失败重试复用同一 command，过期来源不会计入当前价值。
- Core 仍固定到 `68004b2`，主动运行默认关闭，所有新增路径保持 `external_send=false`。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 为 NSIS 安装程序；Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
