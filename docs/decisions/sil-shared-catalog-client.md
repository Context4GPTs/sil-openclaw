---
id: sil-shared-catalog-client
title: One shared catalog client + locally-redeclared read-subset types (no @sil/schemas / @ucp-js/sdk dep)
tags: [architecture, contracts, dependencies, catalog, sil-api, reuse]
card: sil-search-plugin-tool
commit: 6df1061
updated_at: 2026-06-09
updated_by_card: sil-product-get-plugin-tool
---

All sil-api **catalog** tools share ONE client layer in `src/lib/sil-client.ts` and ONE error-envelope taxonomy in `src/tools/catalog.ts`, and the plugin **re-declares the catalog wire fields it consumes LOCALLY** — it does **not** depend on `@sil/schemas` (cross-repo) or `@ucp-js/sdk` (no catalog types). `sil_search` (SC1) established this; the sibling lookup tool `sil_product_get` (SC2) reused it rather than re-deriving a parallel one — and validated the design by exercising exactly the seams it was meant to share (see "What SC2 actually reused vs added" below).

## What `sil_search` landed (the symbols SC2 reuses)

In `src/lib/sil-client.ts`:

| Symbol | Line | What it is | SC2 reuse |
|---|---|---|---|
| `searchCatalog(silApiUrl, token, params)` | 441 | `POST <silApiUrl>/catalog/search` wrapper (Bearer header, timeout, delegates to the classifier) | model `lookupCatalog` / `getProduct` on it |
| `classifySearchResponse(status, body)` | 342 | exported pure classifier → `SearchOutcome` union; the anti-false-green gate lives here | model `classifyLookupResponse` on it |
| `SearchOutcome` | 235 | discriminated union `ok` / `unauthorized` / `invalid_request` / `retryable` (models `IdentityOutcome`) | SC2 needs the same four classes |
| `projectProduct` / `projectVariant` | 620 / 645 | the read-subset normalizers (UCP product/variant → agent-facing shape, defensive narrowing) | **directly reusable** — SC2 returns RICH detail, but the variant projection + null-drop discipline is shared |
| `extractPrice` / `extractAvailability` | 671 / 684 | opaque pass-through of `{amount,currency}` / `{available?,status?}` | reusable as-is |
| `extractCursor` / `extractApiError` | 699 / 710 | cursor hoist (gated on `has_next_page`) / `{error,message}` extraction from a 400 | reusable as-is |

In `src/tools/catalog.ts`: `registerCatalogTools(api)` (line 58) is the group. SC2 adds `registerProductGet(api)` as a **second call inside the same group** (a comment slot is reserved at `catalog.ts:60`) — no structural change. The distinct-envelope helpers (`notRegistered` / `mustReregister` / `transient` / `invalidRequest`) are the shared error taxonomy; SC2 must reuse them so the two tools do not present **divergent agent-facing error contracts** (the deliberate split is LEAN search results vs RICH lookup detail — *not* a different error vocabulary).

## Why re-declare the read-subset locally instead of importing a schema package

- **`@ucp-js/sdk` carries ZERO catalog types.** Verified by enumerating `vendor/ucp/js-sdk/src/spec_generated.ts`: it covers checkout / payment / fulfillment / order only — no `Product`, `Variant`, `Catalog`, `Search`, `Availability`, or `Pagination` export. Importing it for catalog types is impossible, not merely undesirable. (See [[sil-api-catalog-contract]] for the wire-source detail.)
- **`@sil/schemas` is cross-repo.** It lives in the sil-services sibling (`packages/schemas/src/catalog.ts`) — the byte-shape of truth, but a dependency this standalone plugin deliberately does **not** take. The plugin is a thin transport client; it consumes only the read-subset of fields it projects, so it re-declares **just those fields** locally (`SearchParams`, `SearchProduct`, `SearchVariant`, `SearchPrice`, `SearchAvailability`, `SearchResult` — `sil-client.ts:168-224`) and **narrows the untrusted JSON body defensively at the boundary** (no `any`, no unchecked `as`), exactly as `extractIdentity` does for the identity read.
- **The wire body is untrusted.** Even with a schema package, the response is JSON-over-the-wire and must be narrowed at the edge. The local read-subset + defensive narrowing IS the validation; a shared type would not remove it.

## The constraint on SC2 (and any future catalog tool)

> Add the new tool's register fn as a call inside `registerCatalogTools` (don't make a new group). Reuse `searchCatalog`'s shape, the `SearchOutcome`-style union, the `projectProduct`/`projectVariant`/`extractPrice`/`extractAvailability`/`extractCursor`/`extractApiError` normalizers, and the `catalog.ts` error-envelope helpers. Re-declare any *additional* rich fields you consume locally and narrow them — never add a dependency on `@sil/schemas` or `@ucp-js/sdk`. Classify on body shape with a pure exported classifier (see [[sil-response-classification]]).

Origin/path for the catalog endpoint is governed by [[sil-two-origin-model]] (bare `/catalog/search` on `getSilApiUrl()`); the wire contract + the propagated-boilerplate hazard are in [[sil-api-catalog-contract]].

## What SC2 actually reused vs added (the design held)

`sil_product_get` confirmed the split: `src/lib/sil-client.ts` was a **pure addition** (+364/−0 — it modified none of search's primitives). SC2:

- **Reused as-is:** `postJson` / `readJsonBody` / `stripTrailingSlash` / `REQUEST_TIMEOUT_MS` / `asRecord` / `extractPrice` / `extractAvailability` / `extractApiError`, and the `registerCatalogTools` group (added `registerProductGet` as a second call inside it — no new group, no `register()`/`src/index.ts` edit, since adding a tool to an existing group needs none).
- **Added its OWN** thin `classifyLookupResponse` + `extractLookupResult` + `LookupOutcome` rather than reusing search's — **correctly**, because lookup has no `cursor` and DOES have `not_found` misses + the per-variant `inputs` correlation. A shared classifier would have carried dead cursor logic or dropped miss/correlation data. The shared thing is the low-level primitives + the union SHAPE (same four classes) + the error-envelope taxonomy — NOT the classifier/extractor bodies.
- **Parameterized the three shared envelope helpers** (`notRegistered` / `mustReregister` / `transient`) to take a `tool` name arg (a genuine 3rd-use: search's 3 sites + product_get's 3 sites). This keeps the no-divergent-error-vocabulary constraint above — the `status`/`recovery` taxonomy stays shared while each message names the right retry tool ("call sil_product_get again"). Per-tool copies would have risked the two sibling tools' error text drifting.

## The narrow-vs-pass-through rule for projection helpers

When a projection helper (`projectProduct` / `projectLookupProduct` / `extractIdentity`) maps an untrusted wire body to the agent-facing shape, **narrow only the fields that gate the contract; pass contextual display data through OPAQUE**.

- **Narrow (read + `typeof`-gate, null-drop when absent/wrong-type):** the purchasability/identity gates — `id`, `title`, `checkout_url` (non-empty), `price`, `source`; identity's non-empty `name`. These are the load-bearing fields; a product/variant missing one is dropped, never surfaced.
- **Pass through opaque (filter to plain objects, forward verbatim, NEVER read or remap inner fields):** contextual display data — lookup's `categories` and a variant's `options`, identity's `addresses`, lookup's `price_range`/`description`. Use `passThroughObjects` (sil-client.ts) for arrays-of-objects; a bare object via `asRecord`.

**Why this is a rule and not a per-field judgment call:** narrowing on a *guessed inner field name* silently drops real wire data when the guess is wrong. SC2 first narrowed `categories` by requiring an inner `name`; the authoritative `@sil/schemas` `Category` is actually `{ value, taxonomy? }` (no `name`) — so the narrow would have dropped every real category off the wire while passing a test fixture that happened to use `{ name }`. The plugin is a **thin transport client**: the source owns the field shapes of non-gating data, so the plugin must not assert them. Opaque pass-through survives both the real shape and any future drift; it is the same discipline identity `addresses` already used. (The WHY is also inline at each `passThroughObjects` call site.)
