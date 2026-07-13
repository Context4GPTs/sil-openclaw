/**
 * UNIT — sil_specs tool: registration shape + the SpecDefinition schema + the
 * client-side guards (empty-specs, not-registered, malformed-entry reject-whole) +
 * the token-log canary (tier: unit, mock api + temp data dir, `fetch` spied so
 * nothing reaches the network).
 *
 * CARD `sds-specs-client-tool` (epic `spec-driven-shopping-redesign`, Phase 3). At
 * method mint/refresh (Beat 2) the method submits its coined spec DEFINITIONS;
 * `sil_specs` canonicalizes them via the sil-services registry (dedupe-or-create) and
 * returns the canonical `ns.key` to adopt — born canonical, before persist. The tool
 * is a STRUCTURAL CLONE of `sil_search`, extended into `registerCatalogTools`.
 *
 * Covers the unit-tier acceptance criteria that live at the TOOL boundary (the
 * request-mapping + classifier pure pieces are pinned in `lib/specs-client.test.ts`
 * and `lib/specs-classify.test.ts`; the full wired pipeline + the outcome taxonomy are
 * the integration tier's job in `catalog-specs.integration.test.ts`). Here we assert:
 *
 *   - the tool-registration shape: a `sil_specs` tool with a typed parameter object —
 *     `query` (string) + `specs` (array of SpecDefinition objects, `minItems:1`);
 *   - the SpecDefinition schema: namespace / key / display_name (required strings) +
 *     data_type (a closed union of EXACTLY number|text|boolean|enum) + optional
 *     description / unit / allowed_values (string[]). Unlike search's SpecPredicate,
 *     SpecDefinition is FULLY TypeBox-expressible, so the host validates the shape;
 *   - AC4 — the empty-specs guard: an empty or absent `specs` → `invalid_request`
 *     (`empty_specs_input`), ZERO network calls;
 *   - the malformed-entry REJECT-WHOLE guard (`readSpecsParams`, the request-side twin
 *     of the response-side fail-whole in specs-classify): a per-definition malformed
 *     shape rejects the WHOLE request (`invalid_spec`), ZERO network — a silently
 *     dropped coined spec never canonicalizes → never converges (the honesty rule);
 *   - AC5 — the not-registered short-circuit: no tokens.json → terminal
 *     `not_registered` (recovery `sil_register`), ZERO network;
 *   - the token-log canary: on every path the stored token never appears in any
 *     logger call at any level.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - src/tools/catalog.ts#registerCatalogTools(api) ALSO registers a `sil_specs`
 *     tool (extending the group — NO new group) whose parameters are a Type.Object
 *     with `query` (string) + `specs` (Type.Array(SpecDefinitionSchema, {minItems:1}));
 *   - execute() returns a jsonResult; with an empty/absent specs it returns
 *     `empty_specs_input` and calls no fetch; with a malformed definition it returns
 *     `invalid_spec` (reject-whole) and calls no fetch; with no tokens.json it returns
 *     a terminal not_registered hint and calls no fetch.
 *
 * EXPECT RED today: `sil_specs` is not registered, so `getTool(api, "sil_specs")`
 * throws "Tool not registered", and every execute()-path assertion fails.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../../tools/catalog.js";
import { setWebUrl, setApiUrl } from "../../lib/config.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const TOOL = "sil_specs";

/** A well-formed SpecDefinition — the request half (all required fields present). */
const SPEC_A = {
  namespace: "product",
  key: "waterproofing",
  display_name: "Waterproofing",
  data_type: "number",
  unit: "mm",
};

let dataDir: string;
let priorSilDataDir: string | undefined;

/** Parse a ToolResult's JSON payload. */
function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`tool result has no text payload: ${String(text)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Seed a valid token pair so a call proceeds past the not-registered guard. */
function seedTokens(access = "stored-at", refresh = "stored-rt"): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: access, refresh_token: refresh }),
    { mode: 0o600 },
  );
}

/** A 200 real (single-resolution) body so a forwarded request resolves cleanly. The
 * BARE sil-api shape (`{ resolved }` — top level, no `ucp`/`result` wrapper). */
function okEnvelopeFetch(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        resolved: [
          {
            namespace: "product",
            key: "waterproof_rating",
            display_name: "Waterproof Rating",
            data_type: "number",
            unit: "mm",
            is_filterable: true,
            is_comparable: true,
            submitted: { namespace: "product", key: "waterproofing" },
            canonical: { namespace: "product", key: "waterproof_rating" },
            status: "matched",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

/** Collect every argument to every logger level, serialized. */
function logBlob(api: MockPluginAPI): string {
  return [api.logger.info, api.logger.warn, api.logger.error, api.logger.debug]
    .flatMap((fn) => vi.mocked(fn).mock.calls.map((c) => JSON.stringify(c)))
    .join("\n");
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-specs-unit-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("sil_specs — tool registration shape", () => {
  it("registers a sil_specs tool with a typed query + specs param", () => {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    expect(tool.label.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
    const props = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    for (const expected of ["query", "specs"]) {
      expect(Object.keys(props)).toContain(expected);
    }
  });

  it("registering the catalog group does not disturb the sibling catalog tools", () => {
    // sil_specs is ADDED to registerCatalogTools alongside sil_search / sil_product_get
    // — the sibling tools must still register (the group extension is additive).
    const api = createMockPluginApi();
    registerCatalogTools(api);
    for (const sibling of ["sil_search", "sil_product_get", "sil_specs"]) {
      expect(api._tools.has(sibling)).toBe(true);
    }
  });
});

describe("sil_specs — the SpecDefinition schema (fully TypeBox-expressible: the host validates the shape)", () => {
  function specsProps(): Record<string, Record<string, unknown>> {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as {
      properties?: Record<string, Record<string, unknown>>;
    };
    return params.properties ?? {};
  }
  /** The `specs` array's per-item object-schema node. */
  function specItemProps(): Record<string, Record<string, unknown>> {
    const specs = specsProps()["specs"];
    expect(specs, "specs must be a registered param").toBeDefined();
    const items = (specs!["items"] ?? {}) as Record<string, unknown>;
    return (items["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  }
  /** Collect the literal values `data_type` allows, from whichever JSON-schema
   * encoding TypeBox emits for a union-of-literals (`enum`, or `anyOf`/`oneOf` of
   * `const`). */
  function dataTypeLiterals(): string[] {
    const dt = specItemProps()["data_type"];
    expect(dt, "spec item must have a `data_type`").toBeDefined();
    if (Array.isArray(dt!["enum"])) return (dt!["enum"] as unknown[]).map(String);
    const union = (dt!["anyOf"] ?? dt!["oneOf"]) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(union)) {
      return union
        .map((m) => (m["const"] !== undefined ? m["const"] : Array.isArray(m["enum"]) ? (m["enum"] as unknown[])[0] : undefined))
        .filter((v): v is unknown => v !== undefined)
        .map(String);
    }
    return [];
  }

  it("`specs` is an array of objects, with minItems 1 (a canonicalization needs ≥1 definition)", () => {
    const specs = specsProps()["specs"];
    expect(specs).toBeDefined();
    expect(specs!["type"]).toBe("array");
    expect(specs!["minItems"]).toBe(1);
    const items = (specs!["items"] ?? {}) as Record<string, unknown>;
    expect(items["type"]).toBe("object");
  });

  it("`query` and `specs` are BOTH required (the request needs a search context AND ≥1 definition)", () => {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as { required?: unknown };
    const required = Array.isArray(params.required) ? (params.required as string[]) : [];
    expect(required).toContain("query");
    expect(required).toContain("specs");
  });

  it("a SpecDefinition has props namespace / key / display_name / data_type + optional description / unit / allowed_values", () => {
    const keys = Object.keys(specItemProps());
    for (const k of ["namespace", "key", "display_name", "data_type", "description", "unit", "allowed_values"]) {
      expect(keys).toContain(k);
    }
  });

  it("namespace / key / display_name are strings (the two ref fields + the human label)", () => {
    for (const field of ["namespace", "key", "display_name"]) {
      const node = specItemProps()[field];
      expect(node, `${field} must exist`).toBeDefined();
      expect(node!["type"]).toBe("string");
    }
  });

  it("data_type is a union of EXACTLY the four types {number, text, boolean, enum} (closed)", () => {
    expect(new Set(dataTypeLiterals())).toEqual(
      new Set(["number", "text", "boolean", "enum"]),
    );
  });

  it("allowed_values is an array of strings; unit and description are strings", () => {
    const allowed = specItemProps()["allowed_values"];
    expect(allowed!["type"]).toBe("array");
    expect(((allowed!["items"] ?? {}) as Record<string, unknown>)["type"]).toBe("string");
    expect(specItemProps()["unit"]!["type"]).toBe("string");
    expect(specItemProps()["description"]!["type"]).toBe("string");
  });

  it("namespace / key / display_name are NOT enum-constrained (the ns.key vocabulary is OPEN, coined bottom-up)", () => {
    // The open-vocabulary guard (mirrors sil_search's SpecPredicate ns/key): a
    // namespace/key enum or pattern would be the central spec registry the bottom-up
    // design forbids. display_name is likewise free human text.
    for (const field of ["namespace", "key", "display_name"]) {
      const node = specItemProps()[field];
      expect(node!["enum"]).toBeUndefined();
      expect(node!["pattern"]).toBeUndefined();
    }
  });
});

describe("sil_specs — AC4: empty-specs guard (reject empty BEFORE any network)", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A token IS present (so the guard, not the not-registered path, is what rejects);
    // fetch fails loudly if the guard lets an empty request through.
    seedTokens();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("empty specs must not hit the network"));
    api = createMockPluginApi();
    registerCatalogTools(api);
  });

  it("an empty specs:[] (with a valid query) → invalid_request / empty_specs_input, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "hiking gloves", specs: [] }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("empty_specs_input");
    // A validation problem, not an auth problem — no re-register hint.
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("an ABSENT specs (with a valid query) → invalid_request / empty_specs_input, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "hiking gloves" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("empty_specs_input");
  });

  it("a NON-ARRAY specs (a bare object) is dropped-to-empty → empty_specs_input, ZERO network calls", async () => {
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "gloves", specs: { namespace: "p" } }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("empty_specs_input");
  });

  it("a blank (whitespace-only) query WITH valid specs → invalid_request, ZERO network calls", async () => {
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "   ", specs: [SPEC_A] }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
  });
});

describe("sil_specs — malformed-entry REJECT-WHOLE (readSpecsParams; a silently-dropped coined spec never converges)", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    seedTokens();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("a malformed spec must not hit the network"));
    api = createMockPluginApi();
    registerCatalogTools(api);
  });

  it("a blank `namespace` on ONE definition → invalid_spec, WHOLE request rejected, ZERO network", async () => {
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "gloves",
        specs: [SPEC_A, { ...SPEC_A, namespace: "" }],
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_spec");
    // The whole request is rejected — the good SPEC_A is NOT canonicalized in isolation.
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("a blank `display_name` → invalid_spec, ZERO network (display_name is load-bearing for dedupe quality)", async () => {
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "gloves",
        specs: [{ ...SPEC_A, display_name: "" }],
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_spec");
  });

  it("an out-of-set `data_type` (not number/text/boolean/enum) → invalid_spec, ZERO network", async () => {
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "gloves",
        specs: [{ ...SPEC_A, data_type: "banana" }],
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_spec");
  });

  it("a bare non-object entry (string) among valid ones → invalid_spec, WHOLE request rejected, ZERO network", async () => {
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "gloves",
        specs: [SPEC_A, "not-a-definition"],
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_spec");
  });
});

describe("sil_specs — the guard does NOT over-reject a valid request", () => {
  it("a valid { query, specs:[def] } PROCEEDS to the network (canonicalization round-trip)", async () => {
    seedTokens();
    const fetchSpy = okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "hiking gloves", specs: [SPEC_A] }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload["status"]).toBe("ok");
  });
});

describe("sil_specs — AC5: not registered (no tokens.json) short-circuit", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // No tokens seeded. fetch fails loudly if the tool calls it.
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("not-registered must not hit the network"));
    api = createMockPluginApi();
    registerCatalogTools(api);
  });

  it("makes NO sil-api call and names sil_register as the recovery", async () => {
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [SPEC_A] }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("not_registered");
    expect(payload["resolved"]).toBeUndefined();
    expect(JSON.stringify(payload)).toContain("sil_register");
  });

  it("does NOT crash and resolves promptly when not registered", async () => {
    const result = await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [SPEC_A] });
    expect(result).toBeTypeOf("object");
    expect(result.content[0]?.text).toBeTypeOf("string");
  });
});

describe("sil_specs — token never logged (leak-canary)", () => {
  it("on the SUCCESS path, no logger call carries the access token", async () => {
    seedTokens("leak-canary-access", "leak-canary-refresh");
    okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [SPEC_A] });

    const blob = logBlob(api);
    expect(blob).not.toContain("leak-canary-access");
    expect(blob).not.toContain("leak-canary-refresh");
    expect(blob).not.toMatch(/Bearer/i);
  });

  it("on a 401 (non-success) path, no logger call carries the access token", async () => {
    seedTokens("leak-canary-access-2", "leak-canary-refresh-2");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [SPEC_A] });

    const blob = logBlob(api);
    expect(blob).not.toContain("leak-canary-access-2");
    expect(blob).not.toContain("leak-canary-refresh-2");
    expect(blob).not.toMatch(/Bearer/i);
  });

  it("the success result does NOT echo the access token or Authorization header", async () => {
    seedTokens("secret-access-token", "secret-refresh-token");
    okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const blob = JSON.stringify(
      payloadOf(await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [SPEC_A] })),
    );
    expect(blob).not.toContain("secret-access-token");
    expect(blob).not.toContain("secret-refresh-token");
    expect(blob).not.toMatch(/Bearer/i);
    expect(blob).not.toMatch(/authorization/i);
  });
});
