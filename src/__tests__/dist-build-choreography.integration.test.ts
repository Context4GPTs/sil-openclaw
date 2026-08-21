/**
 * INTEGRATION — who builds `dist/`, and when (tier: integration — reads what this run's
 * `globalSetup` provided, the real `dist/` it produced, and every test file's source).
 *
 * Card: create-shopper-bin-dies-on-its-exit-path. `create-shopper.integration.test.ts`
 * and `openclaw-allowlist.integration.test.ts` each drove the build compiler in a
 * `beforeAll`, emitting NON-atomically into the one shared `dist/` — while their own
 * spawned bins were statically importing `../dist/lib/*.js`. A bin that started mid-emit
 * read a truncated module and died at ESM instantiation (stdout empty, exit 1). Measured
 * 1 anomaly in 2,365 spawns under 6-way parallel vitest; 32 in ~24,000 against a
 * compiler storm; `dist/lib/profile-store.js` read 0 bytes on 11 of 811,224 reads.
 *
 * The fix has two halves and neither closes it alone: ONE build per vitest process
 * (`globalSetup`, finished before any test file runs) kills the intra-run race, and an
 * ATOMIC rename install kills the cross-process one (4 parallel `vitest run`s each
 * build; run A's tests race run B's emit). These guards pin the MECHANISM — a
 * probabilistic race cannot be a suite assertion under `no-ci-by-design.md`.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the config.
 */

import { describe, it, expect, inject } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { distEntriesTheBinsImport, DIST_DIR, REPO_ROOT, TSC_ENTRY, TSC_PROJECT } from "./helpers/build-dist";

const TESTS_DIR = join(REPO_ROOT, "src", "__tests__");

/** The ONE test file allowed to drive the build compiler itself: it plants a stale
 * artifact and rebuilds over it in a private outDir to prove stale-dist immunity —
 * that isolated build is the entire point of the file. Add-only; never loosen. */
const TEST_FILES_THAT_MAY_COMPILE = ["compiled-artifact-load.integration.test.ts"];

function testFiles(): string[] {
  return readdirSync(TESTS_DIR, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".test.ts"))
    .sort();
}

/** Value exports (not `type`/`interface`) declared by a TypeScript source. */
function valueExports(tsSource: string): string[] {
  return [...tsSource.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([A-Za-z0-9_$]+)/gm)]
    .map((m) => m[1]!)
    .sort();
}

describe("dist/ is built once per vitest run, before any test file executes", () => {
  it("globalSetup runs the shared build helper, and the dist/ it produced matches CURRENT source", async () => {
    // Behavioural, not a config grep: only `helpers/build-dist.ts#setup` provides this
    // key, and vitest resolves `globalSetup` before it loads a single test file. Absent
    // ⇒ the wiring is gone, whatever `vitest.config.ts` happens to say.
    expect(inject("distBuild")).toEqual(distEntriesTheBinsImport());

    // Anti-vacuity, and the measured failure itself: `does not provide an export named
    // getShopperArtefactDir` was a bin reading a dist/ that did NOT match its source.
    // Runtime export names, not a text grep — a half-written module cannot fake these.
    const libEntries = distEntriesTheBinsImport().filter((e) => e.startsWith("lib/"));
    expect(libEntries.length).toBeGreaterThan(1);
    for (const rel of libEntries) {
      const compiled = await import(pathToFileURL(join(DIST_DIR, rel)).href);
      const source = readFileSync(join(REPO_ROOT, "src", rel.replace(/\.js$/, ".ts")), "utf8");
      expect(Object.keys(compiled).sort()).toEqual(valueExports(source));
    }
  });

  it("no test file compiles into dist/ — a re-added beforeAll build reopens the race", () => {
    // The failure mode nothing else catches: `globalSetup` can be wired and correct
    // while a per-file `beforeAll` still rewrites the shared dist/ under running bins.
    const drivers = testFiles().filter((rel) => {
      const source = readFileSync(join(TESTS_DIR, rel), "utf8");
      return source.includes(TSC_ENTRY) || source.includes(TSC_PROJECT);
    });

    expect(drivers.map((p) => p.split("/").at(-1))).toEqual(TEST_FILES_THAT_MAY_COMPILE);

    for (const rel of drivers) {
      const source = readFileSync(join(TESTS_DIR, rel), "utf8");
      expect(source).toContain("--outDir");
      // …and that outDir is a private scratch dir, never the shared dist/.
      expect(source).not.toMatch(/--outDir["'\s,]+["'`]?dist/);
    }

    // Anti-vacuity: the exact set above means nothing if the walk found no files.
    expect(testFiles().length).toBeGreaterThan(20);
  });
});
