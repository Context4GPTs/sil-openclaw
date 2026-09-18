/**
 * UNIT — every agent-facing string and schema the plugin registers (mock api, no
 * I/O). Schemas are compared with `toEqual`, never a serialized byte-literal:
 * JSON-Schema key order is not contract, so a TypeBox bump that reorders keys
 * must not flip RED while a grown `required` must.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerIdentityTools } from "../../tools/identity.js";
import { registerCatalogTools } from "../../tools/catalog.js";
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
  RETIRED_V0_TOKENS,
} from "../helpers/honesty-vocabulary.js";

/** Both account tools publish this — the shape most likely to silently grow a
 * spurious `required` under a dependency key reorder, which the deep-equal pins. */
const EMPTY_OBJECT_SCHEMA = { type: "object", properties: {} } as const;

/**
 * Every account tool the plugin registers, with the agent-visible contract each
 * must honour — the description VERBATIM, because it is almost the whole of what
 * an agent learns the tool from, so an incidental edit has to be deliberate. The
 * set is part of the contract: exactly these two, no additions or renames.
 */
const TOOL_CONTRACT = {
  sil_register: {
    label: "Register on sil",
    description:
      "Hand the buyer a link that opens. `open` is the whole link: show it on its"
      + " own line so nothing breaks it, and let the buyer open it themselves. The"
      + " plugin polls in the background and stores the credentials once they"
      + " finish, so call sil_register again to confirm — it answers"
      + " already_registered. A buyer who is already registered gets that answer"
      + " straight away: carry on with what they asked for, nothing is offered and"
      + " nothing is created.",
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  sil_whoami: {
    label: "Who am I on sil",
    description:
      "The buyer's name, country and the addresses on file, and the `measurements`"
      + " and `preferences` sil already holds for them — read live from sil with the"
      + " credentials sil_register stored, a stale session token refreshed once and"
      + " the read retried. Call it at the start of a chat: it says where the buyer"
      + " is, how they measure and what they lastingly prefer, and you never ask"
      + " them for anything it answers. shopping_profile_edit is what writes those"
      + " two back. If they are not registered, or the session is past refreshing,"
      + " the result names the recovery (sil_register).",
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

describe("the account tools' agent-facing strings are pinned verbatim", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    api = registerAllTools();
  });

  for (const [name, contract] of Object.entries(TOOL_CONTRACT)) {
    it(`${name}: name, label, and description equal the contracted text verbatim`, () => {
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
 * EVERY registered tool description, the pivot-untouched account tools included.
 * Green on the current tree; a future `expert` reintroduction into any description
 * turns it RED.
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
  registerDoctorTools(api);
  return api;
}

describe("registered tool descriptions carry NO per-niche-expert vocabulary (whole-word `expert`, retro-allowance)", () => {
  it("every registered tool description scans clean — the pivot-untouched account tools included", () => {
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
    // while looking like it filtered. The scan runs over the WHOLE surface — an account
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
    // The write nothing can undo, the two things that must hold first, the vocabulary it
    // may not coin, and the inheritance rule in three parts — no rename, a re-declaration
    // that binds the subtree, and the mark that lets the agent use a key it did not mint.
    shopping_domain_create: [
      /\bNEW\b/,
      /research|read(ing)? up/i,
      /undo|permanent/i,
      /never .{0,20}to coin/i,
      /rename/i,
      /subtree/i,
      /inherited/,
      /shopping_domain_get/,
    ],
    // One brief for the whole session, the id the rest of it is named by, and the quote
    // every `reason` is — the founder's live session wrote four first-person paraphrases,
    // one of them a want ("new") the buyer never stated. A NEW chat opens its own brief off
    // what the earlier ones hold (2026-09-18: the warm session searched on the previous
    // session's brief), and what the buyer wears is a spec sil already answers.
    shopping_brief_create: [
      /per SESSION/i,
      /never one per category/i,
      /`id`/,
      /verbatim/i,
      /carry every spec/i,
      /gender/,
    ],
    // The want is written BEFORE the search, a write REPLACES rather than appends, the
    // `reason` is the buyer's words verbatim, a measurement is not the spec it becomes,
    // and a `decision` is a mind changed, written about the buyer — not a note of what
    // was just written down in their voice.
    shopping_brief_edit: [
      /before\b[^.]{0,20}next search/i,
      /replace/i,
      /`decision`/,
      /verbatim/i,
      /their mind/i,
      /MEASUREMENT is never the spec/i,
      /in their voice/i,
    ],
    // The bare read is a listing, it comes before the first question, and what it answers
    // is READ rather than searched — this session's brief is its own.
    shopping_brief_read: [/newest first/i, /before you ask/i, /never on an earlier session/i],
    // An entry is keyed by its name, writing that name again replaces it, and only an
    // unambiguous statement about the buyer reaches it at all.
    shopping_profile_edit: [/same `name`/, /before the next search/i, /unambiguous/i, /snake_case/],
    // The brief rides on every call, its specs travel unchanged, `n` counts variants,
    // the query is shop words, the honesty the whole answer turns on (`fit` says
    // "unknown" for what sil could not test, `printed` is the page talking, a variant
    // with no option values is a listing whose sizes are unread), the pick is priced,
    // and the bound. The first call waits for what the guide says decides the buy, and
    // this step talks fit: both measured 2026-09-18, four searches on two specs and every
    // shortlist priced against a market the buyer had not been shown a boot from yet.
    shopping_search: [
      /`brief`/,
      /before the FIRST call/i,
      /never the shortlist/i,
      /never on the search/i,
      /\b4\b|\bfour\b/,
      /per CATEGORY/,
      /counts VARIANTS/,
      /never a sentence/i,
      /"unknown"/,
      /`printed`/,
      /no option values/i,
      /gap/i,
      /unchanged/i,
      /priced/i,
    ],
    // What the dossier adds over the shortlist, that a miss is an absence, and that a
    // sizeless listing opens here like any other id.
    shopping_product_get: [/sources/, /absent/i, /opaque/i, /no option values/i],
    // The brief rides here too, its seller specs travel unchanged, a sizeless listing is
    // priced as its page prints, what dates a price, why the spread is the answer — and
    // that this call is the PICK's, not a pass over the shortlist.
    shopping_offers: [
      /`brief`/,
      /never for a shortlist/i,
      /observed_at/,
      /spread/i,
      /convert/i,
      /unchanged/i,
      /no option values/i,
    ],
    // The three states, that the third one keeps its seller, and that ids are the whole ask.
    shopping_seller_get: [/serviceable/, /unknown/, /keeps the seller/i, /nothing else/i],
  };

  it.each(SHOPPING_TOOLS)("%s's description carries every load-bearing token of its clause", (tool) => {
    const description = getTool(allRegisteredTools(), tool).description ?? "";
    const missing = DISCIPLINE[tool].filter((re) => !re.test(description)).map((re) => re.source);
    expect(missing).toEqual([]);
  });

  /**
   * `seller_specs` is still sayable in the mint's description — as the field
   * shopping_domain_get answers, never as one this call takes — so an occurrence is
   * cleared by its ATTRIBUTION rather than by its wording.
   */
  const ATTRIBUTED_SELLER_SPECS = /shopping_domain_get[^.]{0,60}seller_specs/g;

  it("neither description names the field the signed wire took off its request", () => {
    // The map above only proves a clause is PRESENT: a description can carry every token
    // and still tell the agent to send a field the route no longer takes, which is what
    // both of these were before the signed wire. An agent sends what it reads.
    const api = allRegisteredTools();
    const mint = getTool(api, "shopping_domain_create").description ?? "";
    expect(mint.replace(ATTRIBUTED_SELLER_SPECS, "")).not.toMatch(/seller_specs/);
    expect(getTool(api, "shopping_seller_get").description ?? "").not.toMatch(/ship_to/);
    // Guard-of-the-guard: the strip clears a real occurrence, so the bar is not passing
    // over prose that simply dropped the pointer to where seller terms come from.
    expect(mint).toMatch(/seller_specs/);
  });
});

describe("AC15 — `not_found` is never stated as a bare licence to write", () => {
  it("AC15 — no registered description hands out the re-mint licence, and one still explains the status", () => {
    // The agent decides what to do next from these descriptions alone, and
    // `not_found` is the one status that can read as "so make a fresh one". Stated
    // bare over a read sil merely could not complete, that instruction writes over
    // whatever was there.
    //
    // Runs over the WHOLE registered surface (descriptions AND parameter
    // descriptions), derived from the live registration, so a tool that learns the
    // habit is caught for free.
    const api = allRegisteredTools();
    const offenders: string[] = [];
    for (const [name, text] of wholeSurface(api)) {
      for (const sentence of notFoundLicenceOffenders(text)) offenders.push(`${name}: ${sentence}`);
    }
    expect(offenders).toEqual([]);

    // Guard-of-the-guard: the cheapest way to pass a forbid-scan is to stop naming
    // `not_found` anywhere, which leaves the agent reading a wire status no
    // description explains. The registry read answers it, so it must keep saying so.
    // The floor is NAMING it, never a listing qualifier: sil scopes every lookup to
    // the account and lists nothing to decide a 404.
    const names = wholeSurface(api)
      .filter(([, text]) => /\bnot_found\b/.test(text))
      .map(([name]) => name);
    expect(names).toContain("shopping_domain_get");
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
