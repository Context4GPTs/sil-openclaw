/**
 * UNIT — `classifyStoresResponse` (tier: unit, <100 ms, no I/O).
 *
 * `/catalog/stores` is where the v0 journey ends, and it carries the one rule
 * that breaks the product SILENTLY: `serviceability` has three states and they
 * are NOT symmetric. `not_serviceable` is a positive claim requiring policy
 * evidence sil actually read; everything else is `unknown`. At v0 nothing writes
 * `corpus.purposes = 'policy'`, so `unknown` is the MAJORITY answer and
 * `not_serviceable` is structurally unreachable — a consumer that drops
 * `unknown` sellers collapses the shortlist to near-empty while looking like it
 * filtered, and nothing downstream can detect that.
 *
 * So the classifier's job here is narrow and absolute: gate the envelope, then
 * hand every seller over untouched — including, especially, the `unknown` ones.
 *
 * It also owns the route's one genuinely new status: a 404 is `not_found`, which
 * is terminal but NOT fatal (A5) — not retryable, and never a re-register.
 */

import { describe, it, expect } from "vitest";
import { classifyStoresResponse } from "../../lib/sil-client.js";
import {
  AUTH,
  GOLDEN_HOSTS,
  STORES_400_NO_DESTINATION,
  STORES_404,
  clone,
  storeFor,
  storesGolden,
  storesMissing,
  storesWithStore0,
} from "../helpers/v0-wire.js";

const REQUIRED_KEYS = ["destination", "stores", "sources"] as const;

describe("the structural gate — all three top-level keys, fail-closed", () => {
  it("guard-of-the-guard: the UNMUTATED golden classifies `ok`", () => {
    expect(classifyStoresResponse(200, storesGolden()).kind).toBe("ok");
  });

  it.each(REQUIRED_KEYS)("a 200 missing `%s` is `retryable`, never `ok`", (key) => {
    expect(classifyStoresResponse(200, storesMissing(key))).toEqual({ kind: "retryable" });
  });

  it.each([
    ["`destination` is not a string", { destination: 49 }],
    ["`stores` is not an array", { stores: {} }],
    ["`sources` is not an object", { sources: [] }],
  ])("a 200 whose %s is `retryable`", (_label, overlay) => {
    expect(classifyStoresResponse(200, { ...storesGolden(), ...overlay })).toEqual({
      kind: "retryable",
    });
  });

  it.each([
    [
      "`serviceability` outside the three states",
      (s: Record<string, unknown>) => (s["serviceability"] = "maybe"),
    ],
    ["a missing `serviceability`", (s: Record<string, unknown>) => delete s["serviceability"]],
    ["a missing `handoff`", (s: Record<string, unknown>) => delete s["handoff"]],
    [
      "a `handoff` with no `url`",
      (s: Record<string, unknown>) => (s["handoff"] = { source: "url" }),
    ],
    [
      "a `handoff` with no `source`",
      (s: Record<string, unknown>) => (s["handoff"] = { url: "https://evo.com/x" }),
    ],
    [
      "a `handoff.source` outside {buy_url, url}",
      (s: Record<string, unknown>) => (s["handoff"] = { url: "https://evo.com/x", source: "guess" }),
    ],
  ])("a 200 with a store carrying %s is `retryable`", (_label, mutate) => {
    expect(classifyStoresResponse(200, storesWithStore0(mutate))).toEqual({ kind: "retryable" });
  });

  it("`serviceability: 'unknown'` is a VALID state — the gate must not reject it", () => {
    // The gate that "helpfully" refuses the majority answer is the same defect as
    // the agent that filters it, one layer lower.
    const body = storesWithStore0((s) => (s["serviceability"] = "unknown"));
    expect(classifyStoresResponse(200, body).kind).toBe("ok");
  });

  it("an empty `stores: []` is `ok` — presence, never length", () => {
    expect(
      classifyStoresResponse(200, { destination: "DE", stores: [], sources: {} }).kind,
    ).toBe("ok");
  });
});

/**
 * The same reserved-key refusal `result-classify.test.ts` documents in full:
 * `mapStoresOutcome` spreads this body into `{ status: "ok", ...outcome.stores,
 * ...wiringAdvisories(api) }`, so a body declaring `status` would replace the
 * plugin's dispatch key and one declaring `advisories` would drop the plugin's.
 * Both silent. The gate refuses the body whole, down the existing `retryable`
 * arm — the three gates behave identically here on purpose, because a rule that
 * held on one route and not the next is a rule nobody can rely on.
 */
describe("the reserved ENVELOPE keys — a body declaring one is refused, never merged", () => {
  it.each([
    ["status", "partial"],
    ["advisories", [{ id: "route.side_channel", severity: "warn" }]],
  ])("a 200 declaring a top-level `%s` is `retryable`, never `ok`", (key, value) => {
    expect(classifyStoresResponse(200, { ...storesGolden(), [key]: value })).toEqual({
      kind: "retryable",
    });
  });

  it.each(["status", "advisories"])("PRESENCE bites — a falsy `%s` is refused too", (key) => {
    for (const value of [null, ""]) {
      expect(classifyStoresResponse(200, { ...storesGolden(), [key]: value })).toEqual({
        kind: "retryable",
      });
    }
  });

  it("guard-of-the-guard: the SAME body WITHOUT the reserved key is `ok`", () => {
    expect(classifyStoresResponse(200, { ...storesGolden() }).kind).toBe("ok");
  });

  it("an unrelated additive top-level key is STILL `ok` — two reserved names, not a whitelist", () => {
    expect(
      classifyStoresResponse(200, { ...storesGolden(), notice: "an additive member" }).kind,
    ).toBe("ok");
  });
});

describe("every seller crosses VERBATIM — the `unknown` rule, at the classifier", () => {
  it("the whole golden survives deep-equal, all three states included", () => {
    const wire = storesGolden();
    const outcome = classifyStoresResponse(200, clone(wire));
    if (outcome.kind !== "ok") throw new Error(`expected ok, got ${outcome.kind}`);
    expect(outcome.stores).toEqual(wire);
  });

  it("all three serviceability states are present and none is dropped", () => {
    const outcome = classifyStoresResponse(200, storesGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    expect(outcome.stores.stores.map((s) => s.serviceability)).toEqual([
      "serviceable",
      "unknown",
      "not_serviceable",
    ]);
  });

  it("the `unknown` seller keeps its offer, fulfillment, values and handoff", () => {
    const outcome = classifyStoresResponse(200, storesGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    const entry = storeFor(
      outcome.stores as unknown as Record<string, unknown>,
      GOLDEN_HOSTS.unknown,
    );
    expect(entry["serviceability"]).toBe("unknown");
    expect(entry["offer"]).toBeTypeOf("object");
    expect(entry["fulfillment"]).toEqual([]);
    expect(entry["values"]).toBeTypeOf("object");
    expect(entry["handoff"]).toEqual({
      url: "https://backcountry.com/cart/lange-lx-120",
      source: "buy_url",
    });
  });

  it("no seller gains an exclusion / filter / deprioritisation marker", () => {
    const wire = storesGolden();
    const outcome = classifyStoresResponse(200, clone(wire));
    if (outcome.kind !== "ok") throw new Error("expected ok");
    outcome.stores.stores.forEach((entry, i) => {
      const wireEntry = (wire["stores"] as Record<string, unknown>[])[i];
      expect(Object.keys(entry).sort()).toEqual(Object.keys(wireEntry).sort());
      for (const banned of ["excluded", "filtered", "skip", "deprioritised", "usable", "rank"]) {
        expect(entry).not.toHaveProperty(banned);
      }
    });
  });

  it("`policy_evidence` rides ONLY the negative verdict — and is not invented for the others", () => {
    const outcome = classifyStoresResponse(200, storesGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    const body = outcome.stores as unknown as Record<string, unknown>;
    expect(storeFor(body, GOLDEN_HOSTS.not_serviceable)).toHaveProperty("policy_evidence");
    expect(storeFor(body, GOLDEN_HOSTS.unknown)).not.toHaveProperty("policy_evidence");
    expect(storeFor(body, GOLDEN_HOSTS.serviceable)).not.toHaveProperty("policy_evidence");
  });

  it("`unset` cost / threshold / return entries arrive as `{state:'unset'}` — never 0, never free", () => {
    const outcome = classifyStoresResponse(200, storesGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    const body = outcome.stores as unknown as Record<string, unknown>;
    for (const host of Object.values(GOLDEN_HOSTS)) {
      const entry = storeFor(body, host);
      expect(entry["cost"]).toEqual({});
      expect(entry["free_threshold"]).toEqual({});
      expect(entry["charged_currency"]).toEqual({ state: "unset" });
      const values = entry["values"] as Record<string, unknown>;
      expect(values["return_window_days"]).toEqual({ state: "unset" });
      expect(values["restocking_fee"]).toEqual({ state: "unset" });
    }
  });

  it("`{}` cost is NOT rewritten to a zero range, and no default is filled in", () => {
    const outcome = classifyStoresResponse(200, storesGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    const entry = storeFor(
      outcome.stores as unknown as Record<string, unknown>,
      GOLDEN_HOSTS.serviceable,
    );
    expect(entry["cost"]).not.toEqual({ EUR: { min: "0", max: "0" } });
    expect(Object.keys(entry["cost"] as object)).toEqual([]);
  });

  it("a field the mirrored types do not declare still reaches the caller", () => {
    const wire = storesGolden();
    (wire["stores"] as Record<string, unknown>[])[1]["sil_future_field"] = ["additive"];
    const outcome = classifyStoresResponse(200, clone(wire));
    if (outcome.kind !== "ok") throw new Error("expected ok");
    expect(outcome.stores).toEqual(wire);
  });
});

describe("A5 — `not_found` is a NEW status, terminal but not fatal", () => {
  it("a 404 classifies `not_found`, carrying the route's message", () => {
    const outcome = classifyStoresResponse(404, STORES_404);
    expect(outcome.kind).toBe("not_found");
    if (outcome.kind !== "not_found") throw new Error("unreachable");
    expect(outcome.message).toBe(STORES_404.message);
  });

  it("a 404 is NOT retryable — the ref will not appear on a retry", () => {
    expect(classifyStoresResponse(404, STORES_404).kind).not.toBe("retryable");
  });

  it("a 404 is NOT `invalid_request` — the request was well formed", () => {
    expect(classifyStoresResponse(404, STORES_404).kind).not.toBe("invalid_request");
  });

  it("a 404 is NOT `unauthorized`/`forbidden` — auth is fine", () => {
    const kind = classifyStoresResponse(404, STORES_404).kind;
    expect(kind).not.toBe("unauthorized");
    expect(kind).not.toBe("forbidden");
  });

  it("a 404 never answers with an empty `stores` list", () => {
    // The route refuses a 200-with-`stores: []` for this case by design — that
    // body reads as "nobody sells this", which is a lie by omission. The plugin
    // must not manufacture the shape the route declined to send.
    const outcome = classifyStoresResponse(404, STORES_404) as unknown as Record<string, unknown>;
    expect(outcome).not.toHaveProperty("stores");
  });
});

describe("the shared arms behave exactly as the other three routes'", () => {
  it("400 no-destination surfaces `{ error, message }` verbatim", () => {
    expect(classifyStoresResponse(400, STORES_400_NO_DESTINATION)).toEqual({
      kind: "invalid_request",
      error: "invalid_request",
      message: STORES_400_NO_DESTINATION.message,
    });
  });

  it("the no-destination 400 is distinguishable from every serviceability answer", () => {
    // "You did not say where you are" and "we never read this seller's policy"
    // are different gaps with different remedies; collapsing them destroys the
    // only thing this route sells.
    const refusal = classifyStoresResponse(400, STORES_400_NO_DESTINATION);
    const answer = classifyStoresResponse(200, storesGolden());
    expect(refusal.kind).toBe("invalid_request");
    expect(answer.kind).toBe("ok");
    expect(refusal.kind).not.toBe(answer.kind);
  });

  it("401 → unauthorized; 403 → forbidden with the reason; 503 → retryable", () => {
    expect(classifyStoresResponse(401, AUTH.unauthorized)).toEqual({ kind: "unauthorized" });
    expect(classifyStoresResponse(403, AUTH.userNotProvisioned)).toEqual({
      kind: "forbidden",
      reason: "user_not_provisioned",
    });
    expect(classifyStoresResponse(403, AUTH.principalMismatch)).toEqual({
      kind: "forbidden",
      reason: "principal_mismatch",
    });
    expect(classifyStoresResponse(503, AUTH.serviceUnavailable).kind).toBe("retryable");
  });

  it("A6 — 422 falls to retryable here too; no `source_rejected` arm exists", () => {
    expect(classifyStoresResponse(422, { error: "source_rejected" })).toEqual({
      kind: "retryable",
    });
  });
});
