# Desktop Core G4 Pin and L4 Boundary

## Scope

- Desktop branch: `codex/desktop-core-g4-pin-20260922`
- Desktop commits: `8237f23`, `c2ea42e`, `e9752cc`, `2fa1f94`
- Core pin: `368bcd8b6fbe04d78860c96c37f27bec312c8e4c`
- Pull request: [Desktop #206](https://github.com/PIGU-PPPgu/edupi-desktop/pull/206)

## Passed Evidence

| Check | Command | Result |
| --- | --- | --- |
| Desktop regression | `npm test` | 1318 passed, 25 skipped, 0 failed |
| Type and lint | `node_modules/.bin/tsc --noEmit && npm run lint` | passed |
| Dependency audit | `npm run security:audit` | 0 vulnerabilities |
| Core C2/C3 pairing | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run test:edupi-c2-e2` and `test:edupi-c3-e2` | GREEN; exact G4 identity and 12-command capability list |
| Ambient Today | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run test:edupi-ambient-today-runtime` | passed; goal/opportunity projection, `external_send=false` |
| Student follow-up | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run test:edupi-follow-up-e2` | passed; receipt-bound accept and refreshed revision |
| Uploaded schedule dedupe | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run test:edupi-calendar-dedupe-e2` | passed; reordered upload remains two canonical items and unresolved date stays held |
| Packaged preparation dependency isolation | `node --test scripts/preparation-runtime.test.mjs` | passed; Office extraction dependencies load outside development `node_modules` |
| Current G4 desktop staging | `EDUPI_CORE_ROOT=/tmp/edupi-core-g4-pin-test npm run desktop:prepare` + `npm run test:staged-desktop-runtime` | passed; staged server reports Core `368bcd8`, Core/projection ready, `externalSend=false`, proactivity explicitly disabled by default |
| Staged teacher feedback | `npm run test:staged-feedback-runtime` | passed; owner bootstrap, target recheck, real-teacher record/readback, 20-minute saved metric, `external_send=false` |
| Built macOS bundle recovery | `EDUPI_INSTALLED_APP=.../target/release/bundle/macos/EduPi.app EDUPI_EXPECTED_VERSION=0.3.29 npm run test:packaged-background-recovery` | passed; bundle Core `368bcd8`, interrupted job reclaimed on attempt 2, artifact registered |
| Remote PR gates | GitHub `audit`, `rust-audit` | both passed; PR merge state `CLEAN` |

## Safety Boundary

`review_follow_up` remains source/evidence/CAS/receipt validated and teacher-internal. Feedback records are target-rebound server-side against the current revision/fingerprint/evidence before Core writes; Today decisions capture real-teacher feedback only when the ambient feedback capability is active. Feedback reads enforce host/origin checks. Schedule IDs are deterministic for missing caller IDs and upload source hashes are order-independent. Ambient planning remains opt-in; UI reports `主动`/`按需`/`不可用`, attention delivery count, and feedback readiness from the Core status projection.

## Unverified

- The local macOS `.app`/DMG build is unsigned for release because `TAURI_SIGNING_PRIVATE_KEY` was not provided; a signed release and clean-user installation have not been verified.
- Real system notification display/click, sleep-wake recovery, upgrade continuity, and tray behavior remain outside this isolated checkout evidence.
- Real teacher decisions, usefulness, and six-domain value remain `not_run`; no synthetic result is promoted to L4.
- `npm run drift` was not run to completion because this checkout has neither the upstream remote nor the configured `v0.8.2` tag.

This record supports “L4 功能收敛中”, not `L4 established`.
