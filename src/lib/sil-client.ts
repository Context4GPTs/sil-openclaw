/**
 * Typed HTTP wrappers for the two sil-web endpoints the plugin calls, each
 * returning a DISCRIMINATED UNION over the documented outcomes so the status
 * taxonomy lives in exactly one place and the caller switches on `kind` rather
 * than re-deriving meaning from `res.status` at every site.
 *
 * Wire contract (pinned to the already-merged sil-web routes —
 * sil-services/apps/sil-web/src/app/api/v1/...):
 *
 *   POST /api/v1/sessions/{id}/claim   body { code_verifier }
 *     200 { access_token, refresh_token, user:{id} }  → success    (EXACTLY once)
 *     200 { status: "pending" }                       → pending
 *     409                                             → already_claimed
 *     410                                             → expired
 *     404                                             → not_found (wrong verifier
 *                                                       ≡ unknown session, uniform)
 *     5xx / network / abort                           → retryable
 *
 *   POST /api/v1/auth/refresh          body { refresh_token }
 *     200 { access_token, refresh_token, ... }        → refreshed
 *     401                                             → invalid_grant (terminal)
 *     5xx / network / abort                           → retryable
 *
 * THE subtle correctness point (architect Risk "claim taxonomy mis-mapping"):
 * 200-pending and 200-success are BOTH HTTP 200. `classifyClaimResponse` branches
 * on the BODY SHAPE (both tokens present) — never on `res.ok` — so "keep polling"
 * is never conflated with "success". A malformed/partial 200 falls to the SAFE
 * non-terminal `pending` path, never to a false success that would persist a
 * non-credential as tokens. The classifier is exported and pure so it can be
 * unit-tested in isolation, since misclassifying two 200s is the highest-risk
 * subtle bug in the whole flow.
 *
 * Tokens never appear in a log line here (mirrors sil-web's invariant) — they
 * only travel inside the returned union variant.
 *
 * node:fetch (global) only; no dependency.
 */

import { getApiUrl } from "./config.js";
import { readTokens, writeTokens } from "./credentials.js";

/** Per-request timeout: a stalled endpoint (DNS hang, SYN drop) must not wedge
 * a poll tick forever. Mirrors the 15s ceiling the klodi poller uses. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The user identity sil-web returns inside a successful claim. */
export interface ClaimedUser {
  id: string;
  name?: string;
}

/** Outcome of a single claim attempt (classified by status + body). */
export type ClaimOutcome =
  | {
      kind: "success";
      access_token: string;
      refresh_token: string;
      user: ClaimedUser;
    }
  | { kind: "pending" }
  | { kind: "already_claimed" }
  | { kind: "expired" }
  | { kind: "not_found" }
  | { kind: "retryable" };

/** Outcome of a single refresh attempt. */
export type RefreshOutcome =
  | { kind: "refreshed"; access_token: string; refresh_token: string }
  | { kind: "invalid_grant" }
  | { kind: "retryable" };

/**
 * Classify a claim response from its HTTP status AND body. The discriminant for
 * the two-200s split is the PRESENCE OF BOTH TOKENS in the body — never the
 * status code. A 200 that is not a complete token pair is `pending` (the safe
 * non-terminal landing); 409/410/404 are distinct terminals; 5xx is retryable.
 *
 * Pure and exported — this is the highest-risk subtle branch, unit-tested in
 * isolation (sil-client.test.ts).
 */
export function classifyClaimResponse(status: number, body: unknown): ClaimOutcome {
  if (status === 409) return { kind: "already_claimed" };
  if (status === 410) return { kind: "expired" };
  if (status === 404) return { kind: "not_found" };
  if (status >= 500) return { kind: "retryable" };
  if (status !== 200) {
    // 400 (malformed request) or any other unexpected 4xx: terminal not_found
    // (re-polling can't fix a bad request); surface a re-run hint, not a spin.
    return { kind: "not_found" };
  }

  // 200 — classify by body shape. Both tokens required for a clean success;
  // anything short of that is the safe non-terminal `pending`.
  const obj = asRecord(body);
  if (obj === null) return { kind: "pending" };
  const accessToken = obj["access_token"];
  const refreshToken = obj["refresh_token"];
  if (typeof accessToken === "string" && typeof refreshToken === "string") {
    return {
      kind: "success",
      access_token: accessToken,
      refresh_token: refreshToken,
      user: extractUser(obj["user"]),
    };
  }
  return { kind: "pending" };
}

/**
 * Classify a refresh response. 200 with both tokens → refreshed; 401 → terminal
 * invalid_grant ("must re-register"); 5xx / other → retryable.
 */
export function classifyRefreshResponse(status: number, body: unknown): RefreshOutcome {
  if (status === 401) return { kind: "invalid_grant" };
  if (status >= 500) return { kind: "retryable" };
  if (status !== 200) return { kind: "invalid_grant" };

  const obj = asRecord(body);
  const accessToken = obj?.["access_token"];
  const refreshToken = obj?.["refresh_token"];
  if (typeof accessToken === "string" && typeof refreshToken === "string") {
    return { kind: "refreshed", access_token: accessToken, refresh_token: refreshToken };
  }
  return { kind: "retryable" };
}

/**
 * Attempt to claim the token pair for `sessionId` with `verifier`. The verifier
 * is sent in the body; sil-web derives the same challenge server-side and the
 * CAS compares digest-to-digest (the plugin sends the verifier, not the digest).
 * A network error / timeout maps to `retryable` so the poll budget governs.
 */
export async function claimSession(
  apiUrl: string,
  sessionId: string,
  verifier: string,
): Promise<ClaimOutcome> {
  const url = `${stripTrailingSlash(apiUrl)}/api/v1/sessions/${sessionId}/claim`;
  let res: Response;
  try {
    res = await postJson(url, { code_verifier: verifier });
  } catch {
    return { kind: "retryable" };
  }
  const body = await readJsonBody(res);
  return classifyClaimResponse(res.status, body);
}

/**
 * Refresh the bearer pair via sil-web (NEVER Auth0 directly — sil-web is the
 * sole auth authority and the only holder of the Auth0 client secret).
 */
export async function refreshSession(
  apiUrl: string,
  refreshToken: string,
): Promise<RefreshOutcome> {
  const url = `${stripTrailingSlash(apiUrl)}/api/v1/auth/refresh`;
  let res: Response;
  try {
    res = await postJson(url, { refresh_token: refreshToken });
  } catch {
    return { kind: "retryable" };
  }
  const body = await readJsonBody(res);
  return classifyRefreshResponse(res.status, body);
}

/** Result of the high-level refresh orchestration (read → refresh → rotate). */
export type RefreshStoredResult =
  | { status: "refreshed" }
  | { status: "must_reregister"; reason: "invalid_grant" | "no_stored_tokens" }
  | { status: "retryable" };

/**
 * SC7/F7 entry point: read the stored refresh token, exchange it via sil-web,
 * and rotate `tokens.json` with the new pair on success.
 *
 * Contacts ONLY the resolved `sil_api_url` origin — sil-web is the sole auth
 * authority; the plugin never talks to Auth0 directly (sil-web holds the Auth0
 * client secret). On a 401 the refresh token is dead: return a terminal
 * "must re-register" signal and DO NOT rotate (a rejected refresh must never be
 * presented as a fresh, valid pair). A 5xx / network blip is retryable.
 */
export async function refreshStoredTokens(): Promise<RefreshStoredResult> {
  const stored = readTokens();
  if (stored === null) {
    return { status: "must_reregister", reason: "no_stored_tokens" };
  }

  const outcome = await refreshSession(getApiUrl(), stored.refresh_token);
  switch (outcome.kind) {
    case "refreshed":
      await writeTokens({
        access_token: outcome.access_token,
        refresh_token: outcome.refresh_token,
      });
      return { status: "refreshed" };
    case "invalid_grant":
      return { status: "must_reregister", reason: "invalid_grant" };
    case "retryable":
      return { status: "retryable" };
  }
}

/** Narrow the `user` field of a claim body to a typed identity. */
function extractUser(raw: unknown): ClaimedUser {
  const obj = asRecord(raw);
  if (obj === null) return { id: "" };
  const id = obj["id"];
  const name = obj["name"];
  return {
    id: typeof id === "string" ? id : "",
    ...(typeof name === "string" ? { name } : {}),
  };
}

/** A non-null plain object, or null for anything else (incl. arrays/primitives). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** POST a JSON body with a hard per-request timeout (AbortController). */
async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
