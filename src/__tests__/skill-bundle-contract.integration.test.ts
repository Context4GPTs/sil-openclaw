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
import { registerIdentityTools } from "../tools/identity.js";
import { registerBriefCompileTool } from "../tools/brief-compile.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { registerDocTools } from "../tools/doc.js";
import { registerDoctorTools } from "../tools/doctor.js";
import {
  createMockPluginApi,
  registeredToolNames,
} from "./helpers/mock-plugin-api.js";
import { perNicheExpertOffenders } from "./helpers/per-niche-expert.js";
// The needle list + the bundle's blanket-forbid scan, shared with the docs guard
// (`docs-retired-tokens.integration.test.ts`). One module, two corpus rules: the
// docs side SUBTRACTS needles it may not scan, and can never edit the list here.
import { RETIRED_TOKENS, retiredTokenOffenders } from "./helpers/retired-tokens.js";
import {
  honestyExclusionOffenders,
  notFoundLicenceOffenders,
  overPromiseOffenders,
  overTriggerOffenders,
  retiredPhraseOffenders,
  retiredV0Offenders,
  statesQualifiedNotFound,
  RETIRED_V0_PHRASES,
  RETIRED_V0_TOKENS,
} from "./helpers/honesty-vocabulary.js";
// The bundle's reading + SCOPING primitives, shared with
// `eight-beat-loop.integration.test.ts` so the two prose guards cannot drift apart.
import {
  BUNDLE,
  REPO_ROOT,
  beatFile,
  beatStatements,
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

// The always-loaded router must name the whole journey, not half of it: the agent picks a
// tool by name at the moment of use, and a beat whose tool is unnamed in SKILL.md is a
// beat it will improvise around.
//
// This list is HAND-MAINTAINED and separate from the dynamic "every registered tool
// appears somewhere in the corpus" scan below: it is what forces a name into `SKILL.md`
// ITSELF rather than into some `references/` file the agent may never load.
// `shopping_domain_search` has to be here, not merely in the corpus — the read is the
// first move of the cold path, and a router that names only the mint sends an empty shelf
// straight at the one write the product cannot undo. `shopping_doc_find` is beat 1's
// recall (the loop's FIRST move) and `shopping_doc_write` is what beats 1, 3, 7 and 8 all
// land in; `shopping_doc_read` / `shopping_doc_remove` stay on the corpus scan — a
// management verb reached from a reference is fine, the two the loop cannot start or
// finish without are not.
const CORE_TOOLS = [
  "sil_register",
  "sil_whoami",
  "shopping_domain_search",
  "shopping_domain_get",
  "shopping_domain_create",
  "shopping_brief_compile",
  "shopping_search",
  "shopping_product_get",
  "shopping_offers",
  "shopping_seller_get",
  "shopping_doc_find",
  "shopping_doc_write",
];
/** The retired NAMES this card's AC G7 enumerates, as a separate list so the bite
 * proof below drives the same scan the bundle does with each one in turn. */
const G7_RETIRED_NAMES = [
  "sil_learn", "sil_profile_materialize", "sil_profile_search", "sil_profile_get",
  "sil_profile_remove", "method.md", "prd", "domainSlug", "six-beat",
];

const manifest = (): { skills?: unknown } =>
  JSON.parse(readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"));

// Every register group, so the "named in the bundle" guard below covers the WHOLE
// surface. A new group omitted here does not fail — it silently narrows the guard,
// which is worse than a red: the tool ships undocumented and the test still passes.
function registeredTools(): string[] {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerDocTools(api);
  registerBriefCompileTool(api);
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
    expect(description).toContain("shopping_domain_search");
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
    expect(RETIRED_V0_PHRASES.filter((t) => t !== t.toLowerCase())).toEqual([]);
  });

  it("the bundle prose obeys the SAME honesty rules the tool descriptions do", () => {
    // One scanner module, two surfaces. The skill is what the agent reads before
    // it ever sees a tool description, so a bundle that says "drop the unknown
    // sellers" defeats a perfectly worded `shopping_seller_get` description. Sharing
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

  it("AC16 — the bundle states `not_found` as a claim from a listing, never as a bare licence to mint", () => {
    // AC15's other surface, through the ONE shared needle
    // (`helpers/honesty-vocabulary.ts`): the skill is what the agent reads before it
    // ever sees a tool description, so a perfectly qualified `shopping_doc_read`
    // description is undone by a reference file that still says "an absent document
    // is not_found". Two guards, one rule — the same discipline that keeps the
    // honesty scans from drifting apart.
    const offenders: string[] = [];
    for (const rel of bundleFiles()) {
      for (const s of notFoundLicenceOffenders(read(rel))) offenders.push(`${rel}: ${s}`);
    }
    expect(offenders).toEqual([]);
    // Guard-of-the-guard: deleting the vocabulary passes the scan above vacuously.
    // The bundle documents the document surface, so it must still teach the rule.
    expect(bundleFiles().filter((rel) => statesQualifiedNotFound(read(rel)))).not.toEqual([]);
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
      // The retired REQUEST vocabulary rides the same scan. It is ONE-DIRECTIONAL —
      // deleting a tool does not turn stale prose red; only listing the token does.
      // Without these entries the bundle ships driving the shopper at `checkout_url`,
      // a field the wire does not have, under a fully green suite.
      for (const t of retiredV0Offenders(body)) offenders.push(`${rel} → ${t}`);
      // The two retired PHRASES, bundle-only and matched unwrapped — the prose they
      // describe is this bundle's, and both were already invisible to a byte-wise
      // scan at the 88-column wrap they are written at.
      for (const p of retiredPhraseOffenders(body)) offenders.push(`${rel} → ${p}`);
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

  it("SKILL.md pins the mint-first, catalog-of-record forcing function", () => {
    // RE-DERIVED on every rename, never deleted. The forcing function is unchanged —
    // mint a cold category rather than guessing, and take picks from the sil catalog
    // rather than the open web — but its anchors move with the wire each time, and
    // leaving a retired one here would make this bar and the retired-token scan below
    // mutually unsatisfiable, with "weaken one of them" as the only fix.
    const src = skillSrc();
    expect(src).toContain("shopping_domain_create"); // the mint trigger
    expect(src).toContain("shopping_offers"); // where a listing URL legitimately comes from
    expect(src).toMatch(/open[ -]web/i); // never sourced from the open web
  });

  it("the Beat-2 naming discipline survives the registry read's rename", () => {
    // The removal's collateral-damage guard. What died is the registry ROUND TRIP, not
    // the vocabulary hygiene: beat 5 still sends these coined names verbatim as
    // `shopping_search` spec keys, so a synonym splits one concept into two rows that
    // never meet. Over-excising the two surviving rules turns nothing RED — the shopper
    // just quietly gets worse.
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
// The tool alone does not close this card. `shopping_domain_create` performs the ONE
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
/** An EMPTY match list — the one answer that licenses the write. */
const EMPTY_MATCH_LIST =
  /matches:?\s*\[\s*\]|\bmatches\b[^.]{0,40}\bempty\b|\bempty\b[^.]{0,40}\bmatches\b/i;

describe("read before mint — the bundle's half of the card", () => {
  it("S2 — NO file reaches the global write without also naming the read", () => {
    // The card's spine, asserted structurally rather than by wording: a file that
    // teaches the mint and never mentions the read is a door to a permanent write
    // with the discipline missing. Derived from the corpus on disk, so a new
    // reference file inherits the rule for free.
    const offenders = bundleFiles().filter(
      (rel) =>
        read(rel).includes("shopping_domain_create")
        && !read(rel).includes("shopping_domain_search"),
    );
    expect(offenders).toEqual([]);
  });

  it("S2 — guard-of-the-guard: some file DOES name the mint (an empty scan passes)", () => {
    expect(bundleFiles().filter((rel) => read(rel).includes("shopping_domain_create")).length)
      .toBeGreaterThan(0);
  });

  it("S2 — the router's read row sits ABOVE its mint row, and the mint row names the read", () => {
    // Reading order, mechanised. The agent matches top-down; a mint row above the
    // read row is a mint row it reaches first.
    const rows = routingRows();
    const readRow = rows.findIndex((r) => r.includes("shopping_domain_search"));
    const mintRow = rows.findIndex((r) => r.includes("shopping_domain_create"));
    expect(readRow).toBeGreaterThanOrEqual(0);
    expect(mintRow).toBeGreaterThanOrEqual(0);
    expect(readRow).toBeLessThan(mintRow);
    // The mint row states what must have happened first — otherwise the trigger
    // reads as "a cold category" and the read becomes optional.
    expect(rows[mintRow]).toMatch(/shopping_domain_search|\bread\b/);
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

  it("S2/BR-8 — an ambiguous search refusal is settled by READING the domain, never by a mint", () => {
    // A refused domain and a refused spec row carry the same `invalid_request` on the
    // wire, and the plugin matches on no prose, so the refusal text alone cannot tell
    // them apart. Reading the path decides: a guide back means the row was the problem,
    // `not_found` means the domain was. A global write is never entered off refusal prose.
    const corpus = bundleCorpus();
    expect(corpus).toMatch(/read alike|cannot tell|indistinguishable|same .*invalid_request/i);
    expect(corpus).toContain("shopping_domain_get");
    expect(corpus).toMatch(/not_found/);
  });

  it("S3 — the read's input is the buyer's PROSE, and the bundle says why a guess is wrong", () => {
    // `q` is matched against a domain's guide as well as its path text, so a
    // path-shaped guess misses exactly the domains the read exists to surface.
    const corpus = bundleCorpus();
    expect(corpus).toMatch(/own words/i);
    expect(corpus).toMatch(/path[- ]shaped guess|not a path guess|rather than a path guess/i);
    expect(corpus).toMatch(/guide/i);
  });

  it("S4 (= AC B5) — all three branch verdicts are present, and the mint is the licensed one", () => {
    // The contract retired the bounded-list branch with the field that stated it, so the
    // read now answers three ways. Dropping the descend branch re-creates the defect the
    // read exists to prevent: coining a sibling of a path that already stands.
    const corpus = bundleCorpus();
    const verdicts: [string, RegExp][] = [
      ["adopt", /\badopt/i],
      ["descend", /\bdescend/i],
      ["mint licensed", /licens/i],
    ];
    expect(verdicts.filter(([, re]) => !re.test(corpus)).map(([name]) => name)).toEqual([]);
    // The descend rule's whole content: a sibling or re-rooted path for a category
    // that already stands is never coined, because the mint would ACCEPT it.
    expect(corpus).toMatch(/never a sibling|not a sibling|sibling.*re-?rooted/i);
  });

  it("S4/BR-1b (= AC B5) — the licence is an EMPTY registry read, and nothing else grants it", () => {
    // The clause the plugin cannot enforce. `matches: []` is the ONE answer that
    // licenses a permanent, global, un-undoable write; a `not_found` from the guide read
    // is silent about the standing path under a different parent, which is exactly the
    // fork this discipline exists to prevent. Two halves, because either alone leaves
    // the door open: what the guide read does NOT buy, and what the licence costs.
    const units = statements();

    const getUnits = units.filter((s) => /shopping_domain_get/.test(s) && /licen/i.test(s));
    expect(getUnits.length).toBeGreaterThan(0); // guard-of-the-guard: an empty scan passes
    expect(unsatisfied(getUnits, (s) => DENIES_LICENCE.test(s))).toEqual([]);

    const licenceUnits = units.filter((s) => /licen/i.test(s));
    expect(licenceUnits.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(licenceUnits, (s) => EMPTY_MATCH_LIST.test(s))).toEqual([]);
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
    expect(src).toContain("shopping_domain_search");
    const verbatimUnits = splitStatements(src).filter((s) => /verbatim/i.test(s));
    expect(verbatimUnits.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(
        verbatimUnits,
        (s) =>
          /\bkeys?\b/i.test(s)
          && /spec (table|row)|## Hard constraints|## Preferences/i.test(s),
      ),
    ).toEqual([]);
  });

  it("S5 — the read budget is stated as a NUMBER, not implied", () => {
    // An agent left to infer the bound either forfeits it — forking the vocabulary on a
    // near-miss — or reads the registry all afternoon. Write the arithmetic.
    const src = read(beatFile(2));
    const budget = splitStatements(src).filter((s) => /budget/i.test(s));
    expect(budget.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(budget, (s) => /\b2\b|\btwo\b/.test(s) && /reads?/i.test(s))).toEqual([]);
  });

  it("S7 — a held path is the cold path's memory, not a per-search toll", () => {
    // Without this the card ships a latency and spend regression on every warm
    // search, which no other bar here would catch.
    const corpus = bundleCorpus();
    expect(corpus).toMatch(
      /no `?shopping_domain_search`? call|without a read|no registry read|not re-?read/i,
    );
    expect(corpus).toMatch(/cold path'?s first move|never a per-search toll|already records/i);
  });
});

// ===========================================================================
// SC4 — the loop runs on any agent with the plugin, and the creation ceremony
// is gone. The plugin cannot enforce either: both live entirely in prose, which
// is what the scans below hold. The engine's own bars were deleted with it —
// these replace them in the one direction that still matters, re-introduction.
// ===========================================================================

/** The ceremony's dead names. A scan is only worth its list, so each is proved to BITE. */
const CEREMONY_NAMES = [
  "create-shopper",
  "agent_creation_engine",
  "setup_onboarding",
  "creationentrypoint",
  "offer_shopper",
];

/** The pitch itself, in the forms the retired onboarding used — a name-free "let me set
 * up your shopper first" is the same precondition wearing different words. */
const SETUP_PITCH =
  /\bset\s+(?:up|me\s+up|you\s+up)\b[^.]{0,48}\bshopper\b|\bcreate\s+(?:my|your|a|the)\s+shopper\b|\bendors\w+\b[^.]{0,48}\bshopper\b/i;

const ceremonyOffenders = (body: string): string[] => {
  const lower = body.toLowerCase();
  return [
    ...CEREMONY_NAMES.filter((n) => lower.includes(n)),
    ...(SETUP_PITCH.test(body) ? ["a set-up-your-shopper pitch"] : []),
  ];
};

describe("SC4 — no path in the bundle asks for a created shopper", () => {
  it("no bundle file names the retired creation ceremony, or pitches setting a shopper up", () => {
    // The constraint is "the loop runs for any agent with the plugin; the creation
    // ceremony is never a precondition". Prose is the only carrier — an agent that reads
    // "set up your shopper first" stops the loop dead on a fresh install.
    const offenders: string[] = [];
    for (const rel of bundleFiles()) {
      for (const hit of ceremonyOffenders(read(rel))) offenders.push(`${rel} → ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it("guard-of-the-guard: the ceremony scan BITES on every name it lists, and on the pitch", () => {
    // A list entry that is present-but-unmatchable (upper-cased, mistyped) sits there
    // looking protective while catching nothing — the `sil_specs` failure, again.
    const notCaught = CEREMONY_NAMES.filter(
      (name) => ceremonyOffenders(`Then run ${name} to finish it.`).length === 0,
    );
    expect(notCaught).toEqual([]);
    expect(ceremonyOffenders("First, let me set up your shopper.")).not.toEqual([]);
    expect(ceremonyOffenders("Ask them to create your shopper before searching.")).not.toEqual([]);
  });

  it("SKILL.md states where the document comes from instead: `create` on the first saved fact", () => {
    // The positive half — without it the scan above passes vacuously over prose that
    // simply deleted the subject, and the agent is left with no instruction at all for
    // an empty disk. ONE statement, because an agent reads the sentence on its own.
    //
    // Scoped to `SKILL.md`, not the corpus, for the same reason `CORE_TOOLS` is: this is
    // what the agent must know BEFORE it loads anything. Corpus-scoped, the walkthrough
    // satisfied it alone — measured, by deleting this paragraph from SKILL.md and
    // watching the bar stay green over an example the agent may never open.
    const minting = splitStatements(skillSrc()).filter(
      (s) =>
        s.includes('ref: "shopper"')
        && s.includes('mode: "create"')
        && /first saved fact/i.test(s),
    );
    expect(minting.length).toBeGreaterThan(0);
  });

  it("SKILL.md says the `name` at that mint is the buyer's own, and never a placeholder", () => {
    // `shopping_doc_write` REQUIRES `name` on a shopper create, so prose that leaves it
    // unsaid invites an invented one — which lands on disk as the person's identity.
    const named = splitStatements(skillSrc()).filter(
      (s) => s.includes("sil_whoami") && /never a placeholder/i.test(s),
    );
    expect(named.length).toBeGreaterThan(0);
  });

  it("NO bundled prose names a bare sil bin — the one that ships, or the one that does not", () => {
    // `openclaw plugins install` links no bins, so a bare name reaches PATH only through
    // a global npm-style install. Not even as a disavowal: a model lifts the shortest
    // thing that looks like a command. The admission helper is named by absolute path,
    // which `lib/host-wiring.test.ts` holds on the doctor's side.
    const offenders: string[] = [];
    for (const rel of bundleFiles()) {
      for (const bin of ["sil-openclaw-allowlist", "sil-openclaw-create-shopper"]) {
        if (read(rel).includes(bin)) offenders.push(`${rel} → ${bin}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
// What the live draws bought. Two buyer rounds on the live web attributed four
// failures to this bundle's WORDING; each bar below REDs on the wording the draw
// ran against. The fifth, the playback line, is C3 in `eight-beat-loop`.
// ===========================================================================

describe("the live draws' share — wordings a buyer round measured", () => {
  it("L1 — the item's subsection is the buyer's OWN WORDS, ONE SENTENCE, and beat 5 sends it as it stands", () => {
    // Both draws compiled a specification into `query` — draw 2's ran to 60
    // first-person words — and the index answered guides, 0 candidates. "In the
    // buyer's own words" was read as "write the thing up".
    const subsections = beatStatements(1).filter((s) => /subsection/i.test(s));
    expect(subsections.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(subsections, (s) => /own words/i.test(s) && /one sentence/i.test(s)),
    ).toEqual([]);

    const query = beatStatements(5).filter((s) => /`query`/.test(s));
    expect(query.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(query, (s) => /subsection/i.test(s) && /as it stands/i.test(s)),
    ).toEqual([]);
  });

  it("L2 — a durable fact the buyer's own ask carries is written at FILL, cold, before the first search — and THIS job's budget is not one", () => {
    // Draw 2's buyer opened with "size 27.5 for advanced skier up to 300 euros", the
    // agent asked nothing, no document was written, and session 2 re-asked all three.
    // The budget is the other half: on the person, it follows them into the next job.
    const fill = beatStatements(3).filter(
      (s) => /\bASK\b/.test(s) && /durable|\bsize\b|\bfact\b/i.test(s),
    );
    expect(fill.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(fill, (s) => /\bcold\b|before [^.]{0,24}first search/i.test(s))).toEqual([]);

    const budget = beatStatements(3).filter((s) => /budget/i.test(s));
    expect(budget.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(budget, (s) => /brief/i.test(s) && /\bnot\b|\bnever\b/i.test(s))).toEqual([]);

    // …and the ALWAYS-LOADED router says it too. Beat 3's reference is loaded at the
    // moment of use; the rule that decides whether a document exists at all has to
    // reach an agent that never opened it.
    const router = splitStatements(skillSrc()).filter(
      (s) => /first ask|first answer/i.test(s) && /durable/i.test(s),
    );
    expect(router.length).toBeGreaterThan(0);
  });

  it("L3 — a relaxation the buyer does not choose is NOT taken: every hard row stands, and the best defensible reading settles a FACT", () => {
    // Draw 1: answered "go with your best reading and tell me what you assumed", the
    // agent raised the €300 HARD row to €400 and saved it. ASK's best-reading clause
    // reached a proposed widening, and beat 5's "a hard row is never relaxed" lost.
    const reading = beatStatements(4).filter((s) => /defensible reading/i.test(s));
    expect(reading.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(
      unsatisfied(reading, (s) => /relaxation|widening/i.test(s) && /\bnever\b|\bnot\b/i.test(s)),
    ).toEqual([]);

    const offered = beatStatements(6).filter((s) => /relaxation|widen/i.test(s));
    expect(offered.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(offered, (s) => /not a yes|hard rows? stands?/i.test(s))).toEqual([]);
  });

  it("L4 — a minted path names its ANCESTORS: a leaf hung on the root is a fork every later buyer inherits", () => {
    // Draw 2 minted `product.ski_boots` and `product.ski_helmets` on the root; draw 1
    // minted `product.sports.winter.ski.boots` from the same prompt. On a registry
    // holding only the root, a leaf on the root satisfies "descend".
    const coining = beatStatements(2).filter(
      (s) => /\bcoin|\bmint/i.test(s) && /\bpath\b/i.test(s),
    );
    expect(coining.length).toBeGreaterThan(0); // guard-of-the-guard
    expect(unsatisfied(coining, (s) => /ancestor/i.test(s) && /\broot\b/i.test(s))).toEqual([]);
  });
});
