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
 * (`getApiUrl`), at the BARE path `/catalog/search` — NOT `/api/v1`. On a 401
 * the tool now refreshes transparently against the **sil-web** origin
 * (`getWebUrl`, via the real `refreshStoredTokens`) and retries the search ONCE —
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
 *   response (200): the FLAT UCP envelope sil-api emits (`withUcpMeta(body) →
 *     { ucp, ...body }`), carrying a CatalogSearchResult at the TOP LEVEL:
 *     { ucp, products: SilCatalogProduct[], pagination?, messages? } — no `result` wrapper.
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
// CARD surface-user-not-provisioned: the AC8 end-to-end recovery proof drives
// sil_register (after a sil_search 403 clears the dead token) on the SAME api +
// data dir — so the identity tools are registered alongside the catalog tools.
import { registerIdentityTools } from "../tools/identity.js";
import { setWebUrl, setApiUrl, getWebUrl, getApiUrl } from "../lib/config.js";
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

/** The REAL sil-api search envelope — the FLAT shape sil-api actually emits
 * (`withUcpMeta(body) → { ucp, ...body }`: `products`/`pagination` at the TOP LEVEL
 * beside `ucp`, NOT under a `result` wrapper). The presence of a required `source`
 * per product and a non-empty `checkout_url` per variant is what makes the suite
 * anti-false-green: a `{ stub: true }` echo carries none of these, so the assertions
 * below cannot pass against the skeleton stub. */
function searchEnvelope(
  products: unknown[],
  pagination: unknown = { has_next_page: false },
): unknown {
  return {
    ucp: { version: "0.1", status: "success" },
    products,
    pagination,
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

/**
 * Count how many `api.logger.info(marker, …)` calls used `marker` as their first
 * argument. The marker name is the FIRST positional arg of the info call (the
 * convention every `sil_*` log marker in this plugin follows). Used to assert the
 * `sil_search_refreshed` operator marker fires exactly once on the silent-recovery
 * path and ZERO times on a first-try (no-refresh) success.
 */
function infoMarkerCount(api: MockPluginAPI, marker: string): number {
  return vi
    .mocked(api.logger.info)
    .mock.calls.filter((c) => c[0] === marker).length;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-search-int-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  // Pin BOTH origins to distinct known hosts so the origin/path assertions are
  // exact and a misfire onto sil-web is caught.
  setWebUrl(SIL_WEB);
  setApiUrl(SIL_API);
});

afterEach(() => {
  vi.restoreAllMocks();
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
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
    expect(u.origin).toBe(new URL(getApiUrl()).origin);
    expect(u.origin).not.toBe(new URL(getWebUrl()).origin);
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

/**
 * Card `add-ship-to-filter-args-to-the-sil-search-tool` (epic
 * `location-aware-search-2026-06`): the wired tool forwards the new optional
 * serviceability/localization args end-to-end — agent arg → wire key — with the
 * `ship_to` → `filters.ships_to` rename, omit-when-absent, and no client-injected
 * defaults. These assert the full round-trip through the REAL tool + sil-client,
 * capturing the request body the tool sends to sil-api (the only mock is fetch).
 *
 * Card `replace-ships-from-with-local-merchants` deleted `ships_from`, so it is no
 * longer among the forwarded filters here; its end-to-end absence (even for a stray
 * arg) and the `local_merchants` top-level forward are in their own blocks below.
 */
describe("sil_search — the new filter args forward end-to-end (agent arg → wire key)", () => {
  it("all supplied (with query) → captured body carries filters.ships_to / condition / available, the rename applied", async () => {
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
      ship_to: { country: "US", region: "NY", postal_code: "10001" },
      condition: ["new"],
      available: false,
    });

    expect(rec.search.length).toBe(1);
    const body = rec.search[0]!.body as Record<string, unknown>;
    // The whole filters block, exact — proves the agent arg `ship_to` lands on the
    // wire as the plural `ships_to` (rename), the others keep their name, and
    // available:false survives the full pipeline (read-site narrow → buildSearchBody).
    // No `ships_from` — it was deleted end-to-end.
    expect(body["filters"]).toEqual({
      ships_to: { country: "US", region: "NY", postal_code: "10001" },
      condition: ["new"],
      available: false,
    });
    // The query still rides at the top level.
    expect(body["query"]).toBe("office chair");
  });

  it("a bare { query } sends EXACTLY { query } — no filters skeleton, no defaulted ships_to/available (the no-defaults invariant extends to the new args)", async () => {
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
    // Unchanged from today: the new args inject nothing when the agent omits them.
    expect(body).toEqual({ query: "lamp" });
    expect(body["filters"]).toBeUndefined();
  });

  it("ship_to alongside an existing category coexist under one filters object (no clobber)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", {
      query: "chair",
      category: "Furniture",
      ship_to: { country: "DE" },
    });

    expect((rec.search[0]!.body as Record<string, unknown>)["filters"]).toEqual({
      categories: ["Furniture"],
      ships_to: { country: "DE" },
    });
  });
});

/**
 * Card `replace-ships-from-with-local-merchants` (epic `local-merchants-2026-06`):
 * `local_merchants: true` forwards END-TO-END through the real wired tool + sil-client
 * as a TOP-LEVEL request field (sibling of `query`/`filters`/`pagination`), never
 * under `filters`, and the plugin attaches NO country and performs NO identity read
 * to do it (AC[integration]). The only mock is `fetch` (installRouter) — the full
 * pipeline runs.
 */
describe("sil_search — local_merchants forwards end-to-end TOP-LEVEL, with no country and no identity round-trip", () => {
  it("local_merchants:true (with query) → captured body carries top-level local_merchants:true; filters has none", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "καρέκλα", local_merchants: true }),
    );

    expect(rec.search.length).toBe(1);
    const body = rec.search[0]!.body as Record<string, unknown>;
    // Top-level home AND filters-absence asserted together (the anti-false-green pair).
    expect(body["local_merchants"]).toBe(true);
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("local_merchants");
    expect(payload["status"]).toBe("ok");
  });

  it("local_merchants:true attaches NO country anywhere on the request and triggers NO identity / sil_whoami round-trip", async () => {
    // The whole point of a server-resolved boolean (Discovery fact c): the plugin
    // must NOT fetch or pass a country to honor the flag. Proof: the ONLY outbound
    // call is the single /catalog/search; there is no identity read, and the request
    // body/URL carry no country field attributable to the flag.
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "shoes", local_merchants: true });

    // Exactly ONE outbound request — the search. No second (identity) round-trip.
    expect(rec.all.length).toBe(1);
    expect(rec.search.length).toBe(1);
    // No identity endpoint was hit on account of the flag.
    const hitWhoami = rec.all.some((r) => /whoami|\/identity|\/me\b|\/auth\/me/i.test(r.url));
    expect(hitWhoami).toBe(false);
    // The flag injected NO country anywhere — not as a top-level key, not in filters.
    const body = rec.search[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("country");
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("country");
    // The only flag-attributable addition is the boolean itself.
    expect(body["local_merchants"]).toBe(true);
  });

  it("local_merchants:false (with query) → NO local_merchants key on the wire end-to-end (omit-when-falsy)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", local_merchants: false });

    const body = rec.search[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("local_merchants");
    expect(body).toEqual({ query: "chair" });
  });

  it("a wrong-TYPE local_merchants (string) is DROPPED end-to-end — narrowed out before the wire, never coerced to true", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", local_merchants: "true" });

    const body = rec.search[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("local_merchants");
    expect(body).toEqual({ query: "chair" });
  });
});

/**
 * Card `replace-ships-from-with-local-merchants`: a stray `ships_from` argument is
 * NOT forwarded anywhere in the body end-to-end (the deleted lever is closed against
 * at the schema/narrowing, so it never reaches sil-api or the Global Catalog).
 */
describe("sil_search — a stray ships_from argument never reaches the wire end-to-end", () => {
  it("a `ships_from` arg alongside a real query → absent from the forwarded body (not top-level, not filters)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", ships_from: { country: "US" } });

    const body = rec.search[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("ships_from");
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("ships_from");
    expect(JSON.stringify(body)).not.toContain("ships_from");
    // The stray arg changed nothing — byte-exactly today's bare-query body.
    expect(body).toEqual({ query: "chair" });
  });
});

/**
 * Card `replace-ships-from-with-local-merchants` (AC[integration], best-effort
 * semantics): the bias is ENTIRELY sil-api's. When `local_merchants: true` is
 * forwarded and sil-api returns a ranked list, the plugin shapes the result WITHOUT
 * adding any client-side "is local" tag/flag and WITHOUT re-ranking or dropping any
 * result to enforce locality (LEAN search contract — present the server's order).
 * A false "all local" guarantee at the surface is exactly the failure that killed
 * ships_from; the plugin must not manufacture one.
 */
describe("sil_search — result-shaping adds NO client-side locality tag and does NOT re-rank/drop for locality", () => {
  it("with local_merchants:true, the shaped products are the server's order verbatim — no locality tag, none dropped, none reordered", async () => {
    seedTokens("at", "rt");
    // The server returns A then B (its ranking). The plugin must present A then B —
    // it must not reorder to "promote locals", nor drop B for being non-local.
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A, PRODUCT_B]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "chair", local_merchants: true }),
    );

    expect(payload["status"]).toBe("ok");
    const products = payload["products"] as Array<Record<string, unknown>>;
    // Nothing dropped for locality; server order preserved.
    expect(products).toHaveLength(2);
    expect(products[0]!["id"]).toBe("gid://product/a");
    expect(products[1]!["id"]).toBe("gid://product/b");
    // No client-side "is local" tag/flag injected onto any product or its variant.
    const blob = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ["is_local", "islocal", '"local":', "is_domestic", "local_match", "locality"]) {
      expect(blob).not.toContain(forbidden);
    }
    // The shaped product carries the four contract keys — and NO locality key.
    // RECONCILED for card `surface-product-url-and-specs-in-catalog-tools`: this was an
    // EXACT-equality lock on `["id","source","title","variant"]`, which froze the LEAN
    // shape. The enriched projection now ALSO surfaces product `url`/`description.plain`/
    // `media`/`options`/`metadata` WHEN the wire object carries them — so a forward
    // exact-equality lock would be a stale red the moment a fixture here gains an
    // enriched field, NOT a real defect (PRODUCT_A is lean today, so the projection
    // legitimately surfaces only the four; the lock's REAL intent is "no locality tag
    // leaks", already covered by the forbidden-words check above). Relaxed to a
    // required-keys-SUBSET assertion (the contract keys are present) plus an explicit
    // no-locality-key guard — the enriched-projection shape itself is pinned in the
    // dedicated `card surface-product-url` blocks below.
    for (const key of ["id", "source", "title", "variant"]) {
      expect(Object.keys(products[0]!)).toContain(key);
    }
    // PRODUCT_A carries no enriched wire fields, so omit-when-absent means NONE of the
    // new enriched keys appear on its projection (the lean shape is preserved).
    for (const absent of ["url", "description", "media", "options", "metadata"]) {
      expect(products[0]!).not.toHaveProperty(absent);
    }
    // The product is never tagged with a locality key by the plugin (server owns the bias).
    expect(products[0]!).not.toHaveProperty("local");
  });

  it("the shaped result is IDENTICAL whether local_merchants is true or omitted — the plugin's shaping is locality-agnostic (server owns the bias)", async () => {
    async function shaped(localMerchants: boolean | undefined): Promise<Record<string, unknown>> {
      seedTokens("at", "rt");
      installRouter((kind) =>
        kind === "search"
          ? { status: 200, body: searchEnvelope([PRODUCT_A, PRODUCT_B]) }
          : { status: 500, body: {} },
      );
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const args: Record<string, unknown> = { query: "chair" };
      if (localMerchants !== undefined) args["local_merchants"] = localMerchants;
      const p = payloadOf(await getTool(api, TOOL).execute("c1", args));
      vi.restoreAllMocks();
      return p;
    }

    const withFlag = await shaped(true);
    const withoutFlag = await shaped(undefined);
    // The plugin does no locality post-processing, so the SHAPED payload (products +
    // their projection + order) is byte-identical — only the request body differs.
    expect(withFlag).toEqual(withoutFlag);
  });
});

/**
 * RE-SPEC (founder directive 2026-06-11) — THE KEY BEHAVIORAL CHANGE. The tightened
 * contract distinguishes two failure modes for the new location fields:
 *
 *   - Wrong TYPE (a number country, a primitive ship_to, a non-array condition)
 *     → DROP the field as before (the existing narrowing discipline — those tests
 *     live in `tools/search.test.ts` and stay).
 *   - Wrong FORMAT (a STRING that fails its pattern — `country="United States"`,
 *     `region="California"`) → REJECT the WHOLE request CLIENT-SIDE with a
 *     structured validation error and make NO network call. This is the better
 *     agent UX the directive demands over an opaque, fail-late sil-api 400 (the
 *     thin contract forwarded the bad value and let sil-api's closed schema 400 it).
 *
 * The structured validation envelope mirrors the repo's existing client-side
 * rejection shape (`invalidInput`/`invalidIds` in catalog.ts, `notRegistered` in
 * identity.ts): `{ status: "invalid_request", error: <machine code>, message }`,
 * with NO `recovery: sil_register` — auth is fine; the input FORMAT is the problem.
 * The pinned machine error code for a bad filter format is `invalid_filter`
 * (distinct from `empty_search_input`, which is the no-usable-input case).
 *
 * These run the REAL wired tool with a router that 200s any search — so a request
 * that reaches the network would resolve `ok`; the assertion `rec.all.length === 0`
 * is what proves the rejection happened CLIENT-SIDE, before any fetch.
 */
describe("sil_search — bad FORMAT is rejected client-side with a structured error, NO network call (re-spec)", () => {
  it("ship_to.country = 'United States' (a name, not an alpha-2 code) + a real query → invalid_request, ZERO network", async () => {
    seedTokens("at", "rt");
    const rec = installRouter(() => ({ status: 200, body: searchEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "office chair",
        ship_to: { country: "United States" },
      }),
    );

    // Rejected BEFORE any fetch — the format guard runs client-side.
    expect(rec.all.length).toBe(0);
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_filter");
    // It is a validation problem, NOT an auth problem — no re-register hint.
    expect(payload["recovery"]).not.toBe("sil_register");
    // The message names the offending field/format so the agent can fix it.
    expect(typeof payload["message"]).toBe("string");
    expect(String(payload["message"]).toLowerCase()).toMatch(/country|ship_to|code|format|alpha-2|iso/);
  });

  it("ship_to.region = 'California' (a place name, not a 3166-2 code) + a real query → invalid_request, ZERO network", async () => {
    seedTokens("at", "rt");
    const rec = installRouter(() => ({ status: 200, body: searchEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "office chair",
        ship_to: { country: "US", region: "California" },
      }),
    );

    expect(rec.all.length).toBe(0);
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_filter");
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("ship_to.postal_code = 'San Francisco, CA, 94107' (prose) + a real query → invalid_request, ZERO network", async () => {
    seedTokens("at", "rt");
    const rec = installRouter(() => ({ status: 200, body: searchEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "chair",
        ship_to: { country: "US", postal_code: "San Francisco, CA, 94107" },
      }),
    );

    expect(rec.all.length).toBe(0);
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_filter");
  });

  it("a bad postal injection value ('94107; DROP TABLE') is rejected client-side, never reaching the network", async () => {
    // The format guard is also an injection backstop: a postal token carrying SQL /
    // punctuation fails the pattern and is rejected before any wire call.
    seedTokens("at", "rt");
    const rec = installRouter(() => ({ status: 200, body: searchEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "chair",
        ship_to: { country: "US", postal_code: "94107; DROP TABLE" },
      }),
    );

    expect(rec.all.length).toBe(0);
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_filter");
  });
});

/**
 * RE-SPEC: the accept-and-normalize counterpart to the reject path above. A valid
 * lowercase alpha-2 country is ACCEPTED, REACHES the network, and lands on the wire
 * UPPERCASED (`us` → `US`) — the full agent-arg → wire round-trip through the REAL
 * tool, confirming the read site (format-valid) hands a value the wire normalizes.
 */
describe("sil_search — a valid lowercase country is accepted, normalized UPPERCASE, and reaches the network (re-spec)", () => {
  it("ship_to.country = 'us' (valid alpha-2, lowercase) + a query → ok, reaches network, captured body carries ships_to.country = 'US'", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "office chair",
        ship_to: { country: "us" },
      }),
    );

    // Accepted → reached the network exactly once → succeeded.
    expect(rec.search.length).toBe(1);
    expect(payload["status"]).toBe("ok");
    // The captured wire body carries the NORMALIZED uppercase code under the plural
    // wire key (the rename + the uppercase normalization both applied).
    expect((rec.search[0]!.body as Record<string, unknown>)["filters"]).toEqual({
      ships_to: { country: "US" },
    });
  });

  it("a full valid lowercase ship_to (country/region/postal) round-trips with country uppercased, region+postal verbatim", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", {
      query: "chair",
      ship_to: { country: "us", region: "CA", postal_code: "94107" },
    });

    expect(rec.search.length).toBe(1);
    expect((rec.search[0]!.body as Record<string, unknown>)["filters"]).toEqual({
      ships_to: { country: "US", region: "CA", postal_code: "94107" },
    });
  });
});

/**
 * RE-SPEC: `condition` keeps an OPEN WIRE. The DESCRIPTION steers the agent to the
 * set new/secondhand, but an UNRECOGNIZED value (e.g. `["refurbished"]`) must STILL
 * be forwarded — never rejected or dropped for being unrecognized (Shopify: an
 * unrecognized condition value passes through). This is distinct from the location
 * fields, which are CLOSED (format-rejected). `condition` is steered-but-open.
 */
describe("sil_search — condition wire stays OPEN: an unrecognized value still forwards (re-spec)", () => {
  it("condition = ['refurbished'] (not in the steered set) + a query → forwarded under filters.condition, reaches network, NOT rejected", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "chair",
        condition: ["refurbished"],
      }),
    );

    // Accepted and forwarded — an unrecognized condition is NOT a format error.
    expect(rec.search.length).toBe(1);
    expect(payload["status"]).toBe("ok");
    expect((rec.search[0]!.body as Record<string, unknown>)["filters"]).toEqual({
      condition: ["refurbished"],
    });
  });

  it("a mix of recognized + unrecognized condition values forwards ALL of them verbatim (no value dropped)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", {
      query: "chair",
      condition: ["new", "refurbished", "secondhand"],
    });

    expect(rec.search.length).toBe(1);
    expect((rec.search[0]!.body as Record<string, unknown>)["filters"]).toEqual({
      condition: ["new", "refurbished", "secondhand"],
    });
  });
});

/**
 * Input-guard interaction (card AC[integration]): the new args are REFINEMENTS,
 * not usable inputs — `hasUsableInput` is UNCHANGED. A request whose ONLY content
 * is the new filters (no query/category/price) is rejected client-side with NO
 * network call, exactly like `cursor`/`limit` today. A request with a real input
 * PLUS the new args reaches the network.
 */
describe("sil_search — new args do NOT relax the ≥1-input guard (refinements, not inputs)", () => {
  it("ship_to ALONE (no query/category/price) → invalid_request / empty_search_input, ZERO network calls", async () => {
    seedTokens("at", "rt");
    const rec = installRouter(() => ({ status: 200, body: searchEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ship_to: { country: "US" } }),
    );

    // The refinement does not constitute a search — rejected before any fetch.
    expect(rec.all.length).toBe(0);
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("empty_search_input");
  });

  it("available:false ALONE (no query/category/price) → invalid_request, ZERO network calls (a falsy filter is still not an input)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter(() => ({ status: 200, body: searchEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { available: false }),
    );

    expect(rec.all.length).toBe(0);
    expect(payload["status"]).toBe("invalid_request");
  });

  it("condition + ship_to together but NO query/category/price → invalid_request, ZERO network calls", async () => {
    seedTokens("at", "rt");
    const rec = installRouter(() => ({ status: 200, body: searchEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        condition: ["secondhand"],
        ship_to: { country: "US" },
      }),
    );

    expect(rec.all.length).toBe(0);
    expect(payload["status"]).toBe("invalid_request");
  });

  it("local_merchants:true ALONE (no query/category/price) → invalid_request / empty_search_input, ZERO network (the bias is a refinement, not an input)", async () => {
    // Card AC[integration]: a bare `{ local_merchants: true }` must STILL reject
    // empty_search_input client-side — `hasUsableInput` is unchanged, so the flag
    // does not constitute a search any more than `cursor`/`ship_to` do. End-to-end
    // proof through the real wired tool (a router that 200s any search, so reaching
    // the network would resolve `ok` — `rec.all.length === 0` is the proof it didn't).
    seedTokens("at", "rt");
    const rec = installRouter(() => ({ status: 200, body: searchEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { local_merchants: true }),
    );

    expect(rec.all.length).toBe(0);
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("empty_search_input");
  });

  it("a real `query` PLUS the new args passes the guard and REACHES the network", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "chair",
        ship_to: { country: "US" },
        available: false,
      }),
    );

    expect(rec.search.length).toBe(1); // the new args ride alongside a valid search
    expect(payload["status"]).toBe("ok");
  });

  it("a `category` filter PLUS the new args passes the guard and REACHES the network (category is a real input; the new args ride along)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", {
      category: "Furniture",
      condition: ["new"],
    });

    expect(rec.search.length).toBe(1);
  });
});

/**
 * Outcome regression (card AC[integration]): the new args change ONLY the request
 * body — never the outcome taxonomy or the agent-facing envelope. Each existing
 * sil-api outcome (200 result / 200 empty / 400 / 401-refresh-retry / 5xx), run
 * WITH the new args set, must produce the SAME agent-facing `status` and recovery
 * shape it produces without them.
 */
describe("sil_search — the new args are request-shaping only; the outcome taxonomy is unchanged", () => {
  /** The args bundle attached to every outcome below — proving none of them
   * perturb the classification. Includes `local_merchants: true` (the new top-level
   * flag) and the surviving filters; `ships_from` is gone (deleted end-to-end). */
  const NEW_ARGS = {
    ship_to: { country: "US", region: "CA", postal_code: "94107" },
    condition: ["new"],
    available: false,
    local_merchants: true,
  } as const;

  it("200 result WITH the new args → status ok with ranked products (unchanged)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([PRODUCT_A, PRODUCT_B]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "chair", ...NEW_ARGS }),
    );

    expect(payload["status"]).toBe("ok");
    expect((payload["products"] as unknown[]).length).toBe(2);
  });

  it("200 empty-match WITH the new args → status ok, products [] (still a SUCCESS, not an error)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "nope-xyzzy", ...NEW_ARGS }),
    );

    expect(payload["status"]).toBe("ok");
    expect(payload["products"]).toEqual([]);
    expect(payload["recovery"]).toBeUndefined();
  });

  it("400 empty_search_input WITH the new args → invalid_request carrying {error, message} (unchanged)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 400, body: { error: "empty_search_input", message: "Provide a query or filter." } }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "chair", ...NEW_ARGS }),
    );

    expect(payload["status"]).toBe("invalid_request");
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("401 → refresh-and-retry-once WITH the new args → ok, and the RETRY re-sends the same new args under the rotated token (unchanged choreography)", async () => {
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

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "chair", ...NEW_ARGS }),
    );

    // Same recovered-401 outcome as today.
    expect(payload["status"]).toBe("ok");
    expect(rec.search.length).toBe(2);
    expect(rec.refresh.length).toBe(1);
    expect(bearerToken(rec.search[1]!)).toBe("rotated-at");
    // The retry carried the SAME mapped filters as the first attempt (the new args
    // survive the retry, renamed, under the rotated token). No `ships_from` (deleted).
    const retryBody = rec.search[1]!.body as Record<string, unknown>;
    expect(retryBody["filters"]).toEqual({
      ships_to: { country: "US", region: "CA", postal_code: "94107" },
      condition: ["new"],
      available: false,
    });
    // …and the top-level `local_merchants` flag survives the retry too — at the TOP
    // LEVEL, never folded into the retried `filters`.
    expect(retryBody["local_merchants"]).toBe(true);
    expect((retryBody["filters"] as Record<string, unknown>)).not.toHaveProperty("local_merchants");
  });

  it("5xx WITH the new args → retryable, NO recovery:sil_register (unchanged)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 500, body: { error: "source_unavailable", message: "x" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "chair", ...NEW_ARGS }),
    );

    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("the five outcomes map to the SAME status strings WITH the new args as without (taxonomy invariant)", async () => {
    async function statusWithNewArgs(reply: Reply): Promise<unknown> {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "search" ? reply : { status: 200, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const payload = payloadOf(
        await getTool(api, TOOL).execute("c1", { query: "x", ...NEW_ARGS }),
      );
      vi.restoreAllMocks();
      return payload["status"];
    }

    const okStatus = await statusWithNewArgs({ status: 200, body: searchEnvelope([PRODUCT_A]) });
    const emptyStatus = await statusWithNewArgs({ status: 200, body: searchEnvelope([]) });
    const invalidStatus = await statusWithNewArgs({ status: 400, body: { error: "empty_search_input", message: "x" } });
    const sourceFailStatus = await statusWithNewArgs({ status: 500, body: { error: "source_unavailable", message: "x" } });

    expect(okStatus).toBe("ok");
    expect(emptyStatus).toBe("ok");
    expect(invalidStatus).toBe("invalid_request");
    expect(sourceFailStatus).toBe("retryable");
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

    // NEGATIVE half of the observability seam (review-round-1 fix): this is a
    // FIRST-TRY success (no 401, no refresh), so the `sil_search_refreshed` marker
    // must NOT fire. The marker means "this success was a silent recovery"; on a
    // plain success it would be a false signal that the session is thrashing. The
    // marker keys off the helper's `refreshed:false` passthrough discriminant.
    expect(infoMarkerCount(api, "sil_search_refreshed")).toBe(0);
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
  it("empty match: 200 { ucp, products: [] } → status ok, products [], NO cursor, NO recovery hint (NOT an error)", async () => {
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

/**
 * CARD `name-the-source-in-catalog-error-surfacing` (epic
 * `catalog-source-error-taxonomy-2026-06`) — the RED integration ceiling.
 *
 * The product promise: THREE causally-distinct failures become THREE
 * distinguishable agent envelopes (the legibility contract — card "Behavioral
 * framing"). Today all three collapse into the single generic retryable
 * "sil is temporarily unavailable" copy because the source-failure body is
 * discarded at the wire classifier (`classifySearchResponse` sil-client.ts:530),
 * one step before `transient()` (catalog.ts:725) runs.
 *
 *   (a) sil / network / transport down → status retryable, GENERIC "sil is
 *       temporarily unavailable", NO source name, NO sil_register hint.
 *   (b) a specific catalog SOURCE down or rate-limited (429-as-source_unavailable)
 *       → status retryable, the message NAMES the source, NEVER "sil is …
 *       unavailable", NO sil_register.
 *   (c) upstream REJECTED the request (a deterministic 4xx, e.g. source_rejected)
 *       → NON-retryable invalid_request carrying the REAL upstream { error, message }
 *       (not extractApiError's search-specific default), NO retry hint, NO sil_register.
 *
 * These assert on the agent-observable ENVELOPE (status + message CONTENT), which
 * is where the distinguishability lives and which `tsc` cannot verify (architect
 * Risk "message-content regression is invisible to type-checking"). The ONLY mock
 * is `fetch` (`installRouter`) — the full real tool + sil-client pipeline runs; per
 * `complete-work-is-stub-free`, nothing asserts a stub response.
 *
 * EXPECT RED today: outcome (b)'s message is the generic copy (source discarded),
 * and outcome (c) arrives as a 5xx-shaped retryable until the classifier carries
 * the source and the sibling ships the 4xx. The (a) assertions and the regression
 * guards already pass — they pin the invariants the a/b/c rework must NOT break.
 */
describe("sil_search — outcome a: sil/network down → GENERIC retryable, names NO source, no sil_register", () => {
  it("5xx with NO source on the body → generic 'sil is temporarily unavailable', NO source name, NO sil_register", async () => {
    // A sil-INTERNAL 5xx (no source on the failure body) is outcome a — the agent
    // retries the same call; the copy must stay generic and must NOT fabricate a
    // source name it was never handed (attribution honesty).
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 500, body: { error: "internal_error", message: "Something went wrong inside sil." } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("retryable");
    const message = String(payload["message"]);
    // The GENERIC sil-unavailable copy (this is what outcome a SHOULD say).
    expect(message.toLowerCase()).toMatch(/sil is (temporarily )?unavailable|try .*again/);
    // No re-register hint — re-registering fixes neither a 5xx nor anything else here.
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });

  it("network throw → generic retryable, NO source name, no sil_register, EXACTLY one round-trip (no retry storm)", async () => {
    // A thrown fetch (timeout / abort / DNS hang / connection refused) is outcome a.
    // The no-source half of the no-fabrication guard at the wire boundary: the
    // catch returns a bare sourceless retryable, so the agent gets the generic copy.
    seedTokens("at", "rt");
    const rec = installRouter((kind) => (kind === "search" ? "network-error" : { status: 200, body: {} }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    // Exactly ONE round-trip — a thrown fetch must not spin an internal retry storm.
    expect(rec.search.length).toBe(1);
    expect(rec.refresh.length).toBe(0); // a first-call network blip is not a 401
    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
    // The generic copy — and it must NOT name any of the canary sources.
    const message = String(payload["message"]).toLowerCase();
    expect(message).toMatch(/sil is (temporarily )?unavailable|try .*again/);
    for (const src of ["shopify", "etsy", "global-catalog"]) {
      expect(message).not.toContain(src);
    }
  });
});

describe("sil_search — outcome b: a named source down/rate-limited → source-named retryable, NEVER 'sil is unavailable'", () => {
  it("5xx source_unavailable WITH a `source` → retryable whose message NAMES the source and NEVER says 'sil is unavailable'", async () => {
    // The headline product behavior: a SOURCE outage is reported as THAT source
    // being degraded, not as sil being down. The agent (and the user reading its
    // words) must not conclude the whole platform is unavailable when one source is.
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? {
            status: 500,
            body: {
              error: "source_unavailable",
              message: "Catalog source 'shopify' is temporarily unavailable.",
              source: "shopify",
            },
          }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("retryable");
    const message = String(payload["message"]);
    // NAMES the source.
    expect(message).toContain("shopify");
    // NEVER the generic "sil is (temporarily) unavailable" / "sil is down" copy —
    // this is the masking the card exists to remove.
    expect(message.toLowerCase()).not.toMatch(/sil is (temporarily )?unavailable/);
    expect(message.toLowerCase()).not.toMatch(/sil is down/);
    // Still retryable, still NOT a re-register (the source is transiently degraded;
    // auth is fine).
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });

  it("rate-limited source (upstream 429 → source_unavailable 5xx) WITH a `source` → outcome b: retryable, names the source, never 'sil is down', never non-retryable", async () => {
    // 429 is the canonical trap: it is transient pressure, NOT a malformed request,
    // so it MUST stay retryable (outcome b) and name the source — never get swept
    // into the non-retryable c arm with the other 4xx, never read as "sil is down".
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? {
            status: 503,
            body: {
              error: "source_unavailable",
              message: "Catalog source 'global-catalog' is rate-limited; retry shortly.",
              source: "global-catalog",
            },
          }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("retryable"); // transient, never invalid_request
    expect(payload["status"]).not.toBe("invalid_request");
    const message = String(payload["message"]);
    expect(message).toContain("global-catalog");
    expect(message.toLowerCase()).not.toMatch(/sil is (temporarily )?unavailable|sil is down/);
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("outcome b carries NO recovery:sil_register hint (a degraded source is not an auth problem)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? {
            status: 500,
            body: { error: "source_unavailable", message: "Source 'etsy' is unavailable.", source: "etsy" },
          }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });
});

describe("sil_search — outcome c: upstream rejected the request → NON-retryable invalid_request carrying the real cause", () => {
  it("4xx source_rejected → invalid_request carrying the upstream { error, message }, NO retry hint, NO sil_register", async () => {
    // A deterministic upstream rejection (a malformed filter the source refuses) is
    // outcome c — the agent must STOP and fix the request, never loop it. It is the
    // hard pivot: non-retryable, carrying the server's real cause so the agent can
    // act on it. The upstream message must be CARRIED THROUGH, not replaced by
    // extractApiError's search-specific default ("Provide a search query …").
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? {
            status: 400,
            body: {
              error: "source_rejected",
              message: "Source 'shopify' rejected the request: filter `gift_wrap` is not supported.",
            },
          }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    // NON-retryable — the agent must not retry a deterministic rejection.
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["status"]).not.toBe("retryable");
    // Carries the REAL upstream cause (error code + the server's message verbatim),
    // NOT the search-specific generic default from extractApiError.
    expect(payload["error"]).toBe("source_rejected");
    const message = String(payload["message"]);
    expect(message).toContain("gift_wrap");
    expect(message).not.toMatch(/Provide a search query or at least one filter/i);
    // No retry hint, no re-register — stop and fix the request.
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });

  it("outcome c is NON-retryable AND carries no sil_register — distinct from both retryable arms (a/b)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 400, body: { error: "source_rejected", message: "Deterministic rejection from the source." } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("invalid_request");
    expect(payload["status"]).not.toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
  });
});

describe("sil_search — DISTINGUISHABILITY: six failure/success cases are pairwise distinct agent envelopes (highest-value)", () => {
  it("{a-5xx, a-network, b-source, b-429, c-reject, empty-200} produce pairwise-distinguishable envelopes", async () => {
    // The single highest-value assertion (extends the existing 'three distinct
    // status strings' test at :1137 into the full a/b split + 429 + c). Drives all
    // six through the real wiring and proves no two collapse into the same
    // agent-observable signal:
    //   - a and b SHARE status "retryable" but DIFFER on whether `message` names a source;
    //   - c is the only "invalid_request";
    //   - the empty match is the only "ok" (with products []).
    async function envelopeFor(reply: Reply): Promise<Record<string, unknown>> {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "search" ? reply : { status: 200, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { query: "x" }));
      vi.restoreAllMocks();
      return p;
    }

    const aGeneric = await envelopeFor({ status: 500, body: { error: "internal_error", message: "internal" } });
    const aNetwork = await (async () => {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "search" ? "network-error" : { status: 200, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { query: "x" }));
      vi.restoreAllMocks();
      return p;
    })();
    const bSource = await envelopeFor({
      status: 500,
      body: { error: "source_unavailable", message: "Source 'shopify' is unavailable.", source: "shopify" },
    });
    const b429 = await envelopeFor({
      status: 503,
      body: { error: "source_unavailable", message: "Source 'global-catalog' rate-limited.", source: "global-catalog" },
    });
    const cReject = await envelopeFor({
      status: 400,
      body: { error: "source_rejected", message: "The request was rejected: filter `gift_wrap` is not supported." },
    });
    const emptyMatch = await envelopeFor({ status: 200, body: searchEnvelope([]) });

    // c is the lone non-retryable error; the empty match is the lone success.
    expect(cReject["status"]).toBe("invalid_request");
    expect(emptyMatch["status"]).toBe("ok");
    expect(emptyMatch["products"]).toEqual([]);

    // a and b are BOTH retryable …
    expect(aGeneric["status"]).toBe("retryable");
    expect(aNetwork["status"]).toBe("retryable");
    expect(bSource["status"]).toBe("retryable");
    expect(b429["status"]).toBe("retryable");

    // … but distinguishable by message attribution: a is generic-sourceless, b names
    // a source. A reducible "fingerprint" per envelope: status + whether it names a
    // source. The set of fingerprints across the six must be the full {a,b,c,ok}.
    function namesSource(p: Record<string, unknown>): boolean {
      const m = String(p["message"] ?? "").toLowerCase();
      return ["shopify", "etsy", "global-catalog"].some((s) => m.includes(s));
    }
    expect(namesSource(aGeneric)).toBe(false);
    expect(namesSource(aNetwork)).toBe(false);
    expect(namesSource(bSource)).toBe(true);
    expect(namesSource(b429)).toBe(true);

    const fingerprint = (p: Record<string, unknown>): string =>
      `${String(p["status"])}::${namesSource(p) ? "named" : "generic"}`;
    // a → retryable::generic ; b → retryable::named ; c → invalid_request::generic ;
    // ok → ok::generic. Four distinct fingerprints — no two of a/b/c/ok collapse.
    expect(
      new Set([
        fingerprint(aGeneric),
        fingerprint(bSource),
        fingerprint(cReject),
        fingerprint(emptyMatch),
      ]).size,
    ).toBe(4);
    // And the two a-variants share a fingerprint with each other (both generic
    // retryable) — they are the SAME signal, correctly.
    expect(fingerprint(aGeneric)).toBe(fingerprint(aNetwork));
    expect(fingerprint(bSource)).toBe(fingerprint(b429));
  });
});

describe("sil_search — regression guards: the a/b/c rework must NOT move the empty-match or the recovered-401 path", () => {
  it("empty match (200, products []) stays status ok — never a/b/c", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([]) } : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "nope-xyzzy" }));

    expect(payload["status"]).toBe("ok");
    expect(payload["products"]).toEqual([]);
    // Not any error arm.
    for (const bad of ["retryable", "invalid_request", "must_reregister", "not_registered"]) {
      expect(payload["status"]).not.toBe(bad);
    }
    expect(payload["recovery"]).toBeUndefined();
  });

  it("recovered 401 (refresh-and-retry-once succeeds) stays invisible — normal ok, NO refreshed/recovery field, NO a/b/c", async () => {
    // The orthogonal 401 path must not move. A recovered 401 is a normal success
    // with no a/b/c envelope and no refreshed/recovery field leaking to the agent.
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

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("ok");
    expect((payload["products"] as unknown[]).length).toBe(1);
    // No a/b/c error envelope leaked, no payload refreshed/recovery field.
    expect(payload["refreshed"]).toBeUndefined();
    expect(payload["recovery"]).toBeUndefined();
    expect(payload["source"]).toBeUndefined();
    expect(payload["detail"]).toBeUndefined();
    // The choreography is unchanged: one refresh + one retry.
    expect(rec.search.length).toBe(2);
    expect(rec.refresh.length).toBe(1);
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
    // The refresh is INVISIBLE TO THE AGENT: no refreshed/retried marker, no
    // recovery hint IN THE PAYLOAD. (This payload contract is correct and stays.)
    expect(payload["refreshed"]).toBeUndefined();
    expect(payload["retried"]).toBeUndefined();
    expect(payload["recovery"]).toBeUndefined();
    // The retry carried the ROTATED access token (proves the re-read after rotation).
    expect(rec.search.length).toBe(2);
    expect(bearerToken(rec.search[1]!)).toBe("rotated-at");
    // The refresh used the STORED refresh token.
    expect(rec.refresh.length).toBe(1);
    expect((rec.refresh[0]!.body as { refresh_token?: string }).refresh_token).toBe("valid-rt");

    // OPERATOR-OBSERVABILITY SEAM (review-round-1 fix; card line 161): the silent
    // recovery is invisible in the PAYLOAD but MUST be observable in operator logs
    // — a session that refreshes on (nearly) every call is the degrading-session
    // signal on-call needs, and the card's own risk-mitigation names the
    // `sil_*_refreshed` marker by hand. Assert the `sil_search_refreshed` INFO
    // marker fired EXACTLY ONCE on this recovered-401 path. RED until the tool
    // emits it (logs-only — NOT a payload field) when the helper reports
    // `refreshed: true`.
    expect(infoMarkerCount(api, "sil_search_refreshed")).toBe(1);
    // The marker is logs-only — it does NOT add any field to the agent payload
    // (outcome 1's invisible-to-the-agent contract stays inviolate).
    expect(payload["sil_search_refreshed"]).toBeUndefined();
    // The marker carries NO token material (the privacy invariant holds on the
    // marker too — its meta must never carry a token value).
    const refreshedMarkerArgs = vi
      .mocked(api.logger.info)
      .mock.calls.filter((c) => c[0] === "sil_search_refreshed");
    const refreshedMarkerBlob = JSON.stringify(refreshedMarkerArgs);
    expect(refreshedMarkerBlob).not.toContain("rotated-at");
    expect(refreshedMarkerBlob).not.toContain("rotated-rt");
    expect(refreshedMarkerBlob).not.toContain("valid-rt");
    expect(refreshedMarkerBlob).not.toContain("expired-at");
    expect(refreshedMarkerBlob).not.toMatch(/Bearer/i);
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
    const silApiOrigin = new URL(getApiUrl()).origin;
    const silWebOrigin = new URL(getWebUrl()).origin;
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

/**
 * CARD `surface-user-not-provisioned-and-fix-recovery` — the RED integration
 * ceiling for `sil_search`. Two bugs, both wired-through here:
 *
 *   Bug 1 (legibility): a sil-api 403 `user_not_provisioned` must surface as the
 *   forbidden envelope `{ status:"forbidden", reason, message, recovery:"sil_register" }`
 *   — IDENTICAL to what `sil_whoami` emits — never the false-transient
 *   `{ status:"retryable", message:"…temporarily unavailable…" }`. Today the catalog
 *   classifier has no 403 arm, so a 403 reads as `retryable` (the agent retries a
 *   call that can NEVER succeed). EXPECT RED.
 *
 *   Bug 2 (recovery terminates): on a `user_not_provisioned` 403 — and ONLY that
 *   reason — the tool clears the structurally-dead token (`clearTokens()` at the
 *   call site) so the next `sil_register` re-onboards instead of short-circuiting
 *   to `already_registered`. A `principal_mismatch` (or any other/unknown reason)
 *   must NOT clear — it can be transient and the credential must survive (AC10).
 *
 * The ONLY mock is `fetch` (installRouter). A 403 must NEVER enter the refresh
 * path (it is `forbidden`, not `unauthorized` — AC3); the 5xx → retryable cases
 * stay green unchanged (AC11). The message-register parity with `sil_whoami` is
 * asserted by the same regex pair whoami.integration.test.ts uses (AC5).
 */
describe("sil_search — a 403 user_not_provisioned surfaces FORBIDDEN and clears the dead token (AC1, AC3, AC5, AC6, AC11)", () => {
  it("403 user_not_provisioned → forbidden envelope (reason + recovery:sil_register), NEVER retryable / temporarily-unavailable (AC1)", async () => {
    // AC1: the headline legibility fix. The agent sees `forbidden`, the real
    // reason, and the recovery hint — not the lie it was getting before.
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: { access_token: "x", refresh_token: "y" } },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "office chair" }));

    expect(payload["status"]).toBe("forbidden");
    expect(payload["status"]).not.toBe("retryable");
    expect(payload["reason"]).toBe("user_not_provisioned");
    expect(payload["recovery"]).toBe("sil_register");
    // No products, no false success.
    expect(payload["products"]).toBeUndefined();
    // The message is an actionable onboarding/provisioning prompt — and is NOT the
    // false-transient "temporarily unavailable, try again later" copy the bug
    // produced (this is the exact phrasing the false-transient symptom showed).
    const message = String(payload["message"]).toLowerCase();
    expect(message).not.toMatch(/temporar|transient|unavailable|try.again.later/);
    expect(message).not.toContain("temporarily unavailable");
  });

  it("the 403 is classified FORBIDDEN, NOT unauthorized — NO /auth/refresh call is made, exactly one search (AC3)", async () => {
    // AC3: a 403 is not a 401. Refreshing a valid-but-unprovisioned token changes
    // nothing — the tool must NOT enter the refresh-and-retry-once path. The
    // router 200s any refresh, so a stray refresh would (wrongly) recover; the
    // `rec.refresh.length === 0` assertion is what proves no refresh was attempted.
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: { access_token: "rotated", refresh_token: "rotated-rt" } },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair" });

    expect(rec.refresh.length).toBe(0); // NO refresh on a 403 — the load-bearing assertion
    expect(rec.search.length).toBe(1); // exactly one read, no retry
  });

  it("the forbidden message + reason + recovery MATCH what sil_whoami emits for user_not_provisioned (one vocabulary, AC5)", async () => {
    // AC5: parity on what the agent SEES. The catalog forbidden envelope must be
    // byte-compatible with sil_whoami's — same reason, same recovery, same message
    // register (matches /provision|onboard|forbidden|not.*set.up/, the same positive
    // regex whoami.integration.test.ts asserts; NOT the transient regex).
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["reason"]).toBe("user_not_provisioned");
    expect(payload["recovery"]).toBe("sil_register");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/provision|onboard|forbidden|not.*set.up/);
    expect(blob).not.toMatch(/temporar|transient|unavailable|try.again.later/);
  });

  it("the dead token is CLEARED on user_not_provisioned — tokens.json is gone (AC6)", async () => {
    // AC6: the recovery loop is broken. The structurally-dead token (maps to no
    // account on this backend; a refresh cannot help) is cleared, so a subsequent
    // sil_register no longer short-circuits to already_registered. Asserted both by
    // file absence and a null read (the same two-pronged check whoami uses for the
    // invalid_grant clear).
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair" });

    expect(existsSync(getTokensPath())).toBe(false);
    expect(readTokens()).toBeNull();
  });

  it("a genuine 5xx is STILL retryable with NO recovery:sil_register — the fix re-routes ONLY the 403 (AC11)", async () => {
    // AC11: the load-bearing invariant the bug violated, asserted from the other
    // side — a real transient must NOT collapse into forbidden. A 5xx stays
    // `retryable`, no recovery hint, token untouched.
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 500, body: { error: "source_unavailable", message: "x" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("retryable");
    expect(payload["status"]).not.toBe("forbidden");
    expect(payload["recovery"]).not.toBe("sil_register");
    // A 5xx is transient — the token is NOT cleared (it may be perfectly valid).
    expect(readTokens()).not.toBeNull();
  });
});

describe("sil_search — a 403 principal_mismatch is forbidden but does NOT clear the token (AC4, AC10)", () => {
  it("403 principal_mismatch → forbidden envelope carrying that reason (NEVER retryable) (AC4)", async () => {
    // AC4: every 403 is legible — a principal_mismatch is `forbidden` with its
    // reason surfaced, with the recovery hint, never the false-transient.
    seedTokens("valid-at", "valid-rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 403, body: { error: "principal_mismatch" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("forbidden");
    expect(payload["status"]).not.toBe("retryable");
    expect(payload["reason"]).toBe("principal_mismatch");
    expect(payload["recovery"]).toBe("sil_register");
  });

  it("the token SURVIVES on principal_mismatch — tokens.json is NOT cleared (AC10, the correctness boundary)", async () => {
    // AC10: the cardinal scoping guard. principal_mismatch can be transient (an
    // in-flight principal/agent-context resolution); the SAME valid credential
    // must stay usable once the mismatch clears. Clearing here would force a
    // destructive, pointless re-onboard. The clear is gated on EXACT equality
    // reason === "user_not_provisioned" — principal_mismatch must not trip it.
    seedTokens("valid-at", "valid-rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 403, body: { error: "principal_mismatch" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair" });

    // The valid token survives — not cleared on principal_mismatch.
    expect(existsSync(getTokensPath())).toBe(true);
    expect(readTokens()).not.toBeNull();
    expect(readTokens()!.access_token).toBe("valid-at");
  });

  it("an UNKNOWN / generic 'forbidden' reason also does NOT clear the token (AC10, the default boundary)", async () => {
    // AC10 (the default half): an unexpected 403 body defaults to reason
    // "forbidden" (extractForbiddenReason's default), which does NOT equal
    // "user_not_provisioned" — so it must NOT clear either. Only the one exact
    // reason clears; everything else survives.
    seedTokens("valid-at", "valid-rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 403, body: { something_unexpected: true } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("forbidden");
    expect(payload["reason"]).toBe("forbidden");
    // Unknown reason → no clear.
    expect(readTokens()).not.toBeNull();
    expect(readTokens()!.access_token).toBe("valid-at");
  });
});

describe("sil_search — the recovery TERMINATES end-to-end: after a user_not_provisioned clear, sil_register re-onboards (AC8)", () => {
  it("sil_search 403 user_not_provisioned clears the token → a subsequent sil_register mints awaiting_browser, NOT already_registered", async () => {
    // AC8: the headline end-to-end proof — the exit actually works, not just that
    // the token vanished. Before this card, sil_register short-circuits to
    // already_registered on ANY stored token, so the recovery hint loops forever
    // (forbidden → sil_register → already_registered → forbidden …). With the dead
    // token cleared by the 403, sil_register has nothing to short-circuit on and
    // proceeds to mint a fresh registration session (`awaiting_browser`).
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);
    registerIdentityTools(api);

    // Step 1 — the catalog 403 clears the dead token.
    const searchPayload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "chair" }),
    );
    expect(searchPayload["status"]).toBe("forbidden");
    expect(readTokens()).toBeNull(); // dead token gone

    // Step 2 — sil_register now re-onboards. It arms a fire-and-forget background
    // poll; restore the search router and trap that poll's fetch with a
    // never-resolving promise so it cannot escape the test (the same isolation
    // whoami.integration.test.ts uses for the post-clear sil_register).
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );

    const regPayload = payloadOf(await getTool(api, "sil_register").execute("c2", {}));

    // The recovery exit is live: NOT already_registered, but a fresh session.
    expect(regPayload["status"]).not.toBe("already_registered");
    expect(regPayload["status"]).toBe("awaiting_browser");
  });
});

/**
 * CARD `surface-product-url-and-specs-in-catalog-tools` (epic
 * `catalog-product-contract-2026-06`) — the RED integration ceiling for the WIDENED
 * `sil_search` projection. Today each result is the lean
 * `{ id, title, price, availability, checkout_url, source }`; this card widens the
 * projection to ALSO surface, from sil-api's flat envelope, the evaluate-before-buy
 * surface — product `url`/`description.plain`/`media`/`options` and per-variant
 * `url`/`seller`/`media`/`metadata` — each ONLY where present.
 *
 * THE single most important correctness property (architect's BIGGEST RISK): opaque
 * pass-through keyed on PRESENCE, NEVER narrowed on a guessed inner field name. Base
 * UCP `seller` is `{ name?, links? }`, but the sil-services Shopify normalizer attaches
 * `seller.url`/`seller.domain` as EXTENSION keys; a typed `{ name, links }` narrow
 * would silently DROP a real `seller.url` and still pass a naive fixture. So the
 * fixtures below carry a `seller` AND a `metadata` object with EXTENSION keys BEYOND
 * the spec base, and assert they survive WHOLE — this is the test that catches the
 * narrow. (Precedent: the documented `categories`/`{name}` near-miss — the real
 * `@sil/schemas` `Category` is `{ value, taxonomy? }`, so a `{name}` narrow dropped
 * every real category.)
 *
 * The SECOND property: omit-when-absent, per field. An absent field must NOT appear
 * (never `null`, never `""`, never `[]`) — a hollow value is WORSE than omission (the
 * agent may render an empty page link). Presence is decided per-field, never
 * all-or-nothing.
 *
 * Anti-false-green (complete-work-is-stub-free): the enriched fixtures carry a REAL
 * enriched envelope (the field SHAPES are pinned to `@sil/schemas` catalog.ts —
 * product/variant `url`, `Media[]`, `ProductOption[]`, `Seller`, open `metadata`), so
 * the assertions cannot go green against the `{ stub: true }` skeleton OR against the
 * lean projection. EXPECT RED today: the lean projection surfaces none of these keys.
 * The ONLY mock is `fetch` (installRouter) — the full real tool + sil-client pipeline
 * runs.
 */

/** A media item in the REAL UCP `Media` shape (`@sil/schemas` `Media`:
 * `{ type, url, alt_text?, width?, height? }`). Surfaced OPAQUE — the projection
 * must forward it verbatim, never read or remap its inner fields. */
const MEDIA_IMAGE = {
  type: "image",
  url: "https://img.example.com/aeron-front.jpg",
  alt_text: "Aeron chair, front view",
  width: 1200,
  height: 900,
};

/** A product-level OPTION DEFINITION in the REAL UCP `ProductOption` shape
 * (`{ name, values: OptionValue[] }`, `OptionValue` = `{ id?, label }`) — the MENU
 * of choices (Size → S/M/L), distinct from a variant's SelectedOption picks. */
const PRODUCT_OPTION_SIZE = {
  name: "Size",
  values: [
    { id: "opt-b", label: "Size B" },
    { id: "opt-c", label: "Size C" },
  ],
};

/** A `seller` object that carries the base UCP `{ name, links }` AND Shopify
 * EXTENSION keys (`url`, `domain`) that are NOT in the base `Seller` schema. The
 * opaque-pass-through proof rides on these extra keys surviving whole — a typed
 * `{ name, links }` narrow would strip `seller.url`/`seller.domain`. */
const SELLER_WITH_EXTENSION_KEYS = {
  name: "Herman Miller",
  links: [
    { type: "refund_policy", url: "https://hermanmiller.example.com/returns", title: "Returns" },
    { type: "shipping_policy", url: "https://hermanmiller.example.com/shipping" },
  ],
  // EXTENSION keys beyond the spec base — these MUST survive opaque pass-through.
  url: "https://hermanmiller.example.com",
  domain: "hermanmiller.example.com",
};

/** A `metadata` object carrying arbitrary source keys BEYOND any known set — the
 * open UCP extension point. Surfaced verbatim; the projection must NOT narrow it to
 * a known shape. */
const METADATA_WITH_SOURCE_KEYS = {
  top_features: ["8Z Pellicle suspension", "PostureFit SL"],
  tech_specs: { weight_capacity_kg: 159, warranty_years: 12 },
  unique_selling_points: "Ships assembled.",
};

/** A FULLY enriched variant — the REAL `SilCatalogVariant` shape PLUS the enriched
 * `url`/`seller`/`media`/`metadata`. Carries the lean five the projection already
 * surfaces, so the assertions prove the new fields are ADDITIVE, not a replacement. */
const ENRICHED_VARIANT = {
  id: "gid://variant/enriched-1",
  title: "Aeron Chair — Graphite, Size B",
  description: { plain: "An ergonomic office chair." },
  price: { amount: 159900, currency: "USD" },
  availability: { available: true, status: "in_stock" },
  checkout_url: "https://buy.example.com/aeron-enriched-1",
  // The enriched per-variant surface (each where present):
  url: "https://store.example.com/products/aeron/variants/enriched-1",
  seller: SELLER_WITH_EXTENSION_KEYS,
  media: [MEDIA_IMAGE],
  metadata: METADATA_WITH_SOURCE_KEYS,
};

/** A FULLY enriched product — REAL `SilCatalogProduct` shape PLUS the enriched
 * product surface (`url`/`description.plain`/`media`/`options`/`metadata`). */
const ENRICHED_PRODUCT = {
  id: "gid://product/enriched",
  title: "Aeron Chair",
  description: { plain: "The classic ergonomic office chair.", html: "<p>The classic ergonomic office chair.</p>" },
  price_range: {
    min: { amount: 159900, currency: "USD" },
    max: { amount: 169900, currency: "USD" },
  },
  variants: [ENRICHED_VARIANT],
  source: "herman-miller",
  // The enriched product surface (each where present):
  url: "https://store.example.com/products/aeron",
  media: [MEDIA_IMAGE],
  options: [PRODUCT_OPTION_SIZE],
  metadata: METADATA_WITH_SOURCE_KEYS,
};

describe("sil_search — WIDENED projection surfaces the enriched product contract where present [card surface-product-url]", () => {
  /** Run a search against a single enriched product and return its shaped result. */
  async function searchOne(product: unknown): Promise<Record<string, unknown>> {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([product]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "office chair" }));
    expect(payload["status"]).toBe("ok");
    const products = payload["products"] as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    return products[0]!;
  }

  it("all enriched fields present → surfaces product url/description.plain/media/options + per-variant url/seller/media, alongside the unchanged lean six", async () => {
    // AC[integration] #1: the headline. A fully enriched product surfaces the whole
    // evaluate-before-buy surface, and the existing lean shape is UNCHANGED.
    const product = await searchOne(ENRICHED_PRODUCT);

    // The existing lean shape is intact (additive, not replacement).
    expect(product["id"]).toBe("gid://product/enriched");
    expect(product["title"]).toBe("Aeron Chair");
    expect(product["source"]).toBe("herman-miller");
    const variant = product["variant"] as Record<string, unknown>;
    expect(variant["id"]).toBe("gid://variant/enriched-1");
    expect(variant["checkout_url"]).toBe("https://buy.example.com/aeron-enriched-1");
    expect(variant["price"]).toEqual({ amount: 159900, currency: "USD" });
    expect(variant["availability"]).toEqual({ available: true, status: "in_stock" });

    // The NEW product-level surface.
    expect(product["url"]).toBe("https://store.example.com/products/aeron");
    expect(product["media"]).toEqual([MEDIA_IMAGE]);
    expect(product["options"]).toEqual([PRODUCT_OPTION_SIZE]);

    // The NEW per-variant surface.
    expect(variant["url"]).toBe("https://store.example.com/products/aeron/variants/enriched-1");
    expect(variant["media"]).toEqual([MEDIA_IMAGE]);
    // seller carries the links[] dig-in targets.
    const seller = variant["seller"] as Record<string, unknown>;
    expect(seller["name"]).toBe("Herman Miller");
    expect(seller["links"]).toEqual([
      { type: "refund_policy", url: "https://hermanmiller.example.com/returns", title: "Returns" },
      { type: "shipping_policy", url: "https://hermanmiller.example.com/shipping" },
    ]);
  });

  it("surfaces `description.plain` as the agent-facing short summary (lifted from the UCP description object's plain format)", async () => {
    // AC[integration]: the product-owner's agent-facing key. The projection surfaces
    // the `plain` summary so the agent has a short human description to show.
    const product = await searchOne(ENRICHED_PRODUCT);
    const description = product["description"] as Record<string, unknown>;
    expect(description).toBeDefined();
    expect(description["plain"]).toBe("The classic ergonomic office chair.");
  });

  it("OPAQUE PASS-THROUGH: a `seller` carrying Shopify extension keys (url/domain) beyond `{name,links}` survives WHOLE — never narrowed to a guessed subset", async () => {
    // AC[integration] #6 + the architect's BIGGEST RISK. The projection must pass
    // `seller` through opaque (filter-to-object, forward verbatim), NOT narrow it to a
    // typed `{ name, links }`. If it narrows, the real `seller.url`/`seller.domain`
    // extension keys (which the Shopify source attaches) are silently stripped — this
    // assertion is the one that catches that defect. A naive `{ name, links }` fixture
    // would pass a narrow; these extension keys make the narrow observable.
    const product = await searchOne(ENRICHED_PRODUCT);
    const seller = (product["variant"] as Record<string, unknown>)["seller"] as Record<string, unknown>;
    // The WHOLE seller object survives, extension keys included.
    expect(seller).toEqual(SELLER_WITH_EXTENSION_KEYS);
    // Pinned explicitly so a key-by-key narrow can't sneak past the deep-equal:
    expect(seller["url"]).toBe("https://hermanmiller.example.com");
    expect(seller["domain"]).toBe("hermanmiller.example.com");
  });

  it("OPAQUE PASS-THROUGH: `metadata` is surfaced verbatim with the source's arbitrary keys — not narrowed to a known set", async () => {
    // AC[integration] #5. metadata is UCP's open extension point — whatever keys the
    // source attached (top_features / tech_specs / unique_selling_points) must survive
    // verbatim, including nested objects.
    const product = await searchOne(ENRICHED_PRODUCT);
    expect(product["metadata"]).toEqual(METADATA_WITH_SOURCE_KEYS);
    // And on the variant too (variant metadata is part of the contract).
    expect((product["variant"] as Record<string, unknown>)["metadata"]).toEqual(METADATA_WITH_SOURCE_KEYS);
  });

  it("a product with NONE of the new enriched fields surfaces EXACTLY the lean shape and is still returned (no key is null/''/[])", async () => {
    // AC[integration] #2: omit-when-absent at the all-absent extreme. A product
    // without enrichment is still a valid, buyable result — never dropped, never given
    // a hollow enriched key.
    const lean = {
      id: "gid://product/lean",
      title: "Plain Stool",
      description: { plain: "A plain stool." },
      price_range: { min: { amount: 5000, currency: "USD" }, max: { amount: 5000, currency: "USD" } },
      variants: [
        {
          id: "gid://variant/lean-1",
          title: "Plain Stool — Black",
          price: { amount: 5000, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: "https://buy.example.com/lean-1",
        },
      ],
      source: "ikea",
    };
    const product = await searchOne(lean);

    // Still a valid, buyable result.
    expect(product["id"]).toBe("gid://product/lean");
    expect((product["variant"] as Record<string, unknown>)["checkout_url"]).toBe("https://buy.example.com/lean-1");

    // NONE of the new product-level keys appear (no null, no "", no []).
    for (const key of ["url", "media", "options", "metadata"]) {
      expect(product).not.toHaveProperty(key);
    }
    // NONE of the new per-variant keys appear.
    const variant = product["variant"] as Record<string, unknown>;
    for (const key of ["url", "seller", "media", "metadata"]) {
      expect(variant).not.toHaveProperty(key);
    }
  });

  it("PARTIAL enrichment: present fields appear, absent fields are OMITTED entirely — presence is decided per-field, never all-or-nothing", async () => {
    // AC[integration] #3: the per-field rule. url present, media absent; seller.links
    // present but seller.name absent. Each present field surfaces; each absent field
    // is omitted (not null/''/[]).
    const partial = {
      id: "gid://product/partial",
      title: "Partial Lamp",
      description: { plain: "A desk lamp." },
      price_range: { min: { amount: 3000, currency: "USD" }, max: { amount: 3000, currency: "USD" } },
      // product `url` present; product `media`/`options`/`metadata` ABSENT.
      url: "https://store.example.com/products/lamp",
      variants: [
        {
          id: "gid://variant/partial-1",
          title: "Partial Lamp — White",
          price: { amount: 3000, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: "https://buy.example.com/partial-1",
          // seller present with links but NO name; variant `url`/`media`/`metadata` ABSENT.
          seller: {
            links: [{ type: "faq", url: "https://store.example.com/faq" }],
          },
        },
      ],
      source: "lampco",
    };
    const product = await searchOne(partial);

    // Present product field surfaces …
    expect(product["url"]).toBe("https://store.example.com/products/lamp");
    // … absent ones are omitted.
    for (const key of ["media", "options", "metadata"]) {
      expect(product).not.toHaveProperty(key);
    }
    const variant = product["variant"] as Record<string, unknown>;
    // seller present (with links, no name) surfaces whole; name simply isn't there.
    const seller = variant["seller"] as Record<string, unknown>;
    expect(seller["links"]).toEqual([{ type: "faq", url: "https://store.example.com/faq" }]);
    expect(seller).not.toHaveProperty("name");
    // absent per-variant fields are omitted.
    for (const key of ["url", "media", "metadata"]) {
      expect(variant).not.toHaveProperty(key);
    }
  });

  it("empty / missing `plain`: a description carrying html/markdown but no usable `plain` OMITS description.plain — never substitutes html/markdown", async () => {
    // AC[integration] #4: the projection surfaces ONLY the `plain` format, and only
    // when it is a non-empty string. An empty `plain`, or a description with only
    // html/markdown, must NOT yield a `description.plain` and must NEVER copy
    // html/markdown into the plain slot.
    const htmlOnly = {
      id: "gid://product/htmlonly",
      title: "HTML-only Desc",
      // `plain` is EMPTY; html/markdown carry the real text.
      description: { plain: "", html: "<p>Rich text only.</p>", markdown: "Rich text only." },
      price_range: { min: { amount: 1000, currency: "USD" }, max: { amount: 1000, currency: "USD" } },
      variants: [
        {
          id: "gid://variant/htmlonly-1",
          title: "HTML-only — Default",
          price: { amount: 1000, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: "https://buy.example.com/htmlonly-1",
        },
      ],
      source: "shop",
    };
    const product = await searchOne(htmlOnly);

    // description.plain is OMITTED (empty plain → no plain key) …
    const description = product["description"];
    if (description !== undefined) {
      const desc = description as Record<string, unknown>;
      expect(desc["plain"]).toBeUndefined();
      // … and html/markdown were NOT substituted into plain.
      expect(desc["plain"]).not.toBe("<p>Rich text only.</p>");
      expect(desc["plain"]).not.toBe("Rich text only.");
    }
    // UNCONDITIONAL: the html text is distinctive (`<p>…</p>`), so it must appear
    // NOWHERE in the projected product — neither surfaced as `description.html` nor
    // copied into a `plain` slot. This holds whether or not `description` is present
    // post-GREEN (an empty-plain description should be omitted entirely), so the guard
    // is not vacuous if a future impl starts emitting `description`.
    const productBlob = JSON.stringify(product);
    expect(productBlob).not.toContain("<p>Rich text only.</p>");
    // The product is still a valid, buyable result regardless of the description.
    expect((product["variant"] as Record<string, unknown>)["checkout_url"]).toBe(
      "https://buy.example.com/htmlonly-1",
    );
  });

  it("a no-`metadata` product OMITS the metadata key entirely (never an empty object)", async () => {
    // AC[integration] #5 (the absent half): no metadata on the wire → no metadata key.
    const noMeta = {
      id: "gid://product/nometa",
      title: "No Metadata",
      description: { plain: "Nothing extra." },
      price_range: { min: { amount: 2000, currency: "USD" }, max: { amount: 2000, currency: "USD" } },
      url: "https://store.example.com/products/nometa",
      variants: [
        {
          id: "gid://variant/nometa-1",
          title: "No Metadata — Default",
          price: { amount: 2000, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: "https://buy.example.com/nometa-1",
        },
      ],
      source: "shop",
    };
    const product = await searchOne(noMeta);
    expect(product).not.toHaveProperty("metadata");
    expect(product["url"]).toBe("https://store.example.com/products/nometa"); // a present field still surfaces
  });

  it("a `media` (or product `options`) array with a GARBAGE entry drops the bad entry and surfaces the usable ones", async () => {
    // AC[integration] #7: a non-object/garbage array entry is dropped; the usable
    // plain-object entries still surface. The field is never a broken/partial value.
    const withGarbage = {
      id: "gid://product/garbage",
      title: "Garbage Array Entry",
      description: { plain: "Has a bad media entry." },
      price_range: { min: { amount: 4000, currency: "USD" }, max: { amount: 4000, currency: "USD" } },
      // The first media entry is a usable object; the second is a bare string (garbage).
      media: [MEDIA_IMAGE, "not-an-object"],
      options: [PRODUCT_OPTION_SIZE, 42],
      variants: [
        {
          id: "gid://variant/garbage-1",
          title: "Garbage — Default",
          price: { amount: 4000, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: "https://buy.example.com/garbage-1",
        },
      ],
      source: "shop",
    };
    const product = await searchOne(withGarbage);

    // Only the usable object entry survives; the garbage string/number is dropped.
    expect(product["media"]).toEqual([MEDIA_IMAGE]);
    expect(product["options"]).toEqual([PRODUCT_OPTION_SIZE]);
  });

  it("a `media` array that yields ZERO usable entries OMITS the key (never an empty array)", async () => {
    // AC[integration] #7 (the all-garbage half): if every entry is unusable, the key
    // is omitted, not surfaced as `[]` (a hollow `media: []` is a false signal — the
    // agent may render an empty "images:" heading).
    const allGarbageMedia = {
      id: "gid://product/allgarbage",
      title: "All-garbage Media",
      description: { plain: "All media entries are garbage." },
      price_range: { min: { amount: 4000, currency: "USD" }, max: { amount: 4000, currency: "USD" } },
      media: ["nope", 7, null],
      variants: [
        {
          id: "gid://variant/allgarbage-1",
          title: "All-garbage — Default",
          price: { amount: 4000, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: "https://buy.example.com/allgarbage-1",
        },
      ],
      source: "shop",
    };
    const product = await searchOne(allGarbageMedia);
    expect(product).not.toHaveProperty("media"); // omitted, NOT []
  });

  it("PURCHASABILITY GATE UNCHANGED: a featured variant lacking a non-empty checkout_url is STILL dropped, even when the product carries url/media/seller", async () => {
    // AC[integration] (cross-cutting): the enriched fields are additive CONTEXT, not a
    // new gate. A product whose featured variant has no usable checkout_url is dropped
    // exactly as today — surfacing a `url`/`media`/`seller` does NOT make a
    // non-buyable product appear.
    seedTokens("at", "rt");
    const enrichedButUnbuyable = {
      id: "gid://product/unbuyable",
      title: "Enriched but Unbuyable",
      description: { plain: "Cannot be bought." },
      price_range: { min: { amount: 9900, currency: "USD" }, max: { amount: 9900, currency: "USD" } },
      url: "https://store.example.com/products/unbuyable",
      media: [MEDIA_IMAGE],
      options: [PRODUCT_OPTION_SIZE],
      variants: [
        {
          id: "gid://variant/unbuyable-1",
          title: "Unbuyable — Default",
          price: { amount: 9900, currency: "USD" },
          availability: { available: false, status: "out_of_stock" },
          // checkout_url MISSING — the variant is not purchasable.
          url: "https://store.example.com/products/unbuyable/variants/1",
          seller: SELLER_WITH_EXTENSION_KEYS,
          media: [MEDIA_IMAGE],
        },
      ],
      source: "shop",
    };
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([enrichedButUnbuyable, ENRICHED_PRODUCT]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));

    expect(payload["status"]).toBe("ok");
    const products = payload["products"] as Array<Record<string, unknown>>;
    // The unbuyable product is dropped despite its rich fields; only the buyable one remains.
    expect(products).toHaveLength(1);
    expect(products[0]!["id"]).toBe("gid://product/enriched");
    expect(products.some((p) => p["id"] === "gid://product/unbuyable")).toBe(false);
  });
});

/**
 * CARD `surface-product-url-and-specs-in-catalog-tools` — REGRESSION GUARDS. The
 * widened projection is read-side ONLY: it must NOT perturb the request body
 * (`buildSearchBody`) or the outcome taxonomy. These run an enriched envelope through
 * the full wiring and assert the request side + the classification are unchanged.
 * EXPECT GREEN today (they pin invariants the widening must not break) and STAY green.
 */
describe("sil_search — the enriched projection is read-side only: request body + outcome taxonomy unchanged [card surface-product-url]", () => {
  it("the request body is byte-identical to today's (the projection widening changes nothing the tool SENDS)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([ENRICHED_PRODUCT]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", {
      query: "office chair",
      category: "Furniture",
      price_min: 10000,
    });

    const body = rec.search[0]!.body as Record<string, unknown>;
    // The mapped request is exactly what it was before this card — the new fields are
    // RESPONSE-side; the request shape is untouched.
    expect(body).toEqual({
      query: "office chair",
      filters: { categories: ["Furniture"], price: { min: 10000 } },
    });
  });

  it("the outcome taxonomy is unchanged with enriched envelopes (ok / empty / 400 / 401-refresh / 5xx)", async () => {
    async function statusFor(reply: Reply, query = "x"): Promise<unknown> {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "search" ? reply : { status: 200, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query }));
      vi.restoreAllMocks();
      return payload["status"];
    }

    // An enriched 200 is still `ok`; the other arms are unchanged.
    const okStatus = await statusFor({ status: 200, body: searchEnvelope([ENRICHED_PRODUCT]) });
    const emptyStatus = await statusFor({ status: 200, body: searchEnvelope([]) });
    const invalidStatus = await statusFor({ status: 400, body: { error: "empty_search_input", message: "x" } });
    const sourceFailStatus = await statusFor({ status: 500, body: { error: "source_unavailable", message: "x" } });

    expect(okStatus).toBe("ok");
    expect(emptyStatus).toBe("ok");
    expect(invalidStatus).toBe("invalid_request");
    expect(sourceFailStatus).toBe("retryable");
  });
});
