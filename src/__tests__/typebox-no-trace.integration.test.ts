/**
 * INTEGRATION — no `@sinclair/typebox` left in the dependency tree after
 * the migration (tier: integration — reads the two real dependency-manifest
 * files on disk: package.json and pnpm-lock.yaml).
 *
 * Card: migrate-openclaw-tool-schemas-to-typebox-1-x, Pillar B. The whole
 * point of the migration is to stop straddling two TypeBox majors: the
 * plugin must depend on the standalone `typebox@1.x` and carry NO trace of
 * `@sinclair/typebox@0.34` anywhere. The lockfile is the load-bearing one —
 * 3 `@sinclair/typebox@0.34.14` references live there pre-migration and are
 * the easiest to leave behind if `package.json` is edited but the lock isn't
 * regenerated (a stale-lockfile straddle).
 *
 * THIS TEST IS GENUINELY RED ON THE PRE-MIGRATION TREE — package.json's
 * dependency block and pnpm-lock.yaml both name `@sinclair/typebox` today.
 * That failure is the Red signal the expert-developer turns Green by
 * swapping the dependency and regenerating the lockfile. Do NOT weaken or
 * skip it to make the suite pass before the migration lands.
 *
 * (Source-tree `@sinclair/typebox` references — the import specifiers in
 * src/tools/*.ts and src/types/openclaw.d.ts — are caught by `pnpm
 * typecheck` failing once the package is gone, and by the contract test
 * running against the new package. This file pins the DEPENDENCY-manifest
 * half of the no-trace criterion, which typecheck alone does not see.)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// src/__tests__ → repo root is two levels up.
const REPO_ROOT = join(HERE, "..", "..");

const OLD_TYPEBOX = "@sinclair/typebox";
/** The standalone successor the migration adopts. Used ONLY as an exact
 * dependency KEY in package.json (where it is unambiguous — `typebox` is a
 * distinct key from `@sinclair/typebox`). It is deliberately NOT used as a
 * raw-text `toContain` probe, because `@sinclair/typebox` contains the
 * substring `typebox`: a raw-text "does it mention typebox" check is
 * satisfied by the OLD package and proves nothing. New-package PRESENCE is
 * pinned by the package.json key + 1.x-range assertions below and by the
 * contract test, which only resolves if `typebox` is installed. */
const NEW_TYPEBOX = "typebox";

function readText(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readText("package.json")) as PackageJson;
}

/** Every dependency bucket flattened to one name→range map, so a stray
 * `@sinclair/typebox` cannot hide in devDependencies / optional / peer. */
function allDependencies(pkg: PackageJson): Record<string, string> {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
}

describe("package.json — no @sinclair/typebox, depends on standalone typebox@1.x", () => {
  const pkg = readPackageJson();
  const deps = allDependencies(pkg);

  it("declares NO @sinclair/typebox in any dependency bucket", () => {
    // RED pre-migration: dependencies['@sinclair/typebox'] === "0.34.14".
    expect(Object.keys(deps)).not.toContain(OLD_TYPEBOX);
  });

  it("declares the standalone `typebox` dependency", () => {
    // RED pre-migration: the standalone package is not yet a dependency.
    expect(Object.keys(deps)).toContain(NEW_TYPEBOX);
  });

  it("resolves `typebox` to a 1.x range (the migration target major)", () => {
    // Accepts exact-pin (`1.2.2`) or caret (`^1.2.2`) — both are defensible
    // per the architect; pin the MAJOR (1), not the discovery-time patch.
    const range = deps[NEW_TYPEBOX];
    expect(range).toBeTypeOf("string");
    // Leading `1` optionally prefixed by ^ ~ >= etc. — never a 0.x straddle.
    expect(range).toMatch(/^[\^~>=v\s]*1[.0-9xX]*/);
    expect(range).not.toMatch(/^[\^~>=v\s]*0\./);
  });

  it("contains the substring `@sinclair/typebox` NOWHERE in the raw file", () => {
    // Adversarial: catches the package surfacing outside the parsed
    // dependency buckets — a comment, a resolutions/overrides block, a
    // pnpm.overrides pin, anywhere in the raw text.
    expect(readText("package.json")).not.toContain(OLD_TYPEBOX);
  });
});

describe("pnpm-lock.yaml — no @sinclair/typebox node survives the regen (the load-bearing grep)", () => {
  // 3 `@sinclair/typebox@0.34.14` references live in the lockfile today
  // (importer spec, resolution block, dependency entry). A `package.json`
  // edit WITHOUT a lockfile regen — or `--frozen-lockfile` against the old
  // lock — leaves them behind and the plugin still straddles two majors.
  const lockfile = readText("pnpm-lock.yaml");

  it("contains NO `@sinclair/typebox` reference (zero, not 'fewer')", () => {
    // RED pre-migration: 3 references present. The byte-for-byte string is
    // what `grep -r "@sinclair/typebox" pnpm-lock.yaml` keys on. This is
    // the unambiguous load-bearing assertion — absence of the OLD scoped
    // package. (A positive "lockfile mentions typebox" probe is NOT done
    // here: the old name `@sinclair/typebox` contains the substring
    // `typebox`, so such a probe is green even on the unmigrated tree and
    // proves nothing. New-package presence is pinned in package.json above
    // and by the contract test resolving against the installed `typebox`.)
    expect(lockfile).not.toContain(OLD_TYPEBOX);
  });

  it("resolves the standalone `typebox` package at a 1.x version in the lock", () => {
    // Pins new-package PRESENCE unambiguously: the lockfile keys packages
    // as `typebox@<version>:` and `'typebox': specifier|version`. Match a
    // `typebox@1` token — produced ONLY by the standalone package at major
    // 1, never by `@sinclair/typebox@0.34.14` (different name AND major).
    // RED pre-migration: no `typebox@1` token exists in the lock yet.
    expect(lockfile).toMatch(/(^|[^@\w/])typebox@1\./m);
  });
});
