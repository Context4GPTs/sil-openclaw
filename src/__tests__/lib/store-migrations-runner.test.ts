/**
 * UNIT — the versioned store-migration runner + registry (tier: unit, real temp
 * $SIL_DATA_DIR, no fs mocking, no network, no host).
 *
 * Card: versioned-store-migrations-on-load-self-migrate. THESE ASSERTIONS ARE THE
 * SPEC (RED-first). The runner is sil-agnostic: `detect → backup → apply → verify →
 * record`, fail-closed, driven by a registry of ascending `Migration` hops keyed by
 * an INTEGER store-format version (decoupled from package.json semver).
 *
 * This file pins the GENERIC runner over a SYNTHETIC ordered registry of fake
 * migrations — the only way to exercise multi-hop ordering (AC3), verify-before-
 * record (AC5), and the generic revert (AC4 companion) when just ONE real migration
 * exists today. Migration #1's real transform + the on-load trigger are the
 * integration file's job (store-migrations.integration.test.ts).
 *
 * Contract this file pins for the implementation (expert-developer):
 *
 *   src/lib/migrations/types.ts
 *     interface Migration {
 *       readonly version: number;                 // ascending, contiguous from 1
 *       readonly description: string;
 *       detectApplicable(dataDir: string): boolean;   // content-probe of the PRE-state
 *       apply(dataDir: string): void;                  // atomic writes; throw on hard failure
 *       verify(dataDir: string): string | null;        // reason string, or null when the floor holds
 *     }
 *     type MigrationRunResult =
 *       | { ok: true; from: number; to: number; applied: number[] }
 *       | MigrationFailed;
 *     interface MigrationFailed {
 *       ok: false; kind: "migration_failed"; version: number;
 *       reason: string; reverted: boolean; recovery: "inspect_store";
 *     }
 *
 *   src/lib/migrations/registry.ts
 *     export const MIGRATIONS: readonly Migration[];              // ascending, from 1
 *     export const CURRENT_STORE_VERSION: number;                // MIGRATIONS.at(-1)?.version ?? 0
 *
 *   src/lib/migrations/runner.ts
 *     export function readStoreVersion(dataDir: string): number;  // marker, or 0 (absent/unparseable)
 *     export function writeStoreVersion(dataDir: string, version: number): void;  // atomic 0600, data-dir ROOT
 *     export function runStoreMigrations(
 *       dataDir: string,
 *       migrations?: readonly Migration[],   // defaults to MIGRATIONS; INJECTABLE so this
 *     ): MigrationRunResult;                 //   file can drive a synthetic ordered registry.
 *     export function ensureStoreMigrated(): MigrationRunResult;  // memoized on-load gate (integration file)
 *
 * The store-format marker is `$SIL_DATA_DIR/store-format.json` = `{ "version": <int> }`
 * at the DATA-DIR ROOT (sibling to tokens.json — NOT under shopper/, so a shopper-
 * subtree backup/revert never touches it). The per-hop backup is
 * `$SIL_DATA_DIR/.sil-migration-backup/` (also at root, outside the reverted subtree).
 *
 * Hermetic via a fresh mkdtemp $SIL_DATA_DIR per test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  statSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readStoreVersion,
  writeStoreVersion,
  runStoreMigrations,
} from "../../lib/migrations/runner.js";
import { MIGRATIONS, CURRENT_STORE_VERSION } from "../../lib/migrations/registry.js";
import type { Migration, MigrationRunResult } from "../../lib/migrations/types.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

const MARKER = "store-format.json";
const BACKUP_DIR = ".sil-migration-backup";
const SHOPPER = "shopper";

// Root bypasses the permission bits the fault-injection levers below rely on, so those
// cases skip under root (idiom per create-shopper.integration.test.ts).
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-store-mig-runner-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  // Defensive: restore any perms a fault-injection lever dropped on the data-dir root or the
  // backup subtree, so the temp-dir teardown never EACCESes if a test threw before its finally.
  for (const p of [dataDir, join(dataDir, BACKUP_DIR)]) {
    try {
      chmodSync(p, 0o700);
    } catch {
      /* may not exist */
    }
  }
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures: a shopper subtree with a known sentinel + a fake-migration builder.
// ---------------------------------------------------------------------------

/** Seed `$SIL_DATA_DIR/shopper/sentinel.txt` with known bytes — the subtree the
 * runner backs up + reverts. Returns the sentinel path. */
function seedShopper(contents = "ORIGINAL-BYTES\n"): string {
  const dir = join(dataDir, SHOPPER);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = join(dir, "sentinel.txt");
  writeFileSync(p, contents, { mode: 0o600 });
  return p;
}

interface FakeSpec {
  detect?: (dataDir: string) => boolean;
  apply?: (dataDir: string) => void;
  verify?: (dataDir: string) => string | null;
}

/** A fake Migration with call-count spies on every hook. */
function fakeMigration(version: number, spec: FakeSpec = {}) {
  const calls = { detect: 0, apply: 0, verify: 0 };
  const migration: Migration = {
    version,
    description: `fake migration v${version}`,
    detectApplicable(dir: string) {
      calls.detect++;
      return spec.detect ? spec.detect(dir) : true;
    },
    apply(dir: string) {
      calls.apply++;
      if (spec.apply) spec.apply(dir);
    },
    verify(dir: string) {
      calls.verify++;
      return spec.verify ? spec.verify(dir) : null;
    },
  };
  return { migration, calls };
}

/** Recursively list every relative path under the shopper subtree (sorted). */
function walkShopper(): string[] {
  const dir = join(dataDir, SHOPPER);
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[]).sort();
}

// ===========================================================================
// registry.ts — the ascending, contiguous-from-1 registry + CURRENT constant.
// ===========================================================================
describe("registry — ascending contiguous versions from 1; CURRENT is the last hop", () => {
  it("MIGRATIONS is non-empty and each hop has the Migration shape", () => {
    expect(Array.isArray(MIGRATIONS)).toBe(true);
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(1);
    for (const m of MIGRATIONS) {
      expect(typeof m.version).toBe("number");
      expect(typeof m.description).toBe("string");
      expect(m.description.length).toBeGreaterThan(0);
      expect(typeof m.detectApplicable).toBe("function");
      expect(typeof m.apply).toBe("function");
      expect(typeof m.verify).toBe("function");
    }
  });

  it("versions are ascending and contiguous starting at 1 (no gaps, no dupes)", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
  });

  it("CURRENT_STORE_VERSION equals the last hop's version (= MIGRATIONS.length)", () => {
    expect(CURRENT_STORE_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version);
    expect(CURRENT_STORE_VERSION).toBe(MIGRATIONS.length);
  });

  it("Migration #1 (the 0.3.x → 0.4.0 frontmatter-store move) is version 1", () => {
    expect(MIGRATIONS[0]!.version).toBe(1);
  });
});

// ===========================================================================
// readStoreVersion / writeStoreVersion — the integer marker at the data-dir root.
// ===========================================================================
describe("store-format marker — integer version at the data-dir root, absent/corrupt ⇒ 0", () => {
  it("an ABSENT marker reads as version 0 (safe default, not a throw)", () => {
    expect(existsSync(join(dataDir, MARKER))).toBe(false);
    expect(readStoreVersion(dataDir)).toBe(0);
  });

  it("writeStoreVersion round-trips through readStoreVersion", () => {
    writeStoreVersion(dataDir, 3);
    expect(readStoreVersion(dataDir)).toBe(3);
  });

  it("the marker is store-format.json at the DATA-DIR ROOT (sibling of tokens.json, NOT under shopper/)", () => {
    writeStoreVersion(dataDir, 2);
    // At the root — so a shopper-subtree backup/revert can never touch it.
    expect(existsSync(join(dataDir, MARKER))).toBe(true);
    expect(existsSync(join(dataDir, SHOPPER, MARKER))).toBe(false);
    const parsed = JSON.parse(readFileSync(join(dataDir, MARKER), "utf8")) as { version: number };
    expect(parsed.version).toBe(2);
  });

  it("the marker is written owner-only (0600)", () => {
    writeStoreVersion(dataDir, 1);
    // eslint-disable-next-line no-bitwise
    expect(statSync(join(dataDir, MARKER)).mode & 0o777).toBe(0o600);
  });

  it("an UNPARSEABLE marker reads as version 0 (content-probe self-heal, never a brick)", () => {
    writeFileSync(join(dataDir, MARKER), "not json { at all", { mode: 0o600 });
    expect(readStoreVersion(dataDir)).toBe(0);
  });

  it("a marker that parses but carries no integer `version` reads as 0", () => {
    writeFileSync(join(dataDir, MARKER), JSON.stringify({ version: "seven" }), { mode: 0o600 });
    expect(readStoreVersion(dataDir)).toBe(0);
    writeFileSync(join(dataDir, MARKER), JSON.stringify({ nope: 1 }), { mode: 0o600 });
    expect(readStoreVersion(dataDir)).toBe(0);
  });
});

// ===========================================================================
// AC3 — multi-hop skipped-release: every applicable hop applies in ASCENDING
// order in ONE pass; the recorded version advances to the registry's last.
// ===========================================================================
describe("runStoreMigrations — AC3 multi-hop ordered application over a synthetic registry", () => {
  it("a store at 0 with a 3-hop registry applies 1 → 2 → 3 IN ORDER, records 3, applied=[1,2,3]", () => {
    seedShopper();
    const orderLog = join(dataDir, SHOPPER, "order.log");
    const appendVersion = (v: number) => (dir: string) => {
      const prev = existsSync(join(dir, SHOPPER, "order.log"))
        ? readFileSync(join(dir, SHOPPER, "order.log"), "utf8")
        : "";
      writeFileSync(join(dir, SHOPPER, "order.log"), prev + v + "\n", { mode: 0o600 });
    };
    const m1 = fakeMigration(1, { apply: appendVersion(1) });
    const m2 = fakeMigration(2, { apply: appendVersion(2) });
    const m3 = fakeMigration(3, { apply: appendVersion(3) });

    const result = runStoreMigrations(dataDir, [m1.migration, m2.migration, m3.migration]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.from).toBe(0);
    // `to` is the version the store actually advanced to — NOT the global
    // CURRENT_STORE_VERSION (that is the REAL registry's max, wrong here).
    expect(result.to).toBe(3);
    expect(result.to).toBe(readStoreVersion(dataDir));
    expect(result.applied).toEqual([1, 2, 3]);
    // Every hop's transform ran exactly once, in ascending order.
    expect(readFileSync(orderLog, "utf8")).toBe("1\n2\n3\n");
    for (const m of [m1, m2, m3]) expect(m.calls.apply).toBe(1);
  });

  it("a store already at version 1 applies ONLY the later hops (2, 3) — version-1's transform never re-runs", () => {
    seedShopper();
    writeStoreVersion(dataDir, 1);
    const m1 = fakeMigration(1);
    const m2 = fakeMigration(2);
    const m3 = fakeMigration(3);

    const result = runStoreMigrations(dataDir, [m1.migration, m2.migration, m3.migration]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.from).toBe(1);
    expect(result.to).toBe(3);
    expect(result.applied).toEqual([2, 3]);
    // Hop 1 is below `from` → not even probed.
    expect(m1.calls.detect).toBe(0);
    expect(m1.calls.apply).toBe(0);
    expect(m2.calls.apply).toBe(1);
    expect(m3.calls.apply).toBe(1);
  });
});

// ===========================================================================
// AC7 (unit) — idempotent no-op: an already-current store rewrites NOTHING.
// ===========================================================================
describe("runStoreMigrations — AC7 idempotent no-op on an already-current store", () => {
  it("a store at the registry's top version does nothing — no probe, no apply, no marker rewrite, no backup", () => {
    const sentinel = seedShopper();
    writeStoreVersion(dataDir, 3);
    const markerMtime = statSync(join(dataDir, MARKER)).mtimeMs;
    const sentinelMtime = statSync(sentinel).mtimeMs;
    const m1 = fakeMigration(1);
    const m2 = fakeMigration(2);
    const m3 = fakeMigration(3);

    const result = runStoreMigrations(dataDir, [m1.migration, m2.migration, m3.migration]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.from).toBe(3);
    expect(result.to).toBe(3);
    expect(result.applied).toEqual([]);
    // No hook ran at all — nothing is above `from`.
    for (const m of [m1, m2, m3]) {
      expect(m.calls.detect).toBe(0);
      expect(m.calls.apply).toBe(0);
      expect(m.calls.verify).toBe(0);
    }
    // Zero churn: neither the marker nor the shopper subtree was rewritten.
    expect(statSync(join(dataDir, MARKER)).mtimeMs).toBe(markerMtime);
    expect(statSync(sentinel).mtimeMs).toBe(sentinelMtime);
    expect(existsSync(join(dataDir, BACKUP_DIR))).toBe(false);
  });

  it("a hop whose detectApplicable is FALSE records the version but runs NO transform + creates NO backup", () => {
    seedShopper();
    const m1 = fakeMigration(1, { detect: () => false });

    const result = runStoreMigrations(dataDir, [m1.migration]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // The version is recorded (so it is never re-probed) but the transform is a no-op.
    expect(readStoreVersion(dataDir)).toBe(1);
    expect(m1.calls.detect).toBe(1);
    expect(m1.calls.apply).toBe(0);
    // A no-op hop is not "applied" and takes no backup.
    expect(result.applied).toEqual([]);
    expect(existsSync(join(dataDir, BACKUP_DIR))).toBe(false);
  });
});

// ===========================================================================
// AC5 — verify-before-record: apply COMPLETING is not success; the floor being
// met is. A failed verify is treated as FAILURE — reverted, NOT recorded.
// ===========================================================================
describe("runStoreMigrations — AC5 verify-before-record (anti false-healthy)", () => {
  it("apply returns cleanly but verify returns a reason ⇒ FAILED: reverted, marker NOT advanced, migration_failed surfaced", () => {
    const sentinel = seedShopper("ORIGINAL\n");
    // apply mutates the subtree (looks migrated) but verify rejects it.
    const m1 = fakeMigration(1, {
      apply: (dir) => writeFileSync(join(dir, SHOPPER, "sentinel.txt"), "MUTATED\n", { mode: 0o600 }),
      verify: () => "preservation floor unmet: user_spec name is blank",
    });

    const result = runStoreMigrations(dataDir, [m1.migration]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("migration_failed");
    expect(result.version).toBe(1);
    expect(result.reverted).toBe(true);
    expect(result.recovery).toBe("inspect_store");
    // verify DID run (apply completed first) — that is the whole point of the gate.
    expect(m1.calls.apply).toBe(1);
    expect(m1.calls.verify).toBe(1);
    // "looks migrated but lost the floor" is NEVER recorded as success.
    expect(readStoreVersion(dataDir)).toBe(0);
    // Byte-exact revert: the mutation is gone.
    expect(readFileSync(sentinel, "utf8")).toBe("ORIGINAL\n");
    // The failure reason is carried (non-empty, names the floor miss).
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC4 (generic companion) — fail-closed revert: a hop that throws mid-apply is
// reverted to the BYTE-EXACT pre-migration subtree; the version is NOT advanced;
// the backup is RETAINED for inspection.
// ===========================================================================
describe("runStoreMigrations — AC4 generic revert to byte-exact prior state", () => {
  it("a hop that THROWS mid-apply reverts the whole subtree byte-exactly + retains the backup + does not advance the marker", () => {
    const sentinel = seedShopper("PRISTINE\n");
    const before = walkShopper();
    const m1 = fakeMigration(1, {
      apply: (dir) => {
        // Partial mutation, THEN a hard failure — the classic half-applied hazard.
        writeFileSync(join(dir, SHOPPER, "half-written.txt"), "garbage\n", { mode: 0o600 });
        throw new Error("disk exploded mid-apply");
      },
    });

    const result = runStoreMigrations(dataDir, [m1.migration]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("migration_failed");
    expect(result.version).toBe(1);
    expect(result.reverted).toBe(true);
    expect(result.reason).toMatch(/disk exploded/);
    // Byte-exact restore: the original file is intact and the half-written file is GONE.
    expect(readFileSync(sentinel, "utf8")).toBe("PRISTINE\n");
    expect(walkShopper()).toEqual(before);
    expect(existsSync(join(dataDir, SHOPPER, "half-written.txt"))).toBe(false);
    // The version is NOT advanced — a reverted hop leaves the marker at its prior value.
    expect(readStoreVersion(dataDir)).toBe(0);
    // The backup is RETAINED on failure so sil_doctor / a human can recover.
    expect(existsSync(join(dataDir, BACKUP_DIR))).toBe(true);
  });

  it("an early hop that SUCCEEDS stays applied when a LATER hop fails (per-hop transactional, not per-chain rollback)", () => {
    seedShopper();
    const m1 = fakeMigration(1, {
      apply: (dir) => writeFileSync(join(dir, SHOPPER, "hop1.txt"), "kept\n", { mode: 0o600 }),
    });
    const m2 = fakeMigration(2, {
      apply: () => {
        throw new Error("hop 2 blew up");
      },
    });

    const result = runStoreMigrations(dataDir, [m1.migration, m2.migration]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.version).toBe(2);
    // Hop 1 committed: its file survives and the marker sits at 1 (not rolled back to 0).
    expect(existsSync(join(dataDir, SHOPPER, "hop1.txt"))).toBe(true);
    expect(readStoreVersion(dataDir)).toBe(1);
  });
});

// ===========================================================================
// Success cleans up its backup — a green hop leaves no retained backup behind.
// ===========================================================================
describe("runStoreMigrations — a successful hop removes its own backup", () => {
  it("after a clean apply+verify, no .sil-migration-backup remains", () => {
    seedShopper();
    const m1 = fakeMigration(1, {
      apply: (dir) => writeFileSync(join(dir, SHOPPER, "done.txt"), "ok\n", { mode: 0o600 }),
    });

    const result = runStoreMigrations(dataDir, [m1.migration]);

    expect(result.ok).toBe(true);
    expect(readStoreVersion(dataDir)).toBe(1);
    // The transient backup is gone on success (retained ONLY on failure).
    expect(existsSync(join(dataDir, BACKUP_DIR))).toBe(false);
  });
});

// ===========================================================================
// Fail-closed I/O gap (review round 1, P2). The runner's contract is that NO path
// escapes as a raw throw — EVERY failure surfaces as a structured migration_failed
// (business rule 3). The apply/verify seam is already guarded; these pin the
// previously-unguarded sites: createBackup, BOTH writeStoreVersion calls (the no-op
// record and the post-verify record), and removeBackup. Real-fs fault injection
// (chmod / marker-as-directory), no synthetic hook, mirroring the AC6 lever.
//
// The `reverted` discriminator is load-bearing here and differs BY SITE, keyed on
// whether a transform was already COMMITTED when the I/O failed:
//   - before any transform (createBackup, the no-op-branch record) ⇒ store is provably
//     untouched ⇒ reverted:true (honest "prior state intact"), never a false-alarm dirty.
//   - after a verified transform (the post-verify record) ⇒ the migration is CORRECT,
//     only the marker could not be written ⇒ reverted:false, and the good transform is
//     KEPT (never thrown away — reverting would re-expose the legacy store to a
//     destructive re-migrate loop next boot).
//   - a POST-SUCCESS cleanup failure (removeBackup, after apply+verify+record all passed)
//     is NOT a data-integrity failure ⇒ the run still SUCCEEDS (a leftover backup is
//     harmless; reporting failure would falsely tell the agent the shopper is broken).
// ===========================================================================
describe("runStoreMigrations — fail-closed: every guarded I/O site maps to migration_failed, never a raw throw", () => {
  it.skipIf(AS_ROOT)(
    "createBackup cannot snapshot (read-only data-dir root) ⇒ migration_failed, store untouched (reverted:true), version NOT advanced",
    () => {
      const sentinel = seedShopper("UNTOUCHED\n");
      const before = walkShopper();
      // A hop that WOULD transform — but the backup snapshot can't be created because the
      // data-dir root is read-only, so createBackup (mkdir .sil-migration-backup) EACCESes
      // BEFORE apply ever runs. Unguarded, createBackup raw-throws out of the runner (RED);
      // the fail-closed contract requires a structured migration_failed instead.
      const m1 = fakeMigration(1, {
        apply: (dir) => writeFileSync(join(dir, SHOPPER, "should-never-exist.txt"), "x\n", { mode: 0o600 }),
      });
      chmodSync(dataDir, 0o500);

      let result: MigrationRunResult;
      try {
        result = runStoreMigrations(dataDir, [m1.migration]);
      } finally {
        chmodSync(dataDir, 0o700);
      }

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.kind).toBe("migration_failed");
      expect(result.version).toBe(1);
      // createBackup failed BEFORE apply — the store was never mutated ⇒ reverted:true.
      expect(result.reverted).toBe(true);
      expect(result.recovery).toBe("inspect_store");
      expect(result.reason.length).toBeGreaterThan(0);
      // apply never ran (createBackup gates it) and the version was not advanced.
      expect(m1.calls.apply).toBe(0);
      expect(readStoreVersion(dataDir)).toBe(0);
      // Byte-exact: the subtree is identical, no half-written file leaked in.
      expect(readFileSync(sentinel, "utf8")).toBe("UNTOUCHED\n");
      expect(walkShopper()).toEqual(before);
    },
  );

  it.skipIf(AS_ROOT)(
    "the no-op-branch writeStoreVersion fails (read-only root, detectApplicable false) ⇒ migration_failed, store untouched (reverted:true)",
    () => {
      seedShopper("PRISTINE\n");
      // detectApplicable:false ⇒ the runner records the version WITHOUT a transform. On a
      // read-only root that marker write EACCESes — unguarded it raw-throws (RED). Mapped:
      // migration_failed with the store untouched.
      const m1 = fakeMigration(1, { detect: () => false });
      chmodSync(dataDir, 0o500);

      let result: MigrationRunResult;
      try {
        result = runStoreMigrations(dataDir, [m1.migration]);
      } finally {
        chmodSync(dataDir, 0o700);
      }

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.kind).toBe("migration_failed");
      expect(result.version).toBe(1);
      // No transform of any kind ran (detect was false) — the store is untouched ⇒ reverted:true.
      expect(result.reverted).toBe(true);
      expect(m1.calls.apply).toBe(0);
      expect(readStoreVersion(dataDir)).toBe(0);
    },
  );

  it("the post-verify writeStoreVersion fails (marker path unwritable) ⇒ migration_failed, reverted:false, and the verified transform is KEPT", () => {
    const sentinel = seedShopper("ORIGINAL\n");
    // Make ONLY the record write fail while backup + apply + verify all succeed: pre-create
    // the marker PATH as a NON-EMPTY directory, so writeStoreVersion's rename-onto-path
    // EISDIRs. (This fault reproduces regardless of privilege — no skipIf needed.)
    const markerAsDir = join(dataDir, MARKER);
    mkdirSync(markerAsDir, { recursive: true });
    writeFileSync(join(markerAsDir, "occupied"), "x\n", { mode: 0o600 });
    const m1 = fakeMigration(1, {
      apply: (dir) => writeFileSync(join(dir, SHOPPER, "sentinel.txt"), "MIGRATED\n", { mode: 0o600 }),
      verify: () => null, // the transform met the floor; only recording it fails
    });

    const result = runStoreMigrations(dataDir, [m1.migration]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("migration_failed");
    expect(result.version).toBe(1);
    // A verified transform was already committed — the migration is CORRECT, only the marker
    // could not be recorded ⇒ reverted:false (NOT reverted:true, which would claim a
    // revert-to-prior that did not, and must not, happen).
    expect(result.reverted).toBe(false);
    // The verified transform SURVIVES — the runner did not throw away good, floor-meeting work.
    expect(readFileSync(sentinel, "utf8")).toBe("MIGRATED\n");
    expect(m1.calls.apply).toBe(1);
    expect(m1.calls.verify).toBe(1);
    // The marker never recorded (the unwritable dir parses as absent ⇒ still 0).
    expect(readStoreVersion(dataDir)).toBe(0);
  });

  it.skipIf(AS_ROOT)(
    "removeBackup fails AFTER a successful apply+verify+record ⇒ the run still SUCCEEDS (a post-success cleanup failure is not a data-integrity failure)",
    () => {
      seedShopper("PRISTINE\n");
      // apply mutates the subtree AND drops write on the backup dir the runner created, so the
      // post-success removeBackup (rmSync of .sil-migration-backup) EACCESes. The migration
      // ITSELF fully succeeded — apply ran, verify passed, the marker recorded — only the
      // transient-backup cleanup failed. Contract (pinned with the dev): a cleanup failure
      // NEVER turns a succeeded migration into migration_failed; the shopper IS migrated and
      // intact, so reporting failure here would falsely tell the agent the shopper is broken.
      const m1 = fakeMigration(1, {
        apply: (dir) => {
          writeFileSync(join(dir, SHOPPER, "migrated.txt"), "done\n", { mode: 0o600 });
          chmodSync(join(dir, BACKUP_DIR), 0o500); // block removeBackup's rmSync of the backup children
        },
        verify: () => null,
      });

      let result: MigrationRunResult;
      try {
        result = runStoreMigrations(dataDir, [m1.migration]);
      } finally {
        chmodSync(join(dataDir, BACKUP_DIR), 0o700); // restore so afterEach teardown succeeds
      }

      // The migration SUCCEEDED despite the cleanup failure.
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.from).toBe(0);
      expect(result.to).toBe(1);
      expect(result.applied).toEqual([1]);
      // The version WAS recorded and the transform is present — the shopper is intact.
      expect(readStoreVersion(dataDir)).toBe(1);
      expect(existsSync(join(dataDir, SHOPPER, "migrated.txt"))).toBe(true);
      // The backup could not be cleaned up — a harmless leftover, tolerated (not fatal).
      expect(existsSync(join(dataDir, BACKUP_DIR))).toBe(true);
    },
  );
});
