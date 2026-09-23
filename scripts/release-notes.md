EduPi Desktop 0.3.37。

- “找 AI 继续聊 / AI 协作”不再把固定长模板塞进输入框。老师可以直接写本次要求，事项参考单独附上并可移除；旧草稿保留。
- PDF、DOCX 和扫描图片材料的日程提取增加离线 OCR、逐项配对及课表来源核对。不确定的来源和冲突继续交给老师确认，不自动覆盖已有事项。
- Core 固定到 `68004b2`，保留 `edupi-bridge-v1.1`；单班单科主动运行试用默认关闭，Core 主动运行不执行外部发送。
- OpenConnector 外部 Action 执行统一要求教师可见确认，输入快照与幂等键绑定；同用户 shell 与 runtime 凭据的强隔离尚未完成，该集成仍默认关闭，不作为本版可用能力宣传。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 为 NSIS 安装程序；Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
