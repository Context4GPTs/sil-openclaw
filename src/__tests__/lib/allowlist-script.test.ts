/**
 * UNIT — the allowlist-script resolver (tier: unit — no network, no spawn, <100ms).
 *
 * THE TRAP THIS FILE EXISTS TO CATCH: a cwd-derived root. `process.cwd()` IS the repo
 * root under vitest, so a `resolve("scripts/allowlist-openclaw.mjs")` implementation is
 * green here and broken in production, where cwd is the agent's workspace. The bar below
 * re-imports the module with the process REALLY chdir'd elsewhere and demands the same
 * absolute path — total, because it pins the ONE right answer rather than forbidding a
 * list of wrong mechanisms (a cwd root, a PATH lookup, a homedir root and a hardcoded
 * install path all fail it alike). Deliberately NOT a source scan for `process.cwd`: the
 * module's own header disavows cwd by name, so a substring ban would fail the prose that
 * documents the fix.
 *
 * `sil_doctor`'s `wiring.tools_not_admitted` finding is what hands this path to an
 * operator; `lib/host-wiring.test.ts` owns that surface.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the module.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWLIST_SCRIPT_RELATIVE,
  resolveAllowlistScript,
} from "../../lib/allowlist-script.js";

/** …/src/__tests__/lib → three levels up is the repo (plugin) root. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sil-allowlist-script-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveAllowlistScript — the plugin root is derived from import.meta.url", () => {
  it("resolves to the plugin root's scripts/allowlist-openclaw.mjs, absolutely", () => {
    const resolved = resolveAllowlistScript();
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(join(REPO_ROOT, ALLOWLIST_SCRIPT_RELATIVE));
  });

  it("points at a file that really exists in this tree (the path is not a fiction)", () => {
    // Anti-vacuity for the whole file: every assertion here is about a path, so one of
    // them must confirm the path is real. If this fails, the fix sil_doctor prints is
    // unrunnable.
    expect(existsSync(resolveAllowlistScript())).toBe(true);
  });

  it("resolves IDENTICALLY from a foreign cwd (never process.cwd())", async () => {
    // vitest runs a forks pool, so chdir is available; `resetModules` forces a root
    // computed at module scope to be recomputed under the foreign cwd.
    const elsewhere = tempDir();
    const original = process.cwd();
    try {
      process.chdir(elsewhere);
      vi.resetModules();
      const fresh = await import("../../lib/allowlist-script.js");
      expect(fresh.resolveAllowlistScript()).toBe(join(REPO_ROOT, ALLOWLIST_SCRIPT_RELATIVE));
      expect(fresh.resolveAllowlistScript()).not.toContain(elsewhere);
    } finally {
      process.chdir(original);
    }
  });

  it("proves the chdir seam actually bites — a cwd-derived path WOULD differ there", () => {
    // Guard-of-the-guard: were the foreign cwd the repo root, the bar above would pass
    // against a cwd implementation.
    const elsewhere = tempDir();
    const original = process.cwd();
    try {
      process.chdir(elsewhere);
      expect(join(process.cwd(), ALLOWLIST_SCRIPT_RELATIVE)).not.toBe(
        join(REPO_ROOT, ALLOWLIST_SCRIPT_RELATIVE),
      );
    } finally {
      process.chdir(original);
    }
  });

  it("is the constant joined to the root — not a second literal", () => {
    // One constant, one root: the path the doctor prints cannot drift from the file
    // `package.json#bin` and `#files` ship.
    expect(ALLOWLIST_SCRIPT_RELATIVE).toBe("scripts/allowlist-openclaw.mjs");
    expect(resolveAllowlistScript().endsWith(ALLOWLIST_SCRIPT_RELATIVE)).toBe(true);
  });

  it("makes NO network call — naming a local path is a local act", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    resolveAllowlistScript();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
