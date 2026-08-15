/**
 * The honesty-field vocabulary discipline, as a SINGLE source of truth shared by
 * the tool-description guard (unit — `tools/tool-schema-contract.unit.test.ts`)
 * and the skill-prose guard (integration —
 * `skill-bundle-contract.integration.test.ts`). Same split, same reason, as
 * `per-niche-expert.ts`: one module means the allowance can never drift between
 * the two surfaces that carry the same rule.
 *
 * WHAT IT PROTECTS. The v0 wire answers with honesty fields — `serviceability:
 * unknown`, `values[k].state: unset`, `predicates[].applied: false`, `maturity:
 * web`. Every one of them is an ORDINARY answer that KEEPS its subject. The
 * agent learns what to do with them almost entirely from the tool descriptions,
 * and prose is the only carrier of the rule — so prose is what has to be guarded.
 *
 * `unknown` is the one that silently breaks the product. `/catalog/stores` fails
 * closed: `not_serviceable` is a positive claim needing policy evidence sil read,
 * and at v0 NOTHING writes `corpus.purposes='policy'` — so `unknown` is the
 * MAJORITY answer and `not_serviceable` is structurally unreachable. A
 * description that reads as "drop the unknowns" undoes the route's fail-closed
 * design one layer up and collapses the shortlist to near-empty WHILE LOOKING
 * LIKE IT FILTERED. Nothing downstream can detect that.
 *
 * WHY IT IS NOT A BLANKET FORBID. The correct description must NAME the state in
 * order to keep it ("`unknown` … never a reason to drop a seller: keep it"). A
 * flat ban on "drop" near "unknown" would fail the exact sentence the product
 * needs. So the scan is SENTENCE-scoped and carries a keep/negation allowance —
 * the same shape as `perNicheExpertOffenders`' retro-allowance.
 *
 * Every regex below is proved to BITE (and to spare the approved wording) in
 * `lib/honesty-vocabulary.test.ts`. A scanner nobody has watched fail is a
 * scanner that passes for the wrong reason.
 */

/**
 * The honesty states, as they are actually written in agent-facing prose —
 * bare (`unknown`, `unset`), backticked, or as a field assertion
 * (`applied: false`, `maturity: "web"`).
 */
const HONESTY_TOKEN =
  /\b(unknown|unset)\b|applied\s*[`'":=]*\s*false|maturity\s*[`'":=]*\s*['"`]?web/i;

/**
 * Verbs that remove a subject from what the buyer sees. `deprioritise` is here
 * because a description that says "rank unknowns last" has quietly reintroduced
 * the exclusion as an ordering — the shortlist still collapses, just slower.
 */
const EXCLUSION =
  /\b(filters?|filtered|filtering|excludes?|excluded|excluding|exclusion|drops?|dropped|dropping|skips?|skipped|skipping|discards?|discarded|omits?|omitted|omitting|removes?|removed|hides?|hidden|hiding|ignores?|ignored|ignoring|deprioriti[sz]e[sd]?|deprioriti[sz]ing|suppress(?:es|ed)?|disregards?)\b/i;

/**
 * Phrases that mean exclusion with no honesty token beside them — "present only
 * serviceable sellers" names no state yet forbids two of the three. Absolutes
 * still get the keep/negation allowance, so prose may disavow them by name.
 */
const ABSOLUTE_EXCLUSION = [
  /\bonly\s+(?:the\s+|show\s+|present\s+|list\s+|return\s+|keep\s+)*serviceable\b/i,
  /\bserviceable\s+(?:sellers?\s+|results?\s+|ones?\s+)?only\b/i,
  /\bsoft(?:er)?\s+not_serviceable\b/i,
  /\bunknown\s+means\s+(?:it\s+)?(?:can(?:not|'t)\s+ship|no\b|not\s+available)/i,
  /\btreat\s+unknown\s+as\s+(?:not_serviceable|unavailable|no\b)/i,
];

/**
 * The negation allowance, read in a LOOKBACK WINDOW immediately before the
 * exclusion verb — never sentence-wide. A sentence-wide `\bnot\b` excuses
 * "Suppress the unset fields so the buyer is not confused", which is the defect
 * itself; the negation has to be attached to the verb it cancels.
 *
 * 44 characters covers the longest real form the product ruling uses ("and
 * never a reason to drop") without reaching the previous clause.
 *
 * `\bnot\b` does NOT match inside `not_serviceable` (`_` is a word character),
 * which is load-bearing: otherwise every sentence naming the negative state
 * would excuse itself.
 */
const NEGATION_LOOKBACK = 44;
const NEGATION = /\b(never|not|nor|n't|no reason|rather than|instead of)\b/i;

/**
 * A keep verb anywhere in the sentence also clears it — the instruction to keep
 * the subject is what the exclusion verb is being contrasted against.
 */
const KEEP_VERB = /\b(keeps?|keeping|kept|stays?|remains?|retains?)\b/i;

/**
 * The route's OWN vocabulary, which is definitionally an exclusion and must
 * stay sayable: `not_serviceable` MEANS the seller's policy excludes the
 * destination. Without this the correct three-state definition would false-RED,
 * and the only fix would be a weaker description.
 */
const ROUTE_VOCABULARY = [
  /\bexcludes?\s+the\s+destination\b/i,
  /\bpolicy\b[^.]{0,48}?\bexcludes?\b/i,
];

/**
 * Sentence scope. Markdown bullets and newlines end a sentence too — a
 * paragraph-wide window would let a keep-clause three sentences away excuse an
 * exclusion the agent reads on its own.
 */
function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?;])\s+|\n+|(?:^|\s)[-*•]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Every index in `sentence` at which `re` matches. */
function matchIndices(sentence: string, re: RegExp): number[] {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const found: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = global.exec(sentence)) !== null) {
    found.push(m.index);
    if (m[0].length === 0) global.lastIndex += 1;
  }
  return found;
}

/** Is the exclusion at `index` part of a phrase the route itself owns? */
function isRouteVocabulary(sentence: string, index: number): boolean {
  return ROUTE_VOCABULARY.some((re) =>
    matchIndices(sentence, re).some((start) => {
      const match = new RegExp(re.source, re.flags).exec(sentence.slice(start));
      return match !== null && index >= start && index < start + match[0].length;
    }),
  );
}

/**
 * Sentences that teach the agent to drop, filter, hide or deprioritise on an
 * honesty field. Empty ⇒ clean. Returns the offending sentences so a red names
 * the prose, not just the file.
 */
export function honestyExclusionOffenders(body: string): string[] {
  const offenders: string[] = [];
  for (const sentence of sentences(body)) {
    const candidates = [
      ...(HONESTY_TOKEN.test(sentence) ? matchIndices(sentence, EXCLUSION) : []),
      ...ABSOLUTE_EXCLUSION.flatMap((re) => matchIndices(sentence, re)),
    ];
    if (candidates.length === 0) continue;
    if (KEEP_VERB.test(sentence)) continue;
    const uncleared = candidates.filter(
      (index) =>
        !isRouteVocabulary(sentence, index) &&
        !NEGATION.test(sentence.slice(Math.max(0, index - NEGATION_LOOKBACK), index)),
    );
    if (uncleared.length > 0) offenders.push(sentence.replace(/\s+/g, " "));
  }
  return offenders;
}

/**
 * Claims a v0 route cannot honour (R6.2.3). Each names a state the wire can
 * genuinely be in: a price whose `observed` is `stored` is not "the current
 * price"; a seller whose `serviceability` is `unknown` does not "ship to you";
 * a result whose predicate is `applied: false` does not "match your
 * requirements"; a `report.blocked > 0` answer is not "everything available".
 *
 * Same sentence scope and same negation allowance — prose must be able to
 * forbid the claim by quoting it.
 */
const OVER_PROMISE = [
  /\bthe\s+current\s+price\b/i,
  /\bprices?\s+(?:are\s+)?(?:always\s+)?(?:up[- ]to[- ]date|current)\b/i,
  /\bguaranteed\s+(?:to\s+)?(?:ship|deliver)/i,
  /\bwill\s+ship\s+to\s+(?:you|the\s+buyer)\b/i,
  /\bships?\s+to\s+you\b/i,
  /\bmatch(?:es|ing)?\s+(?:all\s+)?(?:your|the\s+buyer's)\s+requirements\b/i,
  /\bevery(?:thing)?\s+(?:item\s+)?available\b/i,
  /\ball\s+(?:the\s+)?sellers?\s+(?:that\s+)?exists?\b/i,
  /\bexhaustive\b/i,
  /\bcomplete\s+list\s+of\b/i,
];

export function overPromiseOffenders(body: string): string[] {
  const offenders: string[] = [];
  for (const sentence of sentences(body)) {
    const uncleared = OVER_PROMISE.flatMap((re) => matchIndices(sentence, re)).filter(
      (index) =>
        !NEGATION.test(sentence.slice(Math.max(0, index - NEGATION_LOOKBACK), index)),
    );
    if (uncleared.length > 0) offenders.push(sentence.replace(/\s+/g, " "));
  }
  return offenders;
}

/**
 * Over-trigger (R6.2.5): a description that claims the general category instead
 * of what THIS tool does. `sil_search` searches sil's catalog in ONE registry
 * domain — an agent told it "searches the web" will reach for it constantly and
 * for the wrong thing. A prior card on this board was bounced for exactly this.
 *
 * NO negation allowance: unlike the honesty rules, there is no legitimate reason
 * for a tool description to quote an over-broad trigger at all, and the phrases
 * are the ones a model pattern-matches on regardless of the words around them.
 */
const OVER_TRIGGER = [
  /\bsearch(?:es)?\s+the\s+web\b/i,
  /\bweb\s+search\b/i,
  /\bfind\s+any(?:thing)?\b/i,
  /\bfind\s+(?:any\s+)?products?\s+(?:anywhere|online|on\s+the\s+(?:web|internet))\b/i,
  /\blook\s+anything\s+up\b/i,
  /\bgeneral[- ]purpose\b/i,
  /\bany\s+(?:online\s+)?(?:store|shop|retailer|merchant)\b/i,
  /\banything\s+you\s+(?:want|need)\b/i,
];

export function overTriggerOffenders(body: string): string[] {
  return sentences(body)
    .filter((s) => OVER_TRIGGER.some((re) => re.test(s)))
    .map((s) => s.replace(/\s+/g, " "));
}

/**
 * Vocabulary the v0 contract retired, as TEXT — every entry is a dead string
 * that cannot appear innocently in English prose, so a blanket forbid is right.
 *
 * The pre-v0 PARAMETER names that ARE innocent words (`category`, `condition`,
 * `cursor`) are deliberately absent: they are guarded STRUCTURALLY instead, off
 * each tool's own `parameters` schema (exact, and free of the false RED a bare
 * "category" would cause in prose that legitimately says "research how the
 * category is bought"). In prose they are caught in their BACKTICKED form
 * below — backticks are how prose names a parameter.
 *
 * Lower-case only: bodies are lowered before matching, so an upper-case needle
 * would sit here looking protective while matching nothing. Guarded by a
 * guard-of-the-guard at both call sites.
 */
export const RETIRED_V0_TOKENS = [
  "checkout_url",
  "price_min",
  "price_max",
  "local_merchants",
  "ship_to",
  "specs_status",
  "filters.specs",
  "ns.key",
  "sil_lookup",
  "mint_domain",
  "`cursor`",
  "`category`",
  "`condition`",
];

/** Retired tokens present in `body`, in the order listed. Empty ⇒ clean. */
export function retiredV0Offenders(body: string): string[] {
  const lower = body.toLowerCase();
  return RETIRED_V0_TOKENS.filter((token) => lower.includes(token));
}
