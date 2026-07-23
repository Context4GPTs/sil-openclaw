/**
 * UNIT — the surviving half of `src/lib/creation-entrypoint.ts`: the ALLOWLIST
 * script's path oracle.
 *
 * REBUILT, NOT PATCHED. This file used to pin five creation-side exports —
 * `CREATION_ENTRYPOINT_RELATIVE`, `resolveCreationEntrypoint`,
 * `probeCreationEntrypoint`, `buildCreationEntrypointFinding` and the
 * `CreationEntrypointVerdict` union. They existed for one reason: creation
 * shipped as an operator BIN, so an agent had to be handed a path it could not
 * derive (`openclaw plugins install` links no bins, and the host publishes
 * plugin skills as symlinks whose `..` node erases lexically before the
 * filesystem sees it). This card relocates creation into `sil_create_shopper`,
 * a registered tool, so the path and its whole probe/finding apparatus are
 * DELETED. Testing them would be testing code that no longer exists
 * (`delete-first`).
 *
 * `resolveAllowlistScript` survives, and matters more than before: it is now the
 * only consumer of the module, and `sil_doctor`'s
 * `wiring.tools_not_admitted.suggestedAction` is the only thing standing between
 * a tools-filtered user and a dead session. Its one hard requirement is
 * unchanged, and is the reason the module exists at all: the root comes from
 * `import.meta.url`, never `process.cwd()`.
 *
 * Contract pinned for the implementation (src/lib/creation-entrypoint.ts):
 *
 *   export const ALLOWLIST_SCRIPT_RELATIVE = "scripts/allowlist-openclaw.mjs";
 *   export function resolveAllowlistScript(): string;   // absolute
 *
 * Card: clear-the-clawhub-suspicious-flag-review-findings (slice M deletions).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWLIST_SCRIPT_RELATIVE,
  resolveAllowlistScript,
} from "../../lib/creation-entrypoint.js";

/** …/src/__tests__/lib → three levels up is the repo (plugin) root. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MODULE_SRC = join(REPO_ROOT, "src", "lib", "creation-entrypoint.ts");

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sil-entrypoint-"));
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
    // Anti-vacuity for the whole file: every assertion here is about a path, so
    // one of them must confirm the path is real. If this fails, the command
    // `sil_doctor` tells a filtered user to run is unrunnable.
    expect(existsSync(resolveAllowlistScript())).toBe(true);
  });

  it("resolves IDENTICALLY from a foreign cwd (never process.cwd())", async () => {
    // THE production-fidelity test. Under vitest, cwd IS the repo root, so a
    // `resolve("scripts/allowlist-openclaw.mjs")` implementation passes every
    // other test in this file and then fails in production, where cwd is the
    // agent's workspace. Here the process is REALLY chdir'd (vitest runs a forks
    // pool, so chdir is available) and the module is re-imported, so a root
    // computed at module scope is recomputed under the foreign cwd.
    //
    // Pinning the exact expected path — rather than forbidding `process.cwd` —
    // makes this total: a cwd root, a PATH lookup, a homedir root and a
    // hardcoded /usr/lib path all fail it.
    const elsewhere = tempDir();
    const original = process.cwd();
    try {
      process.chdir(elsewhere);
      vi.resetModules();
      const fresh = await import("../../lib/creation-entrypoint.js");
      expect(fresh.resolveAllowlistScript()).toBe(join(REPO_ROOT, ALLOWLIST_SCRIPT_RELATIVE));
      expect(fresh.resolveAllowlistScript()).not.toContain(elsewhere);
    } finally {
      process.chdir(original);
    }
  });

  it("proves the chdir seam actually bites — a cwd-derived path WOULD differ there", () => {
    // Guard-of-the-guard: if the foreign cwd happened to be the repo root, the
    // test above would be vacuous — it would pass against a cwd implementation.
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

  it("makes NO network call — naming a local path is a local act", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    resolveAllowlistScript();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the ONE literal — the constant every surface is asserted against", () => {
  it("is the real shipped path, not an empty or placeholder string", () => {
    expect(ALLOWLIST_SCRIPT_RELATIVE).toBe("scripts/allowlist-openclaw.mjs");
    expect(ALLOWLIST_SCRIPT_RELATIVE).toMatch(/^scripts\/[a-z][a-z0-9-]*\.mjs$/);
  });

  it("agrees with package.json#bin — the bin map and the resolver cannot drift", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      bin?: Record<string, string>;
    };
    expect(pkg.bin?.["sil-openclaw-allowlist"]?.replace(/^\.\//, "")).toBe(
      ALLOWLIST_SCRIPT_RELATIVE,
    );
  });

  it("the resolver is built from the constant, not a second copy of the string", () => {
    expect(resolveAllowlistScript().endsWith(ALLOWLIST_SCRIPT_RELATIVE)).toBe(true);
  });
});

describe("the creation half is DELETED — no shim, no v1/v2 side by side", () => {
  it("exports nothing creation-shaped any more", async () => {
    const mod = (await import("../../lib/creation-entrypoint.js")) as Record<string, unknown>;
    for (const dead of [
      "CREATION_ENTRYPOINT_RELATIVE",
      "resolveCreationEntrypoint",
      "probeCreationEntrypoint",
      "buildCreationEntrypointFinding",
    ]) {
      expect(dead in mod, `${dead} survived the relocation`).toBe(false);
    }
    // Positive half: the module is not simply empty.
    expect(typeof mod["resolveAllowlistScript"]).toBe("function");
  });

  it("names a path and never runs one — the module spawns nothing", () => {
    // The reason `security.noChildProcess` can be true at all: this module's job
    // is to say WHERE a script is, never to execute it.
    const src = readFileSync(MODULE_SRC, "utf8");
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/(?<![.\w$])(execFileSync|execSync|spawnSync|spawn|fork)\s*\(/);
  });
});
