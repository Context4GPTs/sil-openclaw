/**
 * UNIT — sil-api catalog SPECS response classifier + the pure specs-resolution
 * gate (tier: unit, no network).
 *
 * CARD `sds-specs-client-tool` (epic `spec-driven-shopping-redesign`, Phase 3 —
 * the plugin side). The pure, highest-risk core of `sil_specs`, pinned in isolation
 * exactly like `classifySearchResponse` / `classifyIdentityResponse`. `sil_specs`
 * is a STRUCTURAL CLONE of `sil_search` — same origin (sil-api, bare path), same
 * bearer + 401 refresh-and-retry-once, same outcome taxonomy — BUT over a new wire
 * shape and with two DELIBERATE deletions from search's classifier that this file
 * pins as hard adversarial guards:
 *
 *   1. NO 422 arm. The specs registry is sil's OWN Postgres (specs.ts:15-17), not an
 *      external catalog source, so there is no `source_rejected` 422 to special-case.
 *      A 422 MUST fall through to `retryable` — the OPPOSITE of `classifySearchResponse`,
 *      where 422 → invalid_request. Copying search's 422 arm here is the taxonomy lie
 *      in reverse (telling the agent "give up / fix the request" on a transient blip).
 *   2. NO `source` attribution on `retryable`. The registry has no external source, so
 *      `SpecsOutcome`'s retryable is ALWAYS bare `{ kind: "retryable" }` — even when a
 *      5xx body carries a `source` field. Surfacing a source on a specs 5xx is wrong
 *      attribution (search's `retryableFromBody` source arm is dropped for specs).
 *
 * The wire contract, verified against the LIVE handler
 * (`../../sil-services/services/sil-api/src/handlers/specs.ts`) + `@sil/schemas`
 * `packages/schemas/src/specs.ts` (authoritative over any design doc — the doc's
 * `200 { ucp, resolved }` is STALE; the live response is the BARE `{ resolved }`):
 *   - Request  `{ query: string, specs: SpecDefinition[] }`.
 *   - Response 200 — the BARE `{ resolved: SpecResolution[] }`, `resolved` TOP-LEVEL,
 *     NO `ucp` meta, NO `result` wrapper. Read `resolved` straight off the body.
 *   - SpecResolution = ...SpecDefinition (flat canonical def) + submitted:{namespace,key}
 *     + canonical:{namespace,key} + status:"matched"|"created" + is_filterable + is_comparable.
 *   - Error arms: 400 (TypeBox boundary), 401, 403, 5xx/DB fault. NO 422, NO source.
 *
 * The anti-false-green gate is `Array.isArray(resolved)` — AND, STRICTER than search:
 * because a well-formed request (specs `minItems:1`) owes a 1:1 resolution, an EMPTY
 * `resolved: []` cannot occur → an empty array is itself a malformed 200 → `retryable`
 * (there is NO valid empty-match success here, UNLIKE `sil_search` where `products:[]`
 * is a genuine ok). And per the reject-WHOLE decision (card handoff, confirmed): a
 * structurally-present but MALFORMED entry (no usable `canonical` ref / bad `status`)
 * falls the WHOLE 200 to `retryable` — never drop-and-continue (the method cannot adopt
 * a canonical name it never got back; a half-canonical vocabulary forks silently).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts` — model on `SearchOutcome`, dropping the 422 arm + source:
 *   classifySpecsResponse(status: number, body: unknown): SpecsOutcome
 *   where SpecsOutcome is a discriminated union on `kind`:
 *     | { kind: "ok"; resolved: SpecResolution[] }
 *     | { kind: "unauthorized" }
 *     | { kind: "forbidden"; reason: string }
 *     | { kind: "invalid_request"; error: string; message: string }
 *     | { kind: "retryable" }                 // BARE — no source, no detail
 *   The classifier branches on `status` (and, for 200, the body shape) — NEVER on
 *   `res.ok`. `extractSpecsResult(body)` reads `resolved` off the FLAT top-level body
 *   and returns null (→ retryable) on any non-usable shape. The `resolved` array is
 *   surfaced FAITHFULLY (the client trusts the backend's dedupe authority — it does
 *   not second-guess a `matched`).
 *
 * EXPECT RED today: `classifySpecsResponse` / `extractSpecsResult` do not exist yet,
 * so every call throws "is not a function".
 */

import { describe, it, expect } from "vitest";

import { classifySpecsResponse } from "../../lib/sil-client.js";

/** A coined spec that dedupes to an EXISTING canonical name — `submitted` (the
 * method's private synonym) DIFFERS from `canonical` (the adopted name). This is the
 * anti-fragmentation case: the method drops "waterproofing" and adopts the canonical
 * "waterproof_rating". The flat def fields ARE the canonical definition. */
const MATCHED = {
  namespace: "product",
  key: "waterproof_rating",
  display_name: "Waterproof Rating",
  data_type: "number",
  unit: "mm",
  is_filterable: true,
  is_comparable: true,
  submitted: { namespace: "product", key: "waterproofing" },
  canonical: { namespace: "product", key: "waterproof_rating" },
  status: "matched",
};

/** A NOVEL coined spec registered as canonical — `canonical === submitted` (you were
 * first, your coined name IS canonical going forward). */
const CREATED = {
  namespace: "seller",
  key: "handmade",
  display_name: "Handmade",
  data_type: "boolean",
  is_filterable: true,
  is_comparable: false,
  submitted: { namespace: "seller", key: "handmade" },
  canonical: { namespace: "seller", key: "handmade" },
  status: "created",
};

/** A stub-shaped 200 (`{ stub, tool, echo }`). Such a body must NEVER read as a clean
 * resolution (complete-work-is-stub-free). */
const STUB_BODY = { stub: true, tool: "sil_specs", echo: { query: "hiking gloves" } };

describe("classifySpecsResponse — the status taxonomy is a STRICT SUBSET of search's (no 422, no source)", () => {
  it("200 with a populated resolved → ok (carries the resolutions)", () => {
    const out = classifySpecsResponse(200, { resolved: [MATCHED, CREATED] });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.resolved).toHaveLength(2);
    }
  });

  it("400 → invalid_request, surfacing sil-api's { error, message } (the TypeBox boundary reject)", () => {
    const out = classifySpecsResponse(400, {
      error: "invalid_request",
      message: "specs must contain at least one definition.",
    });
    expect(out.kind).toBe("invalid_request");
    if (out.kind === "invalid_request") {
      expect(out.error).toBe("invalid_request");
      expect(out.message).toBe("specs must contain at least one definition.");
    }
  });

  it("401 → unauthorized (the refresh trigger, NOT terminal for this tool)", () => {
    const out = classifySpecsResponse(401, { error: "unauthorized" });
    expect(out.kind).toBe("unauthorized");
  });

  it("403 → forbidden carrying its reason (parity with search/identity)", () => {
    const out = classifySpecsResponse(403, { error: "user_not_provisioned" });
    expect(out.kind).toBe("forbidden");
    if (out.kind === "forbidden") {
      expect(out.reason).toBe("user_not_provisioned");
    }
  });

  it("5xx (registry / DB fault) → retryable (transient try-again)", () => {
    const out = classifySpecsResponse(500, { error: "internal_error", message: "DB unavailable." });
    expect(out.kind).toBe("retryable");
  });

  it("keeps the five outcome kinds DISTINCT (ok / invalid_request / unauthorized / forbidden / retryable)", () => {
    const kinds = new Set([
      classifySpecsResponse(200, { resolved: [MATCHED] }).kind,
      classifySpecsResponse(400, { error: "invalid_request" }).kind,
      classifySpecsResponse(401, {}).kind,
      classifySpecsResponse(403, { error: "user_not_provisioned" }).kind,
      classifySpecsResponse(500, {}).kind,
    ]);
    expect(kinds.size).toBe(5);
  });

  it("does NOT flatten 400 / 403 / 5xx into the ok path", () => {
    expect(classifySpecsResponse(400, { error: "invalid_request" }).kind).not.toBe("ok");
    expect(classifySpecsResponse(403, { error: "user_not_provisioned" }).kind).not.toBe("ok");
    expect(classifySpecsResponse(500, {}).kind).not.toBe("ok");
  });
});

describe("classifySpecsResponse — a 403 is FORBIDDEN carrying its reason, NEVER retryable (parity with search's forbidden arm)", () => {
  it("403 principal_mismatch → forbidden carrying reason:'principal_mismatch' (passes through; NEVER retryable)", () => {
    const out = classifySpecsResponse(403, { error: "principal_mismatch" });
    expect(out.kind).toBe("forbidden");
    expect(out.kind).not.toBe("retryable");
    if (out.kind === "forbidden") {
      expect(out.reason).toBe("principal_mismatch");
    }
  });

  it("403 with an unknown / absent reason → forbidden with the default 'forbidden' marker, NEVER retryable", () => {
    for (const body of [{}, { error: "" }, { error: 42 }, null, "boom", []]) {
      const out = classifySpecsResponse(403, body);
      expect(out.kind).toBe("forbidden");
      expect(out.kind).not.toBe("retryable");
      if (out.kind === "forbidden") {
        expect(out.reason).toBe("forbidden");
        // Never the provisioning reason on a garbage body — the exact-equality clear
        // gate downstream therefore cannot mis-fire a destructive token wipe.
        expect(out.reason).not.toBe("user_not_provisioned");
      }
    }
  });

  it("a 403 is DISTINCT from unauthorized (401, refreshable) and retryable (5xx, transient) — three landings", () => {
    const forbidden403 = classifySpecsResponse(403, { error: "user_not_provisioned" }).kind;
    const unauthorized401 = classifySpecsResponse(401, {}).kind;
    const retryable5xx = classifySpecsResponse(500, {}).kind;
    expect(forbidden403).toBe("forbidden");
    expect(unauthorized401).toBe("unauthorized");
    expect(retryable5xx).toBe("retryable");
    expect(new Set([forbidden403, unauthorized401, retryable5xx]).size).toBe(3);
  });
});

describe("classifySpecsResponse — NO 422 arm (specs registry is sil's OWN Postgres, not an external source)", () => {
  it("422 → retryable, NEVER invalid_request (the OPPOSITE of classifySearchResponse — copying search's 422 arm is the bug)", () => {
    // The load-bearing DELETE-FIRST guard: search classifies 422 source_rejected →
    // invalid_request because an external catalog source refused the request. The
    // specs registry has NO external source and emits no 422 SourceError — so a 422
    // reaching this classifier is an UNMAPPED non-200 that must stay `retryable`
    // (fix-nothing, retry). A dev who copy-pastes search's 422 → invalid_request arm
    // trips this: it turns a transient blip into a false "give up / fix the request".
    const out = classifySpecsResponse(422, {
      error: "source_rejected",
      message: "should not be treated as a specs invalid_request",
      source: "shopify",
    });
    expect(out.kind).toBe("retryable");
    expect(out.kind).not.toBe("invalid_request");
  });

  it("a 422 NEVER surfaces error/message as invalid_request — it is a bare retryable (no source arm either)", () => {
    const out = classifySpecsResponse(422, { error: "source_rejected", message: "x", source: "etsy" });
    expect(out.kind).toBe("retryable");
    expect(out).not.toHaveProperty("error");
    expect(out).not.toHaveProperty("message");
    expect(out).not.toHaveProperty("source");
  });
});

describe("classifySpecsResponse — retryable is ALWAYS BARE (no source attribution — the registry has no external source)", () => {
  it("a 5xx that CARRIES a `source` field STILL yields a bare retryable — NO source surfaced (drop search's source arm)", () => {
    // search's `retryableFromBody` attaches `source`/`detail` when a 5xx body names a
    // catalog source (outcome b). For specs there IS no external source: the registry
    // is sil's own Postgres. A `source` on a specs 5xx is spurious and MUST NOT be
    // surfaced — a fabricated source on a sil-internal fault is wrong attribution.
    const out = classifySpecsResponse(500, {
      error: "source_unavailable",
      message: "Catalog source 'shopify' is temporarily unavailable.",
      source: "shopify",
    });
    expect(out.kind).toBe("retryable");
    expect(out).not.toHaveProperty("source");
    expect(out).not.toHaveProperty("detail");
  });

  it("502/503/504 → bare retryable, no source", () => {
    for (const code of [502, 503, 504]) {
      const out = classifySpecsResponse(code, { error: "source_unavailable", source: "etsy" });
      expect(out.kind).toBe("retryable");
      expect(out).not.toHaveProperty("source");
    }
  });

  it("an unmapped 4xx other than 400/401/403/422 (404/409/429) → retryable, never a silent ok", () => {
    for (const code of [404, 409, 429]) {
      expect(classifySpecsResponse(code, {}).kind).toBe("retryable");
      expect(classifySpecsResponse(code, {}).kind).not.toBe("ok");
    }
  });
});

describe("classifySpecsResponse — the anti-false-green body gate on 200 (STRICTER than search: no empty-match success)", () => {
  it("200 carrying the STUB body ({stub,tool,echo}) is NOT ok — it is retryable", () => {
    const out = classifySpecsResponse(200, STUB_BODY);
    expect(out.kind).not.toBe("ok");
    expect(out.kind).toBe("retryable");
  });

  it("200 whose body has NO `resolved` key → retryable, NEVER ok", () => {
    const out = classifySpecsResponse(200, { note: "no resolved here" });
    expect(out.kind).toBe("retryable");
    expect(out.kind).not.toBe("ok");
  });

  it("200 whose `resolved` is a NON-ARRAY (null / object / string) → retryable, never ok", () => {
    for (const bad of [null, {}, "nope", 7]) {
      const out = classifySpecsResponse(200, { resolved: bad });
      expect(out.kind).not.toBe("ok");
      expect(out.kind).toBe("retryable");
    }
  });

  it("200 with an EMPTY `resolved: []` → retryable, NEVER ok (STRICTER than search — a 1:1 request owes ≥1 resolution)", () => {
    // THE deliberate divergence from `sil_search`, where `products: []` is a genuine
    // empty-match SUCCESS. Here the request carries `specs` (minItems:1) and the server
    // owes one resolution per submitted spec — so an empty `resolved` cannot happen for
    // a well-formed request. An empty array is a malformed 200, not a valid empty match
    // → `retryable`. A dev who reuses search's `Array.isArray` gate verbatim (which
    // accepts `[]`) trips this.
    const out = classifySpecsResponse(200, { resolved: [] });
    expect(out.kind).not.toBe("ok");
    expect(out.kind).toBe("retryable");
  });

  it("200 with an empty / null / non-object body → retryable, never ok (defensive)", () => {
    expect(classifySpecsResponse(200, {}).kind).not.toBe("ok");
    expect(classifySpecsResponse(200, null).kind).not.toBe("ok");
    expect(classifySpecsResponse(200, "not-an-object").kind).not.toBe("ok");
  });

  it("does NOT branch on res.ok — a 200 stub and a 200 real resolution differ only by body", () => {
    expect(classifySpecsResponse(200, { resolved: [MATCHED] }).kind).toBe("ok");
    expect(classifySpecsResponse(200, STUB_BODY).kind).not.toBe("ok");
  });
});

describe("classifySpecsResponse — reject-WHOLE on a malformed entry (no partial adopt; the method needs a usable canonical for EVERY spec)", () => {
  it("a resolved array with one GOOD entry and one MALFORMED entry (no canonical) → retryable, NOT a partial ok", () => {
    // The reject-WHOLE decision (card handoff, confirmed with product-owner): unlike
    // search dropping ONE unusable product from a best-effort list, specs owes a 1:1
    // resolution — a single unusable entry (no `canonical` ref the method can adopt)
    // falls the WHOLE 200 to `retryable`. Dropping it would hand back a HALF-canonical
    // vocabulary that forks silently (the anti-convergence failure this card exists to
    // prevent). NEVER a partial `ok` carrying only the good entry.
    const out = classifySpecsResponse(200, {
      resolved: [MATCHED, { namespace: "x", key: "y", status: "created" /* no canonical ref */ }],
    });
    expect(out.kind).not.toBe("ok");
    expect(out.kind).toBe("retryable");
  });

  it("a resolved entry with a bad `status` (not matched/created) → whole 200 falls to retryable", () => {
    const out = classifySpecsResponse(200, {
      resolved: [{ ...CREATED, status: "maybe" }],
    });
    expect(out.kind).not.toBe("ok");
    expect(out.kind).toBe("retryable");
  });

  it("a resolved entry that is a bare non-object (string / null) → whole 200 falls to retryable", () => {
    for (const bad of ["not-an-object", null, 42]) {
      const out = classifySpecsResponse(200, { resolved: [MATCHED, bad] });
      expect(out.kind).not.toBe("ok");
      expect(out.kind).toBe("retryable");
    }
  });
});

describe("classifySpecsResponse — resolution surfacing (faithful: matched adopts the canonical, created echoes the submitted)", () => {
  it("surfaces the resolved array FAITHFULLY, in order, verbatim — the client does not second-guess the backend's verdict", () => {
    // The client trusts the registry's dedupe authority (card scope boundary): it
    // surfaces `resolved` whole, per-entry, in order — never reshaping or dropping a
    // field the method needs to persist the canonical def (display_name, data_type,
    // unit, is_filterable, is_comparable). A `{ submitted, canonical, status }` narrow
    // would strand the method with no canonical DEFINITION to write.
    const resolved = [MATCHED, CREATED];
    const out = classifySpecsResponse(200, { resolved });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.resolved).toEqual(resolved);
    }
  });

  it("MATCHED: status is 'matched' and canonical (the existing name) DIFFERS from submitted (the coined synonym)", () => {
    const out = classifySpecsResponse(200, { resolved: [MATCHED] });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const r = out.resolved[0]! as Record<string, unknown>;
      expect(r["status"]).toBe("matched");
      // The adopt target: canonical is the EXISTING canonical name, ≠ the submitted synonym.
      expect(r["canonical"]).toEqual({ namespace: "product", key: "waterproof_rating" });
      expect(r["submitted"]).toEqual({ namespace: "product", key: "waterproofing" });
      expect(r["canonical"]).not.toEqual(r["submitted"]);
    }
  });

  it("CREATED: status is 'created' and canonical EQUALS submitted (you were first; your coined name IS canonical)", () => {
    const out = classifySpecsResponse(200, { resolved: [CREATED] });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const r = out.resolved[0]! as Record<string, unknown>;
      expect(r["status"]).toBe("created");
      expect(r["canonical"]).toEqual(r["submitted"]);
      expect(r["canonical"]).toEqual({ namespace: "seller", key: "handmade" });
    }
  });

  it("a MIXED resolution (one matched, one created) surfaces BOTH per-entry — no partial, no collapse", () => {
    const out = classifySpecsResponse(200, { resolved: [MATCHED, CREATED] });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.resolved).toHaveLength(2);
      const statuses = out.resolved.map((r) => (r as Record<string, unknown>)["status"]);
      expect(statuses).toEqual(["matched", "created"]);
    }
  });

  it("preserves the canonical DEFINITION fields the method must persist (display_name, data_type, is_filterable, is_comparable)", () => {
    const out = classifySpecsResponse(200, { resolved: [MATCHED] });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const r = out.resolved[0]! as Record<string, unknown>;
      expect(r["display_name"]).toBe("Waterproof Rating");
      expect(r["data_type"]).toBe("number");
      expect(r["unit"]).toBe("mm");
      expect(r["is_filterable"]).toBe(true);
      expect(r["is_comparable"]).toBe(true);
    }
  });
});
