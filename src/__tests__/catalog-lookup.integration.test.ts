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
 * ONE ORIGIN: the lookup read targets the resolved **sil-api** origin
 * (`getSilApiUrl`), at the BARE path `/catalog/lookup` — NOT `/api/v1`, NOT the
 * sil-web origin (`getApiUrl`). Both origins are pinned to distinct known hosts so
 * the origin + path assertions are exact, and a misfire onto sil-web is caught.
 * (Lookup does no refresh choreography in SC2 — a single round-trip; the 401 path is
 * a terminal re-register hint, parity with sil_search.)
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
 *   401                  → terminal re-register envelope
 *   500 / network / timeout → retryable envelope
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
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../tools/catalog.js";
import { setApiUrl, setSilApiUrl, getApiUrl, getSilApiUrl } from "../lib/config.js";
import { getDataDir, getTokensPath } from "../lib/credentials.js";
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
 * `lookup` (sil-api /catalog/lookup) or `other`. Records every request (url, method,
 * bearer, body) so origin, path, the Bearer header, the mapped body, and call COUNTS
 * are all assertable.
 */
function installRouter(
  reply: (kind: "lookup" | "other", nthOfKind: number, req: Recorded) => Reply,
): { all: Recorded[]; lookup: Recorded[] } {
  const all: Recorded[] = [];
  const lookup: Recorded[] = [];

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

      const kind: "lookup" | "other" = url.includes("/catalog/lookup") ? "lookup" : "other";
      let nthOfKind: number;
      if (kind === "lookup") {
        lookup.push(req);
        nthOfKind = lookup.length - 1;
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

  return { all, lookup };
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

  it("the partial-hit success is DISTINCT from both the 401 and the 500 error envelopes", async () => {
    async function payloadFor(reply: Reply): Promise<Record<string, unknown>> {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "lookup" ? reply : { status: 200, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["x"] }));
      vi.restoreAllMocks();
      return p;
    }

    const partialHit = await payloadFor({
      status: 200,
      body: lookupEnvelope([PRODUCT_A], [notFoundMsg("gone")]),
    });
    const unauthorized = await payloadFor({ status: 401, body: { error: "unauthorized" } });
    const sourceFail = await payloadFor({ status: 500, body: { error: "source_unavailable" } });

    // Three distinct agent-facing statuses — a partial hit is ok, the others are not.
    expect(new Set([partialHit["status"], unauthorized["status"], sourceFail["status"]]).size).toBe(3);
    expect(partialHit["status"]).toBe("ok");
  });
});

describe("sil_product_get — the failure outcomes surface as distinguishable error envelopes", () => {
  it("401 → terminal re-register envelope (recovery sil_register), single round-trip, NOT a false-green", async () => {
    seedTokens("dead-at", "dead-rt");
    const rec = installRouter((kind) =>
      kind === "lookup" ? { status: 401, body: { error: "unauthorized" } } : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }));

    // A SINGLE round-trip — lookup does NOT do the transparent refresh-and-retry
    // choreography whoami performs (parity with sil_search: SC2 is single round-trip).
    expect(rec.lookup.length).toBe(1);
    // No refresh call leaked onto sil-web.
    for (const r of rec.all) {
      expect(r.url).not.toContain("/auth/refresh");
    }
    // Terminal, actionable re-register — not a success, not a silent all-missed.
    expect(payload["status"]).not.toBe("ok");
    expect(payload["products"]).toBeUndefined();
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/re-?register|sil_register|session.*expired/);
  });

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

  it("401 is DISTINCT from the 500 transient outcome (different recovery guidance)", async () => {
    async function payloadFor(reply: Reply): Promise<Record<string, unknown>> {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "lookup" ? reply : { status: 200, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const p = payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["x"] }));
      vi.restoreAllMocks();
      return p;
    }

    const unauthorized = await payloadFor({ status: 401, body: { error: "unauthorized" } });
    const transient = await payloadFor({ status: 500, body: { error: "source_unavailable" } });

    // The 401 carries a re-register hint; the 5xx does NOT (re-registering can't fix
    // a server fault). The two must be distinguishable envelopes.
    expect(unauthorized["status"]).not.toBe(transient["status"]);
    expect(JSON.stringify(unauthorized).toLowerCase()).toMatch(/sil_register|re-?register/);
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
