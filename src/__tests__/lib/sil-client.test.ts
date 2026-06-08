/**
 * UNIT — claim/refresh response classifier (tier: unit, no network).
 *
 * THE highest-risk SUBTLE bug in this card (architect Risk #4 / the
 * "200-pending vs 200-success" trap). The claim endpoint returns HTTP
 * **200 for BOTH** "keep polling" (`{ status: "pending" }`) and "success"
 * (`{ access_token, refresh_token, user }`) — see
 * `sil-services/.../claim/route.ts:100,134`. Branching on `res.ok` or the
 * status code alone conflates them: a poller that treats every 200 as
 * success persists a `{status:"pending"}` body as if it were tokens; one
 * that treats every 200 as pending never terminates. The discriminant
 * MUST be the PRESENCE of `access_token` in the body, not the status code.
 *
 * This file pins the pure classifier in isolation (the architect's
 * handoff step 3 calls for exactly this focused unit test). The full
 * fetch→classify→persist lifecycle is proven at the integration tier
 * (`register-claim.integration.test.ts`), where only `fetch` is mocked.
 *
 * Wire shapes pinned to the ALREADY-MERGED contract
 * (`sil-services/cards/done/2026/sil-web-auth-endpoints.md` +
 * `claim/route.ts` / `auth/refresh/route.ts`):
 *   claim   200 {access_token,refresh_token,user} → success
 *   claim   200 {status:"pending"}                → pending (keep polling)
 *   claim   409 {error:"already_claimed"}         → already_claimed (terminal)
 *   claim   410 {error:"session_expired"}         → expired (terminal)
 *   claim   404 {error:"not_found"}               → not_found (terminal)
 *   claim   5xx / network throw                   → retryable
 *   refresh 200 {access_token,refresh_token}      → success
 *   refresh 401 {error:"invalid_grant"}           → invalid_grant (terminal)
 *
 * Contract this file pins for the implementation (expert-developer),
 * per the In-Dev handoff (`src/lib/sil-client.ts`):
 *   - classifyClaimResponse(status: number, body: unknown): ClaimOutcome
 *     a discriminated union on `kind`:
 *       | { kind: "success"; access_token; refresh_token; user }
 *       | { kind: "pending" }
 *       | { kind: "already_claimed" }
 *       | { kind: "expired" }
 *       | { kind: "not_found" }
 *       | { kind: "retryable" }
 * (If the dev folds this into identity.ts instead of a sil-client.ts
 * module, re-export `classifyClaimResponse` so this isolation test still
 * binds — the classifier itself is the immutable spec, not its file.)
 */

import { describe, it, expect } from "vitest";

import { classifyClaimResponse } from "../../lib/sil-client.js";

/** A well-formed success body per claim/route.ts:134-138. */
const SUCCESS_BODY = {
  access_token: "at-success",
  refresh_token: "rt-success",
  user: { id: "user-1" },
};

describe("classifyClaimResponse — the 200-pending vs 200-success split", () => {
  it("200 WITH access_token → success (carries the token pair + user)", () => {
    const out = classifyClaimResponse(200, SUCCESS_BODY);
    expect(out.kind).toBe("success");
    if (out.kind === "success") {
      expect(out.access_token).toBe("at-success");
      expect(out.refresh_token).toBe("rt-success");
      expect(out.user).toEqual({ id: "user-1" });
    }
  });

  it("200 WITHOUT access_token ({status:'pending'}) → pending, NOT success", () => {
    // The load-bearing distinction: a 200 pending body must never be read
    // as success. This is the bug that would persist a non-credential as
    // tokens.
    const out = classifyClaimResponse(200, { status: "pending" });
    expect(out.kind).toBe("pending");
  });

  it("does NOT branch on res.ok — a 200 pending and a 200 success differ only by body", () => {
    // Same status code (200), opposite outcomes — proves the discriminant
    // is the body, not the HTTP status.
    expect(classifyClaimResponse(200, SUCCESS_BODY).kind).toBe("success");
    expect(classifyClaimResponse(200, { status: "pending" }).kind).toBe(
      "pending",
    );
  });

  it("200 with an empty/garbage body (no access_token) → pending, never success", () => {
    // Defensive: a malformed 200 must fall to the safe non-terminal path,
    // not be mistaken for a token-bearing success.
    expect(classifyClaimResponse(200, {}).kind).toBe("pending");
    expect(classifyClaimResponse(200, null).kind).toBe("pending");
    expect(classifyClaimResponse(200, "not-an-object").kind).toBe("pending");
  });

  it("200 with access_token but missing refresh_token is NOT a clean success", () => {
    // A success MUST carry both tokens (the refresh token is what SC7
    // rotation needs). A half-token 200 must not be persisted as if whole.
    const out = classifyClaimResponse(200, {
      access_token: "at-only",
      user: { id: "u" },
    });
    expect(out.kind).not.toBe("success");
  });
});

describe("classifyClaimResponse — terminal status codes", () => {
  it("409 → already_claimed (terminal, no tokens)", () => {
    const out = classifyClaimResponse(409, { error: "already_claimed" });
    expect(out.kind).toBe("already_claimed");
  });

  it("410 → expired (terminal)", () => {
    const out = classifyClaimResponse(410, { error: "session_expired" });
    expect(out.kind).toBe("expired");
  });

  it("404 → not_found (terminal; the uniform wrong-verifier/unknown-session code)", () => {
    const out = classifyClaimResponse(404, { error: "not_found" });
    expect(out.kind).toBe("not_found");
  });

  it("keeps 409/410/404 DISTINCT (each maps to its own terminal kind)", () => {
    // The agent-facing copy differs per terminal state; collapsing them
    // loses the recovery hint. Assert no two share a kind.
    const kinds = new Set([
      classifyClaimResponse(409, {}).kind,
      classifyClaimResponse(410, {}).kind,
      classifyClaimResponse(404, {}).kind,
    ]);
    expect(kinds.size).toBe(3);
  });
});

describe("classifyClaimResponse — retryable (transient) failures", () => {
  it("500 → retryable (a 5xx blip is not terminal)", () => {
    expect(classifyClaimResponse(500, {}).kind).toBe("retryable");
  });

  it("502/503/504 → retryable", () => {
    expect(classifyClaimResponse(502, {}).kind).toBe("retryable");
    expect(classifyClaimResponse(503, {}).kind).toBe("retryable");
    expect(classifyClaimResponse(504, {}).kind).toBe("retryable");
  });

  it("a 5xx is NOT misclassified as a terminal failure", () => {
    // The product risk: a transient 5xx must not end the flow as if the
    // session were dead. It must stay retryable so the budget governs.
    const out = classifyClaimResponse(503, {});
    expect(["expired", "not_found", "already_claimed"]).not.toContain(out.kind);
  });
});
