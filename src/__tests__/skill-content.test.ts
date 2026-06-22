/**
 * INTEGRATION — skill discoverability (tier: integration — reads the
 * real skill/SKILL.md from disk and compares its body against the set
 * of registered tool names; two artifacts interacting, the
 * skill-doc ↔ registration seam).
 *
 * Named `skill-content.test.ts` to mirror the reference adapter's file
 * of the same name. Covers the card's "Skill is discoverable" criteria:
 *   - skill/SKILL.md exists, its YAML frontmatter PARSES, and exposes a
 *     non-empty `name` and `description`;
 *   - the skill body names EVERY real tool the plugin registers
 *     (`sil_register`, `sil_whoami`, `sil_search`, `sil_product_get`), so
 *     the agent's session-start tool check has a source of truth.
 *
 * Frontmatter is parsed with a small self-contained extractor (no
 * gray-matter dependency assumed — the skeleton's dep set is minimal)
 * that still REJECTS a malformed frontmatter block: a missing closing
 * fence, an empty block, or absent keys all fail. Adversarial intent:
 * "frontmatter parses" must mean structurally valid, not merely present.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   skill/SKILL.md has a valid `--- ... ---` YAML frontmatter block at
 *   the top with non-empty `name:` and `description:` scalars, and a
 *   body that mentions each registered sil_* tool by name.
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
const SKILL_PATH = join(REPO_ROOT, "skill", "SKILL.md");

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

/** The set of names the real register code emits against a mock api. Must
 * call EVERY tool group that src/index.ts#register() wires, so the skill
 * body is checked against the REAL tool surface (`sil_register`,
 * `sil_whoami`, `sil_search`, `sil_product_get`, and the `sil_profile_*`
 * family). Mirror register() — registerProfileTools is now wired in too, so
 * the body-mentions check below covers the profile tools (materialize +
 * list/get/remove), not just identity + catalog. */
function registeredNames(): Set<string> {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerProfileTools(api);
  return registeredToolNames(api);
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

describe("skill/SKILL.md — body is a source of truth for the tool surface", () => {
  it("names EVERY registered real tool in its body", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const names = registeredNames();
    expect(names.size).toBeGreaterThan(0); // sanity: there ARE tools
    const missing = [...names].filter((name) => !body.includes(name));
    expect(missing).toEqual([]);
  });

  it("names no removed example tool (sil_ping / sil_echo) in its body", () => {
    // The card's contributor-mental-model goal: the skill no longer
    // presents the deleted stubs as a real, callable tool surface.
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    expect(body).not.toContain("sil_ping");
    expect(body).not.toContain("sil_echo");
  });
});

/* ===========================================================================
 * MANAGE LOCAL EXPERTS — list / view / remove
 * (card: list-view-and-remove-local-expert-agents)
 *
 * tier: integration. The three management intents are conversational prose in
 * skill/SKILL.md driving the three new plugin tools (+ the host CLI for the
 * wiring half of remove). The skill body IS the source of truth the host agent
 * follows, so — exactly as the create-engine block above pins its procedure —
 * we pin that the management section names each new tool and spells out the
 * load-bearing invariants (host-CLI-FIRST remove ordering, confirm-before-
 * remove, graceful not_found framing).
 *
 * Cross-card note: PR #28 (open, unmerged) also edits this file and renumbers
 * the engine section. These assertions anchor on tool NAMES and content tokens,
 * NEVER on `§N` section numbers, so they survive that renumber.
 * ========================================================================= */

describe("skill/SKILL.md — names the three management tools by name (list/view/remove)", () => {
  it("names sil_profile_list, sil_profile_get, and sil_profile_remove in the body", () => {
    const body = skillBody(readFileSync(SKILL_PATH, "utf8"));
    const missing = [
      "sil_profile_list",
      "sil_profile_get",
      "sil_profile_remove",
    ].filter((name) => !body.includes(name));
    // Report by name so a forgotten tool is named, not an opaque false.
    expect(missing).toEqual([]);
  });
});

describe("skill/SKILL.md — manage-experts procedure spells out the load-bearing invariants", () => {
  it("frames a distinct manage/list/view/remove capability (not just the create engine)", () => {
    // Adversarial: the create-engine section already names experts. This card
    // adds MANAGEMENT — the body must name listing/viewing/removing experts, so
    // the new section is a real addition, not a re-read of the create prose.
    const body = skillBodyLower();
    const namesList = body.includes("list");
    const namesView = body.includes("view") || body.includes("show");
    const namesRemove = body.includes("remove") || body.includes("delete");
    expect(namesList && namesView && namesRemove).toBe(true);
  });

  it("orders the remove flow host-CLI FIRST: `openclaw agents remove` precedes the procedural `sil_profile_remove` call", () => {
    // The architect's partial-failure decision (card §110/§197): the skill runs
    // the HOST wiring removal (`openclaw agents remove <id>`) BEFORE the sil
    // artefact removal (`sil_profile_remove { agentId }`). Order in the prose IS
    // the spec — artefacts-first then a failed host step leaves a broken-but-
    // loading expert; host-first leaves only harmless, list-surfaced disk cruft.
    //
    // Adversarial precision on the anchor: `sil_profile_remove` is also named
    // earlier in the intent→tool TABLE and the tool DESCRIPTION (before the
    // numbered procedure). A naive first-occurrence `indexOf("sil_profile_remove")`
    // would catch those reference mentions and FALSELY fail even on a correctly
    // ordered procedure. Anchor the artefact step on its procedural CALL FORM
    // (`sil_profile_remove { agentId }` — the invocation with its param), which
    // appears only in the numbered remove procedure, so the ordering check pins
    // the real step sequence, not an incidental earlier reference.
    const body = skillBodyLower();
    const hostRemoveIdx = body.indexOf("openclaw agents remove");
    // The call-form prefix `sil_profile_remove {` marks the invocation (with its
    // arg object) — present only in the numbered procedure, not the reference
    // mentions. Resilient to whitespace inside the braces.
    const artefactCallIdx = body.indexOf("sil_profile_remove {");
    expect(hostRemoveIdx).toBeGreaterThanOrEqual(0);
    expect(artefactCallIdx).toBeGreaterThanOrEqual(0);
    expect(hostRemoveIdx).toBeLessThan(artefactCallIdx);
  });

  it("requires confirming with the user BEFORE a destructive remove", () => {
    // Product rule 7 / UX: remove is destructive + irreversible, so the skill
    // confirms before acting. The body must say so (confirm/confirmation before
    // removing/deleting), so the agent does not silently delete.
    const body = skillBodyLower();
    const confirms =
      body.includes("confirm") ||
      body.includes("confirmation") ||
      body.includes("explicit go-ahead") ||
      body.includes("ask before");
    expect(confirms).toBe(true);
  });

  it("names `not_found` graceful framing for an unknown expert (view & remove)", () => {
    // Product rule 4 / UX principle: referencing an unknown expert fails
    // gracefully — a plain not_found, ideally listing the experts that DO exist,
    // never a stack trace or raw path. The body must name the not_found outcome.
    expect(skillBodyLower()).toContain("not_found");
  });

  it("names `invalid_request` for a malformed/traversal expert id", () => {
    // The fail-closed id-validation outcome the management tools surface — the
    // body must name it so the agent recognizes a bad-id rejection (deletes
    // nothing) versus an unknown expert (not_found).
    expect(skillBodyLower()).toContain("invalid_request");
  });

  it("keeps the artefact-store source-of-truth framing (list reads profile.json, not the host list)", () => {
    // Product rule 5: a sil expert IS a readable agents/<id>/profile.json — list
    // reads the manifest, not the host agent list. The body must name the
    // artefact store / profile.json as the listing source, so a bare host agent
    // is not mistaken for a sil expert.
    const body = skillBodyLower();
    const namesArtefactSource =
      body.includes("profile.json") ||
      body.includes("artefact store") ||
      body.includes("sil_data_dir") ||
      body.includes("sil data dir");
    expect(namesArtefactSource).toBe(true);
  });
});

/* ===========================================================================
 * AGENT-CREATION ENGINE — the procedure-as-source-of-truth seam
 * (card: create-a-valid-sil-wired-openclaw-agent-profile)
 *
 * tier: integration. These read the REAL skill/SKILL.md from disk and pin
 * the agent-creation procedure as a source of truth — the engine is the
 * skill prose driving the host CLI (no plugin-tool code per the architect's
 * verdict), so the skill body IS the spec the host agent follows. Pinning it
 * is exactly how `skill-content.test.ts` already pins the tool surface.
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
 * No host, no network, no Docker: this is a content seam over the skill file.
 * The real host round (create → validate → shop, SC3) is `live-verification`'s
 * job, NOT a test-tier assertion — these never fake a running host.
 * ========================================================================= */

/** Lower-cased skill body — substring checks are intent ("the procedure names
 * X"), so case folding avoids a brittle fail on an incidental capitalization
 * while keeping the exact-token literals (CLI names, status words) honest. */
function skillBodyLower(): string {
  return skillBody(readFileSync(SKILL_PATH, "utf8")).toLowerCase();
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

describe("skill/SKILL.md — agent-creation procedure is a pinned source of truth (AC1)", () => {
  it("names the host-native agent-creation CLI `openclaw agents add`", () => {
    // The persistence path is host-CLI-driven (the plugin may NOT write host
    // config — noChildProcess + filesystemScope). The procedure must name the
    // host's OWN creation command, not a plugin tool or hand-authored JSON.
    expect(skillBodyLower()).toContain("openclaw agents add");
  });

  it("names the host `agents` config surface the profile lands in", () => {
    // Product invariant 1/6: a real host `agents` entry in the user's local
    // OpenClaw config — not a bespoke sil data file. The body must name the
    // surface so the agent knows WHERE the profile lives.
    expect(skillBodyLower()).toContain("agents");
  });

  it("names ALL FOUR engine outcome statuses (created/invalid_request/collision/persistence_failed)", () => {
    const body = skillBodyLower();
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
    const body = skillBodyLower();
    const namesCreation =
      body.includes("create") || body.includes("creation");
    const namesSubject =
      body.includes("expert") ||
      body.includes("agent profile") ||
      body.includes("shopping expert");
    expect(namesCreation && namesSubject).toBe(true);
  });
});

describe("skill/SKILL.md — validate-first: a bad spec writes NOTHING (AC2)", () => {
  it("names the `invalid_request` outcome for an invalid/incomplete spec", () => {
    expect(skillBodyLower()).toContain("invalid_request");
  });

  it("specifies validating the spec BEFORE invoking `openclaw agents add` (validate-first ordering)", () => {
    // Product invariant 7 (atomic outcome) + AC2: on a bad spec the engine
    // stops at validation and `openclaw agents add` is never reached. The
    // procedure must put a spec-validation step textually AHEAD of the add
    // step, so an agent following top-to-bottom validates first. Order in the
    // prose IS the spec — a procedure that adds-then-validates clobbers on a
    // bad spec.
    //
    // Adversarial precision: key the "before" anchor on the `validate` VERB,
    // NOT on `invalid_request`. The pre-existing status taxonomy already
    // contains `invalid_request` ABOVE where the new procedure lands, so an
    // `/validate|invalid_request/` anchor would pass FALSELY the moment the
    // developer adds `openclaw agents add` after that old mention — even with
    // NO real validate-first step. The old body has no `validate` verb at all,
    // so requiring `validate` before `add` only goes green on a genuine
    // spec-validation step preceding the creation call.
    const body = skillBodyLower();
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
    const body = skillBodyLower();
    expect(body).toContain("persona");
    // The name must be required AND unique (the collision precondition).
    expect(body).toMatch(/name/);
  });

  it("states that nothing is written / no profile is created on an invalid spec", () => {
    // The atomic-outcome invariant, in prose: on `invalid_request` the engine
    // writes NOTHING. The body must say so, so the agent does not half-create.
    const body = skillBodyLower();
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

describe("skill/SKILL.md — collision is non-destructive (AC3)", () => {
  it("names the collision check via `openclaw agents list` (read before write)", () => {
    // AC3: the engine checks existing agents with the host's OWN list command
    // before adding, so a same-name agent is detected, not overwritten.
    expect(skillBodyLower()).toContain("openclaw agents list");
  });

  it("names the `collision` outcome and that it does NOT clobber an existing agent", () => {
    const body = skillBodyLower();
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
    const body = skillBodyLower();
    const listIdx = body.indexOf("openclaw agents list");
    const addIdx = body.indexOf("openclaw agents add");
    expect(listIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(listIdx).toBeLessThan(addIdx);
  });
});

describe("skill/SKILL.md — valid spec persists a host-loadable, sil-wired agent (AC4)", () => {
  it("invokes `openclaw agents add` non-interactively with JSON output", () => {
    // AC4: `openclaw agents add … --non-interactive --json` — the exact
    // machine-drivable form (an interactive prompt cannot be agent-driven).
    const body = skillBodyLower();
    expect(body).toContain("--non-interactive");
    expect(body).toContain("--json");
  });

  it("gates 'created' on the host's OWN validation via `openclaw config validate`", () => {
    // Product invariant 1 + AC4: "valid" means the HOST says yes, verified the
    // way the host validates — `openclaw config validate` (or load probe). The
    // body must name it, so success ≠ "the plugin thinks it's fine".
    expect(skillBodyLower()).toContain("openclaw config validate");
  });

  it("orders config-validate AFTER add (validate the written profile, then declare created)", () => {
    // The defect this card exists to prevent: emitting a profile the host then
    // rejects. The procedure must validate AFTER the add and only then report
    // `created` — so the validate step sits between `add` and `created`.
    const body = skillBodyLower();
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
    const body = skillBodyLower();
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
    const body = skillBodyLower();
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
    const body = skillBodyLower();
    expect(body).toContain("persistence_failed");
    const namesPathCause =
      body.includes("path") && body.includes("cause");
    expect(namesPathCause).toBe(true);
  });
});

describe("skill/SKILL.md — the created agent shops with no further setup (AC5 / SC3)", () => {
  it("states the created agent can call sil_search / sil_product_get with no further setup", () => {
    // AC5 / SC3 (the goal's primary correctness bar): after creation the agent
    // shops immediately. The body must name the catalog tools the created
    // expert calls AND the "no further setup" guarantee — the zero-setup
    // promise is the whole product (UX principle 1). The HOST round is
    // live-verified; here we pin that the skill PROMISES it.
    const body = skillBodyLower();
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
    // The skill DOES mention sil_register elsewhere (the tool table), so we
    // can't assert its absence globally — instead assert the creation procedure
    // does not present registration as a prerequisite *for creation*.
    const body = skillBodyLower();
    const couplesIdentity =
      /register[^.]*before[^.]*creat/.test(body) ||
      /creat[^.]*requires[^.]*register/.test(body) ||
      /must.*register.*to.*creat/.test(body);
    expect(couplesIdentity).toBe(false);
  });
});

describe("skill/SKILL.md — behaviour artefacts materialized into $SIL_DATA_DIR (founder steer)", () => {
  it("names $SIL_DATA_DIR as where the behaviour artefacts are materialized", () => {
    // Founder steer 2026-06-22: the engine materializes FIXED behaviour
    // artefacts into the sil data directory ($SIL_DATA_DIR — the plugin's
    // disclosed filesystemScope) at creation time. The body must name the
    // data dir as the artefact store, distinct from the host `agents` wiring.
    const body = skillBodyLower();
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
    expect(skillBodyLower()).toContain("persona");
  });

  it("names the generated domain sub-skill as a behaviour artefact", () => {
    // The second artefact the card names: a generated domain sub-skill (e.g. a
    // gift-shopping playbook). The body must name the sub-skill as part of the
    // materialized behaviour layer.
    const body = skillBodyLower();
    expect(body).toContain("sub-skill");
  });

  it("keeps the store boundary clean: host config = wiring, $SIL_DATA_DIR = behaviour", () => {
    // Founder steer: store boundary stays clean — host `agents` config holds
    // the WIRING (plugin enabled + skill attached), $SIL_DATA_DIR holds the
    // BEHAVIOUR artefacts. The host config write stays host-CLI-driven; the
    // artefact write is the in-scope sil-owned write. The body must reflect
    // both surfaces — wiring via the CLI, behaviour via the data dir — so the
    // two-store boundary is explicit in the prose.
    const body = skillBodyLower();
    const namesDataDir =
      body.includes("sil_data_dir") || body.includes("sil data dir");
    const namesHostConfig =
      body.includes("openclaw agents add") ||
      body.includes("openclaw config validate");
    expect(namesDataDir && namesHostConfig).toBe(true);
  });
});
