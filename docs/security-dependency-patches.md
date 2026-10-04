# Dependency security patches

The npm high/critical gate remains unchanged. No advisory is allowlisted.

## Pi 1.0.2

The four Desktop Pi packages are fixed to the Core 1.0.2 baseline. Upstream
removed its published shrinkwrap in 1.0.1 and now resolves secure Undici,
brace-expansion and minimatch versions without modifying installed packages.
The old 0.84.1 postinstall replacement script has been removed. `npm ci` and
the installed-tree regression still verify actual resolutions, not just the lock.

Undici remains explicitly pinned to 8.10.2. npm 10 failed to resolve the previous
`$undici` override during the major upgrade; the explicit version preserves the
same security bound and matches Core. The high/critical audit gate is unchanged.

`core_sdk` in the compatibility manifest binds the Desktop SDK and Core Durable
versions. Release verification rejects a stale Desktop Pi version, and Core
staging verifies Core's package versions and the fixed Durable bundle's identity
against the runtime component manifest. Durable remains a Core-owned, default-off
internal executor; Desktop does not create a second execution database.

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
