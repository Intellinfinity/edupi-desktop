# OpenConnector Console asset provenance

These files are a modified build of [`oomol-lab/open-connector@v1.6.5`](https://github.com/oomol-lab/open-connector/tree/c6f55b58f98bae95c14d0848eb612dfa09b80291), commit `c6f55b58f98bae95c14d0848eb612dfa09b80291`. The source is Apache-2.0. Its `LICENSE.txt` and `NOTICE.md` are included here. This build does not include the upstream OOMOL logo, favicon, or provider icons. Provider names remain identification text; no ownership of third-party marks is claimed.

`edupi-console.patch` records every source change from that tag: EduPi branding, fixed local icon mapping, read-only Providers/Actions/Runs/Overview views, disabled credential forms and Action debugging, sparse copy, and the 800-pixel filter layout. The separate HTTP host enforces the read-only boundary even if the frontend is modified.

To reproduce: download the official v1.6.5 source archive and verify its SHA-256 in `manifest.json`; extract it; run `npm ci --ignore-scripts`; apply `edupi-console.patch` at the source root; run `npm run build:web`. Copy only `dist/web/index.html` and the four files referenced in that HTML into this directory. `node scripts/verify-openconnector-console-assets.mjs` checks every shipped digest and rejects extra generated assets. It does not fetch source or alter the installed runtime.

The headless NPM package and this Console use the same v1.6.5 provider catalog. The Console runs on its own loopback origin and never receives a runtime or administrator token. Its server only forwards explicit GET requests; connection writes and Action POSTs return 403, and the runtime additionally blocks every Action and proxy. Account setup, OAuth, API-key issuance, and real Action execution are not shipped by this build.
