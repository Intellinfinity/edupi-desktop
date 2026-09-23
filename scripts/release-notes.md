EduPi Desktop 0.3.35。

- 修复 macOS 签名包内 Node helper 缺少 JIT 权限导致首次启动崩溃；发布前实际运行签名后的 helper 和安装包内服务器
- 修复 v0.3.31-v0.3.32 安装包漏带 Next.js 运行时依赖、首次启动退出的问题
- 日程导入使用稳定 occurrence 标识，改期冲突由教师显式审核并支持重放、过期拒绝和重启回读
- 审核其他事项后继续保留日程时间、时区和地点；旧主动授权缺凭据时不阻断普通工作区，也不自动重绑
- 手机入口经独立局域网网关只开放配对、会话和提醒路径；桌面 API 与配对管理要求桌面进程令牌
- 手机批准后立即显示已有对话；请求中断不自动重发消息，退出时撤销手机授权；网关不可达时不显示可用地址或生成配对码
- Safe Mode 只加载 Core 清单内的内置 Skills，不运行教师目录中的第三方 Skills
- Core 固定到 `860594a`，保留 v1.1 桥接并增加可选 occurrence v1.2；ambient planning 和外部发送保持关闭
- 正式 macOS 发布缺签名或公证凭据时停止，发布前验证应用与 DMG 的公证 ticket 和签名

- macOS Apple Silicon DMG
- Windows x64 安装程序
- Linux x64 Debian / AppImage
- 支持带更新插件的旧版在应用内检查、下载、安装并重启；v0.3.29 需要一次手动安装

macOS 应用使用 Developer ID 签名并公证；更新包签名与 Windows 代码签名是独立机制。
