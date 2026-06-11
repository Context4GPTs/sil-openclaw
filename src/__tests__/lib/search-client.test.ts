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

/**
 * The card `add-ship-to-filter-args-to-the-sil-search-tool` (epic
 * `location-aware-search-2026-06`) adds four optional serviceability/localization
 * filters to `SearchParams`: `ship_to`, `ships_from`, `condition`, `available`.
 * `buildSearchBody` maps each into `filters.*`, with ONE load-bearing rename:
 * the agent arg `ship_to` (singular) becomes the wire key `filters.ships_to`
 * (plural). The other three keep their name under `filters.*`.
 *
 * Wire-shape source of truth: the Shopify Global-Catalog extension
 * (`vendor/shopify/docs/agents/catalog/global-catalog-extension.md:26-33`) and
 * sil-services `packages/schemas/src/catalog.ts` `SearchFilters` (OPEN —
 * `additionalProperties: true`, so a wrong key is silently ACCEPTED and ignored;
 * the exact emitted key name + nesting is the only thing that catches a bad
 * rename, hence the highest-value assertion in this file).
 *
 * The discipline is identical to `category`/`price`/`pagination` above: an absent
 * filter is an OMITTED key (never `available: undefined`, never an empty
 * `filters: {}` or `ships_to: {}`), no client-injected defaults (the server
 * applies `available: true` — the plugin must NOT), and a supplied `available:
 * false` SURVIVES (it is meaningful, not falsy-dropped).
 */
describe("searchCatalog — ship-to + serviceability filters map into filters.* (omit-when-absent, no defaults)", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("renames the agent arg `ship_to` → wire key `filters.ships_to` (THE load-bearing rename — the open SearchFilters silently ignores a wrong key)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "chair",
      ship_to: { country: "US", region: "CA", postal_code: "94107" },
    });
    const body = cap[0]!.body as Record<string, unknown>;
    // The plural wire key carries the supplied value, forwarded verbatim — and the
    // singular AGENT-arg name `ship_to` must NOT appear anywhere on the wire (the
    // whole-body equality pins both the rename AND the absence of the old name).
    expect(body).toEqual({
      query: "chair",
      filters: { ships_to: { country: "US", region: "CA", postal_code: "94107" } },
    });
  });

  it("forwards a minimal `ship_to` (country only) as `filters.ships_to`, not reshaped", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", ship_to: { country: "DE" } });
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { ships_to: { country: "DE" } } });
  });

  it("maps `ships_from` → `filters.ships_from` (same name on both sides), value forwarded as given", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", ships_from: { country: "US" } });
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { ships_from: { country: "US" } } });
  });

  it("maps `condition` (array) → `filters.condition`, forwarded as the supplied array", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", condition: ["new", "secondhand"] });
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { condition: ["new", "secondhand"] } });
  });

  it("maps `available` (boolean true) → `filters.available: true`", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", available: true });
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { available: true } });
  });

  it("a supplied `available: false` SURVIVES — forwarded as `filters.available: false`, never dropped as falsy", async () => {
    // The whole point of exposing `available`: set false to INCLUDE unavailable
    // items. A truthiness guard (`if (params.available)`) would silently drop it,
    // collapsing the false case back to the server default. It must be narrowed
    // with `typeof v === "boolean"` so false is preserved.
    await searchCatalog(SIL_API, "tok", { query: "chair", available: false });
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { available: false } });
  });

  it("maps ALL FOUR new filters at once alongside the existing ones (full body, exact)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "office chair",
      category: "Furniture",
      price_min: 10000,
      price_max: 200000,
      cursor: "cur-1",
      limit: 25,
      ship_to: { country: "US", region: "NY", postal_code: "10001" },
      ships_from: { country: "US" },
      condition: ["new"],
      available: false,
    });
    // The exact merged body — the new filters sit beside categories/price under
    // `filters`, the rename applied, `available:false` preserved, no extra keys.
    expect(cap[0]!.body).toEqual({
      query: "office chair",
      filters: {
        categories: ["Furniture"],
        price: { min: 10000, max: 200000 },
        ships_to: { country: "US", region: "NY", postal_code: "10001" },
        ships_from: { country: "US" },
        condition: ["new"],
        available: false,
      },
      pagination: { cursor: "cur-1", limit: 25 },
    });
  });

  it("omits EACH new filter when absent — a bare query carries no ships_to/ships_from/condition/available and no `filters` skeleton", async () => {
    await searchCatalog(SIL_API, "tok", { query: "lamp" });
    const body = cap[0]!.body as Record<string, unknown>;
    // No filters object at all (nothing to put in it) — the omit-when-absent rule
    // the existing `category`/`price` mapping already follows extends to all four.
    expect(body).toEqual({ query: "lamp" });
    expect(body["filters"]).toBeUndefined();
  });

  it("does NOT inject a default `available` (the server applies available:true; the plugin omits the key)", async () => {
    // Anti-regression on Risk: the extension documents a SERVER-SIDE default of
    // available:true. The plugin must NOT echo that default — when the agent omits
    // `available`, the key is simply absent from the body.
    await searchCatalog(SIL_API, "tok", { query: "chair", category: "Furniture" });
    const filters = (cap[0]!.body as Record<string, unknown>)["filters"] as Record<string, unknown>;
    expect(filters).not.toHaveProperty("available");
    expect(filters).not.toHaveProperty("ships_to");
    expect(filters).not.toHaveProperty("ships_from");
    expect(filters).not.toHaveProperty("condition");
  });

  it("emits NO empty `ships_to` object — an absent ship_to leaves no `filters.ships_to: {}` stub", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", available: false });
    // available:false is the ONLY filter set → filters carries ONLY `available`,
    // with no empty `ships_to: {}` (or ships_from/condition) skeleton injected.
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { available: false } });
  });

  it("a filter-only request of ONLY a new filter carries `filters` and NO `query` key", async () => {
    // `buildSearchBody` is mapping-only (the ≥1-input guard lives in the tool, not
    // here). Given only `ships_from`, the body must carry it under `filters` and
    // omit `query` entirely — the same shape the `category`-only case produces.
    await searchCatalog(SIL_API, "tok", { ships_from: { country: "US" } });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body["filters"]).toEqual({ ships_from: { country: "US" } });
    expect(body["query"]).toBeUndefined();
  });
});

/**
 * RE-SPEC (founder directive 2026-06-11): the tightened, Shopify-grounded contract
 * — `ships_to.country`/`ships_from.country` are ISO 3166-1 alpha-2 codes that the
 * WIRE NORMALIZES to UPPERCASE (`us` → `US`). The directive: "NORMALIZED UPPERCASE
 * on the wire (`us` → `US`)" — so it is the wire-build layer (`buildSearchBody` /
 * `searchCatalog`), not just the read site, that emits the uppercase code. This is
 * the byte-for-byte mirror of `@sil/schemas` `ShipTo`/`ShipFrom` the sil-services
 * sibling enforces identically; a lowercase code on the wire would diverge from the
 * sibling and (depending on the server's case-sensitivity) silently mis-filter.
 *
 * These assert NORMALIZATION at the wire seam directly (input is a `SearchParams`
 * carrying a lowercase/mixed-case country — the value the read site, after format
 * validation, hands down). Region/postal are forwarded verbatim once they pass
 * format (the read site owns format; the wire owns the country-case normalization).
 */
describe("searchCatalog — country is NORMALIZED UPPERCASE on the wire (alpha-2 contract)", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("uppercases a lowercase ship_to.country on the wire (`us` → `US`)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", ship_to: { country: "us" } });
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { ships_to: { country: "US" } } });
  });

  it("uppercases a mixed-case ship_to.country on the wire (`De` → `DE`)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", ship_to: { country: "De" } });
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { ships_to: { country: "DE" } } });
  });

  it("leaves an already-uppercase ship_to.country unchanged (`US` → `US`)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", ship_to: { country: "US" } });
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { ships_to: { country: "US" } } });
  });

  it("uppercases ships_from.country on the wire too (`gb` → `GB`)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", ships_from: { country: "gb" } });
    expect(cap[0]!.body).toEqual({ query: "chair", filters: { ships_from: { country: "GB" } } });
  });

  it("normalizes country case but forwards region + postal_code VERBATIM (they are already format-valid here)", async () => {
    // The wire normalizes ONLY country case; region/postal are passed through as
    // received (format is the read site's gate — by the time a value reaches the
    // wire it has already passed its pattern). region stays uppercase as supplied;
    // postal stays exactly as supplied.
    await searchCatalog(SIL_API, "tok", {
      query: "chair",
      ship_to: { country: "us", region: "CA", postal_code: "94107" },
    });
    expect(cap[0]!.body).toEqual({
      query: "chair",
      filters: { ships_to: { country: "US", region: "CA", postal_code: "94107" } },
    });
  });

  it("normalizes country in the all-filters body (the merged shape keeps US/US uppercase, available:false preserved)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "office chair",
      ship_to: { country: "us", region: "NY", postal_code: "10001" },
      ships_from: { country: "us" },
      condition: ["new"],
      available: false,
    });
    expect((cap[0]!.body as Record<string, unknown>)["filters"]).toEqual({
      ships_to: { country: "US", region: "NY", postal_code: "10001" },
      ships_from: { country: "US" },
      condition: ["new"],
      available: false,
    });
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
