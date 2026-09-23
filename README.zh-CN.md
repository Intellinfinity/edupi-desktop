# EduPi Desktop

[English](./README.md) | **简体中文**

EduPi 是面向教师的本地 AI 工作台，把教学任务、学生档案、课程日历、材料和 AI 对话放在同一个桌面应用中。教师可以从当天的工作进入任务，查看生成的产物和证据，再作出审核决定。

[下载桌面应用](https://github.com/Intellinfinity/edupi-desktop/releases) · [源码](https://github.com/Intellinfinity/edupi-desktop) · [架构说明](./docs/architecture/edupi-desktop.md)

## 工作台

- **教学与任务**：查看今日工作、课前准备和任务看板，进入任务对应的独立会话，跟踪运行状态、产物和审核。
- **学生与记忆**：查看学生档案、事件和教育记忆，处理候选信息与教师审核。
- **课程与材料**：管理课表、校历和教学材料，导入材料并查看识别结果。
- **AI 协作**：保留实时对话、历史会话、分支、文件预览，以及模型、认证、技能和插件配置。

功能可用性取决于当前绑定的 EduPi Core 契约、模型配置与本机权限；未支持的 Core 操作不会作为已完成能力执行。

## 安装与开始使用

在 [Releases](https://github.com/Intellinfinity/edupi-desktop/releases) 中选择对应平台的附件。发布工作流的目标是 Apple Silicon macOS、Windows x64 和 Linux x64，具体可下载文件以该次发布为准。

| 平台 | 安装文件 |
| --- | --- |
| macOS Apple Silicon | `aarch64.dmg` |
| Windows x64 | `x64-setup.exe` |
| Linux x64 | `.deb` |

macOS v0.3.29 缺少应用内更新插件，v0.3.25–v0.3.28 固化了旧 Release 地址；已撤回的 v0.3.30–v0.3.34 也需要替换安装。先退出 EduPi，从最新正式 Release 下载已签名的 `aarch64.dmg`，替换 `/Applications/EduPi.app` 后重新打开；教师数据目录单独保存，不要删除。v0.3.35 起可在设置中应用内更新；已在安装版实测 v0.3.35 → v0.3.36。

桌面包包含本地 Next.js 服务、Node.js、Pi SDK 和固定版本的 EduPi Core。安装版由应用启动本地服务，无需手动启动终端服务。首次打开后完成教师信息引导，在设置中配置可用模型。

应用默认使用内置 Core 和托管数据目录，也可恢复已选的数据目录。使用远程模型时，对话及调用所需的上下文会发送到所配置的模型服务；本地存储不等于离线推理。

## 架构

![EduPi Desktop 架构](./docs/architecture/edupi-desktop.svg)

[交互图 HTML](./docs/architecture/edupi-desktop.html) · [可编辑图源](./docs/architecture/edupi-desktop.archify.json) · [源码依据与再生成方法](./docs/architecture/edupi-desktop.md)

GitHub 不执行仓库中的 HTML。下载后在浏览器打开交互图，可搜索节点、追踪关系并导出图片。图由 [Archify](https://github.com/tt-a1i/archify) 生成。

Tauri 提供桌面窗口与原生能力，React 工作台通过本地 Next.js API 访问两条运行路径：

- **教学数据路径**：桌面桥接层校验 Core 版本、契约和数据目录，通过独立 Node.js 子进程请求快照或提交命令，并检查回执。
- **对话路径**：Next.js 进程内的 Pi AgentSession 执行对话与工具调用，通过 SSE 返回事件；会话保存在 Pi 数据目录中。

EduPi Core 的扩展与技能也参与 Agent 运行。架构图展示主要运行关系，详细的工具和审核规则见源码依据。

## 本地开发

需要 Node.js **22.19.0 或更新版本**。桌面开发还需要 Rust 和对应平台的 Tauri 构建依赖。

```bash
npm ci
```

教学功能需要配套的 [EduPi Core](https://github.com/PIGU-PPPgu/edupi)。使用 [`contracts/edupi-core-compat.json`](./contracts/edupi-core-compat.json) 中 `core_runtime.core_commit` 指定的版本，并在 Core 目录安装其依赖。Core 会核验组件清单，任意版本的目录不能替代固定版本运行时。

浏览器开发时显式指定 Core 与数据目录。将示例路径替换为已存在的绝对路径：

```bash
EDUPI_CORE_ROOT=/absolute/path/to/edupi \
EDUPI_DATA_ROOT=/absolute/path/to/teacher-workspace \
npm run dev
```

打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)。仅启动 Web 服务不会提供 Tauri 原生能力。

桌面开发：

```bash
EDUPI_CORE_ROOT=/absolute/path/to/edupi \
EDUPI_DATA_ROOT=/absolute/path/to/teacher-workspace \
npm run desktop:dev
```

当同级目录存在 `../edupi` 时，桌面开发启动器会默认将其作为 Core 与数据根目录。显式配置两个目录可以分开存放代码和教师数据。

| 配置 | 用途 |
| --- | --- |
| `EDUPI_CORE_ROOT` | 固定版本的 Core 代码目录 |
| `EDUPI_DATA_ROOT` | 教师数据根目录，包含 `.edupi/memory`、`.edupi/output` 和 `.edupi/locks` |
| `EDUPI_PROJECT_ROOT` | 部分运行路径与桌面开发启动器保留的兼容变量；Web 开发使用上面的显式配置 |
| `PI_CODING_AGENT_DIR` | 覆盖 Pi 默认的 `~/.pi/agent` 数据目录 |

任务与会话的绑定单独保存在 `.edupi/output/task_session_bindings.json`。模型认证与 Pi 会话使用 Pi 数据目录，不与教学事实文件混用。

## 验证与维护

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

**开发服务运行时不要执行 `next build` 或 `npm run build`**，构建会污染开发中的 `.next`。桌面打包使用 `npm run desktop:build`，在独立的打包环境运行；发布前还需准备固定版本 Core、平台依赖和签名配置，见[发布说明](./docs/release.md)。

```text
components/EduPi*       教师工作台与审核界面
app/api/edupi/         教学数据、材料、任务与 Core 桥接 API
lib/edupi-*           Core 契约、数据投影、命令、任务会话与 Agent 工具
lib/rpc-manager.ts    进程内 Pi AgentSession 生命周期
hooks/useAgentSession.ts  对话事件与运行状态同步
contracts/           固定 Core 身份与桥接兼容清单
src-tauri/           原生窗口、本地服务、权限与更新
scripts/             开发启动、打包、验证和上游同步
```

- [架构与图源维护](./docs/architecture/edupi-desktop.md)
- [开发约定](./AGENTS.md)
- [桌面更新](./docs/desktop-updates.md)
- [上游同步](./docs/desktop-upstream-sync.md)与[维护边界](./docs/ownership-boundaries.md)
- [安全问题报告](./SECURITY.md)

上游同步只生成审核 PR；正式桌面发布由独立的手动工作流处理。下载与更新目的地均为本仓库。

## 来源与许可

EduPi Desktop 基于 [Pi Agent Desktop](https://github.com/abcwyc/pi-agent-desktop) 和 [Pi Web](https://github.com/agegr/pi-web)，使用 [Pi](https://github.com/earendil-works/pi) Agent 运行时。上游项目保留署名，EduPi 的教师工作台与 Core 集成在本仓库维护。

仓库保留 [MIT License](./LICENSE)。NomiFun 衍生原生组件保留 Apache-2.0 许可及其 [第三方声明](./src-tauri/resources/third-party/nomifun/)。
