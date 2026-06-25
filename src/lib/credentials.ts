/**
 * Persistent credential + identity storage for the sil plugin — the SOLE owner
 * of on-disk auth state.
 *
 * After a successful claim the plugin writes two files under the resolved data
 * directory:
 *   - `tokens.json`  → { access_token, refresh_token }  (the bearer pair)
 *   - `config.json`  → { user: { id, name? } }          (identity, for whoami)
 *
 * The PKCE verifier is NEVER written here — it is the claim bearer secret and
 * lives only in memory (see `pkce.ts`). Only the post-claim tokens + identity
 * touch disk.
 *
 * Resolution order for the data dir (no host `dataDir` accessor exists in the
 * declared SDK, so we compute it deterministically; the env override is what
 * makes the credential tests hermetic — each points at its own temp dir):
 *   1. `$SIL_DATA_DIR`              (test/override — highest precedence)
 *   2. `$XDG_DATA_HOME/sil`         (XDG Base Directory spec)
 *   3. `~/.local/share/sil`         (XDG default)
 *
 * Writes are atomic (temp file in the same dir + rename) so a crash mid-write
 * never leaves a half-written token file, and the files are `0600` (owner-only)
 * so the bearer pair is never group/world-readable. Reads tolerate a missing
 * dir/file by returning null (the already-registered short-circuit treats
 * "no tokens" as "not registered").
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/** Owner read/write only. The bearer pair must never be group/world-readable. */
const FILE_MODE = 0o600;
/** Owner read/write/execute only on the data dir itself. */
const DIR_MODE = 0o700;

const TOKENS_FILE = "tokens.json";
const CONFIG_FILE = "config.json";

/** The bearer pair persisted on a successful claim / refresh. */
export interface StoredTokens {
  access_token: string;
  refresh_token: string;
}

/** The identity persisted alongside the tokens, for `sil_whoami` (next card). */
export interface StoredConfig {
  user: StoredUser;
}

export interface StoredUser {
  id: string;
  name?: string;
}

/**
 * Resolve the plugin's data directory at call time (never cached — tests flip
 * `$SIL_DATA_DIR` between cases, and a deployment could relocate `$XDG_DATA_HOME`
 * between calls). See the module header for the precedence order.
 */
export function getDataDir(): string {
  const override = process.env["SIL_DATA_DIR"];
  if (override !== undefined && override !== "") return override;

  const xdg = process.env["XDG_DATA_HOME"];
  if (xdg !== undefined && xdg !== "") return join(xdg, "sil");

  return join(homedir(), ".local", "share", "sil");
}

export function getTokensPath(): string {
  return join(getDataDir(), TOKENS_FILE);
}

export function getConfigPath(): string {
  return join(getDataDir(), CONFIG_FILE);
}

/**
 * True iff a `tokens.json` exists on disk. This is the already-registered
 * short-circuit's gate — it is PRESENCE-based, not freshness-based: an expired
 * session token still counts as "registered" for this card (refresh is SC7, the
 * sil_whoami card). Note carried forward in the card body.
 */
export function hasTokens(): boolean {
  return existsSync(getTokensPath());
}

/**
 * Persist the bearer pair atomically with owner-only perms.
 *
 * Async signature (returns a Promise) but SYNCHRONOUS fs internals (temp+rename
 * via the *Sync calls). The async wrapper is the public contract (callers await
 * it); the sync internals guarantee the file is fully on disk by the time the
 * returned promise resolves — important under the fake-timer poll loop, where a
 * threadpool-backed `fs/promises` write would NOT settle within the test's
 * microtask flush and the persisted file would race the assertion.
 */
export async function writeTokens(tokens: StoredTokens): Promise<void> {
  writeJsonAtomic(getTokensPath(), tokens);
}

/** Persist the identity atomically with owner-only perms. See `writeTokens`
 * for why this is an async wrapper over synchronous fs internals. */
export async function writeConfig(config: StoredConfig): Promise<void> {
  writeJsonAtomic(getConfigPath(), config);
}

/** Read the bearer pair, or null if absent/unreadable/malformed. */
export function readTokens(): StoredTokens | null {
  return readJson<StoredTokens>(getTokensPath());
}

/** Read the identity, or null if absent/unreadable/malformed. */
export function readConfig(): StoredConfig | null {
  return readJson<StoredConfig>(getConfigPath());
}

/**
 * Delete `tokens.json` if present (tolerant of absence — a no-op when the file
 * is already gone). Called on a CONFIRMED terminal auth failure (a refresh that
 * came back invalid_grant) so a known-dead bearer pair never lingers on disk:
 * the product invariant is "a dead session never masquerades as live". Because
 * the sil_register short-circuit is PRESENCE-based, leaving a dead tokens.json
 * would wrongly short-circuit the user's re-registration recovery; clearing it
 * lets the next sil_register mint a fresh session. Only ever called for a
 * confirmed-dead pair — never on a transient/retryable blip (the token may be
 * fine). The config.json identity is left untouched (it is not a credential and
 * is overwritten on the next successful claim).
 */
export function clearTokens(): void {
  const path = getTokensPath();
  if (!existsSync(path)) return;
  unlinkSync(path);
}

/**
 * Write `data` as pretty JSON to `path` atomically: serialize to a uniquely
 * named temp file in the SAME directory (rename is only atomic within a
 * filesystem), fsync-free `writeFileSync`, then `renameSync` over the target.
 * The temp file is created `0600` and the final file is re-`chmod`'d to `0600`
 * in case the rename inherited a different mode on some filesystems.
 *
 * Creating the dir first (recursive, `0700`) makes first-run on a clean machine
 * a non-error. The temp name carries random bytes so two concurrent writers (a
 * pathological double-register sharing a data dir) don't collide on the temp.
 */
function writeJsonAtomic(path: string, data: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });

  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: FILE_MODE,
  });
  renameSync(tmp, path);
  // Belt-and-braces: some filesystems drop the temp's mode on rename.
  chmodSync(path, FILE_MODE);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    // A corrupt/half-written file reads as "absent" — the caller falls back to
    // the not-registered path rather than crashing on a SyntaxError.
    return null;
  }
}
