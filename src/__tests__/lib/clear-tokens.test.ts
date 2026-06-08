/**
 * UNIT — clearTokens() credential clear (tier: unit, real temp dir, no network).
 *
 * The mechanism behind the product invariant "a dead session never
 * masquerades as live" (architect resolution: clear tokens.json on a
 * confirmed invalid_grant). After a refresh is rejected, the now-known-dead
 * token pair must be removed so the user's `sil_register` recovery is NOT
 * blocked by stale presence — recall `sil_register`'s short-circuit is
 * PRESENCE-based (`hasTokens()`), so a lingering dead pair would make the
 * next register short-circuit on a session that no longer works.
 *
 * Three properties pinned here:
 *   1. Clears the tokens file — after clearTokens(), hasTokens() is false and
 *      readTokens() is null.
 *   2. Tolerant of absence — clearing when there is no tokens.json is a no-op
 *      that does NOT throw (covers the TOCTOU where the file vanished, and a
 *      clear on a never-registered dir).
 *   3. Scoped — clearTokens() removes ONLY tokens.json; config.json (identity)
 *      is untouched (the clear is about the credential, not the cached id).
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (the repo's standard knob).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/credentials.ts`:
 *   - clearTokens(): void | Promise<void>   atomically removes tokens.json;
 *     tolerant of a missing file (no throw); does not touch config.json.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearTokens,
  hasTokens,
  readTokens,
  readConfig,
  getDataDir,
  getTokensPath,
  getConfigPath,
} from "../../lib/credentials.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

function seedTokens(): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: "dead-at", refresh_token: "dead-rt" }),
    { mode: 0o600 },
  );
}

function seedConfig(): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getConfigPath(),
    JSON.stringify({ user: { id: "user-1", name: "Ada Lovelace" } }),
    { mode: 0o600 },
  );
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-clear-tokens-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("clearTokens — removes the stored token pair", () => {
  it("after clearTokens(), the tokens file is gone (hasTokens false, readTokens null)", async () => {
    seedTokens();
    expect(hasTokens()).toBe(true);

    await clearTokens();

    expect(hasTokens()).toBe(false);
    expect(readTokens()).toBeNull();
    expect(existsSync(getTokensPath())).toBe(false);
  });
});

describe("clearTokens — tolerant of absence (no throw)", () => {
  it("clearing when no tokens.json exists is a no-op that does not throw", async () => {
    // never seeded — the dir may not even contain the file
    expect(hasTokens()).toBe(false);
    await expect(Promise.resolve(clearTokens())).resolves.not.toThrow();
    expect(hasTokens()).toBe(false);
  });

  it("clearing twice in a row does not throw on the second call", async () => {
    seedTokens();
    await clearTokens();
    await expect(Promise.resolve(clearTokens())).resolves.not.toThrow();
    expect(hasTokens()).toBe(false);
  });
});

describe("clearTokens — scoped to tokens.json only", () => {
  it("does NOT remove config.json (the cached identity survives the credential clear)", async () => {
    seedTokens();
    seedConfig();

    await clearTokens();

    expect(hasTokens()).toBe(false);
    // config.json (identity) is a separate concern — untouched by clearTokens.
    expect(existsSync(getConfigPath())).toBe(true);
    expect(readConfig()).not.toBeNull();
  });
});
