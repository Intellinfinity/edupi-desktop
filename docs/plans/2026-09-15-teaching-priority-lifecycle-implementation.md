# Teaching Priority Lifecycle Implementation Plan

> **For Codex:** Execute this plan continuously in the paired Core and Desktop worktrees. A task is complete only after its focused tests pass; the feature is complete only after Core/Desktop PRs and live-browser evidence.

**Goal:** Let teachers create, edit, pause, complete, delete, inspect, and restore teaching priorities through one Core-owned lifecycle that also updates later lesson preparation.

**Architecture:** Store explicit teacher priorities separately from read-only subject knowledge and education facts. Project current values through the signed education workspace, expose old values only on an explicit history request, and use the existing entity tombstone ledger for deletion. Desktop sends intent plus the current revision and trusts only a bound Core receipt followed by a verified reread.

**Tech Stack:** Node.js ESM Core stores and bridge, TypeBox/JSON Schema, Next.js route handlers, React 19, Tauri packaging manifests, Node test runner.

---

### Task 1: Core priority store and versions

**Files:**
- Create: `scripts/teaching_priority_store.mjs`
- Create: `scripts/teaching_priority_store.d.mts`
- Create: `scripts/test_teaching_priority_store.mjs`
- Modify: `package.json`

1. Write tests for create/update/status/restore, stable IDs, class-scoped duplicates, stale revision, semantic idempotency, bounded history and restart readback.
2. Run the focused test and confirm it fails before the module exists.
3. Implement one locked store with exact request/receipt validation, maximum 200 priorities, 50 versions per priority, and a 512 KiB file limit.
4. Rerun the focused test and commit the store slice.

### Task 2: Projection and unified deletion

**Files:**
- Modify: `scripts/edupi_education_workspace.mjs`
- Modify: `scripts/entity_delete_store.mjs`
- Modify: `scripts/edupi_bridge_snapshot.mjs`
- Modify: `contracts/edupi-bridge-v1.1.ts`
- Modify: projection, deletion, bridge, fixture, and transport tests

1. Add failing tests for public current-value projection, deletion visibility, tombstone restore, and private history omission.
2. Add `continuity.teaching_priorities` and `teaching_priority` to the existing delete target union.
3. Ensure deleted priorities cannot be updated and restored priorities retain the same stable ID and versions.
4. Regenerate the bridge schema, hash, fixtures, and rerun contract/deletion tests.

### Task 3: Core bridge and lesson-preparation consumption

**Files:**
- Modify: `scripts/desktop_bridge_port.mjs`
- Modify: `scripts/rhythm_heartbeat.mjs`
- Modify: `scripts/rhythm_planner.mjs`
- Modify: relevant bridge, heartbeat, and planner tests

1. Add failing tests for `teaching-priorities` create/update/restore and explicit history reads.
2. Dispatch all mutations through the managed Core mutation boundary and keep history behind `workspace-resources` opt-in parameters.
3. Match active priorities by subject and optional class, include priority ID/revision in evidence, and exclude paused/completed/deleted items.
4. Prove a priority edit changes source semantics without changing lesson occurrence ID; prove pause/delete removes it from new preparation summaries.

### Task 4: Core manifests, regression, review, and merge

**Files:**
- Modify: Core component manifests and their tests
- Modify: Core roadmap evidence as applicable

1. Regenerate Desktop and Runtime component manifests.
2. Run focused tests, typecheck, full `npm test`, and high-severity audit.
3. Run an independent P1/P2 review and fix every finding.
4. Push, open the Core PR, wait for required checks, and merge.

### Task 5: Desktop typed adapter and API

**Files:**
- Create: `lib/edupi-teaching-priorities.ts`
- Create: `app/api/edupi/teaching-priorities/route.ts`
- Create: focused tests and an isolated E2 script
- Modify: `lib/edupi-education-contract.ts`, Core pin/manifest files, and education projection glue

1. Add failing tests for exact current projection, version-chain hashes, receipt binding, cross-object history, stale revisions and response-loss replay.
2. Implement GET/POST/PUT/history/restore adapters using stable request IDs and bounded same-origin JSON requests.
3. Reread the education workspace and history after every mutation; return success only when ID, revision and values reconcile.
4. Run focused API and paired-Core E2 tests.

### Task 6: Desktop teaching-priority workspace

**Files:**
- Modify: `components/EduPiTeachingWorkspace.tsx`
- Modify: `components/EduPiWorkspaceViews.tsx`
- Modify: `app/edupi-workbench.css`
- Modify/create: component interaction tests

1. Add “新增重点” to the teaching-priority page and keep “对话补充重点” as the AI collaboration entry.
2. Render teacher priorities separately from Core facts and subject-knowledge evidence.
3. Implement create/cancel/save, direct edit, pause/resume/complete, history before/after restore, and unified delete.
4. Refresh shared education state so teaching home, preparation tasks, object counts, and deleted-items navigation stay consistent.

### Task 7: Live acceptance and delivery

**Files:**
- Modify: `docs/plans/2026-09-06-product-closure-roadmap.md`
- Modify: `docs/acceptance/2026-09-08-live-workflows.md`

1. In isolated data, exercise create → edit → pause → restore → complete → delete → deleted-items restore → refresh.
2. Verify a real preparation summary consumes only the active scoped priority and changes after revision.
3. Run Desktop full tests, typecheck, lint, npm/Rust audits, and an independent P1/P2 review.
4. Push, open the Desktop PR, wait for checks, merge, and continue with material metadata versions.
