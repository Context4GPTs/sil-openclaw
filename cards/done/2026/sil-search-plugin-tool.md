---
type: card
title: sil_search plugin tool
slug: sil-search-plugin-tool
work_type: feature        # feature | bug | refactor | chore | docs
tiers: [unit, integration]   # subset of [unit, integration, e2e] — set by solutions-architect during Discovery from the acceptance criteria below
status: done                # backlog | discovery | stand-by | in-dev | review | distilling | pr-ready | done | abandoned
agents: []   # current active agent set; updated by each handoff
priority: 1               # 1 = drop-everything, 2 = normal, 3 = nice-to-have
created: 2026-06-09       # placeholder — /board-add overwrites with today's date; never leave as a placeholder before commit (INDEX.base formulas will break)
updated: 2026-06-09       # same — must be a real ISO date before commit
base_branch: main         # the branch this card's worktree was cut from and the PR will target
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-sil-search-plugin-tool            # set by /board-add at card birth (absolute path to .claude/worktrees/card-<slug>)
branch: card/sil-search-plugin-tool            # set by /board-add (card/<slug>)
pr: https://github.com/Context4GPTs/sil-openclaw/pull/8   # set by expert-developer at in-dev → review
merged_commit: 346d9338136d9ae77ba4c6393e12eab4a7bbad1f   # set by /board-tick on PR-merge detection
epic_id: catalog-plugin-tools
origin: goal:agentic-search-slice
depends_on: [catalog-domain-endpoints]
---

## Intent (goal: agentic-search-slice — SC1)

The **`sil_search`** OpenClaw plugin tool. An AI agent sends a *simplified* structured query — free-text `query` plus optional filters (`category`, `price_min`/`price_max`, pagination `cursor`/`limit`; at least one of `query` or a filter required) — and gets back normalized, **ranked** `products[]`, each purchasable variant carrying `{ id, title, price, availability, checkout_url, source }`, plus an opaque pagination `cursor`. The agent builds **no UCP envelope and fills no defaults** — the tool calls sil-api's **`POST /api/v1/catalog/search`** (merged, PR #18), which owns enrichment + the envelope. Empty results are an empty `products[]` (not an error); not-registered/`401`/source-failure → a structured error envelope with a recovery hint. Real tool, **not a stub** (stub-free): the integration test drives the live endpoint.

## Epic notes (provisional — sibling Discovery owns the verdict)

**Epic:** `catalog-plugin-tools`. **Origin:** `goal:agentic-search-slice`. **Satisfies:** SC1. `depends_on: catalog-domain-endpoints` — **MERGED (PR #18)**, so this is **ready**. Sibling card: `sil-product-get-plugin-tool` (SC2, the lookup companion).

**Likely change site (shallow guess — Discovery confirms):** follow the `src/tools/examples.ts` pattern (the canonical "how to add a tool" — `api.registerTool({ name, label, description, parameters: Type.Object({...}), execute })`); add a `registerCatalogTools(api)` group (or similar), wire it into `register()` in `src/index.ts`, and **add `sil_search` to `openclaw.plugin.json#contracts.tools`** (the load-bearing third step the `manifest-contract.integration.test.ts` drift guard enforces). `execute` does the HTTP call to `${SIL_API_BASE}/api/v1/catalog/search` with the user's Bearer JWT (mirror how `sil_whoami`/`sil_register` reach sil-api). Read `vendor/ucp/spec/docs/specification/catalog/` + `@ucp-js/sdk` for the response shape.

**Draft acceptance scenarios (Discovery refines + tier-tags):**
- `[unit]` Given a structured query (free-text + optional filters), when `sil_search` runs, then it calls `POST /api/v1/catalog/search` with exactly those params (no envelope, no defaults) and returns the normalized ranked `products[]` + cursor.
- `[integration]` Against the live sil-api, a known-good query returns ≥1 product with a non-empty `checkout_url`; a valid no-match query returns an empty `products[]` (not an error).
- `[integration]` Unauthenticated → `401` surfaced as a structured error envelope with a recovery hint; source-failure → structured error envelope.
- `[integration]` `sil_search` is in `contracts.tools` and `register()` registers it — the manifest-contract drift test passes.
- Real tool, no stub on the exercised path (`complete-work-is-stub-free`).

<!--
For work_type: bug, replace the paragraph above with:

**Symptom:** what the user sees / what breaks
**Repro:** steps, env, frequency (always / sometimes / once)
**Expected vs actual:** what should happen vs what does
**Hypothesis:** optional — your theory if you have one
-->

---

## Signals to orchestrator (append-only)

<!--
Any agent at any stage can append here when something matters one altitude up
to the orchestrator: a success criterion the PRD missed, a cross-card or
cross-sibling blocker, scope bleed, a reusable pattern, a duplicate-risk with
another card. Write what you know; the orchestrator decides what to do with it.

Format: - <YYYY-MM-DD> <agent> (<stage>) — <type>: <one-line body>

Types are open-ended; common ones: sc-candidate, blocked-on, duplicate-risk,
pattern, scope-bleed. Invent new types when the existing ones don't fit.

The orchestrator reads this every tick and records the signals it has acted on
in $MC/log/<goal_id>/, so entries are never deleted from here — they travel
with the card to cards/done/ or cards/abandoned/. Empty section is fine; the
orchestrator only reads when entries exist.
-->

- 2026-06-09 product-owner (discovery) — pattern: `sil_search` and the sibling `sil_product_get` (SC2) share one thin-client + response-normalization layer and one error-envelope taxonomy (mirrored from `src/tools/identity.ts`: not_registered / must_reregister / retryable, each with a distinct recovery hint). Deliberate scope split: search returns LEAN results (one purchasable variant per product, six fields), lookup/get returns RICH product detail. Whichever card lands first should factor the shared catalog client + error mapping so the second reuses it — avoids two divergent agent-facing error contracts across SC1/SC2.
- 2026-06-09 product-owner (discovery) — scope-clarification: `checkout_url` and `source` in the agent-facing variant shape are NOT raw UCP variant fields (UCP variant = id/title/price/availability/sku/options/seller). They are sil-api enrichment. This reinforces the card's "sil-api owns enrichment + envelope" premise but means SC1 depends on sil-api PR #18 actually emitting those two fields; if PR #18 does not, that is a cross-sibling gap to flag (the tool cannot synthesize a checkout_url client-side).
- 2026-06-09 solutions-architect (discovery) — resolved: product-owner's signal above is RESOLVED, no gap. PR #18 (`@sil/schemas` catalog.ts:204-245) emits `checkout_url` REQUIRED + non-empty (`minLength:1`) per variant and `source` REQUIRED per product. No client-side synthesis needed; SC1 is unblocked on this axis.
- 2026-06-09 solutions-architect (discovery) — card-doc-error: this card's Intent + Epic-notes state the endpoint as `POST /api/v1/catalog/search` and pin wire types to `@ucp-js/sdk`. BOTH are wrong: sil-api serves the route at the BARE `/catalog/search` (no `/api/v1` prefix anywhere in sil-api — handlers/catalog.ts:189), and `@ucp-js/sdk` carries ZERO catalog types (it is checkout/cart/order/payment only). Authoritative catalog wire shape is sil-services `@sil/schemas` catalog.ts. The sibling card `sil-product-get-plugin-tool` (SC2) and any future agentic-search-slice card almost certainly copy the same wrong `/api/v1` + `@ucp-js/sdk` boilerplate from the goal template — recommend correcting the goal's card-fanout template so the error does not propagate.
- 2026-06-09 solutions-architect (discovery) — scope-decision (founder may override): scoped `sil_search` to a SINGLE round-trip on 401 (terminal re-register hint), NOT the transparent refresh-and-retry-once choreography `sil_whoami` performs. Rationale: simplest thing that ships SC1; refresh parity is additive. Flagging in case the goal intends uniform auth-recovery UX across all sil-api tools — if so, that is a small follow-on card, not a blocker here.

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — product-owner, solutions-architect

<!-- Filled jointly by product-owner and solutions-architect. -->

### Approach + alternatives ruled out

<!-- product framing — product-owner -->

**What `sil_search` is, for an AI-agent caller.** A thin, typed product-discovery
tool. The agent passes a *simplified* structured query — free-text `query` plus a
small set of optional filters (`category`, `price_min`/`price_max`) and pagination
(`cursor`/`limit`) — and gets back a single, flat, ranked list of purchasable
options: `products[]` where each entry's purchasable variant carries
`{ id, title, price, availability, checkout_url, source }`, plus an opaque
pagination `cursor`. The agent's whole job is "describe what the shopper wants";
sil's job is "return things they can buy, best-first." Ranking is sil-api's
contract (UCP: first element is the best match for a search — `vendor/ucp/.../catalog/index.md`),
so the agent presents results in array order and does not re-rank.

**The tool builds no UCP envelope and fills no defaults.** sil-api's
`POST /api/v1/catalog/search` (merged, PR #18) owns enrichment (it derives the
`checkout_url` and `source` that are NOT raw UCP variant fields — see
`vendor/ucp/.../catalog/rest.md` variant shape), context/market resolution, and
the UCP envelope. The plugin tool is a thin client: validate the agent's simplified
input, attach the user's Bearer JWT (mirroring `sil_whoami`/`sil_register` in
`src/tools/identity.ts`), POST, and normalize the response into the flat agent-facing
shape. This keeps a single source of truth for commerce semantics (sil-api) and
many thin transport clients (this plugin, and the sibling `sil_product_get`).

**Alternatives ruled out:**

- **Agent assembles the full UCP `search_request` (context, signals, attribution,
  raw `filters` object).** Rejected: pushes commerce-wire knowledge into every
  agent and duplicates sil-api's enrichment. The card's premise — *simplified*
  query in, ranked purchasable results out — is the product, not an accident.
- **Surface the raw UCP `search_response` (full `product`: media, options,
  `price_range`, ratings, metadata, `messages[]`).** Rejected for SC1: an agent
  picking something to buy needs id/title/price/availability/checkout_url/source,
  not the product-detail-page payload. Rich detail is the sibling card
  `sil_product_get`'s (SC2) job. Keep search's result lean and scannable.
- **Treat a zero-match query as an error / empty-result status.** Rejected: it
  contradicts UCP ("empty search returns an empty array without messages… this is
  not an error" — `catalog/index.md` Empty Search; `catalog/rest.md` Business
  Outcomes) and would make an agent fall into an error branch for the most common
  benign outcome. Empty `products[]` is a successful search.
- **Tool client-side filters / sorts / paginates over a broad fetch.** Rejected:
  sil-api owns ranking, filtering, and cursor minting; the tool must pass `category`,
  `price_min`/`price_max`, `cursor`, `limit` through and trust the server's order
  and `cursor`. Re-ranking or trimming client-side would diverge from the
  authoritative result.
- **Make a stub first, de-stub later.** Rejected by `complete-work-is-stub-free`:
  the backing endpoint is already merged, so this ships real on the exercised path,
  driven by an integration test against the live endpoint.

**Technical approach — solutions-architect (corrects two facts in the card/Intent against the merged sil-api contract).**

**Shape: mirror `sil_whoami` exactly.** `sil_search` is a synchronous request/response tool. `execute(callId, params)` reads the stored access token (`readTokens()`), calls a new `searchCatalog(silApiUrl, token, params)` wrapper added to `src/lib/sil-client.ts`, and maps a discriminated `SearchOutcome` union to an agent-facing `jsonResult(...)`. New `registerCatalogTools(api)` group in `src/tools/catalog.ts`; wired into `register()`; `sil_search` added to `contracts.tools`.

**FACT CORRECTION 1 — the endpoint is `POST <silApiUrl>/catalog/search` at a BARE path, NOT `/api/v1/catalog/search`.** The Intent and Epic-notes both state `/api/v1/...` — that is wrong. sil-api registers the route at the bare `/catalog/search` with no prefix (sil-services `services/sil-api/src/handlers/catalog.ts:189-190`, and the handler's own doc comment: *"there is no `/api/v1` prefix anywhere in sil-api"*). It is on the **sil-api origin** — resolved by `getSilApiUrl()` / `SIL_API_BASE` (config.ts:79), the SAME origin `fetchIdentity` uses for `<silApiUrl>/identity` — NOT sil-web (`getApiUrl()`, which owns `/api/v1` claim+refresh). No new config key: `sil_api_base` already exists and config.ts:14-17 explicitly anticipates *every* future sil-api domain tool sharing it.

**FACT CORRECTION 2 — the wire-type source is NOT `@ucp-js/sdk`.** The card pins `@ucp-js/sdk` (`vendor/ucp/js-sdk/src/`), but that SDK carries **zero** catalog types — it is checkout/cart/order/fulfillment/payment only (verified by enumerating every export in `spec_generated.ts`: no `Product`/`Variant`/`Search`/`Availability`/`Pagination`). The authoritative wire contract is sil-services `@sil/schemas` `packages/schemas/src/catalog.ts` (TypeBox, hand-mirrored from the UCP spec JSON schemas at `vendor/ucp/spec/source/schemas/shopping/`; that file's own header says it is NOT derived from `@ucp-js/sdk` "that SDK is Zod, is not a dependency here, and carries no catalog types"). The plugin must NOT depend on `@sil/schemas` (cross-repo) — it re-declares the **read-subset of fields it consumes** locally with strict types and narrows the JSON body defensively at the boundary, exactly as `extractIdentity` does (sil-client.ts:340). The spec docs under `vendor/ucp/spec/docs/specification/catalog/` are the human reference; `@sil/schemas/catalog.ts` is the byte-shape of truth.

**Reconciles the PO's "where does normalization happen" assumption (their ASSUMPTION 1):** PR #18's response is **not** the flat six-field shape — it is a UCP envelope `{ protocol, version, domain, enrichment, result }` whose `result` is `CatalogSearchResult = { products: SilCatalogProduct[], pagination?: { has_next_page, cursor?, total_count? }, messages? }` (catalog.ts:433-445). Each `SilCatalogProduct` = a UCP product PLUS a **required `source`**, with `variants[]` each a UCP variant PLUS a **required, non-empty `checkout_url`** (`minLength: 1` — catalog.ts:204-245). So `checkout_url`/`source` ARE emitted by PR #18 (resolving the PO's signal-70 cross-sibling concern: confirmed present), but the tool DOES do the projection: unwrap `result`, pick the **first (featured) variant** per product, project to `{ id, title, price, availability, checkout_url }` + product-level `source`, and **hoist `result.pagination.cursor` to a top-level `cursor`** (present iff `has_next_page`; absent otherwise). The tool passes products through in server order (already ranked — UCP `Product` ordering), never re-ranks.

**Error taxonomy → a new exported pure `classifySearchResponse(status, body)` + `SearchOutcome` union in sil-client.ts** (unit-tested in isolation like `classifyIdentityResponse`, the highest-risk subtle branch): no stored token → terminal `not_registered` (zero network); 401 (auth preHandler rejects unauth before the handler — catalog.ts:8) → `unauthorized`; 400 `empty_search_input` → `invalid_request` (surface sil-api's `{ error, message }`); 500 / source-down (catalog.ts:60-69) → `retryable`; network/timeout → `retryable`; 200 with a `products` array → `ok`; **200 with no usable `products` array → `retryable`, NEVER a false-green empty match** (mirror `extractIdentity`'s `name`-gate, sil-client.ts:340-357). A **valid empty match** is a genuine 200 with `result.products: []` → `ok` + empty list (NOT an error) — this is the success case, distinct from the no-usable-array guard.

**Additional alternatives ruled out (technical):**
- *Depend on `@sil/schemas` / `@ucp-js/sdk` for response types* — rejected: cross-repo dep the plugin avoids; the SDK has no catalog types anyway. Re-declare the read-subset locally + narrow, like `extractIdentity`.
- *Reach sil-api via `getApiUrl()` / `/api/v1`* — rejected: that is sil-web (auth). Catalog is a sil-api domain read → `getSilApiUrl()` + bare `/catalog/search`.
- *A new config key for the catalog origin* — rejected: `sil_api_base` is already the shared sil-api-domain key (config.ts:14-17).

### Affected files / surfaces

- **`src/tools/catalog.ts`** (NEW) — `registerCatalogTools(api)` → `registerSearch(api)`. Designed so the sibling card `sil-product-get-plugin-tool` (SC2) adds `registerProductGet(api)` as a second call inside the SAME group, no structural change (per PO signal-69's shared-layer ask). Mirror `src/tools/identity.ts`'s two-tool group shape and its distinct-envelope helper style (`notRegistered`/`mustReregister`/`transient`).
- **`src/lib/sil-client.ts`** (EDIT) — add `searchCatalog(silApiUrl, token, params)` + exported pure `classifySearchResponse(status, body)` + the `SearchOutcome` union + a local `extractSearchResult` read-subset narrowing helper (the shared catalog response normalizer the sibling lookup tool reuses). Reuse `postJson` (with the Bearer header), `REQUEST_TIMEOUT_MS`, `stripTrailingSlash`, `asRecord`, `readJsonBody`. Tokens never logged, never in the returned union.
- **`src/index.ts`** (EDIT) — `import { registerCatalogTools }` and call it in `register()` after `registerIdentityTools(api)`. `register()` stays synchronous, opens nothing.
- **`openclaw.plugin.json`** (EDIT) — add `"sil_search"` to `contracts.tools`. `security.networkEndpoints` already lists `https://api.sil.4gpts.com` (the sil-api origin) — confirm, no change expected.
- **`src/__tests__/manifest-contract.integration.test.ts`** (EDIT, qa-developer) — `codeRegisteredNames()` MUST also call `registerCatalogTools(api)` or the drift guard goes stale (the test's own doc warns of this — manifest-contract test lines 72-81).
- **`src/__tests__/catalog-search.integration.test.ts`** (NEW, qa-developer) — the boundary suite (test strategy below).

### Risks / failure modes

<!-- product-owner contributed the behavior/contract risks; solutions-architect adds technical ones -->

- **Empty-vs-error conflation.** If a no-match search is surfaced as an error (or
  as anything other than `status: "ok"` + empty `products[]`), agents will treat a
  normal "nothing matched" as a failure and may retry pointlessly or tell the user
  the tool is broken. The empty array MUST be a success. (UCP Empty Search.)
- **Recovery hint that misdirects the agent.** The three error classes need
  *distinct* hints, mirroring `identity.ts`: not-registered → `recovery: "sil_register"`
  ("run sil_register, then search again"); `401`-after-refresh-failed → re-register
  (session dead); source/transport failure (5xx, network, sil-api down) → a transient
  "try again" hint with NO `recovery: sil_register` (re-registering wouldn't help and
  would derail the user). A wrong hint sends the agent down a recovery path that can't
  fix the actual problem.
- **Stale purchasability presented as a commitment.** `price`, `availability`, and
  `checkout_url` are point-in-time and session-scoped — UCP is explicit that catalog
  responses "are not transactional commitments; checkout is authoritative" and
  "SHOULD NOT be reused across sessions without re-validation" (`catalog/index.md`).
  Risk: an agent caches a `checkout_url`/price and acts on it later as if guaranteed.
  The tool returns current values; it does not promise they persist.
- **Agent assumes `products.length === limit`.** UCP: `limit` is a *requested* page
  size, not a guarantee; servers MAY clamp silently and return fewer
  (`catalog/search.md` Page Size). An agent that infers "no more results" from a
  short page (instead of from an absent `cursor`) will stop paginating early.
  End-of-results is signalled by the *absence* of a `cursor`, never by page length.
- **Validation that rejects a legitimate filter-only browse, or accepts an empty
  request.** At least one of `query` / `category` / `price_min` / `price_max` must
  be present (UCP Search Inputs requires ≥1 recognized input). A bare
  `{}` (or whitespace-only `query` with no filter) must be rejected with an
  actionable validation error before any network call — but a filter-only request
  (e.g. `category` alone, no `query`) is valid and must be allowed (UCP browse).
- **Variant selection ambiguity.** A UCP product has many variants; the agent-facing
  contract promises ONE purchasable `{id,…}` per product (the featured/best-match
  variant — UCP: businesses return the best-match variant first for search). If
  normalization silently drops products that have no available variant, or picks a
  non-featured variant, the agent's "buy this" id may not be the one the user saw
  ranked first. Pick the first (featured) variant deterministically.
- **PII / token leakage in results or logs.** Same invariant as `identity.ts`: the
  Bearer token and Authorization header never reach a log line or the result. Search
  results are not PII-bearing, but the JWT that authorizes a personalized search is —
  log only non-credential status markers.

*Technical failure modes — solutions-architect:*

- **Wrong path/origin (highest-likelihood mistake — the card states it wrong).**
  Using `/api/v1/catalog/search` or `getApiUrl()` 404s against sil-api. Pin to the
  bare `/catalog/search` on `getSilApiUrl()`.
- **False-green empty result.** A stub/garbage/partial 200 (no `products` array)
  misread as a valid empty match. Gate `ok` on the envelope unwrapping AND
  `Array.isArray(result.products)`; anything else → `retryable`. Mirror the
  `extractIdentity` `name`-gate (sil-client.ts:340-357). This is the analogue of the
  whoami anti-false-green and the load-bearing correctness point of the classifier.
- **Cursor location.** The opaque cursor is nested at `result.pagination.cursor`
  (present iff `has_next_page`), NOT top-level. Hoist it out and round-trip it back
  into `pagination.cursor` on the next call. Never derive "more pages" from
  `products.length === limit` — sil-api forbids it (catalog.ts:96-99, the documented
  pagination bug). (This is the technical mechanism behind the PO's
  `products.length === limit` risk.)
- **Collapsing the three distinct sil-api outcomes.** Empty match (200 `[]`),
  invalid request (400 `empty_search_input`), and source failure (500) must surface
  as three distinguishable agent envelopes. sil-api keeps them distinct
  (catalog.ts:17-25); the tool must preserve that, never flatten 400/500 into the
  empty-match path.
- **`@any` at the boundary.** The wire body is untrusted JSON; do not cast it to a
  trusted type. Narrow defensively (no `any`, no unchecked `as`) — mirror
  `extractIdentity`.
- **Stale drift guard.** Forgetting `registerCatalogTools` in the manifest-contract
  test's `codeRegisteredNames()` lets the guard pass while not covering the new
  group.

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.
-->

Tiers tagged by solutions-architect. Definitions for THIS repo: **unit** = host SDK
boundary (`fetch`) mocked, pure-function / param-mapping assertions. **integration**
= the real plugin wiring through the real `sil-client`, with only `fetch`/host
mocked — there is NO live sil-api and NO e2e/host-load tier here (CLAUDE.md;
`whoami.integration.test.ts:6-12`). NOTE on the card's "integration test drives the
**live** endpoint": in THIS repo that means the real plugin pipeline against a
live-SHAPED `fetch` double (the true live-sil-api guarantee is sil-stage's deferred
e2e, goal SC9). `tiers:` frontmatter = `[unit, integration]` (no `e2e`).

**Happy path — structured query → ranked purchasable results**

- `[unit]` Given a structured query (free-text `query`, optionally with `category`,
  `price_min`/`price_max`, `cursor`, `limit`), when `sil_search` runs, then it
  calls `POST <silApiUrl>/catalog/search` (bare path, sil-api origin — NOT
  `/api/v1`) with exactly those parameters mapped to the sil-api body
  `{ query?, filters: { categories?, price: { min?, max? } }, pagination: { cursor?, limit? } }`
  — building no UCP envelope and filling no defaults the agent did not supply —
  carrying the stored user's `Authorization: Bearer <token>`.
- `[unit]` Given sil-api returns a populated result envelope, when `sil_search`
  normalizes it, then the tool unwraps `result` and returns `status: "ok"` with a
  flat `products[]` in server order (best-match first — the tool does NOT re-rank),
  each product carrying exactly one purchasable variant (the first/featured)
  projected to `{ id, title, price, availability, checkout_url }` plus the
  product-level `source`, plus the opaque pagination `cursor` hoisted from
  `result.pagination.cursor` when present.
- `[unit]` Given the response carries a next page (`pagination.has_next_page: true`),
  when normalized, then the returned `cursor` is `result.pagination.cursor` passed
  through verbatim; given the response is the last page (`has_next_page: false`),
  then no `cursor` is returned (end-of-results is the absent cursor, never a short
  `products[]`).

**Empty results are success, not error**

- `[integration]` Given a syntactically valid query that matches nothing, when
  `sil_search` runs against the real wiring (`fetch` double returns 200
  `{ result: { products: [] } }`), then the tool returns `status: "ok"` with
  `products: []` (and no `cursor`) — NOT an error, no `recovery` hint, no thrown
  failure. (UCP: empty search returns an empty array, "this is not an error".)
- `[unit]` Given a 200 whose envelope yields NO usable `products` array (a partial /
  garbage / stub-shaped body), when classified, then the outcome is `retryable`,
  NEVER `ok` — the anti-false-green guard (distinct from a genuine empty match).

**Input validation — at least one of query-or-filter required**

<!-- architect note: the ≥1-input rule has TWO enforcers and they are NOT in
conflict. The tool owns a cheap client-side guard for the obviously-empty case (UX +
saves a round-trip), and sil-api is the authoritative backstop, rejecting an empty
body with a structured `empty_search_input` → HTTP 400. Both criteria below hold. -->

- `[unit]` Given a request with neither a non-empty `query` nor any filter (e.g.
  `{}`, or a whitespace-only `query` with no `category`/`price_min`/`price_max`),
  when `sil_search` runs, then it returns a structured validation error naming the
  missing input ("provide a search query or at least one filter") and makes NO
  network call (the client-side guard; sil-api's `empty_search_input` 400 is the
  backstop if a body slips through).
- `[unit]` Given a filter-only request (e.g. `category` set, no `query`), when
  `sil_search` runs, then it is accepted and forwarded as a browse (UCP allows
  omitting `query` when filters are present) — no local rejection.

**Error envelopes carry a distinct recovery hint per class**

- `[unit]` Given the user is not registered (no stored credentials,
  `readTokens()` is null), when `sil_search` runs, then it returns
  `status: "not_registered"` with a message and `recovery: "sil_register"`, making
  ZERO network calls (mirrors `sil_whoami`'s not-registered path).
- `[integration]` Given sil-api responds `401` (unauthenticated / dead session),
  when `sil_search` runs against the real wiring, then it returns a structured
  re-register error (recovery `sil_register`), not a crash and not a false-green.
  (Per the open question below: a SINGLE round-trip — no transparent
  refresh-and-retry choreography in SC1; that is an additive follow-on.)
- `[integration]` Given sil-api fails for a transport/source reason (500 with
  `{ error, message }`, network error, or timeout), when `sil_search` runs against
  the real wiring, then it returns a structured transient error
  (`status: "retryable"`) guiding the agent to try the search again, and it does
  NOT emit `recovery: "sil_register"` — surfaced as a DISTINCT envelope from the 401
  outcome (the three-distinct-outcomes guarantee).
- `[integration]` Given a 400 `empty_search_input` from sil-api, when `sil_search`
  runs, then it surfaces a structured `invalid_request` envelope carrying sil-api's
  `{ error, message }` and a hint to supply a query or filter — distinct from both
  the empty-match success and the transient failure.
- `[unit]` Given a network error / timeout from `fetch`, when `sil_search` runs,
  then it returns `retryable` AND the access token never appears in any log line or
  in the result (the never-log-the-token invariant).

**Self-enforcing registration + stub-free**

- `[integration]` Given the tool is added, when the manifest-contract drift guard
  runs (with `codeRegisteredNames()` updated to call `registerCatalogTools`), then
  `sil_search` appears in `openclaw.plugin.json#contracts.tools` AND is registered
  by `register()` — the set-compare passes in both directions.
- `[integration]` Given the work is taken to done, when the exercised path is
  inspected, then it contains no stub: the integration suite drives the real
  `POST <silApiUrl>/catalog/search` pipeline and asserts the real normalized
  `SilCatalogProduct` shape, never a `{ stub: true }` placeholder
  (`complete-work-is-stub-free`).

### Open questions (if any)

<!-- product-owner: none blocking. Documented assumptions below; founder may override. -->

None blocking. Defensible assumptions recorded inline — In Dev should confirm the
first two against the merged sil-api PR #18 response shape (`sil-services`), not
re-litigate them:

- **ASSUMPTION — sil-api returns the flat `{id,title,price,availability,checkout_url,source}`
  shape directly.** The card states sil-api "owns enrichment + the envelope," and
  `checkout_url`/`source` are not raw UCP variant fields, so sil-api is expected to
  emit the normalized agent-facing shape (or a near-trivial unwrap of its `result`).
  If PR #18 instead returns the raw UCP `search_response` (full `product` with
  `variants[]`, `price_range`, etc.), the tool does the variant-selection +
  field-projection normalization itself (first/featured variant → the six fields).
  Either way the agent-facing contract above is unchanged; this only moves *where*
  the projection happens. Confirm against PR #18 in Dev.
- **ASSUMPTION — `availability` is a boolean-ish flag the agent can act on.** UCP's
  variant `availability` is an object (`{ available: true }`). The agent-facing
  contract surfaces availability so the agent can decide whether to offer the item;
  pass through whatever sil-api returns rather than flattening to a bare boolean
  (avoids dropping signal sil-api may add). Confirm the field's shape against PR #18.
- **ASSUMPTION — `limit`/`cursor` bounds are sil-api's to enforce.** The tool does
  not clamp `limit` or validate `cursor` opacity; it forwards them and trusts
  sil-api (UCP: servers MAY clamp `limit` silently; cursors are opaque). The tool
  only enforces the one client-side invariant it owns: at-least-one-input.
- **ASSUMPTION — `category` is a single free-text/identifier string.** The card's
  simplified shape lists `category` (singular). UCP's underlying filter is
  `categories[]` (an array, multi-taxonomy). The simplified contract takes one
  `category` and sil-api maps it into the UCP `filters.categories`. If multi-category
  is later needed it is an additive change, not a contract break. (Cross-check the
  exact param name sil-api PR #18 expects in Dev.)

*solutions-architect — resolutions against the merged PR #18 contract (so Dev does NOT re-litigate):*

- **PO ASSUMPTION 1 RESOLVED.** PR #18 returns a UCP envelope, not the flat shape:
  `result = CatalogSearchResult { products: SilCatalogProduct[], pagination?, messages? }`
  (`@sil/schemas` `catalog.ts:433-445`). The tool unwraps `result`, picks the first
  (featured) variant per product, and projects the six fields. The agent-facing
  contract is unchanged; the projection happens client-side. The `category` →
  `filters.categories[]` mapping the PO flags is confirmed by `catalog.ts:268-279`
  (the body's `filters.categories` is a string array).
- **PO ASSUMPTION 2 RESOLVED (`availability` shape).** sil-api's `availability` is an
  OBJECT `{ available?: boolean, status?: string }` (`catalog.ts:113-122`), not a bare
  boolean. Pass it through as-is — do NOT flatten to a boolean (would drop the
  `status` signal). The PO's "pass through whatever sil-api returns" is correct.
- **PO signal-70 RESOLVED (cross-sibling `checkout_url`/`source` gap).** Confirmed
  present and REQUIRED in PR #18's shape: `checkout_url` is non-empty per variant
  (`minLength: 1`, catalog.ts:206-208) and `source` is required per product
  (catalog.ts:231-232). No client-side synthesis needed; no cross-sibling gap to
  escalate.

**Genuinely open (recommendation made, not a blocker — founder may override):**

- **401 handling depth.** `sil_whoami` does a transparent refresh-and-retry-once on
  401; the Intent does not specify refresh for `sil_search`, and the PO's criterion
  hedges ("a single transparent refresh also fails, OR no refresh path applies").
  **Architect recommendation: keep `sil_search` a single round-trip** — surface 401
  as a terminal re-register hint, with NO refresh choreography in SC1 (adding it
  later is additive). Rationale: the simplest thing that ships SC1; refresh parity
  is a separable concern. Documented as an assumption, tagged into the AC above.
  Raised as a signal to the orchestrator below for visibility. NOT blocking.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**Where to start (expert-developer):**

1. **`src/lib/sil-client.ts`** — add `searchCatalog(silApiUrl, token, params)`, an
   exported pure `classifySearchResponse(status, body)`, the `SearchOutcome`
   discriminated union (model on `IdentityOutcome`: `ok` / `unauthorized` /
   `invalid_request` / `retryable`), and a local `extractSearchResult` read-subset
   normalizer (unwrap envelope `result` → narrow `products[]` → first variant →
   six-field projection → hoist cursor). Reuse `postJson` (with the Bearer header),
   `REQUEST_TIMEOUT_MS` AbortController, `asRecord`, `readJsonBody`,
   `stripTrailingSlash`. Endpoint: `` `${stripTrailingSlash(silApiUrl)}/catalog/search` `` (BARE).
2. **`src/tools/catalog.ts`** (NEW) — `registerCatalogTools(api)` → `registerSearch(api)`,
   mirroring `identity.ts`'s group shape. `execute(callId, params)`: read tokens →
   `searchCatalog(getSilApiUrl(), token, params)` → map `SearchOutcome` →
   `jsonResult`. Copy the distinct-envelope helper style (`notRegistered` /
   `mustReregister` / `transient` / an `invalidRequest` for the 400). Leave room for
   `registerProductGet(api)` as a second call in the group (sibling card SC2; PO
   signal-69 wants the shared layer factored here).
3. **`src/index.ts`** — `import { registerCatalogTools }`, call it in `register()`
   after `registerIdentityTools(api)`.
4. **`openclaw.plugin.json`** — add `"sil_search"` to `contracts.tools`.

**Constraints:**

- Endpoint is bare `/catalog/search` on `getSilApiUrl()` (NOT `/api/v1`, NOT
  `getApiUrl()`). The card's URL is wrong — see Fact Correction 1.
- Strict TypeScript, **no `any` at the boundary** — narrow the untrusted JSON body
  defensively (no unchecked `as`); mirror `extractIdentity`.
- Do NOT add a dependency on `@sil/schemas` or `@ucp-js/sdk` — re-declare the
  read-subset of catalog types locally. (The SDK has no catalog types; `@sil/schemas`
  is cross-repo.) See Fact Correction 2.
- `register()` stays synchronous, opens nothing — all I/O in `execute`.
- Tokens / Bearer header never logged, never in the result.
- No defaults, no `context`, no UCP envelope built client-side — sil-api owns it all.
- Cursor: hoist from `result.pagination.cursor`; never derive paging from
  `length === limit`.
- 401 → single round-trip terminal re-register (no transparent refresh in SC1 — see
  open question).
- **Real tool, not a stub** — no `stubResult` on the path.

**Test strategy (qa-developer owns RED first):**

- **Auth is real — NO dev bypass.** There is no `AUTH_DEV_BYPASS` / dev-token in this
  plugin; the tool sends the stored Bearer token. The test seeds a real-shaped token
  pair via the `seedTokens(...)` pattern (`whoami.integration.test.ts:202-211`).
  Prod/dev switches on `NODE_ENV` only; a bypass-based test is fail-closed rejected.
- **Unit tier:** `vi.spyOn(globalThis, "fetch")`. Assert param→request mapping (URL
  is the bare `/catalog/search`, sil-api origin, Bearer header, exact mapped body)
  and the pure `classifySearchResponse` over every documented status/body in
  isolation (it is exported and pure, like `classifyIdentityResponse`). Cover the
  anti-false-green 200-no-products case, the not-registered zero-network case, and
  the never-log-the-token assertion on a network error.
- **Integration tier:** drive the REAL `registerCatalogTools` + REAL `sil-client`
  with a URL-routing `fetch` double — clone the `installRouter` recorder from
  `whoami.integration.test.ts:122-193` (record url/method/bearer/body, route by
  `/catalog/search`). The happy-path mock MUST return the **real `SilCatalogProduct`
  envelope shape**:
  `{ protocol:"ucp", version, domain:"catalog", result: { products: [{ id, title, description, price_range, source, variants: [{ id, title, price, availability:{available:true}, checkout_url }] }], pagination: { has_next_page, cursor? } } }`
  — so the suite is anti-false-green: it CANNOT pass against a `{ stub: true }` echo.
  Assert the three distinct outcomes (empty match 200 `[]`; 400 `empty_search_input`;
  500 source-failure) surface as three distinguishable envelopes, and that the access
  token is sent on the read but never appears in `logBlob(api)`
  (`whoami.integration.test.ts:220-229`).
- **Manifest drift guard:** update `codeRegisteredNames()` in
  `manifest-contract.integration.test.ts` to call `registerCatalogTools(api)` and
  assert `sil_search` is in the equal set.
- **No e2e/host-load tier** in this repo (`tiers:` excludes `e2e`); the true
  live-sil-api cross-service guarantee is deferred to sil-stage (goal SC9), exactly
  as whoami's was.

## In Dev — expert-developer, qa-developer

### Implementation (expert-developer) — DONE, awaiting qa's RED tests before PR

Implemented `sil_search` per the Discovery handoff (NOT the stale Intent — bare
`/catalog/search` on `getSilApiUrl()`, local read-subset types, no `@sil/schemas`
/ `@ucp-js/sdk` dep). Production files (the four I own):

- **`src/lib/sil-client.ts`** — added the `SearchParams` input type, the
  agent-facing `SearchProduct`/`SearchPrice`/`SearchAvailability`/`SearchResult`
  read-subset types (re-declared locally, narrowed defensively at the boundary),
  the `SearchOutcome` discriminated union (`ok` / `unauthorized` /
  `invalid_request` / `retryable` — models `IdentityOutcome`), the exported pure
  `classifySearchResponse(status, body)`, `searchCatalog(silApiUrl, token, params)`,
  and the private normalizers `buildSearchBody` / `extractSearchResult` /
  `projectProduct` / `extractPrice` / `extractAvailability` / `extractCursor` /
  `extractApiError`. Reuses `postJson` (Bearer via `extraHeaders`),
  `REQUEST_TIMEOUT_MS`, `stripTrailingSlash`, `asRecord`, `readJsonBody`.
- **`src/tools/catalog.ts`** (NEW) — `registerCatalogTools(api)` → `registerSearch(api)`,
  mirroring `identity.ts`'s group + distinct-envelope-helper style
  (`notRegistered` / `mustReregister` / `transient` + an `invalidInput` for the
  client guard and `invalidRequest` for sil-api's 400). `registerProductGet(api)`
  has a reserved comment slot in the group for the SC2 sibling.
- **`src/index.ts`** — imports + calls `registerCatalogTools(api)` after
  `registerIdentityTools(api)`. `register()` stays synchronous, opens nothing.
- **`openclaw.plugin.json`** — `"sil_search"` added to `contracts.tools`
  (alphabetical, after `sil_register`). `security.networkEndpoints` already lists
  `https://api.sil.4gpts.com` — no change needed.

**Key contract decisions (load-bearing for Review + the distillation stage):**

- **`params` is `Record<string, unknown>` at the boundary.** The OpenClaw SDK is
  an ambient shim (`src/types/openclaw.d.ts`); `execute(callId, params)` types
  `params` loosely (the host validates against the `parameters` schema, but the
  read site still guards). `readSearchParams` narrows each field with `typeof`,
  dropping wrong-typed fields rather than coercing — no `any`, no unchecked `as`.
- **At-least-one-input guard owns ONLY query-or-filter.** `hasUsableInput`
  accepts a non-whitespace `query` OR any of `category`/`price_min`/`price_max`.
  `cursor`/`limit` alone do NOT count as input (they refine a search, they don't
  constitute one) → a `{ cursor }`-only call is rejected client-side. A
  filter-only browse (`{ category }`) is accepted (UCP browse). sil-api's
  `empty_search_input` 400 is the authoritative backstop.
- **Three distinct outcomes preserved.** empty match (200 `products:[]`) → `ok`
  + empty list (SUCCESS, no `recovery`); invalid (400) → `invalid_request`
  carrying sil-api's `{error,message}`; source failure (5xx/network) → `retryable`
  (no `recovery: sil_register`). 401 → `must_reregister` (single round-trip, NO
  transparent refresh — per the architect's scope decision for SC1).
- **Anti-false-green:** `extractSearchResult` requires `result` to be an object
  AND `result.products` to be `Array.isArray`. A `{ stub: true }` / partial 200
  → null → `retryable`, never a false `ok`. A genuine empty array → `ok` + `[]`.
  `extractSearchResult` has NO bare-top-level fallback (unlike `extractIdentity`):
  a search response is always enveloped, so a top-level `products` is malformed.
- **Variant selection:** `projectProduct` picks `variants[0]` (UCP: "Platforms
  SHOULD treat the first element as featured" — `catalog/index.md:107`). A product
  whose featured variant lacks a non-empty `checkout_url` (or `id`/`title`/`price`)
  is DROPPED, never surfaced as a non-purchasable result.
- **Pass-through, not flatten:** `price` (`{amount,currency}`) and `availability`
  (`{available?,status?}`) pass through opaque (extra fields preserved); per the
  architect, availability is an OBJECT and flattening to a bare boolean would drop
  the `status` signal. `source` is hoisted from the product onto the flat result.
- **Cursor:** hoisted from `result.pagination.cursor`, surfaced ONLY when
  `has_next_page === true` AND the cursor is a non-empty string. End-of-results is
  the absent cursor — never `products.length === limit`.
- **Token hygiene:** the Bearer header is built in `searchCatalog` and travels
  only in the outbound request; never logged, never in the `SearchOutcome` union
  or the result. Log lines carry only status markers (`sil_search_unauthorized`,
  `sil_search_retryable`, `sil_search_invalid_request` with the error code only).

**Verification (live-verification skill):**

- Build gate: `pnpm typecheck` + `pnpm build` both green (exit 0).
- Plugin-equivalent integration smoke (this repo has no HTTP server; the analogue
  is the real compiled `registerCatalogTools` + `sil-client` against a `fetch`
  double returning the **real `SilCatalogProduct` envelope**): **37/37 checks
  pass** — happy path (featured variant, six fields, opaque price/availability,
  hoisted source + cursor, bare endpoint, Bearer sent, body mapping, no
  client-side envelope, token-not-in-result), empty match → ok, stub200 →
  retryable (anti-false-green), 400/401/500/network outcomes distinct, client-side
  empty/whitespace guard makes zero network calls, filter-only browse accepted,
  cursor round-trips, last-page returns no cursor. (Ephemeral script, not committed.)
- Existing suite: **248/250 pass.** The 2 failures are BOTH in
  `manifest-contract.integration.test.ts` and are EXPECTED + qa-owned: the
  manifest now declares `sil_search` but the test's `codeRegisteredNames()` helper
  does not yet call `registerCatalogTools(api)`, so the drift guard reports
  `sil_search` "missing from code." This goes green the moment qa adds that call.

### Coordination note → qa-developer

- Exported symbols are exactly as the handoff specified: `registerCatalogTools`,
  `searchCatalog`, `classifySearchResponse`, `SearchOutcome` (`registerSearch` is
  internal to `catalog.ts`). Also exported for tests: `SearchParams`,
  `SearchResult`, `SearchProduct`, `SearchPrice`, `SearchAvailability`.
- `SearchOutcome.invalid_request` carries `{ error: string, message: string }`;
  the tool surfaces these as `{ status: "invalid_request", error, message }`.
- The agent-facing success envelope is `{ status: "ok", products: SearchProduct[], cursor? }`
  (NOT `{ status:"ok", result:{...} }` — the result is spread to the top level).
- **You still own**: updating `codeRegisteredNames()` in
  `manifest-contract.integration.test.ts` to call `registerCatalogTools(api)`, the
  new `catalog-search` unit + integration suites, and the `seedTokens` pattern for
  real-token auth. I have NOT touched `src/__tests__/**`.
- Authoritative on contract divergence: the card's written Acceptance criteria.

**Gate status:** implementation complete + self-verified. Holding the PR until
qa's RED tests are committed and the FULL `pnpm test` is green including them
(per the in-dev → review gate).

### Adversarial RED tests (qa-developer) — DONE + committed (PR gate satisfied)

Tests committed to `card/sil-search-plugin-tool` in commit `c78bc59`. The four
files I own (zero overlap with expert-developer's `src/lib` / `src/tools` /
`src/index.ts` / `openclaw.plugin.json`):

- **`src/__tests__/lib/search-classify.test.ts`** (NEW, 25 tests) — the pure
  `classifySearchResponse` in isolation: the three distinct outcomes
  (ok/invalid_request/unauthorized/retryable) kept distinct, empty-match-is-success
  vs the anti-false-green 200-no-products gate (incl. the `{stub:true}` body and
  wrapped-stub cases), the first/featured-variant projection + six fields + opaque
  `availability` object, and the cursor hoist gated on `has_next_page` (incl. a
  stale-cursor-on-last-page suppression case).
- **`src/__tests__/lib/search-client.test.ts`** (NEW, 13 tests) — `searchCatalog`
  param→request mapping via a `fetch` spy: bare `/catalog/search`, trailing-slash
  tolerance, POST + JSON content-type + `Bearer`, the EXACT mapped
  `CatalogSearchRequest` body (`category`→`categories[]`, `price_*`→`price.{min,max}`,
  `cursor`/`limit`→`pagination`), no envelope/defaults/empty-skeletons, per-bound
  partial mapping, no client-side clamp, and token-never-in-the-returned-union.
- **`src/__tests__/tools/search.test.ts`** (NEW, 13 tests) — the tool boundary:
  registration shape (typed `query`+filters+pagination params), the client-side
  ≥1-input guard (bare `{}`, whitespace-only, empty-string `query` all rejected
  with ZERO network), the guard NOT over-rejecting a filter-only / price-only
  browse, the not-registered short-circuit (zero network, `sil_register` hint), and
  the token-log canary on success + 401 paths.
- **`src/__tests__/catalog-search.integration.test.ts`** (NEW, 23 tests) — the
  boundary suite: real `registerCatalogTools` + real `sil-client` through the
  cloned `installRouter` URL-routing `fetch` double, `seedTokens` real-token auth.
  Happy-path mock returns the REAL `SilCatalogProduct` envelope so the suite is
  anti-false-green (CANNOT pass against a `{stub:true}` echo — asserted). Covers
  param→request mapping (bare path, sil-api origin not sil-web, Bearer, exact body,
  filter-only browse), the three distinguishable outcome envelopes (empty 200 =
  ok+[]; 400 = invalid_request; 500/network = retryable), 401 = single round-trip
  terminal re-register (no `/auth/refresh` leak), not-registered = zero network,
  cursor hoist (true→cursor, false→none even on a full page), and the access token
  sent on the read but NEVER in `logBlob(api)` or the result.
- **`src/__tests__/manifest-contract.integration.test.ts`** (EDIT) — added
  `registerCatalogTools(api)` to `codeRegisteredNames()` (resolving the 2 expected
  failures expert-developer flagged) + a named assertion that `sil_search` is in
  the equal set, both directions.

**Verification:**
- FULL `vitest run`: **316/316 pass, 27 files** (includes the +74 search tests).
  `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.build.json` both exit 0.
- **Tests proven adversarial via 3 mutations** against a scratch copy of the
  pristine implementation (expert-developer's `sil-client.ts` left byte-identical,
  `git status` clean): (1) weakening the `Array.isArray(products)` gate to coerce
  garbage→`[]` failed 3 anti-false-green tests; (2) dropping the `has_next_page`
  gate failed the new stale-cursor suppression test (a gap I found mid-audit and
  closed); (3) un-wrapping `category` (string instead of `[string]`) failed 4
  mapping tests across the unit + integration suites.
- Stub-free confirmed: no `stubResult` / `{ stub: true }` on the exercised path in
  `catalog.ts`; the integration suite drives the real `SilCatalogProduct` envelope.

**For an adversarial-testing re-examination on the SC2 sibling card
(`sil_product_get`):** the shared catalog read-subset normalizer (`projectProduct`
/ `projectVariant` / `extractCursor` / `extractApiError`) and the error-envelope
taxonomy are now exercised by these suites — the lookup tool should reuse them and
the next qa pass should re-test that the LEAN-vs-RICH scope split holds (search =
one featured variant + six fields; lookup = rich detail) without the two tools'
error contracts diverging (PO signal-69).

**Gate:** RED tests committed + full suite green including them. expert-developer
may proceed with the in-dev → review transition (open the PR).

### → Handoff to Review (next agent: code-quality-guardian)

**PR:** https://github.com/Context4GPTs/sil-openclaw/pull/8 (targets `main`).
**Branch:** `card/sil-search-plugin-tool` — 3 commits: `81f9042` (impl),
`d7eb25f` (variant-nesting shape fix), `c78bc59` (qa's RED tests). The card file
is gitignored, so the PR diff is implementation + tests only (no card body).

**Gate at handoff:** `pnpm typecheck` exit 0, `pnpm build` exit 0, `pnpm test`
**316/316 across 27 files** — including all 4 new `sil_search` suites and the
manifest drift guard (now passes; `codeRegisteredNames()` calls
`registerCatalogTools`). No CI is configured on this repo (skeleton).

**Where to focus the review (diff = 4 prod files + 5 test artifacts):**

- **`src/lib/sil-client.ts`** is the substance — the new `Search*` types, the
  exported pure `classifySearchResponse`, `searchCatalog`, and the read-subset
  normalizers (`extractSearchResult`/`projectProduct`/`projectVariant`/
  `extractPrice`/`extractAvailability`/`extractCursor`/`buildSearchBody`/
  `extractApiError`). All defensive narrowing, no `any`, no unchecked `as`.
- **The anti-false-green gate** (`extractSearchResult` requiring `result` object
  AND `Array.isArray(result.products)`) is the load-bearing correctness point —
  worth a careful read. A genuine empty array is `ok`; a missing/non-array is
  `retryable`. Unlike `extractIdentity`, there is NO bare-top-level fallback
  (deliberate: search is always enveloped).
- **`buildSearchBody` emits only supplied keys** — no empty `filters`/`pagination`
  skeletons (asserted by the integration suite). `category` (singular) maps to the
  UCP `filters.categories` array.
- **Variant shape decision (worth confirming you agree):** `SearchProduct` carries
  product-level `{id,title,source}` + a NESTED `variant {id,title,price,
  availability,checkout_url}`, keeping product id distinct from variant id. This
  diverged from my first cut (which flattened) and was corrected to match the AC +
  qa's spec — the ranked match is the product, the purchase target is the variant.

**Deliberate trade-offs / scope (not smells — flagged so they aren't mistaken):**

- **401 is a single round-trip terminal re-register** — NO transparent
  refresh-and-retry choreography (`sil_whoami` has that). This is the architect's
  documented SC1 scope decision (card open question); refresh parity is an additive
  follow-on, not a gap.
- **`category` is singular** (maps into the UCP `categories[]` array). Multi-category
  is an additive change if ever needed, not a contract break.
- **No client-side `limit` clamp / no cursor opacity validation** — sil-api owns
  those (UCP: servers MAY clamp `limit`; cursors are opaque). The tool enforces only
  the one invariant it owns: at-least-one-input (`hasUsableInput` — `cursor`/`limit`
  alone do NOT count, they refine a search rather than constitute one).

**Known non-issues:** the `extractAvailability` helper explicitly sets `available`/
`status` to `undefined` when the wire value is the wrong type — this strips garbage
from the spread and serializes cleanly (undefined keys are dropped by
`JSON.stringify`). It is intentional defensive narrowing, not dead code.

## Review round 1 — code-quality-guardian

**Verdict: PASS.**

Reviewed against the open PR #8 diff (`git diff main...HEAD`): 4 production files
(`src/lib/sil-client.ts`, `src/tools/catalog.ts` NEW, `src/index.ts`,
`openclaw.plugin.json`) + 5 test artifacts. Gates re-run locally and confirmed
green: `pnpm typecheck` exit 0, `pnpm test` **316/316 across 27 files**.

No security issue, full type safety, structured fail-fast errors, zero hardcoded
values, no legacy / back-compat, no bloat, no structural anti-pattern, sound
architecture, knowledge captured inline + on the card body. Every handoff
confirm-item independently verified against the actual code (not just trusted):

- **Endpoint** — bare `` `${stripTrailingSlash(silApiUrl)}/catalog/search` ``
  (sil-client.ts:446); origin is `getSilApiUrl()` (catalog.ts:135). Grep confirms
  `/api/v1` appears nowhere in the path construction and `getApiUrl()` is NOT used
  in the search path (its sole reference, sil-client.ts:481, is the pre-existing
  sil-web `refreshStoredTokens`). Origin separation correct.
- **Type safety / no boundary `any`** — zero `any` types in either prod file (all
  grep hits are comments). The only `as` cast is the pre-existing `asRecord`
  (sil-client.ts:738), guarded behind a runtime `typeof === "object" && !== null`
  check — a checked narrowing, not an unchecked boundary cast. No cross-repo dep on
  `@sil/schemas` / `@ucp-js/sdk`; the `Search*` read-subset types are re-declared
  locally and every wire field is narrowed defensively (`extractSearchResult` /
  `projectProduct` / `projectVariant` / `extractPrice` / `extractAvailability` /
  `extractCursor` / `extractApiError`). `tsc --noEmit` exit 0.
- **Anti-false-green gate** — `extractSearchResult` (sil-client.ts:593) requires
  `result` to be an object AND `Array.isArray(result.products)`; a partial / garbage
  / `{stub:true}` 200 → null → `retryable`, a genuine `products: []` → `ok` + empty
  list. No bare-top-level fallback (deliberate: search is always enveloped). Proven
  by qa mutation #1 (weakening the `Array.isArray` gate fails 3 tests).
- **Three distinct outcomes** — empty-match 200 → `ok`; 400 `empty_search_input` →
  `invalid_request` (surfaces sil-api's `{error,message}`); 401 → `must_reregister`;
  5xx/network → `retryable` (no `recovery: sil_register`). Distinct, non-misdirecting
  hints; the integration suite asserts distinguishability both individually and via
  `Set([...]).size === 3` (catalog-search.integration.test.ts:547).
- **Never-log-the-token** — the Bearer header is built in `searchCatalog` via
  `extraHeaders` and travels only on the outbound request; never in the
  `SearchOutcome` union or the result. Log lines (catalog.ts:140-147) carry only
  status markers + the error *code* — no token, no params, no message body. The
  canary asserts against actual `logBlob(api)` output on success, 401, and network
  paths — not merely trusted.
- **Cursor** — hoisted from `result.pagination.cursor`, gated on
  `has_next_page === true` AND a non-empty string (`extractCursor`,
  sil-client.ts:699). End-of-results is the absent cursor; the stale-cursor-on-
  last-page suppression case is covered (proven by qa mutation #2).
- **`register()` synchronous** — `index.ts:41-57` registers tools + logs only; all
  I/O is inside `execute`. `registerCatalogTools` opens nothing.
- **Real tool, nested variant** — `jsonResult` only, no `stubResult` on the path.
  `SearchProduct` carries product-level `{id,title,source}` + a nested `variant`
  `{id,title,price,availability,checkout_url}` (sil-client.ts:205-215) — product id
  (ranked match) and variant id (purchase target) are not conflated. Confirmed the
  shape fix from commit `d7eb25f` matches the AC.
- **Tests have teeth / manifest guard wired** — the 4 suites assert exact shapes
  (`toEqual`, not partial), prove first-variant selection negatively, and the
  drift guard's `codeRegisteredNames()` now calls `registerCatalogTools(api)` with
  a named both-directions `sil_search` assertion (manifest-contract.integration.test.ts:124).
  Mutation-proven adversarial per qa's report.
- **Tier coverage** — `tiers: [unit, integration]` matches the suites in the diff
  (unit: search-classify, search-client, tools/search; integration:
  catalog-search, manifest-contract). No e2e claimed; correct for this repo.

**Deliberate scope (not smells, confirmed agreed):** 401 = single round-trip
terminal re-register (no transparent refresh in SC1); `category` singular →
`filters.categories[]`; no client-side `limit` clamp / cursor opacity check
(sil-api owns those). `extractAvailability` setting wrong-typed fields to
`undefined` is intentional defensive narrowing (undefined keys drop on
`JSON.stringify`), not dead code.

No findings (P1/P2/P3). Proceeding to distillation.

### → Handoff back to In Dev (if FAIL/REVIEW)

<!-- Not applicable — verdict is PASS. -->

## Distillation — solutions-architect

<!-- Runs in the worktree on the card branch after Review PASS. Pushes to the same PR. Per the `distillation` skill: SEARCH docs/ INDEX files first; edit existing docs rather than creating duplicates. Captures land at smallest viable scope: inline WHY comments, docs/decisions/, docs/knowledge/, docs/product/, or CLAUDE.md. Then flips status to pr-ready. -->

Inline WHY capture was already dense and correctly-scoped (the guardian confirmed it
for the anti-false-green gate, no-bare-fallback, has_next_page cursor gate, and
singular-category mapping — all at the site in `sil-client.ts` / `catalog.ts`), so
distillation captured ONLY the cross-cutting things the sibling SC2 card and the goal
template need, which an inline comment can't surface at a discoverable scope. All
captures search-first (both candidate docs pre-existed → edited, not duplicated):

- **decisions/sil-shared-catalog-client.md** (NEW) — the shared catalog-client + error-envelope layer and the re-declare-read-subset-locally decision (no `@sil/schemas` / `@ucp-js/sdk` dep). Names the exact landed symbols SC2 (`sil_product_get`) reuses: `searchCatalog`, `classifySearchResponse`, `SearchOutcome`, `projectProduct`/`projectVariant`/`extractPrice`/`extractAvailability`/`extractCursor`/`extractApiError`, and the `registerCatalogTools` group it extends. Directly de-risks the SC2 dev.
- **knowledge/sil-api-catalog-contract.md** (NEW) — the bare `POST /catalog/search` contract + the two wrong facts the goal's card-fanout template propagated to TWO catalog cards (the `/api/v1` path and the `@ucp-js/sdk` wire-source — verified: that SDK has ZERO catalog types; truth is sil-services `@sil/schemas/catalog.ts`). Load-bearing so the next catalog card doesn't copy the wrong boilerplate.
- **decisions/sil-two-origin-model.md** (EDIT) — added catalog as the second sil-api domain proving the bare-path/`getSilApiUrl()` rule (table row + constraint paragraph + cross-links). Bumped `updated_at`/`updated_by_card`.
- **knowledge/sil-response-classification.md** (EDIT) — added `classifySearchResponse` as the third classifier with its empty-match-vs-no-array 200 sub-case + the no-bare-fallback note; refreshed the `res.ok`-banned mutation evidence to cover the catalog gate. Bumped `updated_at`/`updated_by_card`.
- INDEX.md updated: decisions (new row + re-sort), knowledge (new row + re-sort).

No CLAUDE.md convention change warranted (the "how to add a tool" pattern was followed,
not extended). No `docs/product/` capture (the agent-facing flow lives on the card AC).

## PR Ready

<!-- PR url; founder notification fires here -->

- **PR:** https://github.com/Context4GPTs/sil-openclaw/pull/8 (OPEN, targets `main` — founder merges)
- Distillation landed 2 new + 2 edited docs (1 decision + 1 knowledge new; the two-origin decision + the response-classification knowledge doc extended) + both INDEXes, all on `card/sil-search-plugin-tool` / PR #8. Inline capture was already sufficient for the within-file WHYs; distillation added only the cross-cutting reuse + wrong-boilerplate-hazard surfaces the SC2 sibling and the goal template need.

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
