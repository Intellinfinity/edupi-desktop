EduPi Desktop 0.3.46。

- Core 固定 `3397b71`（#204）。G1 默认关闭；教师明确启用单班单科授权后，才允许在桌面后台生成内部待审草稿，最多 12 次模型调用。旧授权须先停止再重新启用。通知点击续聊、失败延期和回执恢复已接入；教师决定前不自动对外发送。
- Windows 安装包保留 Core 的 `native_attestation_required` 安全边界，Windows G1 暂不可用；系统通知点击、真实跨到期睡眠和安装版教师反馈仍需正式安装后逐项验收。
- G2、G3、G4 Live 默认关闭；G5 监护关系、未核实材料及课次/学期归属不当作已验证。
- macOS Apple Silicon DMG 使用 Developer ID 签名与公证；Windows x64 提供 NSIS 安装程序，Linux x64 提供 Debian 包与 AppImage。
- 带 updater 插件的旧版可在应用内检查、下载、验签、安装并重启。v0.3.29 仍需一次手动安装新版。
