/**
 * INTEGRATION — the `sil-shopping` bundle drives the loop of the agent contract §2:
 * OPEN, GATHER, then find → price → decide, with the brief and the profile held in
 * sil under the buyer's account. Reads the real files.
 *
 * ONE BAR PER BEHAVIOUR, and every behaviour is a defect the founder's session of
 * 2026-09-16 measured or a scenario his hand test runs. The title names the failure.
 *
 * WHY THESE ARE STRUCTURAL, NOT PROSE PINS. This repo deleted a 1341-line
 * skill-content test that pinned nearly every clause and stayed GREEN straight
 * through a live behavioural bug. Every bar here asserts WHERE a decision lives —
 * inside the section that owns it — and never what wording carries it. The scope is
 * what does the work; the regexes inside it are deliberately loose alternations.
 *
 * THE ONE FORMAT CONTRACT (`helpers/skill-bundle.ts#loopSections`): each section is
 * opened by a markdown heading naming it in upper case. A missing section makes
 * `sectionBody()` THROW rather than return an empty scope — an empty scope would make
 * every `unsatisfied()` bar pass vacuously, which is worse than a red.
 *
 * The registry half of GATHER (read before mint, inheritance, the naming discipline)
 * is held by `skill-bundle-contract.integration.test.ts`; a second copy would be
 * duplicate coverage, not safety.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken one to match the prose.
 */

import { describe, it, expect } from "vitest";

import {
  sectionBody,
  sectionStatements,
  splitStatements,
  skillSrc,
  unsatisfied,
} from "./helpers/skill-bundle.js";

describe("the loop the bundle drives", () => {
  it("1 — OPEN reads the profile and the briefs first, so a second session cannot re-ask a size sil already holds", () => {
    // 2026-09-16: the next morning's session re-asked the Mondopoint size that was on
    // file. The two reads have to be the chat's FIRST move and named in SKILL.md, which
    // is the only file loaded before the agent starts answering.
    const body = sectionBody("OPEN");
    expect(skillSrc()).toContain(body); // the OPEN section is in the always-loaded file
    expect(body).toContain("sil_whoami");
    expect(body).toContain("shopping_brief_read");

    const units = splitStatements(body);
    const asking = units.filter((s) => /\bask/i.test(s));
    expect(asking.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        asking,
        (s) =>
          /\bnever\b|\bnot\b|\bno\b/i.test(s)
          && /profile|brief/i.test(s)
          && /\bsize\b|already|on file/i.test(s),
      ),
    ).toEqual([]);

    // …and nothing is set up first: an unregistered outcome ROUTES, it is not offered.
    const register = units.filter((s) => /sil_register/.test(s));
    expect(register.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(register, (s) => /unregistered/i.test(s) && /routes?/i.test(s)),
    ).toEqual([]);
  });

  it("2 — every want becomes a spec and every lasting fact a profile entry BEFORE the next search, or a session searches on what it never wrote", () => {
    // 2026-09-16: the brief was written three times in the first 30 seconds and never
    // again — a foot length, a width, a shoe size, "Greece only", a budget and "not
    // used" reached no brief and no profile, and six searches ran without them.
    const units = sectionStatements("GATHER");

    // The satisfying statement has to be about WRITING the want down, not about the
    // registry read that also happens before the search — measured: the domain read's
    // own sentence satisfied a looser rule here and the mutant passed.
    const before = units.filter((s) => /before/i.test(s) && /search/i.test(s));
    expect(before.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(before, (s) => /\bspec/i.test(s) && /\bwrit|brief|profile/i.test(s)),
    ).toEqual([]);

    const profile = units.filter((s) => /shopping_profile_edit/.test(s));
    expect(profile.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(profile, (s) => /measurement|lasting|whatever they are buying/i.test(s)),
    ).toEqual([]);

    // A measurement is the buyer's and the spec it becomes is the brief's — the guide
    // is what converts one into the other, and both are written.
    const converting = units.filter((s) => /measurement/i.test(s) && /\bspec/i.test(s));
    expect(converting.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(converting, (s) => /guide|reason/i.test(s))).toEqual([]);

    // The narrative is rewritten whole, and a want no spec can carry is SAID, not lost.
    const narrative = units.filter((s) => /narrative/i.test(s));
    expect(narrative.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(narrative, (s) => /\bwhole\b/i.test(s))).toEqual([]);
    expect(
      unsatisfied(
        units.filter((s) => /no spec can carry|nothing a spec|no key carries/i.test(s)),
        (s) => /narrative/i.test(s) && /say so|tell|out loud/i.test(s),
      ),
    ).toEqual([]);
  });

  it("3 — a market is a SELLER spec on the offers, and `ship_to` is an address label — the `ship_to: \"Home\"` six searches sent as a Greece filter", () => {
    // 2026-09-16: the model could not find a market filter, so it sent `ship_to: "Home"`
    // on all six searches and reported it as "Greece only". `ship_to` localizes and
    // excludes no seller; the want is the seller spec `country`, on the offers.
    const units = sectionStatements("GATHER");

    const sellerSpecs = units.filter((s) => /seller spec|domain: "seller"/i.test(s));
    expect(sellerSpecs.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        sellerSpecs,
        (s) => /shopping_offers|offers\b/i.test(s) && /\bnever\b|\bnot\b/i.test(s) && /search/i.test(s),
      ),
    ).toEqual([]);

    const shipTo = units.filter((s) => /ship_to/.test(s));
    expect(shipTo.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(shipTo, (s) => /\blabel\b/i.test(s) && /address/i.test(s))).toEqual([]);
    // The denial must attach to the MARKET reading. Keyed near the word because
    // "excludes no seller" alone reads as satisfied by a sentence that has just called
    // `ship_to` the market filter — measured, the mutant passed.
    expect(
      unsatisfied(shipTo, (s) => /\b(?:never|not)\b[^.]{0,30}\bmarket\b/i.test(s)),
    ).toEqual([]);

    // …and the other side of the line: "not used" is a PRODUCT spec, on the category.
    const product = units.filter((s) => /condition/i.test(s));
    expect(product.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(product, (s) => /product spec/i.test(s))).toEqual([]);
  });

  it("4 — the search carries the brief's id and ALL its product specs as shopping words, under a per-CATEGORY bound", () => {
    // Two failures in one call. A spec left out of the call is a want the buyer stated
    // and sil never saw; and both live draws compiled a sentence into `query` — the
    // index answers ZERO priced offers for "ski boots size 27.5 advanced skier up to
    // 300 euros" and forty for "ski boots 27.5 flex 110".
    const units = sectionStatements("FIND");

    const call = units.filter((s) => /shopping_search/.test(s));
    expect(call.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(call, (s) => /`brief`|brief'?s? id/i.test(s))).toEqual([]);
    expect(
      unsatisfied(call, (s) => /\ball\b|\bevery\b/i.test(s) && /\bspecs?\b/i.test(s)),
    ).toEqual([]);

    const query = units.filter((s) => /`query`/.test(s));
    expect(query.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        query,
        (s) => /categor/i.test(s) && /number/i.test(s) && /never a sentence/i.test(s),
      ),
    ).toEqual([]);

    const bound = units.filter(
      (s) => /(≤\s*4|\b4\b|\bfour\b)/.test(s) && /shopping_search|\bsearch/i.test(s),
    );
    expect(bound.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(bound, (s) => /per categor|each categor/i.test(s))).toEqual([]);
    // …and NO statement in the step re-scopes it. Scanned over the whole section, not
    // just the statements naming the number: the sentence that spends one category's
    // budget on another names neither `4` nor the search — measured, it slipped through.
    // "per job" is an offender only where the same statement does not also say per
    // category, since the correct prose disavows the wrong reading by name.
    expect(units.filter((s) => /per job/i.test(s) && !/per categor/i.test(s))).toEqual([]);
  });

  it("5 — the offers carry the brief's seller specs, and an ABSENT `seller_fit` key is a term sil has not read — never a seller that failed it", () => {
    // The lie that looks like a filter. A key absent from `seller_fit` means sil has not
    // read that term; reported as a failure it hides the only seller that might ship,
    // and nothing downstream can detect it.
    const units = sectionStatements("PRICE");

    const call = units.filter((s) => /shopping_offers/.test(s));
    expect(call.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(call, (s) => /`brief`/.test(s) && /seller_specs|seller spec/i.test(s)),
    ).toEqual([]);

    const fit = units.filter((s) => /seller_fit/.test(s));
    expect(fit.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(fit, (s) => /absent/i.test(s) && /has not read|not read/i.test(s)),
    ).toEqual([]);

    const country = units.filter((s) => /`country`/.test(s));
    expect(country.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(country, (s) => /\bnever\b|\bnot\b/i.test(s) && /claim/i.test(s))).toEqual([]);

    const ships = units.filter((s) => /ships: unknown/i.test(s));
    expect(ships.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(ships, (s) => /keeps?\b/i.test(s))).toEqual([]);

    expect(sectionBody("PRICE")).toContain("shopping_seller_get");
  });

  it("6 — DECIDE proposes ONE relaxation and WAITS, then writes the buyer's word as a spec AND a decision", () => {
    // Draw 1: asked to use its best reading, the agent raised the €300 ceiling to €400
    // by itself and searched on. A change the buyer did not choose is not a change; a
    // change they did choose is a brief edit with the sentence that says why, or the
    // next session inherits a number with no reason behind it.
    const units = sectionStatements("DECIDE");

    const proposing = units.filter((s) => /relaxation|widening|change/i.test(s));
    expect(proposing.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(proposing, (s) => /\bone\b/i.test(s) && /\bwait/i.test(s)),
    ).toEqual([]);
    expect(
      unsatisfied(proposing, (s) => /not a yes|stands as written|never a relaxation/i.test(s)),
    ).toEqual([]);

    const writing = units.filter((s) => /shopping_brief_edit/.test(s));
    expect(writing.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(writing, (s) => /`decision`/.test(s) && /`remove`|spec/i.test(s))).toEqual([]);

    // …and the loop closes: the edit is followed by step 1 again, never by a widening
    // sent on the wire alone.
    expect(
      unsatisfied(writing, (s) => /step 1|again/i.test(s)),
    ).toEqual([]);
  });

  it("7 — an `invalid_request` on a brief write is fixed from the spec it shows and resent, never dropped", () => {
    // The refusal is the one moment a want silently disappears: sil names the key and
    // hands back a spec on it that passes, and the cheapest wrong move is to carry on
    // without the row rather than fix it.
    const units = sectionStatements("GATHER").filter((s) => /invalid_request/.test(s));
    expect(units.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(units, (s) => /\bkey\b/i.test(s) && /passes?|would pass/i.test(s))).toEqual([]);

    const resend = sectionStatements("GATHER").filter((s) =>
      /resend|re-?issue|send it again/i.test(s),
    );
    expect(resend.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(resend, (s) => /never drop|not drop|never dropped/i.test(s))).toEqual([]);
  });

  it("8 — what sil verified is said as verified and the rest as what it is: a `fit` gap, a page's own words, a bound in another currency", () => {
    // The honesty half of the always-on contract, and the one the scanners cannot hold:
    // `honestyExclusionOffenders` catches prose that teaches DROPPING an honesty state,
    // and is silent about prose that simply stops naming them — an agent that presents
    // an unread page as verified breaks nothing red.
    const units = splitStatements(skillSrc());

    const gaps = units.filter((s) => /\bfit\b/.test(s) && /absent/i.test(s));
    expect(gaps.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(gaps, (s) => /\bgap\b/i.test(s) && /never a miss|not a miss/i.test(s))).toEqual([]);

    const page = units.filter((s) => /webpage_info/.test(s));
    expect(page.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(page, (s) => /own words/i.test(s) && /never presented as verified|not verified/i.test(s)),
    ).toEqual([]);
    // The half an agent loses first: the ABSENCE of the block is the positive signal.
    expect(unsatisfied(page, (s) => /absence/i.test(s) && /verified/i.test(s))).toEqual([]);

    const currency = units.filter((s) => /currency/i.test(s));
    expect(currency.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(currency, (s) => /could not test/i.test(s))).toEqual([]);
  });
});
