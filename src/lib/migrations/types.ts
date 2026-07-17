/**
 * Versioned store-format migration contract — sil-agnostic.
 *
 * A `Migration` advances the on-disk store from `version - 1` to `version`. The
 * runner (`runner.ts`) drives an ascending, contiguous registry of them through
 * `detect → backup → apply → verify → record`, fail-closed: a hop that throws or
 * fails verify is reverted from a byte-exact backup and NEVER half-recorded.
 *
 * This is a forward DATA migration (convert old on-disk state to the new format,
 * delete the legacy bytes), NOT code back-compat — no v1/v2 reader kept alive.
 */

export interface Migration {
  /** Store-format version this hop ADVANCES TO (version-1 → version). Ascending, from 1. */
  readonly version: number;
  /** One-line, for logs + a future sil_doctor readout. */
  readonly description: string;
  /**
   * Content-probe of this store's PRE-state. Consulted only when `version > recorded`.
   * FALSE ⇒ the transform is a no-op for this store's shape → record the version, touch
   * nothing (an already-migrated or fresh/empty store). TRUE ⇒ run the transform. This
   * is what disambiguates the absent-marker cases without re-transforming.
   */
  detectApplicable(dataDir: string): boolean;
  /** Apply the transform with atomic file writes; THROW on any hard failure. */
  apply(dataDir: string): void;
  /** Post-condition check: a reason string when the floor is unmet, or null when it holds. */
  verify(dataDir: string): string | null;
}

export type MigrationRunResult =
  | { ok: true; from: number; to: number; applied: number[] }
  | MigrationFailed;

export interface MigrationFailed {
  ok: false;
  kind: "migration_failed";
  /** The hop that failed. */
  version: number;
  /** Non-PII cause (a thrown-error message or the verify reason). */
  reason: string;
  /** true = the store was restored byte-exact to its prior state; false = the revert
   * itself failed and the store is left DIRTY (the louder honesty rail). */
  reverted: boolean;
  recovery: "inspect_store";
}
