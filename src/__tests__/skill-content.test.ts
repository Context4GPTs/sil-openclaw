/**
 * INTEGRATION — skill discoverability + the progressive-disclosure split
 * (tier: integration — reads the real skill/ files from disk and compares
 * their bodies against the set of registered tool names and the pinned
 * procedure invariants; multiple artifacts interacting, the skill-doc ↔
 * registration seam and the SKILL.md-router ↔ reference-files seam).
 *
 * Named `skill-content.test.ts` to mirror the reference adapter's file
 * of the same name. The skill is authored as a progressive-disclosure
 * bundle (skill-creator convention): a MAXIMALLY-LEAN `skill/SKILL.md` pure
 * router plus detailed procedures under `skill/references/` and a worked example
 * under `skill/examples/`. So content this file pins lives in the file that now
 * OWNS it:
 *   - the router (intent→tool→reference) lives in `skill/SKILL.md` — it NAMES
 *     every registered tool and routes, but holds NO per-tool detail;
 *   - the four core tools' per-tool behaviour + the shared status taxonomy live
 *     in `skill/references/catalog_tools_reference.md`;
 *   - the brainstorm interview procedure lives in
 *     `skill/references/brainstorm_interview.md`;
 *   - the agent-creation engine lives in
 *     `skill/references/agent_creation_engine.md`;
 *   - the answer→sil_search-param mapping lives in
 *     `skill/references/search_param_mapping.md`;
 *   - the worked end-to-end example lives in `skill/examples/`.
 *
 * Frontmatter is parsed with a small self-contained extractor (no
 * gray-matter dependency assumed — the skeleton's dep set is minimal)
 * that still REJECTS a malformed frontmatter block: a missing closing
 * fence, an empty block, or absent keys all fail. Adversarial intent:
 * "frontmatter parses" must mean structurally valid, not merely present.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   skill/SKILL.md has a valid `--- ... ---` YAML frontmatter block at
 *   the top with non-empty `name:` and `description:` scalars, a body
 *   that mentions each registered sil_* tool by name and routes to the
 *   reference/example files (every `references/…` / `examples/…` path it
 *   names exists on disk); the references hold the procedure detail —
 *   including the four core tools' per-tool behaviour + the shared status
 *   taxonomy in `references/catalog_tools_reference.md` (NOT inline in the
 *   router); and the runtime skill carries NO contributor-facing
 *   "adding a tool" prose.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SKILL_DIR = join(REPO_ROOT, "skill");
const SKILL_PATH = join(SKILL_DIR, "SKILL.md");

// The progressive-disclosure reference + example files that now own the
// detailed procedures the router points at.
const CATALOG_TOOLS_PATH = join(
  SKILL_DIR,
  "references",
  "catalog_tools_reference.md",
);
const BRAINSTORM_PATH = join(SKILL_DIR, "references", "brainstorm_interview.md");
const ENGINE_PATH = join(SKILL_DIR, "references", "agent_creation_engine.md");
const MAPPING_PATH = join(SKILL_DIR, "references", "search_param_mapping.md");
const MANAGE_PATH = join(SKILL_DIR, "references", "manage_experts.md");
const EXPERT_SHOPPING_PATH = join(
  SKILL_DIR,
  "references",
  "expert_shopping.md",
);
// SC6 — the refine-an-existing-expert loop (this card). NEW reference file; the
// content-seam block at the foot of this file pins its load-bearing invariants.
const REFINE_PATH = join(SKILL_DIR, "references", "refine_expert.md");
const EXAMPLE_PATH = join(
  SKILL_DIR,
  "examples",
  "road_cycling_expert_walkthrough.md",
);

interface Frontmatter {
  raw: string;
  fields: Record<string, string>;
}

/**
 * Extract and validate the leading `--- ... ---` frontmatter block.
 * Throws on a structurally-invalid block (no opening fence at byte 0,
 * no closing fence, or empty body) — so "parses" is a real assertion.
 * Reads top-level `key: value` scalar lines (enough for name +
 * description; nested metadata is ignored, not required).
 */
function parseFrontmatter(content: string): Frontmatter {
  if (!content.startsWith("---")) {
    throw new Error("SKILL.md does not open with a `---` frontmatter fence");
  }
  // Find the closing fence on its own line after the opening one.
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
    // Only top-level (non-indented) key: value scalar lines.
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m && m[2] !== "") {
      fields[m[1]!] = m[2]!.replace(/^["']|["']$/g, "").trim();
    }
  }
  return { raw, fields };
}

function skillBody(content: string): string {
  // Everything after the closing fence.
  const closeMatch = content.slice(3).match(/\n---[ \t]*\r?\n/);
  if (!closeMatch || closeMatch.index === undefined) return content;
  return content.slice(3 + closeMatch.index + closeMatch[0].length);
}

/** Read a skill file and return its body below the frontmatter (reference/
 * example files may have none — then the whole content is the body). */
function readBody(path: string): string {
  const content = readFileSync(path, "utf8");
  return content.startsWith("---") ? skillBody(content) : content;
}

/** The set of names the real register code emits against a mock api. Must
 * call EVERY tool group that src/index.ts#register() wires, so the skill
 * is checked against the REAL tool surface (`sil_register`, `sil_whoami`,
 * `sil_search`, `sil_product_get`, and the `sil_profile_*` family —
 * materialize + list/get/remove). Mirror register() — registerProfileTools
 * is wired in too, so the bundle-mentions check below covers the profile
 * tools, not just identity + catalog. */
function registeredNames(): Set<string> {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerProfileTools(api);
  return registeredToolNames(api);
}

/** The whole progressive-disclosure bundle as one lower-case corpus: the
 * router PLUS every reference + example. Under progressive disclosure the
 * BUNDLE is the source of truth for the tool surface — a tool may be named
 * in the file that OWNS its procedure (e.g. `sil_profile_materialize` lives
 * in the engine reference, the manage tools in `manage_experts.md`), not
 * forced into the lean router. The bundle-mentions gate checks against this. */
function bundleCorpus(): string {
  return [
    readBody(SKILL_PATH),
    readBody(CATALOG_TOOLS_PATH),
    readBody(BRAINSTORM_PATH),
    readBody(ENGINE_PATH),
    readBody(MAPPING_PATH),
    readBody(MANAGE_PATH),
    readBody(EXAMPLE_PATH),
  ].join("\n");
}

describe("skill/SKILL.md — discoverability", () => {
  it("exists at skill/SKILL.md", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("has frontmatter that parses (valid open + close fences, non-empty body)", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(() => parseFrontmatter(content)).not.toThrow();
  });

  it("exposes a non-empty `name` in frontmatter", () => {
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    expect(fm.fields["name"]).toBeDefined();
    expect((fm.fields["name"] ?? "").length).toBeGreaterThan(0);
  });

  it("exposes a non-empty `description` in frontmatter", () => {
    const fm = parseFrontmatter(readFileSync(SKILL_PATH, "utf8"));
    expect(fm.fields["description"]).toBeDefined();
    expect((fm.fields["description"] ?? "").length).toBeGreaterThan(0);
  });
});

describe("skill bundle — source of truth for the tool surface", () => {
  it("names EVERY registered real tool somewhere in the bundle (router or the reference that owns it)", () => {
    // Progressive disclosure: the BUNDLE (router + references + example) is the
    // source of truth, not the lean router alone. Every registered tool must be
    // named in the file that OWNS its procedure — the four core tools + the
    // manage tools in the router/their references, and `sil_profile_materialize`
    // in the engine reference (the router must NOT inline it — the lean-router
    // block below pins that). So we check the registered surface against the
    // whole bundle, reporting any unnamed tool by name.
    const corpus = bundleCorpus();
    const names = registeredNames();
    expect(names.size).toBeGreaterThan(0); // sanity: there ARE tools
    const missing = [...names].filter((name) => !corpus.includes(name));
    expect(missing).toEqual([]);
  });

  it("names the four core tools in the LEAN router itself (the always-loaded entry point)", () => {
    // The router is what an agent reads first, before loading any reference. The
    // four core shopping tools must be named in the router so the session-start
    // tool check has a source of truth without loading a reference.
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    for (const tool of [
      "sil_register",
      "sil_whoami",
      "sil_search",
      "sil_product_get",
    ]) {
      expect(body).toContain(tool);
    }
  });

  it("names no removed example tool (sil_ping / sil_echo) anywhere in the bundle", () => {
    // The contributor-mental-model goal: the skill no longer presents the
    // deleted stubs as a real, callable tool surface — in NO bundle file.
    const corpus = bundleCorpus();
    expect(corpus).not.toContain("sil_ping");
    expect(corpus).not.toContain("sil_echo");
  });
});

/* ===========================================================================
 * CATALOG + IDENTITY TOOLS REFERENCE — the per-tool behaviour + the shared
 * status taxonomy now live in references/catalog_tools_reference.md (founder
 * decision: SKILL.md is a MAXIMALLY-LEAN pure router). These read the REAL
 * reference from disk and pin the detail the router DELEGATES to it — the
 * four core tools' behaviour and the status vocabulary every shopping tool
 * shares. Same content-seam pattern as the engine/brainstorm blocks below.
 * ========================================================================= */

/** Lower-cased catalog-tools reference body — the file that OWNS the four
 * core tools' per-tool behaviour + the shared status taxonomy after the
 * maximally-lean-router split. */
function catalogToolsBodyLower(): string {
  return readBody(CATALOG_TOOLS_PATH).toLowerCase();
}

describe("references/catalog_tools_reference.md — per-tool behaviour + shared status taxonomy (delegated from the router)", () => {
  it("exists on disk", () => {
    expect(existsSync(CATALOG_TOOLS_PATH)).toBe(true);
  });

  it("documents the per-tool behaviour of all four core tools", () => {
    // The detail the router moved OUT of SKILL.md: how each of the four core
    // tools behaves. The reference must name each tool AND carry a behaviour
    // detail unique to it (so it is the real per-tool detail, not a bare list).
    const body = catalogToolsBodyLower();
    for (const tool of [
      "sil_register",
      "sil_whoami",
      "sil_search",
      "sil_product_get",
    ]) {
      expect(body).toContain(tool);
    }
    // Behaviour tokens that only the per-tool detail carries — the register
    // browser handshake, whoami's transparent refresh, search's ranking +
    // pagination cursor, product_get's partial not_found.
    expect(body).toContain("awaiting_browser");
    expect(body).toContain("cursor");
    expect(body).toContain("not_found");
    expect(body).toContain("checkout_url");
  });

  it("holds the shared status taxonomy (all six statuses, with the recovery rule)", () => {
    // The shared status taxonomy moved here from the router. The reference must
    // name every status in the vocabulary the catalog/identity tools share, so
    // an agent loading it knows how to route each outcome.
    const body = catalogToolsBodyLower();
    const STATUSES = [
      "ok",
      "not_registered",
      "must_reregister",
      "forbidden",
      "invalid_request",
      "retryable",
    ];
    const missing = STATUSES.filter((s) => !body.includes(s));
    expect(missing).toEqual([]);
    // The recovery rule travels with the taxonomy: follow the tool's own
    // recovery hint, never improvise (re-registering can't fix a bad query).
    expect(body).toContain("recovery");
  });

  it("does NOT carry the agent-creation procedure (it is a SHOPPING-tools reference, not the engine)", () => {
    // Keep the seam clean: the catalog/identity reference owns the four core
    // tools, NOT the agent-creation engine. The engine's load-bearing host CLI
    // must not have leaked into this reference.
    const body = catalogToolsBodyLower();
    expect(body).not.toContain("openclaw agents add");
    expect(body).not.toContain("sil_profile_materialize");
  });
});

/* ===========================================================================
 * PROGRESSIVE-DISCLOSURE ROUTER — SKILL.md is a LEAN router, the detail lives
 * in references/ + examples/ (skill-creator convention).
 *
 * tier: integration. These read the REAL skill/SKILL.md + reference/example
 * files from disk and pin the SPLIT: the router routes (names the references
 * by relative path, with the endorsement-before-engine gate explicit), the
 * references exist on disk, and no detailed procedure leaked back into the
 * router. Mirrors skill-creator's "referenced-files-must-exist" validation.
 * ========================================================================= */

describe("skill/SKILL.md — lean router that routes to references + examples", () => {
  it("routes to the brainstorm interview, the engine, the param mapping, and the worked example by relative path", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    expect(body).toContain("references/brainstorm_interview.md");
    expect(body).toContain("references/agent_creation_engine.md");
    expect(body).toContain("references/search_param_mapping.md");
    expect(body).toContain("examples/road_cycling_expert_walkthrough.md");
  });

  it("makes the endorsement-before-engine gate unmistakable in the routing block", () => {
    // The single strongest invariant of the split: the router must make clear
    // the engine reference is read/run ONLY after the user's explicit
    // endorsement of the assembled draft. So an agent that reads the router
    // alone (before loading any reference) already knows the gate exists.
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    // The endorsement token and the engine reference must both appear, and
    // the endorsement gate must be stated ahead of running the engine.
    const endorseIdx = body.indexOf("endorse");
    const engineRefIdx = body.indexOf("agent_creation_engine.md");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(engineRefIdx).toBeGreaterThanOrEqual(0);
    // "only after … endorse … agent_creation_engine.md": the gate language
    // precedes the engine-reference pointer in the routing block.
    expect(endorseIdx).toBeLessThan(engineRefIdx);
    // And the router names the interview reference FIRST (read it before the
    // engine), so the order an agent loads them in is interview → engine.
    const interviewRefIdx = body.indexOf("brainstorm_interview.md");
    expect(interviewRefIdx).toBeGreaterThanOrEqual(0);
    expect(interviewRefIdx).toBeLessThan(engineRefIdx);
  });

  it("keeps the router LEAN — the detailed procedures do NOT live in SKILL.md", () => {
    // skill-creator: info lives in ONE place. The router must not duplicate
    // the engine's ordered host-CLI steps. `openclaw agents add` is the
    // engine's load-bearing command; it belongs in the engine reference, not
    // the router. (The router may NAME the reference, not inline its steps.)
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    expect(body).not.toContain("openclaw agents add");
    expect(body).not.toContain("openclaw config validate");
    expect(body).not.toContain("sil_profile_materialize");
  });

  it("does NOT inline the per-tool behaviour or the status taxonomy (they live in catalog_tools_reference.md, no duplication)", () => {
    // Founder decision: SKILL.md is a MAXIMALLY-LEAN pure router. The four core
    // tools' per-tool behaviour and the shared status taxonomy moved OUT into
    // references/catalog_tools_reference.md. skill-creator's no-duplication rule
    // means the router must NOT re-carry that detail. Anchor on tokens that
    // belong ONLY to the moved detail — the register browser-handshake status
    // and the catalog-tool status vocabulary. The router may NAME the tools
    // (it routes to them) but must not inline how they behave or their statuses.
    const body = skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
    expect(body).not.toContain("awaiting_browser");
    expect(body).not.toContain("not_registered");
    expect(body).not.toContain("must_reregister");
    expect(body).not.toContain("retryable");
    // The router DOES route to the catalog/identity reference that owns them.
    expect(body).toContain("references/catalog_tools_reference.md");
  });

  it("every references/… and examples/… path SKILL.md mentions EXISTS on disk", () => {
    // Mirrors skill-creator's referenced-files-must-exist validation: a
    // router that points at a missing reference is a broken skill. This glob
    // auto-covers references/manage_experts.md once the router names it (the
    // manage block below asserts that route), so a dangling manage pointer
    // fails here too.
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const referenced = [
      ...body.matchAll(/(references|examples)\/[A-Za-z0-9_./-]+\.md/g),
    ].map((m) => m[0]);
    expect(referenced.length).toBeGreaterThan(0); // sanity: it routes somewhere
    const missing = referenced.filter(
      (rel) => !existsSync(join(SKILL_DIR, rel)),
    );
    expect(missing).toEqual([]);
    // Explicitly: the manage reference is one of the paths the router points
    // at, and it exists on disk (path-integrity, named for clarity).
    expect(referenced).toContain("references/manage_experts.md");
    expect(existsSync(MANAGE_PATH)).toBe(true);
  });

  it("routes the manage intents (list/view/remove) to references/manage_experts.md", () => {
    // The new manage capability is wired into the router exactly like the other
    // intents: a routing row mapping the list/view/remove intents to the three
    // sil_profile_* tools and pointing at the manage reference. The router must
    // name all three tools AND the reference, so an agent reading the router
    // alone knows where the manage flow's detail lives.
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    for (const tool of [
      "sil_profile_list",
      "sil_profile_get",
      "sil_profile_remove",
    ]) {
      expect(body).toContain(tool);
    }
    expect(body).toContain("references/manage_experts.md");
  });
});

/* ===========================================================================
 * MANAGE LOCAL EXPERTS — list / view / remove
 * (card: list-view-and-remove-local-expert-agents)
 *
 * tier: integration. The three management procedures are conversational prose
 * in references/manage_experts.md (the file that OWNS the manage flow after the
 * progressive-disclosure re-home) driving the three plugin tools — plus the
 * host CLI for the wiring half of remove. The reference body IS the source of
 * truth the host agent follows, so — exactly as the engine block pins its
 * procedure — we pin that the manage reference names each tool and spells out
 * the load-bearing invariants: host-CLI-FIRST remove ordering, confirm-before-
 * remove, graceful not_found / invalid_request framing, and the artefact-store
 * (`profile.json`) source-of-truth (never the host agent list).
 *
 * These anchor on tool NAMES + content tokens, NEVER on `§N` section numbers,
 * so they survive any renumber.
 * ========================================================================= */

/** Lower-cased manage reference body — the file that OWNS the list/view/remove
 * flow after the re-home. The manage tools' procedure detail lives here, not in
 * the lean router. */
function manageBodyLower(): string {
  return readBody(MANAGE_PATH).toLowerCase();
}

describe("references/manage_experts.md — names the three management tools by name (list/view/remove)", () => {
  it("exists on disk", () => {
    expect(existsSync(MANAGE_PATH)).toBe(true);
  });

  it("names sil_profile_list, sil_profile_get, and sil_profile_remove in the reference", () => {
    const body = readBody(MANAGE_PATH);
    const missing = [
      "sil_profile_list",
      "sil_profile_get",
      "sil_profile_remove",
    ].filter((name) => !body.includes(name));
    // Report by name so a forgotten tool is named, not an opaque false.
    expect(missing).toEqual([]);
  });
});

describe("references/manage_experts.md — manage-experts procedure spells out the load-bearing invariants", () => {
  it("frames a distinct manage/list/view/remove capability (not just the create engine)", () => {
    // The create engine already names experts. This card adds MANAGEMENT — the
    // reference must name listing/viewing/removing experts, so the re-homed
    // section is a real capability, not a re-read of the create prose.
    const body = manageBodyLower();
    const namesList = body.includes("list");
    const namesView = body.includes("view") || body.includes("show");
    const namesRemove = body.includes("remove") || body.includes("delete");
    expect(namesList && namesView && namesRemove).toBe(true);
  });

  it("orders the remove flow host-CLI FIRST: `openclaw agents remove` precedes the procedural `sil_profile_remove` call", () => {
    // The architect's partial-failure decision: the skill runs the HOST wiring
    // removal (`openclaw agents remove <id>`) BEFORE the sil artefact removal
    // (`sil_profile_remove { agentId }`). Order in the prose IS the spec —
    // artefacts-first then a failed host step leaves a broken-but-loading
    // expert; host-first leaves only harmless, list-surfaced disk cruft.
    //
    // Adversarial precision on the anchor: `sil_profile_remove` is also named
    // earlier in the intent→tool TABLE and the per-tool prose (before the
    // numbered procedure). A naive first-occurrence indexOf would catch those
    // reference mentions and FALSELY fail even on a correctly ordered procedure.
    // Anchor the artefact step on its procedural CALL FORM (`sil_profile_remove {`
    // — the invocation with its arg object), which appears only in the numbered
    // remove procedure, so the ordering check pins the real step sequence.
    const body = manageBodyLower();
    const hostRemoveIdx = body.indexOf("openclaw agents remove");
    const artefactCallIdx = body.indexOf("sil_profile_remove {");
    expect(hostRemoveIdx).toBeGreaterThanOrEqual(0);
    expect(artefactCallIdx).toBeGreaterThanOrEqual(0);
    expect(hostRemoveIdx).toBeLessThan(artefactCallIdx);
  });

  it("requires confirming with the user BEFORE a destructive remove", () => {
    // Remove is destructive + irreversible, so the skill confirms before acting.
    // The reference must say so (confirm/confirmation before removing), so the
    // agent does not silently delete.
    const body = manageBodyLower();
    const confirms =
      body.includes("confirm") ||
      body.includes("confirmation") ||
      body.includes("explicit go-ahead") ||
      body.includes("ask before");
    expect(confirms).toBe(true);
  });

  it("names `not_found` graceful framing for an unknown expert (view & remove)", () => {
    // Referencing an unknown expert fails gracefully — a plain not_found, ideally
    // listing the experts that DO exist, never a stack trace or raw path. The
    // reference must name the not_found outcome AND the graceful framing.
    const body = manageBodyLower();
    expect(body).toContain("not_found");
    const graceful =
      body.includes("never surface a stack trace") ||
      body.includes("never a stack trace") ||
      body.includes("not a stack trace") ||
      (body.includes("stack trace") && body.includes("never")) ||
      body.includes("raw path") ||
      body.includes("raw filesystem path");
    expect(graceful).toBe(true);
  });

  it("names `invalid_request` for a malformed/traversal expert id (deletes nothing)", () => {
    // The fail-closed id-validation outcome the management tools surface — the
    // reference must name it so the agent recognizes a bad-id rejection (deletes
    // nothing) versus an unknown expert (not_found).
    expect(manageBodyLower()).toContain("invalid_request");
  });

  it("keeps the artefact-store source-of-truth framing (list reads profile.json, not the host list)", () => {
    // A sil expert IS a readable agents/<id>/profile.json — list reads the
    // manifest, not the host agent list. The reference must name the artefact
    // store / profile.json as the listing source, so a bare host agent is not
    // mistaken for a sil expert.
    const body = manageBodyLower();
    const namesArtefactSource =
      body.includes("profile.json") ||
      body.includes("artefact store") ||
      body.includes("sil_data_dir") ||
      body.includes("sil data dir");
    expect(namesArtefactSource).toBe(true);
    // And it must say this is the source of truth (never artefacts-first /
    // never the host list as the authority).
    const namesSourceOfTruth =
      body.includes("source of truth") ||
      body.includes("source-of-truth") ||
      body.includes("never the host agent list") ||
      body.includes("not the host agent list");
    expect(namesSourceOfTruth).toBe(true);
  });

  it("names the manage status taxonomy (ok / not_found / invalid_request / removed / persistence_failed)", () => {
    // The manage flow has its own outcome vocabulary. The reference must name
    // each status so an agent loading it knows how to route each outcome.
    const body = manageBodyLower();
    const missing = [
      "ok",
      "not_found",
      "invalid_request",
      "removed",
      "persistence_failed",
    ].filter((s) => !body.includes(s));
    expect(missing).toEqual([]);
  });
});

describe("skill — the contributor-facing 'adding a tool' prose is GONE from the runtime skill", () => {
  it("no skill file carries the repo-CLAUDE.md 'how to add a tool' contributor content", () => {
    // The monolithic SKILL.md carried a §6 "Adding a real tool" section — pure
    // contributor guidance that already lives in the repo CLAUDE.md. It has no
    // place in a RUNTIME shopping skill. Assert it is gone from SKILL.md AND
    // every reference/example (it must not have been relocated, only deleted).
    const corpus = [
      readBody(SKILL_PATH),
      readBody(CATALOG_TOOLS_PATH),
      readBody(BRAINSTORM_PATH),
      readBody(ENGINE_PATH),
      readBody(MAPPING_PATH),
      readBody(MANAGE_PATH),
      readBody(EXAMPLE_PATH),
    ]
      .join("\n")
      .toLowerCase();
    // The contributor section's distinctive tokens — the registration plumbing
    // an agent USING the skill never needs.
    expect(corpus).not.toContain("registerxtools");
    expect(corpus).not.toContain("contracts.tools");
    expect(corpus).not.toContain("adding a real tool");
    expect(corpus).not.toContain("adding a tool");
  });
});

/* ===========================================================================
 * AGENT-CREATION ENGINE — the procedure-as-source-of-truth seam
 * (card: create-a-valid-sil-wired-openclaw-agent-profile)
 *
 * tier: integration. These now read the REAL
 * skill/references/agent_creation_engine.md from disk (the file that OWNS the
 * engine after the progressive-disclosure split) and pin the agent-creation
 * procedure as a source of truth — the engine is the skill prose driving the
 * host CLI (no plugin-tool code per the architect's verdict), so the engine
 * reference IS the spec the host agent follows. Pinning it is exactly how this
 * file already pins the tool surface.
 *
 * These are adversarial: they do not merely check a keyword is present, they
 * check the load-bearing invariants of the engine are spelled out —
 *   - the host-native CLI surface is named (not invented JSON authoring);
 *   - the four outcome statuses form the engine's status taxonomy;
 *   - validate-FIRST ordering (nothing written on a bad spec);
 *   - collision is non-destructive (list-check before add, never clobber);
 *   - host-own validation gates "success" (config validate before created);
 *   - the behaviour artefacts are materialized into $SIL_DATA_DIR (founder
 *     steer) — the persona/instructions + the domain sub-skill that power
 *     the created agent, kept OUT of the thin host `agents` wiring entry.
 *
 * No host, no network, no Docker: this is a content seam over the engine file.
 * The real host round (create → validate → shop, SC3) is `live-verification`'s
 * job, NOT a test-tier assertion — these never fake a running host.
 * ========================================================================= */

/** Lower-cased engine reference body — substring checks are intent ("the
 * procedure names X"), so case folding avoids a brittle fail on an incidental
 * capitalization while keeping the exact-token literals (CLI names, status
 * words) honest. The engine now OWNS this content. */
function engineBodyLower(): string {
  return readBody(ENGINE_PATH).toLowerCase();
}

/** The four outcome statuses the architect fixed as the engine's taxonomy
 * (mirrors identity.ts/catalog.ts structured-error vocabulary). Pinned as a
 * named set so a missing one is reported by NAME, not as an opaque false. */
const ENGINE_STATUSES = [
  "created",
  "invalid_request",
  "collision",
  "persistence_failed",
] as const;

describe("references/agent_creation_engine.md — agent-creation procedure is a pinned source of truth (AC1)", () => {
  it("names the host-native agent-creation CLI `openclaw agents add`", () => {
    // The persistence path is host-CLI-driven (the plugin may NOT write host
    // config — noChildProcess + filesystemScope). The procedure must name the
    // host's OWN creation command, not a plugin tool or hand-authored JSON.
    expect(engineBodyLower()).toContain("openclaw agents add");
  });

  it("names the host `agents` config surface the profile lands in", () => {
    // Product invariant 1/6: a real host `agents` entry in the user's local
    // OpenClaw config — not a bespoke sil data file. The body must name the
    // surface so the agent knows WHERE the profile lives.
    expect(engineBodyLower()).toContain("agents");
  });

  it("names ALL FOUR engine outcome statuses (created/invalid_request/collision/persistence_failed)", () => {
    const body = engineBodyLower();
    const missing = ENGINE_STATUSES.filter((s) => !body.includes(s));
    // Report by name: a partial taxonomy is the failure this pins. An engine
    // that names `created` but never `collision` would silently clobber.
    expect(missing).toEqual([]);
  });

  it("frames the procedure as agent-creation, not just tool-driving (a distinct shopping-expert intent)", () => {
    // Adversarial: the pre-existing skill already drove the four sil_* tools.
    // This card adds a NEW capability — creating a sil-wired agent. The body
    // must mention creating an agent/expert/profile, so the new procedure is
    // a real addition, not a re-read of the old tool table.
    const body = engineBodyLower();
    const namesCreation =
      body.includes("create") || body.includes("creation");
    const namesSubject =
      body.includes("expert") ||
      body.includes("agent profile") ||
      body.includes("shopping expert");
    expect(namesCreation && namesSubject).toBe(true);
  });
});

describe("references/agent_creation_engine.md — validate-first: a bad spec writes NOTHING (AC2)", () => {
  it("names the `invalid_request` outcome for an invalid/incomplete spec", () => {
    expect(engineBodyLower()).toContain("invalid_request");
  });

  it("specifies validating the spec BEFORE invoking `openclaw agents add` (validate-first ordering)", () => {
    // Product invariant 7 (atomic outcome) + AC2: on a bad spec the engine
    // stops at validation and `openclaw agents add` is never reached. The
    // procedure must put a spec-validation step textually AHEAD of the add
    // step, so an agent following top-to-bottom validates first. Order in the
    // prose IS the spec — a procedure that adds-then-validates clobbers on a
    // bad spec.
    //
    // Adversarial precision: key the "before" anchor on the `validate` VERB.
    // The engine reference's step 1 is a spec-validation step ABOVE the
    // `openclaw agents add` in step 3, so requiring `validate` before `add`
    // only goes green on a genuine spec-validation step preceding the
    // creation call.
    const body = engineBodyLower();
    const firstValidateIdx = body.indexOf("validate");
    const addIdx = body.indexOf("openclaw agents add");
    expect(firstValidateIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(firstValidateIdx).toBeLessThan(addIdx);
  });

  it("requires the spec's mandatory fields — name AND persona/instructions — to be present", () => {
    // AC2 enumerates the invalid shapes: missing name, empty persona, no sil
    // skill attached. The procedure must name persona/instructions and the
    // unique name as required, so the validation has a concrete checklist —
    // not a vague "if the spec is bad".
    const body = engineBodyLower();
    expect(body).toContain("persona");
    // The name must be required AND unique (the collision precondition).
    expect(body).toMatch(/name/);
  });

  it("states that nothing is written / no profile is created on an invalid spec", () => {
    // The atomic-outcome invariant, in prose: on `invalid_request` the engine
    // writes NOTHING. The body must say so, so the agent does not half-create.
    const body = engineBodyLower();
    const saysNothingWritten =
      body.includes("write nothing") ||
      body.includes("writes nothing") ||
      body.includes("nothing is written") ||
      body.includes("write no") ||
      body.includes("does not write") ||
      body.includes("no profile") ||
      body.includes("nothing partial") ||
      body.includes("no partial");
    expect(saysNothingWritten).toBe(true);
  });
});

describe("references/agent_creation_engine.md — collision is non-destructive (AC3)", () => {
  it("names the collision check via `openclaw agents list` (read before write)", () => {
    // AC3: the engine checks existing agents with the host's OWN list command
    // before adding, so a same-name agent is detected, not overwritten.
    expect(engineBodyLower()).toContain("openclaw agents list");
  });

  it("names the `collision` outcome and that it does NOT clobber an existing agent", () => {
    const body = engineBodyLower();
    expect(body).toContain("collision");
    // Product invariant 8 / UX principle 4: never silently overwrite. The body
    // must say so explicitly — "do not overwrite" / "never clobber" / "no
    // overwrite" — so the agent surfaces the collision instead of replacing.
    const saysNonDestructive =
      body.includes("overwrite") ||
      body.includes("clobber") ||
      body.includes("never overwrite") ||
      body.includes("not overwrite") ||
      body.includes("non-destructive") ||
      body.includes("do not clobber");
    expect(saysNonDestructive).toBe(true);
  });

  it("orders the collision check BEFORE the add (list precedes add in the procedure)", () => {
    // Adversarial ordering: `openclaw agents list` must come before `openclaw
    // agents add` in the prose, or an agent following the steps top-to-bottom
    // would add first and discover the collision too late (after clobbering).
    const body = engineBodyLower();
    const listIdx = body.indexOf("openclaw agents list");
    const addIdx = body.indexOf("openclaw agents add");
    expect(listIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(listIdx).toBeLessThan(addIdx);
  });
});

describe("references/agent_creation_engine.md — valid spec persists a host-loadable, sil-wired agent (AC4)", () => {
  it("invokes `openclaw agents add` non-interactively with JSON output", () => {
    // AC4: `openclaw agents add … --non-interactive --json` — the exact
    // machine-drivable form (an interactive prompt cannot be agent-driven).
    const body = engineBodyLower();
    expect(body).toContain("--non-interactive");
    expect(body).toContain("--json");
  });

  it("gates 'created' on the host's OWN validation via `openclaw config validate`", () => {
    // Product invariant 1 + AC4: "valid" means the HOST says yes, verified the
    // way the host validates — `openclaw config validate` (or load probe). The
    // body must name it, so success ≠ "the plugin thinks it's fine".
    expect(engineBodyLower()).toContain("openclaw config validate");
  });

  it("orders config-validate AFTER add (validate the written profile, then declare created)", () => {
    // The defect this card exists to prevent: emitting a profile the host then
    // rejects. The procedure must validate AFTER the add and only then report
    // `created` — so the validate step sits between `add` and `created`.
    const body = engineBodyLower();
    const addIdx = body.indexOf("openclaw agents add");
    const validateIdx = body.indexOf("openclaw config validate");
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(validateIdx).toBeGreaterThan(addIdx);
  });

  it("wires the sil PLUGIN enabled into the created agent (the four tools come for free)", () => {
    // Product invariant 2 + the spec→flag mapping: the created agent has the
    // sil plugin enabled, which is what makes sil_register/sil_whoami/
    // sil_search/sil_product_get available to it. The body must say the
    // profile enables the `sil` plugin.
    const body = engineBodyLower();
    const wiresPlugin =
      body.includes("plugin") &&
      (body.includes("enable") || body.includes("enabled"));
    expect(wiresPlugin).toBe(true);
  });

  it("wires the sil SKILL attached into the created agent (it knows HOW to drive the tools)", () => {
    // Product invariant 3: the created agent attaches the sil skill (+ any
    // generated sub-skill). The body must say the profile attaches the skill,
    // not just enable the plugin — plugin without skill knows the tools exist
    // but not how to drive them.
    const body = engineBodyLower();
    const wiresSkill =
      body.includes("skill") &&
      (body.includes("attach") || body.includes("attached"));
    expect(wiresSkill).toBe(true);
  });

  it("names `persistence_failed` (with path + cause) for a write/validate failure", () => {
    // AC4 failure half / Product invariant 7: on a CLI or validate failure the
    // engine reports `persistence_failed` with the path + cause and leaves
    // nothing partial. The body must name the outcome AND that it carries the
    // failing path/cause, so the agent's recovery is actionable.
    const body = engineBodyLower();
    expect(body).toContain("persistence_failed");
    const namesPathCause =
      body.includes("path") && body.includes("cause");
    expect(namesPathCause).toBe(true);
  });
});

/* ===========================================================================
 * HOST-WIRING SHAPES PINNED TO alpine/openclaw:2026.6.9
 * (card: realign-skill-4-host-cli-to-openclaw-2026-4-15)
 *
 * tier: unit. The engine's two host-wiring shapes drifted from the real
 * 2026.6.9 OpenClaw CLI the sil-stage host round probes live:
 *   - the plugin-ENABLE step used `--merge`, which is NOT a flag on this image;
 *     the real path is a value-mode set with `--strict-json`;
 *   - the VALIDATE-verdict read keyed off a non-existent `ok: false`; the real
 *     `openclaw config validate --json` shape is `{ valid, path, issues? }`, so
 *     the verdict is read from `valid`.
 * These mirror the host round's real-shape probes (sil-stage host-round-create.mjs
 * 321-337) rather than re-asserting prose, turning "doc says X, host proves X"
 * from coincidence into a checked invariant. Each shape is pinned in BOTH the
 * engine reference AND the worked example (the copy-paste-most-likely artefact),
 * so the two duplicated wirings cannot silently re-diverge.
 *
 * Adversarial: for EACH shape we assert presence-of-correct AND absence-of-
 * defective. A one-sided presence check passes while a stray `--merge` lingers
 * beside `--strict-json`, or a residual `ok: false` lingers beside `valid`.
 * ========================================================================= */

/** Lower-cased worked-example body — the example carries the SAME two wiring
 * shapes by hand, so it is pinned alongside the engine reference. */
function exampleBodyLower(): string {
  return readBody(EXAMPLE_PATH).toLowerCase();
}

describe("references/agent_creation_engine.md — host-wiring shapes match alpine/openclaw:2026.6.9", () => {
  it("enables the sil plugin with the host's real value-mode set (`--strict-json`), NOT `--merge`", () => {
    // The 2026.6.9 CLI has no scalar `--merge` flag; the enable is a value-mode set
    // with `--strict-json` (host-round-create.mjs:321-329). Anchor the POSITIVE
    // on the FULL enable substring — `plugins.entries.sil.enabled true
    // --strict-json` — not bare `--strict-json`, because the adjacent skills set
    // already uses `--strict-json` correctly (line 45) and a bare-token check
    // would pass even with the enable still on `--merge`.
    const body = engineBodyLower();
    expect(body).toContain(
      "plugins.entries.sil.enabled true --strict-json",
    );
    // NEGATIVE: NO `--merge` remains anywhere in the engine reference — a stray
    // `--merge` lingering beside the corrected `--strict-json` is exactly the
    // one-sided-pass the card warns against. `--merge` appears nowhere
    // legitimately in this doc, so absence of the bare flag is the tight check.
    expect(body).not.toContain("--merge");
  });

  it("reads the validate verdict from `.valid` (the `{ valid, path, issues? }` shape), NOT a non-existent `ok: false`", () => {
    // The real `openclaw config validate --json` shape is `{ valid, path,
    // issues? }` (host-round-create.mjs:333-337) — success/failure keys off
    // `valid`, never `ok`. POSITIVE: the verdict read references `valid`.
    const body = engineBodyLower();
    expect(body).toContain("valid");
    // NEGATIVE: NO `ok: false` verdict read remains. Scope the negative match
    // to the PRECISE verdict token `ok: false` — a bare `ok` is innocent prose
    // elsewhere (step-4 `sil_profile_materialize` outcomes name a bare `ok`),
    // and matching bare `ok` would false-positive on legitimate text.
    expect(body).not.toContain("ok: false");
  });

  it("names/pins the LATEST asserted OpenClaw image tag `alpine/openclaw:2026.6.9` (couples the doc to the host that proves it), with NO stale `2026.4.15` lingering", () => {
    // Surfacing the tag the sil-stage host round validates against makes "doc
    // says X, host proves X" a coupled guarantee, not a coincidence — the next
    // CLI surface change can no longer silently re-open this bug. Match the
    // literal tag case-sensitively against the un-lowercased body so the
    // asserted string is the exact tag, not an incidentally-cased near-miss.
    const raw = readBody(ENGINE_PATH);
    // POSITIVE: the doc pins the latest reproducible tag.
    expect(raw).toContain("alpine/openclaw:2026.6.9");
    // NEGATIVE: the superseded pin is gone everywhere — a stray `2026.4.15`
    // lingering beside the corrected `2026.6.9` is exactly the one-sided-pass
    // this card warns against (the doc↔host coupling is only real when a single
    // tag is named). Scope the negative to the bare version token so any
    // surviving `alpine/openclaw:2026.4.15` (or prose naming it) trips it.
    expect(raw).not.toContain("2026.4.15");
  });
});

describe("examples/road_cycling_expert_walkthrough.md — wiring shape stays coupled to the engine reference", () => {
  it("carries the SAME corrected enable shape (`--strict-json`, NO `--merge`) as the engine reference", () => {
    // The example is the copy-paste-most-likely artefact and duplicates the
    // enable shape by hand (line 98). Pinning it here couples the two artefacts:
    // a future edit cannot re-introduce `--merge` in the example with nothing
    // red. Same FULL-substring anchor — the skills set on the same line already
    // carries `--strict-json`, so a bare-token check would not catch a `--merge`
    // enable.
    const body = exampleBodyLower();
    expect(body).toContain(
      "plugins.entries.sil.enabled true --strict-json",
    );
    expect(body).not.toContain("--merge");
  });
});

describe("references/agent_creation_engine.md — the created agent shops with no further setup (AC5 / SC3)", () => {
  it("states the created agent can call sil_search / sil_product_get with no further setup", () => {
    // AC5 / SC3 (the goal's primary correctness bar): after creation the agent
    // shops immediately. The body must name the catalog tools the created
    // expert calls AND the "no further setup" guarantee — the zero-setup
    // promise is the whole product (UX principle 1). The HOST round is
    // live-verified; here we pin that the skill PROMISES it.
    const body = engineBodyLower();
    expect(body).toContain("sil_search");
    expect(body).toContain("sil_product_get");
    const noFurtherSetup =
      body.includes("no further setup") ||
      body.includes("without further setup") ||
      body.includes("zero further setup") ||
      body.includes("no additional setup") ||
      body.includes("zero-setup");
    expect(noFurtherSetup).toBe(true);
  });

  it("does NOT couple creation to identity (no register/token as a precondition to CREATE)", () => {
    // Product out-of-scope: creating an expert neither requires nor performs
    // sil registration. The procedure must keep creation local + offline — it
    // must NOT state that registration / a token is a precondition of creating
    // the profile (the expert registers the user LATER, on first shop).
    // The engine DOES mention sil_register (the deferred first-shop step), so we
    // can't assert its absence globally — instead assert the creation procedure
    // does not present registration as a prerequisite *for creation*.
    const body = engineBodyLower();
    const couplesIdentity =
      /register[^.]*before[^.]*creat/.test(body) ||
      /creat[^.]*requires[^.]*register/.test(body) ||
      /must.*register.*to.*creat/.test(body);
    expect(couplesIdentity).toBe(false);
  });
});

describe("references/agent_creation_engine.md — behaviour artefacts materialized into $SIL_DATA_DIR (founder steer)", () => {
  it("names $SIL_DATA_DIR as where the behaviour artefacts are materialized", () => {
    // Founder steer 2026-06-22: the engine materializes FIXED behaviour
    // artefacts into the sil data directory ($SIL_DATA_DIR — the plugin's
    // disclosed filesystemScope) at creation time. The body must name the
    // data dir as the artefact store, distinct from the host `agents` wiring.
    const body = engineBodyLower();
    const namesDataDir =
      body.includes("$sil_data_dir") ||
      body.includes("sil_data_dir") ||
      body.includes("sil data directory") ||
      body.includes("sil data dir");
    expect(namesDataDir).toBe(true);
  });

  it("names the persona/instructions behaviour artefact", () => {
    // The artefacts that POWER the created agent's behaviour: the persona/
    // instructions. The body must name it as a materialized artefact (read by
    // the sil skill at runtime), keeping the host `agents` entry thin.
    expect(engineBodyLower()).toContain("persona");
  });

  it("names the generated domain sub-skill as a behaviour artefact", () => {
    // The second artefact the card names: a generated domain sub-skill (e.g. a
    // gift-shopping playbook). The body must name the sub-skill as part of the
    // materialized behaviour layer.
    const body = engineBodyLower();
    expect(body).toContain("sub-skill");
  });

  it("keeps the store boundary clean: host config = wiring, $SIL_DATA_DIR = behaviour", () => {
    // Founder steer: store boundary stays clean — host `agents` config holds
    // the WIRING (plugin enabled + skill attached), $SIL_DATA_DIR holds the
    // BEHAVIOUR artefacts. The host config write stays host-CLI-driven; the
    // artefact write is the in-scope sil-owned write. The body must reflect
    // both surfaces — wiring via the CLI, behaviour via the data dir — so the
    // two-store boundary is explicit in the prose.
    const body = engineBodyLower();
    const namesDataDir =
      body.includes("sil_data_dir") || body.includes("sil data dir");
    const namesHostConfig =
      body.includes("openclaw agents add") ||
      body.includes("openclaw config validate");
    expect(namesDataDir && namesHostConfig).toBe(true);
  });
});

/* ===========================================================================
 * BRAINSTORM / INTERVIEW PROCEDURE — the conversational spec-filling seam
 * (card: brainstorm-driven-creation-of-a-tailored-expert)
 *
 * tier: integration. Same content-seam pattern as the engine block above, now
 * re-pointed at the file that OWNS the brainstorm after the progressive-
 * disclosure split: read the REAL skill/references/brainstorm_interview.md from
 * disk (and, for the answer→param mapping detail the interview delegates to,
 * skill/references/search_param_mapping.md), lowercase, and pin the brainstorm
 * PROCEDURE as a source of truth via OR-grouped intent-token substrings and
 * ORDERING via indexOf comparison. The brainstorm is skill prose the host agent
 * follows — there is NO new plugin tool, NO code path — so the reference body IS
 * the spec, exactly as it is for the engine. These never fake a transcript: "a
 * real agent runs a genuinely good interview" is `live-verification`'s job, NOT
 * a test tier. We pin the procedure's load-bearing invariants:
 *   - SC1: open, multi-turn, TWO-SIDED interview (domain attributes AND the
 *     user's own tastes/style/budget/constraints), explicitly NOT a form-fill;
 *     all FIVE converged sections named;
 *   - narrow-first gate: a vague/over-broad domain is narrowed WITH the user
 *     BEFORE persona/mapping/rubric (ordering anchor);
 *   - per-section converge + re-entrant (reflect-back + confirm; collaborative);
 *   - SC2 tailoring: persona + answer→param mapping + rubric reflect STATED
 *     inputs; the mapping names REAL sil_search params; ship_to left EMPTY by
 *     default (no sil_whoami round-trip);
 *   - endorsement-before-creation: an endorse/confirm token PRECEDES the first
 *     engine step (`openclaw agents add` / `sil_profile_materialize`) — ZERO
 *     engine steps before explicit endorsement (ordering anchor, now pinned in
 *     the interview reference that owns the endorsement gate);
 *   - abandon-mid-flow creates nothing; collision → refine-or-rename never
 *     clobber; the spec is a valid sil_profile_materialize input.
 * ========================================================================= */

/** Lower-cased brainstorm interview reference body — the file that OWNS the
 * interview after the split. */
function brainstormBodyLower(): string {
  return readBody(BRAINSTORM_PATH).toLowerCase();
}

/** The interview delegates the concrete answer→param mapping detail to the
 * dedicated mapping reference. Where an assertion pins the worked param tokens
 * the interview points at (price_min, condition, ship_to, …), read the
 * interview + the mapping it references as one corpus — the agent loads both
 * when authoring the mapping section. */
function brainstormCorpusLower(): string {
  return (readBody(BRAINSTORM_PATH) + "\n" + readBody(MAPPING_PATH)).toLowerCase();
}

describe("references/brainstorm_interview.md — brainstorm conducts an open, two-sided interview (SC1)", () => {
  it("names the brainstorm/interview as an open, multi-turn conversation (a distinct procedure)", () => {
    // SC1: the new capability is a conversational interview that PRODUCES the
    // spec the engine consumes. The body must name it as a brainstorm/interview
    // and as multi-turn / back-and-forth / conversational — not a single shot.
    const body = brainstormBodyLower();
    const namesInterview =
      body.includes("brainstorm") ||
      body.includes("interview");
    const namesMultiTurn =
      body.includes("multi-turn") ||
      body.includes("back-and-forth") ||
      body.includes("back and forth") ||
      body.includes("conversation") ||
      body.includes("conversational");
    expect(namesInterview).toBe(true);
    expect(namesMultiTurn).toBe(true);
  });

  it("states the interview is NOT a fixed questionnaire / form-fill", () => {
    // The product thesis (founder intent): an OPEN interview, NOT a form-fill.
    // The body must explicitly disavow the fixed-questionnaire shape — a generic
    // "ask some questions" is not enough; the prose must say it is NOT a form.
    const body = brainstormBodyLower();
    const disavowsForm =
      body.includes("not a fixed questionnaire") ||
      body.includes("not a questionnaire") ||
      body.includes("not a form-fill") ||
      body.includes("not a form fill") ||
      body.includes("not a form") ||
      body.includes("not a fixed form") ||
      body.includes("not a wizard") ||
      body.includes("not a locked wizard") ||
      (body.includes("questionnaire") && body.includes("not")) ||
      body.includes("conversation, not a form-fill");
    expect(disavowsForm).toBe(true);
  });

  it("elicits BOTH the domain's decision-attributes AND the user's personal tastes/constraints", () => {
    // Business rule 3 (elicit BOTH sides): a spec from only domain attributes
    // (generic) or only preferences (no searchable mapping) is incomplete. The
    // body must name the two sides — the domain's decision-attributes AND the
    // user's own tastes/style/budget/constraints.
    const body = brainstormBodyLower();
    const namesDomainAttributes =
      body.includes("decision-attribute") ||
      body.includes("decision attribute") ||
      body.includes("decision-attributes") ||
      body.includes("domain's attributes") ||
      body.includes("attributes that matter") ||
      (body.includes("attribute") && body.includes("domain"));
    const namesPersonalTastes =
      (body.includes("taste") || body.includes("preference") || body.includes("priorities")) &&
      (body.includes("budget") || body.includes("constraint") || body.includes("style"));
    expect(namesDomainAttributes).toBe(true);
    expect(namesPersonalTastes).toBe(true);
  });

  it("names ALL FIVE sections the interview converges", () => {
    // The five-section spine is the concrete agenda: domain framing, persona,
    // elicitation style, answer→sil_search-param mapping, comparison/
    // recommendation rubric. The body must name each, so the interview has a
    // real agenda and every converged section survives into the spec.
    const body = brainstormBodyLower();
    const namesDomainFraming =
      body.includes("domain framing") ||
      body.includes("domain frame") ||
      (body.includes("domain") && body.includes("niche"));
    const namesPersona = body.includes("persona");
    const namesElicitationStyle =
      body.includes("elicitation style") ||
      (body.includes("elicitation") && body.includes("style")) ||
      (body.includes("how this expert") && body.includes("talk"));
    const namesMapping =
      body.includes("mapping") &&
      (body.includes("sil_search") || body.includes("param"));
    const namesRubric =
      body.includes("rubric") ||
      (body.includes("comparison") && body.includes("recommendation"));
    const missing: string[] = [];
    if (!namesDomainFraming) missing.push("domain framing");
    if (!namesPersona) missing.push("persona");
    if (!namesElicitationStyle) missing.push("elicitation style");
    if (!namesMapping) missing.push("answer→sil_search-param mapping");
    if (!namesRubric) missing.push("comparison/recommendation rubric");
    expect(missing).toEqual([]);
  });
});

describe("references/brainstorm_interview.md — vague domain is narrowed WITH the user FIRST (narrow-first gate)", () => {
  it("names the narrow-a-vague-domain-first gate", () => {
    // Business rule 6: never build persona/mapping/rubric on an un-narrowed
    // niche. The body must name the gate — a vague/over-broad/ambiguous domain
    // is narrowed (with narrowing questions, reflecting a concrete niche back)
    // before the other sections.
    const body = brainstormBodyLower();
    const namesVague =
      body.includes("vague") ||
      body.includes("over-broad") ||
      body.includes("overbroad") ||
      body.includes("too broad") ||
      body.includes("too-broad") ||
      body.includes("ambiguous") ||
      body.includes("broad or ambiguous");
    const namesNarrow =
      body.includes("narrow") ||
      body.includes("narrowing");
    expect(namesVague).toBe(true);
    expect(namesNarrow).toBe(true);
  });

  it("orders the narrow-domain STEP before the persona/playbook CONVERGENCE steps", () => {
    // Ordering anchor (mirrors the engine's validate-first / list-before-add):
    // the executable narrow-domain step must come BEFORE the executable steps
    // that converge persona / the mapping / the rubric, so an agent following
    // top-to-bottom narrows first and never builds those sections on an
    // un-narrowed niche.
    //
    // Adversarial precision — anchor on the EXECUTABLE STEP verb, NOT the raw
    // first occurrence of `persona`/`rubric`. The procedure legitimately opens
    // with a five-section AGENDA table that NAMES persona (section 2) and the
    // rubric (section 5) up front, so `indexOf("persona")` / `indexOf("rubric")`
    // land in that overview, ABOVE the narrow step — a raw-token anchor would
    // FALSELY fail even on correctly-ordered prose. The anchor is the
    // narrow-the-domain step token, required to precede the FIRST downstream
    // CONVERGENCE step.
    const body = brainstormBodyLower();
    // The narrow-domain gate step: "narrow a vague domain … first / before any
    // other section" — the executable step, not the agenda cell.
    const narrowStepIdx = (() => {
      for (const anchor of [
        "narrow a vague domain",
        "narrow the domain together",
        "narrow a vague or",
        "narrow the niche first",
      ]) {
        const i = body.indexOf(anchor);
        if (i >= 0) return i;
      }
      return -1;
    })();
    // The first DOWNSTREAM convergence step: converging the persona, or the
    // playbook sections (the mapping + rubric live there). Anchor on the
    // converge verb so the agenda table's section NAMES don't match.
    const convergeDownstreamIdx = (() => {
      const candidates = [
        "converge the persona",
        "converge persona",
        "converge the three playbook",
        "converge the playbook",
      ]
        .map((a) => body.indexOf(a))
        .filter((i) => i >= 0);
      return candidates.length ? Math.min(...candidates) : -1;
    })();
    expect(narrowStepIdx).toBeGreaterThanOrEqual(0);
    expect(convergeDownstreamIdx).toBeGreaterThanOrEqual(0);
    // The narrow-domain step precedes the first downstream convergence step —
    // an agent reaching persona/mapping/rubric convergence has already narrowed.
    expect(narrowStepIdx).toBeLessThan(convergeDownstreamIdx);
  });
});

describe("references/brainstorm_interview.md — per-section converge + re-entrant (collaborative, not a locked wizard)", () => {
  it("states each section is converged with the user (reflect-back + confirm) before advancing", () => {
    // Business rule 5: reflect-and-confirm per section. The body must name the
    // reflect-back-then-confirm loop — ask, reflect a short summary of what it
    // heard, get a yes/adjust before moving on.
    const body = brainstormBodyLower();
    const reflectsBack =
      body.includes("reflect back") ||
      body.includes("reflect-back") ||
      body.includes("reflects back") ||
      body.includes("reflect a") ||
      body.includes("summary of what") ||
      body.includes("reflect");
    const confirms =
      body.includes("confirm") ||
      body.includes("yes / adjust") ||
      body.includes("yes/adjust") ||
      body.includes("before moving on") ||
      body.includes("before advancing");
    expect(reflectsBack).toBe(true);
    expect(confirms).toBe(true);
  });

  it("states the flow is collaborative / re-entrant — the user can revise an earlier section", () => {
    // Business rule 5: the flow is re-entrant, not linear-locked. The body must
    // say the user can revise/return to an earlier section — collaborative, not
    // a locked wizard.
    const body = brainstormBodyLower();
    const isReentrant =
      body.includes("re-entrant") ||
      body.includes("reentrant") ||
      body.includes("revise an earlier") ||
      body.includes("revise earlier") ||
      body.includes("revisit") ||
      body.includes("return to an earlier") ||
      body.includes("go back") ||
      (body.includes("revise") && body.includes("earlier"));
    const isCollaborative =
      body.includes("collaborative") ||
      body.includes("not a locked wizard") ||
      body.includes("not linear-locked") ||
      body.includes("not a wizard");
    expect(isReentrant).toBe(true);
    expect(isCollaborative).toBe(true);
  });
});

describe("references/brainstorm_interview.md — SC2 tailoring: the spec reflects THIS user's stated inputs", () => {
  it("states the persona, mapping, and rubric must reflect the user's STATED inputs (tailored, not template)", () => {
    // Business rule 4 (SC2): the persona, answer→param mapping, and rubric must
    // reflect what THIS user said — not a generic template. The body must say
    // the tailoring is real (reflects the user's stated tastes/priorities), not
    // a fixed template.
    const body = brainstormBodyLower();
    const namesStated =
      body.includes("stated") ||
      body.includes("what this user said") ||
      body.includes("what the user said") ||
      body.includes("the user's stated");
    const namesTailored =
      body.includes("tailored") ||
      body.includes("tailor") ||
      body.includes("not a generic template") ||
      body.includes("not a template") ||
      body.includes("not generic");
    expect(namesStated).toBe(true);
    expect(namesTailored).toBe(true);
  });

  it("maps concrete stated inputs to REAL sil_search params (budget→price_min/price_max, prefer secondhand→condition, niche→query/category)", () => {
    // SC2 core: the answer→param mapping must target the REAL sil_search params
    // (catalog.ts), not invented filters. The mapping reference (which the
    // interview delegates this detail to) must name the concrete params a stated
    // input maps onto: a budget → price_min/price_max; "prefer secondhand"/"new
    // only" → condition; the niche → query and/or category. Read the interview +
    // the mapping it references as one corpus.
    const body = brainstormCorpusLower();
    expect(body).toContain("price_min");
    expect(body).toContain("price_max");
    expect(body).toContain("condition");
    expect(body).toContain("query");
    expect(body).toContain("category");
    // The mapping must tie a stated budget to the price params, not merely list
    // them — a budget token near the price params proves the worked example.
    expect(body).toContain("budget");
    // "secondhand" is the concrete condition value a "prefer secondhand" taste
    // maps onto — naming it proves the mapping is a real worked example.
    expect(body).toContain("secondhand");
  });

  it("leaves ship_to EMPTY by default and never round-trips sil_whoami to populate it", () => {
    // Business rule 9 / location-aware-search-flow: the inherited search
    // behaviour must leave ship_to empty (server resolves the registered
    // default) and must NOT instruct the expert to call sil_whoami to populate
    // it. The mapping reference (delegated from the interview) must name ship_to,
    // state it is left empty by default, and disavow the sil_whoami round-trip.
    const body = brainstormCorpusLower();
    expect(body).toContain("ship_to");
    const leavesEmpty =
      body.includes("ship_to empty") ||
      body.includes("ship_to left empty") ||
      body.includes("leave ship_to empty") ||
      body.includes("leaves ship_to empty") ||
      (body.includes("ship_to") && body.includes("empty"));
    expect(leavesEmpty).toBe(true);
    // The no-whoami-roundtrip rule: the mapping must NOT round-trip sil_whoami
    // to populate ship_to. The prose must disavow it — "never call sil_whoami",
    // "do not round-trip sil_whoami", "without sil_whoami".
    const disavowsWhoamiRoundtrip =
      /(never|not|no|without|don't|do not)[^.]*sil_whoami/.test(body) ||
      /sil_whoami[^.]*(never|not)/.test(body);
    expect(disavowsWhoamiRoundtrip).toBe(true);
  });

  it("ties the recommendation rubric to the user's stated priorities (weighted, not a fixed order)", () => {
    // Business rule 4 / SC2: the rubric ranks/picks by the user's stated
    // priorities (e.g. "durability over price", a hard-no brand) — weighted by
    // what the user said, not a fixed order. The body must name the rubric AND
    // tie it to stated priorities, with a concrete worked example.
    const body = brainstormBodyLower();
    const namesRubric =
      body.includes("rubric") ||
      (body.includes("rank") && body.includes("recommend"));
    const tiesToPriorities =
      body.includes("priorities") ||
      body.includes("priority") ||
      body.includes("weighted") ||
      body.includes("weight") ||
      body.includes("durability over price") ||
      body.includes("hard no") ||
      body.includes("hard-no");
    expect(namesRubric).toBe(true);
    expect(tiesToPriorities).toBe(true);
  });

  it("frames the converged output as a valid sil_profile_materialize input (agentId lower-kebab ≠ main, non-blank name/persona, optional playbook)", () => {
    // SC2 / the spec-contract bridge: the converged spec must be a VALID input
    // to sil_profile_materialize — { agentId (lower-kebab, ≠ main), name
    // (non-blank), persona (non-blank), playbook? (non-blank if present) }. The
    // body must frame the brainstorm output as that spec, and name agentId's
    // lower-kebab + not-main constraint so a derived id is a valid one.
    const body = brainstormBodyLower();
    expect(body).toContain("sil_profile_materialize");
    expect(body).toContain("agentid");
    const namesLowerKebab =
      body.includes("lower-kebab") ||
      body.includes("lower kebab") ||
      body.includes("kebab");
    const namesNotMain = body.includes("main");
    expect(namesLowerKebab).toBe(true);
    expect(namesNotMain).toBe(true);
  });
});

describe("skill — endorsement before creation: ZERO engine steps before an explicit go-ahead", () => {
  it("names an explicit endorsement / go-ahead on the assembled draft", () => {
    // Business rule 1 (the strongest invariant): nothing is created until the
    // user explicitly endorses the assembled draft. The interview reference (the
    // file that owns the endorsement gate) must name an explicit endorsement /
    // go-ahead — and that it is an affirmative user act, not inferred from
    // answering the last question or from silence.
    const body = brainstormBodyLower();
    const namesEndorsement =
      body.includes("endorse") ||
      body.includes("endorsement") ||
      body.includes("go-ahead") ||
      body.includes("go ahead") ||
      (body.includes("explicit") && (body.includes("approve") || body.includes("confirm")));
    const namesDraft =
      body.includes("draft") ||
      body.includes("assembled spec") ||
      body.includes("assembled draft");
    expect(namesEndorsement).toBe(true);
    expect(namesDraft).toBe(true);
  });

  it("orders the endorsement BEFORE the engine pointer (the interview reaches the engine only after endorsement)", () => {
    // The card's strongest ordering invariant, preserved across the split: in
    // the interview reference, an endorse/confirm anchor must precede the
    // pointer that hands off to the engine reference. Because the engine is
    // loaded DOWNSTREAM of the interview, an endorsement step textually ahead of
    // the engine handoff proves the agent cannot reach creation before the
    // user's explicit go-ahead. Anchor on the `endorse` verb — the brainstorm
    // owns it.
    const body = brainstormBodyLower();
    const endorseIdx = body.indexOf("endorse");
    const engineHandoffIdx = body.indexOf("agent_creation_engine.md");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(engineHandoffIdx).toBeGreaterThanOrEqual(0);
    // The endorsement gate is stated, and the FINAL/after-endorsement handoff to
    // the engine reference comes after an endorse mention. The last engine-ref
    // pointer (the "after endorsement, proceed to the engine" handoff) must be
    // preceded by an endorse token.
    const lastEngineHandoffIdx = body.lastIndexOf("agent_creation_engine.md");
    expect(endorseIdx).toBeLessThan(lastEngineHandoffIdx);
  });

  it("guards BOTH write surfaces behind endorsement (no openclaw agents add / sil_profile_materialize pre-endorsement)", () => {
    // The same gate against the two concrete write surfaces. The interview
    // reference must keep the engine's write commands OUT of the pre-endorsement
    // flow — neither `openclaw agents add` nor `sil_profile_materialize` may be
    // reachable before the endorsement gate. The interview names the engine only
    // as a post-endorsement handoff; if it mentions either write surface, that
    // mention must come AFTER the endorse token.
    const body = brainstormBodyLower();
    const endorseIdx = body.indexOf("endorse");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    const addIdx = body.indexOf("openclaw agents add");
    if (addIdx >= 0) expect(endorseIdx).toBeLessThan(addIdx);
    const materializeIdx = body.indexOf("sil_profile_materialize");
    // sil_profile_materialize IS named (the spec-contract bridge) — its first
    // mention is the self-check of the spec SHAPE, which legitimately precedes
    // endorsement; the WRITE call lives in the engine. So we do not order the
    // first mention. The invariant that matters — no engine STEP runs pre-
    // endorsement — is pinned by the engine handoff ordering above and the
    // prose-state assertion below.
    expect(materializeIdx).toBeGreaterThanOrEqual(0);
  });

  it("states ZERO engine steps run before endorsement (nothing created until the user says yes)", () => {
    // Business rule 1 + 2, in prose: before endorsement the flow has called
    // ZERO engine steps. The body must say nothing is created / written until
    // the user endorses — the draft lives only in conversation until then.
    const body = brainstormBodyLower();
    const saysNothingUntilEndorsed =
      body.includes("nothing is created until") ||
      body.includes("nothing created until") ||
      body.includes("creates nothing until") ||
      body.includes("create nothing until") ||
      body.includes("nothing is written until") ||
      body.includes("zero engine steps") ||
      body.includes("no engine step") ||
      (body.includes("only on") && body.includes("endorse")) ||
      (body.includes("only") && body.includes("endorse") && body.includes("engine"));
    expect(saysNothingUntilEndorsed).toBe(true);
  });
});

describe("references/brainstorm_interview.md — abandon mid-flow creates nothing", () => {
  it("states abandoning mid-flow leaves a clean state with nothing written (no partial expert)", () => {
    // Business rule 2: if the user stops/changes their mind before endorsing,
    // the flow has created nothing — no partial expert to clean up, because no
    // engine step ran pre-endorsement. The body must name the abandon path and
    // that it leaves nothing partial (no teardown needed).
    const body = brainstormBodyLower();
    const namesAbandon =
      body.includes("abandon") ||
      body.includes("stops") ||
      body.includes("changes their mind") ||
      body.includes("walks away") ||
      body.includes("walk away") ||
      body.includes("change their mind") ||
      body.includes("mid-flow");
    const namesNothingCreated =
      body.includes("nothing is created") ||
      body.includes("nothing created") ||
      body.includes("created nothing") ||
      body.includes("creates nothing") ||
      body.includes("nothing was written") ||
      body.includes("no partial") ||
      body.includes("nothing partial") ||
      body.includes("clean state");
    expect(namesAbandon).toBe(true);
    expect(namesNothingCreated).toBe(true);
  });

  it("states the flow never saves progress by writing artefacts early", () => {
    // Business rule 2 corollary: the flow must never "save progress" by writing
    // artefacts before endorsement — the draft lives in conversation only. The
    // body must disavow early/partial writes, so abandonment is automatically
    // clean.
    const body = brainstormBodyLower();
    const disavowsEarlyWrite =
      body.includes("never save progress") ||
      body.includes("not save progress") ||
      body.includes("does not save progress") ||
      body.includes("draft lives only in the conversation") ||
      body.includes("draft lives in conversation") ||
      body.includes("only in the conversation") ||
      body.includes("only in conversation") ||
      body.includes("no writes before") ||
      body.includes("write nothing before") ||
      body.includes("writes nothing before") ||
      body.includes('"save progress"');
    expect(disavowsEarlyWrite).toBe(true);
  });
});

describe("references/brainstorm_interview.md — collision is handled in the conversation: refine-or-rename, never clobber", () => {
  it("offers refine-or-rename on a colliding agentId (a path forward, not a dead-end)", () => {
    // Business rule 7 / the card's collision edge: when the proposed agentId
    // collides with an existing expert, the flow offers a CHOICE — refine the
    // niche under a new id, or rename this one — rather than dead-ending. The
    // body must name both the rename option AND the refine-the-niche
    // alternative, so the user is never stuck.
    const body = brainstormBodyLower();
    const offersRename =
      body.includes("rename") ||
      body.includes("different id") ||
      body.includes("new id") ||
      body.includes("pick a different");
    const offersRefine =
      body.includes("refine") ||
      body.includes("refine the niche") ||
      body.includes("refine the existing");
    expect(offersRename).toBe(true);
    expect(offersRefine).toBe(true);
  });

  it("never clobbers an existing expert on collision (defers to the engine's collision refusal)", () => {
    // Business rule 7: the flow never overwrites an existing expert — it
    // surfaces the `collision` outcome and offers refine-or-rename. The body
    // must disavow clobbering on collision, consistent with the engine's
    // non-destructive collision refusal.
    const body = brainstormBodyLower();
    expect(body).toContain("collision");
    const neverClobbers =
      body.includes("never overwrite") ||
      body.includes("never clobber") ||
      body.includes("not overwrite") ||
      body.includes("do not overwrite") ||
      body.includes("do not clobber") ||
      body.includes("non-destructive");
    expect(neverClobbers).toBe(true);
  });
});

describe("references/brainstorm_interview.md — creation is local + offline: no identity coupling in the interview", () => {
  it("does NOT present sil registration / a token as a prerequisite to CREATE the expert", () => {
    // Business rule 8: the interview never presents sil registration / a token
    // as a prerequisite to CREATE the expert (the expert registers the user
    // later, on first shop). The brainstorm must not ask the user to register
    // before creating. Same adversarial shape as the engine's AC5 identity-
    // coupling guard: assert the brainstorm does not gate CREATION on register.
    const body = brainstormBodyLower();
    const couplesIdentity =
      /register[^.]*before[^.]*creat/.test(body) ||
      /creat[^.]*requires[^.]*register/.test(body) ||
      /must.*register.*to.*creat/.test(body) ||
      /register[^.]*prerequisite[^.]*creat/.test(body);
    expect(couplesIdentity).toBe(false);
  });
});

/* ===========================================================================
 * WORKED EXAMPLE — the end-to-end walkthrough exists and demonstrates the gate.
 * skill-creator: ≥1 worked example showing the full journey (free-form request
 * → interview convergence → assembled spec → created expert). Pin its presence
 * and that it carries the endorsement gate, so the example never drifts into a
 * shortcut that skips the user's go-ahead.
 * ========================================================================= */

describe("examples/ — a worked end-to-end example exists and demonstrates the endorsement gate", () => {
  it("the worked example file exists on disk", () => {
    expect(existsSync(EXAMPLE_PATH)).toBe(true);
  });

  it("walks the full journey: a free-form request, the interview, an assembled spec, a created expert", () => {
    const body = readBody(EXAMPLE_PATH).toLowerCase();
    // The assembled spec shape and the catalog tools the created expert calls.
    expect(body).toContain("agentid");
    expect(body).toContain("persona");
    expect(body).toContain("playbook");
    // The journey reaches the engine via the host-native creation command.
    expect(body).toContain("openclaw agents add");
  });

  it("shows the endorsement gate — the engine runs only AFTER the user's explicit go-ahead", () => {
    // The example must not model a shortcut: the explicit endorsement must
    // precede the engine's first write command in the walkthrough.
    const body = readBody(EXAMPLE_PATH).toLowerCase();
    const endorseIdx = body.indexOf("endorse");
    const addIdx = body.indexOf("openclaw agents add");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(endorseIdx).toBeLessThan(addIdx);
  });
});

/* ===========================================================================
 * REFINE AN EXISTING EXPERT — the self-reinforcement loop seam
 * (card: refine-an-expert-from-observed-sessions-self-reinf — SC6)
 *
 * tier: unit (the *nature* of each assertion is a single-artefact prose check
 * over the real reference body — the umbrella file declares itself integration
 * because it reads real skill files, but these mirror how the sibling SC4 card
 * tagged its identical reference-content criteria). Same content-seam pattern as
 * the engine/brainstorm blocks above: read the REAL
 * skill/references/refine_expert.md from disk, lowercase, and pin the loop's
 * load-bearing invariants via OR-grouped intent-token substrings + indexOf
 * step-VERB ordering anchors — NEVER `§N` numbers, NEVER exact sentences, so the
 * prose stays editable.
 *
 * The architect's verdict: SC6 is skill-guidance-only — no `src/` change, no new
 * plugin tool. The refine loop COMPOSES the existing `sil_profile_get` (load) +
 * `sil_profile_materialize` (atomic in-place re-write) tools; the reference body
 * IS the spec the host agent follows, exactly as it is for the engine. These
 * never fake a host: "a real refinement genuinely sharpens the expert" is
 * `live-verification`'s job (this repo has NO host-load gate per CLAUDE.md), and
 * the artefact-interaction half (the in-place re-write preserving prior artefacts
 * on failure; the materialize→re-materialize→read round-trip) is pinned by the
 * integration test in src/__tests__/lib/refine-rewrite.test.ts.
 *
 * The 7 unit invariants pinned here come straight from the card's 7 `unit`
 * acceptance criteria / the In-Dev handoff "Where to start (qa-developer)" list.
 * RED on arrival: refine_expert.md does not exist yet (expert-developer authors
 * it in GREEN) — every read + assert below fails until it does.
 * ========================================================================= */

/** Lower-cased refine reference body — the file that OWNS the refine loop. */
function refineBodyLower(): string {
  return readBody(REFINE_PATH).toLowerCase();
}

/** The refine reference + the search-param mapping it DELEGATES the param table
 * to, read as one corpus — for the never-invent-a-filter / ship_to-empty checks
 * where the worked param detail legitimately lives in the mapping reference the
 * refine loop POINTS AT (rather than re-carrying). */
function refineCorpusLower(): string {
  return (readBody(REFINE_PATH) + "\n" + readBody(MAPPING_PATH)).toLowerCase();
}

describe("references/refine_expert.md — exists + names the load/persist tools it composes (AC1/AC4)", () => {
  it("exists on disk", () => {
    // RED until expert-developer authors the reference. A refine loop with no
    // reference is a broken capability — the router would point at a missing file.
    expect(existsSync(REFINE_PATH)).toBe(true);
  });

  it("names the load step `sil_profile_get` (load the expert it sharpens)", () => {
    // Step 1 (trigger + load): the loop loads the named expert's current
    // artefacts via the existing get tool — manifest + persona + playbook. The
    // reference must name the real load tool so the path is loadable.
    expect(refineBodyLower()).toContain("sil_profile_get");
  });

  it("names the persist step `sil_profile_materialize` (the atomic in-place re-write)", () => {
    // Step 4 (persist): the confirmed subset persists by re-running the engine's
    // persist step — `sil_profile_materialize` with the UPDATED spec. The
    // reference must name the real persist tool (NOT a hand-rolled write under
    // $SIL_DATA_DIR — that would diverge from the store's atomic-write idiom and
    // re-open the half-refined surface).
    expect(refineBodyLower()).toContain("sil_profile_materialize");
  });
});

describe("references/refine_expert.md — propose from the OBSERVED session, tied to evidence, not a generic template (AC1)", () => {
  it("frames a distinct REFINE capability (load→propose→confirm→persist), not the create engine or a shop loop", () => {
    // Adversarial: the engine already CREATES experts and SC4 owns the SHOP loop.
    // This card adds REFINE — sharpening an EXISTING expert. The body must name
    // refining/sharpening an existing expert, so it is a real distinct capability,
    // not a re-read of the create prose or a duplicate of the shop loop.
    const body = refineBodyLower();
    const namesRefine =
      body.includes("refine") ||
      body.includes("sharpen") ||
      body.includes("amend");
    const namesExistingExpert =
      body.includes("existing expert") ||
      body.includes("an existing") ||
      (body.includes("existing") && body.includes("expert")) ||
      body.includes("the named expert");
    expect(namesRefine).toBe(true);
    expect(namesExistingExpert).toBe(true);
  });

  it("proposes refinements drawn from the OBSERVED session (not invented out of nothing)", () => {
    // Step 2 (propose, session-grounded): proposals are drawn from what the agent
    // actually OBSERVED in the just-completed/in-progress shopping session under
    // this expert. The body must name the observed session as the source.
    const body = refineBodyLower();
    const namesObserved =
      body.includes("observed session") ||
      body.includes("observed shopping") ||
      body.includes("what it observed") ||
      body.includes("what the agent observed") ||
      (body.includes("observed") && body.includes("session"));
    expect(namesObserved).toBe(true);
  });

  it("ties each proposal to CONCRETE observed evidence (a query that returned junk, what was rejected, a taste volunteered-but-uncaptured)", () => {
    // Business rule / AC1: every proposal CITES the observed evidence behind it —
    // a `sil_search` param mapping that returned (ir)relevant items, what the user
    // accepted/rejected, a taste volunteered but never captured. The body must
    // name the evidence categories so a proposal is grounded, not guesswork.
    const body = refineBodyLower();
    // The evidence is tied to what was returned / accepted / rejected / volunteered.
    const namesEvidence =
      body.includes("evidence") ||
      body.includes("grounded") ||
      body.includes("returned relevant") ||
      body.includes("returned irrelevant") ||
      body.includes("relevant or irrelevant") ||
      body.includes("relevant vs irrelevant") ||
      body.includes("accepted") ||
      body.includes("rejected") ||
      body.includes("volunteered");
    expect(namesEvidence).toBe(true);
    // And it names WHICH artefact element each proposal changes — a persona
    // standing rule, a mapping entry, a rubric weight — so a proposal is concrete.
    const namesArtefactTarget =
      body.includes("persona") &&
      (body.includes("mapping") || body.includes("rubric"));
    expect(namesArtefactTarget).toBe(true);
  });

  it("disavows a generic, ungrounded improvement template (no plausible-sounding guesswork)", () => {
    // AC1 / risk: a proposal NOT tied to anything the session showed is guesswork
    // dressed as expertise. The body must disavow the generic-template shape —
    // "not a generic template", "never a generic improvement", "do not fabricate".
    const body = refineBodyLower();
    const disavowsGeneric =
      body.includes("not a generic template") ||
      body.includes("not a generic") ||
      body.includes("never a generic") ||
      body.includes("not a template") ||
      body.includes("not generic") ||
      body.includes("ungrounded") ||
      (body.includes("generic") && body.includes("not")) ||
      (body.includes("template") && body.includes("not"));
    expect(disavowsGeneric).toBe(true);
  });
});

describe("references/refine_expert.md — per-proposal SUBSET confirmation; only the confirmed subset folds in (AC2)", () => {
  it("names per-proposal subset confirmation (all / some / none — not all-or-nothing)", () => {
    // AC2: the user confirms a SUBSET (per-proposal accept/reject), not just a
    // single yes/no over the whole batch. The body must name subset confirmation.
    const body = refineBodyLower();
    const namesSubset =
      body.includes("subset") ||
      body.includes("all, some, or none") ||
      body.includes("all/some/none") ||
      body.includes("all, some or none") ||
      body.includes("per-proposal") ||
      body.includes("per proposal") ||
      body.includes("which to keep") ||
      body.includes("which refinements to keep");
    expect(namesSubset).toBe(true);
  });

  it("states ONLY the confirmed subset is folded into the spec + persisted (the rest discarded with the conversation)", () => {
    // AC2: only the confirmed subset persists; the unconfirmed proposals are
    // discarded with the conversation. The body must say only the confirmed
    // changes are folded in / persisted — no over-persist.
    const body = refineBodyLower();
    const onlyConfirmed =
      body.includes("only the confirmed") ||
      body.includes("only confirmed") ||
      body.includes("confirmed subset") ||
      (body.includes("confirmed") && body.includes("folded")) ||
      (body.includes("only") && body.includes("confirm") && body.includes("persist"));
    expect(onlyConfirmed).toBe(true);
    const discardsRest =
      body.includes("discard") ||
      body.includes("discarded") ||
      body.includes("dies with the conversation") ||
      body.includes("live only in the conversation") ||
      body.includes("lives only in the conversation") ||
      body.includes("only in the conversation") ||
      body.includes("nothing else persists") ||
      body.includes("no more");
    expect(discardsRest).toBe(true);
  });
});

describe("references/refine_expert.md — confirm-before-persist GATE; never inferred from silence/off-topic (AC3)", () => {
  it("names the confirm-before-persist gate (an explicit affirmative act)", () => {
    // AC3 (the strongest invariant): nothing persists without the user's explicit
    // confirmation. The body must name confirmation as an explicit affirmative act
    // gating the persist.
    const body = refineBodyLower();
    const namesConfirmGate =
      body.includes("confirm") ||
      body.includes("confirmation") ||
      body.includes("explicit") ||
      body.includes("affirmative");
    expect(namesConfirmGate).toBe(true);
  });

  it("states confirmation is NEVER inferred from silence or an off-topic / unrelated reply", () => {
    // AC3 headline trust contract: "confirm" is never inferred from silence or
    // from the user answering an unrelated question. The body must disavow both.
    const body = refineBodyLower();
    const disavowsSilence =
      body.includes("never inferred from silence") ||
      body.includes("not inferred from silence") ||
      body.includes("never from silence") ||
      (body.includes("silence") && body.includes("never")) ||
      (body.includes("silence") && body.includes("not"));
    const disavowsOffTopic =
      body.includes("off-topic") ||
      body.includes("off topic") ||
      body.includes("unrelated question") ||
      body.includes("unrelated reply") ||
      body.includes("answering an unrelated") ||
      body.includes("answering something unrelated") ||
      body.includes("an unrelated");
    expect(disavowsSilence).toBe(true);
    expect(disavowsOffTopic).toBe(true);
  });

  it("orders the CONFIRM verb strictly BEFORE the persist/materialize verb (the gate precedes the write)", () => {
    // AC3 ordering anchor (mirrors the engine's validate-before-add): the confirm
    // step must come textually BEFORE the `sil_profile_materialize`/persist step,
    // so an agent following top-to-bottom confirms first and can never persist a
    // proposal the user has not confirmed. Order in the prose IS the spec.
    //
    // Adversarial precision: anchor the persist side on the materialize TOOL
    // token (the write surface), and the confirm side on the `confirm` verb. If
    // the reference legitimately names the materialize tool earlier (e.g. naming
    // the persist step it routes to), the LAST confirm before the materialize
    // CALL still proves the gate; here we require the FIRST confirm to precede the
    // materialize mention — a procedure that materializes before any confirm is
    // exactly the trust violation this pins.
    const body = refineBodyLower();
    const confirmIdx = body.indexOf("confirm");
    const materializeIdx = body.indexOf("sil_profile_materialize");
    expect(confirmIdx).toBeGreaterThanOrEqual(0);
    expect(materializeIdx).toBeGreaterThanOrEqual(0);
    expect(confirmIdx).toBeLessThan(materializeIdx);
  });
});

describe("references/refine_expert.md — persist is atomic; a failure leaves the PRIOR artefacts intact (AC4)", () => {
  it("frames the persist as an atomic in-place re-write of THAT ONE agentId's artefacts", () => {
    // AC4: persona drift → persona.md; mapping/rubric/elicitation drift →
    // playbook.md; the re-materialize is an ATOMIC in-place re-write of that one
    // expert's artefacts (full-spec, never a partial/field-level write). The body
    // must name the atomic/all-or-nothing re-write and the artefact files.
    const body = refineBodyLower();
    const namesAtomic =
      body.includes("atomic") ||
      body.includes("all-or-nothing") ||
      body.includes("all or nothing") ||
      body.includes("in-place re-write") ||
      body.includes("in-place rewrite") ||
      body.includes("re-write") ||
      body.includes("rewrite") ||
      body.includes("overwrite");
    expect(namesAtomic).toBe(true);
    // The artefact files the re-write targets.
    expect(body).toContain("persona.md");
    expect(body).toContain("playbook.md");
  });

  it("states a persist FAILURE leaves the PRIOR artefacts intact (never a half-refined expert) and tells the user it did not stick", () => {
    // AC4 failure half: a failed re-write leaves the PRIOR artefacts intact (the
    // store's `dirPreexisted` guard never tears down a pre-existing dir), and the
    // user is told the refinement did not stick. The body must name BOTH — prior
    // artefacts survive, and never a half-refined expert.
    const body = refineBodyLower();
    const priorSurvives =
      body.includes("prior artefacts") ||
      body.includes("prior artifacts") ||
      body.includes("prior expert") ||
      body.includes("leaves the prior") ||
      body.includes("leave the prior") ||
      body.includes("prior state") ||
      body.includes("left intact") ||
      body.includes("leaves intact") ||
      (body.includes("intact") && body.includes("prior")) ||
      (body.includes("unchanged") && body.includes("fail"));
    const neverHalfRefined =
      body.includes("half-refined") ||
      body.includes("half refined") ||
      body.includes("never half") ||
      body.includes("nothing partial") ||
      body.includes("no partial") ||
      body.includes("did not stick") ||
      body.includes("didn't stick") ||
      body.includes("does not stick");
    expect(priorSurvives).toBe(true);
    expect(neverHalfRefined).toBe(true);
  });
});

describe("references/refine_expert.md — per-user/local under $SIL_DATA_DIR; NO server endpoint on the refine path (AC6)", () => {
  it("frames refinement as per-user + local under $SIL_DATA_DIR (no shared store, no cross-user signal)", () => {
    // AC6: the improvement is per-user and local — written only to this user's
    // $SIL_DATA_DIR/agents/<agentId>/, no server-side aggregation, no shared
    // store. The body must name per-user/local AND the data dir.
    const body = refineBodyLower();
    const namesPerUserLocal =
      body.includes("per-user") ||
      body.includes("per user") ||
      body.includes("local") ||
      body.includes("on this machine") ||
      body.includes("your own");
    const namesDataDir =
      body.includes("$sil_data_dir") ||
      body.includes("sil_data_dir") ||
      body.includes("sil data directory") ||
      body.includes("sil data dir");
    expect(namesPerUserLocal).toBe(true);
    expect(namesDataDir).toBe(true);
    // And it disavows server-side aggregation / a shared store / cross-user signal.
    const disavowsServer =
      body.includes("no server-side aggregation") ||
      body.includes("no server side aggregation") ||
      body.includes("no shared store") ||
      body.includes("no shared expert") ||
      body.includes("no cross-user") ||
      body.includes("no server endpoint") ||
      (body.includes("no") && body.includes("aggregation")) ||
      (body.includes("never") && body.includes("shared"));
    expect(disavowsServer).toBe(true);
  });

  it("NEGATIVE: names NO server / sil-api endpoint on the refine path (no register/whoami round-trip, no network call)", () => {
    // AC6 negative token check: the refine/persist path calls no server endpoint.
    // The catalog/identity server-call surface must NOT appear as a refine STEP —
    // the loop reasons over loaded artefacts + observations and persists locally.
    // sil_register / sil_whoami are the identity round-trips the refine path must
    // not perform; a `sil-api` / server-endpoint token would mean a network call.
    const body = refineBodyLower();
    // No identity round-trip on the refine path (the loop loads + persists, it
    // does not register or whoami).
    expect(body).not.toContain("sil_register");
    expect(body).not.toContain("sil_whoami");
    // No raw server/api endpoint token on the refine path.
    expect(body).not.toContain("sil-api");
    expect(body).not.toContain("api.sil");
    expect(body).not.toContain("https://");
  });
});

describe("references/refine_expert.md — single-agentId isolation; other experts + generic shopping untouched (AC7)", () => {
  it("scopes the persist to the single named agentId's directory", () => {
    // AC7: the persist touches exactly `agents/<agentId>/` for the named expert.
    // The body must name the single-agentId scope (keyed off the one validated id).
    const body = refineBodyLower();
    const namesAgentScope =
      body.includes("agentid") ||
      body.includes("agent id") ||
      body.includes("agents/<") ||
      body.includes("agents/") ||
      body.includes("the named expert");
    expect(namesAgentScope).toBe(true);
  });

  it("states other experts AND the generic profile-less shopping path are UNTOUCHED", () => {
    // AC7 isolation bar: no sibling expert's artefacts mutate, and a plain sil
    // session still shops exactly as today. The body must name BOTH — other
    // experts untouched AND generic/profile-less shopping untouched.
    const body = refineBodyLower();
    const othersUntouched =
      body.includes("other expert") ||
      body.includes("sibling") ||
      body.includes("another expert") ||
      (body.includes("other") && body.includes("untouched"));
    const genericUntouched =
      body.includes("generic") ||
      body.includes("profile-less") ||
      body.includes("profileless") ||
      body.includes("plain sil") ||
      body.includes("plain shopping") ||
      (body.includes("untouched") && body.includes("shopping"));
    expect(othersUntouched).toBe(true);
    expect(genericUntouched).toBe(true);
  });
});

describe("references/refine_expert.md — mapping refinements target REAL sil_search params; POINT AT the mapping, don't restate it (AC8)", () => {
  it("names the never-invent-a-filter rule (a no-matching-param taste folds into query text or the rubric)", () => {
    // AC8: a refinement to the answer→param mapping maps ONLY onto real
    // sil_search params; a volunteered taste with no matching param folds into
    // `query` text or the rubric — NEVER a fabricated filter. The body must name
    // the never-invent rule AND the fold-into-query/rubric fallback.
    const body = refineBodyLower();
    const namesNeverInvent =
      body.includes("never an invented filter") ||
      body.includes("never invent a filter") ||
      body.includes("not invent a filter") ||
      body.includes("never an invented") ||
      body.includes("invented filter") ||
      body.includes("fabricated filter") ||
      body.includes("real sil_search param") ||
      body.includes("only real") ||
      (body.includes("invent") && body.includes("filter"));
    expect(namesNeverInvent).toBe(true);
    const foldsIntoQueryOrRubric =
      body.includes("query text") ||
      body.includes("into query") ||
      body.includes("into the query") ||
      body.includes("the rubric") ||
      (body.includes("query") && body.includes("rubric"));
    expect(foldsIntoQueryOrRubric).toBe(true);
  });

  it("names the ship_to-empty / no-sil_whoami-round-trip rule", () => {
    // AC8: the mapping leaves ship_to EMPTY (server resolves the registered
    // default) and never round-trips sil_whoami to populate it. The refine
    // reference must name this rule (consistent with the established mapping
    // rules) — read with the mapping reference it points at, since the worked
    // ship_to detail may legitimately live in the mapping reference.
    const body = refineCorpusLower();
    expect(body).toContain("ship_to");
    const leavesEmpty =
      body.includes("ship_to empty") ||
      body.includes("ship_to left empty") ||
      body.includes("leave ship_to empty") ||
      body.includes("leaves ship_to empty") ||
      (body.includes("ship_to") && body.includes("empty"));
    expect(leavesEmpty).toBe(true);
    const disavowsWhoamiRoundtrip =
      /(never|not|no|without|don't|do not)[^.]*sil_whoami/.test(body) ||
      /sil_whoami[^.]*(never|not)/.test(body);
    expect(disavowsWhoamiRoundtrip).toBe(true);
  });

  it("POINTS AT search_param_mapping.md rather than re-carrying the param table (references-not-restates)", () => {
    // AC8 / the no-duplication invariant (same one the router tests pin): the
    // refine reference must LINK the mapping reference, NOT restate the param
    // table. Two checks: (1) it names the mapping reference by relative path;
    // (2) it does NOT re-carry the worked param TOKENS that belong only to the
    // mapping reference (a refine reference that lists price_min/price_max/
    // condition itself has duplicated the table — drift waiting to happen).
    const body = readBody(REFINE_PATH).toLowerCase();
    const pointsAtMapping =
      body.includes("search_param_mapping.md") ||
      body.includes("references/search_param_mapping.md");
    expect(pointsAtMapping).toBe(true);
    // It must NOT re-carry the param table's worked tokens (link, don't restate).
    expect(body).not.toContain("price_min");
    expect(body).not.toContain("price_max");
  });
});

describe("references/refine_expert.md — no-observed-signal fallback: guided amend, never fabricate (AC9)", () => {
  it("names the no-observed-signal fallback — guided amend (ask what to change) or invite-to-shop-first", () => {
    // AC9: when no observed session signal is available (a fresh session, or the
    // prior session out of context), the agent falls back to a guided amend (ask
    // the user what to change) or invites them to shop first. The body must name
    // the no-signal case AND the fallback.
    const body = refineBodyLower();
    const namesNoSignal =
      body.includes("no observed") ||
      body.includes("no session") ||
      body.includes("fresh session") ||
      body.includes("out of context") ||
      body.includes("no signal") ||
      body.includes("without an observed") ||
      body.includes("no shopping session");
    expect(namesNoSignal).toBe(true);
    const namesFallback =
      body.includes("guided amend") ||
      body.includes("ask the user what to change") ||
      body.includes("ask what to change") ||
      body.includes("ask what they") ||
      body.includes("invite") ||
      body.includes("shop first") ||
      body.includes("shop a session first");
    expect(namesFallback).toBe(true);
  });

  it("states the agent must NOT fabricate session observations", () => {
    // AC9 trust bar: the expert must NEVER invent session evidence to propose
    // against. The body must disavow fabricating observations.
    const body = refineBodyLower();
    const disavowsFabrication =
      body.includes("not fabricate") ||
      body.includes("never fabricate") ||
      body.includes("do not fabricate") ||
      body.includes("don't fabricate") ||
      body.includes("not invent") ||
      body.includes("never invent") ||
      body.includes("without inventing") ||
      body.includes("rather than inventing") ||
      body.includes("rather than invent") ||
      (body.includes("fabricat") && body.includes("not")) ||
      (body.includes("invent") && body.includes("observation"));
    expect(disavowsFabrication).toBe(true);
  });
});

/* ===========================================================================
 * EXPERT-SHOPPING LOOP — the shop-time behaviour a created expert runs (SC4)
 * (card: expert-shopping-behaviour-for-a-created-agent)
 *
 * tier: unit (single-reference content/ordering substring + indexOf checks) +
 * integration (the cross-file additive-not-regressive seam). Same content-seam
 * pattern as the engine/brainstorm blocks above: read the REAL
 * skill/references/expert_shopping.md from disk, lowercase, and pin the
 * shop-time loop as a SOURCE OF TRUTH — there is no plugin-tool change, no code
 * path; the reference body IS the spec the created expert follows when a user
 * states a shopping intent. The loop consumes the already-materialized profile
 * artefacts (persona.md / playbook.md / profile.json under $SIL_DATA_DIR — the
 * engine's Runtime hook ENDS where this loop STARTS) and the existing
 * sil_search / sil_product_get tools UNCHANGED.
 *
 * Adversarial discipline (mirrors the engine/brainstorm blocks): anchor on step
 * VERBS via indexOf ORDERING and OR-grouped intent tokens — NEVER on `§N`
 * section numbers and NEVER on exact sentences, so any reword survives. The
 * loop ORDER is the spec: elicit → map → search → compare → recommend, and
 * re-fetch BEFORE the buy hand-off.
 *
 * No host, no network, no faked transcript: "a real expert genuinely shops like
 * a specialist" is `live-verification`'s job, NOT a test tier (this repo has no
 * host-load gate — CLAUDE.md). These pin the reference's load-bearing
 * invariants, not merely that a keyword is present.
 *
 * Reference, not restate: the loop POINTS AT search_param_mapping.md for the
 * param table and DELEGATES the status taxonomy to catalog_tools_reference.md —
 * the no-duplication invariant the router-leanness tests already enforce on
 * SKILL.md, extended here to the new reference.
 * ========================================================================= */

/** Lower-cased expert-shopping reference body — the file that OWNS the shop-time
 * loop a created expert runs. Substring checks are intent ("the loop names X");
 * indexOf comparisons pin step ORDER. */
function expertShoppingBodyLower(): string {
  return readBody(EXPERT_SHOPPING_PATH).toLowerCase();
}

describe("references/expert_shopping.md — exists and starts where the engine's Runtime hook ends", () => {
  it("exists on disk", () => {
    // RED until the expert-developer authors it. The router's
    // every-references-path-exists glob auto-covers the new pointer once SKILL.md
    // names it; this block pins the BODY's load-bearing invariants.
    expect(existsSync(EXPERT_SHOPPING_PATH)).toBe(true);
  });

  it("frames a distinct shop-time loop for a created expert consuming the loaded profile artefacts", () => {
    // SC4 is a NEW behaviour: the shop-time loop a created expert runs, driven by
    // the playbook's rubric/priority order over the EXISTING tools. The body must
    // name the profile artefacts it consumes (the engine's Runtime hook loads
    // them — playbook/persona) AND the shopping subject, so this is a real
    // addition, not a re-read of the engine's creation prose.
    const body = expertShoppingBodyLower();
    const namesArtefacts =
      body.includes("playbook") ||
      body.includes("persona") ||
      body.includes("profile.json");
    const namesShopping =
      body.includes("shop") ||
      body.includes("shopping intent") ||
      body.includes("shopping");
    expect(namesArtefacts).toBe(true);
    expect(namesShopping).toBe(true);
  });
});

describe("references/expert_shopping.md — the loop ORDER is the spec (elicit → map → search → compare → recommend)", () => {
  it("names the elicit-in-priority-order step, disavows the form-fill, and forbids re-asking a stated attribute", () => {
    // AC1: when a load-bearing attribute is missing, the expert elicits it through
    // back-and-forth IN THE PLAYBOOK'S PRIORITY ORDER — not a fixed form-fill, and
    // never re-asking what was already stated. Same shape as the brainstorm
    // "not a form-fill" block: name the elicit step, the priority-order rule, the
    // form-fill disavowal, and the no-re-ask rule (OR-grouped intent tokens).
    const body = expertShoppingBodyLower();
    expect(body).toContain("elicit");
    const namesPriorityOrder =
      body.includes("priority order") ||
      body.includes("priority-order") ||
      body.includes("priority-ordered") ||
      (body.includes("priority") && body.includes("order"));
    const disavowsForm =
      body.includes("not a fixed form-fill") ||
      body.includes("not a form-fill") ||
      body.includes("not a form fill") ||
      body.includes("not a form") ||
      body.includes("not a fixed battery") ||
      body.includes("not a question battery") ||
      body.includes("not a wizard") ||
      body.includes("not a questionnaire") ||
      (body.includes("battery") && body.includes("not")) ||
      (body.includes("form-fill") && body.includes("not"));
    const forbidsReask =
      body.includes("never re-ask") ||
      body.includes("never reask") ||
      body.includes("not re-ask") ||
      body.includes("do not re-ask") ||
      body.includes("don't re-ask") ||
      body.includes("never re-asking") ||
      body.includes("never ask again") ||
      (body.includes("re-ask") && body.includes("never")) ||
      (body.includes("already stated") && body.includes("never"));
    expect(namesPriorityOrder).toBe(true);
    expect(disavowsForm).toBe(true);
    expect(forbidsReask).toBe(true);
  });

  it("states elicitation is need-driven — a sufficiently-specified intent proceeds straight to map+search (no invented question battery)", () => {
    // AC (second criterion): the elicitation is need-driven, only for a MISSING
    // load-bearing attribute. An intent that already carries enough load-bearing
    // attributes for a defensible search proceeds to map + search — the expert
    // does NOT invent an extra battery. The body must say elicitation triggers on
    // a missing/load-bearing gap, not as a fixed gate before every search.
    const body = expertShoppingBodyLower();
    const namesLoadBearing =
      body.includes("load-bearing") ||
      body.includes("load bearing");
    const namesNeedDriven =
      body.includes("missing") ||
      body.includes("need-driven") ||
      body.includes("only when") ||
      body.includes("only if") ||
      body.includes("only for") ||
      body.includes("already stated") ||
      body.includes("sufficiently specified") ||
      body.includes("enough") ||
      body.includes("proceed straight") ||
      body.includes("proceeds straight") ||
      body.includes("straight to");
    expect(namesLoadBearing).toBe(true);
    expect(namesNeedDriven).toBe(true);
  });

  it("orders the loop steps elicit → map → search → compare → recommend (indexOf on step VERBS, not §N numbers)", () => {
    // AC1+AC3+AC4: the loop ORDER is the spec, exactly as the engine pins
    // validate-first / list-before-add. An agent following the prose top-to-bottom
    // must elicit, then map answers to params, then search, then compare the
    // returned candidates, then recommend. Anchor on the step VERBS so a reword of
    // the prose survives and a §N renumber is irrelevant.
    const body = expertShoppingBodyLower();
    const elicitIdx = body.indexOf("elicit");
    const mapIdx = body.indexOf("map");
    const searchIdx = body.indexOf("sil_search");
    const compareIdx = (() => {
      for (const anchor of ["compare", "comparing", "evaluate"]) {
        const i = body.indexOf(anchor);
        if (i >= 0) return i;
      }
      return -1;
    })();
    const recommendIdx = (() => {
      for (const anchor of ["recommend", "recommendation"]) {
        const i = body.indexOf(anchor);
        if (i >= 0) return i;
      }
      return -1;
    })();
    expect(elicitIdx).toBeGreaterThanOrEqual(0);
    expect(mapIdx).toBeGreaterThanOrEqual(0);
    expect(searchIdx).toBeGreaterThanOrEqual(0);
    expect(compareIdx).toBeGreaterThanOrEqual(0);
    expect(recommendIdx).toBeGreaterThanOrEqual(0);
    // elicit precedes map precedes search precedes compare precedes recommend.
    expect(elicitIdx).toBeLessThan(mapIdx);
    expect(mapIdx).toBeLessThan(searchIdx);
    expect(searchIdx).toBeLessThan(compareIdx);
    expect(compareIdx).toBeLessThan(recommendIdx);
  });
});

describe("references/expert_shopping.md — map step: real sil_search params, never an invented filter, ship_to empty", () => {
  it("names sil_search, the never-invent-a-filter rule, and the ship_to-empty / no-sil_whoami-round-trip rule", () => {
    // AC (map criterion): the expert maps each answer to a WELL-FORMED sil_search
    // param, NEVER an invented filter, and leaves ship_to EMPTY so the server
    // resolves the registered default (no sil_whoami round-trip). Same shape as
    // the brainstorm mapping block: name the never-invent rule, ship_to, and
    // disavow the sil_whoami round-trip — OR-grouped so a reword survives.
    const body = expertShoppingBodyLower();
    expect(body).toContain("sil_search");
    const neverInvents =
      body.includes("never invent a filter") ||
      body.includes("never invent a param") ||
      body.includes("not invent a filter") ||
      body.includes("do not invent") ||
      body.includes("never an invented filter") ||
      body.includes("invented filter") ||
      (body.includes("invent") && body.includes("filter"));
    expect(neverInvents).toBe(true);
    expect(body).toContain("ship_to");
    const leavesShipToEmpty =
      body.includes("ship_to empty") ||
      body.includes("ship_to left empty") ||
      body.includes("leave ship_to empty") ||
      body.includes("leaves ship_to empty") ||
      (body.includes("ship_to") && body.includes("empty"));
    expect(leavesShipToEmpty).toBe(true);
    const disavowsWhoamiRoundtrip =
      /(never|not|no|without|don't|do not)[^.]*sil_whoami/.test(body) ||
      /sil_whoami[^.]*(never|not)/.test(body);
    expect(disavowsWhoamiRoundtrip).toBe(true);
  });

  it("POINTS AT search_param_mapping.md for the param table (references, does NOT re-carry it)", () => {
    // The references-not-restates invariant (architect risk): the loop's map step
    // must LINK the dedicated mapping reference, not copy its table into this file.
    // Two sources of truth drift. The body must name the mapping reference by
    // relative path so an agent loads it for the worked table.
    const body = expertShoppingBodyLower();
    expect(body).toContain("search_param_mapping.md");
  });
});

describe("references/expert_shopping.md — compare + recommend: rubric weighted by stated priorities, always the 'why', best-first preserved", () => {
  it("names the compare-on-the-rubric step weighted by the user's stated priorities", () => {
    // AC (compare/recommend criterion): the expert compares candidates on the
    // PLAYBOOK'S RUBRIC weighted by the user's STATED priorities (plus persona
    // hard-rules / hard-no's). The body must name the rubric AND tie it to the
    // user's stated priorities — the specialist behaviour, not generic ranking.
    const body = expertShoppingBodyLower();
    const namesRubric =
      body.includes("rubric") ||
      (body.includes("compare") && body.includes("recommend"));
    const tiesToStatedPriorities =
      body.includes("stated priorities") ||
      body.includes("stated priority") ||
      body.includes("the user's stated") ||
      body.includes("weighted by") ||
      (body.includes("priorities") && body.includes("stated")) ||
      (body.includes("priority") && body.includes("weight")) ||
      body.includes("hard-no") ||
      body.includes("hard no") ||
      body.includes("hard-rule") ||
      body.includes("hard rule");
    expect(namesRubric).toBe(true);
    expect(tiesToStatedPriorities).toBe(true);
  });

  it("requires domain-relevant rationale (always the 'why') with every recommendation", () => {
    // UX principle / SC4 headline: the "why" IS the product. Every recommendation
    // carries domain-relevant rationale tied to the rubric — not a bare list. The
    // body must mandate the rationale / "why" with the recommendation.
    const body = expertShoppingBodyLower();
    const requiresWhy =
      body.includes("rationale") ||
      body.includes('"why"') ||
      body.includes("the why") ||
      body.includes("explain why") ||
      body.includes("why it") ||
      body.includes("why this") ||
      (body.includes("recommend") && body.includes("because")) ||
      (body.includes("recommendation") && body.includes("reason"));
    expect(requiresWhy).toBe(true);
  });

  it("preserves sil_search's best-first order — present results best-first, never re-rank", () => {
    // AC (compare criterion) + catalog_tools_reference: sil_search returns
    // best-first; the expert presents in order and does NOT re-rank. The body must
    // name the best-first / do-not-re-rank rule, so the rubric informs the
    // recommendation's RATIONALE without re-sorting the list.
    const body = expertShoppingBodyLower();
    const namesBestFirst =
      body.includes("best-first") ||
      body.includes("best first") ||
      body.includes("best match first") ||
      body.includes("in order");
    const disavowsRerank =
      body.includes("never re-rank") ||
      body.includes("never rerank") ||
      body.includes("not re-rank") ||
      body.includes("do not re-rank") ||
      body.includes("don't re-rank") ||
      (body.includes("re-rank") && body.includes("not")) ||
      (body.includes("rerank") && body.includes("not"));
    expect(namesBestFirst).toBe(true);
    expect(disavowsRerank).toBe(true);
  });
});

describe("references/expert_shopping.md — re-fetch before buy (sil_product_get) — never commit off the stale sil_search snapshot", () => {
  it("names the re-fetch-with-sil_product_get-before-buy step", () => {
    // AC (re-fetch criterion): before any buy hand-off, re-fetch the chosen item
    // via sil_product_get for point-in-time price / availability / checkout_url.
    // The body must name sil_product_get AND tie it to the pre-buy re-fetch.
    const body = expertShoppingBodyLower();
    expect(body).toContain("sil_product_get");
    const namesRefetch =
      body.includes("re-fetch") ||
      body.includes("refetch") ||
      body.includes("re-fetches") ||
      body.includes("fetch again") ||
      (body.includes("fetch") && body.includes("before"));
    expect(namesRefetch).toBe(true);
  });

  it("forbids committing a buy off the stale sil_search snapshot", () => {
    // AC (re-fetch criterion): never commit a buy off the earlier sil_search
    // snapshot — price/availability/checkout_url are point-in-time. The body must
    // disavow buying off the stale snapshot, distinct from merely naming the
    // re-fetch step.
    const body = expertShoppingBodyLower();
    const namesStaleSnapshot =
      body.includes("stale") ||
      body.includes("point-in-time") ||
      body.includes("point in time") ||
      (body.includes("snapshot") && body.includes("never")) ||
      (body.includes("snapshot") && body.includes("not")) ||
      (body.includes("sil_search") && body.includes("snapshot"));
    expect(namesStaleSnapshot).toBe(true);
  });

  it("orders the re-fetch step BEFORE the buy hand-off (indexOf on the re-fetch verb, not §N)", () => {
    // The re-fetch must precede the buy/checkout hand-off in the prose, or an
    // agent following top-to-bottom would commit on the stale snapshot. Anchor on
    // sil_product_get (the re-fetch invocation) and the buy/checkout/purchase
    // hand-off token. Same ordering discipline as the engine's add-then-validate.
    const body = expertShoppingBodyLower();
    const refetchIdx = body.indexOf("sil_product_get");
    const buyIdx = (() => {
      for (const anchor of [
        "buy",
        "checkout",
        "purchase",
        "hand-off to purchase",
        "hand off to purchase",
      ]) {
        const i = body.indexOf(anchor);
        if (i >= 0) return i;
      }
      return -1;
    })();
    expect(refetchIdx).toBeGreaterThanOrEqual(0);
    expect(buyIdx).toBeGreaterThanOrEqual(0);
    // The re-fetch (sil_product_get) precedes the buy hand-off — buy off fresh
    // detail, never the stale sil_search snapshot.
    expect(refetchIdx).toBeLessThan(buyIdx);
  });
});

describe("references/expert_shopping.md — empty (ok + products: []) → relax-and-explain, distinct from the unservable case", () => {
  it("names the ok-empty outcome, the relax/re-frame action, and the explain-what-changed rule", () => {
    // AC (empty criterion): on status ok with products: [] the expert RELAXES or
    // re-frames the params (loosens a constraint / broadens the query) and
    // EXPLAINS what it changed and why — it does not dead-end silently. The body
    // must name the ok-empty case, the relax/re-frame action, AND the explain
    // rule — three distinct invariants.
    const body = expertShoppingBodyLower();
    const namesEmptyOk =
      body.includes("products: []") ||
      body.includes("products: [ ]") ||
      body.includes("empty result") ||
      body.includes("empty product") ||
      body.includes("nothing matched") ||
      body.includes("no matches") ||
      (body.includes("ok") && body.includes("empty"));
    const relaxes =
      body.includes("relax") ||
      body.includes("re-frame") ||
      body.includes("reframe") ||
      body.includes("loosen") ||
      body.includes("broaden");
    const explains =
      body.includes("explain") ||
      body.includes("what changed") ||
      body.includes("what it changed") ||
      body.includes("what was relaxed") ||
      body.includes("say what");
    expect(namesEmptyOk).toBe(true);
    expect(relaxes).toBe(true);
    expect(explains).toBe(true);
  });

  it("forbids the silent dead-end on empty (it never just stops)", () => {
    // The empty-result silent dead-end is the named failure mode. The body must
    // disavow stopping silently on an empty match — distinct from relaxing.
    const body = expertShoppingBodyLower();
    const forbidsDeadEnd =
      body.includes("dead-end") ||
      body.includes("dead end") ||
      body.includes("never just stop") ||
      body.includes("not just stop") ||
      body.includes("does not dead-end") ||
      body.includes("not stop silently") ||
      body.includes("never stop silently") ||
      (body.includes("silently") && body.includes("not")) ||
      (body.includes("silent") && body.includes("never"));
    expect(forbidsDeadEnd).toBe(true);
  });
});

describe("references/expert_shopping.md — unservable domain → honest 'no', never junk (distinct from empty)", () => {
  it("names the honest-'no' for a domain the catalog cannot serve, distinct from the empty-but-servable case", () => {
    // AC (unservable criterion): for a domain the catalog GENUINELY cannot serve
    // (not shippable / age-gated / out of scope) the expert says so HONESTLY — a
    // different outcome from the empty-but-servable relax case. The body must name
    // the unservable case (its triggers) AND that the answer is an honest "no".
    const body = expertShoppingBodyLower();
    const namesUnservable =
      body.includes("cannot serve") ||
      body.includes("can't serve") ||
      body.includes("unservable") ||
      body.includes("not shippable") ||
      body.includes("non-shippable") ||
      body.includes("age-gated") ||
      body.includes("age gated") ||
      body.includes("out of scope") ||
      body.includes("out-of-scope");
    const namesHonestNo =
      body.includes("honest") ||
      body.includes('say "no"') ||
      body.includes("say so") ||
      body.includes("says so") ||
      body.includes("plainly") ||
      body.includes('an honest "no"') ||
      (body.includes("honest") && body.includes("no"));
    expect(namesUnservable).toBe(true);
    expect(namesHonestNo).toBe(true);
  });

  it("forbids fabricating / padding with junk to avoid saying 'no'", () => {
    // UX principle "never return junk": the expert never pads with irrelevant or
    // unbuyable options to avoid saying "no". The body must disavow the
    // fabricate/pad-with-junk behaviour — distinct from the relax-and-explain path.
    const body = expertShoppingBodyLower();
    const forbidsJunk =
      body.includes("never fabricate") ||
      body.includes("not fabricate") ||
      body.includes("do not fabricate") ||
      body.includes("never pad") ||
      body.includes("not pad") ||
      body.includes("never junk") ||
      body.includes("never return junk") ||
      body.includes("not return junk") ||
      body.includes("irrelevant") ||
      body.includes("unbuyable") ||
      (body.includes("junk") && body.includes("never")) ||
      (body.includes("junk") && body.includes("not"));
    expect(forbidsJunk).toBe(true);
  });
});

describe("references/expert_shopping.md — non-ok status → follow the tool's own recovery, never improvise (and a non-ok is NOT an empty match)", () => {
  it("names the follow-the-tool's-own-recovery / never-improvise rule on a non-ok status", () => {
    // AC (non-ok criterion): on a sil_search/sil_product_get non-ok status the
    // expert follows the tool's OWN recovery hint and never improvises a different
    // one. Same shape as catalog_tools_reference's recovery rule, but the loop
    // must REFERENCE it. The body must name the recovery hint AND the
    // never-improvise rule.
    const body = expertShoppingBodyLower();
    expect(body).toContain("recovery");
    const neverImprovise =
      body.includes("never improvise") ||
      body.includes("not improvise") ||
      body.includes("do not improvise") ||
      body.includes("don't improvise") ||
      body.includes("never a different") ||
      body.includes("follow the tool") ||
      body.includes("follow the recovery") ||
      (body.includes("recovery") && body.includes("never"));
    expect(neverImprovise).toBe(true);
  });

  it("states a non-ok status is NOT an empty match (no pointless param-relaxing on a retryable / auth failure)", () => {
    // The mis-attribution failure mode: a retryable (transient/source down) or an
    // auth status must NOT be treated like an empty match — relaxing params on a
    // retryable is wrong recovery. The body must distinguish a non-ok status from
    // an ok-empty result, so the expert retries / re-auths instead of relaxing.
    const body = expertShoppingBodyLower();
    const distinguishesNonOkFromEmpty =
      body.includes("not an empty match") ||
      body.includes("not the same as empty") ||
      body.includes("not an empty result") ||
      body.includes("not treat") ||
      body.includes("do not treat") ||
      body.includes("never treat") ||
      body.includes("not mistake") ||
      body.includes("don't mistake") ||
      body.includes("not the same as a non-ok") ||
      (body.includes("retryable") && body.includes("not")) ||
      (body.includes("transient") &&
        (body.includes("not") || body.includes("never")));
    expect(distinguishesNonOkFromEmpty).toBe(true);
  });

  it("DELEGATES the status taxonomy to catalog_tools_reference.md — does NOT re-carry the taxonomy tokens that belong only to it", () => {
    // The references-not-restates invariant (architect risk): the loop must LINK
    // catalog_tools_reference.md for the status taxonomy, NOT copy it. Anchor on
    // tokens that belong ONLY to the moved taxonomy detail — the register
    // browser-handshake status and the catalog status vocabulary that the
    // router-leanness test (skill-content.test.ts:350-365) already pins as ABSENT
    // from the lean SKILL.md. Apply the same discipline to the new reference: it
    // must NOT re-carry those taxonomy tokens.
    const body = expertShoppingBodyLower();
    // It must POINT AT the taxonomy's owner.
    expect(body).toContain("catalog_tools_reference.md");
    // And it must NOT re-list the taxonomy that belongs only there. These tokens
    // are unique to catalog_tools_reference.md's per-tool detail + status table;
    // the loop references the outcomes by behaviour (empty / non-ok / recovery),
    // never by re-carrying the vocabulary.
    expect(body).not.toContain("awaiting_browser");
    expect(body).not.toContain("not_registered");
    expect(body).not.toContain("must_reregister");
  });
});

describe("skill bundle — the expert-shopping path is ADDITIVE: the generic profile-less flow does NOT regress", () => {
  it("keeps the lean router's four-core-tools-in-the-router invariant intact (no regression from the additive pointer)", () => {
    // Integration AC: the generic, profile-less shopping flow must keep working —
    // the four core tools stay named in the lean router, and the new
    // expert-shopping pointer is ADDITIVE, not a replacement. This re-asserts the
    // router-leanness invariant survives the additive change (the existing
    // four-core-tools-in-the-router test at :200-213 is the canonical guard; this
    // pins it together with the bundle's source-of-truth for the new reference).
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    for (const tool of [
      "sil_register",
      "sil_whoami",
      "sil_search",
      "sil_product_get",
    ]) {
      expect(body).toContain(tool);
    }
  });

  it("the new reference stays a SHOP-TIME reference — no contributor 'adding a tool' prose leaked in", () => {
    // The bundle-wide no-contributor-prose invariant (skill-content.test.ts
    // :555-579) applies to the new reference too: a runtime shopping reference
    // never carries registerXTools / contracts.tools / "adding a tool" plumbing.
    const body = expertShoppingBodyLower();
    expect(body).not.toContain("registerxtools");
    expect(body).not.toContain("contracts.tools");
    expect(body).not.toContain("adding a real tool");
    expect(body).not.toContain("adding a tool");
  });
});
