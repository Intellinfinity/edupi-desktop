# ADR-006: Teacher-Confirmed Core Runtime Root Repair

## Status

Accepted

## Date

2026-09-21

## Context

EduPi Core binds its runtime and writer-admission SQLite stores to a filesystem
root fingerprint. A data-root move or prior interrupted migration can leave both
stores with an older fingerprint. Reads continue to work, while all mutations
fail closed. The existing reconnect action cannot repair this state because it
correctly refuses a mismatched runtime root.

## Decision

Add a desktop-only, teacher-confirmed repair action at
`POST /api/edupi/runtime/repair`. The route requires the per-process Tauri
desktop token and performs no repair for browser or phone clients.

The repair adapter is deliberately narrow:

- It validates the pinned Core runtime schema, `user_version`, exact metadata
  rows, authority invariants, and the absence of a live owner or writer lease.
- It acquires `BEGIN IMMEDIATE` on both state databases before mutation and
  uses SQLite's online backup API, which includes WAL state.
- It writes a private repair intent before the first commit. If the process
  stops between the two database commits, the next explicit repair resumes from
  the original consistent backup pair rather than creating a new backup from a
  half-repaired state.
- It changes only runtime root-binding metadata. Teacher memory, output,
  calendar, timetable, and task files are outside the mutation set.

The management center exposes the action for `runtime_root_invalid` and
`runtime_state_invalid`; a healthy runtime uses the existing supervisor rather
than restarting unnecessarily.

## Alternatives Considered

### Delete the runtime directory

Rejected. It could discard queued runtime events and would make recovery
irreversible.

### Automatically rewrite the fingerprint at startup

Rejected. A root mismatch is a security boundary. A teacher must explicitly
confirm the repair, and active owners must block it.

### Patch the pinned Core bundle in Desktop

Rejected. That would change the Core component closure without a paired Core
commit and manifest update.

## Consequences

The common stale-runtime failure is recoverable from the desktop UI without
touching teacher data. Repair creates private `before-root-repair` SQLite
backups and may require a second click after an interrupted process; invalid or
active state remains read-only and fails closed.
