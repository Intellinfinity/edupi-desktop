# Dependency security patches

The npm high/critical gate remains unchanged. No advisory is allowlisted.

## Pi 0.84.1

Pi publishes `npm-shrinkwrap.json`. npm 10 can reinstall its Undici 8.9.0 and
brace-expansion 5.0.9 even when the project lock and overrides name patched
versions. A lock-only audit is therefore insufficient.

`scripts/prepare-security-dependencies.mjs` runs after installation and replaces
only those two nested directories with the project's exact registry packages:
Undici 8.10.2 and brace-expansion 5.0.12. No SDK source or session format changes.
The installed SDK manifest's Undici requirement is updated to match those bytes;
its original exact 8.9.0 requirement would otherwise leave `npm ls` invalid.
The root lock also records the patched packages and registry integrity hashes.
The installation patch invalidates npm's generated hidden lock after replacing
files, so `npm ls` reads the patched tree instead of cached shrinkwrap metadata.
After regenerating that lock, check both nested entries; upstream shrinkwrap may
reintroduce its old values. Do not bypass the installed-tree regression test.

CI does a clean install and tests the versions actually resolved from the SDK,
as well as the full lockfile. Installing with `--ignore-scripts` is insufficient;
run the preparation script before using that installation. Remove this workaround
when a compatible, tested Pi release fixes the published shrinkwrap.

## OpenConnector 1.6.5

The mail dependency is scoped to Nodemailer 10.0.10. The catalog/Console version
and Action deny-all policy remain unchanged. Regression tests compose and parse
MIME in memory, with no SMTP connection or outgoing message.

## Next lint

Next and its lint config are 16.3.8. The private `vendor/next-root-glob` adapter
replaces their only fast-glob call; all lint rules remain enabled. Its README
records scope, sources and removal criteria. Tests cover root-directory matching
and the actual internal-link rule, not just dependency metadata.

Recheck these temporary integrations by 2026-11-03.
