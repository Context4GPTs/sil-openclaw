/**
 * INTEGRATION — the load-bearing CONTRACT of the sil-shopping skill bundle
 * (reads real files + real registration code). Replaces the deleted 1341-line
 * skill-content test, which pinned nearly every prose CLAUSE and so stayed
 * green through a live behavioral bug. Guards only what breaks the product if it
 * drifts — discoverability, the published name, the tool set, the retired
 * vocabulary, and the catalog-of-record forcing function — deriving facts from
 * source, never restating prose wording.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { registerIdentityTools } from "../tools/identity.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { registerDoctorTools } from "../tools/doctor.js";
import {
  createMockPluginApi,
  registeredToolNames,
} from "./helpers/mock-plugin-api.js";
import { categoryAsDomainOffenders } from "./helpers/domain-vocabulary.js";
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
  RETIRED_V0_PHRASES,
  RETIRED_V0_TOKENS,
} from "./helpers/honesty-vocabulary.js";
// The bundle's reading + SCOPING primitives, shared with
// `skill-rules.integration.test.ts` so the two prose guards cannot drift apart.
import {
  BUNDLE,
  REPO_ROOT,
  bundleCorpus,
  bundleEntries,
  bundleFiles,
  frontmatter,
  read,
  skillSection,
  skillSrc,
} from "./helpers/skill-bundle.js";

// The always-loaded router must name the whole journey, not half of it: the agent picks a
// tool by name at the moment of use, and a step whose tool is unnamed in SKILL.md is a
// step it will improvise around.
//
// This list is HAND-MAINTAINED and separate from the dynamic "every registered tool
// appears somewhere in the corpus" scan below: it is what forces a name into `SKILL.md`
// ITSELF rather than into some `references/` file the agent may never load.
// The brief and profile tools are here because the loop opens on `shopping_brief_read` and writes every want
// before its first search, so an agent that never loads a reference still has to know
// they exist. `sil_doctor` stays on the corpus scan — a repair verb reached from the
// routing table is enough.
const CORE_TOOLS = [
  "sil_register",
  "sil_whoami",
  "shopping_domain_search",
  "shopping_domain_get",
  "shopping_content",
  "shopping_brief_create",
  "shopping_brief_edit",
  "shopping_brief_read",
  "shopping_profile_edit",
  "shopping_search",
  "shopping_product_get",
  "shopping_offers",
  "shopping_seller_get",
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

  it("the bundle names NO tool outside the contract's surface — a dangling name is one the agent calls, fails, and has no recovery from", () => {
    // The reverse of the scan above, and the one it cannot do: a `shopping_reviews` or a
    // `sil_learn` invented in prose reads exactly like a real tool to the agent. Derived
    // from the registration code ALONE — every tool the contract signs is registered now,
    // so a name nobody registers reds with no allowance to hide behind.
    const allowed = new Set(registeredTools());
    const named = new Set(
      [...bundleCorpus().matchAll(/\b(?:sil|shopping)_[a-z_]+\b/g)].map((m) => m[0]),
    );
    expect([...named].filter((n) => !allowed.has(n)).sort()).toEqual([]);
    expect(named.size).toBeGreaterThan(CORE_TOOLS.length - 1); // guard-of-the-guard
  });

  it("the frontmatter description enumerates the registry read", () => {
    // The description is what the host shows BEFORE the body is loaded, so it is
    // the only text that decides whether the skill is reached at all.
    const { description } = frontmatter();
    expect(description).toContain("shopping_domain_search");
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

  it("AC16 — no bundle file reads `not_found` as an absence that licenses a write", () => {
    // AC15's other surface, through the ONE shared needle
    // (`helpers/honesty-vocabulary.ts`): the skill is what the agent reads before it
    // ever sees a tool description, so a perfectly qualified `shopping_brief_read`
    // description is undone by a reference file that still reads `not_found` as "the
    // brief is gone, so open another". Two guards, one rule — the same discipline that
    // keeps the honesty scans from drifting apart.
    //
    const offenders: string[] = [];
    for (const rel of bundleFiles()) {
      for (const s of notFoundLicenceOffenders(read(rel))) offenders.push(`${rel}: ${s}`);
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
      // "domain", never "category", for sil's registry concept (founder ruling
      // 2026-09-19). Same scan runs over the registered surface in
      // `tools/tool-schema-contract.unit.test.ts` — one module, two surfaces.
      for (const ctx of categoryAsDomainOffenders(body)) offenders.push(`${rel}: …${ctx}…`);
    }
    expect(offenders).toEqual([]);
  });

  it("guard-of-the-guard: the category scan BITES the registry sense and SPARES the generic one", () => {
    // A vocabulary scan that cannot tell "the category's guide" from "the web researches
    // a category" is either a blanket forbid nobody can keep green or a bar that matches
    // nothing. Both halves are proved here, on the two sentences the bundle actually has.
    expect(categoryAsDomainOffenders("read the category's guide first")).not.toEqual([]);
    expect(categoryAsDomainOffenders("send a category path with the specs")).not.toEqual([]);
    expect(categoryAsDomainOffenders("research how the category is bought")).toEqual([]);
    expect(categoryAsDomainOffenders("a shortlist about the category, not this buyer")).toEqual([]);
    expect(categoryAsDomainOffenders("the web researches a category; it supplies no pick")).toEqual([]);
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

  it("SKILL.md pins the catalog-of-record forcing function", () => {
    // RE-DERIVED on every rename, never deleted: take picks from the sil catalog rather
    // than the open web. Its anchors move with the wire each time, and leaving a retired
    // one here would make this bar and the retired-token scan mutually unsatisfiable.
    const src = skillSrc();
    expect(src).toContain("shopping_offers"); // where a listing URL legitimately comes from
    expect(src).toMatch(/open[ -]web/i); // never sourced from the open web
  });

  it("the naming discipline survives: a spec key is the domain's, sent verbatim", () => {
    // A synonym splits one concept into two specs that never meet. Over-excising the rule
    // turns nothing RED — the agent just quietly gets worse.
    const traps = skillSection("traps");
    expect(traps).toMatch(/synonym/i);
    expect(traps).toMatch(/keys verbatim/i);
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

  // The POSITIVE half of the two scans above — what a chat opens with instead of a
  // set-up turn — is `skill-rules.integration.test.ts`'s bar 5, statement-scoped inside
  // SKILL.md's own `## Start by reading`. A second copy here would be duplicate coverage.

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
