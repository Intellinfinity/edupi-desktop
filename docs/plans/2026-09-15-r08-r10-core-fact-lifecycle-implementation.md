# R08/R10 Core 事实生命周期实施计划

1. 在 Core 新增严格的 `education-facts` 请求适配器与重放对账，接入 Desktop bridge、daemon bridge 分类、Runtime 协议和组件清单。
2. 为 Core 增加生命周期、传输一致性、writer admission、重启和投影回归；生成新的精确组件与 Runtime hash。
3. Desktop pin 新 Core，增加事实请求模型、服务端对账和 `/api/edupi/facts` 路由，拒绝来源、状态和 revision 伪造。
4. 扩展事实类型和观察分类，把事实候选接入审核看板，把统一操作接入学生档案、教学依据及观察数据库。
5. 跑 Core/Desktop 定向与全量检查，再用隔离数据完成真实浏览器四入口同步、删除恢复和刷新验收。
6. 独立审查 P1/P2，修复后复审；分别提交 Core 与 Desktop PR，合并后更新唯一路线图的 R08/R10 状态。
