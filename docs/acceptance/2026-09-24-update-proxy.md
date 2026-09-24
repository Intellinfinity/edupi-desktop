# 更新代理一次保存验收

状态：更新代理随 Desktop #251 与 Windows 覆盖修复 #255 进入公开签名 v0.3.39；macOS 安装版已完成原生保存、退出重启回读，并经 7897 查询 GitHub Release。经代理下载、验签、安装后续版本仍待 v0.3.40 公开后验证。Core 固定 `68004b2c0294159eef4f88bcbf4a921ef6978037`，本改动不修改教师数据。

## 合同与边界

- 原生设置只接受不含凭据、路径或参数的 `http://127.0.0.1:<port>`；留空清除专用 `app_config_dir/updater-proxy.json`，不写保存教师数据根目录的 `ui-prefs.json`。非空值写到同目录独占临时文件，`sync_all` 后原子替换；专用文件存在但缺字段、为空或损坏时，检查失败而不静默直连。设置页提供重试读取和明确的“恢复系统网络”。
- 独立审查发现 `std::fs::rename` 在 Windows 不能覆盖已有目标，会让第二次保存失败。已合并的 #255 改为 Windows `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`，其他平台继续使用同目录 `rename`；新增门禁和 Windows CI 编译用于防止退化。
- Tauri updater 每次安装前重新读取原生设置，并将同一个代理传给 `check({ proxy })`；当前插件将该代理用于清单检查和资产下载。设置页与启动提醒共用的 `/api/updates` 每次从专用文件读取代理，只给本次 GitHub Release 查询传 Undici `ProxyAgent`，响应消费/取消后关闭，不改变全局 dispatcher。设置成功后立即强制刷新一次版本检查；旧请求迟到不会覆盖新结果。参考 [Tauri updater 源码](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/guest-js/index.ts) 与 [Undici ProxyAgent](https://github.com/nodejs/undici/blob/main/docs/docs/api/ProxyAgent.md)。

## 已执行证据

| 环境与操作 | 实际结果 |
| --- | --- |
| macOS / Node 22.23.1，隔离本机 HTTP 代理模拟 GitHub `CONNECT`；查询最新 Release | 只向 `127.0.0.1` 配置端口发出 `CONNECT api.github.com:443`；代理返回 502 后错误脱敏，未发直连请求。|
| 本机较早显式使用 `http://127.0.0.1:7897` 请求 GitHub Latest API | 当次 HTTP 200，连接端点为 `127.0.0.1`；后续验收时该端口已无监听，不能将一次成功视为持续可用。 |
| 隔离 `PI_CODING_AGENT_DIR`、`PI_DESKTOP_STATE_DIR`；强制刷新先遇代理失败，再改为无代理的本地模拟成功，随后代理再次失败 | 首次失败不写 `lastCheckedAt`；成功写入新版并可见；后续失败保留已缓存更新且不改上次成功检查时间。无请求写入正式 Pi 目录。 |
| 隔离 800×900 Next 页面、模拟 Tauri 原生命令；先模拟读取失败，再“重试读取 → 恢复系统网络 → 保存 7897”，重载页面 | 错误在折叠卡片标题可见；恢复后输入可用；非法远端地址禁保存并用 `aria-invalid` 指向错误；`http://127.0.0.1:7897` 恢复显示，无整页横向溢出。模拟旧直连请求晚失败、新代理请求先成功，最终仍显示新版。此模拟不等于真实原生配置文件验收。 |
| Rust 配置测试与发布静态门 | 拒绝远端、凭据、空端口、路径和参数；独立配置文件保存/更改/清除/损坏恢复均不改 `ui-prefs.json`。`cargo test --locked` 30/30；`npm test` 1735 tests、1709 passed / 26 skipped / 0 failed；TypeScript、lint、npm audit（0 漏洞）、release verify 通过。 |
| 无签名安装包预览 [35973703981](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35973703981) | 精确实现提交 `4e2b7af` 的质量、macOS `.app`/DMG 与 Windows NSIS 包任务全部成功；macOS 最终 `.app` 中用包内 Node 启动只读目录，Windows staged 目录与 exe 版本门禁通过，预览资产分别约 208 MB / 126 MB。预览构建不等于签名/公证、安装后的代理设置可用。 |
| Windows runner [`35976790629`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35976790629) | 安装/启动公开 v0.3.38 后，以公共资源夹具执行修复分支 `cargo check --lib --locked`；包含 `MoveFileExW` 的 Windows 原生代码编译成功。 |
| v0.3.39 正式发布与安装 | [35979258168](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35979258168) 三平台、Mac 公证、签名 feed 全绿；Linux [35984333853](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35984333853) 和 Windows [35986226781](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35986226781) 公网安装通过。本机 v0.3.37→v0.3.39 经原生更新重启、Core 与 51/240/43/9 保持；这次使用旧链路而非保存后的代理。详见 [v0.3.39 验收](2026-09-24-v0.3.39-signed-release.md)。 |
| v0.3.39 安装版保存与重启回读 | 在 7897 对 GitHub API 实际返回 200 后，原生页面保存 `http://127.0.0.1:7897`，界面显示“已保存”；专用文件为 44 字节、SHA-256 `c8eefffd…`。退出并重启后，字段仍回读同一地址，Core/投影/Kernel ready，51/240/43/9、`external_send=false` 与模型/认证/设置三份摘要保持。 |
| v0.3.39 安装版经代理查询版本 | 重启后强制调用 `/api/updates?refresh=1`，返回当前/最新均为 `0.3.39`、无可用更新；同时 Clash Verge/mihomo 日志记录 `127.0.0.1 -> api.github.com:443` 走境外代理规则。这证明已安装服务器的 Release 查询读取了专用代理；当时还没有新资产，不证明 Tauri 下载/安装。 |
| v0.3.40 公开大资产经 7897 下载 | 公开 DMG 在一次 partial transfer 后以 byte-range 续传完成；最终大小 209,955,075 字节，SHA-256 `52463d58…` 与 GitHub 资产声明完全一致。挂载后为 v0.3.40，严格签名和 Gatekeeper 公证通过。这是同一代理的公开下载证据，但不替代 Tauri updater 本身的验签/安装。 |

## 尚未验证

- v0.3.39 已通过旧客户端链路安装；7897 原生保存、关闭重开回读、GitHub Release 查询与公开 DMG 下载已通过。Tauri updater 自身的签名清单、资产下载、验签、覆盖安装与自动重启仍未完成；只有这一跳能证明应用内全链路也使用了该配置。
- v0.3.38 及更早版本没有此设置；本机首次取得支持版的升级已验证，不能回溯证明旧包支持代理。Windows/Linux 原生设置的实际持久化和旧版应用内升级未实测；公开干净安装不能替代。现有 `ui-prefs.json` 其他写入路径的非原子性是历史问题，本新设置通过独立文件避免扩大其影响。
