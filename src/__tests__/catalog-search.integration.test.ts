/**
 * INTEGRATION — sil_search read against sil-api (tier: integration).
 *
 * The real `sil_search` tool wired through the real sil-client (`searchCatalog`
 * + `classifySearchResponse` + the read-subset normalizer) and the real
 * credentials module. The ONLY thing mocked is `fetch` — the host/network
 * boundary. There is no live sil-api or Postgres in this repo; the true
 * cross-service guarantee (a real catalog over the wire from a live sil-api) is
 * sil-stage's deferred e2e (goal SC9). Here we prove the whole PLUGIN-SIDE
 * contract — param→request mapping, the three-distinct-outcomes taxonomy,
 * empty-match-is-success, cursor hoist, and token privacy — against a mocked
 * boundary, exactly as whoami's integration suite proved its read flow.
 *
 * TWO ORIGINS: the search read targets the resolved **sil-api** origin
 * (`getSilApiUrl`), at the BARE path `/catalog/search` — NOT `/api/v1`. On a 401
 * the tool now refreshes transparently against the **sil-web** origin
 * (`getApiUrl`, via the real `refreshStoredTokens`) and retries the search ONCE —
 * the SAME refresh-and-retry-once choreography `sil_whoami` performs (this card
 * makes 401 recovery uniform across every sil-api-calling tool; FLAG-10). Both
 * origins are pinned to distinct known hosts so the origin + path assertions are
 * exact, and a misfire is caught.
 *
 * Wire shapes pinned to the ALREADY-MERGED sil-api contract (sil-services
 * `@sil/schemas` `packages/schemas/src/catalog.ts` + `envelope.ts` +
 * `services/sil-api/src/handlers/catalog.ts`):
 *   request body (CatalogSearchRequest, additionalProperties:false):
 *     { query?, filters?: { categories?: string[], price?: { min?, max? } },
 *       pagination?: { cursor?, limit? }, context? }
 *   response (200): the UCP envelope buildEnvelope emits, whose `result` is a
 *     CatalogSearchResult { products: SilCatalogProduct[], pagination?, messages? }.
 *   400 { error: "empty_search_input", message }  → invalid_request envelope
 *   401                                           → refresh-and-retry-once (see below)
 *   500 / network / timeout                       → retryable envelope
 *
 *   refresh (sil-web):  POST <sil-web>/api/v1/auth/refresh { refresh_token }
 *     200 { access_token, refresh_token }         → rotate tokens.json, retry once
 *     401 { error: "invalid_grant" }              → terminal re-register, tokens cleared
 *     5xx / network                               → transient retryable, NO retry
 *
 * THE anti-false-green (complete-work-is-stub-free): the happy-path mock returns
 * the REAL `SilCatalogProduct` envelope shape (each product with a required
 * `source`, each variant with a non-empty `checkout_url` and an `availability`
 * object). The suite asserts the tool surfaces the normalized products — so it
 * is UNABLE to go green against the skeleton stub `{ stub: true, tool, echo }`.
 *
 * Contract pinned for the implementation (expert-developer):
 *   - registerCatalogTools(api) registers `sil_search`; execute(callId, params)
 *     reads tokens.json, POSTs <sil-api>/catalog/search with the mapped body and
 *     Authorization: Bearer <at>, then maps the SearchOutcome to a jsonResult.
 *   - not-registered (no tokens.json) → terminal `not_registered`, ZERO network.
 *   - the access token travels ONLY in the Authorization header — never in a log
 *     line and never in the result.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../tools/catalog.js";
import { setApiUrl, setSilApiUrl, getApiUrl, getSilApiUrl } from "../lib/config.js";
import { getDataDir, getTokensPath, readTokens } from "../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

const TOOL = "sil_search";
const SIL_WEB = "https://sil-web.test.example.com"; // auth origin — must NOT be hit
const SIL_API = "https://sil-api.test.example.com"; // catalog-read origin

/** A real `SilCatalogVariant` (UCP variant + required non-empty `checkout_url`,
 * `availability` as the UCP object). */
const VARIANT_A1 = {
  id: "gid://variant/a1",
  title: "Aeron Chair — Graphite, Size B",
  description: { plain: "An ergonomic office chair." },
  price: { amount: 159900, currency: "USD" },
  availability: { available: true, status: "in_stock" },
  checkout_url: "https://buy.example.com/aeron-a1",
};

/** A second variant on the SAME product — the tool must surface the FIRST. */
const VARIANT_A2 = {
  id: "gid://variant/a2",
  title: "Aeron Chair — Carbon, Size C",
  description: { plain: "An ergonomic office chair." },
  price: { amount: 169900, currency: "USD" },
  availability: { available: false, status: "out_of_stock" },
  checkout_url: "https://buy.example.com/aeron-a2",
};

const PRODUCT_A = {
  id: "gid://product/a",
  title: "Aeron Chair",
  description: { plain: "An ergonomic office chair." },
  price_range: {
    min: { amount: 159900, currency: "USD" },
    max: { amount: 169900, currency: "USD" },
  },
  variants: [VARIANT_A1, VARIANT_A2],
  source: "herman-miller",
};

const PRODUCT_B = {
  id: "gid://product/b",
  title: "Standing Desk",
  description: { plain: "A height-adjustable desk." },
  price_range: {
    min: { amount: 89900, currency: "USD" },
    max: { amount: 89900, currency: "USD" },
  },
  variants: [
    {
      id: "gid://variant/b1",
      title: "Standing Desk — Oak",
      description: { plain: "A height-adjustable desk." },
      price: { amount: 89900, currency: "USD" },
      availability: { available: true, status: "in_stock" },
      checkout_url: "https://buy.example.com/desk-b1",
    },
  ],
  source: "uplift",
};

/** The REAL sil-api search envelope (buildEnvelope output). The presence of a
 * required `source` per product and a non-empty `checkout_url` per variant is
 * what makes the suite anti-false-green: a `{ stub: true }` echo carries none of
 * these, so the assertions below cannot pass against the skeleton stub. */
function searchEnvelope(
  products: unknown[],
  pagination: unknown = { has_next_page: false },
): unknown {
  return {
    protocol: "ucp",
    version: "0.1",
    domain: "catalog",
    request_id: "req-int-1",
    issued_at: "2026-06-09T00:00:00.000Z",
    enrichment: { agent_id: "auth0|abc", on_behalf_of: "auth0|abc", enriched: true, source: "sil-api" },
    result: { products, pagination },
  };
}

let dataDir: string;
let priorSilDataDir: string | undefined;

/** One recorded outbound request. */
interface Recorded {
  url: string;
  method: string;
  bearer: string | null;
  /** The parsed request body, or null when none was sent. */
  body: unknown;
  /** Whether a request body was present at all (a search POST carries one). */
  hasBody: boolean;
}

type Reply = { status: number; body: unknown } | "network-error";

/**
 * A URL-routing fetch double cloned from whoami.integration.test.ts. `reply(kind,
 * nthOfKind, req)` decides each response given whether the request is a `search`
 * (sil-api /catalog/search), a `refresh` (sil-web /auth/refresh — the transparent
 * 401 recovery leg, reached via the real `refreshStoredTokens`), or `other`.
 * Records every request (url, method, bearer, body) so origin, path, the Bearer
 * header, the mapped body, and call COUNTS (including "exactly one refresh") are
 * all assertable. The `refresh` bucket is what makes the no-storm bound testable.
 */
function installRouter(
  reply: (
    kind: "search" | "refresh" | "other",
    nthOfKind: number,
    req: Recorded,
  ) => Reply,
): { all: Recorded[]; search: Recorded[]; refresh: Recorded[] } {
  const all: Recorded[] = [];
  const search: Recorded[] = [];
  const refresh: Recorded[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const bearer = headers["Authorization"] ?? headers["authorization"] ?? null;
      const method = (init?.method ?? "GET").toUpperCase();
      const hasBody = init?.body !== undefined && init?.body !== null;
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const req: Recorded = { url, method, bearer, body, hasBody };
      all.push(req);

      // Order matters: /auth/refresh is the sil-web leg; /catalog/search the
      // sil-api leg. Check refresh first so a future shared path can't be
      // misrouted to `search`.
      let kind: "search" | "refresh" | "other";
      if (url.includes("/auth/refresh")) kind = "refresh";
      else if (url.includes("/catalog/search")) kind = "search";
      else kind = "other";

      let nthOfKind: number;
      if (kind === "search") {
        search.push(req);
        nthOfKind = search.length - 1;
      } else if (kind === "refresh") {
        refresh.push(req);
        nthOfKind = refresh.length - 1;
      } else {
        nthOfKind = all.length - 1;
      }

      const r = reply(kind, nthOfKind, req);
      if (r === "network-error") {
        return Promise.reject(new Error("simulated network failure"));
      }
      return Promise.resolve(
        new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  );

  return { all, search, refresh };
}

/** Parse a ToolResult payload. */
function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("no tool payload");
  return JSON.parse(text) as Record<string, unknown>;
}

/** Seed a stored token pair so the search proceeds to the read. */
function seedTokens(access: string, refresh: string): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: access, refresh_token: refresh }),
    { mode: 0o600 },
  );
}

/** The Bearer token value carried on a recorded request (stripped of scheme). */
function bearerToken(req: Recorded): string | null {
  if (req.bearer === null) return null;
  return req.bearer.replace(/^Bearer\s+/i, "");
}

/** Collect every argument to every logger level, serialized. */
function logBlob(api: MockPluginAPI): string {
  return [api.logger.info, api.logger.warn, api.logger.error, api.logger.debug]
    .flatMap((fn) => vi.mocked(fn).mock.calls.map((c) => JSON.stringify(c)))
    .join("\n");
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-search-int-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  // Pin BOTH origins to distinct known hosts so the origin/path assertions are
  // exact and a misfire onto sil-web is caught.
  setApiUrl(SIL_WEB);
  setSilApiUrl(SIL_API);
});

afterEach(() => {
  vi.restoreAllMocks();
  setApiUrl("");
  setSilApiUrl("");
  delete process.env["SIL_API_URL"];
  delete process.env["SIL_API_BASE"];
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("sil_search — param → request mapping (bare path, sil-api origin, Bearer)", () => {
  it("POSTs the BARE /catalog/search path on the sil-api origin (NOT /api/v1, NOT sil-web)", async () => {
    seedTokens("the-access-token", "the-refresh-token");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "office chair" });

    expect(rec.search.length).toBe(1);
    const req = rec.search[0]!;
    // Bare path — no /api/v1 anywhere (Fact Correction 1).
    const u = new URL(req.url);
    expect(u.pathname).toBe("/catalog/search");
    expect(req.url).not.toContain("/api/v1");
    // sil-api origin, NOT sil-web.
    expect(u.origin).toBe(new URL(getSilApiUrl()).origin);
    expect(u.origin).not.toBe(new URL(getApiUrl()).origin);
    // It is a POST carrying a body, with the stored Bearer token.
    expect(req.method).toBe("POST");
    expect(req.hasBody).toBe(true);
    expect(bearerToken(req)).toBe("the-access-token");
  });

  it("maps the simplified params to the sil-api body EXACTLY (no envelope, no defaults, category→categories[], price→{min,max})", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", {
      query: "office chair",
      category: "Furniture",
      price_min: 10000,
      price_max: 200000,
      cursor: "cur-1",
      limit: 25,
    });

    expect(rec.search.length).toBe(1);
    const body = rec.search[0]!.body as Record<string, unknown>;
    // Exact mapped body — the tool builds NO UCP envelope and fills NO defaults.
    expect(body).toEqual({
      query: "office chair",
      filters: { categories: ["Furniture"], price: { min: 10000, max: 200000 } },
      pagination: { cursor: "cur-1", limit: 25 },
    });
    // Belt-and-braces: it did NOT smuggle a client-built envelope or context.
    expect(body["protocol"]).toBeUndefined();
    expect(body["domain"]).toBeUndefined();
    expect(body["context"]).toBeUndefined();
    expect(body["enrichment"]).toBeUndefined();
  });

  it("omits filters/pagination keys the agent did NOT supply (no defaults injected)", async () => {
    // Only a bare `query` is supplied. The mapped body must carry `query` and no
    // empty `filters`/`pagination`/`price` skeletons — the tool fills no defaults.
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "lamp" });

    const body = rec.search[0]!.body as Record<string, unknown>;
    expect(body["query"]).toBe("lamp");
    // No injected empty filter/pagination objects.
    expect(body["filters"]).toBeUndefined();
    expect(body["pagination"]).toBeUndefined();
  });

  it("a filter-ONLY request (category, no query) is forwarded as a browse — no query key, no local rejection", async () => {
    // UCP allows omitting `query` when a filter is present. The tool must forward
    // it (not reject it) and must not invent an empty query.
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { category: "Furniture" }),
    );

    expect(rec.search.length).toBe(1); // forwarded, not locally rejected
    const body = rec.search[0]!.body as Record<string, unknown>;
    expect(body["filters"]).toEqual({ categories: ["Furniture"] });
    expect(body["query"]).toBeUndefined();
    expect(payload["status"]).toBe("ok");
  });
});

describe("sil_search — happy path normalizes the REAL envelope (anti-false-green)", () => {
  it("returns status ok with ranked products, each carrying ONE projected variant + source", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A, PRODUCT_B], { has_next_page: false }) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    // The product promise — surfaced from the REAL envelope. A `{ stub: true }`
    // echo would carry NONE of these markers, so this can't go green on a stub.
    const blob = JSON.stringify(payload);
    expect(payload["status"]).toBe("ok");
    expect(blob).not.toContain('"stub"'); // never the skeleton stub shape
    const products = payload["products"] as Array<Record<string, unknown>>;
    expect(Array.isArray(products)).toBe(true);
    expect(products).toHaveLength(2);
    // Server order preserved (best-match first; the tool does NOT re-rank).
    expect(products[0]!["id"]).toBe("gid://product/a");
    expect(products[1]!["id"]).toBe("gid://product/b");
    // First (featured) variant only, projected to the six fields, with source.
    const v = products[0]!["variant"] as Record<string, unknown>;
    expect(v["id"]).toBe("gid://variant/a1"); // a1, never a2
    expect(v["checkout_url"]).toBe("https://buy.example.com/aeron-a1");
    expect(v["price"]).toEqual({ amount: 159900, currency: "USD" });
    expect(products[0]!["source"]).toBe("herman-miller");
    // availability passed through as the UCP object, not flattened to a boolean.
    const avail = v["availability"] as Record<string, unknown>;
    expect(typeof avail).toBe("object");
    expect(avail["available"]).toBe(true);
    expect(avail["status"]).toBe("in_stock");
  });

  it("hoists result.pagination.cursor to a top-level cursor when has_next_page is true", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? {
            status: 200,
            body: searchEnvelope([PRODUCT_A], { has_next_page: true, cursor: "next-page-cur" }),
          }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("ok");
    expect(payload["cursor"]).toBe("next-page-cur");
  });

  it("returns NO cursor on the last page (has_next_page:false) — end-of-results is the absent cursor", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A, PRODUCT_B], { has_next_page: false }) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("ok");
    // No cursor even though the page is full — paging is cursor-driven, not length-driven.
    expect(payload["cursor"]).toBeUndefined();
  });
});

describe("sil_search — the three distinct sil-api outcomes surface as three distinguishable envelopes", () => {
  it("empty match: 200 { result: { products: [] } } → status ok, products [], NO cursor, NO recovery hint (NOT an error)", async () => {
    // UCP: an empty search returns an empty array — "this is not an error". This
    // is the SUCCESS arm, distinct from the 400/500 error arms below.
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([], { has_next_page: false }) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "nonexistent-xyzzy" }));

    expect(payload["status"]).toBe("ok");
    expect(payload["products"]).toEqual([]);
    expect(payload["cursor"]).toBeUndefined();
    // An empty match is NOT an error — no recovery hint, no error status.
    expect(payload["recovery"]).toBeUndefined();
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).not.toMatch(/sil_register/);
  });

  it("invalid request: 400 empty_search_input → invalid_request envelope carrying {error, message}, distinct from empty-match + transient", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? {
            status: 400,
            body: {
              error: "empty_search_input",
              message: "Provide a search query or at least one filter.",
            },
          }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "  " }));

    // A distinct, structured invalid_request — not the empty-match success, not
    // a transient. Surfaces sil-api's structured {error, message}.
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["status"]).not.toBe("ok");
    expect(payload["status"]).not.toBe("retryable");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/query|filter|empty_search_input/);
    // Not framed as a transient "try again" — a bad request won't fix itself.
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("source failure: 500 → retryable envelope, NO recovery:sil_register, distinct from the 401 + invalid_request arms", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? {
            status: 500,
            body: { error: "source_unavailable", message: "The catalog source is temporarily unavailable." },
          }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("retryable");
    // Transient — try again, NOT re-register (re-registering can't fix a 5xx).
    expect(payload["recovery"]).not.toBe("sil_register");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).not.toMatch(/sil_register/);
    expect(blob).toMatch(/retry|try.again|temporar|unavailable|later/);
  });

  it("the three sil-api outcomes (empty 200 / 400 / 500) map to THREE distinct status strings", async () => {
    // The load-bearing distinguishability assertion: run all three against the
    // real wiring and confirm the agent-facing `status` differs for each.
    async function statusFor(reply: Reply): Promise<unknown> {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "search" ? reply : { status: 200, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "x" }));
      vi.restoreAllMocks();
      return payload["status"];
    }

    const emptyMatch = await statusFor({ status: 200, body: searchEnvelope([]) });
    const invalid = await statusFor({ status: 400, body: { error: "empty_search_input", message: "x" } });
    const sourceFail = await statusFor({ status: 500, body: { error: "source_unavailable", message: "x" } });

    expect(new Set([emptyMatch, invalid, sourceFail]).size).toBe(3);
    expect(emptyMatch).toBe("ok");
    expect(invalid).toBe("invalid_request");
    expect(sourceFail).toBe("retryable");
  });

  it("network error / timeout (thrown fetch) → retryable, distinct from the empty-match success", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) => (kind === "search" ? "network-error" : { status: 200, body: {} }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(rec.search.length).toBe(1); // one round-trip attempted
    expect(payload["status"]).toBe("retryable");
    expect(payload["status"]).not.toBe("ok");
  });
});

describe("sil_search — 401 → transparent refresh-and-retry-once (outcome 1: the agent never sees the 401)", () => {
  it("401 → refresh once via sil-web → rotate tokens.json → retry the search once with the NEW token → normal ranked result", async () => {
    // AC[integration]: outcome 1 — a registered agent whose access token is
    // expired gets a NORMAL ranked result, indistinguishable from a call that
    // never 401'd. This is the choreography sil_whoami already performs; the card
    // brings sil_search onto it. EXPECT RED against current code (catalog.ts 401 is
    // terminal mustReregister, no refresh) and GREEN once it routes through the
    // shared refreshAndRetryOnce helper.
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind, nth) => {
      if (kind === "search") {
        // First search 401 (expired); second (after refresh) returns products.
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: searchEnvelope([PRODUCT_A]) };
      }
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    // The agent sees a normal success — NOT a re-register, NOT an empty.
    expect(payload["status"]).toBe("ok");
    const products = payload["products"] as Array<Record<string, unknown>>;
    expect(Array.isArray(products)).toBe(true);
    expect(products).toHaveLength(1);
    expect(products[0]!["id"]).toBe("gid://product/a");
    // The refresh is INVISIBLE: no refreshed/retried marker, no recovery hint.
    expect(payload["refreshed"]).toBeUndefined();
    expect(payload["retried"]).toBeUndefined();
    expect(payload["recovery"]).toBeUndefined();
    // The retry carried the ROTATED access token (proves the re-read after rotation).
    expect(rec.search.length).toBe(2);
    expect(bearerToken(rec.search[1]!)).toBe("rotated-at");
    // The refresh used the STORED refresh token.
    expect(rec.refresh.length).toBe(1);
    expect((rec.refresh[0]!.body as { refresh_token?: string }).refresh_token).toBe("valid-rt");
  });

  it("makes EXACTLY one refresh (sil-web) + EXACTLY two catalog reads (the failed read + one retry) — no loop, no storm", async () => {
    // AC[integration]: the silent path does not loop or storm. Exactly 1 refresh
    // + 2 catalog calls on a recovered 401.
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind, nth) => {
      if (kind === "search") {
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: searchEnvelope([PRODUCT_A]) };
      }
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair" });

    expect(rec.search.length).toBe(2); // failed read + exactly one retry
    expect(rec.refresh.length).toBe(1); // exactly one refresh, never more
    // The refresh hit sil-web; the searches hit sil-api — origins asserted apart.
    const silApiOrigin = new URL(getSilApiUrl()).origin;
    const silWebOrigin = new URL(getApiUrl()).origin;
    for (const r of rec.search) expect(new URL(r.url).origin).toBe(silApiOrigin);
    for (const r of rec.refresh) expect(new URL(r.url).origin).toBe(silWebOrigin);
    // No Auth0 contacted on any path (sil-web is the sole auth authority).
    for (const r of rec.all) expect(r.url).not.toMatch(/auth0\.com/i);
  });

  it("persists the rotated pair to tokens.json and leaks NO token to the result or any log line", async () => {
    // AC[integration]: tokens.json holds the rotated pair, and neither old nor new
    // token value appears in any logger call or the returned payload.
    const ROT_AT = "rotated-secret-access";
    const ROT_RT = "rotated-secret-refresh";
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind, nth) => {
      if (kind === "search") {
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: searchEnvelope([PRODUCT_A]) };
      }
      if (kind === "refresh") return { status: 200, body: { access_token: ROT_AT, refresh_token: ROT_RT } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    // tokens.json now holds the rotated pair (the refresh persisted).
    const tokens = readTokens();
    expect(tokens!.access_token).toBe(ROT_AT);
    expect(tokens!.refresh_token).toBe(ROT_RT);
    // The rotated token reached the retry's Authorization header, and ONLY there.
    expect(bearerToken(rec.search[1]!)).toBe(ROT_AT);
    // No token (old or rotated) in the result.
    const resultBlob = JSON.stringify(payload);
    expect(resultBlob).not.toContain(ROT_AT);
    expect(resultBlob).not.toContain(ROT_RT);
    expect(resultBlob).not.toContain("valid-rt");
    expect(resultBlob).not.toContain("expired-at");
    // No token in any log line, and never a Bearer string.
    const logs = logBlob(api);
    expect(logs).not.toContain(ROT_AT);
    expect(logs).not.toContain(ROT_RT);
    expect(logs).not.toContain("valid-rt");
    expect(logs).not.toContain("expired-at");
    expect(logs).not.toMatch(/Bearer/i);
    // Nor in any request BODY (the credential rides only the header).
    for (const r of [...rec.search, ...rec.refresh]) {
      const b = JSON.stringify(r.body ?? {});
      expect(b).not.toContain(ROT_AT);
      expect(b).not.toContain("expired-at");
    }
  });
});

describe("sil_search — 401 → second 401 / dead refresh is terminal (outcome 2: re-register, refreshed at most once)", () => {
  it("refresh OK but the retried read is ALSO 401 → terminal re-register, exactly ONE refresh (a freshly-rotated-still-401 is structurally dead)", async () => {
    // AC[integration]: the no-storm bound. A retry that is still 401 must be
    // terminal, never a second refresh.
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind) => {
      // Search ALWAYS 401 (even after a good refresh — structurally dead).
      if (kind === "search") return { status: 401, body: { error: "unauthorized" } };
      // Refresh succeeds (rotates), so the tool DOES retry once.
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    // Exactly: search(401) → refresh(200) → retry-search(401) → STOP.
    expect(rec.search.length).toBe(2); // initial + exactly one retry
    expect(rec.refresh.length).toBe(1); // exactly one refresh, NEVER a second
    // Terminal, actionable re-register — not a success, not a silent empty.
    expect(payload["status"]).toBe("must_reregister");
    expect(payload["products"]).toBeUndefined();
    expect(payload["recovery"]).toBe("sil_register");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/re-?register|sil_register|session.*expired/);
  });

  it("refresh returns invalid_grant (sil-web 401) → terminal re-register, tokens.json cleared, NO catalog retry", async () => {
    // AC[integration]: a dead refresh token. Terminal re-register, the dead pair
    // cleared (so the agent's sil_register recovery is not blocked by stale
    // presence), and NO retry of the search (there is no rotated token to retry).
    seedTokens("expired-at", "dead-rt");
    const rec = installRouter((kind) => {
      if (kind === "search") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("must_reregister");
    expect(payload["recovery"]).toBe("sil_register");
    // No retry after a failed refresh — exactly ONE search (the original 401) +
    // ONE refresh. (A retry with no rotated token is a bug.)
    expect(rec.search.length).toBe(1);
    expect(rec.refresh.length).toBe(1);
    // The confirmed-dead pair is cleared so sil_register does not short-circuit.
    expect(existsSync(getTokensPath())).toBe(false);
    expect(readTokens()).toBeNull();
  });

  it("the second-401 / dead-refresh terminal leaks NO token to any log line or the payload", async () => {
    // AC[integration]: privacy holds on the terminal path too.
    seedTokens("expired-at", "dead-rt");
    installRouter((kind) => {
      if (kind === "search") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    const resultBlob = JSON.stringify(payload);
    expect(resultBlob).not.toContain("expired-at");
    expect(resultBlob).not.toContain("dead-rt");
    const logs = logBlob(api);
    expect(logs).not.toContain("expired-at");
    expect(logs).not.toContain("dead-rt");
    expect(logs).not.toMatch(/Bearer/i);
  });
});

describe("sil_search — 401 → transient refresh failure is 'try again', NOT a re-register (outcome 3)", () => {
  it("the refresh leg returns 5xx → transient retryable, NO recovery:sil_register, NO catalog retry", async () => {
    // AC[integration]: a refresh-leg 5xx is a blip, not a dead session. The agent
    // is told to try again — re-registering would eject a still-valid session.
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind) => {
      if (kind === "search") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 503, body: { error: "unavailable" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).not.toMatch(/sil_register/);
    expect(blob).toMatch(/retry|try.again|temporar|unavailable|later/);
    // The refresh was attempted once; the search was NOT retried (no rotated token).
    expect(rec.refresh.length).toBe(1);
    expect(rec.search.length).toBe(1);
    // Tokens are NOT cleared on a transient (the pair may be fine).
    expect(readTokens()).not.toBeNull();
  });

  it("the refresh leg throws (network error) → transient retryable, NO re-register, NO catalog retry", async () => {
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind) => {
      if (kind === "search") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return "network-error";
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("retryable");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
    expect(rec.refresh.length).toBe(1);
    expect(rec.search.length).toBe(1);
    expect(readTokens()).not.toBeNull();
  });

  it("a first-call 5xx (before any 401) keeps its existing transient outcome and attempts NO refresh (the refresh path is reachable only via a 401)", async () => {
    // AC[integration]: this card does NOT alter the non-401 branches. A 5xx on the
    // ORIGINAL search must NOT trigger the refresh path.
    seedTokens("at", "rt");
    const rec = installRouter((kind) => {
      if (kind === "search") return { status: 500, body: { error: "source_unavailable" } };
      return { status: 200, body: { access_token: "x", refresh_token: "y" } };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("retryable");
    expect(rec.search.length).toBe(1); // single round-trip
    expect(rec.refresh.length).toBe(0); // NO refresh — a first-call 5xx is not a 401
  });

  it("401 (terminal re-register) is DISTINCT from a refresh-leg 5xx (transient) — different recovery guidance", async () => {
    // The recovery-hint discriminator: a dead session (invalid_grant) carries the
    // sil_register hint; a transient refresh blip does NOT. The two must be
    // distinguishable envelopes for the same originating 401.
    async function payloadFor(refreshReply: Reply): Promise<Record<string, unknown>> {
      seedTokens("expired-at", "valid-rt");
      installRouter((kind) => {
        if (kind === "search") return { status: 401, body: { error: "unauthorized" } };
        if (kind === "refresh") return refreshReply;
        return { status: 500, body: {} };
      });
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { query: "x" }));
      vi.restoreAllMocks();
      return p;
    }

    const deadRefresh = await payloadFor({ status: 401, body: { error: "invalid_grant" } });
    const transientRefresh = await payloadFor({ status: 503, body: { error: "unavailable" } });

    expect(deadRefresh["status"]).not.toBe(transientRefresh["status"]);
    expect(JSON.stringify(deadRefresh).toLowerCase()).toMatch(/sil_register|re-?register/);
    expect(JSON.stringify(transientRefresh).toLowerCase()).not.toMatch(/sil_register/);
  });
});

describe("sil_search — not registered (no tokens.json) makes ZERO network calls", () => {
  it("returns a terminal not_registered hint (recovery sil_register) and never touches fetch", async () => {
    // No tokens seeded. A not-registered search has nothing to authenticate with,
    // so it must short-circuit BEFORE any network call (mirrors sil_whoami).
    const rec = installRouter(() => ({ status: 200, body: searchEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(rec.all.length).toBe(0); // ZERO network — nothing to authenticate with
    expect(payload["status"]).not.toBe("ok");
    expect(payload["products"]).toBeUndefined();
    expect(JSON.stringify(payload)).toContain("sil_register");
  });
});

describe("sil_search — the access token is sent on the read but NEVER leaks", () => {
  it("the Bearer token reaches the request header but NOT the result and NOT any log line", async () => {
    const AT = "search-secret-access-token";
    const RT = "search-secret-refresh-token";
    seedTokens(AT, RT);
    const rec = installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([PRODUCT_A]) } : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    // The token DID reach the only legitimate place: the Authorization header.
    expect(rec.search.length).toBe(1);
    expect(bearerToken(rec.search[0]!)).toBe(AT);
    // It is NOT echoed back to the agent in the result.
    const resultBlob = JSON.stringify(payload);
    expect(resultBlob).not.toContain(AT);
    expect(resultBlob).not.toContain(RT);
    expect(resultBlob).not.toMatch(/Bearer/i);
    expect(resultBlob).not.toMatch(/authorization/i);
    // And it never appears in any log line at any level.
    const logs = logBlob(api);
    expect(logs).not.toContain(AT);
    expect(logs).not.toContain(RT);
    expect(logs).not.toMatch(/Bearer/i);
    // The token must not ride in the request BODY either — only the header.
    const bodyBlob = JSON.stringify(rec.search[0]!.body ?? {});
    expect(bodyBlob).not.toContain(AT);
    expect(bodyBlob).not.toContain(RT);
  });

  it("on a network error, the access token still never appears in any log line", async () => {
    const AT = "leak-canary-on-network-error";
    seedTokens(AT, "rt");
    installRouter((kind) => (kind === "search" ? "network-error" : { status: 200, body: {} }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair" });

    const logs = logBlob(api);
    expect(logs).not.toContain(AT);
    expect(logs).not.toMatch(/Bearer/i);
  });
});
