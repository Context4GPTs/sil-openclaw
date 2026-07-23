/**
 * INTEGRATION — the PACKED release artefact carries no `child_process`.
 *
 * ClawHub's static-analysis engine raises `suspicious.dangerous_exec` off the
 * shipped tarball, not the repo tree, so this guard packs the real artefact and
 * walks it. PR #70 already spent one release cycle on a partial fix: the scan
 * report quoted ONE line (`scripts/create-shopper.mjs`), while `scripts/
 * allowlist-openclaw.mjs` imported `node:child_process` too. De-exec'ing one and
 * leaving the other buys a second cycle on the identical cause — so this test
 * refuses to be told which files to look at:
 *
 *   1. It packs with `npm pack`, exactly as `scripts/release.mjs` does, and
 *      re-packs the extracted contents under the ClawHub name `@4gpts/sil`
 *      (`packClawhubTarball`) — BOTH published artefacts are scanned.
 *   2. It walks EVERY file in each extracted tarball. A bin added later is
 *      covered for free; nothing here is hand-listed.
 *   3. It matches the import/require surface honestly — the module specifier,
 *      the bare call sites, and the member call sites — so a rename
 *      (`execFileSync` → `spawnSync`, `node:child_process` → `child_process`)
 *      cannot slip through. `RE.exec(…)` is NOT a false positive: the bare
 *      pattern is member-access-aware.
 *   4. It proves its own matcher fires (POSITIVE CONTROL) and proves the walk
 *      actually reached the shipped bins and `dist/index.js` — a scanner that
 *      silently matched nothing, or a walk that silently visited nothing, is
 *      the vacuity trap that let this ship twice.
 *
 * It also pins `openclaw.plugin.json#security.noChildProcess` against reality in
 * BOTH directions: the declaration must equal what the tarball actually
 * contains. Declaring a capability we no longer have — or hiding one we do — is
 * the same honesty defect pointed two ways.
 *
 * Card: clear-the-clawhub-suspicious-flag-review-findings (slice M, criteria 1-2).
 *
 * NOTE — this test file imports `node:child_process` itself, to drive `npm` and
 * `tar`. Test sources are excluded from `tsconfig.build.json` and absent from
 * `package.json#files`, so they are not in either tarball; the assertions below
 * are what proves that.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

/** Extensions we treat as executable source regardless of content. */
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]);

interface Pattern {
  id: string;
  re: RegExp;
}

/**
 * Shapes that are unambiguously CODE wherever they appear — asserted against
 * every shipped file, prose included. A markdown page carrying `execFileSync(`
 * is documenting an exec we claim not to have.
 */
const HARD_PATTERNS: Pattern[] = [
  {
    id: "child_process import/require specifier",
    re: /(?:from|require|import)\s*\(?\s*(["'`])(?:node:)?child_process\1/,
  },
  {
    id: "exec/spawn call site",
    re: /(?<![.\w$])(?:execFileSync|execSync|execFile|spawnSync)\s*\(/,
  },
  {
    id: "member exec/spawn call site",
    re: /\.(?:execFileSync|execSync|execFile|spawnSync|spawn|fork)\s*\(/,
  },
];

/**
 * Shapes that could legitimately occur in English ("spawn (a process)",
 * "child_process is never imported") — asserted against code files only, where
 * they can only mean the real thing.
 */
const CODE_ONLY_PATTERNS: Pattern[] = [
  { id: "child_process module id", re: /(?<![\w$])(?:node:)?child_process(?![\w$])/ },
  { id: "bare spawn/exec/fork call", re: /(?<![.\w$])(?:spawn|exec|fork)\s*\(/ },
];

interface Hit {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

function isCodeFile(relPath: string, body: string): boolean {
  const dot = relPath.lastIndexOf(".");
  const ext = dot === -1 ? "" : relPath.slice(dot);
  if (CODE_EXT.has(ext)) return true;
  // A shipped bin need not carry an extension — the shebang makes it code.
  return body.startsWith("#!");
}

function scanText(relPath: string, body: string): Hit[] {
  const patterns = isCodeFile(relPath, body)
    ? [...HARD_PATTERNS, ...CODE_ONLY_PATTERNS]
    : HARD_PATTERNS;
  const hits: Hit[] = [];
  const lines = body.split("\n");
  for (const p of patterns) {
    lines.forEach((line, i) => {
      if (p.re.test(line)) {
        hits.push({ file: relPath, line: i + 1, pattern: p.id, text: line.trim().slice(0, 160) });
      }
    });
  }
  return hits;
}

/** Every file under `dir`, recursively, as paths relative to `dir` (POSIX-ish). */
function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs, base));
    else out.push(relative(base, abs).split(sep).join("/"));
  }
  return out.sort();
}

interface Packed {
  /** package.json#name inside the tarball. */
  name: string;
  /** Extracted `<tmp>/package` directory. */
  root: string;
  /** Every shipped file, relative to the package root. */
  files: string[];
  hits: Hit[];
}

function pack(args: string[], cwd: string, dest: string): string {
  const out = execFileSync(
    "npm",
    ["pack", ...args, "--json", "--ignore-scripts", "--pack-destination", dest],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const filename = JSON.parse(out)?.[0]?.filename;
  if (!filename) throw new Error(`npm pack reported no tarball filename (cwd=${cwd})`);
  return join(dest, filename);
}

function extract(tarball: string, into: string): string {
  execFileSync("tar", ["-xzf", tarball, "-C", into], { stdio: ["ignore", "pipe", "pipe"] });
  return join(into, "package");
}

function inspect(root: string): Packed {
  const files = walkFiles(root);
  const hits: Hit[] = [];
  for (const rel of files) {
    hits.push(...scanText(rel, readFileSync(join(root, rel), "utf8")));
  }
  return {
    name: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name as string,
    root,
    files,
    hits,
  };
}

function render(hits: Hit[]): string {
  return hits.map((h) => `${h.file}:${h.line} [${h.pattern}] ${h.text}`).join("\n");
}

let npmPkg: Packed;
let clawhubPkg: Packed;
let manifest: { security?: { noChildProcess?: unknown } };

beforeAll(() => {
  const stage = mkdtempSync(join(tmpdir(), "sil-packscan-"));

  // Build from CURRENT source so the scan reads the dist this tree emits, never
  // a stale one. No `clean` first: two sibling integration tests build the same
  // dist/ in parallel forks, and deleting it mid-run would race them.
  execFileSync("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // 1. The npm artefact, packed exactly as scripts/release.mjs packs it.
  const npmTarball = pack([], REPO_ROOT, stage);
  const npmDir = mkdtempSync(join(tmpdir(), "sil-packscan-npm-"));
  npmPkg = inspect(extract(npmTarball, npmDir));

  // 2. The ClawHub artefact — release.mjs#packClawhubTarball: extract the npm
  //    tarball, rewrite ONLY package.json#name, re-pack. Same bytes, new name.
  const restage = mkdtempSync(join(tmpdir(), "sil-packscan-clawhub-"));
  const restaged = extract(npmTarball, restage);
  const staged = JSON.parse(readFileSync(join(restaged, "package.json"), "utf8"));
  const pluginId = JSON.parse(
    readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"),
  ).id as string;
  staged.name = `@4gpts/${pluginId}`;
  writeFileSync(join(restaged, "package.json"), `${JSON.stringify(staged, null, 2)}\n`, "utf8");
  const clawhubTarball = pack([restaged], restage, restage);
  const clawhubDir = mkdtempSync(join(tmpdir(), "sil-packscan-ch-"));
  clawhubPkg = inspect(extract(clawhubTarball, clawhubDir));

  manifest = JSON.parse(readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"));
}, 180_000);

describe("packed tarball — zero child_process (ClawHub suspicious.dangerous_exec)", () => {
  it("the matcher fires on every forbidden shape (positive control)", () => {
    const samples: Array<[string, string]> = [
      ["import { execFileSync } from 'node:child_process';", "a.js"],
      ['import { spawn } from "child_process";', "a.js"],
      ['const cp = require("node:child_process");', "a.cjs"],
      ['const { execSync } = await import("child_process");', "a.mjs"],
      ["execFileSync('openclaw', args, {});", "a.js"],
      ["execSync('ls');", "a.js"],
      ["spawnSync('node', []);", "a.js"],
      ["cp.spawn('node', []);", "a.js"],
      ["childProcess.fork('./w.js');", "a.js"],
      ["spawn('node', []);", "a.js"],
      ["fork('./w.js');", "a.js"],
      ["exec('rm -rf /');", "a.js"],
      ["#!/usr/bin/env node\nexecFileSync('openclaw', []);", "bin-without-extension"],
      ["    const stdout = execFileSync(\"openclaw\", args, {", "README.md"],
    ];
    for (const [body, file] of samples) {
      expect(scanText(file, body), `matcher missed: ${file} :: ${body}`).not.toHaveLength(0);
    }
  });

  it("the matcher does not fire on the legitimate shapes this repo ships", () => {
    const benign: Array<[string, string]> = [
      ["const m = SEMVER_RE.exec(version.trim());", "a.js"],
      ["const m = /^([A-Za-z0-9_]+):\\s*(.*)$/.exec(line);", "a.js"],
      ["sil_doctor installs nothing, spawns no process, writes no host config.", "m.json"],
      ["It will never spawn (or fork) anything on your machine.", "README.md"],
      ["security.noChildProcess is true.", "README.md"],
      ["const results = list.map((x) => x.execute());", "a.js"],
    ];
    for (const [body, file] of benign) {
      expect(scanText(file, body), `false positive: ${file} :: ${body}`).toHaveLength(0);
    }
  });

  it("walks the whole npm tarball — every shipped bin and the plugin entry", () => {
    // Anti-vacuity: a walk that visited nothing would pass the scan below for
    // free. Pin that it reached the real artefact, and that every bin declared
    // in package.json#bin is present AND classified as code (so a future bin
    // cannot dodge the CODE_ONLY patterns by lacking an extension).
    const pkgJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const bins = Object.values(pkgJson.bin ?? {}) as string[];

    expect(npmPkg.files.length).toBeGreaterThan(10);
    expect(npmPkg.files).toContain("dist/index.js");
    expect(npmPkg.files).toContain("openclaw.plugin.json");

    for (const bin of bins) {
      const rel = bin.replace(/^\.\//, "");
      expect(npmPkg.files, `bin ${bin} is declared but not packed`).toContain(rel);
      const body = readFileSync(join(npmPkg.root, rel), "utf8");
      expect(isCodeFile(rel, body), `bin ${bin} is not scanned as code`).toBe(true);
    }

    // Every shipped .js/.mjs is scanned as code.
    const codeFiles = npmPkg.files.filter((f) =>
      isCodeFile(f, readFileSync(join(npmPkg.root, f), "utf8")),
    );
    expect(codeFiles.length).toBeGreaterThan(5);
  });

  it("the npm tarball (sil-openclaw) contains no child_process import or call", () => {
    expect(npmPkg.name).toBe("sil-openclaw");
    expect(render(npmPkg.hits)).toBe("");
  });

  it("the ClawHub re-pack (@4gpts/sil) contains no child_process import or call", () => {
    expect(npmPkg.name).toBe("sil-openclaw");
    expect(clawhubPkg.name).toBe("@4gpts/sil");
    expect(render(clawhubPkg.hits)).toBe("");
  });

  it("both artefacts ship identical contents — only package.json#name differs", () => {
    // Without this, the ClawHub scan above could be reading a stale or
    // mislabelled copy and prove nothing about the second published artefact.
    expect(clawhubPkg.files).toEqual(npmPkg.files);
    for (const rel of npmPkg.files) {
      if (rel === "package.json") continue;
      expect(
        readFileSync(join(clawhubPkg.root, rel), "utf8"),
        `${rel} drifted between the npm and ClawHub artefacts`,
      ).toBe(readFileSync(join(npmPkg.root, rel), "utf8"));
    }
    const a = JSON.parse(readFileSync(join(npmPkg.root, "package.json"), "utf8"));
    const b = JSON.parse(readFileSync(join(clawhubPkg.root, "package.json"), "utf8"));
    delete a.name;
    delete b.name;
    expect(b).toEqual(a);
  });

  it("no shipped file references the child_process module at all", () => {
    // The specifier check on its own, reported separately so a regression names
    // the module rather than a call shape.
    const specifier = /(?<![\w$])(?:node:)?child_process(?![\w$])/;
    const offenders = npmPkg.files.filter((f) =>
      specifier.test(readFileSync(join(npmPkg.root, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("security.noChildProcess — declared vs actual", () => {
  it("declares true", () => {
    expect(manifest.security?.noChildProcess).toBe(true);
  });

  it("the declaration equals what the tarball actually contains, in both directions", () => {
    const actuallyFree = npmPkg.hits.length === 0 && clawhubPkg.hits.length === 0;
    expect(
      manifest.security?.noChildProcess,
      actuallyFree
        ? "tarball is exec-free but the manifest still declares noChildProcess:false"
        : `manifest declares noChildProcess:${String(manifest.security?.noChildProcess)} while the tarball execs:\n${render(npmPkg.hits)}`,
    ).toBe(actuallyFree);
  });
});
