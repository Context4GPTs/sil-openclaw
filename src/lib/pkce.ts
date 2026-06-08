/**
 * PKCE primitives for the sil-web auth flow (proof system A — agent ↔ sil-web).
 *
 * The plugin mints a session id + a code verifier, holds the verifier as a
 * secret IN MEMORY, and sends only the S256 CHALLENGE to `/authorize`. This is
 * load-bearing: sil-web stores what the agent sends (already a digest) and the
 * claim CAS compares digest-to-digest — so the derivation here MUST match
 * sil-web's `src/lib/pkce.ts` byte-for-byte, or every claim returns a uniform
 * 404 (wrong-verifier ≡ unknown-session by construction, no existence oracle).
 *
 * `deriveChallenge` / `isValidCodeChallenge` / `isValidSessionId` are ported
 * verbatim from sil-services/apps/sil-web/src/lib/pkce.ts so the two sides agree.
 * `newSessionId` / `newVerifier` are the plugin-side minters (sil-web never
 * mints — it only validates the incoming params).
 *
 * node:crypto only; base64url; no dependency.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

/** A base64url S256 digest is exactly 43 chars, no padding ([A-Za-z0-9_-]). */
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/** RFC 4122 UUID (any version/variant); the session id is minted by the agent. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The verifier is 32 random bytes, base64url-encoded. 32 bytes → a 43-char
 * base64url string, comfortably inside RFC 7636's 43–128 char range; the same
 * width sil-web's own test vectors use.
 */
const VERIFIER_BYTES = 32;

/**
 * Derive the PKCE S256 code challenge from a verifier:
 *   BASE64URL( SHA256( ASCII(verifier) ) )
 * Pure; no I/O. The result is a 43-char base64url string.
 *
 * Identical to sil-web's `deriveChallenge` — pinned by a shared test vector so
 * any drift fails in CI rather than silently as a runtime 404.
 */
export function deriveChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * True iff `value` is a well-formed S256 code challenge: exactly 43 characters,
 * base64url charset only ([A-Za-z0-9_-], no padding). This is the format gate
 * sil-web's `/authorize` applies to the incoming `code_challenge`.
 */
export function isValidCodeChallenge(value: string): boolean {
  return CODE_CHALLENGE_RE.test(value);
}

/**
 * True iff `value` is a well-formed session id (UUID). This is the format gate
 * sil-web's `/authorize` and `/claim` apply to the incoming `session` param.
 */
export function isValidSessionId(value: string): boolean {
  return UUID_RE.test(value);
}

/** Mint a fresh session id (UUID v4). The agent owns it for the whole flow. */
export function newSessionId(): string {
  return randomUUID();
}

/**
 * Mint a fresh PKCE code verifier — 32 cryptographically-random bytes as a
 * base64url string. NEVER written to disk: it is the bearer secret for the
 * claim CAS; only its digest (the challenge) ever leaves the process, and only
 * inside the auth URL.
 */
export function newVerifier(): string {
  return randomBytes(VERIFIER_BYTES).toString("base64url");
}
