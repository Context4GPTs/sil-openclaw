/**
 * UNIT — sil_search tool: registration shape + the client-side ≥1-input guard +
 * the token-log canary (tier: unit, mock api + temp data dir, `fetch` spied so
 * nothing reaches the network).
 *
 * Covers the unit-tier acceptance criteria that live at the TOOL boundary (the
 * request-mapping + classifier pure pieces are pinned in
 * `lib/search-client.test.ts` and `lib/search-classify.test.ts`; the full wired
 * pipeline + the three-distinct-outcomes taxonomy are the integration tier's job
 * in `catalog-search.integration.test.ts`). Here we assert:
 *
 *   - the tool-registration shape (a `sil_search` tool with a typed parameter
 *     object: `query` + optional `category`/`price_min`/`price_max`/`cursor`/`limit`);
 *   - the CLIENT-SIDE ≥1-input guard the tool owns: a request with neither a
 *     non-empty `query` nor any filter (`{}`, or a whitespace-only `query` with no
 *     filter) returns a structured validation error naming the missing input and
 *     makes ZERO network calls (sil-api's `empty_search_input` 400 is the
 *     authoritative backstop, but the cheap client guard saves the round-trip);
 *   - a filter-only request (e.g. `category` alone, no `query`) is ACCEPTED (UCP
 *     browse) and DOES reach the network — the guard must not over-reject;
 *   - the not-registered short-circuit: no tokens.json → terminal `not_registered`
 *     (recovery `sil_register`), ZERO network;
 *   - the token-log canary: on every path the stored token never appears in any
 *     logger call at any level.
 *
 * Hermetic via the `SIL_DATA_DIR` temp-dir override and the config-reset
 * machinery mirrored from the sil_whoami / sil_register unit tests.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - src/tools/catalog.ts#registerCatalogTools(api) registers a `sil_search`
 *     tool whose parameters are a Type.Object with `query` (optional) plus
 *     optional `category`, `price_min`, `price_max`, `cursor`, `limit`;
 *   - execute() returns a jsonResult; with neither query nor a filter it returns
 *     a structured validation error and calls no fetch; with a filter only it
 *     proceeds; with no tokens.json it returns a terminal not_registered hint and
 *     calls no fetch.
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

const TOOL = "sil_search";

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

/** Seed a valid token pair so the search proceeds past the not-registered guard. */
function seedTokens(access = "stored-at", refresh = "stored-rt"): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: access, refresh_token: refresh }),
    { mode: 0o600 },
  );
}

/** A 200 real (empty-match) envelope, so a forwarded request resolves cleanly. The
 * FLAT sil-api shape (`{ ucp, products, pagination }` — top level, no `result`
 * wrapper; `withUcpMeta(body)`), the only shape sil-api emits. */
function okEnvelopeFetch(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        ucp: { version: "0.1", status: "success" },
        products: [],
        pagination: { has_next_page: false },
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

/** Spy `fetch`, reply 200 empty-match, and capture the parsed request body of the
 * single outbound call into `captured[0]`. Used by the `readSearchParams`
 * narrowing tests, which assert a wrong-typed param is DROPPED before it reaches
 * the wire body (the read-site guard, exercised through the real tool execute). */
function captureBodyFetch(captured: unknown[]): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation((_input: unknown, init?: RequestInit) => {
    if (typeof init?.body === "string") {
      try {
        captured.push(JSON.parse(init.body));
      } catch {
        captured.push(init.body);
      }
    } else {
      captured.push(null);
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ucp: { version: "0.1", status: "success" },
          products: [],
          pagination: { has_next_page: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-search-unit-"));
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

describe("sil_search — tool registration shape", () => {
  it("registers a sil_search tool with a typed query + optional filter/pagination params", () => {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    expect(tool.label.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
    // A TypeBox object whose properties include the simplified search inputs.
    expect((tool.parameters as { type?: unknown }).type).toBe("object");
    const props = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    const keys = Object.keys(props);
    for (const expected of ["query", "category", "price_min", "price_max", "cursor", "limit"]) {
      expect(keys).toContain(expected);
    }
  });
});

/**
 * Card `add-ship-to-filter-args-to-the-sil-search-tool`: the schema gains four
 * optional serviceability/localization params, each with a self-describing
 * per-field `description` (agents read field descriptions independently of the
 * tool description, so each must stand alone). Shapes pinned to the architect's
 * immutable contract + the Shopify Global-Catalog extension
 * (`vendor/shopify/docs/agents/catalog/global-catalog-extension.md:26-33`):
 *   - `ship_to`     : object { country (required), region?, postal_code? }
 *   - `ships_from`  : object { country (required) }
 *   - `condition`   : array of strings
 *   - `available`   : boolean
 * All four are `Type.Optional` — the whole param is omittable; `country` is
 * required only WITHIN the ship_to/ships_from objects.
 */
describe("sil_search — schema exposes the four new optional filter params (shapes + per-field descriptions)", () => {
  function searchProps(): Record<string, Record<string, unknown>> {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as {
      properties?: Record<string, Record<string, unknown>>;
    };
    return params.properties ?? {};
  }

  it("declares ship_to / ships_from / condition / available as properties", () => {
    const keys = Object.keys(searchProps());
    for (const expected of ["ship_to", "ships_from", "condition", "available"]) {
      expect(keys).toContain(expected);
    }
  });

  it("ship_to is an object whose `country` is required, with optional region + postal_code", () => {
    const shipTo = searchProps()["ship_to"];
    expect(shipTo).toBeDefined();
    expect(shipTo!["type"]).toBe("object");
    const sub = (shipTo!["properties"] ?? {}) as Record<string, unknown>;
    for (const k of ["country", "region", "postal_code"]) {
      expect(Object.keys(sub)).toContain(k);
    }
    // `country` is required WITHIN the object (the override needs a destination);
    // region/postal_code are optional refinements.
    expect(shipTo!["required"]).toEqual(["country"]);
  });

  it("ships_from is an object whose `country` is required", () => {
    const shipsFrom = searchProps()["ships_from"];
    expect(shipsFrom).toBeDefined();
    expect(shipsFrom!["type"]).toBe("object");
    const sub = (shipsFrom!["properties"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(sub)).toContain("country");
    expect(shipsFrom!["required"]).toEqual(["country"]);
  });

  it("condition is an array of strings", () => {
    const condition = searchProps()["condition"];
    expect(condition).toBeDefined();
    expect(condition!["type"]).toBe("array");
    const items = (condition!["items"] ?? {}) as Record<string, unknown>;
    expect(items["type"]).toBe("string");
  });

  it("available is a boolean", () => {
    const available = searchProps()["available"];
    expect(available).toBeDefined();
    expect(available!["type"]).toBe("boolean");
  });

  it("each new param carries a non-empty, self-describing `description`", () => {
    const props = searchProps();
    for (const k of ["ship_to", "ships_from", "condition", "available"]) {
      expect(props[k]).toBeDefined();
      const desc = props[k]!["description"];
      expect(typeof desc).toBe("string");
      expect((desc as string).length).toBeGreaterThan(0);
    }
  });

  it("the ship_to field description repeats the empty=registered-default / override framing (agents read field descriptions in isolation)", () => {
    // The architect's contract: the per-field description must stand alone, since
    // an agent may read it without the tool description. It must convey BOTH that
    // omitting it uses the registered/default address AND that it is an override.
    const shipTo = searchProps()["ship_to"];
    expect(shipTo).toBeDefined();
    const desc = String(shipTo!["description"] ?? "").toLowerCase();
    expect(desc).toMatch(/default|registered|omit|leave.*empty|absent/);
    expect(desc).toMatch(/override|different|else|another/);
  });
});

/**
 * THE LOAD-BEARING DELIVERABLE (card Intent + handoff contract #6): the tool
 * `description` is the only lever that steers the agent off the redundant
 * `sil_whoami` round-trip. These assertions pin the two required steering phrases
 * so a future edit cannot silently delete the round-trip-avoidance contract.
 * Asserted against the registered `description` string — the same surface the
 * agent reads and the same pattern the suite already uses for tool strings.
 */
describe("sil_search — description encodes the empty=registered-default steering contract (load-bearing)", () => {
  function description(): string {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    return getTool(api, TOOL).description;
  }

  it("states that leaving ship_to empty/absent uses the user's REGISTERED DEFAULT address, resolved server-side by sil-api", () => {
    const d = description().toLowerCase();
    // The empty=registered-default contract: it must name the registered/default
    // address as what an omitted ship_to resolves to, server-side.
    expect(d).toMatch(/registered|default/);
    expect(d).toMatch(/address/);
    // And tie that resolution to the server / sil-api (not the plugin/agent).
    expect(d).toMatch(/server|sil-api|sil api/);
  });

  it("explicitly steers the agent AWAY from calling sil_whoami merely to populate ship_to (names the anti-pattern)", () => {
    // The headline: the description must name `sil_whoami` and tell the agent NOT
    // to call it just to fetch an address to resubmit. This is the exact waste the
    // card exists to kill; a vague description leaves the agent reflexively
    // round-tripping. The negative framing ("do not"/"don't"/"never"/"no need")
    // must co-occur with the sil_whoami reference.
    const d = description();
    expect(d).toMatch(/sil_whoami/);
    expect(d.toLowerCase()).toMatch(/do not|don't|never|no need|avoid|without/);
  });

  it("frames ship_to as an OVERRIDE — supplied only to ship to a DIFFERENT destination, not as a required input", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/ship_to/);
    expect(d).toMatch(/override|different|else|another destination|elsewhere/);
  });

  it("documents ships_from, condition, and available each as optional filters by what they constrain (no implied prior tool call)", () => {
    const d = description().toLowerCase();
    // origin country / product condition / availability — each named.
    expect(d).toMatch(/ships_from/);
    expect(d).toMatch(/origin|seller|merchant|ships from/);
    expect(d).toMatch(/condition/);
    expect(d).toMatch(/new|used|secondhand|condition/);
    expect(d).toMatch(/available|availability|unavailable|in stock|out of stock/);
  });
});

describe("sil_search — client-side ≥1-input guard (reject empty BEFORE any network)", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A token IS present (so the guard, not the not-registered path, is what
    // rejects); fetch fails loudly if the guard lets an empty request through.
    seedTokens();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("empty request must not hit the network"));
    api = createMockPluginApi();
    registerCatalogTools(api);
  });

  it("a bare {} → structured validation error, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    expect(fetchSpy).not.toHaveBeenCalled();
    // A distinct, actionable validation error naming the missing input.
    expect(payload["status"]).not.toBe("ok");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/query|filter/);
    expect(blob).toMatch(/status|error|invalid/);
  });

  it("a whitespace-only query with NO filter → validation error, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "   " }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).not.toBe("ok");
    expect(JSON.stringify(payload).toLowerCase()).toMatch(/query|filter/);
  });

  it("an empty-string query with NO filter → validation error, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).not.toBe("ok");
  });
});

describe("sil_search — the guard does NOT over-reject a valid filter-only browse", () => {
  it("a filter-only request (category, no query) PROCEEDS to the network (UCP browse)", async () => {
    seedTokens();
    const fetchSpy = okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { category: "Furniture" }));

    // The guard must NOT reject a filter-only browse — it reaches the network.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload["status"]).toBe("ok");
  });

  it("a price-filter-only request (price_min, no query/category) PROCEEDS to the network", async () => {
    seedTokens();
    const fetchSpy = okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { price_min: 5000 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * `readSearchParams` (catalog.ts) narrows the untrusted, host-provided params.
 * Card AC[unit]: a field of the WRONG type at the read site (a drifted on-disk
 * call) is DROPPED — treated as absent — never coerced, mirroring the existing
 * `readIds` discipline (no `any`, no unchecked cast). A dropped field must not
 * reach the wire body. Exercised through the real tool execute with a
 * body-capturing fetch spy (tool-boundary unit: mock api + temp dir + spied
 * fetch). A real `query` rides alongside so the request clears the input guard
 * and the malformed filter's ABSENCE in the body is observable.
 */
describe("sil_search — readSearchParams drops wrong-typed new filter args (narrowing, no coercion)", () => {
  it("`available` as a string is dropped (not coerced to a boolean) — no filters.available on the wire", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    // `available: "true"` is the wrong type. It must NOT become filters.available.
    await getTool(api, TOOL).execute("c1", { query: "chair", available: "true" });

    const body = bodies[0] as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("available");
  });

  it("`condition` as a non-array (bare string) is dropped — no filters.condition on the wire", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", condition: "new" });

    const body = bodies[0] as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("condition");
  });

  it("`ship_to` as a primitive (string) is dropped — no filters.ships_to on the wire", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", ship_to: "US" });

    const body = bodies[0] as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("ships_to");
    expect(filters).not.toHaveProperty("ship_to");
  });

  it("`ships_from` as a primitive (number) is dropped — no filters.ships_from on the wire", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", ships_from: 42 });

    const body = bodies[0] as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("ships_from");
  });

  it("a valid `available: false` STILL survives the read site (the drop is type-driven, not value-driven)", async () => {
    // Guards against an over-eager narrowing that drops false along with the
    // wrong-typed cases. false is a VALID boolean and must reach the wire.
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", available: false });

    const body = bodies[0] as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).toHaveProperty("available", false);
  });
});

describe("sil_search — not registered (no tokens.json) short-circuit", () => {
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
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).not.toBe("ok");
    expect(payload["products"]).toBeUndefined();
    expect(JSON.stringify(payload)).toContain("sil_register");
  });

  it("does NOT crash and resolves promptly when not registered", async () => {
    const result = await getTool(api, TOOL).execute("c1", { query: "chair" });
    expect(result).toBeTypeOf("object");
    expect(result.content[0]?.text).toBeTypeOf("string");
  });
});

describe("sil_search — token never logged (leak-canary)", () => {
  it("on the SUCCESS path, no logger call carries the access token", async () => {
    seedTokens("leak-canary-access", "leak-canary-refresh");
    okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair" });

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

    await getTool(api, TOOL).execute("c1", { query: "chair" });

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

    const blob = JSON.stringify(payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" })));
    expect(blob).not.toContain("secret-access-token");
    expect(blob).not.toContain("secret-refresh-token");
    expect(blob).not.toMatch(/Bearer/i);
    expect(blob).not.toMatch(/authorization/i);
  });
});
