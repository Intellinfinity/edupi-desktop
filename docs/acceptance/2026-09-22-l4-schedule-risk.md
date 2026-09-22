# L4 Schedule Intake Risk Boundary

## Current checkpoint: Core #169 and Desktop #209

- Core [#168](https://github.com/Intellinfinity/edupi/pull/168) and [#169](https://github.com/Intellinfinity/edupi/pull/169) are merged; #169 merge commit is `156ee8ec5daa11d5f1e38dbdee3e60799f46b3a1`. Desktop #209 remains open. Its interim pin matches this merge commit and Core component hashes, not an installed release.
- Core #169 exposes owner-bound, paginated calendar/timetable conflicts and three CAS decisions. Exact replay, stale/deleted source rejection, distinct occurrences, legacy material review-target tombstones and old draft invalidation passed Core `npm test` and remote `core-quality` on head `bc2a47b`.
- Desktop persists a separate owner-control credential in a private per-data-root file under `PI_DESKTOP_STATE_DIR`. The Core transport bearer remains ephemeral. Invalid permissions, links, missing/corrupt keys and existing owner state without a key fail closed; an interrupted create with the matching private temporary hard link can recover. Older owner states written with an ephemeral key cannot be authenticated automatically; they are preserved for an explicit recovery procedure.

| Environment | Check | Expected | Actual |
| --- | --- | --- | --- |
| Desktop source paired to Core, macOS Node | `EDUPI_CORE_ROOT=... npm test`, `tsc --noEmit`, `npm run lint`, `npm run security:audit` | No regression or high dependency vulnerability | 1357 passed, 8 skipped, 0 failed; type/lint passed; 0 vulnerabilities at the interim pin. Without a Core checkout, 1339 passed and 25 skipped |
| Paired Core 156ee8e, isolated roots | `test:edupi-c2-e2`, `test:edupi-c3-e2`, `test:edupi-calendar-dedupe-e2`, `test:edupi-follow-up-e2`, `test:edupi-ambient-today-runtime` | Exact Bridge pairing and existing workflows | Passed; no external send |
| Paired Core 156ee8e, isolated roots | `test:edupi-schedule-conflicts-e2` | Import two revised calendar records, decide, reject wrong replay/stale revision, read education projection, restart, reject lost credential | Passed. Same canonical event became current on 2026-10-13; owner bytes unchanged after credential-loss rejection |
| Packaged server and Core 156ee8e | `desktop:prepare`, `test:staged-desktop-runtime`, `test:staged-schedule-conflicts-runtime`, `test:staged-feedback-runtime` | Built API/Core run the same isolated flow | Passed. Default proactivity disabled; enabled schedule review survives full server restart. Unverified Goal feedback denied; synthetic missed feedback persisted/replayed and excluded from real-teacher metrics |
| Copied model host without Core dependencies | `EDUPI_CORE_ROOT=... node --test scripts/runtime-model-host-files.test.mjs` | Isolated localhost SDK still runs after copying host-only imports | Passed after adding `ambient_safety_policy.mjs` and `pi-telemetry` to the copy closure; no symlinks or Core `node_modules` required |
| Isolated packaged page, browser WebView simulation | Open calendar review, compare source fields, choose candidate, reload at 1280/800/390 widths | Native-gated control is actionable and does not overflow | Passed after closing independent object-list and update overlays. 390px document had no horizontal overflow; no page errors. This is browser simulation, not a signed Tauri install |

The next Core risk gate is deletion propagation **after** a material-derived schedule has already been accepted: current projections, G1/G3 executions, Today and attention must all reject that withdrawn source. Same-ID manual undo after an earlier replacement still needs explicit review rather than a permanent `source_conflict`. Uploads still lack typed time/place and a stable occurrence key independent of date or period, so arbitrary itineraries and automatic amendment correlation remain unverified. No formal model blind run, real teacher value trial, native notification click, sleep recovery or macOS/Windows installation was claimed here.

## Scope

- The following scope and evidence predate the current checkpoint above: Desktop branch `codex/l4-risk-source-20260922`, commits `8a16df8` and `32f74f8`, then pinned Core G4 `368bcd8`.
- Core #168 was not paired at that earlier checkpoint; the current interim pairing is recorded above.
- All test data used an isolated temporary root or an in-browser synthetic receipt. No teacher records or external channels were changed.

## Evidence

| Environment | Check | Expected | Actual |
| --- | --- | --- | --- |
| Desktop source, macOS Node | `node --test lib/edupi-material-intake-flow.test.mjs app/api/edupi/intake/route.test.mjs` | Repeated file uploads share schedule IDs; distinct same-day details do not overwrite; same-file ambiguity writes nothing | Passed. Exact duplicate recognition rows yield one candidate; different details have distinct IDs or stop before any write |
| Isolated Core G4 data root | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run test:edupi-calendar-dedupe-e2` | Reordered replay creates no extra canonical rows; invalid date remains held | Passed, 0 → 2 → 2 canonical events, no external send |
| Desktop source, macOS Node | `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint` | No regression | 1331 passed, 25 skipped, 0 failed; type and lint passed on the current source |
| Isolated Next dev + Codex in-app browser | Synthetic `intake_material=accepted`, `import_calendar=held` returned via localhost request interception | Materials page separates accepted material from held schedule; prompt stays visible and can be dismissed without covering mobile navigation | Observed in Materials and Today. At effective 494px and 300px browser widths, toast ended 16px above the 60px navigation rail after the fix. Test interception was cleared, tab closed, server stopped |

## Boundary

Recognized calendar/timetable IDs no longer depend on a random staging ID. A normalized detail fingerprint separates same-day items from different uploads; conflicting same-file base identities are rejected before Core writes. The API surfaces `scheduleNeedsReview` from schedule receipts, and the Materials page does not report a held item as a completed schedule.

This is not a claim that arbitrary itineraries, school-calendar amendments, or installed-app delivery are complete. The v1.1 calendar contract lacks typed time, place and occurrence anchors. Core #168 holds uncertain cross-source changes and stales old ready work, but teacher conflict resolution, new Core pin, native page flow, Windows/macOS installs and real teacher value remain pending.
