---
id: sil-uniform-401-refresh-retry
title: One shared 401 refresh-and-retry-once helper — every sil-api tool routes its 401 through it, never a per-tool handler
tags: [architecture, auth, contracts, reuse, refresh, anti-divergence]
card: uniform-401-refresh-across-catalog-tools
commit: c8f9ed4
updated_at: 2026-06-10
updated_by_card: uniform-401-refresh-across-catalog-tools
---

**Every sil-api-calling tool MUST route a 401 through the single generic `refreshAndRetryOnce<O>` helper (`src/lib/sil-client.ts:747`) — never fork a per-tool 401 handler.** 401 auth-recovery is a property of sil's auth boundary, not of any one tool: the same expired access token must self-heal identically (transparent refresh-once → retry-once) whether the agent called `sil_search`, `sil_product_get`, or `sil_whoami`. A per-tool difference is the exact divergence this decision exists to forbid.

## The rule for the next sil-api tool

> When you add a tool that calls a sil-api domain (cart, checkout, order, fulfillment, payments, loyalty, …) and its read can return 401: do NOT write a terminal `case "unauthorized":` arm, and do NOT inline a copy of the refresh loop. Call `refreshAndRetryOnce(first, isUnauthorized, retryWithToken)` and map its `RefreshRetryResult<O>` to your envelope, exactly as the three existing call sites do (`identity.ts:178`, `catalog.ts:144`, `catalog.ts:284`). Then add your tool to `cross-tool-401-parity.integration.test.ts` so the parity guard covers it too.

The helper is **the** single 401 path: `refreshStoredTokens()` is invoked at exactly one non-test call site (`sil-client.ts:759`, inside the helper). A second invocation anywhere is the regression signal.

## Why a shared helper, not inline parity (FLAG-10)

The `sil_search` / `sil_product_get` Discovery deliberately deferred transparent refresh, landing 401 as a *terminal re-register* while `sil_whoami` already refreshed-and-retried. That per-tool divergence (FLAG-10) is precisely the goal's forbidden state: an agent that can `sil_whoami` through an expired token but is dead-ended by `sil_search` on the *same* token. Three hand-maintained copies of a subtle bounded-refresh loop drift silently — the invariants (one refresh max, second-401 terminal, TOCTOU re-read, clear-only-on-`invalid_grant`) are exactly the kind that diverge when copied. So the choreography is factored into one control-flow helper and **all three** sites — `sil_whoami` included, re-pointed off its old inline block — call it. Inline parity was rejected: it is the status quo the card killed.

**Alternatives rejected:** (a) leave `sil_whoami` inline, extract a helper only for catalog — leaves whoami as a fourth un-deduplicated copy, the same drift; (b) push the loop down into `searchCatalog`/`lookupCatalog`/`fetchIdentity` — forces the pure single-round-trip client functions to own `clearTokens()` + tool-facing terminal/transient UX and to re-enter themselves (impure). The helper sits at the right seam: above the single-round-trip client calls, below the envelope mapping.

## What the helper owns vs. what the caller owns (the seam)

The helper owns the **control flow and its invariants**, and is `O`-parametric so the three different outcome unions share it with no `any`/cast (it only ever returns an `O` produced by `first` or `retryWithToken`, never fabricates one; it inspects `O` only via the caller's `isUnauthorized` predicate):

- **At most one refresh + at most one retry, structural — no loop.** Straight-line `first → refresh → re-read → retry`. A freshly-rotated token that is *still* 401 is structurally dead → `second_unauthorized` terminal, **never a second refresh** (the refresh-storm guard).
- **TOCTOU re-read.** After `refreshStoredTokens()` rotates `tokens.json`, the helper re-reads the rotated pair through the module's `readTokens()`; a `null` read ⇒ `must_reregister/no_stored_tokens`, no retry with a stale/absent token.
- **The `RefreshRetryResult<O>` discriminant** that tells the caller which terminal/transient/success path was taken — including the `refreshed: boolean` bit on the `result` variant (see "observability" below).

The caller owns ONLY: the `isUnauthorized` predicate, the token-bearing `retryWithToken` thunk (closing over its params + the rotated token), envelope mapping, `clearTokens()` on the clearing terminals, and logging. **Token-clearing stays at the call site, not in the helper** — *when* to clear is uniform but credential side-effects beyond the rotation `refreshStoredTokens` already does stay at the edges (mirrors `identity.ts`). `clearTokens()` fires on exactly two terminals — `must_reregister`+`invalid_grant` and `second_unauthorized` — and **never** on `no_stored_tokens` / `retryable` / a `result`-mapped 403/5xx.

## Two-axis observability: silent in the payload, visible in the logs

A silent refresh is **invisible in the agent-facing payload** (outcome 1 returns a normal `ok` result with no `refreshed`/`retried` marker — by product design; the agent must never reason about token mechanics) **but observable in operator logs** via a uniform `<tool>_refreshed` info marker (`sil_search_refreshed` / `sil_product_get_refreshed` / `sil_whoami_refreshed`). These are two deliberately-separate axes. The marker is **logs-only, carries no token material, and adds no payload field**; it fires on (and only on) the silent-recovery path, gated by the helper's `refreshed: true` discriminant. This restores the seam the card's risk-mitigation named (a session that refreshes on nearly every call — wrong TTL/cadence upstream — is otherwise invisible) and makes it uniform across all three tools, where it was whoami-only before. The full WHY is inline at `sil-client.ts:690-784` (helper) and each call site's `case "result":` arm (`catalog.ts:154`, `:294`; `identity.ts:190`).

## How drift is prevented (test, not reviewer vigilance)

`cross-tool-401-parity.integration.test.ts` drives the identical expired-token + 401 scenario through all three tools and collapses each dimension (`status` / `refreshCount` / `readCount` / `tokensCleared` / `<tool>_refreshed` count) to a `Set`, asserting size 1 — with an explicit FLAG-10 canary that fails if any one tool's `refreshCount` (or success-marker count) diverges. A new tool with a forked terminal-401 branch shows a different `refreshCount` → set size 2 → fail. **A new sil-api tool is only covered once it is added to this test** — adding the tool to the parity suite is part of the rule above, not optional.

## See also

- [[sil-two-origin-model]] — refresh goes **only** to sil-web (`POST /api/v1/auth/refresh`), the sole auth authority; the helper's `refreshStoredTokens()` hard-codes that origin. 401 on a sil-api domain read triggers the refresh; the refresh itself never hits sil-api or Auth0.
- [[sil-api-identity-contract]] — the original spec of the read→401→refresh-once→retry-once choreography and the 401-vs-403-vs-5xx taxonomy (401 refreshable; 403 never; 5xx transient). This decision generalizes that single-tool choreography into the shared cross-tool helper.
- [[sil-shared-catalog-client]] — the shared catalog client + the `mustReregister`/`transient`/`notRegistered` envelope taxonomy the `RefreshRetryResult` variants map onto. That doc owns the catalog *client* reuse; this doc owns the *401-recovery control flow* reuse — distinct concerns, both binding the next tool.
- [[sil-response-classification]] — classifiers keep mapping 401 → `{ kind: "unauthorized" }` (unchanged); what this card changed is that `unauthorized` stopped being *terminal* for the catalog callers — it became the helper's trigger.
