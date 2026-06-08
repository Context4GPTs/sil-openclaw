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
 * Why this exists alongside examples.test.ts: that file asserts only
 * `parameters.type === "object"` — which passes even if `required` or a
 * nested `description` silently drifted. This file deep-equals the WHOLE
 * schema, so structure cannot be lost.
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
import { registerExampleTools } from "../../tools/examples.js";
import { registerIdentityTools } from "../../tools/identity.js";
import {
  createMockPluginApi,
  getTool,
  registeredToolNames,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

/**
 * The complete agent-facing tool contract, captured from the live 0.34.14
 * emission (transcribed verbatim from the card's Risks section). The
 * migration must keep every tool's `parameters` JSON-schema deep-equal to
 * the value here. `name` / `label` / `description` are plain string
 * literals (TypeBox-independent) and must not be incidentally edited
 * during the import swap.
 *
 * The four schemas are: `Type.Object({})` (×3 — the no-argument tools) and
 * `Type.Object({ message: Type.String({ description }) })` (sil_echo, the
 * one tool with structure to lose).
 */
const EMPTY_OBJECT_SCHEMA = { type: "object", properties: {} } as const;

const ECHO_PARAMETERS_SCHEMA = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Text echoed back verbatim in the stub payload.",
    },
  },
  required: ["message"],
} as const;

/** Every tool the plugin registers, with the agent-visible contract each
 * must honour after the migration. The set is itself part of the contract:
 * exactly these four, no additions / removals / renames. */
const TOOL_CONTRACT = {
  sil_ping: {
    label: "Ping",
    description:
      "Liveness check. Takes no arguments and returns a stub payload"
      + " confirming the plugin's tools are registered and invocable.",
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  sil_echo: {
    label: "Echo",
    description:
      "Echo the supplied message back inside a stub payload. Demonstrates"
      + " that a typed parameter round-trips from request to response.",
    parameters: ECHO_PARAMETERS_SCHEMA,
  },
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

/** Register the entire plugin tool surface exactly as src/index.ts#register()
 * does (both groups), so the assertions run against the real registration
 * code — not a re-stated schema literal. Mirror register() exactly. */
function registerAllTools(): MockPluginAPI {
  const api = createMockPluginApi();
  registerExampleTools(api);
  registerIdentityTools(api);
  return api;
}

describe("tool-set invariant — exactly the four contracted tools", () => {
  it("registers exactly { sil_echo, sil_ping, sil_register, sil_whoami } — no additions, removals, or renames", () => {
    const names = registeredToolNames(registerAllTools());
    expect([...names].sort()).toEqual([
      "sil_echo",
      "sil_ping",
      "sil_register",
      "sil_whoami",
    ]);
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

  for (const name of ["sil_ping", "sil_register", "sil_whoami"] as const) {
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

  it("sil_echo (the only non-empty schema — the boundary case): parameters deep-equals today's full structure", () => {
    // The one schema with structure to lose: nested properties.message of
    // { type: "string", description: <exact text> } AND required: ["message"].
    // 1.x reorders keys (required before properties; nested type before
    // description) — toEqual is order-insensitive, so a pure dependency bump
    // stays GREEN while any real drift (lost description, lost/extra required,
    // changed type) flips RED.
    const params = getTool(api, "sil_echo").parameters as unknown as Record<
      string,
      unknown
    >;
    expect(params).toEqual(ECHO_PARAMETERS_SCHEMA);
  });

  it("sil_echo: preserves the nested description verbatim and the exact required array (drift-resistant sub-assertions)", () => {
    // Belt-and-braces: even if a future refactor of the literal above were
    // wrong, these pin the two pieces most likely to be silently dropped.
    const params = getTool(api, "sil_echo").parameters as unknown as {
      properties: { message: { type: unknown; description: unknown } };
      required: unknown;
    };
    expect(params.properties.message.type).toBe("string");
    expect(params.properties.message.description).toBe(
      "Text echoed back verbatim in the stub payload.",
    );
    expect(params.required).toEqual(["message"]);
  });
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

  for (const name of ["sil_ping", "sil_echo", "sil_register", "sil_whoami"] as const) {
    it(`${name}: JSON.stringify(parameters) leaks no ~kind / ~optional / ~readonly key`, () => {
      const serialized = JSON.stringify(getTool(api, name).parameters);
      expect(serialized).not.toContain("~kind");
      expect(serialized).not.toContain("~optional");
      expect(serialized).not.toContain("~readonly");
    });
  }
});
