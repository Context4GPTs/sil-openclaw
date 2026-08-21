/**
 * Build `dist/` ONCE per vitest run (vitest.config.ts `globalSetup`) and install it
 * with `renameSync` only. The operator bins statically import `../dist/lib/*.js`, so a
 * `tsc` emitting straight into the shared `dist/` lets a bin spawned mid-emit read a
 * truncated module and die at ESM instantiation. `rename(2)` is atomic: every reader
 * sees one whole version. Card: create-shopper-bin-dies-on-its-exit-path.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/src/__tests__/helpers → the checkout root. */
export const REPO_ROOT = join(HERE, "..", "..", "..");
export const DIST_DIR = join(REPO_ROOT, "dist");

/** The compiler's real JS entry — `node_modules/.bin/tsc` is a shell wrapper `node`
 * cannot run directly. */
export const TSC_ENTRY = "node_modules/typescript/bin/tsc";
export const TSC_PROJECT = "tsconfig.build.json";

/** Every `../dist/**.js` an operator bin statically imports. Derived, not listed, so a
 * new bin import cannot silently escape the emitted-entries check. */
export function distEntriesTheBinsImport(): string[] {
  const scripts = join(REPO_ROOT, "scripts");
  const found = new Set<string>(["index.js"]);
  for (const file of readdirSync(scripts)) {
    if (!file.endsWith(".mjs")) continue;
    const source = readFileSync(join(scripts, file), "utf8");
    for (const m of source.matchAll(/["']\.\.\/dist\/([^"']+\.js)["']/g)) found.add(m[1]!);
  }
  return [...found].sort();
}

/** Move every emitted file over `distDir`, one atomic `rename(2)` each. */
function installTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) installTree(src, dst);
    else renameSync(src, dst);
  }
}

export interface BuildDistOptions {
  /** Unit-tier seam: run the compiler with this argv. Defaults to the real `tsc`. */
  compile?: (argv: string[]) => void;
  /** Unit-tier seam: install target. Defaults to the checkout's real `dist/`. */
  distDir?: string;
}

export function buildDist(opts: BuildDistOptions = {}): void {
  const distDir = opts.distDir ?? DIST_DIR;
  const compile = opts.compile ?? ((argv) => {
    execFileSync("node", argv, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  });
  // Under REPO_ROOT, never the OS tmpdir: `rename(2)` across filesystems is EXDEV, and
  // /tmp is routinely a different one.
  const outDir = mkdtempSync(join(REPO_ROOT, ".tmp-dist-build-"));
  try {
    compile([TSC_ENTRY, "-p", TSC_PROJECT, "--outDir", outDir]);
    for (const rel of distEntriesTheBinsImport()) {
      if (!existsSync(join(outDir, rel))) {
        throw new Error(`build did not emit ${rel} — an operator bin's import would 404`);
      }
    }
    installTree(outDir, distDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    /** What this run's ONE build installed. Absent ⇒ `globalSetup` never ran. */
    distBuild: string[];
  }
}

/** vitest `globalSetup` — runs once per vitest process, before any test file. */
export function setup(project: { provide: (key: "distBuild", value: string[]) => void }): void {
  buildDist();
  project.provide("distBuild", distEntriesTheBinsImport());
}
