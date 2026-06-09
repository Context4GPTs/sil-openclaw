/**
 * UNIT — sil-api catalog LOOKUP response classifier + the pure lookup outcome
 * projection (tier: unit, no network).
 *
 * The pure, highest-risk core of `sil_product_get`, pinned in isolation exactly
 * like `classifySearchResponse` / `classifyIdentityResponse`. The whole
 * agent-facing taxonomy — and the headline lookup invariant that UNFOUND IDS ARE A
 * SUCCESS (not an error) — hangs off which `LookupOutcome` a (status, body) pair
 * maps to. So the mapping must be nailed down here, in the cheapest tier, before
 * any wiring.
 *
 * FOUR distinct things this classifier must get right, all load-bearing:
 *
 *   1. STATUS taxonomy — four distinct outcomes stay distinct (the catalog routes
 *      sit behind the same JWT preHandler as search; a 401 is the dead-session
 *      terminal, a 5xx/source-down is the transient):
 *        200 (+ a usable `products` array, possibly empty) → ok
 *        400 (Fastify schema reject — e.g. empty ids,       → invalid_request
 *             request_too_large)                              (surfaces {error,message})
 *        401 (auth preHandler rejected)                     → unauthorized  (terminal re-register)
 *        5xx (source down) / other non-200                  → retryable     (transient try-again)
 *      400 and 500 must NEVER flatten into the ok path, and 401 (terminal) must be
 *      DISTINCT from 5xx (transient) — a wrong hint sends the agent down a recovery
 *      path that can't fix the problem (auth dance on a blip; retry-forever on a
 *      dead session). NOTE: lookup's empty-`ids` 400 is a SCHEMA-validation reject,
 *      NOT the search-only `empty_search_input` SourceError — the classifier maps
 *      ANY 400 → invalid_request and must not special-case that code on this path.
 *
 *   2. UNFOUND IDS ARE A SUCCESS surfaced as a `not_found` list — never an error
 *      (the headline lookup risk; UCP §Identifiers Not Found: "return success with
 *      the found products … MAY include informational messages indicating which
 *      identifiers were not found"):
 *        200 { result: { products:[…found…], messages:[{type:"info",code:"not_found",content:"<id>"}] } }
 *                          → ok + found products + not_found:[<the unfound ids>]
 *        200 { result: { products:[], messages:[…not_found for every id…] } }
 *                          → ok + products:[] + not_found:[<all ids>]   (all-missed IS a success)
 *        200 { result: { products:[…all resolved…] } } (NO messages key)
 *                          → ok + NO not_found key                       (every id resolved)
 *      The `not_found` ids come from `result.messages` entries whose
 *      `code === "not_found"`; `content` is the id (sil-api emits exactly this,
 *      `messages` OMITTED on full success). A `not_found` is DATA on the ok result,
 *      NEVER an error and NEVER a recovery hint.
 *
 *   3. The anti-false-green body gate on 200 (mirroring `extractIdentity`'s
 *      `name`-gate / `extractSearchResult`'s array-gate — complete-work-is-stub-free):
 *        200 { result: { products: [] } }      → ok + empty list   (a VALID all-missed,
 *                                                 distinct from the no-array fault)
 *        200 with NO usable `products` array (partial / garbage / `{stub:true}`)
 *                                              → retryable, NEVER ok (the false-green guard:
 *                                                a stub/malformed 200 must not read as ok)
 *      `ok` is gated on the envelope unwrapping AND `Array.isArray(result.products)` —
 *      the empty-array case is the all-missed success, the missing/non-array case is
 *      the fault. SUBTLE: distinguish by PRESENCE of a real products array, NEVER by
 *      array length.
 *
 *   4. The RICH projection + the `inputs` correlation (lookup's defining feature
 *      over search — the read-subset normalizer): unwrap `result` → products (NOT
 *      re-ordered; the response does not preserve request order) → per product pick
 *      the FIRST (featured) variant → project the RICH product subset
 *      (`id`,`title`,`description`,`categories?`,`price_range`,`source`,`handle?`)
 *      + the featured variant (`id`,`title`,`price`,`availability` OBJECT,
 *      `checkout_url`,`sku?`,`options?`, and the **`inputs:[{id,match}]`**
 *      correlation, `match` ∈ {exact,featured}). `availability` passes through as
 *      the UCP OBJECT (`{available?,status?}`), NEVER flattened to a bare boolean.
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts` — model on `SearchOutcome`:
 *   classifyLookupResponse(status: number, body: unknown): LookupOutcome
 *   where LookupOutcome is a discriminated union on `kind`:
 *     | { kind: "ok"; products: LookupProduct[]; not_found?: string[] }
 *     | { kind: "unauthorized" }
 *     | { kind: "invalid_request"; error?: string; message?: string }
 *     | { kind: "retryable" }
 *   and LookupProduct surfaces the RICH product subset + a nested featured
 *   `variant` carrying the `inputs` correlation. The classifier branches on
 *   `status` (and, for 200, the body shape) — NEVER on `res.ok`. The FIELD NAMES
 *   below and the unfound-is-success + anti-false-green splits ARE the immutable
 *   spec. (If the dev sites the classifier elsewhere, re-export it from
 *   sil-client.ts so this isolation test still binds — the classifier is the spec,
 *   not its file.)
 *
 * Wire shapes pinned to the ALREADY-MERGED sil-api `/catalog/lookup` contract
 * (PR #18; sil-services `@sil/schemas` catalog.ts + envelope.ts) and the UCP
 * catalog-lookup spec (`vendor/ucp/spec/.../catalog/lookup.md` +
 * `source/schemas/shopping/catalog_lookup.json` + `types/input_correlation.json`),
 * NOT `@ucp-js/sdk` (which carries zero catalog types).
 */

import { describe, it, expect } from "vitest";

import { classifyLookupResponse } from "../../lib/sil-client.js";

/** A real lookup `variant`: UCP variant + sil-api's required non-empty
 * `checkout_url` + the REQUIRED lookup `inputs` correlation (UCP
 * `catalog_lookup.json#/$defs/lookup_variant`: `inputs` required, minItems 1).
 * `availability` is the UCP OBJECT `{ available?, status? }`. `options` is the
 * `{ name, label }` selected-option shape. */
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

/** A SECOND variant on the SAME product — the projection must pick the FIRST
 * (featured) one, never this one. */
const VARIANT_A2 = {
  id: "gid://variant/a2",
  title: "Aeron Chair — Carbon, Size C",
  description: { plain: "An ergonomic office chair." },
  sku: "AER-CB-C",
  options: [
    { name: "Color", label: "Carbon" },
    { name: "Size", label: "C" },
  ],
  price: { amount: 169900, currency: "USD" },
  availability: { available: false, status: "out_of_stock" },
  checkout_url: "https://buy.example.com/aeron-a2",
  inputs: [{ id: "gid://variant/a2", match: "exact" }],
};

/** A real lookup product (UCP product + sil-api's required `source`), RICH:
 * description, categories, price_range, handle. Two variants. */
const PRODUCT_A = {
  id: "gid://product/a",
  handle: "aeron-chair",
  title: "Aeron Chair",
  description: { plain: "An ergonomic office chair.", html: "<p>An ergonomic office chair.</p>" },
  categories: [{ name: "Office Furniture" }],
  price_range: {
    min: { amount: 159900, currency: "USD" },
    max: { amount: 169900, currency: "USD" },
  },
  variants: [VARIANT_A1, VARIANT_A2],
  source: "herman-miller",
};

/** A variant resolved by an EXACT (variant-id) match — to assert the `match`
 * distinction the agent relies on. */
const VARIANT_B1 = {
  id: "gid://variant/b1",
  title: "Standing Desk — Oak",
  description: { plain: "A height-adjustable desk." },
  sku: "DESK-OAK",
  options: [{ name: "Finish", label: "Oak" }],
  price: { amount: 89900, currency: "USD" },
  availability: { available: true, status: "in_stock" },
  checkout_url: "https://buy.example.com/desk-b1",
  inputs: [{ id: "gid://variant/b1", match: "exact" }],
};

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
  variants: [VARIANT_B1],
  source: "uplift",
};

/** Wrap a `CatalogLookupResult` in the real UCP envelope `buildEnvelope` emits. */
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

/** A single `not_found` info message, exactly as sil-api emits per unresolved id
 * (UCP §Identifiers Not Found; `{ type:"info", code:"not_found", content:<id> }`). */
function notFoundMsg(id: string): Record<string, unknown> {
  return { type: "info", code: "not_found", content: id };
}

/** A stub-shaped 200 (`{ stub, tool, echo }`). Such a body must NEVER read as a
 * clean lookup (complete-work-is-stub-free). */
const STUB_BODY = { stub: true, tool: "sil_product_get", echo: { ids: ["x"] } };

describe("classifyLookupResponse — the four distinct outcomes stay distinct", () => {
  it("200 with a populated result → ok (carries the products)", () => {
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products).toHaveLength(1);
    }
  });

  it("400 (schema reject) → invalid_request, surfacing sil-api's {error, message}", () => {
    // A lookup with an empty/missing `ids` (or an over-limit batch) is rejected by
    // the Fastify request schema with a generic 400 — NOT the search-only
    // `empty_search_input` SourceError. The classifier maps ANY 400 →
    // invalid_request and surfaces whatever {error,message} the body carries.
    const out = classifyLookupResponse(400, {
      error: "request_too_large",
      message: "Too many identifiers in one request.",
    });
    expect(out.kind).toBe("invalid_request");
    if (out.kind === "invalid_request") {
      expect(out.error).toBe("request_too_large");
      expect(out.message).toBe("Too many identifiers in one request.");
    }
  });

  it("401 → unauthorized (terminal re-register, NOT transient)", () => {
    // The catalog routes sit behind the JWT preHandler: an unauthenticated/dead-
    // session request is rejected 401 before the handler.
    const out = classifyLookupResponse(401, { error: "unauthorized" });
    expect(out.kind).toBe("unauthorized");
  });

  it("500 source-down → retryable (transient, NOT invalid_request, NOT unauthorized)", () => {
    const out = classifyLookupResponse(500, {
      error: "source_unavailable",
      message: "The catalog source is temporarily unavailable.",
    });
    expect(out.kind).toBe("retryable");
  });

  it("keeps the four outcome kinds DISTINCT (no two of ok/invalid_request/unauthorized/retryable collapse)", () => {
    const kinds = new Set([
      classifyLookupResponse(200, envelope({ products: [PRODUCT_A] })).kind,
      classifyLookupResponse(400, { error: "request_too_large" }).kind,
      classifyLookupResponse(401, {}).kind,
      classifyLookupResponse(500, {}).kind,
    ]);
    expect(kinds.size).toBe(4);
  });

  it("does NOT flatten 400 or 500 into the ok path", () => {
    expect(classifyLookupResponse(400, { error: "request_too_large" }).kind).not.toBe("ok");
    expect(classifyLookupResponse(500, { error: "source_unavailable" }).kind).not.toBe("ok");
  });

  it("4xx other than 400/401 → retryable, never a silent ok (defensive)", () => {
    for (const code of [403, 404, 409, 429]) {
      expect(classifyLookupResponse(code, {}).kind).not.toBe("ok");
    }
  });
});

describe("classifyLookupResponse — unfound ids are a SUCCESS surfaced as not_found, never an error", () => {
  it("a mix of found + unfound → ok with the found products AND not_found:[the unfound ids]", () => {
    // UCP §Identifiers Not Found: return success with the found products plus info
    // messages naming the unfound. NOT an error branch.
    const out = classifyLookupResponse(
      200,
      envelope({ products: [PRODUCT_A], messages: [notFoundMsg("gid://product/missing")] }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products).toHaveLength(1);
      expect(out.not_found).toEqual(["gid://product/missing"]);
    }
  });

  it("NONE resolve → ok with products:[] and not_found:[every requested id] (all-missed IS a success)", () => {
    // The lookup analogue of search's empty-results-as-success — but lookup NAMES
    // which ids came back empty. Empty products + a full not_found is `ok`, NOT an
    // error, distinct from a not-registered/transport failure.
    const out = classifyLookupResponse(
      200,
      envelope({
        products: [],
        messages: [notFoundMsg("missing-1"), notFoundMsg("missing-2"), notFoundMsg("missing-3")],
      }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products).toEqual([]);
      expect(out.not_found).toEqual(["missing-1", "missing-2", "missing-3"]);
    }
  });

  it("every id resolves → ok with NO not_found key (messages omitted server-side on full success)", () => {
    // sil-api omits the `messages` key entirely when every id resolved
    // (catalog.ts:88-91). The tool surfaces that absence as no `not_found` — never
    // an empty array the agent must special-case, and never a stray key.
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A, PRODUCT_B] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products).toHaveLength(2);
      expect(out.not_found).toBeUndefined();
    }
  });

  it("an empty `messages` array → still NO not_found (an empty list is not a miss)", () => {
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A], messages: [] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.not_found).toBeUndefined();
    }
  });

  it("not_found ids come from `content` and preserve the server's order", () => {
    const out = classifyLookupResponse(
      200,
      envelope({
        products: [PRODUCT_A],
        messages: [notFoundMsg("zeta"), notFoundMsg("alpha"), notFoundMsg("mu")],
      }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.not_found).toEqual(["zeta", "alpha", "mu"]);
    }
  });

  it("ignores non-not_found messages (a warning/disclosure does NOT become a not_found id)", () => {
    // A catalog response may carry warning/disclosure messages too. Only entries
    // whose `code === "not_found"` are misses; broader passthrough is out of scope.
    const out = classifyLookupResponse(
      200,
      envelope({
        products: [PRODUCT_A],
        messages: [
          { type: "warning", code: "allergens", path: "$.products[0]", content: "Contains nuts." },
          notFoundMsg("really-missing"),
        ],
      }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.not_found).toEqual(["really-missing"]);
      // The warning content must NOT leak into the not_found id list.
      expect(out.not_found).not.toContain("Contains nuts.");
      expect(out.not_found).not.toContain("allergens");
    }
  });

  it("a partial hit is NOT invalid_request and NOT retryable (it is ok)", () => {
    const out = classifyLookupResponse(
      200,
      envelope({ products: [PRODUCT_A], messages: [notFoundMsg("x")] }),
    );
    expect(out.kind).toBe("ok");
    expect(["invalid_request", "retryable", "unauthorized"]).not.toContain(out.kind);
  });
});

describe("classifyLookupResponse — the anti-false-green body gate on 200", () => {
  it("200 carrying the skeleton STUB body ({stub,tool,echo}) is NOT ok", () => {
    const out = classifyLookupResponse(200, STUB_BODY);
    expect(out.kind).not.toBe("ok");
  });

  it("200 wrapping the STUB body in an envelope `result` is still NOT ok", () => {
    const out = classifyLookupResponse(200, envelope(STUB_BODY));
    expect(out.kind).not.toBe("ok");
  });

  it("200 whose result has NO `products` key → retryable, NEVER ok", () => {
    // A partial/garbage 200 (no products array at all) is a server fault, not a
    // valid all-missed lookup. It is `retryable`, DISTINCT from the genuine
    // all-missed (which has products:[] + not_found).
    const out = classifyLookupResponse(200, envelope({ messages: [notFoundMsg("x")] }));
    expect(out.kind).toBe("retryable");
    expect(out.kind).not.toBe("ok");
  });

  it("200 whose `products` is a NON-ARRAY (null / object / string) → retryable, never ok", () => {
    expect(classifyLookupResponse(200, envelope({ products: null })).kind).not.toBe("ok");
    expect(classifyLookupResponse(200, envelope({ products: {} })).kind).not.toBe("ok");
    expect(classifyLookupResponse(200, envelope({ products: "nope" })).kind).not.toBe("ok");
  });

  it("200 with an empty / null / non-object body → retryable, never ok (defensive)", () => {
    expect(classifyLookupResponse(200, {}).kind).not.toBe("ok");
    expect(classifyLookupResponse(200, null).kind).not.toBe("ok");
    expect(classifyLookupResponse(200, "not-an-object").kind).not.toBe("ok");
  });

  it("the all-missed success (products:[]) is DISTINCT from the no-array fault — by PRESENCE, not length", () => {
    // THE subtle correctness point: a 200 with a real empty `products` array is the
    // all-missed SUCCESS; a 200 with NO products array is the fault. The
    // discriminant is the array's presence, NEVER its length.
    const allMissed = classifyLookupResponse(
      200,
      envelope({ products: [], messages: [notFoundMsg("x")] }),
    );
    const noArray = classifyLookupResponse(200, envelope({ messages: [notFoundMsg("x")] }));
    expect(allMissed.kind).toBe("ok");
    expect(noArray.kind).toBe("retryable");
  });

  it("does NOT branch on res.ok — a 200 stub and a 200 real result differ only by body", () => {
    expect(classifyLookupResponse(200, envelope({ products: [PRODUCT_A] })).kind).toBe("ok");
    expect(classifyLookupResponse(200, STUB_BODY).kind).not.toBe("ok");
  });
});

describe("classifyLookupResponse — rich projection (first/featured variant, rich subset, source)", () => {
  it("does NOT rely on response order — surfaces each product with its own id (order not guaranteed)", () => {
    // UCP §Client Correlation: the response does NOT guarantee request order. The
    // tool surfaces products as the server returns them and the agent correlates
    // via `inputs`, never by array position.
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_B, PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.products).toHaveLength(2);
      const ids = out.products.map((p) => p.id);
      expect(ids).toContain("gid://product/a");
      expect(ids).toContain("gid://product/b");
    }
  });

  it("picks the FIRST (featured) variant per product, never a later one", () => {
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const v = out.products[0]!.variant;
      expect(v.id).toBe("gid://variant/a1");
      expect(v.id).not.toBe("gid://variant/a2");
    }
  });

  it("projects the RICH product subset: id, title, description, categories, price_range, source, handle", () => {
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const p = out.products[0]! as unknown as Record<string, unknown>;
      expect(p["id"]).toBe("gid://product/a");
      expect(p["title"]).toBe("Aeron Chair");
      // description is the full object (not just a title — lookup is for a purchase
      // decision), passed through.
      expect(p["description"]).toEqual({
        plain: "An ergonomic office chair.",
        html: "<p>An ergonomic office chair.</p>",
      });
      expect(p["categories"]).toEqual([{ name: "Office Furniture" }]);
      expect(p["price_range"]).toEqual({
        min: { amount: 159900, currency: "USD" },
        max: { amount: 169900, currency: "USD" },
      });
      expect(p["source"]).toBe("herman-miller");
      expect(p["handle"]).toBe("aeron-chair");
    }
  });

  it("projects the featured variant: id, title, price, availability OBJECT, checkout_url, sku, options", () => {
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const v = out.products[0]!.variant as unknown as Record<string, unknown>;
      expect(v["id"]).toBe("gid://variant/a1");
      expect(v["title"]).toBe("Aeron Chair — Graphite, Size B");
      expect(v["price"]).toEqual({ amount: 159900, currency: "USD" });
      expect(v["checkout_url"]).toBe("https://buy.example.com/aeron-a1");
      expect(v["sku"]).toBe("AER-GR-B");
      // options tell the agent WHICH variant this is (e.g. "Graphite / B").
      expect(v["options"]).toEqual([
        { name: "Color", label: "Graphite" },
        { name: "Size", label: "B" },
      ]);
    }
  });

  it("passes `availability` through as the UCP OBJECT, never flattened to a bare boolean", () => {
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const avail = (out.products[0]!.variant as unknown as Record<string, unknown>)[
        "availability"
      ] as Record<string, unknown>;
      expect(typeof avail).toBe("object");
      expect(avail).not.toBe(true);
      expect(avail["available"]).toBe(true);
      expect(avail["status"]).toBe("in_stock");
    }
  });

  it("carries the product-level `source` per product (a sil enrichment field)", () => {
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A, PRODUCT_B] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const bySource = new Map(out.products.map((p) => [p.id, p.source]));
      expect(bySource.get("gid://product/a")).toBe("herman-miller");
      expect(bySource.get("gid://product/b")).toBe("uplift");
    }
  });
});

describe("classifyLookupResponse — the `inputs` correlation (lookup's defining feature)", () => {
  it("surfaces the featured variant's `inputs:[{id,match}]` so the agent maps id → result", () => {
    // UCP §Client Correlation: each variant carries `inputs` — which request id(s)
    // resolved to it and how. Dropping `inputs` makes a multi-id lookup
    // uncorrelatable; the tool MUST surface it.
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const inputs = (out.products[0]!.variant as unknown as Record<string, unknown>)[
        "inputs"
      ] as Array<Record<string, unknown>>;
      expect(Array.isArray(inputs)).toBe(true);
      expect(inputs).toEqual([{ id: "gid://product/a", match: "featured" }]);
    }
  });

  it("preserves the `match` distinction — `featured` (product id) vs `exact` (variant id)", () => {
    // PRODUCT_A's featured variant was resolved by a PRODUCT id → match "featured";
    // PRODUCT_B's by a VARIANT id → match "exact". The agent tells the user whether
    // they're looking at the exact thing they referenced or a featured stand-in.
    const out = classifyLookupResponse(200, envelope({ products: [PRODUCT_A, PRODUCT_B] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const byId = new Map(
        out.products.map((p) => [
          p.id,
          (p.variant as unknown as Record<string, unknown>)["inputs"] as Array<
            Record<string, unknown>
          >,
        ]),
      );
      expect(byId.get("gid://product/a")![0]!["match"]).toBe("featured");
      expect(byId.get("gid://product/b")![0]!["match"]).toBe("exact");
    }
  });

  it("surfaces MULTIPLE inputs on one variant (a product id AND a variant id resolving to it)", () => {
    // UCP: multiple request ids may resolve to the same variant — its `inputs`
    // carries one entry per resolved id. The tool must surface ALL of them, not
    // just the first, so the agent can mark both ids as resolved.
    const multiInputVariant = {
      ...VARIANT_A1,
      inputs: [
        { id: "gid://product/a", match: "featured" },
        { id: "gid://variant/a1", match: "exact" },
      ],
    };
    const productMulti = { ...PRODUCT_A, variants: [multiInputVariant] };
    const out = classifyLookupResponse(200, envelope({ products: [productMulti] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const inputs = (out.products[0]!.variant as unknown as Record<string, unknown>)[
        "inputs"
      ] as Array<Record<string, unknown>>;
      expect(inputs).toHaveLength(2);
      expect(inputs.map((i) => i["id"])).toEqual(["gid://product/a", "gid://variant/a1"]);
    }
  });
});
