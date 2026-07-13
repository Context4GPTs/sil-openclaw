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
 *     200 <FLAT UCP envelope>{ ucp, products: SilCatalogProduct[],
 *                              pagination?:{ has_next_page, cursor? } } → ok
 *         (sil-api's `withUcpMeta(body) → { ucp, ...body }`: `products`/`pagination`
 *          at the TOP LEVEL beside `ucp`, NO `result` wrapper)
 *     400 { error:"empty_search_input", message }    → invalid_request
 *     401                                            → unauthorized (→ refresh)
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
 *     200 <FLAT UCP envelope>{ ucp, products: SilCatalogProduct[],
 *            messages?:[{ type:"info", code:"not_found", content:<id> }] } → ok
 *         (same flat `withUcpMeta` shape: `products`/`messages` at the TOP LEVEL
 *          beside `ucp`, NO `result` wrapper)
 *     400 (schema: empty `ids` / request_too_large)  → invalid_request
 *     401                                            → unauthorized (→ refresh)
 *     5xx / network / abort                          → retryable
 *
 * A lookup MISS is partial-SUCCESS data, NEVER an error: an unresolved id is a
 * `not_found` info `message` (the server omits `messages` entirely on full
 * success), surfaced on the `ok` outcome as a `not_found: string[]`. Each looked-up
 * variant carries an `inputs:[{ id, match }]` correlation (lookup's defining
 * feature over search — the response does NOT preserve request order and one id
 * may resolve to a variant of another id's product, so `inputs` is the only way to
 * map a request id to its result). `classifyLookupResponse` gates `ok` on a real
 * `Array.isArray(products)` on the FLAT envelope's top-level `products` — a 200
 * with no usable products array is `retryable`, NEVER a false-green; a genuine
 * ALL-MISSED lookup is a 200 whose top-level `products` IS `[]` WITH a populated
 * `not_found` → `ok` (success: "none of these exist anymore"), the discriminator
 * being array PRESENCE, never length.
 *
 * `SilCatalogProduct` = a UCP product PLUS a required `source`; each variant PLUS
 * a required non-empty `checkout_url` (sil-services `@sil/schemas` catalog.ts —
 * the byte-shape of truth; `@ucp-js/sdk` carries ZERO catalog types). The plugin
 * does NOT depend on `@sil/schemas` (cross-repo): it re-declares the read-subset
 * it consumes locally (the `Search*` types below) and narrows the untrusted body
 * defensively in `extractSearchResult`. The tool reads `products` straight off the
 * FLAT envelope's top level (NO `result` unwrap — search/lookup are always flat,
 * only the identity read carries the `result ?? envelope` dual shape), picks the
 * FIRST (featured) variant per product (UCP: "Platforms SHOULD treat the first
 * element as featured"), projects each to the product-level `{ id, title, source }`
 * plus the nested featured `variant` `{ id, title, price, availability,
 * checkout_url }`, and hoists the top-level `pagination.cursor` to a top-level
 * cursor (present iff `has_next_page`). `classifySearchResponse` gates `ok` on a
 * real `Array.isArray(products)` over that top-level `products` — a 200 with no
 * usable products array is `retryable`, NEVER a false-green empty match (the same
 * anti-false-green guard as the identity `name`-gate). A genuine empty match is a
 * 200 whose top-level `products` IS an empty array → `ok` + `products: []`
 * (success, not an error — UCP: "empty search returns an empty array … this is not
 * an error").
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

/** A deliver-to destination for serviceability + localization filtering. `country`
 * is the ISO 3166-1 alpha-2 code (required when the object is present); `region`
 * (ISO 3166-2 subdivision code) and `postal_code` refine it. FORMAT is enforced at
 * the read site (`readSearchParams` in catalog.ts rejects a present-but-malformed
 * value client-side) — by the time a value reaches this layer it is already
 * format-valid. The ONLY wire normalization here is country-case: `country` is
 * uppercased on emit (`us` → `US`, the alpha-2 contract `@sil/schemas` mirrors);
 * `region`/`postal_code` are forwarded VERBATIM. The agent-arg name `ship_to` is
 * renamed to the wire key `ships_to` in `buildSearchBody`. Mirrors the Shopify
 * Global-Catalog `ships_to` wire shape (`global-catalog-extension.md:32`). */
export interface ShipTo {
  country: string;
  region?: string;
  postal_code?: string;
}

/** The comparison operator on a spec predicate. The seven split by their effect
 * on the query FOLD (see {@link buildSearchBody}): the POSITIVE ops (`eq`/`gte`/
 * `lte`/`in`) render their value into `query` text as a backstop; the negation +
 * existence ops (`neq`/`nin`/`exists`) render NOTHING (a negation as a bare
 * positive token would surface exactly what it excludes — fail-worse). All seven
 * forward unchanged on the wire `filters.specs`; only the fold is op-aware. */
export type SpecOp = "eq" | "neq" | "gte" | "lte" | "in" | "nin" | "exists";

/** The value a spec predicate carries. A scalar for `eq`/`neq`, a number for
 * `gte`/`lte`, an array for `in`/`nin`; `exists` carries NONE. Value is OPTIONAL
 * in the shape (so `exists` fits) — the op→value validity is a READ-SITE rule
 * (`readSpecs` in catalog.ts), not a schema one. */
export type SpecValue = number | string | boolean | (string | number)[];

/** One structured requirement projected from a filled PRD — the THIRD search
 * channel beside free-text `query` and the dedicated params. Closed SHAPE, open
 * `ns.key` VOCABULARY: `ns`/`key` are two free wire strings (the method coins them
 * bottom-up; the TypeBox schema enumerates zero keys — [[sds-specs-vocabulary-is-
 * bottom-up]]), never a dotted string. `hard` mirrors the PRD inviolability flag
 * and is forwarded UNCHANGED so the backend can enforce once it lands and
 * reflection can correlate the `applied:false` hard set. */
export interface SpecPredicate {
  ns: string;
  key: string;
  op: SpecOp;
  value?: SpecValue;
  unit?: string;
  hard?: boolean;
}

/** The per-predicate applied-status the backend reports on the `ok` response —
 * the OBSERVABLE fail-green signal. `applied:true` = the backend indexed it and
 * truly filtered; `applied:false` = not indexed yet (it moved results only via the
 * query fold), and that `applied:false` set is EXACTLY what reflection's
 * hard-constraint honesty check polices. Surfaced verbatim, per-predicate — never
 * collapsed to one boolean, never dropped. */
export interface SpecStatus {
  ns: string;
  key: string;
  applied: boolean;
}

/** The simplified search query an agent sends — a free-text `query` plus
 * optional filters and pagination. Maps 1:1 into the sil-api `CatalogSearchRequest`
 * body (`searchCatalog` builds the nested shape). All fields optional at this
 * layer; the at-least-one-input rule is enforced by the tool, not here.
 *
 * The three serviceability/localization filters (`ship_to`, `condition`,
 * `available`) ride sil-api's OPEN `SearchFilters` (`additionalProperties: true`).
 * They are forwarded ONLY when supplied — an absent filter is an omitted key, never
 * a client-injected default (the server applies `available: true` itself).
 * `available: false` is meaningful (include unavailable items) and is forwarded,
 * never dropped as falsy.
 *
 * `local_merchants` is NOT one of those filters — it is a sil-PRIVATE ranking-bias
 * signal that rides at the TOP LEVEL of the request body (beside `query`/`filters`/
 * `pagination`), NEVER under `filters` (filters are forwarded to the cross-shop
 * Global Catalog, which does not understand the field → a silent no-op). It is
 * emitted ONLY when exactly `true`: unlike `available: false`, a `false` bias
 * carries no signal (== the server's unbiased default), so `false`/absent both omit
 * the key. See `buildSearchBody`. */
export interface SearchParams {
  query?: string;
  category?: string;
  price_min?: number;
  price_max?: number;
  cursor?: string;
  limit?: number;
  ship_to?: ShipTo;
  condition?: string[];
  available?: boolean;
  local_merchants?: boolean;
  /** The structured requirement predicates ({@link SpecPredicate}) projected from a
   * filled PRD — the open long-tail channel with no dedicated param. Each is
   * DUAL-projected in `buildSearchBody`: it rides a single namespaced `filters.specs`
   * key AND folds its value into `query` (positive ops only). Present-but-empty `[]`
   * is a benign no-op (omits `filters.specs`, does not count as usable input); the
   * per-predicate validity is enforced at the read site (`readSpecs`). */
  specs?: SpecPredicate[];
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
 * variant of a product, projected to the fields the agent needs to present, view,
 * dig into, and buy it. `price`/`availability` pass through opaque; `checkout_url`
 * is the non-empty acquisition target (the BUY permalink).
 *
 * The enriched evaluate-before-buy surface (each surfaced WHERE PRESENT, omitted
 * when absent — a hollow value is worse than omission): `url` (the variant PAGE —
 * VIEW, distinct from `checkout_url`), `seller` (the seller context incl.
 * `seller.links[]` dig-in policy/info links), `media`, and `metadata`. Every
 * enriched field is passed through OPAQUE (filter-to-object/array, forward
 * verbatim) keyed on PRESENCE — never narrowed on a guessed inner shape, so a
 * `seller` carrying Shopify extension keys (`url`/`domain`) beyond the base
 * `{ name, links }` survives whole (the [[sil-shared-catalog-client]]
 * narrow-vs-pass-through rule; a `{ name, links }` narrow would drop a real
 * `seller.url`). */
export interface SearchVariant {
  id: string;
  title: string;
  price: SearchPrice;
  availability: SearchAvailability;
  checkout_url: string;
  url?: string;
  seller?: Record<string, unknown>;
  media?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

/** One agent-facing search result. Carries BOTH identities the agent needs:
 * product-level `id`/`title`/`source` (what was ranked + its provenance) AND the
 * nested featured `variant` (what to buy). Keeping the product id distinct from
 * the variant id matters — the ranked match is the product, the purchase target
 * is the variant; flattening them would lose one.
 *
 * The enriched product surface (each surfaced WHERE PRESENT, omitted when absent):
 * `url` (the canonical product PAGE — VIEW / learn more, NOT buy), `description`
 * lifted to `{ plain }` (the short human summary — only the `plain` UCP format,
 * surfaced only when non-empty), `media`, product `options` (the option
 * DEFINITIONS — the menu of choices, distinct from a variant's SelectedOption
 * picks), and `metadata`. Same OPAQUE pass-through discipline as the variant. */
export interface SearchProduct {
  id: string;
  title: string;
  source: string;
  variant: SearchVariant;
  url?: string;
  description?: ProductDescription;
  media?: Record<string, unknown>[];
  options?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

/** The agent-facing product description — the UCP `description` object's `plain`
 * format lifted to a flat `{ plain }`, the short human summary an agent can show.
 * ONLY `plain` is surfaced (never `html`/`markdown`): `html` is untrusted rich
 * text the UCP spec flags for sanitization, and surfacing one named scalar keeps
 * BOTH catalog tools on ONE `description` shape. Omitted entirely when `plain` is
 * absent or empty (so the same product never yields a different `description`
 * shape across `sil_search` and `sil_product_get`). */
export interface ProductDescription {
  plain: string;
}

/** The normalized search payload: the ranked products in server order (the tool
 * does NOT re-rank) plus the opaque pagination cursor, present iff another page
 * remains. `cursor` is hoisted from the flat envelope's top-level
 * `pagination.cursor`; its ABSENCE is end-of-results — never inferred from
 * `products.length`. */
export interface SearchResult {
  products: SearchProduct[];
  cursor?: string;
  /** The per-predicate applied-status ({@link SpecStatus}[]) read off the flat
   * envelope's top-level `specs_status` — a SIBLING of `products`, so it surfaces on
   * an empty match too. OMITTED entirely when the wire carries none (no fabricated
   * default — interpreting absence as unconfirmed is reflection's job). */
  specs_status?: SpecStatus[];
}

/**
 * Outcome of a single sil-api catalog search (classified by status + body).
 * Models `IdentityOutcome`, with `invalid_request` for sil-api's structured 400
 * (`empty_search_input`) carried through to the agent. The `ok` variant carries
 * the projected `products` + optional hoisted `cursor` DIRECTLY (no nested
 * `result` — the normalized payload IS the outcome). `unauthorized` (401) is the
 * refresh trigger — the caller routes it through {@link refreshAndRetryOnce}
 * (transparent refresh-and-retry-once), the SAME choreography `sil_whoami` uses;
 * it is no longer terminal for the catalog tools.
 *
 * The `retryable` variant optionally carries `source`/`detail`: a 5xx whose body
 * is a `source_unavailable` SourceError names which catalog source failed, so the
 * consumer (`transient()` in catalog.ts) can distinguish a *source* outage (name
 * it — outcome b) from sil/network itself being down (generic copy — outcome a).
 * Both are retryable — the only difference is attribution; this is a *message*
 * split within one status, not a new outcome kind. `source` is attached ONLY when
 * the body carries a real non-empty `source` field (never fabricated, never
 * scraped from `message`); a sil-internal 5xx, a bodyless/garbage non-200, and a
 * network-error throw all stay bare `{ kind: "retryable" }` (outcome a).
 *
 * The 401-vs-403 split is the load-bearing auth-branch distinction: `unauthorized`
 * (401) is the refresh trigger; `forbidden` (403) is terminal-but-recoverable —
 * refreshing a valid-but-unprovisioned token changes nothing. The `forbidden`
 * variant carries the actionable `reason` (`user_not_provisioned` /
 * `principal_mismatch`, defaulting to the generic `"forbidden"` marker on an
 * unexpected body — byte-identical to `IdentityOutcome`'s variant), which the tool
 * surfaces in the same forbidden envelope `sil_whoami` emits, and uses to decide
 * whether to clear the dead token (only on `user_not_provisioned`).
 */
export type SearchOutcome =
  | { kind: "ok"; products: SearchProduct[]; cursor?: string; specs_status?: SpecStatus[] }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; reason: string }
  | { kind: "invalid_request"; error: string; message: string }
  | { kind: "retryable"; source?: string; detail?: string };

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
 * than emitted as `undefined`.
 *
 * The enriched evaluate-before-buy surface mirrors {@link SearchVariant} exactly
 * (ONE vocabulary across both tools): `url` / `seller` / `media` / `metadata`,
 * each surfaced WHERE PRESENT via the same OPAQUE pass-through. `options` here is
 * the variant's SelectedOption picks (the SELECTIONS, e.g. "Size: B") — NOT the
 * product-level option DEFINITIONS that live on {@link LookupProduct.options}. */
export interface LookupVariant {
  id: string;
  title: string;
  price: SearchPrice;
  availability: SearchAvailability;
  checkout_url: string;
  sku?: string;
  options?: SelectedOption[];
  inputs?: LookupInput[];
  url?: string;
  seller?: Record<string, unknown>;
  media?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

/** One option selection on a variant, passed through OPAQUE from the UCP
 * `SelectedOption` (well-known fields `{ name, label }`, e.g. "Size: Large") —
 * the tool does NOT read or remap individual fields; it filters to plain objects
 * and passes them through verbatim, exactly as identity `addresses` pass through.
 * Surfaced so a lookup caller knows WHICH variant of a product they are buying. */
export type SelectedOption = Record<string, unknown>;

/** One looked-up product, projected to its RICH agent-facing detail (the deliberate
 * split vs search's LEAN six: a lookup caller is making a purchase decision, so it
 * gets `categories`, `handle`, `price_range`). Carries the product-level identity
 * AND the single featured `variant` (what to buy) — mirroring search's structural
 * shape; the split is rich-vs-lean FIELDS, not a different envelope. `categories`/
 * `handle` are omitted when absent. `categories` passes through opaque (the tool
 * surfaces it, it does not interpret it).
 *
 * `description` is the `{ plain }` lift — the SAME shape `sil_search` surfaces
 * (ONE vocabulary). Lookup once passed the WHOLE `description` object opaque; that
 * diverged from search the moment a wire `description` carried `html`/`markdown`,
 * so the same product would have yielded a different `description` shape across the
 * two tools. Lifting `.plain` on both reconciles it; `description` is omitted when
 * `plain` is absent/empty (so it is now optional, where it was once required).
 *
 * The enriched product surface mirrors {@link SearchProduct} (ONE vocabulary):
 * product-level `url` / `media` / `options` (the option DEFINITIONS) / `metadata`,
 * each surfaced WHERE PRESENT via the same OPAQUE pass-through. */
export interface LookupProduct {
  id: string;
  title: string;
  price_range: unknown;
  source: string;
  description?: ProductDescription;
  categories?: Record<string, unknown>[];
  handle?: string;
  url?: string;
  media?: Record<string, unknown>[];
  options?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
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
 * Models {@link SearchOutcome} — the SAME error/success classes so the two
 * catalog tools present ONE agent-facing error vocabulary, NOT a divergent one.
 * The `ok` variant carries the projected `products` + optional `not_found`
 * DIRECTLY (no nested `result`). `unauthorized` (401) is the refresh trigger —
 * the caller routes it through {@link refreshAndRetryOnce} (transparent
 * refresh-and-retry-once, parity with `sil_search` and `sil_whoami`); it is no
 * longer terminal for the catalog tools. `forbidden` (403) is terminal-but-
 * recoverable, carrying the actionable `reason` exactly as {@link SearchOutcome}
 * does — a 403 surfaces as the shared forbidden envelope, never the false-transient
 * `retryable`; refreshing it would not help (it is not `unauthorized`).
 *
 * Structural deltas from `SearchOutcome`, both handled here: NO `cursor` (lookup
 * is a batch resolve, not a list) and a `not_found` id list parsed from the
 * server's `not_found` info `messages`.
 */
export type LookupOutcome =
  | { kind: "ok"; products: LookupProduct[]; not_found?: string[] }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; reason: string }
  | { kind: "invalid_request"; error: string; message: string }
  | { kind: "retryable"; source?: string; detail?: string };

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
 * Classify a sil-api catalog-search response from its HTTP status AND body.
 * Branches on STATUS (and, for 200, the body shape) — never on `res.ok`:
 *   400 → invalid_request (surface sil-api's structured `{ error, message }`,
 *         e.g. `empty_search_input` — distinct from both the empty-match success
 *         and a transient failure; the agent must learn to fix its query, not
 *         retry or re-register)
 *   401 → unauthorized (the refresh trigger — the caller drives transparent
 *         refresh-and-retry-once via `refreshAndRetryOnce`, not terminal)
 *   403 → forbidden (terminal-but-recoverable; carries the actionable reason
 *         `user_not_provisioned`/`principal_mismatch`, defaulting to the generic
 *         `"forbidden"` marker on an unexpected body — parity with
 *         `classifyIdentityResponse`). A 403 is NOT a 401: it surfaces as the
 *         shared forbidden envelope, never the false-transient `retryable`, and a
 *         valid-but-unprovisioned token gains nothing from a refresh.
 *   5xx / other non-200 → retryable
 *   200 → read `products` off sil-api's FLAT envelope (`{ ucp, products,
 *         pagination? }` — top level, no `result` wrapper), normalize, and require
 *         `products` to be a real ARRAY. A 200 that yields no usable top-level
 *         products array (a partial / garbage / stub-shaped body, or one carrying
 *         only `ucp` metadata) is `retryable`, NEVER `ok` — the
 *         `Array.isArray(products)` gate is the anti-false-green guard, the
 *         analogue of the identity `name`-gate. A genuine empty match (200 whose
 *         top-level `products` IS `[]`) is `ok` with an empty product list: a
 *         SUCCESS, distinct from the no-array guard.
 *
 * Pure and exported — unit-tested in isolation like `classifyIdentityResponse`;
 * conflating the empty-match success with a partial-200 false-green, or with the
 * 400/401/403/5xx error classes, is the highest-risk subtle bug in this flow.
 */
export function classifySearchResponse(status: number, body: unknown): SearchOutcome {
  if (status === 400) {
    const { error, message } = extractApiError(body);
    return { kind: "invalid_request", error, message };
  }
  if (status === 401) return { kind: "unauthorized" };
  if (status === 403) return { kind: "forbidden", reason: extractForbiddenReason(body) };
  // 422 source_rejected: the source LOOKED at this exact request and refused it —
  // it can never succeed unchanged, so it is non-retryable invalid_request carrying
  // the real upstream cause, NOT the source-named `retryable` the fallthrough below
  // would produce (a 422 body names a `source`, so `retryableFromBody` would emit
  // outcome (b) and tell the agent to retry a doomed request). This is the third
  // arm of the 401-vs-403-vs-422 split: 401 refresh-and-retry, 403 forbidden
  // (refresh won't help), 422 invalid_request (fix the request, don't retry).
  // Matches EXACTLY 422 — a 5xx/429 source_unavailable stays `retryable` (outcome b).
  if (status === 422) {
    const { error, message } = extractApiError(body);
    return { kind: "invalid_request", error, message };
  }
  if (status !== 200) return retryableFromBody(body);

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
 *   401 → unauthorized (the refresh trigger — the caller drives transparent
 *         refresh-and-retry-once via `refreshAndRetryOnce`, parity with search)
 *   403 → forbidden (terminal-but-recoverable; carries the actionable reason
 *         `user_not_provisioned`/`principal_mismatch`, defaulting to the generic
 *         `"forbidden"` marker on an unexpected body — parity with search and
 *         `classifyIdentityResponse`). A 403 surfaces as the shared forbidden
 *         envelope, never the false-transient `retryable`; it is NOT a 401, so no
 *         refresh is triggered.
 *   5xx / other non-200 → retryable
 *   200 → read `products` off sil-api's FLAT envelope (`{ ucp, products,
 *         messages? }` — top level, no `result` wrapper), normalize, and require
 *         `products` to be a real ARRAY. A 200 that yields no usable top-level
 *         products array (a partial / garbage / stub-shaped body) is `retryable`,
 *         NEVER `ok` — the `Array.isArray(products)` gate is the anti-false-green
 *         guard, the analogue of the identity `name`-gate and search's
 *         products-array gate.
 *
 * THE subtle correctness point: an all-MISSED lookup is a genuine SUCCESS — a 200
 * whose top-level `products` IS an empty array WITH a populated `not_found` list
 * ("none of these ids exist anymore"). It is `ok` with empty `products` + full
 * `not_found`, distinct from the no-array guard above. The discriminator between
 * "valid all-missed" and "garbage 200" is the `products`-array PRESENCE, NEVER
 * array length — exactly as search distinguishes empty-match from a partial-200
 * false-green.
 *
 * Pure and exported — unit-tested in isolation like `classifySearchResponse`.
 */
export function classifyLookupResponse(status: number, body: unknown): LookupOutcome {
  if (status === 400) {
    const { error, message } = extractApiError(body);
    return { kind: "invalid_request", error, message };
  }
  if (status === 401) return { kind: "unauthorized" };
  if (status === 403) return { kind: "forbidden", reason: extractForbiddenReason(body) };
  // 422 source_rejected: the twin seam of `classifySearchResponse` — sil-api emits
  // 422 on the SHARED source layer backing both catalog routes, so a source-rejected
  // lookup is the same non-retryable invalid_request, carrying the upstream cause,
  // NOT the source-named `retryable` the fallthrough would produce. Same one error
  // vocabulary across both catalog tools (see this fn's doc-comment). Matches EXACTLY
  // 422 — a 5xx/429 source_unavailable stays `retryable` (outcome b).
  if (status === 422) {
    const { error, message } = extractApiError(body);
    return { kind: "invalid_request", error, message };
  }
  if (status !== 200) return retryableFromBody(body);

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
 *
 * THE load-bearing rename: the agent arg `ship_to` (singular) becomes the wire key
 * `filters.ships_to` (plural). `condition`/`available` keep their name under
 * `filters.*`. These three ride sil-api's OPEN `SearchFilters`
 * (`additionalProperties: true`), which SILENTLY accepts an unknown key — so the
 * exact emitted key name is the only thing standing between a working serviceability
 * filter and a no-op (a wrong rename fails GREEN). Each is forwarded ONLY when
 * supplied (omit-when-absent, identical to `category`/`price`/`pagination`); NO
 * client-injected default (the server applies `available: true`). A supplied
 * `available: false` is narrowed with `typeof === "boolean"`, never `if (v)`, so the
 * meaningful `false` (include unavailable items) survives.
 *
 * `local_merchants` is the ONE field that does NOT ride `filters`. It is a
 * sil-PRIVATE ranking-bias signal, not a UCP/Global-Catalog filter — `filters` is
 * forwarded to the cross-shop Global Catalog, whose OPEN schema would silently
 * accept and ignore an unknown `local_merchants` key (the exact wrong-placement
 * no-op the rename hazard above warns of). So it is emitted at the TOP LEVEL of the
 * body (beside `query`/`filters`/`pagination`), and ONLY when exactly `true`: unlike
 * `available: false` (a meaningful include-unavailable signal that survives), a
 * `false` bias carries NO signal (== the server's unbiased default), so `false` and
 * absent both omit the key (narrow on the VALUE, not just the type — emit iff true).
 *
 * COUNTRY-CASE NORMALIZATION is the wire layer's job (the read site owns FORMAT
 * rejection): `ships_to.country` is emitted UPPERCASE (`us` → `US`), the alpha-2
 * contract `@sil/schemas` `ShipTo` mirrors byte-for-byte. A lowercase code on the
 * wire would diverge from the sibling and (depending on the server's
 * case-sensitivity) silently mis-filter. `region` and `postal_code` are forwarded
 * VERBATIM — they passed their pattern at the read site, and the wire normalizes
 * only country case.
 */
function buildSearchBody(params: SearchParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // The agent's free-text `query` is PRIMARY; each POSITIVE spec predicate folds
  // its value(+unit) in as a backstop (deduped case-insensitively) so a structured
  // requirement still moves results at `applied:false`. `renderSpecQuery` returns
  // the base query verbatim when there are no specs (behaviour-preserving).
  const query = renderSpecQuery(params.query, params.specs ?? []);
  if (query !== undefined) body["query"] = query;

  const filters: Record<string, unknown> = {};
  if (typeof params.category === "string") {
    filters["categories"] = [params.category];
  }
  const price: Record<string, unknown> = {};
  if (typeof params.price_min === "number") price["min"] = params.price_min;
  if (typeof params.price_max === "number") price["max"] = params.price_max;
  if (Object.keys(price).length > 0) filters["price"] = price;

  // The three serviceability/localization filters — the `ship_to` → `ships_to`
  // rename happens here; the other two keep their name. Country is uppercased on
  // emit (region/postal forwarded verbatim); the other two pass through as-is.
  if (params.ship_to !== undefined) filters["ships_to"] = withUppercaseCountry(params.ship_to);
  if (params.condition !== undefined) filters["condition"] = params.condition;
  if (typeof params.available === "boolean") filters["available"] = params.available;

  // The structured requirement predicates ride ONE namespaced well-known key —
  // `filters.specs` holds the WHOLE array (never spread as `filters.<key>`, which
  // would collide with a typed filter and fail-green on the open `SearchFilters`;
  // never top-level — unlike the sil-private `local_merchants`, `specs` is a
  // backend-bound filter). `hard` rides each entry UNCHANGED. A present-but-empty
  // `[]` emits nothing (the query is unchanged, `filters.specs` omitted).
  if (Array.isArray(params.specs) && params.specs.length > 0) filters["specs"] = params.specs;

  if (Object.keys(filters).length > 0) body["filters"] = filters;

  // `local_merchants` is a sil-PRIVATE ranking bias — it rides at the TOP LEVEL of
  // the body (a sibling of `query`/`filters`/`pagination`), NEVER under `filters`
  // (those are forwarded to the Global Catalog, which would silently swallow it).
  // Emitted ONLY when exactly `true`: a `false`/absent bias carries no signal (it is
  // the server's unbiased default), so — unlike `available:false` — it is omitted.
  // Narrow on the VALUE, not just the type: `=== true`, never a truthiness coerce.
  if (params.local_merchants === true) body["local_merchants"] = true;

  const pagination: Record<string, unknown> = {};
  if (typeof params.cursor === "string") pagination["cursor"] = params.cursor;
  if (typeof params.limit === "number") pagination["limit"] = params.limit;
  if (Object.keys(pagination).length > 0) body["pagination"] = pagination;

  return body;
}

/** The POSITIVE spec ops whose value folds into the free-text query. The rest
 * (`neq`/`nin`/`exists`) render NOTHING — a negation as a bare positive token
 * would surface exactly what it EXCLUDES, failing worse than a silent no-op. */
const POSITIVE_SPEC_OPS: ReadonlySet<SpecOp> = new Set(["eq", "gte", "lte", "in"]);

/**
 * Fold the POSITIVE spec predicates into the agent's free-text `query` as a
 * backstop so a structured requirement still moves results while the backend
 * reports it `applied:false`. The agent's phrasing stays PRIMARY and un-mangled:
 * its tokens are kept, and each spec token is appended ONLY when not already
 * present (case-insensitive, whitespace-tokenized) so the fold never duplicates
 * what the agent already wrote nor what an earlier predicate rendered.
 *
 * A predicate renders `value` immediately followed by `unit` (`16` + `GB` →
 * `16GB`, matching the design's rendered-form example — NO separating space); an
 * `in` array renders one token per element. Negation/existence ops and BOOLEAN
 * values render nothing (see {@link POSITIVE_SPEC_OPS}).
 *
 * Behaviour-preserving when `specs` is empty: returns the base `query` verbatim
 * (including an empty string, kept present), or `undefined` when there is no base
 * query and nothing to fold (so `buildSearchBody` omits the key).
 */
function renderSpecQuery(query: string | undefined, specs: SpecPredicate[]): string | undefined {
  const hasBase = typeof query === "string";
  const base = hasBase ? query : "";
  const seen = new Set(tokenizeQuery(base));
  const additions: string[] = [];
  for (const spec of specs) {
    for (const token of renderSpecTokens(spec)) {
      const lower = token.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      additions.push(token);
    }
  }
  if (additions.length === 0) return hasBase ? base : undefined;
  return [base, ...additions].filter((token) => token.length > 0).join(" ");
}

/** The free-text query as lower-cased, whitespace-split tokens — the dedup set the
 * spec fold checks each rendered token against. */
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** Render one predicate to its query token(s), or none. Only POSITIVE ops render;
 * `value` is stringified with `unit` appended (no space), an array value yields one
 * token per element, and a boolean/absent value renders nothing. */
function renderSpecTokens(spec: SpecPredicate): string[] {
  if (!POSITIVE_SPEC_OPS.has(spec.op)) return [];
  const unit = typeof spec.unit === "string" ? spec.unit : "";
  const values = Array.isArray(spec.value) ? spec.value : [spec.value];
  const tokens: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    tokens.push(`${value}${unit}`);
  }
  return tokens;
}

/** Emit a ship-to object with its alpha-2 `country` UPPERCASED on the wire
 * (`us` → `US`); every other field (`region`/`postal_code` on {@link ShipTo}) is
 * preserved verbatim. The spread-then-overwrite keeps the shape generic over any
 * `{ country }`-bearing value without reshaping or dropping a field. */
function withUppercaseCountry<T extends { country: string }>(value: T): T {
  return { ...value, country: value.country.toUpperCase() };
}

/**
 * Unwrap + narrow a sil-api catalog-search response body to a typed
 * {@link SearchResult}, or null if it carries no usable products array. sil-api
 * emits a FLAT UCP envelope (`withUcpMeta(body) → { ucp, ...body }` —
 * sil-services `.../sil-api/src/envelope.ts`): `products` and `pagination` sit at
 * the TOP LEVEL beside `ucp`, there is NO `result` wrapper. Read them straight
 * off the body. (There is no nested-`result` fallback to keep: search has no
 * second route that ever returns one, so a `result`-wrapper expectation would be
 * dead weight and — worse — a latent false-green a stray `result` key could shadow
 * the real top-level `products`.)
 *
 * The load-bearing anti-false-green guard is the `Array.isArray(products)` check:
 * a 200 lacking a real top-level `products` array (a partial / garbage / stub
 * `{ stub: true }` body, or one carrying only `ucp` metadata) returns null →
 * `retryable`, never a false-green empty match. An EMPTY array is a VALID empty
 * match (a genuine "nothing matched") and returns an empty `products` list —
 * distinct from the no-array guard. Individual products that are unusable (no
 * projectable featured variant, missing checkout_url) are dropped via
 * `projectProduct` returning null, never fabricated.
 *
 * The opaque cursor is hoisted from `pagination.cursor` and surfaced ONLY when
 * `pagination.has_next_page` is true (end-of-results is the absent cursor — never
 * derived from `products.length`).
 *
 * `specs_status` is read off the SAME flat envelope as a sibling of `products`
 * (via {@link extractSpecsStatus}), so the observable per-predicate applied-status
 * surfaces even on an empty match. It is informational — NEVER a purchasability
 * gate; the `Array.isArray(products)` anti-false-green guard is unchanged.
 */
function extractSearchResult(body: unknown): SearchResult | null {
  const envelope = asRecord(body);
  if (envelope === null) return null;

  const rawProducts = envelope["products"];
  if (!Array.isArray(rawProducts)) return null;

  const products = rawProducts
    .map(projectProduct)
    .filter((p): p is SearchProduct => p !== null);

  const result: SearchResult = { products };
  const cursor = extractCursor(envelope["pagination"]);
  if (cursor !== null) result.cursor = cursor;
  const specsStatus = extractSpecsStatus(envelope["specs_status"]);
  if (specsStatus !== null) result.specs_status = specsStatus;
  return result;
}

/** Narrow the wire `specs_status` to {@link SpecStatus}[], or null to OMIT the
 * key. Each usable entry needs a non-empty string `ns`, a non-empty string `key`,
 * and a BOOLEAN `applied`; a malformed entry is DROPPED (never fabricated
 * `applied:true`, never a crash). Returns null when the field is absent/non-array
 * OR when no entry survives — the no-fabrication discipline: interpreting the
 * ABSENCE of a status is reflection's job, not the tool's. A fully-`applied:false`
 * array is the honest "not indexed yet" shape and passes through whole. */
function extractSpecsStatus(raw: unknown): SpecStatus[] | null {
  if (!Array.isArray(raw)) return null;
  const statuses = raw
    .map((entry): SpecStatus | null => {
      const obj = asRecord(entry);
      if (obj === null) return null;
      const ns = obj["ns"];
      const key = obj["key"];
      const applied = obj["applied"];
      if (typeof ns !== "string" || ns.length === 0) return null;
      if (typeof key !== "string" || key.length === 0) return null;
      if (typeof applied !== "boolean") return null;
      return { ns, key, applied };
    })
    .filter((s): s is SpecStatus => s !== null);
  return statuses.length === 0 ? null : statuses;
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

  const result: SearchProduct = { id: productId, title: productTitle, source, variant };
  attachProductEnrichment(result, product);
  return result;
}

/**
 * Project a `SilCatalogVariant` to the agent-facing {@link SearchVariant}, or
 * null if it is not a usable purchasable variant. Requires `id`, `title`, a price
 * object, and a non-empty `checkout_url`; `price`/`availability` pass through
 * opaque. The PURCHASABILITY gate is unchanged — the enriched fields are additive
 * context, never a new gate: a variant lacking a non-empty `checkout_url` is still
 * dropped even when it carries `url`/`seller`/`media`.
 *
 * The enriched per-variant surface (`url`/`seller`/`media`/`metadata`) is attached
 * via {@link attachVariantEnrichment}, each ONLY when present.
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

  const result: SearchVariant = {
    id,
    title,
    price,
    availability: extractAvailability(variant["availability"]),
    checkout_url: checkoutUrl,
  };
  attachVariantEnrichment(result, variant);
  return result;
}

/**
 * Unwrap + narrow a sil-api catalog-LOOKUP response body to a typed
 * {@link LookupResult}, or null if it carries no usable products array. Like
 * `extractSearchResult`, it reads sil-api's FLAT UCP envelope
 * (`withUcpMeta(body) → { ucp, ...body }`): `products` and `messages` sit at the
 * TOP LEVEL beside `ucp`, there is NO `result` wrapper — read them straight off
 * the body (no nested-`result` fallback; lookup has no route that returns one).
 *
 * It shares search's load-bearing anti-false-green guard — `Array.isArray(products)`
 * on the TOP-LEVEL `products`; a 200 lacking it (partial / garbage / stub
 * `{ stub: true }`, or only `ucp` metadata) returns null → `retryable`. An EMPTY
 * array is a VALID all-missed lookup (the products gate passes; `not_found`
 * carries the ids) — distinct from the no-array guard. The two structural deltas
 * from search:
 *   - NO cursor hoist — lookup is a batch resolve, not a list (no `pagination`).
 *   - `not_found` is parsed from the top-level `messages`: each
 *     `{ code: 'not_found', content: <id> }` entry's `content` IS a missed request
 *     id (server emits one per unresolved id, in input order, and OMITS `messages`
 *     on full success). The `not_found` key is omitted here when there are no misses.
 *
 * Products unusable in lookup terms (no projectable featured variant, missing
 * `checkout_url`) are dropped via `projectLookupProduct` returning null, never
 * fabricated — same null-drop discipline as search.
 */
function extractLookupResult(body: unknown): LookupResult | null {
  const envelope = asRecord(body);
  if (envelope === null) return null;

  const rawProducts = envelope["products"];
  if (!Array.isArray(rawProducts)) return null;

  const products = rawProducts
    .map(projectLookupProduct)
    .filter((p): p is LookupProduct => p !== null);

  const notFound = extractNotFound(envelope["messages"]);
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

  const priceRange = product["price_range"];
  if (asRecord(priceRange) === null) return null;

  const variants = product["variants"];
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const variant = projectLookupVariant(variants[0]);
  if (variant === null) return null;

  const result: LookupProduct = {
    id,
    title,
    price_range: priceRange,
    source,
    variant,
  };
  const categories = passThroughObjects(product["categories"]);
  if (categories !== null) result.categories = categories;
  const handle = product["handle"];
  if (typeof handle === "string" && handle.length > 0) result.handle = handle;
  // `description` is now the `{ plain }` lift (ONE vocabulary with search), NOT the
  // whole opaque object — omitted entirely when `plain` is absent/empty. Reuses the
  // SAME product-enrichment attach as search so both tools surface the identical
  // enriched shape (`url`/`description`/`media`/`options`/`metadata`).
  attachProductEnrichment(result, product);
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
  // The SAME enriched per-variant surface as search (ONE vocabulary):
  // `url`/`seller`/`media`/`metadata`, each only when present. The variant's
  // `options` SELECTIONS above and these enriched fields are distinct, additive.
  attachVariantEnrichment(result, variant);
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

/** Pass a single wire OBJECT through OPAQUE — forward it verbatim when it is a
 * plain object, never reading or remapping individual fields. The single-object
 * counterpart to {@link passThroughObjects}, for `seller` and `metadata`: contextual
 * data the tool SURFACES but does not interpret. This is the load-bearing
 * narrow-vs-pass-through guard ([[sil-shared-catalog-client]]) — a typed
 * `{ name, links }` narrow on `seller` would silently DROP the Shopify extension
 * keys (`seller.url`/`seller.domain`) the source attaches, and pass a naive fixture;
 * opaque pass-through keeps both the base shape and any extension/drift. An ARRAY is
 * NOT a usable object here (a `seller`/`metadata` that arrived as `[]` is garbage),
 * so arrays return null and the caller omits the key. */
function passThroughObject(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** Lift the agent-facing {@link ProductDescription} (`{ plain }`) from a wire
 * `description` object, or null to OMIT. Surfaces ONLY the `plain` UCP format, and
 * ONLY when it is a non-empty string — `html`/`markdown` are never substituted into
 * `plain` (the spec flags `html` as untrusted rich text), and an absent/empty `plain`
 * omits the whole `description` key. This is the one SCALAR read in the enriched
 * surface (a stable, named UCP sub-field), and lifting it identically on both catalog
 * tools is what keeps them on ONE `description` shape. */
function liftDescriptionPlain(raw: unknown): ProductDescription | null {
  const obj = asRecord(raw);
  if (obj === null) return null;
  const plain = obj["plain"];
  return typeof plain === "string" && plain.length > 0 ? { plain } : null;
}

/** Attach the enriched PRODUCT surface (`url`/`description`/`media`/`options`/
 * `metadata`) onto a projected product, each ONLY when present on the wire object.
 * Shared verbatim by `projectProduct` (search) and `projectLookupProduct` (lookup)
 * so BOTH tools surface the IDENTICAL enriched shape — the ONE-vocabulary property.
 * Mutates `target` in place (it is a freshly-built projection the caller owns). Every
 * field is OPAQUE pass-through keyed on PRESENCE; the only scalar read is
 * `description.plain`. Omit-when-absent is per-field — an absent / empty-`plain` /
 * no-`metadata` / all-garbage-array field leaves its key off entirely (no null/''/[]). */
function attachProductEnrichment(
  target: SearchProduct | LookupProduct,
  product: Record<string, unknown>,
): void {
  const url = product["url"];
  if (typeof url === "string" && url.length > 0) target.url = url;
  const description = liftDescriptionPlain(product["description"]);
  if (description !== null) target.description = description;
  const media = passThroughObjects(product["media"]);
  if (media !== null) target.media = media;
  const options = passThroughObjects(product["options"]);
  if (options !== null) target.options = options;
  const metadata = passThroughObject(product["metadata"]);
  if (metadata !== null) target.metadata = metadata;
}

/** Attach the enriched per-VARIANT surface (`url`/`seller`/`media`/`metadata`) onto a
 * projected variant, each ONLY when present. Shared verbatim by `projectVariant`
 * (search) and `projectLookupVariant` (lookup) — the variant half of the
 * ONE-vocabulary property. `seller` (incl. `seller.links[]`) and `metadata` are
 * single-object opaque pass-through; `media` is array pass-through. Same
 * omit-when-absent, per-field, never-narrow discipline as the product surface. */
function attachVariantEnrichment(
  target: SearchVariant | LookupVariant,
  variant: Record<string, unknown>,
): void {
  const url = variant["url"];
  if (typeof url === "string" && url.length > 0) target.url = url;
  const seller = passThroughObject(variant["seller"]);
  if (seller !== null) target.seller = seller;
  const media = passThroughObjects(variant["media"]);
  if (media !== null) target.media = media;
  const metadata = passThroughObject(variant["metadata"]);
  if (metadata !== null) target.metadata = metadata;
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
