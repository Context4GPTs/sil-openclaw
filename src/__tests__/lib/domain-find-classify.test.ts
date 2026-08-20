/**
 * UNIT — `classifyDomainFindResponse` (tier: unit, <100 ms, no I/O).
 *
 * THE READ IS WHAT LICENSES THE MINT, so its 200 gate is not hygiene — it is the
 * load-bearing half of BR-1. The agent is allowed to perform v0's ONE permanent,
 * un-undoable global registry write only when a discovery read came back with no
 * match stating `exists: true` AND `capped: false`. Both of those are read off
 * the body. A gate that admits a body which cannot state them hands the agent a
 * verdict it has no evidence for, under a `status: "ok"` that looks clean.
 *
 * Three failures are therefore refused as `retryable`, never `ok`:
 *
 *   - `capped` absent or non-boolean. `capped: false` is FALSY, so the gate must
 *     test `typeof === "boolean"` and never truthiness. A dropped `capped` lets
 *     the agent mint past a bound it never saw — the exact defect this route
 *     exists to prevent.
 *   - `exists` absent or non-boolean. It is STATED and never inferable: a path
 *     with no row still resolves its ancestors' vocabulary, so a non-empty
 *     `specs` says nothing, and `guide === null` says nothing either
 *     (`@sil/schemas` `domain-find.ts:20-24`).
 *   - `validated_at` neither a string nor `null`. The fence IS the column; a
 *     body that cannot date it cannot say whether this domain's first answers
 *     come from the web.
 *
 * And ONE success is refused the other way round: `matches: []` beside
 * `capped: false` is `ok` — PRESENCE, never length, the same rule `results: []`
 * follows. Mapping the empty answer to a failure (or to a `not_found` arm) would
 * re-create the "empty shelf sent straight to the mint" behaviour this whole card
 * exists to delete.
 *
 * The read has NO 404 and NO 409 arm: it holds nothing that can be absent (an
 * absent domain is a 200 stating `exists: false`) and it writes nothing that can
 * collide.
 */

import { describe, it, expect } from "vitest";
import { classifyDomainFindResponse } from "../../lib/sil-client.js";
import {
  AUTH,
  FIND_400_BOTH,
  FIND_400_NEITHER,
  FIND_400_UNSUPPORTED,
  GOLDEN_DOMAINS,
  domainFindCapped,
  domainFindEmpty,
  domainFindGolden,
  domainFindMissing,
  domainFindProbeMiss,
  domainFindWithMatch0,
  matchFor,
} from "../helpers/v0-wire.js";

describe("the 200 — the payload crosses whole, and the empty answer is a SUCCESS", () => {
  it("classifies `ok` and carries the body verbatim", () => {
    const wire = domainFindGolden();
    const outcome = classifyDomainFindResponse(200, wire);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.found).toEqual(wire);
  });

  it("returns the ORIGINAL object, not a copy or a projection", () => {
    // The identity check is the anti-projection guard: a gate that rebuilt the
    // envelope would pass every deep-equal above while silently dropping the
    // fields it does not declare.
    const wire = domainFindGolden();
    const outcome = classifyDomainFindResponse(200, wire);
    if (outcome.kind !== "ok") throw new Error("expected ok");
    expect(outcome.found as unknown).toBe(wire);
  });

  it("`matches: []` with `capped: false` is `ok` — the MINT SIGNAL, never a failure", () => {
    const outcome = classifyDomainFindResponse(200, domainFindEmpty());
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.found.matches).toEqual([]);
    expect(outcome.found.capped).toBe(false);
  });

  it("the empty answer is NOT mapped to any absence arm", () => {
    // A `not_found` here would be a SECOND empty-shelf signal, and the two would
    // disagree about whether a mint is licensed.
    const kind = classifyDomainFindResponse(200, domainFindEmpty()).kind;
    expect(kind).not.toBe("not_found");
    expect(kind).not.toBe("invalid_request");
    expect(kind).not.toBe("retryable");
  });

  it("`capped: true` is still `ok` — a bounded answer is an answer, and it is STATED", () => {
    const outcome = classifyDomainFindResponse(200, domainFindCapped());
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.found.capped).toBe(true);
  });

  it("a `?path=` probe MISS crosses whole — `exists: false` beside the vocabulary it WOULD inherit", () => {
    // The two facts are independent and are never conflated: no row here, and a
    // non-empty inherited vocabulary. BR-4 is computed from exactly this shape,
    // so a gate that rejected it (or an outcome that flattened it) would leave
    // the pre-mint probe unusable.
    const wire = domainFindProbeMiss();
    const outcome = classifyDomainFindResponse(200, wire);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    const [match] = outcome.found.matches;
    expect(match.exists).toBe(false);
    expect(match.guide).toBeNull();
    expect(match.specs.length).toBeGreaterThan(0);
  });

  it("a FENCED match keeps its place — `validated_at: null` is adopted like any other", () => {
    const outcome = classifyDomainFindResponse(200, domainFindGolden());
    if (outcome.kind !== "ok") throw new Error("expected ok");
    const fenced = matchFor(
      outcome.found as unknown as Record<string, unknown>,
      GOLDEN_DOMAINS.fenced,
    );
    expect(fenced["validated_at"]).toBeNull();
    expect(fenced["exists"]).toBe(true);
  });
});

describe("the `capped` gate — `false` is FALSY and must still pass", () => {
  it("an explicit `capped: false` passes the gate", () => {
    // The named bug class: a truthiness test drops the one value that means
    // "this list is complete", which is half of the mint licence.
    expect(classifyDomainFindResponse(200, { matches: [], capped: false }).kind).toBe("ok");
  });

  it.each([
    ["absent", domainFindMissing("capped")],
    ["a string 'false'", { ...domainFindGolden(), capped: "false" }],
    ["a string 'true'", { ...domainFindGolden(), capped: "true" }],
    ["null", { ...domainFindGolden(), capped: null }],
    ["a number 0", { ...domainFindGolden(), capped: 0 }],
    ["a number 1", { ...domainFindGolden(), capped: 1 }],
  ])("a 200 whose `capped` is %s is `retryable`, never `ok`", (_label, body) => {
    expect(classifyDomainFindResponse(200, body)).toEqual({ kind: "retryable" });
  });
});

describe("the `matches` gate — the envelope's other half", () => {
  it.each([
    ["absent", domainFindMissing("matches")],
    ["an object", { matches: {}, capped: false }],
    ["a string", { matches: "product.sports", capped: false }],
    ["null", { matches: null, capped: false }],
    ["carrying a non-object element", { matches: ["product.sports"], capped: false }],
    ["carrying null", { matches: [null], capped: false }],
  ])("a 200 whose `matches` is %s is `retryable`, never `ok`", (_label, body) => {
    expect(classifyDomainFindResponse(200, body)).toEqual({ kind: "retryable" });
  });
});

describe("the per-match gate — every field a business rule reads is checked", () => {
  it.each([
    ["`exists` omitted", (m: Record<string, unknown>) => delete m["exists"]],
    ["`exists` a string 'true'", (m: Record<string, unknown>) => (m["exists"] = "true")],
    ["`exists` null", (m: Record<string, unknown>) => (m["exists"] = null)],
    ["`exists` a number 1", (m: Record<string, unknown>) => (m["exists"] = 1)],
    ["`path` omitted", (m: Record<string, unknown>) => delete m["path"]],
    ["`path` not a string", (m: Record<string, unknown>) => (m["path"] = 7)],
    ["`validated_at` omitted", (m: Record<string, unknown>) => delete m["validated_at"]],
    ["`validated_at` a number", (m: Record<string, unknown>) => (m["validated_at"] = 1755158400)],
    ["`validated_at` a boolean", (m: Record<string, unknown>) => (m["validated_at"] = false)],
    ["`guide` omitted", (m: Record<string, unknown>) => delete m["guide"]],
    ["`guide` an object", (m: Record<string, unknown>) => (m["guide"] = { text: "…" })],
    ["`specs` omitted", (m: Record<string, unknown>) => delete m["specs"]],
    ["`specs` an object", (m: Record<string, unknown>) => (m["specs"] = {})],
  ])("a 200 with %s is `retryable`, never `ok`", (_label, mutate) => {
    expect(classifyDomainFindResponse(200, domainFindWithMatch0(mutate))).toEqual({
      kind: "retryable",
    });
  });

  it("`validated_at: null` and `guide: null` are VALID — the fence and the absent row", () => {
    // The nullable pair the gate must NOT reject: null is the stated fact here,
    // not a missing field, and rejecting it would make every fenced domain and
    // every probe miss unreadable.
    const outcome = classifyDomainFindResponse(
      200,
      domainFindWithMatch0((m) => {
        m["validated_at"] = null;
        m["guide"] = null;
      }),
    );
    expect(outcome.kind).toBe("ok");
  });

  it("an EMPTY `specs` on an existing domain is still `ok` — presence, never length", () => {
    // A domain with an empty vocabulary still exists (`domain-find.ts:20-24`).
    const outcome = classifyDomainFindResponse(
      200,
      domainFindWithMatch0((m) => (m["specs"] = [])),
    );
    expect(outcome.kind).toBe("ok");
  });

  it("a LATER match's malformation bites too — the gate walks every element", () => {
    // A gate that checked only `matches[0]` would pass a body whose second match
    // cannot state `exists`, and the agent reads all of them.
    const body = domainFindGolden();
    delete (body["matches"] as Record<string, unknown>[])[1]["exists"];
    expect(classifyDomainFindResponse(200, body)).toEqual({ kind: "retryable" });
  });

  it("an unrelated ADDITIVE field on a match is still `ok` — the gate is not a whitelist", () => {
    // An additive server field must reach the agent unreviewed; rejecting the
    // unknown reinstates the projector this contract deletes.
    const outcome = classifyDomainFindResponse(
      200,
      domainFindWithMatch0((m) => (m["notice"] = "an additive member")),
    );
    expect(outcome.kind).toBe("ok");
  });
});

describe("the 200 that is not a body at all", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["a string", "product.sports.winter.ski.boots"],
    ["a number", 1],
    ["a boolean", true],
  ])("a 200 that is %s is `retryable`", (_label, body) => {
    expect(classifyDomainFindResponse(200, body)).toEqual({ kind: "retryable" });
  });
});

/**
 * The shared reserved-key refusal. `mapFindOutcome` spreads this body into
 * `{ status: "ok", ...outcome.found, ...wiringAdvisories(api) }`, so a body
 * declaring `status` would replace the plugin's dispatch key and one declaring
 * `advisories` would drop the plugin's own field. The reservation is the SHARED
 * one (`declaresEnvelopeKey`) — the fifth route inherits it rather than
 * re-deriving it, and this file proves the fifth route actually got it.
 */
describe("the reserved ENVELOPE keys — a body declaring one is refused, never merged", () => {
  it.each([
    ["status", "partial"],
    ["advisories", [{ id: "route.side_channel", severity: "warn" }]],
  ])("a 200 declaring a top-level `%s` is `retryable`, never `ok`", (key, value) => {
    expect(classifyDomainFindResponse(200, { ...domainFindGolden(), [key]: value })).toEqual({
      kind: "retryable",
    });
  });

  it.each(["status", "advisories"])("PRESENCE bites — a falsy `%s` is refused too", (key) => {
    for (const value of [null, ""]) {
      expect(classifyDomainFindResponse(200, { ...domainFindGolden(), [key]: value })).toEqual({
        kind: "retryable",
      });
    }
  });

  it("guard-of-the-guard: the SAME body WITHOUT the reserved key is `ok`", () => {
    expect(classifyDomainFindResponse(200, { ...domainFindGolden() }).kind).toBe("ok");
  });

  it("an unrelated additive TOP-LEVEL key is STILL `ok` — two reserved names, not a whitelist", () => {
    expect(
      classifyDomainFindResponse(200, { ...domainFindGolden(), notice: "an additive member" }).kind,
    ).toBe("ok");
  });
});

describe("the 400 — BOTH refusal paths surface verbatim, and neither is rewritten", () => {
  it.each([
    ["neither `q` nor `path`", FIND_400_NEITHER],
    ["both `q` and `path`", FIND_400_BOTH],
    ["an unsupported knob, named by the validator", FIND_400_UNSUPPORTED],
  ])("a 400 for %s carries `{ error, message }` verbatim", (_label, body) => {
    expect(classifyDomainFindResponse(400, body)).toEqual({
      kind: "invalid_request",
      error: body.error,
      message: body.message,
    });
  });

  it("the two mode refusals stay DISTINGUISHABLE — the message is the agent's whole recourse", () => {
    // Each is the other's control: a classifier that synthesised its own message
    // (or truncated to the shared contract sentence) would collapse them into
    // one, and the agent could no longer tell "you sent nothing" from "you sent
    // two things".
    const neither = classifyDomainFindResponse(400, FIND_400_NEITHER);
    const both = classifyDomainFindResponse(400, FIND_400_BOTH);
    if (neither.kind !== "invalid_request" || both.kind !== "invalid_request") {
      throw new Error("expected invalid_request");
    }
    expect(neither.message).not.toBe(both.message);
    expect(neither.message).toContain("you sent neither");
    expect(both.message).toContain("you sent both");
  });

  it("a 400 carries NO recovery hint and NO retry hint", () => {
    // Re-sending the same querystring cannot succeed, and auth is fine.
    const outcome = classifyDomainFindResponse(400, FIND_400_NEITHER);
    expect(outcome).not.toHaveProperty("recovery");
    expect(outcome).not.toHaveProperty("source");
    expect(outcome.kind).not.toBe("retryable");
  });
});

describe("the shared arms — identical to the other four sil-api routes", () => {
  it("401 → unauthorized; 403 → forbidden with the reason; 503 → retryable", () => {
    expect(classifyDomainFindResponse(401, AUTH.unauthorized)).toEqual({ kind: "unauthorized" });
    expect(classifyDomainFindResponse(403, AUTH.userNotProvisioned)).toEqual({
      kind: "forbidden",
      reason: "user_not_provisioned",
    });
    expect(classifyDomainFindResponse(403, AUTH.principalMismatch)).toEqual({
      kind: "forbidden",
      reason: "principal_mismatch",
    });
    expect(classifyDomainFindResponse(503, AUTH.serviceUnavailable).kind).toBe("retryable");
  });

  it.each([500, 502, 504])("%d → retryable", (status) => {
    expect(classifyDomainFindResponse(status, { error: "boom" }).kind).toBe("retryable");
  });

  it("a 5xx naming a degraded SOURCE carries the attribution", () => {
    expect(
      classifyDomainFindResponse(503, {
        error: "source_unavailable",
        source: "registry",
        message: "registry read timed out",
      }),
    ).toEqual({ kind: "retryable", source: "registry", detail: "registry read timed out" });
  });

  it("a 404 is `retryable` and NOT an absence — this route has no `not_found` arm", () => {
    // An absent domain is a 200 stating `exists: false`. A 404 here means the
    // route itself is not there, which is a deployment fact, not an answer about
    // the registry — and reading it as "nothing stands here" would license a
    // mint off a missing route.
    expect(classifyDomainFindResponse(404, { error: "not_found", message: "no route" })).toEqual({
      kind: "retryable",
    });
  });

  it("a 409 is `retryable` — the read writes nothing, so it can collide with nothing", () => {
    expect(classifyDomainFindResponse(409, { error: "domain_exists", message: "x" })).toEqual({
      kind: "retryable",
    });
  });
});
