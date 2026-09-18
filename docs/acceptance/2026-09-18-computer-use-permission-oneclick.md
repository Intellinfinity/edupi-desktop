# 2026-09-18 桌面控制权限一键流开发验收

## 范围

- 设置页“桌面控制”把“开启/停止、辅助功能、屏幕录制、重启”收敛为一个随状态变化的主按钮。
- 主流程固定为先请求辅助功能；检测到授权后自动请求屏幕录制；屏幕录制请求发起后主按钮变为“授权后重启”。
- 辅助功能等待期间每 2 秒静默回读状态，不造成主按钮禁用闪烁。
- “重新检测”和“停止控制”保留为图标次级动作，均有 tooltip 与 ARIA 名称。
- 不声称应用能绕过 macOS 授权用户确认；真实授权仍在系统设置完成，屏幕录制按系统要求重启后生效。

## 证据

- 代码版本：v0.3.23 发布 PR；本文件随同 PR 合并。
- 运行环境：Node 22.23.1、Next dev、800×900 Chrome 153；Tauri invoke 使用状态机 mock 模拟 macOS 权限请求。
- 命令：node --test components/AppSettingsUpdate.test.mjs components/AppSettingsNotification.test.mjs lib/computer-use-permissions.test.mjs；9 passed / 0 failed。
- 命令：node_modules/.bin/tsc --noEmit；通过。
- 命令：npm run lint；ESLint 与 branding 测试通过。
- 页面操作：从管理中心 → 系统 → 检查更新打开设置；800×900 下主按钮唯一、旧的两个系统设置按钮不存在、三个动作按钮无矩形重叠。
- 状态流：点击“一键处理权限”后记录辅助功能请求；模拟系统授权后轮询自动记录屏幕录制请求；主按钮变为“授权后重启”；键盘 Enter 触发重启命令并写入 edupi-computer-use-enabled=true；模拟重启授权生效并手动重检后总开关为已开启，主按钮变为“停止控制”。
- 脚本错误 0、网络失败 0。开发环境 Core 相关 503 与页面关闭造成的 aborted 请求另行计数，不属于本功能回归。

## 边界

- 这是开发页面加 Tauri API mock 的交互与布局验收，不等于原生 System Settings 授权验收。
- macOS 实机需在 v0.3.23 安装版确认真实辅助功能/屏幕录制请求、用户授权、重启后状态保持。
- 当前 macOS 仍是 ad-hoc 签名；Developer ID 与公证未配置前，不能承诺权限跨版本长期稳定。
- Windows/Linux 平台权限状态为“无需”，已用状态机测试覆盖不阻塞开启，仍缺实机安装版验收。

