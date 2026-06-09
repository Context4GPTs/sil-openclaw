---
type: card
title: sil_product_get plugin tool
slug: sil-product-get-plugin-tool
work_type: feature        # feature | bug | refactor | chore | docs
tiers: [unit, integration]   # subset of [unit, integration, e2e] — set by solutions-architect during Discovery from the acceptance criteria below
status: done            # backlog | discovery | stand-by | in-dev | review | distilling | pr-ready | done | abandoned
agents: []                # current active agent set; updated by each handoff
priority: 2               # 1 = drop-everything, 2 = normal, 3 = nice-to-have
created: 2026-06-09       # placeholder — /board-add overwrites with today's date; never leave as a placeholder before commit (INDEX.base formulas will break)
updated: 2026-06-09       # set by expert-developer at stand-by → in-dev
base_branch: main         # the branch this card's worktree was cut from and the PR will target
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-sil-product-get-plugin-tool            # set by /board-add at card birth (absolute path to .claude/worktrees/card-<slug>)
branch: card/sil-product-get-plugin-tool            # set by /board-add (card/<slug>)
pr: https://github.com/Context4GPTs/sil-openclaw/pull/9                  # set by expert-developer at in-dev → review
merged_commit: 6f7984c08d58cb41a11f2af543e8389ca017b350       # set by /board-tick on PR-merge detection
epic_id: catalog-plugin-tools
origin: goal:agentic-search-slice
depends_on: [catalog-domain-endpoints, sil-search-plugin-tool]
---

## Intent (goal: agentic-search-slice — SC2)

The **`sil_product_get`** OpenClaw plugin tool (the lookup companion to `sil_search`). An agent passes `{ ids: string[] }` — one or more product/variant identifiers (e.g. ids returned earlier by `sil_search`) — and gets the matching `products[]`/variants in UCP shape, each purchasable variant with **fresh** `{ id, title, price, availability, checkout_url, source }` (re-fetch current price/availability + a fresh checkout URL before the user buys). The agent builds **no UCP envelope** — the tool calls sil-api's **`POST /api/v1/catalog/lookup`** (merged, PR #18). Ids not found come back as an **info message** listing them (UCP lookup semantics), **not a hard error**; `401`/source-failure → a structured error envelope. Real tool, **not a stub** (stub-free): the integration test drives the live endpoint.

## Epic notes (provisional — sibling Discovery owns the verdict)

**Epic:** `catalog-plugin-tools`. **Origin:** `goal:agentic-search-slice`. **Satisfies:** SC2. `depends_on: catalog-domain-endpoints` — **MERGED (PR #18)**, so this is **ready**. Sibling card: `sil-search-plugin-tool` (SC1, the search companion) — same plugin pattern; the two may share a `registerCatalogTools` group.

**Likely change site (shallow guess — Discovery confirms):** the `src/tools/examples.ts` pattern — register `sil_product_get` (likely in the same `registerCatalogTools(api)` group as `sil_search`), wire into `register()`, and **add `sil_product_get` to `openclaw.plugin.json#contracts.tools`** (the manifest-contract drift guard). `execute` calls `${SIL_API_BASE}/api/v1/catalog/lookup` with the Bearer JWT. Read `vendor/ucp/spec/docs/specification/catalog/` (lookup semantics) + `@ucp-js/sdk`.

**Draft acceptance scenarios (Discovery refines + tier-tags):**
- `[unit]` Given `{ ids: [...] }`, when `sil_product_get` runs, then it calls `POST /api/v1/catalog/lookup` with those ids (no envelope) and returns the matching `products[]` in UCP shape.
- `[integration]` Against the live sil-api, a known id returns the expected item with a fresh, non-empty `checkout_url`; a mix of known + unknown ids returns the found products **plus an info message** listing the unfound ids (not a hard error).
- `[integration]` Unauthenticated → `401` structured error envelope; source-failure → structured error envelope.
- `[integration]` `sil_product_get` is in `contracts.tools` and `register()` registers it — the manifest-contract drift test passes.
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

- 2026-06-09 founder (re-prioritize) — sequence: added [[sil-search-plugin-tool]] to depends_on. Both cards add to the same `registerCatalogTools` group + edit `src/index.ts` + `openclaw.plugin.json`; doing search first makes this card rebase once instead of thrashing on the same surface. Discovery may proceed in parallel; dev waits for search to merge.
- 2026-06-09 product-owner (discovery) — scope-boundary: this card is UCP `lookup_catalog` (`POST /catalog/lookup`, batch `ids[]`, ONE featured variant per product), NOT `get_product` (`POST /catalog/product`, single id, full multi-variant + interactive `selected`/`preferences` option selection). sil-api has built ONLY `/catalog/lookup` (handlers/catalog.ts:213-235 — no `/catalog/product` route). So interactive variant-selection / full-PDP detail is OUT OF SCOPE for SC2 and is a clean, separable future card (`sil_get_product` over a future sil-api `/catalog/product`). "Rich" here = rich product detail + the featured variant per id, not the option-selection PDP experience. Flagging so the orchestrator knows SC2 does not cover `get_product` — if the goal expects interactive selection, that is a distinct card.
- 2026-06-09 product-owner (discovery) — pattern: confirms the sibling [[sil-search-plugin-tool]] signal-69 shared-layer ask from the lookup side. Both catalog tools share one thin-client + response-normalization layer in `src/lib/sil-client.ts` and one error-envelope taxonomy mirrored from `identity.ts` (not_registered / must_reregister / retryable, each a distinct recovery hint). The scope split is the product: search = LEAN (six fields/product, ranked list, pagination cursor); lookup = RICH (description + options + the featured variant + the `inputs` correlation, NO pagination — lookup is a batch resolve, not a list). The shared catalog client should be factored by whichever card lands first (search, per the depends_on) and reused here — avoids two divergent agent-facing contracts across SC1/SC2.
- 2026-06-09 solutions-architect (discovery) — blocked-on (concrete coupling): dev for this card couples on [[sil-search-plugin-tool]]'s EXACT landed symbols, which do NOT exist on `main` yet (verified: search's worktree `src/tools/` is still `examples.ts` + `identity.ts`; no `registerCatalogTools`/`searchCatalog` committed). This card REUSES `registerCatalogTools(api)` (adds `registerProductGet` inside it) + the sil-client low-level helpers, and ADDS `lookupCatalog` + pure `classifyLookupResponse` + `LookupOutcome` + `extractLookupResult`. Search's discovery PLANNED the names `registerCatalogTools`/`registerSearch`/`searchCatalog`/`classifySearchResponse`/`SearchOutcome`/`extractSearchResult` — dev must VERIFY these against search's merged code at rebase and reconcile if they differ. Keep this card at `stand-by`; do NOT start dev until search merges. Discovery (this work) is complete and needs no merge.
- 2026-06-09 solutions-architect (discovery) — card-doc-error (same as search signal-72): this card's Intent + Epic-notes state the endpoint as `POST /api/v1/catalog/lookup` and pin wire types to `@ucp-js/sdk`. BOTH wrong, identically to the search card: sil-api serves the route at the BARE `/catalog/lookup` (no `/api/v1` anywhere — handlers/catalog.ts:213-214), and `@ucp-js/sdk` carries ZERO catalog types (checkout/cart/order/payment only). Authoritative catalog wire shape is `@sil/schemas` `catalog.ts`. The goal's card-fanout template is propagating the wrong `/api/v1` + `@ucp-js/sdk` boilerplate to every agentic-search-slice card — recommend correcting the template at the goal level so the next catalog card does not inherit it a third time.
- 2026-06-09 solutions-architect (discovery) — sc-candidate (auth-recovery parity): scoped `sil_product_get`'s 401 to a SINGLE round-trip (terminal re-register), matching the sibling search card's scope decision — NOT `sil_whoami`'s transparent refresh-and-retry-once. If the goal intends uniform transparent-refresh auth-recovery UX across ALL sil-api tools, that is a SINGLE small follow-on card touching BOTH catalog tools (the `registerCatalogTools` group) together — not a per-tool divergence. Not blocking SC2.
- 2026-06-09 product-owner (discovery) — scope-decision (founder may override): recommend `sil_product_get` MATCH the sibling `sil_search`'s 401 handling EXACTLY — single round-trip, terminal re-register hint, NO transparent refresh-and-retry. Rationale: the two catalog tools are siblings used back-to-back; uniform auth-recovery UX is the right product behavior, and transparent-refresh parity (if the founder wants it) should land on BOTH catalog tools together as one follow-on across the `registerCatalogTools` group, never diverge between them. Not blocking.
- 2026-06-09 product-owner (discovery) — duplicate-risk: this card's Intent + Epic-notes carry the SAME wrong boilerplate the sibling [[sil-search-plugin-tool]] flagged (its solutions-architect signal): the endpoint is stated as `POST /api/v1/catalog/lookup` (WRONG — sil-api serves the BARE `/catalog/lookup`, no `/api/v1` prefix, handlers/catalog.ts:15) and wire types are pinned to `@ucp-js/sdk` (WRONG — that SDK carries ZERO catalog types; the authoritative shape is sil-services `@sil/schemas` catalog.ts). Confirms the sibling's recommendation to correct the goal's card-fanout template so this error stops propagating to every agentic-search-slice catalog card. (solutions-architect will record the technical correction in Discovery; flagging here for the orchestrator/template fix.)

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

**What `sil_product_get` is, for an AI-agent caller.** The *lookup companion* to
`sil_search` — the RICH side of a deliberate scope split (`sil_search` returns LEAN
scannable results; this tool returns RICH per-product detail). The agent passes
`{ ids: string[] }` — one or more product/variant identifiers it already holds (e.g.
ids a prior `sil_search` returned, a saved/deep-linked id, or an id from cart
validation) — and gets back the matching `products[]` in UCP shape, each product
carrying its **fresh** purchasable variant `{ id, title, price, availability,
checkout_url, source }` plus richer product-level context (see "How rich is rich"
below). The agent's whole job is "I have these ids — give me current, buyable detail
for them." The tool builds **no UCP envelope and fills no defaults**: it calls sil-api's
**`POST /catalog/lookup`** (merged), which owns enrichment, the `not_found` messaging,
and the envelope. The tool is a thin client — validate, attach the user's Bearer JWT
(mirroring `sil_whoami`/`sil_register` in `src/tools/identity.ts`), POST, normalize the
response, surface the result.

**Why "fresh" is the entire point of this tool.** UCP is explicit that catalog
responses "reflect the Business's current terms for the given request but are **not
transactional commitments** — checkout is authoritative" and "SHOULD NOT be reused
across sessions without re-validation" (`vendor/ucp/.../catalog/index.md` §Relationship
to Checkout). `price`, `availability`, and `checkout_url` are point-in-time and
session-scoped: a `checkout_url` or price that `sil_search` returned minutes ago may
already be stale. Lookup exists so an agent can **re-fetch current values immediately
before the user buys** — acting on a stale cached `checkout_url`/price later is a broken
or mispriced purchase. So this tool always hits the live source; it never serves a cache
and never promises the values persist past this response.

**This card is `lookup_catalog` (batch resolve), NOT `get_product` (single-product
interactive detail).** UCP's catalog-lookup capability has TWO operations
(`vendor/ucp/.../catalog/lookup.md`): `lookup_catalog` (`POST /catalog/lookup`, `ids[]`,
**one featured variant per product**, batch) and `get_product` (`POST /catalog/product`,
single `id`, **full variant subset + interactive option selection** via
`selected`/`preferences`). The card's intent (`{ ids: string[] }` → `/catalog/lookup`)
is unambiguously `lookup_catalog`, and sil-api has built ONLY `/catalog/lookup`
(`services/sil-api/src/handlers/catalog.ts:213-235` — there is no `/catalog/product`
route). So interactive variant selection is **explicitly out of scope** for this card;
"rich" here means rich *product* detail with the featured variant per id, not the
multi-variant option-selection PDP experience. (Scope-boundary signal raised below.)

**The unfound-id decision: a partial hit is a SUCCESS, surfaced as an info list —
already built server-side.** When some ids don't resolve, sil-api returns **200** with
the found `products[]` PLUS a `messages[]` array, one entry per unresolved id:
`{ type: "info", code: "not_found", content: "<the id>" }`, in input order, and the
`messages` key is **omitted entirely when every id resolved** (`catalog.ts:88-91`,
`123-128`; `@sil/schemas` `catalog.ts:384-399`, `456-467`; UCP §Identifiers Not Found).
This is the product decision the card calls for, and it is **not the tool's to invent —
it is the tool's to surface faithfully**. The agent-facing contract: a lookup that finds
*some* (or even *none*) of its ids is `status: "ok"` with whatever resolved, and a
structured `not_found: [<ids>]` list the agent can relay ("3 of your 4 items are still
available; 1 is no longer listed"). It is NEVER an error and carries NO recovery hint —
re-running won't conjure a delisted product.

**Three id-resolution outcomes the agent must tell apart** (all `status: "ok"`,
distinguished by content — mirroring how sil-api keeps them distinct):
1. **All ids resolved** → `products[]` populated, no `not_found`.
2. **Partial hit** → some `products[]`, `not_found: [<the unresolved ids>]`.
3. **No ids resolved** → `products: []`, `not_found: [<all the ids>]`. This is the
   lookup analogue of search's empty-results-as-success: an empty `products[]` from a
   lookup is a successful "none of these exist anymore," not a failure — and unlike
   search, lookup *names which ids* came back empty.

**Correlating ids to variants — the agent uses `inputs`, not array order.** UCP
guarantees the lookup response does **not** preserve request order
(`lookup.md` §Client Correlation, line 63), and one id can resolve to a product while
another resolves to one of its variants. Each returned variant carries an
`inputs: [{ id, match }]` array — which request id(s) resolved to it, and whether the
match was `exact` (a variant/sku id) or `featured` (a product id; the server picked a
representative variant). The tool MUST surface `inputs` so the agent can map "the id I
asked about" → "the variant I got back" and tell the user whether they're looking at the
exact thing they referenced or a featured stand-in. Dropping `inputs` makes a multi-id
lookup uncorrelatable.

**Error vs business-outcome split (mirrors `identity.ts`'s distinct-hint taxonomy).**
Only TWO conditions are true errors (everything else — including all id-resolution
outcomes above — is `status: "ok"`):
- **Not registered / `401`** → re-register hint (`recovery: "sil_register"`). No stored
  token → terminal `not_registered`, ZERO network (mirrors `sil_whoami`). A `401` from
  sil-api (dead session — the auth preHandler rejects before the handler,
  `catalog.ts:5-8`) → re-register hint.
- **Source / transport failure** → transient "try again" hint, **NO re-register**. A
  `500 source_unavailable` (the source is down — `catalog.ts:60-63`), a network error,
  or a timeout → `status: "retryable"`. Re-registering wouldn't help and would misdirect
  the user; this hint MUST be DISTINCT from the `401` hint.

The distinct-hint discipline is the whole reason the taxonomy exists: an agent that gets
a "re-register" hint on a transient source blip sends the user through a pointless auth
dance; an agent that gets "try again" on a dead session retries forever. One wrong hint
= one misdirected user.

**Alternatives ruled out (product):**

- **Treat unfound ids as a hard error (non-200, or `status:"error"`).** Rejected: it
  contradicts UCP ("return success with the found products… MAY include informational
  messages indicating which identifiers were not found" — `catalog/index.md`) AND the
  already-merged sil-api behavior (200 + info messages, `catalog.ts:123-128`). It would
  make the common, benign case (a saved id since delisted) fall into the agent's error
  branch, breaking an otherwise-successful multi-id lookup.
- **Collapse a no-ids-resolved lookup into the same shape as a not-registered/transport
  error.** Rejected: "none of your ids exist" is a *successful* answer the agent relays
  to the user; "you're not registered" / "the source is down" are recoverable failures
  with actions attached. Conflating them strips the agent of the information it needs to
  respond correctly. Empty `products[]` + `not_found:[all ids]` is `ok`.
- **Drop the `inputs` correlation and return products in an assumed order.** Rejected:
  UCP does not guarantee response order and one id may resolve to a variant of another
  id's product (`lookup.md` §Client Correlation). Without `inputs` a multi-id lookup is
  uncorrelatable — the agent can't tell the user which id maps to which result. `inputs`
  is lookup's defining feature over search; surface it.
- **Build this card as `get_product` (single id, interactive `selected`/`preferences`
  option selection).** Rejected: the card's input is `{ ids: string[] }` (plural, batch)
  → `/catalog/lookup`, and sil-api has not built `/catalog/product`. Interactive
  multi-variant selection is a separable future tool, not this one. Batch-lookup keeps
  this card shippable now and the scope split clean.
- **Serve a cached / `sil_search`-derived result instead of re-fetching.** Rejected: the
  product reason lookup exists is freshness (UCP: catalog responses are not transactional
  commitments and must be re-validated). A cache reintroduces exactly the
  stale-`checkout_url`/price hazard lookup is meant to eliminate. Always hit live.
- **Make a stub first, de-stub later.** Rejected by `complete-work-is-stub-free`: the
  backing `/catalog/lookup` endpoint is already merged, so this ships real on the
  exercised path, driven by an integration test against the real wiring.

**How rich is "rich" — what lookup returns beyond search's lean six.** The scope split
demands lookup carry more than search's `{ id, title, price, availability, checkout_url,
source }`-per-product projection, but "rich" must stay bounded — dumping the entire raw
UCP payload is its own anti-pattern. The decision, drawing on what `SilCatalogProduct`
actually carries (`@sil/schemas` `catalog.ts:228-245`):

- **Each PRODUCT surfaces:** `id`, `title`, `description` (the full
  `{ plain?, html?, markdown? }` — search shows at most a title; lookup is for a purchase
  decision, so the description is the point), `categories` (when present), `price_range`,
  `source`, and `handle` (when present — a stable human-facing id the agent can
  deep-link).
- **The FEATURED variant (one per product, per `lookup_catalog` semantics) surfaces:**
  `id`, `title`, `price`, `availability` (the full `{ available?, status? }` OBJECT —
  pass through, do NOT flatten to a bool: a `status` like `"in_stock"`/`"out_of_stock"`
  is actionable signal), `checkout_url` (fresh, non-empty — the acquisition target),
  `sku` and `options` (`[{ name, label }]` — what specific configuration this variant is,
  e.g. "Blue / Large"; a lookup caller making a purchase decision needs to know *which*
  variant they're buying), and the lookup-only **`inputs`** correlation.

What lookup **does NOT** add (the bound): no `media`/images, `ratings`, `unit_price`,
`barcodes`, `seller`, or product-level `metadata`. Those exist in the open UCP product
(passed through sil-api's open schema) but are not part of *this tool's* agent-facing
contract — an agent picking among already-identified items needs buyable detail (price,
availability, which-variant, how-to-buy, why-this-matched), not a full PDP render
bundle. If a future card needs the render payload, that is `get_product` + a richer
projection, additive — not a contract break here.

**Rich-detail alternatives ruled out:**

- **Return the entire raw UCP product-detail payload (media, full options matrix,
  ratings, all metadata, `messages[]` verbatim).** Rejected: pushes UCP-wire knowledge
  and a render-bundle's worth of noise onto every agent, duplicates what a future
  `get_product` PDP tool would own, and bloats the result for a caller whose job is "is
  this still buyable, and which variant." Curate the rich subset above.
- **Return the SAME lean six fields as `sil_search`** (no description, no options, no
  inputs). Rejected: it collapses the deliberate search/lookup split — no product reason
  to call lookup over re-searching. Lookup must add purchase-decision detail
  (description, the variant's options, `inputs` correlation) to earn its place. The split
  is the product, not an accident.
- **Return ALL variants per product (not just the featured one).** Rejected: that is the
  `get_product` contract (`lookup.md`: lookup is "one featured variant per product";
  get_product is "featured variant and relevant subset"). Multi-variant interactive
  selection is out of scope (above). One featured variant per product, with `inputs`
  telling the agent whether it was an `exact` or `featured` match.

**Technical approach — solutions-architect (the symbol-level contract; the PO's three
findings above all confirmed against source — see the resolutions under Open questions).**

**Shape: mirror `sil_whoami`, single synchronous request/response.** `execute(callId, { ids })`
guards a non-empty `ids` client-side, reads the stored access token (`readTokens()`), calls a
new `lookupCatalog(silApiUrl, token, ids)` wrapper in `src/lib/sil-client.ts`, and maps a
discriminated `LookupOutcome` union to `jsonResult(...)`. The tool is added as
`registerProductGet(api)` — a SECOND call inside the SAME `registerCatalogTools(api)` group
that [[sil-search-plugin-tool]] creates (no structural change; exactly the slot search's
handoff leaves open and PO signal-69 asks be factored).

**SHARED-LAYER reuse — exactly what is reused vs new** (search lands FIRST and creates the
group + the catalog sil-client helpers):
- **REUSES** (does not recreate): the `registerCatalogTools(api)` group; the low-level
  sil-client primitives from the identity work that search also reuses — `postJson` (with a
  Bearer header), `asRecord`, `readJsonBody`, `stripTrailingSlash`, `REQUEST_TIMEOUT_MS`; the
  distinct-envelope helper STYLE (`notRegistered`/`mustReregister`/`transient`); `getSilApiUrl()`
  origin resolution; the integration `installRouter` recorder pattern.
- **ADDS**: `registerProductGet(api)` (the tool); `lookupCatalog(...)` + a pure exported
  `classifyLookupResponse(status, body)` + the `LookupOutcome` union + a local
  `extractLookupResult` normalizer in sil-client.ts. Lookup gets its OWN classifier/extractor,
  NOT search's `classifySearchResponse`/`extractSearchResult` (see rejected alternative).

**Two structural deltas from search's response that the lookup layer handles distinctly.**
PR #18's lookup `result` is `CatalogLookupResult = { products: SilCatalogProduct[], messages? }`
(`@sil/schemas` catalog.ts:456-465):
1. **No `pagination`.** Lookup is a batch resolve, not a list (catalog.ts:456-460, doc line
   454). `lookupCatalog` neither hoists nor returns any `cursor`. (Search's classifier hoists
   `result.pagination.cursor`; lookup has no cursor concern.)
2. **`messages[]` carries the misses.** `{ type:'info', code:'not_found', content:<id> }`
   entries in `result.messages`, OMITTED entirely on full success (catalog.ts:78-91, 117-128).
   `extractLookupResult` parses the `not_found` ids out (entries whose `code === 'not_found'`;
   `content` is the id) onto the `ok` result as `not_found: string[]`.

**`LookupOutcome` classifier (pure, exported, unit-tested like `classifyIdentityResponse`).**
Simpler than search's — no `empty_search_input` 400 (lookup's empty-`ids` is a Fastify SCHEMA
400, not a `SourceError`), no empty-vs-error subtlety (a 200 with `products:[]` + all-`not_found`
messages is a legitimate all-missed success): no stored token → handled in the tool (terminal
`not_registered`, zero network); 401 (preHandler rejects unauth — catalog.ts:5-8) →
`unauthorized` → terminal re-register (single round-trip, parity with search); 400 →
`invalid_request` surfacing `{ error, message }`; 500 `source_unavailable` / network / timeout
→ `retryable`; 200 with a usable `products` array (possibly empty) → `ok` carrying
`{ products, not_found }`; **200 with no usable envelope / `products` array → `retryable`,
NEVER false-green `ok`** — gate `ok` on envelope unwrapping AND `Array.isArray(result.products)`,
mirroring `extractIdentity`'s `name`-gate (sil-client.ts:340-357). SUBTLE: distinguish "no
products but real envelope" (ok, all-missed) from "no usable envelope" (retryable) by
PRESENCE, never array length.

**Additional alternatives ruled out (technical):**
- *Reuse search's `classifySearchResponse`/`extractSearchResult` verbatim* — rejected: lookup
  has no `pagination` and DOES have `not_found` messages + the per-variant `inputs`
  correlation; a shared classifier would carry dead cursor logic or drop miss/correlation
  data. Lookup gets its own thin classifier + extractor, sharing only the low-level helpers
  and the group/envelope-helper SHAPE.
- *Depend on `@sil/schemas` / `@ucp-js/sdk` for the lookup result type* — rejected: cross-repo
  dep the plugin avoids; the SDK has no catalog types. Re-declare the read-subset locally +
  narrow, like `extractIdentity`.
- *Reach sil-api via `getApiUrl()` / `/api/v1`, or add a new config key* — rejected: catalog
  is a sil-api domain read → bare `/catalog/lookup` on `getSilApiUrl()`; `sil_api_base` is
  already the shared sil-api-domain key (config.ts:14-17).

### Affected files / surfaces

<!-- product-owner contributes behavior surfaces; solutions-architect the technical map -->

**Reuses (created by [[sil-search-plugin-tool]], which lands FIRST — this card rebases onto
them, does NOT recreate them):**
- **`src/tools/catalog.ts`** — the `registerCatalogTools(api)` group search creates; this card
  adds `registerProductGet(api)` inside it. Reconcile to search's ACTUAL landed symbol names
  at rebase (Signals to orchestrator).
- **`src/lib/sil-client.ts`** — the low-level helpers (`postJson` w/ Bearer, `asRecord`,
  `readJsonBody`, `stripTrailingSlash`, `REQUEST_TIMEOUT_MS`) search reuses from identity.

**New / edited by THIS card:**
- **`src/lib/sil-client.ts`** (EDIT) — add `lookupCatalog(silApiUrl, token, ids)`, exported
  pure `classifyLookupResponse(status, body)`, the `LookupOutcome` union (`ok` carrying
  `{ products, not_found }` / `unauthorized` / `invalid_request` / `retryable`), and a local
  `extractLookupResult` read-subset normalizer (unwrap `result` → narrow `products[]` →
  per-product first-variant projection incl. `inputs` → parse `not_found` from
  `result.messages`). Tokens never logged, never in the returned union.
- **`src/tools/catalog.ts`** (EDIT) — add `registerProductGet(api)` inside `registerCatalogTools`;
  `parameters: Type.Object({ ids: Type.Array(Type.String(), { minItems: 1 }) })`; `execute`:
  client-side non-empty-`ids` guard → read tokens → `lookupCatalog(getSilApiUrl(), token, ids)`
  → map `LookupOutcome` → `jsonResult`. Reuse the distinct-envelope helper style.
- **`src/index.ts`** — likely NO change (the `registerCatalogTools(api)` call already exists
  from search; a tool added to an existing group needs no `register()` edit — CLAUDE.md step 2).
  Confirm at rebase.
- **`openclaw.plugin.json`** (EDIT) — add `"sil_product_get"` to `contracts.tools`.
  `security.networkEndpoints` already lists `https://api.sil.4gpts.com` — no change. Extend
  `security.packagingNote` prose to mention the catalog lookup read if search has not.
- **`src/__tests__/manifest-contract.integration.test.ts`** (likely NO edit, qa-developer) —
  `codeRegisteredNames()` already calls `registerCatalogTools(api)` once search lands, so the
  new name is picked up automatically (contrast search, which had to ADD the call). Verify
  after rebase.
- **`src/__tests__/catalog-lookup.integration.test.ts`** (NEW, qa-developer) — the boundary
  suite (test strategy in the handoff), cloning search's `installRouter` recorder routed on
  `/catalog/lookup`.

### Risks / failure modes

<!-- product-owner contributed the behavior/contract risks; solutions-architect
adds the technical ones below. -->

- **Partial-hit / empty-hit conflated with error (the headline lookup risk).** If a
  lookup that resolves only *some* (or *none*) of its ids is surfaced as anything other
  than `status: "ok"` + the found `products[]` + a `not_found: [<ids>]` list, agents
  treat the most common benign outcome — a saved or `sil_search`-derived id that has
  since been delisted — as a failure: they may retry pointlessly, tell the user the tool
  is broken, or discard the items that DID resolve. A partial hit is a success; a
  zero-hit is a success that says "none of these exist anymore." (UCP §Identifiers Not
  Found; sil-api `catalog.ts:123-128`.)
- **Recovery hint that misdirects the agent.** The two true-error classes need DISTINCT
  hints, mirroring `identity.ts`: not-registered / `401`-dead-session → `recovery:
  "sil_register"`; source/transport failure (500 `source_unavailable`, network, timeout)
  → a transient "try again" hint with NO `recovery: sil_register`. And `not_found` ids
  must carry NEITHER hint — they are a business outcome, not a failure. A wrong hint
  sends the agent down a recovery path that cannot fix the actual problem (re-register on
  a transient blip; retry-forever on a dead session; an auth dance over a delisted id).
- **Stale purchasability presented as a commitment.** This is the risk lookup *exists to
  reduce*, and the tool must not reintroduce it. `price`, `availability`, and
  `checkout_url` are point-in-time and session-scoped — UCP: catalog responses "are not
  transactional commitments; checkout is authoritative" and "SHOULD NOT be reused across
  sessions without re-validation" (`catalog/index.md`). Risk: the tool caches a prior
  result, or the agent treats a returned `checkout_url`/price as a guarantee that holds
  later. The tool returns current values from a live fetch and promises nothing past this
  response; an agent should re-call lookup right before acting on a price/checkout_url.
- **Variant-selection ambiguity / lost id↔variant correlation.** A UCP product has many
  variants; lookup returns ONE featured variant per product, and the response is NOT in
  request order, and one id may resolve to a variant of another id's product
  (`lookup.md` §Client Correlation). If the tool drops the `inputs` correlation, picks a
  non-featured variant, or silently omits a product whose variants were all filtered out,
  the agent's "the item I looked up" no longer maps to "the variant I got back" — it may
  show the user the wrong configuration or lose track of which id is which. Surface the
  first/featured variant deterministically AND its `inputs` array (`id` + `exact`/
  `featured`) so every result is traceable to the id that produced it.
- **`availability` flattened, dropping actionable signal.** UCP `availability` is an
  OBJECT `{ available?, status? }` (`@sil/schemas` `catalog.ts:113-122`). Flattening it
  to a bare boolean discards `status` (`"in_stock"` / `"out_of_stock"` / backorder
  signal) that a purchase-decision caller needs. Pass the object through as-is.
- **PII / token leakage in results or logs.** Same invariant as `identity.ts`: the Bearer
  token and Authorization header never reach a log line or the result. The product
  payload (titles, prices, descriptions, checkout_urls) is not credential-bearing and is
  the point of the tool, but the JWT that authorizes a personalized lookup (member
  pricing, gated inventory — `catalog/index.md` §Scopes `lookup:read`) is — log only
  non-credential status markers.
- **Duplicate / over-large id lists handled wrong.** UCP: duplicate ids in the request
  MUST be deduplicated, and when multiple ids resolve to the same product it MUST be
  returned once (`lookup.md` §Supported Identifiers); implementations MAY cap batch size
  and MUST reject an over-limit batch with a `request_too_large` 400. sil-api's seam
  already dedups (`catalog.ts:80`); the tool must NOT itself dedup-then-mask (which would
  hide a seam regression) nor assume one-product-per-id (the `inputs` array can carry
  multiple ids for one variant). The tool forwards the ids as given and trusts sil-api's
  dedup/cap; it owns only the one client-side guard it can cheaply make — a non-empty
  `ids` array (the empty case is also the schema backstop, `ids` `minItems: 1`).

*Technical failure modes — solutions-architect:*

- **Dev starts before [[sil-search-plugin-tool]] merges (highest-likelihood process
  failure).** The shared `registerCatalogTools` group + the catalog sil-client helpers do
  NOT exist on `main` yet — verified: the search worktree has not committed them (its
  `src/tools/` is still `examples.ts` + `identity.ts` only; no `searchCatalog`/
  `registerCatalogTools` symbols anywhere). If this card's dev runs first it either
  recreates the group (divergent from search → merge conflict + two error contracts) or
  fails to compile. **Dev MUST wait for search to merge**; `stand-by` is correct and the
  orchestrator gates dev on the dependency. Discovery in parallel is fine (no code touched).
- **Wrong path/origin (the card states it wrong).** Using `/api/v1/catalog/lookup` or
  `getApiUrl()` 404s against sil-api. Pin to the bare `/catalog/lookup` on `getSilApiUrl()`.
- **Implementing the wrong UCP operation.** Building `get_product` single-resource
  semantics (option selection, `ucp.status:"error"` on miss) instead of `lookup_catalog`
  batch semantics. sil-api has no `/catalog/product` route; the contract is batch lookup.
- **The empty-`ids` 400 is a Fastify SCHEMA-validation error, NOT a `SourceError`
  `empty_search_input`.** That `SourceError` code is search-only (`catalog.ts:60-69`,
  `sourceErrorToHttp`) — it never arises on the lookup route. A lookup with an empty/missing
  `ids` is rejected by the `CatalogLookupRequest.ids` `minItems:1` schema → generic 400. The
  classifier maps any 400 → `invalid_request`; do NOT special-case `empty_search_input` on
  the lookup path.
- **`@ucp-js/sdk` wire-source error.** The card pins `@ucp-js/sdk`; it has zero catalog
  types. Catalog types live in `@sil/schemas` `catalog.ts` (cross-repo — do NOT depend on
  it). Re-declare the read-subset locally + narrow, like `extractIdentity`.
- **False-green on a partial/garbage 200.** A stub/garbage/partial 200 (no `products` array)
  misread as a valid all-missed lookup. Gate `ok` on envelope unwrapping AND
  `Array.isArray(result.products)`; anything else → `retryable`. Mirror the `extractIdentity`
  `name`-gate (sil-client.ts:340-357). SUBTLE: a genuine 200 with `products:[]` + populated
  `messages` IS a valid `ok` (all-missed) — the discriminator is envelope/`products`-array
  PRESENCE, never array length.
- **`any` at the boundary.** The wire body is untrusted JSON; do not cast it to a trusted
  type. Narrow defensively (no `any`, no unchecked `as`) — mirror `extractIdentity`.
- **Stale manifest drift guard.** Unlike search (which had to ADD the `registerCatalogTools`
  call to `codeRegisteredNames()`), this card adds a tool to a group ALREADY wired into the
  test — so no test edit is needed and the new name is picked up once it is in the manifest.
  Verify the `registerCatalogTools(api)` call is present in `codeRegisteredNames()` after
  rebase; if search structured the group differently, reconcile.

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.
-->

Tiers tagged by solutions-architect. Definitions for THIS repo (identical to the search
card): **unit** = host SDK boundary (`fetch`) mocked, pure-function / param-mapping
assertions. **integration** = the real plugin wiring through the real `sil-client`, with
only `fetch`/host mocked — there is NO live sil-api and NO e2e/host-load tier in this repo
(CLAUDE.md; `whoami.integration.test.ts:6-12`). The card's phrase "the integration test
drives the **live** endpoint" means, in THIS repo, the real plugin pipeline against a
live-SHAPED `fetch` double; the true live-sil-api guarantee is sil-stage's deferred e2e
(goal SC9). `tiers:` frontmatter = `[unit, integration]` (no `e2e`). The `(likely …)`
hints the PO left are folded into the `[tier]` tags below.

**Happy path — ids in → fresh rich product detail out**

- `[unit]` Given `{ ids: [...] }` (one or more product/variant ids), when
  `sil_product_get` runs, then it calls `POST <silApiUrl>/catalog/lookup` (bare path,
  sil-api origin — NOT `/api/v1`) with body `{ ids }` (the simplified shape; building no
  UCP envelope and filling no defaults the agent did not supply), carrying the stored
  user's `Authorization: Bearer <token>`.
- `[unit]` Given sil-api returns a populated lookup envelope, when `sil_product_get`
  normalizes it, then it unwraps `result` and returns `status: "ok"` with a `products[]`,
  each product projected to its rich detail (`id`, `title`, `description`, `categories`
  when present, `price_range`, `source`, `handle` when present) and exactly one featured
  variant (`id`, `title`, `price`, the full `availability` object, `checkout_url`, `sku`,
  `options`, and the `inputs` correlation), and NO `not_found` list when every id
  resolved.
- `[integration]` Given a known id, when `sil_product_get` runs against the real wiring,
  then the matching product comes back with a fresh, **non-empty `checkout_url`** on its
  featured variant (the acquisition target — re-fetched live, not a cached value).
- `[unit]` Given the response does not preserve request order and an id resolved at the
  product level vs the variant level, when normalized, then each returned variant carries
  its `inputs: [{ id, match }]` with `match` ∈ {`exact`, `featured`}, so the agent can
  correlate every result back to the request id that produced it (the tool does NOT rely
  on or assert array order).

**Unfound ids are a SUCCESS surfaced as an info list — never a hard error**

- `[integration]` Given a mix of known + unknown ids, when `sil_product_get` runs against
  the real wiring (the `fetch` double returns 200 with the found `products[]` plus
  `messages: [{ type:"info", code:"not_found", content:"<id>" }, ...]`), then the tool
  returns `status: "ok"` with the found products AND a structured `not_found: [<the
  unfound ids>]` list — NOT an error, NO `recovery` hint, no thrown failure.
- `[integration]` Given NONE of the requested ids resolve (200, `result.products: []`, a
  `not_found` message for every id), when `sil_product_get` runs, then it returns
  `status: "ok"` with `products: []` and `not_found: [<all the ids>]` — a successful
  "none of these exist anymore," distinct from a not-registered/transport error and from
  a happy-path hit.
- `[unit]` Given every id resolves, when normalized, then the result carries NO
  `not_found` key (the `messages` key is omitted server-side on full success —
  `catalog.ts:88-91`; the tool surfaces its absence as no `not_found`).

**Input validation — at least one id required**

<!-- architect note: the non-empty-ids rule has TWO enforcers, NOT in conflict. The tool
owns a cheap client-side guard for an obviously-empty `ids` (UX + saves a round-trip);
sil-api's schema (`CatalogLookupRequest.ids` `minItems: 1`) is the authoritative
backstop, rejecting an empty body with a Fastify schema-validation 400. NOTE this is a
SCHEMA 400, not the search-only `empty_search_input` SourceError (that code maps via
`sourceErrorToHttp` and does not apply to lookup). -->

- `[unit]` Given a request with an empty `ids` array (or no `ids`), when
  `sil_product_get` runs, then it returns a structured validation error naming the
  missing input ("provide at least one product or variant id") and makes NO network call
  (the client-side guard; sil-api's `minItems:1` schema 400 is the backstop if a body
  slips through).

**Error envelopes carry a distinct recovery hint per class**

- `[unit]` Given the user is not registered (no stored credentials — `readTokens()` is
  null), when `sil_product_get` runs, then it returns `status: "not_registered"` with a
  message and `recovery: "sil_register"`, making ZERO network calls (mirrors
  `sil_whoami`'s not-registered path).
- `[integration]` Given sil-api responds `401` (dead session — the auth preHandler
  rejects an unauthenticated request before the handler, `catalog.ts:5-8`), when
  `sil_product_get` runs against the real wiring, then it returns a structured re-register
  error (recovery `sil_register`), not a crash and not a false-green. (Single round-trip —
  no transparent refresh-and-retry choreography; see the open question, matching the
  sibling card's scope decision.)
- `[integration]` Given sil-api fails for a transport/source reason (500
  `source_unavailable` with `{ error, message }`, a network error, or a timeout), when
  `sil_product_get` runs against the real wiring, then it returns a structured transient
  error (`status: "retryable"`) guiding the agent to try the lookup again, and it does NOT
  emit `recovery: "sil_register"` — a DISTINCT envelope from both the `401` outcome and
  the `not_found` business outcome.
- `[unit]` Given a network error / timeout from `fetch`, when `sil_product_get` runs,
  then it returns `retryable` AND the access token never appears in any log line or in
  the result (the never-log-the-token invariant).

**Self-enforcing registration + stub-free**

- `[integration]` Given the tool is added, when the manifest-contract drift guard runs
  (`codeRegisteredNames()` already calls `registerCatalogTools(api)` once search lands, so
  the new name is picked up automatically), then `sil_product_get` appears in
  `openclaw.plugin.json#contracts.tools` AND is registered by `register()` — the
  set-compare passes in both directions.
- `[integration]` Given the work is taken to done, when the exercised path is inspected,
  then it contains no stub: the integration suite drives the real
  `POST <silApiUrl>/catalog/lookup` pipeline and asserts the real normalized
  `SilCatalogProduct`/`CatalogLookupResult` shape (products + `not_found` info messages),
  never a `{ stub: true }` placeholder (`complete-work-is-stub-free`).

### Open questions (if any)

<!-- product-owner: none blocking. Documented assumptions below; founder may override. -->

None blocking. Defensible assumptions recorded inline — In Dev should confirm against the
merged sil-api `/catalog/lookup` contract (`@sil/schemas` `catalog.ts`, sil-api
`handlers/catalog.ts`), not re-litigate:

- **ASSUMPTION — sil-api returns the UCP envelope; the tool does the rich projection
  client-side.** Confirmed against the merged code: `/catalog/lookup` returns
  `buildEnvelope('catalog', …, CatalogLookupResult)` where `result = { products:
  SilCatalogProduct[], messages? }` (`catalog.ts:213-235`, `@sil/schemas`
  `catalog.ts:456-467`). The tool unwraps `result`, projects each product to its rich
  agent-facing subset, picks the featured (first) variant, and maps `result.messages`
  (the `not_found` info entries) to a `not_found: [<ids>]` list. The agent-facing contract
  above is unchanged regardless; this only fixes *where* the projection happens
  (client-side, like the sibling search tool).
- **ASSUMPTION — `not_found` ids come from `result.messages` filtered to
  `code === "not_found"`, `content` is the id.** Confirmed: sil-api emits exactly
  `{ type:"info", code:"not_found", content:<id> }` per unresolved id, in input order,
  `messages` omitted on full success (`catalog.ts:88-91`). The tool projects `content` →
  the `not_found` list. (Should a response ever carry other message codes — a UCP
  `warning`/`delayed_fulfillment` — the tool surfaces only `not_found` here; broader
  message passthrough is out of scope for SC2, additive later.)
- **ASSUMPTION — `availability` is the `{ available?, status? }` object, passed through.**
  Confirmed (`@sil/schemas` `catalog.ts:113-122`). Do NOT flatten to a boolean — `status`
  is actionable signal for a purchase decision.
- **ASSUMPTION — the tool forwards `ids` as given; sil-api owns dedup + any batch cap.**
  UCP: dedup is mandatory and a batch cap is optional with a `request_too_large` 400
  (`lookup.md`). sil-api's seam already dedups (`catalog.ts:80`). The tool enforces only
  the one cheap client-side invariant it owns — a non-empty `ids` array — and trusts
  sil-api for the rest. (Confirm whether sil-api enforces a max batch size in Dev; if it
  does and returns a `request_too_large` 400, that maps to an `invalid_request`-style
  envelope, distinct from the transient/source-failure path. Not expected to block SC2.)
- **ASSUMPTION — `filters`/`context` are NOT part of this tool's agent-facing input.**
  `CatalogLookupRequest` allows optional `filters`/`context` (`@sil/schemas`
  `catalog.ts:348-361`), but the card's simplified contract is `{ ids: string[] }` only —
  consistent with "the agent fills no defaults and builds no envelope." Filter-narrowed
  lookup is additive, not SC2. The tool sends `{ ids }`.

**Genuinely open (recommendation made, not a blocker — founder may override):**

- **401 handling depth — recommend PARITY with the sibling `sil_search` decision.**
  `sil_whoami` does a transparent refresh-and-retry-once on 401; the sibling
  `sil-search-plugin-tool` Discovery scoped search to a SINGLE round-trip (terminal
  re-register hint, no refresh choreography) as the simplest thing that ships, flagging
  refresh-parity as an additive follow-on. **Product recommendation: `sil_product_get`
  should match `sil_search` exactly** — single round-trip, terminal re-register on 401.
  Rationale: the two catalog tools are siblings an agent uses back-to-back; a uniform
  auth-recovery UX across them is the right product behavior, and if the founder later
  wants transparent refresh it should land on BOTH catalog tools together (one follow-on
  card spanning the `registerCatalogTools` group), not diverge between them. Tagged into
  the AC above; signal raised below. NOT blocking. (solutions-architect: confirm this
  matches whatever the sibling card finally shipped — they were in stand-by at the time
  of this writing.)

*solutions-architect — technical resolutions against the merged `/catalog/lookup` contract
(the PO assumptions above are confirmed against the code; these add the technical
corrections, so Dev does not re-litigate):*

- **Endpoint RESOLVED — bare `/catalog/lookup` on `getSilApiUrl()`, NOT
  `/api/v1/catalog/lookup`.** The Intent + Epic-notes are WRONG (identically to the search
  card). sil-services `services/sil-api/src/handlers/catalog.ts:213-214`; handler doc line
  15. Same origin as identity/search; `sil_api_base` config key (config.ts:14-17,79). NOT
  sil-web's `getApiUrl()`.
- **Wire-type source RESOLVED — `@sil/schemas` `catalog.ts`, NOT `@ucp-js/sdk`.** The card
  pins the SDK; it has zero catalog types. Re-declare the read-subset locally + narrow
  defensively (mirror `extractIdentity`, sil-client.ts:340-357). Do NOT add the cross-repo
  `@sil/schemas` dep.
- **Operation RESOLVED — `lookup_catalog` / `POST /catalog/lookup` (batch), NOT UCP
  `get_product`.** sil-api implements only `/catalog/lookup` (no `/catalog/product`).
- **401 parity CONCUR.** I concur with the PO's parity recommendation: single round-trip,
  terminal re-register on 401, matching `sil_search`'s scoped decision — no transparent
  refresh choreography in SC2. If the founder wants refresh parity it lands on BOTH catalog
  tools together (one follow-on across the `registerCatalogTools` group). At rebase, confirm
  this matches what the sibling card actually shipped (it was in stand-by at this writing —
  signal raised below). NOT blocking.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**DEV IS GATED ON [[sil-search-plugin-tool]] MERGING.** Do not start until search is on
`main`. The shared `registerCatalogTools` group and the catalog sil-client helpers this
card builds on are created by search and do NOT exist on `main` yet (verified). Rebase
this card's branch onto merged `main` FIRST, then reconcile the symbol names below against
search's ACTUAL landed code (search's discovery PLANNED `searchCatalog` /
`classifySearchResponse` / `SearchOutcome` / `extractSearchResult` / `registerCatalogTools` /
`registerSearch` — treat those as the expected names but VERIFY at rebase; see Signals to
orchestrator). The orchestrator gates dev; `stand-by` is the correct resting state.

**Product-owner's behavioral guidance (carried forward):** endpoint `POST <silApiUrl>/catalog/lookup`
(bare path, sil-api origin), body `{ ids }`; mirror the sibling `sil_search` tool's shape
exactly (same `registerCatalogTools` group, same thin-client + classify pattern as
`identity.ts`). The single most important product invariant: **unfound ids are a SUCCESS
(`status:"ok"` + `not_found:[…]`), never an error and never a recovery hint** — only
not-registered/401 and source/transport failure are errors, with DISTINCT hints
(re-register vs try-again). Surface the `inputs` correlation per variant and the full
`availability` object; return the rich product subset (description, options, etc.), not
search's lean six. Always live-fetch; never cache (freshness is the reason this tool exists).

**Where to start (expert-developer), after rebase onto merged search:**

1. **`src/lib/sil-client.ts`** — add, alongside search's catalog helpers:
   - `lookupCatalog(silApiUrl, token, ids: string[])` — `POST` to
     `` `${stripTrailingSlash(silApiUrl)}/catalog/lookup` `` (BARE) with body `{ ids }` and
     the `Authorization: Bearer <token>` header, via the shared `postJson`. Catch
     network/abort → `retryable`. Origin is `getSilApiUrl()`, resolved by the caller and
     passed in (mirror `fetchIdentity`/`searchCatalog`).
   - exported pure `classifyLookupResponse(status, body)` → `LookupOutcome`
     (`ok` / `unauthorized` / `invalid_request` / `retryable`). Branch on status; for 200
     call `extractLookupResult` and gate `ok` on a usable `products` array.
   - `LookupOutcome` discriminated union (model on `IdentityOutcome`/`SearchOutcome`). The
     `ok` variant carries `{ products, not_found }`.
   - local `extractLookupResult(body)` read-subset normalizer: `asRecord` → `result` →
     `Array.isArray(products)` (else null → retryable) → per product, pick the first
     variant, project the rich subset (`id`,`title`,`description`,`categories?`,`price_range`,
     `source`,`handle?` at product level; `id`,`title`,`price`,`availability`(object),
     `checkout_url`,`sku?`,`options?`,`inputs?` at variant level); parse `not_found` ids
     from `result.messages` (entries whose `code === 'not_found'`; `content` is the id).
     Reuse `asRecord`, `readJsonBody`, `stripTrailingSlash`, `REQUEST_TIMEOUT_MS`,
     `postJson`. No `any`, no unchecked `as`.
2. **`src/tools/catalog.ts`** — add `registerProductGet(api)` and call it from
   `registerCatalogTools(api)` (a second call after `registerSearch(api)`).
   `parameters: Type.Object({ ids: Type.Array(Type.String(), { minItems: 1 }) })`.
   `execute(callId, { ids })`: client-side guard (reject empty `ids` with a structured
   validation result, no network) → `readTokens()` (null → `notRegistered()`) →
   `lookupCatalog(getSilApiUrl(), token, ids)` → map `LookupOutcome` → `jsonResult`. Reuse
   the distinct-envelope helper style (`notRegistered`/`mustReregister`/`transient`/an
   `invalidRequest`; an `ok` carrying `{ products, not_found }`).
3. **`openclaw.plugin.json`** — add `"sil_product_get"` to `contracts.tools`. Extend the
   `security.packagingNote` prose to mention the catalog lookup read if search did not.
4. **`src/index.ts`** — likely NO change (`registerCatalogTools(api)` already wired from
   search; adding a tool to an existing group needs no `register()` edit). Confirm.

**Constraints:**

- Endpoint is bare `/catalog/lookup` on `getSilApiUrl()` (NOT `/api/v1`, NOT `getApiUrl()`).
- Implement `lookup_catalog` (batch), NOT `get_product` (single-resource). sil-api has no
  `/catalog/product`.
- Strict TypeScript, **no `any` at the boundary** — narrow the untrusted JSON body
  defensively (no unchecked `as`); mirror `extractIdentity`.
- Do NOT depend on `@sil/schemas` or `@ucp-js/sdk` — re-declare the read-subset locally.
- `register()` stays synchronous, opens nothing — all I/O in `execute`.
- Tokens / Bearer header never logged, never in the result.
- No defaults, no `filters`/`context`, no UCP envelope built client-side — send `{ ids }`.
- `not_found` misses are partial-success DATA on the `ok` result, NEVER an error.
- No `pagination`/`cursor` on the lookup response — it is a batch resolve, not a list.
- 401 → single round-trip terminal re-register (no transparent refresh in SC2; parity with
  search).
- **Real tool, not a stub** — no `stubResult` on the path; de-stub on touch.

**Test strategy (qa-developer owns RED first):**

- **Auth is real — NO dev bypass.** No `AUTH_DEV_BYPASS`/dev-token; the tool sends the
  stored Bearer token. Seed a real-shaped token pair via the `seedTokens(...)` pattern
  (`whoami.integration.test.ts:202-211`). Prod/dev switches on `NODE_ENV` only; a
  bypass-based test is fail-closed rejected.
- **Unit tier:** `vi.spyOn(globalThis, "fetch")`. Assert param→request mapping (URL is the
  bare `/catalog/lookup`, sil-api origin, Bearer header, body `{ ids }`) and the pure
  `classifyLookupResponse` over every documented status/body in isolation (it is exported
  and pure, like `classifyIdentityResponse`). Cover: the rich projection incl. `inputs` and
  the `availability` object; the anti-false-green 200-no-`products`-array case → `retryable`;
  the genuine all-missed 200-empty-products-with-messages case → `ok` + full `not_found`;
  the every-id-resolved case → no `not_found` key; the not-registered zero-network case;
  the empty-`ids` client-side-guard no-network case; the never-log-the-token assertion on a
  network error.
- **Integration tier:** drive the REAL `registerCatalogTools` + REAL `sil-client` with a
  URL-routing `fetch` double — clone the `installRouter` recorder from
  `whoami.integration.test.ts:122-193`, routed on `/catalog/lookup`. The happy-path mock
  MUST return the **real lookup envelope shape** so the suite is anti-false-green (cannot
  pass against a `{ stub: true }` echo):
  ```
  { protocol:"ucp", version:"0.1", domain:"catalog",
    result: { products: [{ id, title, description, price_range, source,
      variants: [{ id, title, price, availability:{available:true}, checkout_url,
        inputs:[{ id:"<requested-id>", match:"featured" }] }] }],
      messages: [{ type:"info", code:"not_found", content:"<unknown-id>" }] } }
  ```
  Assert: the mixed found+unknown case yields `status:"ok"` with both `products` and
  `not_found`; the all-missed case is `ok` with empty `products` + full `not_found`; the
  three distinct FAILURE outcomes (401 re-register; 400 invalid_request; 500/network
  retryable) surface as distinguishable envelopes; the access token is sent on the read but
  never appears in `logBlob(api)` (`whoami.integration.test.ts:220-229`).
- **Manifest drift guard:** NO test edit expected — `codeRegisteredNames()` already calls
  `registerCatalogTools(api)` once search lands; the new `sil_product_get` name is picked up
  automatically once it is in the manifest. Verify the call is present after rebase; if
  search structured the group differently, reconcile.
- **No e2e/host-load tier** in this repo (`tiers:` excludes `e2e`); the true live-sil-api
  cross-service guarantee is deferred to sil-stage (goal SC9), as whoami's and search's were.

## In Dev — expert-developer, qa-developer

**Implemented exactly to the Discovery handoff — every assumption confirmed against
source before coding.** Search (PR #8) had merged into this card's base when dev
began, so no rebase/symbol-reconciliation was needed; the planned names
(`searchCatalog` / `classifySearchResponse` / `SearchOutcome` / `extractSearchResult`
/ `registerCatalogTools` / `registerSearch`) all matched the landed code. The four
Discovery resolutions held: bare `/catalog/lookup` on `getSilApiUrl()` (NOT
`/api/v1`, NOT sil-web); wire shape from `@sil/schemas` `catalog.ts` re-declared
locally (no cross-repo dep); `lookup_catalog` batch semantics (sil-api has no
`/catalog/product`); 401 = single round-trip terminal re-register (parity with
search). No `pnpm` deps added.

**`src/lib/sil-client.ts` (the shared client — EXTENDED, reusing search's primitives):**
- `lookupCatalog(silApiUrl, token, ids)` — `POST <silApiUrl>/catalog/lookup` body
  `{ ids }` (only), Bearer header, via the shared `postJson`; catch → `retryable`.
  Mirrors `searchCatalog` exactly; reuses `postJson` / `readJsonBody` /
  `stripTrailingSlash` / `REQUEST_TIMEOUT_MS` unchanged.
- `classifyLookupResponse(status, body)` — exported pure classifier → `LookupOutcome`,
  modelled on `classifySearchResponse`. Same four classes (`ok` / `unauthorized` /
  `invalid_request` / `retryable`) so the two catalog tools share ONE error
  vocabulary. Two deltas from search, both handled here: NO `cursor` (lookup is a
  batch resolve, not a list) and a `not_found` id list parsed from the server's
  `not_found` info `messages`. Reuses `extractApiError` for the 400 path.
- `extractLookupResult(body)` — read-subset normalizer: unwrap envelope `result` →
  `Array.isArray(products)` anti-false-green gate (a 200 with no usable products
  array → null → `retryable`; an empty array WITH `not_found` → valid all-missed
  `ok`) → per product pick the FIRST (featured) variant → project the RICH subset →
  parse `not_found` from `result.messages` (`code === "not_found"`, `content` is the
  id, in server order). Reuses `extractPrice` / `extractAvailability` / `asRecord`.
- New rich projection helpers: `projectLookupProduct` / `projectLookupVariant`
  (richer than search's — add `description`, `categories?`, `handle?` at product
  level; `sku?`, `options?`, and the lookup-only `inputs?` at variant level),
  `extractInputs` (correlation: required `id`, optional `match`), and
  `passThroughObjects` (see the design note below). Optional fields are OMITTED when
  absent, never emitted as `undefined`.
- New locally-declared read-subset types: `LookupInput`, `LookupVariant`,
  `SelectedOption`, `LookupProduct`, `LookupResult`, `LookupOutcome`. No `@sil/schemas`
  / `@ucp-js/sdk` dep (per `docs/decisions/sil-shared-catalog-client.md`).

**`src/tools/catalog.ts` (the tool — added to the existing group, NO new group):**
- `registerProductGet(api)` added as a SECOND call inside `registerCatalogTools`
  (the slot Discovery + search reserved). `parameters: Type.Object({ ids:
  Type.Array(Type.String(), { minItems: 1 }) })`. `execute` flow mirrors `sil_search`:
  not-registered (zero network) → client-side empty-`ids` guard (zero network) →
  `lookupCatalog` → map `LookupOutcome`. New tool-local helpers: `readIds` (drops
  non-strings defensively), `lookupResult` (spreads the `ok` payload incl.
  `not_found`), `invalidIds`.
- **Refactored the three shared envelope helpers** (`notRegistered` / `mustReregister`
  / `transient`) to take a `tool` name parameter, so each tool's message is
  actionable ("call sil_product_get again") while the `status`/`recovery` TAXONOMY
  stays shared — search's three call sites now pass `"sil_search"`. This is a genuine
  3rd-use abstraction (both tools need their own retry-tool name), not premature; it
  also keeps the deliberate split as rich-vs-lean FIELDS, not a divergent error
  vocabulary (per the shared-catalog-client decision doc).

**`openclaw.plugin.json` (step 3 — the load-bearing one):** added `"sil_product_get"`
to `contracts.tools`; extended `security.packagingNote` to note both catalog tools'
read (read-only, no token write, no timer, single round-trip). `register()` in
`src/index.ts` needed NO change (the `registerCatalogTools` call already exists from
search; a tool added to an existing group needs no `register()` edit).

**Test approach (qa-developer, RED-first; I made GREEN without touching tests):**
QA landed FOUR files: `lib/lookup-classify.test.ts` (the pure classifier + rich
projection + the unfound-is-success + anti-false-green gate),
`lib/lookup-client.test.ts` (the `lookupCatalog` request construction — bare path,
`{ ids }` verbatim, Bearer, retryable-on-throw, no-leak), `tools/product-get.test.ts`
(registration shape, client-side guard, not-registered short-circuit, token-log
canary, anti-false-green happy path), and `catalog-lookup.integration.test.ts` (the
full wired pipeline — real `registerCatalogTools` + real `sil-client` + a live-shaped
URL-routing `fetch` double cloned from the search integration suite: the
unfound-is-success arms, the three-distinct-FAILURE-outcomes taxonomy, the rich
projection + `inputs` correlation, and the token-never-leaks canary). QA also added a
`sil_product_get` row to the manifest-contract drift guard. All anti-false-green
(happy paths assert the real normalized `SilCatalogProduct`/`CatalogLookupResult`
shape — products + `inputs` + `not_found` — cannot pass against `{ stub: true }`).
**Final: 366 tests / 28 files, all green**, including the manifest-contract drift
guard and the full pre-existing search/whoami/identity suites (confirming the
shared-helper parameterization did not regress search).

**Process note (mid-flight race, resolved):** QA was writing test files concurrently
with my GREEN runs; one full-suite run mid-write showed transient failures (a
half-written `not_found` fixture and a manifest momentarily mid-edit). Confirmed each
was a race, NOT a code defect, by isolating both the 401→`unauthorized` path and the
`not_found` parse path with direct `tsx` probes against the live `src/` modules — both
correct in isolation. The settled full suite is 366/366 green.

### → Handoff to Review (next agent: code-quality-guardian)

**The one non-obvious design call — `passThroughObjects` for `categories`/`options`.**
QA's `lookup-classify.test.ts` fixture used `categories: [{ name: "Office Furniture" }]`
and asserts it passes through verbatim. The authoritative `@sil/schemas` `Category` is
actually `{ value, taxonomy? }` (no `name` field — QA's fixture copied the *option*
shape). My first cut *narrowed* categories by requiring `value` and dropped QA's
fixture (the only test that failed on the first run). I did NOT weaken the test —
instead I recognized the deeper issue: `categories` and a variant's `options` are
**contextual display data**, not purchasability gates (the gates are `checkout_url` +
`price`). The pattern-consistent, production-grade fix is **opaque pass-through** —
filter to plain objects, never read or remap inner fields — exactly how identity
`addresses` pass through (`extractIdentity`: "addresses pass through OPAQUE … never
reads or remaps individual fields"). Under opaque pass-through both `{ value }` (the
real wire shape) and `{ name }` (QA's fixture) survive identically, so the fix is
correct for the REAL contract AND makes the test green honestly. `inputs` keeps a
light `id` gate (an input entry without an `id` is useless for correlation — the
correlation contract genuinely needs it). Worth a look: confirm you agree
contextual-data fields should pass through rather than be schema-narrowed by the
plugin (the plugin is a thin transport client; the source owns the field shapes).

**Deliberate trade-offs / things to check:**
- **Shared-helper parameterization** (`notRegistered`/`mustReregister`/`transient` now
  take a `tool` arg). Touches search's call sites — verify the search suite still
  passes (it does) and that you agree this is the right factoring vs duplicating the
  three helpers per tool. The alternative (per-tool copies) would diverge the message
  text and risk the two tools drifting; one shared taxonomy + a name param is the
  production-grade choice and matches the no-divergent-error-vocabulary constraint in
  `docs/decisions/sil-shared-catalog-client.md`.
- **`LookupProduct.variant` is singular (nested), mirroring search's `SearchProduct.variant`.**
  `lookup_catalog` returns ONE featured variant per product, so a single nested
  `variant` (not a `variants[]`) is the right shape and keeps structural parity with
  search. The rich-vs-lean split is in the FIELDS, not the envelope structure.
- **`price_range` is typed `unknown` and passed through** (the tool surfaces it for the
  agent's purchase decision but does not interpret the min/max — consistent with the
  opaque-pass-through stance for non-gating fields). It IS gated to a plain object
  (`asRecord` non-null) so a product missing it is dropped, like search drops a
  variant missing `checkout_url`.

**No stubs on the exercised path** (`complete-work-is-stub-free`): `sil_product_get`
returns real `jsonResult` data through the real `lookupCatalog` pipeline; no
`stubResult` anywhere in the path. The anti-false-green gates (`Array.isArray(products)`
+ the per-product/variant projection null-drops) make a stub/garbage 200 fall to
`retryable`, never a false `ok`.

## Review round 1 — code-quality-guardian

**VERDICT: PASS** (no blocking findings; two P3 notes for the distiller/future, neither gates merge).

Reviewed against PR #9's diff (`git diff origin/main...HEAD`): `src/lib/sil-client.ts`
(+364/-0 — a PURE ADDITION), `src/tools/catalog.ts`, `openclaw.plugin.json`, and the
four new test suites + the manifest-contract guard row.

**Authoritative local gate (no CI on this repo) — GREEN:**
- `pnpm typecheck` → clean (`tsc --noEmit`, zero diagnostics).
- `pnpm build` → clean (`tsc -p tsconfig.build.json`).
- `pnpm test` → **28 files / 366 tests passed**, exactly as the In Dev handoff claimed.
  Includes the manifest-contract drift guard and the full pre-existing
  search/whoami/identity suites — confirming the shared-helper `tool`-parameterization
  did NOT regress search.

**The two flagged design calls — both CORRECT, pattern-consistent, not gaps:**

1. **Opaque pass-through (`passThroughObjects`, sil-client.ts:983-989) for
   `categories`/`options`.** This is the right call for a thin transport client, NOT a
   leaked-shape correctness gap. It genuinely mirrors the established identity
   `addresses` opaque pass-through (sil-client.ts:155-170 — "addresses pass through
   OPAQUE … never reads or remaps individual fields"), filtering to plain objects and
   forwarding verbatim. `categories`/`options` are contextual display data, not
   purchasability gates — the gates are `checkout_url` + `price`, which ARE narrowed and
   null-drop the product/variant when absent (projectLookupVariant:951-957). The deeper
   correctness point: the authoritative `@sil/schemas` `Category` is `{ value, taxonomy? }`,
   so narrowing on a guessed inner field name would silently drop real wire data — opaque
   pass-through is the production-grade choice and survives both the real `{ value }` shape
   and any drift. The WHY is captured inline (sil-client.ts:975-982). `inputs` correctly
   keeps a light `id` gate (an input without an `id` is useless for correlation —
   extractInputs:997-1010). Agree with the implementer's stance.

2. **`tool`-parameterization of the three shared envelope helpers (`notRegistered` /
   `mustReregister` / `transient`, catalog.ts:333-383).** Genuine 3rd-use consolidation
   (search's 3 call sites + product_get's 3 call sites), NOT premature abstraction. It
   honors the explicit no-divergent-error-vocabulary constraint in
   `docs/decisions/sil-shared-catalog-client.md` — the `status`/`recovery` taxonomy stays
   shared while each message names the right retry tool ("call sil_product_get again"). The
   alternative (per-tool copies) would risk the two sibling tools' error text drifting. Each
   message stays actionable per class (re-register vs try-again vs fix-input), and the
   distinct-hint discipline is preserved. Search's 3 call sites correctly pass `"sil_search"`
   and the search suite stays green. Right factoring.

**Enforcement checklist — all clear:**
- **Type safety:** no `any`, no `as any`, no `@ts-ignore`/`@ts-expect-error`, no
  eslint-disable anywhere in the new code. The untrusted wire body is narrowed defensively
  through `asRecord` + per-field `typeof` gates (mirrors `extractIdentity`); the locally
  re-declared read-subset types carry the contract. `tsc --noEmit` strict clean.
- **Security (token-never-logged):** verified by canary AND by scan. No `logger.*` call
  references token/access/bearer/authorization/refresh. Canaries assert the token absent
  from the result, every log level, and the request body — on success, 401, and
  network-error paths (product-get.test.ts:257-305; lookup-client.test.ts:213-228;
  catalog-lookup.integration.test.ts:669-714). The Bearer header is built inside
  `lookupCatalog` and travels only on the outbound request, never into the returned union.
- **Fail-loud / structured errors, no silent swallowing:** the `try/catch` around `fetch`
  maps network/abort to `retryable` (the union's explicit transient class), never swallows.
  Four distinct outcome classes; the `switch` over `LookupOutcome.kind` is exhaustive (no
  `default`, all four arms present — relies on strict exhaustiveness). Structured `info`
  logs use snake_case event names + key-value pairs and correctly do NOT log expected error
  conditions at `error` level (per the `code-logging` skill).
- **Anti-false-green / stub-free:** `classifyLookupResponse` gates `ok` on envelope unwrap
  AND `Array.isArray(result.products)` (sil-client.ts:498-509, extractLookupResult:872-888)
  — a 200 carrying the skeleton `{ stub: true }` shape, or any no-products-array body, falls
  to `retryable`, never a false `ok`. Directly asserted (lookup-classify.test.ts:358-407;
  integration `not.toContain('"stub"')` at :367). The all-missed success (`products:[]` +
  full `not_found`) is correctly distinguished from the no-array fault by PRESENCE, never
  length. No `stubResult` on the exercised path. Honors `complete-work-is-stub-free`.
- **Reuse, not duplication:** `sil-client.ts` is +364/-0 — a pure addition; NONE of search's
  shared primitives or classifiers were modified. Lookup correctly reuses `postJson` /
  `readJsonBody` / `stripTrailingSlash` / `REQUEST_TIMEOUT_MS` / `asRecord` / `extractPrice`
  / `extractAvailability` / `extractApiError`, and gets its OWN thin classifier + extractor
  (the right call — lookup has no `cursor` and does have `not_found` + `inputs`). Matches
  `docs/decisions/sil-shared-catalog-client.md` exactly.
- **No hardcoded values:** origin from `getSilApiUrl()`; the only path literal is the route
  suffix `/catalog/lookup` (the API contract per `sil-two-origin-model`, not config); the
  timeout is the shared named const `REQUEST_TIMEOUT_MS`; the only numeric literals are HTTP
  status codes in the classifier (protocol constants, the standard-idiom exception).
- **Complexity/bloat:** longest new function ~24 body lines, linear straight-line narrowing,
  cyclomatic well under 10, nesting ≤ 2. Every helper is single-responsibility. No dead
  code, no over-abstraction, no legacy/back-compat shims.
- **Architecture:** correct dependency direction (no cross-repo `@sil/schemas` / `@ucp-js/sdk`
  dep, read-subset re-declared locally), no circular deps, classify-on-body-shape honored
  (`docs/knowledge/sil-response-classification.md`). `register()` stays synchronous and opens
  nothing; all I/O in `execute`.
- **Manifest contract:** `sil_product_get` added to `contracts.tools` (alphabetical),
  `packagingNote` accurately extended to cover both catalog reads; the drift guard's new
  by-name assertion (manifest-contract.integration.test.ts:132-142) passes both directions.
- **Knowledge capture:** the two non-obvious calls carry inline WHY comments AND are recorded
  in the In Dev "→ Handoff to Review" block for the distiller to lift; both are already
  governed by existing decision/knowledge docs. No capture gap.

**P3 (non-blocking, for the distiller / a future touch — neither gates this PR):**
- **P3 — `callId` not threaded into the structured logs.** `execute(_callId, …)` discards
  the host-supplied `callId`; the `info` logs carry no correlation id. The `code-logging`
  skill lists `request_id`/correlation id as a high-cardinality field to include WHEN
  available, and it IS available here. This MATCHES the pre-existing `sil_search` /
  `sil_whoami` pattern, so it is a repo-wide consistency item, not a regression introduced by
  this card — best addressed once across all tools, not in a per-tool divergence. No fix
  required for merge.
- **P3 — pre-existing `extractAvailability` emits explicit `undefined` keys**
  (sil-client.ts:1048-1057) for absent `available`/`status`, whereas the new lookup
  projection omits absent optionals. This is SEARCH's helper, reused unchanged (0 lines of it
  in this card's diff), so it is out of scope here; flagging only so a future catalog touch
  can align the two conventions. Not a defect — the object still passes through and the agent
  reads the present fields.

This is production-grade. No rework needed; advancing to distilling.

## Distillation — solutions-architect

Searched `docs/decisions/INDEX.md` + `docs/knowledge/INDEX.md` (greps: catalog, lookup,
not_found, opaque, pass-through, availability). The sibling `sil_search` card (PR #8)
already distilled this area; **edited the two existing docs rather than creating new
ones** — no new docs were justified. Inline WHY was already exhaustive in the diff
(`passThroughObjects`, `classifyLookupResponse`, the all-missed-vs-garbage discriminator,
`extractInputs`, the four-class taxonomy parity all carry full site comments — confirmed
against `git diff origin/main...HEAD`), so no code edits were needed.

- **knowledge/sil-api-catalog-contract.md — EXTENDED** (was search-only → now covers BOTH
  catalog reads): added a `POST /catalog/lookup` section pinning the non-obvious lookup
  contract a future catalog card needs — bare path + `{ ids }` body; misses as `not_found`
  info `messages` (omitted on full success) being a SUCCESS not an error; the load-bearing
  `inputs:[{id,match}]` correlation (response is NOT in request order); empty-`ids` being a
  Fastify SCHEMA 400, NOT search's `empty_search_input` SourceError; the all-missed-200 =
  `ok` discriminated by `products`-array PRESENCE not length. Broadened the title + the
  `/api/v1` wrong-boilerplate note to both routes (SC2 inherited the identical wrong
  boilerplate, confirming the propagation hazard). Bumped `commit`/`updated_at`/`updated_by_card`.
- **decisions/sil-shared-catalog-client.md — EXTENDED**: (1) a "what SC2 reused vs added"
  section recording that the design held (sil-client.ts was +364/−0, lookup got its OWN
  classifier/extractor correctly, the 3rd-use `tool`-param of the envelope helpers); (2) a
  reusable **narrow-vs-pass-through rule** for projection helpers — narrow only the
  purchasability/identity GATES, pass contextual display data through OPAQUE; the rejected
  alternative (narrow on a guessed inner field) silently dropped real wire data
  (`Category` is `{ value }`, not the `{ name }` the first cut guessed). Bumped
  `commit`/`updated_at`/`updated_by_card`.
- **INDEX.md updated:** knowledge (title + tags refreshed for the lookup coverage), decisions
  (no change needed — title unchanged, already the freshest top row).

**Deliberately NOT captured** (would be over-capture / already recorded): the two P3 review
findings. (1) `callId` not threaded into structured logs and (2) `extractAvailability`
emitting explicit `undefined` keys vs the newer omit-absent convention are BOTH repo-wide,
pre-existing (search's helpers, 0 lines in this diff), derivable from the code, and already
recorded in the Review verdict on this card body — which travels with the card. Manufacturing
a doc for either would be doc churn for a stylistic/consistency item, not a non-obvious gotcha.

## PR Ready

<!-- PR url; founder notification fires here -->

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
