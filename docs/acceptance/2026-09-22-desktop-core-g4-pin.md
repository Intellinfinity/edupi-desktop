# Desktop Core G4 Pin and L4 Boundary

## Scope

- Desktop branch: `codex/desktop-core-g4-pin-20260922`, merged as `4d55f88498851f197ae07de341d8c46235a54c55`
- Desktop risk fixes: `4fcba0c`, `35ceb67`; Core G5 decision-only fix and replay test: `d5c9208`, `bd39463`, merged as `7cbb280eaf33bdb259e719a0149b7f2ca343d356`
- Core pin: `368bcd8b6fbe04d78860c96c37f27bec312c8e4c`
- Pull requests: [Desktop #206](https://github.com/Intellinfinity/edupi-desktop/pull/206), [Core #166](https://github.com/Intellinfinity/edupi/pull/166)

## Passed Evidence

| Check | Command | Result |
| --- | --- | --- |
| Desktop regression | `npm test` | final source: 1326 passed, 25 skipped, 0 failed |
| Type and lint | `node_modules/.bin/tsc --noEmit && npm run lint` | passed |
| Dependency audit | `npm run security:audit` | 0 vulnerabilities |
| Core C2/C3 pairing | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run test:edupi-c2-e2` and `test:edupi-c3-e2` | GREEN; exact G4 identity and 12-command capability list |
| Ambient Today | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run test:edupi-ambient-today-runtime` | passed; goal/opportunity projection, `external_send=false` |
| Student follow-up | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run test:edupi-follow-up-e2` | passed; receipt-bound accept and refreshed revision |
| Uploaded schedule dedupe | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run test:edupi-calendar-dedupe-e2` | passed; reordered upload remains two canonical items and unresolved date stays held |
| Packaged preparation dependency isolation | `node --test scripts/preparation-runtime.test.mjs` | passed; Office extraction dependencies load outside development `node_modules` |
| Current G4 desktop staging | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run desktop:prepare` + `npm run test:staged-desktop-runtime` | passed; staged server reports Core `368bcd8`, Core/projection ready, `externalSend=false`, proactivity explicitly disabled by default |
| Staged teacher feedback | `npm run test:staged-feedback-runtime` | passed; unauthenticated GET/POST both 403, token-bound bootstrap/target binding/record/exact replay/readback; one synthetic record excluded, real-teacher current=0, time saved=0, `external_send=false` |
| Feedback boundary regression | `node --test app/api/edupi/teacher-feedback/route.test.mjs lib/edupi-teacher-feedback.test.mjs components/EduPiTodayWork.test.mjs` | 11 passed; token/origin, post-review revision guard, bound retry payload, explicit rating without inferred use or scope |
| Built macOS bundle recovery | `EDUPI_INSTALLED_APP=.../target/release/bundle/macos/EduPi.app EDUPI_EXPECTED_VERSION=0.3.29 npm run test:packaged-background-recovery` | passed; bundle Core `368bcd8`, interrupted job reclaimed on attempt 2, artifact registered |
| Remote PR gates | GitHub `audit`, `rust-audit` | both passed on final Desktop head `35ceb67`; #206 merged `4d55f88`. Core `core-quality` passed on final head `bd39463`; #166 merged `7cbb280` |
| Release version check | `npm run release:verify` | failed: the branch and current main report `0.3.29`, while the latest published Release is `0.3.30`; this branch does not change release metadata |

## Safety Boundary

`review_follow_up` remains source/evidence/CAS/receipt validated and teacher-internal. Feedback GET/POST require the per-process desktop token, loopback host and origin checks. An explicit rating reads and binds the current target revision, fingerprint and evidence once; Core checks the initial write, while a retry preserves that same binding and command bytes. Today review does not infer usefulness, actual use, reuse intent or time saved. The optional rating is available only in the native app while the capability is active and task evidence includes a class ID and subject with a recognized trigger. Schedule IDs are deterministic for missing caller IDs and upload source hashes are order-independent. Ambient planning remains opt-in; UI reports `主动`/`按需`/`不可用`, attention delivery count, and feedback readiness from the Core status projection.

## Unverified

- The local macOS `.app`/DMG build is unsigned for release because `TAURI_SIGNING_PRIVATE_KEY` was not provided; a signed release and clean-user installation have not been verified.
- A direct native cold-start attempt was handed to the already-running `/Applications/EduPi.app` single-instance process; the running user instance was not terminated, so an isolated native window/notification observation still needs a clean app session.
- Real system notification display/click, sleep-wake recovery, upgrade continuity, and tray behavior remain outside this isolated checkout evidence.
- The native Today rating interaction and a real teacher decision/usefulness/continuity flow remain `not_run`; Core rhythm tasks frequently lack class ID/subject, so this opt-in channel does not yet cover every opportunity. No synthetic result is promoted to L4.
- Core G5 `7cbb280` allows surfaced decisions with `not_observed` usefulness and excludes them from assessed usefulness and saved-time metrics; Desktop is still pinned to G4 until a separate G5 contract and bundle update is verified.
- `npm run drift` was not run to completion because this checkout has neither the upstream remote nor the configured `v0.8.2` tag.

This record supports “L4 功能收敛中”, not `L4 established`.
