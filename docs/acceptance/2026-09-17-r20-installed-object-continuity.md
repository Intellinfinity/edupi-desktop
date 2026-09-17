# R20 v0.3.20 安装版对象连续性验收

- 状态：macOS 安装版隔离数据验收通过；2026-09-18 补齐成长“验证/发布”和真实对话产物绑定后，R20 的安装版隔离链路收口。
- 代码版本：Desktop v0.3.20，Release commit 3b173f6a95cb566bc69188542a5268d44c11c199；Core commit 19c0fd5182c6c20d6534973e506d6fa36acc1b06。
- 环境：原安装包内置 server、bundled Core、独立 HOME/state/data root、macOS Chrome headless；教师数据为临时副本，验收后进程与临时目录已删除，未写入真实学生或教师档案。

## 操作与结果

| 对象 | 实际操作 | 结果 |
| --- | --- | --- |
| 教学重点 | 教学页新增“R20对象连续性验收”，修改说明，历史恢复修改前，删除后从管理中心回收站恢复 | 通过；revision 0→1→2，教学首页和课前任务摘要同步新值，删除后消失、恢复后回来 |
| 学生档案 | 班级入口打开蔡静然，手动修改学生特征，再恢复修改前 | 通过；档案历史 1→2，重启后当前值与原始特征一致 |
| 材料 | 以安装版 desktop token 暂存 DOCX 并接入，材料页修改名称/类型，删除后回收站恢复 | 通过；材料数 31→32→31→32，重启后仍为“R20安装版材料已编辑”，课前任务摘要同步显示该材料 |
| 任务 | Today 中接受“第2周 · 慢慢进入状态准备” | 通过；待判断 17→16，已记录 0→1，任务进入“正在进行/已准备”，重启后 status=accepted |
| 日程 | 写入“R20安装版日程连续性”，重启后打开详情并改名，删除后回收站恢复 | 通过；操作历史 1→2，重启后仍为“R20安装版日程已编辑”，恢复后日程侧栏和详情回来 |
| 成长 | 新增“R20安装版对象连续性方法”，记录一次有效试用并关联已接受任务 | 首轮仅完成创建与试用；未填写必填“验证意见”时按钮按设计禁用。该缺口已在 2026-09-18 补验中完成 |
| 重启 | 停止隔离 server 与浏览器，用同一数据根重新启动安装版 server | 通过；Core/projection/kernel 均 ready，上述对象与任务状态重新读取 |

## 2026-09-18 补验

| 对象 | 实际操作 | 结果 |
| --- | --- | --- |
| 成长生命周期 | 新增“R20成长完整生命周期”，记录一次有效试用，填写必填验证意见并点击“验证通过”，再点击“发布” | 通过；页面依次显示草稿、试用中、已验证、已发布；重启后 Core 回读 lifecycle_state=published、revision=3、trial_count=1、can_reuse=true，方法 ID teaching_method_7ae5019b5c9ad4b2acbe87868da62df5 |
| 安装版对话写回 | 配置仅限隔离 HOME 的本地 OpenAI-compatible 模型，通过安装版页面进程调用 /api/agent/new 发起真实 prompt，模型用 write 工具生成文件 | 通过；会话 01a0b038-b8b6-7aa9-a392-aceb51f89b74 记录用户请求、write 工具调用、成功工具结果和最终回复；文件 .edupi/output/r20-installed-chat.md 为 94 字节 |
| 对话产物绑定 | 打开同一会话的“本次产物”浮层，重启安装版 server 后再次恢复会话 | 通过；Core artifact c90df67d-fcbb-4719-9503-76e0d67626b1 绑定同一 session ID；重启前和重启后页面均显示“本次产物 / 1 份文件 / r20-installed-chat.md” |
| 隔离模型失败对照 | 第一轮验收模型服务器误用 BaseHTTPRequestHandler.write 写 SSE，Pi 重试四次收到 500 | 不计为桌面端缺陷；修正验收服务器后新会话通过。旧失败会话仅作对照，未用作通过证据 |
| 重启与清理 | 停止浏览器、模型服务器和安装版 server，删除临时数据根 | 通过；重启后 Core/projection/kernel 均 ready；清理前最终回读通过，退出码 Chrome 0、模型 130、server 130（Ctrl-C 预期） |

## 证据

- 2026-09-17 首轮最终快照：Core/projection/kernel 均 ready；学生 50、课表 6、校历 29、任务 165。
- 稳定对象回读：r20-calendar-continuity、蔡静然 student_29202e7f06b256e5a420924f15ad4307 revision 2、任务 teaching_node_preparation:desktop_calendar_mt5xnja8_2 accepted、材料“R20安装版材料已编辑”、成长方法“R20安装版对象连续性方法”均存在。
- 隔离 server 日志尾部没有新的 error、exception、500 或 503 输出。
- 临时进程退出码：Chrome 0、server 130（Ctrl-C 预期）；/tmp/edupi-r20-IokIbeya 已删除。

## 边界与未通过

- 复制真实教师数据时保留了旧 Runtime 指纹，Core 按设计拒绝在其他路径复用；只在临时副本删除 Runtime 存储并由 Core 重建。重建后投影计数从 50/9/43/240 变为 50/6/29/165，说明该副本不是完整原位迁移等价物。本验收证明隔离副本中的写入与重启回读，不证明真实数据迁移无损。
- 普通浏览器没有 desktop token，材料暂存接口按安全设计返回不可用；本轮用安装进程 token 调同一 staging/intake API 建立对象，后续编辑、删除、恢复和跨面回读仍在安装版页面完成。
- 成长生命周期已按上一节补验完成；“验证意见”为空时按钮禁用的行为与源码一致。
- 安装版真实对话发送与产物绑定已补验；模型为隔离本地服务，只证明 Desktop/Chat/工具/Core 登记链路，不代表外部供应商质量。
- 未持续采集浏览器 console/network 事件，不能宣称本轮 console error 或失败请求为 0；只记录安装版 UI 可见状态和 server 日志。
