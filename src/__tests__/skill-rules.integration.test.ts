/**
 * INTEGRATION — the rules the `sil-shopping` bundle carries. Reads the real files.
 *
 * NOT A LOOP. The founder's ruling of 2026-09-19 retired the numbered sequence: the
 * agent drives the tools in whatever order the conversation needs, so nothing here
 * asserts an order, a beat, or a precondition on a call. What survives is what the
 * bundle must SAY, and the section it must say it in.
 *
 * ONE BAR PER BEHAVIOUR, and every behaviour is a defect a founder session measured or
 * a scenario his hand test runs. The title names the failure.
 *
 * WHY THESE ARE STRUCTURAL, NOT PROSE PINS. This repo deleted a 1341-line
 * skill-content test that pinned nearly every clause and stayed GREEN straight through
 * a live behavioural bug. Every bar here asserts WHERE a decision lives — inside the
 * section that owns it — and never what wording carries it. The scope is what does the
 * work; the regexes inside it are deliberately loose alternations.
 *
 * THE ONE FORMAT CONTRACT (`helpers/skill-bundle.ts#section`): each scope is opened by
 * the heading named in `SKILL_SECTIONS`. A missing heading makes the helper THROW rather
 * than return an empty scope — an empty scope would make every `unsatisfied()` bar pass
 * vacuously, which is worse than a red.
 *
 * The registry half (read before mint, inheritance, the naming discipline) is held by
 * `skill-bundle-contract.integration.test.ts` against `references/mint.md`; a second copy
 * would be duplicate coverage, not safety. So is anything a TOOL DESCRIPTION is the one
 * carrier of — the `DISCIPLINE` table in `tools/tool-schema-contract.unit.test.ts` — and
 * each bar below names where its other half lives rather than repeating it.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken one to match the prose.
 */

import { describe, it, expect } from "vitest";

import {
  MINT,
  mintStatements,
  preambleStatements,
  section,
  skillSection,
  skillSectionStatements,
  skillSrc,
  splitStatements,
  unsatisfied,
} from "./helpers/skill-bundle.js";

/**
 * What sil SHIPS. The ruling's first consequence: the domain document is sil's, handed
 * over by `shopping_domain_get`, and minting is the fallback for a domain it does not
 * hold. An agent that reads the mint as the normal path writes a permanent global row
 * for a domain that already stands.
 */
describe("sil ships the domain document, and the mint is the fallback", () => {
  it("1 — SKILL.md's opening names the document as SIL's knowledge, read before the buyer is asked anything", () => {
    // Scoped to the preamble, above the first `##`: this is the frame the agent reads
    // the rest of the file under. Slid down into a tip, it is a claim the agent meets
    // after it has already decided how to work.
    const units = preambleStatements();

    const doc = units.filter((s) => /domain document/i.test(s));
    expect(doc.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(doc, (s) => /sil'?s own/i.test(s) && /bought well|how this thing is bought/i.test(s)),
    ).toEqual([]);

    // What the read hands back, and the ONE thing that makes a key's question worth
    // asking: the `description` says how that key moves the fit.
    const handed = units.filter((s) => /shopping_domain_get/.test(s));
    expect(handed.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(handed, (s) => /markdown/i.test(s) && /guide/i.test(s) && /\bkeys\b/i.test(s)),
    ).toEqual([]);
    expect(
      unsatisfied(handed, (s) => /`description`/.test(s) && /moves the fit/i.test(s)),
    ).toEqual([]);

    const before = units.filter((s) => /before you ask/i.test(s));
    expect(before.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(before, (s) => /decides the buy/i.test(s))).toEqual([]);
  });

  it("2 — `references/mint.md` opens by saying sil ships the document, so the mint reads as the FALLBACK it is", () => {
    // The file an agent opens only when a domain is missing has to disown itself in its
    // first paragraph, or an agent that opened it for one cold domain carries the mint
    // into the next warm one — and the registry write is the one thing nothing undoes.
    const units = mintStatements();

    const ships = units.filter((s) => /sil ships/i.test(s));
    expect(ships.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(ships, (s) => /domain document/i.test(s) && /markdown/i.test(s) && /guide/i.test(s)),
    ).toEqual([]);

    const normal = units.filter((s) => /normal path/i.test(s));
    expect(normal.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(normal, (s) => /shopping_domain_get/.test(s))).toEqual([]);

    expect(units.filter((s) => /fallback/i.test(s)).length).toBeGreaterThan(0);
    // …and the always-loaded router says it too, for the agent that never opens the file.
    expect(skillSection("tools")).toMatch(/fallback/i);
  });

  it("3 — the guide a mint writes is markdown that says what goes wrong, what to trust, and what buying it online takes", () => {
    // The shape of the document sil itself ships, stated where an agent has to reproduce
    // it. "What goes wrong" is the load-bearing one: it is what lets a later agent say
    // why a question is worth answering, and the first thing a rushed mint drops.
    const doc = section(MINT, "What the document has to say");
    const units = splitStatements(doc);

    expect(doc).toMatch(/markdown/i);
    const missing = (
      [
        ["what it is bought on", /bought on/i],
        ["what goes wrong", /goes wrong/i],
        ["what to trust", /to trust/i],
        ["what buying it online takes", /buying it online/i],
      ] as const
    ).filter(([, re]) => !re.test(doc));
    expect(missing.map(([name]) => name)).toEqual([]);

    // Not a label — what the mistake COSTS, in the buyer's own terms.
    const wrong = units.filter((s) => /goes wrong/i.test(s));
    expect(wrong.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(wrong, (s) => /costs the buyer/i.test(s))).toEqual([]);

    // The one answer the document may never give, said in the document's own section.
    const shop = units.filter((s) => /go to a shop/i.test(s));
    expect(shop.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(shop, (s) => /\bnever\b/i.test(s) && /came here/i.test(s))).toEqual([]);
  });

  it("4 — the brief is the scratchpad AND the spec of the buy: the narrative says what a good buy looks like for THIS buyer", () => {
    // The ruling's second consequence. Read as a scratchpad alone, the narrative collects
    // notes nothing is judged against, and every pick is argued from the spec rows —
    // which is how a want no key can carry ("quiet", "for my daughter") disappears.
    const units = preambleStatements();

    const narrative = units.filter((s) => /narrative/i.test(s));
    expect(narrative.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(narrative, (s) => /spec of th(?:is|e) buy/i.test(s) && /good buy looks like/i.test(s)),
    ).toEqual([]);
    expect(unsatisfied(narrative, (s) => /scratchpad/i.test(s))).toEqual([]);

    const one = units.filter((s) => /one per/i.test(s));
    expect(one.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(one, (s) => /conversation|session/i.test(s))).toEqual([]);

    // …and the brief is what a pick is judged against, not a place wants are filed.
    const judging = units.filter((s) => /judge/i.test(s));
    expect(judging.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(judging, (s) => /every pick/i.test(s))).toEqual([]);
  });
});

/**
 * What a chat opens with. Scoped to SKILL.md's `## Start by reading`, which is the one
 * file a live session is known to read: the founder's session of 2026-09-17 read
 * `SKILL.md` and opened no reference file.
 */
describe("what a chat opens with", () => {
  it("5 — the profile and the briefs are READ first, so a second session cannot re-ask a size sil already holds", () => {
    // 2026-09-16: the next morning's session re-asked the Mondopoint size that was on
    // file. The two reads have to be the chat's first move and named in SKILL.md, which
    // is the only file loaded before the agent starts answering.
    const body = skillSection("reading");
    expect(skillSrc()).toContain(body); // the section is in the always-loaded file
    expect(body).toContain("sil_whoami");
    expect(body).toContain("shopping_brief_read");

    const units = splitStatements(body);
    const asking = units.filter((s) => /\bask/i.test(s));
    expect(asking.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(asking, (s) => /\bnever\b/i.test(s) && /already|on file/i.test(s)),
    ).toEqual([]);

    // …and nothing is set up first: an unregistered outcome ROUTES, it is not offered.
    const register = units.filter((s) => /sil_register/.test(s));
    expect(register.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(register, (s) => /unregistered/i.test(s) && /routes?/i.test(s)),
    ).toEqual([]);
  });

  it("6 — a new chat opens its OWN brief, carrying what is still true under a `decision` that names the carry", () => {
    // Measured 2026-09-18 (the warm session): the chat searched on the previous session's
    // brief. The buyer was asked nothing, which is right, but the record then says one
    // brief ran two conversations — and no later reader can tell which chat asked for what.
    const units = skillSectionStatements("reading");

    // Naming the tool is one rule; WHAT the new brief carries over is another, and both say
    // `shopping_brief_create`. Filtering on the tool made the carry bar demand "still true"
    // from the statement that only says WHEN to open one.
    expect(units.filter((s) => /shopping_brief_create/.test(s)).length).toBeGreaterThan(0);

    // TWO independent requirements, not one `unsatisfied` over everything saying "carry":
    // the rule is a single sentence holding both halves, so an OR predicate over it stays
    // green when either half is deleted, and the section's illustration ("that carry, not a
    // second interview") carries neither. Each half is asserted — and bites — on its own.
    expect(
      units.filter((s) => /\bcarry(ing)?\b/i.test(s) && /still true/i.test(s)).length,
    ).toBeGreaterThan(0);
    expect(
      units.filter((s) => /`decision`/.test(s) && /what you carried|which brief/i.test(s)).length,
    ).toBeGreaterThan(0);

    // …and the half that stops the warm session repeating: an earlier brief is a READ.
    const past = units.filter((s) => /past brief/i.test(s));
    expect(past.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(past, (s) => /never reused|never searched/i.test(s))).toEqual([]);
  });

  it("7 — a non-`ok` status is followed, never improvised around, and never settled by loosening the brief", () => {
    // The refusal is the one moment a want silently disappears: the cheapest wrong move
    // is to drop the row that was refused and carry on. What the fix IS — sil names the
    // key and hands back a spec on it that passes — is pinned on `shopping_brief_edit`'s
    // own description (`DISCIPLINE`, `tools/tool-schema-contract.unit.test.ts`), which is
    // the text an agent reads at the moment it holds the refusal.
    const units = skillSectionStatements("tools");
    const status = units.filter((s) => /`recovery`|`status`/.test(s));
    expect(status.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        status,
        (s) => /never improvise/i.test(s) && /never loosen/i.test(s) && /brief/i.test(s),
      ),
    ).toEqual([]);
  });
});

/**
 * How a spec is made — SKILL.md's `## Using sil well`. Every bar is one measured live
 * defect, pinned inside the section that owns the rule rather than anywhere in the file:
 * a rule that drifts into the routing table keeps satisfying a file-wide bar while the
 * agent stops reading it as a rule.
 */
describe("how a spec is made", () => {
  it("8 — the domain document is read BEFORE the first search, and sil never says what it left out", () => {
    // Measured 2026-09-18: the guide says a ski boot is bought on stiffness, forefoot
    // width and binding compatibility, and the agent searched four times and recommended
    // a boot on two specs. A TIP, not a gate — the ruling retired the precondition — so
    // what is pinned is the reason it matters: the answer carries what fits and nothing
    // about what it left out, so no later turn can discover the miss.
    const units = skillSectionStatements("using");

    const first = units.filter((s) => /first search/i.test(s));
    expect(first.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(first, (s) => /domain document|guide/i.test(s) && /\bread\b/i.test(s)),
    ).toEqual([]);

    const leftOut = units.filter((s) => /left out/i.test(s));
    expect(leftOut.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(leftOut, (s) => /\bnever\b|\bnot\b/i.test(s) && /\bsil\b/.test(s))).toEqual([]);

    // What replaced the precondition: one question, and the `description` is what makes
    // it worth answering — "why do you need to know that" has an answer on file.
    // `in one question` and not `one question`: the gender rule ends "None on file IS one
    // question", a different rule, and a filter that swept it in would demand the asking
    // rule's wording from a statement about inferring gender from a name.
    const asking = units.filter((s) => /\bin one question\b/i.test(s));
    expect(asking.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(asking, (s) => /`description`/.test(s) && /goes wrong/i.test(s)),
    ).toEqual([]);
  });

  it("9 — a spec traces to the buyer: `reason` QUOTES their words, and a want they never stated gets no spec", () => {
    // Measured: every `reason` was a first-person paraphrase ("My forefoot is wide;
    // prioritize a wide/high-volume last."), and `condition eq new` was written with the
    // reason "I want to buy a new ski boot." — a want the buyer never uttered.
    const units = skillSectionStatements("using");

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

  it("10 — a measurement is never the spec: the key's `description` converts it, and the number as typed is not the value", () => {
    // Two measured defects on one bullet. 2026-09-17: searches 1 and 2 sent
    // `foot_length eq 27.2`, a key no boot listing carries, found no size and cost the
    // buyer a turn. 2026-09-18: a 102 mm forefoot became `last_width gte 102` (a last two
    // millimetres narrower packs out and fits) and "Alpine binding" became `sole_norm eq
    // alpine_iso5355` (GripWalk mounts on nearly every alpine binding sold since 2018) —
    // together they cut 25 of the 38 boots on the shelf.
    const units = skillSectionStatements("using");

    const measured = units.filter((s) => /measurement/i.test(s));
    expect(measured.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        measured,
        (s) =>
          /\bnot a spec\b|\bnot the spec\b|\bnever the spec\b/i.test(s)
          && /\bsold in\b/i.test(s)
          && /\bsize\b/i.test(s),
      ),
    ).toEqual([]);

    // WHAT converts it — the key's own `description`, not the agent's judgement. This bar
    // used to require the three ski readings verbatim, which pinned one domain's knowledge
    // into a skill that must serve every domain; the conversion rules now live in the
    // document sil ships, and what the skill owes is that the agent READS them there.
    const converting = units.filter((s) => /`description`/.test(s) && /turn|becomes|convert/i.test(s));
    expect(converting.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(converting, (s) => /\bdomain\b/i.test(s) && /differ|every domain|per domain/i.test(s)),
    ).toEqual([]);

    const typed = units.filter((s) => /as typed/i.test(s));
    expect(typed.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(typed, (s) => /\bnot\b|\bnever\b/i.test(s) && /number/i.test(s))).toEqual([]);
  });

  it("11 — `gender` is read off sil_whoami and rides on anything worn, asked once when the profile holds none, never inferred", () => {
    // Measured 2026-09-18: *"Of course I am a male. Don't you know that?"* — five searches
    // had gone out with men's and women's boots mixed, and the agent had neither read a
    // gender nor asked for one. The registry's own SPELLING (`male` → `gender eq mens`) is
    // pinned by VALUE on `shopping_brief_create`'s description and on `sil_whoami`'s
    // verbatim contract, so it is deliberately not repeated here.
    const units = skillSectionStatements("using");

    const gender = units.filter((s) => /\bgender\b/i.test(s));
    expect(gender.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        gender,
        (s) =>
          /sil_whoami/.test(s)
          && /worn/i.test(s)
          && /\bspec\b/i.test(s)
          && /never guessed|never inferred/i.test(s),
      ),
    ).toEqual([]);

    const inferring = units.filter((s) => /infer/i.test(s));
    expect(inferring.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(inferring, (s) => /one question/i.test(s) && /\bnever\b/i.test(s)),
    ).toEqual([]);
  });

  it("12 — `query` is shop words: a sentence costs the offers, and a budget, a market, a unit and a standard's name are specs", () => {
    // Measured 2026-09-17 and -18: searches read "… under 350 EUR Greece" and "… Greece
    // online under 400 EUR in stock" and the offers the index answered fell from 39 and 40
    // to 3, 10 and 12; `"men's alpine ski boots advanced 27.5 wide 102mm Alpine ISO 5355"`
    // came back with motorcycle boots. "Never a sentence" was already written; what a
    // sentence is MADE of was not, and the model kept appending the specs it had just
    // written to the brief.
    const units = skillSectionStatements("using");

    const query = units.filter((s) => /`query`/.test(s));
    expect(query.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        query,
        (s) => /shop words/i.test(s) && /as a shop lists it/i.test(s) && /number/i.test(s),
      ),
    ).toEqual([]);

    const sentence = units.filter((s) => /\bsentence\b/i.test(s));
    expect(sentence.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(sentence, (s) => /costs?\b/i.test(s) && /offers?/i.test(s))).toEqual([]);

    const notQuery = units.filter((s) => /\bbudget\b/i.test(s) && /\bmarket\b/i.test(s));
    expect(notQuery.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        notQuery,
        (s) => /\ba unit\b/i.test(s) && /standard/i.test(s) && /\bspecs?\b/i.test(s),
      ),
    ).toEqual([]);

    // Both literals, so the rule is copyable rather than a category of words to infer.
    const body = skillSection("using");
    expect(body).toContain("ski boots 27.5 flex 110");
    expect(body).toMatch(/motorcycle/i);
  });

  it("13 — a want changes in the brief or not at all: a bound is never loosened silently on the wire", () => {
    // Measured: the brief held `flex gte 110` and the next search sent `flex gte 100` — no
    // word from the buyer, no `shopping_brief_edit`, no decision. A bound relaxed on the
    // wire is a want the buyer still believes is being asked for. That the CALL carries the
    // brief's specs UNCHANGED is pinned on `shopping_search` and `shopping_offers`'
    // descriptions (`DISCIPLINE`), which is where the agent builds the arguments.
    const units = skillSectionStatements("using");

    const loosening = units.filter((s) => /loosen|looser|relax/i.test(s));
    expect(loosening.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(loosening, (s) => /\bnever\b/i.test(s) && /\bspec\b/i.test(s))).toEqual([]);
    // …and the route a change DOES take: their word, the brief, a `decision`.
    expect(
      unsatisfied(loosening, (s) => /brief/i.test(s) && /`decision`/.test(s) && /buyer/i.test(s)),
    ).toEqual([]);
  });

  it("14 — the brief is written AS the wants are settled, because a want it does not hold is one the next call drops", () => {
    // 2026-09-16: the brief was written three times in the first 30 seconds and never
    // again — a foot length, a width, a shoe size, "Greece only", a budget and "not used"
    // reached no brief and no profile, and six searches ran without them.
    const units = skillSectionStatements("using");

    const writing = units.filter((s) => /as you go|not at the end/i.test(s));
    expect(writing.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(writing, (s) => /brief/i.test(s))).toEqual([]);
    expect(
      unsatisfied(writing, (s) => /\bwant\b/i.test(s) && /next call/i.test(s) && /drops?\b/i.test(s)),
    ).toEqual([]);
  });

  it("15 — an ambiguous phrase is asked about or stays in the buyer's own words, never guessed into a lasting fact", () => {
    // Measured: "wide forefoot and bit short" became the profile entry `stature: "a bit
    // short"` and the narrative "I am a bit short". The buyer meant the foot. That the
    // PROFILE holds only the unambiguous is pinned on `shopping_profile_edit`'s own
    // description (`DISCIPLINE`); what this bar holds is the route out of the ambiguity
    // and the cost of getting it wrong, in the file a live session actually read.
    const units = skillSectionStatements("using");

    const ambiguous = units.filter((s) => /ambiguous/i.test(s));
    expect(ambiguous.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(ambiguous, (s) => /\bask/i.test(s) && /narrative/i.test(s) && /own words/i.test(s)),
    ).toEqual([]);

    const lasting = units.filter((s) => /\bprofile\b/i.test(s) && /wrong/i.test(s));
    expect(lasting.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(lasting, (s) => /forever|follows/i.test(s))).toEqual([]);
  });

  it("16 — every pick comes out of a sil tool: a product the open web supplied never enters the shortlist", () => {
    // Zero results is an answer, and the expensive wrong move is to answer it from the
    // web — the buyer then acts on a price, a size and a seller sil never read, with no
    // `observed_at` behind any of it. Statement-scoped, because a file-wide "open web"
    // match is satisfied by prose that merely mentions the web.
    const sourced = skillSectionStatements("using").filter((s) => /open[ -]web/i.test(s));
    expect(sourced.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        sourced,
        (s) =>
          /\bnever\b/i.test(s)
          && /shortlist|\bpick\b/i.test(s)
          && /did not come back|from sil/i.test(s),
      ),
    ).toEqual([]);
  });
});

/**
 * What sil verified, what a page claims, and what nobody read — SKILL.md's
 * `## Don't take a seller's word`. The honesty half of the surface, and the one the
 * scanners cannot hold: `honestyExclusionOffenders` catches prose that teaches DROPPING
 * an honesty state and is silent about prose that simply stops naming them, so an agent
 * that presents an unread page as verified breaks nothing red.
 */
describe("what sil verified, what a page claims, and what nobody read", () => {
  it("17 — `printed` is the shop talking, its ABSENCE is sil's own read, and `fit`'s \"unknown\" is a gap, never a product that failed", () => {
    // Read as a failed spec, "unknown" hides the product the buyer wanted; read as a
    // reading, `printed` turns the shop's marketing into something sil is vouching for.
    // The absence half is the one an agent loses first — it is the POSITIVE signal.
    const units = skillSectionStatements("seller");

    const page = units.filter((s) => /`printed`/.test(s));
    expect(page.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(page, (s) => /\bclaim\b/i.test(s) && /the shop|page/i.test(s))).toEqual([]);

    const absence = units.filter((s) => /absence/i.test(s));
    expect(absence.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(absence, (s) => /read the page/i.test(s))).toEqual([]);

    const gaps = units.filter((s) => /`fit`/.test(s));
    expect(gaps.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        gaps,
        (s) =>
          /unknown/i.test(s)
          && /\bgap\b/i.test(s)
          && /never a product that failed|never a miss/i.test(s),
      ),
    ).toEqual([]);
  });

  it("18 — only `shopping_offers` reads a price live, it is quoted with the moment it was read, and sil converts no currency", () => {
    // Measured: the recommended boot was presented with a price taken off a page sil had
    // not read, with no dated read behind it. A range quoted as today's price is the same
    // defect wearing a wider number. sil holds no rate, so a converted price is invented.
    const units = skillSectionStatements("seller");

    const live = units.filter((s) => /shopping_offers/.test(s));
    expect(live.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        live,
        (s) => /\bonly\b/i.test(s) && /reads? live/i.test(s) && /moment|stamps/i.test(s),
      ),
    ).toEqual([]);

    const currency = units.filter((s) => /currency/i.test(s));
    expect(currency.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(currency, (s) => /never convert/i.test(s) && /no rate|holds no/i.test(s)),
    ).toEqual([]);
  });

  it("19 — a key ABSENT from `seller_fit` is a term sil has not read, and `ships: unknown` KEEPS the offer", () => {
    // The lie that looks like a filter. A key absent from `seller_fit` means sil has not
    // read that term; reported as a failure it hides the only seller that might ship, and
    // nothing downstream can detect it.
    const units = skillSectionStatements("seller");

    const absent = units.filter((s) => /seller_fit/.test(s));
    expect(absent.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(absent, (s) => /missing|absent/i.test(s) && /has not read|not read/i.test(s)),
    ).toEqual([]);

    const ships = units.filter((s) => /ships: unknown/i.test(s));
    expect(ships.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(ships, (s) => /keeps?\b/i.test(s) && /listing|hand/i.test(s))).toEqual([]);
  });

  it("20 — a variant with no option values is a listing whose sizes are UNREAD: said, priced, and never read as stock", () => {
    // Measured twice. 2026-09-16: the pick came back with no listed size and a page saying
    // "sizes 24-31", and the agent told the buyer "sizes listed 24–31, including your
    // likely 27.5". 2026-09-17: the two Greek listings of the boot the buyer needed were
    // never priced at all — the agent read the empty option list as "nothing to price".
    // Both readings die on the same two sentences.
    const units = skillSectionStatements("seller");

    const sizeless = units.filter((s) => /no option values/i.test(s));
    expect(sizeless.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(sizeless, (s) => /unread|has not read/i.test(s) && /\bprice\b/i.test(s)),
    ).toEqual([]);

    const stock = units.filter((s) => /\bstock\b/i.test(s));
    expect(stock.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(stock, (s) => /\bnever\b/i.test(s) && /range/i.test(s))).toEqual([]);
  });
});

/** The traps — SKILL.md's `## Common traps`. Each is a live draw's own wrong turn. */
describe("the traps a live draw took", () => {
  it("21 — the buyer is never sent to a shop: the document says what buying it online takes instead", () => {
    // The one answer a buyer who came here cannot use, and the reason the domain document
    // carries a "what buying it online takes" section at all — a measurement taken at
    // home, a tolerance, a return window stand in for handling the thing.
    const units = skillSectionStatements("traps");

    const shop = units.filter((s) => /\bshop\b/i.test(s));
    expect(shop.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        shop,
        (s) =>
          /domain document/i.test(s) && /online/i.test(s) && /in place of handling/i.test(s),
      ),
    ).toEqual([]);

    const store = units.filter((s) => /in store|fitted/i.test(s));
    expect(store.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(store, (s) => /cannot use|came here/i.test(s))).toEqual([]);
  });

  it("22 — each variant carries its OWN price, so a price is quoted with the size it belongs to", () => {
    // Measured 2026-09-17: one price was quoted per product while the answer's sizes were
    // priced differently, and the sizes the price came from had been dropped from the turn.
    const units = skillSectionStatements("traps");
    const priced = units.filter((s) => /\bprice\b/i.test(s));
    expect(priced.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(priced, (s) => /variant/i.test(s) && /own price/i.test(s))).toEqual([]);
    expect(unsatisfied(priced, (s) => /\bsize\b/i.test(s) && /quote/i.test(s))).toEqual([]);
  });

  it("23 — a key that reads `unknown` is a question, not a recommendation; and pricing a whole shortlist costs the buyer the answer they asked for", () => {
    // Two costs, both measured 2026-09-18. A pick recommended on the key sil could not
    // verify is the recommendation the buyer cannot check. And every shortlist priced with
    // `country eq GR` before the buyer had chosen anything ended in Canadian, Swedish and
    // UK sellers reading `ships: unknown` under a line of "shipping to Greece unverified".
    //
    // A COST TIP, never a gate — the ruling of 2026-09-19 retired "the pick is priced
    // before it is recommended" and "never for a shortlist" as preconditions on a call,
    // so what is pinned is what the spend BUYS, not an order.
    const units = skillSectionStatements("traps");

    const unknown = units.filter((s) => /`unknown`/.test(s));
    expect(unknown.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(unknown, (s) => /decides the buy/i.test(s) && /not a recommendation/i.test(s)),
    ).toEqual([]);

    const shortlist = units.filter((s) => /shortlist/i.test(s));
    expect(shortlist.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(shortlist, (s) => /interested/i.test(s) && /patience|buries/i.test(s)),
    ).toEqual([]);
  });
});

/** The turn the buyer acts on — SKILL.md's `## Showing a pick`. */
describe("showing a pick", () => {
  it("24 — the pick is argued against the buyer's OWN brief, separating what sil verified from what the shop claims", () => {
    // The ruling's third consequence made visible: the brief is the spec of the buy, so a
    // pick is answered against it in the buyer's words — never as a spec table, and never
    // with the shop's claims and sil's readings run together, which is the presentation
    // that makes an unverified width read as a measured one.
    const units = skillSectionStatements("pick");

    const against = units.filter((s) => /brief/i.test(s));
    expect(against.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        against,
        (s) => /their (?:own )?brief/i.test(s) && /their words/i.test(s) && /spec table/i.test(s),
      ),
    ).toEqual([]);

    const separating = units.filter((s) => /verified/i.test(s));
    expect(separating.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        separating,
        (s) => /shop claims|the shop/i.test(s) && /nobody has read|not read/i.test(s),
      ),
    ).toEqual([]);
  });

  it("25 — nothing fits: name the want in the way, ask for the ONE change, write it, and search again", () => {
    // The answer carries what fits and nothing about what it left out, so no turn can tell
    // the buyer what relaxing a bound would reach. An agent that does not know this either
    // invents the trade-off or widens the search silently — both measured on 2026-09-17.
    const units = skillSectionStatements("pick");

    const nothing = units.filter((s) => /nothing fits/i.test(s));
    expect(nothing.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        nothing,
        (s) =>
          /give it up|giving it up/i.test(s)
          && /`decision`/.test(s)
          && /search(?:ing)? again/i.test(s),
      ),
    ).toEqual([]);

    // …and WHY it is searched again rather than reasoned about: searching is the only
    // thing that learns what giving the want up actually reaches.
    const reaching = units.filter((s) => /giving it up/i.test(s));
    expect(reaching.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(reaching, (s) => /only way/i.test(s))).toEqual([]);
  });
});
