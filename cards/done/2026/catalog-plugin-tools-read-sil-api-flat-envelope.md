---
type: card
title: Catalog plugin tools read sil-api flat envelope
slug: catalog-plugin-tools-read-sil-api-flat-envelope
work_type: bug            # feature | bug | refactor | chore | docs
tiers: [unit, integration]  # subset of [unit, integration, e2e] — set by solutions-architect during Discovery from the acceptance criteria below
status: done              # backlog | discovery | stand-by | in-dev | review | distilling | pr-ready | done | abandoned
agents: []                # current active agent set; updated by each handoff
priority: 1               # 1 = drop-everything, 2 = normal, 3 = nice-to-have
created: 2026-06-10
updated: 2026-06-10
base_branch: main         # the branch this card's worktree was cut from and the PR will target
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-catalog-plugin-tools-read-sil-api-flat-envelope
branch: card/catalog-plugin-tools-read-sil-api-flat-envelope
pr: https://github.com/Context4GPTs/sil-openclaw/pull/13
merged_commit: c62ed5b26917698309c6ec17f37ea8f96b7ad907  # set by /board-tick on PR-merge detection
epic_id: catalog-plugin-tools
origin: goal:agentic-search-slice
---

## Intent (founder)

**Symptom:** `sil_search` and `sil_product_get` return `retryable` against the live stack — an agent gets no search results and no lookup results, even when sil-api responds with real products. (The booted-stack catalog eval in sil-stage RED-flagged this against the *built* artifacts: the projected plugin surface is unreadable.)

**Repro:** boot the full stack and drive `sil_search '{"query":"…"}'` (or `sil_product_get`) through the compiled plugin against a live sil-api with a valid Bearer. Frequency: always.

**Expected vs actual:** *Expected* — the tools return the normalized products from sil-api's catalog response. *Actual* — `extractSearchResult` / `extractLookupResult` require a nested `envelope.result.products`, but sil-api emits a **flat** UCP envelope (`{ ucp, products, pagination }` — products at the top level, no `result` wrapper). The `result === null` guard fires, the extractor returns `null`, and the tool degrades to `retryable`.

**Hypothesis:** `extractSearchResult` (`src/lib/sil-client.ts:884`) and `extractLookupResult` (`:977`) lack the `result ?? envelope` flat-fallback that `extractIdentity` already has (`:809-810`). Give both the same fallback — or drop the nested-`result` expectation entirely, since the flat `{ ucp, ...body }` is the settled sil-api envelope contract (`sil-services/services/sil-api/src/envelope.ts` `withUcpMeta`). No backwards-compat for the dead nested shape. This is a real live-path breakage of `sil_search`/`sil_product_get` (SC1/SC2) and the sole sil-openclaw blocker on the SC10 catalog eval.

**Scope guard — founder steer (2026-06-10):** the fix is in the **unwrap only** (correctly reading sil-api's response). The **agent-facing output stays lean** — the existing `projectProduct` projection to the relevant products/details + `checkout_url` (PRD F1/F2 per-variant `{ id, title, price, availability, checkout_url, source }`) is the **intended design** and must be preserved. sil-api is the UCP simplification layer; **never return the whole UCP envelope to the agent** — that blows up the agent's context window with fields it does not need to reason, pick, and check out. The "drop the nested-`result`" option changes only the unwrap; it must **not** widen what reaches the agent. (If anything, Discovery should confirm the projection carries exactly enough to reason + pick + checkout, no more.)

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

---

## Epic notes (provisional — sibling Discovery owns the verdict)

**Epic:** `catalog-plugin-tools` · **Origin:** `goal:agentic-search-slice` · this restores the live behaviour of `sil_search`/`sil_product_get` (SC1/SC2) and is the **sole sil-openclaw gate** on the SC10 catalog eval (`sil-stage:catalog-relevance-eval`, currently held). Evidence is in that card's `## Signals to orchestrator` (2026-06-10, expert-developer) — verified against the built artifacts, not a paper guess.

**Likely change site (shallow read-only guess — Discovery confirms):**
- `src/lib/sil-client.ts` — `extractSearchResult` (~`:884-889`) and `extractLookupResult` (~`:977-982`): both do `const result = asRecord(envelope["result"]); if (result === null) return null;`. Mirror `extractIdentity` (~`:809-810`): `const result = asRecord(envelope["result"]); const source = result ?? envelope;` then read `products`/`not_found` off `source`. (Or drop the nested-`result` expectation entirely — the flat envelope is the only shape sil-api emits.)
- Contract reference (read-only, sibling): `sil-services/services/sil-api/src/envelope.ts` — `withUcpMeta(body) → { ucp, ...body }`, the flat envelope (`products` at top level, no `result` wrapper).
- **No backwards-compat for the dead nested shape** (`production-grade-first`): replace the expectation, don't keep both paths alive.

**Draft acceptance scenarios (Discovery refines + tier-tags):**
- `[unit]` Given a flat sil-api search envelope `{ ucp, products: [...], pagination }`, when `extractSearchResult` runs, then it returns the products (not `null`).
- `[unit]` Given a flat sil-api lookup envelope `{ ucp, products: [...], not_found: [...] }`, when `extractLookupResult` runs, then it returns the items + `not_found` (not `null`).
- `[unit]` Given a malformed/empty body (no `products` anywhere), when either extractor runs, then it still returns `null` — the fallback widens the accepted shape, it does not swallow genuine errors.
- `[integration]` Given the booted stack with a real Bearer, when `sil_search`/`sil_product_get` are driven, then they return normalized results (not `retryable`) — the live-path regression guard.
- `[unit]` Given a sil-api response (flat envelope), when the tools return to the agent, then the payload is the **lean projected shape** (relevant products/details + per-variant `checkout_url`, PRD F1/F2) — NOT the raw envelope and NOT the full `SilCatalogProduct` (no `categories`/`tags`/`price_range`/non-featured variants leaking through) — the unwrap fix must not widen the agent-facing payload (founder steer: mind the agent's context window).

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — solutions-architect, product-owner

<!-- Filled jointly by product-owner and solutions-architect. -->

### Approach + alternatives ruled out

**Chosen — drop the nested-`result` expectation in both extractors; read `products`/`pagination`/`messages` off the flat envelope body.** sil-api's `withUcpMeta(body) → { ucp, ...body }` is the ONE shape it emits — products at the top level, no `result` wrapper (confirmed in `sil-services/.../sil-api/src/envelope.ts`; the integration fixture that "proved" the nested shape, `catalog-search.integration.test.ts:143-149`, was asserting a contract sil-api never produces). The change is confined to the unwrap: `extractSearchResult` (`src/lib/sil-client.ts:888-889`) and `extractLookupResult` (`:981-982`) stop short-circuiting on `result === null` and read the products array off the envelope directly. The `.map(projectProduct)` / `.map(projectLookupProduct)` pipeline downstream is untouched, so the agent-facing payload cannot widen — the projection is a structural gate, not a passthrough.

- **(a) Mirror `extractIdentity`'s flat-fallback (`const source = result ?? envelope`, `:809-810`) — RULED OUT.** It keeps the dead nested-`result` branch alive as a live code path. `extractIdentity` needs the dual-fallback for a real reason (the identity may arrive enveloped on one route and bare on a follow-on); search/lookup have NO such second route — sil-api always envelopes them flat. Keeping `result ??` here is backwards-compat for a shape that is never emitted, which `production-grade-first` forbids (no v1-and-v2 side-by-side). It also leaves a latent false-green: a malformed future body carrying a stray `result` key would be read in preference to the real top-level `products`.
- **(b) Widen the agent-facing payload (spread the unwrapped envelope, or return the full `SilCatalogProduct`) — RULED OUT (founder steer, binding).** sil-api is the UCP simplification layer; returning the whole envelope or the raw product would flood the agent's context window with `categories`/`tags`/`price_range`/non-featured variants/UCP metadata it does not need to reason, pick, and check out. The lean per-variant projection `{ id, title, price, availability, checkout_url }` nested under a `{ id, title, source, variant }` product (PRD F1/F2) is the intended design and is preserved exactly. This is the regression most worth a test — see the lean-shape criterion below. (Lookup is deliberately RICHER than search — it adds `description`/`price_range`/`categories?`/`handle?` + variant `sku?`/`options?`/`inputs?` for a purchase decision — but it is still a bounded *projection*, never the raw envelope.)
- **Non-additive test fix (corollary of the chosen approach).** The classifier + integration fixtures currently encode the nested `result` shape (`search-classify.test.ts:133`, `catalog-search.integration.test.ts:143`, the `searchCatalog` mock at `search-client.test.ts:81-88`, and the lookup counterparts). These are RE-POINTED to the flat envelope, not added-to — leaving the nested fixtures green beside the flat ones would re-introduce the dead shape the fix deletes.

### Affected files / surfaces

**Production fix (the only behavioural change) — `src/lib/sil-client.ts`:**
- `extractSearchResult` (`:884-900`) — the bug. Drop the unwrap guard `const result = asRecord(envelope["result"]); if (result === null) return null;` (`:888-889`) and read `products` (`:891`) + `pagination` (`:898`) off the flat envelope (`asRecord(body)` itself). **Everything from `:891` down stays verbatim** — the `Array.isArray(rawProducts)` gate, the `projectProduct` map/filter, and `extractCursor`. Per the chosen approach (and `production-grade-first`), this is a *drop*, not a `result ?? envelope` fallback — no dead nested path survives.
- `extractLookupResult` (`:977-993`) — same bug, same fix. Drop `:981-982`; read `products` (`:984`) + `messages` (`:991`) off the flat envelope. **`:984` down stays verbatim** — the array gate, `projectLookupProduct`, and `extractNotFound`. (`extractNotFound` already reads `messages`, the exact top-level key sil-api emits — see contract below.)
- Two stale doc comments must be corrected, not left lying (they are factually wrong about sil-api): `:864-870` ("the products live in the UCP envelope's `result.products`; `result` is required — unlike `extractIdentity` there is NO bare-top-level fallback, because a search response is always enveloped … a top-level `products` would be a malformed body, not an alternate contract") and the lookup mirror `:959-972`. Reword both to state sil-api's flat `{ ucp, products, … }` contract and that the **`Array.isArray(products)` gate** (not a `result` wrapper) is the load-bearing anti-false-green guard.
- `extractIdentity` (`:805-822`, fallback `:809-810` `const source = result ?? envelope`) — **reference pattern, DO NOT TOUCH.** The identity handler also emits flat (`handlers/identity.ts:87`), so its nested-`result` branch is already dead on the live path; its flat fallback is *why* `sil_whoami` works against the live stack today. This is the proof the same flat read is correct for search/lookup. (The chosen approach deliberately does NOT replicate `extractIdentity`'s dual-fallback here — search/lookup have no second route that would ever return a `result` wrapper, so the dead branch is dropped, not carried.)
- `projectProduct` (`:911-928`) + `projectVariant` (`:936-957`) — **MUST NOT CHANGE** (founder scope-steer, binding). The lean agent-facing projection (`{ id, title, source, variant:{ id, title, price, availability, checkout_url } }`, PRD F1/F2) is the intended design. Same for `projectLookupProduct` (`:1006-1040`) / `projectLookupVariant` (`:1050-1078`) — the rich-but-still-bounded lookup projection. The fix is in the **unwrap only**; the agent-facing payload is not widened by one field.
- `classifySearchResponse` (`:459-470`) / `classifyLookupResponse` (`:501-512`) — **no change.** They delegate the unwrap to the two extractors and gate `ok` on a non-null result; fixing the extractor fixes the classifier for free.

**Confirmed-flat sibling contract (read-only — sil-api emits this; the plugin must read it):**
- `sil-services/services/sil-api/src/envelope.ts` — `withUcpMeta(body) → { ucp, ...body }` (`:33-45`). Doc `:9-12`: the envelope is FLAT — body fields (`products`, `pagination`, `addresses`) sit at the top level beside `ucp`, NOT under `result`. **Settled shape.**
- `sil-services/services/sil-api/src/handlers/catalog.ts` — search: `withUcpMeta(toSearchResult(page), …)` (`:236`); `toSearchResult` (`:120-122`) = `{ products, pagination }` → wire `{ ucp, products, pagination }`. Lookup: `withUcpMeta(toLookupResult(outcome), …)` (`:267`); `toLookupResult` (`:130-135`) = `{ products, messages? }` → wire `{ ucp, products, messages? }`. **Misses ride `messages` (not a `not_found` key)** — `extractLookupResult` already reads `messages`, so reading it off the top level Just Works.
- `sil-services/packages/schemas/src/envelope.ts` — `UcpResponse(body) = Type.Object({ ucp, ...body.properties })` (`:105-115`), structurally flat. Doc `:91-93`: "`UcpResponse(CatalogSearchResult)` is `{ ucp, products, pagination?, messages? }`."
- `sil-services/packages/schemas/src/catalog.ts` — `CatalogSearchResult` (`:432-442`) = `{ products, pagination?, messages? }`; `CatalogLookupResult` (`:455-464`) = `{ products, messages? }`. Exact top-level field names.
- `sil-services/services/sil-api/src/handlers/identity.ts` (`:87`) — `withUcpMeta(buildIdentityReadResult(...))` → flat `{ ucp, id, name, addresses }`. Confirms `extractIdentity`'s flat fallback is the live path.

**UCP spec cross-check (read-only):** `vendor/ucp/spec/docs/specification/catalog/search.md` + `lookup.md` — the `search_response` / `lookup_response` `$defs` carry `products`/`pagination`/`messages` at the response level (no `result` wrapper). sil-api conforms; the plugin's nested-`result` expectation never matched the spec either.

**Test fixtures that encode the WRONG (phantom nested-`result`) envelope — ALL must flip to the flat shape (qa-developer owns RED):**
- `src/__tests__/lib/search-classify.test.ts` — `envelope()` helper (`:132-143`) wraps in a `{ protocol, version, domain, request_id, issued_at, enrichment, result }` envelope sil-api **never emits**. Every `it` calls it. The **assertions** (status taxonomy, empty-match-is-success, anti-false-green stub/no-array/non-object `:251-299`, projection `:301-370`, cursor hoist `:372-443`) are correct and must survive verbatim — only the `envelope()` body changes to the flat `{ ucp: { version, status: "success" }, ...result }`.
- `src/__tests__/lib/lookup-classify.test.ts` — same phantom `envelope()` (`:175-184`); flip the wrapper, keep all assertions (unfound-is-success, anti-false-green, rich projection, `inputs` correlation).
- `src/__tests__/lib/search-client.test.ts` (`:81-86`) and `src/__tests__/tools/search.test.ts` (`:93`) — the `fetch` mock replies with the nested `result` shape; flip to flat.
- `src/__tests__/lib/lookup-client.test.ts`, `src/__tests__/tools/product-get.test.ts` — lookup counterparts; flip.
- `src/__tests__/catalog-search.integration.test.ts` (`:149`, `:496`) and `src/__tests__/catalog-lookup.integration.test.ts` (`:162`) — integration fixtures build the nested `result`; flip to flat. **These are the live-path regression guards** — their RED→GREEN is the real proof of the fix.

### Risks / failure modes

- **Regressing the anti-false-green guard (highest risk).** The stale comments at `:868`/`:962` claim the `result`-wrapper requirement IS the anti-false-green guard. It is **not** — the real guard is the `Array.isArray(products)` check (`:892`/`:985`). Dropping the `result` unwrap removes a check that never protected against stubs (sil-api emits `products` at top level by design; a wrapper requirement only ever rejected sil-api's *real* contract). The dev MUST keep `:891`/`:984` downward intact: a `{ stub: true }` / no-`products` / non-array body still returns `null → retryable`. **Mitigation:** the existing anti-false-green `it`s (`search-classify.test.ts:251-299`, lookup mirror) are re-pointed to the flat envelope and must stay GREEN — the stub body, no-`products` key, non-array `products`, and null/non-object body all still classify non-`ok`. If any of those flips to `ok`, the fix over-reached.
- **Widening the agent-facing payload (founder-steer violation).** A lazy fix — `return { ...envelope }` or surfacing the raw `SilCatalogProduct` — would dump `categories`/`tags`/`price_range`/non-featured variants/UCP metadata into the agent's context window. **Mitigation:** `projectProduct`/`projectVariant` (and the lookup pair) are untouched; the dev reads `products` off the flat envelope and feeds the SAME `.map(projectProduct).filter(...)` pipeline. A projection-shape assertion (lean six fields for search, bounded rich set for lookup; NO raw envelope, NO full product) is an acceptance criterion — see the lean-shape criteria.
- **Phantom-contract test fixtures going green against the wrong shape.** Every catalog test currently wraps fixtures in a nested `result` envelope sil-api never emits (`search-classify.test.ts:132-143`, `lookup-classify.test.ts:175-184`, the client/tool/integration fixtures). If the dev fixes the extractor but leaves the fixtures nested, the unit suite breaks (extractor now reads top-level `products`, fixtures hide it under `result`) — RED, as it should be. The trap is the *reverse*: "fixing" the extractor to accept BOTH shapes to keep the old fixtures green. That re-introduces the dead nested path the chosen approach deletes. **Mitigation:** re-point fixtures to the flat shape; do NOT add a dual-shape accept to the extractor.
- **`ucp.status: "error"` arm (out of scope, do not invent).** The UCP get_product spec (`lookup.md:138-144`) describes a `ucp.status: "error"` + `messages` application-error response for a not-found single-product lookup. sil-api's current `/catalog/lookup` (batch) does NOT emit that — misses are `messages` info entries on a `status: "success"` envelope (`handlers/catalog.ts:95-98`, `notFoundMessages`). The fix must NOT start branching on `ucp.status`; that is a separate future contract. Reading `products`/`messages` off the flat body is the whole change.
- **Stubs in the exercised path (`complete-work-is-stub-free`).** None found. The catalog source path is real (`handlers/catalog.ts` → source registry → fixture source); the only "stub" references are the anti-false-green *test inputs* (`{ stub: true }` bodies) that assert a stub-shaped 200 is rejected — those are guards to keep, not stubs to remove. The plugin extractor path is stub-free. No de-stubbing owed on this touch.
- **`pagination` vs `messages` key crossover (low, but worth a guard).** Search's flat body carries `pagination` (no `messages`); lookup's carries `messages` (no `pagination`). After the unwrap moves to the top level, `extractCursor(source["pagination"])` and `extractNotFound(source["messages"])` read the correct keys — but a copy-paste between the two extractors could swap them. **Mitigation:** the cursor-hoist tests (`search-classify.test.ts:372-443`) and the `not_found` tests (lookup) pin each key to its extractor.

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.
-->

- `[unit]` Given a FLAT sil-api search envelope `{ ucp, products: [...], pagination }` (products at the top level, no `result` wrapper), when `classifySearchResponse(200, body)` / `extractSearchResult` runs, then it returns `kind: "ok"` with the projected products — NOT `retryable` (the bug: today the `result === null` guard fires and degrades to `retryable`).
- `[unit]` Given a FLAT sil-api lookup envelope `{ ucp, products: [...], messages: [{ code: "not_found", content: <id> }] }`, when `classifyLookupResponse(200, body)` / `extractLookupResult` runs, then it returns `kind: "ok"` with the projected products and the `not_found` ids — NOT `retryable`.
- `[unit]` Given a 200 body with NO `products` array at the top level (a partial / garbage / `{ stub: true }` body, AND a body carrying only `ucp` metadata), when either extractor runs, then it still returns `null` → `retryable` — the flat read widens the accepted envelope but PRESERVES the anti-false-green guard (it must not treat the `ucp` metadata wrapper, or a missing array, as an empty match). An EMPTY top-level `products: []` remains a VALID empty match → `ok` with an empty list.
- `[unit]` Given a flat sil-api search envelope whose product carries the FULL `SilCatalogProduct` shape (`categories`, `tags`, `price_range`, multiple non-featured `variants`, extra UCP metadata), when `extractSearchResult` projects it, then each returned product is EXACTLY the lean shape `{ id, title, source, variant: { id, title, price, availability, checkout_url } }` and carries NO `categories` / `tags` / `price_range` / additional-variants / raw-envelope keys — the founder's context-window guard: the unwrap fix must not widen the agent-facing payload. (Lookup's parallel projection asserts its deliberately-richer-but-still-bounded shape — `description`/`price_range`/`categories?`/`handle?` + variant `sku?`/`options?`/`inputs?` — and likewise NOT the raw envelope.)
- `[integration]` Given the booted stack with a real Bearer, when `sil_search` / `sil_product_get` are driven against a live sil-api that returns real products, then the tools return `status: "ok"` with the normalized lean products (each with a per-variant `checkout_url`) — NOT `status: "retryable"`. This is the live-path regression guard that restores SC1/SC2 and unblocks the SC10 catalog eval; the fixture/mock envelope MUST be the flat shape sil-api actually emits (re-pointed from the nested `result` fiction), or the guard tests nothing.

### Open questions (if any)

None blocking — the founder steer (lean unwrap only, no payload widening) fully resolves the only design choice. Two non-blocking notes for the dev pair (not founder escalations):
- The existing classifier + integration fixtures encode the dead nested-`result` shape and are green against a contract sil-api never emits (`search-classify.test.ts:133`, `catalog-search.integration.test.ts:143`, `search-client.test.ts:81-88`, + lookup counterparts). Re-point them to the flat envelope rather than adding flat cases alongside — green-against-a-fiction is exactly what `complete-work-is-stub-free` rejects.
- The `classifySearchResponse` / `classifyLookupResponse` JSDoc ("unwrap the envelope `result`", `sil-client.ts:448`/`:485`) and the `extractSearchResult`/`extractLookupResult` doc comments still describe the nested expectation — update them in the same change so the comments don't restate a deleted contract.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**Confirmed root cause.** `extractSearchResult` (`src/lib/sil-client.ts:888-889`) and `extractLookupResult` (`:981-982`) short-circuit on `asRecord(envelope["result"]) === null`. sil-api emits a **flat** UCP envelope (`withUcpMeta(body) → { ucp, ...body }`, `sil-services/.../sil-api/src/envelope.ts:33-45`) — `products` is at the top level, there is no `result` wrapper — so the guard fires on every live response and both tools degrade to `retryable`. Confirmed against the real sibling code (`handlers/catalog.ts:236,267`, `@sil/schemas` `UcpResponse` `:105-115`, `CatalogSearchResult`/`CatalogLookupResult` `:432,455`) and the UCP spec (`catalog/search.md`, `lookup.md`), not the paper hypothesis. `extractIdentity` (`:809-810`) already reads the flat shape via `result ?? envelope`, which is precisely why `sil_whoami` works live and search/lookup don't.

**The precise fix shape (recommended — matches the chosen approach):** in BOTH extractors, **delete** the `const result = asRecord(envelope["result"]); if (result === null) return null;` lines and read `products` (and `pagination` for search / `messages` for lookup) directly off `asRecord(body)`. Do **not** add a `result ?? envelope` fallback — search/lookup have no second route that returns a `result` wrapper, so the nested branch is dead weight and (worse) a latent false-green a stray `result` key could exploit. This is the *narrower* fix the card asked for: it accepts sil-api's real flat shape **without** keeping the never-emitted nested path alive.

**Why it does NOT regress the anti-false-green property:** the `result`-wrapper requirement was never the guard — it only ever rejected sil-api's *real* contract. The actual anti-false-green guard is `if (!Array.isArray(rawProducts)) return null;` (`:892`/`:985`), and it is **untouched**. A `{ stub: true }` body, a body with no `products` key, a non-array `products`, and a null/non-object body all still return `null → retryable` after the fix. Keep everything from `:891`/`:984` downward exactly as-is.

**Where to start (expert-developer):**
1. `extractSearchResult` — drop `:888-889`, read off the flat body, keep `:891`→`:899` verbatim.
2. `extractLookupResult` — drop `:981-982`, read off the flat body, keep `:984`→`:992` verbatim.
3. Correct the now-false doc comments: `:864-870`, `:959-972`, and the two classifier JSDocs ("unwrap the envelope `result`", `:448`/`:485`). State sil-api's flat `{ ucp, products, … }` contract and name the `Array.isArray(products)` gate as the anti-false-green guard. (`production-grade-first`: don't leave a comment restating a deleted contract.)

**DO NOT TOUCH — binding:**
- `projectProduct` (`:911-928`), `projectVariant` (`:936-957`), `projectLookupProduct` (`:1006-1040`), `projectLookupVariant` (`:1050-1078`). The lean/rich projections are the intended agent-facing design (founder scope-steer). The fix is the unwrap only; the payload is not widened by one field. A projection-shape assertion is an acceptance criterion — if a projection function changes, the fix has over-reached.
- `extractIdentity` and the whoami/identity path — out of scope for this card.
- Do NOT branch on `ucp.status` (the get_product `"error"` arm in `lookup.md:138-144` is a separate, future contract sil-api's batch lookup does not emit).

**Test strategy (qa-developer owns RED, sequence qa → expert):**
- The catalog test fixtures currently encode a **phantom nested-`result` envelope** sil-api never emits — `search-classify.test.ts:132-143` (`envelope()` helper), `lookup-classify.test.ts:175-184`, `search-client.test.ts:81-86`, `tools/search.test.ts:93`, `catalog-search.integration.test.ts:149,496`, `catalog-lookup.integration.test.ts:162`, and the lookup client/tool counterparts. **Re-point every one to the flat shape** `{ ucp: { version, status: "success" }, products, pagination?|messages? }`. Do NOT add flat cases *beside* the nested ones — a dual-shape suite would tempt a dual-shape extractor, re-introducing the dead path (`complete-work-is-stub-free`).
- **Keep the assertions verbatim** in the classify tests — the status taxonomy, empty-match-is-success, anti-false-green (stub/no-array/non-object → `retryable`, `:251-299` + lookup mirror), projection (lean six / rich set), and cursor-hoist / `not_found` blocks are all correct; only their envelope *fixture* was wrong. The anti-false-green `it`s staying GREEN after the flip is the proof the fix didn't over-reach.
- **Unit tier** covers criteria 1-4 (flat-envelope `ok`, `not_found` parse, anti-false-green preservation, lean/bounded projection shape) directly on `classifySearchResponse`/`classifyLookupResponse`.
- **Integration tier** covers criterion 5: drive `sil_search`/`sil_product_get` against a flat-envelope sil-api stand-in and assert `status: "ok"` with normalized lean products (each with `checkout_url`), NOT `retryable`. This is the live-path regression guard that restores SC1/SC2 and unblocks the held SC10 catalog eval — its RED→GREEN is the real signal the bug is fixed.
- Run `pnpm typecheck` + `pnpm test`; the suite is unit + integration only (no e2e gate in this repo).

## In Dev — qa-developer, expert-developer

**RED (qa-developer, `5996230`).** Re-pointed every catalog fixture from the phantom nested-`result` envelope to the flat `{ ucp, ...body }` shape (the `envelope()` helpers in both classify tests now spread `result` onto the top level; the integration `searchEnvelope`/`lookupEnvelope` build `products`/`pagination`/`messages` at the top level). All assertions kept verbatim; added 2 AC4 absence tests (exact-key-set projection bound). 55 failing `ok`-path tests, the 10 anti-false-green guards stayed green. Production source untouched.

**GREEN (expert-developer, `d2b6393`) — `src/lib/sil-client.ts`, unwrap only.**
- `extractSearchResult`: dropped `const result = asRecord(envelope["result"]); if (result === null) return null;`; now reads `envelope["products"]` and `envelope["pagination"]` straight off the flat body. Everything from the `Array.isArray` gate down is byte-for-byte unchanged.
- `extractLookupResult`: same drop; reads `envelope["products"]` and `envelope["messages"]` off the flat body. Array gate + `projectLookupProduct` + `extractNotFound` unchanged.
- **No `result ?? envelope` fallback** (deliberate, per Discovery's chosen approach): search/lookup have no route returning a `result` wrapper, so a dual-path would be dead weight and a latent false-green. This is the narrower fix.
- Corrected stale doc comments that described the dead nested contract: the two extractor blocks, the two classifier JSDocs (`classifySearchResponse` / `classifyLookupResponse`), the module-header search/lookup wire-contract blocks, and the `SearchResult` interface doc. All now state sil-api's flat `{ ucp, products, … }` shape and name `Array.isArray(products)` as the anti-false-green guard.

**Untouched (binding scope guards held):** `projectProduct` / `projectVariant` / `projectLookupProduct` / `projectLookupVariant` (agent-facing payload not widened by one field — confirmed by the diff: no projection function appears in it), `extractIdentity` + the whole identity/whoami path (the `result ?? envelope` reference pattern, out of scope), no `ucp.status` branching.

**Verification gate — all clean:** `pnpm typecheck` (0 errors), `pnpm build` (tsc → `dist/`; `dist/lib/sil-client.js` confirmed reading `envelope["products"]` in both extractors, the one remaining `envelope["result"]` is `extractIdentity`), `pnpm test` (**374 passed, 0 failed** — up from 319 passed / 55 failed at RED). Anti-false-green guards (13 across both classify files) verified green by name; the 2 AC4 lean/bounded-projection absence tests verified green by name; empty-match/all-missed-success tests green. Live-verification: Build Gate PASS; Run/API/Browser/Integration-smoke gates N/A (library plugin — no bootable server, no owned HTTP routes, no UI); the integration tier IS the live-path regression guard (real tools through real sil-client, only `fetch` mocked) and is green — this restores SC1/SC2 and unblocks the held SC10 catalog eval.

### → Handoff to Review (next agent: code-quality-guardian)

**PR:** https://github.com/Context4GPTs/sil-openclaw/pull/13 (base `main`; carries RED `5996230` + GREEN `d2b6393`).

**What to look at:**
- The change is confined to the two extractors' unwrap + doc comments. The behavioural delta is exactly two pairs of dropped lines (`src/lib/sil-client.ts`); the rest of the 161-line diff is doc-comment correction (the nested-`result` contract was described in the module header, two classifier JSDocs, both extractor blocks, and the `SearchResult` interface doc — all corrected to the flat shape so no comment restates a deleted contract).
- **Confirm the projections did not widen.** The founder scope-steer is binding: `projectProduct`/`projectVariant`/`projectLookupProduct`/`projectLookupVariant` must not appear in the diff (they don't). The AC4 exact-key-set absence tests are the wall; they're green.
- **Confirm the anti-false-green property held.** The `Array.isArray(products)` gate (now reading the top-level `products`) is the guard; the drop removed only the `result`-wrapper requirement, which never protected against stubs. Stub / no-`products` / non-array / non-object 200 → still `retryable`; empty `products: []` → `ok` empty list.

**Deliberate trade-offs / non-obvious choices (for distillation):**
- **No dual-path fallback** is intentional, not an oversight — Discovery ruled out mirroring `extractIdentity`'s `result ?? envelope` precisely because search/lookup are always flat and a surviving nested branch is a latent false-green. This is the `production-grade-first` "no v1-and-v2 side-by-side" rule applied.
- The **sil-api flat-envelope contract** (`withUcpMeta(body) → { ucp, ...body }`, products at top level, no `result` wrapper) and the invariant **"the load-bearing anti-false-green guard is `Array.isArray(products)`, not a `result` wrapper"** are the two distillation candidates (`docs/knowledge/`). The identity path's `result ?? envelope` dual-read is the *exception* (it has a genuine second bare-top-level route), not the rule — worth noting so a future reader doesn't "unify" them.

No known smells. The diff is mechanical and fully test-pinned.

## Review round 1 — code-quality-guardian

**Verdict: PASS.**

Reviewed the open PR's diff vs `main` (`origin/main...HEAD`: RED `5996230` test re-point + GREEN `d2b6393` fix). The behavioural change is exactly the two extractor unwraps; the remaining 254 deletions / 440 insertions are doc-comment corrections (test JSDoc + production JSDoc) and two AC4 absence tests. No security, type-safety, error-handling, complexity, hardcoded-value, legacy, bloat, anti-pattern, or architecture issues. Production diff is one file (`src/lib/sil-client.ts`), mechanical and fully test-pinned.

### Gate results (independently re-run in the worktree)

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS — 0 errors (`tsc --noEmit`) |
| `pnpm build` | PASS — 0 errors (`tsc -p tsconfig.build.json` → `dist/`) |
| `pnpm test` | PASS — **374 passed / 0 failed**, 29 files (confirms the expert's report exactly) |

Commit hygiene verified: RED `5996230` touches tests only (no `src/lib/sil-client.ts`); GREEN `d2b6393` touches `src/lib/sil-client.ts` only.

### The 7 binding constraints — each verified

1. **Unwrap-only, no payload widening — HONOURED.** `projectProduct` / `projectVariant` / `projectLookupProduct` / `projectLookupVariant` do NOT appear in the diff (grep on the diff for the four `function …` signatures returns empty). Read the live source at `sil-client.ts:925-971` + `:1023+` — byte-identical to main. The agent-facing payload did not widen by one field.
2. **Clean drop, not a dual-path — HONOURED.** Both extractors *delete* `const result = asRecord(envelope["result"]); if (result === null) return null;` and read `envelope["products"]` directly (`extractSearchResult` `:905`, `extractLookupResult` `:1001`). No `result ?? envelope` fallback was added; no nested branch survives. The retained test "200 wrapping the STUB body in an envelope `result` is still NOT ok" (both classify suites) positively proves a stray `result` key is no longer privileged over the real top-level `products` — the exact latent false-green Discovery flagged is closed.
3. **Anti-false-green guard intact — HONOURED.** The `Array.isArray(rawProducts)` gate and everything downstream are preserved verbatim (`:906`, `:1002`). Proven green by named tests in both suites: skeleton-stub body → not ok, no-`products`-key → retryable, non-array `products` → retryable, empty/null/non-object body → retryable; and empty `products: []` → ok empty list / all-missed-is-success. A `{stub:true}`/no-array/non-object 200 still degrades to retryable.
4. **`extractIdentity` + whoami path untouched — HONOURED.** The only surviving `envelope["result"]` read in the file is `:822` = `extractIdentity` (still `result ?? envelope`, the reference pattern). Out of scope, unchanged.
5. **No `ucp.status` branching — HONOURED.** Grep on the `+` lines of the source diff for `ucp.*status` / `status.*error` returns empty. No application-error arm introduced.
6. **Doc comments corrected, not left restating the deleted contract — HONOURED.** Module-header search/lookup wire blocks (`:42-83`), both classifier JSDocs (`:453-465`, `:493-505`), both extractor blocks (`:877-899`, `:973-995`), and the `SearchResult` interface doc now state sil-api's flat `{ ucp, products, … }` contract and name `Array.isArray(products)` as the load-bearing anti-false-green guard. No comment restates the dropped nested contract.
7. **Tests re-pointed, not dual-shaped — HONOURED.** Every catalog fixture now encodes ONLY the flat shape; the classify-test `envelope()` helpers spread the result body flat onto the top level (`search-classify.test.ts:140`, `lookup-classify.test.ts:180`). Scan for a surviving nested-`result` *fixture body* returns only benign matches (`envelope(result: unknown)` signatures and a `payloadOf(result:)` helper param). No dual-shape suite — the FAIL-level smell is absent.

### Integration tier — live-path regression guard confirmed

`catalog-search.integration.test.ts` and `catalog-lookup.integration.test.ts` drive the REAL tools (`registerCatalogTools(api)` → `sil_search` / `sil_product_get`) through the real sil-client with only `fetch` mocked, feed the flat `{ ucp, products, … }` envelope, and assert `status: "ok"` with the normalized lean products carrying a per-variant `checkout_url` (search `:429/:440`, lookup `:400/:416`) — NOT `retryable`. The empty-match (`:495 "200 { ucp, products: [] } → status ok"`) and partial/all-missed (`not_found`) paths are covered. This restores SC1/SC2 and unblocks the held SC10 catalog eval.

No P1/P2/P3 findings. No handoff back to In Dev required.

## Distillation — solutions-architect

Searched `docs/knowledge/INDEX.md` + `docs/decisions/INDEX.md` first. Three existing knowledge docs already owned this surface and **asserted the dead nested-`result` contract this card disproved** — so this was an *edit-in-place material correction*, not a new doc. (No `docs/decisions/` edit: the unwrap is a contract-read fix, not a new cross-cutting choice; the shared-client decision doc carries no envelope claim. No inline-comment capture: the GREEN commit already corrected every relevant doc comment in `sil-client.ts` — the module header at `:91` already states "only the identity read carries the `result ?? envelope` dual shape", so re-stating it in code would duplicate.)

Edited (all `commit`/`updated_at`/`updated_by_card` bumped, INDEX re-sorted):
- **knowledge/sil-api-catalog-contract.md** — was the highest-value lie: opened by asserting the envelope's `result.products` is `SilCatalogProduct[]`. Added a new "The envelope is FLAT: `{ ucp, ...body }`, never `{ result: {...} }`" section (the `withUcpMeta` contract + the phantom-contract correction), and re-pointed the status→outcome table, the empty-match line, the lookup body description, the misses-as-`messages` line, and the all-missed discriminator from `result.products` → top-level `products`. Title + tags updated.
- **knowledge/sil-response-classification.md** — its catalog trap #3 stated the **exact inverse** of the truth ("Unlike `extractIdentity`, there is no bare-top-level fallback … a top-level `products` is malformed") — the precise sentence that would re-introduce this bug. Rewrote trap #3 to read flat, and added the load-bearing invariant: **the anti-false-green guard is `Array.isArray(products)`, NOT a `result` wrapper; search/lookup read flat-only while `extractIdentity` keeps `result ?? envelope` for a genuine bare-or-enveloped second route — do not "unify" them.** Refreshed stale `extractIdentity` line refs (`:340`→`:818`).
- **knowledge/sil-api-identity-contract.md** — verified against sibling source (`sil-services/.../handlers/identity.ts:87` → `withUcpMeta` → flat; `envelope.ts:33-44` doc-comment "the envelope is FLAT … NOT nested under a `result` key") that the live `GET /identity` emits **flat** `{ ucp, id, name, addresses }`, NOT the `{ result: { name, addresses } }` this doc claimed. Corrected the status-table row and the "enveloped under `result`" assertion to flat, noted `extractIdentity`'s `result ?? envelope` resolves to the `envelope` branch live, and refreshed stale `fetchIdentity`/`getJson` line refs (`:270`/`:415` → `:584`/`:1256`).
- **knowledge/INDEX.md** — all three rows' titles/tags/Updated bumped to 2026-06-10, re-sorted newest-first.

Net: the two review-flagged invariants (sil-api emits a FLAT UCP envelope; the guard is `Array.isArray(products)` not a wrapper, with the identity dual-read as the documented *exception*) are captured in `knowledge/`, and three docs that were quietly asserting the never-emitted nested shape no longer lie. No tracked source changed beyond the docs.

## PR Ready

<!-- PR url; founder notification fires here -->

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
