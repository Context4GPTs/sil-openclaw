/**
 * UNIT — ensureDataDir(), the SOLE data-dir creator (tier: unit, real
 * temp dir, no fs mocking).
 *
 * The card "Create the sil data directory at registration" promotes the
 * data home from lazily-created-on-first-write to guaranteed-at-load. The
 * architect's handoff (§2) sites the creator as a single exported helper
 * beside `getDataDir()`:
 *
 *   export function ensureDataDir(): string  — creates getDataDir() with
 *   mode 0o700 if absent, idempotent (recursive mkdir is a no-op when it
 *   already exists), returns the resolved path. It is the SOLE creator —
 *   register() calls it at load; the write paths call it before write
 *   (which doubles as the mid-session-delete guard).
 *
 * These tests pin that helper's contract at the unit tier, against a
 * hermetic per-test $SIL_DATA_DIR (a real temp dir — NO mocked fs, NO
 * AUTH_DEV_BYPASS; the repo's established credentials.test.ts pattern).
 * They are the canonical home for:
 *   - AC2  the dir is created with mode 0o700 (owner-only);
 *   - AC3  creation honors the SAME $SIL_DATA_DIR → $XDG_DATA_HOME/sil →
 *          ~/.local/share/sil precedence getDataDir() resolves, at the
 *          resolved path and NOWHERE else, and that path is the one every
 *          later read/write resolves;
 *   - AC4  a pre-existing dir (with contents) is a clean idempotent no-op —
 *          nothing overwritten, nothing re-permissioned;
 *   - AC7  the write path re-ensures the home after a mid-session delete.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   src/lib/credentials.ts exports `ensureDataDir(): string` — see above.
 *   getDataDir() stays a PURE resolver (no side effects); creation is
 *   ensureDataDir()'s job only.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getDataDir,
  ensureDataDir,
  writeTokens,
  readTokens,
} from "../../lib/credentials.js";

let parentDir: string;
let priorSilDataDir: string | undefined;
let priorXdg: string | undefined;

beforeEach(() => {
  // A fresh EMPTY parent per test. The data dir under test is a
  // not-yet-existing CHILD of it, so "ensureDataDir creates it" is a real
  // creation, never a pre-existing no-op (except where a test seeds it).
  parentDir = mkdtempSync(join(tmpdir(), "sil-ensuredir-test-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  priorXdg = process.env["XDG_DATA_HOME"];
  process.env["SIL_DATA_DIR"] = join(parentDir, "data");
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  if (priorXdg === undefined) delete process.env["XDG_DATA_HOME"];
  else process.env["XDG_DATA_HOME"] = priorXdg;
  rmSync(parentDir, { recursive: true, force: true });
});

/** The low 9 permission bits (owner/group/other rwx) of a path. */
function modeBits(path: string): number {
  // eslint-disable-next-line no-bitwise
  return statSync(path).mode & 0o777;
}

describe("ensureDataDir — creates the resolved dir (AC2: 0o700)", () => {
  it("creates a 0o700 directory at the resolved path when absent", () => {
    const target = getDataDir();
    expect(existsSync(target)).toBe(false); // precondition: not yet there

    const returned = ensureDataDir();

    expect(existsSync(target)).toBe(true);
    expect(statSync(target).isDirectory()).toBe(true);
    // 0o700 = owner rwx, group/other none — byte-identical to the mode the
    // token/profile write paths already apply (DIR_MODE). A group/world
    // accessible data home leaks the credential store's container perms.
    expect(modeBits(target)).toBe(0o700);
    // Returns the path it ensured, for the caller (register()) to log.
    expect(returned).toBe(target);
  });

  it("creates intermediate parents recursively (clean machine, deep path)", () => {
    const deep = join(parentDir, "a", "b", "c", "sil");
    process.env["SIL_DATA_DIR"] = deep;
    expect(existsSync(deep)).toBe(false);
    ensureDataDir();
    expect(statSync(deep).isDirectory()).toBe(true);
    expect(modeBits(deep)).toBe(0o700);
  });
});

describe("ensureDataDir — path-resolution precedence at creation (AC3)", () => {
  it("creates at $SIL_DATA_DIR and nowhere else (highest precedence)", () => {
    const target = join(parentDir, "via-sil-data-dir");
    process.env["SIL_DATA_DIR"] = target;
    // XDG is ALSO set — to prove SIL_DATA_DIR wins and XDG is not touched.
    const xdg = mkdtempSync(join(tmpdir(), "sil-xdg-prec-"));
    process.env["XDG_DATA_HOME"] = xdg;
    try {
      const created = ensureDataDir();
      expect(created).toBe(target);
      expect(existsSync(target)).toBe(true);
      // The XDG path must NOT have been created — precedence honored.
      expect(existsSync(join(xdg, "sil"))).toBe(false);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it("creates at $XDG_DATA_HOME/sil when SIL_DATA_DIR is unset", () => {
    delete process.env["SIL_DATA_DIR"];
    const xdg = mkdtempSync(join(tmpdir(), "sil-xdg-create-"));
    process.env["XDG_DATA_HOME"] = xdg;
    try {
      const created = ensureDataDir();
      expect(created).toBe(join(xdg, "sil"));
      expect(statSync(join(xdg, "sil")).isDirectory()).toBe(true);
      expect(modeBits(join(xdg, "sil"))).toBe(0o700);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it("targets ~/.local/share/sil when neither env is set (suffix-pinned)", () => {
    delete process.env["SIL_DATA_DIR"];
    delete process.env["XDG_DATA_HOME"];
    // Do NOT actually create under the real home; only assert the resolver
    // the creator would use points at the XDG-default suffix. getDataDir()
    // is the creator's target, so pinning it pins where creation lands.
    expect(getDataDir().endsWith(join(".local", "share", "sil"))).toBe(true);
  });

  it("the dir ensured at creation is the SAME path getDataDir() resolves later", async () => {
    const target = join(parentDir, "consistent-home");
    process.env["SIL_DATA_DIR"] = target;
    const ensured = ensureDataDir();
    // Identity: no half-initialized second home — the dir created at load
    // is exactly the path every subsequent read/write resolves.
    expect(ensured).toBe(getDataDir());
    await writeTokens({ access_token: "at", refresh_token: "rt" });
    expect(existsSync(join(target, "tokens.json"))).toBe(true);
    expect(readTokens()!.access_token).toBe("at");
  });
});

describe("ensureDataDir — pre-existing dir is a clean no-op (AC4: idempotent)", () => {
  it("does not throw, truncate, or re-permission existing contents", () => {
    const target = getDataDir();
    // Pre-create the dir and seed a 0600 file with known bytes — an
    // already-registered user re-loading the plugin.
    mkdirSync(target, { recursive: true, mode: 0o700 });
    const seeded = join(target, "tokens.json");
    writeFileSync(seeded, '{"access_token":"keep-me"}', { mode: 0o600 });

    expect(() => ensureDataDir()).not.toThrow();

    // Contents intact (not truncated/overwritten) and perms undisturbed.
    expect(readFileSync(seeded, "utf8")).toBe('{"access_token":"keep-me"}');
    expect(modeBits(seeded)).toBe(0o600);
    expect(modeBits(target)).toBe(0o700);
  });

  it("a second ensureDataDir() in a row is a no-op (truly idempotent)", () => {
    const first = ensureDataDir();
    const second = ensureDataDir();
    expect(second).toBe(first);
    expect(statSync(first).isDirectory()).toBe(true);
    expect(modeBits(first)).toBe(0o700);
  });
});

describe("ensureDataDir — write path re-ensures after a mid-session delete (AC7)", () => {
  it("the next writeTokens recreates the deleted home (same path, 0700)", async () => {
    const target = getDataDir();
    ensureDataDir();
    expect(existsSync(target)).toBe(true);

    // Deleted out from under a running session AFTER registration.
    rmSync(target, { recursive: true, force: true });
    expect(existsSync(target)).toBe(false);

    // The write path must re-ensure the home BEFORE writing — not wedge.
    await writeTokens({ access_token: "recovered", refresh_token: "rt" });

    expect(existsSync(target)).toBe(true);
    expect(modeBits(target)).toBe(0o700);
    expect(readTokens()!.access_token).toBe("recovered");
  });

  it("a bare ensureDataDir() call also self-heals a mid-session delete", () => {
    const target = getDataDir();
    ensureDataDir();
    rmSync(target, { recursive: true, force: true });
    expect(existsSync(target)).toBe(false);
    // The point-of-need guard: calling the helper again re-creates it.
    ensureDataDir();
    expect(existsSync(target)).toBe(true);
    expect(modeBits(target)).toBe(0o700);
  });
});
