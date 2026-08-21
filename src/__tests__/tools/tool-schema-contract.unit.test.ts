/**
 * UNIT — agent-facing tool-schema contract is invariant across the
 * TypeBox 0.34 → 1.x migration (tier: unit, <100ms, no I/O, mock api).
 *
 * Card: migrate-openclaw-tool-schemas-to-typebox-1-x. The migration is a
 * dependency-major swap ONLY — the JSON-schema object each tool publishes
 * in `parameters` (the value the OpenClaw host serializes and presents to
 * agents) must be equivalent before and after. This file pins that
 * equivalence OBSERVATIONALLY against the known-good literals captured in
 * the card's Risks section, so an unexpected emission drift fails the
 * build rather than silently reaching an agent.
 *
 * Scope: the identity surface (`sil_register`, `sil_whoami`) — both
 * no-argument tools whose `parameters` is `Type.Object({})`. The catalog
 * tools' schemas (`sil_search`, `sil_product_get`) carry structure and are
 * independently owned by `search.test.ts` / `product-get.test.ts`; they are
 * deliberately NOT re-asserted here. This file deep-equals the WHOLE schema
 * (order-insensitive) so the empty-object shape cannot silently grow a
 * spurious `required` or property during the dependency bump.
 *
 * CONTRACT NOTE (architect Risk — load-bearing for these assertions):
 * TypeBox 1.x reorders JSON-schema keys vs 0.34 (e.g. `required` before
 * `properties`, nested `type` before `description`). JSON-Schema objects
 * are UNORDERED key sets; the host serializes and validates by key, not
 * byte order. So every schema assertion below uses `toEqual` (deep,
 * order-insensitive) — NEVER `expect(JSON.stringify(a)).toBe(<0.34
 * byte-literal>)`, which would flip RED on a pure dependency bump even
 * though the contract is intact.
 *
 * Runs entirely against createMockPluginApi() — no host, no network, no
 * filesystem.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerIdentityTools } from "../../tools/identity.js";
import { registerCatalogTools } from "../../tools/catalog.js";
import { registerProfileTools } from "../../tools/profile.js";
import { registerDoctorTools } from "../../tools/doctor.js";
import {
  createMockPluginApi,
  getTool,
  registeredToolNames,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";
import { perNicheExpertOffenders } from "../helpers/per-niche-expert.js";
import {
  honestyExclusionOffenders,
  overPromiseOffenders,
  overTriggerOffenders,
  retiredV0Offenders,
  RETIRED_V0_TOKENS,
} from "../helpers/honesty-vocabulary.js";

/**
 * The agent-facing tool contract for the identity surface, captured from
 * the live 0.34.14 emission (transcribed verbatim from the card's Risks
 * section). The migration must keep each tool's `parameters` JSON-schema
 * deep-equal to the value here. `name` / `label` / `description` are plain
 * string literals (TypeBox-independent) and must not be incidentally
 * edited during the import swap.
 *
 * Both identity tools publish the same `Type.Object({})` empty schema — the
 * shape most likely to silently grow a spurious `required` under a key
 * reorder, which is exactly what the deep-equal below pins.
 */
const EMPTY_OBJECT_SCHEMA = { type: "object", properties: {} } as const;

/** Every identity tool the plugin registers, with the agent-visible
 * contract each must honour after the migration. The set is itself part of
 * the contract: exactly these two, no additions / removals / renames. */
const TOOL_CONTRACT = {
  sil_register: {
    label: "Register on sil",
    description:
      "Start browser-based registration on sil. Returns an auth URL for the"
      + " user to open in a browser. The plugin polls the session in the"
      + " background until registration completes (then it stores credentials"
      + " locally), the link expires, or the attempt times out. Call this tool"
      + " again afterwards to confirm registration completed.",
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  sil_whoami: {
    label: "Who am I on sil",
    description:
      "Return the registered user's identity (name and addresses) from sil,"
      + " using the credentials stored by sil_register. If the stored session token"
      + " has expired it is refreshed transparently and the read is retried. If you"
      + " are not registered, or the session has fully expired, the result names"
      + " the recovery action (run sil_register).",
    parameters: EMPTY_OBJECT_SCHEMA,
  },
} as const;

/** Register the identity tool group exactly as src/index.ts#register()
 * does, so the assertions run against the real registration code — not a
 * re-stated schema literal. The catalog group is intentionally NOT called:
 * this file owns only the identity surface's schema invariant. */
function registerAllTools(): MockPluginAPI {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  return api;
}

describe("identity tool-set invariant — exactly the two contracted tools", () => {
  it("registers exactly { sil_register, sil_whoami } — no additions, removals, or renames", () => {
    const names = registeredToolNames(registerAllTools());
    expect([...names].sort()).toEqual(["sil_register", "sil_whoami"]);
  });
});

describe("tool string fields are invariant across the migration (TypeBox-independent literals)", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    api = registerAllTools();
  });

  for (const [name, contract] of Object.entries(TOOL_CONTRACT)) {
    it(`${name}: name, label, and description equal their pre-migration values verbatim`, () => {
      const tool = getTool(api, name);
      expect(tool.name).toBe(name);
      expect(tool.label).toBe(contract.label);
      expect(tool.description).toBe(contract.description);
    });
  }
});

describe("parameters JSON-schema is the same shape agents see today (deep-equal, order-insensitive)", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    api = registerAllTools();
  });

  for (const name of ["sil_register", "sil_whoami"] as const) {
    it(`${name} (no-argument tool): parameters deep-equals { type: "object", properties: {} } with no \`required\``, () => {
      // The empty-object schema carries `properties: {}` present-and-empty
      // on BOTH 0.34 and 1.x (architect-verified) — and no `required` key.
      // Deep-equal pins both: the empty properties map AND the absence of
      // a spurious `required`.
      const params = getTool(api, name).parameters as unknown as Record<
        string,
        unknown
      >;
      expect(params).toEqual(EMPTY_OBJECT_SCHEMA);
      expect(params).not.toHaveProperty("required");
    });
  }
});

describe("TypeBox introspection metadata never leaks into the agent-visible schema", () => {
  // TypeBox 1.x's headline breaking change moves Kind/Optional/Readonly off
  // enumerable symbols onto NON-enumerable `~kind` / `~optional` / `~readonly`
  // properties. The host serializes `parameters` with JSON.stringify before
  // exposing it to an agent; that output must carry none of those keys. This
  // is the ONE place JSON.stringify is the right tool — it asserts key
  // ABSENCE, not byte-order equality (so it is migration-safe).
  let api: MockPluginAPI;

  beforeEach(() => {
    api = registerAllTools();
  });

  for (const name of ["sil_register", "sil_whoami"] as const) {
    it(`${name}: JSON.stringify(parameters) leaks no ~kind / ~optional / ~readonly key`, () => {
      const serialized = JSON.stringify(getTool(api, name).parameters);
      expect(serialized).not.toContain("~kind");
      expect(serialized).not.toContain("~optional");
      expect(serialized).not.toContain("~readonly");
    });
  }
});

/* ---------------------------------------------------------------------------
 * VOCABULARY — no registered tool DESCRIPTION frames the surface as a per-niche
 * expert (card: audit-tool-skill-surface-for-single-shopper-pivot).
 *
 * The single-shopper pivot shipped as targeted slices; the four catalog/identity
 * tools (`sil_register`, `sil_whoami`, `sil_search`, `sil_product_get`) were never
 * opened, so their descriptions could regress to implicit per-niche-expert framing
 * without anyone touching them — and an agent learns the model it is driving almost
 * entirely from these descriptions. This guard runs the SHARED whole-word
 * `\bexperts?\b` + 28-char retro-allowance check (`perNicheExpertOffenders`, the
 * very check the skill-prose guard uses, so the discipline can never drift) over
 * EVERY registered tool description — the four pivot-untouched tools and the five
 * profile verbs (`sil_profile_*` + `sil_remember`). Green on the current tree; a
 * future `expert` reintroduction into any description turns it RED.
 *
 * This is a VOCABULARY guard, DISTINCT from the exact-tool-SET guards (the identity
 * set assertion above, index.test.ts, manifest-contract): it pins HOW a description
 * talks about the model, never WHICH tools exist — so it deliberately asserts NO
 * tool count / name set, and adding or removing a tool never turns it RED. Reuses
 * the retro-allowance rather than a stricter matcher, so a legitimate future retro-
 * reference ("unlike the retired per-niche expert…") would not false-RED.
 * ------------------------------------------------------------------------- */

function allRegisteredTools(): MockPluginAPI {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerProfileTools(api);
  registerDoctorTools(api);
  return api;
}

describe("registered tool descriptions carry NO per-niche-expert vocabulary (whole-word `expert`, retro-allowance)", () => {
  it("every registered tool description scans clean — incl. the four pivot-untouched tools and the five profile verbs", () => {
    const tools = [...allRegisteredTools()._tools.entries()];
    // Guard against a vacuous green: descriptions must actually exist AND be
    // non-blank to be scanned. (NOT a tool count/set pin — passes for any tool set.)
    expect(tools.length).toBeGreaterThan(0);
    const emptyDescriptions: string[] = [];
    const offenders: string[] = [];
    for (const [name, tool] of tools) {
      const description = tool.description ?? "";
      if (description.trim().length === 0) emptyDescriptions.push(name);
      for (const ctx of perNicheExpertOffenders(description)) {
        offenders.push(`${name}: …${ctx}…`);
      }
    }
    expect(emptyDescriptions).toEqual([]);
    expect(offenders).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * THE v0 AGENT-FACING SURFACE — the cross-cutting scans (card: the four v0
 * tools). Everything here runs over EVERY registered tool description AND every
 * parameter description, because an agent reads both and a rule enforced on one
 * is not enforced.
 *
 * The scanners live in `helpers/honesty-vocabulary.ts`, imported by BOTH this
 * file and `skill-bundle-contract.integration.test.ts` — one module, so the
 * tool-description guard and the skill-prose guard can never drift apart. Their
 * bite (and their allowance for the sentence the product NEEDS) is proved in
 * `lib/honesty-vocabulary.test.ts`.
 * ------------------------------------------------------------------------- */

/**
 * The v0 catalog tools, by SC6's own names — verbatim, not renamed.
 *
 * FIVE, not four. SC6 says "four tools" and that wording is now literally false:
 * the design rule is 1:1 with the routes and never flags on one another, and
 * `/catalog/domains` is served by TWO verbs — `GET` reads the registry, `POST`
 * performs the one write nothing can undo. Shrinking the tool count to preserve
 * SC6's sentence would put the read behind a `mode` flag on the write, which is
 * the exact shape the rule forbids.
 *
 * This list is HAND-MAINTAINED and it drives three `it.each` guards below (the
 * no-flags rule, the retired-parameter scan, and the discipline clause). It bites
 * nothing when a tool is omitted — the registration check below is a SUBSET test —
 * so an omission here silently narrows all three rather than going RED.
 */
const V0_TOOLS = [
  "sil_search",
  "sil_product_get",
  "sil_stores",
  "sil_domain_find",
  "sil_domain_create",
] as const;

/** A tool's description plus every one of its parameter descriptions. */
function agentFacingText(api: MockPluginAPI, name: string): string {
  const tool = getTool(api, name);
  const schema = tool.parameters as unknown as Record<string, unknown>;
  const props = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const nested = JSON.stringify(schema).match(/"description"\s*:\s*"(?:[^"\\]|\\.)*"/g) ?? [];
  return [
    tool.description ?? "",
    ...Object.values(props).map((p) => (p["description"] as string | undefined) ?? ""),
    // Nested parameter descriptions (a predicate's `key`, a spec's `unit`) are
    // agent-facing too and would otherwise escape every scan below.
    ...nested.map((raw) => JSON.parse(`{${raw}}`).description as string),
  ].join("\n");
}

/** Every agent-facing string across the WHOLE registered surface. */
function wholeSurface(api: MockPluginAPI): [string, string][] {
  return [...api._tools.keys()].map((name) => [name, agentFacingText(api, name)]);
}

describe("v0 — the tools are registered under SC6's names, 1:1 with the routes", () => {
  it("all five exist, spelled exactly as the goal names them", () => {
    const names = registeredToolNames(allRegisteredTools());
    expect(V0_TOOLS.filter((t) => !names.has(t))).toEqual([]);
  });

  it("`sil_lookup` does not exist — `sil_product_get` reads /catalog/lookup", () => {
    expect([...registeredToolNames(allRegisteredTools())]).not.toContain("sil_lookup");
  });
});

describe("v0 — R6.4: never flags on one another", () => {
  /**
   * A model picks a tool BY NAME at the moment of use. A flag hides the intention
   * inside a parameter it will not read — and a flag that triggers a global
   * registry write hides it inside the one write the product cannot undo.
   */
  const FORBIDDEN_PARAM = /^(mode|action|op|operation|refresh|include_.*|create_.*|with_.*|also_.*|and_.*)$/;

  it.each(V0_TOOLS)("%s exposes no mode / action / op / include_* / refresh / create_* parameter", (name) => {
    const api = allRegisteredTools();
    const schema = getTool(api, name).parameters as unknown as Record<string, unknown>;
    const props = Object.keys((schema["properties"] ?? {}) as object);
    expect(props.filter((p) => FORBIDDEN_PARAM.test(p))).toEqual([]);
  });

  it("no v0 tool's parameters could select another's route", () => {
    // The concrete forbidden shapes: sil_search(refresh) standing in for
    // sil_product_get, sil_product_get(include_stores) for sil_stores,
    // sil_search(create_domain_if_missing) for sil_domain_create.
    const api = allRegisteredTools();
    const offenders: string[] = [];
    for (const name of V0_TOOLS) {
      const schema = getTool(api, name).parameters as unknown as Record<string, unknown>;
      const serialized = JSON.stringify(Object.keys((schema["properties"] ?? {}) as object));
      for (const other of V0_TOOLS) {
        if (other === name) continue;
        // A parameter naming ANOTHER tool's job (`stores`, `domain_create`,
        // `lookup`) is the flag this rule forbids.
        const verb = other.replace(/^sil_/, "");
        if (serialized.includes(`"${verb}"`) || serialized.includes(`"include_${verb}"`)) {
          offenders.push(`${name} → ${verb}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("v0 — the retired parameter vocabulary is STRUCTURALLY gone", () => {
  /**
   * The pre-v0 request surface, by parameter name. Guarded off the SCHEMA rather
   * than by scanning prose: `category` / `condition` / `cursor` are innocent
   * English words the v0 descriptions legitimately use ("research how the
   * category is bought"), so a text forbid would fail the card against itself.
   * The schema assertion is exact, cannot be satisfied by rewording, and is what
   * actually breaks if a pre-v0 parameter is resurrected.
   */
  const RETIRED_PARAMS = [
    "category", "categories", "condition", "cursor", "limit", "available",
    "ship_to", "price_min", "price_max", "local_merchants", "filters",
    "pagination", "ids", "ns", "on_behalf_of", "k", "top_k",
  ];

  /**
   * `specs` is retired as a SEARCH parameter (the pre-v0 `filters.specs`
   * predicate array — its v0 replacement is `predicates`) and simultaneously
   * LIVE as the mint's third field (`{ path, guide, specs }`). One name, two
   * meanings, so the blacklist is scoped rather than global — a flat forbid
   * would fail the mint against the route it mirrors. `sil_domain_create`'s
   * exact property set is pinned in `tools/domain-create.test.ts`, which is the
   * stronger guard anyway.
   */
  const RETIRED_ELSEWHERE: Record<string, string[]> = {
    sil_search: ["specs"],
    sil_product_get: ["specs"],
    sil_stores: ["specs"],
  };

  it.each(V0_TOOLS)("%s declares none of the pre-v0 parameters", (name) => {
    const api = allRegisteredTools();
    const schema = getTool(api, name).parameters as unknown as Record<string, unknown>;
    const declared = Object.keys((schema["properties"] ?? {}) as object);
    const retired = [...RETIRED_PARAMS, ...(RETIRED_ELSEWHERE[name] ?? [])];
    expect(declared.filter((p) => retired.includes(p))).toEqual([]);
  });

  it("guard-of-the-guard: each v0 tool declares SOME parameter (an empty schema passes vacuously)", () => {
    const api = allRegisteredTools();
    for (const name of V0_TOOLS) {
      const schema = getTool(api, name).parameters as unknown as Record<string, unknown>;
      expect(Object.keys((schema["properties"] ?? {}) as object).length).toBeGreaterThan(0);
    }
  });
});

describe("v0 — the retired VOCABULARY is gone from every agent-facing string", () => {
  it("no registered description names a field the v0 wire does not have", () => {
    const offenders: string[] = [];
    for (const [name, text] of wholeSurface(allRegisteredTools())) {
      for (const token of retiredV0Offenders(text)) offenders.push(`${name} → ${token}`);
    }
    expect(offenders).toEqual([]);
  });

  it("guard-of-the-guard: every RETIRED_V0_TOKENS needle is lower-case", () => {
    expect(RETIRED_V0_TOKENS.filter((t) => t !== t.toLowerCase())).toEqual([]);
  });
});

describe("v0 — no honesty field is ever framed as an exclusion (R6.2.2)", () => {
  it("NO registered tool teaches dropping / filtering / hiding on unknown, unset, applied:false or maturity:web", () => {
    // The named prior failure: `sil_stores` leading the agent to drop `unknown`
    // sellers undoes the route's fail-closed design one layer up. The scan runs
    // over the WHOLE surface, not just the catalog four — a profile tool that
    // learned the habit would be just as wrong.
    const offenders: string[] = [];
    for (const [name, text] of wholeSurface(allRegisteredTools())) {
      for (const sentence of honestyExclusionOffenders(text)) {
        offenders.push(`${name}: ${sentence}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("guard-of-the-guard: the scanned corpus is substantial (an empty surface scans clean)", () => {
    const total = wholeSurface(allRegisteredTools())
      .map(([, text]) => text.trim().length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(1000);
  });
});

describe("v0 — no description out-promises its route (R6.2.3)", () => {
  it("no 'current price' where `observed` can be `stored`, no 'ships to you' where the state can be `unknown`", () => {
    const offenders: string[] = [];
    for (const [name, text] of wholeSurface(allRegisteredTools())) {
      for (const sentence of overPromiseOffenders(text)) offenders.push(`${name}: ${sentence}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("v0 — no over-trigger: a description states when THIS tool applies (R6.2.5)", () => {
  it("no registered tool claims the general category ('search the web', 'find anything')", () => {
    const offenders: string[] = [];
    for (const [name, text] of wholeSurface(allRegisteredTools())) {
      for (const sentence of overTriggerOffenders(text)) offenders.push(`${name}: ${sentence}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("v0 — each of the four carries its discipline clause (R6.2.1)", () => {
  /**
   * Pinned on the clause's LOAD-BEARING tokens, not on the wording. The card is
   * explicit that R6.3's drafts are "binding on the clauses, editable on the
   * wording" — and this repo already deleted a 1341-line prose test that pinned
   * wording and stayed green through a live behavioural bug.
   */
  const DISCIPLINE: Record<(typeof V0_TOOLS)[number], RegExp[]> = {
    sil_search: [/\b4\b|\bfour\b/, /widen/i, /hard[^.]*never relaxed|never relax/i],
    sil_product_get: [/shortlist/i, /live/i, /top-?k|top offers/i],
    sil_stores: [/three states/i, /unknown/i, /serviceab/i],
    sil_domain_create: [/\bNEW\b/, /research|read(ing)? up/i, /never[^.]*change|not to change/i],
    // The read's discipline is a BUDGET and a mode rule: the two doors answer
    // different questions, and a cold category is settled in at most two
    // discovery reads plus one probe of the exact path about to be coined. An
    // agent left to infer whether the probe counts against the bound either
    // forfeits it (forking the vocabulary) or takes a third discovery read.
    sil_domain_find: [/\b(2|two)\b/, /probe/i, /never both|exactly one of/i],
  };

  it.each(V0_TOOLS)("%s's description carries every load-bearing token of its clause", (name) => {
    const description = getTool(allRegisteredTools(), name).description ?? "";
    const missing = DISCIPLINE[name].filter((re) => !re.test(description)).map((re) => re.source);
    expect(missing).toEqual([]);
  });

  it.each(V0_TOOLS)("%s's description is BOUNDED — the pre-v0 2000-char parameter tutorials are gone", (name) => {
    // R6.2.4: what survives per tool is what it does, the discipline clause, the
    // honesty clause and the recovery pointer. An agent reads this at pick-time
    // under context pressure; the clause that survives is the short one. The
    // ceiling is generous — it fails the 2000-char tutorials, not tight prose.
    const description = getTool(allRegisteredTools(), name).description ?? "";
    expect(description.length).toBeGreaterThan(150);
    expect(description.length).toBeLessThanOrEqual(1400);
  });
});

describe("v0 — no agent-facing string points at a tool that does not exist", () => {
  it("every `sil_*` token in a description names a REGISTERED tool", () => {
    // The general form of a defect this card creates by existing: `sil_domain_create`
    // is new, so any older prose that named a mint by some other spelling now
    // competes with a real tool for the same intention. A dangling pointer is
    // worse than a missing one — the agent tries it, fails, and has no recovery.
    //
    // Derived from the registered set, never a literal list: a tool added later is
    // covered for free, and a tool REMOVED turns every stale mention red (which is
    // the direction the one-directional bundle guard cannot cover).
    const api = allRegisteredTools();
    const registered = registeredToolNames(api);
    const offenders: string[] = [];
    for (const [name, text] of wholeSurface(api)) {
      for (const match of text.match(/\bsil_[a-z0-9_]+/g) ?? []) {
        if (!registered.has(match)) offenders.push(`${name} → ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("guard-of-the-guard: the scan finds `sil_*` tokens at all", () => {
    // A regex that matched nothing would pass forever. The descriptions really do
    // cross-reference each other — that is the point of the recovery pointers.
    const api = allRegisteredTools();
    const found = wholeSurface(api).flatMap(([, text]) => text.match(/\bsil_[a-z0-9_]+/g) ?? []);
    expect(new Set(found).size).toBeGreaterThan(3);
  });
});
