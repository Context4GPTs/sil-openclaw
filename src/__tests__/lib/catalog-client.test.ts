/**
 * UNIT — the five v0 call functions (tier: unit — `fetch` doubled, no host, no
 * filesystem, no credentials module).
 *
 * One route each, one request each, at the BARE path on the sil-api origin. This
 * is A8's client half: the tool half (that no tool's parameters can select
 * another's route) lives in `catalog-*.integration.test.ts`.
 *
 * FOUR POST A BODY; `findDomains` GETs a querystring — and it shares
 * `/catalog/domains` with `mintDomain`, so at this layer the VERB is the only
 * thing separating a read from the one write the product cannot undo. It
 * therefore gets its own cases rather than a row in the POST table.
 *
 * The three things pinned here that nothing else can see:
 *   - the request BODY is what the agent asked for, with no plugin-invented
 *     default and no key the route's `additionalProperties: false` would 400 on;
 *   - the Bearer travels ONLY in the header and never into the returned union;
 *   - a network error / timeout is `retryable`, never a fabricated `ok`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchCatalog,
  lookupCatalog,
  readStores,
  mintDomain,
  findDomains,
} from "../../lib/sil-client.js";
import {
  MINT_409,
  STORES_404,
  domainFindGolden,
  mintGolden,
  resultGolden,
  storesGolden,
} from "../helpers/v0-wire.js";

const API = "https://sil-api.test.example.com";
const TOKEN = "at-secret-do-not-leak";

interface Sent {
  url: string;
  method: string;
  bearer: string | null;
  body: unknown;
}

let sent: Sent[];

function respond(status: number, body: unknown): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({
      url: typeof input === "string" ? input : String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      bearer: headers["Authorization"] ?? headers["authorization"] ?? null,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

function failNetwork(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({
      url: typeof input === "string" ? input : String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      bearer: headers["Authorization"] ?? headers["authorization"] ?? null,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return Promise.reject(new Error("simulated network failure"));
  });
}

beforeEach(() => {
  sent = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SEARCH_PARAMS = {
  domain: "product.sports.winter.ski.boots",
  query: "stiff all-mountain boots for a wide foot",
  n: 8,
  predicates: [{ key: "flex_index", op: "gte" as const, value: 110 }],
  destination: "DE",
};

const MINT_PARAMS = {
  path: "product.sports.winter.ski.boots",
  guide: "How ski boots are bought: last width first, then flex, then shell fit.",
  specs: [
    { key: "flex_index", display_name: "Flex index", data_type: "number", unit: "index" },
  ],
};

describe("each call hits exactly its OWN bare path, once, on the sil-api origin", () => {
  it.each([
    ["searchCatalog", "/catalog/search", () => searchCatalog(API, TOKEN, SEARCH_PARAMS), resultGolden()],
    ["lookupCatalog", "/catalog/lookup", () => lookupCatalog(API, TOKEN, ["variant:abc"]), resultGolden()],
    ["readStores", "/catalog/stores", () => readStores(API, TOKEN, { ref: "variant:abc" }), storesGolden()],
    ["mintDomain", "/catalog/domains", () => mintDomain(API, TOKEN, MINT_PARAMS), mintGolden()],
  ])("%s → POST %s", async (_name, path, call, body) => {
    respond(200, body);
    await call();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${API}${path}`);
    expect(sent[0].method).toBe("POST");
    expect(sent[0].bearer).toBe(`Bearer ${TOKEN}`);
  });

  it("findDomains → GET /catalog/domains?… — the same path, the OPPOSITE verb", async () => {
    // `mintDomain` POSTs this exact path. If the read ever emitted a POST it
    // would coin a category as a side effect of looking one up, with no undo —
    // so the method is asserted here, at the layer that decides it.
    respond(200, domainFindGolden());
    await findDomains(API, TOKEN, { q: "ski boots" });
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("GET");
    expect(sent[0].url).toBe(`${API}/catalog/domains?q=ski+boots`);
    expect(sent[0].bearer).toBe(`Bearer ${TOKEN}`);
    // A GET body is at best ignored and in strict fetch environments throws.
    expect(sent[0].body).toBeNull();
  });

  it("no call reaches `/api/v1` — the v0 routes are at the bare path", async () => {
    // The pre-v0 identity leg lives under `/api/v1` on the OTHER origin; a bare
    // path is the thing that keeps the two apart.
    //
    // DRIVEN, not observed. `sent` is reset per test, so asserting over it
    // without issuing a call passes vacuously — which is how this guard sat
    // green while proving nothing. Every call function is exercised first.
    respond(200, resultGolden());
    await searchCatalog(API, TOKEN, SEARCH_PARAMS);
    await lookupCatalog(API, TOKEN, ["variant:abc"]);
    respond(200, storesGolden());
    await readStores(API, TOKEN, { ref: "variant:abc" });
    respond(200, mintGolden());
    await mintDomain(API, TOKEN, MINT_PARAMS);
    respond(200, domainFindGolden());
    await findDomains(API, TOKEN, { path: "product.sports.winter.ski.boots" });

    expect(sent).toHaveLength(5);
    expect(sent.filter((s) => s.url.includes("/api/v1"))).toEqual([]);
  });

  it("a trailing slash on the configured origin does not produce a double slash", async () => {
    respond(200, resultGolden());
    await searchCatalog(`${API}/`, TOKEN, SEARCH_PARAMS);
    expect(sent[0].url).toBe(`${API}/catalog/search`);
  });

  it("a trailing slash survives the querystring join too", async () => {
    respond(200, domainFindGolden());
    await findDomains(`${API}/`, TOKEN, { q: "ski boots" });
    expect(sent[0].url).toBe(`${API}/catalog/domains?q=ski+boots`);
  });
});

describe("the request body is the agent's, with nothing invented", () => {
  it("search sends exactly `{ domain, query, n, predicates, destination }`", async () => {
    respond(200, resultGolden());
    await searchCatalog(API, TOKEN, SEARCH_PARAMS);
    expect(sent[0].body).toEqual(SEARCH_PARAMS);
  });

  it("search omits `predicates`/`destination` when the agent supplied neither", async () => {
    // The route is `additionalProperties: false` and an omitted optional is not
    // the same as an empty one: `destination: ""` would fail its own pattern, and
    // `predicates: []` asserts the agent stated no requirement when it said
    // nothing at all.
    respond(200, resultGolden());
    await searchCatalog(API, TOKEN, { domain: "product.x", query: "q", n: 3 });
    expect(sent[0].body).toEqual({ domain: "product.x", query: "q", n: 3 });
  });

  it("search never invents an `n` — it is a spend knob the agent owns", async () => {
    respond(200, resultGolden());
    await searchCatalog(API, TOKEN, { domain: "product.x", query: "q", n: 1 });
    expect((sent[0].body as Record<string, unknown>)["n"]).toBe(1);
  });

  it("lookup sends `{ refs }` and NOTHING else — no `k`, no `top_k`", async () => {
    // The route refuses a submitted spend knob outright rather than ignoring it;
    // a silently-ignored one reads as accepted.
    respond(200, resultGolden());
    await lookupCatalog(API, TOKEN, ["variant:a", "url:https://x.example/p"]);
    expect(sent[0].body).toEqual({ refs: ["variant:a", "url:https://x.example/p"] });
  });

  it("lookup forwards the refs AS GIVEN — no dedupe, no reordering, no rewriting", async () => {
    // The echo is what makes an absent ref an unambiguous miss; a client-side
    // dedupe would break the caller's set-difference correlation.
    respond(200, resultGolden());
    const refs = ["variant:b", "variant:a", "variant:b"];
    await lookupCatalog(API, TOKEN, refs);
    expect((sent[0].body as Record<string, unknown>)["refs"]).toEqual(refs);
  });

  it("stores sends ONE `ref`, not a batch", async () => {
    respond(200, storesGolden());
    await readStores(API, TOKEN, { ref: "variant:abc", destination: "DE" });
    expect(sent[0].body).toEqual({ ref: "variant:abc", destination: "DE" });
  });

  it("stores omits `destination` when the agent gave none — the route resolves the default", async () => {
    // "Ship to me" is an omitted key, resolved from `users.default_country`. The
    // plugin must not call `sil_whoami` to fill it.
    respond(200, storesGolden());
    await readStores(API, TOKEN, { ref: "variant:abc" });
    expect(sent[0].body).toEqual({ ref: "variant:abc" });
  });

  it("mint sends `{ path, guide, specs }` verbatim", async () => {
    respond(200, mintGolden());
    await mintDomain(API, TOKEN, MINT_PARAMS);
    expect(sent[0].body).toEqual(MINT_PARAMS);
  });
});

describe("token privacy and transport failure", () => {
  it("the token appears in the header and NOWHERE in the returned outcome", async () => {
    respond(200, resultGolden());
    const outcome = await searchCatalog(API, TOKEN, SEARCH_PARAMS);
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
    expect(sent[0].bearer).toContain(TOKEN);
  });

  it("the token is never placed in the request BODY", async () => {
    respond(200, resultGolden());
    await searchCatalog(API, TOKEN, SEARCH_PARAMS);
    expect(JSON.stringify(sent[0].body)).not.toContain(TOKEN);
  });

  it.each([
    ["searchCatalog", () => searchCatalog(API, TOKEN, SEARCH_PARAMS)],
    ["lookupCatalog", () => lookupCatalog(API, TOKEN, ["variant:a"])],
    ["readStores", () => readStores(API, TOKEN, { ref: "variant:a" })],
    ["mintDomain", () => mintDomain(API, TOKEN, MINT_PARAMS)],
    ["findDomains", () => findDomains(API, TOKEN, { q: "ski boots" })],
  ])("%s maps a network failure to `retryable`, never a fabricated ok", async (_n, call) => {
    failNetwork();
    expect((await call()).kind).toBe("retryable");
  });

  it("an unparseable 200 body is `retryable`, not `ok`", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    expect((await searchCatalog(API, TOKEN, SEARCH_PARAMS)).kind).toBe("retryable");
  });
});

describe("each call runs its OWN classifier — the route-specific statuses reach the caller", () => {
  it("a stores 404 surfaces as `not_found` through `readStores`", async () => {
    respond(404, STORES_404);
    expect((await readStores(API, TOKEN, { ref: "variant:gone" })).kind).toBe("not_found");
  });

  it("a mint 409 surfaces as `already_exists` through `mintDomain`, carrying the path", async () => {
    respond(409, MINT_409);
    const outcome = await mintDomain(API, TOKEN, MINT_PARAMS);
    if (outcome.kind !== "already_exists") throw new Error(`got ${outcome.kind}`);
    expect(outcome.path).toBe(MINT_PARAMS.path);
  });

  it("a search 404 is NOT `not_found` — that status belongs to stores alone", async () => {
    // `/catalog/search` has no 404 arm; inventing one would give the agent a
    // recovery for a state the route cannot produce.
    respond(404, { error: "not_found", message: "nope" });
    expect((await searchCatalog(API, TOKEN, SEARCH_PARAMS)).kind).toBe("retryable");
  });

  it("a search 409 is NOT `already_exists` — that status belongs to the mint alone", async () => {
    respond(409, MINT_409);
    expect((await searchCatalog(API, TOKEN, SEARCH_PARAMS)).kind).toBe("retryable");
  });

  it("a find 409 is NOT `already_exists` either — a read collides with nothing", async () => {
    // The read shares the mint's PATH, so this is the one place the two could be
    // conflated: reusing the mint's classifier would give the read a status for a
    // state it cannot reach, and `already_exists` reads as "the category is
    // already there" — a licence to stop looking.
    respond(409, MINT_409);
    expect((await findDomains(API, TOKEN, { q: "ski boots" })).kind).toBe("retryable");
  });

  it("a find 404 is NOT `not_found` — an absent domain is a 200 stating `exists: false`", async () => {
    respond(404, { error: "not_found", message: "nope" });
    expect((await findDomains(API, TOKEN, { path: "product.absent" })).kind).toBe("retryable");
  });

  it("a lookup 404/409 is likewise generic — one route, one extra status", async () => {
    respond(404, { error: "not_found" });
    expect((await lookupCatalog(API, TOKEN, ["variant:a"])).kind).toBe("retryable");
    sent = [];
    vi.restoreAllMocks();
    respond(409, MINT_409);
    expect((await lookupCatalog(API, TOKEN, ["variant:a"])).kind).toBe("retryable");
  });
});
