/**
 * Typed HTTP wrappers for every endpoint the plugin calls — the two sil-web auth
 * endpoints, the sil-api identity read and the seven shopping routes — each returning
 * a DISCRIMINATED UNION over the documented outcomes so the status taxonomy lives in
 * exactly one place and the caller switches on `kind` rather than re-deriving meaning
 * from `res.status` at every site.
 *
 * Wire contract (pinned to the already-merged sil-web routes —
 * sil-services/apps/sil-web/src/app/api/v1/...):
 *
 *   POST /api/v1/sessions/{id}/claim   body { code_verifier }
 *     200 { access_token, refresh_token, user:{id} }  → success    (EXACTLY once)
 *     200 { status: "pending" }                       → pending
 *     409                                             → already_claimed (terminal)
 *     410                                             → expired (terminal)
 *     404                                             → not_found (wrong verifier
 *                                                       ≡ unknown session, uniform);
 *                                                       the NORMAL pre-session early
 *                                                       state — KEEP POLLING at the
 *                                                       loop (non-terminal); only the
 *                                                       deadline ends it (as timeout)
 *     400 / other unexpected non-2xx                  → invalid_request (non-polling
 *                                                       terminal — fail fast; a bad
 *                                                       request can't be re-polled)
 *     5xx / network / abort                           → retryable
 *
 *   POST /api/v1/auth/refresh          body { refresh_token }
 *     200 { access_token, refresh_token, ... }        → refreshed
 *     401                                             → invalid_grant (terminal)
 *     5xx / network / abort                           → retryable
 *
 * Wire contract for the sil-API identity read (a SECOND origin — sil-api, the
 * Fastify domain service — NOT sil-web; bare path, not /api/v1). The authenticated
 * self-read is a BODYLESS GET; the Authorization header carries the stored session
 * token and IS the principal — sil-api derives the user from the JWT `sub`, not a
 * request body:
 *
 *   GET <silApiUrl>/identity    Authorization: Bearer <access_token>
 *     200 { name, addresses }                             → ok (carries identity)
 *     401                                                 → unauthorized (→ refresh)
 *     403 { error: user_not_provisioned | principal_mismatch } → forbidden (terminal)
 *     5xx / network / abort                               → retryable
 *
 * THE SHOPPING WIRE IS NOT MIRRORED HERE. Each tool's request shape is the committed
 * artifact under `schema/`, registered as the tool's own `parameters`; each 200 body is
 * the agent contract's, handed back VERBATIM. So this file declares no product type at
 * all — a hand-mirror of the response would be a second copy of the contract, and the
 * first thing to drift from it. {@link classifyShoppingResponse} gates the 200 on the
 * ONE thing the plugin genuinely owns (a plain object stating `status: "ok"`) and maps
 * every other status onto the contract's §4 vocabulary.
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
 * The VERB is load-bearing: sil-api's `POST /identity` is the agent enrich-STUB
 * ({kind, verified, subject, ...} — no name/addresses); `GET /identity` is the
 * real self-read returning {id, name, addresses} (sil-api `handlers/identity.ts`,
 * PR #7). The identity lives in the envelope's `result` (the tool unwraps it so
 * the agent sees identity, not transport metadata). `classifyIdentityResponse`
 * still narrows DEFENSIVELY — a 200 whose result has no usable identity (no
 * `name`) falls to `retryable`, NEVER to a false `ok`, so a stray stub 200 (or a
 * malformed body) can't be green while the product promise is unmet. An EMPTY
 * `addresses: []` IS a valid identity (a provisioned, address-less user).
 *
 * Tokens never appear in a log line here (mirrors sil-web's invariant) — they
 * only travel inside the returned union variant.
 *
 * node:fetch (global) only; no dependency.
 */

import { getWebUrl } from "./config.js";
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
  | { kind: "invalid_request" }
  | { kind: "retryable" };

/** Outcome of a single refresh attempt. */
export type RefreshOutcome =
  | { kind: "refreshed"; access_token: string; refresh_token: string }
  | { kind: "invalid_grant" }
  | { kind: "retryable" };

/** A postal address as returned by the sil-api identity read. These fields are
 * only optional HINTS — addresses pass through OPAQUE: `extractIdentity` filters
 * to plain objects and never reads or remaps individual fields. The ACTUAL wire
 * shape is sil-api's `AddressWire` (`street_address`, `address_locality`,
 * `address_region`, `postal_code`, `address_country`, … — sil-services
 * `packages/schemas/src/identity.ts`), NOT these `line1`/`city`/… names. Do NOT
 * remap to these fields — that would silently drop real address data. Extra
 * fields are tolerated and passed through untyped. */
export interface IdentityAddress extends Record<string, unknown> {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
}

/** The authenticated user's identity, unwrapped from the sil-api envelope's
 * `result`. The `name` is the authoritative human name; `addresses` is the
 * user's address list (possibly empty). This is the REAL contract whoami
 * surfaces — NOT the current /identity stub's {kind, verified, subject, ...}. */
export interface Identity {
  name: string;
  addresses: IdentityAddress[];
}

/**
 * Outcome of a single sil-api identity read (classified by status + body).
 * `unauthorized` (401) is the ONLY refresh trigger; `forbidden` (403) is
 * terminal — refreshing a valid-but-unprovisioned token changes nothing.
 */
export type IdentityOutcome =
  | { kind: "ok"; identity: Identity }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; reason: string }
  | { kind: "retryable" };

/**
 * One shopping route, as the tool table declares it. A `:name` segment in `path` is
 * filled from the argument of that name and URL-encoded; on a GET, `query` names the
 * arguments that ride the querystring and everything else stays home.
 */
export interface ShoppingRoute {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: readonly string[];
}

/**
 * The outcome of any shopping call — ONE union for all seven, because they share one
 * origin, one Bearer, one auth plugin and the contract's one error vocabulary (§4).
 *
 * `ok` carries the API's own 200 body, unread and unreshaped. `unauthorized` is the
 * sole refresh trigger; `forbidden` is terminal (a refresh cannot provision a user).
 */
export type ShoppingOutcome =
  | { kind: "ok"; body: Record<string, unknown> }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; reason: string }
  | { kind: "invalid_request"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "already_exists"; message: string }
  | { kind: "retryable"; source?: string; detail?: string };

/**
 * Classify a shopping response. One classifier for all seven routes — the contract
 * gives them one error vocabulary, so a second one could only drift.
 *
 * The 200 gate is the whole of what the plugin owns: a plain object stating
 * `status: "ok"`. Every 200 the API means as an answer says so, and a 200 that does
 * not is a broken contract rather than a degraded answer — `retryable`, never `ok`.
 * Nothing below the top level is inspected: the response artifact is the shape's one
 * source, and a second opinion here would be the copy that drifts from it.
 *
 * Pure and exported — unit-tested in isolation.
 */
export function classifyShoppingResponse(status: number, body: unknown): ShoppingOutcome {
  if (status === 400) return { kind: "invalid_request", message: extractApiError(body).message };
  if (status === 401) return { kind: "unauthorized" };
  if (status === 403) return { kind: "forbidden", reason: extractForbiddenReason(body) };
  if (status === 404) return { kind: "not_found", message: extractApiError(body).message };
  if (status === 409) return { kind: "already_exists", message: extractApiError(body).message };
  if (status !== 200) return retryableFromBody(body);

  const envelope = asRecord(body);
  if (envelope === null || envelope["status"] !== "ok") return { kind: "retryable" };
  return { kind: "ok", body: envelope };
}

/**
 * Classify a claim response from its HTTP status AND body. The discriminant for
 * the two-200s split is the PRESENCE OF BOTH TOKENS in the body — never the
 * status code. A 200 that is not a complete token pair is `pending` (the safe
 * non-terminal landing). 409/410 are distinct terminals; 5xx is retryable.
 *
 * 404 is `not_found` ON THE WIRE — but it is the NORMAL pre-session early state
 * (the session row is INSERTed server-side only when the user opens the auth
 * URL), so its terminality lives at the LOOP, not here: `claimStep` keeps polling
 * on `not_found` and only the 30-min deadline ends a never-appearing session (as
 * `timeout`). A 400 / any other unexpected non-{200,409,410,404,5xx} status is a
 * structurally-malformed request that re-polling can never fix, so it is its OWN
 * non-polling terminal `invalid_request` (fail fast) rather than riding the
 * keep-polling `not_found` path and spinning for the full deadline.
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
    // 400 (malformed request) or any other unexpected non-2xx: a NON-polling
    // terminal — re-polling can't fix a structurally-bad request, so fail fast
    // and loud rather than spinning to the deadline. Distinct from the early
    // 404 `not_found`, which DOES keep polling.
    return { kind: "invalid_request" };
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
 * Classify a sil-api identity response from its HTTP status AND body. Branches
 * on STATUS (and, for 200, the body shape) — never on `res.ok`:
 *   401 → unauthorized (the ONLY refresh trigger)
 *   403 → forbidden (terminal; carries user_not_provisioned/principal_mismatch)
 *   5xx / non-200 → retryable
 *   200 → unwrap the envelope `result` and narrow to {name, addresses}; a 200
 *         that yields no usable identity (no `name`) is `retryable`, NEVER `ok`
 *         (the anti-false-green guard — a partial/garbage 200, or the current
 *         /identity STUB shape with no name, must not read as success).
 *
 * Pure and exported — unit-tested in isolation like `classifyClaimResponse`;
 * mis-splitting 401 (refreshable) from 403 (terminal) is the highest-risk
 * auth-branch bug in this flow.
 */
export function classifyIdentityResponse(status: number, body: unknown): IdentityOutcome {
  if (status === 401) return { kind: "unauthorized" };
  if (status === 403) return { kind: "forbidden", reason: extractForbiddenReason(body) };
  if (status >= 500) return { kind: "retryable" };
  if (status !== 200) return { kind: "retryable" };

  const identity = extractIdentity(body);
  if (identity === null) return { kind: "retryable" };
  return { kind: "ok", identity };
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

/**
 * Read the authenticated user's identity from sil-api (the SECOND origin — the
 * Fastify domain service, NOT sil-web). This is a bodyless `GET <silApiUrl>/identity`:
 * sil-api's authenticated self-read derives the principal from the JWT `sub`
 * (the `Authorization: Bearer <token>` header), loads that user's addresses,
 * and returns `{ id, name, addresses }` (sil-api `handlers/identity.ts` GET route —
 * declares only a response schema, takes no request body). The verb is the whole
 * point: POST hits the agent
 * enrich-STUB (no name/addresses), GET hits the real self-read. No `agent_id`
 * or `on_behalf_of` is sent — the GET self-read has no body, so the principal
 * is unambiguously the token subject and the `principal_mismatch` 403 path is
 * eliminated entirely. A network error / timeout → `retryable`.
 *
 * The Bearer header is built HERE and never logged; the token travels only in
 * the outbound request, never into the returned union.
 */
export async function fetchIdentity(
  silApiUrl: string,
  token: string,
): Promise<IdentityOutcome> {
  const url = `${stripTrailingSlash(silApiUrl)}/identity`;
  let res: Response;
  try {
    res = await getJson(url, { authorization: `Bearer ${token}` });
  } catch {
    return { kind: "retryable" };
  }
  const body = await readJsonBody(res);
  return classifyIdentityResponse(res.status, body);
}

/**
 * Call one shopping route. `args` are the host-validated tool arguments, forwarded AS
 * GIVEN: the plugin fills no default, clamps no bound and re-validates nothing, because
 * the route refuses before it spends and names the offender in its own message — a
 * second validator here would buy nothing and drift from the artifact that already
 * bounds the input.
 *
 * The Bearer header is built HERE and never logged; the token travels only in the
 * outbound request, never into the returned union.
 */
export async function callShopping(
  silApiUrl: string,
  token: string,
  route: ShoppingRoute,
  args: Record<string, unknown>,
): Promise<ShoppingOutcome> {
  const url = `${stripTrailingSlash(silApiUrl)}${routePath(route, args)}`;
  let res: Response;
  try {
    res =
      route.method === "GET"
        ? await getJson(url, { authorization: `Bearer ${token}` })
        : await postJson(url, args, { authorization: `Bearer ${token}` });
  } catch {
    return { kind: "retryable" };
  }
  return classifyShoppingResponse(res.status, await readJsonBody(res));
}

/**
 * The route's path with its `:name` segment filled and its querystring built.
 *
 * Both halves are encoded, never concatenated: a dotted registry path is one PATH
 * SEGMENT (a stray `/` in it would re-route the call), and an unencoded query value
 * could inject a second parameter. Only the keys the agent actually sent travel — an
 * empty `q=` is a DIFFERENT request from an omitted `q`, and each gets its own refusal
 * message, which is the agent's whole recourse.
 */
function routePath(route: ShoppingRoute, args: Record<string, unknown>): string {
  const path = route.path.replace(/:([a-z_]+)/g, (_match, name: string) =>
    encodeURIComponent(String(args[name] ?? "")),
  );
  if (route.method !== "GET") return path;
  const query = new URLSearchParams();
  for (const key of route.query ?? []) {
    const value = args[key];
    if (typeof value === "string") query.set(key, value);
  }
  const search = query.toString();
  return search === "" ? path : `${path}?${search}`;
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
 * Contacts ONLY the resolved `sil_web_url` origin — sil-web is the sole auth
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

  const outcome = await refreshSession(getWebUrl(), stored.refresh_token);
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

/**
 * The discriminant {@link refreshAndRetryOnce} returns for the caller to map to
 * its own agent-facing envelope. Generic over the caller's outcome union `O`
 * (`ShoppingOutcome` / `IdentityOutcome`) —
 * the helper only ever surfaces an `O` produced by the first call or the retry,
 * never one it fabricates, so `O` stays parametric (no `any`, no cast).
 *
 *   result             — pass `outcome` through the caller's normal mapping (the
 *                        first non-401 outcome, OR the retry's non-401 outcome).
 *                        `refreshed` discriminates the two: `false` when `outcome`
 *                        is the first-try passthrough (no refresh happened),
 *                        `true` when it was produced via the refresh+retry recovery
 *                        path. The caller emits its `<tool>_refreshed` operator log
 *                        marker on (and ONLY on) `refreshed: true` — a logs-only
 *                        seam for the otherwise-invisible silent recovery; it adds
 *                        NO field to the agent-facing payload (outcome 1 stays
 *                        invisible to the agent).
 *   must_reregister     — terminal: refresh failed. `invalid_grant` is a dead
 *                        refresh token (the caller clears tokens); `no_stored_tokens`
 *                        is the pre-refresh or post-rotate TOCTOU empty read (nothing
 *                        to clear). NO retry was made.
 *   retryable           — transient: the refresh leg blipped (5xx/network). NO retry;
 *                        the caller surfaces "try again", NEVER a re-register.
 *   second_unauthorized — the retry with the freshly-rotated token was ALSO 401, so
 *                        the rotated pair is structurally dead (the caller clears
 *                        tokens + goes terminal). NEVER a second refresh.
 */
export type RefreshRetryResult<O> =
  | { kind: "result"; outcome: O; refreshed: boolean }
  | { kind: "must_reregister"; reason: "invalid_grant" | "no_stored_tokens" }
  | { kind: "retryable" }
  | { kind: "second_unauthorized" };

/**
 * THE single 401 refresh-and-retry-once choreography, shared by every
 * sil-api-calling tool (every `shopping_*` call and `sil_whoami`) so the 401
 * behaviour cannot drift apart between them (FLAG-10). The control flow IS the
 * contract — straight-line, AT MOST one refresh + AT MOST one retry, no loop:
 *
 *   1. `first` not unauthorized           → passthrough `{ result, first }`. The
 *                                            refresh path is reachable ONLY via a 401.
 *   2. `first` unauthorized → refresh ONCE via {@link refreshStoredTokens} (sil-web;
 *      rotates tokens.json):
 *        must_reregister (invalid_grant /  → terminal, NO retry (a failed refresh
 *          no_stored_tokens)                 leaves no rotated token to retry with).
 *        retryable (5xx/network)           → transient, NO retry.
 *        refreshed                         → re-read the rotated pair THROUGH the
 *                                            module's `readTokens` (so a TOCTOU on
 *                                            the on-disk pair is observed):
 *          re-read empty (TOCTOU)          → must_reregister(no_stored_tokens), NO retry.
 *          re-read ok → retry ONCE with the rotated session token:
 *            retry still unauthorized      → second_unauthorized (the rotated token is
 *                                            structurally dead — NEVER refresh again).
 *            retry otherwise               → `{ result, retry }`.
 *
 * The helper owns the bound, the rotation re-read, and the TOCTOU + second-401
 * guards. The caller owns ONLY: the `isUnauthorized` predicate, the token-bearing
 * `retryWithToken` thunk (closing over its params + the rotated token), the
 * envelope mapping, `clearTokens()` on the clearing terminals, and logging.
 * Credential side-effects beyond the rotation `refreshStoredTokens` already does
 * stay at the call site (mirrors `identity.ts`).
 */
export async function refreshAndRetryOnce<O>(
  first: O,
  isUnauthorized: (outcome: O) => boolean,
  retryWithToken: (accessToken: string) => Promise<O>,
): Promise<RefreshRetryResult<O>> {
  if (!isUnauthorized(first)) {
    // First-try passthrough: no refresh happened, so the caller must NOT emit its
    // `<tool>_refreshed` marker. `refreshed: false` is the negative half of the
    // observability discriminant.
    return { kind: "result", outcome: first, refreshed: false };
  }

  const refresh = await refreshStoredTokens();
  if (refresh.status === "must_reregister") {
    return { kind: "must_reregister", reason: refresh.reason };
  }
  if (refresh.status === "retryable") {
    return { kind: "retryable" };
  }

  // refresh.status === "refreshed" — re-read the rotated pair through the module
  // binding (the TOCTOU seam: tokens.json may have vanished between the rotate
  // inside refreshStoredTokens and this read).
  const rotated = readTokens();
  if (rotated === null) {
    return { kind: "must_reregister", reason: "no_stored_tokens" };
  }

  const retry = await retryWithToken(rotated.access_token);
  if (isUnauthorized(retry)) {
    // A freshly-rotated token STILL rejected is structurally dead — terminal,
    // never another refresh cycle.
    return { kind: "second_unauthorized" };
  }
  // Silent-recovery success: this outcome was produced via refresh+retry, so the
  // caller emits its `<tool>_refreshed` operator marker. `refreshed: true` is the
  // positive half of the observability discriminant — logs-only, never a payload field.
  return { kind: "result", outcome: retry, refreshed: true };
}

/**
 * Unwrap + narrow a sil-api identity response body to a typed `Identity`, or
 * null if it carries no usable identity. Defends against the latent wire shape:
 * the identity may be wrapped in a `result` field OR (if the follow-on returns it
 * bare) at the top level, so we try `result` first and fall back to the body
 * itself.
 *
 * A usable identity REQUIRES a non-empty `name` string (the authoritative human
 * name) and that `addresses` is an ARRAY — but the array may be EMPTY. sil-api
 * returns `addresses: []` for a provisioned user who has onboarded a name but
 * not yet added an address (`handlers/identity.ts` → `buildIdentityReadResult`);
 * that is a real, authenticated identity, NOT a not-yet-ready read. Rejecting it
 * would strand such a user on a false `retryable` they could never escape by
 * retrying. The `name` gate is the load-bearing anti-false-green guard: the
 * current /identity STUB shape ({kind, verified, subject, ...}) has NO name, so
 * it still returns null → `retryable`, never a false `ok`. Extra fields on each
 * address are preserved (addresses pass through opaque — see `IdentityAddress`).
 */
function extractIdentity(body: unknown): Identity | null {
  const envelope = asRecord(body);
  if (envelope === null) return null;

  const result = asRecord(envelope["result"]);
  const source = result ?? envelope;

  const name = source["name"];
  if (typeof name !== "string" || name.length === 0) return null;

  const rawAddresses = source["addresses"];
  if (!Array.isArray(rawAddresses)) return null;
  const addresses = rawAddresses.filter(
    (a): a is IdentityAddress => asRecord(a) !== null,
  );

  return { name, addresses };
}

/** Pull the actionable reason out of a 403 body (`user_not_provisioned` /
 * `principal_mismatch`), defaulting to a generic marker when the shape is
 * unexpected — the tool surfaces this to drive the right recovery hint. */
function extractForbiddenReason(body: unknown): string {
  const obj = asRecord(body);
  const error = obj?.["error"];
  return typeof error === "string" && error.length > 0 ? error : "forbidden";
}


/**
 * Build the `retryable` outcome for a non-200, non-{400,401} response, attaching
 * the failed catalog `source` (+ a `detail` carrying the upstream cause) ONLY when
 * the 5xx body is a real `source_unavailable` SourceError that names a source.
 *
 * This is the seam where outcome (a) (sil/network down → bare retryable, generic
 * copy) and outcome (b) (a named source down → source-named retryable) become
 * distinguishable — see {@link ShoppingOutcome}'s `retryable` arm. The gate is the
 * PRESENCE of a real
 * non-empty-string `source` field on the body, NEVER the `message` prose: a
 * sil-internal 5xx (no `source`), a bodyless/garbage non-200, or a `source` that is
 * null/number/empty/object/array all fall back to the bare sourceless retryable.
 * Attaching a source to a non-source 5xx would re-introduce wrong attribution in
 * the opposite direction (a sil-down event falsely named as a source outage), so
 * the populate must never fabricate or coerce.
 *
 * `detail` is the upstream cause the consumer can relay — the body's `message`
 * when present, else its `error` code. It is only set alongside a real `source`
 * (an outcome-a retryable carries neither field).
 */
function retryableFromBody(body: unknown): { kind: "retryable"; source?: string; detail?: string } {
  const obj = asRecord(body);
  const source = obj?.["source"];
  if (typeof source !== "string" || source.length === 0) {
    return { kind: "retryable" };
  }
  const message = obj?.["message"];
  const error = obj?.["error"];
  const detail =
    typeof message === "string" && message.length > 0
      ? message
      : typeof error === "string" && error.length > 0
        ? error
        : source;
  return { kind: "retryable", source, detail };
}

/** Pull sil-api's structured `{ error, message }` out of a refusal body, verbatim.
 * Every v0 route names the offender in its own message by design, so the message
 * is the agent's whole recourse and is never rewritten here — the defaults only
 * cover a body that carried neither field, so the agent gets a sentence rather
 * than `undefined`. */
function extractApiError(body: unknown): { error: string; message: string } {
  const obj = asRecord(body);
  const error = obj?.["error"];
  const message = obj?.["message"];
  return {
    error: typeof error === "string" && error.length > 0 ? error : "invalid_request",
    message:
      typeof message === "string" && message.length > 0
        ? message
        : "sil rejected this request and gave no reason.",
  };
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

/** A non-null plain object, or null for anything else (incl. arrays/primitives).
 * The array exclusion is load-bearing: a JSON array reaching the 200 gate is a
 * malformed body, not a usable empty. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** POST a JSON body with a hard per-request timeout (AbortController). Extra
 * headers (e.g. an Authorization bearer) merge over the JSON content-type; the
 * header values are passed straight to fetch and never logged. */
async function postJson(
  url: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** GET with a hard per-request timeout (AbortController), sharing `postJson`'s
 * timeout and never-log-the-token invariants. Sends NO `content-type` and NO
 * body — a GET body is at best ignored and in strict fetch environments throws,
 * and the sil-api self-read derives its principal from the Bearer JWT, not a
 * body. Extra headers (e.g. an Authorization bearer) are passed straight to
 * fetch and never logged. */
async function getJson(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "GET",
      headers: { ...extraHeaders },
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
