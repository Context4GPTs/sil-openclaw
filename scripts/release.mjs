#!/usr/bin/env node
/**
 * Build, pack, and publish to npm and ClawHub.
 *
 * The two registries publish under DIFFERENT names, by hard constraint:
 *   - npm:     `sil-openclaw`  (unscoped — the bare `sil` is taken upstream)
 *   - ClawHub: `@4gpts/sil`    (the plugin id `sil` cannot be claimed on its own;
 *              it is already owned by the @4gpts/sil package, so ClawHub publishes
 *              under the scoped @<owner>/<plugin-id> name. The runtime plugin id
 *              stays `sil`, so `openclaw plugins install clawhub:sil` still resolves.)
 *
 * One clean build, then the SAME file content to both registries: npm gets the
 * packed `sil-openclaw` tarball as-is; ClawHub gets those identical files
 * re-packed with only package.json#name rewritten to `@4gpts/sil` (ClawHub
 * requires --name to equal the tarball's package.json#name). Same content, the
 * name field is the only difference — no drift in what the two registries serve.
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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
// The 4gpts ClawHub org we publish under (mirrors the @4gpts npm scope). You
// authenticate as an org member via `clawhub login`; override with CLAWHUB_OWNER.
const DEFAULT_CLAWHUB_OWNER = "4gpts";
const CLAWHUB_OWNER = process.env.CLAWHUB_OWNER || DEFAULT_CLAWHUB_OWNER;
const CLAWHUB_FAMILY = "code-plugin";

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const version = pkg.version;
const tag = `v${version}`;

// ClawHub package name: the SCOPED @<owner>/<plugin-id> identity (e.g. @4gpts/sil).
// The bare plugin id (`sil`, openclaw.plugin.json#id) cannot be a package name on
// its own — it is already claimed by the @4gpts/sil package — so the scoped name is
// the ClawHub identity, while the runtime plugin id stays `sil`. Derived from owner
// + id so it never drifts from the manifest.
const CLAWHUB_PLUGIN_ID = JSON.parse(
  readFileSync(resolve(ROOT, "openclaw.plugin.json"), "utf8"),
).id;
const CLAWHUB_NAME = `@${CLAWHUB_OWNER}/${CLAWHUB_PLUGIN_ID}`;

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

/**
 * Re-pack the just-built npm tarball under the ClawHub name. ClawHub requires
 * --name to EQUAL the tarball's package.json#name, and the npm tarball carries
 * `sil-openclaw` — so extract it, rewrite ONLY package.json#name to CLAWHUB_NAME
 * (@4gpts/sil), and `npm pack` the renamed package. The content is identical to
 * npm's (same extracted files); only the name field changes. Returns the staged
 * tarball path — its parent temp dir is the caller's to remove.
 */
function packClawhubTarball(npmTarball) {
  const stage = mkdtempSync(resolve(tmpdir(), "sil-clawhub-"));
  // Extract the already-built npm tarball (→ <stage>/package/...) so the ClawHub
  // artifact ships the exact same files, not a separate build.
  runInherit("tar", ["-xzf", npmTarball, "-C", stage]);
  const pkgPath = resolve(stage, "package", "package.json");
  const staged = JSON.parse(readFileSync(pkgPath, "utf8"));
  staged.name = CLAWHUB_NAME;
  writeFileSync(pkgPath, `${JSON.stringify(staged, null, 2)}\n`, "utf8");
  // Re-pack the renamed package dir into the same temp dir. --ignore-scripts: no
  // prepack rebuild (the dist is already inside the extracted package).
  const out = capture("npm", [
    "pack",
    resolve(stage, "package"),
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    stage,
  ]);
  const filename = JSON.parse(out)?.[0]?.filename;
  if (!filename) fail("clawhub stage: `npm pack --json` did not report a tarball filename.");
  return resolve(stage, filename);
}

function publishClawhub(npmTarball) {
  const sha = capture("git", ["rev-parse", "HEAD"]);
  // The release notes for this version, straight from CHANGELOG.md (empty if the
  // version has no section yet — then we just omit --changelog).
  const changelog = (tryCapture("node", ["scripts/changelog.mjs", "show", version]) ?? "").trim();
  // Stage the @4gpts/sil-named tarball (ClawHub requires --name == package name).
  const tarball = packClawhubTarball(npmTarball);
  try {
    const args = [
      "package",
      "publish",
      tarball,
      "--family",
      CLAWHUB_FAMILY,
      "--name",
      CLAWHUB_NAME,
      "--owner",
      CLAWHUB_OWNER,
      "--source-repo",
      sourceRepo(),
      "--source-commit",
      sha,
    ];
    if (changelog) args.push("--changelog", changelog);
    if (DRY_RUN) args.push("--dry-run");
    else args.push("--tags", "latest");
    log(
      `clawhub package publish${DRY_RUN ? " --dry-run" : ""} (name=${CLAWHUB_NAME}, owner=${CLAWHUB_OWNER}, ` +
        `repo=${sourceRepo()}, changelog=${changelog ? "yes" : "none"})`,
    );
    runInherit("clawhub", args);
  } finally {
    rmSync(dirname(tarball), { recursive: true, force: true });
  }
}

log(`${DRY_RUN ? "DRY-RUN " : ""}release ${pkg.name}@${version} (npm) + ${CLAWHUB_NAME}@${version} (ClawHub)`);
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
    : `published ${pkg.name}@${version} (npm) + ${CLAWHUB_NAME}@${version} (ClawHub).`,
);
if (!DRY_RUN) {
  log(`next: \`clawhub package readiness ${CLAWHUB_NAME}\` to check ClawHub readiness blockers.`);
}
