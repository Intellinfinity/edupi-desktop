# R19/R21 v0.3.20 行动入口与幂等补验

- 状态：模型缺失入口和重复 due-scan 幂等通过；系统通知点击、真实睡眠唤醒和稳定系统授权仍保留未验收。
- 代码版本：Desktop v0.3.20，Release commit 3b173f6a95cb566bc69188542a5268d44c11c199；Core commit 19c0fd5182c6c20d6534973e506d6fa36acc1b06。
- 环境：macOS 安装版 0.3.20。模型缺失使用空 HOME、空教师数据和独立端口；重复 due-scan 使用当前正式安装版只读核对 Kernel 投影。

## 操作与结果

| 范围 | 实际操作 | 结果 |
| --- | --- | --- |
| 模型缺失入口 | 安装版 server 以空模型配置启动，打开教育工作区 | 通过；首跑卡片显示“连接模型 / 打开 AI 与模型”，后台管理“AI 与模型”显示“模型数据不可用 / 连接模型”；页面未暴露 provider、stack 或内部错误码 |
| 任务/材料失败入口 | 读取当前正式安装版 Kernel 与既有 0.3.17/0.3.20 页面验收 | 通过；15 条失败均为缺材料逻辑键，页面沿用“缺少可用材料 / 补充材料”，点击进入材料模块，Core 整体仍 ready |
| 重复 due-scan | 连续两次调用安装版 preparation 接口的 ensure 动作 | 通过；两次调用后 Kernel 仍为 total 17、failed 15、succeeded 2，15 个 g1_prepare_due 失败 fire_key 一一对应，没有重复展开 |
| 清理 | 停止空模型隔离 server 与浏览器，删除临时数据根 | 通过；Chrome exit 0、server exit 130（Ctrl-C 预期），/tmp/edupi-r19-model-OiKEkwZD 已删除 |

## 未验证条件

- 未触发系统通知，也没有点击通知中心条目；不能证明 edupi://reminder-open 在 macOS 通知中心的端到端跳转。
- 未让系统真实睡眠/唤醒；本轮只证明重复 ensure 不增加逻辑失败，不能用进程重启或 API 幂等替代系统唤醒。
- 空模型只证明缺失配置的入口与文案，不代表任一外部供应商真实 Key 可用后的生成质量。
