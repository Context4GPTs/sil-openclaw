/**
 * UNIT — `lookupCatalog` HTTP wrapper request construction (tier: unit, `fetch`
 * spied so nothing reaches the network).
 *
 * The lookup sibling of `search-client.test.ts`. Pins the request-construction
 * half of the catalog LOOKUP client in isolation (the classifier — the response
 * half — is `lookup-classify.test.ts`). `lookupCatalog(silApiUrl, token, ids)` is
 * the seam where the agent's `{ ids: string[] }` becomes the sil-api
 * `CatalogLookupRequest` body and the stored Bearer token becomes the
 * `Authorization` header — both load-bearing and both cheaply assertable with a
 * single `fetch` spy, exactly as `search-client.test.ts` pins `searchCatalog`.
 *
 * What this file locks down (the request side — card AC "[unit] … calls
 * POST <silApiUrl>/catalog/lookup with body { ids } (no envelope) … carrying the
 * stored user's Authorization: Bearer <token>"):
 *   - the URL is the BARE `${silApiUrl}/catalog/lookup` — NO `/api/v1` anywhere
 *     (the card's own Intent is WRONG; the route is bare — see
 *     docs/knowledge/sil-api-catalog-contract.md), trailing slash on the base
 *     tolerated, sil-api origin (NOT sil-web);
 *   - the method is POST with a JSON content-type and an `Authorization: Bearer
 *     <token>` header;
 *   - the body is EXACTLY `{ ids }` — the SIMPLIFIED shape: the tool builds NO UCP
 *     envelope and injects NO defaults (no `filters`, no `context`, no `signals`),
 *     forwarding the ids verbatim (sil-api owns dedup + any batch cap);
 *   - on a thrown fetch (network/timeout) the wrapper returns `retryable` and the
 *     token never appears in the returned union (the never-leak invariant at the
 *     wrapper boundary; the tool-level log canary is in `tools/product-get.test.ts`).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts`:
 *   lookupCatalog(
 *     silApiUrl: string,
 *     token: string,
 *     ids: string[],
 *   ): Promise<LookupOutcome>
 *   It POSTs `{ ids }` to the bare `/catalog/lookup` with the Bearer header, then
 *   returns `classifyLookupResponse(status, body)`. A thrown fetch →
 *   `{ kind: "retryable" }`. The exact request shape below IS the immutable spec.
 *
 * Wire shapes pinned to the ALREADY-MERGED sil-api `/catalog/lookup` contract
 * (PR #18; sil-services `@sil/schemas` catalog.ts) + the UCP catalog-lookup spec
 * (`vendor/ucp/spec/source/schemas/shopping/catalog_lookup.json#/$defs/lookup_request`
 * — `ids` required, `minItems: 1`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { lookupCatalog } from "../../lib/sil-client.js";

const SIL_API = "https://sil-api.test.example.com";

interface Captured {
  url: string;
  method: string;
  bearer: string | null;
  contentType: string | null;
  body: unknown;
}

/** The REAL sil-api lookup body, one product whose featured variant carries the
 * required `inputs` correlation — so a forwarded request resolves cleanly through the
 * classifier and the wrapper returns `ok`. FLAT shape (`{ products }` — top level, no
 * `result` wrapper), the only shape sil-api emits. */
function lookupEnvelope(): unknown {
  return {
    products: [
      {
        id: "gid://product/a",
        title: "Aeron Chair",
        description: { plain: "An ergonomic office chair." },
        price_range: {
          min: { amount: 159900, currency: "USD" },
          max: { amount: 159900, currency: "USD" },
        },
        source: "herman-miller",
        variants: [
          {
            id: "gid://variant/a1",
            title: "Aeron Chair — Graphite, Size B",
            price: { amount: 159900, currency: "USD" },
            availability: { available: true, status: "in_stock" },
            checkout_url: "https://buy.example.com/aeron-a1",
            inputs: [{ id: "gid://product/a", match: "featured" }],
          },
        ],
      },
    ],
  };
}

/** Spy `fetch` and capture the single outbound request, replying 200 with the
 * real lookup envelope so the wrapper resolves cleanly. */
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
        new Response(JSON.stringify(lookupEnvelope()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupCatalog — endpoint, method, and auth header", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("POSTs the BARE /catalog/lookup path (no /api/v1 anywhere)", async () => {
    await lookupCatalog(SIL_API, "tok", ["gid://product/a"]);
    expect(cap).toHaveLength(1);
    expect(new URL(cap[0]!.url).pathname).toBe("/catalog/lookup");
    expect(cap[0]!.url).not.toContain("/api/v1");
    expect(cap[0]!.url).toBe(`${SIL_API}/catalog/lookup`);
  });

  it("tolerates a trailing slash on the base URL (no double slash)", async () => {
    await lookupCatalog(`${SIL_API}/`, "tok", ["gid://product/a"]);
    expect(cap[0]!.url).toBe(`${SIL_API}/catalog/lookup`);
    expect(cap[0]!.url).not.toContain("//catalog");
  });

  it("uses POST with a JSON content-type and the stored Bearer token", async () => {
    await lookupCatalog(SIL_API, "the-access-token", ["gid://product/a"]);
    expect(cap[0]!.method).toBe("POST");
    expect(cap[0]!.contentType).toMatch(/application\/json/);
    expect(cap[0]!.bearer).toBe("Bearer the-access-token");
  });
});

describe("lookupCatalog — body is EXACTLY { ids } (no envelope, no defaults, ids verbatim)", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("sends the body { ids } with the ids verbatim and in the given order", async () => {
    await lookupCatalog(SIL_API, "tok", ["id-1", "id-2", "id-3"]);
    expect(cap[0]!.body).toEqual({ ids: ["id-1", "id-2", "id-3"] });
  });

  it("a single-id lookup carries that one id in the array", async () => {
    await lookupCatalog(SIL_API, "tok", ["gid://variant/solo"]);
    expect(cap[0]!.body).toEqual({ ids: ["gid://variant/solo"] });
  });

  it("builds NO UCP envelope and injects NO context/filters/signals (the agent sends { ids } only)", async () => {
    await lookupCatalog(SIL_API, "tok", ["gid://product/a"]);
    const body = cap[0]!.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["ids"]);
    expect(body["protocol"]).toBeUndefined();
    expect(body["version"]).toBeUndefined();
    expect(body["domain"]).toBeUndefined();
    expect(body["enrichment"]).toBeUndefined();
    expect(body["context"]).toBeUndefined();
    expect(body["filters"]).toBeUndefined();
    expect(body["signals"]).toBeUndefined();
  });

  it("forwards duplicate ids VERBATIM — does NOT dedup client-side (sil-api owns dedup)", async () => {
    // UCP mandates dedup, but sil-api owns it (it already dedups at the seam). The
    // tool must NOT dedup-then-mask, which would hide a seam regression. It
    // forwards the ids as given; the server returns each matched product once.
    await lookupCatalog(SIL_API, "tok", ["dup", "dup", "other"]);
    expect(cap[0]!.body).toEqual({ ids: ["dup", "dup", "other"] });
  });

  it("does NOT cap or truncate the batch — forwards a large id list verbatim (sil-api owns the cap)", async () => {
    // UCP allows an optional batch cap with a request_too_large 400; that is
    // sil-api's to enforce. The tool forwards the full list and trusts the server.
    const many = Array.from({ length: 50 }, (_, i) => `id-${i}`);
    await lookupCatalog(SIL_API, "tok", many);
    expect(cap[0]!.body).toEqual({ ids: many });
  });
});

describe("lookupCatalog — transport failure maps to retryable without leaking the token", () => {
  it("a thrown fetch (network/timeout) → retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("simulated network failure"));
    const out = await lookupCatalog(SIL_API, "tok", ["gid://product/a"]);
    expect(out.kind).toBe("retryable");
  });

  it("the returned union NEVER carries the access token (privacy at the wrapper boundary)", async () => {
    // On every path — success AND thrown — the token travels only in the outbound
    // request header, never into the returned LookupOutcome.
    const SECRET = "wrapper-secret-token";

    // Success path.
    spyFetch([]);
    const ok = await lookupCatalog(SIL_API, SECRET, ["gid://product/a"]);
    expect(JSON.stringify(ok)).not.toContain(SECRET);
    vi.restoreAllMocks();

    // Thrown path.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const thrown = await lookupCatalog(SIL_API, SECRET, ["gid://product/a"]);
    expect(JSON.stringify(thrown)).not.toContain(SECRET);
  });
});
