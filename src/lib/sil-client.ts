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
 * Wire contract for the sil-API identity read (a SECOND origin — sil-api, the
 * Fastify domain service — NOT sil-web; bare path, not /api/v1; see the
 * sil-whoami card). The authenticated self-read is a BODYLESS GET; the
 * Authorization header carries the stored access token and IS the principal —
 * sil-api derives the user from the JWT `sub`, not a request body:
 *
 *   GET <silApiUrl>/identity    Authorization: Bearer <access_token>
 *                               (no body, no content-type)
 *     200 <UCP envelope>{ result: { name, addresses } }  → ok (carries identity)
 *     401                                                 → unauthorized (→ refresh)
 *     403 { error: user_not_provisioned | principal_mismatch } → forbidden (terminal)
 *     5xx / network / abort                               → retryable
 *
 * Wire contract for the sil-API catalog search (SAME origin as the identity
 * read — sil-api, bare path, NOT /api/v1; see the sil-search card). A simplified
 * structured query in, ranked purchasable products out. sil-api owns the UCP
 * envelope + enrichment; the plugin sends NO envelope and fills NO defaults:
 *
 *   POST <silApiUrl>/catalog/search   Authorization: Bearer <access_token>
 *     body { query?, filters?:{ categories?, price?:{ min?, max? } },
 *            pagination?:{ cursor?, limit? } }       (no context, no envelope)
 *     200 <UCP envelope>{ result: { products: SilCatalogProduct[],
 *                                   pagination?:{ has_next_page, cursor? } } } → ok
 *     400 { error:"empty_search_input", message }    → invalid_request
 *     401                                            → unauthorized (terminal here)
 *     5xx / network / abort                          → retryable
 *
 * Wire contract for the sil-API catalog LOOKUP (SAME origin/path style as search —
 * sil-api, bare `/catalog/lookup`, NOT /api/v1; see the sil-product-get card). The
 * lookup COMPANION to search: an agent passes ids it already holds and gets fresh
 * RICH detail back (search is LEAN). sil-api owns enrichment + the `not_found`
 * messaging + the envelope; the plugin sends just `{ ids }` (NO filters/context,
 * NO envelope). The two structural deltas from search's response: NO `pagination`
 * (a batch resolve, not a list) and a `messages[]` carrying the misses:
 *
 *   POST <silApiUrl>/catalog/lookup   Authorization: Bearer <access_token>
 *     body { ids: string[] }                         (≥1; no filters/context)
 *     200 <UCP envelope>{ result: { products: SilCatalogProduct[],
 *            messages?:[{ type:"info", code:"not_found", content:<id> }] } } → ok
 *     400 (schema: empty `ids` / request_too_large)  → invalid_request
 *     401                                            → unauthorized (terminal here)
 *     5xx / network / abort                          → retryable
 *
 * A lookup MISS is partial-SUCCESS data, NEVER an error: an unresolved id is a
 * `not_found` info `message` (the server omits `messages` entirely on full
 * success), surfaced on the `ok` outcome as a `not_found: string[]`. Each looked-up
 * variant carries an `inputs:[{ id, match }]` correlation (lookup's defining
 * feature over search — the response does NOT preserve request order and one id
 * may resolve to a variant of another id's product, so `inputs` is the only way to
 * map a request id to its result). `classifyLookupResponse` gates `ok` on a real
 * `Array.isArray(result.products)` — a 200 with no usable products array is
 * `retryable`, NEVER a false-green; a genuine ALL-MISSED lookup is a 200 whose
 * `result.products` IS `[]` WITH a populated `not_found` → `ok` (success: "none of
 * these exist anymore"), the discriminator being array PRESENCE, never length.
 *
 * `SilCatalogProduct` = a UCP product PLUS a required `source`; each variant PLUS
 * a required non-empty `checkout_url` (sil-services `@sil/schemas` catalog.ts —
 * the byte-shape of truth; `@ucp-js/sdk` carries ZERO catalog types). The plugin
 * does NOT depend on `@sil/schemas` (cross-repo): it re-declares the read-subset
 * it consumes locally (the `Search*` types below) and narrows the untrusted body
 * defensively in `extractSearchResult`, exactly as `extractIdentity` does. The
 * tool unwraps `result`, picks the FIRST (featured) variant per product (UCP:
 * "Platforms SHOULD treat the first element as featured"), projects each to the
 * product-level `{ id, title, source }` plus the nested featured `variant`
 * `{ id, title, price, availability, checkout_url }`, and hoists
 * `result.pagination.cursor` to a top-level cursor (present iff `has_next_page`).
 * `classifySearchResponse` gates `ok` on a
 * real `Array.isArray(result.products)` — a 200 with no usable products array is
 * `retryable`, NEVER a false-green empty match (the same anti-false-green guard
 * as the identity `name`-gate). A genuine empty match is a 200 whose
 * `result.products` IS an empty array → `ok` + `products: []` (success, not an
 * error — UCP: "empty search returns an empty array … this is not an error").
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

/** The simplified search query an agent sends — a free-text `query` plus
 * optional filters and pagination. Maps 1:1 into the sil-api `CatalogSearchRequest`
 * body (`searchCatalog` builds the nested shape). All fields optional at this
 * layer; the at-least-one-input rule is enforced by the tool, not here. */
export interface SearchParams {
  query?: string;
  category?: string;
  price_min?: number;
  price_max?: number;
  cursor?: string;
  limit?: number;
}

/** A currency-tagged price, passed through OPAQUE from sil-api's UCP `Price`
 * (`{ amount: <minor units>, currency: <ISO 4217> }`). Extra fields tolerated. */
export interface SearchPrice extends Record<string, unknown> {
  amount: number;
  currency: string;
}

/** Variant availability, passed through OPAQUE from sil-api's UCP `Availability`
 * object (`{ available?, status? }`) — NOT flattened to a bare boolean, which
 * would drop the `status` signal sil-api may carry. Both fields are optional in
 * the wire shape; extra fields are tolerated and passed through. */
export interface SearchAvailability extends Record<string, unknown> {
  available?: boolean;
  status?: string;
}

/** The single purchasable variant the agent acts on — the featured (first)
 * variant of a product, projected to the five fields the agent needs to present
 * and buy it. `price`/`availability` pass through opaque; `checkout_url` is the
 * non-empty acquisition target. */
export interface SearchVariant {
  id: string;
  title: string;
  price: SearchPrice;
  availability: SearchAvailability;
  checkout_url: string;
}

/** One agent-facing search result. Carries BOTH identities the agent needs:
 * product-level `id`/`title`/`source` (what was ranked + its provenance) AND the
 * nested featured `variant` (what to buy). Keeping the product id distinct from
 * the variant id matters — the ranked match is the product, the purchase target
 * is the variant; flattening them would lose one. */
export interface SearchProduct {
  id: string;
  title: string;
  source: string;
  variant: SearchVariant;
}

/** The normalized search payload: the ranked products in server order (the tool
 * does NOT re-rank) plus the opaque pagination cursor, present iff another page
 * remains. `cursor` is hoisted from `result.pagination.cursor`; its ABSENCE is
 * end-of-results — never inferred from `products.length`. */
export interface SearchResult {
  products: SearchProduct[];
  cursor?: string;
}

/**
 * Outcome of a single sil-api catalog search (classified by status + body).
 * Models `IdentityOutcome`, with `invalid_request` for sil-api's structured 400
 * (`empty_search_input`) carried through to the agent. The `ok` variant carries
 * the projected `products` + optional hoisted `cursor` DIRECTLY (no nested
 * `result` — the normalized payload IS the outcome). `unauthorized` (401) is
 * terminal in this card — a single round-trip, no transparent refresh (the
 * refresh choreography is `sil_whoami`'s; adding it here is additive follow-on).
 */
export type SearchOutcome =
  | { kind: "ok"; products: SearchProduct[]; cursor?: string }
  | { kind: "unauthorized" }
  | { kind: "invalid_request"; error: string; message: string }
  | { kind: "retryable" };

/** Which request id resolved to a looked-up variant, and how. Lookup's defining
 * feature over search: the response does NOT preserve request order and one id
 * may resolve to a VARIANT of another id's product, so `inputs` is the only way
 * to correlate "the id I asked about" → "the variant I got back". `match` is an
 * OPEN string (UCP well-known values `exact` — a direct variant/sku/barcode hit —
 * and `featured` — a product-id hit where the server picked a representative
 * variant), passed through as-is. `id` is required; a missing/non-string `match`
 * is dropped (not coerced). */
export interface LookupInput {
  id: string;
  match?: string;
}

/** The featured variant of a looked-up product, projected to the purchase-decision
 * fields a lookup caller needs. Richer than {@link SearchVariant}: adds `sku` and
 * `options` (which specific configuration this is — e.g. "Blue / Large") and the
 * lookup-only `inputs` correlation. `price`/`availability` pass through opaque;
 * `checkout_url` is the non-empty acquisition target (re-fetched live — freshness
 * is the reason this tool exists). Optional fields are omitted when absent rather
 * than emitted as `undefined`. */
export interface LookupVariant {
  id: string;
  title: string;
  price: SearchPrice;
  availability: SearchAvailability;
  checkout_url: string;
  sku?: string;
  options?: SelectedOption[];
  inputs?: LookupInput[];
}

/** One option selection on a variant, passed through OPAQUE from the UCP
 * `SelectedOption` (well-known fields `{ name, label }`, e.g. "Size: Large") —
 * the tool does NOT read or remap individual fields; it filters to plain objects
 * and passes them through verbatim, exactly as identity `addresses` pass through.
 * Surfaced so a lookup caller knows WHICH variant of a product they are buying. */
export type SelectedOption = Record<string, unknown>;

/** One looked-up product, projected to its RICH agent-facing detail (the deliberate
 * split vs search's LEAN six: a lookup caller is making a purchase decision, so it
 * gets `description`, `categories`, `handle`). Carries the product-level identity
 * AND the single featured `variant` (what to buy) — mirroring search's structural
 * shape; the split is rich-vs-lean FIELDS, not a different envelope. `categories`/
 * `handle` are omitted when absent. `description`/`categories` pass through opaque
 * (the tool surfaces them, it does not interpret them). */
export interface LookupProduct {
  id: string;
  title: string;
  description: Record<string, unknown>;
  price_range: unknown;
  source: string;
  categories?: Record<string, unknown>[];
  handle?: string;
  variant: LookupVariant;
}

/** The normalized lookup payload: the resolved products (in server order — lookup
 * does NOT guarantee request order, and the tool does not re-sort; the agent
 * correlates via each variant's `inputs`) plus `not_found`, the request ids that
 * resolved to nothing. `not_found` is OMITTED when every id resolved (the
 * server-side `messages`-absent-on-full-success contract surfaced as no key) and
 * is the partial-success DATA, never an error. */
export interface LookupResult {
  products: LookupProduct[];
  not_found?: string[];
}

/**
 * Outcome of a single sil-api catalog lookup (classified by status + body).
 * Models {@link SearchOutcome} — the SAME four error/success classes so the two
 * catalog tools present ONE agent-facing error vocabulary, NOT a divergent one.
 * The `ok` variant carries the projected `products` + optional `not_found`
 * DIRECTLY (no nested `result`). `unauthorized` (401) is terminal — a single
 * round-trip, no transparent refresh (parity with `sil_search`; the refresh
 * choreography is `sil_whoami`'s, an additive follow-on across both tools).
 *
 * Structural deltas from `SearchOutcome`, both handled here: NO `cursor` (lookup
 * is a batch resolve, not a list) and a `not_found` id list parsed from the
 * server's `not_found` info `messages`.
 */
export type LookupOutcome =
  | { kind: "ok"; products: LookupProduct[]; not_found?: string[] }
  | { kind: "unauthorized" }
  | { kind: "invalid_request"; error: string; message: string }
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
 * Classify a sil-api catalog-search response from its HTTP status AND body.
 * Branches on STATUS (and, for 200, the body shape) — never on `res.ok`:
 *   400 → invalid_request (surface sil-api's structured `{ error, message }`,
 *         e.g. `empty_search_input` — distinct from both the empty-match success
 *         and a transient failure; the agent must learn to fix its query, not
 *         retry or re-register)
 *   401 → unauthorized (terminal here — single round-trip, no refresh in SC1)
 *   5xx / other non-200 → retryable
 *   200 → unwrap the envelope `result`, normalize, and require `result.products`
 *         to be a real ARRAY. A 200 that yields no usable products array (a
 *         partial / garbage / stub-shaped body) is `retryable`, NEVER `ok` — the
 *         anti-false-green guard, the analogue of the identity `name`-gate. A
 *         genuine empty match (200 whose `result.products` IS `[]`) is `ok` with
 *         an empty product list: a SUCCESS, distinct from the no-array guard.
 *
 * Pure and exported — unit-tested in isolation like `classifyIdentityResponse`;
 * conflating the empty-match success with a partial-200 false-green, or with the
 * 400/401/5xx error classes, is the highest-risk subtle bug in this flow.
 */
export function classifySearchResponse(status: number, body: unknown): SearchOutcome {
  if (status === 400) {
    const { error, message } = extractApiError(body);
    return { kind: "invalid_request", error, message };
  }
  if (status === 401) return { kind: "unauthorized" };
  if (status !== 200) return { kind: "retryable" };

  const result = extractSearchResult(body);
  if (result === null) return { kind: "retryable" };
  return { kind: "ok", ...result };
}

/**
 * Classify a sil-api catalog-LOOKUP response from its HTTP status AND body.
 * Branches on STATUS (and, for 200, the body shape) — never on `res.ok`. The
 * SAME class structure as `classifySearchResponse` (so the two catalog tools
 * share one error vocabulary), minus search's `empty_search_input` subtlety:
 *   400 → invalid_request (a SCHEMA-validation 400 — an empty/missing `ids`
 *         rejected by `CatalogLookupRequest.ids` `minItems:1`, or a
 *         `request_too_large` over-batch — surface the server's `{ error,
 *         message }`. NOTE: this is NOT search's `empty_search_input` SourceError,
 *         which never arises on the lookup route; do not special-case it.)
 *   401 → unauthorized (terminal here — single round-trip, no refresh; parity
 *         with search)
 *   5xx / other non-200 → retryable
 *   200 → unwrap the envelope `result`, normalize, and require `result.products`
 *         to be a real ARRAY. A 200 that yields no usable products array (a
 *         partial / garbage / stub-shaped body) is `retryable`, NEVER `ok` — the
 *         anti-false-green guard, the analogue of the identity `name`-gate and
 *         search's products-array gate.
 *
 * THE subtle correctness point: an all-MISSED lookup is a genuine SUCCESS — a 200
 * whose `result.products` IS an empty array WITH a populated `not_found` list
 * ("none of these ids exist anymore"). It is `ok` with empty `products` + full
 * `not_found`, distinct from the no-array guard above. The discriminator between
 * "valid all-missed" and "garbage 200" is envelope/`products`-array PRESENCE,
 * NEVER array length — exactly as search distinguishes empty-match from a
 * partial-200 false-green.
 *
 * Pure and exported — unit-tested in isolation like `classifySearchResponse`.
 */
export function classifyLookupResponse(status: number, body: unknown): LookupOutcome {
  if (status === 400) {
    const { error, message } = extractApiError(body);
    return { kind: "invalid_request", error, message };
  }
  if (status === 401) return { kind: "unauthorized" };
  if (status !== 200) return { kind: "retryable" };

  const result = extractLookupResult(body);
  if (result === null) return { kind: "retryable" };
  return { kind: "ok", ...result };
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
 * and returns `{ id, name, addresses }` in the UCP envelope's `result`
 * (sil-api `handlers/identity.ts` GET route — declares only a response schema,
 * takes no request body). The verb is the whole point: POST hits the agent
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
 * Run a catalog search against sil-api (the SAME origin as the identity read —
 * NOT sil-web; bare `/catalog/search`, no `/api/v1`). The simplified
 * {@link SearchParams} are mapped into the sil-api `CatalogSearchRequest` body
 * (`{ query?, filters:{ categories?, price:{ min?, max? } }, pagination:{ cursor?, limit? } }`)
 * — building NO UCP envelope and filling NO defaults the agent did not supply.
 * Only the keys the agent actually provided are emitted (an absent filter is an
 * omitted key, not an empty object), so a free-text-only query sends just
 * `{ query }` and sil-api applies its own context resolution.
 *
 * The Bearer header is built HERE and never logged; the token travels only in
 * the outbound request, never into the returned union. A network error / timeout
 * maps to `retryable`.
 */
export async function searchCatalog(
  silApiUrl: string,
  token: string,
  params: SearchParams,
): Promise<SearchOutcome> {
  const url = `${stripTrailingSlash(silApiUrl)}/catalog/search`;
  let res: Response;
  try {
    res = await postJson(url, buildSearchBody(params), {
      authorization: `Bearer ${token}`,
    });
  } catch {
    return { kind: "retryable" };
  }
  const body = await readJsonBody(res);
  return classifySearchResponse(res.status, body);
}

/**
 * Resolve catalog ids against sil-api (the SAME origin as the identity read and
 * `searchCatalog` — NOT sil-web; bare `/catalog/lookup`, no `/api/v1`). The agent
 * already holds the ids (from a prior `sil_search`, a saved list, or cart
 * validation); this re-fetches CURRENT detail for them — building NO UCP envelope
 * and filling NO defaults. The body is just `{ ids }` (the simplified contract;
 * `filters`/`context` are sil-api options this tool does not expose). The ids are
 * forwarded AS GIVEN — sil-api owns dedup (its seam already dedups) and any batch
 * cap; the tool does not pre-dedup (which would mask a seam regression).
 *
 * The Bearer header is built HERE and never logged; the token travels only in the
 * outbound request, never into the returned union. A network error / timeout maps
 * to `retryable`.
 */
export async function lookupCatalog(
  silApiUrl: string,
  token: string,
  ids: string[],
): Promise<LookupOutcome> {
  const url = `${stripTrailingSlash(silApiUrl)}/catalog/lookup`;
  let res: Response;
  try {
    res = await postJson(url, { ids }, { authorization: `Bearer ${token}` });
  } catch {
    return { kind: "retryable" };
  }
  const body = await readJsonBody(res);
  return classifyLookupResponse(res.status, body);
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

/**
 * Unwrap + narrow a sil-api identity response body to a typed `Identity`, or
 * null if it carries no usable identity. Defends against the latent wire shape:
 * the identity may be wrapped in the UCP envelope's `result` OR (if the
 * follow-on returns it bare) at the top level, so we try `result` first and
 * fall back to the body itself.
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
 * Map the simplified {@link SearchParams} into the sil-api `CatalogSearchRequest`
 * body. Only keys the agent supplied are emitted — an absent filter is an OMITTED
 * key (sil-api's body is `additionalProperties: false`, but every field is
 * optional), never an empty `{}`. The singular `category` maps into the UCP
 * `filters.categories` ARRAY (sil-api's filter is multi-taxonomy; the simplified
 * contract takes one). `price_min`/`price_max` map into `filters.price.{min,max}`.
 * The tool clamps nothing and validates no cursor opacity — sil-api owns those.
 */
function buildSearchBody(params: SearchParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (typeof params.query === "string") body["query"] = params.query;

  const filters: Record<string, unknown> = {};
  if (typeof params.category === "string") {
    filters["categories"] = [params.category];
  }
  const price: Record<string, unknown> = {};
  if (typeof params.price_min === "number") price["min"] = params.price_min;
  if (typeof params.price_max === "number") price["max"] = params.price_max;
  if (Object.keys(price).length > 0) filters["price"] = price;
  if (Object.keys(filters).length > 0) body["filters"] = filters;

  const pagination: Record<string, unknown> = {};
  if (typeof params.cursor === "string") pagination["cursor"] = params.cursor;
  if (typeof params.limit === "number") pagination["limit"] = params.limit;
  if (Object.keys(pagination).length > 0) body["pagination"] = pagination;

  return body;
}

/**
 * Unwrap + narrow a sil-api catalog-search response body to a typed
 * {@link SearchResult}, or null if it carries no usable products array. The
 * products live in the UCP envelope's `result.products`; `result` is required —
 * unlike `extractIdentity` there is NO bare-top-level fallback, because a search
 * response is always enveloped (sil-api `buildEnvelope`) and a top-level
 * `products` would be a malformed body, not an alternate contract.
 *
 * The load-bearing anti-false-green guard: `result.products` MUST be a real
 * ARRAY. A 200 lacking it (a partial / garbage / stub `{ stub: true }` body)
 * returns null → `retryable`, never a false-green empty match. An EMPTY array is
 * a VALID empty match (a genuine "nothing matched") and returns an empty
 * `products` list — distinct from the no-array guard. Individual products that
 * are unusable (no projectable featured variant, missing checkout_url) are
 * dropped via `projectProduct` returning null, never fabricated.
 *
 * The opaque cursor is hoisted from `result.pagination.cursor` and surfaced ONLY
 * when `pagination.has_next_page` is true (end-of-results is the absent cursor —
 * never derived from `products.length`).
 */
function extractSearchResult(body: unknown): SearchResult | null {
  const envelope = asRecord(body);
  if (envelope === null) return null;

  const result = asRecord(envelope["result"]);
  if (result === null) return null;

  const rawProducts = result["products"];
  if (!Array.isArray(rawProducts)) return null;

  const products = rawProducts
    .map(projectProduct)
    .filter((p): p is SearchProduct => p !== null);

  const cursor = extractCursor(result["pagination"]);
  return cursor === null ? { products } : { products, cursor };
}

/**
 * Project one `SilCatalogProduct` to the agent-facing {@link SearchProduct}, or
 * null if it is unusable. Carries the product-level `id`/`title`/`source` AND the
 * featured variant nested under `variant`. Picks the FIRST (featured) variant —
 * UCP: "Platforms SHOULD treat the first element as featured". A product whose
 * featured variant has no non-empty `checkout_url` (the one field the agent acts
 * on to buy), or that is missing any required field, is dropped rather than
 * surfaced as a non-purchasable result.
 */
function projectProduct(raw: unknown): SearchProduct | null {
  const product = asRecord(raw);
  if (product === null) return null;

  const productId = product["id"];
  const productTitle = product["title"];
  const source = product["source"];
  if (typeof productId !== "string" || productId.length === 0) return null;
  if (typeof productTitle !== "string") return null;
  if (typeof source !== "string" || source.length === 0) return null;

  const variants = product["variants"];
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const variant = projectVariant(variants[0]);
  if (variant === null) return null;

  return { id: productId, title: productTitle, source, variant };
}

/**
 * Project a `SilCatalogVariant` to the agent-facing {@link SearchVariant}, or
 * null if it is not a usable purchasable variant. Requires `id`, `title`, a price
 * object, and a non-empty `checkout_url`; `price`/`availability` pass through
 * opaque.
 */
function projectVariant(raw: unknown): SearchVariant | null {
  const variant = asRecord(raw);
  if (variant === null) return null;

  const id = variant["id"];
  const title = variant["title"];
  const checkoutUrl = variant["checkout_url"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof title !== "string") return null;
  if (typeof checkoutUrl !== "string" || checkoutUrl.length === 0) return null;

  const price = extractPrice(variant["price"]);
  if (price === null) return null;

  return {
    id,
    title,
    price,
    availability: extractAvailability(variant["availability"]),
    checkout_url: checkoutUrl,
  };
}

/**
 * Unwrap + narrow a sil-api catalog-LOOKUP response body to a typed
 * {@link LookupResult}, or null if it carries no usable products array. Mirrors
 * `extractSearchResult`'s structure and shares its load-bearing anti-false-green
 * guard — `result.products` MUST be a real ARRAY; a 200 lacking it (partial /
 * garbage / stub `{ stub: true }`) returns null → `retryable`. An EMPTY array is a
 * VALID all-missed lookup (the products gate passes; `not_found` carries the ids)
 * — distinct from the no-array guard. The two structural deltas from search:
 *   - NO cursor hoist — lookup is a batch resolve, not a list (no `pagination`).
 *   - `not_found` is parsed from `result.messages`: each `{ code: 'not_found',
 *     content: <id> }` entry's `content` IS a missed request id (server emits one
 *     per unresolved id, in input order, and OMITS `messages` on full success).
 *     The `not_found` key is omitted here when there are no misses.
 *
 * Products unusable in lookup terms (no projectable featured variant, missing
 * `checkout_url`) are dropped via `projectLookupProduct` returning null, never
 * fabricated — same null-drop discipline as search.
 */
function extractLookupResult(body: unknown): LookupResult | null {
  const envelope = asRecord(body);
  if (envelope === null) return null;

  const result = asRecord(envelope["result"]);
  if (result === null) return null;

  const rawProducts = result["products"];
  if (!Array.isArray(rawProducts)) return null;

  const products = rawProducts
    .map(projectLookupProduct)
    .filter((p): p is LookupProduct => p !== null);

  const notFound = extractNotFound(result["messages"]);
  return notFound.length === 0 ? { products } : { products, not_found: notFound };
}

/**
 * Project one `SilCatalogProduct` to the agent-facing {@link LookupProduct}, or
 * null if it is unusable. RICHER than search's `projectProduct`: carries the
 * product-level `description`, `price_range`, `categories?` and `handle?` (a lookup
 * caller is making a purchase decision) plus the featured variant nested under
 * `variant`. Picks the FIRST (featured) variant — `lookup_catalog` returns one
 * featured variant per product; UCP: "Platforms SHOULD treat the first element as
 * featured". A product whose featured variant has no non-empty `checkout_url`, or
 * that is missing any required field, is dropped rather than surfaced as a
 * non-purchasable result.
 */
function projectLookupProduct(raw: unknown): LookupProduct | null {
  const product = asRecord(raw);
  if (product === null) return null;

  const id = product["id"];
  const title = product["title"];
  const source = product["source"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof title !== "string") return null;
  if (typeof source !== "string" || source.length === 0) return null;

  const description = asRecord(product["description"]);
  if (description === null) return null;
  const priceRange = product["price_range"];
  if (asRecord(priceRange) === null) return null;

  const variants = product["variants"];
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const variant = projectLookupVariant(variants[0]);
  if (variant === null) return null;

  const result: LookupProduct = {
    id,
    title,
    description,
    price_range: priceRange,
    source,
    variant,
  };
  const categories = passThroughObjects(product["categories"]);
  if (categories !== null) result.categories = categories;
  const handle = product["handle"];
  if (typeof handle === "string" && handle.length > 0) result.handle = handle;
  return result;
}

/**
 * Project a `SilCatalogVariant` to the agent-facing {@link LookupVariant}, or null
 * if it is not a usable purchasable variant. RICHER than search's `projectVariant`:
 * adds `sku`, `options` (which configuration this variant is), and the lookup-only
 * `inputs` correlation. Requires `id`, `title`, a price object, and a non-empty
 * `checkout_url`; `price`/`availability` pass through opaque. Optional rich fields
 * are omitted when absent rather than emitted as `undefined`.
 */
function projectLookupVariant(raw: unknown): LookupVariant | null {
  const variant = asRecord(raw);
  if (variant === null) return null;

  const id = variant["id"];
  const title = variant["title"];
  const checkoutUrl = variant["checkout_url"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof title !== "string") return null;
  if (typeof checkoutUrl !== "string" || checkoutUrl.length === 0) return null;

  const price = extractPrice(variant["price"]);
  if (price === null) return null;

  const result: LookupVariant = {
    id,
    title,
    price,
    availability: extractAvailability(variant["availability"]),
    checkout_url: checkoutUrl,
  };
  const sku = variant["sku"];
  if (typeof sku === "string" && sku.length > 0) result.sku = sku;
  const options = passThroughObjects(variant["options"]);
  if (options !== null) result.options = options;
  const inputs = extractInputs(variant["inputs"]);
  if (inputs !== null) result.inputs = inputs;
  return result;
}

/** Pass a wire array of objects through OPAQUE — filter to plain objects, preserve
 * each verbatim, never read or remap individual fields. Used for `categories` and
 * the variant's `options`: contextual display data the tool SURFACES but does not
 * interpret (it is not a purchasability gate — that is `checkout_url`/`price`).
 * Mirrors how identity `addresses` pass through (the wire field names — `value` vs
 * `name` on a category — are the source's to define, not the tool's to assert).
 * Returns null when the field is absent/non-array or yields no usable object, so
 * the caller omits the key rather than emitting an empty array. */
function passThroughObjects(raw: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(raw)) return null;
  const objects = raw.filter(
    (o): o is Record<string, unknown> => asRecord(o) !== null,
  );
  return objects.length === 0 ? null : objects;
}

/** Narrow a wire `inputs` correlation array to {@link LookupInput}[] — each entry
 * needs a non-empty `id` (the request id that resolved to this variant); a missing
 * or non-string `match` is dropped (not coerced). Returns null when the field is
 * absent or yields no usable entry, so the caller omits the key. Surfacing this is
 * what makes a multi-id lookup correlatable — without it the agent cannot map "the
 * id I asked about" to "the variant I got back". */
function extractInputs(raw: unknown): LookupInput[] | null {
  if (!Array.isArray(raw)) return null;
  const inputs = raw
    .map((i): LookupInput | null => {
      const obj = asRecord(i);
      if (obj === null) return null;
      const id = obj["id"];
      if (typeof id !== "string" || id.length === 0) return null;
      const match = obj["match"];
      return typeof match === "string" ? { id, match } : { id };
    })
    .filter((i): i is LookupInput => i !== null);
  return inputs.length === 0 ? null : inputs;
}

/** Parse the missed request ids out of a wire `messages` array. Each
 * `{ code: 'not_found', content: <id> }` info entry's `content` IS an unresolved
 * id (sil-api emits one per miss, in input order; `messages` is OMITTED on full
 * success). Returns the ids in order — an empty array when there are no misses
 * (the caller then omits the `not_found` key). Only `not_found` codes are
 * surfaced; any other message code (a future UCP `warning`/`delayed_fulfillment`)
 * is ignored here — broader message passthrough is out of scope. */
function extractNotFound(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const entry of raw) {
    const obj = asRecord(entry);
    if (obj === null) continue;
    if (obj["code"] !== "not_found") continue;
    const content = obj["content"];
    if (typeof content === "string" && content.length > 0) ids.push(content);
  }
  return ids;
}

/** Narrow a wire price (`{ amount: number, currency: string }`) — passed through
 * opaque (extra fields preserved), or null if the two required fields are absent
 * (an unpriced variant is not a usable purchasable result). */
function extractPrice(raw: unknown): SearchPrice | null {
  const obj = asRecord(raw);
  if (obj === null) return null;
  const amount = obj["amount"];
  const currency = obj["currency"];
  if (typeof amount !== "number" || typeof currency !== "string") return null;
  return { ...obj, amount, currency };
}

/** Narrow a wire availability object (`{ available?, status? }`) — passed through
 * opaque (NOT flattened to a bare boolean; extra fields preserved). A missing or
 * non-object availability yields an empty object (the agent reads no signal,
 * rather than the tool inventing one). */
function extractAvailability(raw: unknown): SearchAvailability {
  const obj = asRecord(raw);
  if (obj === null) return {};
  const result: SearchAvailability = { ...obj };
  const available = obj["available"];
  const status = obj["status"];
  result.available = typeof available === "boolean" ? available : undefined;
  result.status = typeof status === "string" ? status : undefined;
  return result;
}

/** Hoist the opaque next-page cursor from a wire `pagination` object. Returns the
 * cursor string ONLY when `has_next_page` is true AND a non-empty `cursor` is
 * present; null otherwise (last page, or no pagination). End-of-results is the
 * absent cursor — never `products.length === limit`. */
function extractCursor(raw: unknown): string | null {
  const obj = asRecord(raw);
  if (obj === null) return null;
  if (obj["has_next_page"] !== true) return null;
  const cursor = obj["cursor"];
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

/** Pull sil-api's structured `{ error, message }` out of a 400 body, defaulting
 * each field when the shape is unexpected so the agent always gets an actionable
 * (if generic) hint rather than `undefined`. */
function extractApiError(body: unknown): { error: string; message: string } {
  const obj = asRecord(body);
  const error = obj?.["error"];
  const message = obj?.["message"];
  return {
    error: typeof error === "string" && error.length > 0 ? error : "invalid_request",
    message:
      typeof message === "string" && message.length > 0
        ? message
        : "The search request was rejected. Provide a search query or at least one filter.",
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

/** A non-null plain object, or null for anything else (incl. arrays/primitives). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
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
