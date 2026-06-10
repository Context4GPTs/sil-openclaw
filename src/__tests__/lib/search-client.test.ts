/**
 * UNIT — `searchCatalog` HTTP wrapper param→request mapping (tier: unit, `fetch`
 * spied so nothing reaches the network).
 *
 * Pins the request-construction half of the catalog client in isolation (the
 * classifier — the response half — is `search-classify.test.ts`). The wrapper
 * `searchCatalog(silApiUrl, token, params)` is the seam where the simplified
 * agent params become the sil-api `CatalogSearchRequest` body and the stored
 * Bearer token becomes the `Authorization` header — both load-bearing and both
 * cheaply assertable with a single `fetch` spy, exactly as `sil-client.test.ts`
 * pins `claimSession`/`refreshSession`.
 *
 * What this file locks down (the request side):
 *   - the URL is the BARE `${silApiUrl}/catalog/search` — no `/api/v1` (Fact
 *     Correction 1), trailing slash on the base tolerated;
 *   - the method is POST with a JSON content-type and an `Authorization: Bearer
 *     <token>` header;
 *   - the body maps EXACTLY: `query?` → top-level `query`; `category` (singular)
 *     → `filters.categories: [category]`; `price_min`/`price_max` →
 *     `filters.price: { min?, max? }`; `cursor`/`limit` → `pagination`; and the
 *     tool builds NO UCP envelope and injects NO defaults (no `context`, no empty
 *     `filters`/`pagination` skeletons for keys the agent omitted);
 *   - on a thrown fetch (network/timeout) the wrapper returns `retryable` and the
 *     token never appears in the returned union (the never-leak invariant at the
 *     wrapper boundary; the tool-level log canary is in `tools/catalog.test.ts`).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts`:
 *   searchCatalog(
 *     silApiUrl: string,
 *     token: string,
 *     params: {
 *       query?: string; category?: string;
 *       price_min?: number; price_max?: number;
 *       cursor?: string; limit?: number;
 *     },
 *   ): Promise<SearchOutcome>
 *   It POSTs the mapped `CatalogSearchRequest` to the bare `/catalog/search` with
 *   the Bearer header, then returns `classifySearchResponse(status, body)`. A
 *   thrown fetch → `{ kind: "retryable" }`. The exact param mapping below IS the
 *   immutable spec.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { searchCatalog } from "../../lib/sil-client.js";

const SIL_API = "https://sil-api.test.example.com";

interface Captured {
  url: string;
  method: string;
  bearer: string | null;
  contentType: string | null;
  body: unknown;
}

/** Spy `fetch` and capture the single outbound request, replying 200 with a real
 * (empty-match) envelope so the wrapper resolves cleanly. The reply is the FLAT
 * sil-api envelope (`{ ucp, products, pagination }` — top level, no `result`
 * wrapper; `withUcpMeta(body)`), the only shape sil-api emits. */
function spyFetch(captured: Captured[]): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      captured.push({
        url: typeof input === "string" ? input : String(input),
        method: (init?.method ?? "GET").toUpperCase(),
        bearer: headers["Authorization"] ?? headers["authorization"] ?? null,
        contentType: headers["content-type"] ?? headers["Content-Type"] ?? null,
        body,
      });
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
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchCatalog — endpoint, method, and auth header", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("POSTs the BARE /catalog/search path (no /api/v1 anywhere)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair" });
    expect(cap).toHaveLength(1);
    expect(new URL(cap[0]!.url).pathname).toBe("/catalog/search");
    expect(cap[0]!.url).not.toContain("/api/v1");
    expect(cap[0]!.url).toBe(`${SIL_API}/catalog/search`);
  });

  it("tolerates a trailing slash on the base URL (no double slash)", async () => {
    await searchCatalog(`${SIL_API}/`, "tok", { query: "chair" });
    expect(cap[0]!.url).toBe(`${SIL_API}/catalog/search`);
    expect(cap[0]!.url).not.toContain("//catalog");
  });

  it("uses POST with a JSON content-type and the stored Bearer token", async () => {
    await searchCatalog(SIL_API, "the-access-token", { query: "chair" });
    expect(cap[0]!.method).toBe("POST");
    expect(cap[0]!.contentType).toMatch(/application\/json/);
    expect(cap[0]!.bearer).toBe("Bearer the-access-token");
  });
});

describe("searchCatalog — param → CatalogSearchRequest body mapping (no envelope, no defaults)", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("maps a fully-specified request EXACTLY (category→categories[], price→{min,max}, cursor/limit→pagination)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "office chair",
      category: "Furniture",
      price_min: 10000,
      price_max: 200000,
      cursor: "cur-1",
      limit: 25,
    });
    expect(cap[0]!.body).toEqual({
      query: "office chair",
      filters: { categories: ["Furniture"], price: { min: 10000, max: 200000 } },
      pagination: { cursor: "cur-1", limit: 25 },
    });
  });

  it("builds NO UCP envelope and injects NO context (the agent sends a simplified request only)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair" });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body["protocol"]).toBeUndefined();
    expect(body["version"]).toBeUndefined();
    expect(body["domain"]).toBeUndefined();
    expect(body["enrichment"]).toBeUndefined();
    expect(body["context"]).toBeUndefined();
  });

  it("omits keys the agent did not supply — a bare query carries no empty filters/pagination", async () => {
    await searchCatalog(SIL_API, "tok", { query: "lamp" });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body).toEqual({ query: "lamp" });
    expect(body["filters"]).toBeUndefined();
    expect(body["pagination"]).toBeUndefined();
  });

  it("a filter-only request (category, no query) carries `filters` and NO `query` key", async () => {
    await searchCatalog(SIL_API, "tok", { category: "Furniture" });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body["filters"]).toEqual({ categories: ["Furniture"] });
    expect(body["query"]).toBeUndefined();
  });

  it("maps only the price bound that is present (price_min alone → filters.price.min, no max key)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", price_min: 5000 });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body["filters"]).toEqual({ price: { min: 5000 } });
    const price = (body["filters"] as { price?: Record<string, unknown> }).price!;
    expect(price["max"]).toBeUndefined();
  });

  it("maps only the pagination field that is present (limit alone → pagination.limit, no cursor key)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", limit: 10 });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body["pagination"]).toEqual({ limit: 10 });
    const pag = body["pagination"] as Record<string, unknown>;
    expect(pag["cursor"]).toBeUndefined();
  });

  it("does NOT clamp `limit` or validate cursor opacity — forwards them verbatim (sil-api owns those bounds)", async () => {
    // ASSUMPTION: limit/cursor bounds are sil-api's to enforce. A large limit and
    // an opaque cursor pass through unchanged — the tool does not second-guess them.
    await searchCatalog(SIL_API, "tok", { query: "chair", limit: 100000, cursor: "::opaque::base64==" });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body["pagination"]).toEqual({ limit: 100000, cursor: "::opaque::base64==" });
  });
});

describe("searchCatalog — transport failure maps to retryable without leaking the token", () => {
  it("a thrown fetch (network/timeout) → retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("simulated network failure"));
    const out = await searchCatalog(SIL_API, "tok", { query: "chair" });
    expect(out.kind).toBe("retryable");
  });

  it("the returned union NEVER carries the access token (privacy at the wrapper boundary)", async () => {
    // On every path — success AND thrown — the token travels only in the outbound
    // request header, never into the returned SearchOutcome.
    const SECRET = "wrapper-secret-token";

    // Success path.
    spyFetch([]);
    const ok = await searchCatalog(SIL_API, SECRET, { query: "chair" });
    expect(JSON.stringify(ok)).not.toContain(SECRET);
    vi.restoreAllMocks();

    // Thrown path.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const thrown = await searchCatalog(SIL_API, SECRET, { query: "chair" });
    expect(JSON.stringify(thrown)).not.toContain(SECRET);
  });
});
