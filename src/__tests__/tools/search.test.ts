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
import { setApiUrl, setSilApiUrl } from "../../lib/config.js";
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

/** A 200 real (empty-match) envelope, so a forwarded request resolves cleanly. */
function okEnvelopeFetch(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        protocol: "ucp",
        version: "0.1",
        domain: "catalog",
        result: { products: [], pagination: { has_next_page: false } },
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
  dataDir = mkdtempSync(join(tmpdir(), "sil-search-unit-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setApiUrl("");
  setSilApiUrl("");
  delete process.env["SIL_API_URL"];
  delete process.env["SIL_API_BASE"];
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  setApiUrl("");
  setSilApiUrl("");
  delete process.env["SIL_API_URL"];
  delete process.env["SIL_API_BASE"];
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
