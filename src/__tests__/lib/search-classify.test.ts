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
 *        200 { ucp, products: [] }         → ok + empty list   (a VALID empty match,
 *                                            NOT an error — UCP "this is not an error")
 *        200 with NO usable top-level `products` array (partial / garbage / `{stub:true}`)
 *                                          → retryable, NEVER ok (the false-green guard:
 *                                            a stub/malformed 200 must not read as a
 *                                            clean empty match — see complete-work-is-stub-free)
 *      `ok` is gated on a real top-level `Array.isArray(products)` — the empty-array
 *      case is the success, the missing/non-array case is the fault.
 *
 *   3. The PROJECTION + cursor hoist (the read-subset normalizer the sibling
 *      `sil_product_get` reuses): read the FLAT body → server-order products → pick
 *      the FIRST (featured) variant per product → project to
 *      `{ id, title, price, availability, checkout_url }` + product-level `source` →
 *      hoist `pagination.cursor` to a top-level `cursor` (present iff
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
 *   `res.ok`. It reads `products` off the FLAT sil-api envelope (`{ ucp, products,
 *   pagination? }` — top level, no `result` wrapper). The exact field/variant
 *   projection is the dev's to shape, but the FIELD NAMES below and the cursor-hoist
 *   + empty-vs-error split ARE the immutable spec (assert the projected
 *   `variant.checkout_url`, the passthrough `availability` object, and the hoisted
 *   `cursor`).
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

/** Wrap a `CatalogSearchResult` in the FLAT UCP envelope sil-api actually emits —
 * `withUcpMeta(body) → { ucp, ...body }` (sil-services `.../sil-api/src/envelope.ts`):
 * the result body's fields (`products`, `pagination`) sit at the TOP LEVEL beside
 * `ucp`, NOT under a `result` wrapper. The `result` arg here IS a CatalogSearchResult
 * object whose keys are spread onto the envelope. A non-object `result` is spread as
 * nothing (the flat body then carries only `ucp`) — exactly the malformed/garbage
 * case the anti-false-green gate must still reject. */
function envelope(result: unknown): unknown {
  return {
    ucp: { version: "0.1", status: "success" },
    ...(result !== null && typeof result === "object" ? (result as Record<string, unknown>) : {}),
  };
}

/** A stub-shaped 200 (`{ stub, tool, echo }`). Such a body must NEVER read as a
 * clean empty match (complete-work-is-stub-free). */
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

  it("4xx other than 400/401/403 → retryable, never a silent ok (defensive)", () => {
    // Unmapped 4xx (e.g. 404/409/429) is not a clean empty match. It must not
    // read as ok; a non-ok terminal/transient is correct (retryable is the safe
    // non-ok landing — re-running can't make a 200-empty out of a 4xx). 403 is
    // NO LONGER in this loop — it has its own positive `forbidden` arm below
    // (the whole point of this card); 404/409/429 stay `retryable`.
    for (const code of [404, 409, 429]) {
      expect(classifySearchResponse(code, {}).kind).toBe("retryable");
      expect(classifySearchResponse(code, {}).kind).not.toBe("ok");
    }
  });
});

/**
 * CARD `surface-user-not-provisioned-and-fix-recovery` (epic
 * `…`) — the RED unit floor for the catalog 403 → `forbidden` arm.
 *
 * THE BUG this pins: `classifySearchResponse` has NO 403 arm — it goes straight
 * from the 401 check to `if (status !== 200) return retryable`, so a sil-api 403
 * `user_not_provisioned` lands in `retryable` (a false-transient: the agent is
 * told "temporarily unavailable, try again" forever, and retrying a
 * valid-but-unprovisioned token can NEVER succeed). `classifyIdentityResponse`
 * ALREADY classifies 403 → `forbidden` (sil-client.ts:501) — that one line is the
 * entire reason `sil_whoami` is legible and the catalog tools are not.
 *
 * The fix ADDS a `{ kind: "forbidden"; reason: string }` variant to `SearchOutcome`
 * (byte-identical to `IdentityOutcome`'s, sil-client.ts:204) and the 403 arm to the
 * classifier — `if (status === 403) return { kind: "forbidden", reason:
 * extractForbiddenReason(body) }` — reusing the SAME `extractForbiddenReason`
 * helper. This block is the immutable spec for that arm: the `reason` passthrough
 * (`user_not_provisioned` / `principal_mismatch`) and the unknown-body default
 * (`"forbidden"`), classifier-level (AC3, AC4). The wired forbidden envelope +
 * token-clear live at the integration tier (catalog-search.integration.test.ts).
 *
 * EXPECT RED today: every assertion below fails because the classifier returns
 * `retryable` on a 403 (no forbidden arm exists yet).
 */
describe("classifySearchResponse — a 403 is FORBIDDEN carrying its reason, NEVER retryable (AC3, AC4)", () => {
  it("403 user_not_provisioned → forbidden carrying reason:'user_not_provisioned' (NEVER retryable)", () => {
    // AC3: the catalog classifier reaches parity with classifyIdentityResponse —
    // a 403 is `forbidden`, not the false-transient `retryable`. The provisioning
    // reason rides through so the tool can drive the token-clear (Bug 2's fix).
    const out = classifySearchResponse(403, { error: "user_not_provisioned" });
    expect(out.kind).toBe("forbidden");
    expect(out.kind).not.toBe("retryable");
    if (out.kind === "forbidden") {
      expect(out.reason).toBe("user_not_provisioned");
    }
  });

  it("403 principal_mismatch → forbidden carrying reason:'principal_mismatch' (the reason passes through; NEVER retryable)", () => {
    // AC4: every 403 is legible, not just the provisioning one. principal_mismatch
    // passes through as the reason — the tool uses it to decide NOT to clear
    // (AC10: principal_mismatch is recoverable, must survive). Still `forbidden`.
    const out = classifySearchResponse(403, { error: "principal_mismatch" });
    expect(out.kind).toBe("forbidden");
    expect(out.kind).not.toBe("retryable");
    if (out.kind === "forbidden") {
      expect(out.reason).toBe("principal_mismatch");
    }
  });

  it("403 with an unknown / absent reason → forbidden with the default 'forbidden' marker (extractForbiddenReason's default), NEVER retryable", () => {
    // AC4: an unexpected 403 body is STILL forbidden (legible), defaulting to the
    // generic `"forbidden"` marker — which (correctly) does NOT equal
    // "user_not_provisioned", so the tool will NOT clear on it (AC10's "unknown
    // reason does not clear" boundary, proven at the classifier seam).
    for (const body of [{}, { error: "" }, { error: 42 }, null, "boom", []]) {
      const out = classifySearchResponse(403, body);
      expect(out.kind).toBe("forbidden");
      expect(out.kind).not.toBe("retryable");
      if (out.kind === "forbidden") {
        expect(out.reason).toBe("forbidden");
        // Never the provisioning reason on a garbage body — the exact-equality
        // gate downstream therefore cannot mis-fire a destructive clear.
        expect(out.reason).not.toBe("user_not_provisioned");
      }
    }
  });

  it("a 403 is DISTINCT from both unauthorized (401, refreshable) and retryable (5xx, transient) — five kinds now", () => {
    // The taxonomy assertion extended for the forbidden arm: 401 (refreshable),
    // 403 (forbidden, terminal-but-recoverable), and 5xx (transient) are three
    // distinct landings. A 403 collapsing into either neighbor is the bug.
    const forbidden403 = classifySearchResponse(403, { error: "user_not_provisioned" }).kind;
    const unauthorized401 = classifySearchResponse(401, {}).kind;
    const retryable5xx = classifySearchResponse(500, {}).kind;
    expect(forbidden403).toBe("forbidden");
    expect(unauthorized401).toBe("unauthorized");
    expect(retryable5xx).toBe("retryable");
    expect(new Set([forbidden403, unauthorized401, retryable5xx]).size).toBe(3);
  });

  it("a 5xx is STILL retryable, never forbidden — the fix re-routes ONLY the 403 (AC11)", () => {
    // AC11 (classifier half): the 403 arm must NOT bleed into the transient path.
    // A genuine 5xx stays `retryable`; a 403 is `forbidden`; the two never cross.
    for (const code of [500, 502, 503, 504]) {
      expect(classifySearchResponse(code, { error: "source_unavailable" }).kind).toBe("retryable");
      expect(classifySearchResponse(code, { error: "source_unavailable" }).kind).not.toBe(
        "forbidden",
      );
    }
  });
});

/**
 * CARD `name-the-source-in-catalog-error-surfacing` (epic
 * `catalog-source-error-taxonomy-2026-06`) — the RED unit floor.
 *
 * THE BUG this pins: `classifySearchResponse` collapses every 5xx / non-{200,400,401}
 * into a BODYLESS `{ kind: "retryable" }`, discarding the `{ error, message, source }`
 * a `source_unavailable` 5xx body carries. So `transient()` downstream
 * (catalog.ts:725) can never name the failed source — three causally-distinct
 * failures read as one generic "sil is temporarily unavailable" envelope.
 *
 * The fix WIDENS the `retryable` variant (it is NOT replaced — every existing
 * `.kind === "retryable"` assertion above stays valid) to:
 *     { kind: "retryable"; source?: string; detail?: string }
 * and populates `source`/`detail` in the classifier ONLY when the 5xx body carries
 * a real `source` field. This block is the immutable spec for that shape and for
 * the no-fabrication guard (architect Risk "regenerating the masking in reverse").
 *
 * SCOPE NOTE — this classifier is pure over `(status, body)`; it NEVER sees a raw
 * network throw (that is `searchCatalog`'s `catch`, which returns a bare
 * `{ kind: "retryable" }` literal — structurally sourceless). So the "network throw
 * → no source" half of the card's no-fabrication guard is asserted at the
 * integration tier (the network-throw case in catalog-search.integration.test.ts);
 * here we pin the bodyless / garbage / no-`source` 5xx cases the classifier owns.
 */
describe("classifySearchResponse — a source-attributed 5xx SURFACES its source on the retryable outcome (outcome b)", () => {
  it("500 source_unavailable WITH a `source` → retryable carrying that source (and a detail)", () => {
    // The structured contract outcome (b) consumes: sil-api's source-down 5xx body
    // (`source_unavailable`) carries which catalog/product source failed. The
    // classifier MUST surface it so `transient()` can NAME the source instead of
    // emitting the generic "sil is down". RED today: the classifier returns a bare
    // `{ kind: "retryable" }` and throws the `source` away.
    const out = classifySearchResponse(500, {
      error: "source_unavailable",
      message: "Catalog source 'shopify' is temporarily unavailable.",
      source: "shopify",
    });
    expect(out.kind).toBe("retryable");
    if (out.kind === "retryable") {
      expect(out.source).toBe("shopify");
      // `detail` carries the upstream cause (error/message) so the consumer has
      // something concrete to relay; its exact composition is the dev's to shape,
      // but it MUST be a non-empty string that surfaces the failure.
      expect(typeof out.detail).toBe("string");
      expect((out.detail as string).length).toBeGreaterThan(0);
    }
  });

  it("a 502/503/504 source_unavailable WITH a `source` ALSO surfaces it (not just 500)", () => {
    // sil-api may surface an upstream outage as any 5xx; the source-carry must not
    // be hardcoded to 500. Each of these, when the body names a source, surfaces it.
    for (const code of [502, 503, 504]) {
      const out = classifySearchResponse(code, {
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
    // The sibling classifies an upstream HTTP 429 as `source_unavailable` (a 5xx) so
    // a throttle stays RETRYABLE (a 429 reaching the plugin AS a 4xx would route to
    // the non-retryable invalid_request arm — wrong for a transient throttle). When
    // it carries a source, the classifier surfaces it exactly like any source outage.
    const out = classifySearchResponse(503, {
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

describe("classifySearchResponse — the no-fabrication guard: a sourceless retryable NEVER invents a source (outcome a)", () => {
  it("500 WITH NO `source` field → bare retryable, NO source (a sil-internal failure is outcome a, not b)", () => {
    // A sil-internal 5xx (the source-failure body is NOT present) must stay the
    // GENERIC retryable — attaching a source here would mis-name a source on a
    // sil-down event, re-introducing wrong attribution in the OPPOSITE direction
    // (architect Risk). The populate gates on the PRESENCE of a real `source`.
    const out = classifySearchResponse(500, {
      error: "internal_error",
      message: "Something went wrong inside sil.",
    });
    expect(out.kind).toBe("retryable");
    if (out.kind === "retryable") {
      expect(out.source).toBeUndefined();
    }
  });

  it("500 with a garbage / non-object body → bare retryable, NO source", () => {
    // A malformed 5xx body (no parseable `source`) can never name a source. Each of
    // these falls back to outcome a — generic retryable, source undefined.
    for (const body of [null, "boom", 42, [], {}]) {
      const out = classifySearchResponse(500, body);
      expect(out.kind).toBe("retryable");
      if (out.kind === "retryable") {
        expect(out.source).toBeUndefined();
      }
    }
  });

  it("500 whose `source` is present but NOT a non-empty string → NO source (never coerce a bad field)", () => {
    // The source field must be a real, non-empty string. A null/number/empty/object
    // `source` is not a usable identifier — the classifier must NOT surface it (and
    // must not stringify a non-string). Degrade to outcome a, not a fabricated name.
    for (const source of [null, 123, "", {}, []]) {
      const out = classifySearchResponse(500, {
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
    // The generic transport-failure landing: a 5xx with no body at all is outcome a.
    const out = classifySearchResponse(502, {});
    expect(out.kind).toBe("retryable");
    if (out.kind === "retryable") {
      expect(out.source).toBeUndefined();
    }
  });

  it("NEVER scrapes a source out of the human `message` string — a source named only in prose stays unsurfaced", () => {
    // The architect ruled out string-scraping the message ("catalog source 'X' is
    // unavailable"): it is brittle and couples the plugin to sil-api's wording. The
    // source MUST arrive as the structured `source` field. A body that names a
    // source ONLY inside `message` (no `source` key) is outcome a — no source.
    const out = classifySearchResponse(500, {
      error: "source_unavailable",
      message: "Catalog source 'shopify' is temporarily unavailable.",
    });
    expect(out.kind).toBe("retryable");
    if (out.kind === "retryable") {
      expect(out.source).toBeUndefined();
    }
  });
});

describe("classifySearchResponse — empty match is SUCCESS, not error", () => {
  it("200 { ucp, products: [] } → ok with an EMPTY products list and NO cursor", () => {
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

  it("DROPS the wide SilCatalogProduct fields — the lean projection carries NO categories/tags/price_range/extra-variant/raw-envelope keys (founder context-window guard, AC4)", () => {
    // AC4 — the context-window guard, asserted by ABSENCE (not just presence). A
    // full `SilCatalogProduct` carries `description`, `price_range`, `categories`,
    // `tags`, extra UCP metadata, and multiple non-featured variants. The unwrap fix
    // must NOT widen the agent-facing payload by one field: the projected search
    // product is EXACTLY `{ id, title, source, variant: { id, title, price,
    // availability, checkout_url } }`. A regression that spreads the raw envelope or
    // returns the whole product would flood the agent's context window — this test
    // is the wall against it.
    const WIDE_VARIANT = {
      id: "gid://variant/wide1",
      title: "Wide — Featured",
      // A pile of extra variant fields lookup surfaces but SEARCH must drop.
      sku: "WIDE-SKU-1",
      options: [{ name: "Color", label: "Graphite" }],
      inputs: [{ id: "gid://product/wide", match: "featured" }],
      barcode: "0123456789",
      price: { amount: 159900, currency: "USD" },
      availability: { available: true, status: "in_stock" },
      checkout_url: "https://buy.example.com/wide-1",
    };
    const WIDE_VARIANT_2 = {
      id: "gid://variant/wide2",
      title: "Wide — Non-featured",
      price: { amount: 169900, currency: "USD" },
      availability: { available: false, status: "out_of_stock" },
      checkout_url: "https://buy.example.com/wide-2",
    };
    const WIDE_PRODUCT = {
      id: "gid://product/wide",
      title: "Wide Product",
      source: "herman-miller",
      // The wide fields the agent does NOT need to reason/pick/checkout.
      description: { plain: "A very detailed description.", html: "<p>…</p>" },
      price_range: {
        min: { amount: 159900, currency: "USD" },
        max: { amount: 169900, currency: "USD" },
      },
      categories: [{ name: "Office Furniture" }, { name: "Chairs" }],
      tags: ["ergonomic", "premium"],
      handle: "wide-product",
      vendor: "Herman Miller",
      extra_ucp_metadata: { provenance: "sil-api", scored: true },
      variants: [WIDE_VARIANT, WIDE_VARIANT_2],
    };

    const out = classifySearchResponse(200, envelope({ products: [WIDE_PRODUCT] }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const p = out.products[0]! as unknown as Record<string, unknown>;
      // EXACT lean product shape — these three keys and no others.
      expect(Object.keys(p).sort()).toEqual(["id", "source", "title", "variant"]);
      // The wide product fields are GONE (not merely undefined-by-coincidence).
      for (const wide of [
        "description",
        "price_range",
        "categories",
        "tags",
        "handle",
        "vendor",
        "extra_ucp_metadata",
        "variants",
      ]) {
        expect(p[wide]).toBeUndefined();
      }
      // EXACT lean variant shape — the FEATURED variant, five keys and no others.
      const v = p["variant"] as Record<string, unknown>;
      expect(v["id"]).toBe("gid://variant/wide1"); // featured (first), never wide2
      expect(Object.keys(v).sort()).toEqual([
        "availability",
        "checkout_url",
        "id",
        "price",
        "title",
      ]);
      // The lookup-only / raw variant fields must NOT leak through search.
      for (const wide of ["sku", "options", "inputs", "barcode"]) {
        expect(v[wide]).toBeUndefined();
      }
      // And no raw second-variant material rode along.
      expect(JSON.stringify(p)).not.toContain("gid://variant/wide2");
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
