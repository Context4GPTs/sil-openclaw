---
id: sil-api-catalog-contract
title: sil-api catalog reads — FLAT { ucp, products, … } envelope (no result wrapper), bare POST /catalog/{search,lookup}, @sil/schemas is the wire truth (NOT @ucp-js/sdk)
tags: [sil-api, catalog, search, lookup, contract, wire-types, envelope, cross-sibling, gotcha]
card: sil-search-plugin-tool
commit: d2b6393
updated_at: 2026-06-10
updated_by_card: catalog-plugin-tools-read-sil-api-flat-envelope
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
body: { query?, filters?: { categories?: string[], price?: { min?, max? } }, pagination?: { cursor?, limit? } }
       — only the keys the agent supplied are emitted; an absent filter is an OMITTED key, never an empty {}
```

Expected responses (classified by [[sil-response-classification]]'s `classifySearchResponse`):

| Status | Meaning | Plugin action |
|---|---|---|
| `200` flat envelope `{ ucp, products: SilCatalogProduct[], pagination? }` | a search result (possibly empty) | read top-level `products`, project first/featured variant per product, hoist `pagination.cursor` iff `has_next_page` |
| `200` whose top-level `products` is **not an array** (partial / garbage / stub) | NOT a valid result | `retryable` — the anti-false-green guard (`Array.isArray(products)`), NEVER a false `ok` |
| `400` `{ error: "empty_search_input", message }` | server-side empty-input rejection | `invalid_request` — surface `{error,message}`; the agent fixes its query (do NOT retry, do NOT re-register) |
| `401` | dead session | terminal re-register (single round-trip — no transparent refresh in SC1) |
| `5xx` / network / abort | source/transport failure | `retryable` — try again, NO `recovery: sil_register` |

A **genuine empty match** (200 with top-level `products: []`) is a SUCCESS (`ok` + empty list), NOT an error — distinct from the no-array guard above. (UCP: "empty search returns an empty array … this is not an error.")

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
