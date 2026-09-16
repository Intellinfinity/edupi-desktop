# R22 更新下载中断验收

- 状态：旧安装版故障已复现；新代码定向验证通过，签名安装版升级仍待验收。
- 代码版本：Desktop `ab5f6ae728a5306a0707bc63bad970b43d6baf33`，PR [#163](https://github.com/PIGU-PPPgu/edupi-desktop/pull/163)。
- 环境：macOS `/Applications/EduPi.app` 0.3.17，Next.js 打包服务和 Tauri 原生设置窗口；目标公开版 0.3.18。

## 操作与结果

| 操作 | 预期 | 实际 |
| --- | --- | --- |
| 查看磁盘应用、运行进程和设置页版本 | 与用户所述升级结果一致 | 三处均仍为 0.3.17；磁盘只发现一个安装副本 |
| 强制读取旧客户端 `/api/updates?refresh=1` | 可发现公开新版 | `latestVersion=0.3.18`、`updateAvailable=true`，但设置页保留 `error decoding response body` 下载失败 |
| 模拟下载流两次中断、第三次成功 | 重试且重新累计进度，只在成功验签后安装 | 定向测试通过；两次重置，750ms/1500ms 退避 |
| 模拟签名验证失败和连续三次下载中断 | 签名失败不重试，网络耗尽后保留失败 | 定向测试通过；英文和简体中文失败文案分别由现有语言目录提供 |

## 命令证据

- `node --test lib/desktop-updater.test.mjs components/AppSettingsUpdate.test.mjs lib/i18n/registry.test.mjs`：9 passed，0 failed。
- `npm test`：1253 tests，1228 passed，25 skipped，0 failed。
- `node_modules/.bin/tsc --noEmit` 和 `npm run lint`：通过。
- 对照本机 `@tauri-apps/plugin-updater` 2.10.1 Rust/JS 实现：`download` 完成后先验签，`install` 独立执行。

## 未验证条件

- 0.3.17 不含自动重试；本机尚未真正安装 0.3.18 或下一版，不把新版下载、安装、重启及数据回读记为通过。
- 没有制造真实网络断连；离线模拟证明重试边界，不证明 GitHub 下载链在该网络下必然成功。
