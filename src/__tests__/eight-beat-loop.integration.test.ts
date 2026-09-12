/**
 * INTEGRATION — the `sil-shopping` bundle drives the EIGHT beats of
 * `SIL-DOMAINS-AND-SPECS.md` §5, at the `SIL-V0-DOMAINS-AND-SPECS.md` §6
 * narrowing. Card acceptance groups A (BRIEF/cadence) · B (DOMAIN) · C (ASK) ·
 * D (SEARCH) · E (REFLECT, no-regression) · F (VERDICT). Reads the real files.
 *
 * WHY THESE ARE STRUCTURAL, NOT PROSE PINS. This repo deleted a 1341-line
 * skill-content test that pinned nearly every clause and stayed GREEN straight
 * through a live behavioural bug. Every bar here asserts WHERE a decision lives —
 * inside the section of the beat that owns it — and never what wording carries it.
 * The scope is what does the work; the regexes inside it are deliberately loose
 * alternations. Modelled on the shipped S2–S7 block in
 * `skill-bundle-contract.integration.test.ts`: statement-scoped, each with a
 * guard-of-the-guard so an empty corpus cannot pass.
 *
 * THE ONE FORMAT CONTRACT (`helpers/skill-bundle.ts#beatSections`): each beat is
 * opened by a markdown heading naming `Beat <n>`, which is already the bundle's own
 * convention. A missing beat makes `beatBody()` THROW rather than return an empty
 * scope — an empty scope would make every `unsatisfied()` bar below it pass
 * vacuously, which is worse than a red. A3 is the bar that names that failure.
 *
 * Where a criterion's subject is model behaviour (C3, F2), the bar asserts the
 * discipline is STATED at the beat that owns it. That is the honest ceiling: no
 * test in this repo can observe an agent choosing to ask two questions instead of
 * nine. Stating it at the right beat is the whole mechanism the product has.
 *
 * B5 is NOT here — the mint-licence no-regression is already held, statement-scoped
 * and with its own guard-of-the-guard, by the `S4`/`S4/BR-1b`/`S2` bars in
 * `skill-bundle-contract.integration.test.ts` (labelled `= B5` there). A second copy
 * would be duplicate coverage, not safety.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken one to match the prose.
 */

import { describe, it, expect } from "vitest";

import {
  BEAT_NAMES,
  beatBody,
  beatSections,
  beatStatements,
  bundleFiles,
  read,
  splitStatements,
  statements,
  unsatisfied,
} from "./helpers/skill-bundle.js";

/** Every bundle file naming all eight beats in UPPERCASE — the loop overview an
 * agent reads before it loads any single beat. Uppercase deliberately: `ASK` and
 * `SEARCH` are ordinary English words, and a case-insensitive scan would order the
 * beats by whichever paragraph happened to use the verb first. */
const overviewFiles = (): string[] =>
  bundleFiles().filter((rel) => {
    const src = read(rel);
    return BEAT_NAMES.every((name) => new RegExp(`\\b${name}\\b`).test(src));
  });

/** The bundle is HARD-WRAPPED, so `once per job` is routinely `once\nper job`. Every
 * whole-file regex below runs against the folded text; a line-break must never be
 * the reason a decision reads as absent. */
const folded = (rel: string): string => read(rel).replace(/\s+/g, " ");

describe("A — BRIEF and the cadence", () => {
  it("A1 — beat 1 scopes the job as `## Items`: one row and one prose subsection PER THING", () => {
    // The row-per-thing shape is what makes a two-item job a two-item job. Without
    // it a multi-thing request is either one blurred search or two Briefs, and the
    // per-item fan-out below has nothing to iterate.
    const body = beatBody(1);
    expect(body).toContain("## Items");
    const shape = beatStatements(1).filter((s) => /\b(row|subsection)\b/i.test(s));
    expect(shape.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(shape, (s) => /\bper\s+(thing|item)\b/i.test(s))).toEqual([]);
  });

  it("A2 — an unclassified item is a LEGAL, writable state at beat 1 — never an error, never a blocked job", () => {
    // An item exists before it is classified (beat 2 classifies it), so beat 1 must
    // be able to write a row with no domain. Prose that treats it as an error turns
    // "I need boots and something warm" into a refusal at the first turn.
    const candidates = beatStatements(1).filter((s) =>
      /unclassified|no domain|before it is classified|not yet classified|domain (cell )?(is )?empty/i.test(s),
    );
    expect(candidates.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(candidates, (s) =>
        /\blegal\b|\bwritable\b|\ballowed\b|\bvalid\b|\bproceeds?\b|never an error|not an error/i.test(s),
      ),
    ).toEqual([]);
  });

  it("A3 — all eight beats exist, named and in order, and the loop states its three cadences", () => {
    // The guard-of-the-guard for this WHOLE file: every other bar scopes itself to a
    // beat section, and a missing section throws rather than passing vacuously.
    const sections = beatSections();
    expect([...sections.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const misnamed = BEAT_NAMES.map((name, i) => [i + 1, name] as const)
      .filter(([n, name]) => !new RegExp(`\\b${name}\\b`, "i").test(sections.get(n)!.heading))
      .map(([n, name]) => `beat ${n} heading does not name ${name}: ${sections.get(n)!.heading}`);
    expect(misnamed).toEqual([]);

    // ONE file must enumerate all eight IN ORDER and state all three cadences — the
    // loop is a sequence, and a reader who meets it out of order runs it out of
    // order. Per file, never across the corpus: an ordering assembled from two files
    // is an ordering no reader ever sees. The cadence is the shape — eight beats that
    // all run per item is not this loop, and a BRIEF re-run per item re-scopes the job.
    const overviews = overviewFiles();
    expect(overviews).not.toEqual([]); // guard-of-the-guard
    const ordered = overviews.filter((rel) => {
      const src = read(rel);
      const at = BEAT_NAMES.map((name) => src.search(new RegExp(`\\b${name}\\b`)));
      return (
        at.every((i, k) => k === 0 || i > (at[k - 1] as number))
        && /once per job/i.test(folded(rel))
        && /per item/i.test(folded(rel))
        && /out of band/i.test(folded(rel))
      );
    });
    expect(overviews.filter(() => ordered.length === 0)).toEqual([]);
  });

  it("A4 — recall happens TWICE and neither read subsumes the other: text at beat 1, exact-by-domain at beat 2", () => {
    // Beat-SECTION scope, not statement scope: "recall first" and "reuse it, do not
    // open a second Brief" are two sentences by design, and forcing them into one
    // would be pinning a sentence rather than locating a decision.
    const first = beatBody(1);
    expect(first).toContain("shopping_doc_find");
    expect(first).toMatch(/\breuse\b/i);
    expect(first).toMatch(/second brief|a second|not a second|never a second/i);
    expect(beatBody(2)).toContain("shopping_doc_find");

    // …and the bundle says the two reads are two, so neither is optimised away.
    const bothReads = statements().filter((s) => /recall/i.test(s));
    expect(bothReads.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(bothReads, (s) =>
        /twice|two recalls|two reads|separate|neither|does not replace/i.test(s),
      ),
    ).toEqual([]);
  });

  it("A5 — completion is the COUNT of open `## Items` rows: a pick ends an item, never the job", () => {
    const completion = statements().filter(
      (s) => /\bopen\b/i.test(s) && /## Items|\bitems?\b/i.test(s),
    );
    expect(completion.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        completion,
        (s) =>
          /\bcount\b|how many|number of/i.test(s) && /\bdone\b|complete|finished/i.test(s),
      ),
    ).toEqual([]);

    const picks = statements().filter((s) => /\bpick\b/i.test(s) && /\bitem\b/i.test(s));
    expect(picks.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(picks, (s) => /never the job|not the job|ends? (that|the|an|one) item/i.test(s)),
    ).toEqual([]);
  });
});

describe("B — DOMAIN", () => {
  it("B1 — beat 2 ADOPTS a matched domain WHOLE: keys verbatim, nothing coined beside them, no standing domain edited from a session", () => {
    const body = beatBody(2);
    expect(body).toMatch(/\badopt/i);
    expect(body).toMatch(/verbatim/i);
    const edits = splitStatements(body).filter(
      (s) =>
        /\bedit|\bchange|\bmodif|\brewrit|\bwiden/i.test(s)
        && /existing|standing|already|another shopper|from (a|the) session/i.test(s),
    );
    expect(edits.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(edits, (s) => /\bnever\b|\bnot\b|\bcannot\b|\bcan'?t\b/i.test(s))).toEqual([]);
  });

  it("B2 — a key the adopted vocabulary lacks travels EXACTLY two ways — an unapplied predicate and a `## Notes / open` row — and is never coined", () => {
    const body = beatBody(2);
    expect(body).toContain("## Notes / open");

    // BOTH channels in ONE statement. The pre-card bundle already carried an
    // `applied: false` gap sentence AND a `## Notes / open` bullet — a hundred lines
    // apart, about unrelated things — so a body-scoped pair passes on prose that
    // never connected them, and the agent writes the predicate and forgets the row.
    const gaps = splitStatements(body).filter(
      (s) => /unapplied|applied:?\s*[`'"]*false|named gap/i.test(s),
    );
    expect(gaps.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(gaps, (s) => /notes ?\/ ?open/i.test(s))).toEqual([]);

    const coining = splitStatements(body).filter((s) => /\bcoin/i.test(s));
    expect(coining.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(coining, (s) => /\bnever\b|\bnot\b|\brather than\b/i.test(s))).toEqual([]);
  });

  it("B3 — beat 2 ANNOUNCES the inferred domain, writes it into the item's `## Items` row, and copies the guide VERBATIM into `## Buying guide`", () => {
    const body = beatBody(2);
    expect(body).toContain("## Items");
    expect(body).toContain("## Buying guide");
    expect(body).toMatch(/verbatim/i);
    const announce = splitStatements(body).filter(
      (s) => /announce|tell the buyer|state the inferred|say which domain/i.test(s),
    );
    expect(announce.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(announce, (s) => /correct/i.test(s))).toEqual([]);
  });

  it("B4 — beat 2 resolves EACH item's domain independently — one item's domain never infers another's", () => {
    const perItem = splitStatements(beatBody(2)).filter((s) =>
      /\b(per|each|every)\s+item\b/i.test(s),
    );
    expect(perItem.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(perItem, (s) =>
        /independent|separate|its own|on its own|one per item|never inherit|not inherited/i.test(s),
      ),
    ).toEqual([]);
  });
});

describe("C — ASK is a beat, so `## Notes / open` is a surface", () => {
  it("C1 — ASK runs BEFORE that item's first `shopping_search`", () => {
    // Beat ordering alone (A3) says ASK precedes SEARCH; this says the bundle states
    // the CONSEQUENCE — no search is issued for an item whose load-bearing dimension
    // is still open until the ask has run.
    const units = beatStatements(4);
    expect(units.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(units, (s) => /\bbefore\b/i.test(s) && /shopping_search|\bsearch\b/i.test(s)),
    ).toEqual([]);
  });

  it("C2 — ASK can ask NOTHING: a fully-resolved item passes straight through to SEARCH", () => {
    // The interrogation guard. Promoting ASK to a beat invites a battery of
    // questions on a warm domain, which is the common case and the one where a
    // question costs the most.
    const nothing = beatStatements(4).filter(
      (s) => /\bnothing\b|no question|does not ask|asks? none|silent/i.test(s),
    );
    expect(nothing.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(nothing, (s) => /\bask/i.test(s))).toEqual([]);
  });

  it("C3 — the ASK turn is BOUNDED, each question carries the guide's reason, and it plays the filled understanding back", () => {
    const units = beatStatements(4);
    expect(units.length).toBeGreaterThan(0); // guard-of-the-guard
    const bars: [string, RegExp][] = [
      [
        "a few at a time, never a battery",
        /\ba few\b|two or three|at a time|\bbatter(y|ies)\b|\binterrogat|never a list of/i,
      ],
      [
        "each question tied to why it decides the buy",
        /decides the buy|why it (matters|decides)|load-bearing|the guide (says|marks)/i,
      ],
      [
        "plays the filled understanding back for correction",
        /play(s|ing)? (it |the .{0,24})?back|read(s|ing)? back|restate|reflect(s|ing)? back|mis-?translation/i,
      ],
    ];
    expect(bars.filter(([, re]) => !units.some((s) => re.test(s))).map(([name]) => name)).toEqual([]);
  });

  it("C4 — a declined or unanswered ASK still searches on the best defensible reading, states the assumption, and writes a `## Notes / open` row", () => {
    // Elicitation gates QUALITY, never ACCESS. A half-resolved Brief that refuses to
    // search is the form-filling failure this whole beat is designed against.
    const body = beatBody(4);
    expect(body).toContain("## Notes / open");
    const declines = splitStatements(body).filter(
      (s) => /declin|no answer|does not answer|unanswered|silence|skips? the question/i.test(s),
    );
    expect(declines.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(declines, (s) =>
        /still (search|run)|search(es)? anyway|never blocks|does not block|proceeds/i.test(s),
      ),
    ).toEqual([]);
    expect(body).toMatch(/assumption/i);
    expect(body).toMatch(/quality/i);
    expect(body).toMatch(/access/i);
  });

  it("C5 — a prior session's `## Notes / open` rows are ASK's INPUT: read back, and re-asked only while still load-bearing", () => {
    // The difference between a surface and a record. Written-only rows are sediment;
    // read-back rows are what makes the section worth having.
    const notes = beatStatements(4).filter((s) => /notes ?\/ ?open/i.test(s));
    expect(notes.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(notes, (s) => /\bread\b|\binput\b|consume|next session|carried|prior/i.test(s)),
    ).toEqual([]);

    const reask = beatStatements(4).filter((s) => /re-?ask/i.test(s));
    expect(reask.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(reask, (s) => /\bstill\b|\bonly\b/i.test(s))).toEqual([]);
  });

  it("C6 — beat 6 re-enters ASK when not-verified dominates, or the guide marks the risk unrecoverable — ASK has TWO entry points", () => {
    const body = beatBody(6);
    expect(body).toMatch(/not[- ]verified/i);
    expect(body).toMatch(/dominat/i);
    expect(body).toMatch(/unrecoverab/i);
    const reentry = splitStatements(body).filter((s) => /dominat|unrecoverab/i.test(s));
    expect(reentry.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(reentry, (s) => /\bASK\b/.test(s) || /beat 4|beat four/i.test(s))).toEqual([]);
  });

  it("C7 — NO reference presents elicitation as a step inside FILL: every ask in beat 3 defers to ASK", () => {
    // The exact demotion §5 rejects. Fill's terminal state is "everything has a
    // value", so a residue folded into it reads as a failure to resolve — and the
    // shopper either keeps resolving out loud or defaults silently.
    //
    // Two allowances, both load-bearing, both the `honestyExclusionOffenders` shape:
    //   1. beat 3 may NAME the ASK beat — that is the hand-off, not the demotion.
    //      Case matters: uppercase `ASK` is the reference, the lowercase verb is the
    //      defect.
    //   2. beat 3 may say it asks NOTHING. "Fill asks the buyer nothing" is the very
    //      sentence this bar exists to protect, so a bare verb scan would fail the
    //      card against itself. The negation is read in a 44-char window on EITHER
    //      side of the verb — "asks … nothing" puts it after — never document-wide,
    //      which would excuse a real ask three paragraphs below a denial.
    const NEAR = 44;
    const CLEARS = /\b(never|not|nothing|none|n't|no question|rather than|instead of)\b/i;
    const ownsAnAsk = (s: string): boolean => {
      if (/\bASK\b/.test(s) || /beat 4|beat four/i.test(s)) return false;
      for (const m of s.matchAll(/\b(asks?|asking|asked|elicit\w*)\b/gi)) {
        const at = m.index ?? 0;
        if (!CLEARS.test(s.slice(Math.max(0, at - NEAR), at + m[0].length + NEAR))) return true;
      }
      return false;
    };
    const units = beatStatements(3);
    expect(units.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(units.filter(ownsAnAsk)).toEqual([]);
  });

  it("C8 — two items reaching ASK with an open dimension are merged into ONE turn", () => {
    // Per-item beats must not mean per-item interrogations: three items with one
    // open dimension each is three separate question turns unless the bundle says so.
    const merged = beatStatements(4).filter(
      (s) => /one turn|single turn|same turn|together|merge/i.test(s),
    );
    expect(merged.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(merged, (s) => /\bitems?\b/i.test(s))).toEqual([]);
  });
});

describe("D — SEARCH, as the contract narrows it", () => {
  it("D1 — beat 5 reads ONLY the four shopping reads; no review read exists and none is named", () => {
    const body = beatBody(5);
    const missing = [
      "shopping_search",
      "shopping_product_get",
      "shopping_offers",
      "shopping_seller_get",
    ].filter((t) => !body.includes(t));
    expect(missing).toEqual([]);
    // A review read is a V1 tool. Naming a tool the plugin does not register hands the
    // agent a dangling pointer: it tries it, fails, and has no recovery.
    const dangling = bundleFiles().filter(
      (rel) => read(rel).includes("sil_reviews") || read(rel).includes("shopping_reviews"),
    );
    expect(dangling).toEqual([]);
  });

  it("D2 — the ≤4 priority-ordered call bound is PER ITEM, never per request and never per job", () => {
    // `SKILL.md` once said "per request". On a two-item job that either halves the second
    // item's budget or blows the bound, and neither is visible from any other bar.
    const bounded = statements().filter(
      (s) =>
        /(≤\s*4|\b4\b|\bfour\b)[^.]{0,80}\bcalls?\b|\bcalls?\b[^.]{0,80}(≤\s*4|\bfour\b)/i.test(s)
        && /shopping_search|\bsearch\b/i.test(s),
    );
    expect(bounded.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(bounded, (s) => /per item|each item/i.test(s))).toEqual([]);
    // A bound sentence naming per-request/per-job is an offender ONLY when it does
    // not also say per item in the SAME statement. The correct prose disavows the
    // wrong reading by name ("PER ITEM — not per job"), and a bare forbid would fail
    // exactly the sentence that fixes the defect.
    expect(
      bounded.filter((s) => /per request|per job/i.test(s) && !/per item|each item/i.test(s)),
    ).toEqual([]);
  });
});

describe("E — REFLECT keeps its three-state veto, re-derived onto the contract's honesty", () => {
  // The veto ships and this rewrite must not cost it. What changed is its INPUTS: the
  // contract retired the per-value state, the per-row report and the maturity flag, and
  // put the whole of what sil verified in one place — `fit`. The three buckets are the
  // same three; what fills them is read off the new wire.

  it("E1 — VIOLATED is a key `fit` CARRIES whose value fails the hard row: out, always", () => {
    const body = beatBody(6);
    expect(body).toMatch(/\bVIOLATED\b/);
    const violated = splitStatements(body).filter((s) => /\bVIOLATED\b/.test(s));
    expect(violated.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(violated, (s) => /\bfit\b/i.test(s) && /fail/i.test(s)),
    ).toEqual([]);
    expect(body).toMatch(/\bout\b|never (becomes )?the pick|never the pick/i);
  });

  it("E2 — NOT VERIFIED is kept and FLAGGED with the missing key named — never silently passed, never silently dropped", () => {
    // The bucket the whole honesty turns on, and the one with three ways in now: a key
    // absent from `fit`, a page sil has not read, and a bound in a currency it could not
    // test. All three keep their product.
    const body = beatBody(6);
    const notVerified = splitStatements(body).filter((s) => /NOT[ -]VERIFIED/i.test(s));
    expect(notVerified.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        notVerified,
        (s) => /absent from `?fit`?/i.test(s) && /webpage_info/i.test(s) && /currency/i.test(s),
      ),
    ).toEqual([]);
    expect(body).toMatch(/flag/i);
    expect(body).toMatch(/missing key|the key named|names? the (missing )?key|which key/i);
    expect(body).toMatch(/silently/i);
  });

  it("E3 — `webpage_info` never vetoes on its own: it lands in NOT VERIFIED, never in VIOLATED", () => {
    // A page sil has not read yet is a REAL listing at a real price. Reading its
    // presence as a failure empties the cold shortlist, which is every shortlist in a
    // category minted a minute ago.
    const info = splitStatements(beatBody(6)).filter((s) => /webpage_info/i.test(s));
    expect(info.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(info, (s) => /never vetoes|never veto|not (a )?veto|on its own/i.test(s)),
    ).toEqual([]);
    expect(
      unsatisfied(info, (s) => /NOT[ -]VERIFIED/i.test(s) && /\bVIOLATED\b/.test(s)),
    ).toEqual([]);
  });

  it("E4 — the ABSENCE of `webpage_info` is the positive signal: those values were verified", () => {
    // The half an agent silently loses first. Without it `webpage_info` reads as a
    // warning label rather than a state, and a verified card gets hedged like an unread
    // one — which is the same lie in the other direction.
    const info = splitStatements(beatBody(6)).filter((s) => /webpage_info/i.test(s));
    expect(unsatisfied(info, (s) => /absence/i.test(s) && /verified/i.test(s))).toEqual([]);
  });
});

describe("F — VERDICT, the sparse falsifier", () => {
  it("F1 — beat 2's exact-by-domain recall opens the session with the verdict ask on a DONE Brief's undecided pick, before the new job's fill", () => {
    const body = beatBody(2);
    expect(body).toMatch(/verdict/i);
    const verdict = splitStatements(body).filter((s) => /verdict/i.test(s));
    expect(verdict.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(verdict, (s) => /\bdone\b/i.test(s) && /\bpick\b/i.test(s))).toEqual([]);
    expect(body).toMatch(/before[^.]{0,80}(fill|new job|shopping|we shop)/i);
  });

  it("F2 — the `## Past purchases` row carries what · when · verdict · why, and the WHY is the buyer's own — never inferred", () => {
    // A bare good/bad row is near-worthless evidence, and an INFERRED why is worse
    // than none: it manufactures a constraint the buyer never held.
    const body = beatBody(8);
    expect(body).toContain("## Past purchases");
    const why = splitStatements(body).filter((s) => /\bwhy\b/i.test(s));
    expect(why.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(why, (s) =>
        /never infer|not infer|never guess|the buyer'?s own|in the buyer'?s (own )?words/i.test(s),
      ),
    ).toEqual([]);
  });

  it("F3 — a bare good/bad is asked ONCE for its reason and the row is written either way, with an EMPTY why rather than a fabricated one", () => {
    const body = beatBody(8);
    const askOnce = splitStatements(body).filter(
      (s) => /\bonce\b/i.test(s) && /reason|why/i.test(s),
    );
    expect(askOnce.length).toBeGreaterThan(0); // guard-of-the-guard

    const blank = splitStatements(body).filter((s) => /empty|blank|left out|no why/i.test(s));
    expect(blank.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        blank,
        (s) =>
          /rather than|\bnever\b|\bnot\b/i.test(s) && /fabricat|invent|guess|infer|made up/i.test(s),
      ),
    ).toEqual([]);
  });

  it("F4 — a contradicted `## Shopping` section is RE-DERIVED WHOLE, never caveated and never a second appended line; `## Fit` gains a row only when the size taught something", () => {
    const body = beatBody(8);
    expect(body).toContain("## Shopping");
    expect(body).toContain("## Fit");

    const rederive = splitStatements(body).filter((s) => /re-?deriv|rewrit/i.test(s));
    expect(rederive.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(rederive, (s) => /whole|never append|not append|never caveat|not caveat/i.test(s)),
    ).toEqual([]);

    const fit = splitStatements(body).filter((s) => /## Fit|\bfit\b/i.test(s));
    expect(fit.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(fit, (s) => /\bsize\b/i.test(s))).toEqual([]);
  });

  it("F5 — a DECLINED verdict ask writes nothing, is not repeated that session, and leaves the new job untouched", () => {
    // The toll-booth failure: every session in a domain opening with a survey
    // question turns the shopper into a form.
    const declines = beatStatements(8).filter((s) => /declin/i.test(s));
    expect(declines.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(declines, (s) => /nothing/i.test(s))).toEqual([]);
    expect(
      unsatisfied(declines, (s) =>
        /not repeated|never repeated|not asked again|once (a|per) session|this session/i.test(s),
      ),
    ).toEqual([]);
  });

  it("F6 — the verdict trigger is the UNDECIDED PICK — never elapsed time, never a session count", () => {
    const body = beatBody(8) + "\n" + beatBody(2);
    const triggers = splitStatements(body).filter((s) =>
      /\btimer\b|threshold|session count|elapsed|how long/i.test(s),
    );
    expect(triggers.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(triggers, (s) => /\bno\b|\bnever\b|\bnot\b/i.test(s))).toEqual([]);
  });

  it("F7 — at v0 beat 8 writes the shopper's OWN document and nothing else: no review is written and no review tool is called", () => {
    // The publish/share half of the criterion is behaviour no test in this repo can
    // observe; what IS checkable is that the write target is the shopper's document
    // and that the V1 write tool is named nowhere — a dangling pointer the agent
    // would try, fail, and have no recovery from.
    const writes = beatStatements(8).filter((s) => /shopping_doc_write|\bwrit(e|es|ing)\b/i.test(s));
    expect(writes.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(writes, (s) => /shopper|## Past purchases|own document/i.test(s)),
    ).toEqual([]);
    expect(bundleFiles().filter((rel) => read(rel).includes("sil_review_write"))).toEqual([]);
  });
});
