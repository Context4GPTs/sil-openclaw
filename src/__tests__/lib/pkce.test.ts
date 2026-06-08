/**
 * UNIT — PKCE primitives (tier: unit, <100ms, no I/O, no network).
 *
 * THE single highest-risk correctness point in this card (architect Risk
 * #1 / SC1·F1). The plugin's `deriveChallenge` MUST reproduce sil-web's
 * `src/lib/pkce.ts` byte-for-byte: the agent stores the verifier and
 * sends only the S256 *challenge* to /authorize; the claim endpoint
 * compares digest-to-digest (`claim/route.ts:60-68`). A one-byte drift —
 * wrong encoding, padding, or hashing the challenge instead of the
 * verifier — makes every claim return a UNIFORM 404 that is, by design,
 * indistinguishable from an unknown session (`claim/route.ts:86`, no
 * existence oracle). It would pass a happy-path smoke and fail silently
 * in production. So we pin the derivation against a FIXED vector lifted
 * from sil-web's own test (`sil-services/apps/sil-web/src/lib/__tests__/
 * pkce.test.ts`) AND cross-check against an independent node:crypto
 * derivation in-test, so the assertion is not circular with the code
 * under test.
 *
 * Contract this file pins for the implementation (expert-developer),
 * per the In-Dev handoff (`src/lib/pkce.ts`, node:crypto, no new dep):
 *   - deriveChallenge(verifier): string  — S256 base64url, exactly 43 ch
 *   - newVerifier(): string              — fresh high-entropy base64url
 *   - newSessionId(): string             — fresh RFC-4122 UUID
 * The first is the load-bearing one; the latter two are pinned to the
 * sil-web format gates (`isValidCodeChallenge` / `isValidSessionId`) so a
 * verifier or session id the plugin mints can never be rejected by
 * /authorize.
 */

import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";

import {
  deriveChallenge,
  newSessionId,
  newVerifier,
} from "../../lib/pkce.js";

/**
 * The canonical PKCE S256 fixture. Verifier → challenge is the RFC 7636
 * Appendix B published vector, and it is THE SAME vector sil-web pins in
 * `src/lib/__tests__/pkce.test.ts`. If the plugin and sil-web ever derive
 * a different challenge for this verifier, the live claim breaks — this is
 * the cross-repo contract anchor.
 */
const RFC7636_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC7636_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

/** A base64url S256 digest is exactly 43 chars, base64url charset only.
 * This is the regex sil-web's `isValidCodeChallenge` applies at /authorize
 * (`pkce.ts:12`) — a challenge that fails it is rejected with a 400. */
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/** The UUID gate sil-web's `isValidSessionId` applies at /authorize and
 * claim (`pkce.ts:15`) — a session id that fails it is a uniform 404/400. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Independent reference derivation — NOT the module under test — so the
 * vector assertion can't be circular with a buggy implementation. */
function referenceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("deriveChallenge — S256 base64url, the cross-repo claim anchor", () => {
  it("matches the FIXED RFC 7636 verifier→challenge vector (same vector sil-web pins)", () => {
    // The load-bearing assertion: drift here is a uniform-404 at runtime
    // with no diagnostic. If this fails, the claim CAS can never match.
    expect(deriveChallenge(RFC7636_VERIFIER)).toBe(RFC7636_CHALLENGE);
  });

  it("agrees with an independent node:crypto SHA256→base64url derivation (not circular)", () => {
    for (let i = 0; i < 8; i++) {
      const verifier = randomBytes(32).toString("base64url");
      expect(deriveChallenge(verifier)).toBe(referenceChallenge(verifier));
    }
  });

  it("hashes the VERIFIER, not the challenge (digest of a digest ≠ digest)", () => {
    // The classic drift: accidentally feeding the already-derived
    // challenge back through. SHA256(challenge) must NOT equal the
    // challenge, proving the input is the raw verifier.
    const challenge = deriveChallenge(RFC7636_VERIFIER);
    expect(deriveChallenge(challenge)).not.toBe(challenge);
    expect(deriveChallenge(challenge)).not.toBe(RFC7636_CHALLENGE);
  });

  it("always yields a 43-char base64url string (no padding)", () => {
    const challenge = deriveChallenge(newVerifier());
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(CODE_CHALLENGE_RE);
  });

  it("uses the URL-safe alphabet only — never +, /, or = padding", () => {
    // A verifier whose SHA-256 contains bytes that map to +,/ in standard
    // base64 must still come back URL-safe; a stray `=` (standard-base64
    // digest('base64')) would be rejected by sil-web's 43-char gate.
    const challenge = deriveChallenge("payload-with-special-bytes-ÿþ-/+=");
    expect(challenge).not.toMatch(/[+/=]/);
    expect(challenge).toMatch(CODE_CHALLENGE_RE);
  });

  it("is deterministic — same verifier in, same challenge out", () => {
    expect(deriveChallenge("stable-verifier")).toBe(
      deriveChallenge("stable-verifier"),
    );
  });

  it("is sensitive — a one-char change in the verifier changes the digest", () => {
    expect(deriveChallenge("verifier-a")).not.toBe(
      deriveChallenge("verifier-b"),
    );
  });
});

describe("newVerifier — the in-memory bearer secret", () => {
  it("produces a base64url string sil-web's challenge derivation accepts", () => {
    // The verifier must be high-entropy base64url so its derived challenge
    // lands inside the 43-char gate. We don't pin the verifier's own
    // length (impl detail), but its DERIVED challenge must be valid.
    const verifier = newVerifier();
    expect(typeof verifier).toBe("string");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe, no padding
    expect(deriveChallenge(verifier)).toMatch(CODE_CHALLENGE_RE);
  });

  it("carries real entropy — two fresh verifiers are not equal", () => {
    // A constant or low-entropy verifier defeats PKCE. Generate a batch
    // and assert all distinct.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(newVerifier());
    expect(seen.size).toBe(50);
  });

  it("is long enough to resist guessing (≥ 32 base64url chars ≈ 24 bytes)", () => {
    // RFC 7636 mandates a 43–128 char verifier; base64url(randomBytes(32))
    // is 43. Assert a floor so a careless impl can't ship an 8-char token.
    expect(newVerifier().length).toBeGreaterThanOrEqual(32);
  });
});

describe("newSessionId — the session UUID the agent mints", () => {
  it("produces a UUID sil-web's isValidSessionId gate accepts", () => {
    // /authorize and claim both 404/400 a non-UUID session id, so the
    // minted id MUST match sil-web's UUID_RE byte-for-byte.
    expect(newSessionId()).toMatch(UUID_RE);
  });

  it("is unique per call (no fixed/sequential ids)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(newSessionId());
    expect(seen.size).toBe(50);
  });
});
