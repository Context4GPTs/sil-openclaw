/**
 * The store-format migration runner — sil-agnostic `detect → backup → apply →
 * verify → record`, fail-closed.
 *
 * A store carries an INTEGER store-format version (decoupled from `package.json`
 * semver) in a marker at the DATA-DIR ROOT. The runner advances it one hop at a time
 * through the registry; each hop is independently transactional:
 *
 *   for m of MIGRATIONS where m.version > recorded (ascending):
 *     detectApplicable? no  → record the version, transform nothing
 *                       yes → backup shopper/ → apply → verify → (record + drop backup)
 *                             on any throw / verify-miss → revert from backup, DO NOT record
 *
 * Fail-closed guarantees: verify-BEFORE-record (apply completing is not success — the
 * preservation floor being met is); a failure reverts to the byte-exact prior subtree
 * and leaves the marker untouched; a revert that ITSELF fails is the louder
 * `reverted:false` outcome (store left dirty) and retains the backup for recovery.
 *
 * `ensureStoreMigrated()` is the on-load gate: the store primitives call it on their
 * first line so a behind-version store HEALS BEFORE IT SERVES. It is NEVER wired into
 * `register()` (the strictly-synchronous / opens-nothing invariant,
 * [[sil-data-dir-lifecycle]]). Memoized per resolved data-dir, so it runs at most once
 * per process (production has one data-dir) and is a cheap cached no-op thereafter.
 *
 * Only `SHOPPER_SUBDIR`, the marker filename, and the backup dir are sil constants;
 * everything else is generic, so a future cross-plugin extraction is mechanical.
 */

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import { DIR_MODE, getDataDir } from "../credentials.js";
import { MIGRATIONS } from "./registry.js";
import type { Migration, MigrationFailed, MigrationRunResult } from "./types.js";

/** The store-format version marker — JSON `{ version: <int> }`, at the data-dir ROOT
 * (sibling to tokens.json, NOT under shopper/), so a shopper-subtree backup/revert can
 * never touch it and a future migration may touch tokens/config under the same version. */
const MARKER_FILE = "store-format.json";
/** Owner-only, like every credential/artefact in the data home. */
const MARKER_MODE = 0o600;

/** The subtree a migration transforms + the runner backs up / reverts. */
const SHOPPER_SUBDIR = "shopper";
/** Per-hop backups live here (data-dir root, outside the reverted subtree). RETAINED on
 * failure for sil_doctor / a human to recover; dropped on hop success. */
const BACKUP_SUBDIR = ".sil-migration-backup";

// ---------------------------------------------------------------------------
// Store-format version marker.
// ---------------------------------------------------------------------------

/** Read the recorded store-format version, or 0 when the marker is absent, unparseable,
 * or carries no integer `version`. Treating a corrupt marker as 0 is SAFE — the runner
 * disambiguates via each hop's content-probe `detectApplicable`, so a corrupt marker on
 * an already-migrated store re-stamps rather than re-transforming; fail-closing here
 * would brick the store instead of self-healing it. */
export function readStoreVersion(dataDir: string): number {
  const path = join(dataDir, MARKER_FILE);
  if (!existsSync(path)) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return 0;
  }
  const version = (parsed as { version?: unknown } | null)?.version;
  return typeof version === "number" && Number.isInteger(version) && version >= 0 ? version : 0;
}

/** Record the store-format version atomically (0600) at the data-dir root. */
export function writeStoreVersion(dataDir: string, version: number): void {
  const path = join(dataDir, MARKER_FILE);
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, JSON.stringify({ version }) + "\n", { mode: MARKER_MODE });
  renameSync(tmp, path);
  chmodSync(path, MARKER_MODE);
}

// ---------------------------------------------------------------------------
// Backup / restore of the shopper subtree.
// ---------------------------------------------------------------------------

function shopperDir(dataDir: string): string {
  return join(dataDir, SHOPPER_SUBDIR);
}

function backupRoot(dataDir: string): string {
  return join(dataDir, BACKUP_SUBDIR);
}

function backupPath(dataDir: string, version: number): string {
  return join(backupRoot(dataDir), "v" + version);
}

/** Snapshot the whole shopper subtree before a hop's transform. Recursive copy of a
 * small markdown tree; cheap. Clears any stale backup at this version first. */
function createBackup(dataDir: string, version: number): void {
  const dest = backupPath(dataDir, version);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(backupRoot(dataDir), { recursive: true, mode: DIR_MODE });
  const src = shopperDir(dataDir);
  if (existsSync(src)) cpSync(src, dest, { recursive: true });
  else mkdirSync(dest, { recursive: true, mode: DIR_MODE });
}

/** Revert the whole shopper subtree to the hop's backup. The rm→copy window is the one
 * non-atomic seam; a throw here surfaces as the louder `reverted:false` outcome. */
function restore(dataDir: string, version: number): void {
  const dest = shopperDir(dataDir);
  rmSync(dest, { recursive: true, force: true });
  cpSync(backupPath(dataDir, version), dest, { recursive: true });
}

/** Drop the transient backup on a hop's success (retained ONLY on failure). At most one
 * backup is live during a chain — a failed hop returns immediately — so wiping the whole
 * backup dir is safe and leaves the data-dir clean. */
function removeBackup(dataDir: string): void {
  rmSync(backupRoot(dataDir), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

function failed(version: number, reason: string, reverted: boolean): MigrationFailed {
  return { ok: false, kind: "migration_failed", version, reason, reverted, recovery: "inspect_store" };
}

function errCause(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run every applicable migration above the recorded version, in ascending order, in one
 * pass. Pure (no memo) — the on-load gate memoizes; the self-upgrade card calls this
 * directly. `migrations` is injectable so tests can drive a synthetic ordered registry.
 */
export function runStoreMigrations(
  dataDir: string,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationRunResult {
  const from = readStoreVersion(dataDir);
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const applied: number[] = [];
  let to = from;

  for (const m of ordered) {
    if (m.version <= from) continue; // at/below the recorded version — never probed

    let isApplicable: boolean;
    try {
      isApplicable = m.detectApplicable(dataDir);
    } catch (err) {
      // A probe throw is before any mutation/backup — the store is untouched.
      return failed(m.version, errCause(err), true);
    }

    if (!isApplicable) {
      // No-op for this store's shape → record the version, transform nothing, no backup.
      writeStoreVersion(dataDir, m.version);
      to = m.version;
      continue;
    }

    createBackup(dataDir, m.version);
    try {
      m.apply(dataDir);
      const reason = m.verify(dataDir);
      if (reason !== null) throw new Error(reason); // verify-BEFORE-record gate
    } catch (err) {
      const reason = errCause(err);
      let reverted: boolean;
      try {
        restore(dataDir, m.version);
        reverted = true;
      } catch {
        reverted = false; // revert itself failed → store left DIRTY (louder rail)
      }
      // Backup RETAINED on either failure outcome; the marker is NOT advanced.
      return failed(m.version, reason, reverted);
    }

    writeStoreVersion(dataDir, m.version); // record only after verify passes
    removeBackup(dataDir);
    applied.push(m.version);
    to = m.version;
  }

  return { ok: true, from, to, applied };
}

// ---------------------------------------------------------------------------
// On-load gate — memoized per resolved data-dir.
// ---------------------------------------------------------------------------

const migrationMemo = new Map<string, MigrationRunResult>();

/**
 * The on-load gate the store primitives call on their first line (heal-before-serve).
 * Memoized on the resolved data-dir: runs `runStoreMigrations` at most once per process
 * (production has a single data-dir), a cached no-op thereafter. NEVER call this from
 * `register()` — the sync/opens-nothing invariant lives there.
 */
export function ensureStoreMigrated(): MigrationRunResult {
  const dataDir = getDataDir();
  const cached = migrationMemo.get(dataDir);
  if (cached !== undefined) return cached;
  const result = runStoreMigrations(dataDir);
  migrationMemo.set(dataDir, result);
  return result;
}
