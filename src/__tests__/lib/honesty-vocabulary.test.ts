/**
 * UNIT — the guard-of-the-guard for `helpers/honesty-vocabulary.ts`.
 *
 * The honesty scanners are the ONLY mechanical carrier of the most dangerous rule
 * on the v0 surface (`unknown` keeps the seller). Prose rots, and a scanner
 * nobody has watched FAIL is a scanner that passes for the wrong reason — the
 * exact failure mode `RETIRED_TOKENS` documented, one level up.
 *
 * So this file drives both halves, from the card's own text:
 *   - MUST BITE   — every forbidden phrasing the product ruling names (R3, R6.2).
 *   - MUST SPARE  — the approved draft descriptions (R6.3), verbatim. A scanner
 *                   that fails the sentence the product NEEDS ("`unknown` …
 *                   never a reason to drop a seller: keep it") is worse than no
 *                   scanner: it forces the fix to be a weaker description.
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

/**
 * The card's R6.3 draft descriptions, verbatim. Binding on the clauses, editable
 * on the wording — but the scanner must pass THESE, because every one of them
 * names an honesty state in order to keep its subject.
 */
const APPROVED_STORES =
  "For one pick, list every seller that carries it and what sil knows about shipping it to" +
  " the buyer. Each seller carries `serviceability`: `serviceable` (sil read a shipping route" +
  " covering the destination), `not_serviceable` (sil read this seller's policy and it excludes" +
  " the destination), or `unknown` (sil has not read this seller's policy). `unknown` is an" +
  " ordinary answer, not a degraded one, and never a reason to drop a seller: keep it, say sil" +
  " could not confirm shipping, and hand over its URL. Costs and thresholds come as ranges per" +
  " currency where sil has read them and `unset` where it has not — `unset` is never zero and" +
  " never free. The `handoff` names its own promise: `source: buy_url` is a checkout path," +
  " `source: url` is the listing page — say which one you are handing over. Discipline: the" +
  " pick's check — three states; `unknown` is never no.";

const APPROVED_SEARCH =
  "Search sil for buyable items in one registry domain. Send the domain path, the buyer's own" +
  " words as `query`, and their stated requirements as typed predicates; get up to `n` results," +
  " best first. Present them in the order returned — do not re-rank. Each result carries the" +
  " values sil holds (`unset` where it holds none), the merchant's own printed pairs, the offers" +
  " it has read, and `maturity` (`catalog` = built and verified by sil; `web` = a listing read" +
  " minutes ago, values honestly unset). `predicates[]` says, per requirement, whether sil could" +
  " apply it. A requirement reported `applied: false`, or a result whose value is `unset`, is NOT" +
  " VERIFIED — neither a match nor a miss: keep the result and name the missing value." +
  " Discipline: at most 4 calls per item; widen soft requirements only; a hard requirement is" +
  " never relaxed. If the domain is not in sil's registry the call is refused — research how the" +
  " category is bought, then sil_domain_create at that same path.";

const APPROVED_PRODUCT_GET =
  "Re-read up to 5 results you already hold, by the `ref` sil returned, before the buyer decides." +
  " Same result object, with the top offers' prices read live: every offer says `observed: live`" +
  " (read just now) or `stored` (quoted from storage — say the date it was read, never present it" +
  " as the current price). Only the offers move; values, pairs and media are the stored read. A" +
  " ref that resolves to nothing is absent from the results — say that listing is gone, never" +
  " substitute another product. Discipline: the shortlist read — live prices, top-K bounded.";

const APPROVED_DOMAIN_CREATE =
  "Add a NEW category to sil's shared registry: its path, a buying guide written from research," +
  " and its first spec keys. Call it only after reading up on the web on how that category is" +
  " actually bought (never on products), and only when sil's search refused the domain as" +
  " unregistered. NEW nodes only — an existing path is refused and nothing is written; that" +
  " refusal means the category is already there, so re-issue the search on the same path. Never" +
  " mint a near-path variant to route around a refusal, and never call this to change or extend a" +
  " domain that exists. What you write is global — every sil shopper sees it. A fresh node is" +
  " provisional until sil validates it: tell the buyer the first answers come from the web while" +
  " that catches up.";

const APPROVED = {
  sil_search: APPROVED_SEARCH,
  sil_product_get: APPROVED_PRODUCT_GET,
  sil_stores: APPROVED_STORES,
  sil_domain_create: APPROVED_DOMAIN_CREATE,
};

describe("honestyExclusionOffenders — the `unknown` rule, mechanically", () => {
  /** Every way the product ruling says the shortlist silently collapses. */
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
    ["drop on unset", "Discard results whose values are unset."],
    ["drop on applied:false", "Omit any requirement reported applied: false from the answer."],
    ["drop on maturity web", "Filter out results with maturity: web — they are unverified."],
    ["suppress on unset", "Suppress the unset fields so the buyer is not confused."],
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
      "keep-the-result on applied:false",
      "A requirement reported `applied: false` is NOT VERIFIED — keep the result and name the" +
        " missing value.",
    ],
    [
      "a `web` result stays in the list",
      "A result with maturity: web is a real listing with honestly unset values — it remains in" +
        " the set, flagged.",
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

  it.each(Object.entries(APPROVED))(
    "spares the card's approved %s description verbatim",
    (_name, description) => {
      expect(honestyExclusionOffenders(description)).toEqual([]);
    },
  );

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
      "matches-your-requirements where applied can be false",
      "Every result matches your requirements.",
    ],
    ["everything-available where blocked can be > 0", "Returns everything available for the pick."],
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
    ["a blocked-count caveat", "Some shops did not answer, so this list is not exhaustive."],
  ];

  it.each(MUST_SPARE)("spares: %s", (_label, prose) => {
    expect(overPromiseOffenders(prose)).toEqual([]);
  });

  it.each(Object.entries(APPROVED))(
    "spares the card's approved %s description verbatim",
    (_name, description) => {
      expect(overPromiseOffenders(description)).toEqual([]);
    },
  );
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

  it.each(Object.entries(APPROVED))(
    "spares the card's approved %s description verbatim",
    (_name, description) => {
      // `sil_domain_create` legitimately says "reading up on the web" — the
      // research path. The scan must not confuse that with "search the web".
      expect(overTriggerOffenders(description)).toEqual([]);
    },
  );
});

describe("retiredV0Offenders — the pre-v0 contract's dead strings", () => {
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
    // `category` / `condition` / `cursor` are guarded STRUCTURALLY off each tool's
    // own parameters schema — a bare-word forbid would fail the v0 mint description,
    // which must say "research how the category is bought".
    expect(retiredV0Offenders("research how the category is bought in that condition")).toEqual([]);
  });

  it("bites the BACKTICKED parameter form — how prose names a parameter", () => {
    expect(retiredV0Offenders("pass `category` to narrow the search")).toEqual(["`category`"]);
  });

  it.each(Object.entries(APPROVED))(
    "spares the card's approved %s description verbatim",
    (_name, description) => {
      expect(retiredV0Offenders(description)).toEqual([]);
    },
  );
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
    ["sil_doc_read's shipped line, verbatim", "An absent document answers not_found."],
    [
      "sil_doc_remove's shipped line, verbatim — `not_found` as proof a delete landed",
      "An already-gone document answers not_found, so a repeat call is safe.",
    ],
    [
      "the bundle's shipped line, verbatim",
      "An absent document is `not_found`; a present-but-corrupt one is `unreadable`.",
    ],
    [
      "the re-mint instruction spelled out",
      "If a Brief reads not_found, mint a fresh one with sil_doc_write (mode: create).",
    ],
    [
      "the delete believed to have landed",
      "A repeat sil_doc_remove answers not_found, which is proof the document is gone.",
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
