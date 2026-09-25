EduPi Desktop 0.3.42。

- Core 精确配对到 `86a49de`。管理中心按实际执行器健康状态分别显示课前准备、学生跟进和其他任务；单个课次缺少关联时不再误报整机自动检查异常。
- OpenConnector 只读目录修复打包路径别名导致的启动退出；外部 Action 仍隔离，JEV 不参与对话。
- G2 学生跟进和共享能力尚未启用，主动运行默认关闭，`external_send=false`。本版不会自动发送学生资料或执行外部 Action。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 提供 NSIS 安装程序，Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
