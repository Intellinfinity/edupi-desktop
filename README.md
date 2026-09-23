# EduPi Desktop

**English** | [简体中文](./README.zh-CN.md)

EduPi is a local AI workspace for teachers. It brings teaching tasks, student records, schedules, materials, and AI conversations into one desktop app. Start from today's work, open a task, inspect its artifacts and evidence, and review the result.

[Download](https://github.com/Intellinfinity/edupi-desktop/releases) · [Source](https://github.com/Intellinfinity/edupi-desktop) · [Architecture](./docs/architecture/edupi-desktop.md)

## The workspace

- **Teaching and tasks**: today's work, preparation, task boards, dedicated task conversations, run status, artifacts, and review.
- **Students and memory**: student profiles, events, education memory, candidate information, and teacher review.
- **Schedules and materials**: timetables, school calendars, material intake, and recognition results.
- **AI collaboration**: streaming conversations, session history, branching, file previews, and model, authentication, skill, and plugin settings.

Availability depends on the pinned EduPi Core contract, configured models, and local permissions. Unsupported Core operations are not executed as supported capabilities.

## Install and get started

Choose an asset from [Releases](https://github.com/Intellinfinity/edupi-desktop/releases). The release workflow targets Apple Silicon macOS, Windows x64, and Linux x64; consult each release for the assets actually available.

| Platform | Installer |
| --- | --- |
| macOS Apple Silicon | `aarch64.dmg` |
| Windows x64 | `x64-setup.exe` |
| Linux x64 | `.deb` |

On macOS, v0.3.29 lacks the updater plugin; v0.3.25–v0.3.28 have the old release endpoint built in. The withdrawn v0.3.30–v0.3.34 builds also need replacement. Quit EduPi, download the latest signed `aarch64.dmg`, replace `/Applications/EduPi.app`, and reopen it. Keep the separate teacher data directory. From v0.3.35 onward, use Settings to update in the app; the v0.3.35 → v0.3.36 path was verified on an installed Mac.

The desktop package includes the local Next.js server, Node.js, Pi SDK, and a pinned EduPi Core runtime. The installed app starts its own local server. Complete the teacher setup when opening the app, then configure an available model in Settings.

The app uses bundled Core and a managed data directory by default, and can restore a previously selected data directory. When using a remote model, conversation content and the context required by the request are sent to that provider. Local storage does not imply offline inference.

## Architecture

![EduPi Desktop architecture](./docs/architecture/edupi-desktop.svg)

[Interactive HTML](./docs/architecture/edupi-desktop.html) · [Editable source](./docs/architecture/edupi-desktop.archify.json) · [Source evidence and regeneration](./docs/architecture/edupi-desktop.md)

GitHub does not execute repository HTML. Download the interactive diagram and open it in a browser to search nodes, trace relationships, and export images. Generated with [Archify](https://github.com/tt-a1i/archify); diagram labels and evidence notes are in Chinese.

Tauri supplies the desktop window and native capabilities. The React workspace accesses two runtime paths through local Next.js APIs:

- **Education data**: the desktop bridge validates Core identity, contracts, and data roots, then requests snapshots or submits commands through an independent Node.js child process and checks the receipts.
- **Conversations**: Pi AgentSession runs inside the Next.js process, executes prompts and tools, and streams events through SSE. Sessions persist in the Pi data directory.

Core extensions and skills also participate in Agent execution. The diagram shows the main runtime relationships; source notes cover the tool and review boundaries.

## Local development

Requires Node.js **22.19.0 or newer**. Desktop development also requires Rust and the Tauri build dependencies for your platform.

```bash
npm ci
```

Education features require the companion [EduPi Core](https://github.com/PIGU-PPPgu/edupi). Use the revision specified by `core_runtime.core_commit` in [`contracts/edupi-core-compat.json`](./contracts/edupi-core-compat.json) and install Core's dependencies in its directory. The bridge verifies the component manifest; an arbitrary Core checkout cannot substitute for the pinned runtime.

For browser development, set both roots explicitly. Replace the example values with existing absolute directories:

```bash
EDUPI_CORE_ROOT=/absolute/path/to/edupi \
EDUPI_DATA_ROOT=/absolute/path/to/teacher-workspace \
npm run dev
```

Open [http://127.0.0.1:30141](http://127.0.0.1:30141). Browser mode does not provide Tauri native capabilities.

For desktop development:

```bash
EDUPI_CORE_ROOT=/absolute/path/to/edupi \
EDUPI_DATA_ROOT=/absolute/path/to/teacher-workspace \
npm run desktop:dev
```

When a sibling `../edupi` directory exists, the desktop dev launcher uses it as the data root. The pinned Core bundled under `src-tauri/resources/edupi-core` supplies the code root unless `EDUPI_CORE_ROOT` is set explicitly. Set both roots explicitly when developing against a Core checkout.

| Setting | Purpose |
| --- | --- |
| `EDUPI_CORE_ROOT` | Pinned Core code directory |
| `EDUPI_DATA_ROOT` | Teacher data root containing `.edupi/memory`, `.edupi/output`, and `.edupi/locks` |
| `EDUPI_PROJECT_ROOT` | Compatibility variable used by some runtime paths and the desktop dev launcher; use the explicit configuration above for Web development |
| `PI_CODING_AGENT_DIR` | Overrides Pi's default `~/.pi/agent` data directory |

Task-to-session bindings are stored separately in `.edupi/output/task_session_bindings.json`. Model credentials and Pi sessions use the Pi data directory, separate from education fact files.

## Verification and maintenance

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

**Do not run `next build` or `npm run build` while the development server is running.** They modify the development `.next` directory. Use `npm run desktop:build` in a separate packaging environment, with the pinned Core runtime, platform dependencies, and signing configuration prepared; see [release documentation](./docs/release.md).

```text
components/EduPi*         Teacher workspace and review UI
app/api/edupi/           Education, material, task, and Core bridge APIs
lib/edupi-*              Core contracts, projections, commands, task sessions, Agent tools
lib/rpc-manager.ts       In-process Pi AgentSession lifecycle
hooks/useAgentSession.ts Conversation events and run reconciliation
contracts/              Pinned Core identity and bridge compatibility manifests
src-tauri/              Native windows, local server, permissions, updates
scripts/                Development, packaging, verification, upstream synchronization
```

- [Architecture and diagram maintenance](./docs/architecture/edupi-desktop.md)
- [Development conventions](./AGENTS.md)
- [Desktop updates](./docs/desktop-updates.md)
- [Upstream synchronization](./docs/desktop-upstream-sync.md) and [ownership boundaries](./docs/ownership-boundaries.md)
- [Security reporting](./SECURITY.md)

Upstream synchronization produces review PRs. A separate manual workflow publishes desktop releases. Downloads and updates both belong to this repository.

## Attribution and license

EduPi Desktop builds on [Pi Agent Desktop](https://github.com/abcwyc/pi-agent-desktop) and [Pi Web](https://github.com/agegr/pi-web), using the [Pi](https://github.com/earendil-works/pi) Agent runtime. The teacher workspace and Core integration are maintained in this repository with upstream attribution preserved.

The repository retains the [MIT License](./LICENSE). NomiFun-derived native components retain Apache-2.0 licensing and their [third-party notices](./src-tauri/resources/third-party/nomifun/).
