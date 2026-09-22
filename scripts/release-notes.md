EduPi Desktop 0.3.31。

- 手机入口经独立局域网网关只开放配对、会话和提醒路径；桌面 API 与配对管理要求桌面进程令牌
- 手机批准后立即显示已有对话；请求中断不自动重发消息，退出时撤销手机授权；网关不可达时不显示可用地址或生成配对码
- Safe Mode 只加载 Core 清单内的内置 Skills，不运行教师目录中的第三方 Skills
- Core 配对更新至 G6，保留 12 个桥接命令和教师确认；教师评价绑定可信范围，家校沟通发送未开放给桌面端
- 正式 macOS 发布缺签名或公证凭据时停止，发布前验证应用公证 ticket 与 DMG 签名

- macOS Apple Silicon DMG
- Windows x64 安装程序
- Linux x64 Debian / AppImage
- 应用内检查、下载、安装并重启更新

macOS 应用使用 Developer ID 签名并公证；更新包签名与 Windows 代码签名是独立机制。
