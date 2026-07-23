/**
 * INTEGRATION — `pnpm release` reports DELIVERED vs HELD, per channel.
 *
 * `scripts/release.mjs` uploads to npm and ClawHub INDEPENDENTLY. A ClawHub
 * upload returns OK and then the scan verdict decides whether that version is
 * promoted; a `suspicious` one can sit unpromoted while npm has shipped. Today
 * the script exits 0 on both and says "published" — so the operator cannot tell
 * a delivered release from a held one, and npm users can be on a version
 * ClawHub-channel users will never see, while `README.md` calls ClawHub the
 * *recommended* install.
 *
 * The product ruling: **"published" and "delivered" are reported separately, per
 * channel** — for ClawHub, the post-upload promotion state, not the upload's exit
 * code. `pnpm release` exiting 0 while a channel holds the artefact is a false
 * green in our own hands, and this repo already has the pattern for it: the
 * `teardown_failed` rail, where an outcome that could not complete is a distinct,
 * louder result rather than green-washed.
 *
 * HOW THIS IS DRIVEN. `release.mjs` reaches every external tool by BARE NAME
 * through `execFileSync`, so a PATH-prepended shim dir intercepts all of them —
 * `git`, `npm`, `pnpm`, `tar`, `clawhub`. Nothing is uploaded and nothing is
 * built: the shims are doubles of the EXTERNAL binary boundary (permitted — they
 * stub no sil logic), and they record every argv so a test can prove WHICH
 * commands ran and IN WHAT ORDER. `--dry-run` is deliberately NOT used: a dry run
 * uploads nothing, so there is no promotion state to read back, and the criterion
 * is about a real upload.
 *
 * Card: clear-the-clawhub-suspicious-flag-review-findings (delivery signal).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASE = join(REPO_ROOT, "scripts", "release.mjs");
const VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string }
).version;

let shimDir: string;
let workDir: string;
let logPath: string;

/** One CJS shim, addressed by bare name, that logs its argv and answers. */
function writeShim(name: string, body: string): void {
  writeFileSync(
    join(shimDir, name),
    `#!/usr/bin/env node
const fs = require("fs");
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.SIL_SHIM_LOG, ${JSON.stringify(name)} + " " + argv.join(" ") + "\\n");
${body}
`,
    { mode: 0o755 },
  );
}

function installShims(): void {
  // git: a clean tree, HEAD carrying the v<version> tag, a stable sha.
  writeShim(
    "git",
    `if (argv[0] === "status") { process.stdout.write(""); process.exit(0); }
if (argv[0] === "tag") { process.stdout.write(${JSON.stringify(`v${VERSION}`)}); process.exit(0); }
if (argv[0] === "rev-parse") { process.stdout.write("0123456789abcdef0123456789abcdef01234567"); process.exit(0); }
process.exit(0);`,
  );

  // npm: authenticated; `pack --json` fabricates a real file and reports it.
  writeShim(
    "npm",
    `const path = require("path");
if (argv[0] === "whoami") { process.stdout.write("shim-user"); process.exit(0); }
if (argv[0] === "pack") {
  const destIdx = argv.indexOf("--pack-destination");
  const dest = destIdx === -1 ? process.cwd() : argv[destIdx + 1];
  const file = "shim-tarball-" + Date.now() + Math.random().toString(16).slice(2) + ".tgz";
  fs.writeFileSync(path.join(dest, file), "not-a-real-tarball");
  process.stdout.write(JSON.stringify([{ filename: file }]));
  process.exit(0);
}
process.exit(0);`,
  );

  // pnpm build / tar extract: no-ops (nothing is really built or unpacked).
  writeShim("pnpm", "process.exit(0);");
  writeShim(
    "tar",
    `const path = require("path");
const cIdx = argv.indexOf("-C");
if (cIdx !== -1) {
  const stage = path.join(argv[cIdx + 1], "package");
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ name: "sil-openclaw", version: ${JSON.stringify(VERSION)} }));
}
process.exit(0);`,
  );

  // clawhub: publish always succeeds; the SCAN VERDICT is what decides delivery.
  writeShim(
    "clawhub",
    `if (argv[0] === "--version") { process.stdout.write("0.22.0"); process.exit(0); }
if (argv[0] === "package" && argv[1] === "moderation-status") {
  const scan = process.env.SIL_SHIM_SCAN || "clean";
  process.stdout.write(JSON.stringify({
    latest: ${JSON.stringify(VERSION)},
    releaseScan: scan,
    blocked: scan === "suspicious",
    manualState: "none",
    openReports: 0,
  }));
  process.exit(0);
}
if (argv[0] === "package" && argv[1] === "inspect") {
  process.stdout.write(JSON.stringify({ latest: ${JSON.stringify(VERSION)}, scan: process.env.SIL_SHIM_SCAN || "clean" }));
  process.exit(0);
}
process.stdout.write("ok");
process.exit(0);`,
  );
}

interface Run {
  status: number;
  out: string;
  log: string;
}

function runRelease(env: Record<string, string> = {}): Run {
  let status = 0;
  let out = "";
  try {
    out = execFileSync("node", [RELEASE], {
      cwd: workDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
        SIL_SHIM_LOG: logPath,
        ...env,
      },
    });
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    status = e.status ?? 1;
    out = `${(e.stdout ?? "").toString()}\n${(e.stderr ?? "").toString()}`;
  }
  return { status, out, log: readFileSync(logPath, "utf8") };
}

beforeEach(() => {
  shimDir = mkdtempSync(join(tmpdir(), "sil-release-bin-"));
  workDir = mkdtempSync(join(tmpdir(), "sil-release-cwd-"));
  mkdirSync(workDir, { recursive: true });
  logPath = join(workDir, "shim.log");
  writeFileSync(logPath, "");
  installShims();
});

afterEach(() => {
  for (const d of [shimDir, workDir]) rmSync(d, { recursive: true, force: true });
  // `buildAndPack()` packs with cwd = REPO_ROOT and no --pack-destination, so the
  // shim's fabricated tarball lands in the repo. release.mjs removes it in a
  // `finally`, which a `process.exit()` inside the try would skip — sweep, so a
  // future implementation cannot litter the working tree from a test run.
  for (const f of readdirSync(REPO_ROOT)) {
    if (f.startsWith("shim-tarball-") && f.endsWith(".tgz")) {
      rmSync(join(REPO_ROOT, f), { force: true });
    }
  }
});

describe("release — the operator is told, per channel, whether the version was DELIVERED", () => {
  it("reads the ClawHub promotion state back AFTER publishing — the upload's exit code is not the verdict", () => {
    const r = runRelease({ SIL_SHIM_SCAN: "clean" });
    const publishAt = r.log.indexOf("clawhub package publish");
    const statusAt = r.log.indexOf("clawhub package moderation-status");
    expect(publishAt, `clawhub publish never ran:\n${r.log}`).toBeGreaterThanOrEqual(0);
    expect(
      statusAt,
      `release never read the promotion state back — the upload's exit code IS the report:\n${r.log}`,
    ).toBeGreaterThanOrEqual(0);
    expect(statusAt, "the state was read BEFORE publishing, so it cannot reflect this upload").
      toBeGreaterThan(publishAt);
  });

  it("a promoted release reports DELIVERED on both channels and exits 0", () => {
    const r = runRelease({ SIL_SHIM_SCAN: "clean" });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/npm[^\n]*deliver/i);
    expect(r.out).toMatch(/clawhub[^\n]*deliver/i);
  });

  it("a HELD ClawHub release is reported as held — not as a published success", () => {
    const r = runRelease({ SIL_SHIM_SCAN: "suspicious" });
    // npm shipped; ClawHub did not deliver. Both facts must be visible.
    expect(r.out).toMatch(/npm[^\n]*deliver/i);
    expect(
      /held|not delivered|undelivered|blocked/i.test(r.out),
      `the held ClawHub release was not reported as held:\n${r.out}`,
    ).toBe(true);
    expect(r.out).toMatch(/suspicious/i);
  });

  it("a held channel is a LOUD outcome — `pnpm release` does not exit 0 over it", () => {
    // The `teardown_failed` rail, operator-side: an outcome that could not
    // complete is a distinct, louder result, never green-washed. Exiting 0 here
    // is a false green in our own hands.
    const held = runRelease({ SIL_SHIM_SCAN: "suspicious" });
    const clean = runRelease({ SIL_SHIM_SCAN: "clean" });
    expect(clean.status).toBe(0);
    expect(held.status, `held release exited 0:\n${held.out}`).not.toBe(0);
  });

  it("guard-of-the-guard: the shims really intercepted every external tool", () => {
    // If PATH interception failed, the run would hit the REAL npm/clawhub — and
    // every assertion above would be about something other than release.mjs.
    const r = runRelease({ SIL_SHIM_SCAN: "clean" });
    for (const cmd of ["git status", "npm whoami", "npm pack", "clawhub package publish"]) {
      expect(r.log, `${cmd} did not go through the shim`).toContain(cmd);
    }
  });
});
