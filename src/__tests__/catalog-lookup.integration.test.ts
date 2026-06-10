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
 * (`getSilApiUrl`), at the BARE path `/catalog/lookup` — NOT `/api/v1`. On a 401
 * the tool now refreshes transparently against the **sil-web** origin
 * (`getApiUrl`, via the real `refreshStoredTokens`) and retries the lookup ONCE —
 * the SAME refresh-and-retry-once choreography sil_whoami / sil_search perform
 * (this card makes 401 recovery uniform across every sil-api-calling tool;
 * FLAG-10). Both origins are pinned to distinct known hosts so the origin + path
 * assertions are exact, and a misfire is caught.
 *
 * Wire shapes pinned to the ALREADY-MERGED sil-api `/catalog/lookup` contract
 * (PR #18; sil-services `@sil/schemas` catalog.ts + envelope.ts) and the UCP
 * catalog-lookup spec:
 *   request body (CatalogLookupRequest): { ids: string[] }  (no envelope, no defaults)
 *   response (200): the UCP envelope buildEnvelope emits, whose `result` is a
 *     CatalogLookupResult { products: SilCatalogProduct[], messages? } — each
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
import { setApiUrl, setSilApiUrl, getApiUrl, getSilApiUrl } from "../lib/config.js";
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

/** The REAL sil-api lookup envelope (buildEnvelope output). The presence of a
 * required `source` per product, a non-empty `checkout_url` + an `inputs`
 * correlation per variant is what makes the suite anti-false-green: a
 * `{ stub: true }` echo carries none of these, so the assertions below cannot pass
 * against the skeleton stub. `messages` is included only when there are misses. */
function lookupEnvelope(products: unknown[], messages?: unknown[]): unknown {
  const result: Record<string, unknown> = { products };
  if (messages !== undefined) result["messages"] = messages;
  return {
    protocol: "ucp",
    version: "0.1",
    domain: "catalog",
    request_id: "req-int-1",
    issued_at: "2026-06-09T00:00:00.000Z",
    enrichment: { agent_id: "auth0|abc", on_behalf_of: "auth0|abc", enriched: true, source: "sil-api" },
    result,
  };
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
    expect(u.origin).toBe(new URL(getSilApiUrl()).origin);
    expect(u.origin).not.toBe(new URL(getApiUrl()).origin);
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
    const silApiOrigin = new URL(getSilApiUrl()).origin;
    const silWebOrigin = new URL(getApiUrl()).origin;
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
