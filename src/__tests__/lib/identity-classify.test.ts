/**
 * UNIT — sil-api identity response classifier (tier: unit, no network).
 *
 * The highest-risk PURE branch in `sil_whoami` (architect handoff step 3 +
 * Risk "401 vs 403 conflation" + the PO's "latent-endpoint confusion"
 * false-green). The identity read resolves to exactly one of four outcomes,
 * and the WHOLE auth choreography (refresh-on-401, terminal-on-403,
 * retry-on-5xx) hangs off which one — so the mapping must be pinned in
 * isolation, exactly like `classifyClaimResponse`/`classifyRefreshResponse`.
 *
 * Two distinct things this classifier must get right, both load-bearing:
 *
 *   1. STATUS taxonomy — the auth branch:
 *        200 (+ a REAL identity body)              → ok
 *        401 (expired/invalid/missing token)       → unauthorized  (→ refresh)
 *        403 user_not_provisioned                  → forbidden{reason} (terminal)
 *        403 principal_mismatch                    → forbidden{reason} (terminal)
 *        5xx / non-classifiable                    → retryable
 *      401 (refreshable) and 403 (NOT refreshable) MUST be split — refreshing a
 *      valid-but-unprovisioned token changes nothing, so a 403 that read as
 *      `unauthorized` would burn a pointless refresh and still fail.
 *
 *   2. BODY gate on 200 — the anti-false-green:
 *      a 200 is `ok` ONLY if the body carries the agreed real identity
 *      (`{ name, … }`, possibly wrapped in a UCP envelope's `result`).
 *      The CURRENT sil-api `/identity` STUB returns
 *      `{ kind, verified, subject, attributes, note }` — NO name. That
 *      stub 200 MUST NOT classify as `ok`: if it did, the suite could go green
 *      while the product promise (return the user's real name) is
 *      unmet. A partial/garbage 200 falls to `retryable` (a malformed success is
 *      a server fault, not a terminal auth state), never to a false `ok`.
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts`:
 *   classifyIdentityResponse(status: number, body: unknown): IdentityOutcome
 *   where IdentityOutcome is a discriminated union on `kind`:
 *     | { kind: "ok"; identity: { name: string; address?: … } }
 *     | { kind: "unauthorized" }
 *     | { kind: "forbidden"; reason: "user_not_provisioned" | "principal_mismatch" | string }
 *     | { kind: "retryable" }
 *   The classifier branches on `status` (and, for 200, the body shape) — NEVER
 *   on `res.ok`. It accepts identity either bare or unwrapped from a UCP
 *   envelope's `result` (the tool surfaces identity, not transport metadata).
 *   (If the dev sites the classifier elsewhere, re-export it from sil-client.ts
 *   so this isolation test still binds — the classifier is the immutable spec.)
 */

import { describe, it, expect } from "vitest";

import { classifyIdentityResponse } from "../../lib/sil-client.js";

/** sil-api's lean identity read: the name plus the default address. Bare shape. */
const REAL_IDENTITY = {
  name: "Ada Lovelace",
  address: { label: "Home", locality: "London", country: "GB" },
};

/** The same identity wrapped in sil-api's current UCP envelope (architect
 * resolution: POST /identity returns the envelope with identity in `result`). */
const ENVELOPED_IDENTITY = {
  protocol: "ucp",
  version: "0.1",
  domain: "identity",
  result: REAL_IDENTITY,
};

/** The CURRENT sil-api /identity STUB payload — NO name. The
 * tool must never read this as a real identity. */
const STUB_BODY = {
  kind: "identity",
  verified: true,
  subject: "auth0|abc",
  attributes: {},
  note: "stub",
};

describe("classifyIdentityResponse — status taxonomy (the auth branch)", () => {
  it("200 with a real identity body → ok (carries the identity)", () => {
    const out = classifyIdentityResponse(200, REAL_IDENTITY);
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.identity.name).toBe("Ada Lovelace");
      expect(out.identity.address).toEqual({ label: "Home", locality: "London", country: "GB" });
    }
  });

  it("200 → a name alone is a valid identity, and a malformed `address` is dropped", () => {
    // A buyer sil holds nothing else on must not be stranded on a `retryable` no retry clears.
    const bare = classifyIdentityResponse(200, { name: "Ada Lovelace" });
    expect(bare).toEqual({ kind: "ok", identity: { name: "Ada Lovelace" } });

    const garbage = classifyIdentityResponse(200, { name: "Ada Lovelace", address: "London" });
    expect(garbage).toEqual({ kind: "ok", identity: { name: "Ada Lovelace" } });
  });

  it("200 → `country` passes through when the read carries a string, and is ABSENT otherwise", () => {
    // The contract's "knows where the buyer is". A country the read does not carry
    // must not be invented — an agent would localize a search to a guess.
    const withCountry = classifyIdentityResponse(200, {
      ...REAL_IDENTITY,
      country: "GB",
    });
    expect(withCountry.kind).toBe("ok");
    if (withCountry.kind === "ok") expect(withCountry.identity.country).toBe("GB");

    const without = classifyIdentityResponse(200, REAL_IDENTITY);
    expect(without.kind).toBe("ok");
    if (without.kind === "ok") {
      expect(without.identity).not.toHaveProperty("country");
    }

    // A non-string is dropped rather than coerced: `country: 826` must not reach
    // the agent as "826" or as `true`.
    const nonString = classifyIdentityResponse(200, { ...REAL_IDENTITY, country: 826 });
    expect(nonString.kind).toBe("ok");
    if (nonString.kind === "ok") expect(nonString.identity).not.toHaveProperty("country");
  });

  it.each([
    ["gender", "male"],
    ["currency", "EUR"],
    ["language", "el"],
  ])("200 → `%s` passes through when the read carries a string, and is ABSENT otherwise", (field, value) => {
    // The skill reads each off this one field — `gender eq mens` on anything worn, a money
    // row with no `currency` meaning this one — so a classifier that drops it makes the
    // tool description a promise the tool breaks, and the agent asks what sil answered.
    const withField = classifyIdentityResponse(200, { ...REAL_IDENTITY, [field]: value });
    expect(withField.kind).toBe("ok");
    if (withField.kind === "ok") expect(withField.identity).toHaveProperty(field, value);

    // Never stated: absent, never defaulted.
    const without = classifyIdentityResponse(200, REAL_IDENTITY);
    expect(without.kind).toBe("ok");
    if (without.kind === "ok") expect(without.identity).not.toHaveProperty(field);

    const nonString = classifyIdentityResponse(200, { ...REAL_IDENTITY, [field]: 1 });
    expect(nonString.kind).toBe("ok");
    if (nonString.kind === "ok") expect(nonString.identity).not.toHaveProperty(field);
  });

  it("200 with the identity wrapped in a UCP envelope → ok (unwraps result)", () => {
    const out = classifyIdentityResponse(200, ENVELOPED_IDENTITY);
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.identity.name).toBe("Ada Lovelace");
      expect(out.identity.address).toBeDefined();
    }
  });

  it("401 → unauthorized (the refresh-and-retry trigger)", () => {
    const out = classifyIdentityResponse(401, { error: "unauthorized" });
    expect(out.kind).toBe("unauthorized");
  });

  it("403 user_not_provisioned → forbidden carrying the reason (terminal)", () => {
    const out = classifyIdentityResponse(403, { error: "user_not_provisioned" });
    expect(out.kind).toBe("forbidden");
    if (out.kind === "forbidden") {
      expect(out.reason).toBe("user_not_provisioned");
    }
  });

  it("403 principal_mismatch → forbidden carrying the reason (terminal)", () => {
    const out = classifyIdentityResponse(403, { error: "principal_mismatch" });
    expect(out.kind).toBe("forbidden");
    if (out.kind === "forbidden") {
      expect(out.reason).toBe("principal_mismatch");
    }
  });

  it("splits 401 (refreshable) from 403 (NOT refreshable) — they never share a kind", () => {
    // The cardinal auth-branch distinction: refreshing a 403 is pointless, so
    // 403 must NOT read as `unauthorized`. If these collapse, the tool burns a
    // refresh on an unprovisioned token and still fails.
    const k401 = classifyIdentityResponse(401, {}).kind;
    const k403 = classifyIdentityResponse(403, { error: "user_not_provisioned" }).kind;
    expect(k401).toBe("unauthorized");
    expect(k403).toBe("forbidden");
    expect(k401).not.toBe(k403);
  });
});

describe("classifyIdentityResponse — retryable (transient) failures", () => {
  it("500/502/503/504 → retryable (a 5xx blip is not terminal, not auth)", () => {
    for (const code of [500, 502, 503, 504]) {
      expect(classifyIdentityResponse(code, {}).kind).toBe("retryable");
    }
  });

  it("a 5xx is NOT misclassified as unauthorized or forbidden", () => {
    // A transient server fault must not trigger a refresh (unauthorized) nor a
    // terminal re-register/onboard hint (forbidden) — it must stay retryable so
    // the agent is told "try again", never "re-register".
    const out = classifyIdentityResponse(503, {});
    expect(out.kind).toBe("retryable");
    expect(["unauthorized", "forbidden", "ok"]).not.toContain(out.kind);
  });
});

describe("classifyIdentityResponse — the anti-false-green body gate on 200", () => {
  it("200 with the CURRENT sil-api STUB body ({kind,verified,subject,...}) is NOT ok", () => {
    // The load-bearing false-green guard (PO "latent-endpoint confusion"): the
    // live sil-api /identity stub returns no name. If a tool wired
    // against the stub could read it as `ok`, the suite would pass while the
    // product promise (real identity) is unmet. The stub body must NOT be `ok`.
    const out = classifyIdentityResponse(200, STUB_BODY);
    expect(out.kind).not.toBe("ok");
  });

  it("200 wrapping the STUB body in an envelope `result` is still NOT ok", () => {
    // Defends the same gate after the unwrap step — a wrapped stub is still a
    // stub (no name), and must not slip through as `ok`.
    const out = classifyIdentityResponse(200, {
      protocol: "ucp",
      domain: "identity",
      result: STUB_BODY,
    });
    expect(out.kind).not.toBe("ok");
  });

  it("200 with an address but NO name is NOT ok (the name gate is non-negotiable)", () => {
    // The `name` requirement is the load-bearing anti-false-green guard and
    // is non-negotiable — a body with an address but no name must still be `retryable`.
    expect(classifyIdentityResponse(200, { address: { locality: "x", country: "GB" } }).kind).not.toBe("ok");
    expect(classifyIdentityResponse(200, { name: "" }).kind).not.toBe("ok");
  });

  it("200 with an empty / null / non-object body is NOT ok (defensive)", () => {
    // A malformed 200 is a server fault, not a real identity — it must never be
    // mistaken for a clean `ok`.
    expect(classifyIdentityResponse(200, {}).kind).not.toBe("ok");
    expect(classifyIdentityResponse(200, null).kind).not.toBe("ok");
    expect(classifyIdentityResponse(200, "not-an-object").kind).not.toBe("ok");
  });

  it("does NOT branch on res.ok — a 200 stub and a 200 real identity differ only by body", () => {
    // Same status (200), opposite outcomes — proves the discriminant for `ok`
    // is the identity SHAPE in the body, not the HTTP status.
    expect(classifyIdentityResponse(200, REAL_IDENTITY).kind).toBe("ok");
    expect(classifyIdentityResponse(200, STUB_BODY).kind).not.toBe("ok");
  });
});
