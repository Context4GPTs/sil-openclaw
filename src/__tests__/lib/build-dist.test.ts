/**
 * UNIT — the shared `dist/` build helper (`src/__tests__/helpers/build-dist.ts`).
 *
 * Card: create-shopper-bin-dies-on-its-exit-path. `tsc` emitting straight into the one
 * shared `dist/` let a bin spawned mid-emit read a truncated module and die at ESM
 * instantiation (`does not provide an export named …`, exit 1, stdout empty). The
 * helper's whole job is that emit never being observable: compile to a temp `--outDir`,
 * then install by `rename(2)`, which is atomic — a concurrent reader sees the whole old
 * file or the whole new one, never a half-written one.
 *
 * The compiler is the injected seam (a real `tsc` is a 15 s integration cost); the
 * INSTALL is the real code path, exercised against a real temp `dist/`. Atomicity is
 * asserted by INODE IDENTITY, not by a spy: `rename(2)` moves the inode, every copying
 * install (`copyFileSync`, `writeFileSync`, `cp -a`) allocates a new one. A spy on
 * `renameSync` would prove it was called, not that nothing else did the work.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the helper.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import {
  buildDist,
  distEntriesTheBinsImport,
  DIST_DIR,
  REPO_ROOT,
  TSC_ENTRY,
  TSC_PROJECT,
} from "../helpers/build-dist";

/** A file the bins do NOT import, nested one level deeper — proves the install walks
 * the whole emitted tree, not just the entries it checks for. */
const EXTRA_EMIT = "tools/catalog.js";

let distDir: string;
/** Every argv the injected compiler was handed, in call order. */
let compileCalls: string[][];
/** `dist/lib/doc-store.js` as the compiler saw it, per call. */
let distDuringCompile: (string | null)[];
/** Inode of each file the compiler emitted, keyed by path relative to the outDir. */
let emittedInodes: Map<string, number>;
/** outDirs the helper asked the compiler to emit into. */
let outDirs: string[];

/** Stand-in for `tsc`: reads `--outDir` off the argv and plants a realistic emit tree
 * there — every entry the bins import, plus one nested extra. */
function fakeCompile(argv: string[]): void {
  compileCalls.push(argv);
  const outDir = argv[argv.indexOf("--outDir") + 1]!;
  outDirs.push(outDir);
  const seen = join(distDir, "lib", "doc-store.js");
  distDuringCompile.push(existsSync(seen) ? readFileSync(seen, "utf8") : null);

  for (const rel of [...distEntriesTheBinsImport(), EXTRA_EMIT]) {
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `// fresh ${rel}\n`);
    emittedInodes.set(rel, statSync(target).ino);
  }
}

beforeEach(() => {
  // Under REPO_ROOT, not the OS tmpdir: /tmp is a different filesystem here, and
  // `rename(2)` across filesystems is EXDEV — the same constraint the helper is
  // written to, so a target elsewhere would test a path the helper never takes.
  distDir = mkdtempSync(join(REPO_ROOT, ".tmp-dist-target-"));
  compileCalls = [];
  distDuringCompile = [];
  emittedInodes = new Map();
  outDirs = [];
});

// No sweep of stray `.tmp-dist-build-*` here: `buildDist` removes its own in a
// `finally`, and a blind sweep would delete a PARALLEL vitest run's in-flight outDir.
afterEach(() => {
  rmSync(distDir, { recursive: true, force: true });
});

/** Seed the target with a previous build so "the compiler never wrote here" is
 * observable rather than vacuous against an empty directory. */
function seedPreviousBuild(): void {
  mkdirSync(join(distDir, "lib"), { recursive: true });
  writeFileSync(join(distDir, "lib", "doc-store.js"), "// STALE\n");
}

describe("buildDist — compiles to a temp outDir and installs by rename only", () => {
  it("never names dist/ as an output path, and every emitted file lands there by rename (same inode)", () => {
    seedPreviousBuild();

    buildDist({ compile: fakeCompile, distDir });

    expect(compileCalls).toHaveLength(1);
    const argv = compileCalls[0]!;
    expect(argv[0]).toBe(TSC_ENTRY);
    expect(argv).toContain("-p");
    expect(argv).toContain(TSC_PROJECT);

    // No compiler output path IS dist/, or lives under it — the emit must be
    // unobservable to a bin importing dist/ while it runs.
    const outDir = outDirs[0]!;
    expect(outDir).not.toBe(distDir);
    expect(relative(distDir, outDir).startsWith("..")).toBe(true);
    for (const arg of argv) {
      const asPath = resolve(REPO_ROOT, arg);
      expect(asPath).not.toBe(distDir);
      expect(relative(distDir, asPath).startsWith("..")).toBe(true);
    }
    // …and the install runs strictly AFTER the compile: mid-compile, dist/ still
    // held the previous build byte-for-byte.
    expect(distDuringCompile).toEqual(["// STALE\n"]);

    // The whole emitted tree arrived, each file by rename — a copying install would
    // allocate a fresh inode for every one of these.
    for (const [rel, ino] of emittedInodes) {
      expect(existsSync(join(distDir, rel))).toBe(true);
      expect(statSync(join(distDir, rel)).ino).toBe(ino);
    }
    expect(emittedInodes.has(EXTRA_EMIT)).toBe(true);

    // The scratch outDir is gone — no orphan build tree under the checkout root.
    expect(existsSync(outDir)).toBe(false);
  });

  it("throws instead of installing when the build misses an entry a bin imports", () => {
    // The failure mode no other test catches: a partial emit installed into dist/ ships
    // a shopper whose `../dist/lib/*.js` import 404s at ESM load — green suite, dead bin.
    seedPreviousBuild();
    const missing = distEntriesTheBinsImport().find((e) => e.startsWith("lib/"))!;
    const partialCompile = (argv: string[]): void => {
      fakeCompile(argv);
      rmSync(join(outDirs.at(-1)!, missing), { force: true });
    };

    expect(() => buildDist({ compile: partialCompile, distDir })).toThrow(missing);

    expect(readFileSync(join(distDir, "lib", "doc-store.js"), "utf8")).toBe("// STALE\n");
    expect(existsSync(join(distDir, EXTRA_EMIT))).toBe(false);
    expect(existsSync(outDirs[0]!)).toBe(false);
  });
});

describe("distEntriesTheBinsImport — derived from the bins, never a hand-list", () => {
  it("names every ../dist/*.js an operator script statically imports, plus the plugin entry", () => {
    const entries = distEntriesTheBinsImport();

    const fromSource = new Set<string>(["index.js"]);
    for (const file of readdirSync(join(REPO_ROOT, "scripts"))) {
      if (!file.endsWith(".mjs")) continue;
      const source = readFileSync(join(REPO_ROOT, "scripts", file), "utf8");
      for (const m of source.matchAll(/from\s+["']\.\.\/dist\/([^"']+\.js)["']/g)) fromSource.add(m[1]!);
    }

    expect(entries).toEqual([...fromSource].sort());
    // Anti-vacuity: an empty or single-entry derivation would satisfy the equality
    // above while checking nothing, and these two are the imports that actually broke.
    expect(entries).toContain("lib/doc-store.js");
    expect(entries).toContain("lib/openclaw-allowlist.js");
  });
});

describe("the default install target is the directory the bins actually import", () => {
  it("DIST_DIR is where `../dist/lib/doc-store.js` resolves from scripts/", () => {
    // Anti-vacuity for the seam: every assertion above runs against an INJECTED
    // distDir, so a default pointing somewhere else would go unnoticed. Derived from
    // the bin's own import specifier, never restated from the helper.
    const asTheBinResolvesIt = resolve(REPO_ROOT, "scripts", "../dist/lib/doc-store.js");
    expect(join(DIST_DIR, "lib", "doc-store.js")).toBe(asTheBinResolvesIt);
  });
});
