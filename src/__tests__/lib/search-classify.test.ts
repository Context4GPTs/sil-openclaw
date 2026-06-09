/**
 * UNIT — sil-api catalog SEARCH response classifier + the pure search outcome
 * projection (tier: unit, no network).
 *
 * The pure, highest-risk core of `sil_search`, pinned in isolation exactly like
 * `classifyIdentityResponse` / `classifyClaimResponse`. The whole agent-facing
 * error taxonomy and the empty-vs-error distinction hang off which `SearchOutcome`
 * a (status, body) pair maps to — so the mapping must be nailed down here, in the
 * cheapest tier, before any wiring.
 *
 * THREE distinct things this classifier must get right, all load-bearing:
 *
 *   1. STATUS taxonomy — the THREE distinct sil-api outcomes stay distinct
 *      (architect Risk "collapsing the three distinct sil-api outcomes"; sil-api
 *      keeps them apart at `handlers/catalog.ts:17-25,60-69`):
 *        200 (+ a usable `products` array) → ok            (a match OR empty match)
 *        400 empty_search_input            → invalid_request (surfaces {error,message})
 *        401 (auth preHandler rejected)    → unauthorized   (terminal re-register)
 *        5xx (source down) / non-200       → retryable      (transient try-again)
 *      400 and 500 must NEVER flatten into the empty-match success path, and 401
 *      (terminal) must be distinct from 5xx (transient) — a wrong hint sends the
 *      agent down a recovery path that can't fix the problem.
 *
 *   2. The empty-match-is-SUCCESS vs the anti-false-green guard (the subtlest
 *      pair, mirroring `extractIdentity`'s `name`-gate at sil-client.ts:340-357):
 *        200 { result: { products: [] } }  → ok + empty list   (a VALID empty match,
 *                                            NOT an error — UCP "this is not an error")
 *        200 with NO usable `products` array (partial / garbage / `{stub:true}`)
 *                                          → retryable, NEVER ok (the false-green guard:
 *                                            a stub/malformed 200 must not read as a
 *                                            clean empty match — see complete-work-is-stub-free)
 *      `ok` is gated on the envelope unwrapping AND `Array.isArray(result.products)` —
 *      the empty-array case is the success, the missing/non-array case is the fault.
 *
 *   3. The PROJECTION + cursor hoist (the read-subset normalizer the sibling
 *      `sil_product_get` reuses): unwrap `result` → server-order products → pick
 *      the FIRST (featured) variant per product → project to
 *      `{ id, title, price, availability, checkout_url }` + product-level `source` →
 *      hoist `result.pagination.cursor` to a top-level `cursor` (present iff
 *      `has_next_page`, ABSENT otherwise — end-of-results is the absent cursor,
 *      never a short page). `availability` passes through as the UCP OBJECT
 *      (`{ available?, status? }`), never flattened to a bare boolean.
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts` — model on `IdentityOutcome`:
 *   classifySearchResponse(status: number, body: unknown): SearchOutcome
 *   where SearchOutcome is a discriminated union on `kind`:
 *     | { kind: "ok"; products: SearchProduct[]; cursor?: string }
 *     | { kind: "unauthorized" }
 *     | { kind: "invalid_request"; error?: string; message?: string }
 *     | { kind: "retryable" }
 *   and SearchProduct = {
 *     id: string; title: string;
 *     variant: { id; title; price; availability; checkout_url };
 *     source: string;
 *   }
 *   The classifier branches on `status` (and, for 200, the body shape) — NEVER on
 *   `res.ok`. It accepts the products either bare or unwrapped from the UCP
 *   envelope's `result`. The exact field/variant projection is the dev's to shape,
 *   but the FIELD NAMES below and the cursor-hoist + empty-vs-error split ARE the
 *   immutable spec (assert the projected `variant.checkout_url`, the passthrough
 *   `availability` object, and the hoisted `cursor`).
 *   (If the dev sites the classifier elsewhere, re-export it from sil-client.ts so
 *   this isolation test still binds — the classifier is the spec, not its file.)
 *
 * Wire shapes pinned to the ALREADY-MERGED sil-api contract (sil-services
 * `@sil/schemas` `packages/schemas/src/catalog.ts` + `envelope.ts` +
 * `services/sil-api/src/handlers/catalog.ts`), NOT `@ucp-js/sdk` (which carries
 * zero catalog types — Fact Correction 2 in the card).
 */

import { describe, it, expect } from "vitest";

import { classifySearchResponse } from "../../lib/sil-client.js";

/** A real `SilCatalogVariant` (UCP variant + required non-empty `checkout_url`);
 * `availability` is the UCP OBJECT shape `{ available?, status? }`. */
const VARIANT_A = {
  id: "gid://variant/a1",
  title: "Aeron Chair — Graphite, Size B",
  description: { plain: "An ergonomic office chair." },
  price: { amount: 159900, currency: "USD" },
  availability: { available: true, status: "in_stock" },
  checkout_url: "https://buy.example.com/aeron-a1",
};

/** A second variant on the SAME product — the projection must pick the FIRST
 * (featured) one, never this one. */
const VARIANT_A2 = {
  id: "gid://variant/a2",
  title: "Aeron Chair — Carbon, Size C",
  description: { plain: "An ergonomic office chair." },
  price: { amount: 169900, currency: "USD" },
  availability: { available: false, status: "out_of_stock" },
  checkout_url: "https://buy.example.com/aeron-a2",
};

/** A real `SilCatalogProduct` (UCP product + required `source`), two variants. */
const PRODUCT_A = {
  id: "gid://product/a",
  title: "Aeron Chair",
  description: { plain: "An ergonomic office chair." },
  price_range: {
    min: { amount: 159900, currency: "USD" },
    max: { amount: 169900, currency: "USD" },
  },
  variants: [VARIANT_A, VARIANT_A2],
  source: "herman-miller",
};

const VARIANT_B = {
  id: "gid://variant/b1",
  title: "Standing Desk — Oak",
  description: { plain: "A height-adjustable desk." },
  price: { amount: 89900, currency: "USD" },
  availability: { available: true, status: "in_stock" },
  checkout_url: "https://buy.example.com/desk-b1",
};

const PRODUCT_B = {
  id: "gid://product/b",
  title: "Standing Desk",
  description: { plain: "A height-adjustable desk." },
  price_range: {
    min: { amount: 89900, currency: "USD" },
    max: { amount: 89900, currency: "USD" },
  },
  variants: [VARIANT_B],
  source: "uplift",
};

/** Wrap a `CatalogSearchResult` in the real UCP envelope `buildEnvelope` emits. */
function envelope(result: unknown): unknown {
  return {
    protocol: "ucp",
    version: "0.1",
    domain: "catalog",
    request_id: "req-1",
    issued_at: "2026-06-09T00:00:00.000Z",
    enrichment: { agent_id: "auth0|abc", enriched: true, source: "sil-api" },
    result,
  };
}

/** The current skeleton STUB shape (`stubResult` → `{ stub, tool, echo }`). A
 * 200 carrying this must NEVER read as a clean empty match (complete-work-is-stub-free). */
const STUB_BODY = { stub: true, tool: "sil_search", echo: { query: "chair" } };

describe("classifySearchResponse — the three distinct sil-api outcomes stay distinct", () => {
  it("200 with a populated result → ok (carries the products)", () => {
    const out = classifySearchResponse(
      200,
      envelope({ products: [PRODUCT_A], pagination: { has_next_page: false } }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products).toHaveLength(1);
    }
  });

  it("400 empty_search_input → invalid_request, surfacing sil-api's {error, message}", () => {
    // sil-api rejects an empty body with a structured 400 (handlers/catalog.ts
    // sourceErrorToHttp: empty_search_input → 400). This is the authoritative
    // backstop for the ≥1-input rule and MUST be distinct from both the empty
    // match (200) and the transient failure (5xx).
    const out = classifySearchResponse(400, {
      error: "empty_search_input",
      message: "Provide a search query or at least one filter.",
    });
    expect(out.kind).toBe("invalid_request");
    if (out.kind === "invalid_request") {
      expect(out.error).toBe("empty_search_input");
      expect(out.message).toBe("Provide a search query or at least one filter.");
    }
  });

  it("401 → unauthorized (terminal re-register, NOT transient)", () => {
    // The catalog routes sit behind the JWT preHandler (handlers/catalog.ts:8):
    // an unauthenticated/dead-session request is rejected 401 before the handler.
    const out = classifySearchResponse(401, { error: "unauthorized" });
    expect(out.kind).toBe("unauthorized");
  });

  it("500 source-down → retryable (transient, NOT invalid_request, NOT unauthorized)", () => {
    // A source being down maps to 500 (sourceErrorToHttp: source_unavailable →
    // 500). It is transient — the agent should try again, never re-register and
    // never treat it as a bad request.
    const out = classifySearchResponse(500, {
      error: "source_unavailable",
      message: "The catalog source is temporarily unavailable.",
    });
    expect(out.kind).toBe("retryable");
  });

  it("keeps the four outcome kinds DISTINCT (no two of ok/invalid_request/unauthorized/retryable collapse)", () => {
    // The load-bearing taxonomy assertion: each documented status maps to its
    // OWN kind. Collapsing any pair loses the agent's recovery hint.
    const kinds = new Set([
      classifySearchResponse(
        200,
        envelope({ products: [PRODUCT_A], pagination: { has_next_page: false } }),
      ).kind,
      classifySearchResponse(400, { error: "empty_search_input" }).kind,
      classifySearchResponse(401, {}).kind,
      classifySearchResponse(500, {}).kind,
    ]);
    expect(kinds.size).toBe(4);
  });

  it("does NOT flatten 400 or 500 into the empty-match (ok) path", () => {
    // The cardinal conflation risk: a 400/500 must never read as a 200-with-no-
    // products (empty match). Both are non-ok, distinctly.
    expect(classifySearchResponse(400, { error: "empty_search_input" }).kind).not.toBe("ok");
    expect(classifySearchResponse(500, { error: "source_unavailable" }).kind).not.toBe("ok");
  });

  it("4xx other than 400/401 → retryable, never a silent ok (defensive)", () => {
    // Unmapped 4xx (e.g. 403/404/429) is not a clean empty match. It must not
    // read as ok; a non-ok terminal/transient is correct (retryable is the safe
    // non-ok landing — re-running can't make a 200-empty out of a 4xx).
    for (const code of [403, 404, 409, 429]) {
      expect(classifySearchResponse(code, {}).kind).not.toBe("ok");
    }
  });
});

describe("classifySearchResponse — empty match is SUCCESS, not error", () => {
  it("200 { result: { products: [] } } → ok with an EMPTY products list and NO cursor", () => {
    // UCP: an empty search returns an empty array — "this is not an error". The
    // agent must see status ok + an empty list, never an error branch.
    const out = classifySearchResponse(
      200,
      envelope({ products: [], pagination: { has_next_page: false } }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products).toEqual([]);
      expect(out.cursor).toBeUndefined();
    }
  });

  it("an empty match is NOT invalid_request and NOT retryable", () => {
    // The empty-vs-error distinction, asserted negatively: a genuine 200 empty
    // match must never be misread as a bad request or a transient failure.
    const out = classifySearchResponse(200, envelope({ products: [] }));
    expect(out.kind).toBe("ok");
    expect(["invalid_request", "retryable", "unauthorized"]).not.toContain(out.kind);
  });
});

describe("classifySearchResponse — the anti-false-green body gate on 200", () => {
  it("200 carrying the skeleton STUB body ({stub,tool,echo}) is NOT ok", () => {
    // THE false-green guard (complete-work-is-stub-free): a 200 that is the
    // `{ stub: true }` echo — not a real search result — must NOT classify as a
    // clean empty match. If it did, the suite could go green against the stub
    // while the product (real catalog search) is unmet.
    const out = classifySearchResponse(200, STUB_BODY);
    expect(out.kind).not.toBe("ok");
  });

  it("200 wrapping the STUB body in an envelope `result` is still NOT ok", () => {
    // Defends the gate after the unwrap: a wrapped stub (no `products` array) is
    // still a stub and must fall to retryable, never a false empty match.
    const out = classifySearchResponse(200, envelope(STUB_BODY));
    expect(out.kind).not.toBe("ok");
  });

  it("200 whose result has NO `products` key → retryable, NEVER ok", () => {
    // A partial/garbage 200 (no products array at all) is a server fault, not a
    // valid empty match. It is `retryable`, distinct from the genuine empty match
    // (which has `products: []`).
    const out = classifySearchResponse(200, envelope({ pagination: { has_next_page: false } }));
    expect(out.kind).toBe("retryable");
    expect(out.kind).not.toBe("ok");
  });

  it("200 whose `products` is a NON-ARRAY (null / object / string) → retryable, never ok", () => {
    // The `Array.isArray` half of the gate: a non-array `products` is malformed,
    // distinct from an empty array. Only a genuine ARRAY (incl. empty) is `ok`.
    expect(classifySearchResponse(200, envelope({ products: null })).kind).not.toBe("ok");
    expect(classifySearchResponse(200, envelope({ products: {} })).kind).not.toBe("ok");
    expect(classifySearchResponse(200, envelope({ products: "nope" })).kind).not.toBe("ok");
  });

  it("200 with an empty / null / non-object body → retryable, never ok (defensive)", () => {
    // A malformed 200 (no envelope, no result) is a server fault — never a clean
    // empty match.
    expect(classifySearchResponse(200, {}).kind).not.toBe("ok");
    expect(classifySearchResponse(200, null).kind).not.toBe("ok");
    expect(classifySearchResponse(200, "not-an-object").kind).not.toBe("ok");
  });

  it("does NOT branch on res.ok — a 200 stub and a 200 real result differ only by body", () => {
    // Same status (200), opposite outcomes — proves the discriminant for `ok` is
    // the `products` array in the body, not the HTTP status.
    expect(classifySearchResponse(200, envelope({ products: [PRODUCT_A] })).kind).toBe("ok");
    expect(classifySearchResponse(200, STUB_BODY).kind).not.toBe("ok");
  });
});

describe("classifySearchResponse — projection (first/featured variant, six fields, source)", () => {
  it("preserves server ORDER of products (the tool does NOT re-rank)", () => {
    // UCP ranks best-match first; the tool passes products through in server
    // order. A classifier that sorted/reordered would break the ranked contract.
    const out = classifySearchResponse(
      200,
      envelope({ products: [PRODUCT_A, PRODUCT_B] }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products).toHaveLength(2);
      expect(out.products[0]!.id).toBe("gid://product/a");
      expect(out.products[1]!.id).toBe("gid://product/b");
    }
  });

  it("picks the FIRST (featured) variant per product, never a later one", () => {
    // The agent-facing contract promises ONE purchasable variant per product —
    // the featured/best-match (first) variant. PRODUCT_A has two; the projection
    // must surface VARIANT_A (a1), never VARIANT_A2 (a2).
    const out = classifySearchResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const p = out.products[0]!;
      expect(p.variant.id).toBe("gid://variant/a1");
      expect(p.variant.id).not.toBe("gid://variant/a2");
    }
  });

  it("projects exactly the six fields: product {id,title,source} + variant {id,title,price,availability,checkout_url}", () => {
    const out = classifySearchResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const p = out.products[0]!;
      // Product-level: id, title, source.
      expect(p.id).toBe("gid://product/a");
      expect(p.title).toBe("Aeron Chair");
      expect(p.source).toBe("herman-miller");
      // Variant-level: id, title, price, availability, checkout_url.
      expect(p.variant.id).toBe("gid://variant/a1");
      expect(p.variant.title).toBe("Aeron Chair — Graphite, Size B");
      expect(p.variant.price).toEqual({ amount: 159900, currency: "USD" });
      expect(p.variant.checkout_url).toBe("https://buy.example.com/aeron-a1");
    }
  });

  it("passes `availability` through as the UCP OBJECT, never flattened to a bare boolean", () => {
    // ASSUMPTION 2 RESOLVED: sil-api `availability` is `{ available?, status? }`
    // (catalog.ts:113-122). Flattening to a bare boolean would drop the `status`
    // signal the agent may act on. Pass it through as-is.
    const out = classifySearchResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const avail = out.products[0]!.variant.availability as Record<string, unknown>;
      expect(typeof avail).toBe("object");
      expect(avail).not.toBe(true);
      expect(avail["available"]).toBe(true);
      expect(avail["status"]).toBe("in_stock");
    }
  });

  it("carries the product-level `source` (a sil enrichment field, not a raw UCP field)", () => {
    const out = classifySearchResponse(200, envelope({ products: [PRODUCT_A, PRODUCT_B] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products[0]!.source).toBe("herman-miller");
      expect(out.products[1]!.source).toBe("uplift");
    }
  });
});

describe("classifySearchResponse — cursor hoist (end-of-results is the ABSENT cursor)", () => {
  it("has_next_page:true → the top-level cursor is result.pagination.cursor verbatim", () => {
    // The opaque cursor is nested at result.pagination.cursor (present iff
    // has_next_page). Hoist it to a top-level cursor, passed through verbatim.
    const out = classifySearchResponse(
      200,
      envelope({
        products: [PRODUCT_A],
        pagination: { has_next_page: true, cursor: "opaque-cursor-xyz" },
      }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.cursor).toBe("opaque-cursor-xyz");
    }
  });

  it("has_next_page:false → NO cursor (end-of-results is the absent cursor, never a short page)", () => {
    // The end-of-results signal is the ABSENCE of a cursor — never page length.
    // An agent that infers "no more" from a short page (instead of an absent
    // cursor) stops paginating early; the tool must not hand back a cursor here.
    const out = classifySearchResponse(
      200,
      envelope({ products: [PRODUCT_A], pagination: { has_next_page: false } }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.cursor).toBeUndefined();
    }
  });

  it("has_next_page:false WITH a stale `cursor` present → still NO cursor (gate on has_next_page, not cursor presence)", () => {
    // The defensive gate: even if the wire carries a (stale/erroneous) cursor on a
    // last page, has_next_page:false is authoritative — the tool must SUPPRESS it.
    // Hoisting any present cursor instead of gating on has_next_page would hand the
    // agent a dead cursor and an infinite "one more page" loop.
    const out = classifySearchResponse(
      200,
      envelope({
        products: [PRODUCT_A],
        pagination: { has_next_page: false, cursor: "stale-should-be-suppressed" },
      }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.cursor).toBeUndefined();
    }
  });

  it("no pagination block at all → NO cursor (treated as last page)", () => {
    const out = classifySearchResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.cursor).toBeUndefined();
    }
  });

  it("a NON-empty page WITHOUT a cursor still has no cursor (length != end-of-results signal)", () => {
    // Belt-and-braces on the pagination risk: even a full-looking page with two
    // products and has_next_page:false yields no cursor. Paging is driven by the
    // cursor, never by products.length.
    const out = classifySearchResponse(
      200,
      envelope({ products: [PRODUCT_A, PRODUCT_B], pagination: { has_next_page: false } }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products).toHaveLength(2);
      expect(out.cursor).toBeUndefined();
    }
  });
});
