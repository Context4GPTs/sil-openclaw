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
import type { SpecPredicate } from "../../lib/sil-client.js";

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
 * `location-aware-search-2026-06`) adds optional serviceability/localization
 * filters to `SearchParams`: `ship_to`, `condition`, `available`.
 * `buildSearchBody` maps each into `filters.*`, with ONE load-bearing rename:
 * the agent arg `ship_to` (singular) becomes the wire key `filters.ships_to`
 * (plural). The other two keep their name under `filters.*`.
 *
 * Card `replace-ships-from-with-local-merchants` (epic `local-merchants-2026-06`)
 * DELETED `ships_from` — so it is no longer mapped into `filters.*` here. Its
 * absence from the whole forwarded body (even when a stray arg is passed) is pinned
 * in the dedicated "ships_from is GONE" block below; the `local_merchants` boolean
 * that replaces it rides at the TOP LEVEL (its own block), never under `filters`.
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

  it("maps ALL new filters at once alongside the existing ones (full body, exact)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "office chair",
      category: "Furniture",
      price_min: 10000,
      price_max: 200000,
      cursor: "cur-1",
      limit: 25,
      ship_to: { country: "US", region: "NY", postal_code: "10001" },
      condition: ["new"],
      available: false,
    });
    // The exact merged body — the new filters sit beside categories/price under
    // `filters`, the rename applied, `available:false` preserved, no extra keys.
    // (No `ships_from` — it was deleted; its absence here is part of the deletion.)
    expect(cap[0]!.body).toEqual({
      query: "office chair",
      filters: {
        categories: ["Furniture"],
        price: { min: 10000, max: 200000 },
        ships_to: { country: "US", region: "NY", postal_code: "10001" },
        condition: ["new"],
        available: false,
      },
      pagination: { cursor: "cur-1", limit: 25 },
    });
  });

  it("omits EACH new filter when absent — a bare query carries no ships_to/condition/available and no `filters` skeleton", async () => {
    await searchCatalog(SIL_API, "tok", { query: "lamp" });
    const body = cap[0]!.body as Record<string, unknown>;
    // No filters object at all (nothing to put in it) — the omit-when-absent rule
    // the existing `category`/`price` mapping already follows extends to each.
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
    // here). Given only `ship_to`, the body must carry it under `filters` and
    // omit `query` entirely — the same shape the `category`-only case produces.
    await searchCatalog(SIL_API, "tok", { ship_to: { country: "US" } });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body["filters"]).toEqual({ ships_to: { country: "US" } });
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

  it("normalizes country in the all-filters body (the merged shape keeps US uppercase, available:false preserved)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "office chair",
      ship_to: { country: "us", region: "NY", postal_code: "10001" },
      condition: ["new"],
      available: false,
    });
    expect((cap[0]!.body as Record<string, unknown>)["filters"]).toEqual({
      ships_to: { country: "US", region: "NY", postal_code: "10001" },
      condition: ["new"],
      available: false,
    });
  });
});

/**
 * Card `replace-ships-from-with-local-merchants` (epic `local-merchants-2026-06`):
 * `buildSearchBody` emits `local_merchants: true` at the TOP LEVEL of the request
 * body — a SIBLING of `query`/`filters`/`pagination`, NEVER under `filters`.
 *
 * THE load-bearing wire invariant (Discovery "Chosen approach" + Risk "Wrong wire
 * placement"): `local_merchants` is a sil-PRIVATE ranking signal, NOT a UCP /
 * Global-Catalog filter. `filters` is forwarded to the cross-shop Global Catalog,
 * whose OPEN `SearchFilters` (`additionalProperties: true`) would SILENTLY accept an
 * unknown `local_merchants` key and ignore it → the flag becomes a no-op, and a
 * presence-only test against the wrong placement would LOOK correct. So every
 * assertion here pins top-level presence AND `filters`-absence TOGETHER — that pair
 * is the only thing that catches the wrong-placement false-green.
 *
 * Emit ONLY when true: `local_merchants:false` == the server's unbiased default ==
 * today's behavior, so it is OMITTED (omit-when-falsy — the OPPOSITE of
 * `available:false`, which is a meaningful include-unavailable signal that survives;
 * Discovery "Open questions"). Absent → omitted. A wrong TYPE → dropped, not coerced.
 */
describe("searchCatalog — local_merchants rides TOP-LEVEL, never under filters (the load-bearing wire invariant)", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("local_merchants:true → body.local_merchants === true AT THE TOP LEVEL, and filters has NO local_merchants (asserted TOGETHER — the anti-false-green pair)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", local_merchants: true });
    const body = cap[0]!.body as Record<string, unknown>;
    // (1) present at the top level, beside `query`, as a literal `true`.
    expect(body["local_merchants"]).toBe(true);
    // (2) and CRUCIALLY not under `filters` — a wrong placement here would be a
    // silent no-op the Global Catalog swallows. Asserting (1) ALONE would pass even
    // if the key were ALSO/ONLY under filters; the pair is what makes this honest.
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("local_merchants");
  });

  it("local_merchants:true with NO other filters → body is exactly { query, local_merchants: true } — no `filters` skeleton conjured to hold it", async () => {
    // The strongest placement assertion: a byte-exact whole-body equality. If the
    // impl routed the flag through `filters`, this body would carry a `filters` key
    // and FAIL — the equality pins both the top-level home AND the absence of filters.
    await searchCatalog(SIL_API, "tok", { query: "chair", local_merchants: true });
    expect(cap[0]!.body).toEqual({ query: "chair", local_merchants: true });
  });

  it("local_merchants:true coexists with real filters — flag at top level, filters untouched (no leak into filters)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "chair",
      category: "Furniture",
      ship_to: { country: "us" },
      local_merchants: true,
    });
    const body = cap[0]!.body as Record<string, unknown>;
    // Whole-body exact: local_merchants sits beside query/filters; filters carries
    // ONLY the real filters, with no local_merchants smuggled in.
    expect(body).toEqual({
      query: "chair",
      local_merchants: true,
      filters: { categories: ["Furniture"], ships_to: { country: "US" } },
    });
  });

  it("local_merchants:false → the key is OMITTED entirely (omit-when-falsy; false == the server's unbiased default)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair", local_merchants: false });
    const body = cap[0]!.body as Record<string, unknown>;
    // Unlike available:false, a false bias carries NO signal — it must NOT be echoed
    // anywhere: not at the top level, not under filters.
    expect(body).not.toHaveProperty("local_merchants");
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("local_merchants");
    // A bare query with a false flag is byte-exactly today's body — no trace of the flag.
    expect(body).toEqual({ query: "chair" });
  });

  it("local_merchants OMITTED → the key is absent (no client-injected default; today's unbiased body)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "chair" });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("local_merchants");
    expect(body).toEqual({ query: "chair" });
  });

  it("a wrong-TYPE local_merchants (string) is DROPPED — not coerced, not forwarded, anywhere", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "chair",
      // @ts-expect-error — a drifted on-disk call passes the wrong type; the wire
      // build must narrow it out (typeof === "boolean"), never truthiness-coerce it.
      local_merchants: "true",
    });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("local_merchants");
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("local_merchants");
    expect(body).toEqual({ query: "chair" });
  });

  it("a wrong-TYPE local_merchants (number 1) is DROPPED — a truthy non-boolean must not slip through", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "chair",
      // @ts-expect-error — number is not boolean; must be dropped, not treated as true.
      local_merchants: 1,
    });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("local_merchants");
    expect(body).toEqual({ query: "chair" });
  });

  it("a wrong-TYPE local_merchants (object) is DROPPED — proves it's a bare boolean, not a { country }-style object", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "chair",
      // @ts-expect-error — an object (e.g. a mistaken { country }) is not a boolean.
      local_merchants: { country: "GR" },
    });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("local_merchants");
    expect(body).toEqual({ query: "chair" });
  });
});

/**
 * Card `replace-ships-from-with-local-merchants`: `ships_from` is GONE end-to-end.
 * A drifted on-disk call that still passes a `ships_from` argument must NOT have it
 * forwarded ANYWHERE in the request body — `SearchParams` no longer carries the
 * field and `buildSearchBody` no longer maps it, so it is dropped before the wire
 * (AC[integration]: "ships_from is NOT present anywhere in the forwarded body").
 */
describe("searchCatalog — a stray ships_from argument is absent from the entire forwarded body", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("a stray `ships_from` arg alongside a real query → it appears NOWHERE in the body (not top-level, not under filters)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "chair",
      // @ts-expect-error — `ships_from` was deleted from SearchParams; a drifted call
      // may still pass it, but the wire build must not forward it.
      ships_from: { country: "US" },
    });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("ships_from");
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("ships_from");
    // The deleted lever leaves no byte in the wire body at all.
    expect(JSON.stringify(body)).not.toContain("ships_from");
    // The body is byte-exactly today's bare-query body — the stray arg changed nothing.
    expect(body).toEqual({ query: "chair" });
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

/**
 * CARD `sds-forward-specs-contract` (epic `spec-driven-shopping-redesign`, Phase 2
 * — founder scope revision 2026-07-13: THE PLUGIN IS PURE TRANSPORT). The unit floor
 * for the `specs` contract in `buildSearchBody` (AC-P1, AC-P5, AC-A2 wire-half,
 * AC-A3 wire-half).
 *
 * `SearchParams` gains `specs?: SpecPredicate[]` — a closed-shape / OPEN-vocabulary
 * structured requirement `{ ns, key, op, value?, unit?, hard? }`. `buildSearchBody`
 * has exactly ONE effect on it:
 *
 *   filters.specs — the predicate array rides under ONE namespaced well-known key
 *   `filters.specs`, forwarded VERBATIM (the whole array, all seven ops, `hard`
 *   unchanged), NEVER spread per-predicate as `filters.<key>`/`filters.<ns>` and
 *   NEVER at the top level. This is the exact fail-green hazard the `ships_to` rename
 *   defends against (the OPEN `SearchFilters`, `additionalProperties:true`, silently
 *   accepts a wrong key → a no-op that a presence-only test would miss). So the
 *   defense is WHOLE-BODY equality asserting the precise `filters.specs` array, never
 *   "a specs key exists". `hard` is forwarded VERBATIM (true kept, false
 *   kept-not-dropped, absent stays absent) so the backend can enforce once it lands
 *   and reflection can correlate the `applied:false` hard set.
 *
 * THE PLUGIN DOES NOT FOLD PREDICATES INTO `query`. Authoring free-text from the
 * requirements is the AGENT's job (the sil-shopping loop, Beat 4) and reframing on
 * `applied:false` is Beat 5 — a mechanical plugin fold was lossy (a range renders as
 * a bare numeric token — noise) and unsafe (a negation folded as a bare positive
 * token inverts intent). So `body.query` is left EXACTLY the agent's `params.query`,
 * byte-for-byte, regardless of `specs` — a predicate never adds, removes, or reorders
 * a query token, and `specs` alone never SYNTHESIZES a `query` (absent stays absent).
 *
 * The backend does not filter on any `ns.key` yet (the sil-services
 * `spec-registry-backend` epic) — NOTHING here asserts filtering. Results move today
 * via the agent's free-text authoring, not a plugin-side fold.
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts`:
 *   type SpecOp = "eq"|"neq"|"gte"|"lte"|"in"|"nin"|"exists";
 *   interface SpecPredicate { ns: string; key: string; op: SpecOp;
 *     value?: number|string|boolean|(string|number)[]; unit?: string; hard?: boolean }
 *   SearchParams.specs?: SpecPredicate[]
 *   buildSearchBody sets ONE `filters.specs` = the predicate array (verbatim, `hard`
 *   kept) and forwards `body.query` = `params.query` UNCHANGED. The exact mappings
 *   below ARE the immutable spec.
 */
describe("searchCatalog — specs ride ONE namespaced filters.specs key (whole-body equality, never spread)", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("whole body EXACT: filters.specs carries ALL SEVEN ops verbatim beside typed filters, and the query is left UNTOUCHED", async () => {
    // The strongest single assertion — a byte-exact whole-body equality carrying every
    // op (eq/neq/gte/lte/in/nin/exists) plus a `hard:true` entry. `filters.specs` is
    // the ONE namespaced key beside `categories`/`price` under the ONE `filters`
    // object, holding the predicate array VERBATIM. The agent's `query` ("gloves")
    // survives byte-for-byte: a plugin that folded the positive ops (eq/gte/lte/in)
    // would append "black"/"10000mm"/"500"/"leather"/"suede" and this equality would
    // FAIL — the guard against any future re-introduction of a fold.
    const specs: SpecPredicate[] = [
      { ns: "product", key: "color", op: "eq", value: "black", hard: true },
      { ns: "product", key: "size", op: "neq", value: "xs" },
      { ns: "product", key: "waterproof_rating", op: "gte", value: 10000, unit: "mm" },
      { ns: "product", key: "weight_g", op: "lte", value: 500 },
      { ns: "product", key: "material", op: "in", value: ["leather", "suede"] },
      { ns: "seller", key: "name", op: "nin", value: ["acme"] },
      { ns: "product", key: "insulation", op: "exists" },
    ];
    await searchCatalog(SIL_API, "tok", {
      query: "gloves",
      category: "Apparel",
      price_max: 5000,
      specs,
    });
    expect(cap[0]!.body).toEqual({
      query: "gloves",
      filters: {
        categories: ["Apparel"],
        price: { max: 5000 },
        specs,
      },
    });
  });

  it("filters.specs carries the predicate array VERBATIM and NEVER spreads a predicate as filters.<name> or top-level `specs`", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "gloves",
      specs: [
        { ns: "product", key: "waterproof_rating", op: "gte", value: 10000, unit: "mm" },
        { ns: "seller", key: "rating_average", op: "gte", value: 4.5 },
        { ns: "product", key: "size", op: "in", value: ["medium", "large"] },
      ],
    });
    const body = cap[0]!.body as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    // The ONE namespaced key holds every predicate, unchanged (no reshaping).
    expect(filters["specs"]).toEqual([
      { ns: "product", key: "waterproof_rating", op: "gte", value: 10000, unit: "mm" },
      { ns: "seller", key: "rating_average", op: "gte", value: 4.5 },
      { ns: "product", key: "size", op: "in", value: ["medium", "large"] },
    ]);
    // NEVER spread per-predicate onto the open SearchFilters (the silent-no-op / typed-
    // filter-collision hazard) — not by key, not by ns.
    for (const wrong of ["waterproof_rating", "rating_average", "size", "product", "seller"]) {
      expect(filters).not.toHaveProperty(wrong);
    }
    // NEVER at the top level — `specs` is a backend-bound filter, unlike sil-private
    // `local_merchants`.
    expect(body).not.toHaveProperty("specs");
  });

  it("forwards `hard` VERBATIM on each entry — true kept, false kept (not dropped as falsy), absent stays absent", async () => {
    // The backend can only enforce a hard constraint, and reflection can only
    // correlate the `applied:false` hard set, if `hard` survives the wire unchanged.
    // A truthiness drop of `hard:false`, or a fabricated default on an absent `hard`,
    // would break the honesty rail. `toEqual` pins all three: true, false, and the
    // ABSENCE of a `hard` key on the third entry.
    await searchCatalog(SIL_API, "tok", {
      query: "gloves",
      specs: [
        { ns: "a", key: "b", op: "eq", value: 1, hard: true },
        { ns: "a", key: "c", op: "eq", value: 2, hard: false },
        { ns: "a", key: "d", op: "eq", value: 3 },
      ],
    });
    const filters = ((cap[0]!.body as Record<string, unknown>)["filters"] ?? {}) as Record<string, unknown>;
    expect(filters["specs"]).toEqual([
      { ns: "a", key: "b", op: "eq", value: 1, hard: true },
      { ns: "a", key: "c", op: "eq", value: 2, hard: false },
      { ns: "a", key: "d", op: "eq", value: 3 },
    ]);
  });

  it("an EMPTY specs:[] is a no-op — no filters.specs, query unchanged (whole body exact)", async () => {
    await searchCatalog(SIL_API, "tok", { query: "gloves", specs: [] });
    // An empty predicate list adds nothing: no `filters` skeleton conjured to hold a
    // `specs`, and the query is byte-exactly the agent's. (Symmetry with the
    // omit-when-absent discipline every other filter follows.)
    expect(cap[0]!.body).toEqual({ query: "gloves" });
  });
});

/**
 * PURE TRANSPORT (founder scope revision 2026-07-13): `specs` NEVER touch `body.query`.
 * The plugin forwards the agent's free-text VERBATIM; authoring search text from the
 * requirements is the agent's job (sil-shopping loop, Beat 4). Every assertion below
 * pins that invariant: `body.query` is byte-exactly `params.query`, and a specs-only
 * request synthesizes no `query` key.
 */
describe("searchCatalog — specs are PURE TRANSPORT: body.query is the agent's query VERBATIM, untouched by any predicate", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  /** The outbound `body.query` (or undefined when the key is omitted). */
  function outboundQuery(): string | undefined {
    const q = (cap[0]!.body as Record<string, unknown>)["query"];
    return typeof q === "string" ? q : undefined;
  }

  it("a POSITIVE eq predicate leaves body.query EXACTLY the agent's query — the value appears NOWHERE in it (RED against the fold)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "external drive",
      specs: [{ ns: "product", key: "capacity_gb", op: "eq", value: 512 }],
    });
    // Byte-exact: no token added, removed, or reordered by the predicate.
    expect(outboundQuery()).toBe("external drive");
    expect(outboundQuery()).not.toContain("512");
  });

  it("a gte predicate's value AND unit are NOT folded into the query (query stays byte-exact)", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "hiking gloves",
      specs: [{ ns: "product", key: "waterproof_rating", op: "gte", value: 10000, unit: "mm" }],
    });
    expect(outboundQuery()).toBe("hiking gloves");
    const q = outboundQuery()!.toLowerCase();
    expect(q).not.toContain("10000");
    expect(q).not.toContain("mm");
  });

  it("an `in` array value is NOT folded — no element enters the query", async () => {
    await searchCatalog(SIL_API, "tok", {
      query: "jacket",
      specs: [{ ns: "product", key: "size", op: "in", value: ["medium", "large"] }],
    });
    expect(outboundQuery()).toBe("jacket");
    const q = outboundQuery()!.toLowerCase();
    expect(q).not.toContain("medium");
    expect(q).not.toContain("large");
  });

  it("a MIX of positive and negation predicates leaves the query byte-exactly the agent's — no token added, removed, or reordered", async () => {
    // The general invariant in one shot: positive ops and negations alike leave
    // `body.query` identical to `params.query`. Byte-exact equality catches an add,
    // a drop, and a reorder alike.
    await searchCatalog(SIL_API, "tok", {
      query: "waterproof running shoes",
      specs: [
        { ns: "product", key: "capacity_gb", op: "eq", value: 512 },
        { ns: "product", key: "color", op: "neq", value: "pink" },
        { ns: "product", key: "brand", op: "nin", value: ["accaltd"] },
        { ns: "product", key: "waterproof_rating", op: "gte", value: 10000, unit: "mm" },
      ],
    });
    expect(outboundQuery()).toBe("waterproof running shoes");
    const q = outboundQuery()!.toLowerCase();
    // Negation values never enter the query …
    expect(q).not.toContain("pink");
    expect(q).not.toContain("accaltd");
    // … and no positive value either — pure transport.
    expect(q).not.toContain("512");
    expect(q).not.toContain("10000");
  });

  it("query ABSENT + only a POSITIVE spec → the `query` key is OMITTED — specs NEVER synthesize a query", async () => {
    // With no agent free-text there is no query to forward, so the `query` key is
    // absent — a specs-only request never synthesizes one. The predicate still rides
    // filters.specs, so the constraint is not lost.
    await searchCatalog(SIL_API, "tok", {
      specs: [{ ns: "product", key: "capacity_gb", op: "eq", value: 512 }],
    });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("query");
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters["specs"]).toEqual([{ ns: "product", key: "capacity_gb", op: "eq", value: 512 }]);
  });

  it("query ABSENT + only negation/exists predicates → the `query` key is OMITTED, predicates still ride filters.specs", async () => {
    // No agent free-text → no `query` key conjured; the predicates still ride
    // filters.specs, preserved.
    await searchCatalog(SIL_API, "tok", {
      specs: [
        { ns: "product", key: "color", op: "neq", value: "red" },
        { ns: "product", key: "waterproof_rating", op: "exists" },
      ],
    });
    const body = cap[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("query");
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters["specs"]).toEqual([
      { ns: "product", key: "color", op: "neq", value: "red" },
      { ns: "product", key: "waterproof_rating", op: "exists" },
    ]);
  });
});
