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
import {
  createMockPluginApi,
  getTool,
  registeredToolNames,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

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
      + " using the credentials stored by sil_register. If the access token has"
      + " expired it is refreshed transparently and the read is retried. If you"
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
