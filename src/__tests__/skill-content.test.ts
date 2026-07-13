/**
 * INTEGRATION — the SIX-BEAT Spec-Driven-Shopping skill ↔ registered-tool drift
 * guard (tier: integration — reads the real `sil-shopping/` bundle from disk and
 * compares it against the registered tool set + the resolved-fork invariants of the
 * spec-driven-shopping-redesign design doc).
 *
 * Card: spec-driven-shopping-redesign — Phase 1, Step B (the skill half).
 * THESE ASSERTIONS ARE THE SPEC (RED-first). Step A recast the store to
 * frontmatter-as-truth and shipped the 9-tool surface (`sil_remember` → `sil_learn`,
 * NEW `sil_profile_search`). This file pins the skill REWRITE: the sil-shopping
 * bundle becomes the **six-beat Spec-Driven-Shopping loop**, replacing the
 * superseded five-beat single-shopper model. It supersedes the old-store prose
 * wholesale — `profile.json`, `sil_remember`, the `domain_spec/intent_spec/playbook`
 * triple, and the `intent > playbook > user_spec > domain_spec` precedence are all
 * DELETED, asserted here by their absence.
 *
 * THE SIX BEATS (design-doc names, § "The loop (state machine)"):
 *   1. Classify / intent-resolve — three-level `{domain, product, intent}`;
 *      reuse-before-mint; never over-ask just to key; announce a mint.
 *   2. Method load / mint / refresh — HIT=load (hot path, no research);
 *      MISS=research+mint (coin niche vocab, born-canonical via sil_specs where the
 *      endpoint exists — coined-and-used raw until Phase 3); refresh is
 *      SIGNAL-DRIVEN (buyer contradiction · overdue volatility marker · explicit
 *      ask — not TTL, not every revisit); create-with-merge preserves every buyer
 *      `sil_learn` edit.
 *   3. Fill — method-driven elicitation to a filled PRD; precedence
 *      request-intent > PRD filled-pref > method taste > user_spec fact > method
 *      default; multi-turn until resolved-or-declined (never a battery);
 *      one-off-vs-standing on a durable conflict; hard constraints inviolable
 *      (route-to-filter + reject-at-pick); elicited durable answers persist NOW
 *      (the split — Beat 6 owns the reaction half).
 *   4. Search-space — project the filled PRD into a BOUNDED ≤4 priority-ordered
 *      searches, dedup + concatenate in issue order (NOT a re-rank).
 *   5. Reflect — honesty pass first (reject-at-pick `applied:false` hard
 *      predicates), then judge best-available vs PRD+method (judgment, not a
 *      threshold): satisfies → hero + 1–2 justified alternatives (never re-rank);
 *      shortfall/empty → propose a specific relaxation and WAIT (no silent
 *      re-search); non-`ok` → follow the tool `recovery`.
 *   6. Feedback — the reaction half; persist only what newly surfaced (durable AND
 *      new), per-reaction and confirmed before each write; route by scope
 *      (fact/hard→user_spec, durable taste→method, this-job→PRD, image→attach-asset);
 *      append/amend/retract; re-scope = write-broader-then-retract-narrower.
 *
 * CANONICAL BUNDLE LAYOUT (this file OWNS it — the expert builds to conform):
 *   SKILL.md                              lean router (six beats named, session-start
 *                                         admission, core tools, routes on demand)
 *   references/catalog_tools_reference.md the 4 core tools + shared status taxonomy
 *   references/shop_loop.md               the six-beat loop; owns Beat 1, 4, 5
 *   references/method_and_prds.md         Beat 2 + intent-PRD model + frontmatter-as-truth
 *                                         store + discovery/manage (search/get/remove)   [NEW]
 *   references/fill_and_feedback.md       Beat 3 + Beat 6 + the sil_learn write verb      [NEW]
 *   references/search_param_mapping.md    Beat-4 answer→param mapping (ship_to empty)
 *   references/agent_creation_engine.md   one-time shopper creation (setup-only materialize)
 *   references/brainstorm_interview.md    the two-touchpoint creation interview
 *   references/setup_onboarding.md        one-time onboarding (after-register + per-search pitch)
 *   examples/multi_domain_shopper_walkthrough.md   a worked six-beat run
 *   RETIRED (gone from disk + all cross-links): manage_domains.md, refine_shopper.md
 *
 * Anchors are structural (beats named in order), decisional (fork phrases,
 * OR-grouped so a reword survives), and tool-name — never brittle full sentences.
 * Do NOT weaken to match the markdown; the markdown is rewritten to satisfy this.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIdentityTools } from "../tools/identity.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { registerProfileTools } from "../tools/profile.js";
import {
  createMockPluginApi,
  registeredToolNames,
} from "./helpers/mock-plugin-api.js";
import {
  PER_NICHE_EXPERT_WORD,
  perNicheExpertOffenders,
} from "./helpers/per-niche-expert.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SKILL_DIR = join(REPO_ROOT, "sil-shopping");
const SKILL_PATH = join(SKILL_DIR, "SKILL.md");
const MANIFEST_PATH = join(REPO_ROOT, "openclaw.plugin.json");

// The canonical reference/example files (this file OWNS the layout).
const CATALOG_TOOLS_PATH = join(SKILL_DIR, "references", "catalog_tools_reference.md");
const SHOP_LOOP_PATH = join(SKILL_DIR, "references", "shop_loop.md");
const METHOD_PRDS_PATH = join(SKILL_DIR, "references", "method_and_prds.md");
const FILL_FEEDBACK_PATH = join(SKILL_DIR, "references", "fill_and_feedback.md");
const MAPPING_PATH = join(SKILL_DIR, "references", "search_param_mapping.md");
const ENGINE_PATH = join(SKILL_DIR, "references", "agent_creation_engine.md");
const BRAINSTORM_PATH = join(SKILL_DIR, "references", "brainstorm_interview.md");
const SETUP_ONBOARDING_PATH = join(SKILL_DIR, "references", "setup_onboarding.md");
const EXAMPLE_PATH = join(SKILL_DIR, "examples", "multi_domain_shopper_walkthrough.md");

/** The five-beat filenames this card RETIRES — absorbed into method_and_prds.md
 * (manage) + fill_and_feedback.md (refine). Gone from disk AND every cross-link. */
const RETIRED_FILENAMES = ["manage_domains.md", "refine_shopper.md"] as const;

/** Deleted-store tokens: the manifest + the domain_spec/intent_spec/playbook triple
 * the recast removed. A shopping-loop prose that still names them points the skill
 * at a store shape that no longer exists. (`intent_spec`/`domain_spec` carry the
 * underscore, so the live vocabulary "intent"/"domain" is never tripped.) */
const DELETED_STORE_TOKENS = ["profile.json", "domain_spec", "intent_spec", "playbook.md"] as const;

/** Deleted / never-existed tool names — must be absent from the whole bundle. */
const DELETED_TOOLS = ["sil_remember", "sil_profile_list", "sil_ping", "sil_echo"] as const;

interface Frontmatter {
  raw: string;
  fields: Record<string, string>;
}

/** Extract + validate the leading `--- ... ---` frontmatter block. Throws on a
 * structurally-invalid block (no opening fence at byte 0, no closing fence, empty
 * body) — so "parses" is a real assertion. */
function parseFrontmatter(content: string): Frontmatter {
  if (!content.startsWith("---")) {
    throw new Error("SKILL.md does not open with a `---` frontmatter fence");
  }
  const closeMatch = content.slice(3).match(/\n---[ \t]*\r?\n/);
  if (!closeMatch || closeMatch.index === undefined) {
    throw new Error("SKILL.md frontmatter has no closing `---` fence");
  }
  const raw = content.slice(3, 3 + closeMatch.index).trim();
  if (raw.length === 0) {
    throw new Error("SKILL.md frontmatter block is empty");
  }
  const fields: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m && m[2] !== "") {
      fields[m[1]!] = m[2]!.replace(/^["']|["']$/g, "").trim();
    }
  }
  return { raw, fields };
}

function skillBody(content: string): string {
  const closeMatch = content.slice(3).match(/\n---[ \t]*\r?\n/);
  if (!closeMatch || closeMatch.index === undefined) return content;
  return content.slice(3 + closeMatch.index + closeMatch[0].length);
}

/** Read a skill file's body below its frontmatter. A file that does not exist yet
 * (a NEW reference during RED) reads as "" so the bundle-wide scans never throw —
 * existence is asserted separately. */
function readBody(path: string): string {
  if (!existsSync(path)) return "";
  const content = readFileSync(path, "utf8");
  return content.startsWith("---") ? skillBody(content) : content;
}

/** The names the real register code emits (identity + catalog + profile groups) —
 * the REAL ten-tool surface (the sds-specs-client-tool card added sil_specs to the
 * catalog group, beside sil_learn + sil_profile_search from the prior card). */
function registeredNames(): Set<string> {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerProfileTools(api);
  return registeredToolNames(api);
}

/** Every bundle file's [label, path] (drives the bundle-wide scans). */
const BUNDLE_FILES: ReadonlyArray<readonly [string, string]> = [
  ["SKILL.md", SKILL_PATH],
  ["catalog_tools_reference.md", CATALOG_TOOLS_PATH],
  ["shop_loop.md", SHOP_LOOP_PATH],
  ["method_and_prds.md", METHOD_PRDS_PATH],
  ["fill_and_feedback.md", FILL_FEEDBACK_PATH],
  ["search_param_mapping.md", MAPPING_PATH],
  ["agent_creation_engine.md", ENGINE_PATH],
  ["brainstorm_interview.md", BRAINSTORM_PATH],
  ["setup_onboarding.md", SETUP_ONBOARDING_PATH],
  ["multi_domain_shopper_walkthrough.md", EXAMPLE_PATH],
];

/** The whole bundle as one corpus (router + every reference + example). Under
 * progressive disclosure the BUNDLE owns the surface — a decision may live in the
 * file that owns its beat, not forced into the lean router. */
function bundleCorpus(): string {
  return BUNDLE_FILES.map(([, p]) => readBody(p)).join("\n");
}

/* ===========================================================================
 * DISCOVERABILITY + FRONTMATTER — the six-beat SKILL.md router
 * ========================================================================= */

describe("sil-shopping/SKILL.md — discoverability", () => {
  it("exists at sil-shopping/SKILL.md", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("has frontmatter that parses (valid open + close fences, non-empty body)", () => {
    expect(() => parseFrontmatter(readFileSync(SKILL_PATH, "utf8"))).not.toThrow();
  });

  it("exposes a non-empty `name` and `description` in frontmatter", () => {
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    expect((fm.fields["name"] ?? "").length).toBeGreaterThan(0);
    expect((fm.fields["description"] ?? "").length).toBeGreaterThan(0);
  });
});

describe("sil-shopping/SKILL.md — frontmatter drives the TEN tools + shopper/domain model, no expert / deleted-tool vocab", () => {
  it("frontmatter `name` equals the published basename `sil-shopping` (not the plugin id `sil`)", () => {
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    expect(fm.fields["name"]).toBe("sil-shopping");
    expect(fm.fields["name"]).not.toBe("sil");
  });

  it("frontmatter `description` enumerates the TEN sil_* tools it drives, and NOT the deleted sil_profile_list / sil_remember", () => {
    // TOOL-SET MIRROR #6 — add-only, kept exact. The sds-specs-client-tool card ADDS
    // sil_specs (the coin/dedupe/register canonicalization primitive the method drives
    // at Beat 2), paired with the SKILL.md frontmatter `description` edit — so this
    // presence pin stays RED until the description names sil_specs.
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    const description = fm.fields["description"] ?? "";
    const missing = [
      "sil_register",
      "sil_whoami",
      "sil_search",
      "sil_product_get",
      "sil_profile_materialize",
      "sil_profile_get",
      "sil_profile_remove",
      "sil_learn",
      "sil_profile_search",
      "sil_specs",
    ].filter((t) => !description.includes(t));
    expect(missing).toEqual([]);
    expect(description).not.toContain("sil_profile_list");
    expect(description).not.toContain("sil_remember");
  });

  it("frontmatter `description` presents the SHOPPER + DOMAIN model, no per-niche-expert vocabulary", () => {
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    const description = fm.fields["description"] ?? "";
    expect(description.toLowerCase()).toContain("shopper");
    expect(description.toLowerCase()).toContain("domain");
    expect(PER_NICHE_EXPERT_WORD.test(description)).toBe(false);
  });
});

/* ===========================================================================
 * NAME-AGREEMENT DRIFT GUARD — the skill's PUBLISHED name is ONE value across the
 * manifest + SKILL.md, and never the plugin id. (Unchanged invariant.)
 * ========================================================================= */

interface SkillManifest {
  id: string;
  skills: string[];
}
function readSkillManifest(): SkillManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as SkillManifest;
}

describe("skill name-agreement drift guard — one published name across manifest + SKILL.md, never the plugin id", () => {
  it("basename(openclaw.plugin.json#skills[0]) EQUALS the SKILL.md frontmatter `name`", () => {
    const manifest = readSkillManifest();
    expect(Array.isArray(manifest.skills)).toBe(true);
    expect(manifest.skills.length).toBeGreaterThan(0);
    const manifestSkillName = basename(manifest.skills[0]!);
    const frontmatterName = parseFrontmatter(readFileSync(SKILL_PATH, "utf8")).fields["name"];
    expect(manifestSkillName).toBe(frontmatterName);
  });

  it("the published skill name is NOT the plugin id (the conflation this guards)", () => {
    const manifest = readSkillManifest();
    expect(manifest.id).toBe("sil");
    expect(basename(manifest.skills[0]!)).not.toBe(manifest.id);
  });
});

/* ===========================================================================
 * BUNDLE — the ten-tool surface, deleted-token retirement, canonical file set
 * ========================================================================= */

describe("skill bundle — source of truth for the ten-tool surface", () => {
  it("registeredNames() equals TEN (the four core tools + the five sil_profile_* / sil_learn verbs + sil_specs)", () => {
    // TOOL-SET MIRROR #6 (count). Add-only, kept exact — the sds-specs-client-tool
    // card added sil_specs to the catalog group (9 → 10).
    const names = registeredNames();
    expect(names.size, `registered tools: ${[...names].sort().join(", ")}`).toBe(10);
    expect(names.has("sil_learn")).toBe(true);
    expect(names.has("sil_profile_search")).toBe(true);
    expect(names.has("sil_specs")).toBe(true);
    expect(names.has("sil_remember")).toBe(false);
    expect(names.has("sil_profile_list")).toBe(false);
  });

  it("names EVERY registered real tool somewhere in the bundle (router or the reference that owns it)", () => {
    const corpus = bundleCorpus();
    const missing = [...registeredNames()].filter((name) => !corpus.includes(name));
    expect(missing).toEqual([]);
  });

  it("names the four core tools in the LEAN router itself (the always-loaded entry point)", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    for (const tool of ["sil_register", "sil_whoami", "sil_search", "sil_product_get"]) {
      expect(body).toContain(tool);
    }
  });

  it("NO bundle file names a DELETED tool (sil_remember / sil_profile_list / sil_ping / sil_echo)", () => {
    // sil_remember was renamed to sil_learn (Step A) — a lingering mention routes
    // the skill at a nonexistent tool. Grepped to zero bundle-wide.
    const offenders: string[] = [];
    for (const [label, path] of BUNDLE_FILES) {
      const body = readBody(path);
      for (const dead of DELETED_TOOLS) {
        if (body.includes(dead)) offenders.push(`${label} → ${dead}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("NO bundle file names a DELETED-store token (profile.json / domain_spec / intent_spec / playbook.md)", () => {
    // The store recast deletes the manifest + the domain_spec/intent_spec/playbook
    // triple. A shopping-loop prose that still references them points at a store
    // shape that no longer exists.
    const offenders: string[] = [];
    for (const [label, path] of BUNDLE_FILES) {
      const body = readBody(path);
      for (const dead of DELETED_STORE_TOKENS) {
        if (body.includes(dead)) offenders.push(`${label} → ${dead}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("carries NO per-niche-expert user-facing vocabulary (whole-word `expert`, scan derived from BUNDLE_FILES)", () => {
    const offenders: string[] = [];
    for (const [label, path] of BUNDLE_FILES) {
      for (const ctx of perNicheExpertOffenders(readBody(path))) offenders.push(`${label}: …${ctx}…`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("skill bundle — the six-beat restructure: new reference files exist; the five-beat files are retired", () => {
  it("the canonical six-beat reference files EXIST on disk (shop_loop + method_and_prds + fill_and_feedback)", () => {
    const problems: string[] = [];
    for (const p of [SHOP_LOOP_PATH, METHOD_PRDS_PATH, FILL_FEEDBACK_PATH]) {
      if (!existsSync(p)) problems.push(`missing canonical reference: ${p}`);
    }
    expect(problems).toEqual([]);
  });

  it("the retired five-beat files (manage_domains.md / refine_shopper.md) are GONE from disk", () => {
    const stale: string[] = [];
    for (const name of RETIRED_FILENAMES) {
      const p = join(SKILL_DIR, "references", name);
      if (existsSync(p)) stale.push(p);
    }
    expect(stale).toEqual([]);
  });

  it("NO bundle file cross-links a retired filename (the rename blast radius grepped to zero)", () => {
    const offenders: string[] = [];
    for (const [label, path] of BUNDLE_FILES) {
      const body = readBody(path);
      for (const old of RETIRED_FILENAMES) {
        if (body.includes(old)) offenders.push(`${label} → ${old}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ===========================================================================
 * CATALOG + IDENTITY TOOLS REFERENCE — per-tool behaviour + shared status taxonomy
 * (delegated from the lean router; niche-agnostic, model-neutral). Unchanged.
 * ========================================================================= */

describe("references/catalog_tools_reference.md — per-tool behaviour + shared status taxonomy", () => {
  it("exists on disk", () => {
    expect(existsSync(CATALOG_TOOLS_PATH)).toBe(true);
  });

  it("documents the per-tool behaviour of all four core tools + the key catalog fields", () => {
    const body = readBody(CATALOG_TOOLS_PATH).toLowerCase();
    for (const tool of ["sil_register", "sil_whoami", "sil_search", "sil_product_get"]) {
      expect(body).toContain(tool);
    }
    for (const field of ["awaiting_browser", "cursor", "not_found", "checkout_url"]) {
      expect(body).toContain(field);
    }
  });

  it("holds the shared status taxonomy (all six statuses + the recovery rule)", () => {
    const body = readBody(CATALOG_TOOLS_PATH).toLowerCase();
    const missing = [
      "ok",
      "not_registered",
      "must_reregister",
      "forbidden",
      "invalid_request",
      "retryable",
    ].filter((s) => !body.includes(s));
    expect(missing).toEqual([]);
    expect(body).toContain("recovery");
  });

  it("is the SHOPPING-tools reference — does NOT carry the agent-creation procedure", () => {
    const body = readBody(CATALOG_TOOLS_PATH).toLowerCase();
    expect(body).not.toContain("openclaw agents add");
    expect(body).not.toContain("sil_profile_materialize");
  });
});

/* ===========================================================================
 * LEAN ROUTER — progressive disclosure: names the six beats, routes to the
 * references (they exist), inlines NO detail, carries NO contributor content.
 * ========================================================================= */

describe("sil-shopping/SKILL.md — lean router routes to the canonical references", () => {
  it("routes to the six-beat loop + the beat references + creation path by relative path", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const expected = [
      "references/catalog_tools_reference.md",
      "references/shop_loop.md",
      "references/method_and_prds.md",
      "references/fill_and_feedback.md",
      "references/agent_creation_engine.md",
      "references/brainstorm_interview.md",
      "examples/multi_domain_shopper_walkthrough.md",
    ];
    expect(expected.filter((rel) => !body.includes(rel))).toEqual([]);
  });

  it("every references/… and examples/… path SKILL.md mentions EXISTS on disk", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const referenced = [...body.matchAll(/(references|examples)\/[A-Za-z0-9_./-]+\.md/g)].map((m) => m[0]);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((rel) => !existsSync(join(SKILL_DIR, rel)))).toEqual([]);
  });

  it("advertises the SIX-BEAT Spec-Driven-Shopping loop and routes its detail to shop_loop.md (lean — the beats live in the reference)", () => {
    // Progressive disclosure: the LEAN router makes the six-beat loop legible + routes
    // to the reference that OWNS the beat detail. The authoritative "six beats named
    // in order" pin lives in shop_loop.md (below), not inlined here. `six-beat` is
    // net-new (absent from the whole bundle today → RED).
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    // `six-beat` is net-new (absent from the whole bundle today). The pre-existing
    // "Spec-Driven Shopping loop" phrase must NOT satisfy this — the router has to
    // advertise the SIX-beat structure specifically.
    const advertisesSixBeatLoop = body.includes("six-beat") || body.includes("six beat");
    expect(advertisesSixBeatLoop).toBe(true);
    expect(body).toContain("references/shop_loop.md");
  });

  it("keeps the router LEAN — no inlined status taxonomy, host-CLI steps, or contributor content", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    // taxonomy lives in catalog_tools_reference.md, not the router
    for (const t of ["awaiting_browser", "not_registered", "must_reregister", "retryable"]) {
      expect(body).not.toContain(t);
    }
    // host-CLI creation steps live in the engine reference
    expect(body).not.toContain("openclaw agents add");
    expect(body).not.toContain("openclaw config validate");
    // contributor "how to add a tool" content never ships in the runtime skill
    for (const c of ["registerxtools", "contracts.tools", "adding a real tool", "adding a tool"]) {
      expect(body).not.toContain(c);
    }
  });

  it("Session start retains the admission self-heal branch (missing sil_* → the shipped helper, not a dead-end)", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const heading = "## Session start";
    const start = body.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = body.slice(start + heading.length);
    const nextHeading = rest.indexOf("\n## ");
    const section = (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest).toLowerCase();
    const present = ALLOWLIST_HELPER_TOKENS.filter((t) => section.includes(t));
    expect(present).not.toEqual([]);
    expect(section.includes("consult") && section.includes("and stop")).toBe(false);
  });
});

/* ===========================================================================
 * BEAT 1 + 4 + 5 — the shop_loop.md six-beat loop.
 * ========================================================================= */

function shopLoopLower(): string {
  return readBody(SHOP_LOOP_PATH).toLowerCase();
}

describe("references/shop_loop.md — the six-beat loop state machine (names all six beats, in order)", () => {
  it("exists on disk", () => {
    expect(existsSync(SHOP_LOOP_PATH)).toBe(true);
  });

  it("names all SIX beats in loop order (classify → method → fill → search-space → reflect → feedback)", () => {
    const body = shopLoopLower();
    const beatIdx = [
      /classif|intent-resolve|intent resolve/,
      /method (?:load|mint|refresh|load\/mint)|load \/ mint|load\/mint\/refresh|beat 2/,
      /\bfill\b|elicit/,
      /search-space|search space|bounded|fan-out|fan out|≤ ?4|four searches/,
      /reflect/,
      /feedback|reaction/,
    ].map((re) => {
      const m = re.exec(body);
      return m ? m.index : -1;
    });
    expect(beatIdx.every((i) => i >= 0), `shop_loop must name all six beats: ${JSON.stringify(beatIdx)}`).toBe(true);
    for (let i = 1; i < beatIdx.length; i++) {
      expect(beatIdx[i]!, `beat ${i + 1} must follow beat ${i}`).toBeGreaterThan(beatIdx[i - 1]!);
    }
  });
});

describe("references/shop_loop.md — Beat 1: classify {domain, product, intent} → reuse-before-mint (never over-ask to key, announce a mint)", () => {
  it("resolves the three coordinates domain → product → intent (intent ALWAYS present — a context-free request keys `general`)", () => {
    const body = shopLoopLower();
    for (const coord of ["domain", "product", "intent"]) {
      expect(body).toContain(coord);
    }
    // The NEW three-level classification: intent is always present; a context-free
    // request keys `general`. `context-free`/`always present` are net-new (absent
    // today), so a stray "general"/"default" mention can no longer false-green this.
    const namesGeneralAsContextFree =
      body.includes("general") &&
      (body.includes("context-free") || body.includes("context free") ||
        body.includes("always present") || body.includes("always-present") ||
        body.includes("intent is always"));
    expect(namesGeneralAsContextFree).toBe(true);
  });

  it("REUSES an existing domain / PRD before minting — semantic match via sil_profile_search (not the deleted manifest)", () => {
    const body = shopLoopLower();
    const reuseBeforeMint =
      body.includes("reuse-before-mint") ||
      (body.includes("reuse") && (body.includes("before mint") || body.includes("before minting")));
    expect(reuseBeforeMint).toBe(true);
    // Discovery is the frontmatter-as-truth query tool, NOT a filesystem/manifest guess.
    expect(body).toContain("sil_profile_search");
    const semantic = body.includes("semantic") || body.includes("prefer existing") || body.includes("prefer-existing");
    expect(semantic).toBe(true);
  });

  it("ANNOUNCES a new-domain / new-PRD mint (inferred coordinates stated so the buyer can correct) — never silent", () => {
    const body = shopLoopLower();
    const announces = body.includes("announce") || body.includes("announced");
    const correctable = body.includes("correct") || body.includes("so the buyer") || body.includes("so the user");
    const neverSilent = body.includes("never silent") || body.includes("not silent") || (body.includes("announce") && body.includes("never"));
    expect(announces).toBe(true);
    expect(correctable).toBe(true);
    expect(neverSilent).toBe(true);
  });

  it("does NOT over-ask just to key — keying never forces an extra question (a silent request keys `general`)", () => {
    const body = shopLoopLower();
    // `over-ask`/`over ask` is net-new (absent today), so this can no longer
    // false-green on an unrelated "general"/"silent" mint mention.
    const namesOverAsk = body.includes("over-ask") || body.includes("over ask");
    const negated = body.includes("never") || body.includes("not ") || body.includes("no ");
    expect(namesOverAsk && negated).toBe(true);
  });
});

describe("references/shop_loop.md — Beat 4: a BOUNDED ≤4 priority-ordered fan-out, concatenated in issue order (NOT a re-rank)", () => {
  it("decomposes into ≤ 4 priority-ordered sil_search calls (core first, widenings after) — a production budget", () => {
    const body = shopLoopLower();
    expect(body).toContain("sil_search");
    const boundedFour =
      body.includes("≤ 4") || body.includes("≤4") || body.includes("<= 4") ||
      body.includes("at most 4") || body.includes("up to 4") || body.includes("four searches") ||
      (body.includes("bounded") && body.includes("4"));
    expect(boundedFour).toBe(true);
    const priorityOrdered =
      body.includes("priority order") || body.includes("priority-order") ||
      (body.includes("core first") && (body.includes("widen") || body.includes("widening")));
    expect(priorityOrdered).toBe(true);
  });

  it("merges by dedup + CONCATENATE in issue order — explicitly NOT a re-rank (the engine owns order within each call)", () => {
    const body = shopLoopLower();
    const concatIssueOrder =
      (body.includes("concat") || body.includes("concatenate")) &&
      (body.includes("issue order") || body.includes("issue-order"));
    expect(concatIssueOrder).toBe(true);
    const notRerank =
      body.includes("never re-rank") || body.includes("not re-rank") || body.includes("not a re-rank") ||
      (body.includes("re-rank") && body.includes("never"));
    expect(notRerank).toBe(true);
    const dedup = body.includes("dedup") || body.includes("already seen") || body.includes("drop") ;
    expect(dedup).toBe(true);
  });

  it("projects onto EXISTING params + query enrichment now (leaves ship_to empty; never invents a filter)", () => {
    const body = shopLoopLower();
    const projectsExisting =
      body.includes("existing") && (body.includes("param") || body.includes("category") || body.includes("price"));
    expect(projectsExisting || body.includes("query enrichment") || body.includes("query-enrichment")).toBe(true);
    expect(body).toContain("ship_to");
    const neverInvents =
      body.includes("never invent") || body.includes("not invent") || (body.includes("invent") && body.includes("filter"));
    expect(neverInvents).toBe(true);
  });
});

describe("references/shop_loop.md — Beat 5: reflect (honesty pass first, judgment not threshold, hero + alternatives, propose-and-wait)", () => {
  it("runs the HONESTY PASS first — reject-at-pick any hard predicate the backend left `applied:false` (+ user_spec hard)", () => {
    const body = shopLoopLower();
    // `honesty pass` + `applied:false` are net-new (absent today), so the preserved
    // `reject-at-pick` / `hard constraint` vocabulary can no longer false-green this:
    // the NEW Beat-5 structure is a distinct honesty pass over the applied:false set.
    const honestyPass = body.includes("honesty pass") || body.includes("honesty-pass");
    expect(honestyPass).toBe(true);
    const rejectAtPick = body.includes("reject-at-pick") || body.includes("reject at pick");
    expect(rejectAtPick).toBe(true);
    const namesAppliedFalse =
      body.includes("applied:false") || body.includes("applied: false") || body.includes("applied false");
    expect(namesAppliedFalse).toBe(true);
  });

  it("judges best-available vs PRD+method as a JUDGMENT CALL, not a threshold / mechanical any-unmet rule", () => {
    const body = shopLoopLower();
    const judgmentNotThreshold =
      body.includes("judgment") &&
      (body.includes("not a threshold") || body.includes("never a threshold") ||
        body.includes("not a mechanical") || body.includes("not mechanical"));
    expect(judgmentNotThreshold).toBe(true);
  });

  it("satisfies → a HERO + 1–2 justified alternatives (best-first as returned, never a bare list, never re-rank)", () => {
    const body = shopLoopLower();
    const heroPlusAlternatives =
      (body.includes("hero") || body.includes("one recommendation") || body.includes("lead with one")) &&
      (body.includes("alternative") || body.includes("1–2") || body.includes("1-2") || body.includes("one or two"));
    expect(heroPlusAlternatives).toBe(true);
    const notRerank =
      body.includes("never re-rank") || body.includes("not re-rank") || (body.includes("re-rank") && body.includes("never"));
    expect(notRerank).toBe(true);
  });

  it("shortfall OR empty → propose a SPECIFIC relaxation and WAIT — no silent re-search; non-ok → follow the tool recovery", () => {
    const body = shopLoopLower();
    const proposeAndWait =
      (body.includes("propose") && body.includes("wait")) ||
      body.includes("propose-and-wait") || body.includes("propose and wait");
    expect(proposeAndWait).toBe(true);
    const noSilentReSearch =
      body.includes("no silent re-search") || body.includes("never silently re-search") ||
      body.includes("no silent auto-widen") || body.includes("never auto-widen") ||
      (body.includes("silent") && (body.includes("re-search") || body.includes("widen")));
    expect(noSilentReSearch).toBe(true);
    expect(body).toContain("recovery");
  });
});

/* ===========================================================================
 * BEAT 2 — method_and_prds.md: method load/mint/refresh + intent-PRD +
 * frontmatter-as-truth store + discovery/manage.
 * ========================================================================= */

function methodPrdsLower(): string {
  return readBody(METHOD_PRDS_PATH).toLowerCase();
}

describe("references/method_and_prds.md — Beat 2: method load (hot path) vs research+mint vs SIGNAL-DRIVEN refresh", () => {
  it("exists on disk", () => {
    expect(existsSync(METHOD_PRDS_PATH)).toBe(true);
  });

  it("HIT = LOAD the durable method (hot path — no research, no round-trip); a plain revisit LOADS, never rebuilds", () => {
    const body = methodPrdsLower();
    const loadHotPath =
      (body.includes("load") && (body.includes("hot path") || body.includes("hot-path"))) ||
      (body.includes("load") && body.includes("no research"));
    expect(loadHotPath).toBe(true);
    expect(body).toContain("sil_profile_get");
    const recoveredNotRebuilt =
      body.includes("recovered, never rebuilt") || body.includes("never rebuilt") ||
      body.includes("not rebuilt") || (body.includes("revisit") && body.includes("load"));
    expect(recoveredNotRebuilt).toBe(true);
  });

  it("MISS = research + mint — coin the niche's whole-domain spec vocabulary (coined-and-used raw until Phase 3)", () => {
    const body = methodPrdsLower();
    const researchAndMint = body.includes("research") && body.includes("mint");
    expect(researchAndMint).toBe(true);
    const coinsVocab =
      body.includes("coin") && (body.includes("vocabulary") || body.includes("spec") || body.includes("ns.key"));
    expect(coinsVocab).toBe(true);
    // sil_specs is a barred stub until Phase 3 — coined-and-used raw now (never a stub call).
    const coinedRawNow =
      body.includes("coined-and-used raw") || body.includes("coined and used raw") ||
      body.includes("phase 3") || body.includes("applied:false") ||
      (body.includes("sil_specs") && (body.includes("not") || body.includes("until") || body.includes("skip")));
    expect(coinedRawNow).toBe(true);
  });

  it("MINT coins CONVERGENCE-FRIENDLY — reuse-your-own-name (one concept, one spelling), the CONVENTIONAL name for a common concept, framed by the all-fields WHY + the corroborating `description`", () => {
    // CARD advise-spec-convergence-in-shopper-skill — the PROACTIVE convergence-aid
    // coining discipline #57 did NOT ship. #57 taught the agent to REACT to `sil_specs`
    // (adopt the canonical `ns.key` it returns); this pins how to COIN so the
    // dedupe-or-create returns `matched` (converged) instead of forking a fresh
    // `created` row. ADD-ONLY on the MISS assertion above — leaves #57's
    // canonicalize-before-persist + the ten-tool pins byte-for-byte intact.
    //
    // Every anchor below is NET-NEW (grep-0 across the whole sil-shopping bundle
    // today: conventional / "one concept" / display_name / data_type / namespace /
    // precision-first / "all fields" / corroborat), so this is genuinely RED until the
    // convergence-aid prose lands — it CANNOT false-green off #57's pre-existing
    // `matched` / `converge` / `synonym` / `description`(word) mentions.
    const body = methodPrdsLower();

    // AC#1 — reuse your OWN coined name for a concept across domains (one concept, one
    // spelling): keep the same coined SpecDefinition fields (display_name + data_type,
    // the real frozen-wire tokens) rather than re-spelling the concept per domain.
    const oneConceptOneSpelling =
      body.includes("one concept") ||
      body.includes("reuse the same") || body.includes("reuse your") ||
      (body.includes("consistent") && (body.includes("across") || body.includes("every")));
    expect(oneConceptOneSpelling).toBe(true);
    const reusesTheCoinedFields = body.includes("display_name") && body.includes("data_type");
    expect(reusesTheCoinedFields).toBe(true);

    // AC#2 — a common/widely-shared concept it has NOT coined before takes the
    // CONVENTIONAL name, not an idiosyncratic personal synonym.
    const conventionalForCommon =
      body.includes("conventional") &&
      (body.includes("common") || body.includes("widely") || body.includes("shared"));
    expect(conventionalForCommon).toBe(true);

    // AC#2 (the WHY) — convergence keys on EVERY spec field agreeing within a `namespace`
    // + `data_type` (precision-first), so consistent + conventional naming is the lever
    // that tips a coin to `matched` instead of a fresh fragment. Determiner-tolerant
    // (every/each field · all its/their/the fields) so a benign reword survives; the
    // "all…fields / every field" phrase is net-new (grep-0 in HEAD) → still RED there.
    const allFieldsWhy =
      (/(?:every|each) (?:coined |spec )?field/.test(body) ||
        /all (?:its |their |the |of its |of their )?(?:coined |spec )?fields/.test(body)) &&
      (body.includes("namespace") || body.includes("precision-first") || body.includes("precision first"));
    expect(allFieldsWhy).toBe(true);

    // AC#3 — carry a concept-naming `description` as the load-bearing CORROBORATOR (the
    // signal that merges true synonyms, and the veto that keeps distinct concepts apart).
    // `corroborat*` is net-new (grep-0 in HEAD); the fallback still requires the
    // `description` FIELD framed by a merge/veto role, never bare "description".
    const corroboratingDescription =
      body.includes("corroborat") ||
      (body.includes("description") &&
        (body.includes("veto") || body.includes("merge true synonym") ||
          body.includes("distinguish") || body.includes("disambiguat")));
    expect(corroboratingDescription).toBe(true);
  });

  it("mints via `sil_learn create` (target method), NOT the setup-only sil_profile_materialize (no domain-mint on materialize)", () => {
    const body = methodPrdsLower();
    // The mint verb is sil_learn create — the old materialize-with-a-domain-object mint is DELETED.
    expect(body).toContain("sil_learn");
    const mintsViaLearn =
      (body.includes("sil_learn") && body.includes("create")) &&
      (body.includes("method") || body.includes("mint"));
    expect(mintsViaLearn).toBe(true);
    const materializeIsSetupOnly =
      body.includes("setup-only") || body.includes("setup only") ||
      (body.includes("sil_profile_materialize") && (body.includes("not") || body.includes("never") || body.includes("only the")));
    expect(materializeIsSetupOnly).toBe(true);
  });

  it("REFRESH is SIGNAL-DRIVEN — buyer contradiction · overdue volatility marker · explicit ask — NOT TTL, NOT every revisit", () => {
    const body = methodPrdsLower();
    const signalDriven =
      body.includes("signal-driven") || body.includes("signal driven") ||
      (body.includes("contradict") && (body.includes("volatility") || body.includes("marker") || body.includes("explicit")));
    expect(signalDriven).toBe(true);
    const namesTheThreeSignals =
      (body.includes("contradict")) &&
      (body.includes("volatility") || body.includes("marker")) &&
      (body.includes("explicit ask") || body.includes("asks") || body.includes("explicit"));
    expect(namesTheThreeSignals).toBe(true);
    const notTtlNotEveryRevisit =
      (body.includes("not ttl") || body.includes("no ttl") || body.includes("never a ttl")) ||
      (body.includes("not every revisit") || body.includes("never every revisit") || body.includes("not on every revisit"));
    expect(notTtlNotEveryRevisit).toBe(true);
  });

  it("CREATE-WITH-MERGE preserves every buyer `sil_learn` edit verbatim on a refresh (never clobbers a buyer edit)", () => {
    const body = methodPrdsLower();
    const createWithMerge =
      body.includes("create-with-merge") || body.includes("create with merge") ||
      (body.includes("merge") && (body.includes("verbatim") || body.includes("preserve")));
    expect(createWithMerge).toBe(true);
    const preservesBuyerEdits =
      (body.includes("preserve") || body.includes("carry") || body.includes("honor") || body.includes("honour")) &&
      (body.includes("buyer") || body.includes("sil_learn edit") || body.includes("edit"));
    expect(preservesBuyerEdits).toBe(true);
    const neverClobbers =
      body.includes("never clobber") || body.includes("not clobber") || body.includes("never overwrite a buyer");
    expect(neverClobbers).toBe(true);
  });
});

describe("references/method_and_prds.md — intent-keyed PRDs + frontmatter-as-truth store + discovery/manage", () => {
  it("keys PRDs by {domain, product, intent} — one durable, revisitable requirements doc per job", () => {
    const body = methodPrdsLower();
    expect(body).toContain("prd");
    const keyedByThree =
      (body.includes("domain") && body.includes("product") && body.includes("intent"));
    expect(keyedByThree).toBe(true);
    const durableRevisitable =
      body.includes("durable") && (body.includes("revisit") || body.includes("recover"));
    expect(durableRevisitable).toBe(true);
  });

  it("discovery is FRONTMATTER-AS-TRUTH via sil_profile_search (coordinates, no bodies) — no manifest, no filesystem guess", () => {
    const body = methodPrdsLower();
    expect(body).toContain("sil_profile_search");
    const frontmatterAsTruth =
      body.includes("frontmatter") && (body.includes("scan") || body.includes("truth") || body.includes("coordinates"));
    expect(frontmatterAsTruth).toBe(true);
    const noManifest =
      body.includes("no manifest") || body.includes("not a manifest") || body.includes("no `profile.json`") || body.includes("without a manifest");
    expect(noManifest).toBe(true);
  });

  it("manages with sil_profile_get (read one body) and sil_profile_remove (whole domain OR one PRD), confirm-before-remove", () => {
    const body = methodPrdsLower();
    for (const tool of ["sil_profile_get", "sil_profile_remove"]) {
      expect(body).toContain(tool);
    }
    const removesDomainOrPrd =
      (body.includes("whole domain") || body.includes("entire domain")) &&
      (body.includes("one prd") || body.includes("single prd") || body.includes("just that prd") || body.includes("a prd"));
    expect(removesDomainOrPrd).toBe(true);
    const confirms = body.includes("confirm") || body.includes("explicit go-ahead") || body.includes("ask before");
    expect(confirms).toBe(true);
  });
});

/* ===========================================================================
 * BEAT 3 + 6 — fill_and_feedback.md: fill (precedence, multi-turn, hard, the split)
 * + feedback (capture-gate, confirm-before-write, route-by-scope) + sil_learn.
 * ========================================================================= */

function fillFeedbackLower(): string {
  return readBody(FILL_FEEDBACK_PATH).toLowerCase();
}

describe("references/fill_and_feedback.md — Beat 3: fill by PRECEDENCE, multi-turn, hard-constraint dual-enforce, the split", () => {
  it("exists on disk", () => {
    expect(existsSync(FILL_FEEDBACK_PATH)).toBe(true);
  });

  it("resolves each dimension by the PRECEDENCE chain: request-intent > PRD filled-pref > method taste > user_spec fact > method default", () => {
    // The NEW precedence — supersedes the deleted intent > playbook > user_spec >
    // domain_spec chain. Pin the ordered spine (a read-compose, most resolve with no question).
    const body = fillFeedbackLower();
    const idx = [
      body.indexOf("request-intent") >= 0 ? body.indexOf("request-intent") : body.indexOf("request intent"),
      body.indexOf("filled-pref") >= 0 ? body.indexOf("filled-pref") : body.indexOf("filled pref"),
      body.indexOf("method taste") >= 0 ? body.indexOf("method taste") : body.indexOf("taste"),
      body.indexOf("user_spec"),
      body.indexOf("method default") >= 0 ? body.indexOf("method default") : body.indexOf("default"),
    ];
    expect(idx.every((i) => i >= 0), `precedence chain must be named in order: ${JSON.stringify(idx)}`).toBe(true);
    for (let i = 1; i < idx.length; i++) {
      expect(idx[i]!, `precedence rung ${i} must follow rung ${i - 1}`).toBeGreaterThan(idx[i - 1]!);
    }
    const readCompose =
      body.includes("read-compose") || body.includes("read compose") ||
      body.includes("most resolve") || body.includes("no question") || body.includes("without a question");
    expect(readCompose).toBe(true);
  });

  it("elicits the residue MULTI-TURN until resolved-or-declined — a few at a time, tied to WHY, never a battery", () => {
    const body = fillFeedbackLower();
    const multiTurn =
      body.includes("multi-turn") || body.includes("multi turn") ||
      (body.includes("resolved") && body.includes("declined"));
    expect(multiTurn).toBe(true);
    const neverABattery =
      body.includes("never a battery") || body.includes("not a battery") ||
      body.includes("a few at a time") || body.includes("few at a time");
    expect(neverABattery).toBe(true);
    const tiedToWhy = body.includes("why") || body.includes("tied to");
    expect(tiedToWhy).toBe(true);
  });

  it("a live request contradicting a stored DURABLE pref → ASK one-off vs standing (standing → amend), never silently overwrite", () => {
    const body = fillFeedbackLower();
    const oneOffVsStanding =
      body.includes("one-off") || body.includes("one off") ||
      (body.includes("standing") && (body.includes("just this once") || body.includes("from now on") || body.includes("ask")));
    expect(oneOffVsStanding).toBe(true);
    const standingAmends =
      (body.includes("standing") && body.includes("amend")) || body.includes("amend the stored");
    expect(standingAmends).toBe(true);
    const neverSilentOverwrite =
      body.includes("never silently overwrite") || body.includes("not silently overwrite") ||
      body.includes("never silently") ;
    expect(neverSilentOverwrite).toBe(true);
  });

  it("hard constraints are INVIOLABLE + dual-enforced — routed to a real filter AND handed to the reject-at-pick check", () => {
    const body = fillFeedbackLower();
    const inviolable =
      body.includes("inviolable") || body.includes("never overrid") || body.includes("never break");
    expect(inviolable).toBe(true);
    const dualEnforced =
      (body.includes("filter") && (body.includes("reject-at-pick") || body.includes("reject at pick"))) ||
      body.includes("dual-enforce") || body.includes("belt and suspenders");
    expect(dualEnforced).toBe(true);
  });

  it("THE SPLIT — elicited durable answers persist to the PRD NOW; Beat 6 owns the reaction half; one-off direction stays ephemeral", () => {
    const body = fillFeedbackLower();
    const persistsNow =
      (body.includes("persist") || body.includes("write")) &&
      (body.includes("now") || body.includes("during elicitation") || body.includes("stated"));
    expect(persistsNow).toBe(true);
    const theSplit =
      body.includes("the split") || body.includes("reaction half") ||
      (body.includes("beat 6") && body.includes("reaction"));
    expect(theSplit).toBe(true);
    const ephemeralOneOff =
      body.includes("ephemeral") || body.includes("one-off direction is never written") ||
      body.includes("never written") || body.includes("not written");
    expect(ephemeralOneOff).toBe(true);
  });

  it("a declined question narrows QUALITY, never ACCESS — proceed on best-defensible params + STATE the assumption", () => {
    const body = fillFeedbackLower();
    const narrowsQualityNotAccess =
      (body.includes("quality") && body.includes("access")) ||
      body.includes("decline never blocks") || body.includes("never blocks");
    expect(narrowsQualityNotAccess).toBe(true);
    const statesAssumption =
      body.includes("state the assumption") || body.includes("states the assumption") ||
      body.includes("assuming") || body.includes("what you assumed");
    expect(statesAssumption).toBe(true);
  });
});

describe("references/fill_and_feedback.md — Beat 6: reaction half, capture-gate, confirm-before-write, route-by-scope", () => {
  it("captures only what is DURABLE AND NEW (no duplicate / noise / empty) — the capture gate", () => {
    const body = fillFeedbackLower();
    const durableAndNew =
      (body.includes("durable") && body.includes("new")) ;
    expect(durableAndNew).toBe(true);
    const gate =
      body.includes("no duplicate") || body.includes("not already stored") ||
      body.includes("noise") || body.includes("no empty") || body.includes("capture gate") || body.includes("capture-gate");
    expect(gate).toBe(true);
  });

  it("CONFIRMS before every durable write — asks, then persists (never a silent harvest); gated behind the candidate", () => {
    const body = fillFeedbackLower();
    const confirmsBeforeWrite =
      body.includes("confirm before") || body.includes("ask before") ||
      body.includes("asks before") || (body.includes("confirm") && body.includes("write"));
    expect(confirmsBeforeWrite).toBe(true);
    const neverSilentHarvest =
      body.includes("never silently harvested") || body.includes("not silently harvested") ||
      body.includes("never a silent harvest") || body.includes("silent harvest");
    expect(neverSilentHarvest).toBe(true);
  });

  it("routes by SCOPE — fact/hard → user_spec, durable taste → method, this-job → PRD, image → attach-asset (broadest scope where it stays true)", () => {
    const body = fillFeedbackLower();
    const routesFactToUserSpec = body.includes("user_spec") && (body.includes("fact") || body.includes("hard"));
    const routesTasteToMethod = body.includes("method") && body.includes("taste");
    const routesJobToPrd = body.includes("prd") && (body.includes("this-job") || body.includes("this job") || body.includes("job"));
    const routesImageToAsset = body.includes("attach-asset") && body.includes("image");
    expect(routesFactToUserSpec).toBe(true);
    expect(routesTasteToMethod).toBe(true);
    expect(routesJobToPrd).toBe(true);
    expect(routesImageToAsset).toBe(true);
    const broadestScope =
      body.includes("broadest scope") || body.includes("placement rule") || body.includes("where it stays true");
    expect(broadestScope).toBe(true);
  });

  it("picks the kind — new → append; contradicts a stored SOFT pref → amend (supersedes, never a stacked bullet); withdrawal → retract", () => {
    const body = fillFeedbackLower();
    for (const kind of ["append", "amend", "retract"]) {
      expect(body).toContain(kind);
    }
    const amendSupersedes =
      (body.includes("amend") && (body.includes("supersede") || body.includes("contradict"))) &&
      (body.includes("never a stacked bullet") || body.includes("not a second") || body.includes("never a second") || body.includes("stacked bullet"));
    expect(amendSupersedes).toBe(true);
  });

  it("RE-SCOPE = write-broader-then-retract-narrower (two sil_learn calls) — there is NO promote verb", () => {
    const body = fillFeedbackLower();
    const writeBroaderRetractNarrower =
      (body.includes("broader") && body.includes("retract")) ||
      body.includes("write-broader") || body.includes("re-scope");
    expect(writeBroaderRetractNarrower).toBe(true);
    const noPromoteVerb =
      body.includes("no promote verb") || body.includes("no separate promote") || body.includes("never a promote");
    expect(noPromoteVerb).toBe(true);
  });
});

describe("references/fill_and_feedback.md — sil_learn is the ONE target+change feedback verb (5 kinds); sil_remember is GONE", () => {
  it("names sil_learn as the single target+change write verb owning the whole method/PRD lifecycle", () => {
    const body = fillFeedbackLower();
    expect(body).toContain("sil_learn");
    const targetPlusChange =
      body.includes("target") && (body.includes("change") || body.includes("kind"));
    expect(targetPlusChange).toBe(true);
    const namesTheFiveKinds = ["create", "append", "amend", "retract", "attach-asset"].filter((k) => !body.includes(k));
    expect(namesTheFiveKinds).toEqual([]);
  });

  it("does NOT name the deleted sil_remember (renamed to sil_learn — no alias survives in prose)", () => {
    expect(readBody(FILL_FEEDBACK_PATH)).not.toContain("sil_remember");
  });
});

/* ===========================================================================
 * BEAT-4 PARAM MAPPING — search_param_mapping.md (ship_to empty; hard → real
 * filter + reject; never round-trip whoami). Kept, model-neutral.
 * ========================================================================= */

describe("references/search_param_mapping.md — answer→param mapping; ship_to empty; hard → real filter + reject", () => {
  it("exists and leaves ship_to empty by default, never round-tripping sil_whoami to populate it", () => {
    expect(existsSync(MAPPING_PATH)).toBe(true);
    const body = readBody(MAPPING_PATH).toLowerCase();
    expect(body).toContain("ship_to");
    const leavesEmpty = body.includes("ship_to empty") || (body.includes("ship_to") && body.includes("empty"));
    expect(leavesEmpty).toBe(true);
    const disavowsWhoami =
      /(never|not|no|without|don't|do not)[^.]*sil_whoami/.test(body) || /sil_whoami[^.]*(never|not)/.test(body);
    expect(disavowsWhoami).toBe(true);
  });

  it("routes a hard constraint to a real FILTER + a reject rule, never only soft query text", () => {
    const body = readBody(MAPPING_PATH).toLowerCase();
    const namesHard = body.includes("hard constraint") || body.includes("hard-constraint") || body.includes("hard-no") || body.includes("inviolable");
    const filterAndReject =
      (body.includes("filter") || body.includes("condition")) && (body.includes("reject") || body.includes("never recommend"));
    const notQueryOnly = body.includes("not only") || body.includes("never only") || body.includes("not just query");
    expect(namesHard).toBe(true);
    expect(filterAndReject).toBe(true);
    expect(notQueryOnly).toBe(true);
  });
});

/* ===========================================================================
 * CREATION PATH (condensed, frontmatter-as-truth) — the one-time shopper setup:
 * setup-only materialize, singleton, admission, persona→SOUL.md, two-touchpoint
 * endorsement-gated interview.
 * ========================================================================= */

function engineLower(): string {
  return readBody(ENGINE_PATH).toLowerCase();
}

describe("references/agent_creation_engine.md — creates ONE shopper via SETUP-ONLY materialize (frontmatter-as-truth, no manifest)", () => {
  it("exists; frames the procedure as creating ONE shopper (never a per-niche expert)", () => {
    expect(existsSync(ENGINE_PATH)).toBe(true);
    const body = engineLower();
    expect(body.includes("create") || body.includes("creation")).toBe(true);
    expect(body).toContain("shopper");
    expect(perNicheExpertOffenders(readBody(ENGINE_PATH))).toEqual([]);
  });

  it("the create call is SETUP-ONLY `sil_profile_materialize { name, userSpec }` — NO domain pack, NO manifest", () => {
    const body = engineLower();
    expect(body).toContain("sil_profile_materialize");
    expect(body).toContain("userspec");
    const setupOnly =
      body.includes("setup-only") || body.includes("setup only") ||
      body.includes("no domain") || body.includes("without a domain") || body.includes("no `domain`");
    expect(setupOnly).toBe(true);
    // Frontmatter-as-truth: user_spec.md carries the name; NO profile.json manifest.
    const frontmatterName =
      body.includes("user_spec.md") && (body.includes("frontmatter") || body.includes("name"));
    expect(frontmatterName).toBe(true);
  });

  it("gates `created` on the host's own validation, ordered after `openclaw agents add`, and admits sil via the shipped helper", () => {
    const body = engineLower();
    expect(body).toContain("openclaw agents add");
    const addIdx = body.indexOf("openclaw agents add");
    const validateIdx = body.indexOf("openclaw config validate");
    expect(validateIdx).toBeGreaterThan(addIdx);
    const present = ALLOWLIST_HELPER_TOKENS.filter((t) => body.includes(t));
    expect(present).not.toEqual([]);
    expect(body).toContain("tools.alsoallow");
  });

  it("refuses a SECOND shopper (singleton) and writes the persona into the host SOUL.md, never a sil persona.md", () => {
    const body = engineLower();
    const singletonRefusal =
      body.includes("a shopper already exists") || body.includes("already have a shopper") ||
      body.includes("singleton") || (body.includes("second shopper") && body.includes("never"));
    expect(singletonRefusal).toBe(true);
    expect(body).toContain("soul.md");
    expect(body).not.toContain("persona.md");
  });

  it("names the engine outcome statuses (created / invalid_request / collision / persistence_failed)", () => {
    const body = engineLower();
    expect(["created", "invalid_request", "collision", "persistence_failed"].filter((s) => !body.includes(s))).toEqual([]);
  });
});

describe("references/brainstorm_interview.md — the TWO-touchpoint, endorsement-gated creation interview", () => {
  it("exists; an open multi-turn interview (not a form-fill) with exactly two touchpoints: persona + shared user-spec seed", () => {
    expect(existsSync(BRAINSTORM_PATH)).toBe(true);
    const body = readBody(BRAINSTORM_PATH).toLowerCase();
    expect(body.includes("brainstorm") || body.includes("interview")).toBe(true);
    const twoTouchpoints =
      body.includes("two touchpoints") || body.includes("two touch-points") || (body.includes("two") && body.includes("touchpoint"));
    expect(twoTouchpoints).toBe(true);
    expect(body).toContain("persona");
    const sharedUserSpec = body.includes("shared user spec") || (body.includes("user_spec") && body.includes("shared")) || (body.includes("user spec") && body.includes("shared"));
    expect(sharedUserSpec).toBe(true);
  });

  it("assembles a draft and reaches the engine ONLY after an explicit endorsement — nothing created before that", () => {
    const body = readBody(BRAINSTORM_PATH).toLowerCase();
    const endorseIdx = body.indexOf("endorse");
    const lastEngineHandoffIdx = body.lastIndexOf("agent_creation_engine.md");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(lastEngineHandoffIdx).toBeGreaterThanOrEqual(0);
    expect(endorseIdx).toBeLessThan(lastEngineHandoffIdx);
    const nothingBefore =
      body.includes("nothing is created") || body.includes("nothing created") || body.includes("creates nothing") || body.includes("no partial");
    expect(nothingBefore).toBe(true);
  });
});

/* ===========================================================================
 * WORKED EXAMPLE — the six-beat multi-domain headline.
 * ========================================================================= */

function exampleLower(): string {
  return readBody(EXAMPLE_PATH).toLowerCase();
}

describe("examples/multi_domain_shopper_walkthrough.md — a worked six-beat, multi-domain run", () => {
  it("exists; create-ONCE reaching the engine only after the explicit endorsement", () => {
    expect(existsSync(EXAMPLE_PATH)).toBe(true);
    const body = exampleLower();
    expect(body).toContain("shopper");
    const endorseIdx = body.indexOf("endorse");
    const addIdx = body.indexOf("openclaw agents add");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(endorseIdx).toBeLessThan(addIdx);
  });

  it("shops ≥2 UNRELATED niches in ONE session, the 2nd minted on the fly + ANNOUNCED, a shared user_spec fact reused across niches", () => {
    const body = exampleLower();
    const secondNiche =
      body.includes("second niche") || body.includes("another niche") || body.includes("unrelated niche") || (body.includes("two") && body.includes("niche"));
    expect(secondNiche).toBe(true);
    const sameSession = body.includes("same session") || body.includes("one session") || body.includes("no agent switch");
    expect(sameSession).toBe(true);
    const mintedAnnounced = body.includes("mint") && (body.includes("announce") || body.includes("on the fly"));
    expect(mintedAnnounced).toBe(true);
    const sharedReuse =
      (body.includes("shared") || body.includes("across") || body.includes("every niche")) &&
      (body.includes("reuse") || body.includes("never re-ask") || body.includes("without re-asking") || body.includes("kept from"));
    expect(sharedReuse).toBe(true);
  });

  it("persists a surfaced signal via sil_learn (NOT the deleted sil_remember) and shows the singleton-refusal edge", () => {
    const body = exampleLower();
    expect(body).toContain("sil_learn");
    expect(body).not.toContain("sil_remember");
    const singletonEdge =
      body.includes("a shopper already exists") || body.includes("already have a shopper") || (body.includes("singleton") && body.includes("refus"));
    expect(singletonEdge).toBe(true);
  });
});

/* ===========================================================================
 * ONBOARDING PITCH BEATS — setup_onboarding.md: after-register offer + per-search
 * pitch. Valid, orthogonal to the six-beat restructure; kept with disavowal
 * discipline. (See docs/knowledge/skill-prose-drift-guard-disavowal-discipline.md.)
 * ========================================================================= */

/** The SKILL.md/reference body H2 section that OWNS `anchor` — from its `## `
 * heading up to the next `## `. `anchor` is a net-new token unique to one beat. */
function sectionOwning(body: string, anchor: number): string {
  const headingStart = body.lastIndexOf("\n## ", anchor);
  const from = headingStart >= 0 ? headingStart + 1 : Math.max(0, anchor - 300);
  const rest = body.slice(from);
  const nextH2 = rest.indexOf("\n## ", anchor - from + 1);
  return nextH2 >= 0 ? rest.slice(0, nextH2) : rest;
}

function afterRegisterBeat(): string {
  const body = readBody(SETUP_ONBOARDING_PATH);
  const at = body.indexOf("offer_shopper");
  expect(at, "setup_onboarding.md must carry the after-register offer_shopper beat").toBeGreaterThanOrEqual(0);
  return sectionOwning(body, at);
}

function perSearchBeat(): string {
  const body = readBody(SETUP_ONBOARDING_PATH);
  const m = /post-?result/i.exec(body);
  expect(m, "setup_onboarding.md must carry the per-search post-result pitch beat").not.toBeNull();
  return sectionOwning(body, m!.index);
}

const PITCH_DISAVOWAL = ["no ", "not ", "never", "without", "don't", "do not", "n't ", "isn't", "aren't"] as const;

function affirmativeOffenders(body: string, re: RegExp): string[] {
  const offenders: string[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const before = body.slice(Math.max(0, m.index - 28), m.index);
    const disavowed = PITCH_DISAVOWAL.some((t) => before.includes(t));
    if (!disavowed) {
      offenders.push(body.slice(Math.max(0, m.index - 24), m.index + m[0].length + 12).replace(/\s+/g, " ").trim());
    }
  }
  return offenders;
}

const LANE1_VIOLATION_RE = /re-?rank|pre-?search question|ask (?:the user )?(?:a question )?before (?:the )?search/gi;

const ALLOWLIST_HELPER_TOKENS = [
  "sil-openclaw-allowlist",
  "allowlist-openclaw.mjs",
  "openclaw:allowlist",
] as const;

describe("sil-shopping — setup_onboarding.md after-register introduce-and-offer beat", () => {
  it("keys off the identity.ts breadcrumb next_step: offer_shopper on already_registered", () => {
    const beat = afterRegisterBeat();
    expect(beat).toContain("next_step");
    expect(beat).toContain("offer_shopper");
    expect(beat).toContain("already_registered");
  });

  it("gates the offer on a no-arg sil_profile_get empty-store check, routes to brainstorm_interview.md only on a yes, skips for a singleton", () => {
    const beat = afterRegisterBeat();
    const lower = beat.toLowerCase();
    expect(lower).toContain("sil_profile_get");
    expect(beat).toContain("brainstorm_interview.md");
    expect(lower).toContain("singleton");
    const gatesOnEmpty = lower.includes("empty") || lower.includes("no shopper") || lower.includes("none yet");
    expect(gatesOnEmpty).toBe(true);
  });
});

describe("sil-shopping — setup_onboarding.md per-search pitch beat (recurring; Lane 1 untouched)", () => {
  it("describes a POST-RESULT trailing line on a completed bare sil_search, recurring by design", () => {
    const beat = perSearchBeat();
    const lower = beat.toLowerCase();
    expect(/post-?result/i.test(beat)).toBe(true);
    expect(lower).toContain("sil_search");
    const trailingLine = lower.includes("trailing line") || lower.includes("one short") || lower.includes("short trailing");
    expect(trailingLine).toBe(true);
    const recurs = /recur/i.test(beat) || /every\b[\s\S]{0,30}\bsearch/i.test(beat) || /each\b[\s\S]{0,30}\bsearch/i.test(beat);
    expect(recurs).toBe(true);
  });

  it("keeps Lane 1 UNTOUCHED — best-first, never a re-rank, never a pre-search question (negation-aware)", () => {
    const lower = perSearchBeat().toLowerCase();
    const bestFirst = /best-?first/i.test(lower) || lower.includes("unchanged") || lower.includes("as they came back");
    expect(bestFirst).toBe(true);
    expect(affirmativeOffenders(lower, LANE1_VIOLATION_RE)).toEqual([]);
  });
});
