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

  it("8 — what sil verified is said as verified and the rest as what it is: `fit`'s \"unknown\", a page's own words, a bound in another currency", () => {
    // The honesty half of the always-on contract, and the one the scanners cannot hold:
    // `honestyExclusionOffenders` catches prose that teaches DROPPING an honesty state,
    // and is silent about prose that simply stops naming them — an agent that presents
    // an unread page as verified breaks nothing red.
    const units = splitStatements(skillSrc());

    // `fit` answers every requested key now, so the gap is a VALUE ("unknown"), not an
    // absent key: read as a failed spec it hides the product the buyer wanted.
    const gaps = units.filter((s) => /`fit`/.test(s) && /unknown/i.test(s));
    expect(gaps.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        gaps,
        (s) => /\bgap\b/i.test(s) && /never a product that failed|never a miss/i.test(s),
      ),
    ).toEqual([]);

    const page = units.filter((s) => /`printed`/.test(s));
    expect(page.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(page, (s) => /own words|labelled pairs/i.test(s) && /not verified/i.test(s)),
    ).toEqual([]);
    // The half an agent loses first: the ABSENCE of the pairs is the positive signal.
    expect(unsatisfied(page, (s) => /absence/i.test(s) && /read the page/i.test(s))).toEqual([]);

    const currency = units.filter((s) => /currency/i.test(s));
    expect(currency.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(currency, (s) => /could not test/i.test(s))).toEqual([]);
  });
});

/**
 * The always-on contract, scoped to SKILL.md ALONE. The founder's live session of
 * 2026-09-17 read `SKILL.md` and opened no reference file — so a rule that holds on every
 * shopping turn and lives only in `references/` is a rule the agent never sees. Each bar
 * below is one measured defect from that session, pinned inside the file the model reads.
 */
describe("the rules SKILL.md itself must carry, because a live session read nothing else", () => {
  it("9 — a spec traces to the buyer: `reason` QUOTES their words, and a want they never stated gets no spec", () => {
    // Measured: every `reason` was a first-person paraphrase ("My forefoot is wide;
    // prioritize a wide/high-volume last."), and `condition eq new` was written with the
    // reason "I want to buy a new ski boot." — a want the buyer never uttered.
    const units = splitStatements(skillSrc());

    const reason = units.filter((s) => /`reason`/.test(s));
    expect(reason.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(reason, (s) => /verbatim/i.test(s) && /never a paraphrase/i.test(s)),
    ).toEqual([]);

    // …and the other half: nothing said, no spec. An assumption is said OUT LOUD and
    // written only on the answer, which is the only route a spec has to a silent want.
    const assuming = units.filter((s) => /assum/i.test(s));
    expect(assuming.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(assuming, (s) => /\bask/i.test(s) && /their (?:answer|word)/i.test(s)),
    ).toEqual([]);
  });

  it("10 — an ambiguous phrase is asked about, never written to the profile as a lasting fact", () => {
    // Measured: "wide forefoot and bit short" became the profile entry `stature: "a bit
    // short"` and the narrative "I am a bit short". The buyer meant the foot. A lasting
    // fact written wrong follows them into every category the account ever opens.
    const units = splitStatements(skillSrc());
    const ambiguous = units.filter((s) => /ambiguous/i.test(s));
    expect(ambiguous.length).toBeGreaterThan(0); // guard-of-the-guard

    expect(
      unsatisfied(
        ambiguous,
        (s) => /\bask/i.test(s) && /narrative|own words/i.test(s) && /\bnever\b/i.test(s),
      ),
    ).toEqual([]);
    // The profile's own half: it holds ONLY the unambiguous. Separate, because a rule
    // about what to ask says nothing about what may be written when nobody asked.
    expect(unsatisfied(ambiguous, (s) => /profile/i.test(s) && /\bonly\b/i.test(s))).toEqual([]);
  });

  it("11 — a call carries the brief's specs UNCHANGED, and a want changes in the brief or not at all", () => {
    // Measured: the brief held `flex gte 110` and the next search sent `flex gte 100` —
    // no word from the buyer, no `shopping_brief_edit`, no decision. A bound relaxed on
    // the wire is a want the buyer still believes is being asked for.
    const units = splitStatements(skillSrc());

    const carrying = units.filter((s) => /unchanged/i.test(s));
    expect(carrying.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        carrying,
        (s) => /brief/i.test(s) && /looser|relax/i.test(s) && /\bnever\b/i.test(s),
      ),
    ).toEqual([]);

    // …and the route a change DOES take: their word, the write, then step 1 again.
    const changing = units.filter((s) => /shopping_brief_edit/.test(s) && /again/i.test(s));
    expect(changing.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(changing, (s) => /`decision`/.test(s) && /buyer/i.test(s))).toEqual([]);
  });

  it("12 — a `decision` is the buyer changing their mind, written about them, never a log and never a new want", () => {
    // Measured twice. 2026-09-16: `decision` was used as narration — "Added my measured
    // 27.2 cm length, 102 mm width, and 90 kg weight…". 2026-09-17: the seller spec
    // `country eq GR` was written with no `reason` at all while the buyer's own quote sat
    // in a `decision`, and every decision was phrased in the buyer's first person ("I
    // changed the maximum budget … so you can find …"). The next session then reads a
    // decision nobody took and a spec nobody asked for.
    const units = splitStatements(skillSrc());
    const decision = units.filter((s) => /`decision`/.test(s));
    expect(decision.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        decision,
        (s) => /mind/i.test(s) && /chang/i.test(s) && /never a log|not a log/i.test(s),
      ),
    ).toEqual([]);
    // Whose voice it is written in, and what it is NOT: a want the buyer has just stated
    // is that spec's `reason`, and nothing else.
    expect(unsatisfied(decision, (s) => /voice/i.test(s) && /\bnever\b|\bnot\b/i.test(s))).toEqual([]);
    expect(unsatisfied(decision, (s) => /`reason`/.test(s) && /new want/i.test(s))).toEqual([]);
  });

  it("13 — the pick is priced by shopping_offers BEFORE it is recommended", () => {
    // Measured: the recommended boot was presented with a price and a size range taken
    // off a page sil had not read, and `shopping_offers` was never called for it — no
    // dated price, no seller country, no `ships`. One turn earlier the agent did all of
    // this correctly, so the rule has to hold on every turn, not on a remembered one.
    const units = splitStatements(skillSrc());
    const recommending = units.filter((s) => /recommend/i.test(s));
    expect(recommending.length).toBeGreaterThan(0); // guard-of-the-guard

    expect(
      unsatisfied(recommending, (s) => /shopping_offers/.test(s) && /observed_at/.test(s)),
    ).toEqual([]);
    // …and whether that seller reaches the buyer, which is the other half of a price.
    expect(unsatisfied(recommending, (s) => /reach/i.test(s) && /seller/i.test(s))).toEqual([]);
  });

  it("14 — a variant with no option values is a listing whose sizes are unread: said, priced, and never read as stock", () => {
    // Measured twice. 2026-09-16: the pick came back with no listed size and a page
    // saying "sizes 24-31", and the agent told the buyer "sizes listed 24–31, including
    // your likely 27.5". 2026-09-17: the two Greek listings of the boot the buyer needed
    // were never priced at all — the agent read `variants: []` as "nothing to price",
    // passed product ids to `shopping_product_get`, and called `shopping_offers` zero
    // times in the whole session. Both readings die on the same sentence.
    const units = splitStatements(skillSrc());
    const listed = units.filter((s) => /`variants`/.test(s));
    expect(listed.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(listed, (s) => /\bsay\b/i.test(s) && /range/i.test(s) && /stock/i.test(s)),
    ).toEqual([]);
    expect(
      unsatisfied(listed, (s) => /shopping_offers/.test(s) && /unread|has not read/i.test(s)),
    ).toEqual([]);
  });

  it("15 — each variant carries its OWN price, so a price is quoted with the size it belongs to", () => {
    // Measured 2026-09-17: one price was quoted per product while the answer's sizes were
    // priced differently, and the sizes the price came from had been dropped from the
    // turn. `n` counts variants now, so the price the buyer acts on is a size's.
    const units = splitStatements(skillSrc());
    const priced = units.filter((s) => /`price`/.test(s));
    expect(priced.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(priced, (s) => /variant/i.test(s) && /size/i.test(s))).toEqual([]);
  });

  it("16 — a measurement is never the spec: the spec is the size the category is sold in", () => {
    // Measured 2026-09-17: searches 1 and 2 sent `foot_length eq 27.2`, a key no boot
    // listing carries, found no size, and cost the buyer a turn ("27.5 should be good").
    // The rule lived in `references/brief.md`, which that session never opened.
    const units = splitStatements(skillSrc());
    const measured = units.filter((s) => /measurement/i.test(s));
    expect(measured.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(measured, (s) => /\bnever the spec\b/i.test(s) || /\bnot the spec\b/i.test(s)),
    ).toEqual([]);
    // …and what the spec IS instead, so the rule is actionable rather than a prohibition.
    expect(
      unsatisfied(measured, (s) => /\bsold in\b|`reason`/.test(s) && /\bsize\b/i.test(s)),
    ).toEqual([]);
  });

  it("17 — `query` is shop words: a budget, a market, in stock and online are specs", () => {
    // Measured 2026-09-17: searches 3–5 read "… under 350 EUR Greece" and "… Greece
    // online under 400 EUR in stock", and the offers the index answered fell from 39 and
    // 40 to 3, 10 and 12. "Never a sentence" was already written; what a sentence IS was
    // not, and the model kept adding the specs it had just written to the brief.
    const units = splitStatements(skillSrc());
    const query = units.filter((s) => /`query`/.test(s));
    expect(query.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(query, (s) => /categor/i.test(s) && /number/i.test(s) && /never a sentence/i.test(s)),
    ).toEqual([]);
    expect(
      unsatisfied(query, (s) => /budget/i.test(s) && /market/i.test(s) && /\bspecs?\b/i.test(s)),
    ).toEqual([]);
  });

  it("18 — nothing fits: ask which spec to give up, write it, search again — sil never says what it left out", () => {
    // The answer carries what fits and nothing about what it left out (contract rule 6),
    // so no turn can tell the buyer what relaxing a bound would reach. An agent that does
    // not know this either invents the trade-off or widens the search silently — both
    // measured on 2026-09-17.
    const units = splitStatements(skillSrc());
    const leftOut = units.filter((s) => /left out/i.test(s));
    expect(leftOut.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(leftOut, (s) => /\bnever\b|\bnot\b/i.test(s) && /sil/.test(s))).toEqual([]);
    expect(
      unsatisfied(
        leftOut,
        (s) => /give up|giving it up/i.test(s) && /search(?:ing)? again/i.test(s),
      ),
    ).toEqual([]);
  });

  it("19 — everything the guide says decides the buy carries a spec BEFORE the first search, from the profile or from one question", () => {
    // Measured 2026-09-18: the guide says a ski boot is "bought on stiffness, forefoot width
    // and binding compatibility", and the agent searched four times and recommended a boot
    // on two specs — `advanced` and `new` — with no size, no width and no sole norm. It
    // asked for them in the turn AFTER the recommendation.
    const units = splitStatements(skillSrc());

    const deciding = units.filter((s) => /\bdecides?\b/i.test(s) && /\bguide\b/i.test(s));
    expect(deciding.length).toBeGreaterThan(0); // guard-of-the-guard
    // ONE statement carries the whole rule — what (the guide's own list), when (before the
    // first search) and where from (the profile, or ONE question with all of it in). Split
    // across two, the loop table's GATHER row satisfies the "when" by itself and the rule
    // can leave the contract unnoticed; measured, that mutant passed.
    expect(
      unsatisfied(
        deciding,
        (s) =>
          /first search/i.test(s)
          && /\bspec/i.test(s)
          && /\bone\b/i.test(s)
          && /question/i.test(s)
          && /profile/i.test(s),
      ),
    ).toEqual([]);
    // …and the recommendation that must not happen: a pick whose deciding keys are unread.
    const short = units.filter((s) => /shortlist/i.test(s));
    expect(short.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(short, (s) => /unknown/i.test(s) && /guess/i.test(s))).toEqual([]);
  });

  it("20 — FIND talks fit; `shopping_offers` prices the PICK the buyer is ready to buy, never a whole shortlist", () => {
    // Measured 2026-09-18: every shortlist was priced with the seller spec `country eq GR`
    // before the buyer had chosen anything, so each turn ended in Canadian, Swedish and UK
    // sellers reading `ships: unknown` and a line of "shipping to Greece unverified" — three
    // times over. The fit answer the buyer asked for arrived under the shipping caveats.
    const units = splitStatements(skillSrc());

    const offers = units.filter((s) => /shopping_offers/.test(s));
    expect(offers.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        offers,
        (s) =>
          /ready to price|ask about|\bpick\b/i.test(s)
          && /never for (?:every|a|the)|never the shortlist/i.test(s),
      ),
    ).toEqual([]);
    // The other half, and the one the draw lost first: before a pick there is no seller in
    // the turn at all. Keyed on the fit statement so a bare "price the pick" cannot satisfy
    // it — the defect was the shipping talk, not the offers call.
    const fitTurn = units.filter((s) => /\bfit\b/i.test(s) && /\bpick\b/i.test(s));
    expect(fitTurn.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(fitTurn, (s) => /no seller/i.test(s) && /shipping|market/i.test(s)),
    ).toEqual([]);

    // …and the step that owns PRICE opens on the same rule, for the agent that loads it.
    const priceStep = sectionStatements("PRICE").filter((s) => /shopping_offers/.test(s));
    expect(priceStep.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(priceStep, (s) => /\bpick\b/i.test(s) && /shortlist/i.test(s)),
    ).toEqual([]);
  });

  it("21 — a measurement is mapped by the RULE the guide states, never by the number as the buyer typed it", () => {
    // Measured 2026-09-18: a 102 mm forefoot was written `last_width gte 102` (a last two
    // millimetres narrower packs out and fits) and "Alpine binding" was written
    // `sole_norm eq alpine_iso5355` (GripWalk mounts on nearly every alpine binding sold
    // since 2018) — together they cut 25 of the 38 boots on the shelf. `skill_level eq
    // advanced` then threw out a boot built ABOVE the level the buyer claimed.
    const units = splitStatements(skillSrc());

    const mapping = units.filter((s) => /\bguide\b/i.test(s) && /\brule\b/i.test(s));
    expect(mapping.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(mapping, (s) => /as typed/i.test(s) && /\bnever\b/i.test(s)),
    ).toEqual([]);
    // The three readings the draw got wrong, written as rules rather than as a ban: a width
    // is a range, a level is a floor, a binding takes more than one norm.
    expect(
      unsatisfied(
        mapping,
        (s) => /2 mm|two millimet/i.test(s) && /floor/i.test(s) && /norm/i.test(s),
      ),
    ).toEqual([]);
    // …and the fallback, so the rule is not a licence to invent one: where the guide is
    // silent, the buyer decides what their number means.
    const silent = units.filter((s) => /states no rule|guide is silent/i.test(s));
    expect(silent.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(silent, (s) => /\bask\b/i.test(s))).toEqual([]);
  });

  it("22 — `query` carries no unit and no standard's name, with the stuffed query that came back with motorcycle boots", () => {
    // Measured 2026-09-18: `"men's alpine ski boots advanced 27.5 wide 102mm Alpine ISO
    // 5355"` answered with motorcycle boots. Bar 17 already holds "never a sentence"; what a
    // sentence is MADE of was not written, and the model kept appending the specs it had
    // just written to the brief.
    const units = splitStatements(skillSrc());
    const query = units.filter((s) => /`query`/.test(s));
    expect(query.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(query, (s) => /\ba unit\b/i.test(s) && /standard/i.test(s)),
    ).toEqual([]);
    // Both literals, so the rule is copyable rather than a category of words to infer.
    expect(skillSrc()).toContain("ski boots 27.5 flex 110");
    expect(skillSrc()).toMatch(/motorcycle/i);
  });

  it("23 — `gender` is read off sil_whoami and sent on anything worn, asked once when the profile holds none, never inferred", () => {
    // Measured 2026-09-18: *"Of course I am a male. Don't you know that?"* — five searches
    // had gone out with men's and women's boots mixed, and the agent had neither read a
    // gender nor asked for one.
    const units = splitStatements(skillSrc());
    const gender = units.filter((s) => /\bgender\b/i.test(s));
    expect(gender.length).toBeGreaterThan(0); // guard-of-the-guard
    // The mapping is pinned by VALUE on both sides: `sil_whoami` answers the person
    // (`male`), the registry's product-root spec takes the cut (`mens`), and a bundle that
    // writes `gender eq men` sends a value the mint refuses.
    expect(
      unsatisfied(
        gender,
        (s) =>
          /sil_whoami/.test(s)
          && /worn/i.test(s)
          && /\bspec\b/i.test(s)
          && /`male` writes `gender eq mens`/.test(s)
          && /`gender eq womens`/.test(s),
      ),
    ).toEqual([]);
    expect(
      unsatisfied(
        gender,
        (s) => /one question/i.test(s) && /never an inference|never inferred/i.test(s),
      ),
    ).toEqual([]);
  });

  it("24 — a new chat READS the earlier briefs and opens its own, carrying what is still true under a `decision` that names the carry", () => {
    // Measured 2026-09-18 (the warm session): the chat searched on the previous session's
    // brief. The buyer was asked nothing, which is right, but the record now says one brief
    // ran two conversations — and no later reader can tell which chat asked for what.
    const body = sectionBody("OPEN");
    expect(skillSrc()).toContain(body); // the rule is in the always-loaded file
    const units = splitStatements(body);

    const opening = units.filter((s) => /shopping_brief_create/.test(s));
    expect(opening.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(opening, (s) => /carry|carrying/i.test(s) && /still true/i.test(s)),
    ).toEqual([]);
    expect(
      unsatisfied(opening, (s) => /`decision`/.test(s) && /which brief/i.test(s)),
    ).toEqual([]);

    // …and the half that stops the warm session repeating: an earlier brief is a READ.
    const past = units.filter((s) => /past brief/i.test(s));
    expect(past.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(past, (s) => /never searched/i.test(s))).toEqual([]);
  });
});
