#!/usr/bin/env node
/**
 * One build, one tarball: STAGED on npm (`sil-openclaw`), public only once a maintainer
 * approves it with 2FA, then the same files to ClawHub (`@4gpts/sil`). Re-running resumes.
 *   pnpm release        stage → wait for `npm stage approve` → verify → ClawHub
 *   pnpm release:dry    build + pack + preview both, upload nothing
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
// The 4gpts ClawHub org we publish under (mirrors the @4gpts npm scope). You
// authenticate as an org member via `clawhub login`; override with CLAWHUB_OWNER.
const DEFAULT_CLAWHUB_OWNER = "4gpts";
const CLAWHUB_OWNER = process.env.CLAWHUB_OWNER || DEFAULT_CLAWHUB_OWNER;
const CLAWHUB_FAMILY = "code-plugin";
const APPROVAL_POLL_MS = 15_000;
const APPROVAL_TIMEOUT_MIN = 30;
// Bounds every registry call, so a hung npm cannot stall the approval wait unseen.
const REGISTRY_CALL_TIMEOUT_MS = 60_000;

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
// Throws, never exits: the tarball cleanup in `finally` must run on every failure.
function fail(msg) {
  throw new Error(msg);
}

/** Run a command, inheriting stdio (output streams to the terminal). */
function runInherit(cmd, args) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
}
/** Run a command and capture trimmed stdout. */
function capture(cmd, args) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: REGISTRY_CALL_TIMEOUT_MS,
  }).trim();
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

/** Clean-build dist, then pack a single tarball. */
function buildAndPack() {
  log("building (clean dist → tsc)…");
  runInherit("pnpm", ["build"]);
  log("packing tarball…");
  // --ignore-scripts: dist is already fresh from the explicit build above, so
  // skip prepack here and keep `npm pack --json` stdout pure JSON.
  const [packed] = JSON.parse(capture("npm", ["pack", "--json", "--ignore-scripts"]));
  if (!packed?.filename) fail("`npm pack --json` did not report a tarball filename.");
  return { path: resolve(ROOT, packed.filename), shasum: packed.shasum, integrity: packed.integrity };
}

/** The integrity npm serves publicly for this version, or null while it is not public. */
function publicIntegrity() {
  // --prefer-online: the packument cache would otherwise hide the approval for minutes.
  return (
    tryCapture("npm", ["view", `${pkg.name}@${version}`, "dist.integrity", "--prefer-online"]) ||
    null
  );
}

function stagedEntry() {
  const staged = JSON.parse(tryCapture("npm", ["stage", "list", pkg.name, "--json"]) || "[]");
  return staged.find((s) => s.version === version) ?? null;
}

/**
 * npm, staged: `npm stage publish` needs no 2FA from any token; approval does, so a human
 * is present for every public version. ClawHub waits for it — a rejected stage never
 * reaches the other registry. Resumes from whichever state a previous run left.
 */
async function releaseNpm(tarball) {
  if (DRY_RUN) {
    log(`npm stage publish --dry-run ${basename(tarball.path)}`);
    runInherit("npm", ["stage", "publish", tarball.path, "--dry-run"]);
    return;
  }
  let served = publicIntegrity();
  if (!served) {
    let staged = stagedEntry();
    if (!staged) {
      log(`npm stage publish ${basename(tarball.path)}`);
      runInherit("npm", ["stage", "publish", tarball.path]);
      staged = stagedEntry();
      if (!staged) fail(`npm reports no staged ${pkg.name}@${version} after staging.`);
    }
    if (staged.shasum !== tarball.shasum) {
      fail(
        `staged ${pkg.name}@${version} (${staged.shasum}) is not this build (${tarball.shasum}). ` +
          `Run \`npm stage reject ${staged.id}\`, then re-run.`,
      );
    }
    log(`staged ${pkg.name}@${version} (${staged.status}). Approve it with 2FA:`);
    log(`    npm stage approve ${staged.id}`);
    log(`waiting up to ${APPROVAL_TIMEOUT_MIN} min for it to go public…`);
    const deadline = Date.now() + APPROVAL_TIMEOUT_MIN * 60_000;
    while (!(served = publicIntegrity())) {
      if (Date.now() > deadline) {
        fail(`not approved within ${APPROVAL_TIMEOUT_MIN} min. Approve, then re-run \`pnpm release\` — it resumes here.`);
      }
      await sleep(APPROVAL_POLL_MS);
    }
  }
  if (served !== tarball.integrity) {
    fail(`npm serves a different ${pkg.name}@${version} (${served}) than ${tag} builds (${tarball.integrity}).`);
  }
  log(`npm serves ${pkg.name}@${version}, identical to this build.`);
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

async function main() {
  log(`${DRY_RUN ? "DRY-RUN " : ""}release ${pkg.name}@${version} (npm) + ${CLAWHUB_NAME}@${version} (ClawHub)`);
  preflight();
  const tarball = buildAndPack();
  try {
    await releaseNpm(tarball);
    publishClawhub(tarball.path);
  } finally {
    rmSync(tarball.path, { force: true });
  }
  if (DRY_RUN) return log("dry-run complete — nothing was uploaded.");
  log(`published ${pkg.name}@${version} (npm) + ${CLAWHUB_NAME}@${version} (ClawHub).`);
  log(`next: \`clawhub package readiness ${CLAWHUB_NAME}\` to check ClawHub readiness blockers.`);
}

main().catch((err) => {
  console.error(`[release] ${err.message}`);
  process.exitCode = 1;
});
