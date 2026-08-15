/**
 * UNIT — `classifyResultResponse`, the ONE classifier behind `/catalog/search`
 * AND `/catalog/lookup` (tier: unit, <100 ms, no I/O).
 *
 * A4: the two routes answer with the SAME result object by contract
 * (`packages/schemas/src/search.ts:1-30` — "they differ in what they were asked
 * and in what they spend, never in what they answer with"), so there is one
 * classifier and one outcome union. Two classifiers would be two places for the
 * gate to drift, on a wire whose whole job is that the agent's three-state veto
 * is computable from either.
 *
 * THE GATE IS FAIL-CLOSED AT THE TOP LEVEL AND VERBATIM UNDERNEATH. A1 widens
 * the pre-v0 single-`products`-array check to all four keys, because a body with
 * `results` but no `predicates` would classify `ok` and silently disarm the veto
 * (RK6). Below those keys nothing is inspected, renamed, defaulted or re-ordered
 * (A3, RK7) — the deleted `projectProduct`/`projectVariant` idiom dropped exactly
 * the fields the veto needs, which is why pass-through is the design and a
 * projection is the regression this file pins.
 *
 * The mutations run off the CHECKED-IN GOLDEN, one at a time, so a "rejects X"
 * case can never pass because the body was already broken for another reason.
 */

import { describe, it, expect } from "vitest";
import { classifyResultResponse } from "../../lib/sil-client.js";
import {
  AUTH,
  GOLDEN_REFS,
  SEARCH_400,
  clone,
  resultEmpty,
  resultGolden,
  resultMissing,
  resultWithResult0,
} from "../helpers/v0-wire.js";

/** The four top-level keys the v0 result object always carries. */
const REQUIRED_KEYS = ["results", "sources", "predicates", "report"] as const;

describe("A1 — the structural gate is ALL FOUR keys, never just `results`", () => {
  it.each(REQUIRED_KEYS)(
    "a 200 missing `%s` is `retryable`, never `ok` (the anti-false-green guard)",
    (key) => {
      expect(classifyResultResponse(200, resultMissing(key))).toEqual({ kind: "retryable" });
    },
  );

  it("guard-of-the-guard: the UNMUTATED golden classifies `ok`", () => {
    // Without this, every rejection above could be passing because the fixture
    // itself is malformed — the whole block would be vacuous.
    expect(classifyResultResponse(200, resultGolden()).kind).toBe("ok");
  });

  it.each([
    ["`results` is not an array", { results: {} }],
    ["`sources` is not an object", { sources: [] }],
    ["`predicates` is not an array", { predicates: {} }],
    ["`report` is not an object", { report: 3 }],
    ["`predicates` is a string", { predicates: "none" }],
  ])("a 200 whose %s is `retryable`", (_label, overlay) => {
    expect(classifyResultResponse(200, { ...resultGolden(), ...overlay })).toEqual({
      kind: "retryable",
    });
  });

  it.each([
    ["`maturity` outside {catalog, web}", (r: Record<string, unknown>) => (r["maturity"] = "lukewarm")],
    ["a non-string `ref`", (r: Record<string, unknown>) => (r["ref"] = 7)],
    ["a non-object `values`", (r: Record<string, unknown>) => (r["values"] = [])],
    ["a non-array `offers`", (r: Record<string, unknown>) => (r["offers"] = {})],
    ["a missing `values`", (r: Record<string, unknown>) => delete r["values"]],
    ["a missing `offers`", (r: Record<string, unknown>) => delete r["offers"]],
    ["a missing `maturity`", (r: Record<string, unknown>) => delete r["maturity"]],
    ["a missing `ref`", (r: Record<string, unknown>) => delete r["ref"]],
  ])("a 200 with all four keys but a result carrying %s is `retryable`", (_label, mutate) => {
    expect(classifyResultResponse(200, resultWithResult0(mutate))).toEqual({ kind: "retryable" });
  });

  it("the gate rejects the WHOLE body on one bad result — never a partial list", () => {
    // A gate that dropped the offending result and returned the rest would hand
    // the agent a shortlist silently missing an item, which is the one failure
    // the buyer cannot see.
    const outcome = classifyResultResponse(
      200,
      resultWithResult0((r) => (r["maturity"] = "lukewarm")),
    );
    expect(outcome.kind).toBe("retryable");
  });

  it("a 200 that is not an object at all is `retryable`", () => {
    for (const body of [null, undefined, [], "ok", 42, true]) {
      expect(classifyResultResponse(200, body)).toEqual({ kind: "retryable" });
    }
  });
});

/**
 * The gate's ONE non-structural refusal, and it protects the layer above it.
 *
 * `mapResultOutcome` builds the agent's envelope as
 * `jsonResult({ status: "ok", ...outcome.result, ...wiringAdvisories(api) })`,
 * and in a spread the LATER key wins. So a route body that itself declares one
 * of the plugin's own two envelope keys corrupts the result silently, in
 * opposite directions:
 *
 *  - `status` REPLACES the plugin's dispatch key — `{status:"ok"}` + a body's
 *    `{status:"partial"}` is `{"status":"partial"}`. Every agent switching on
 *    the tool's status taxonomy then reads a sil-services value with no matching
 *    recovery arm, and the ToolResult still looks healthy.
 *  - `advisories` has the PLUGIN's own silently dropped — the single place in
 *    this design where the verbatim pass-through loses a field it exists to
 *    carry, which is the invariant inverted.
 *
 * Neither is hypothetical: the design plans for additive server fields (RK7) and
 * `report.blocked` already carries a degraded-answer signal, so a top-level
 * `status`-ish member is inside the designed-for future. The body is therefore
 * refused WHOLE, down the same fail-closed `retryable` arm every other gate
 * failure takes — no new status, no projection, nothing stripped.
 *
 * Re-ordering the spread is NOT the fix and these bars reject it too: putting
 * the payload first drops the server's field instead, the same silent loss
 * pointing the other way. A gate that STRIPPED the key would also fail here —
 * `retryable` carries no result at all, so nothing can arrive half-edited.
 */
describe("the reserved ENVELOPE keys — a body declaring one is refused, never merged", () => {
  it.each([
    ["status", "partial"],
    ["advisories", [{ id: "route.side_channel", severity: "warn" }]],
  ])("a 200 declaring a top-level `%s` is `retryable`, never `ok`", (key, value) => {
    expect(classifyResultResponse(200, { ...resultGolden(), [key]: value })).toEqual({
      kind: "retryable",
    });
  });

  it.each(["status", "advisories"])(
    "PRESENCE is what bites — a falsy `%s` clobbers the envelope just as hard",
    (key) => {
      // A spread copies the key, not its truthiness: `{status:"ok"}` + `{status:null}`
      // is `{status:null}`. A gate testing the VALUE would let the dispatch key be
      // nulled out and hand the agent an envelope with no status at all.
      for (const value of [null, ""]) {
        expect(classifyResultResponse(200, { ...resultGolden(), [key]: value })).toEqual({
          kind: "retryable",
        });
      }
    },
  );

  it("guard-of-the-guard: the SAME body WITHOUT the reserved key is `ok`", () => {
    // Every case above is the golden plus exactly one key, so the refusal cannot
    // be coming from anything else in the body.
    expect(classifyResultResponse(200, { ...resultGolden() }).kind).toBe("ok");
  });

  it("a body carrying an unrelated additive top-level key is STILL `ok` — only the two are reserved", () => {
    // The reserved list is two names, not a whitelist of known fields. Widening it
    // into "reject what we do not declare" would break the first time sil-services
    // adds anything, which is the projector this card exists to delete.
    expect(
      classifyResultResponse(200, { ...resultGolden(), notice: "an additive member" }).kind,
    ).toBe("ok");
  });
});

describe("A2 — a genuine EMPTY answer is a success, distinct from A1's guard", () => {
  it("`results: []` with a well-formed envelope is `ok` with an empty list", () => {
    const outcome = classifyResultResponse(200, resultEmpty());
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.result.results).toEqual([]);
  });

  it("the gate keys on PRESENCE, never on length — an empty `predicates` is still `ok`", () => {
    const body = { ...resultEmpty(), predicates: [] };
    expect(classifyResultResponse(200, body).kind).toBe("ok");
  });

  it("an empty answer is NOT `retryable` — zero results is an answer, not a failure", () => {
    expect(classifyResultResponse(200, resultEmpty()).kind).not.toBe("retryable");
  });
});

describe("A3 — pass-through, not projection: the payload crosses VERBATIM", () => {
  it("the whole golden survives, deep-equal — nothing dropped, defaulted or re-ordered", () => {
    const wire = resultGolden();
    const outcome = classifyResultResponse(200, clone(wire));
    if (outcome.kind !== "ok") throw new Error(`expected ok, got ${outcome.kind}`);
    expect(outcome.result).toEqual(wire);
  });

  it("a key the mirrored types do NOT declare still reaches the caller", () => {
    // The regression this pins is `projectProduct`/`projectVariant`, which copied
    // named fields and therefore dropped every field added server-side after the
    // projector was written — the veto's inputs among them.
    const wire = resultGolden();
    (wire["results"] as Record<string, unknown>[])[0]["sil_future_field"] = { nested: [1, 2] };
    wire["notice"] = "an additive top-level member";
    const outcome = classifyResultResponse(200, clone(wire));
    if (outcome.kind !== "ok") throw new Error(`expected ok, got ${outcome.kind}`);
    expect(outcome.result).toEqual(wire);
  });

  it("an `unset` value entry is carried, never elided into an absent key", () => {
    // `{state:'unset'}` and an omitted key are DIFFERENT answers on this wire and
    // the same absence at the call site. Compacting one into the other is how the
    // NOT-VERIFIED bucket silently becomes VERIFIED.
    const outcome = classifyResultResponse(200, resultGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    const values = outcome.result.results[0].values as Record<string, unknown>;
    expect(values["flex_index"]).toEqual({ state: "unset" });
    expect(Object.keys(values).sort()).toEqual(["brand", "flex_index"]);
  });

  it("all three `applied` states cross intact — `true`, `'partial'`, `false`", () => {
    const outcome = classifyResultResponse(200, resultGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    expect(outcome.result.predicates.map((p) => [p.key, p.applied])).toEqual([
      ["flex_index", true],
      ["brand", "partial"],
      ["buckle_count", false],
    ]);
    // `false` as a JSON boolean, never the truthy STRING "false".
    expect(outcome.result.predicates[2].applied).not.toBe("false");
  });

  it("a decimal price stays the SAME STRING — never parsed to a float", () => {
    const outcome = classifyResultResponse(200, resultGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    expect(outcome.result.results[0].offers[0].price).toBe("449.990000");
    expect(typeof outcome.result.results[0].offers[0].price).toBe("string");
  });

  it("absent optionals stay ABSENT — no `\"\"`, no `null`, no `url` copied into `buy_url`", () => {
    const outcome = classifyResultResponse(200, resultGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    const catalogResult = outcome.result.results[0];
    const offer = catalogResult.offers[0] as unknown as Record<string, unknown>;
    expect(catalogResult.product).not.toHaveProperty("description");
    expect(catalogResult.product).not.toHaveProperty("description_source_ref");
    expect(offer).not.toHaveProperty("buy_url");
    expect(offer["seller"]).not.toHaveProperty("display_name");
    expect(offer["seller"]).not.toHaveProperty("country");
    // …while the SAME body's other result carries them, so the assertion above
    // is about absence, not about the fixture holding nothing.
    const webOffer = outcome.result.results[1].offers[0] as unknown as Record<string, unknown>;
    expect(webOffer["buy_url"]).toBe("https://backcountry.com/cart/lange-lx-130");
    expect(webOffer["seller"]).toHaveProperty("display_name", "Backcountry");
  });

  it("server rank order is preserved — no sort, no filter, no dedupe", () => {
    const outcome = classifyResultResponse(200, resultGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    expect(outcome.result.results.map((r) => r.ref)).toEqual([
      GOLDEN_REFS.catalog,
      GOLDEN_REFS.web,
    ]);
  });

  it("a `maturity: 'web'` result carries NO added exclusion/confidence marker", () => {
    const wire = resultGolden();
    const outcome = classifyResultResponse(200, clone(wire));
    if (outcome.kind !== "ok") throw new Error("expected ok");
    const web = outcome.result.results[1] as unknown as Record<string, unknown>;
    const wireWeb = (wire["results"] as Record<string, unknown>[])[1];
    expect(Object.keys(web).sort()).toEqual(Object.keys(wireWeb).sort());
    for (const banned of ["flagged", "excluded", "confidence", "verified", "score", "rank"]) {
      expect(web).not.toHaveProperty(banned);
    }
  });
});

describe("the non-200 arms — one taxonomy, no 422", () => {
  it("400 surfaces the route's `{ error, message }` VERBATIM", () => {
    expect(classifyResultResponse(400, SEARCH_400.unknownDomain)).toEqual({
      kind: "invalid_request",
      error: "invalid_request",
      message: SEARCH_400.unknownDomain.message,
    });
  });

  it("the two search 400s differ ONLY in `message` — the wire has no other discriminator", () => {
    // `handlers/search.ts:84` vs `:97` both send `error: "invalid_request"`. The
    // plugin refuses to substring-match the sibling's prose, so the message IS
    // the discriminator and it must cross verbatim. A machine-readable split
    // needs a distinct `error` code from sil-services (signalled up).
    const domain = classifyResultResponse(400, SEARCH_400.unknownDomain);
    const grammar = classifyResultResponse(400, SEARCH_400.predicateGrammar);
    expect(domain).not.toEqual(grammar);
    if (domain.kind !== "invalid_request" || grammar.kind !== "invalid_request") {
      throw new Error("both 400s must classify invalid_request");
    }
    expect(domain.error).toBe(grammar.error);
    expect(domain.message).toBe(SEARCH_400.unknownDomain.message);
    expect(grammar.message).toBe(SEARCH_400.predicateGrammar.message);
    expect(domain.message).not.toBe(grammar.message);
  });

  it("400 is never retryable and never carries a re-register hint", () => {
    const outcome = classifyResultResponse(400, SEARCH_400.predicateGrammar);
    expect(outcome.kind).toBe("invalid_request");
    expect(outcome).not.toHaveProperty("recovery");
  });

  it("401 is `unauthorized` — the refresh trigger, not a terminal", () => {
    expect(classifyResultResponse(401, AUTH.unauthorized)).toEqual({ kind: "unauthorized" });
  });

  describe("A7 — 503 is retryable, 403 is not, and the two 403 reasons stay apart", () => {
    it("403 `user_not_provisioned` → forbidden carrying that exact reason", () => {
      expect(classifyResultResponse(403, AUTH.userNotProvisioned)).toEqual({
        kind: "forbidden",
        reason: "user_not_provisioned",
      });
    });

    it("403 `principal_mismatch` → forbidden carrying that exact reason", () => {
      expect(classifyResultResponse(403, AUTH.principalMismatch)).toEqual({
        kind: "forbidden",
        reason: "principal_mismatch",
      });
    });

    it("403 is never `retryable` — a refresh cannot fix an unprovisioned user", () => {
      expect(classifyResultResponse(403, AUTH.userNotProvisioned).kind).not.toBe("retryable");
      expect(classifyResultResponse(403, AUTH.principalMismatch).kind).not.toBe("retryable");
    });

    it("503 `service_unavailable` → retryable, NOT forbidden", () => {
      expect(classifyResultResponse(503, AUTH.serviceUnavailable).kind).toBe("retryable");
    });

    it("a 403 with an unreadable body still classifies forbidden, with a generic reason", () => {
      expect(classifyResultResponse(403, null)).toEqual({ kind: "forbidden", reason: "forbidden" });
    });
  });

  describe("A6 — the 422 arm is GONE", () => {
    it("422 falls to `retryable` via the generic non-200 path", () => {
      // No v0 route emits 422; the pre-v0 `source_rejected` special case is
      // deleted, not kept "just in case" — a dead arm is a divergence surface.
      expect(classifyResultResponse(422, { error: "source_rejected", message: "no" })).toEqual({
        kind: "retryable",
      });
    });

    it("422 is NOT `invalid_request` — that mapping died with the pre-v0 contract", () => {
      expect(classifyResultResponse(422, { error: "source_rejected" }).kind).not.toBe(
        "invalid_request",
      );
    });
  });

  it.each([500, 502, 504, 429, 418])("%d → retryable", (status) => {
    expect(classifyResultResponse(status, { error: "boom" }).kind).toBe("retryable");
  });

  it("a 5xx naming a `source` carries it through for the operator log", () => {
    expect(
      classifyResultResponse(500, { source: "index", error: "source_unavailable", message: "down" }),
    ).toEqual({ kind: "retryable", source: "index", detail: "down" });
  });
});

describe("A4 — ONE result classifier exists, and the per-route ones are deleted", () => {
  it("`sil-client` exports no second, route-shaped result classifier", async () => {
    // The criterion is not "two calls agree" (with one function that is a
    // tautology) — it is that a SECOND classifier does not exist to drift from
    // the first. The pre-v0 pair is named here so re-adding either goes RED
    // immediately, before the two have anywhere to disagree. The behavioural
    // half — the same body through `searchCatalog` and `lookupCatalog` giving
    // the same outcome — is `catalog-lookup.integration.test.ts`'s A4 block.
    const mod = (await import("../../lib/sil-client.js")) as Record<string, unknown>;
    expect(typeof mod["classifyResultResponse"]).toBe("function");
    const forked = Object.keys(mod).filter(
      (name) => /^classify.*(Search|Lookup|Catalog)Response$/.test(name),
    );
    expect(forked).toEqual([]);
  });
});
