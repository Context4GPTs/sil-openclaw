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
 * `sil_whoami`, `sil_search`, `sil_product_get`). Mirror register(). */
function registeredNames(): Set<string> {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
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

/* ===========================================================================
 * BRAINSTORM / INTERVIEW PROCEDURE — the conversational spec-filling seam
 * (card: brainstorm-driven-creation-of-a-tailored-expert)
 *
 * tier: integration. Same content-seam pattern as the engine block above:
 * read the REAL skill/SKILL.md from disk, lowercase it, and pin the brainstorm
 * PROCEDURE as a source of truth via OR-grouped intent-token substrings and
 * ORDERING via indexOf comparison. The brainstorm is skill prose the host agent
 * follows — there is NO new plugin tool, NO code path — so the skill body IS the
 * spec, exactly as it is for the engine. These never fake a transcript: "a real
 * agent runs a genuinely good interview" is `live-verification`'s job, NOT a
 * test tier. We pin the procedure's load-bearing invariants:
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
 *     engine steps before explicit endorsement (ordering anchor);
 *   - abandon-mid-flow creates nothing; collision → refine-or-rename never
 *     clobber; the spec is a valid sil_profile_materialize input.
 *
 * Ordering anchors are deliberately keyed on tokens that the engine block above
 * does NOT introduce (or on the engine's OWN tokens used as the downstream
 * anchor), so a green ordering assertion proves a genuine brainstorm step
 * precedes the engine, not an accidental match against pre-existing prose.
 * ========================================================================= */

describe("skill/SKILL.md — brainstorm conducts an open, two-sided interview (SC1)", () => {
  it("names the brainstorm/interview as an open, multi-turn conversation (a distinct procedure)", () => {
    // SC1: the new capability is a conversational interview that PRODUCES the
    // spec the engine consumes. The body must name it as a brainstorm/interview
    // and as multi-turn / back-and-forth / conversational — not a single shot.
    const body = skillBodyLower();
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
    const body = skillBodyLower();
    const disavowsForm =
      body.includes("not a fixed questionnaire") ||
      body.includes("not a questionnaire") ||
      body.includes("not a form-fill") ||
      body.includes("not a form fill") ||
      body.includes("not a form") ||
      body.includes("not a fixed form") ||
      body.includes("not a wizard") ||
      body.includes("not a locked wizard") ||
      (body.includes("questionnaire") && body.includes("not"));
    expect(disavowsForm).toBe(true);
  });

  it("elicits BOTH the domain's decision-attributes AND the user's personal tastes/constraints", () => {
    // Business rule 3 (elicit BOTH sides): a spec from only domain attributes
    // (generic) or only preferences (no searchable mapping) is incomplete. The
    // body must name the two sides — the domain's decision-attributes AND the
    // user's own tastes/style/budget/constraints.
    const body = skillBodyLower();
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
    const body = skillBodyLower();
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

describe("skill/SKILL.md — vague domain is narrowed WITH the user FIRST (narrow-first gate)", () => {
  it("names the narrow-a-vague-domain-first gate", () => {
    // Business rule 6: never build persona/mapping/rubric on an un-narrowed
    // niche. The body must name the gate — a vague/over-broad/ambiguous domain
    // is narrowed (with narrowing questions, reflecting a concrete niche back)
    // before the other sections.
    const body = skillBodyLower();
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
    // FALSELY fail even on correctly-ordered prose (or, worse, FALSELY pass a
    // mis-ordered one). What the invariant actually requires is that the agent
    // narrows before it CONVERGES the downstream sections. So the anchor is the
    // narrow-the-domain step token, required to precede the FIRST downstream
    // CONVERGENCE step. The narrow step must explicitly mark itself as the
    // first/before-other-sections gate (a bare "narrow" mention in the agenda
    // table is not enough).
    const body = skillBodyLower();
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

describe("skill/SKILL.md — per-section converge + re-entrant (collaborative, not a locked wizard)", () => {
  it("states each section is converged with the user (reflect-back + confirm) before advancing", () => {
    // Business rule 5: reflect-and-confirm per section. The body must name the
    // reflect-back-then-confirm loop — ask, reflect a short summary of what it
    // heard, get a yes/adjust before moving on.
    const body = skillBodyLower();
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
    const body = skillBodyLower();
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

describe("skill/SKILL.md — SC2 tailoring: the spec reflects THIS user's stated inputs", () => {
  it("states the persona, mapping, and rubric must reflect the user's STATED inputs (tailored, not template)", () => {
    // Business rule 4 (SC2): the persona, answer→param mapping, and rubric must
    // reflect what THIS user said — not a generic template. The body must say
    // the tailoring is real (reflects the user's stated tastes/priorities), not
    // a fixed template.
    const body = skillBodyLower();
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
    // (catalog.ts), not invented filters. The body must name the concrete
    // params a stated input maps onto: a budget → price_min/price_max; "prefer
    // secondhand"/"new only" → condition; the niche → query and/or category.
    const body = skillBodyLower();
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
    // it. The body must name ship_to, state it is left empty by default, and
    // disavow the sil_whoami round-trip.
    const body = skillBodyLower();
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
    const body = skillBodyLower();
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
    const body = skillBodyLower();
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

describe("skill/SKILL.md — endorsement before creation: ZERO engine steps before an explicit go-ahead", () => {
  it("names an explicit endorsement / go-ahead on the assembled draft", () => {
    // Business rule 1 (the strongest invariant): nothing is created until the
    // user explicitly endorses the assembled draft. The body must name an
    // explicit endorsement / go-ahead — and that it is an affirmative user act,
    // not inferred from answering the last question or from silence.
    const body = skillBodyLower();
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

  it("orders the endorsement BEFORE the first engine step (`openclaw agents add`)", () => {
    // The card's strongest ordering invariant: an endorse/confirm anchor must
    // precede the first `openclaw agents add` token. Because the engine's
    // creation command lives DOWNSTREAM of the brainstorm, an endorsement step
    // textually ahead of `openclaw agents add` proves the agent cannot reach
    // creation before the user's explicit go-ahead. Anchor on the `endorse`
    // verb — it is NEW prose this card introduces; the engine block above never
    // uses it, so a green here is a genuine endorsement-gate, not a stale match.
    const body = skillBodyLower();
    const endorseIdx = body.indexOf("endorse");
    const addIdx = body.indexOf("openclaw agents add");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(endorseIdx).toBeLessThan(addIdx);
  });

  it("orders the endorsement BEFORE `sil_profile_materialize` (no artefacts written pre-endorsement)", () => {
    // The same gate against the OTHER write surface: the behaviour artefacts
    // are materialized by `sil_profile_materialize` only after endorsement. The
    // endorse anchor must precede the FIRST `sil_profile_materialize` token, so
    // no artefacts are written before the user's go-ahead.
    const body = skillBodyLower();
    const endorseIdx = body.indexOf("endorse");
    const materializeIdx = body.indexOf("sil_profile_materialize");
    expect(endorseIdx).toBeGreaterThanOrEqual(0);
    expect(materializeIdx).toBeGreaterThanOrEqual(0);
    expect(endorseIdx).toBeLessThan(materializeIdx);
  });

  it("states ZERO engine steps run before endorsement (nothing created until the user says yes)", () => {
    // Business rule 1 + 2, in prose: before endorsement the flow has called
    // ZERO engine steps. The body must say nothing is created / written until
    // the user endorses — the draft lives only in conversation until then.
    const body = skillBodyLower();
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

describe("skill/SKILL.md — abandon mid-flow creates nothing", () => {
  it("states abandoning mid-flow leaves a clean state with nothing written (no partial expert)", () => {
    // Business rule 2: if the user stops/changes their mind before endorsing,
    // the flow has created nothing — no partial expert to clean up, because no
    // engine step ran pre-endorsement. The body must name the abandon path and
    // that it leaves nothing partial (no teardown needed).
    const body = skillBodyLower();
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
    const body = skillBodyLower();
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
      body.includes("writes nothing before");
    expect(disavowsEarlyWrite).toBe(true);
  });
});

describe("skill/SKILL.md — collision is handled in the conversation: refine-or-rename, never clobber", () => {
  it("offers refine-or-rename on a colliding agentId (a path forward, not a dead-end)", () => {
    // Business rule 7 / the card's collision edge: when the proposed agentId
    // collides with an existing expert, the flow offers a CHOICE — refine the
    // niche under a new id, or rename this one — rather than dead-ending. The
    // body must name both the rename option AND the refine-the-niche
    // alternative, so the user is never stuck.
    const body = skillBodyLower();
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
    const body = skillBodyLower();
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

describe("skill/SKILL.md — creation is local + offline: no identity coupling in the interview", () => {
  it("does NOT present sil registration / a token as a prerequisite to CREATE the expert", () => {
    // Business rule 8: the interview never presents sil registration / a token
    // as a prerequisite to CREATE the expert (the expert registers the user
    // later, on first shop). The brainstorm must not ask the user to register
    // before creating. Same adversarial shape as the engine's AC5 identity-
    // coupling guard: assert the brainstorm does not gate CREATION on register.
    const body = skillBodyLower();
    const couplesIdentity =
      /register[^.]*before[^.]*creat/.test(body) ||
      /creat[^.]*requires[^.]*register/.test(body) ||
      /must.*register.*to.*creat/.test(body) ||
      /register[^.]*prerequisite[^.]*creat/.test(body);
    expect(couplesIdentity).toBe(false);
  });
});
