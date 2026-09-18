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


## v0.3.23 发布与 macOS 原位升级

- PR [#179](https://github.com/PIGU-PPPgu/edupi-desktop/pull/179) merge commit：7a3ee7dbdc7117e79a83471f9a40b30ad72e4a52。发布 workflow [35343391371](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35343391371) 在该提交上完成 release、Linux、macOS、Windows 和 manifest，结论全部 success。
- 公开 Latest [v0.3.23](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.23)：非 draft、非 prerelease，11 项资产，latest.json 覆盖 7 个平台键且每个平台均有签名 URL；组件清单为 Desktop 0.3.23、Pi 0.84.1、pi-web 0.8.7。
- 升级前基线：唯一 /Applications/EduPi.app 为 0.3.22，主进程 67460，更新接口 0.3.22/0.3.22/false；Core、projection、kernel 均 ready，数据计数 50 学生、240 任务、43 校历、9 课表。
- 从安装版 UI 点击“更新”后，真实下载进度从 7% 持续推进到 64%；WebView 收起后主进程仍保持 GitHub CDN 下载连接，连接关闭并自动重启后，唯一安装副本变为 0.3.23，新主进程 90598，未出现第二个 EduPi 应用。随后一次正常退出/启动复核，进程为 91339。
- 升级后 curl /api/updates 返回 0.3.23/0.3.23/false/available；Core/projection/kernel 均 ready，Core commit 19c0fd5182c6c20d6534973e506d6fa36acc1b06，数据计数保持 50/240/43/9，Kernel 18 total / 15 failed / 3 succeeded。
- 升级后模型配置保持：默认模型 zai-coding-cn/glm-5.3-flash，13 个可见模型。
- 0.3.23 安装版自带 server 在 1440×901 Chrome 中加载同一设置页并显示“一键处理权限 / 重新检测 / 停止控制”，确认发布包包含新交互；该检查仍用 Tauri invoke mock，不替代原生 TCC 请求。

## 实机权限边界

- 本次 ad-hoc 更新后，本机自动化对 EduPi 的 Accessibility 树变为不可读（System Events window count 0），CGWindowList 仍能看到原生窗口。这与现有风险记录一致：无 Developer ID/公证时，更新可能使系统授权失效。
- 因此未把“打开系统设置、用户真实授权、重启后保持”记为通过；需老师下一次在 0.3.23 设置页点击“一键处理权限”，按系统弹窗确认后验收。
- Windows/Linux 权限状态仍缺实机安装版证据。
