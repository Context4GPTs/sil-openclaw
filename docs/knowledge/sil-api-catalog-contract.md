---
id: sil-api-catalog-contract
title: sil-api catalog reads — FLAT { ucp, products, … } envelope (no result wrapper), bare POST /catalog/{search,lookup}, OPEN SearchFilters (wrong key fails GREEN), serviceability ships_to/ships_from FORMAT regexes mirror @sil/schemas byte-for-byte, @sil/schemas is the wire truth (NOT @ucp-js/sdk)
tags: [sil-api, catalog, search, lookup, contract, wire-types, envelope, filters, serviceability, ship-to, format, cross-sibling, gotcha]
card: sil-search-plugin-tool
commit: bcbab28
updated_at: 2026-06-11
updated_by_card: add-ship-to-filter-args-to-the-sil-search-tool
---

sil-api serves **two** catalog read endpoints, both against a **live, merged** contract (PR #18), both on the **bare** path / `getSilApiUrl()` origin, both returning a **FLAT** UCP envelope `{ ucp, products, … }` whose top-level `products` is `SilCatalogProduct[]` (each product a **required `source`**, each variant a **required, non-empty `checkout_url`**): `POST /catalog/search` (LEAN, ranked, paginated — `sil_search`/SC1) and `POST /catalog/lookup` (RICH, batch-resolve-by-id — `sil_product_get`/SC2). Three facts about the contract are non-obvious — two bit BOTH cards on arrival (the wrong path + wrong wire-type source, propagated from the goal's card-fanout template), and the third (the envelope is FLAT, not nested under `result`) silently broke the live read until card `catalog-plugin-tools-read-sil-api-flat-envelope` fixed it (PR #13). See "The envelope is FLAT" below — this is the contract the extractors actually read.

## The envelope is FLAT: `{ ucp, ...body }`, never `{ result: {...} }`

sil-api's `withUcpMeta(body) → { ucp, ...body }` (`sil-services/services/sil-api/src/envelope.ts:33-45`) spreads the domain body onto the **top level** beside `ucp`. The catalog response fields — `products`, `pagination` (search), `messages` (lookup) — sit at the **top level**, NOT under a `result` wrapper. There is **no `result` key** on a catalog response. The plugin extractors read every field off the flat body: `extractSearchResult` (`src/lib/sil-client.ts:901`) reads `envelope["products"]` + `envelope["pagination"]`; `extractLookupResult` (`:997`) reads `envelope["products"]` + `envelope["messages"]`. (`@sil/schemas` `packages/schemas/src/envelope.ts` `UcpResponse(body) = Type.Object({ ucp, ...body.properties })` `:105-115` is structurally flat; the UCP spec's `search_response`/`lookup_response` `$defs` carry `products`/`pagination`/`messages` at the response level — sil-api conforms.)

**This corrects a phantom contract.** The plugin originally required a nested `envelope.result.products` and short-circuited on `result === null` — a shape sil-api **never emitted**. The guard fired on every live response and `sil_search`/`sil_product_get` degraded to `retryable` (the SC1/SC2 live-path breakage + the sole sil-openclaw gate on the SC10 catalog eval). The fix **dropped** the nested-`result` read entirely (no `result ?? envelope` fallback — search/lookup have no second bare-vs-enveloped route, unlike identity; see the asymmetry note in [[sil-response-classification]]). The integration test that had "proven" the nested shape was asserting a contract that never existed.

## The contract the plugin consumes

`searchCatalog` (`src/lib/sil-client.ts:613`) issues:

```
POST <sil_api_base>/catalog/search      (BARE path — NOT /api/v1/catalog/search)
Authorization: Bearer <stored access_token>
body: { query?,
        filters?: { categories?: string[], price?: { min?, max? },
                    ships_to?: { country, region?, postal_code? }, ships_from?: { country },
                    condition?: string[], available?: boolean },
        pagination?: { cursor?, limit? } }
       — only the keys the agent supplied are emitted; an absent filter is an OMITTED key, never an empty {}
```

The serviceability/localization filters (`ships_to`/`ships_from`/`condition`/`available`) are detailed in "The serviceability filters ride an OPEN SearchFilters" below — that section names the one wire seam on this contract that can fail *green*.

Expected responses (classified by [[sil-response-classification]]'s `classifySearchResponse`):

| Status | Meaning | Plugin action |
|---|---|---|
| `200` flat envelope `{ ucp, products: SilCatalogProduct[], pagination? }` | a search result (possibly empty) | read top-level `products`, project first/featured variant per product, hoist `pagination.cursor` iff `has_next_page` |
| `200` whose top-level `products` is **not an array** (partial / garbage / stub) | NOT a valid result | `retryable` — the anti-false-green guard (`Array.isArray(products)`), NEVER a false `ok` |
| `400` `{ error: "empty_search_input", message }` | server-side empty-input rejection | `invalid_request` — surface `{error,message}`; the agent fixes its query (do NOT retry, do NOT re-register) |
| `401` | dead session | terminal re-register (single round-trip — no transparent refresh in SC1) |
| `5xx` / network / abort | source/transport failure | `retryable` — try again, NO `recovery: sil_register` |

A **genuine empty match** (200 with top-level `products: []`) is a SUCCESS (`ok` + empty list), NOT an error — distinct from the no-array guard above. (UCP: "empty search returns an empty array … this is not an error.")

## The serviceability filters ride an OPEN `SearchFilters` — a wrong wire key fails GREEN

`SearchFilters` (sil-services `packages/schemas/src/catalog.ts`) is **open** — `additionalProperties: true`. A search-filter key that sil-api does not recognise is **silently accepted and ignored**: no `400`, no error, the filter just no-ops. So the *exact emitted key string* is the only thing standing between a working serviceability filter and a silent no-op — this seam **fails green**, which is why the `buildSearchBody` mapping is pinned by whole-body equality in `search-client.test.ts`, not just "a filter was sent".

Two consequences a future catalog card (and the sil-services sibling) must hold exactly:

1. **The agent arg `ship_to` (singular) is renamed to the wire key `filters.ships_to` (plural).** The agent-facing param is `ship_to` — the founder's word, and what the sil-services default-resolution sibling's "agent omitted `ship_to`" trigger reads — but the wire/`SearchFilters` key is `ships_to`, matching the Shopify Global-Catalog extension (`../../vendor/shopify/docs/agents/catalog/global-catalog-extension.md:32`). The rename lives in `buildSearchBody` (`src/lib/sil-client.ts`). `ships_from`/`condition`/`available` keep one name on both sides. Emitting the singular `ship_to` on the wire, or landing any of these under request-level `context` instead of `filters`, no-ops silently against the open schema. (Cross-sibling contract: `filters.ships_to{country,region?,postal_code?}` must be byte-identical to what sil-services resolves server-side — see [[location-aware-search-flow]].)
2. **No client-injected defaults; `available: false` survives.** Each of the four is emitted ONLY when the agent supplied it (omit-when-absent, identical to `categories`/`price`/`pagination`) — the plugin never injects `available: true` (the server applies that default). `available: false` is the meaningful "include unavailable items" signal and must be narrowed by `typeof === "boolean"`, never a truthiness guard, or it is dropped as falsy.

These keys are accepted on the wire **today** even though the sil-services `SearchFilters` does not yet name them — `additionalProperties: true` is what lets the plugin ship ahead of the sibling. Until the sibling card (`attach-buyer-ship-to-context-server-side-in-sil-ap`) lands, an omitted `ship_to` resolves to *nothing* server-side (un-localized search), not the registered default — the agent-facing promise is only end-to-end true once that sibling ships. (See [[location-aware-search-flow]].)

## The `ships_to`/`ships_from` FORMAT contract is a byte-for-byte cross-repo mirror (no shared package)

The country/region/postal formats are **enforced**, and the three regexes are a **lockstep mirror** of sil-services `@sil/schemas` `ShipTo`/`ShipFrom` — they MUST stay byte-identical across the two repos, with **no shared package to hold them in sync** ([[sil-shared-catalog-client]]: the plugin re-declares the read-subset locally, it does not import `@sil/schemas`). The plugin pins them once as module constants in `src/tools/catalog.ts` (used BOTH as the schema `pattern` and as the read-site gate):

| Field | Regex | Meaning |
|---|---|---|
| `country` (ships_to + ships_from) | `^[A-Za-z]{2}$` | ISO 3166-1 alpha-2 — a 2-letter code, never a country name |
| `region` | `^[A-Za-z0-9]{1,3}$` | ISO 3166-2 subdivision code (CA/NY/BY/97), bounded — never a place name |
| `postal_code` | `^(?=[A-Za-z0-9 -]{2,12}$)[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$` | a single self-contained pattern — a length-cap lookahead (2–12 chars, separators counted) + a structural body (alnum runs joined by single internal space/hyphen, no leading/trailing/doubled separator). Accepts `94107`/`EC1A 1BB`/`K1A 0B1`; rejects prose/injection/overlong/non-ASCII |

The postal pattern is deliberately **one regex** (length-cap lookahead + body, not `pattern` + `minLength`/`maxLength`) so the sibling can mirror it from a single directive string with nothing extra to keep in lockstep. The **failure mode is silent divergence**: an edit to one side's pattern (here OR in `@sil/schemas`) that the other doesn't match makes the two repos disagree on what's valid — the sil-stage `live-catalog-serviceability-localization-eval` is the end-to-end check that catches it. A future change to any of these three patterns must land in **both** repos in the same change.

**Enforcement is client-side, fail-fast — replacing a fail-late sil-api 400.** A present-but-malformed string (`country: "United States"`, `region: "California"`) is **rejected whole-request client-side** before any network call, with a structured `{ status: "invalid_request", error: "invalid_filter", message }` envelope (no `recovery` — auth is fine, the format is the problem). This is the deliberate replacement for the prior thin contract, which forwarded free text and ate an opaque, unrecoverable sil-api 400. The `country` value is then **uppercased on the wire** (`us`→`US`, in `buildSearchBody` — the read site owns FORMAT, the wire owns case); `region`/`postal_code` go verbatim. So the alpha-2 a sibling stores must compare against the **uppercased** wire value. (`condition` is the exception: its wire stays OPEN — an unrecognized value like `"refurbished"` still forwards, never rejected; the known set new/secondhand is steered in the description only, never validated.)

## The lookup endpoint — `POST /catalog/lookup` (the batch-resolve sibling)

`lookupCatalog` (`src/lib/sil-client.ts`, classified by `classifyLookupResponse`) issues:

```
POST <sil_api_base>/catalog/lookup       (BARE path, same origin as search)
Authorization: Bearer <stored access_token>
body: { ids: string[] }                   — ≥1 id; NO filters/context, NO envelope
```

The flat body is `CatalogLookupResult { products: SilCatalogProduct[], messages? }` spread under `ucp` (no `result` wrapper — see "The envelope is FLAT" above) — **structurally the same product/variant shape as search**, with two deltas that make it its own classifier/extractor rather than a reuse of search's:

1. **No `pagination`.** Lookup is a batch resolve, not a list — there is no `cursor` to hoist. (`@sil/schemas` `catalog.ts`; the doc-line is explicit.)
2. **Misses come back as `messages`, and a miss is a SUCCESS — never an error.** Each unresolved id is one `{ type:"info", code:"not_found", content:<the-id> }` entry in the top-level `messages`, in input order, and the `messages` key is **omitted entirely on full success**. The plugin parses those `content` values into `not_found: string[]` on the `ok` outcome. This is the lookup analogue of search's empty-match-is-success, but lookup *names which ids* came back empty. Surfacing a miss as an error (non-200, or `status:"error"`) is wrong — it makes the most common benign case (a saved/`sil_search`-derived id since delisted) fall into the agent's error branch and discards the ids that DID resolve. (UCP §Identifiers Not Found; sil-api `handlers/catalog.ts:88-91,123-128`.)

Two more lookup-only facts the next catalog card needs:

- **Each variant carries an `inputs: [{ id, match }]` correlation** — which request id(s) resolved to it, and whether the match was `exact` (a direct variant/sku/barcode hit) or `featured` (a product-id hit; the server picked a representative variant). It is **load-bearing, not decoration**: UCP does NOT guarantee the response preserves request order, and one id can resolve to a *variant of another id's product* (`lookup.md` §Client Correlation), so `inputs` is the ONLY way to map "the id I asked about" → "the variant I got back". `match` is an OPEN string — pass it through, don't enumerate it.
- **Empty `ids` is a Fastify SCHEMA 400, NOT search's `empty_search_input` SourceError.** That `SourceError` code (`sourceErrorToHttp`) is search-only and never arises on the lookup route. A missing/empty `ids` is rejected by `CatalogLookupRequest.ids` `minItems:1` → a generic 400; the classifier maps any 400 → `invalid_request` and surfaces the server's `{ error, message }`. Do NOT special-case `empty_search_input` on the lookup path. (A `request_too_large` over-batch is the other 400 on this route — same `invalid_request` mapping.)

The all-missed lookup (200, top-level `products: []`, a `not_found` for every id) is a genuine SUCCESS — `ok` with empty `products` + a full `not_found`. The anti-false-green discriminator between it and a garbage/stub 200 is `Array.isArray(products)` PRESENCE on the flat body, **never length** (see [[sil-response-classification]]).

## Two wrong facts the card/template propagated (these bite the next catalog card)

> The goal's card-fanout template seeded BOTH `sil_search` (SC1) and `sil_product_get` (SC2 — the lookup sibling) — and likely any future agentic-search-slice catalog card — with the same two incorrect facts. They are wrong; do not copy them.

1. **The path is NOT `/api/v1/catalog/{search,lookup}`.** sil-api serves catalog at the **bare** `/catalog/search` and `/catalog/lookup` — there is no `/api/v1` prefix anywhere in sil-api (that prefix is sil-web's, the auth authority). A catalog read is a sil-api **domain** read, so it goes to `getSilApiUrl()` / `sil_api_base`, the SAME origin as `fetchIdentity` — NOT `getApiUrl()` / sil-web. Using `/api/v1/...` or `getApiUrl()` 404s. Governed by [[sil-two-origin-model]]. (SC2/`sil_product_get` inherited the identical wrong `/api/v1` + `@ucp-js/sdk` boilerplate from the template and corrected it the same way — confirming the propagation hazard below.)

2. **The wire-type source is NOT `@ucp-js/sdk`.** That SDK (`vendor/ucp/js-sdk/src/spec_generated.ts`) carries **ZERO** catalog types — it is checkout / payment / fulfillment / order only (verified: no `Product` / `Variant` / `Catalog` / `Search` / `Availability` / `Pagination` export; its sole `availability` hit is a fulfillment comment). The authoritative catalog wire shape is the sil-services sibling `@sil/schemas` `packages/schemas/src/catalog.ts` (TypeBox, hand-mirrored from the UCP spec JSON schemas at `vendor/ucp/spec/source/schemas/shopping/`). The human-readable reference is `vendor/ucp/spec/docs/specification/catalog/`; `@sil/schemas/catalog.ts` is the byte-shape of truth. The plugin still depends on **neither** — see [[sil-shared-catalog-client]] for why (re-declare the read-subset locally, narrow at the boundary).

**Recommendation already raised to the orchestrator** (card "Signals to orchestrator", 2026-06-09): correct the goal's card-fanout template so this wrong `/api/v1` + `@ucp-js/sdk` boilerplate stops propagating to new catalog cards.

## Enrichment fields are sil-api's, present and required

`checkout_url` (per variant) and `source` (per product) are **NOT raw UCP variant/product fields** — they are sil-api enrichment. PR #18 emits both as REQUIRED: `checkout_url` is `minLength: 1` (non-empty) per variant, `source` is required per product (`@sil/schemas/catalog.ts`). So the tool never synthesizes a checkout_url client-side (it can't — there is no client-side source for it); it trusts the server's. A product whose featured variant lacks a non-empty `checkout_url` is DROPPED — by `projectProduct` (search) and `projectLookupProduct` (lookup) alike — never surfaced as a non-purchasable result. The freshness of `checkout_url`/`price`/`availability` is the entire reason lookup exists: catalog responses are point-in-time, not transactional commitments (UCP), so lookup always re-fetches live and never caches.

## The cross-service e2e is deferred (as identity's was)

There is no live sil-api in this repo. The plugin codes against a mocked sil-api boundary mirroring the merged PR #18 shape; the true live-sil-api guarantee is sil-stage's deferred e2e (**goal SC9**), exactly as the identity read's was — see [[sil-api-identity-contract]]. The strict [[sil-response-classification]] anti-false-green gate is what keeps the in-repo suite honest until then.
