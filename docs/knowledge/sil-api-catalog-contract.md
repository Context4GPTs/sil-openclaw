---
id: sil-api-catalog-contract
title: sil-api catalog search — bare POST /catalog/search, @sil/schemas is the wire truth (NOT @ucp-js/sdk), and the wrong-boilerplate hazard
tags: [sil-api, catalog, search, contract, wire-types, cross-sibling, gotcha]
card: sil-search-plugin-tool
commit: c78bc59
updated_at: 2026-06-09
updated_by_card: sil-search-plugin-tool
---

`sil_search` reads catalog against a **live, merged** sil-api contract (PR #18): `POST /catalog/search` returns a UCP envelope whose `result` is `CatalogSearchResult { products: SilCatalogProduct[], pagination?, messages? }`, each product carrying a **required `source`** and variants each carrying a **required, non-empty `checkout_url`**. Two facts about this contract are non-obvious and bit the card on arrival — both were stated WRONG in the card's own Intent (propagated from the goal's card-fanout template).

## The contract the plugin consumes

`searchCatalog` (`src/lib/sil-client.ts:441`) issues:

```
POST <sil_api_base>/catalog/search      (BARE path — NOT /api/v1/catalog/search)
Authorization: Bearer <stored access_token>
body: { query?, filters?: { categories?: string[], price?: { min?, max? } }, pagination?: { cursor?, limit? } }
       — only the keys the agent supplied are emitted; an absent filter is an OMITTED key, never an empty {}
```

Expected responses (classified by [[sil-response-classification]]'s `classifySearchResponse`):

| Status | Meaning | Plugin action |
|---|---|---|
| `200` envelope `{ result: { products: SilCatalogProduct[], pagination? } }` | a search result (possibly empty) | unwrap `result`, project first/featured variant per product, hoist `pagination.cursor` iff `has_next_page` |
| `200` whose `result.products` is **not an array** (partial / garbage / stub) | NOT a valid result | `retryable` — the anti-false-green guard, NEVER a false `ok` |
| `400` `{ error: "empty_search_input", message }` | server-side empty-input rejection | `invalid_request` — surface `{error,message}`; the agent fixes its query (do NOT retry, do NOT re-register) |
| `401` | dead session | terminal re-register (single round-trip — no transparent refresh in SC1) |
| `5xx` / network / abort | source/transport failure | `retryable` — try again, NO `recovery: sil_register` |

A **genuine empty match** (200 with `result.products: []`) is a SUCCESS (`ok` + empty list), NOT an error — distinct from the no-array guard above. (UCP: "empty search returns an empty array … this is not an error.")

## Two wrong facts the card/template propagated (these bite the next catalog card)

> The goal's card-fanout template seeded BOTH `sil_search` (SC1) and `sil_product_get` (SC2 — the lookup sibling) — and likely any future agentic-search-slice catalog card — with the same two incorrect facts. They are wrong; do not copy them.

1. **The path is NOT `/api/v1/catalog/search`.** sil-api serves catalog at the **bare** `/catalog/search` — there is no `/api/v1` prefix anywhere in sil-api (that prefix is sil-web's, the auth authority). The catalog read is a sil-api **domain** read, so it goes to `getSilApiUrl()` / `sil_api_base`, the SAME origin as `fetchIdentity` — NOT `getApiUrl()` / sil-web. Using `/api/v1/...` or `getApiUrl()` 404s. Governed by [[sil-two-origin-model]].

2. **The wire-type source is NOT `@ucp-js/sdk`.** That SDK (`vendor/ucp/js-sdk/src/spec_generated.ts`) carries **ZERO** catalog types — it is checkout / payment / fulfillment / order only (verified: no `Product` / `Variant` / `Catalog` / `Search` / `Availability` / `Pagination` export; its sole `availability` hit is a fulfillment comment). The authoritative catalog wire shape is the sil-services sibling `@sil/schemas` `packages/schemas/src/catalog.ts` (TypeBox, hand-mirrored from the UCP spec JSON schemas at `vendor/ucp/spec/source/schemas/shopping/`). The human-readable reference is `vendor/ucp/spec/docs/specification/catalog/`; `@sil/schemas/catalog.ts` is the byte-shape of truth. The plugin still depends on **neither** — see [[sil-shared-catalog-client]] for why (re-declare the read-subset locally, narrow at the boundary).

**Recommendation already raised to the orchestrator** (card "Signals to orchestrator", 2026-06-09): correct the goal's card-fanout template so this wrong `/api/v1` + `@ucp-js/sdk` boilerplate stops propagating to new catalog cards.

## Enrichment fields are sil-api's, present and required

`checkout_url` (per variant) and `source` (per product) are **NOT raw UCP variant/product fields** — they are sil-api enrichment. PR #18 emits both as REQUIRED: `checkout_url` is `minLength: 1` (non-empty) per variant, `source` is required per product (`@sil/schemas/catalog.ts`). So the tool never synthesizes a checkout_url client-side (it can't — there is no client-side source for it); it trusts the server's. A product whose featured variant lacks a non-empty `checkout_url` is DROPPED by `projectProduct`, never surfaced as a non-purchasable result.

## The cross-service e2e is deferred (as identity's was)

There is no live sil-api in this repo. The plugin codes against a mocked sil-api boundary mirroring the merged PR #18 shape; the true live-sil-api guarantee is sil-stage's deferred e2e (**goal SC9**), exactly as the identity read's was — see [[sil-api-identity-contract]]. The strict [[sil-response-classification]] anti-false-green gate is what keeps the in-repo suite honest until then.
