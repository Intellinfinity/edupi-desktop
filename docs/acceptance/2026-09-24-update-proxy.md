# 更新代理一次保存验收

状态：基于公开 v0.3.38 后最新 Desktop 主线的开发态实现；尚未签名、安装或发布。Core 仍固定 `68004b2c0294159eef4f88bcbf4a921ef6978037`，本改动不修改教师数据。

## 合同与边界

- 原生设置只接受不含凭据、路径或参数的 `http://127.0.0.1:<port>`；留空清除专用 `app_config_dir/updater-proxy.json`，不写保存教师数据根目录的 `ui-prefs.json`。非空值写到同目录独占临时文件，`sync_all` 后原子替换；专用文件存在但缺字段、为空或损坏时，检查失败而不静默直连。设置页提供重试读取和明确的“恢复系统网络”。
- 独立审查发现 `std::fs::rename` 在 Windows 不能覆盖已有目标，会让第二次保存失败。集成分支改为 Windows `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`，其他平台继续使用同目录 `rename`；新增门禁和 Windows CI 编译用于防止退化。
- Tauri updater 每次安装前重新读取原生设置，并将同一个代理传给 `check({ proxy })`；当前插件将该代理用于清单检查和资产下载。设置页与启动提醒共用的 `/api/updates` 每次从专用文件读取代理，只给本次 GitHub Release 查询传 Undici `ProxyAgent`，响应消费/取消后关闭，不改变全局 dispatcher。设置成功后立即强制刷新一次版本检查；旧请求迟到不会覆盖新结果。参考 [Tauri updater 源码](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/guest-js/index.ts) 与 [Undici ProxyAgent](https://github.com/nodejs/undici/blob/main/docs/docs/api/ProxyAgent.md)。

## 已执行证据

| 环境与操作 | 实际结果 |
| --- | --- |
| macOS / Node 22.23.1，隔离本机 HTTP 代理模拟 GitHub `CONNECT`；查询最新 Release | 只向 `127.0.0.1` 配置端口发出 `CONNECT api.github.com:443`；代理返回 502 后错误脱敏，未发直连请求。|
| 本机显式使用 `http://127.0.0.1:7897` 请求 GitHub Latest API | HTTP 200，连接端点为 `127.0.0.1`；证明当前 VPN 代理可用，不等于尚未发布的桌面设置已执行应用内升级。 |
| 隔离 `PI_CODING_AGENT_DIR`、`PI_DESKTOP_STATE_DIR`；强制刷新先遇代理失败，再改为无代理的本地模拟成功，随后代理再次失败 | 首次失败不写 `lastCheckedAt`；成功写入新版并可见；后续失败保留已缓存更新且不改上次成功检查时间。无请求写入正式 Pi 目录。 |
| 隔离 800×900 Next 页面、模拟 Tauri 原生命令；先模拟读取失败，再“重试读取 → 恢复系统网络 → 保存 7897”，重载页面 | 错误在折叠卡片标题可见；恢复后输入可用；非法远端地址禁保存并用 `aria-invalid` 指向错误；`http://127.0.0.1:7897` 恢复显示，无整页横向溢出。模拟旧直连请求晚失败、新代理请求先成功，最终仍显示新版。此模拟不等于真实原生配置文件验收。 |
| Rust 配置测试与发布静态门 | 拒绝远端、凭据、空端口、路径和参数；独立配置文件保存/更改/清除/损坏恢复均不改 `ui-prefs.json`。`cargo test --locked` 30/30；`npm test` 1735 tests、1709 passed / 26 skipped / 0 failed；TypeScript、lint、npm audit（0 漏洞）、release verify 通过。 |

## 尚未验证

- 本机经 `127.0.0.1:7897` 访问 GitHub 已通过；该设置尚未进入当前 v0.3.38 安装包，因此未把真实应用内下载、验签与重启记为通过。下一签名版需在原生设置保存一次并执行旧版到新版更新，核对 Core、教师数据、模型配置与唯一安装副本。
- Windows/Linux 原生设置的持久化和包内更新链路未实测；本批尚无正式安装包。现有 `ui-prefs.json` 其他写入路径的非原子性是历史问题，本新设置通过独立文件避免扩大其影响。
