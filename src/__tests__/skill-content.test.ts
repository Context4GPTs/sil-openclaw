/**
 * INTEGRATION — single multi-domain SHOPPER skill ↔ registered-tool drift guard
 * (tier: integration — reads the real `sil-shopping/` skill files from disk and
 * compares their bodies against the set of registered tool names and the pinned
 * single-shopper procedure invariants; multiple artifacts interacting across the
 * skill-doc ↔ registration seam and the SKILL.md-router ↔ reference-files seam).
 *
 * THE MODEL THIS FILE PINS (card: single-shopper-skill-rewrite — Slice 2 of #38):
 * there is ONE persistent **shopper** (a generalist created ONCE) that learns
 * **domains** (niches) LAZILY on first shop. This RETIRES the per-niche **expert**
 * model wholesale (no backwards compat). The skill bundle was renamed +
 * rewritten to drive the shipped single-shopper tool surface:
 *   - `expert_shopping.md`                 → `shop_loop.md`
 *   - `manage_experts.md`                  → `manage_domains.md`
 *   - `refine_expert.md`                   → `refine_shopper.md`
 *   - `road_cycling_expert_walkthrough.md` → `multi_domain_shopper_walkthrough.md`
 *   - `agent_creation_engine.md` / `brainstorm_interview.md` keep their names,
 *     rewritten in place (create ONE shopper, two-touchpoint interview).
 *
 * The tool surface is EIGHT tools (the consolidate-profile-tools-to-the-singleton-
 * surface card folded `sil_profile_list` into `sil_profile_get` and dropped the
 * caller-supplied `agentId`): `sil_register`, `sil_whoami`, `sil_search`,
 * `sil_product_get`, `sil_profile_materialize`, `sil_profile_get`,
 * `sil_profile_remove`, `sil_remember`. Shapes that drive the prose pins:
 *   - `sil_profile_materialize { name, userSpec, domain? }` — NO `domain`
 *     ⇒ create the shopper (writes the SHARED `user_spec.md` + an empty `domains`
 *     map); WITH `domain` ⇒ lazily mint/refresh a niche pack;
 *   - `sil_profile_get { domainSlug? }` — no-args overview (absorbs the deleted
 *     `sil_profile_list`) vs one domain;
 *   - `sil_profile_remove { domainSlug }` — forget ONE domain;
 *   - `sil_remember { kind:"fact"|"taste", text, domain?, hard? }` —
 *     the cheap per-query append (fact → SHARED user spec, taste → active domain).
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the markdown — the
 * markdown is rewritten to satisfy them. Anchors are NET-NEW tokens + OR-grouped
 * intent substrings + indexOf ordering on step VERBS — never `§N` numbers, never
 * brittle full sentences. The per-niche-expert negatives match whole-word
 * `\bexperts?\b` (so legitimate "niche expertise" never false-fails).
 *
 * Frontmatter is parsed with a small self-contained extractor that REJECTS a
 * malformed block (missing fence, empty body, absent keys) — "parses" means
 * structurally valid, not merely present.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
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

// The progressive-disclosure reference + example files that own the detailed
// procedures the router points at. The four RENAMED files carry the single-
// shopper vocabulary in their paths (the router links name them; the test
// constants encode them) — a `manage_experts.md`-whose-body-says-domains was the
// exact expert/shopper confusion this card kills, so the rename is load-bearing.
const CATALOG_TOOLS_PATH = join(SKILL_DIR, "references", "catalog_tools_reference.md");
const BRAINSTORM_PATH = join(SKILL_DIR, "references", "brainstorm_interview.md");
const ENGINE_PATH = join(SKILL_DIR, "references", "agent_creation_engine.md");
const MAPPING_PATH = join(SKILL_DIR, "references", "search_param_mapping.md");
const MANAGE_PATH = join(SKILL_DIR, "references", "manage_domains.md");
const SHOP_LOOP_PATH = join(SKILL_DIR, "references", "shop_loop.md");
const REFINE_PATH = join(SKILL_DIR, "references", "refine_shopper.md");
const EXAMPLE_PATH = join(SKILL_DIR, "examples", "multi_domain_shopper_walkthrough.md");

/** The pre-rewrite filenames the rename retired. Must be gone from disk AND from
 * every cross-link in the bundle (the router-glob catches router links, NOT the
 * cross-links buried inside reference bodies — this set drives the body scan). */
const RETIRED_FILENAMES = [
  "expert_shopping.md",
  "manage_experts.md",
  "refine_expert.md",
  "road_cycling_expert_walkthrough.md",
] as const;

/* `PER_NICHE_EXPERT_WORD` + `perNicheExpertOffenders` (the disavowal-token
 * discipline + 28-char retro-allowance) live in ./helpers/per-niche-expert.ts —
 * a single source of truth shared with the unit tool-description vocabulary guard
 * in tools/tool-schema-contract.unit.test.ts, so the retro-allowance can never
 * drift between the two guards. */

interface Frontmatter {
  raw: string;
  fields: Record<string, string>;
}

/**
 * Extract + validate the leading `--- ... ---` frontmatter block. Throws on a
 * structurally-invalid block (no opening fence at byte 0, no closing fence, or
 * empty body) — so "parses" is a real assertion. Reads top-level `key: value`
 * scalar lines (enough for name + description; nested metadata is ignored).
 */
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

/** Read a skill file and return its body below the frontmatter (reference/example
 * files may have none — then the whole content is the body). */
function readBody(path: string): string {
  const content = readFileSync(path, "utf8");
  return content.startsWith("---") ? skillBody(content) : content;
}

/** The set of names the real register code emits against a mock api. Mirrors
 * src/index.ts#register(): identity + catalog + profile groups, so the bundle is
 * checked against the REAL eight-tool surface (`registerProfileTools` wires the
 * three `sil_profile_*` tools AND `sil_remember`). */
function registeredNames(): Set<string> {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerProfileTools(api);
  return registeredToolNames(api);
}

/** The whole progressive-disclosure bundle as one corpus: the router PLUS every
 * reference + example. Under progressive disclosure the BUNDLE is the source of
 * truth for the tool surface — a tool may be named in the file that OWNS its
 * procedure, not forced into the lean router. */
function bundleCorpus(): string {
  return [
    readBody(SKILL_PATH),
    readBody(CATALOG_TOOLS_PATH),
    readBody(BRAINSTORM_PATH),
    readBody(ENGINE_PATH),
    readBody(MAPPING_PATH),
    readBody(MANAGE_PATH),
    readBody(SHOP_LOOP_PATH),
    readBody(REFINE_PATH),
    readBody(EXAMPLE_PATH),
  ].join("\n");
}

/** Every bundle file's absolute path (for the bundle-wide scans). */
const BUNDLE_FILES: ReadonlyArray<readonly [string, string]> = [
  ["SKILL.md", SKILL_PATH],
  ["catalog_tools_reference.md", CATALOG_TOOLS_PATH],
  ["brainstorm_interview.md", BRAINSTORM_PATH],
  ["agent_creation_engine.md", ENGINE_PATH],
  ["search_param_mapping.md", MAPPING_PATH],
  ["manage_domains.md", MANAGE_PATH],
  ["shop_loop.md", SHOP_LOOP_PATH],
  ["refine_shopper.md", REFINE_PATH],
  ["multi_domain_shopper_walkthrough.md", EXAMPLE_PATH],
];

/* ===========================================================================
 * DISCOVERABILITY + FRONTMATTER — the single-shopper SKILL.md
 * ========================================================================= */

describe("sil-shopping/SKILL.md — discoverability", () => {
  it("exists at sil-shopping/SKILL.md", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("has frontmatter that parses (valid open + close fences, non-empty body)", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(() => parseFrontmatter(content)).not.toThrow();
  });

  it("exposes a non-empty `name` in frontmatter", () => {
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    expect((fm.fields["name"] ?? "").length).toBeGreaterThan(0);
  });

  it("exposes a non-empty `description` in frontmatter", () => {
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    expect((fm.fields["description"] ?? "").length).toBeGreaterThan(0);
  });
});

describe("sil-shopping/SKILL.md — single-shopper frontmatter (name == basename; description drives eight tools, shopper/domain model, NO expert vocab)", () => {
  it("frontmatter `name` equals the published basename `sil-shopping` (not the stale `sil`)", () => {
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    expect(fm.fields["name"]).toBe("sil-shopping");
    expect(fm.fields["name"]).not.toBe("sil");
  });

  it("frontmatter `description` enumerates the EIGHT sil_* tools it drives, and NOT the deleted sil_profile_list", () => {
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
      "sil_remember",
    ].filter((t) => !description.includes(t));
    expect(missing).toEqual([]);
    // The fold deletes sil_profile_list — the trigger description must no longer
    // name it (a recovery/route hint to a nonexistent tool is the regression we kill).
    expect(description).not.toContain("sil_profile_list");
  });

  it("frontmatter `description` presents the SHOPPER + DOMAIN model (not the retired per-niche expert)", () => {
    // The card: the description is rewritten from the per-niche-expert lifecycle to
    // create-your-shopper / shop-any-niche / manage-domains. NET-NEW: the model
    // noun is "shopper" and niches are "domains" — the pre-rewrite description said
    // "shopping expert" and named no "shopper"/"domain", so both are RED today.
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    const description = (fm.fields["description"] ?? "").toLowerCase();
    expect(description).toContain("shopper");
    expect(description).toContain("domain");
  });

  it("frontmatter `description` carries NO per-niche-expert vocabulary (whole-word `expert`)", () => {
    // "zero surviving per-niche-expert prose" applied to the trigger description —
    // no "shopping expert", no "shopping-expert intent". Whole-word so a hypothetical
    // "expertise" would not false-fail.
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    const description = fm.fields["description"] ?? "";
    expect(PER_NICHE_EXPERT_WORD.test(description)).toBe(false);
  });
});

/* ===========================================================================
 * BUNDLE — the tool surface + the rename retirement
 * ========================================================================= */

describe("skill bundle — source of truth for the eight-tool surface", () => {
  it("registeredNames() equals EIGHT (the four core tools + the four sil_profile_* / sil_remember verbs)", () => {
    const names = registeredNames();
    expect(names.size, `registered tools: ${[...names].sort().join(", ")}`).toBe(8);
    expect(names.has("sil_remember")).toBe(true);
    // sil_profile_list was folded into sil_profile_get — it no longer registers.
    expect(names.has("sil_profile_list")).toBe(false);
  });

  it("NO bundle file names the deleted sil_profile_list anywhere (grepped to zero across the bundle)", () => {
    // The fold deletes sil_profile_list; a lingering mention in any reference body —
    // a route row, a recovery hint, a taxonomy row — would point the skill at a
    // nonexistent tool. The card's "grep sil_profile_list to zero" requirement,
    // enforced bundle-wide (the router-glob + per-tool-present scans do NOT catch a
    // stale tool NAME buried in a reference body).
    const offenders: string[] = [];
    for (const [label, path] of BUNDLE_FILES) {
      if (readBody(path).includes("sil_profile_list")) offenders.push(label);
    }
    expect(offenders).toEqual([]);
  });

  it("names EVERY registered real tool somewhere in the bundle (router or the reference that owns it)", () => {
    const corpus = bundleCorpus();
    const names = registeredNames();
    const missing = [...names].filter((name) => !corpus.includes(name));
    expect(missing).toEqual([]);
  });

  it("names the four core tools in the LEAN router itself (the always-loaded entry point)", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    for (const tool of ["sil_register", "sil_whoami", "sil_search", "sil_product_get"]) {
      expect(body).toContain(tool);
    }
  });

  it("names no removed example tool (sil_ping / sil_echo) anywhere in the bundle", () => {
    const corpus = bundleCorpus();
    expect(corpus).not.toContain("sil_ping");
    expect(corpus).not.toContain("sil_echo");
  });
});

describe("skill bundle — the rename retired the per-niche-expert filenames (renamed files exist; old names gone from disk AND every cross-link)", () => {
  it("the four renamed files EXIST on disk and their pre-rewrite names do NOT", () => {
    const renames: ReadonlyArray<readonly [string, string]> = [
      [SHOP_LOOP_PATH, join(SKILL_DIR, "references", "expert_shopping.md")],
      [MANAGE_PATH, join(SKILL_DIR, "references", "manage_experts.md")],
      [REFINE_PATH, join(SKILL_DIR, "references", "refine_expert.md")],
      [EXAMPLE_PATH, join(SKILL_DIR, "examples", "road_cycling_expert_walkthrough.md")],
    ];
    const problems: string[] = [];
    for (const [renamed, old] of renames) {
      if (!existsSync(renamed)) problems.push(`missing renamed file: ${renamed}`);
      if (existsSync(old)) problems.push(`stale old file still on disk: ${old}`);
    }
    expect(problems).toEqual([]);
  });

  it("NO bundle file cross-links any retired filename (the link blast radius is grepped to zero)", () => {
    // Renaming 4 files breaks every [...](expert_shopping.md|manage_experts.md|
    // refine_expert.md|road_cycling_expert_walkthrough.md) link across SKILL.md,
    // search_param_mapping.md, the renamed files cross-linking each other, and the
    // example. The router's "every path exists" glob catches router links but NOT
    // cross-links buried inside reference bodies — this scan catches all of them.
    const offenders: string[] = [];
    for (const [label, path] of BUNDLE_FILES) {
      const body = readBody(path);
      for (const old of RETIRED_FILENAMES) {
        if (body.includes(old)) offenders.push(`${label} → ${old}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("NO bundle file carries per-niche-expert user-facing vocabulary (whole-word `expert`, scan derived from BUNDLE_FILES)", () => {
    // The card's headline success signal: zero surviving per-niche-expert prose. The
    // model noun is "shopper", a niche is a "domain". Whole-word `\bexperts?\b` so
    // legitimate "niche expertise" passes; "shopping expert" / "your experts" fail.
    // The scan set is DERIVED from BUNDLE_FILES (audit forward-gap 1) — not a hand-
    // maintained subset — so NO bundle file can ever escape it again. This folds in
    // search_param_mapping.md AND catalog_tools_reference.md, the two files that
    // previously sat OUTSIDE the scan (covered only by the retired-filename link
    // scan, which greps filenames, not the word "expert"). Both are clean today, so
    // this stays GREEN; a future affirmative `expert` reintroduction in ANY bundle
    // file — including the two newly-folded-in references — is now caught here.
    const offenders: string[] = [];
    for (const [label, path] of BUNDLE_FILES) {
      for (const ctx of perNicheExpertOffenders(readBody(path))) {
        offenders.push(`${label}: …${ctx}…`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ===========================================================================
 * CATALOG + IDENTITY TOOLS REFERENCE — per-tool behaviour + shared status
 * taxonomy (delegated from the lean router; niche-agnostic, model-neutral).
 * ========================================================================= */

function catalogToolsBodyLower(): string {
  return readBody(CATALOG_TOOLS_PATH).toLowerCase();
}

describe("references/catalog_tools_reference.md — per-tool behaviour + shared status taxonomy", () => {
  it("exists on disk", () => {
    expect(existsSync(CATALOG_TOOLS_PATH)).toBe(true);
  });

  it("documents the per-tool behaviour of all four core tools", () => {
    const body = catalogToolsBodyLower();
    for (const tool of ["sil_register", "sil_whoami", "sil_search", "sil_product_get"]) {
      expect(body).toContain(tool);
    }
    expect(body).toContain("awaiting_browser");
    expect(body).toContain("cursor");
    expect(body).toContain("not_found");
    expect(body).toContain("checkout_url");
  });

  it("holds the shared status taxonomy (all six statuses, with the recovery rule)", () => {
    const body = catalogToolsBodyLower();
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

  it("does NOT carry the agent-creation procedure (it is a SHOPPING-tools reference, not the engine)", () => {
    const body = catalogToolsBodyLower();
    expect(body).not.toContain("openclaw agents add");
    expect(body).not.toContain("sil_profile_materialize");
  });
});

/* ===========================================================================
 * LEAN ROUTER — SKILL.md routes to the RENAMED references; no detail leaks back.
 * ========================================================================= */

describe("sil-shopping/SKILL.md — lean router routes to the renamed references", () => {
  it("routes to the brainstorm interview, the engine, the param mapping, the shop loop, manage-domains, refine-shopper, and the renamed example by relative path", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const expected = [
      "references/brainstorm_interview.md",
      "references/agent_creation_engine.md",
      "references/search_param_mapping.md",
      "references/shop_loop.md",
      "references/manage_domains.md",
      "references/refine_shopper.md",
      "examples/multi_domain_shopper_walkthrough.md",
    ];
    const missing = expected.filter((rel) => !body.includes(rel));
    expect(missing).toEqual([]);
  });

  it("every references/… and examples/… path SKILL.md mentions EXISTS on disk", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const referenced = [
      ...body.matchAll(/(references|examples)\/[A-Za-z0-9_./-]+\.md/g),
    ].map((m) => m[0]);
    expect(referenced.length).toBeGreaterThan(0);
    const missing = referenced.filter((rel) => !existsSync(join(SKILL_DIR, rel)));
    expect(missing).toEqual([]);
  });

  it("makes the endorsement-before-engine gate unmistakable in the routing block", () => {
    // Creating the shopper still runs the engine ONLY after the user's explicit
    // endorsement of the assembled draft. Reading the router alone, an agent already
    // knows the gate exists, and that the interview is loaded before the engine.
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    const endorseIdx = body.indexOf("endorse");
    const engineRefIdx = body.indexOf("agent_creation_engine.md");
    const interviewRefIdx = body.indexOf("brainstorm_interview.md");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(engineRefIdx).toBeGreaterThanOrEqual(0);
    expect(interviewRefIdx).toBeGreaterThanOrEqual(0);
    expect(endorseIdx).toBeLessThan(engineRefIdx);
    expect(interviewRefIdx).toBeLessThan(engineRefIdx);
  });

  it("keeps the router LEAN — the engine's ordered host-CLI steps do NOT live in SKILL.md", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    expect(body).not.toContain("openclaw agents add");
    expect(body).not.toContain("openclaw config validate");
    expect(body).not.toContain("sil_profile_materialize");
  });

  it("does NOT inline the per-tool behaviour or the status taxonomy (they live in catalog_tools_reference.md, no duplication)", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    expect(body).not.toContain("awaiting_browser");
    expect(body).not.toContain("not_registered");
    expect(body).not.toContain("must_reregister");
    expect(body).not.toContain("retryable");
    expect(body).toContain("references/catalog_tools_reference.md");
  });
});

describe("sil-shopping/SKILL.md — routes every shop / manage / refine / create intent to the renamed reference that owns it", () => {
  it("routes the shopping intent to references/shop_loop.md", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    expect(body).toContain("references/shop_loop.md");
    expect(body.toLowerCase()).toContain("sil_search");
  });

  it("routes the manage intents (view/remove) to references/manage_domains.md, naming the two surviving sil_profile_* tools (no sil_profile_list)", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    // After the fold, the "what does my shopper know / which domains" intent routes
    // to the no-args sil_profile_get (Zoom A) — sil_profile_list is gone.
    for (const tool of ["sil_profile_get", "sil_profile_remove"]) {
      expect(body).toContain(tool);
    }
    expect(body).not.toContain("sil_profile_list");
    expect(body).toContain("references/manage_domains.md");
  });

  it("routes the refine intent to references/refine_shopper.md", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    expect(body).toContain("references/refine_shopper.md");
  });
});

describe("sil-shopping/SKILL.md — session start retains the admission self-heal branch (#37, preserved)", () => {
  /** The `## Session start` section body of SKILL.md, lower-cased — from that
   * heading to the next `## ` heading. The missing-`sil_*`-tools branch must offer
   * the one-command helper, not dead-end. */
  function sessionStartLower(): string {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const heading = "## Session start";
    const start = body.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = body.slice(start + heading.length);
    const nextHeading = rest.indexOf("\n## ");
    const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
    return section.toLowerCase();
  }

  it("points the missing-`sil_*`-tools branch at the shipped admission helper (self-healing, not a dead-end)", () => {
    const section = sessionStartLower();
    const present = ALLOWLIST_HELPER_TOKENS.filter((t) => section.includes(t));
    expect(present).not.toEqual([]);
  });

  it("no longer dead-ends at 'consult … docs and stop' without offering the fix", () => {
    const section = sessionStartLower();
    const deadEnds =
      section.includes("consult the host's tool-allowlist docs and stop") ||
      (section.includes("consult") && section.includes("and stop"));
    expect(deadEnds).toBe(false);
  });
});

describe("skill — the contributor-facing 'adding a tool' prose is GONE from the runtime skill", () => {
  it("no bundle file carries the repo-CLAUDE.md 'how to add a tool' contributor content", () => {
    const corpus = bundleCorpus().toLowerCase();
    expect(corpus).not.toContain("registerxtools");
    expect(corpus).not.toContain("contracts.tools");
    expect(corpus).not.toContain("adding a real tool");
    expect(corpus).not.toContain("adding a tool");
  });
});

/* ===========================================================================
 * AGENT-CREATION ENGINE — create ONE shopper (userSpec only, no domain),
 * singleton refusal, admission preserved. The procedure-as-source-of-truth seam.
 * ========================================================================= */

function engineBodyLower(): string {
  return readBody(ENGINE_PATH).toLowerCase();
}

/** The four engine outcome statuses (mirrors identity.ts/catalog.ts vocabulary). */
const ENGINE_STATUSES = ["created", "invalid_request", "collision", "persistence_failed"] as const;

describe("references/agent_creation_engine.md — host-CLI procedure is a pinned source of truth", () => {
  it("names the host-native creation CLI `openclaw agents add` and the host `agents` config surface", () => {
    const body = engineBodyLower();
    expect(body).toContain("openclaw agents add");
    expect(body).toContain("agents");
  });

  it("names ALL FOUR engine outcome statuses (created/invalid_request/collision/persistence_failed)", () => {
    const body = engineBodyLower();
    const missing = ENGINE_STATUSES.filter((s) => !body.includes(s));
    expect(missing).toEqual([]);
  });

  it("frames the procedure as creating ONE shopper (NOT a per-niche expert)", () => {
    const body = engineBodyLower();
    const namesCreation = body.includes("create") || body.includes("creation");
    const namesShopper = body.includes("shopper");
    expect(namesCreation).toBe(true);
    expect(namesShopper).toBe(true);
    expect(perNicheExpertOffenders(readBody(ENGINE_PATH))).toEqual([]);
  });
});

describe("references/agent_creation_engine.md — validate-first; collision is a SINGLETON refusal", () => {
  it("names `invalid_request` and validates the spec BEFORE `openclaw agents add` (validate-first ordering)", () => {
    const body = engineBodyLower();
    expect(body).toContain("invalid_request");
    const firstValidateIdx = body.indexOf("validate");
    const addIdx = body.indexOf("openclaw agents add");
    expect(firstValidateIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(firstValidateIdx).toBeLessThan(addIdx);
  });

  it("requires the mandatory create fields — name AND persona AND the shared userSpec", () => {
    const body = engineBodyLower();
    expect(body).toContain("persona");
    expect(body).toContain("userspec");
    expect(body).toMatch(/name/);
  });

  it("names the SINGLETON refusal — a second create is refused with 'a shopper already exists', never a second shopper", () => {
    // NET-NEW: the pre-rewrite engine framed collision as an agentId clash only.
    // The single-shopper model adds the singleton invariant: the user has exactly
    // ONE shopper; a second create attempt is refused and steered to add-a-domain or
    // refine — never a second shopper minted.
    const body = engineBodyLower();
    const namesSingletonRefusal =
      body.includes("a shopper already exists") ||
      body.includes("already have a shopper") ||
      body.includes("shopper already exists");
    expect(namesSingletonRefusal).toBe(true);
    const namesSingleton = body.includes("singleton");
    const refusesSecond =
      body.includes("never mint a second shopper") ||
      body.includes("never a second shopper") ||
      body.includes("not a second shopper") ||
      (body.includes("second shopper") && body.includes("never"));
    expect(namesSingleton || refusesSecond).toBe(true);
  });

  it("reads existing agents BEFORE the add (collision check precedes `openclaw agents add`)", () => {
    const body = engineBodyLower();
    const listIdx = body.indexOf("openclaw agents list");
    const addIdx = body.indexOf("openclaw agents add");
    expect(listIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(listIdx).toBeLessThan(addIdx);
  });

  it("states nothing is written on an invalid spec (atomic outcome)", () => {
    const body = engineBodyLower();
    const saysNothingWritten =
      body.includes("write nothing") ||
      body.includes("writes nothing") ||
      body.includes("nothing is written") ||
      body.includes("does not write") ||
      body.includes("nothing partial") ||
      body.includes("no partial");
    expect(saysNothingWritten).toBe(true);
  });
});

describe("references/agent_creation_engine.md — the create call is `sil_profile_materialize { agentId, name, userSpec }` with NO domain (no per-niche specs at create)", () => {
  it("names the create-materialize call with userSpec and NO `domain` (the shopper, not a domain pack)", () => {
    const body = engineBodyLower();
    expect(body).toContain("sil_profile_materialize");
    // The exact create-call arg list — `name, userSpec` only. The consolidate-
    // profile-tools-to-the-singleton-surface card DROPS the sil-tool-call `agentId`
    // (the store re-scopes to the singleton), so the materialize call no longer
    // carries it. The HOST agent id survives in `openclaw agents add <id>` + the
    // brainstorm draft (host-CLI wiring) — that distinction is per-pin, see
    // brainstorm_interview's `{ agentId, name, persona, userSpec }` draft pin.
    expect(body).toContain("name, userspec");
    const passesNoDomain =
      body.includes("pass no `domain`") ||
      body.includes("pass no domain") ||
      body.includes("no `domain` at create") ||
      body.includes("no domain at create") ||
      body.includes("with no `domain`") ||
      body.includes("with no domain") ||
      body.includes("without a `domain`") ||
      body.includes("without a domain");
    expect(passesNoDomain).toBe(true);
  });

  it("states create writes the shared user_spec + an EMPTY domains map (a fresh shopper has no domains, healthily)", () => {
    const body = engineBodyLower();
    expect(body).toContain("user_spec.md");
    const namesEmptyDomains =
      body.includes("domains: {}") ||
      body.includes("empty `domains`") ||
      body.includes("empty domains") ||
      (body.includes("domains") && body.includes("map") && body.includes("empty"));
    expect(namesEmptyDomains).toBe(true);
  });

  it("NEGATIVE: no 'all four specs from creation' — the retired four-spec create-call arg-list is GONE", () => {
    // The lazy-mint move (create-time → first-shop) means NO per-domain pack is
    // authored at create. We forbid the RETIRED four-spec create-call arg-list and
    // the four-SDS-specs-at-creation framing — NOT the bare tokens `domainSpec` /
    // `intentSpec` (the corrected engine legitimately NAMES them to DISAVOW them at
    // create: "there is no domainSpec / intentSpec / playbook here").
    const body = engineBodyLower();
    expect(body).not.toContain("domainspec, intentspec, userspec, playbook");
    expect(body).not.toContain("name, domainspec, intentspec, userspec, playbook");
    expect(body).not.toContain("all four sds specs");
    expect(body).not.toContain("four sds specs");
    expect(body).not.toContain("all four are present from creation");
  });
});

describe("references/agent_creation_engine.md — wires a host-loadable, sil-wired shopper; validate gates created", () => {
  it("invokes `openclaw agents add` non-interactively with JSON output", () => {
    const body = engineBodyLower();
    expect(body).toContain("--non-interactive");
    expect(body).toContain("--json");
  });

  it("gates 'created' on the host's OWN validation, ordered AFTER the add, reading `.valid` (not a non-existent `ok` field)", () => {
    const body = engineBodyLower();
    expect(body).toContain("openclaw config validate");
    const addIdx = body.indexOf("openclaw agents add");
    const validateIdx = body.indexOf("openclaw config validate");
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(validateIdx).toBeGreaterThan(addIdx);
    expect(body).toContain("valid");
    expect(body).not.toContain("ok: false");
  });

  it("enables the sil plugin with the host's real value-mode set (`--strict-json`), NOT `--merge`", () => {
    const body = engineBodyLower();
    expect(body).toContain("plugins.entries.sil.enabled true --strict-json");
    expect(body).not.toContain("--merge");
  });

  it("pins the asserted OpenClaw image tag with NO stale 2026.4.15 lingering", () => {
    const raw = readBody(ENGINE_PATH);
    expect(raw).toContain("alpine/openclaw:2026.6.9");
    expect(raw).not.toContain("2026.4.15");
  });

  it("wires the sil PLUGIN enabled AND the sil SKILL attached into the created shopper", () => {
    const body = engineBodyLower();
    const wiresPlugin = body.includes("plugin") && (body.includes("enable") || body.includes("enabled"));
    const wiresSkill = body.includes("skill") && (body.includes("attach") || body.includes("attached"));
    expect(wiresPlugin).toBe(true);
    expect(wiresSkill).toBe(true);
  });

  it("names `persistence_failed` (with path + cause) for a write/validate failure", () => {
    const body = engineBodyLower();
    expect(body).toContain("persistence_failed");
    expect(body.includes("path") && body.includes("cause")).toBe(true);
  });

  it("states the created shopper shops with NO further setup (calls sil_search / sil_product_get immediately)", () => {
    const body = engineBodyLower();
    expect(body).toContain("sil_search");
    expect(body).toContain("sil_product_get");
    const noFurtherSetup =
      body.includes("no further setup") ||
      body.includes("without further setup") ||
      body.includes("zero further setup") ||
      body.includes("no additional setup");
    expect(noFurtherSetup).toBe(true);
  });

  it("does NOT couple creation to identity (no register/token as a precondition to CREATE)", () => {
    const body = engineBodyLower();
    const couplesIdentity =
      /register[^.]*before[^.]*creat/.test(body) ||
      /creat[^.]*requires[^.]*register/.test(body) ||
      /must.*register.*to.*creat/.test(body);
    expect(couplesIdentity).toBe(false);
  });
});

describe("references/agent_creation_engine.md — persona → host SOUL.md directly; $SIL_DATA_DIR holds the shared user spec", () => {
  it("writes the persona DIRECTLY into the host SOUL.md — NO sil persona.md, no copy step", () => {
    const body = engineBodyLower();
    expect(body).toContain("soul.md");
    const namesDirectWrite =
      body.includes("straight into") ||
      body.includes("write the persona directly") ||
      body.includes("persona directly") ||
      body.includes("directly into the workspace soul.md") ||
      body.includes("directly into the host soul.md") ||
      (body.includes("persona") && body.includes("soul.md") && body.includes("no copy"));
    expect(namesDirectWrite).toBe(true);
    const namesCopyStep =
      body.includes("copy the materialized persona") ||
      body.includes("copy the persona") ||
      body.includes("copies the persona") ||
      body.includes("copy persona.md");
    expect(namesCopyStep).toBe(false);
  });

  it("names $SIL_DATA_DIR as where the shared user spec is materialized, with the store boundary kept clean (host config = wiring)", () => {
    const body = engineBodyLower();
    const namesDataDir =
      body.includes("$sil_data_dir") ||
      body.includes("sil_data_dir") ||
      body.includes("sil data directory") ||
      body.includes("sil data dir");
    const namesHostConfig =
      body.includes("openclaw agents add") || body.includes("openclaw config validate");
    expect(namesDataDir).toBe(true);
    expect(namesHostConfig).toBe(true);
  });

  it("the Runtime hook loads the shared user_spec + the (possibly empty) domains map; per-domain packs load LAZILY at shop time", () => {
    // NET-NEW: the retired engine loaded four sil artefacts at runtime. The single-
    // shopper engine loads the SHARED user spec + the domains map, and per-domain
    // packs load lazily on first shop.
    const body = engineBodyLower();
    const loadsSharedUserSpec =
      body.includes("shared `user_spec.md`") ||
      body.includes("shared user_spec.md") ||
      body.includes("shared user spec") ||
      (body.includes("user_spec") && body.includes("shared"));
    const namesDomainsMap =
      body.includes("`domains`") || body.includes("domains map") || body.includes("domains` map");
    const lazy =
      body.includes("lazil") || body.includes("lazy") ||
      body.includes("on first shop") || body.includes("at shop time");
    expect(loadsSharedUserSpec).toBe(true);
    expect(namesDomainsMap).toBe(true);
    expect(lazy).toBe(true);
  });
});

/* ===========================================================================
 * ADMISSION (#37, preserved) — the create flow admits sil at tools.alsoAllow via
 * the shipped helper, AFTER the agent shell, gating `created` on real admission.
 * ========================================================================= */

/** Stable identifiers of the shipped #35 helper: the package bin, the script
 * basename, and the pnpm script. Naming one is enough; all three are distinctive
 * to the real artefact, so requiring one pins the REAL shipped helper — never a
 * hand-rolled `openclaw config set` that would clobber existing `tools.alsoAllow`. */
const ALLOWLIST_HELPER_TOKENS = [
  "sil-openclaw-allowlist",
  "allowlist-openclaw.mjs",
  "openclaw:allowlist",
] as const;

function firstHelperIdx(body: string): number {
  const idxs = ALLOWLIST_HELPER_TOKENS.map((t) => body.indexOf(t)).filter((i) => i >= 0);
  return idxs.length ? Math.min(...idxs) : -1;
}

describe("references/agent_creation_engine.md — admits sil at tools.alsoAllow via the shipped helper (#37, retained through the rewrite)", () => {
  it("invokes the shipped allow-list helper (sil-openclaw-allowlist / allowlist-openclaw.mjs / openclaw:allowlist), NOT just enabling the plugin", () => {
    const present = ALLOWLIST_HELPER_TOKENS.filter((t) => engineBodyLower().includes(t));
    expect(present).not.toEqual([]);
  });

  it("names the tool-admission surface `tools.alsoAllow` (the surface that un-filters sil's tools)", () => {
    expect(engineBodyLower()).toContain("tools.alsoallow");
  });

  it("orders the admission step AFTER the agent shell is created (`openclaw agents add` precedes the helper)", () => {
    const body = engineBodyLower();
    const addIdx = body.indexOf("openclaw agents add");
    const helperIdx = firstHelperIdx(body);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(helperIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeLessThan(helperIdx);
  });

  it("gates the `created` verdict on real admission — a failed allow-list step yields `persistence_failed`, not a green `created` over filtered tools", () => {
    const body = engineBodyLower();
    const FAIL_TOKENS = [
      "non-zero",
      "exits non-zero",
      "helper exit",
      "helper fail",
      "admission fail",
      "failed admission",
      "allow-list fail",
      "allowlist fail",
    ];
    const failIdxs = FAIL_TOKENS.map((t) => body.indexOf(t)).filter((i) => i >= 0);
    expect(failIdxs.length).toBeGreaterThan(0);
    const failIdx = Math.min(...failIdxs);
    const window = body.slice(Math.max(0, failIdx - 240), failIdx + 320);
    expect(window).toContain("persistence_failed");
  });
});

/* ===========================================================================
 * BRAINSTORM / INTERVIEW — exactly TWO touchpoints (persona + shared user-spec
 * seed); NO create-time domain research / compare-options taste / intent sign-off.
 * ========================================================================= */

function brainstormBodyLower(): string {
  return readBody(BRAINSTORM_PATH).toLowerCase();
}

/**
 * The affirmative create-time-niche-work STEP instructions a regression to the
 * retired five-touchpoint interview would re-introduce: the deep niche research
 * (old §2), the compare-a-set-of-options taste (old §4), and the intent-dimension
 * sign-off (old §5) that the single-shopper interview RELOCATED to first-shop lazy
 * mint. Same phrases the old bare `not.toContain(...)` forbids targeted — but now
 * negation-aware (audit forward-gap 3): the corrected interview legitimately NAMES
 * these to DISAVOW them ("does NOT research any niche", "never interrogated here",
 * "deferred to first shop", "minted lazily"), so a bare forbid false-REDs the
 * disavowal. This is the disavowal-token discipline applied to a STEP, not a noun.
 */
const CREATE_TIME_NICHE_STEP_RE =
  /research (?:it|the niche) yourself|compare a set of options|ask (?:the user|you) to sign off/gi;

/** Negation / deferral markers that turn an affirmative-step match into a
 * legitimate disavowal when one sits within ~28 chars before the match (mirrors
 * `perNicheExpertOffenders`' retro-allowance lookback). */
const NICHE_STEP_DEFERRAL = [
  "not ",
  "never",
  "no ",
  "don't",
  "deferred",
  "instead",
  "lazily",
  "at first shop",
] as const;

/**
 * Affirmative create-time-niche-work step instructions that are NOT preceded
 * (within ~28 chars) by a negation/deferral token — i.e. a real regression that
 * re-introduces the retired step, never a disavowal of it. Returns the offending
 * contexts (empty ⇒ clean). Body is expected already-lowercased.
 */
function createTimeNicheStepOffenders(body: string): string[] {
  const offenders: string[] = [];
  CREATE_TIME_NICHE_STEP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CREATE_TIME_NICHE_STEP_RE.exec(body)) !== null) {
    const before = body.slice(Math.max(0, m.index - 28), m.index);
    const deferred = NICHE_STEP_DEFERRAL.some((t) => before.includes(t));
    if (!deferred) {
      offenders.push(
        body
          .slice(Math.max(0, m.index - 24), m.index + m[0].length + 12)
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
  }
  return offenders;
}

describe("references/brainstorm_interview.md — open, two-sided interview that converges a shopper draft", () => {
  it("names the brainstorm/interview as an open, multi-turn conversation that is NOT a form-fill", () => {
    const body = brainstormBodyLower();
    const namesInterview = body.includes("brainstorm") || body.includes("interview");
    const namesMultiTurn =
      body.includes("multi-turn") ||
      body.includes("back-and-forth") ||
      body.includes("back and forth") ||
      body.includes("conversation") ||
      body.includes("conversational");
    const disavowsForm =
      body.includes("not a fixed questionnaire") ||
      body.includes("not a questionnaire") ||
      body.includes("not a form-fill") ||
      body.includes("not a form fill") ||
      body.includes("not a form") ||
      body.includes("not a wizard") ||
      (body.includes("questionnaire") && body.includes("not"));
    expect(namesInterview).toBe(true);
    expect(namesMultiTurn).toBe(true);
    expect(disavowsForm).toBe(true);
  });

  it("converges with the user — reflect-back + confirm per touchpoint; collaborative / re-entrant", () => {
    const body = brainstormBodyLower();
    const reflectsBack =
      body.includes("reflect back") || body.includes("reflect-back") ||
      body.includes("reflects back") || body.includes("reflect a") ||
      body.includes("summary of what") || body.includes("reflect");
    const confirms =
      body.includes("confirm") || body.includes("yes/adjust") ||
      body.includes("before moving on") || body.includes("before advancing");
    const collaborative =
      body.includes("collaborative") || body.includes("re-entrant") ||
      body.includes("reentrant") || body.includes("revise an earlier") ||
      body.includes("revisit") || body.includes("not a locked wizard");
    expect(reflectsBack).toBe(true);
    expect(confirms).toBe(true);
    expect(collaborative).toBe(true);
  });
});

describe("references/brainstorm_interview.md — exactly TWO create touchpoints (persona + shared user-spec seed); no per-niche work at create", () => {
  it("names exactly TWO touchpoints — the PERSONA and the SHARED USER-SPEC seed", () => {
    // NET-NEW: the retired interview walked FIVE artefacts (one touchpoint each). The
    // single-shopper interview collapses to TWO: persona (voice/standing rules — the
    // shopper is a generalist, the niche no longer falls out) + a shared user-spec
    // seed (cross-niche facts + hard constraints).
    const body = brainstormBodyLower();
    const namesTwoTouchpoints =
      body.includes("two touchpoints") ||
      body.includes("two touch-points") ||
      body.includes("exactly two") ||
      (body.includes("two") && body.includes("touchpoint"));
    expect(namesTwoTouchpoints).toBe(true);
    const namesPersona = body.includes("persona");
    const namesSharedUserSpec =
      body.includes("shared user spec") ||
      body.includes("shared `user_spec") ||
      body.includes("shared user_spec") ||
      (body.includes("user spec") && body.includes("shared")) ||
      (body.includes("user_spec") && body.includes("shared"));
    expect(namesPersona).toBe(true);
    expect(namesSharedUserSpec).toBe(true);
  });

  it("seeds the SHARED user spec with cross-niche facts + hard constraints (not a per-niche fact)", () => {
    const body = brainstormBodyLower();
    const namesCrossNiche =
      body.includes("cross-niche") || body.includes("across every niche") ||
      body.includes("every niche") || body.includes("across niches");
    const namesFactsAndConstraints =
      (body.includes("fact") || body.includes("address") || body.includes("size")) &&
      (body.includes("hard constraint") || body.includes("hard-constraint") || body.includes("constraint"));
    expect(namesCrossNiche).toBe(true);
    expect(namesFactsAndConstraints).toBe(true);
  });

  it("RELOCATES niche work to first-shop lazy mint — no domain-research / compare-options / sign-off STEP runs at onboarding", () => {
    // The deep domain research (old §2), the compare-a-set-of-options taste (old §4),
    // and the intent-dimension sign-off (old §5) MOVE to first-shop lazy mint
    // (shop_loop.md). The corrected interview legitimately NAMES them only to
    // DISAVOW them ("not authored here", "deferred to first shop") — so we pin the
    // relocation POSITIVELY and forbid the AFFIRMATIVE old-model STEP instructions,
    // NEVER the bare tokens (the disavowal-token trap that false-greens/false-reds a
    // corrected doc).
    const body = brainstormBodyLower();
    // POSITIVE: the niche work is deferred to first shop / lazy mint.
    const relocates =
      (body.includes("first shop") || body.includes("lazily") || body.includes("lazy mint")) &&
      (body.includes("not authored here") ||
        body.includes("deferred") ||
        body.includes("no domain interview") ||
        body.includes("does not research any niche") ||
        body.includes("no niche is researched") ||
        body.includes("minted lazily") ||
        body.includes("minted later"));
    expect(relocates).toBe(true);
    // NEGATIVE (negation-aware — audit forward-gap 3): the active old five-touchpoint
    // create-STEP instructions are gone. A regression re-introduces one of these
    // affirmative steps ("research the niche yourself", "compare a set of options",
    // "ask the user to sign off"); the corrected interview only NAMES them to disavow
    // them. So flag a match ONLY when no negation/deferral token sits within ~28 chars
    // before it — NEVER a bare `not.toContain(...)`, which would false-RED a future
    // negated disavowal ("never asks you to research the niche yourself"). Matcher
    // stays `.toEqual([])` (add-only).
    expect(createTimeNicheStepOffenders(body)).toEqual([]);
  });
});

describe("references/brainstorm_interview.md — the assembled draft is { agentId, name, persona, userSpec }; endorsement-gated", () => {
  it("frames the converged output as a { agentId, name, persona, userSpec } draft (no domain, no per-niche specs)", () => {
    const body = brainstormBodyLower();
    expect(body).toContain("agentid");
    expect(body).toContain("persona");
    expect(body).toContain("userspec");
    const namesKebab =
      body.includes("lower-kebab") || body.includes("lower kebab") || body.includes("kebab");
    expect(namesKebab).toBe(true);
    expect(body).toContain("main");
    // NET-NEW draft shape: the contiguous { agentId, name, persona, userSpec } arg
    // list. The retired draft carried { …, domainSpec, intentSpec, userSpec, playbook }.
    // Pin the new shape POSITIVELY — the corrected doc legitimately NAMES
    // domainSpec/intentSpec only to DISAVOW them ("no domainSpec/intentSpec — there
    // is none at create"), so a bare `not.toContain("domainspec")` would false-fail.
    expect(body).toContain("agentid, name, persona, userspec");
  });

  it("names an explicit endorsement/go-ahead on the assembled draft, BEFORE the engine handoff", () => {
    const body = brainstormBodyLower();
    const namesEndorsement =
      body.includes("endorse") || body.includes("endorsement") ||
      body.includes("go-ahead") || body.includes("go ahead");
    const namesDraft =
      body.includes("draft") || body.includes("assembled spec") || body.includes("assembled draft");
    expect(namesEndorsement).toBe(true);
    expect(namesDraft).toBe(true);
    const endorseIdx = body.indexOf("endorse");
    const lastEngineHandoffIdx = body.lastIndexOf("agent_creation_engine.md");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(lastEngineHandoffIdx).toBeGreaterThanOrEqual(0);
    expect(endorseIdx).toBeLessThan(lastEngineHandoffIdx);
  });

  it("states ZERO engine steps run before endorsement; abandon mid-flow creates nothing", () => {
    const body = brainstormBodyLower();
    const nothingBeforeEndorse =
      body.includes("nothing is created until") ||
      body.includes("nothing created until") ||
      body.includes("creates nothing until") ||
      body.includes("zero engine steps") ||
      body.includes("no engine step") ||
      (body.includes("only") && body.includes("endorse"));
    const abandonClean =
      body.includes("nothing is created") || body.includes("nothing created") ||
      body.includes("created nothing") || body.includes("no partial") ||
      body.includes("nothing partial") || body.includes("clean state");
    expect(nothingBeforeEndorse).toBe(true);
    expect(abandonClean).toBe(true);
  });

  it("does NOT present sil registration / a token as a prerequisite to CREATE the shopper", () => {
    const body = brainstormBodyLower();
    const couplesIdentity =
      /register[^.]*before[^.]*creat/.test(body) ||
      /creat[^.]*requires[^.]*register/.test(body) ||
      /must.*register.*to.*creat/.test(body);
    expect(couplesIdentity).toBe(false);
  });
});

/* ===========================================================================
 * SHOP LOOP — the heart of the model change. classify → reuse-before-mint →
 * on-miss research + materialize WITH domain (announced, correctable) → the loop
 * over the active domain; per-query sil_remember; precedence with SHARED user_spec.
 * ========================================================================= */

function shopLoopBodyLower(): string {
  return readBody(SHOP_LOOP_PATH).toLowerCase();
}

describe("references/shop_loop.md — exists; one shopper, many lazily-minted domains", () => {
  it("exists on disk", () => {
    expect(existsSync(SHOP_LOOP_PATH)).toBe(true);
  });

  it("frames ONE shopper holding many domains, each minted lazily on first shop, reading the shared user spec + the domains map", () => {
    const body = shopLoopBodyLower();
    const oneShopperManyDomains =
      (body.includes("one shopper") && body.includes("domain")) ||
      (body.includes("single shopper") && body.includes("domain"));
    expect(oneShopperManyDomains).toBe(true);
    const lazyMint =
      body.includes("minted lazily") || body.includes("lazily") ||
      (body.includes("mint") && body.includes("first shop"));
    expect(lazyMint).toBe(true);
    const readsSharedUserSpec =
      body.includes("shared user spec") || body.includes("shared `user_spec") ||
      (body.includes("user_spec") && body.includes("shared"));
    expect(readsSharedUserSpec).toBe(true);
  });
});

describe("references/shop_loop.md — entry: classify → reuse-before-mint (semantic dedup) → on-miss mint announced + correctable", () => {
  it("classifies the query's niche by skill reasoning (no routing tool), then reads profile.json.domains", () => {
    const body = shopLoopBodyLower();
    const namesClassify = body.includes("classify") || body.includes("classif");
    expect(namesClassify).toBe(true);
    const readsDomainsMap =
      body.includes("profile.json.domains") ||
      body.includes("profile.json`.domains") ||
      (body.includes("profile.json") && body.includes("domains"));
    expect(readsDomainsMap).toBe(true);
  });

  it("REUSES an existing matching domain before minting — semantic slug dedup is the shop loop's job (load-bearing)", () => {
    // Architect risk: the store enforces only shape; without reuse-before-mint the
    // one shopper fragments into thin duplicate packs. This is the headline dedup
    // rule the test must pin hard.
    const body = shopLoopBodyLower();
    const namesReuseBeforeMint =
      body.includes("reuse-before-mint") ||
      body.includes("reuse an existing domain before minting") ||
      (body.includes("reuse") && (body.includes("before mint") || body.includes("before minting")));
    expect(namesReuseBeforeMint).toBe(true);
    const namesSemanticDedup = body.includes("semantic") && (body.includes("dedup") || body.includes("slug"));
    const namesFragmentRisk =
      body.includes("fragment") || body.includes("duplicate") || body.includes("thin pack") || body.includes("thin packs");
    expect(namesSemanticDedup || namesFragmentRisk).toBe(true);
  });

  it("on a MISS mints the domain on the fly, ANNOUNCED, with the inferred domain STATED so the user can correct it", () => {
    const body = shopLoopBodyLower();
    const announces =
      body.includes("announce") || body.includes("announced") ||
      (body.includes("tell the user") && body.includes("new niche"));
    const disavowsSilentMint =
      body.includes("never silently") || body.includes("not silently") ||
      (body.includes("announce") && body.includes("never"));
    const correctable =
      body.includes("correct it") || body.includes("can correct") ||
      body.includes("stated so the user can correct") || body.includes("the inferred");
    expect(announces).toBe(true);
    expect(disavowsSilentMint).toBe(true);
    expect(correctable).toBe(true);
  });

  it("on a MISS runs the research pass + persists with `sil_profile_materialize` WITH a `domain` object (the whole-doc mint path)", () => {
    const body = shopLoopBodyLower();
    expect(body.includes("research")).toBe(true);
    expect(body).toContain("sil_profile_materialize");
    const withDomainObject =
      body.includes("with the `domain` object") ||
      body.includes("with the domain object") ||
      body.includes("with a `domain` object") ||
      body.includes("with a domain object") ||
      body.includes("domain: { slug") ||
      (body.includes("sil_profile_materialize") && body.includes("domain") && body.includes("slug"));
    expect(withDomainObject).toBe(true);
  });
});

describe("references/shop_loop.md — layering precedence with the SHARED user spec; per-query learning via sil_remember", () => {
  it("layers intent > playbook(domain) > user_spec(SHARED) > domain_spec(domain), with hard-constraint inviolability", () => {
    const body = shopLoopBodyLower();
    const namesPrecedence =
      body.includes("intent > playbook") ||
      (body.includes("precedence") && body.includes("intent") && body.includes("playbook") &&
        body.includes("user_spec") && body.includes("domain_spec"));
    expect(namesPrecedence).toBe(true);
    const userSpecIsShared =
      body.includes("user_spec(shared)") ||
      body.includes("shared user spec") ||
      (body.includes("user_spec") && body.includes("shared"));
    expect(userSpecIsShared).toBe(true);
    const hardInviolable =
      (body.includes("hard constraint") || body.includes("hard-constraint")) &&
      (body.includes("inviolable") || body.includes("never overrid") || body.includes("never break") || body.includes("never violate"));
    expect(hardInviolable).toBe(true);
  });

  it("persists a per-query learning with a SINGLE sil_remember call — fact → SHARED user spec, taste → ACTIVE domain", () => {
    const body = shopLoopBodyLower();
    expect(body).toContain("sil_remember");
    const factToShared =
      (body.includes('kind: "fact"') || body.includes("kind:fact") || body.includes("kind: fact")) &&
      (body.includes("shared") || body.includes("every niche") || body.includes("across"));
    expect(factToShared).toBe(true);
    const tasteToActiveDomain =
      (body.includes('kind: "taste"') || body.includes("kind:taste") || body.includes("kind: taste")) &&
      body.includes("active domain");
    expect(tasteToActiveDomain).toBe(true);
  });

  it("reserves the whole-doc `sil_profile_materialize` for the heavy paths (mint, web refresh, refine) — NOT per-query learning", () => {
    const body = shopLoopBodyLower();
    expect(body).toContain("sil_profile_materialize");
    expect(body).toContain("sil_remember");
    const reservesWholeDoc =
      body.includes("whole-doc") || body.includes("whole doc") ||
      body.includes("web refresh") || body.includes("web-refresh") ||
      body.includes("refine") || body.includes("contradict") ||
      body.includes("re-materialize");
    expect(reservesWholeDoc).toBe(true);
  });

  it("carries an after-recommendation capture that routes each surfaced fact/taste through sil_remember, firing ONLY when something surfaced", () => {
    const body = shopLoopBodyLower();
    const triggers = [
      "after every recommendation",
      "after a recommendation",
      "after the recommendation",
      "after recommending",
      "before the turn ends",
      "post-recommendation",
      "after-recommendation",
    ];
    const hits = triggers.map((t) => body.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b);
    expect(hits.length, "no after-recommendation trigger phrase found").toBeGreaterThan(0);
    const at = hits[0] ?? 0;
    expect(body.slice(at, at + 600)).toContain("sil_remember");
    const onlyWhenSurfaced =
      body.includes("only when") || body.includes("only if") ||
      body.includes("nothing surfaced") || body.includes("no new fact") ||
      body.includes("no empty") || body.includes("noise");
    expect(onlyWhenSurfaced).toBe(true);
  });

  it("keeps capture in-the-open + reviewable via sil_profile_get + erasable via sil_profile_remove", () => {
    const body = shopLoopBodyLower();
    const inTheOpen =
      body.includes("in the open") || body.includes("in-the-open") ||
      body.includes("never silently harvested") || body.includes("not silently harvested");
    expect(inTheOpen).toBe(true);
    expect(body).toContain("sil_profile_get");
    expect(body).toContain("sil_profile_remove");
  });
});

describe("references/shop_loop.md — the map/search/compare/recommend loop (preserved invariants)", () => {
  it("maps to real sil_search params, never invents a filter, leaves ship_to empty without a sil_whoami round-trip", () => {
    const body = shopLoopBodyLower();
    expect(body).toContain("sil_search");
    const neverInvents =
      body.includes("never invent a filter") || body.includes("never invent a param") ||
      body.includes("not invent a filter") || body.includes("do not invent") ||
      (body.includes("invent") && body.includes("filter"));
    expect(neverInvents).toBe(true);
    expect(body).toContain("ship_to");
    const leavesShipToEmpty =
      body.includes("ship_to empty") || body.includes("leave ship_to empty") ||
      (body.includes("ship_to") && body.includes("empty"));
    expect(leavesShipToEmpty).toBe(true);
    const disavowsWhoami =
      /(never|not|no|without|don't|do not)[^.]*sil_whoami/.test(body) ||
      /sil_whoami[^.]*(never|not)/.test(body);
    expect(disavowsWhoami).toBe(true);
  });

  it("recommends with the 'why' that cites the layers, presents best-first, and never re-ranks", () => {
    const body = shopLoopBodyLower();
    const requiresWhy =
      body.includes("rationale") || body.includes('"why"') || body.includes("the why") ||
      body.includes("why this") || (body.includes("recommend") && body.includes("cite"));
    expect(requiresWhy).toBe(true);
    const namesBestFirst = body.includes("best-first") || body.includes("best first") || body.includes("in order");
    const disavowsRerank =
      body.includes("never re-rank") || body.includes("not re-rank") ||
      body.includes("do not re-rank") || (body.includes("re-rank") && body.includes("not"));
    expect(namesBestFirst).toBe(true);
    expect(disavowsRerank).toBe(true);
  });

  it("re-fetches the chosen item with sil_product_get BEFORE any buy (never commits off the stale sil_search snapshot)", () => {
    // A bare indexOf("buy") mis-anchors on "buying niche" / "how to buy well" early
    // in the doc, so pin the re-fetch-before-buy invariant by PHRASE, not a global
    // ordering scan: the pre-buy re-fetch step + the never-off-stale rule.
    const body = shopLoopBodyLower();
    expect(body).toContain("sil_product_get");
    const refetchBeforeBuy =
      body.includes("before any buy") ||
      body.includes("before the buy") ||
      body.includes("before any purchase") ||
      body.includes("before any checkout") ||
      (body.includes("re-fetch") && body.includes("before"));
    expect(refetchBeforeBuy).toBe(true);
    const neverOffStale =
      body.includes("never commit a buy off the stale") ||
      body.includes("off the stale") ||
      (body.includes("stale") && body.includes("snapshot")) ||
      body.includes("point-in-time");
    expect(neverOffStale).toBe(true);

    // Two-sided contract (audit forward-gap 2): the PROSE deliberately keeps every
    // buy-substring OUT of Steps 0–7 — it shops with "shop well" / "shopping taste",
    // never "buy well" / "buying taste" — so the FIRST "buy" substring in the body
    // is the real Step-8 re-fetch step. Anchor on the FIRST occurrence and assert
    // its surrounding window co-locates with the `sil_product_get` re-fetch, so a
    // future "buy well" in an early step moves the first buy UPSTREAM into a window
    // that names neither `sil_product_get` nor the re-fetch → RED. This is a POSITIVE
    // window pin, NOT a naive global indexOf("buy") vs indexOf("sil_product_get")
    // ordering scan (which downstream "unbuyable" / "buying taste" would confound).
    const firstBuy = body.indexOf("buy");
    expect(firstBuy).toBeGreaterThanOrEqual(0);
    const firstBuyWindow = body.slice(Math.max(0, firstBuy - 140), firstBuy + 20);
    expect(firstBuyWindow).toContain("sil_product_get");
    expect(firstBuyWindow).toMatch(/re-fetch|before any buy/);
  });

  it("handles ok+empty (relax + explain), the unservable 'no' (never junk), and non-ok (follow recovery, never improvise)", () => {
    const body = shopLoopBodyLower();
    const relaxesEmpty =
      (body.includes("relax") || body.includes("re-frame") || body.includes("broaden")) &&
      body.includes("explain");
    expect(relaxesEmpty).toBe(true);
    const honestNo =
      (body.includes("cannot serve") || body.includes("unservable") || body.includes("not shippable") || body.includes("out of scope")) &&
      (body.includes("honest") || body.includes("never fabricate") || body.includes("never pad") || body.includes("junk"));
    expect(honestNo).toBe(true);
    expect(body).toContain("recovery");
    const neverImprovise =
      body.includes("never improvise") || body.includes("not improvise") || body.includes("follow the tool");
    expect(neverImprovise).toBe(true);
  });

  it("DELEGATES the param table to search_param_mapping.md and the status taxonomy to catalog_tools_reference.md (references, does not restate)", () => {
    const body = shopLoopBodyLower();
    expect(body).toContain("search_param_mapping.md");
    expect(body).toContain("catalog_tools_reference.md");
    expect(body).not.toContain("awaiting_browser");
    expect(body).not.toContain("not_registered");
    expect(body).not.toContain("must_reregister");
  });
});

/* ===========================================================================
 * MANAGE DOMAINS — list/view/remove operate on DOMAINS; remove ONE domain; two
 * granularities (forget a domain vs decommission the whole shopper).
 * ========================================================================= */

function manageBodyLower(): string {
  return readBody(MANAGE_PATH).toLowerCase();
}

describe("references/manage_domains.md — exists; names the three management tools", () => {
  it("exists on disk", () => {
    expect(existsSync(MANAGE_PATH)).toBe(true);
  });

  it("names the two surviving management tools sil_profile_get and sil_profile_remove (sil_profile_list folded away)", () => {
    const body = readBody(MANAGE_PATH);
    const missing = ["sil_profile_get", "sil_profile_remove"].filter(
      (name) => !body.includes(name),
    );
    expect(missing).toEqual([]);
    // The no-args sil_profile_get (Zoom A) absorbs the listing — sil_profile_list is gone.
    expect(body).not.toContain("sil_profile_list");
  });
});

describe("references/manage_domains.md — list/view/remove operate on DOMAINS; remove forgets ONE domain", () => {
  it("frames the managed unit as the shopper's DOMAINS (list/view/remove a domain), not per-niche experts", () => {
    const body = manageBodyLower();
    const namesList = body.includes("list");
    const namesView = body.includes("view") || body.includes("show");
    const namesRemove = body.includes("remove") || body.includes("forget") || body.includes("delete");
    expect(namesList && namesView && namesRemove).toBe(true);
    expect(body).toContain("domain");
  });

  it("`sil_profile_remove { domainSlug }` forgets ONE domain — the shopper, the shared user spec, and the SIBLING domains survive", () => {
    // NET-NEW: the retired manage flow removed a whole expert via `sil_profile_remove
    // { agentId }`. The single-shopper flow forgets ONE domain (domainSlug REQUIRED,
    // no caller agentId), leaving the shopper + shared user_spec + sibling domains intact.
    const body = manageBodyLower();
    const namesDomainSlug =
      body.includes("domainslug") || body.includes("domain_slug") || body.includes("domain slug");
    expect(namesDomainSlug).toBe(true);
    const forgetsOneDomain =
      body.includes("forget one domain") || body.includes("forget a domain") ||
      body.includes("one domain") || body.includes("single domain") ||
      (body.includes("one") && body.includes("domain") && body.includes("pack"));
    expect(forgetsOneDomain).toBe(true);
    const siblingsSurvive =
      body.includes("sibling") || body.includes("other domains") ||
      body.includes("shared user spec") || (body.includes("the shopper") && body.includes("survive"));
    expect(siblingsSurvive).toBe(true);
  });

  it("makes the TWO remove granularities distinct — forget a DOMAIN vs decommission the WHOLE SHOPPER (host CLI)", () => {
    // NET-NEW: "delete the grocery agent" now means forget the grocery DOMAIN.
    // Decommissioning the whole shopper (host wiring + SOUL.md + tree) is a separate,
    // host-CLI-first action.
    const body = manageBodyLower();
    const namesForgetDomain = body.includes("forget") && body.includes("domain");
    const namesDecommissionShopper =
      body.includes("decommission") || body.includes("whole shopper") ||
      body.includes("the entire shopper") || (body.includes("openclaw agents remove") && body.includes("shopper"));
    expect(namesForgetDomain).toBe(true);
    expect(namesDecommissionShopper).toBe(true);
    expect(body).toContain("openclaw agents remove");
  });

  it("confirms before a destructive remove; frames not_found / invalid_request gracefully (never a stack trace / raw path)", () => {
    const body = manageBodyLower();
    const confirms =
      body.includes("confirm") || body.includes("explicit go-ahead") || body.includes("ask before");
    expect(confirms).toBe(true);
    expect(body).toContain("not_found");
    expect(body).toContain("invalid_request");
    const graceful =
      body.includes("never a stack trace") || body.includes("not a stack trace") ||
      body.includes("raw path") || body.includes("raw filesystem path") ||
      (body.includes("stack trace") && body.includes("never"));
    expect(graceful).toBe(true);
  });

  it("keeps the artefact-store source-of-truth framing (profile.json, never the host agent list)", () => {
    const body = manageBodyLower();
    const namesArtefactSource =
      body.includes("profile.json") || body.includes("artefact store") ||
      body.includes("sil_data_dir") || body.includes("sil data dir");
    expect(namesArtefactSource).toBe(true);
    const namesSourceOfTruth =
      body.includes("source of truth") || body.includes("source-of-truth") ||
      body.includes("never the host agent list") || body.includes("not the host agent list");
    expect(namesSourceOfTruth).toBe(true);
  });

  it("names the manage status taxonomy (ok / not_found / invalid_request / removed / persistence_failed)", () => {
    const body = manageBodyLower();
    const missing = ["ok", "not_found", "invalid_request", "removed", "persistence_failed"].filter(
      (s) => !body.includes(s),
    );
    expect(missing).toEqual([]);
  });
});

/* ===========================================================================
 * REFINE SHOPPER — refine the shared user_spec OR one domain pack (by slug);
 * persisted whole-doc; persona → SOUL.md; confirm-subset gate.
 * ========================================================================= */

function refineBodyLower(): string {
  return readBody(REFINE_PATH).toLowerCase();
}

function refineCorpusLower(): string {
  return (readBody(REFINE_PATH) + "\n" + readBody(MAPPING_PATH)).toLowerCase();
}

describe("references/refine_shopper.md — exists; composes the load + persist tools", () => {
  it("exists on disk", () => {
    expect(existsSync(REFINE_PATH)).toBe(true);
  });

  it("names the load step `sil_profile_get` and the persist step `sil_profile_materialize`", () => {
    const body = refineBodyLower();
    expect(body).toContain("sil_profile_get");
    expect(body).toContain("sil_profile_materialize");
  });
});

describe("references/refine_shopper.md — targets the SHARED user_spec OR one DOMAIN pack (by slug)", () => {
  it("names the two refine targets — the shared user_spec (shopper-level) OR one domain pack selected by slug", () => {
    // NET-NEW: the retired refine targeted the four specs of one expert. The single-
    // shopper refine targets either the SHARED user_spec (no domain) OR one domain
    // pack (by slug — its domain_spec / intent_spec / playbook).
    const body = refineBodyLower();
    const namesSharedUserSpec =
      body.includes("shared user spec") || body.includes("shared `user_spec") ||
      (body.includes("user_spec") && body.includes("shared"));
    expect(namesSharedUserSpec).toBe(true);
    const namesDomainPackBySlug =
      (body.includes("domain pack") || body.includes("one domain") || body.includes("a domain")) &&
      (body.includes("slug") || body.includes("domainslug"));
    expect(namesDomainPackBySlug).toBe(true);
  });

  it("frames a distinct REFINE capability (load → propose → confirm → persist), session-grounded, never a generic template", () => {
    const body = refineBodyLower();
    const namesRefine = body.includes("refine") || body.includes("sharpen") || body.includes("amend");
    expect(namesRefine).toBe(true);
    const namesObserved =
      body.includes("observed session") || body.includes("observed shopping") ||
      (body.includes("observed") && body.includes("session"));
    expect(namesObserved).toBe(true);
    const disavowsGeneric =
      body.includes("not a generic template") || body.includes("not a generic") ||
      body.includes("never a generic") || body.includes("ungrounded") ||
      (body.includes("generic") && body.includes("not"));
    expect(disavowsGeneric).toBe(true);
  });

  it("persists ONLY the confirmed subset, gated on explicit confirmation that is NEVER inferred from silence / off-topic", () => {
    const body = refineBodyLower();
    const namesSubset =
      body.includes("subset") || body.includes("all, some, or none") ||
      body.includes("per-proposal") || body.includes("which to keep");
    expect(namesSubset).toBe(true);
    const confirmIdx = body.indexOf("confirm");
    const materializeIdx = body.indexOf("sil_profile_materialize");
    expect(confirmIdx).toBeGreaterThanOrEqual(0);
    expect(materializeIdx).toBeGreaterThanOrEqual(0);
    expect(confirmIdx).toBeLessThan(materializeIdx);
    const disavowsSilence =
      body.includes("never inferred from silence") || body.includes("not inferred from silence") ||
      (body.includes("silence") && body.includes("never"));
    const disavowsOffTopic =
      body.includes("off-topic") || body.includes("off topic") ||
      body.includes("unrelated question") || body.includes("unrelated reply") || body.includes("an unrelated");
    expect(disavowsSilence).toBe(true);
    expect(disavowsOffTopic).toBe(true);
  });
});

describe("references/refine_shopper.md — persist is whole-doc + atomic; failure leaves prior intact; persona → SOUL.md", () => {
  it("persists via the whole-doc `sil_profile_materialize` re-write (no hand-rolled write, no new tool)", () => {
    const body = refineBodyLower();
    expect(body).toContain("sil_profile_materialize");
    const namesAtomicRewrite =
      body.includes("atomic") || body.includes("in-place re-write") || body.includes("in-place rewrite") ||
      body.includes("re-materialize") || body.includes("overwrit") || body.includes("whole-doc");
    expect(namesAtomicRewrite).toBe(true);
  });

  it("states a persist FAILURE leaves the PRIOR artefacts intact (never a half-refined shopper)", () => {
    const body = refineBodyLower();
    const priorSurvives =
      body.includes("prior artefacts") || body.includes("prior state") ||
      body.includes("left intact") || body.includes("leaves intact") ||
      (body.includes("intact") && body.includes("prior"));
    const neverHalf =
      body.includes("half-refined") || body.includes("never half") ||
      body.includes("did not stick") || body.includes("nothing partial") || body.includes("no partial");
    expect(priorSurvives).toBe(true);
    expect(neverHalf).toBe(true);
  });

  it("a PERSONA refinement refreshes the host SOUL.md via the host CLI — NOT a sil persona.md", () => {
    const body = refineBodyLower();
    const namesSoulRefresh =
      body.includes("soul.md") &&
      (body.includes("refresh") || body.includes("rewrite") || body.includes("re-write") ||
        body.includes("update") || body.includes("host cli") || body.includes("host-cli"));
    expect(namesSoulRefresh).toBe(true);
    expect(body).not.toContain("persona.md");
  });
});

describe("references/refine_shopper.md — per-user/local; isolation; no-signal fallback; points at the mapping", () => {
  it("frames refinement as per-user + local under $SIL_DATA_DIR with NO server endpoint / identity round-trip", () => {
    const body = refineBodyLower();
    const namesPerUserLocal =
      body.includes("per-user") || body.includes("per user") || body.includes("local") || body.includes("your own");
    const namesDataDir =
      body.includes("$sil_data_dir") || body.includes("sil_data_dir") ||
      body.includes("sil data directory") || body.includes("sil data dir");
    expect(namesPerUserLocal).toBe(true);
    expect(namesDataDir).toBe(true);
    expect(body).not.toContain("sil_register");
    expect(body).not.toContain("sil_whoami");
    expect(body).not.toContain("sil-api");
    expect(body).not.toContain("https://");
  });

  it("isolates the refine to the targeted scope — siblings + the shared spec untouched unless they ARE the target", () => {
    const body = refineBodyLower();
    const namesIsolation =
      body.includes("sibling") || body.includes("other domains") ||
      body.includes("untouched") || body.includes("isolation") || body.includes("isolated");
    expect(namesIsolation).toBe(true);
  });

  it("on no observed-session signal, falls back to a guided amend / invite-to-shop-first — never fabricates observations", () => {
    const body = refineBodyLower();
    const namesNoSignal =
      body.includes("no observed") || body.includes("no session") ||
      body.includes("fresh session") || body.includes("out of context") || body.includes("no signal");
    const namesFallback =
      body.includes("guided amend") || body.includes("ask the user what to change") ||
      body.includes("ask what to change") || body.includes("invite") || body.includes("shop first");
    expect(namesNoSignal).toBe(true);
    expect(namesFallback).toBe(true);
    const disavowsFabrication =
      body.includes("not fabricate") || body.includes("never fabricate") ||
      body.includes("do not fabricate") || body.includes("never invent") ||
      (body.includes("fabricat") && body.includes("not"));
    expect(disavowsFabrication).toBe(true);
  });

  it("points at search_param_mapping.md for the param table rather than re-carrying it (ship_to-empty rule preserved)", () => {
    const refineOnly = readBody(REFINE_PATH).toLowerCase();
    expect(refineOnly).toContain("search_param_mapping.md");
    expect(refineOnly).not.toContain("price_min");
    expect(refineOnly).not.toContain("price_max");
    expect(refineCorpusLower()).toContain("ship_to");
  });
});

/* ===========================================================================
 * WORKED EXAMPLE — multi_domain_shopper_walkthrough.md demonstrates the headline:
 * create once → shop ≥2 unrelated niches in one session, 2nd minted on the fly +
 * announced, a shared fact reused across niches, taste isolation, a sil_remember.
 * ========================================================================= */

function exampleBodyLower(): string {
  return readBody(EXAMPLE_PATH).toLowerCase();
}

describe("examples/multi_domain_shopper_walkthrough.md — exists; create-once, endorsement-gated", () => {
  it("the renamed walkthrough exists on disk", () => {
    expect(existsSync(EXAMPLE_PATH)).toBe(true);
  });

  it("walks create-ONCE of the shopper, reaching the engine only after the explicit endorsement", () => {
    const body = exampleBodyLower();
    expect(body).toContain("shopper");
    expect(body).toContain("openclaw agents add");
    const endorseIdx = body.indexOf("endorse");
    const addIdx = body.indexOf("openclaw agents add");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(endorseIdx).toBeLessThan(addIdx);
  });
});

describe("examples/multi_domain_shopper_walkthrough.md — the multi-domain headline", () => {
  it("shops ≥2 UNRELATED niches in ONE session with no agent switch, the 2nd minted on the fly + ANNOUNCED", () => {
    // NET-NEW: the retired example shopped one niche (road cycling) across queries.
    // The new walkthrough demonstrates two UNRELATED niches in the same session, the
    // second minted lazily on the fly and announced.
    const body = exampleBodyLower();
    const namesSecondNiche =
      body.includes("second niche") || body.includes("another niche") ||
      body.includes("a second, unrelated niche") || body.includes("unrelated niche") ||
      (body.includes("two") && body.includes("niche"));
    expect(namesSecondNiche).toBe(true);
    const sameSession =
      body.includes("same session") || body.includes("one session") ||
      body.includes("no agent switch") || body.includes("without switching");
    expect(sameSession).toBe(true);
    const mintedAnnounced =
      body.includes("mint") && (body.includes("announce") || body.includes("on the fly") || body.includes("on the spot"));
    expect(mintedAnnounced).toBe(true);
  });

  it("reuses a SHARED fact captured in niche A while shopping niche B (never re-asked)", () => {
    const body = exampleBodyLower();
    const sharedReuse =
      (body.includes("shared") || body.includes("across") || body.includes("every niche")) &&
      (body.includes("reuse") || body.includes("reused") || body.includes("never re-ask") ||
        body.includes("without re-asking") || body.includes("kept from"));
    expect(sharedReuse).toBe(true);
  });

  it("demonstrates TASTE isolation — a taste learned in A does not leak into B", () => {
    const body = exampleBodyLower();
    const tasteIsolation =
      body.includes("taste") &&
      (body.includes("isolat") || body.includes("does not leak") || body.includes("never leak") ||
        body.includes("never b's") || body.includes("not leak"));
    expect(tasteIsolation).toBe(true);
  });

  it("shows a per-query sil_remember and the singleton-refusal edge (a second 'create' → 'a shopper already exists')", () => {
    const body = exampleBodyLower();
    expect(body).toContain("sil_remember");
    const singletonEdge =
      body.includes("a shopper already exists") || body.includes("already have a shopper") ||
      body.includes("shopper already exists") || (body.includes("singleton") && body.includes("refus"));
    expect(singletonEdge).toBe(true);
  });
});

/* ===========================================================================
 * HARD-CONSTRAINT ROUTING — the shared user-spec hard constraint is routed to a
 * real filter + a reject-at-recommend rule, never only `query` text (mapping doc).
 * ========================================================================= */

describe("references/search_param_mapping.md — hard constraint → real filter + reject-at-recommend, never only query text; ship_to empty", () => {
  it("routes a hard constraint to a real FILTER + an explicit reject-at-recommend rule, never only soft query text", () => {
    const body = readBody(MAPPING_PATH).toLowerCase();
    const namesHardConstraint =
      body.includes("hard constraint") || body.includes("hard-constraint") ||
      body.includes("hard-no") || body.includes("inviolable");
    const routesToFilterAndReject =
      (body.includes("filter") || body.includes("condition") || body.includes("available")) &&
      (body.includes("reject") || body.includes("never recommend") || body.includes("rubric"));
    const disavowsQueryOnly =
      body.includes("not only") || body.includes("never only") ||
      body.includes("not just query") || body.includes("not merely query");
    expect(namesHardConstraint).toBe(true);
    expect(routesToFilterAndReject).toBe(true);
    expect(disavowsQueryOnly).toBe(true);
  });

  it("leaves ship_to empty by default and never round-trips sil_whoami to populate it", () => {
    const body = readBody(MAPPING_PATH).toLowerCase();
    expect(body).toContain("ship_to");
    const leavesEmpty =
      body.includes("ship_to empty") || body.includes("leave ship_to empty") ||
      (body.includes("ship_to") && body.includes("empty"));
    expect(leavesEmpty).toBe(true);
    const disavowsWhoami =
      /(never|not|no|without|don't|do not)[^.]*sil_whoami/.test(body) ||
      /sil_whoami[^.]*(never|not)/.test(body);
    expect(disavowsWhoami).toBe(true);
  });
});

/* ===========================================================================
 * ON-QUERY SDS SPINE — card: enforce-the-on-query-sds-spine-in-the-shop-loop.
 *
 * The founder is promoting the on-EVERY-query SDS sequence in shop_loop.md into a
 * hard, non-skippable FIVE-BEAT spine, splitting today's Step 3 so ELICITATION
 * becomes a first-class ORDERED gate AHEAD of search (the headline). SKILL.md gains
 * ONE reinforcement line making the on-every-query domain-exists check non-skippable,
 * scoped "as the shopper" (Lane 2). Lane 1 (profile-less bare sil_search) stays bare.
 * Skill-prose only — no tool change; the six exact-set/count mirrors are NOT triggered.
 *
 * These are ADD-ONLY drift guards. Every describe ABOVE stays UNEDITED and green.
 * Disavowal discipline (docs/knowledge/skill-prose-drift-guard-disavowal-discipline.md):
 * positive OR-grouped semantic tokens, negation-aware negatives, offender matchers
 * `.toEqual([])`. No `§N` anchors.
 *
 * RED-capability, proven against today's (pre-re-order) files by pre-flight grep:
 *   - shop_loop.md: the beat-3 gate anchors ("gather what's missing"/"before searching"/
 *     "elicitation gate"/"elicit the unresolved") and the beat-4 anchors ("persist what
 *     surfaced"/"persist the surfaced") are ALL absent today (elicitation is still folded
 *     into Step 3), so the five-beat ordering pin and the elicit-before-search gate pin RED.
 *   - SKILL.md: the skip-family reinforcement tokens ("non-skippable"/"before any search"/…)
 *     are absent today (grepped to zero), so the SKILL reinforcement pin REDs. The card's
 *     fuller OR-group ("every query"/"on every"/"first") is DELIBERATELY NOT the anchor —
 *     those already live at L43 ("learns every query", "shops every niche") and would
 *     false-GREEN the reinforcement (content-seam-false-green trap).
 * The regression rails (buy-window ordering, after-recommendation ordering, Lane-1 bare)
 * are GREEN today and stay green — they guard what the re-order must NOT break.
 * ========================================================================= */

/** First index of ANY of `tokens` in the already-lowercased `body`, or -1 if none
 * are present. Used for OR-grouped step anchors + index-ordering pins. Because it
 * returns -1 when a NET-NEW anchor is absent, every ordering assertion below is
 * guarded by a `toBeGreaterThanOrEqual(0)` on the anchor FIRST — so a -1 can never
 * false-satisfy a `toBeLessThan` (−1 < any positive index). */
function firstIndexOfAny(body: string, tokens: readonly string[]): number {
  const idxs = tokens.map((t) => body.indexOf(t)).filter((i) => i >= 0);
  return idxs.length ? Math.min(...idxs) : -1;
}

// OR-group anchors for the five beats (solutions-architect handoff). b3 + b4 are the
// NET-NEW gate/persist anchors — absent in today's Step-3-folded doc.
const SPINE_BEAT1_ANCHORS = ["domain-exists check", "classify the query's niche"] as const;
const SPINE_BEAT2_ANCHORS = ["on a miss", "learn the domain and how", "mint the domain on the fly"] as const;
const SPINE_BEAT3_ANCHORS = ["gather what's missing", "before searching", "elicitation gate", "elicit the unresolved"] as const;
const SPINE_BEAT4_ANCHORS = ["persist what surfaced", "persist the surfaced"] as const;
// The search-EXECUTION phrase, unique to the call step. NOT a bare indexOf("sil_search")
// — that mis-anchors on the earlier layering/map prose (architect risk). Lowercased.
const SEARCH_EXEC_ANCHOR = "call `sil_search` with the mapped";
const SPINE_BEAT5_ANCHORS = [SEARCH_EXEC_ANCHOR, "then search"] as const;

describe("references/shop_loop.md — the on-query SDS spine reads as five ordered beats (add-only; card: enforce-the-on-query-sds-spine)", () => {
  it("presents the five beats in strict order: domain-exists → learn-on-miss → ELICIT-gate → persist → search-execution", () => {
    const body = shopLoopBodyLower();
    const b1 = firstIndexOfAny(body, SPINE_BEAT1_ANCHORS);
    const b2 = firstIndexOfAny(body, SPINE_BEAT2_ANCHORS);
    const b3 = firstIndexOfAny(body, SPINE_BEAT3_ANCHORS);
    const b4 = firstIndexOfAny(body, SPINE_BEAT4_ANCHORS);
    const b5 = firstIndexOfAny(body, SPINE_BEAT5_ANCHORS);
    // Each beat present. b3 (the promoted elicit gate) and b4 (persist-what-surfaced)
    // are NET-NEW anchors — both absent today, so these two `>= 0` checks are the RED
    // driver: the promotion has not been done until they appear.
    expect(b1, "beat 1 (domain-exists / classify) anchor missing").toBeGreaterThanOrEqual(0);
    expect(b2, "beat 2 (learn-on-miss / mint) anchor missing").toBeGreaterThanOrEqual(0);
    expect(b3, "beat 3 (elicit gate) anchor missing — elicitation is not yet a first-class ordered step").toBeGreaterThanOrEqual(0);
    expect(b4, "beat 4 (persist-what-surfaced) anchor missing").toBeGreaterThanOrEqual(0);
    expect(b5, "beat 5 (search-execution) anchor missing").toBeGreaterThanOrEqual(0);
    // Strict index ordering (each guarded by the `>= 0` checks above).
    expect(b2, "beat 2 must follow beat 1").toBeGreaterThan(b1);
    expect(b3, "beat 3 (elicit) must follow beat 2").toBeGreaterThan(b2);
    expect(b4, "beat 4 (persist) must follow beat 3 (elicit)").toBeGreaterThan(b3);
    expect(b5, "beat 5 (search) must follow beat 4 (persist)").toBeGreaterThan(b4);
  });
});

describe("references/shop_loop.md — the elicit-missing gate is a first-class step ORDERED BEFORE search (the headline promotion; add-only)", () => {
  it("positions the elicitation gate before the search-execution call, resolving three sources + asking only genuinely-unresolved dimensions", () => {
    const body = shopLoopBodyLower();
    const gate = firstIndexOfAny(body, SPINE_BEAT3_ANCHORS);
    const searchExec = body.indexOf(SEARCH_EXEC_ANCHOR);
    // (a) the gate is a present, named step (NET-NEW → RED today).
    expect(gate, "the standalone elicit-before-search gate is absent (still folded into Step 3)").toBeGreaterThanOrEqual(0);
    // the search-execution anchor is present (regression: the call step keeps its unique phrasing).
    expect(searchExec, "search-execution anchor 'call `sil_search` with the mapped' missing").toBeGreaterThanOrEqual(0);
    // (d) ORDERED BEFORE search — guarded by gate >= 0 above so an absent gate (-1) can't
    // false-pass (-1 < searchExec). This is the on-query-SDS headline: elicit precedes search.
    expect(gate, "the elicit gate must be ordered before the search-execution call").toBeLessThan(searchExec);

    // Scope (b)/(c)/(e) to the gate window [gate, searchExec] so they pin the GATE, not an
    // incidental mention (the recommend "why" also cites intent/playbook/user_spec downstream).
    const gateWindow = body.slice(Math.max(0, gate), searchExec > gate ? searchExec : body.length);
    // (b) resolves each dimension against the THREE sources — request/intent AND the shared
    // user_spec AND the active playbook (the "resolve first, ask only what's left" rule).
    const namesRequest = gateWindow.includes("request") || gateWindow.includes("intent");
    const namesUserSpec =
      gateWindow.includes("user_spec") || gateWindow.includes("user spec") || gateWindow.includes("shared spec");
    const namesPlaybook =
      gateWindow.includes("playbook") || (gateWindow.includes("active domain") && gateWindow.includes("taste"));
    expect(
      namesRequest && namesUserSpec && namesPlaybook,
      "the gate must resolve each dimension against the request/intent + the shared user_spec + the active playbook",
    ).toBe(true);
    // (c) asks ONLY genuinely-unresolved, load-bearing dimensions (need-driven, never a battery).
    const asksOnlyUnresolved = [
      "ask only for what",
      "genuinely unresolved",
      "need-driven",
      "only a dimension missing",
      "only when a dimension",
      "load-bearing",
    ].some((t) => gateWindow.includes(t));
    expect(asksOnlyUnresolved, "the gate must state the ask-only-genuinely-unresolved / load-bearing discipline").toBe(true);
    // (e) the per-query decompose stays EPHEMERAL (never persisted). Pinned POSITIVELY — NOT a
    // bare forbid of the accretive-capture prose (beat 4 legitimately still handles facts/tastes);
    // the promotion is enforced by the ORDERING above, never by a `not.toContain`.
    const ephemeral = ["ephemeral", "never persisted"].some((t) => gateWindow.includes(t));
    expect(ephemeral, "the per-query intent fill must be named ephemeral / never persisted").toBe(true);
  });

  it("does NOT force an always-ask — the zero-question happy path (enough resolved ⇒ straight to search) stays legal", () => {
    // The council's product distinction: "non-skippable" governs the shopper's REASONING,
    // not the user's inbox. The gate RUNS every query but ASKS only when a load-bearing
    // dimension is genuinely unresolved. This guard deliberately asserts NOTHING about a
    // question being asked (that would wrongly force an always-ask); it only pins that the
    // straight-to-search escape hatch is documented, so a future "always ask before search"
    // regression is not silently blessed here.
    const body = shopLoopBodyLower();
    const straightToSearch =
      body.includes("straight to") ||
      body.includes("proceed directly") ||
      body.includes("ask nothing") ||
      body.includes("zero question") ||
      body.includes("no question") ||
      body.includes("pass straight through") ||
      (body.includes("proceed") && body.includes("search"));
    expect(straightToSearch, "the zero-question happy path (enough resolved ⇒ straight to search) must stay documented").toBe(true);
  });
});

// Skip-family reinforcement anchor for SKILL.md — NET-NEW (absent today, grepped to zero),
// so it is the RED driver. The card's fuller OR-group is not used as the anchor because
// "every query"/"on every"/"first" already live at L43 and would false-GREEN.
const SKILL_SKIP_REINFORCE_ANCHORS = [
  "non-skippable",
  "non skippable",
  "cannot be skipped",
  "never skip",
  "do not skip",
  "before any search",
] as const;
const SKILL_DOMAIN_CHECK_TOKENS = [
  "domain-exists",
  "domain exists",
  "domain-check",
  "domain check",
  "classify",
  "reuse a learned domain",
  "reuses a learned domain",
  "reuse or mint",
  "which domain",
] as const;
// The lean-router-forbidden tokens the reinforcement line must NOT introduce (mirrors the
// pre-existing lean-router guards at :448-462 / :247-254; asserted here scoped to the new line).
const LEAN_ROUTER_FORBIDDEN = [
  "openclaw agents add",
  "openclaw config validate",
  "sil_profile_materialize",
  "awaiting_browser",
  "not_registered",
  "must_reregister",
  "retryable",
  "sil_profile_list",
] as const;

describe("sil-shopping/SKILL.md — one reinforcement line makes the on-every-query domain-exists check non-skippable, scoped 'as the shopper' (add-only)", () => {
  it("adds a NON-SKIPPABLE domain-exists reinforcement in the shopper (Lane 2) routing, clean of lean-router-forbidden tokens", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    const idx = firstIndexOfAny(body, SKILL_SKIP_REINFORCE_ANCHORS);
    // NET-NEW anchor → RED today; GREEN once the reinforcement line lands.
    expect(idx, "SKILL.md must add a non-skippable / before-any-search domain-exists reinforcement").toBeGreaterThanOrEqual(0);
    // The reinforcement is ABOUT the domain-exists / classify / reuse-or-mint check.
    const win = body.slice(Math.max(0, idx - 450), idx + 450);
    const namesDomainCheck = SKILL_DOMAIN_CHECK_TOKENS.some((t) => win.includes(t));
    expect(namesDomainCheck, "the reinforcement must be about the domain-exists / classify / reuse-or-mint check").toBe(true);
    // Scoped to Lane 2 — 'as the shopper' near the reinforcement (never the general router).
    const scopedShopper = body.slice(Math.max(0, idx - 700), idx + 700).includes("as the shopper");
    expect(scopedShopper, "the reinforcement must be scoped 'as the shopper' (Lane 2), not the general router").toBe(true);
    // Belt: the reinforcement window introduces NONE of the lean-router-forbidden tokens.
    const bledForbidden = LEAN_ROUTER_FORBIDDEN.filter((t) => win.includes(t));
    expect(bledForbidden, "the reinforcement window must stay clean of lean-router-forbidden tokens").toEqual([]);
    // Whole-word `expert`-free around the new line (disavowal discipline).
    expect(perNicheExpertOffenders(win)).toEqual([]);
  });
});

// Negation-aware Lane-boundary scan (mirrors perNicheExpertOffenders' retro-allowance): a
// pre-search-gate instruction is an OFFENDER only when NOT scoped to the shopper (Lane 2)
// within ~200 chars before it. The card's own reinforcement IS scoped ('as the shopper'/
// 'shopper' dense in the L43 paragraph), so it is allowed; an unscoped clarifying-question /
// domain-check step added to the general router (breaking Lane 1) is flagged.
const LANE1_GATE_RE =
  /clarifying question|ask[^.]{0,40}(?:clarifying|a question|questions)|domain[- ]exists check|before any search/gi;
const LANE2_SCOPE_TOKENS = ["as the shopper", "shopper", "loaded profile", "shop_loop"] as const;
function laneBleedOffenders(body: string): string[] {
  const offenders: string[] = [];
  LANE1_GATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LANE1_GATE_RE.exec(body)) !== null) {
    const before = body.slice(Math.max(0, m.index - 200), m.index);
    const scoped = LANE2_SCOPE_TOKENS.some((t) => before.includes(t));
    if (!scoped) {
      offenders.push(
        body
          .slice(Math.max(0, m.index - 24), m.index + m[0].length + 12)
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
  }
  return offenders;
}

describe("sil-shopping/SKILL.md — Lane 1 (profile-less bare sil_search) stays bare (add-only, negation-aware)", () => {
  it("preserves the profile-less → 'find X' → sil_search bare boundary (unchanged)", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    expect(body).toContain("profile-less");
    expect(body).toContain('"find x"');
    const staysBare = body.includes("unchanged") || body.includes("bare") || body.includes("untouched");
    expect(staysBare, "the profile-less Lane-1 boundary ('find X' → sil_search, unchanged) must be preserved").toBe(true);
  });

  it("keeps the Lane-1 'find X' routing ROW bare — sil_search only, no domain/elicit/gate token", () => {
    const raw = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const rowLine = raw
      .split(/\r?\n/)
      .find((l) => l.trimStart().startsWith("|") && l.toLowerCase().includes('"find x"'));
    expect(rowLine, "the 'find X' routing table row must exist").toBeTruthy();
    const row = (rowLine ?? "").toLowerCase();
    expect(row).toContain("sil_search");
    // A domain check / elicitation gate / pre-search question must never enter the Lane-1 row.
    const LANE1_ROW_FORBIDDEN = ["domain", "elicit", "clarif", "non-skippable", "before any search", " gate"];
    const bled = LANE1_ROW_FORBIDDEN.filter((t) => row.includes(t));
    expect(bled, "the Lane-1 'find X' row must not gain a domain-check / elicitation / pre-search-question step").toEqual([]);
  });

  it("no UNSCOPED pre-search-gate instruction bleeds into the general router (negation-aware; scoped 'as the shopper' allowed)", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    expect(laneBleedOffenders(body)).toEqual([]);
  });
});

describe("references/shop_loop.md — spine re-order preserves the buy-window + after-recommendation ordering rails (add-only regression rails; MUST stay green)", () => {
  it("keeps every 'buy' substring downstream of the sil_product_get re-fetch (first re-fetch precedes first buy — the #1 build-breaker)", () => {
    const body = shopLoopBodyLower();
    const firstRefetch = body.indexOf("sil_product_get");
    const firstBuy = body.indexOf("buy");
    expect(firstRefetch, "sil_product_get (the re-fetch step) must be present").toBeGreaterThanOrEqual(0);
    expect(firstBuy, "'buy' substring (the re-fetch step) must be present").toBeGreaterThanOrEqual(0);
    // The prose keeps 'buy' out of beats 1–4 and the early part of beat 5 ("shop well" /
    // "shopping taste" / "before searching" / "before purchase"), so the FIRST sil_product_get
    // and the FIRST 'buy' co-locate at the re-fetch step. A 'buy' planted upstream (e.g.
    // "before buying") moves firstBuy above firstRefetch → RED — which would also flip the
    // pre-existing first-buy-window pin (:1316). This is the reciprocal ordering assertion.
    expect(firstRefetch, "the first sil_product_get (re-fetch) must precede the first 'buy'").toBeLessThan(firstBuy);
  });

  it("keeps the after-recommendation capture DOWNSTREAM of the search-execution call (beat-5 tail, not stolen into beat 4)", () => {
    const body = shopLoopBodyLower();
    const searchExec = body.indexOf(SEARCH_EXEC_ANCHOR);
    const AFTER_REC_TRIGGERS = [
      "after every recommendation",
      "after a recommendation",
      "after the recommendation",
      "after recommending",
      "before the turn ends",
      "post-recommendation",
      "after-recommendation",
    ];
    const afterRec = firstIndexOfAny(body, AFTER_REC_TRIGGERS);
    expect(searchExec, "search-execution anchor missing").toBeGreaterThanOrEqual(0);
    expect(afterRec, "after-recommendation trigger phrase missing").toBeGreaterThanOrEqual(0);
    // The after-recommendation capture (today's Step 9) is the beat-5 tail — it must stay
    // AFTER the search call, never pulled up into the beat-4 persist step (which would also
    // move the trigger phrase and break the pre-existing after-recommendation window pin :1220).
    expect(searchExec, "the search-execution call must precede the after-recommendation capture").toBeLessThan(afterRec);
  });
});
