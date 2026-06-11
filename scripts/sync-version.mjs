#!/usr/bin/env node
/**
 * Mirror the single source-of-truth version (package.json#version) into
 * openclaw.plugin.json#version so the two never drift.
 *
 * package.json#version is authoritative — `pnpm version <bump>` bumps it,
 * and this script copies it into the OpenClaw manifest. Wired into the
 * `version` lifecycle (runs inside `pnpm version`, staged into the version
 * commit) and re-runnable standalone (`pnpm sync-version`).
 *
 * Edits only the manifest's `version` string in place — all other bytes
 * and formatting are preserved, so the diff is one line. Idempotent (a
 * no-op when already in sync) and fail-fast on a non-semver version. The
 * version-parity integration test is the guard that keeps this honest.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = resolve(ROOT, "package.json");
const MANIFEST_PATH = resolve(ROOT, "openclaw.plugin.json");

const SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

const version = JSON.parse(readFileSync(PKG_PATH, "utf8")).version;
if (typeof version !== "string" || !SEMVER.test(version)) {
  console.error(`[sync-version] refusing to sync non-semver version: ${version}`);
  process.exit(1);
}

const before = readFileSync(MANIFEST_PATH, "utf8");
if (JSON.parse(before).version === version) {
  console.log(`[sync-version] openclaw.plugin.json already at ${version}; no change.`);
  process.exit(0);
}

// Replace only the first `"version": "..."` — the top-level manifest field
// (it precedes every nested object in the file). The re-parse below proves
// the edit landed on the right key.
const after = before.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
const reparsed = JSON.parse(after);
if (reparsed.version !== version) {
  console.error(
    `[sync-version] post-edit manifest version is ${reparsed.version}, expected ${version} — aborting.`,
  );
  process.exit(1);
}

writeFileSync(MANIFEST_PATH, after, "utf8");
console.log(`[sync-version] openclaw.plugin.json → ${version}`);
