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
 *      (`{ name, addresses }`, possibly wrapped in a UCP envelope's `result`).
 *      The CURRENT sil-api `/identity` STUB returns
 *      `{ kind, verified, subject, attributes, note }` — NO name, NO addresses
 *      (Signals: the real PII read is latent on a sil-services follow-on). That
 *      stub 200 MUST NOT classify as `ok`: if it did, the suite could go green
 *      while the product promise (return the user's real name + addresses) is
 *      unmet. A partial/garbage 200 falls to `retryable` (a malformed success is
 *      a server fault, not a terminal auth state), never to a false `ok`.
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts`:
 *   classifyIdentityResponse(status: number, body: unknown): IdentityOutcome
 *   where IdentityOutcome is a discriminated union on `kind`:
 *     | { kind: "ok"; identity: { name: string; addresses: unknown[] } }
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

/** The agreed REAL identity-read contract (the sil-services follow-on target):
 * the authenticated user's name + addresses. Bare shape. */
const REAL_IDENTITY = {
  name: "Ada Lovelace",
  addresses: [
    { line1: "12 Analytical Engine Way", city: "London", country: "GB" },
  ],
};

/** The same identity wrapped in sil-api's current UCP envelope (architect
 * resolution: POST /identity returns the envelope with identity in `result`). */
const ENVELOPED_IDENTITY = {
  protocol: "ucp",
  version: "0.1",
  domain: "identity",
  result: REAL_IDENTITY,
};

/** The CURRENT sil-api /identity STUB payload — NO name, NO addresses. The
 * tool must never read this as a real identity. */
const STUB_BODY = {
  kind: "identity",
  verified: true,
  subject: "auth0|abc",
  attributes: {},
  note: "stub",
};

/** sil-api returns addresses in its `AddressWire` shape (`street_address`,
 * `address_locality`, `postal_code`, `address_country`, … — sil-services
 * `packages/schemas/src/identity.ts`), NOT the `IdentityAddress` hint fields
 * (`line1`/`city`/…). The classifier must pass addresses through OPAQUE — never
 * remap fields, which would silently drop real address data. */
const WIRE_ADDRESS = {
  street_address: "12 Analytical Engine Way",
  address_locality: "London",
  postal_code: "EC1A 1AA",
  address_country: "GB",
};

describe("classifyIdentityResponse — status taxonomy (the auth branch)", () => {
  it("200 with a real identity body → ok (carries the identity)", () => {
    const out = classifyIdentityResponse(200, REAL_IDENTITY);
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.identity.name).toBe("Ada Lovelace");
      expect(Array.isArray(out.identity.addresses)).toBe(true);
      expect(out.identity.addresses.length).toBe(1);
    }
  });

  it("200 with a non-empty addresses array → ok, addresses pass through OPAQUE (AddressWire fields preserved, not remapped)", () => {
    // Acceptance criterion: addresses are passed through opaquely — the sil-api
    // `AddressWire` field names survive verbatim. A classifier that remapped to
    // `line1`/`city`/… would drop these and this assertion catches it.
    const out = classifyIdentityResponse(200, {
      name: "Ada Lovelace",
      addresses: [WIRE_ADDRESS],
    });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.identity.addresses).toHaveLength(1);
      const addr = out.identity.addresses[0] as Record<string, unknown>;
      // The wire field names are preserved verbatim (opaque passthrough).
      expect(addr["street_address"]).toBe("12 Analytical Engine Way");
      expect(addr["address_locality"]).toBe("London");
      expect(addr["postal_code"]).toBe("EC1A 1AA");
      expect(addr["address_country"]).toBe("GB");
    }
  });

  it("200 with the identity wrapped in a UCP envelope → ok (unwraps result)", () => {
    const out = classifyIdentityResponse(200, ENVELOPED_IDENTITY);
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.identity.name).toBe("Ada Lovelace");
      expect(out.identity.addresses).toHaveLength(1);
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
    // live sil-api /identity stub returns no name + no addresses. If a tool wired
    // against the stub could read it as `ok`, the suite would pass while the
    // product promise (real identity) is unmet. The stub body must NOT be `ok`.
    const out = classifyIdentityResponse(200, STUB_BODY);
    expect(out.kind).not.toBe("ok");
  });

  it("200 wrapping the STUB body in an envelope `result` is still NOT ok", () => {
    // Defends the same gate after the unwrap step — a wrapped stub is still a
    // stub (no name/addresses), and must not slip through as `ok`.
    const out = classifyIdentityResponse(200, {
      protocol: "ucp",
      domain: "identity",
      result: STUB_BODY,
    });
    expect(out.kind).not.toBe("ok");
  });

  it("200 with a name and an EMPTY addresses array → ok (empty address list is a valid identity)", () => {
    // THE forced product decision for this card (was deferred on the sil-whoami
    // card; sil-api PR #7 makes it concrete by returning `addresses: []` for a
    // provisioned, address-less user). A valid `name` with zero addresses IS a
    // usable identity — telling that user "temporarily unavailable, try again"
    // is a false-transient dead-end they can never escape by retrying.
    //
    // EXPECT RED against the pre-fix `extractIdentity` (which rejects
    // `addresses.length === 0`); GREEN only after that reject is removed.
    const out = classifyIdentityResponse(200, { name: "Ada Lovelace", addresses: [] });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.identity.name).toBe("Ada Lovelace");
      expect(Array.isArray(out.identity.addresses)).toBe(true);
      expect(out.identity.addresses).toHaveLength(0);
    }
  });

  it("200 with a name and an empty addresses array wrapped in an envelope `result` → ok", () => {
    // The same relax through the UCP-envelope unwrap path — the real sil-api
    // `GET /identity` returns `{ result: { id, name, addresses: [] } }`.
    const out = classifyIdentityResponse(200, {
      protocol: "ucp",
      version: "0.1",
      domain: "identity",
      result: { id: "u_1", name: "Ada Lovelace", addresses: [] },
    });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.identity.name).toBe("Ada Lovelace");
      expect(out.identity.addresses).toHaveLength(0);
    }
  });

  it("200 with a name but a MISSING `addresses` field is NOT ok (addresses must be an array)", () => {
    // The relax is `addresses` may be EMPTY, NOT absent: a body with no
    // `addresses` key at all is a malformed/partial read (the GET self-read
    // always populates `addresses`, even to `[]`), so it stays `retryable`. This
    // keeps the gate from sliding from "empty array OK" to "any name-only body OK".
    const out = classifyIdentityResponse(200, { name: "Ada Lovelace" });
    expect(out.kind).not.toBe("ok");
  });

  it("200 with a name but a NON-ARRAY `addresses` (e.g. null / object / string) is NOT ok", () => {
    // The `Array.isArray` half of the gate stays: a non-array `addresses` is a
    // malformed body, not an empty list. Only a genuine empty ARRAY is relaxed.
    expect(classifyIdentityResponse(200, { name: "Ada", addresses: null }).kind).not.toBe("ok");
    expect(classifyIdentityResponse(200, { name: "Ada", addresses: {} }).kind).not.toBe("ok");
    expect(classifyIdentityResponse(200, { name: "Ada", addresses: "nope" }).kind).not.toBe("ok");
  });

  it("200 with addresses but NO name is NOT ok (the name gate is non-negotiable)", () => {
    // The `name` requirement is the load-bearing anti-false-green guard and
    // survives the relax unchanged — a body with addresses but no name (and the
    // empty-array case below) must still be `retryable`, never `ok`.
    expect(classifyIdentityResponse(200, { addresses: [{ line1: "x" }] }).kind).not.toBe("ok");
    expect(classifyIdentityResponse(200, { addresses: [] }).kind).not.toBe("ok");
    expect(classifyIdentityResponse(200, { name: "", addresses: [] }).kind).not.toBe("ok");
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
