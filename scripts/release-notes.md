EduPi Desktop 0.3.43。

- 管理中心将任务、材料、教学能力、教师与学生、校历与课表、学校平台归到同一页；后台任务回到自动运行页。
- OpenConnector 只读目录和 JEV 设置集中到“连接”页，工作台主导航可直接打开通用设置；常用语言、外观和教师信息更紧凑。
- OpenConnector 账号连接与外部 Action 仍关闭，JEV 只用于浏览器决策、不参与对话。Core `86a49de` 的 G2 与共享执行器仍待接入，`external_send=false`。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 提供 NSIS 安装程序，Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
