/**
 * UNIT — `sortFindings()`, the shared deterministic finding order (tier: unit,
 * pure, no fs, no network, <100ms).
 *
 * Card: sil-doctor-tool-data-store-identity-health, **AC7b**. `src/lib/findings.ts`
 * is the shared vocabulary (`Finding`/`Severity`/`Status` + `sortFindings`) this card
 * creates and the sibling `self-upgrade-detect-host-wiring-advisory` imports — its
 * `wiring.*` advisory folds into EVERY `sil_*` result, so it cannot import a tool
 * group without a cycle. Two tool surfaces will depend on this order, which is why
 * it is pinned hard and in its own file rather than incidentally through the doctor.
 *
 * The order IS the product contract (PO invariant #4): a dashboard renders stably
 * and a run-to-run diff is meaningful ONLY if the order is total, stable, and
 * idempotent. An order that is merely "usually right" (e.g. a comparator that
 * returns a boolean, or one that ranks severity lexicographically — `critical` <
 * `info` < `warn` — which LOOKS plausible and is silently wrong) makes every
 * consumer's diff noisy.
 *
 * Contract pinned for the implementation (expert-developer) — src/lib/findings.ts:
 *
 *   export type Severity = "info" | "warn" | "critical";
 *   export type Status   = "ok" | "fixed" | "fix_failed" | "needs_confirmation"
 *                        | "advisory";
 *   export interface Finding {
 *     id: string; severity: Severity; status: Status; detected: string;
 *     suggestedAction: string | null; appliedAction: string | null;
 *   }
 *   export function sortFindings(f: Finding[]): Finding[];
 *     — orders by (severity DESC: critical > warn > info, then `id` ASC),
 *       is STABLE for equal (severity, id) keys, is IDEMPOTENT, and is PURE
 *       (does not mutate its input — a shared lib that reorders a caller's array
 *       in place is a footgun for the second consumer).
 */

import { describe, it, expect } from "vitest";

import {
  sortFindings,
  type Finding,
  type Severity,
} from "../../lib/findings.js";

/** A minimal well-formed finding. Only `id`/`severity` drive the order; the
 * other fields ride along and are asserted to survive intact. */
function finding(
  id: string,
  severity: Severity,
  detected = "d:" + id,
): Finding {
  return {
    id,
    severity,
    status: "ok",
    detected,
    suggestedAction: null,
    appliedAction: null,
  };
}

/** The (severity, id) key of each finding, in order — the whole observable
 * contract of the sort, compared as one literal so a partial regression cannot
 * hide behind a per-element check. */
function keys(findings: Finding[]): string[] {
  return findings.map((f) => f.severity + "|" + f.id);
}

describe("sortFindings — severity DESC (critical > warn > info)", () => {
  it("ranks the three severities critical → warn → info from a scrambled input", () => {
    const sorted = sortFindings([
      finding("a.one", "info"),
      finding("a.two", "critical"),
      finding("a.three", "warn"),
    ]);
    expect(sorted.map((f) => f.severity)).toEqual(["critical", "warn", "info"]);
  });

  it("ranks by SEVERITY, not by the severity string's lexicographic order", () => {
    // The trap: "critical" < "info" < "warn" lexicographically, so a naive
    // `a.severity.localeCompare(b.severity)` puts info ABOVE warn and looks
    // right for critical. Ids here are equal-ranked so severity alone decides.
    const sorted = sortFindings([
      finding("x", "info"),
      finding("x", "warn"),
    ]);
    expect(sorted.map((f) => f.severity)).toEqual(["warn", "info"]);
  });

  it("is a TOTAL order over severity — every pair ranks, in both input orders", () => {
    const ladder: Severity[] = ["critical", "warn", "info"];
    for (let hi = 0; hi < ladder.length; hi++) {
      for (let lo = hi + 1; lo < ladder.length; lo++) {
        const high = ladder[hi] as Severity;
        const low = ladder[lo] as Severity;
        // Same id, so ONLY severity can decide — and it must decide the same
        // way regardless of which one the caller happened to append first.
        for (const input of [
          [finding("same.id", high), finding("same.id", low)],
          [finding("same.id", low), finding("same.id", high)],
        ]) {
          expect(sortFindings(input).map((f) => f.severity)).toEqual([high, low]);
        }
      }
    }
  });
});

describe("sortFindings — `id` ASC within one severity", () => {
  it("orders equal-severity findings by id ascending", () => {
    const sorted = sortFindings([
      finding("fs.mode:z", "warn"),
      finding("fs.mode:a", "warn"),
      finding("fs.mode:m", "warn"),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(["fs.mode:a", "fs.mode:m", "fs.mode:z"]);
  });

  it("severity outranks id — a critical with a LATE id still leads an info with an EARLY id", () => {
    // Guards the composite comparator's precedence: an implementation that
    // sorted by id first (then severity) passes both single-key tests above
    // and fails only here.
    const sorted = sortFindings([
      finding("aaa.first", "info"),
      finding("zzz.last", "critical"),
    ]);
    expect(keys(sorted)).toEqual(["critical|zzz.last", "info|aaa.first"]);
  });

  it("orders a realistic mixed report exactly (severity desc, then id asc)", () => {
    const sorted = sortFindings([
      finding("version.plugin_behind", "info"),
      finding("store.unreadable:coffee", "warn"),
      finding("identity.tokens_present", "info"),
      finding("fs.data_dir_writable", "critical"),
      finding("fs.mode:tokens.json", "warn"),
      finding("fs.stale_tmp:shopper/user_spec.md.ab12.tmp", "warn"),
    ]);
    expect(keys(sorted)).toEqual([
      "critical|fs.data_dir_writable",
      "warn|fs.mode:tokens.json",
      "warn|fs.stale_tmp:shopper/user_spec.md.ab12.tmp",
      "warn|store.unreadable:coffee",
      "info|identity.tokens_present",
      "info|version.plugin_behind",
    ]);
  });
});

describe("sortFindings — stable for equal (severity, id) keys", () => {
  it("preserves input order among findings with the SAME severity and id", () => {
    // Equal keys must not be reordered: a consumer diffing two runs would see
    // phantom churn. Distinguished by `detected`, which the sort must not read.
    const input = [
      finding("dup.id", "warn", "first"),
      finding("dup.id", "warn", "second"),
      finding("dup.id", "warn", "third"),
    ];
    expect(sortFindings(input).map((f) => f.detected)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("preserves relative order of equal keys while still ranking unequal ones", () => {
    const input = [
      finding("b.id", "warn", "b-first"),
      finding("a.id", "critical", "the-critical"),
      finding("b.id", "warn", "b-second"),
    ];
    expect(sortFindings(input).map((f) => f.detected)).toEqual([
      "the-critical",
      "b-first",
      "b-second",
    ]);
  });
});

describe("sortFindings — idempotent, total, and pure", () => {
  const scrambled = (): Finding[] => [
    finding("version.plugin_behind", "info"),
    finding("fs.mode:shopper", "warn"),
    finding("fs.data_dir_writable", "critical"),
    finding("identity.token_expiry", "warn"),
  ];

  it("sorting an already-sorted array is a no-op", () => {
    const once = sortFindings(scrambled());
    const twice = sortFindings(once);
    expect(keys(twice)).toEqual(keys(once));
    // Deep-equal too: a second pass must not swap equal-ranked neighbours.
    expect(twice).toEqual(once);
  });

  it("is deterministic — the same input always yields the same order", () => {
    expect(keys(sortFindings(scrambled()))).toEqual(keys(sortFindings(scrambled())));
  });

  it("does NOT mutate its input array (pure — the second consumer shares this lib)", () => {
    const input = scrambled();
    const before = keys(input);
    sortFindings(input);
    expect(keys(input)).toEqual(before);
  });

  it("returns every finding it was given, unmodified — nothing dropped, added, or rewritten", () => {
    const input = scrambled();
    const sorted = sortFindings(input);
    expect(sorted).toHaveLength(input.length);
    // Set-equality on the whole objects: the sort reorders, it never edits.
    for (const f of input) expect(sorted).toContainEqual(f);
  });

  it("handles the degenerate inputs — empty and single-element", () => {
    expect(sortFindings([])).toEqual([]);
    const one = [finding("only.one", "warn")];
    expect(sortFindings(one)).toEqual(one);
  });
});
