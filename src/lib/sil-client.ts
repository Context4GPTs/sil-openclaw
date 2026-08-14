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
 * Fastify domain service — NOT sil-web; bare path, not /api/v1; see the
 * sil-whoami card). The authenticated self-read is a BODYLESS GET; the
 * Authorization header carries the stored session token and IS the principal —
 * sil-api derives the user from the JWT `sub`, not a request body:
 *
 *   GET <silApiUrl>/identity    Authorization: Bearer <access_token>
 *                               (no body, no content-type)
 *     200 { name, addresses }                             → ok (carries identity)
 *     401                                                 → unauthorized (→ refresh)
 *     403 { error: user_not_provisioned | principal_mismatch } → forbidden (terminal)
 *     5xx / network / abort                               → retryable
 *
 * Wire contract for the FOUR v0 catalog routes (SAME origin as the identity read —
 * sil-api, bare paths, NOT /api/v1). All four take the same Bearer, share one auth
 * plugin (401 / 403 / 503) and one error envelope `{ error, message }`:
 *
 *   POST <silApiUrl>/catalog/search   body { domain, query, n, predicates?, destination? }
 *     200 SearchResponse                             → ok
 *     400 { error:"invalid_request", message }       → invalid_request. TWO causes with
 *         ONE code: the domain is not in the registry (mint it), or a predicate's
 *         grammar was refused (fix the predicate). The message is the only wire
 *         discriminator, so the plugin surfaces it VERBATIM and never matches on it.
 *
 *   POST <silApiUrl>/catalog/lookup   body { refs }   (1–5; `variant:<uuid>` | `url:<url>`)
 *     200 THE SAME SearchResponse                    → ok
 *     400 (ref grammar; the message names the ref)   → invalid_request
 *
 *   POST <silApiUrl>/catalog/stores   body { ref, destination? }
 *     200 StoresResponse                             → ok
 *     400 no destination anywhere / ref grammar      → invalid_request
 *     404 { error:"not_found", message }             → not_found (sil holds no such ref)
 *
 *   POST <silApiUrl>/catalog/domains  body { path, guide, specs }
 *     200 DomainMintResult (`validated_at` always null — a mint is born FENCED)
 *     400 path / spec grammar                        → invalid_request
 *     409 { error:"domain_exists", message }         → already_exists (NOT a failure:
 *         the vocabulary is usable — re-issue the search on the SAME path)
 *
 * SEARCH AND LOOKUP ANSWER WITH THE SAME OBJECT, by contract (`@sil/schemas`
 * `search.ts:1-30`) — hence ONE {@link CatalogResultOutcome} and one classifier for
 * both. They differ in what they were asked and in what they spend, never in what
 * they answer with.
 *
 * THE PAYLOAD PASSES THROUGH VERBATIM. The classifiers gate the envelope's top level
 * plus the four load-bearing per-result fields and then hand the SAME object over —
 * no projection, no rename, no default, no re-order. That is not laziness: the
 * agent's three-state veto is computed from `values[].state`, `predicates[].applied`
 * and `results[].maturity`, and a per-field projector drops exactly those. It also
 * means an additive server field reaches the agent unreviewed, which is the trade
 * this wire is designed around (an omitted key and a stated `unset` are DIFFERENT
 * answers here, and only a stated one may be repeated to a buyer).
 *
 * Wire types are MIRRORED from `@sil/schemas` (`packages/schemas/src/{search,stores}.ts`),
 * never imported — no cross-repo dependency, and `@ucp-js/sdk` carries zero catalog
 * types. The v0 result body is deliberately NOT a UCP shape: a UCP variant carries
 * one merchant's price, which would delete the price spread that IS the answer.
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

/* ────────────────────────────────────────────────────────────────────────────
 * The v0 catalog wire, mirrored as a READ SUBSET of `@sil/schemas`.
 *
 * Every type below is a hand-mirror of `sil-services/packages/schemas/src/`
 * (`search.ts`, `stores.ts`). They describe what the plugin reads; they never
 * reshape what it forwards. Extra fields a future sil-services adds are absent
 * from these declarations and present in the payload — that is the point.
 * ──────────────────────────────────────────────────────────────────────────── */

/** How much sil knows about a result. `catalog` — a variant the pass built and
 * verified. `web` — a page fetched during this request, read for its structured
 * markup only: a real listing at a real price, every spec value honestly `unset`.
 * It is the veto's third input and NEVER a veto on its own. */
export type SearchMaturity = "catalog" | "web";

/** Whether THIS price came from bytes fetched during THIS request. Required on
 * both routes: at the call site "no `observed`" and "we do not know" are the same
 * absence, and only one is an honest answer about a price a buyer is about to pay. */
export type SearchObserved = "live" | "stored";

/** What happened to one submitted predicate — about the PREDICATE, never about a
 * result. `false` = there was nothing to evaluate it against. `partial` = a
 * set-valued predicate where some names resolved and some did not. */
export type PredicateApplied = true | "partial" | false;

/** We hold no value for this key — `state` and NOTHING else, so a value-shaped
 * null is unrepresentable rather than merely discouraged. STATED, never omitted. */
export interface SearchValueUnset {
  state: "unset";
}

/** The selected winner for this key, with where and WHEN we read it. */
export interface SearchValueSet {
  state: "set";
  /** Typed by the spec's `data_type`; a `money` value is a DECIMAL STRING. */
  value: number | boolean | string;
  value_currency?: string;
  origin: "observed" | "derived";
  chart_ref?: string;
  source_ref: string;
  observed_at: string;
}

/** A real discriminated union on `state`: the arms share no field but the tag. */
export type SearchValueEntry = SearchValueSet | SearchValueUnset;

/** `display_name`/`country` are ABSENT when unknown — never the host as a name. */
export interface SearchSeller {
  host: string;
  display_name?: string;
  country?: string;
}

/** One seller's current listing. Several offers on one result IS the price
 * spread, which is the answer — never collapsed to a "best" one. */
export interface SearchOffer {
  seller: SearchSeller;
  /** Decimal string. `numeric(20,6)` through a JS float is not the printed price. */
  price: string;
  currency: string;
  list_price?: string;
  availability?: string;
  observed: SearchObserved;
  observed_at: string;
  url: string;
  /** Absent when the listing published none — never `url` copied in. */
  buy_url?: string;
}

export interface SearchMedia {
  url: string;
  /** NULLABLE, unlike every other unknown here: no alt text is a fact about the
   * image, not a field sil failed to fill. */
  alt: string | null;
  position: number;
}

/** A label/value the page printed, VERBATIM. A pair is never a spec value:
 * keying needs the model, and no model runs in the request path. */
export interface SearchPair {
  label: string;
  value: string;
}

export interface SearchProduct {
  title: string;
  description?: string;
  description_source_ref?: string;
}

export interface SearchResult {
  /** Search MINTS it, lookup ECHOES the submitted ref verbatim — which is what
   * makes a ref absent from `results` an unambiguous miss, not a failure. */
  ref: string;
  maturity: SearchMaturity;
  product: SearchProduct;
  option_set: Record<string, string>;
  media: SearchMedia[];
  /** One entry per RESOLVED-vocabulary key, `unset` included. */
  values: Record<string, SearchValueEntry>;
  pairs: SearchPair[];
  offers: SearchOffer[];
}

export interface SearchSource {
  url: string;
  host: string;
  fetched_at: string;
}

export interface SearchResolution {
  name: string;
  canonical: string | null;
}

export interface SearchPredicateResult {
  key: string;
  applied: PredicateApplied;
  resolution?: SearchResolution[];
}

/** What the two legs actually did. `blocked` is what stops a short answer reading
 * as "the web held nothing else". */
export interface SearchReport {
  searches: number;
  fetched: number;
  blocked: number;
}

/** The body BOTH `/catalog/search` and `/catalog/lookup` answer with. */
export interface SearchResponse {
  results: SearchResult[];
  sources: Record<string, SearchSource>;
  predicates: SearchPredicateResult[];
  report: SearchReport;
}

/** Three states, NOT symmetric: `not_serviceable` is a positive claim requiring
 * policy evidence sil read; everything else is `unknown`. At v0 nothing writes
 * that evidence, so `unknown` is the MAJORITY answer and never a filter. */
export type StoreServiceability = "serviceable" | "not_serviceable" | "unknown";

export interface StorePolicyEvidence {
  source_ref: string;
  observed_at: string;
}

export interface StoresFulfillment {
  country: string;
  service: string;
  option_label?: string;
  observed_at: string;
  source_ref: string;
  values: Record<string, SearchValueEntry>;
}

/** A range, never a number: `min === max` is emitted deliberately, because
 * delivery cost is the seller's own function of weight and service. */
export interface StoresRange {
  min: string;
  max: string;
}

/** Keyed by currency — sil holds no FX rate anywhere, so a blended min/max would
 * be meaningless rather than approximate. */
export type StoresCost = Record<string, StoresRange>;

/** Where the buyer goes, and WHICH promise it is. v0's transaction boundary IS
 * this URL and nothing past it. */
export interface StoresHandoff {
  url: string;
  source: "buy_url" | "url";
}

export interface StoreEntry {
  seller: SearchSeller;
  serviceability: StoreServiceability;
  /** Present iff `serviceability` is `not_serviceable` — it dates the exclusion. */
  policy_evidence?: StorePolicyEvidence;
  fulfillment: StoresFulfillment[];
  cost: StoresCost;
  free_threshold: StoresCost;
  values: Record<string, SearchValueEntry>;
  charged_currency: SearchValueEntry;
  offer: SearchOffer;
  handoff: StoresHandoff;
}

export interface StoresResponse {
  /** Echoed, because every verdict in the body is relative to it and it may have
   * come from the account's default country rather than the request. */
  destination: string;
  stores: StoreEntry[];
  sources: Record<string, SearchSource>;
}

/** `validated_at` is always `null`: a minted domain is born FENCED and only the
 * pass lifts it. On the wire so the agent can SEE its vocabulary is not yet live. */
export interface DomainMintResult {
  path: string;
  validated_at: null;
  specs: string[];
}

/* ── request side. Object TYPE ALIASES, not interfaces: only an alias carries an
 * implicit index signature, and these are handed straight to `postJson`. ── */

export type SearchPredicateOp = "eq" | "neq" | "gte" | "lte" | "in" | "nin" | "exists";

/** Forwarded verbatim — the plugin never interprets an op or a value. `currency`
 * is required on a money predicate; there is no FX rate anywhere in the system. */
export type SearchPredicate = {
  key: string;
  op: SearchPredicateOp;
  value?: unknown;
  currency?: string;
};

export type SearchParams = {
  domain: string;
  query: string;
  /** A SPEND knob (the web leg fetches candidates), so it has no plugin default. */
  n: number;
  predicates?: SearchPredicate[];
  /** Empty means "ship to me" — the route resolves the account's default country. */
  destination?: string;
};

export type StoresParams = {
  ref: string;
  destination?: string;
};

/** `data_type` stays a plain string, mirroring the route: a closed union here
 * would produce a schema-path 400 that never names the offending spec KEY. */
export type SpecDefinitionInput = {
  key: string;
  display_name: string;
  description?: string;
  data_type: string;
  unit?: string;
  allowed_values?: string[];
  value_set?: string;
  level?: string;
};

export type DomainMintParams = {
  path: string;
  guide: string;
  specs: SpecDefinitionInput[];
};

/**
 * The outcome of `/catalog/search` AND `/catalog/lookup` — ONE union, because the
 * two routes answer with the same object by contract. `unauthorized` is the sole
 * refresh trigger; `forbidden` is terminal (a refresh cannot provision a user).
 * There is no 422 arm: no v0 route emits one.
 */
export type CatalogResultOutcome =
  | { kind: "ok"; result: SearchResponse }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; reason: string }
  | { kind: "invalid_request"; error: string; message: string }
  | { kind: "retryable"; source?: string; detail?: string };

/** `/catalog/stores`, plus the one status only it can produce: a well-formed ref
 * that resolves to nothing is a 404, never a 200 with an empty `stores` list
 * (which would read as "nobody sells this" — a lie by omission). */
export type StoresOutcome =
  | { kind: "ok"; stores: StoresResponse }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; reason: string }
  | { kind: "invalid_request"; error: string; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "retryable"; source?: string; detail?: string };

/** `/catalog/domains`, plus the one status only it can produce: `already_exists`
 * is the 409, and it is NOT a failure — the category is already there, so the
 * vocabulary is usable and the agent re-issues the search on the SAME path. */
export type MintOutcome =
  | { kind: "ok"; domain: DomainMintResult }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; reason: string }
  | { kind: "invalid_request"; error: string; message: string }
  | { kind: "already_exists"; path: string; message: string }
  | { kind: "retryable"; source?: string; detail?: string };

/**
 * Classify a `/catalog/search` OR `/catalog/lookup` response. One classifier for
 * both: the two routes answer with the same object by contract, so a second one
 * could only drift.
 *
 * The 200 gate is ALL FOUR top-level keys plus the four load-bearing per-result
 * fields, and it is the anti-false-green guard. Gating only `results` would admit
 * a body carrying no `predicates` — which reads as a clean success while silently
 * disarming the agent's veto, the worst failure available on this wire. A gate
 * failure is `retryable`, never `ok`.
 *
 * PRESENCE, never length: `results: []` with a well-formed envelope is a genuine
 * empty answer and a SUCCESS.
 *
 * Pure and exported — unit-tested in isolation.
 */
export function classifyResultResponse(status: number, body: unknown): CatalogResultOutcome {
  if (status === 400) return { kind: "invalid_request", ...extractApiError(body) };
  if (status === 401) return { kind: "unauthorized" };
  if (status === 403) return { kind: "forbidden", reason: extractForbiddenReason(body) };
  if (status !== 200) return retryableFromBody(body);

  const result = gateResultResponse(body);
  return result === null ? { kind: "retryable" } : { kind: "ok", result };
}

/**
 * Classify a `/catalog/stores` response. Adds the 404 arm — terminal but NOT
 * fatal: sil holds no such ref, which no retry and no re-registration can change.
 *
 * The 200 gate covers the envelope plus, per entry, the two fields the whole
 * route exists to deliver: `serviceability` (one of exactly three) and a complete
 * `handoff`. An entry that cannot say which of the three states it is in, or
 * where the buyer goes, is not a degraded answer — it is an unusable one.
 */
export function classifyStoresResponse(status: number, body: unknown): StoresOutcome {
  if (status === 400) return { kind: "invalid_request", ...extractApiError(body) };
  if (status === 401) return { kind: "unauthorized" };
  if (status === 403) return { kind: "forbidden", reason: extractForbiddenReason(body) };
  if (status === 404) return { kind: "not_found", message: extractApiError(body).message };
  if (status !== 200) return retryableFromBody(body);

  const stores = gateStoresResponse(body);
  return stores === null ? { kind: "retryable" } : { kind: "ok", stores };
}

/**
 * Classify a `/catalog/domains` response. `path` is the SUBMITTED path: the 409
 * body carries only `{ error, message }`, and the agent's next move is to search
 * that exact path — so the outcome has to carry it or the recovery is unstated.
 *
 * The 200 gate requires `validated_at` to be exactly `null`. That is not
 * defensive noise: a fresh mint is FENCED, and the fence is what tells the agent
 * its first results will come from the web while the catalog catches up.
 */
export function classifyMintResponse(status: number, body: unknown, path: string): MintOutcome {
  if (status === 400) return { kind: "invalid_request", ...extractApiError(body) };
  if (status === 401) return { kind: "unauthorized" };
  if (status === 403) return { kind: "forbidden", reason: extractForbiddenReason(body) };
  if (status === 409) return { kind: "already_exists", path, message: extractApiError(body).message };
  if (status !== 200) return retryableFromBody(body);

  const domain = gateMintResult(body);
  return domain === null ? { kind: "retryable" } : { kind: "ok", domain };
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
 * `POST /catalog/search` — sil's catalog, in ONE registry domain, before any
 * client-side opinion is applied. `params` go on the wire as given: the plugin
 * fills no default, clamps no bound and re-validates nothing, because every v0
 * route refuses before it spends and names the offender in its message. A second
 * validator here would buy nothing and drift.
 *
 * The Bearer header is built HERE and never logged; the token travels only in the
 * outbound request, never into the returned union.
 */
export async function searchCatalog(
  silApiUrl: string,
  token: string,
  params: SearchParams,
): Promise<CatalogResultOutcome> {
  const url = `${stripTrailingSlash(silApiUrl)}/catalog/search`;
  let res: Response;
  try {
    res = await postJson(url, params, { authorization: `Bearer ${token}` });
  } catch {
    return { kind: "retryable" };
  }
  return classifyResultResponse(res.status, await readJsonBody(res));
}

/**
 * `POST /catalog/lookup` — re-read refs the agent already holds, with the top
 * offers' prices refreshed live. The refs are forwarded AS GIVEN: no dedupe (that
 * would mask a server-side regression) and no pre-trim (the ≤5 cap is the tool
 * schema's, enforced by the host before `execute()` runs).
 */
export async function lookupCatalog(
  silApiUrl: string,
  token: string,
  refs: string[],
): Promise<CatalogResultOutcome> {
  const url = `${stripTrailingSlash(silApiUrl)}/catalog/lookup`;
  let res: Response;
  try {
    res = await postJson(url, { refs }, { authorization: `Bearer ${token}` });
  } catch {
    return { kind: "retryable" };
  }
  return classifyResultResponse(res.status, await readJsonBody(res));
}

/**
 * `POST /catalog/stores` — every seller of ONE pick, its serviceability state and
 * its handoff. Not a batch: `serviceability` is relative to a single pick.
 */
export async function readStores(
  silApiUrl: string,
  token: string,
  params: StoresParams,
): Promise<StoresOutcome> {
  const url = `${stripTrailingSlash(silApiUrl)}/catalog/stores`;
  let res: Response;
  try {
    res = await postJson(url, params, { authorization: `Bearer ${token}` });
  } catch {
    return { kind: "retryable" };
  }
  return classifyStoresResponse(res.status, await readJsonBody(res));
}

/**
 * `POST /catalog/domains` — the one registry write path in v0. Permanent and
 * un-upsertable: there is no delete route and a colliding path is refused, so the
 * 409 is carried back with the submitted path rather than swallowed.
 */
export async function mintDomain(
  silApiUrl: string,
  token: string,
  params: DomainMintParams,
): Promise<MintOutcome> {
  const url = `${stripTrailingSlash(silApiUrl)}/catalog/domains`;
  let res: Response;
  try {
    res = await postJson(url, params, { authorization: `Bearer ${token}` });
  } catch {
    return { kind: "retryable" };
  }
  return classifyMintResponse(res.status, await readJsonBody(res), params.path);
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
 * (`SearchOutcome` / `LookupOutcome` / `IdentityOutcome`) — the helper only ever
 * surfaces an `O` produced by the first call or the retry, never one it
 * fabricates, so `O` stays parametric (no `any`, no cast).
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
 * sil-api-calling tool (`sil_search`, `sil_product_get`, `sil_whoami`) so the 401
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

/**
 * The 200 gate for `/catalog/search` and `/catalog/lookup`, and the ONLY place
 * the result body is inspected.
 *
 * It checks presence and type of the four top-level keys plus, per result, the
 * four fields the agent's veto is computed from. On success it returns the
 * ORIGINAL object — not a copy, not a projection — so every field sil-services
 * sends, including ones this file does not declare, reaches the agent verbatim.
 *
 * What it deliberately does NOT do: descend into `values`, `offers`, `pairs` or
 * `sources`. Rejecting an unknown field would break the first time sil-services
 * adds one, and re-validating a known one would put a second, drifting copy of
 * the contract here.
 */
function gateResultResponse(body: unknown): SearchResponse | null {
  const envelope = asRecord(body);
  if (envelope === null) return null;
  if (!Array.isArray(envelope["results"])) return null;
  if (asRecord(envelope["sources"]) === null) return null;
  if (!Array.isArray(envelope["predicates"])) return null;
  if (asRecord(envelope["report"]) === null) return null;

  for (const raw of envelope["results"]) {
    const result = asRecord(raw);
    if (result === null) return null;
    if (typeof result["ref"] !== "string") return null;
    if (result["maturity"] !== "catalog" && result["maturity"] !== "web") return null;
    if (asRecord(result["values"]) === null) return null;
    if (!Array.isArray(result["offers"])) return null;
  }
  return envelope as unknown as SearchResponse;
}

/** The 200 gate for `/catalog/stores`. Per entry it checks the two fields the
 * route exists to deliver — which of the three states this seller is in, and
 * where the buyer goes — and nothing below them. */
function gateStoresResponse(body: unknown): StoresResponse | null {
  const envelope = asRecord(body);
  if (envelope === null) return null;
  if (typeof envelope["destination"] !== "string") return null;
  if (!Array.isArray(envelope["stores"])) return null;
  if (asRecord(envelope["sources"]) === null) return null;

  for (const raw of envelope["stores"]) {
    const entry = asRecord(raw);
    if (entry === null) return null;
    const state = entry["serviceability"];
    if (state !== "serviceable" && state !== "not_serviceable" && state !== "unknown") return null;
    const handoff = asRecord(entry["handoff"]);
    if (handoff === null) return null;
    if (typeof handoff["url"] !== "string") return null;
    if (handoff["source"] !== "buy_url" && handoff["source"] !== "url") return null;
  }
  return envelope as unknown as StoresResponse;
}

/** The 200 gate for `/catalog/domains`. `validated_at` must be exactly `null`:
 * the fence is the mint's headline fact, and a body that cannot state it is not
 * a mint result the agent can act on. */
function gateMintResult(body: unknown): DomainMintResult | null {
  const envelope = asRecord(body);
  if (envelope === null) return null;
  if (typeof envelope["path"] !== "string") return null;
  if (envelope["validated_at"] !== null) return null;
  const specs = envelope["specs"];
  if (!Array.isArray(specs) || !specs.every((s) => typeof s === "string")) return null;
  return envelope as unknown as DomainMintResult;
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
 * distinguishable — see {@link SearchOutcome}. The gate is the PRESENCE of a real
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
 * The array exclusion is load-bearing for the catalog gates: `sources`, `report`
 * and `values` are objects on the wire, and an array passed as one of them is a
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
