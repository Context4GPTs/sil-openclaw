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
 * Scope of THIS block: the account surface (`sil_register`, `sil_whoami`) —
 * both no-argument tools whose `parameters` is `Type.Object({})`. It
 * deep-equals the WHOLE schema (order-insensitive) so the empty-object shape
 * cannot silently grow a spurious `required` or property during a dependency
 * bump. The shopping tools publish a committed artifact instead, and are
 * deep-equalled against it further down.
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
import { registerDocTools } from "../../tools/doc.js";
import { registerDoctorTools } from "../../tools/doctor.js";
import {
  createMockPluginApi,
  getTool,
  registeredToolNames,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";
import { perNicheExpertOffenders } from "../helpers/per-niche-expert.js";
import {
  SHOPPING_TOOLS,
  artifact,
  artifactParameters,
} from "../helpers/shopping-wire.js";
import {
  honestyExclusionOffenders,
  notFoundLicenceOffenders,
  overPromiseOffenders,
  overTriggerOffenders,
  retiredV0Offenders,
  statesQualifiedNotFound,
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
 * The single-shopper pivot shipped as targeted slices, and the account tools were
 * never opened by any of them, so their descriptions could regress to implicit
 * per-niche-expert framing without anyone touching them — and an agent learns the
 * model it is driving almost entirely from these descriptions. This guard runs the SHARED whole-word
 * `\bexperts?\b` + 28-char retro-allowance check (`perNicheExpertOffenders`, the
 * very check the skill-prose guard uses, so the discipline can never drift) over
 * EVERY registered tool description — the four pivot-untouched tools and the four
 * `shopping_doc_*` document verbs. Green on the current tree; a future `expert`
 * reintroduction into any description turns it RED.
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
  registerDocTools(api);
  registerDoctorTools(api);
  return api;
}

describe("registered tool descriptions carry NO per-niche-expert vocabulary (whole-word `expert`, retro-allowance)", () => {
  it("every registered tool description scans clean — incl. the four pivot-untouched tools and the four document verbs", () => {
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

/**
 * THE SHOPPING SURFACE — the registered contract, and the cross-cutting scans over every
 * agent-facing string (the tool description AND every parameter description, because an
 * agent reads both and a rule enforced on one is not enforced).
 *
 * The scanners live in `helpers/honesty-vocabulary.ts`, imported by BOTH this file and
 * `skill-bundle-contract.integration.test.ts` — one module, so the tool-description guard
 * and the skill-prose guard can never drift apart. Their bite (and their allowance for
 * the sentence the product NEEDS) is proved in `lib/honesty-vocabulary.test.ts`.
 */

/** A tool's description plus every one of its parameter descriptions. */
function agentFacingText(api: MockPluginAPI, name: string): string {
  const tool = getTool(api, name);
  const schema = tool.parameters as unknown as Record<string, unknown>;
  const props = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const nested = JSON.stringify(schema).match(/"description"\s*:\s*"(?:[^"\\]|\\.)*"/g) ?? [];
  return [
    tool.description ?? "",
    ...Object.values(props).map((p) => (p["description"] as string | undefined) ?? ""),
    // Nested parameter descriptions (a spec's `op`, a key's `unit`) are agent-facing too
    // and would otherwise escape every scan below.
    ...nested.map((raw) => JSON.parse(`{${raw}}`).description as string),
  ].join("\n");
}

/** Every agent-facing string across the WHOLE registered surface. */
function wholeSurface(api: MockPluginAPI): [string, string][] {
  return [...api._tools.keys()].map((name) => [name, agentFacingText(api, name)]);
}

describe("the shopping tools' parameters ARE the committed request artifacts", () => {
  it.each(SHOPPING_TOOLS)(
    "%s publishes its artifact verbatim, minus the three FILE annotations",
    (tool) => {
      // The one bar that makes "the plugin adds no shape of its own" checkable. A
      // hand-written schema here would be a second copy of the request contract and the
      // first thing to drift from it; deep-equality against the committed bytes is what
      // makes that impossible rather than merely discouraged.
      const registered = getTool(allRegisteredTools(), tool).parameters as unknown as Record<
        string,
        unknown
      >;
      expect(registered).toEqual(artifactParameters(tool));
    },
  );

  it.each(SHOPPING_TOOLS)("%s strips `$schema` / `$id` / `title` before the host sees it", (tool) => {
    // They describe the FILE, not the argument the model has to build, and a `$id` on a
    // tool input invites a host to resolve a URL nobody serves.
    const registered = getTool(allRegisteredTools(), tool).parameters as unknown as Record<
      string,
      unknown
    >;
    for (const annotation of ["$schema", "$id", "title"]) {
      expect(registered).not.toHaveProperty(annotation);
    }
    // Guard-of-the-guard: the artifact really carries all three, so the strip is doing
    // work rather than agreeing with an empty file.
    for (const annotation of ["$schema", "$id", "title"]) {
      expect(artifact(tool, "request")).toHaveProperty(annotation);
    }
  });

  it.each(SHOPPING_TOOLS)("%s's description is bounded — enough to act on, short enough to read", (tool) => {
    // An agent reads this at pick-time under context pressure; the clause that survives
    // is the short one. The ceiling is generous — it fails a parameter tutorial, not
    // tight prose — and the floor fails a one-liner that teaches nothing.
    const description = getTool(allRegisteredTools(), tool).description ?? "";
    expect(description.length).toBeGreaterThan(150);
    expect(description.length).toBeLessThanOrEqual(1400);
  });
});

describe("the retired tool NAMES cannot come back", () => {
  it("no registered tool is named for the wire the contract replaced", () => {
    // Proved by BITE, not by a literal list: every registered name is run through the
    // shape the old wire used, so a resurrected `sil_search` or a stray `sil_doc_*` is
    // caught whether or not anybody remembered to enumerate it here.
    const retired = /^sil_(search|product_get|stores|lookup|domain_find|domain_create|doc_[a-z]+)$/;
    const names = [...registeredToolNames(allRegisteredTools())];
    expect(names.filter((n) => retired.test(n))).toEqual([]);
    // Guard-of-the-guard: the pattern bites the names it is written for.
    expect(
      ["sil_search", "sil_product_get", "sil_stores", "sil_domain_find", "sil_doc_write"].filter(
        (n) => !retired.test(n),
      ),
    ).toEqual([]);
  });

  it("the loop's tools are all named `shopping_*` — only the account tools keep `sil_`", () => {
    // The contract's own rule: every tool the loop calls is named for what it does for
    // the shopper. A loop tool left under `sil_` is one the agent cannot find by name.
    const names = [...registeredToolNames(allRegisteredTools())].sort();
    expect(names.filter((n) => n.startsWith("sil_")).sort()).toEqual([
      "sil_doctor",
      "sil_register",
      "sil_whoami",
    ]);
    expect(names.filter((n) => n.startsWith("shopping_")).length).toBe(11);
  });
});

describe("the retired VOCABULARY is gone from every agent-facing string", () => {
  it("no registered description names a field the wire does not have", () => {
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

describe("no honesty field is ever framed as an exclusion", () => {
  it("NO registered tool teaches dropping / filtering / hiding on `unknown`, an absent `fit` key, an empty `variants` or `webpage_info`", () => {
    // The named prior failure: a seller tool leading the agent to drop `unknown` sellers
    // undoes the route's fail-closed design one layer up, and the shortlist collapses
    // while looking like it filtered. The scan runs over the WHOLE surface — a document
    // tool that learned the habit would be just as wrong.
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

describe("no description out-promises its route", () => {
  it("no 'current price' where an offer is dated, no 'ships to you' where `ships` can be `unknown`", () => {
    const offenders: string[] = [];
    for (const [name, text] of wholeSurface(allRegisteredTools())) {
      for (const sentence of overPromiseOffenders(text)) offenders.push(`${name}: ${sentence}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("no over-trigger: a description states when THIS tool applies", () => {
  it("no registered tool claims the general category ('search the web', 'find anything')", () => {
    const offenders: string[] = [];
    for (const [name, text] of wholeSurface(allRegisteredTools())) {
      for (const sentence of overTriggerOffenders(text)) offenders.push(`${name}: ${sentence}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("each shopping tool carries its discipline clause", () => {
  /**
   * Pinned on the clause's LOAD-BEARING tokens, never on the wording — this repo already
   * deleted a 1341-line prose test that pinned wording and stayed green through a live
   * behavioural bug. Each entry is the one thing an agent that loses it gets wrong.
   */
  const DISCIPLINE: Record<(typeof SHOPPING_TOOLS)[number], RegExp[]> = {
    // The read that licenses the mint, and the bound on how often it is taken.
    shopping_domain_search: [/matches: \[\]/, /licens/i, /\b(2|two)\b/],
    // What the keys are for, and which of them identify a purchasable option.
    shopping_domain_get: [/variant_spec/, /product_spec/, /operators?/i],
    // The write nothing can undo, and the two things that must hold first.
    shopping_domain_create: [/\bNEW\b/, /research|read(ing)? up/i, /undo|permanent/i],
    // The honesty the whole answer turns on, and the fan-out bound.
    shopping_search: [/\b4\b|\bfour\b/, /widen/i, /hard row is never relaxed/i, /webpage_info/, /gap/i],
    // What the dossier adds over the shortlist, and that a miss is an absence.
    shopping_product_get: [/sources/, /absent/i, /opaque/i],
    // What dates a price, and why the spread is the answer.
    shopping_offers: [/observed_at/, /spread/i, /convert/i],
    // The three states, and that the third one keeps its seller.
    shopping_seller_get: [/serviceable/, /unknown/, /keeps the seller/i],
  };

  it.each(SHOPPING_TOOLS)("%s's description carries every load-bearing token of its clause", (tool) => {
    const description = getTool(allRegisteredTools(), tool).description ?? "";
    const missing = DISCIPLINE[tool].filter((re) => !re.test(description)).map((re) => re.source);
    expect(missing).toEqual([]);
  });
});

/**
 * The four DOCUMENT tools' discipline clauses, verbatim from
 * `SIL-DOMAINS-AND-SPECS.md` §8 ("the plugin implements them verbatim"). Same shape
 * and same reason as the V0_TOOLS map above: pinned on the clause's LOAD-BEARING
 * tokens, never on the wording.
 *
 * Why a clause at all — a model picks tools at the moment of use, and the clause is
 * what survives context pressure. `shopping_doc_write`'s is the one that costs data if it
 * is lost: an agent that does not know `body` is the WHOLE reconciled markdown sends
 * a fragment, and the rest of the person is gone in one call.
 */
const DOC_TOOLS = ["shopping_doc_find", "shopping_doc_read", "shopping_doc_write", "shopping_doc_remove"] as const;

const DOC_DISCIPLINE: Record<(typeof DOC_TOOLS)[number], RegExp[]> = {
  // coordinates only — bodies come from shopping_doc_read
  shopping_doc_find: [/coordinates only/i, /shopping_doc_read/],
  // one whole body; unreadable is never re-minted over
  shopping_doc_read: [/whole (document )?body|one whole/i, /unreadable/i, /never (write|re-?mint)/i],
  // the WHOLE reconciled markdown — never append, never patch a section; create
  // fails if the ref exists, replace fails if it does not
  shopping_doc_write: [
    /whole reconciled/i,
    /no append|never append/i,
    /create fails/i,
    /replace fails/i,
  ],
  // one document, never a cascade
  shopping_doc_remove: [/one document/i, /never a cascade|no cascade/i],
};

describe("AC G8 — each document tool carries its DOMAINS §8 discipline clause", () => {
  it("G8 — every load-bearing token of every clause is present, on all four", () => {
    // ONE bar over four tools rather than four near-identical `it.each` rows: the
    // failure mode is the same for each, and the offender list names which tool lost
    // which clause. The BANNED-VOCABULARY half of G8 needs no bar of its own — the
    // honesty / over-promise / over-trigger / retired-v0 scans above already run over
    // `wholeSurface(allRegisteredTools())`, which now enumerates these four.
    const api = allRegisteredTools();
    const missing: string[] = [];
    for (const name of DOC_TOOLS) {
      const description = getTool(api, name).description ?? "";
      // Guard-of-the-guard: an absent description satisfies nothing, but a BLANK one
      // would make the `missing` list read as if the tool were simply unregistered.
      expect(description.length).toBeGreaterThan(150);
      for (const re of DOC_DISCIPLINE[name]) {
        if (!re.test(description)) missing.push(`${name} → ${re.source}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("AC15 — `not_found` is stated as a claim sil can only make from a listing", () => {
  it("AC15 — no registered description hands out the re-mint licence, and the two doc verbs still teach the rule", () => {
    // The agent decides whether to re-mint from these descriptions alone, and
    // `not_found` is the one status that instructs it to. Over a directory the store
    // merely could not read, that instruction costs the buyer's own words in one
    // call — the same loss the `unreadable` contract exists to prevent, arriving
    // through prose instead of through code.
    //
    // Runs over the WHOLE registered surface (descriptions AND parameter
    // descriptions), derived from the live registration, so a fifth verb that learns
    // the habit is caught for free.
    const api = allRegisteredTools();
    const offenders: string[] = [];
    for (const [name, text] of wholeSurface(api)) {
      for (const sentence of notFoundLicenceOffenders(text)) offenders.push(`${name}: ${sentence}`);
    }
    expect(offenders).toEqual([]);

    // Guard-of-the-guard: the cheapest way to pass a forbid-scan is to stop naming
    // `not_found` anywhere, which leaves the agent reading a wire status no
    // description explains. The two verbs that can answer it must still state the
    // condition under which sil is entitled to.
    const qualified = wholeSurface(api)
      .filter(([, text]) => statesQualifiedNotFound(text))
      .map(([name]) => name);
    expect(qualified).toEqual(expect.arrayContaining(["shopping_doc_read", "shopping_doc_remove"]));
  });
});

describe("no agent-facing string points at a tool that does not exist", () => {
  it("every `sil_*` / `shopping_*` token in a description names a REGISTERED tool", () => {
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
      for (const match of text.match(/\b(?:sil|shopping)_[a-z0-9_]+/g) ?? []) {
        if (!registered.has(match)) offenders.push(`${name} → ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("guard-of-the-guard: the scan finds tool tokens at all", () => {
    // A regex that matched nothing would pass forever. The descriptions really do
    // cross-reference each other — that is the point of the recovery pointers.
    const api = allRegisteredTools();
    const found = wholeSurface(api).flatMap(
      ([, text]) => text.match(/\b(?:sil|shopping)_[a-z0-9_]+/g) ?? [],
    );
    expect(new Set(found).size).toBeGreaterThan(3);
  });
});
