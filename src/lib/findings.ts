/**
 * The shared health-finding vocabulary — one addressable observation about one
 * artefact or subsystem.
 *
 * This lives in `lib/`, not with `sil_doctor`, because a second consumer cannot
 * reach a tool group without a cycle: the self-upgrade card folds a `wiring.*`
 * advisory into EVERY `sil_*` result, and `tools/* → tools/doctor.ts` is an
 * import cycle. `lib → tools` is the only acyclic direction.
 *
 * The six fields are flat and domain-agnostic on purpose: one shape serves the
 * sil-shopping skill, the self-upgrade advisory, and a future dashboard. A
 * version advisory and a host-wiring advisory are ordinary findings whose
 * specifics ride the strings — there is no structured `advisory` sub-object.
 *
 * NOTHING here may ever carry a secret or PII: `detected` / `suggestedAction` /
 * `appliedAction` name paths and conditions, never contents.
 */

/** Urgency if unaddressed. Orthogonal to `Status` ("what was done about it"). */
export type Severity = "info" | "warn" | "critical";

/** Lifecycle of the finding — what the doctor did, and what is left to do. */
export type Status =
  | "ok"
  | "fixed"
  | "fix_failed"
  | "needs_confirmation"
  | "advisory";

export interface Finding {
  /** Stable across runs, dotted; per-path checks append `:<relpath>`. */
  id: string;
  severity: Severity;
  status: Status;
  /** Human-readable, NON-SECRET observation. */
  detected: string;
  /** Next step, or null when nothing is left to do. */
  suggestedAction: string | null;
  /** What a safe fix actually ran, or null when nothing was applied. */
  appliedAction: string | null;
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  warn: 1,
  info: 2,
};

/**
 * Order by (severity desc, `id` asc) — total, stable, and idempotent, so a
 * dashboard renders stably and a run-to-run diff means something.
 *
 * Returns a new array; the input is never mutated.
 */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
