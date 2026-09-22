# L4 Schedule Intake Risk Boundary

## Scope

- Desktop branch `codex/l4-risk-source-20260922`, commits `8a16df8` and `32f74f8`; pinned Core G4 remains `368bcd8`.
- Core schedule guard PR #168 must be paired separately before cross-file ambiguities can be considered safe in a bundled Desktop.
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
