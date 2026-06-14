/**
 * INTEGRATION — sil_product_get lookup against sil-api (tier: integration).
 *
 * The real `sil_product_get` tool wired through the real sil-client (`lookupCatalog`
 * + `classifyLookupResponse` + the read-subset normalizer) and the real credentials
 * module. The ONLY thing mocked is `fetch` — the host/network boundary. There is no
 * live sil-api or Postgres in this repo; the true cross-service guarantee (a real
 * catalog over the wire from a live sil-api) is sil-stage's deferred e2e (goal SC9).
 * Here we prove the whole PLUGIN-SIDE contract — param→request mapping, the
 * unfound-ids-are-success behavior, the three-distinct-failure taxonomy, the rich
 * projection + `inputs` correlation, and token privacy — against a mocked boundary,
 * exactly as sil_search's integration suite proved its read flow.
 *
 * TWO ORIGINS: the lookup read targets the resolved **sil-api** origin
 * (`getApiUrl`), at the BARE path `/catalog/lookup` — NOT `/api/v1`. On a 401
 * the tool now refreshes transparently against the **sil-web** origin
 * (`getWebUrl`, via the real `refreshStoredTokens`) and retries the lookup ONCE —
 * the SAME refresh-and-retry-once choreography sil_whoami / sil_search perform
 * (this card makes 401 recovery uniform across every sil-api-calling tool;
 * FLAG-10). Both origins are pinned to distinct known hosts so the origin + path
 * assertions are exact, and a misfire is caught.
 *
 * Wire shapes pinned to the ALREADY-MERGED sil-api `/catalog/lookup` contract
 * (PR #18; sil-services `@sil/schemas` catalog.ts + envelope.ts) and the UCP
 * catalog-lookup spec:
 *   request body (CatalogLookupRequest): { ids: string[] }  (no envelope, no defaults)
 *   response (200): the FLAT UCP envelope sil-api emits (`withUcpMeta(body) →
 *     { ucp, ...body }`), carrying a CatalogLookupResult at the TOP LEVEL:
 *     { ucp, products: SilCatalogProduct[], messages? } — no `result` wrapper. Each
 *     product with a required `source`, each variant with a non-empty `checkout_url`,
 *     an `availability` object, and the REQUIRED lookup `inputs` correlation.
 *     `messages` carries one { type:"info", code:"not_found", content:<id> } per
 *     unresolved id, and is OMITTED entirely on full success.
 *   400 (schema reject)  → invalid_request envelope
 *   401                  → refresh-and-retry-once (see below)
 *   500 / network / timeout → retryable envelope
 *
 *   refresh (sil-web):  POST <sil-web>/api/v1/auth/refresh { refresh_token }
 *     200 { access_token, refresh_token }  → rotate tokens.json, retry lookup once
 *     401 { error: "invalid_grant" }       → terminal re-register, tokens cleared
 *     5xx / network                        → transient retryable, NO retry
 *
 * THE anti-false-green (complete-work-is-stub-free): the happy-path mock returns the
 * REAL `SilCatalogProduct` lookup envelope shape (each product with a required
 * `source`, each variant with a non-empty `checkout_url` and the `inputs`
 * correlation). The suite asserts the tool surfaces the normalized products + the
 * `not_found` list — so it is UNABLE to go green against the skeleton stub
 * `{ stub: true, tool, echo }`.
 *
 * Contract pinned for the implementation (expert-developer):
 *   - registerCatalogTools(api) registers `sil_product_get`; execute(callId,{ids})
 *     reads tokens.json, POSTs <sil-api>/catalog/lookup with body { ids } and
 *     Authorization: Bearer <at>, then maps the LookupOutcome to a jsonResult.
 *   - not-registered (no tokens.json) → terminal `not_registered`, ZERO network.
 *   - unfound ids → status ok + a not_found list, NEVER an error.
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
import { setWebUrl, setApiUrl, getWebUrl, getApiUrl } from "../lib/config.js";
import { getDataDir, getTokensPath, readTokens } from "../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

const TOOL = "sil_product_get";
const SIL_WEB = "https://sil-web.test.example.com"; // auth origin — must NOT be hit
const SIL_API = "https://sil-api.test.example.com"; // catalog-read origin

/** A real lookup `variant` resolved by a PRODUCT id (match "featured"): UCP variant
 * + sil-api's required non-empty `checkout_url` + the REQUIRED `inputs` correlation,
 * `availability` as the UCP object, `sku`/`options` for the purchase decision. */
const VARIANT_A1 = {
  id: "gid://variant/a1",
  title: "Aeron Chair — Graphite, Size B",
  description: { plain: "An ergonomic office chair." },
  sku: "AER-GR-B",
  options: [
    { name: "Color", label: "Graphite" },
    { name: "Size", label: "B" },
  ],
  price: { amount: 159900, currency: "USD" },
  availability: { available: true, status: "in_stock" },
  checkout_url: "https://buy.example.com/aeron-a1",
  inputs: [{ id: "gid://product/a", match: "featured" }],
};

/** A SECOND variant on the SAME product — the tool must surface the FIRST. */
const VARIANT_A2 = {
  id: "gid://variant/a2",
  title: "Aeron Chair — Carbon, Size C",
  description: { plain: "An ergonomic office chair." },
  sku: "AER-CB-C",
  price: { amount: 169900, currency: "USD" },
  availability: { available: false, status: "out_of_stock" },
  checkout_url: "https://buy.example.com/aeron-a2",
  inputs: [{ id: "gid://variant/a2", match: "exact" }],
};

const PRODUCT_A = {
  id: "gid://product/a",
  handle: "aeron-chair",
  title: "Aeron Chair",
  description: { plain: "An ergonomic office chair." },
  categories: [{ name: "Office Furniture" }],
  price_range: {
    min: { amount: 159900, currency: "USD" },
    max: { amount: 169900, currency: "USD" },
  },
  variants: [VARIANT_A1, VARIANT_A2],
  source: "herman-miller",
};

/** A second product whose featured variant was resolved by a VARIANT id
 * (match "exact"). */
const PRODUCT_B = {
  id: "gid://product/b",
  handle: "standing-desk",
  title: "Standing Desk",
  description: { plain: "A height-adjustable desk." },
  categories: [{ name: "Office Furniture" }],
  price_range: {
    min: { amount: 89900, currency: "USD" },
    max: { amount: 89900, currency: "USD" },
  },
  variants: [
    {
      id: "gid://variant/b1",
      title: "Standing Desk — Oak",
      description: { plain: "A height-adjustable desk." },
      sku: "DESK-OAK",
      options: [{ name: "Finish", label: "Oak" }],
      price: { amount: 89900, currency: "USD" },
      availability: { available: true, status: "in_stock" },
      checkout_url: "https://buy.example.com/desk-b1",
      inputs: [{ id: "gid://variant/b1", match: "exact" }],
    },
  ],
  source: "uplift",
};

/** The REAL sil-api lookup envelope — the FLAT shape sil-api actually emits
 * (`withUcpMeta(body) → { ucp, ...body }`: `products`/`messages` at the TOP LEVEL
 * beside `ucp`, NOT under a `result` wrapper). The presence of a required `source`
 * per product, a non-empty `checkout_url` + an `inputs` correlation per variant is
 * what makes the suite anti-false-green: a `{ stub: true }` echo carries none of
 * these, so the assertions below cannot pass against the skeleton stub. `messages`
 * is included only when there are misses. */
function lookupEnvelope(products: unknown[], messages?: unknown[]): unknown {
  const envelope: Record<string, unknown> = {
    ucp: { version: "0.1", status: "success" },
    products,
  };
  if (messages !== undefined) envelope["messages"] = messages;
  return envelope;
}

/** A single `not_found` info message, exactly as sil-api emits per unresolved id. */
function notFoundMsg(id: string): Record<string, unknown> {
  return { type: "info", code: "not_found", content: id };
}

let dataDir: string;
let priorSilDataDir: string | undefined;

/** One recorded outbound request. */
interface Recorded {
  url: string;
  method: string;
  bearer: string | null;
  body: unknown;
  hasBody: boolean;
}

type Reply = { status: number; body: unknown } | "network-error";

/**
 * A URL-routing fetch double cloned from catalog-search.integration.test.ts.
 * `reply(kind, nthOfKind, req)` decides each response given whether the request is a
 * `lookup` (sil-api /catalog/lookup), a `refresh` (sil-web /auth/refresh — the
 * transparent 401 recovery leg, reached via the real `refreshStoredTokens`), or
 * `other`. Records every request (url, method, bearer, body) so origin, path, the
 * Bearer header, the mapped body, and call COUNTS (including "exactly one refresh")
 * are all assertable. The `refresh` bucket is what makes the no-storm bound testable.
 */
function installRouter(
  reply: (
    kind: "lookup" | "refresh" | "other",
    nthOfKind: number,
    req: Recorded,
  ) => Reply,
): { all: Recorded[]; lookup: Recorded[]; refresh: Recorded[] } {
  const all: Recorded[] = [];
  const lookup: Recorded[] = [];
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

      // Check refresh first (sil-web /auth/refresh) so it is never misrouted to
      // the lookup bucket.
      let kind: "lookup" | "refresh" | "other";
      if (url.includes("/auth/refresh")) kind = "refresh";
      else if (url.includes("/catalog/lookup")) kind = "lookup";
      else kind = "other";

      let nthOfKind: number;
      if (kind === "lookup") {
        lookup.push(req);
        nthOfKind = lookup.length - 1;
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

  return { all, lookup, refresh };
}

/** Parse a ToolResult payload. */
function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("no tool payload");
  return JSON.parse(text) as Record<string, unknown>;
}

/** Seed a stored token pair so the lookup proceeds to the read. */
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
 * `sil_product_get_refreshed` operator marker fires exactly once on the
 * silent-recovery path and ZERO times on a first-try (no-refresh) success.
 */
function infoMarkerCount(api: MockPluginAPI, marker: string): number {
  return vi
    .mocked(api.logger.info)
    .mock.calls.filter((c) => c[0] === marker).length;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-lookup-int-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  // Pin BOTH origins to distinct known hosts so the origin/path assertions are exact
  // and a misfire onto sil-web is caught.
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

describe("sil_product_get — param → request mapping (bare path, sil-api origin, Bearer)", () => {
  it("POSTs the BARE /catalog/lookup path on the sil-api origin (NOT /api/v1, NOT sil-web)", async () => {
    seedTokens("the-access-token", "the-refresh-token");
    const rec = installRouter((kind) =>
      kind === "lookup"
        ? { status: 200, body: lookupEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] });

    expect(rec.lookup.length).toBe(1);
    const req = rec.lookup[0]!;
    // Bare path — no /api/v1 anywhere.
    const u = new URL(req.url);
    expect(u.pathname).toBe("/catalog/lookup");
    expect(req.url).not.toContain("/api/v1");
    // sil-api origin, NOT sil-web.
    expect(u.origin).toBe(new URL(getApiUrl()).origin);
    expect(u.origin).not.toBe(new URL(getWebUrl()).origin);
    // It is a POST carrying a body, with the stored Bearer token.
    expect(req.method).toBe("POST");
    expect(req.hasBody).toBe(true);
    expect(bearerToken(req)).toBe("the-access-token");
  });

  it("maps { ids } to the body EXACTLY (no envelope, no defaults, ids verbatim)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "lookup"
        ? { status: 200, body: lookupEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a", "gid://variant/b1"] });

    expect(rec.lookup.length).toBe(1);
    const body = rec.lookup[0]!.body as Record<string, unknown>;
    // Exact mapped body — the tool builds NO UCP envelope and fills NO defaults.
    expect(body).toEqual({ ids: ["gid://product/a", "gid://variant/b1"] });
    // Belt-and-braces: it did NOT smuggle a client-built envelope, context, or filters.
    expect(body["protocol"]).toBeUndefined();
    expect(body["domain"]).toBeUndefined();
    expect(body["context"]).toBeUndefined();
    expect(body["filters"]).toBeUndefined();
    expect(body["enrichment"]).toBeUndefined();
  });
});

describe("sil_product_get — happy path normalizes the REAL envelope (anti-false-green)", () => {
  it("returns status ok with the products, each carrying ONE rich projected variant + source + inputs", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 200, body: lookupEnvelope([PRODUCT_A, PRODUCT_B]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a", "gid://variant/b1"] }),
    );

    // The product promise — surfaced from the REAL envelope. A `{ stub: true }` echo
    // would carry NONE of these markers, so this can't go green on a stub.
    const blob = JSON.stringify(payload);
    expect(payload["status"]).toBe("ok");
    expect(blob).not.toContain('"stub"'); // never the skeleton stub shape
    const products = payload["products"] as Array<Record<string, unknown>>;
    expect(Array.isArray(products)).toBe(true);
    expect(products).toHaveLength(2);

    // Locate product A regardless of response order (lookup does not preserve order).
    const a = products.find((p) => p["id"] === "gid://product/a")!;
    expect(a).toBeDefined();
    // RICH product detail — beyond search's lean six.
    expect(a["description"]).toEqual({ plain: "An ergonomic office chair." });
    expect(a["source"]).toBe("herman-miller");
    expect(a["handle"]).toBe("aeron-chair");
    // First (featured) variant only, projected with its rich fields + inputs.
    const v = a["variant"] as Record<string, unknown>;
    expect(v["id"]).toBe("gid://variant/a1"); // a1, never a2
    expect(v["checkout_url"]).toBe("https://buy.example.com/aeron-a1");
    expect(v["price"]).toEqual({ amount: 159900, currency: "USD" });
    expect(v["sku"]).toBe("AER-GR-B");
    expect(v["options"]).toEqual([
      { name: "Color", label: "Graphite" },
      { name: "Size", label: "B" },
    ]);
    // availability passed through as the UCP object, not flattened to a boolean.
    const avail = v["availability"] as Record<string, unknown>;
    expect(typeof avail).toBe("object");
    expect(avail["available"]).toBe(true);
    expect(avail["status"]).toBe("in_stock");
    // The inputs correlation — lookup's defining feature — is surfaced.
    expect(v["inputs"]).toEqual([{ id: "gid://product/a", match: "featured" }]);

    // NEGATIVE half of the observability seam (review-round-1 fix): this is a
    // FIRST-TRY success (no 401, no refresh), so the `sil_product_get_refreshed`
    // marker must NOT fire. The marker means "this success was a silent recovery";
    // on a plain success it would be a false signal that the session is thrashing.
    // The marker keys off the helper's `refreshed:false` passthrough discriminant.
    expect(infoMarkerCount(api, "sil_product_get_refreshed")).toBe(0);
  });

  it("a known id returns its featured variant with a FRESH, non-empty checkout_url", async () => {
    // The acquisition target — re-fetched live, never a cached/empty value. This is
    // the entire point of the lookup tool (UCP: catalog responses are not
    // transactional commitments; re-fetch before buying).
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 200, body: lookupEnvelope([PRODUCT_A]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(payload["status"]).toBe("ok");
    const products = payload["products"] as Array<Record<string, unknown>>;
    const v = products[0]!["variant"] as Record<string, unknown>;
    const url = v["checkout_url"];
    expect(typeof url).toBe("string");
    expect((url as string).length).toBeGreaterThan(0);
    expect(url).toBe("https://buy.example.com/aeron-a1");
  });

  it("preserves the `match` distinction across products (featured vs exact)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 200, body: lookupEnvelope([PRODUCT_A, PRODUCT_B]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a", "gid://variant/b1"] }),
    );

    const products = payload["products"] as Array<Record<string, unknown>>;
    const matchById = new Map(
      products.map((p) => {
        const inputs = (p["variant"] as Record<string, unknown>)["inputs"] as Array<
          Record<string, unknown>
        >;
        return [p["id"], inputs[0]!["match"]];
      }),
    );
    expect(matchById.get("gid://product/a")).toBe("featured");
    expect(matchById.get("gid://product/b")).toBe("exact");
  });
});

describe("sil_product_get — unfound ids are a SUCCESS surfaced as a not_found list (never an error)", () => {
  it("a mix of known + unknown ids → status ok with the found products AND not_found:[the unfound ids]", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? {
            status: 200,
            body: lookupEnvelope([PRODUCT_A], [notFoundMsg("gid://product/gone")]),
          }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a", "gid://product/gone"] }),
    );

    // A partial hit is a SUCCESS — the found product PLUS a structured not_found list.
    expect(payload["status"]).toBe("ok");
    const products = payload["products"] as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    expect(products[0]!["id"]).toBe("gid://product/a");
    expect(payload["not_found"]).toEqual(["gid://product/gone"]);
    // NOT an error: no recovery hint, no re-register.
    expect(payload["recovery"]).toBeUndefined();
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });

  it("NONE of the ids resolve → status ok with products:[] and not_found:[all the ids] (all-missed IS success)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? {
            status: 200,
            body: lookupEnvelope([], [notFoundMsg("missing-1"), notFoundMsg("missing-2")]),
          }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["missing-1", "missing-2"] }),
    );

    // "None of these exist anymore" is a successful answer, distinct from a
    // not-registered/transport error and from a happy-path hit.
    expect(payload["status"]).toBe("ok");
    expect(payload["products"]).toEqual([]);
    expect(payload["not_found"]).toEqual(["missing-1", "missing-2"]);
    expect(payload["recovery"]).toBeUndefined();
  });

  it("every id resolves → status ok with NO not_found key (messages omitted on full success)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 200, body: lookupEnvelope([PRODUCT_A, PRODUCT_B]) } // no messages key
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a", "gid://variant/b1"] }),
    );

    expect(payload["status"]).toBe("ok");
    expect((payload["products"] as unknown[]).length).toBe(2);
    expect(payload["not_found"]).toBeUndefined();
  });

  it("the partial-hit success is DISTINCT from both the dead-401 (re-register) and the 500 (transient) envelopes", async () => {
    // The partial hit is `ok`; a 401 whose refresh is also dead terminates at
    // `must_reregister`; a first-call 500 is `retryable`. Three distinct statuses.
    // (The 401 case now drives the refresh leg via the `refresh` route — a dead
    // refresh keeps it terminal, so the three-way distinction is preserved under
    // the refresh-and-retry-once path this card introduces.)
    const partialHit = await (async () => {
      seedTokens("at", "rt");
      installRouter((kind) =>
        kind === "lookup"
          ? { status: 200, body: lookupEnvelope([PRODUCT_A], [notFoundMsg("gone")]) }
          : { status: 200, body: {} },
      );
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["x"] }));
      vi.restoreAllMocks();
      return p;
    })();

    const unauthorized = await (async () => {
      seedTokens("expired-at", "dead-rt");
      installRouter((kind) => {
        if (kind === "lookup") return { status: 401, body: { error: "unauthorized" } };
        if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
        return { status: 500, body: {} };
      });
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["x"] }));
      vi.restoreAllMocks();
      return p;
    })();

    const sourceFail = await (async () => {
      seedTokens("at", "rt");
      installRouter((kind) =>
        kind === "lookup" ? { status: 500, body: { error: "source_unavailable" } } : { status: 200, body: {} },
      );
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["x"] }));
      vi.restoreAllMocks();
      return p;
    })();

    // Three distinct agent-facing statuses — a partial hit is ok, the others are not.
    expect(new Set([partialHit["status"], unauthorized["status"], sourceFail["status"]]).size).toBe(3);
    expect(partialHit["status"]).toBe("ok");
    expect(unauthorized["status"]).toBe("must_reregister");
    expect(sourceFail["status"]).toBe("retryable");
  });
});

describe("sil_product_get — 401 → transparent refresh-and-retry-once (outcome 1: the agent never sees the 401)", () => {
  it("401 → refresh once via sil-web → rotate tokens.json → retry the lookup once with the NEW token → normal lookup result", async () => {
    // AC[integration]: outcome 1 — a registered agent whose access token is
    // expired gets the normal `{ status: ok, products, not_found? }`,
    // indistinguishable from a call that never 401'd. The card brings
    // sil_product_get onto sil_whoami's refresh-and-retry-once choreography.
    // EXPECT RED against current code (catalog.ts 401 is terminal mustReregister,
    // no refresh) and GREEN once it routes through the shared helper.
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind, nth) => {
      if (kind === "lookup") {
        // First lookup 401 (expired); second (after refresh) returns products.
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: lookupEnvelope([PRODUCT_A]) };
      }
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    // The agent sees a normal success — NOT a re-register, NOT a silent all-missed.
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
    expect(rec.lookup.length).toBe(2);
    expect(bearerToken(rec.lookup[1]!)).toBe("rotated-at");
    // The refresh used the STORED refresh token.
    expect(rec.refresh.length).toBe(1);
    expect((rec.refresh[0]!.body as { refresh_token?: string }).refresh_token).toBe("valid-rt");

    // OPERATOR-OBSERVABILITY SEAM (review-round-1 fix; card line 161): the silent
    // recovery is invisible in the PAYLOAD but MUST be observable in operator logs
    // — a session that refreshes on (nearly) every call is the degrading-session
    // signal on-call needs, and the card's own risk-mitigation names the
    // `sil_*_refreshed` marker by hand. Assert the `sil_product_get_refreshed` INFO
    // marker fired EXACTLY ONCE on this recovered-401 path. RED until the tool
    // emits it (logs-only — NOT a payload field) when the helper reports
    // `refreshed: true`.
    expect(infoMarkerCount(api, "sil_product_get_refreshed")).toBe(1);
    // The marker is logs-only — it does NOT add any field to the agent payload
    // (outcome 1's invisible-to-the-agent contract stays inviolate).
    expect(payload["sil_product_get_refreshed"]).toBeUndefined();
    // The marker carries NO token material (the privacy invariant holds on the
    // marker too — its meta must never carry a token value).
    const refreshedMarkerArgs = vi
      .mocked(api.logger.info)
      .mock.calls.filter((c) => c[0] === "sil_product_get_refreshed");
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
      if (kind === "lookup") {
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: lookupEnvelope([PRODUCT_A]) };
      }
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] });

    expect(rec.lookup.length).toBe(2); // failed read + exactly one retry
    expect(rec.refresh.length).toBe(1); // exactly one refresh, never more
    // The refresh hit sil-web; the lookups hit sil-api — origins asserted apart.
    const silApiOrigin = new URL(getApiUrl()).origin;
    const silWebOrigin = new URL(getWebUrl()).origin;
    for (const r of rec.lookup) expect(new URL(r.url).origin).toBe(silApiOrigin);
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
      if (kind === "lookup") {
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: lookupEnvelope([PRODUCT_A]) };
      }
      if (kind === "refresh") return { status: 200, body: { access_token: ROT_AT, refresh_token: ROT_RT } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    // tokens.json now holds the rotated pair (the refresh persisted).
    const tokens = readTokens();
    expect(tokens!.access_token).toBe(ROT_AT);
    expect(tokens!.refresh_token).toBe(ROT_RT);
    // The rotated token reached the retry's Authorization header, and ONLY there.
    expect(bearerToken(rec.lookup[1]!)).toBe(ROT_AT);
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
    for (const r of [...rec.lookup, ...rec.refresh]) {
      const b = JSON.stringify(r.body ?? {});
      expect(b).not.toContain(ROT_AT);
      expect(b).not.toContain("expired-at");
    }
  });
});

describe("sil_product_get — 401 → second 401 / dead refresh is terminal (outcome 2: re-register, refreshed at most once)", () => {
  it("refresh OK but the retried read is ALSO 401 → terminal re-register, exactly ONE refresh (a freshly-rotated-still-401 is structurally dead)", async () => {
    // AC[integration]: the no-storm bound. A retry that is still 401 must be
    // terminal, never a second refresh.
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind) => {
      // Lookup ALWAYS 401 (even after a good refresh — structurally dead).
      if (kind === "lookup") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    // Exactly: lookup(401) → refresh(200) → retry-lookup(401) → STOP.
    expect(rec.lookup.length).toBe(2); // initial + exactly one retry
    expect(rec.refresh.length).toBe(1); // exactly one refresh, NEVER a second
    expect(payload["status"]).toBe("must_reregister");
    expect(payload["products"]).toBeUndefined();
    expect(payload["recovery"]).toBe("sil_register");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/re-?register|sil_register|session.*expired/);
  });

  it("refresh returns invalid_grant (sil-web 401) → terminal re-register, tokens.json cleared, NO catalog retry", async () => {
    // AC[integration]: a dead refresh token. Terminal re-register, the dead pair
    // cleared, and NO retry of the lookup (there is no rotated token to retry).
    seedTokens("expired-at", "dead-rt");
    const rec = installRouter((kind) => {
      if (kind === "lookup") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    expect(payload["status"]).toBe("must_reregister");
    expect(payload["recovery"]).toBe("sil_register");
    // No retry after a failed refresh — exactly ONE lookup (the original 401) +
    // ONE refresh.
    expect(rec.lookup.length).toBe(1);
    expect(rec.refresh.length).toBe(1);
    // The confirmed-dead pair is cleared so sil_register does not short-circuit.
    expect(existsSync(getTokensPath())).toBe(false);
    expect(readTokens()).toBeNull();
  });

  it("the second-401 / dead-refresh terminal leaks NO token to any log line or the payload", async () => {
    // AC[integration]: privacy holds on the terminal path too.
    seedTokens("expired-at", "dead-rt");
    installRouter((kind) => {
      if (kind === "lookup") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    const resultBlob = JSON.stringify(payload);
    expect(resultBlob).not.toContain("expired-at");
    expect(resultBlob).not.toContain("dead-rt");
    const logs = logBlob(api);
    expect(logs).not.toContain("expired-at");
    expect(logs).not.toContain("dead-rt");
    expect(logs).not.toMatch(/Bearer/i);
  });
});

describe("sil_product_get — 401 → transient refresh failure is 'try again', NOT a re-register (outcome 3)", () => {
  it("the refresh leg returns 5xx → transient retryable, NO recovery:sil_register, NO catalog retry", async () => {
    // AC[integration]: a refresh-leg 5xx is a blip, not a dead session.
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind) => {
      if (kind === "lookup") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 503, body: { error: "unavailable" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).not.toMatch(/sil_register/);
    expect(blob).toMatch(/retry|try.again|temporar|unavailable|later/);
    // The refresh was attempted once; the lookup was NOT retried (no rotated token).
    expect(rec.refresh.length).toBe(1);
    expect(rec.lookup.length).toBe(1);
    // Tokens are NOT cleared on a transient (the pair may be fine).
    expect(readTokens()).not.toBeNull();
  });

  it("the refresh leg throws (network error) → transient retryable, NO re-register, NO catalog retry", async () => {
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind) => {
      if (kind === "lookup") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return "network-error";
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    expect(payload["status"]).toBe("retryable");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
    expect(rec.refresh.length).toBe(1);
    expect(rec.lookup.length).toBe(1);
    expect(readTokens()).not.toBeNull();
  });

  it("a first-call 5xx (before any 401) keeps its existing transient outcome and attempts NO refresh (the refresh path is reachable only via a 401)", async () => {
    // AC[integration]: this card does NOT alter the non-401 branches. A 5xx on the
    // ORIGINAL lookup must NOT trigger the refresh path.
    seedTokens("at", "rt");
    const rec = installRouter((kind) => {
      if (kind === "lookup") return { status: 500, body: { error: "source_unavailable" } };
      return { status: 200, body: { access_token: "x", refresh_token: "y" } };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    expect(payload["status"]).toBe("retryable");
    expect(rec.lookup.length).toBe(1); // single round-trip
    expect(rec.refresh.length).toBe(0); // NO refresh — a first-call 5xx is not a 401
  });
});

describe("sil_product_get — the failure outcomes surface as distinguishable error envelopes", () => {
  it("400 (schema reject) → invalid_request envelope, distinct from the all-missed success and the transient", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? {
            status: 400,
            body: { error: "request_too_large", message: "Too many identifiers in one request." },
          }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["a", "b"] }));

    expect(payload["status"]).toBe("invalid_request");
    expect(payload["status"]).not.toBe("ok");
    expect(payload["status"]).not.toBe("retryable");
    // Not framed as a transient retry, not a re-register — the request is the problem.
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("source failure: 500 → retryable envelope, NO recovery:sil_register, distinct from the 401 + invalid_request arms", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? {
            status: 500,
            body: { error: "source_unavailable", message: "The catalog source is temporarily unavailable." },
          }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(payload["status"]).toBe("retryable");
    // Transient — try again, NOT re-register (re-registering can't fix a 5xx).
    expect(payload["recovery"]).not.toBe("sil_register");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).not.toMatch(/sil_register/);
    expect(blob).toMatch(/retry|try.again|temporar|unavailable|later/);
  });

  it("network error / timeout (thrown fetch) → retryable, distinct from the all-missed success", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) => (kind === "lookup" ? "network-error" : { status: 200, body: {} }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(rec.lookup.length).toBe(1); // one round-trip attempted
    expect(payload["status"]).toBe("retryable");
    expect(payload["status"]).not.toBe("ok");
  });

  it("a 401 with a DEAD refresh (re-register) is DISTINCT from a first-call 500 (transient) — different recovery guidance", async () => {
    // AC[integration]: the recovery-hint discriminator. A 401 whose refresh token
    // is also dead (invalid_grant) terminates at re-register with the sil_register
    // hint; a first-call 5xx is transient with NO hint. The two must stay
    // distinguishable envelopes (one wrong hint = one misdirected user).
    const deadRefresh = await (async () => {
      seedTokens("expired-at", "dead-rt");
      installRouter((kind) => {
        if (kind === "lookup") return { status: 401, body: { error: "unauthorized" } };
        if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
        return { status: 500, body: {} };
      });
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["x"] }));
      vi.restoreAllMocks();
      return p;
    })();

    const transient = await (async () => {
      seedTokens("at", "rt");
      installRouter((kind) =>
        kind === "lookup" ? { status: 500, body: { error: "source_unavailable" } } : { status: 200, body: {} },
      );
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["x"] }));
      vi.restoreAllMocks();
      return p;
    })();

    expect(deadRefresh["status"]).not.toBe(transient["status"]);
    expect(JSON.stringify(deadRefresh).toLowerCase()).toMatch(/sil_register|re-?register/);
    expect(JSON.stringify(transient).toLowerCase()).not.toMatch(/sil_register/);
  });
});

/**
 * CARD `name-the-source-in-catalog-error-surfacing` (epic
 * `catalog-source-error-taxonomy-2026-06`) — the RED integration ceiling, SYMMETRIC
 * with the sil_search block in `catalog-search.integration.test.ts`. The two catalog
 * tools share ONE agent-facing error vocabulary, so outcomes a/b/c (and the 429
 * sub-case) MUST read identically through `sil_product_get` — or the agent learns
 * two error languages for the same failure (architect Risk "lookup vs search
 * divergence"). Same root cause: the source-failure body is discarded at
 * `classifyLookupResponse` (sil-client.ts:574) before `transient()` (catalog.ts:725)
 * runs. Same mock boundary (`installRouter` → `fetch`); nothing asserts a stub.
 *
 *   (a) sil/network down → retryable, GENERIC copy, NO source name, NO sil_register.
 *   (b) a named SOURCE down/rate-limited → retryable, NAMES the source, NEVER
 *       "sil is unavailable", NO sil_register.
 *   (c) upstream REJECTED → NON-retryable invalid_request carrying the real upstream
 *       cause, NO retry hint, NO sil_register.
 *
 * EXPECT RED today for outcome (b) (the source is discarded → generic copy); the (a)
 * assertions and regression guards already pass (they pin the invariants the rework
 * must not break).
 */
describe("sil_product_get — outcome a: sil/network down → GENERIC retryable, names NO source, no sil_register", () => {
  it("5xx with NO source on the body → generic 'sil is temporarily unavailable', NO source name, NO sil_register", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 500, body: { error: "internal_error", message: "Something went wrong inside sil." } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(payload["status"]).toBe("retryable");
    const message = String(payload["message"]);
    expect(message.toLowerCase()).toMatch(/sil is (temporarily )?unavailable|try .*again/);
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });

  it("network throw → generic retryable, NO source name, no sil_register, EXACTLY one round-trip (no retry storm)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) => (kind === "lookup" ? "network-error" : { status: 200, body: {} }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(rec.lookup.length).toBe(1);
    expect(rec.refresh.length).toBe(0);
    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
    const message = String(payload["message"]).toLowerCase();
    expect(message).toMatch(/sil is (temporarily )?unavailable|try .*again/);
    for (const src of ["shopify", "etsy", "global-catalog"]) {
      expect(message).not.toContain(src);
    }
  });
});

describe("sil_product_get — outcome b: a named source down/rate-limited → source-named retryable, NEVER 'sil is unavailable'", () => {
  it("5xx source_unavailable WITH a `source` → retryable whose message NAMES the source and NEVER says 'sil is unavailable'", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
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

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(payload["status"]).toBe("retryable");
    const message = String(payload["message"]);
    expect(message).toContain("shopify");
    expect(message.toLowerCase()).not.toMatch(/sil is (temporarily )?unavailable/);
    expect(message.toLowerCase()).not.toMatch(/sil is down/);
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });

  it("rate-limited source (upstream 429 → source_unavailable 5xx) WITH a `source` → outcome b: retryable, names the source, never 'sil is down', never non-retryable", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
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

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(payload["status"]).toBe("retryable");
    expect(payload["status"]).not.toBe("invalid_request");
    const message = String(payload["message"]);
    expect(message).toContain("global-catalog");
    expect(message.toLowerCase()).not.toMatch(/sil is (temporarily )?unavailable|sil is down/);
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("outcome b carries NO recovery:sil_register hint (a degraded source is not an auth problem)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? {
            status: 500,
            body: { error: "source_unavailable", message: "Source 'etsy' is unavailable.", source: "etsy" },
          }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });
});

describe("sil_product_get — outcome c: upstream rejected the request → NON-retryable invalid_request carrying the real cause", () => {
  it("4xx source_rejected → invalid_request carrying the upstream { error, message }, NO retry hint, NO sil_register", async () => {
    // Outcome c for lookup carries the upstream cause VERBATIM — and must NOT be
    // replaced by extractApiError's generic default (which, note, is the
    // search-specific "Provide a search query …" copy reused on the lookup 400-path;
    // see the architect's flagged-out-of-scope note). The contract: a deterministic
    // rejection is non-retryable and surfaces the real reason.
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? {
            status: 400,
            body: {
              error: "source_rejected",
              message: "Source 'shopify' rejected the request: identifier scheme not supported.",
            },
          }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(payload["status"]).toBe("invalid_request");
    expect(payload["status"]).not.toBe("retryable");
    expect(payload["error"]).toBe("source_rejected");
    const message = String(payload["message"]);
    expect(message).toContain("identifier scheme not supported");
    // NOT the search-specific generic default.
    expect(message).not.toMatch(/Provide a search query or at least one filter/i);
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });

  it("outcome c is NON-retryable AND carries no sil_register — distinct from both retryable arms (a/b)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 400, body: { error: "source_rejected", message: "Deterministic rejection from the source." } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(payload["status"]).toBe("invalid_request");
    expect(payload["status"]).not.toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
  });
});

describe("sil_product_get — DISTINGUISHABILITY: six failure/success cases are pairwise distinct agent envelopes (highest-value)", () => {
  it("{a-5xx, a-network, b-source, b-429, c-reject, all-missed-200} produce pairwise-distinguishable envelopes", async () => {
    // The per-tool half of the load-bearing distinguishability property. The lookup
    // SUCCESS analogue of search's empty match is the ALL-MISSED 200 (products [] +
    // not_found): a success the agent does not retry. No two of a/b/c/ok collapse.
    async function envelopeFor(reply: Reply): Promise<Record<string, unknown>> {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "lookup" ? reply : { status: 200, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["x"] }));
      vi.restoreAllMocks();
      return p;
    }

    const aGeneric = await envelopeFor({ status: 500, body: { error: "internal_error", message: "internal" } });
    const aNetwork = await (async () => {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "lookup" ? "network-error" : { status: 200, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["x"] }));
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
      body: { error: "source_rejected", message: "The request was rejected: identifier scheme not supported." },
    });
    const allMissed = await envelopeFor({
      status: 200,
      body: lookupEnvelope([], [notFoundMsg("x")]),
    });

    expect(cReject["status"]).toBe("invalid_request");
    expect(allMissed["status"]).toBe("ok");
    expect(allMissed["products"]).toEqual([]);
    expect(allMissed["not_found"]).toEqual(["x"]);

    expect(aGeneric["status"]).toBe("retryable");
    expect(aNetwork["status"]).toBe("retryable");
    expect(bSource["status"]).toBe("retryable");
    expect(b429["status"]).toBe("retryable");

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
    expect(
      new Set([
        fingerprint(aGeneric),
        fingerprint(bSource),
        fingerprint(cReject),
        fingerprint(allMissed),
      ]).size,
    ).toBe(4);
    expect(fingerprint(aGeneric)).toBe(fingerprint(aNetwork));
    expect(fingerprint(bSource)).toBe(fingerprint(b429));
  });
});

describe("sil_product_get — regression guards: the a/b/c rework must NOT move the all-missed or the recovered-401 path", () => {
  it("all-missed (200, products [] + not_found) stays status ok — never a/b/c", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 200, body: lookupEnvelope([], [notFoundMsg("gone-1"), notFoundMsg("gone-2")]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gone-1", "gone-2"] }));

    expect(payload["status"]).toBe("ok");
    expect(payload["products"]).toEqual([]);
    expect(payload["not_found"]).toEqual(["gone-1", "gone-2"]);
    for (const bad of ["retryable", "invalid_request", "must_reregister", "not_registered"]) {
      expect(payload["status"]).not.toBe(bad);
    }
    expect(payload["recovery"]).toBeUndefined();
  });

  it("recovered 401 (refresh-and-retry-once succeeds) stays invisible — normal ok, NO refreshed/recovery field, NO a/b/c", async () => {
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind, nth) => {
      if (kind === "lookup") {
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: lookupEnvelope([PRODUCT_A]) };
      }
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(payload["status"]).toBe("ok");
    expect((payload["products"] as unknown[]).length).toBe(1);
    expect(payload["refreshed"]).toBeUndefined();
    expect(payload["recovery"]).toBeUndefined();
    expect(payload["source"]).toBeUndefined();
    expect(payload["detail"]).toBeUndefined();
    expect(rec.lookup.length).toBe(2);
    expect(rec.refresh.length).toBe(1);
  });
});

describe("sil_product_get — not registered (no tokens.json) makes ZERO network calls", () => {
  it("returns a terminal not_registered hint (recovery sil_register) and never touches fetch", async () => {
    // No tokens seeded. A not-registered lookup has nothing to authenticate with, so
    // it must short-circuit BEFORE any network call (mirrors sil_search / sil_whoami).
    const rec = installRouter(() => ({ status: 200, body: lookupEnvelope([PRODUCT_A]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    expect(rec.all.length).toBe(0); // ZERO network — nothing to authenticate with
    expect(payload["status"]).not.toBe("ok");
    expect(payload["products"]).toBeUndefined();
    expect(JSON.stringify(payload)).toContain("sil_register");
  });
});

describe("sil_product_get — the access token is sent on the read but NEVER leaks", () => {
  it("the Bearer token reaches the request header but NOT the result and NOT any log line", async () => {
    const AT = "lookup-secret-access-token";
    const RT = "lookup-secret-refresh-token";
    seedTokens(AT, RT);
    const rec = installRouter((kind) =>
      kind === "lookup" ? { status: 200, body: lookupEnvelope([PRODUCT_A]) } : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    // The token DID reach the only legitimate place: the Authorization header.
    expect(rec.lookup.length).toBe(1);
    expect(bearerToken(rec.lookup[0]!)).toBe(AT);
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
    const bodyBlob = JSON.stringify(rec.lookup[0]!.body ?? {});
    expect(bodyBlob).not.toContain(AT);
    expect(bodyBlob).not.toContain(RT);
  });

  it("on a network error, the access token still never appears in any log line", async () => {
    const AT = "leak-canary-on-network-error";
    seedTokens(AT, "rt");
    installRouter((kind) => (kind === "lookup" ? "network-error" : { status: 200, body: {} }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] });

    const logs = logBlob(api);
    expect(logs).not.toContain(AT);
    expect(logs).not.toMatch(/Bearer/i);
  });
});

/**
 * CARD `surface-user-not-provisioned-and-fix-recovery` — the RED integration
 * ceiling for `sil_product_get`, SYMMETRIC with the sil_search block in
 * `catalog-search.integration.test.ts`. Catalog parity is the whole point: a fix
 * that lands only in `sil_search` leaves `sil_product_get` still false-transient
 * (AC2/AC7 catch exactly that). Same two bugs, same forbidden envelope, same
 * exact-equality token-clear gate; only the tool and request shape differ.
 *
 *   AC2  — 403 user_not_provisioned → forbidden (reason + recovery), NEVER retryable.
 *   AC7  — that same 403 CLEARS the dead token (recovery terminates regardless of
 *          which catalog tool revealed the state).
 *   AC10 — 403 principal_mismatch → forbidden but the token SURVIVES (the credential
 *          stays recoverable; the clear is scoped to user_not_provisioned ONLY).
 *
 * The only mock is `fetch` (installRouter). A 403 must NEVER enter the refresh
 * path (AC3 — it is `forbidden`, not `unauthorized`). EXPECT RED today (the
 * lookup classifier has no 403 arm, so a 403 reads as `retryable` and nothing
 * clears).
 */
describe("sil_product_get — a 403 user_not_provisioned surfaces FORBIDDEN and clears the dead token (AC2, AC7)", () => {
  it("403 user_not_provisioned → forbidden envelope (reason + recovery:sil_register), NEVER retryable (AC2)", async () => {
    // AC2: catalog parity — sil_product_get speaks the SAME forbidden vocabulary
    // as sil_search and sil_whoami, never the false-transient.
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: { access_token: "x", refresh_token: "y" } },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    expect(payload["status"]).toBe("forbidden");
    expect(payload["status"]).not.toBe("retryable");
    expect(payload["reason"]).toBe("user_not_provisioned");
    expect(payload["recovery"]).toBe("sil_register");
    expect(payload["products"]).toBeUndefined();
    const message = String(payload["message"]).toLowerCase();
    expect(message).toMatch(/provision|onboard|forbidden|not.*set.up/);
    expect(message).not.toMatch(/temporar|transient|unavailable|try.again.later/);
  });

  it("the 403 is FORBIDDEN, NOT unauthorized — NO /auth/refresh call, exactly one lookup (AC3)", async () => {
    // AC3: a 403 must not enter the refresh-and-retry-once path. The router 200s
    // any refresh, so rec.refresh.length === 0 proves no refresh was attempted.
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    const rec = installRouter((kind) =>
      kind === "lookup"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: { access_token: "rotated", refresh_token: "rotated-rt" } },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] });

    expect(rec.refresh.length).toBe(0);
    expect(rec.lookup.length).toBe(1);
  });

  it("the dead token is CLEARED on user_not_provisioned — tokens.json is gone (AC7)", async () => {
    // AC7: recovery terminates regardless of which catalog tool revealed the
    // state. Same clear as sil_search; asserted by file absence + null read.
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] });

    expect(existsSync(getTokensPath())).toBe(false);
    expect(readTokens()).toBeNull();
  });
});

describe("sil_product_get — a 403 principal_mismatch is forbidden but does NOT clear the token (AC10)", () => {
  it("403 principal_mismatch → forbidden envelope carrying that reason (NEVER retryable)", async () => {
    seedTokens("valid-at", "valid-rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 403, body: { error: "principal_mismatch" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    expect(payload["status"]).toBe("forbidden");
    expect(payload["status"]).not.toBe("retryable");
    expect(payload["reason"]).toBe("principal_mismatch");
    expect(payload["recovery"]).toBe("sil_register");
  });

  it("the token SURVIVES on principal_mismatch — tokens.json is NOT cleared (AC10, the correctness boundary)", async () => {
    // AC10: the same exact-equality gate as sil_search. principal_mismatch is
    // recoverable; clearing it would force a destructive re-onboard on a good
    // credential. Only reason === "user_not_provisioned" clears.
    seedTokens("valid-at", "valid-rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 403, body: { error: "principal_mismatch" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] });

    expect(existsSync(getTokensPath())).toBe(true);
    expect(readTokens()).not.toBeNull();
    expect(readTokens()!.access_token).toBe("valid-at");
  });
});

/**
 * CARD `surface-product-url-and-specs-in-catalog-tools` (epic
 * `catalog-product-contract-2026-06`) — the RED integration ceiling for the WIDENED
 * `sil_product_get` projection AND the ONE-VOCABULARY property (AC8 + AC9). Lookup
 * must surface the SAME enriched shape `sil_search` does — product
 * `url`/`description.plain`/`media`/`options` and per-variant
 * `url`/`seller`/`media`/`metadata` — with the SAME omit-when-absent rule, AND
 * WITHOUT regressing the fields lookup already surfaces (`sku`, variant `options`
 * selections, `categories`, `handle`, the `inputs` correlation, `not_found`).
 *
 * THE reconciliation the implementer MUST make (card handoff): lookup TODAY passes
 * the WHOLE `description` object through opaque (`LookupProduct.description:
 * Record<string,unknown>`), while this card surfaces `description.plain` on search.
 * For one vocabulary the same product must yield the SAME `description` shape across
 * both tools. The architect's recommended choice — lift `.plain` on BOTH (the cleaner
 * agent key, matching the founder wording). The `description.plain` test below uses a
 * description carrying html/markdown so the two shapes DIVERGE unless reconciled: a
 * whole-object pass-through would keep html/markdown, a `.plain` lift would not — they
 * cannot both be right, so the implementer must pick one for both tools.
 *
 * Same opaque-pass-through + omit-when-absent properties as the search block; same
 * extension-key trap (seller.url/.domain, arbitrary metadata keys). The ONLY mock is
 * `fetch` (installRouter). EXPECT RED today: the lean lookup projection surfaces none
 * of url/media/seller/product-options/metadata, and surfaces the WHOLE `description`
 * object (not `.plain`).
 */

/** A media item in the REAL UCP `Media` shape — surfaced OPAQUE, forwarded verbatim. */
const MEDIA_IMAGE = {
  type: "image",
  url: "https://img.example.com/aeron-front.jpg",
  alt_text: "Aeron chair, front view",
  width: 1200,
  height: 900,
};

/** A product-level OPTION DEFINITION (`ProductOption`: `{ name, values: OptionValue[] }`)
 * — the MENU of choices, distinct from a variant's SelectedOption picks. */
const PRODUCT_OPTION_SIZE = {
  name: "Size",
  values: [
    { id: "opt-b", label: "Size B" },
    { id: "opt-c", label: "Size C" },
  ],
};

/** A `seller` with the base `{ name, links }` AND Shopify EXTENSION keys
 * (`url`/`domain`) NOT in the base schema — the opaque-pass-through proof. */
const SELLER_WITH_EXTENSION_KEYS = {
  name: "Herman Miller",
  links: [
    { type: "refund_policy", url: "https://hermanmiller.example.com/returns", title: "Returns" },
    { type: "shipping_policy", url: "https://hermanmiller.example.com/shipping" },
  ],
  url: "https://hermanmiller.example.com",
  domain: "hermanmiller.example.com",
};

/** A `metadata` object with arbitrary source keys beyond any known set. */
const METADATA_WITH_SOURCE_KEYS = {
  top_features: ["8Z Pellicle suspension", "PostureFit SL"],
  tech_specs: { weight_capacity_kg: 159, warranty_years: 12 },
  unique_selling_points: "Ships assembled.",
};

/** A FULLY enriched LOOKUP variant — the rich lookup shape (sku/options/inputs) PLUS
 * the enriched url/seller/media/metadata. Carries the lean+rich fields the projection
 * already surfaces, so the new fields are proven ADDITIVE. */
const ENRICHED_LOOKUP_VARIANT = {
  id: "gid://variant/enriched-1",
  title: "Aeron Chair — Graphite, Size B",
  description: { plain: "An ergonomic office chair." },
  sku: "AER-GR-B",
  options: [
    { name: "Color", label: "Graphite" },
    { name: "Size", label: "B" },
  ],
  price: { amount: 159900, currency: "USD" },
  availability: { available: true, status: "in_stock" },
  checkout_url: "https://buy.example.com/aeron-enriched-1",
  inputs: [{ id: "gid://product/enriched", match: "featured" }],
  // The enriched per-variant surface:
  url: "https://store.example.com/products/aeron/variants/enriched-1",
  seller: SELLER_WITH_EXTENSION_KEYS,
  media: [MEDIA_IMAGE],
  metadata: METADATA_WITH_SOURCE_KEYS,
};

/** A FULLY enriched LOOKUP product — rich lookup detail (description/categories/handle)
 * PLUS the enriched url/media/options/metadata. The `description` carries html AND
 * markdown beyond `plain` — the one-vocabulary divergence anchor. */
const ENRICHED_LOOKUP_PRODUCT = {
  id: "gid://product/enriched",
  handle: "aeron-chair",
  title: "Aeron Chair",
  description: {
    plain: "The classic ergonomic office chair.",
    html: "<p>The classic ergonomic office chair.</p>",
    markdown: "The classic ergonomic office chair.",
  },
  categories: [{ value: "Office Furniture", taxonomy: "google" }],
  price_range: {
    min: { amount: 159900, currency: "USD" },
    max: { amount: 169900, currency: "USD" },
  },
  variants: [ENRICHED_LOOKUP_VARIANT],
  source: "herman-miller",
  // The enriched product surface:
  url: "https://store.example.com/products/aeron",
  media: [MEDIA_IMAGE],
  options: [PRODUCT_OPTION_SIZE],
  metadata: METADATA_WITH_SOURCE_KEYS,
};

describe("sil_product_get — WIDENED projection surfaces the same enriched contract as search, without regressing rich fields [card surface-product-url]", () => {
  /** Resolve a single enriched lookup product and return its shaped result. */
  async function lookupOne(product: unknown): Promise<Record<string, unknown>> {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 200, body: lookupEnvelope([product]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/enriched"] }));
    expect(payload["status"]).toBe("ok");
    const products = payload["products"] as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    return products[0]!;
  }

  it("surfaces product url/media/options + per-variant url/seller/media — alongside the rich fields lookup already carries (sku/options/categories/handle/inputs)", async () => {
    // AC8: the enriched surface lands on lookup too, and the EXISTING rich fields are
    // NOT regressed.
    const product = await lookupOne(ENRICHED_LOOKUP_PRODUCT);

    // Existing rich fields — NOT regressed.
    expect(product["handle"]).toBe("aeron-chair");
    expect(product["categories"]).toEqual([{ value: "Office Furniture", taxonomy: "google" }]);
    const variant = product["variant"] as Record<string, unknown>;
    expect(variant["sku"]).toBe("AER-GR-B");
    expect(variant["options"]).toEqual([
      { name: "Color", label: "Graphite" },
      { name: "Size", label: "B" },
    ]);
    expect(variant["inputs"]).toEqual([{ id: "gid://product/enriched", match: "featured" }]);
    expect(variant["checkout_url"]).toBe("https://buy.example.com/aeron-enriched-1");

    // NEW product-level enriched surface.
    expect(product["url"]).toBe("https://store.example.com/products/aeron");
    expect(product["media"]).toEqual([MEDIA_IMAGE]);
    expect(product["options"]).toEqual([PRODUCT_OPTION_SIZE]);

    // NEW per-variant enriched surface.
    expect(variant["url"]).toBe("https://store.example.com/products/aeron/variants/enriched-1");
    expect(variant["media"]).toEqual([MEDIA_IMAGE]);
    expect(variant["metadata"]).toEqual(METADATA_WITH_SOURCE_KEYS);
  });

  it("the product-level `options` (DEFINITIONS) and the variant `options` (SELECTIONS) coexist — they are DIFFERENT fields, not conflated", async () => {
    // The two `options` must not be conflated: product-level ProductOption[] (the menu)
    // and the variant SelectedOption[] (the picks) both surface, distinctly.
    const product = await lookupOne(ENRICHED_LOOKUP_PRODUCT);
    // Product-level = the DEFINITIONS (Size → [B, C]).
    expect(product["options"]).toEqual([PRODUCT_OPTION_SIZE]);
    // Variant-level = the SELECTIONS (Color: Graphite, Size: B) — unchanged.
    expect((product["variant"] as Record<string, unknown>)["options"]).toEqual([
      { name: "Color", label: "Graphite" },
      { name: "Size", label: "B" },
    ]);
    // They are NOT the same value.
    expect(product["options"]).not.toEqual((product["variant"] as Record<string, unknown>)["options"]);
  });

  it("OPAQUE PASS-THROUGH: a `seller` with Shopify extension keys (url/domain) survives WHOLE on lookup too — never narrowed to {name,links}", async () => {
    // AC8 + the BIGGEST RISK, lookup side. Same opaque-pass-through proof as search.
    const product = await lookupOne(ENRICHED_LOOKUP_PRODUCT);
    const seller = (product["variant"] as Record<string, unknown>)["seller"] as Record<string, unknown>;
    expect(seller).toEqual(SELLER_WITH_EXTENSION_KEYS);
    expect(seller["url"]).toBe("https://hermanmiller.example.com");
    expect(seller["domain"]).toBe("hermanmiller.example.com");
  });

  it("ONE VOCABULARY — `description.plain`: lookup surfaces description as `{ plain }`, the SAME shape as search (NOT the whole html/markdown object)", async () => {
    // AC8/AC9 reconciliation. Lookup TODAY passes the WHOLE `description` object opaque,
    // so a description carrying html+markdown would surface them too — DIVERGING from
    // search's `description.plain`. For one vocabulary the implementer must lift `.plain`
    // on BOTH tools. This product's description carries html AND markdown beyond plain;
    // the surfaced shape must be `{ plain }` only — proving the reconciliation happened.
    const product = await lookupOne(ENRICHED_LOOKUP_PRODUCT);
    const description = product["description"] as Record<string, unknown>;
    expect(description).toBeDefined();
    expect(description["plain"]).toBe("The classic ergonomic office chair.");
    // The reconciled shape surfaces ONLY plain — html/markdown are NOT surfaced (else
    // the same product yields a different description shape on lookup than on search).
    expect(description).not.toHaveProperty("html");
    expect(description).not.toHaveProperty("markdown");
    expect(Object.keys(description)).toEqual(["plain"]);
  });

  it("omit-when-absent on lookup: a product with NONE of the new enriched fields surfaces the rich-but-unenriched shape and NO new key (null/''/[])", async () => {
    // AC8 omit-when-absent. The new fields are absent → omitted, while the existing
    // rich fields (description.plain/categories/handle/sku/options/inputs) still surface.
    const leanRich = {
      id: "gid://product/leanrich",
      handle: "lean-rich",
      title: "Lean-Rich Product",
      description: { plain: "Rich detail, no enrichment." },
      categories: [{ value: "Furniture" }],
      price_range: { min: { amount: 5000, currency: "USD" }, max: { amount: 5000, currency: "USD" } },
      variants: [
        {
          id: "gid://variant/leanrich-1",
          title: "Lean-Rich — Black",
          sku: "LR-BLK",
          options: [{ name: "Color", label: "Black" }],
          price: { amount: 5000, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: "https://buy.example.com/leanrich-1",
          inputs: [{ id: "gid://product/leanrich", match: "featured" }],
        },
      ],
      source: "ikea",
    };
    const product = await lookupOne(leanRich);

    // Existing rich fields still surface.
    expect(product["handle"]).toBe("lean-rich");
    expect((product["description"] as Record<string, unknown>)["plain"]).toBe("Rich detail, no enrichment.");
    const variant = product["variant"] as Record<string, unknown>;
    expect(variant["sku"]).toBe("LR-BLK");

    // NONE of the NEW enriched keys appear.
    for (const key of ["url", "media", "options", "metadata"]) {
      expect(product).not.toHaveProperty(key);
    }
    for (const key of ["url", "seller", "media", "metadata"]) {
      expect(variant).not.toHaveProperty(key);
    }
  });

  it("a `media` array with a garbage entry drops it; an all-garbage array OMITS the key (never [])", async () => {
    // AC[integration] #7, lookup side.
    const withGarbage = {
      id: "gid://product/lkgarbage",
      title: "Lookup Garbage Media",
      description: { plain: "Bad media entry." },
      price_range: { min: { amount: 4000, currency: "USD" }, max: { amount: 4000, currency: "USD" } },
      media: [MEDIA_IMAGE, "garbage", 9],
      variants: [
        {
          id: "gid://variant/lkgarbage-1",
          title: "Lookup Garbage — Default",
          price: { amount: 4000, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: "https://buy.example.com/lkgarbage-1",
          inputs: [{ id: "gid://product/lkgarbage", match: "featured" }],
        },
      ],
      source: "shop",
    };
    const product = await lookupOne(withGarbage);
    expect(product["media"]).toEqual([MEDIA_IMAGE]); // garbage dropped, usable kept

    const allGarbage = { ...withGarbage, id: "gid://product/lkallgarbage", media: [null, "x", 1] };
    const product2 = await lookupOne(allGarbage);
    expect(product2).not.toHaveProperty("media"); // omitted, NOT []
  });

  it("PURCHASABILITY GATE UNCHANGED: a featured variant lacking a non-empty checkout_url is STILL dropped, even with url/media/seller present", async () => {
    // AC[integration] cross-cutting, lookup side. The enriched fields do not change the
    // gate — a non-buyable product (no checkout_url) is still dropped to `not_found`-less
    // absence from the products list.
    seedTokens("at", "rt");
    const enrichedButUnbuyable = {
      id: "gid://product/lkunbuyable",
      title: "Lookup Enriched Unbuyable",
      description: { plain: "Cannot be bought." },
      price_range: { min: { amount: 9900, currency: "USD" }, max: { amount: 9900, currency: "USD" } },
      url: "https://store.example.com/products/lkunbuyable",
      media: [MEDIA_IMAGE],
      options: [PRODUCT_OPTION_SIZE],
      variants: [
        {
          id: "gid://variant/lkunbuyable-1",
          title: "Lookup Unbuyable — Default",
          price: { amount: 9900, currency: "USD" },
          availability: { available: false, status: "out_of_stock" },
          // checkout_url MISSING.
          url: "https://store.example.com/products/lkunbuyable/variants/1",
          seller: SELLER_WITH_EXTENSION_KEYS,
          media: [MEDIA_IMAGE],
          inputs: [{ id: "gid://product/lkunbuyable", match: "featured" }],
        },
      ],
      source: "shop",
    };
    installRouter((kind) =>
      kind === "lookup"
        ? { status: 200, body: lookupEnvelope([enrichedButUnbuyable, ENRICHED_LOOKUP_PRODUCT]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/lkunbuyable", "gid://product/enriched"] }),
    );

    expect(payload["status"]).toBe("ok");
    const products = payload["products"] as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    expect(products[0]!["id"]).toBe("gid://product/enriched");
    expect(products.some((p) => p["id"] === "gid://product/lkunbuyable")).toBe(false);
  });
});

/**
 * CARD `surface-product-url-and-specs-in-catalog-tools` — the ONE-VOCABULARY
 * cross-tool equality (AC9). The SAME wire product, resolved through BOTH tools, must
 * surface the SAME enriched fields. A field present on one tool's result but dropped
 * by the other for the same wire object is a defect. This drives both `sil_search` AND
 * `sil_product_get` over an IDENTICAL enriched product (search uses a product with the
 * lookup-only fields stripped — `inputs`/`sku` are lookup-only by design — but the
 * SHARED enriched fields, url/description.plain/media/product-options/seller/metadata,
 * must match byte-for-byte). EXPECT RED today (search surfaces none; lookup surfaces
 * the whole description, not `.plain`).
 */
describe("sil_product_get vs sil_search — the SAME wire product surfaces the SAME enriched fields on both tools (one vocabulary, AC9)", () => {
  it("product url/description.plain/media/options and variant url/seller/media match across the two tools for the same wire object", async () => {
    // The shared enriched surface — what BOTH tools must agree on for the same product.
    const sharedProductWire = {
      id: "gid://product/shared",
      title: "Shared Chair",
      description: { plain: "A shared chair.", html: "<p>A shared chair.</p>" },
      price_range: { min: { amount: 12000, currency: "USD" }, max: { amount: 12000, currency: "USD" } },
      url: "https://store.example.com/products/shared",
      media: [MEDIA_IMAGE],
      options: [PRODUCT_OPTION_SIZE],
      metadata: METADATA_WITH_SOURCE_KEYS,
      source: "shop",
    };
    const sharedVariantWire = {
      id: "gid://variant/shared-1",
      title: "Shared Chair — Default",
      price: { amount: 12000, currency: "USD" },
      availability: { available: true, status: "in_stock" },
      checkout_url: "https://buy.example.com/shared-1",
      url: "https://store.example.com/products/shared/variants/1",
      seller: SELLER_WITH_EXTENSION_KEYS,
      media: [MEDIA_IMAGE],
      metadata: METADATA_WITH_SOURCE_KEYS,
    };

    // Run it through sil_search (a plain fetch spy returning the FLAT search envelope —
    // the same `okEnvelopeFetch` pattern the search unit suite uses; the only mock is fetch).
    const searchShaped = await (async () => {
      seedTokens("at", "rt");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            ucp: { version: "0.1", status: "success" },
            products: [{ ...sharedProductWire, variants: [sharedVariantWire] }],
            pagination: { has_next_page: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, "sil_search").execute("c1", { query: "shared chair" }));
      vi.restoreAllMocks();
      return (p["products"] as Array<Record<string, unknown>>)[0]!;
    })();

    // Run the SAME wire object through sil_product_get.
    const lookupShaped = await (async () => {
      seedTokens("at", "rt");
      installRouter((kind) =>
        kind === "lookup"
          ? {
              status: 200,
              body: lookupEnvelope([
                {
                  ...sharedProductWire,
                  variants: [{ ...sharedVariantWire, inputs: [{ id: "gid://product/shared", match: "featured" }] }],
                },
              ]),
            }
          : { status: 500, body: {} },
      );
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/shared"] }));
      vi.restoreAllMocks();
      return (p["products"] as Array<Record<string, unknown>>)[0]!;
    })();

    const searchVariant = searchShaped["variant"] as Record<string, unknown>;
    const lookupVariant = lookupShaped["variant"] as Record<string, unknown>;

    // The SHARED enriched product fields are identical across the two tools.
    expect(searchShaped["url"]).toEqual(lookupShaped["url"]);
    expect(searchShaped["media"]).toEqual(lookupShaped["media"]);
    expect(searchShaped["options"]).toEqual(lookupShaped["options"]);
    expect(searchShaped["metadata"]).toEqual(lookupShaped["metadata"]);
    expect(searchShaped["description"]).toEqual(lookupShaped["description"]); // both `{ plain }`

    // The SHARED enriched variant fields are identical across the two tools.
    expect(searchVariant["url"]).toEqual(lookupVariant["url"]);
    expect(searchVariant["seller"]).toEqual(lookupVariant["seller"]);
    expect(searchVariant["media"]).toEqual(lookupVariant["media"]);
    expect(searchVariant["metadata"]).toEqual(lookupVariant["metadata"]);

    // Neither tool dropped a field the other kept — for each shared key, presence matches.
    for (const key of ["url", "media", "options", "metadata", "description"]) {
      expect(
        Object.prototype.hasOwnProperty.call(searchShaped, key),
        `product.${key} presence must match across tools`,
      ).toBe(Object.prototype.hasOwnProperty.call(lookupShaped, key));
    }
    for (const key of ["url", "seller", "media", "metadata"]) {
      expect(
        Object.prototype.hasOwnProperty.call(searchVariant, key),
        `variant.${key} presence must match across tools`,
      ).toBe(Object.prototype.hasOwnProperty.call(lookupVariant, key));
    }
  });
});
