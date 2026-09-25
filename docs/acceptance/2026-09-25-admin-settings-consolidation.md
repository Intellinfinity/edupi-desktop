# 管理中心与通用设置归位

## 问题与实现

- 教师截图显示：原管理中心把“教学能力、学校平台、上传内容、任务与产物”等多数只有数字和跳转的内容拆成独立页面；通用设置却只能从管理中心“系统 → 应用更新”绕到长弹层，OpenConnector 只读目录埋在弹层下部。旧导航共 12 项。
- Desktop 将管理导航收成 7 项：概览、自动运行、工作与资源、连接、AI 与模型、系统、回收站。任务、材料、教学能力、教师与学生、校历与课表、学校平台都在“工作与资源”同一页，原深链 section ID 映射到这页，保留进入实际工作区的操作。教学能力的发布/试用/验证数与最多 20 项生命周期、复用、试用次数，学校逐租户 Core 模式、设备和 Harness 数保存在同页折叠详情中。后台文档任务移到“自动运行”，不再混入连接。
- “连接”页直接展示 OpenConnector 只读目录的搜索、结果和参数区域，并放置 JEV 浏览器决策设置及既有服务连接。通用设置不再重复显示 JEV/OpenConnector；工作台主导航新增“设置”直达，语言和外观合并首屏，教师信息只保留编辑动作，弹层按内容自适应高度并受最大高度约束。
- [OpenConnector 官方 Web Console](https://github.com/oomol-lab/open-connector) 还包含凭据配置、runtime token 和运行日志；当前 Desktop 只打包 headless package 与只读 catalog host，不嵌入拥有管理/执行权限的整套 Console。目录在非 Tauri 页面明确禁用，生产 Agent Action 继续关闭；Core capability/Receipt 和可信授权未完成前不开放账号连接或 Action。

## 验证边界

- 隔离 macOS 源码服务使用精确 Core `86a49de`、`/tmp/edupi-admin-ui-042.h2Fh0g/data` 的 0 学生/0 课表/0 校历/0 任务数据根与独立 Agent/状态目录，未向真实教师档案写入测试数据。
- IAB 实际操作：主导航“设置”一击打开；1280×720 查看一页六卡工作与资源、连接中的 OpenConnector/JEV；800×900 查看工作页与设置首屏，`body.scrollWidth=document.documentElement.scrollWidth=800`，无横向溢出。刷新后的连接页只包含 OpenConnector、JEV 与服务连接；后台任务在自动运行页，控制台 error/warn 为空。非桌面浏览器的目录查询按钮禁用并说明边界。
- 定向组件测试先按新信息架构失败、实现后 11/11 通过；详情补丁后最终 `npm test` 为 1741 total / 1715 passed / 26 skipped / 0 failed。TypeScript、lint、`npm audit --audit-level=high`（0 漏洞）、release verify、Cargo locked metadata 与 `git diff --check` 已通过。独立只读复审发现并促成上述折叠详情恢复，最终无剩余高/中风险。源码浏览器视觉证据不能替代签名 Tauri 安装版；OpenConnector search/inspect 的已有安装版/隔离运行证据见 [v0.3.42 验收](2026-09-25-v0.3.42-signed-release.md)。

## 尚未声称

- 当前安装版 v0.3.42 仍是旧布局；v0.3.43 的版本与组件清单已准备，尚未发布和原位升级验收。
- 上游完整 Web Console 的凭据、运行令牌、Action、审计页未集成；仅安全只读目录位于新的“连接”页。真实 OpenConnector Action、JEV 受管浏览器、Core grant/Receipt、学校部署与手机异地访问仍沿原路线图推进。
