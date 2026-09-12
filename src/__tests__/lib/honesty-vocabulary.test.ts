/**
 * UNIT — the guard-of-the-guard for `helpers/honesty-vocabulary.ts`.
 *
 * The honesty scanners are the ONLY mechanical carrier of the most dangerous rule on the
 * surface (`unknown` keeps the seller). Prose rots, and a scanner nobody has watched FAIL
 * is a scanner that passes for the wrong reason — the exact failure mode
 * `RETIRED_TOKENS` documented, one level up.
 *
 * So this file drives both halves:
 *   - MUST BITE   — every forbidden phrasing the contract's honesty rules name.
 *   - MUST SPARE  — the sentence shape the product NEEDS. A scanner that fails
 *                   "`unknown` … never a reason to drop a seller: keep it" is worse than
 *                   no scanner: it forces the fix to be a weaker description.
 *
 * The SHIPPED descriptions are scanned where they live — `tool-schema-contract.unit`
 * runs all four scanners over every registered description and every parameter
 * description. Restating them here would be the drift copy this module exists to avoid.
 *
 * Tier: unit — pure string logic, no I/O, no host.
 */

import { describe, it, expect } from "vitest";
import {
  honestyExclusionOffenders,
  notFoundLicenceOffenders,
  overPromiseOffenders,
  overTriggerOffenders,
  retiredV0Offenders,
  statesQualifiedNotFound,
  RETIRED_V0_TOKENS,
} from "../helpers/honesty-vocabulary.js";

describe("honestyExclusionOffenders — the `unknown` rule, mechanically", () => {
  /** Every way the contract's honesty rules say the shortlist silently collapses. */
  const MUST_BITE: [string, string][] = [
    ["drop on unknown", "Drop sellers whose serviceability is unknown."],
    ["filter on unknown", "Filter out the unknown sellers before presenting the list."],
    ["skip on unknown", "Skip any seller returned as unknown."],
    ["exclude on unknown", "Exclude unknown sellers from the shortlist."],
    ["hide on unknown", "Hide sellers with unknown serviceability from the buyer."],
    ["ignore on unknown", "Ignore unknown entries."],
    [
      "deprioritise on unknown — the exclusion smuggled in as an ordering",
      "Rank the unknown sellers last and deprioritise them in the summary.",
    ],
    ["only serviceable — no honesty token needed", "Present only serviceable sellers."],
    ["serviceable only, inverted", "Show serviceable sellers only."],
    ["unknown reframed as a soft no", "Treat unknown as not_serviceable when in doubt."],
    ["unknown reframed as cannot-ship", "unknown means it cannot ship to the destination."],
    ["drop on an unfilled gap", "Discard products with a gap in fit."],
    ["drop on webpage_info", "Filter out products that only carry webpage_info."],
    ["drop on unverified", "Omit the unverified products from the shortlist."],
    ["drop on an empty variants list", "Skip products whose variants: [] came back empty."],
    ["drop on a currency sil could not test", "Hide the ones sil could not test against the budget."],
    ["only verified", "Present only verified products."],
    ["verified only, inverted", "Show verified products only."],
  ];

  it.each(MUST_BITE)("bites: %s", (_label, prose) => {
    expect(honestyExclusionOffenders(prose)).not.toEqual([]);
  });

  /** The sentences the product NEEDS. A scanner that fails these is unusable. */
  const MUST_SPARE: [string, string][] = [
    [
      "the keep-clause that names `drop` in order to forbid it",
      "`unknown` is an ordinary answer, not a degraded one, and never a reason to drop a seller:" +
        " keep it, say sil could not confirm shipping, and hand over its URL.",
    ],
    [
      "the negative instruction",
      "Never filter, drop or deprioritise a seller because its serviceability is unknown.",
    ],
    [
      "the route's own wording — `not_serviceable` legitimately excludes",
      "`not_serviceable` (sil read this seller's policy and it excludes the destination).",
    ],
    [
      "keep-the-product on a gap in `fit`",
      "A key absent from `fit` is a gap to name, never a miss — keep the product and say which" +
        " value sil holds nothing for.",
    ],
    [
      "a `webpage_info` product stays in the list",
      "A product carrying webpage_info is a real listing sil has not read yet — it remains in the" +
        " set, flagged as not verified.",
    ],
    [
      "an untestable currency bound is named, never used to drop",
      "A price in another currency is a bound sil could not test — say so rather than dropping" +
        " the product.",
    ],
    [
      "the absolute, disavowed by name",
      "Do not present only serviceable sellers — that collapses the shortlist while looking like" +
        " it filtered.",
    ],
  ];

  it.each(MUST_SPARE)("spares: %s", (_label, prose) => {
    expect(honestyExclusionOffenders(prose)).toEqual([]);
  });

  it("scopes to the SENTENCE — a keep-clause three sentences away does not excuse an exclusion", () => {
    // The window matters: an agent reads the offending sentence on its own.
    const prose =
      "unknown sellers are dropped from the list. Something else entirely. We never exclude a" +
      " seller, of course.";
    expect(honestyExclusionOffenders(prose)).toEqual([
      "unknown sellers are dropped from the list.",
    ]);
  });
});

describe("overPromiseOffenders — no description out-promises its route (R6.2.3)", () => {
  const MUST_BITE: [string, string][] = [
    ["current price where observed can be stored", "Returns the current price for every offer."],
    ["ships-to-you where the state can be unknown", "Lists the sellers that will ship to you."],
    [
      "matches-your-requirements where `fit` can be silent on a key",
      "Every result matches your requirements.",
    ],
    ["everything-available where `n` bounds the shortlist", "Returns everything available for the pick."],
    ["exhaustive", "The seller list is exhaustive."],
  ];

  it.each(MUST_BITE)("bites: %s", (_label, prose) => {
    expect(overPromiseOffenders(prose)).not.toEqual([]);
  });

  const MUST_SPARE: [string, string][] = [
    [
      "the honest form — the claim quoted in order to forbid it",
      "say the date it was read, never present it as the current price.",
    ],
    ["the bounded-shortlist caveat", "Some shops did not answer, so this list is not exhaustive."],
  ];

  it.each(MUST_SPARE)("spares: %s", (_label, prose) => {
    expect(overPromiseOffenders(prose)).toEqual([]);
  });

});

describe("overTriggerOffenders — a tool states when IT applies (R6.2.5)", () => {
  const MUST_BITE: [string, string][] = [
    ["search the web", "Search the web for products."],
    ["find any product", "Find anything the buyer asks about."],
    ["look anything up", "Look anything up on sil."],
    ["general-purpose", "A general-purpose lookup tool."],
    ["any online store", "Buy from any online store."],
  ];

  it.each(MUST_BITE)("bites: %s", (_label, prose) => {
    expect(overTriggerOffenders(prose)).not.toEqual([]);
  });

  it("spares the mint's research path — 'reading up on the web' is not 'search the web'", () => {
    expect(
      overTriggerOffenders("read up on the web on how the category is bought (never on products)"),
    ).toEqual([]);
  });
});

describe("retiredV0Offenders — the retired request surface's dead strings", () => {
  it("bites every retired token, one at a time (no needle sits vacuous)", () => {
    for (const token of RETIRED_V0_TOKENS) {
      expect({ token, hits: retiredV0Offenders(`the prose says ${token} here`) }).toEqual({
        token,
        hits: [token],
      });
    }
  });

  it("matches case-insensitively — a Title-cased reintroduction still fails", () => {
    expect(retiredV0Offenders("the CHECKOUT_URL field")).toEqual(["checkout_url"]);
  });

  it("every needle is lower-case (guard-of-the-guard: the body is lowered, not the needle)", () => {
    expect(RETIRED_V0_TOKENS.filter((t) => t !== t.toLowerCase())).toEqual([]);
  });

  it("spares the innocent English words the pre-v0 PARAMETERS were named after", () => {
    // `category` / `condition` / `cursor` are guarded STRUCTURALLY: each tool's
    // parameters ARE its committed artifact, so a resurrected one cannot register at
    // all. A bare-word forbid would fail the mint description, which must say "research
    // how the category is bought".
    expect(retiredV0Offenders("research how the category is bought in that condition")).toEqual([]);
  });

  it("bites the BACKTICKED parameter form — how prose names a parameter", () => {
    expect(retiredV0Offenders("pass `category` to narrow the search")).toEqual(["`category`"]);
  });

  it("spares `ship_to` — the contract's seller read takes it as a request field", () => {
    // It was retired once and came back. A guard that still forbids it would fight the
    // wire it exists to protect.
    expect(retiredV0Offenders("send `ship_to` only when it is not the buyer's own country")).toEqual(
      [],
    );
  });
});

/**
 * The needle AC15 (tool descriptions) and AC16 (bundle prose) both read. Without a
 * bite proof an unmatchable qualifier would leave BOTH of them green over prose
 * that still hands the agent the licence — the failure neither of them can catch
 * about itself.
 *
 * The spare rows are deliberately worded UNLIKE the descriptions they will run
 * over: the rule is "state the listing condition", not "use this sentence".
 */
describe("notFoundLicenceOffenders — `not_found` is a positive claim, never a bare licence", () => {
  const MUST_BITE: [string, string][] = [
    ["shopping_doc_read's shipped line, verbatim", "An absent document answers not_found."],
    [
      "shopping_doc_remove's shipped line, verbatim — `not_found` as proof a delete landed",
      "An already-gone document answers not_found, so a repeat call is safe.",
    ],
    [
      "the bundle's shipped line, verbatim",
      "An absent document is `not_found`; a present-but-corrupt one is `unreadable`.",
    ],
    [
      "the re-mint instruction spelled out",
      "If a Brief reads not_found, mint a fresh one with shopping_doc_write (mode: create).",
    ],
    [
      "the delete believed to have landed",
      "A repeat shopping_doc_remove answers not_found, which is proof the document is gone.",
    ],
    [
      "sentence scope — a qualifier in the NEXT sentence does not reach it",
      "not_found means the Brief is gone. sil reports it only when it could list the directory.",
    ],
    [
      "bullet scope — a qualifier in the bullet BELOW does not reach it either",
      "- An absent document answers not_found\n- sil could list the directory that would hold it",
    ],
  ];

  it.each(MUST_BITE)("bites: %s", (_label, prose) => {
    expect(notFoundLicenceOffenders(prose)).not.toEqual([]);
  });

  const MUST_SPARE: [string, string][] = [
    [
      "the condition stated plainly",
      "not_found is reported only when sil could list the directory that would hold the document"
        + " and it was not in it.",
    ],
    [
      "the same rule from the other side — different words, same fact",
      "not_found never means an unreadable directory: it is what sil answers when the folder"
        + " listed cleanly and the document was gone.",
    ],
    [
      "the negative form, naming the state it excludes",
      "not_found is never returned for an unlistable directory, so an absent answer is a real"
        + " absence.",
    ],
    [
      "an enumeration of the wire's statuses claims nothing about absence",
      "The store answers ok, not_found, unreadable or invalid_request.",
    ],
    [
      "a HARD-WRAPPED sentence is one sentence — the rule is not a column-width rule",
      "`not_found` is reported only when sil could list the\ndirectory that would hold the document"
        + "\nand it was not in it.",
    ],
  ];

  it.each(MUST_SPARE)("spares: %s", (_label, prose) => {
    expect(notFoundLicenceOffenders(prose)).toEqual([]);
  });

  it("statesQualifiedNotFound separates teaching the rule from deleting the vocabulary", () => {
    // The cheapest way to pass a forbid-scan is to stop naming `not_found` at all,
    // which leaves the agent reading a status nothing explains. AC15/AC16 use this
    // as their floor, so it has to be false on the bare form.
    expect(
      statesQualifiedNotFound(
        "not_found is reported only when sil could list the directory that would hold it.",
      ),
    ).toBe(true);
    expect(statesQualifiedNotFound("An absent document answers not_found.")).toBe(false);
    expect(statesQualifiedNotFound("The document surface is local-only.")).toBe(false);
  });
});
