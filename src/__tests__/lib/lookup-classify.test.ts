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
 *        200 { ucp, products:[…found…], messages:[{type:"info",code:"not_found",content:"<id>"}] }
 *                          → ok + found products + not_found:[<the unfound ids>]
 *        200 { ucp, products:[], messages:[…not_found for every id…] }
 *                          → ok + products:[] + not_found:[<all ids>]   (all-missed IS a success)
 *        200 { ucp, products:[…all resolved…] } (NO messages key)
 *                          → ok + NO not_found key                       (every id resolved)
 *      The `not_found` ids come from the top-level `messages` entries whose
 *      `code === "not_found"`; `content` is the id (sil-api emits exactly this,
 *      `messages` OMITTED on full success). A `not_found` is DATA on the ok result,
 *      NEVER an error and NEVER a recovery hint.
 *
 *   3. The anti-false-green body gate on 200 (mirroring `extractIdentity`'s
 *      `name`-gate / `extractSearchResult`'s array-gate — complete-work-is-stub-free):
 *        200 { ucp, products: [] }             → ok + empty list   (a VALID all-missed,
 *                                                 distinct from the no-array fault)
 *        200 with NO usable top-level `products` array (partial / garbage / `{stub:true}`)
 *                                              → retryable, NEVER ok (the false-green guard:
 *                                                a stub/malformed 200 must not read as ok)
 *      `ok` is gated on a real top-level `Array.isArray(products)` — the empty-array
 *      case is the all-missed success, the missing/non-array case is the fault.
 *      SUBTLE: distinguish by PRESENCE of a real products array, NEVER by array length.
 *
 *   4. The RICH projection + the `inputs` correlation (lookup's defining feature
 *      over search — the read-subset normalizer): read the FLAT body → products (NOT
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

import { classifyLookupResponse, type LookupOutcome } from "../../lib/sil-client.js";

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

/** Wrap a `CatalogLookupResult` in the FLAT UCP envelope sil-api actually emits —
 * `withUcpMeta(body) → { ucp, ...body }` (sil-services `.../sil-api/src/envelope.ts`):
 * the result body's fields (`products`, `messages`) sit at the TOP LEVEL beside `ucp`,
 * NOT under a `result` wrapper. The `result` arg here IS a CatalogLookupResult object
 * whose keys are spread onto the envelope. A non-object `result` is spread as nothing
 * (the flat body then carries only `ucp`) — exactly the malformed/garbage case the
 * anti-false-green gate must still reject. */
function envelope(result: unknown): unknown {
  return {
    ucp: { version: "0.1", status: "success" },
    ...(result !== null && typeof result === "object" ? (result as Record<string, unknown>) : {}),
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

  it("4xx other than 400/401/403 → retryable, never a silent ok (defensive)", () => {
    // 403 is NO LONGER in this loop — it has its own positive `forbidden` arm
    // below (this card); 404/409/429 stay `retryable`.
    for (const code of [404, 409, 429]) {
      expect(classifyLookupResponse(code, {}).kind).toBe("retryable");
      expect(classifyLookupResponse(code, {}).kind).not.toBe("ok");
    }
  });
});

/**
 * CARD `surface-user-not-provisioned-and-fix-recovery` — the RED unit floor for
 * the catalog 403 → `forbidden` arm, SYMMETRIC with `search-classify.test.ts`. The
 * two catalog tools share ONE agent-facing error vocabulary, so the 403 →
 * `forbidden{reason}` mapping MUST hold identically on `classifyLookupResponse` /
 * `LookupOutcome` — or `sil_product_get` stays false-transient while `sil_search`
 * is fixed (a fix that lands in only one classifier leaves the other lying).
 *
 * Same bug, same fix as search: `classifyLookupResponse` has no 403 arm (403 →
 * `retryable` today); the fix adds `{ kind: "forbidden"; reason: string }` to
 * `LookupOutcome` and the 403 arm reusing `extractForbiddenReason`. EXPECT RED
 * today (the classifier returns `retryable` on a 403).
 */
describe("classifyLookupResponse — a 403 is FORBIDDEN carrying its reason, NEVER retryable (AC3, AC4)", () => {
  it("403 user_not_provisioned → forbidden carrying reason:'user_not_provisioned' (NEVER retryable)", () => {
    const out = classifyLookupResponse(403, { error: "user_not_provisioned" });
    expect(out.kind).toBe("forbidden");
    expect(out.kind).not.toBe("retryable");
    if (out.kind === "forbidden") {
      expect(out.reason).toBe("user_not_provisioned");
    }
  });

  it("403 principal_mismatch → forbidden carrying reason:'principal_mismatch' (the reason passes through; NEVER retryable)", () => {
    const out = classifyLookupResponse(403, { error: "principal_mismatch" });
    expect(out.kind).toBe("forbidden");
    expect(out.kind).not.toBe("retryable");
    if (out.kind === "forbidden") {
      expect(out.reason).toBe("principal_mismatch");
    }
  });

  it("403 with an unknown / absent reason → forbidden with the default 'forbidden' marker, NEVER retryable", () => {
    for (const body of [{}, { error: "" }, { error: 42 }, null, "boom", []]) {
      const out = classifyLookupResponse(403, body);
      expect(out.kind).toBe("forbidden");
      expect(out.kind).not.toBe("retryable");
      if (out.kind === "forbidden") {
        expect(out.reason).toBe("forbidden");
        expect(out.reason).not.toBe("user_not_provisioned");
      }
    }
  });

  it("a 403 is DISTINCT from both unauthorized (401, refreshable) and retryable (5xx, transient)", () => {
    const forbidden403 = classifyLookupResponse(403, { error: "user_not_provisioned" }).kind;
    const unauthorized401 = classifyLookupResponse(401, {}).kind;
    const retryable5xx = classifyLookupResponse(500, {}).kind;
    expect(forbidden403).toBe("forbidden");
    expect(unauthorized401).toBe("unauthorized");
    expect(retryable5xx).toBe("retryable");
    expect(new Set([forbidden403, unauthorized401, retryable5xx]).size).toBe(3);
  });

  it("a 5xx is STILL retryable, never forbidden — the fix re-routes ONLY the 403 (AC11)", () => {
    for (const code of [500, 502, 503, 504]) {
      expect(classifyLookupResponse(code, { error: "source_unavailable" }).kind).toBe("retryable");
      expect(classifyLookupResponse(code, { error: "source_unavailable" }).kind).not.toBe(
        "forbidden",
      );
    }
  });
});

/**
 * CARD `name-the-source-in-catalog-error-surfacing` (epic
 * `catalog-source-error-taxonomy-2026-06`) — the RED unit floor, SYMMETRIC with
 * `search-classify.test.ts`. The two catalog tools share ONE agent-facing error
 * vocabulary, so the `retryable`-carries-source contract MUST hold identically on
 * `classifyLookupResponse` / `LookupOutcome` — or the agent learns two error
 * languages for the same failure.
 *
 * THE BUG (same as search): `classifyLookupResponse` collapses every 5xx /
 * non-{200,400,401} into a bodyless `{ kind: "retryable" }`, discarding the
 * `source` a `source_unavailable` 5xx body carries. The fix WIDENS the variant to
 * `{ kind: "retryable"; source?: string; detail?: string }` (NOT replaced — every
 * existing `.kind === "retryable"` assertion above stays valid) and populates it
 * ONLY when the body carries a real `source`. Same no-fabrication guard.
 *
 * SCOPE NOTE — pure over `(status, body)`; the network-throw "no source" half lives
 * at the integration tier (`catalog-lookup.integration.test.ts`), since
 * `lookupCatalog`'s `catch` returns a bare sourceless `{ kind: "retryable" }`.
 */
describe("classifyLookupResponse — a source-attributed 5xx SURFACES its source on the retryable outcome (outcome b)", () => {
  it("500 source_unavailable WITH a `source` → retryable carrying that source (and a detail)", () => {
    const out = classifyLookupResponse(500, {
      error: "source_unavailable",
      message: "Catalog source 'shopify' is temporarily unavailable.",
      source: "shopify",
    });
    expect(out.kind).toBe("retryable");
    if (out.kind === "retryable") {
      expect(out.source).toBe("shopify");
      expect(typeof out.detail).toBe("string");
      expect((out.detail as string).length).toBeGreaterThan(0);
    }
  });

  it("a 502/503/504 source_unavailable WITH a `source` ALSO surfaces it (not just 500)", () => {
    for (const code of [502, 503, 504]) {
      const out = classifyLookupResponse(code, {
        error: "source_unavailable",
        message: "Catalog source 'etsy' is temporarily unavailable.",
        source: "etsy",
      });
      expect(out.kind).toBe("retryable");
      if (out.kind === "retryable") {
        expect(out.source).toBe("etsy");
      }
    }
  });

  it("the upstream 429-as-source_unavailable (a rate-limited source, surfaced as 5xx) ALSO carries its source (outcome b/429)", () => {
    const out = classifyLookupResponse(503, {
      error: "source_unavailable",
      message: "Catalog source 'global-catalog' is rate-limited; retry shortly.",
      source: "global-catalog",
    });
    expect(out.kind).toBe("retryable");
    if (out.kind === "retryable") {
      expect(out.source).toBe("global-catalog");
    }
  });
});

describe("classifyLookupResponse — the no-fabrication guard: a sourceless retryable NEVER invents a source (outcome a)", () => {
  it("500 WITH NO `source` field → bare retryable, NO source (a sil-internal failure is outcome a, not b)", () => {
    const out = classifyLookupResponse(500, {
      error: "internal_error",
      message: "Something went wrong inside sil.",
    });
    expect(out.kind).toBe("retryable");
    if (out.kind === "retryable") {
      expect(out.source).toBeUndefined();
    }
  });

  it("500 with a garbage / non-object body → bare retryable, NO source", () => {
    for (const body of [null, "boom", 42, [], {}]) {
      const out = classifyLookupResponse(500, body);
      expect(out.kind).toBe("retryable");
      if (out.kind === "retryable") {
        expect(out.source).toBeUndefined();
      }
    }
  });

  it("500 whose `source` is present but NOT a non-empty string → NO source (never coerce a bad field)", () => {
    for (const source of [null, 123, "", {}, []]) {
      const out = classifyLookupResponse(500, {
        error: "source_unavailable",
        message: "A catalog source is unavailable.",
        source,
      });
      expect(out.kind).toBe("retryable");
      if (out.kind === "retryable") {
        expect(out.source).toBeUndefined();
      }
    }
  });

  it("an unmapped non-200 (e.g. 502 with an empty body) → bare retryable, NO source", () => {
    const out = classifyLookupResponse(502, {});
    expect(out.kind).toBe("retryable");
    if (out.kind === "retryable") {
      expect(out.source).toBeUndefined();
    }
  });

  it("NEVER scrapes a source out of the human `message` string — a source named only in prose stays unsurfaced", () => {
    const out = classifyLookupResponse(500, {
      error: "source_unavailable",
      message: "Catalog source 'shopify' is temporarily unavailable.",
    });
    expect(out.kind).toBe("retryable");
    if (out.kind === "retryable") {
      expect(out.source).toBeUndefined();
    }
  });
});

/**
 * CARD `classify-catalog-422-as-invalid-request` (epic
 * `catalog-source-error-taxonomy-2026-06`) — the RED unit floor for the catalog
 * 422 → `invalid_request` arm, SYMMETRIC with `search-classify.test.ts`. The two
 * catalog tools share ONE agent-facing error vocabulary, and sil-api emits 422
 * `source_rejected` on the SHARED source layer backing both `/catalog/search` and
 * `/catalog/lookup` — so a source-rejected LOOKUP mis-maps the same (b)≡(c) way.
 * Closing only the search seam would leave `sil_product_get` lying (a 422 reading
 * non-retryable on one catalog tool and retryable on its companion) — a half-done
 * taxonomy. The twin-seam verdict (CLOSE BOTH) is what makes this block mandatory.
 *
 * Same bug, same fix as search: `classifyLookupResponse` has no 422 arm (422 →
 * retryable today, source-named because the body carries a `source`); the fix
 * adds the identical `422 → invalid_request` arm reusing `extractApiError` — no new
 * `kind`, no type change (`LookupOutcome` already carries `{ kind:
 * "invalid_request"; error; message }`). EXPECT RED today (the classifier returns
 * `retryable` on a 422); the 5xx/4xx guards PASS today and must stay green.
 */
describe("classifyLookupResponse — a 422 source_rejected is INVALID_REQUEST carrying the cause, NEVER retryable (outcome c)", () => {
  it("422 source_rejected WITH { error, message, source } → invalid_request carrying error+message (NEVER retryable, NEVER source-named)", () => {
    // The headline contract for the lookup twin seam — identical shape to the search
    // path so the two tools present ONE vocabulary. RED today: 422 → retryable with
    // the source named. The cause is carried verbatim.
    const out = classifyLookupResponse(422, {
      error: "source_rejected",
      message: "Source 'etsy' rejected the request: identifier scheme not supported.",
      source: "etsy",
    });
    expect(out.kind).toBe("invalid_request");
    expect(out.kind).not.toBe("retryable");
    if (out.kind === "invalid_request") {
      expect(out.error).toBe("source_rejected");
      expect(out.message).toBe(
        "Source 'etsy' rejected the request: identifier scheme not supported.",
      );
    }
  });

  it("a 422 NEVER surfaces a `source` field — outcome c is non-retryable, NOT the source-named retryable (the (b)≡(c) collapse, inverted)", () => {
    // The exact collapse this card closes, on the lookup seam: the 422 body carries a
    // `source` (what mis-routes it to outcome b today), but the classified outcome
    // must be `invalid_request`, which has NO `source` key.
    const out = classifyLookupResponse(422, {
      error: "source_rejected",
      message: "Identifier scheme not supported.",
      source: "etsy",
    });
    expect(out.kind).toBe("invalid_request");
    expect(out).not.toHaveProperty("source");
    expect(out).not.toHaveProperty("detail");
  });

  it("422 with a garbage / empty body ({}, null, 'boom', []) → STILL invalid_request via extractApiError's defaults (a rejection that says nothing is still non-retryable)", () => {
    // The malformed-422 edge, symmetric with search: a rejection with no usable
    // { error, message } is STILL non-retryable, never routed back to retryable.
    // extractApiError fills its defaults. RED today: each returns a bare
    // { kind: "retryable" }.
    //
    // NOTE (architect Risk, accepted in-scope): extractApiError's DEFAULT message is
    // search-flavored ("…Provide a search query…") and rides this lookup path on a
    // degenerate body. That copy nuance is consciously accepted for this card — the
    // behavioral contract asserted here is only that the outcome is a well-formed
    // NON-retryable invalid_request with non-empty fields, NOT the exact default
    // wording. So this assertion does not pin the message text.
    for (const body of [{}, null, "boom", []] as const) {
      const out = classifyLookupResponse(422, body);
      expect(out.kind).toBe("invalid_request");
      expect(out.kind).not.toBe("retryable");
      if (out.kind === "invalid_request") {
        expect(typeof out.error).toBe("string");
        expect(out.error.length).toBeGreaterThan(0);
        expect(typeof out.message).toBe("string");
        expect(out.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("GUARD (anti-over-narrowing) — a 5xx source_unavailable that NAMES a source STILL returns retryable carrying that source (the fix narrows ONLY 422)", () => {
    // The non-vacuous reverse-collapse tripwire, symmetric with search: a genuine
    // source-down 5xx (outcome b) must remain { kind: "retryable", source, detail }.
    // A wrong-direction over-narrow trips this. PASSES today and after the fix.
    for (const code of [500, 502, 503, 504]) {
      const out = classifyLookupResponse(code, {
        error: "source_unavailable",
        message: "Catalog source 'etsy' is temporarily unavailable.",
        source: "etsy",
      });
      expect(out.kind).toBe("retryable");
      expect(out.kind).not.toBe("invalid_request");
      if (out.kind === "retryable") {
        expect(out.source).toBe("etsy");
      }
    }
  });

  it("GUARD — the unmapped 4xx defensive set [404, 409, 429] STILL routes to retryable, and NONE of them is invalid_request (422 is the ONLY 4xx narrowed)", () => {
    // The low-side companion tripwire: only 422 leaves the retryable path. 404/409/429
    // are not part of this card's contract and must stay `retryable`. PASSES today and
    // after the fix.
    for (const code of [404, 409, 429]) {
      const out = classifyLookupResponse(code, {});
      expect(out.kind).toBe("retryable");
      expect(out.kind).not.toBe("invalid_request");
    }
  });

  it("422 is DISTINCT from the source-named 5xx retryable (b) and the bare 5xx retryable (a) — three distinct landings, no collapse", () => {
    // The taxonomy assertion for the lookup final seam — outcomes (a)/(b)/(c) are
    // three distinct (kind, names-source?) signals; the (b)≡(c) collapse is gone.
    const c422 = classifyLookupResponse(422, { error: "source_rejected", message: "x", source: "etsy" });
    const bSource = classifyLookupResponse(500, { error: "source_unavailable", message: "x", source: "etsy" });
    const aBare = classifyLookupResponse(500, { error: "internal_error", message: "x" });
    expect(c422.kind).toBe("invalid_request");
    expect(bSource.kind).toBe("retryable");
    expect(aBare.kind).toBe("retryable");
    const fingerprint = (o: LookupOutcome): string =>
      `${o.kind}::${o.kind === "retryable" && o.source !== undefined ? "named" : "generic"}`;
    expect(new Set([fingerprint(c422), fingerprint(bSource), fingerprint(aBare)]).size).toBe(3);
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
      // description is the `{ plain }` lift — the same shape search surfaces (one
      // vocabulary across both tools): only the `plain` format, never `html`/`markdown`.
      expect(p["description"]).toEqual({ plain: "An ergonomic office chair." });
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

  it("is BOUNDED — the rich projection drops `tags`/raw-envelope/extra-variant keys; lookup is richer than search but is NOT the raw envelope (founder context-window guard, AC4)", () => {
    // AC4 (lookup half) — lookup is DELIBERATELY richer than search (it adds
    // description/price_range/categories?/handle? + variant sku?/options?/inputs? for a
    // purchase decision), but it is still a BOUNDED projection, never the raw
    // `SilCatalogProduct`/envelope. A product carrying fields OUTSIDE the bounded set
    // (`tags`, `vendor`, extra UCP metadata, non-featured variants) must have them
    // DROPPED — asserted by the exact key set, not just field presence.
    const WIDE_FEATURED = {
      id: "gid://variant/wide1",
      title: "Wide — Featured",
      sku: "WIDE-SKU-1",
      options: [{ name: "Color", label: "Graphite" }],
      price: { amount: 159900, currency: "USD" },
      availability: { available: true, status: "in_stock" },
      checkout_url: "https://buy.example.com/wide-1",
      inputs: [{ id: "gid://product/wide", match: "featured" }],
      // Variant fields OUTSIDE the bounded lookup-variant set — must be dropped.
      barcode: "0123456789",
      weight: { value: 20, unit: "kg" },
    };
    const WIDE_NON_FEATURED = {
      id: "gid://variant/wide2",
      title: "Wide — Non-featured",
      price: { amount: 169900, currency: "USD" },
      availability: { available: false, status: "out_of_stock" },
      checkout_url: "https://buy.example.com/wide-2",
      inputs: [{ id: "gid://variant/wide2", match: "exact" }],
    };
    const WIDE_PRODUCT = {
      id: "gid://product/wide",
      handle: "wide-product",
      title: "Wide Product",
      description: { plain: "A very detailed description." },
      categories: [{ name: "Office Furniture" }],
      price_range: {
        min: { amount: 159900, currency: "USD" },
        max: { amount: 169900, currency: "USD" },
      },
      source: "herman-miller",
      variants: [WIDE_FEATURED, WIDE_NON_FEATURED],
      // Product fields OUTSIDE the bounded lookup-product set — must be dropped.
      tags: ["ergonomic", "premium"],
      vendor: "Herman Miller",
      extra_ucp_metadata: { provenance: "sil-api", scored: true },
    };

    const out = classifyLookupResponse(200, envelope({ products: [WIDE_PRODUCT] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const p = out.products[0]! as unknown as Record<string, unknown>;
      // The projected product key set is a SUBSET of the bounded rich shape — and
      // carries NONE of the out-of-bounds keys.
      const allowedProductKeys = new Set([
        "id",
        "title",
        "description",
        "price_range",
        "source",
        "categories",
        "handle",
        "variant",
      ]);
      for (const key of Object.keys(p)) {
        expect(allowedProductKeys.has(key)).toBe(true);
      }
      for (const wide of ["tags", "vendor", "extra_ucp_metadata", "variants"]) {
        expect(p[wide]).toBeUndefined();
      }
      // The featured (first) variant — its key set is a SUBSET of the bounded
      // lookup-variant shape, with NONE of the out-of-bounds variant keys.
      const v = p["variant"] as Record<string, unknown>;
      expect(v["id"]).toBe("gid://variant/wide1"); // featured, never wide2
      const allowedVariantKeys = new Set([
        "id",
        "title",
        "price",
        "availability",
        "checkout_url",
        "sku",
        "options",
        "inputs",
      ]);
      for (const key of Object.keys(v)) {
        expect(allowedVariantKeys.has(key)).toBe(true);
      }
      for (const wide of ["barcode", "weight"]) {
        expect(v[wide]).toBeUndefined();
      }
      // No raw non-featured-variant material rode along.
      expect(JSON.stringify(p)).not.toContain("gid://variant/wide2");
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
