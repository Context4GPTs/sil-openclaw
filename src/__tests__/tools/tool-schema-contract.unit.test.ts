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
import { categoryAsDomainOffenders } from "../helpers/domain-vocabulary.js";
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
    expect(names.filter((n) => n.startsWith("shopping_")).length).toBe(12);
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

describe("the registry's concept is a DOMAIN, never a category", () => {
  it("no agent-facing string names a domain's path, guide, keys or specs a `category`'s", () => {
    // Founder ruling, 2026-09-19: sil ships the domain document, and "domain" is the
    // user-facing word for what the registry holds. An agent reading "the category's
    // guide" in one description and `domain` in the next is being handed two names for
    // one thing, and coins its spec keys under whichever it read last.
    //
    // Runs over the WHOLE surface — descriptions AND parameter descriptions — because a
    // rule enforced on one is not enforced. The scan is narrow by construction (the
    // possessive, or the registry's own nouns) so the generic English sense the bundle
    // still uses legitimately cannot false-RED; its bite is proved in
    // `skill-bundle-contract.integration.test.ts`, which runs the same module.
    // De-duplicated: `agentFacingText` deliberately reads each property description
    // twice (once directly, once through the nested-schema sweep), which costs the other
    // scanners nothing but would print every offender here twice.
    const offenders = new Set<string>();
    for (const [name, text] of wholeSurface(allRegisteredTools())) {
      for (const ctx of categoryAsDomainOffenders(text)) offenders.add(`${name}: …${ctx}…`);
    }
    expect([...offenders]).toEqual([]);
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
