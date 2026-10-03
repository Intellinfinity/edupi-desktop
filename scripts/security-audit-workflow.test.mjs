import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("dependency security is checked on PRs, main, and a daily schedule", async () => {
  const [packageJson, workflow] = await Promise.all([
    read("package.json"),
    read(".github/workflows/security-audit.yml"),
  ]);
  assert.equal(JSON.parse(packageJson).scripts["security:audit"], "npm audit --audit-level=high");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /cron: "17 3 \* \* \*"/);
  assert.match(workflow, /run: npm run security:audit/);
  assert.match(workflow, /npm ci\s+npm ls fast-glob undici brace-expansion --all\s+node --test scripts\/dependency-security\.test\.mjs/);
  assert.match(workflow, /if: github\.event_name != 'schedule'/);
  assert.match(workflow, /npm test\s+node_modules\/\.bin\/tsc --noEmit\s+npm run lint/);
  assert.match(workflow, /run: cargo install cargo-audit --locked/);
  assert.match(workflow, /run: cargo audit --file src-tauri\/Cargo\.lock/);
  assert.doesNotMatch(workflow, /rustsec\/audit-check/);
});

test("Dependabot opens grouped security updates without routine version noise", async () => {
  const config = await read(".github/dependabot.yml");
  assert.match(config, /package-ecosystem: "npm"/);
  assert.match(config, /open-pull-requests-limit: 0/);
  assert.match(config, /applies-to: security-updates/);
  assert.match(config, /patterns:\s*\n\s*- "\*"/);
  assert.match(config, /package-ecosystem: "cargo"/);
  assert.match(config, /rust-security:/);
});
