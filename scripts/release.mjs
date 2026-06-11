#!/usr/bin/env node
/**
 * Build, pack ONCE, and publish the identical tarball to npm and ClawHub.
 *
 * The two registries receive the SAME bytes: this builds a clean `dist/`,
 * `npm pack` produces one tarball, and both `npm publish <tarball>` and
 * `clawhub package publish <tarball>` upload that exact artifact. One build,
 * one artifact, two registries — no drift between what npm and ClawHub serve.
 *
 * Usage:
 *   pnpm release        publish for real (npm + ClawHub)
 *   pnpm release:dry    dry-run both: build + pack + preview, upload NOTHING
 *
 * Real-publish preflight (skipped under --dry-run, which is a pure preview):
 *   - clean git working tree
 *   - HEAD carries the v<version> tag  (run `pnpm version <bump>` first)
 *   - `npm whoami` succeeds            (run `npm login`)
 *   - `clawhub` CLI on PATH            (npm i -g clawhub && clawhub login)
 *
 * ClawHub attribution: --family code-plugin, --owner (env CLAWHUB_OWNER,
 * default below), --source-repo (derived from package.json#repository),
 * --source-commit HEAD, and --tags latest on a real publish.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
// The 4gpts ClawHub org we publish under (mirrors the @4gpts npm scope). You
// authenticate as an org member via `clawhub login`; override with CLAWHUB_OWNER.
const DEFAULT_CLAWHUB_OWNER = "4gpts";
const CLAWHUB_FAMILY = "code-plugin";

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const version = pkg.version;
const tag = `v${version}`;

const log = (msg) => console.log(`[release] ${msg}`);
function fail(msg) {
  console.error(`[release] ${msg}`);
  process.exit(1);
}

/** Run a command, inheriting stdio (output streams to the terminal). */
function runInherit(cmd, args) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
}
/** Run a command and capture trimmed stdout. */
function capture(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();
}
/** Capture stdout, or null on any non-zero exit / spawn failure. */
function tryCapture(cmd, args) {
  try {
    return capture(cmd, args);
  } catch {
    return null;
  }
}
/** True if `cmd` is resolvable on PATH (a non-zero exit still means present). */
function commandExists(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch (err) {
    return err.code !== "ENOENT";
  }
}

/** Derive "Owner/Repo" for ClawHub --source-repo from package.json#repository.url. */
function sourceRepo() {
  const url = pkg.repository?.url ?? "";
  const m = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!m) fail(`cannot derive --source-repo from package.json#repository.url: "${url}"`);
  return m[1];
}

function preflight() {
  if (!pkg.name) fail("package.json#name is missing — cannot publish.");
  if (DRY_RUN) {
    log("dry-run: skipping clean-tree / tag / auth preflight (pure preview).");
    return;
  }
  const dirty = capture("git", ["status", "--porcelain"]);
  if (dirty) fail(`working tree is dirty — commit or stash first:\n${dirty}`);

  const headTags = (tryCapture("git", ["tag", "--points-at", "HEAD"]) ?? "").split("\n");
  if (!headTags.includes(tag)) {
    fail(`HEAD is not tagged ${tag}. Run \`pnpm version <patch|minor|major>\` first.`);
  }

  const npmUser = tryCapture("npm", ["whoami"]);
  if (!npmUser) fail("not authenticated with npm. Run `npm login`.");
  log(`npm user: ${npmUser}`);

  if (!commandExists("clawhub")) {
    fail("clawhub CLI not found on PATH. Run `npm i -g clawhub && clawhub login`.");
  }
}

/** Clean-build dist, then pack a single tarball. Returns its absolute path. */
function buildAndPack() {
  log("building (clean dist → tsc)…");
  runInherit("pnpm", ["build"]);
  log("packing tarball…");
  // --ignore-scripts: dist is already fresh from the explicit build above, so
  // skip prepack here and keep `npm pack --json` stdout pure JSON.
  const out = capture("npm", ["pack", "--json", "--ignore-scripts"]);
  const filename = JSON.parse(out)?.[0]?.filename;
  if (!filename) fail("`npm pack --json` did not report a tarball filename.");
  return resolve(ROOT, filename);
}

function publishNpm(tarball) {
  const args = ["publish", tarball];
  if (DRY_RUN) args.push("--dry-run");
  log(`npm publish${DRY_RUN ? " --dry-run" : ""} ${basename(tarball)}`);
  runInherit("npm", args);
}

function publishClawhub(tarball) {
  const owner = process.env.CLAWHUB_OWNER || DEFAULT_CLAWHUB_OWNER;
  const sha = capture("git", ["rev-parse", "HEAD"]);
  // The release notes for this version, straight from CHANGELOG.md (empty if
  // the version has no section yet — then we just omit --changelog).
  const changelog = (tryCapture("node", ["scripts/changelog.mjs", "show", version]) ?? "").trim();
  const args = [
    "package",
    "publish",
    tarball,
    "--family",
    CLAWHUB_FAMILY,
    "--owner",
    owner,
    "--source-repo",
    sourceRepo(),
    "--source-commit",
    sha,
  ];
  if (changelog) args.push("--changelog", changelog);
  if (DRY_RUN) args.push("--dry-run");
  else args.push("--tags", "latest");
  log(
    `clawhub package publish${DRY_RUN ? " --dry-run" : ""} (owner=${owner}, repo=${sourceRepo()}` +
      `, changelog=${changelog ? "yes" : "none"})`,
  );
  runInherit("clawhub", args);
}

log(`${DRY_RUN ? "DRY-RUN " : ""}release ${pkg.name}@${version}`);
preflight();
const tarball = buildAndPack();
try {
  publishNpm(tarball);
  publishClawhub(tarball);
} finally {
  rmSync(tarball, { force: true });
}
log(
  DRY_RUN
    ? "dry-run complete — nothing was uploaded."
    : `published ${pkg.name}@${version} to npm + ClawHub.`,
);
if (!DRY_RUN) {
  log(`next: \`clawhub package readiness ${pkg.name}\` to check ClawHub readiness blockers.`);
}
