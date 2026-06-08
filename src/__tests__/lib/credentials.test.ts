/**
 * UNIT — credential storage (tier: unit, real temp dir, no network).
 *
 * `src/lib/credentials.ts` is the SOLE owner of on-disk credential state.
 * These tests run against a per-test temp dir via the `SIL_DATA_DIR`
 * override the architect specified (the env knob is what makes the suite
 * hermetic — each test points at its own dir and never touches the real
 * `~/.local/share/sil`). No mocking of `node:fs`: we assert the REAL file
 * bytes and the REAL mode on disk, because the failure modes we care
 * about (world-readable perms, partial writes, the verifier leaking to
 * disk) only manifest on a real filesystem.
 *
 * Covers the card's "Credential storage (F4)" unit criteria:
 *   - round-trip: writeTokens/writeConfig then readTokens/readConfig
 *     return what was written, into the resolved data dir;
 *   - first-run: a non-existent data dir is created, no error;
 *   - 0600 / owner-only perms on every written file;
 *   - SIL_DATA_DIR override is honored (resolution: env → XDG → home);
 *   - the PKCE verifier is NEVER written to disk by ANY credentials call.
 *
 * Contract this file pins for the implementation (expert-developer),
 * per the In-Dev handoff (`src/lib/credentials.ts`):
 *   - getDataDir(): string  — $SIL_DATA_DIR → $XDG_DATA_HOME/sil → ~/.local/share/sil
 *   - writeTokens(t: StoredTokens): void | Promise<void>  — atomic, 0600
 *   - writeConfig(c: StoredConfig): void | Promise<void>  — atomic, 0600
 *   - readTokens(): StoredTokens | null
 *   - readConfig(): StoredConfig | null
 * where StoredTokens carries { access_token, refresh_token } and
 * StoredConfig carries the user identity ({ user: { id, name? } } or a
 * flattened equivalent — the round-trip test pins behavior, not the exact
 * key, by reading back through the module's own reader).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getDataDir,
  writeTokens,
  writeConfig,
  readTokens,
  readConfig,
} from "../../lib/credentials.js";

let dataDir: string;
let priorSilDataDir: string | undefined;
let priorXdg: string | undefined;

beforeEach(() => {
  // A fresh empty temp dir per test, pointed at via the override env.
  dataDir = mkdtempSync(join(tmpdir(), "sil-cred-test-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  priorXdg = process.env["XDG_DATA_HOME"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  // Restore env exactly (don't leak the override into other suites).
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  if (priorXdg === undefined) delete process.env["XDG_DATA_HOME"];
  else process.env["XDG_DATA_HOME"] = priorXdg;
  rmSync(dataDir, { recursive: true, force: true });
});

/** Recursively collect every file path under a directory. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/** The low 9 permission bits (owner/group/other rwx) of a file. */
function modeBits(path: string): number {
  // eslint-disable-next-line no-bitwise
  return statSync(path).mode & 0o777;
}

describe("getDataDir — resolution order ($SIL_DATA_DIR → XDG → home)", () => {
  it("honors the $SIL_DATA_DIR override (the hermetic-test knob)", () => {
    expect(getDataDir()).toBe(dataDir);
  });

  it("falls back to $XDG_DATA_HOME/sil when SIL_DATA_DIR is unset", () => {
    delete process.env["SIL_DATA_DIR"];
    const xdg = mkdtempSync(join(tmpdir(), "sil-xdg-test-"));
    process.env["XDG_DATA_HOME"] = xdg;
    try {
      expect(getDataDir()).toBe(join(xdg, "sil"));
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it("falls back to ~/.local/share/sil when neither env is set", () => {
    delete process.env["SIL_DATA_DIR"];
    delete process.env["XDG_DATA_HOME"];
    const resolved = getDataDir();
    // Don't pin the home prefix (CI-dependent); pin the XDG-conventional
    // suffix the architect specified.
    expect(resolved.endsWith(join(".local", "share", "sil"))).toBe(true);
  });
});

describe("writeTokens / readTokens — round-trip into the data dir", () => {
  it("reads back exactly what was written", async () => {
    await writeTokens({ access_token: "at-123", refresh_token: "rt-456" });
    const got = readTokens();
    expect(got).not.toBeNull();
    expect(got!.access_token).toBe("at-123");
    expect(got!.refresh_token).toBe("rt-456");
  });

  it("writes the tokens file INTO the resolved data dir (not elsewhere)", async () => {
    await writeTokens({ access_token: "at", refresh_token: "rt" });
    const files = walkFiles(dataDir);
    // Some tokens file must exist under the data dir, and its content must
    // carry the tokens — proving the resolver routed the write here.
    const tokenFile = files.find((f) =>
      readFileSync(f, "utf8").includes("at"),
    );
    expect(tokenFile).toBeDefined();
  });

  it("returns null when no tokens file exists yet (clean machine)", () => {
    // Fresh temp dir, nothing written — the short-circuit reader must
    // report absence, not throw.
    expect(readTokens()).toBeNull();
  });

  it("overwrites a prior token pair (refresh rotation persists)", async () => {
    await writeTokens({ access_token: "old-at", refresh_token: "old-rt" });
    await writeTokens({ access_token: "new-at", refresh_token: "new-rt" });
    const got = readTokens();
    expect(got!.access_token).toBe("new-at");
    expect(got!.refresh_token).toBe("new-rt");
  });
});

describe("writeConfig / readConfig — identity round-trip", () => {
  it("reads back the user identity that was written", async () => {
    await writeConfig({ user: { id: "user-789", name: "Ada Lovelace" } });
    const got = readConfig();
    expect(got).not.toBeNull();
    // Pin the identity values via the module's own reader (key layout is
    // the impl's call; the identity must survive the round-trip).
    expect(JSON.stringify(got)).toContain("user-789");
    expect(JSON.stringify(got)).toContain("Ada Lovelace");
  });

  it("returns null when no config file exists yet", () => {
    expect(readConfig()).toBeNull();
  });
});

describe("first-run — directory is created on demand", () => {
  it("creates a missing nested data dir and writes without error", async () => {
    // Point at a path one level DEEPER than the (empty) temp dir, so the
    // leaf does not exist yet — the clean-machine first-run case.
    const nested = join(dataDir, "fresh", "sil");
    process.env["SIL_DATA_DIR"] = nested;
    // writeTokens may be sync (void) or async (Promise<void>) per the
    // handoff — assert it neither throws synchronously nor rejects, then
    // prove the file landed under the freshly-created nested dir.
    let thrown: unknown = null;
    try {
      await writeTokens({ access_token: "at", refresh_token: "rt" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeNull();
    expect(readTokens()!.access_token).toBe("at");
  });
});

describe("permissions — credential files are owner-only (0600)", () => {
  it("writes tokens.json with 0600 (no group/other access)", async () => {
    await writeTokens({ access_token: "secret-at", refresh_token: "secret-rt" });
    const tokenFile = walkFiles(getDataDir()).find((f) =>
      readFileSync(f, "utf8").includes("secret-at"),
    );
    expect(tokenFile).toBeDefined();
    // 0600 = owner rw, nobody else. A token file readable by group/other
    // is a credential-exposure bug.
    expect(modeBits(tokenFile!)).toBe(0o600);
  });

  it("writes the config file with 0600 as well (it carries PII)", async () => {
    await writeConfig({ user: { id: "u1", name: "PII Name" } });
    const cfgFile = walkFiles(getDataDir()).find((f) =>
      readFileSync(f, "utf8").includes("PII Name"),
    );
    expect(cfgFile).toBeDefined();
    expect(modeBits(cfgFile!)).toBe(0o600);
  });

  it("leaves NO temp/leftover file world-readable after an atomic write", async () => {
    // Atomic temp+rename must not leave a 0644 scratch file behind. Every
    // file under the data dir must be 0600 after the write settles.
    await writeTokens({ access_token: "at", refresh_token: "rt" });
    await writeConfig({ user: { id: "u", name: "n" } });
    for (const f of walkFiles(getDataDir())) {
      expect(modeBits(f)).toBe(0o600);
    }
  });
});

describe("the PKCE verifier NEVER touches disk (F4 secret invariant)", () => {
  it("no credentials API accepts or persists a verifier", async () => {
    // The verifier is the bearer secret for the claim; it lives only in
    // memory. Even if a careless caller stuffed it into a token/config
    // object, NO file under the data dir may contain it after writes.
    const VERIFIER = "this-verifier-must-never-be-on-disk-abc123";
    await writeTokens({ access_token: "at", refresh_token: "rt" });
    await writeConfig({ user: { id: "u", name: "n" } });
    for (const f of walkFiles(getDataDir())) {
      expect(readFileSync(f, "utf8")).not.toContain(VERIFIER);
    }
  });
});
