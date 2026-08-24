/**
 * INTEGRATION — the load-bearing CONTRACT of the sil-shopping skill bundle
 * (reads real files + real registration code). Replaces the deleted 1341-line
 * skill-content test, which pinned nearly every prose CLAUSE and so stayed
 * green through a live behavioral bug (the shopper never minting a domain).
 * Guards only what breaks the product if it drifts — discoverability, the
 * published name, the tool set, cross-links, the retired vocabulary, and the
 * mint-first/catalog-of-record forcing function — deriving facts from source,
 * never restating prose wording.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CREATION_ENTRYPOINT_RELATIVE } from "../lib/creation-entrypoint.js";
import { buildDoctorReport } from "../tools/doctor.js";
import { registerIdentityTools } from "../tools/identity.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { registerDocTools } from "../tools/doc.js";
import { registerDoctorTools } from "../tools/doctor.js";
import {
  createMockPluginApi,
  registeredToolNames,
} from "./helpers/mock-plugin-api.js";
import { perNicheExpertOffenders } from "./helpers/per-niche-expert.js";
import {
  honestyExclusionOffenders,
  overPromiseOffenders,
  overTriggerOffenders,
  retiredV0Offenders,
  RETIRED_V0_TOKENS,
} from "./helpers/honesty-vocabulary.js";
// The bundle's reading + SCOPING primitives, shared with
// `eight-beat-loop.integration.test.ts` so the two prose guards cannot drift apart.
import {
  BUNDLE,
  REPO_ROOT,
  beatFile,
  bundleCorpus,
  bundleEntries,
  bundleFiles,
  frontmatter,
  read,
  routingRows,
  skillSrc,
  splitStatements,
  statements,
  unsatisfied,
} from "./helpers/skill-bundle.js";

// The always-loaded router must name the whole v0 journey, not half of it: the
// agent picks a tool by name at the moment of use, and a beat whose tool is
// unnamed in SKILL.md is a beat it will improvise around. Add-only (4 → 6 with
// the four-v0-tools card, 6 → 7 with the read-before-mint card).
//
// This list is HAND-MAINTAINED and separate from the dynamic "every registered
// tool appears somewhere in the corpus" scan below: it is what forces a name into
// `SKILL.md` ITSELF rather than into some `references/` file the agent may never
// load. `sil_domain_find` has to be here, not merely in the corpus — the read is
// the first move of the cold path, and a router that names only the mint sends an
// empty shelf straight at the one write the product cannot undo.
//
// 7 → 9 with the eight-beat card: `sil_doc_find` is beat 1's recall (the loop's
// FIRST move, so a router that omits it starts every job blind) and `sil_doc_write`
// is what beats 1, 3, 7 and 8 all land in. `sil_doc_read` / `sil_doc_remove` stay on
// the corpus scan below — a management verb reached from a reference is fine; the
// two the loop cannot start or finish without are not.
const CORE_TOOLS = [
  "sil_register",
  "sil_whoami",
  "sil_search",
  "sil_product_get",
  "sil_stores",
  "sil_domain_create",
  "sil_domain_find",
  "sil_doc_find",
  "sil_doc_write",
];
// Tokens retired by the single-shopper + SDS-redesign pivots — no path, no doc,
// no compat alias may resurrect them anywhere in the bundle. Each names a thing
// that is GONE, so a blanket forbid is right: nothing legitimately disavows them
// by name (unlike `expert`, which a corrected doc DOES name to bury it — that one
// needs the retro-allowance scan below, never a blanket forbid).
//   `domain_spec`/`intent_spec` keep their UNDERSCORE deliberately: the live
//   vocabulary "intent"/"domain" must never trip this guard.
//   `profile.json` is gone FOREVER — the store is frontmatter-as-truth and the
//   versioned-store-migrations card was abandoned, so nothing will resurrect it.
//   `sil_specs`/`canonical` join on the retire-the-dead-sil-specs-tool card, and
//   they are THE enforcement for its skill-prose criteria: the "every registered
//   tool is named in the bundle" scan above is ONE-DIRECTIONAL, so once the tool
//   is unregistered every stale `sil_specs` passage passes GREEN and the shopper
//   keeps being driven at a deleted tool under a fully green suite. `canonical`
//   is a generic adjective and so carries a real false-RED cost on future prose —
//   taken deliberately: the v0 shopper vocabulary has no canonical anything, a
//   false RED is loud and names its file, and a silent miss is the defect being
//   retired. (`dedup` is NOT here — shop_loop.md uses it legitimately for the
//   Beat-4 merge.)
// Matched CASE-INSENSITIVELY (each body is lowered, not the needle), so a
// Title-cased prose reintroduction (`Rubric`) fails too. Entries MUST therefore
// be lower-case — pinned by a guard-of-the-guard below, because an upper-case
// needle would never match a lowered body and would sit here silently vacuous.
const RETIRED_TOKENS = [
  "profile.json", "domain_spec", "intent_spec", "playbook", "sil_remember",
  "sil_ping", "sil_echo", "rubric", "manage_domains",
  "refine_shopper", "sil_specs", "canonical",
  // The eight-beat card's retirement (AC G7). Every one is a thing that is GONE,
  // and this scan is THE only thing that catches stale prose about it: the "every
  // registered tool is named in the bundle" scan above is ONE-DIRECTIONAL, so
  // deleting the tool turns no passage red — the shopper simply ships driven at a
  // tool that no longer exists, under a fully green suite. `sil_profile` as a PREFIX
  // subsumes the old `sil_profile_list` entry and covers all five verbs at once.
  "sil_profile", "sil_learn", "method.md", "prd", "domainslug", "six-beat",
];

/** The retired NAMES this card's AC G7 enumerates, as a separate list so the bite
 * proof below drives the same scan the bundle does with each one in turn. */
const G7_RETIRED_NAMES = [
  "sil_learn", "sil_profile_materialize", "sil_profile_search", "sil_profile_get",
  "sil_profile_remove", "method.md", "prd", "domainSlug", "six-beat",
];

const manifest = (): { skills?: unknown } =>
  JSON.parse(readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"));

/** The retired-token scan, as ONE function, so the bundle sweep and the bite proof
 * can never be two different rules. */
const retiredTokenOffenders = (body: string): string[] => {
  const lower = body.toLowerCase();
  return RETIRED_TOKENS.filter((t) => lower.includes(t));
};

// Every register group, so the "named in the bundle" guard below covers the WHOLE
// surface. A new group omitted here does not fail — it silently narrows the guard,
// which is worse than a red: the tool ships undocumented and the test still passes.
function registeredTools(): string[] {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerDocTools(api);
  registerDoctorTools(api);
  return [...registeredToolNames(api)];
}

describe("sil-shopping skill bundle — load-bearing contract (not prose)", () => {
  it("SKILL.md exists with parseable frontmatter and a non-empty body", () => {
    expect(existsSync(join(BUNDLE, "SKILL.md"))).toBe(true);
    expect(skillSrc().startsWith("---")).toBe(true);
    expect(frontmatter().body.trim().length).toBeGreaterThan(0);
  });

  it("frontmatter name is the published skill name 'sil-shopping' (distinct from plugin id 'sil') with a non-empty description", () => {
    const fm = frontmatter();
    expect(fm.name).toBe("sil-shopping");
    expect(fm.name).not.toBe("sil");
    expect(fm.description.length).toBeGreaterThan(0);
  });

  it("manifest skills[0] basename agrees with the SKILL.md frontmatter name", () => {
    const skills = manifest().skills as string[];
    expect(Array.isArray(skills)).toBe(true);
    expect(basename(skills[0])).toBe(frontmatter().name);
  });

  it("every registered tool name appears somewhere in the skill bundle", () => {
    const corpus = bundleCorpus();
    expect(registeredTools().filter((n) => !corpus.includes(n))).toEqual([]);
  });

  it("every core tool is named in SKILL.md itself (the always-loaded router)", () => {
    const src = skillSrc();
    expect(CORE_TOOLS.filter((t) => !src.includes(t))).toEqual([]);
  });

  it("the frontmatter description enumerates the read, not just the mint", () => {
    // The description is what the host shows BEFORE the body is loaded, so it is
    // the only text that decides whether the skill is reached at all. A trigger
    // list that names the mint but not the read advertises the write half of a
    // read-then-write discipline.
    const { description } = frontmatter();
    expect(description).toContain("sil_domain_find");
  });

  it("every references/ and examples/ link in the bundle resolves to a real file", () => {
    const paths = [
      ...bundleCorpus().matchAll(/(?:references|examples)\/[\w./-]+\.md/g),
    ].map((m) => m[0]);
    expect(paths.length).toBeGreaterThan(0);
    expect([...new Set(paths)].filter((p) => !existsSync(join(BUNDLE, p)))).toEqual([]);
  });

  it("the drift scan covers EVERY file on disk — no bundle file escapes it", () => {
    // The floor that keeps every corpus-driven guard honest. Without it a silent
    // shrink of the scanned set (a file renamed to .mdx, moved, or added in a new
    // format) narrows the retired-token + per-niche-expert scans to a smaller
    // corpus and they keep passing — green over prose nobody checks. A non-.md
    // bundle file must force a deliberate decision here, not slip through.
    const all = bundleEntries();
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((p) => !p.endsWith(".md"))).toEqual([]);
    expect(bundleFiles()).toContain("SKILL.md");
  });

  it("every RETIRED_TOKENS needle is lower-case (the body is lowered, not the needle)", () => {
    // Guard-of-the-guard: an upper-case needle can never match the lowered body,
    // so it would sit in the list looking protective while matching nothing.
    expect(RETIRED_TOKENS.filter((t) => t !== t.toLowerCase())).toEqual([]);
    expect(RETIRED_V0_TOKENS.filter((t) => t !== t.toLowerCase())).toEqual([]);
  });

  it("the bundle prose obeys the SAME honesty rules the tool descriptions do", () => {
    // One scanner module, two surfaces. The skill is what the agent reads before
    // it ever sees a tool description, so a bundle that says "drop the unknown
    // sellers" defeats a perfectly worded `sil_stores` description. Sharing
    // `helpers/honesty-vocabulary.ts` with `tools/tool-schema-contract.unit.test.ts`
    // is what stops the two rules drifting apart.
    const offenders: string[] = [];
    for (const rel of bundleFiles()) {
      const body = read(rel);
      for (const s of honestyExclusionOffenders(body)) offenders.push(`${rel}: ${s}`);
      for (const s of overPromiseOffenders(body)) offenders.push(`${rel}: ${s}`);
      for (const s of overTriggerOffenders(body)) offenders.push(`${rel}: ${s}`);
    }
    expect(offenders).toEqual([]);
  });

  it("guard-of-the-guard: the scanned corpus is non-trivial", () => {
    // Every scan above returns [] over an empty corpus. This is the floor that
    // keeps them honest if the bundle is ever gutted.
    expect(bundleCorpus().length).toBeGreaterThan(5000);
  });

  it("no retired vocabulary token survives anywhere in the bundle", () => {
    // Offenders carry their file so a red names the drift's location, not just
    // that the bundle is dirty somewhere.
    const offenders: string[] = [];
    for (const rel of bundleFiles()) {
      const body = read(rel);
      for (const t of retiredTokenOffenders(body)) offenders.push(`${rel} → ${t}`);
      // The pre-v0 CATALOG vocabulary joins on the four-v0-tools card. This scan
      // is ONE-DIRECTIONAL — deleting the tools does not turn stale prose red;
      // only listing the token does. Without these entries the bundle ships
      // driving the shopper at `checkout_url`, a field the v0 wire does not
      // have, under a fully green suite. That is the exact failure the
      // sil_specs retirement documented.
      for (const t of retiredV0Offenders(body)) offenders.push(`${rel} → ${t}`);
      for (const ctx of perNicheExpertOffenders(body)) offenders.push(`${rel}: …${ctx}…`);
    }
    expect(offenders).toEqual([]);
  });

  it("AC G7 — every name this card retires is CAUGHT by that scan (the one-directional guard, closed)", () => {
    // THE bar the sil_specs failure exists to force. The scan above is a scan: it
    // reports what it was told to look for and is silent about everything else. So
    // "no retired name survives" is only worth what the LIST is worth, and the list
    // is exactly what a rushed retirement forgets — leaving the shopper driven at
    // `sil_learn` and `method.md` under a fully green suite.
    //
    // Proved by BITE, not by membership: each name is fed through the real scan
    // inside a plausible sentence, so an entry that is present-but-unmatchable
    // (upper-cased, mistyped, or a `sil_profile_x` the `sil_profile` prefix happens
    // not to cover) fails here rather than sitting in the list looking protective.
    const notCaught = G7_RETIRED_NAMES.filter(
      (name) => retiredTokenOffenders(`Then call ${name} to record it.`).length === 0,
    );
    expect(notCaught).toEqual([]);
  });

  it("SKILL.md pins the mint-first, catalog-of-record forcing function (v0 vocabulary)", () => {
    // RE-DERIVED, not deleted. The forcing function is unchanged — mint a cold
    // category rather than guessing, and take picks from the sil catalog rather
    // than the open web — but BOTH of its old anchors are retired by the v0
    // contract: `mint_domain` names a tool that never existed (the tool is
    // `sil_domain_create`), and `checkout_url` is a FIELD the v0 wire does not
    // have (the handoff is `sil_stores`' `handoff.url`). Left as they were, this
    // assertion and the retired-token scan below would be mutually
    // unsatisfiable, and the "fix" would have been to weaken one of them.
    const src = skillSrc();
    expect(src).toContain("sil_domain_create"); // the mint trigger
    expect(src).toContain("sil_stores"); // where a handoff URL legitimately comes from
    expect(src).toMatch(/open[ -]web/i); // never sourced from the open web
  });

  it("the Beat-2 naming discipline survives the sil_domain_find arrival", () => {
    // The removal's collateral-damage guard (retire-the-dead-sil-specs-tool). What
    // died is the registry ROUND TRIP, not the vocabulary hygiene: Beat 4 still
    // sends these coined names verbatim as sil_search.filters.specs, so a synonym
    // splits one concept into two predicates that never meet. Over-excising the two
    // surviving rules turns nothing RED — the shopper just quietly gets worse.
    // TWO tokens, deliberately not a re-pinning of the wording (the 1 341-line
    // prose test was deleted for a reason).
    //
    // Resolved through `beatFile(2)` rather than a filename: the eight-beat card
    // renamed `method_and_prds.md` → `domain_and_brief.md`, and a hardcoded path
    // would have to be re-fixed on every such rename while guarding nothing extra.
    // The BEAT is the stable address; the file is not.
    const src = read(beatFile(2));
    expect(src).toContain("one spelling"); // reuse the exact key you coined
    expect(src).toContain("conventional name"); // take the Schelling-point name
  });
});

// ===========================================================================
// Card: sil-domain-find — READ BEFORE MINT, as the bundle states it.
//
// The tool alone does not close this card. `sil_domain_create` performs v0's ONE
// permanent, un-undoable global registry write, and nothing in the plugin can
// stop an agent reaching it — the discipline lives entirely in prose, so prose is
// what has to be guarded. Each bar below holds a DECISION that changes the
// shopper's behaviour if it is lost, never a sentence: the 1341-line prose test
// this suite deleted stayed green through a live behavioural bug precisely
// because it pinned wording instead.
// ===========================================================================

// `routingRows`, `statements` and `unsatisfied` moved to `helpers/skill-bundle.ts`
// (imported above) when the eight-beat bars needed the same SCOPING. Duplicating
// the statement splitter would have been the drift `honesty-vocabulary.ts` exists to
// prevent: two prose guards, two definitions of "a statement", one of them wrong.

/** Withholds the licence: "never licenses", "does not license", or the exclusivity
 * form the tool itself uses ("only a `q` read licenses one"). Direction is
 * load-bearing — the denial must PRECEDE the licence word, or "**mint licensed** —
 * no returned match states…" satisfies it and the bar is born vacuous. */
const DENIES_LICENCE = /\b(?:never|not|cannot|can'?t|no|only)\b[\s\S]*?licen/i;
/** An EMPTY match list — the one thing a probe cannot produce. */
const EMPTY_MATCH_LIST =
  /matches:?\s*\[\s*\]|\bmatches\b[^.]{0,40}\bempty\b|\bempty\b[^.]{0,40}\bmatches\b/i;

describe("read before mint — the bundle's half of the card", () => {
  it("S2 — NO file reaches the global write without also naming the read", () => {
    // The card's spine, asserted structurally rather than by wording: a file that
    // teaches the mint and never mentions the read is a door to a permanent write
    // with the discipline missing. Derived from the corpus on disk, so a new
    // reference file inherits the rule for free.
    const offenders = bundleFiles().filter(
      (rel) => read(rel).includes("sil_domain_create") && !read(rel).includes("sil_domain_find"),
    );
    expect(offenders).toEqual([]);
  });

  it("S2 — guard-of-the-guard: some file DOES name the mint (an empty scan passes)", () => {
    expect(bundleFiles().filter((rel) => read(rel).includes("sil_domain_create")).length)
      .toBeGreaterThan(0);
  });

  it("S2 — the router's read row sits ABOVE its mint row, and the mint row names the read", () => {
    // Reading order, mechanised. The agent matches top-down; a mint row above the
    // read row is a mint row it reaches first.
    const rows = routingRows();
    const readRow = rows.findIndex((r) => r.includes("sil_domain_find"));
    const mintRow = rows.findIndex((r) => r.includes("sil_domain_create"));
    expect(readRow).toBeGreaterThanOrEqual(0);
    expect(mintRow).toBeGreaterThanOrEqual(0);
    expect(readRow).toBeLessThan(mintRow);
    // The mint row states what must have happened first — otherwise the trigger
    // reads as "a cold category" and the read becomes optional.
    expect(rows[mintRow]).toMatch(/sil_domain_find|\bread\b/);
  });

  it("S2 (= AC B5) — a read that did NOT return is not a read that returned nothing", () => {
    // BR-2. Without this the natural repair for a transient failure is to mint and
    // move on — a permanent global write entered off a network blip.
    const corpus = bundleCorpus();
    expect(corpus).toMatch(/invalid_request/);
    expect(corpus).toMatch(
      /did not return|not a read that returned nothing|never coin around|leaves the mint (out of reach|unreachable)/i,
    );
  });

  it("S2/BR-8 — an ambiguous `sil_search` refusal is settled by a PROBE, never by a mint", () => {
    // The two refusals carry the same `invalid_request` on the wire and the plugin
    // matches on no prose, so the refusal text alone cannot tell them apart. The
    // stated `exists` decides — a global write is never entered off refusal prose.
    const corpus = bundleCorpus();
    expect(corpus).toMatch(/read alike|cannot tell|indistinguishable|same .*invalid_request/i);
    expect(corpus).toMatch(/probe/i);
    expect(corpus).toMatch(/exists/);
  });

  it("S3 — the read's input is the buyer's PROSE, and the bundle says why a guess is wrong", () => {
    // `q` is matched against a domain's guide as well as its path text, so a
    // path-shaped guess misses exactly the domains the read exists to surface.
    const corpus = bundleCorpus();
    expect(corpus).toMatch(/own words/i);
    expect(corpus).toMatch(/path[- ]shaped guess|not a path guess|rather than a path guess/i);
    expect(corpus).toMatch(/guide/i);
  });

  it("S4 (= AC B5) — all four branch verdicts are present, and `capped` is one of them", () => {
    // Dropping the `capped` branch ALONE re-creates the exact defect the route
    // exists to prevent: minting while the standing path sat just past the bound.
    const corpus = bundleCorpus();
    const verdicts: [string, RegExp][] = [
      ["adopt", /\badopt/i],
      ["descend", /\bdescend/i],
      ["mint licensed", /licens/i],
      ["narrow on capped", /\bcapped\b/],
    ];
    expect(verdicts.filter(([, re]) => !re.test(corpus)).map(([name]) => name)).toEqual([]);
    // The descend rule's whole content: a sibling or re-rooted path for a category
    // that already stands is never coined, because the mint would ACCEPT it.
    expect(corpus).toMatch(/never a sibling|not a sibling|sibling.*re-?rooted/i);
  });

  it("S4 (= AC B5) — `capped: true` withholds the licence rather than shrinking the answer", () => {
    const corpus = bundleCorpus();
    expect(corpus).toMatch(/capped:?\s*`?true/i);
    expect(corpus).toMatch(/narrow|sharpen|read (once more|again)/i);
  });

  it("S4/BR-1b (= AC B5) — the licence is an EMPTY `q` read, and a `path` probe never grants it", () => {
    // The clause the plugin cannot enforce, and the one the bundle stated more
    // weakly than the tool did. A probe MISS is not an empty answer: it returns a
    // match carrying `exists: false` (`helpers/v0-wire.ts#domainFindProbeMiss`), so
    // an `exists`-only licence test is SATISFIED by the single read that must never
    // license a mint — and the agent coins a sibling of a path already standing
    // under a different parent. That write is permanent, global and un-undoable, and
    // `exists: false` at a guessed path is silent about it. Two halves, because
    // either alone leaves the door: what the probe does NOT buy, and what the
    // licence actually costs.
    const units = statements();

    const probeUnits = units.filter((s) => /probe/i.test(s));
    expect(probeUnits.length).toBeGreaterThan(0); // guard-of-the-guard: an empty scan passes
    expect(unsatisfied(probeUnits, (s) => DENIES_LICENCE.test(s))).toEqual([]);

    const licenceUnits = units.filter((s) => /licen/i.test(s));
    expect(licenceUnits.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(licenceUnits, (s) => EMPTY_MATCH_LIST.test(s) && /capped/i.test(s)),
    ).toEqual([]);
  });

  it("S5 — the adoption discipline names its mechanism and says the keys travel VERBATIM", () => {
    // "take the key sil already holds" was unreachable advice until this tool
    // existed: nothing in the surface could read a standing domain's vocabulary.
    //
    // RETARGETED, not weakened. The `## Search vocabulary` literal this bar used to
    // pin was a section of the PRD, and the eight-beat card deletes the PRD outright
    // (§4.1: the guide and vocabulary are the registry's now). The DECISION did not
    // move — adopted keys travel unchanged — only its destination did, from a
    // per-domain PRD section to the Brief's predicate tables. Pinning a section that
    // no longer exists would have made this bar and the retired-token scan mutually
    // unsatisfiable, and the "fix" would have been to delete one of them.
    const src = read(beatFile(2));
    expect(src).toContain("sil_domain_find");
    const verbatimUnits = splitStatements(src).filter((s) => /verbatim/i.test(s));
    expect(verbatimUnits.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        verbatimUnits,
        (s) =>
          /\bkeys?\b/i.test(s)
          && /predicate|## Hard constraints|## Preferences|vocabular/i.test(s),
      ),
    ).toEqual([]);
  });

  it("S5 — the read budget is stated as a NUMBER, and the probe is outside it", () => {
    // Open question 9. An agent left to infer whether the probe counts against the
    // bound either forfeits it — forking the vocabulary — or takes a third
    // discovery read. Write the arithmetic; do not imply it.
    const src = read(beatFile(2));
    expect(src).toMatch(/\b2\b|\btwo\b/);
    expect(src).toMatch(/probe/i);
    expect(src).toMatch(/does\s*\*{0,2}not\*{0,2}\s*count|≤\s*2\s*\+\s*1|2 \+ 1/i);
  });

  it("S6 — a fenced match is ADOPTED, and the fence explains the result rather than removing one", () => {
    // `validated_at: null` means minted but not yet validated by the pass. The
    // sentence carrying this is exactly the shape `honestyExclusionOffenders`
    // scans (an exclusion verb beside a maturity claim), and that scan runs over
    // the whole bundle above — so this bar only has to pin the DECISION.
    const corpus = bundleCorpus();
    expect(corpus).toMatch(/validated_at/);
    expect(corpus).toMatch(/adopted like any other|like any other match|a real (category|domain)/i);
    expect(corpus).toMatch(/stays on the table|every result and seller/i);
  });

  it("S7 — a held path is the cold path's memory, not a per-search toll", () => {
    // Without this the card ships a latency and spend regression on every warm
    // search, which no other bar here would catch.
    const corpus = bundleCorpus();
    expect(corpus).toMatch(/no `?sil_domain_find`? call|without a read|no registry read|not re-?read/i);
    expect(corpus).toMatch(/cold path'?s first move|never a per-search toll|already records/i);
  });
});

// ===========================================================================
// Card: creation-bin-unreachable-on-clawhub-installs — the prose is the third
// surface, and the only one that can actually drift.
//
// `sil_doctor` REPORTS the entrypoint and PROBES it from ONE constant, so the
// reported path and the probed path cannot disagree by construction. The prose is
// what the agent actually obeys, and nothing binds it to that constant but these
// tests. This bug's entire lifetime was underwritten by a GREEN guard
// (`package-manifest.integration.test.ts:238` pinned the bin map while the flow
// using it was dead), which is the failure mode this block exists to foreclose.
// ===========================================================================

const ENGINE = "references/agent_creation_engine.md";
const engineSrc = (): string => read(ENGINE);

/** The fenced code blocks — what the agent COPIES, as opposed to prose about it.
 * Command-shape assertions belong here: the prose legitimately DISCUSSES the traps
 * (a `../scripts/…` hop, a heredoc) in order to disavow them by name, so scanning
 * the whole document for those constructs would fail the very words that document
 * the fix. */
const engineCodeBlocks = (): string =>
  [...engineSrc().matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");

const pkgBin = (): Record<string, string> =>
  (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    bin: Record<string, string>;
  }).bin;

describe("creation entrypoint — the surfaces that can actually drift (AC B7)", () => {
  it("AC B7 — the doc names the REAL DoctorReport field that carries the path", () => {
    // THE drift guard, retargeted to the drift this design can actually suffer.
    //
    // B7 as written asks the prose to name `scripts/create-shopper.mjs` and pins that
    // literal equal to the constant + the bin map. The shipped design does not put a
    // path in the prose at all — it documents `node "<creationEntrypoint>"`, where the
    // value comes from sil_doctor at runtime. That is STRONGER than B7 hoped for
    // (E and D are one value, not two strings asserted equal), and pinning the path
    // into prose would ADD a fourth surface that goes stale on the next rename while
    // guarding nothing.
    //
    // But the binding did not vanish — it MOVED, from the path to the FIELD NAME. If
    // the report's key is ever renamed, the doc still says `creationEntrypoint`, the
    // agent reads a field that does not exist, and creation dies at exactly the step
    // this card is fixing, silently, on both channels. Nothing else guards that.
    //
    // Derived by VALUE, never by restating the key: plant a sentinel path in a real
    // report and ask which top-level key came back carrying it. A rename makes `key`
    // the NEW name and forces the doc to follow.
    const SENTINEL = "/sentinel-root/scripts/create-shopper.mjs";
    const report = buildDoctorReport({
      dataDir: "/tmp/sil-data",
      installedVersion: "0.0.0",
      creationEntrypoint: SENTINEL,
      findings: [],
    });
    const key = Object.entries(report).find(([, v]) => v === SENTINEL)?.[0];
    expect(key).toBeDefined();
    expect(engineSrc()).toContain(key!);
  });

  it("package.json#bin maps the resolver's SAME path (the bin is retained for npm-global users)", () => {
    // "Out of scope" keeps the bin entry: it costs nothing and still serves the
    // npm-global channel. It is simply no longer the DOCUMENTED invocation. Asserting
    // it against the same constant is what stops a future cleanup from "restoring"
    // the bare bin name in the prose.
    expect(pkgBin()["sil-openclaw-create-shopper"]?.replace(/^\.\//, "")).toBe(
      CREATION_ENTRYPOINT_RELATIVE,
    );
  });

  it("the constant is a real, non-vacuous scripts/*.mjs path (guard-of-the-guard)", () => {
    // Three surfaces asserted equal to an empty string would pass forever.
    expect(CREATION_ENTRYPOINT_RELATIVE).toMatch(/^scripts\/[a-z][a-z0-9-]*\.mjs$/);
    expect(existsSync(join(REPO_ROOT, CREATION_ENTRYPOINT_RELATIVE))).toBe(true);
  });
});

describe("the documented creation command is channel-independent (AC A2/A3/A4)", () => {
  it("AC A4 — the doc sources the path from sil_doctor's creationEntrypoint", () => {
    // The POSITIVE pin, and the load-bearing one: the agent has no other sound source.
    // The host publishes plugin skills as SYMLINKS and hands the agent the symlink
    // path, so there IS no plugin-root datum in its context.
    const src = engineSrc();
    expect(src).toContain("sil_doctor");
    expect(src).toContain("creationEntrypoint");
  });

  it("AC A3 — the documented command runs node against that path, by absolute path", () => {
    expect(engineCodeBlocks()).toMatch(/node\s+"<creationEntrypoint>"/);
  });

  it("AC A3 — NO bundled prose names a bare sil bin anywhere", () => {
    // The defect itself. `openclaw plugins install` links no bins, so both names
    // reach PATH only through a global npm-style install. Bundle-wide, and not even
    // as a disavowal: a model lifts the shortest thing that looks like a command, and
    // a name-free disavowal (which the doc now does) carries the warning just as well.
    const offenders: string[] = [];
    for (const rel of bundleFiles()) {
      for (const bin of ["sil-openclaw-create-shopper", "sil-openclaw-allowlist"]) {
        if (read(rel).includes(bin)) offenders.push(`${rel} → ${bin}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("AC A4 — no documented command derives the path from the skill file's own location", () => {
    // The falsified fix direction. `node <skilldir>/../scripts/x` throws
    // MODULE_NOT_FOUND on the exact string `cat` reads happily: node's path.resolve
    // normalizes `..` LEXICALLY, before the filesystem, so the symlink hop is erased.
    // Scoped to code blocks BY DESIGN — the prose names this trap to warn about it.
    expect(engineCodeBlocks()).not.toMatch(/\.\.\//);
    expect(engineCodeBlocks()).not.toMatch(/readlink|dirname|\$\(dirname/);
  });

  it("AC A2 — ONE invocation serves both channels: no channel-conditional branch", () => {
    // "If you installed via X do A, else B" is how a fix becomes a fork that only one
    // channel ever exercises.
    const src = engineSrc().toLowerCase();
    expect(src).not.toContain("clawhub");
    expect(src).not.toContain("npm install");
    expect(src).not.toContain("npm i -g");
  });
});

describe("the spec is fed by file, never by shell quoting (AC C2/C3)", () => {
  it("AC C2 — the documented input form is --spec <path>", () => {
    expect(engineCodeBlocks()).toContain("--spec");
  });

  it("AC C2 — NO heredoc or stdin form survives as an alternative", () => {
    // Delete-first: the heredoc is REMOVED, not left beside the new form. Two
    // documented forms means the model picks the quoting-fragile one half the time —
    // and a mangled heredoc reaches the bin as unparseable stdin, so it fails as
    // `invalid_request` and the agent BLAMES THE USER for a spec that was fine.
    //
    // The heredoc OPERATOR, not the word: the prose says "as a file, not a heredoc",
    // which is correct and must not be punished. stdin stays in the bin (founder
    // ruling 3) — the DOC is the single-form contract.
    expect(engineCodeBlocks()).not.toMatch(/<<-?\s*['"]?\w+/);
    expect(engineSrc()).not.toContain("stdin");
  });

  it("AC C3 — the doc instructs an owner-only spec file that is removed after the run", () => {
    // `--spec <path>` writes the user's home address, sizes, and allergy/ethics rules
    // to disk where stdin left nothing at rest. The agent owns that file's lifecycle:
    // the bin never deletes an input it does not own (founder ruling 3).
    const src = engineSrc();
    expect(src).toMatch(/0600|umask 077/);
    expect(engineCodeBlocks()).toMatch(/rm -f|rm "/);
  });
});
