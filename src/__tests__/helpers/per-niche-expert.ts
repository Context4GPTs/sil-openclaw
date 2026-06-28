/**
 * The per-niche-expert vocabulary disavowal-token discipline, as a SINGLE source
 * of truth shared by the prose drift guard (`skill-content.test.ts`, integration)
 * and the tool-description vocabulary guard (`tool-schema-contract.unit.test.ts`,
 * unit). Both pin the same rule: the single-shopper pivot RETIRED "expert" as
 * user-facing vocabulary for the current model (the agent is a "shopper", a niche
 * a "domain"), but a corrected doc/description legitimately NAMES the retired
 * model to bury it (a *retro-reference*). So the guard forbids the bare agent-noun
 * "expert"/"experts" — EXCEPT when a legacy/retired/per-niche context sits
 * immediately before it.
 *
 * See docs/knowledge/skill-prose-drift-guard-disavowal-discipline.md (seam 1).
 * Keeping this in one module means the retro-allowance lookback can never drift
 * between the prose guard and the tool-description guard.
 */

/**
 * Whole-word "expert"/"experts" — the per-niche-expert agent noun the pivot
 * retires from user-facing vocabulary. Whole-word so legitimate "niche
 * expertise" / "expertly" (substring) never trips it (the false-token trap).
 */
export const PER_NICHE_EXPERT_WORD = /\bexperts?\b/i;

/**
 * Whole-word "expert" matches that are NOT legitimate retro-references to the
 * RETIRED per-niche-expert model. An `expert` occurrence is ALLOWED iff it sits
 * in a legacy/retired/per-niche context (a disavowal, e.g. "the retired
 * per-niche-expert model", "a legacy expert"); any other occurrence frames the
 * CURRENT model as a per-niche expert and is forbidden. Returns the offending
 * contexts (empty ⇒ clean). This is the disavowal-token discipline: a corrected
 * doc/description may NAME the retired model to bury it — never the bare token as
 * a blanket forbid.
 */
export function perNicheExpertOffenders(body: string): string[] {
  const offenders: string[] = [];
  const re = /\bexperts?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const before = body.slice(Math.max(0, m.index - 28), m.index).toLowerCase();
    const isRetro =
      before.includes("legacy") ||
      before.includes("retired") ||
      before.includes("per-niche") ||
      before.includes("no longer") ||
      before.includes("old ");
    if (!isRetro) {
      offenders.push(
        body
          .slice(Math.max(0, m.index - 24), m.index + m[0].length + 12)
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
  }
  return offenders;
}
