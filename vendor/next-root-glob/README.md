# Next root-directory matching

Temporary dev-only replacement for the single `fast-glob.globSync(string,
{ onlyDirectories: true })` call in `@next/eslint-plugin-next@16.3.8`.
All Next lint rules remain enabled. This is not a general fast-glob replacement.

`braces@3.0.3` has no published fix for
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The scoped npm override removes its dependency chain instead of ignoring the
advisory. Patched `brace-expansion` preserves numeric/stepped root globs;
`tinyglobby` matches directories without globby's implicit recursive expansion.

References:

- [Next caller](https://github.com/vercel/next.js/blob/v16.3.8/packages/eslint-plugin-next/src/utils/get-root-dirs.ts)
- [tinyglobby migration](https://superchupu.dev/tinyglobby/migration#switching-from-fast-glob)

Remove this package and its override once a stable Next lint plugin no longer
requires vulnerable braces. Recheck by 2026-11-03. Regression coverage lives in
`scripts/dependency-security.test.mjs` and exercises the real Next rule.
