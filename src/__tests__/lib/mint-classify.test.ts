/**
 * UNIT — `classifyMintResponse` (tier: unit, <100 ms, no I/O).
 *
 * The mint is v0's ONE registry write path and it is PERMANENT: there is no
 * delete route, no upsert, and an existing path is refused rather than changed.
 * That makes the 409 the most consequential non-200 on the whole surface — read
 * as a failure it invites the agent to mint a near-path variant, which forks the
 * taxonomy forever and no tool can undo. So `already_exists` is a NEW status
 * class (A5), it carries the path the agent must re-search, and nothing about it
 * is framed as an error.
 *
 * The 200 has exactly one job beyond echoing: carry `validated_at: null`
 * EXPLICITLY. A minted domain is born FENCED — the catalog leg does not run,
 * every predicate reports `applied: false`, results come back `maturity: "web"`.
 * That is a fence, not an empty catalog, and the agent can only say so once if
 * the signal survives the tool boundary.
 *
 * `classifyMintResponse` takes the SUBMITTED path as a third argument because
 * the route's 409 body carries none (`handlers/domains.ts:50`).
 */

import { describe, it, expect } from "vitest";
import { classifyMintResponse } from "../../lib/sil-client.js";
import { AUTH, MINT_409, mintGolden } from "../helpers/v0-wire.js";

const PATH = "product.sports.winter.ski.boots";

describe("the 200 — the provisional signal survives, explicitly", () => {
  it("classifies `ok` and carries the mint result verbatim", () => {
    const wire = mintGolden();
    const outcome = classifyMintResponse(200, wire, PATH);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.domain).toEqual(wire);
  });

  it("`validated_at: null` is PRESENT, not stripped as a falsy nothing", () => {
    // A born-fenced domain that reads as un-fenced is how the agent mistakes a
    // fence for an empty catalog and re-mints around it.
    const outcome = classifyMintResponse(200, mintGolden(), PATH);
    if (outcome.kind !== "ok") throw new Error("expected ok");
    expect(outcome.domain).toHaveProperty("validated_at");
    expect(outcome.domain.validated_at).toBeNull();
  });

  it("the minted spec keys cross intact, in order", () => {
    const outcome = classifyMintResponse(200, mintGolden(), PATH);
    if (outcome.kind !== "ok") throw new Error("expected ok");
    expect(outcome.domain.specs).toEqual(["flex_index", "last_width_mm", "brand"]);
  });

  it("a mint with zero coined specs is still `ok` — presence, never length", () => {
    const outcome = classifyMintResponse(200, { ...mintGolden(), specs: [] }, PATH);
    expect(outcome.kind).toBe("ok");
  });

  it.each([
    ["`path` missing", { validated_at: null, specs: [] }],
    ["`path` not a string", { path: 3, validated_at: null, specs: [] }],
    ["`validated_at` missing", { path: PATH, specs: [] }],
    ["`validated_at` not null (a validated domain cannot be born)", { path: PATH, validated_at: "2026-01-01T00:00:00.000Z", specs: [] }],
    ["`specs` missing", { path: PATH, validated_at: null }],
    ["`specs` not an array", { path: PATH, validated_at: null, specs: {} }],
    ["`specs` carrying a non-string", { path: PATH, validated_at: null, specs: ["ok", 7] }],
  ])("a 200 with %s is `retryable`, never `ok`", (_label, body) => {
    expect(classifyMintResponse(200, body, PATH)).toEqual({ kind: "retryable" });
  });

  it("a 200 that is not an object is `retryable`", () => {
    for (const body of [null, undefined, [], "minted", 1]) {
      expect(classifyMintResponse(200, body, PATH)).toEqual({ kind: "retryable" });
    }
  });
});

describe("A5 — `already_exists` is a NEW status, and it is NOT a failure", () => {
  it("a 409 classifies `already_exists`, carrying the SUBMITTED path", () => {
    const outcome = classifyMintResponse(409, MINT_409, PATH);
    expect(outcome.kind).toBe("already_exists");
    if (outcome.kind !== "already_exists") throw new Error("unreachable");
    expect(outcome.path).toBe(PATH);
    expect(outcome.message).toBe(MINT_409.message);
  });

  it("the path comes from the REQUEST — the 409 body carries none", () => {
    // `handlers/domains.ts:50` sends `{ error: "domain_exists", message }` only.
    // A path lifted from the body would be `undefined`, and the agent's whole
    // recovery is "re-issue the search on the SAME path".
    expect(MINT_409).not.toHaveProperty("path");
    const other = "product.sports.winter.ski.poles";
    const outcome = classifyMintResponse(409, MINT_409, other);
    if (outcome.kind !== "already_exists") throw new Error("expected already_exists");
    expect(outcome.path).toBe(other);
  });

  it("a 409 is NOT `invalid_request` — the request was correct, the category exists", () => {
    expect(classifyMintResponse(409, MINT_409, PATH).kind).not.toBe("invalid_request");
  });

  it("a 409 is NOT `retryable` — re-minting the same path can never succeed", () => {
    expect(classifyMintResponse(409, MINT_409, PATH).kind).not.toBe("retryable");
  });

  it("a 409 is NOT an auth outcome", () => {
    const kind = classifyMintResponse(409, MINT_409, PATH).kind;
    expect(kind).not.toBe("unauthorized");
    expect(kind).not.toBe("forbidden");
  });

  it("`already_exists` and `not_found`-style terminals stay distinct from `ok`", () => {
    expect(classifyMintResponse(409, MINT_409, PATH).kind).not.toBe(
      classifyMintResponse(200, mintGolden(), PATH).kind,
    );
  });
});

describe("the shared arms", () => {
  it("400 surfaces the grammar refusal verbatim — the message names the offending spec", () => {
    const body = {
      error: "invalid_request",
      message: 'spec "flex_index": a number spec must declare a unit',
    };
    expect(classifyMintResponse(400, body, PATH)).toEqual({
      kind: "invalid_request",
      error: "invalid_request",
      message: body.message,
    });
  });

  it("400 MissingRoot surfaces verbatim too — a path must descend from a registry root", () => {
    const body = {
      error: "invalid_request",
      message: 'no registry root for path "zzz.ski.boots"',
    };
    const outcome = classifyMintResponse(400, body, "zzz.ski.boots");
    if (outcome.kind !== "invalid_request") throw new Error("expected invalid_request");
    expect(outcome.message).toBe(body.message);
  });

  it("401 → unauthorized; 403 → forbidden with the reason; 503 → retryable", () => {
    expect(classifyMintResponse(401, AUTH.unauthorized, PATH)).toEqual({ kind: "unauthorized" });
    expect(classifyMintResponse(403, AUTH.userNotProvisioned, PATH)).toEqual({
      kind: "forbidden",
      reason: "user_not_provisioned",
    });
    expect(classifyMintResponse(503, AUTH.serviceUnavailable, PATH).kind).toBe("retryable");
  });

  it("A6 — 422 falls to retryable; no `source_rejected` arm exists", () => {
    expect(classifyMintResponse(422, { error: "source_rejected" }, PATH)).toEqual({
      kind: "retryable",
    });
  });

  it.each([500, 502, 504])("%d → retryable", (status) => {
    expect(classifyMintResponse(status, { error: "boom" }, PATH).kind).toBe("retryable");
  });
});
