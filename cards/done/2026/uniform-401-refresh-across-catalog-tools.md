---
type: card
title: Uniform 401 refresh across catalog tools
slug: uniform-401-refresh-across-catalog-tools
work_type: refactor       # feature | bug | refactor | chore | docs
tiers: [unit, integration]  # subset of [unit, integration, e2e] — set by solutions-architect during Discovery from the acceptance criteria below
status: done          # backlog | discovery | stand-by | in-dev | review | distilling | pr-ready | done | abandoned
agents: []  # current active agent set; updated by each handoff
priority: 2               # 1 = drop-everything, 2 = normal, 3 = nice-to-have
created: 2026-06-09       # placeholder — /board-add overwrites with today's date; never leave as a placeholder before commit (INDEX.base formulas will break)
updated: 2026-06-10       # same — must be a real ISO date before commit
base_branch: main         # the branch this card's worktree was cut from and the PR will target
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-uniform-401-refresh-across-catalog-tools   # set by /board-add at card birth (absolute path to .claude/worktrees/card-<slug>)
branch: card/uniform-401-refresh-across-catalog-tools            # set by /board-add (card/<slug>)
pr: https://github.com/Context4GPTs/sil-openclaw/pull/11                  # set by expert-developer at in-dev → review
merged_commit: 7a9b1620734f25fc8c70a25027478115ec497811       # set by /board-tick on PR-merge detection
epic_id: catalog-plugin-tools
origin: goal:agentic-search-slice
---

## Intent (founder)

The two catalog tools — `sil_search` and `sil_product_get` — currently treat a 401 from sil-api as a **terminal** re-register (a single round-trip, no token refresh), while `sil_whoami` recovers transparently: it refreshes the bearer pair once via sil-web and retries the read exactly once. That per-tool divergence is exactly what the goal's sil-openclaw acceptance forbids — `401` auth-recovery must be **uniform across every sil-api-calling tool**: transparent refresh-and-retry-once, never a per-tool difference. Bring the catalog tools onto the same choreography `sil_whoami` already implements: on 401, refresh once via the existing `refreshStoredTokens()` path, re-read the rotated pair, retry the original call exactly once; a second 401 (or a rejected/dead refresh) falls through to the terminal re-register hint, and a 5xx/network refresh blip stays transient. **Reuse `sil_whoami`'s path — do not fork a second 401 handler — and factor it so search, product_get, and whoami cannot drift apart again.** No backwards-compat: the terminal-only 401 branches in `catalog.ts` / `sil-client.ts` are replaced, not kept alongside.

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
- 2026-06-09 orchestrator (goal-tick) — origin: goal:agentic-search-slice. The loop's own card (tick 63). Traces to FLAG-10 (resolved): `sil_search`/`sil_product_get` Discovery (ticks 59/61) deliberately deferred transparent refresh, landing 401 as a terminal re-register "as one follow-on across both catalog tools, never diverge" — the PRD's sil-openclaw acceptance requires uniform refresh-and-retry-once across **every** sil-api-calling tool. Verified still-divergent in merged code: `catalog.ts` 401 cases are terminal (`sil-client.ts` comments call the refresh choreography "`sil_whoami`'s; adding it here is additive follow-on"), `identity.ts:171-208` is the transparent path.
- 2026-06-09 orchestrator (goal-tick) — ready-now/why: born this tick because its shared-surface gate cleared — `remove-openclaw-skeleton-example-stub-tools` merged (PR #10, 17:21Z) and both literal deps `sil_search` (PR #8) + `sil_product_get` (PR #9) are merged, so the `catalog.ts` / `sil-client.ts` / `registerCatalogTools` surface is free and sil-openclaw WIP is 0. Mirror `sil_whoami`'s existing choreography; reuse `refreshStoredTokens()` (no new refresh machinery). Discovery owns whether to extract a shared `refreshAndRetryOnce(...)` helper vs. inline parity — three call sites that must stay identical is the case *for* one.

---

## Epic notes (provisional — sibling Discovery owns the verdict)

### Likely change sites (shallow read-only guess — Discovery confirms)

- `src/tools/catalog.ts` — the `case "unauthorized":` handlers in `sil_search` (~line 142) and `sil_product_get` (~line 242) currently log + return the terminal re-register result. Replace each with the refresh-and-retry-once choreography mirrored from `sil_whoami`.
- `src/tools/identity.ts:171-208` — **the canonical pattern to mirror** (`sil_whoami`: 401 → refresh once via `refreshStoredTokens()` → re-read rotated pair → retry once → second-401/dead-refresh terminal). Don't reinvent it.
- `src/lib/sil-client.ts` — `classifySearchResponse` / `classifyLookupResponse` keep `401 → { kind: "unauthorized" }`, but `unauthorized` stops being *terminal* for the catalog callers. The refresh primitives already exist and are reused as-is: `refreshStoredTokens()` (the SC7 entry point whoami uses), `refreshSession`, `classifyRefreshResponse`, plus the stored-token read/rotate. **No new refresh machinery** — wire the existing one into the catalog paths and delete the "no transparent refresh in this card" comments.
- Tests (`src/__tests__/tools/` for catalog + the client) — unit tests asserting catalog 401 → terminal must be rewritten to assert refresh-and-retry-once. **Stub-free:** exercise the real `refreshStoredTokens` path against a mocked sil-web boundary exactly as the whoami tests do — no `AUTH_DEV_BYPASS`, no stubbed refresh.

### Draft acceptance scenarios (Discovery owns the final tier-tagged set)

- `[unit]` Given a registered agent whose access token is expired, when `sil_search` calls sil-api and gets 401, then it refreshes the pair once via `refreshStoredTokens()`, retries the search once with the rotated token, and returns normal ranked results — the agent never sees the 401.
- `[unit]` Same for `sil_product_get`: 401 → refresh once → retry once → normal lookup result.
- `[unit]` Given the retry after refresh ALSO returns 401 (or the refresh returns `must_reregister` / `invalid_grant`), when either catalog tool runs, then it returns the terminal re-register envelope with the recovery hint — and refreshes **at most once** (never a second refresh).
- `[unit]` Given the refresh itself is `retryable` (5xx/network), when either catalog tool runs, then it surfaces the transient "try again" outcome, not a re-register.
- `[integration]` The 401-recovery choreography is shared, not per-tool: a test proves `sil_search` / `sil_product_get` 401 behaviour is identical to `sil_whoami`'s, so the divergence cannot be reintroduced.

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — <agents tag themselves here>

<!-- Filled jointly by product-owner and solutions-architect. -->

### Approach + alternatives ruled out

<!-- 1–3 lines per alternative, with the reason it lost -->

<!-- product framing — product-owner -->

**Product principle (the WHY this card exists).** 401 recovery is a property of *sil's auth boundary*, not of any one tool. Every sil-api-calling tool sees the same thing on an expired access token — transparent refresh-and-retry-once — so an agent never has to learn per-tool which calls self-heal and which dead-end. `sil_whoami` already lives this (`identity.ts:170-208`); `sil_search` / `sil_product_get` currently break it (`catalog.ts` `case "unauthorized"` → terminal `mustReregister`). The card's product job is to make the agent's *observable* 401 behavior identical across all three, and to make that sameness structural so it can't silently diverge on the next catalog tool.

**The agent-facing contract — four 401 outcomes, each a distinct observable state.** A 401 from sil-api is the plugin's private business: the agent's mental model is "my call either succeeds, tells me to retry later, or tells me to re-register" — the refresh round-trip underneath the success case is *invisible*.

1. **First 401 → refresh succeeds → retry succeeds.** The agent sees a **normal result** — for `sil_search` the ranked `{ status: "ok", products, cursor? }`; for `sil_product_get` the `{ status: "ok", products, not_found? }`. It is indistinguishable from a call that never hit a 401: **no `refreshed` flag, no warning, no extra marker in the payload.** The expired token was an internal event the agent must never have to reason about. (Mirrors `sil_whoami` returning a plain identity after a silent refresh.)
2. **Retry still 401, OR refresh returns `must_reregister`/`invalid_grant`.** The agent sees the **terminal re-register envelope** — the *same* `{ status: "must_reregister", message, recovery: "sil_register" }` the catalog tools already emit, carrying the actionable `sil_register` hint. This is the ONLY 401 path that surfaces a recovery hint. **At most one refresh per call:** a freshly-rotated token that is *still* rejected is structurally dead — the tool does NOT refresh a second time, it goes terminal. A dead refresh token (`invalid_grant`) additionally clears `tokens.json` (so stale-presence does not block the agent's `sil_register` recovery), exactly as whoami does on `invalid_grant`.
3. **Refresh itself is transient (`retryable` — 5xx/network/timeout on the sil-web refresh leg).** The agent sees the **transient outcome** — `{ status: "retryable", message: "sil is temporarily unavailable. Please try <tool> again." }`, with **NO `recovery: sil_register`**. A 5xx on the refresh leg is not a dead session; sending the agent to re-register would be a false terminal that derails the user. "Try again" is the truthful, recoverable instruction. (The first-call `retryable` — a 5xx on the *original* search/lookup, before any 401 — keeps its existing transient outcome unchanged; this card only adds the refresh-leg transient.)
4. **Unchanged non-401 outcomes.** `not_registered` (no tokens — zero network), `invalid_request` (sil-api 400), the first-call `retryable` (5xx on the search/lookup itself), and every `ok` are untouched. This card narrows its blast radius to exactly the `case "unauthorized"` branch — the 401 stops being terminal; nothing else moves.

**The recovery-hint discriminator (one wrong hint = one misdirected user).** Only outcome 2 carries `recovery: "sil_register"`. Outcomes 1 (ok) and 3 (transient) must NOT — re-registering cannot fix a 5xx and cannot improve an already-successful read, and a spurious hint pushes the agent down a recovery path that resolves nothing. This is the existing catalog taxonomy invariant (`catalog.ts` already keeps the hint off `transient`/`invalid_request`); the refresh-leg transient inherits it.

**Cross-tool parity is the deliverable, not a side effect.** The card is only "done" when `sil_search`, `sil_product_get`, and `sil_whoami` 401 behavior is *provably* identical — same trigger (401 from sil-api), same single refresh via `refreshStoredTokens()`, same retry-once, same four terminal/transient/ok mappings. The divergence the goal forbids (FLAG-10) re-enters the moment a fourth tool copies catalog's *old* terminal branch instead of the shared path, so the parity must be enforced by a test that fails if any one tool drifts — not left to reviewer vigilance.

**Alternatives ruled out (product lens — the architect owns the helper-vs-inline mechanics):**
- **Keep catalog 401 terminal, refresh only in whoami.** This *is* the divergence the goal forbids — an agent that can `sil_whoami` through an expired token but is dead-ended by `sil_search` on the same token is the exact per-tool inconsistency FLAG-10 raised. Rejected: it is the bug, not an option.
- **Surface a `refreshed: true` marker (or a "token was refreshed" notice) on the post-refresh success.** Rejected: leaks an internal auth event into the product surface. The agent has no action to take on it, would have to special-case a field that means "ignore me," and it breaks the indistinguishable-from-a-normal-result contract whoami already sets. Refresh is invisible by design.
- **On a transient refresh failure, fall through to re-register "to be safe."** Rejected: a 5xx/network blip is not a dead session — re-registering throws away a still-valid refresh token and derails the user with a sign-in they didn't need. The honest outcome is "try again." Same false-terminal trap the existing `transient`-vs-`mustReregister` split already guards.
- **Refresh-and-retry more than once (loop until success or a cap).** Rejected: a freshly-rotated token still 401 is structurally dead, not transiently unlucky; a retry loop masks a real auth failure as latency and risks an invisible refresh storm against sil-web. At most one refresh + one retry per call — the same ceiling whoami enforces.

<!-- technical approach + helper-vs-inline verdict — solutions-architect -->

**Verdict: extract a single generic `refreshAndRetryOnce(...)` helper in `src/lib/sil-client.ts`, and route ALL THREE call sites (`sil_whoami`, `sil_search`, `sil_product_get`) through it — including re-pointing `sil_whoami` off its current inline copy.** Verified against `identity.ts:170-208` (the canonical inline choreography) and the three client call signatures.

The choreography is identical at all three sites: call-with-stored-token → if not 401, map outcome; if 401, `refreshStoredTokens()` once → on `must_reregister` terminal (clear tokens iff `invalid_grant`), on `retryable` transient → on `refreshed` re-read rotated pair (TOCTOU null ⇒ terminal) → retry the call ONCE with the rotated token → ok⇒result, second-401⇒terminal+`clearTokens()` (NEVER a second refresh), other⇒map. The only per-site variance is (a) call arity — `fetchIdentity(url, token)` / `searchCatalog(url, token, params)` / `lookupCatalog(url, token, ids)`; (b) the outcome union (`IdentityOutcome`/`SearchOutcome`/`LookupOutcome`); (c) the terminal/transient/success *envelope*. None of that variance lives in the control flow — it's all at the edges. So the factoring is a control-flow helper that takes a token-bearing retry thunk + an `unauthorized` discriminator and returns a small typed result union the caller maps to its own envelope.

**Shape (record WHY this signature):** a generic
`refreshAndRetryOnce<O>(first: O, isUnauthorized: (o: O) => boolean, retryWithToken: (accessToken: string) => Promise<O>): Promise<RefreshRetryResult<O>>`
where `RefreshRetryResult<O> = { kind: "result"; outcome: O } | { kind: "must_reregister"; reason: "invalid_grant" | "no_stored_tokens" } | { kind: "retryable" } | { kind: "second_unauthorized" }`. The helper owns `refreshStoredTokens()`, the rotated-pair re-read, the at-most-one-refresh bound, the TOCTOU guard, and the second-401⇒`second_unauthorized` rule. The caller owns ONLY: deciding `isUnauthorized`, supplying the typed retry thunk (which closes over `params`/`ids`/the stored token), `clearTokens()` on the two clearing terminals, logging, and envelope mapping. Token-clearing stays at the call site (not in the helper) — *when* to clear is uniform but the helper should not own credential side-effects beyond the rotation `refreshStoredTokens` already does; it returns the discriminant and the caller clears, mirroring `identity.ts:180,203`.

Why generic over `O` rather than three `unauthorized`-narrowed overloads: the three unions share no nominal base, but the helper never inspects `O` beyond the caller-supplied `isUnauthorized` predicate and never fabricates an `O` — it only ever returns an `O` produced by `first` or `retryWithToken`. So `O` is genuinely parametric: no `any`, no cast, strict-mode clean.

**Alternative A — inline parity at three sites (copy whoami's block into each catalog tool).** Rejected. It is the status quo the card exists to kill: three hand-maintained copies of a subtle bounded-refresh loop whose invariants (one refresh max, second-401 terminal, TOCTOU re-read, clear-only-on-`invalid_grant`) drift silently when copied. The card's framing — "factor it so search, product_get, and whoami cannot drift apart again" — plus FLAG-10's history (catalog 401 was *deliberately* deferred and diverged) make this the losing option. Three real consumers today, not a speculative future — so the helper is not premature abstraction.

**Alternative B — push the loop down into `searchCatalog`/`lookupCatalog`/`fetchIdentity` (clients refresh internally).** Rejected. It forces the client layer to own `clearTokens()` + the tool-facing terminal/transient semantics, collapsing the deliberate "client classifies one round-trip; tool owns recovery UX" split (`identity.ts` + `sil-client.ts`). It also makes the pure, isolated classifier/transport functions impure (they'd mutate `tokens.json` and re-enter themselves). The helper sits at the right seam: above the single-round-trip client calls, below the envelope mapping.

**Alternative C — leave `sil_whoami` inline, extract a helper only for the two catalog tools.** Rejected. It leaves whoami as a fourth, un-deduplicated copy — the exact drift the card forbids — and violates the Intent's "reuse `sil_whoami`'s path — do not fork a second 401 handler". Whoami adopts the helper too; that is what makes the set genuinely un-driftable.

No new refresh machinery: `refreshStoredTokens` / `refreshSession` / `classifyRefreshResponse` and the `readTokens`/`writeTokens` rotate primitives are reused as-is (confirmed present — `sil-client.ts:396-408`, `:537-550`, `:661-680`). The classifiers keep mapping 401→`{ kind: "unauthorized" }` (`SearchOutcome`/`LookupOutcome` `unauthorized` variants STAY); what changes is that `unauthorized` stops being *terminal* for the catalog callers — it becomes the helper's trigger. Per no-backwards-compat: the terminal `case "unauthorized":` branches in `catalog.ts` and the "401 is terminal here / additive follow-on / no transparent refresh" comments in `catalog.ts` + `sil-client.ts` are deleted, not kept beside the new path.

### Affected files / surfaces

<!-- bulleted list -->

<!-- verified change sites — solutions-architect -->

- **`src/lib/sil-client.ts`** — ADD `refreshAndRetryOnce<O>(...)` + the exported `RefreshRetryResult<O>` union (new shared choreography; reuses `refreshStoredTokens`/`readTokens`/`writeTokens`, no new refresh primitive). EDIT the doc-comments to drop the now-false "401 terminal here / no refresh in this card / additive follow-on": the top wire-contract block (`:48-49` search, `:64-65` lookup), `SearchOutcome` (`:254-267`), `LookupOutcome` (`:336-353`), `classifySearchResponse` (`:443`), `classifyLookupResponse` (`:480-481`). The classifiers' `if (status === 401) return { kind: "unauthorized" }` bodies are UNCHANGED.
- **`src/tools/catalog.ts`** — `registerSearch`'s `case "unauthorized":` (`:142-144`) and `registerProductGet`'s `case "unauthorized":` (`:242-244`): replace the terminal `mustReregister(tool)` with the helper call. The arm becomes: build the `retryWithToken` thunk (re-runs `searchCatalog`/`lookupCatalog` with the rotated token), call `refreshAndRetryOnce(outcome, o => o.kind === "unauthorized", thunk)`, then map `RefreshRetryResult`: `result`⇒the existing ok/invalid_request/retryable switch; `must_reregister`⇒`mustReregister(tool)` (+`clearTokens()` iff `reason === "invalid_grant"`); `retryable`⇒`transient(tool)`; `second_unauthorized`⇒`mustReregister(tool)`+`clearTokens()`. EDIT the `mustReregister` doc-comment (`:363-365`) and the two `execute`-flow header comments (`:26-29`, `:171-179`) to drop "single round-trip — no transparent refresh". `mustReregister`/`transient`/`notRegistered`/`searchResult`/`lookupResult` reused unchanged. New imports: `clearTokens` (`../lib/credentials.js`), `refreshAndRetryOnce` (`../lib/sil-client.js`).
- **`src/tools/identity.ts`** — `registerWhoami`'s inline refresh block (`:175-208`): replace with the same `refreshAndRetryOnce` call so whoami shares the one path (Intent: "do not fork a second 401 handler"). Observable behaviour is unchanged; only the *source of the loop* moves into the helper. `identityOutcomeToResult`/`mustReregister`/`transient`/`clearTokens` reused; the `identityOutcomeToResult` `case "unauthorized":` unreachable-guard (`:225-228`) stays.
- **Tests — rewrite the now-false terminal-401 assertions (these are the RED the dev makes pass):**
  - `src/__tests__/catalog-search.integration.test.ts` — the `describe("sil_search — 401 is a terminal re-register hint (single round-trip, no refresh in SC1)")` block (`:567-609`) incl. `expect(r.url).not.toContain("/auth/refresh")` (`:583`) asserts the OLD behaviour → rewrite to the refresh-and-retry-once choreography (mirror `whoami.integration.test.ts:379-605`). The integration fetch double must gain a `refresh` route — the whoami `installRouter` (`:122-193`, routes `/auth/refresh`) is the template.
  - `src/__tests__/catalog-lookup.integration.test.ts` — same: the terminal-401 `describe` (`:548-647`) incl. `:563` `not.toContain("/auth/refresh")` → rewrite + add refresh route.
  - `src/__tests__/tools/search.test.ts` (`:254-271`) / `product-get.test.ts` (`:272-289`) — the unit single-401 leak-canaries stay valid (log-hygiene intent, no terminal-401 assertion to fix); just confirm they still pass under the new path.
  - NEW `src/__tests__/lib/refresh-retry.test.ts` (or extend `lib/sil-client.test.ts`) — UNIT the pure helper in isolation (stub `refreshStoredTokens` + the `retryWithToken` thunk): one-refresh-max, second-401⇒`second_unauthorized`, dead-refresh⇒`must_reregister`+no-retry, 5xx-refresh⇒`retryable`, TOCTOU re-read⇒`must_reregister`/`no_stored_tokens`.
- **NOT touched:** `searchCatalog`/`lookupCatalog`/`fetchIdentity` signatures (helper wraps, doesn't change them); classifier bodies; `openclaw.plugin.json` contracts (no tool added/removed → the manifest-contract drift guard is unaffected); `src/index.ts` wiring.

### Risks / failure modes

<!-- bulleted list — what could break -->

<!-- technical risks — solutions-architect -->

- **Refresh storm / unbounded retry (the cardinal risk).** A freshly-rotated token that STILL 401s must be terminal, never a second refresh. The helper enforces this structurally — straight-line `first → refresh → retry`, no loop — and returns `second_unauthorized` on the retry's 401. Integration must assert exactly 2 catalog-endpoint calls + 1 refresh on a persistent 401, independently for search AND lookup (mirror `whoami.integration.test.ts:578-604`).
- **Mis-scoped `clearTokens()` on the terminal fall-through.** The clear must fire on exactly two terminals — `must_reregister`+`invalid_grant` from the refresh, and `second_unauthorized` from the retry — and must NOT fire on `no_stored_tokens` (TOCTOU; nothing to clear), `retryable` (token may be fine), or a 403/5xx mapped via `result`. Mis-scoping forces a pointless re-register; the whoami 403 guard (`:557-575`) is the analogue to replicate per catalog tool.
- **Transient refresh (5xx/network) leaking as terminal.** A `refreshStoredTokens` `retryable` must surface `transient(tool)`, NEVER `mustReregister` — a false terminal on a 5xx ejects valid users into a needless re-auth. Integration must assert refresh-leg 5xx ⇒ retryable envelope, distinct from dead-refresh ⇒ re-register.
- **TOCTOU between rotate and re-read.** If `tokens.json` vanishes between `writeTokens` (inside `refreshStoredTokens`) and the helper's `readTokens`, the helper returns `must_reregister`/`no_stored_tokens` and the caller does NOT retry with a stale/absent token (whoami handles this at `:191-195`). The helper owns this so all three sites inherit it identically.
- **Three-site drift returning (the risk this card removes).** If the dev extracts the helper but leaves whoami inline (Alt C), or copies the loop instead of *calling* the helper, the divergence is back. The cross-tool-parity integration AC — asserting search/lookup 401 behaviour is identical to whoami's — is the structural guard; it must be a real shared-behaviour assertion, not three independent copies.
- **Generic-helper type erosion.** Serving three different outcome unions tempts an `any`/unchecked cast to unify them — a no-`any`-at-boundaries violation. The `isUnauthorized` predicate + `retryWithToken` thunk keep `O` parametric; review must reject any cast smuggling a concrete union into the helper body.
- **Cross-call double-refresh (known limitation, NOT a regression).** `refreshStoredTokens` reads/writes on-disk `tokens.json`; two concurrent catalog calls could each refresh — but this already holds for whoami today and there is no in-process lock. The helper must not ADD caching that worsens it. Per-*call* refresh stays ≤1; cross-call concurrency is unchanged from the whoami baseline — out of scope for this card.

### Acceptance criteria

<!-- bulleted list — what could break -->

<!-- product-facing risks — product-owner -->

- **Perceived added latency on the silent-retry path.** Outcome 1 turns one round-trip into three (failed read → refresh → retried read), invisibly. To the agent it is one slow `sil_search`, not a failure — but a slow `sil_search` could read as a hang if the per-request timeout is generous. *Mitigation:* the existing 15s `REQUEST_TIMEOUT_MS` per leg bounds it, refresh fires only on an actual 401 (never speculatively), and it is at most one extra refresh + one retry — never a loop. Acceptable: the alternative (a terminal re-register) costs the user a full manual re-auth, far worse than one slow call.
- **Invisible refresh loop / refresh storm against sil-web.** The headline failure mode if the retry-once ceiling is not airtight: a tool that refreshes on *every* 401 including the retry's own 401 would hammer sil-web's `/api/v1/auth/refresh` and mask a dead session as latency, with nothing visible to the agent. *Mitigation (a hard product invariant, not a tuning knob):* a freshly-rotated token that is still 401 is structurally dead → terminal, NEVER a second refresh. At most one refresh + one retry per call. This must be asserted by a fetch-call-count test, not assumed.
- **Silent refresh hides a degrading session from the user.** Because the refresh is invisible (by design), a user whose session refreshes on nearly every call — a sign the refresh cadence or token TTL is wrong upstream — sees only normal results and never learns their auth is thrashing. *Accepted, with a seam:* this is the correct product trade (the agent should not be burdened with token mechanics), and the refresh event is still observable to operators via the existing non-credential log markers (`sil_*_refreshed` / `sil_*_must_reregister`) — diagnosable in logs without ever surfacing to the agent or logging a token.
- **False-terminal on a transient refresh blip (the user-facing cost of getting outcome 3 wrong).** If a 5xx/network refresh failure were mapped to re-register instead of transient, every sil-web hiccup would eject otherwise-valid users into a needless `sil_register` flow — a self-inflicted churn spike during any refresh-endpoint incident. *Mitigation:* outcome 3 is `retryable` with no `recovery` hint; covered by an explicit acceptance criterion so the mapping can't regress.
- **Recovery-hint drift across the three tools.** Parity is behavioral, not just structural: if one tool's terminal envelope omits `recovery: "sil_register"` or another's transient envelope wrongly includes it, the agent gets inconsistent guidance for the same auth state — the exact per-tool confusion this card exists to kill. *Mitigation:* the cross-tool-parity criterion asserts the envelopes are identical, so a drifted hint fails the suite.

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.
-->

<!-- behavior framed by product-owner; `[tier]` tags + `tiers:` frontmatter PENDING solutions-architect -->

**Outcome 1 — first 401 → silent refresh + retry → normal result (the agent never sees the 401):**

- `[integration]` Given a registered agent whose stored access token is expired, when `sil_search` POSTs `/catalog/search` and sil-api returns 401, then the tool refreshes the pair exactly once via `refreshStoredTokens()`, re-reads the rotated tokens, retries the search once with the rotated access token, and returns the normal `{ status: "ok", products, cursor? }` — with NO `refreshed`/`retried` marker and NO recovery hint in the payload (indistinguishable from a call that never 401'd).
- `[integration]` Given the same expired-token state, when `sil_product_get` POSTs `/catalog/lookup` and sil-api returns 401, then it refreshes once, retries once, and returns the normal `{ status: "ok", products, not_found? }` — again with no refresh marker and no recovery hint.
- `[integration]` Given outcome-1 succeeds, when either catalog tool runs, then exactly one refresh call to sil-web `/api/v1/auth/refresh` and exactly two calls to the sil-api catalog endpoint are made (the failed read + the one retry) — no more (proves the silent path does not loop or storm).
- `[integration]` Given outcome-1 succeeds, when either catalog tool runs, then `tokens.json` holds the rotated pair (the refresh persisted) and neither the old nor the new token value appears in any logger call or in the returned payload (privacy invariant holds across the refresh path).

**Outcome 2 — second 401, or a dead refresh → terminal re-register with the hint, refreshed at most once:**

- `[integration]` Given a registered agent whose access token is expired AND whose refresh succeeds but the retried read ALSO returns 401, when either catalog tool runs, then it returns the terminal `{ status: "must_reregister", recovery: "sil_register", message }` and does NOT refresh a second time (exactly one refresh call to sil-web — a freshly-rotated token still rejected is structurally dead).
- `[integration]` Given a registered agent whose refresh returns `invalid_grant` (sil-web 401 on `/api/v1/auth/refresh`), when either catalog tool runs, then it returns the terminal re-register envelope with the `sil_register` hint, clears `tokens.json` (the dead pair must not block the agent's re-register), and makes NO retry of the catalog call (the refresh failed; there is no rotated token to retry with).
- `[integration]` Given the second-401 / dead-refresh terminal is reached, when either catalog tool runs, then no token value (access or refresh, old or rotated) appears in any logger call or in the returned payload.

**Outcome 3 — transient refresh failure → "try again", NOT a re-register:**

- `[integration]` Given a registered agent whose access token is expired AND whose refresh leg returns a 5xx / network error / timeout (`refreshStoredTokens()` → `retryable`), when either catalog tool runs, then it returns the transient `{ status: "retryable", message: "...try <tool> again." }` with NO `recovery: "sil_register"` hint (a refresh blip is not a dead session) and does NOT retry the catalog call.
- `[integration]` Given the first-call (pre-401) outcomes, when sil-api returns a 5xx on the ORIGINAL search/lookup (before any 401), then the existing first-call transient `{ status: "retryable" }` is returned unchanged and NO refresh is attempted (the refresh path is reachable only via a 401, never via a first-call 5xx — this card does not alter the non-401 branches).

**Cross-tool parity — the divergence is provably gone and cannot return:**

- `[integration]` Given an identical expired-access-token + 401-from-sil-api scenario driven through each of `sil_search`, `sil_product_get`, and `sil_whoami`, when each tool runs, then all three exhibit the identical 401 choreography — exactly one refresh via `refreshStoredTokens()`, exactly one retry of the original read, and the same terminal/transient/ok envelope class for each of the four refresh sub-outcomes (retry-ok, second-401, invalid_grant, refresh-retryable) — so no tool dead-ends on a 401 that another tool recovers from.
- `[integration]` Given the three tools share one 401-recovery path, when a regression reintroduces a terminal-only 401 branch in any single catalog tool (the FLAG-10 divergence), then the parity test fails (the shared behavior is enforced by test, not by reviewer vigilance — the same divergence cannot silently return on the next catalog tool).

**Shared helper — the bounded-loop invariants, unit-tested in isolation (solutions-architect):**

- `[unit]` Given the pure `refreshAndRetryOnce<O>(first, isUnauthorized, retryWithToken)` with `first` classified `unauthorized` and a stubbed `refreshStoredTokens` returning `refreshed`, when the stubbed `retryWithToken` returns a non-401 `ok` outcome, then the helper returns `{ kind: "result", outcome }` having called `refreshStoredTokens` exactly once and `retryWithToken` exactly once (one refresh, one retry — the bound is structural, not a loop).
- `[unit]` Given `first` is `unauthorized` and the refresh succeeds but the stubbed `retryWithToken` returns `unauthorized` again, when the helper runs, then it returns `{ kind: "second_unauthorized" }` and calls `refreshStoredTokens` exactly once (NEVER a second refresh on a freshly-rotated-still-401 — the storm guard at the unit boundary).
- `[unit]` Given `first` is `unauthorized` and the stubbed `refreshStoredTokens` returns `must_reregister` (`invalid_grant`), when the helper runs, then it returns `{ kind: "must_reregister", reason: "invalid_grant" }` and NEVER calls `retryWithToken` (a failed refresh leaves no rotated token to retry with).
- `[unit]` Given `first` is `unauthorized` and `refreshStoredTokens` returns `retryable` (5xx/network on the refresh leg), when the helper runs, then it returns `{ kind: "retryable" }` and NEVER calls `retryWithToken` (a refresh blip is transient, not terminal).
- `[unit]` Given `first` is `unauthorized`, the refresh succeeds, but the post-rotate token re-read yields no stored tokens (TOCTOU), when the helper runs, then it returns `{ kind: "must_reregister", reason: "no_stored_tokens" }` and does NOT retry with a stale/absent token.
- `[unit]` Given `first` is NOT `unauthorized` (an `ok`/`forbidden`/`retryable` first outcome), when the helper runs, then it returns `{ kind: "result", outcome: first }` WITHOUT calling `refreshStoredTokens` or `retryWithToken` (the refresh path is reachable only via a first-call 401).

### Open questions (if any)

<!-- escalate to founder if blocking -->

<!-- solutions-architect -->

- None blocking. Recorded assumptions (most-defensible, per the no-mid-flight-ask rule): (1) the shared helper lands in `src/lib/sil-client.ts` alongside `refreshStoredTokens` (its sole collaborator), not a new file — it is choreography over existing client primitives, and a new module would split one cohesive concern; the dev may instead colocate it in a small `src/lib/refresh-retry.ts` if `sil-client.ts` grows unwieldy, with no behavioural difference. (2) Token-clearing stays at the tool call sites (not inside the helper), matching `identity.ts`'s existing shape — the helper returns the terminal discriminant, the caller owns the credential side-effect. (3) `sil_whoami` is re-pointed onto the helper in this same card (not deferred), because leaving it inline reintroduces the very drift the card removes. If the founder wants whoami left untouched, that is a scope reduction to flag — but the Intent explicitly says "reuse `sil_whoami`'s path — do not fork a second 401 handler", so adopting the helper there is the faithful reading.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

<!-- specific guidance for the dev pair: where to start, constraints,
test strategy -->

<!-- solutions-architect -->

**Where to start (build order).**
1. **Write the helper first, with its unit test (RED→GREEN).** Add `refreshAndRetryOnce<O>(first, isUnauthorized, retryWithToken): Promise<RefreshRetryResult<O>>` + the exported `RefreshRetryResult<O>` union to `src/lib/sil-client.ts` (or `src/lib/refresh-retry.ts` — colocate with `refreshStoredTokens` either way). qa-developer writes `src/__tests__/lib/refresh-retry.test.ts` covering the six `[unit]` ACs (one-refresh-max, second-401, dead-refresh-no-retry, refresh-retryable, TOCTOU, non-401-passthrough) against a stubbed `refreshStoredTokens` + stub `retryWithToken`. The helper has no I/O of its own beyond calling `refreshStoredTokens`/`readTokens`, so it unit-tests cleanly.
2. **Re-point `sil_whoami` onto the helper.** Replace `identity.ts:175-208` with the helper call. The existing `whoami.integration.test.ts` is the regression net — it must stay GREEN unchanged (behaviour is identical; only the loop's *home* moves). If any whoami integration assertion breaks, the refactor changed behaviour — stop and reconcile.
3. **Bring the two catalog tools onto the helper.** Replace the `case "unauthorized":` terminal arms in `catalog.ts` (search `:142-144`, product_get `:242-244`) with the helper call + `RefreshRetryResult` mapping (see Affected files for the exact arm-by-arm map). Add the `clearTokens`/`refreshAndRetryOnce` imports.
4. **Rewrite the catalog integration tests.** qa-developer rewrites the terminal-401 `describe` blocks in `catalog-search.integration.test.ts` (`:567-609`) and `catalog-lookup.integration.test.ts` (`:548-647`) to the refresh-and-retry-once choreography, and adds a `refresh` route to each test's fetch double. The whoami `installRouter` (`whoami.integration.test.ts:122-193`) is the copy-from template — it already routes `/auth/refresh`, records method/bearer/body, and exposes `identity`/`refresh`/`all` buckets for call-count assertions. The catalog doubles currently route only `search`/`lookup`-vs-`other`; extend them the same way.
5. **Add the cross-tool parity integration test** (the two parity ACs) — drive the identical expired-token + 401 scenario through all three tools and assert the same choreography + envelope classes. This is the structural guard against FLAG-10 re-entry; it must fail if any one tool drifts.

**Constraints (non-negotiable).**
- **No new refresh machinery.** Reuse `refreshStoredTokens`/`refreshSession`/`classifyRefreshResponse`/`readTokens`/`writeTokens` exactly as whoami does. If you find yourself writing a new fetch to `/auth/refresh`, stop — `refreshStoredTokens` already is it.
- **No backwards-compat.** Delete the terminal `case "unauthorized":` bodies and the "401 terminal here / no transparent refresh / additive follow-on" comments in `catalog.ts` + `sil-client.ts`. Do not keep an old terminal path beside the new one.
- **Strict types, no `any` at the helper boundary.** `O` stays parametric via the `isUnauthorized` predicate + `retryWithToken` thunk. No cast that pins a concrete outcome union inside the helper body. The classifiers keep returning `{ kind: "unauthorized" }` — unchanged.
- **At most one refresh + one retry per call.** This is structural in the helper (no loop). The second-401 and dead-refresh paths are terminal. `clearTokens()` fires only on `invalid_grant` and `second_unauthorized` (never on `no_stored_tokens`/`retryable`/403/5xx).
- **Stub-free, real auth path.** Mirror the whoami tests: real `sil-client` + `credentials` + `refreshStoredTokens`, only `fetch` mocked, real `SIL_DATA_DIR` temp dir + token seeding. No `AUTH_DEV_BYPASS`, no stubbed refresh, no mocked-logic shortcuts. Privacy invariant (no token/PII in logs or payload) holds across the new refresh path.

**Test strategy / tiers.** Union = **unit + integration** (no e2e — this repo has no host-load gate; the true cross-service proof is sil-stage's deferred e2e, consistent with the existing integration headers). Unit tier owns the pure helper's bounded-loop invariants in isolation. Integration tier owns every *wired-tool* behaviour (the four 401 outcomes per catalog tool, the call-count/origin/clear-tokens assertions, and cross-tool parity) — because the value is in the real `sil-client`+`credentials`+`refreshStoredTokens` wiring, exactly as `whoami.integration.test.ts` proves it for whoami. The `manifest-contract.integration.test.ts` drift guard is unaffected (no tool added/removed).

## In Dev — expert-developer, qa-developer

**What was built (GREEN phase).** The solutions-architect's verdict implemented verbatim: one generic helper, three unified call sites, `sil_whoami` re-pointed off its inline copy.

- **`src/lib/sil-client.ts`** — ADDED `refreshAndRetryOnce<O>(first, isUnauthorized, retryWithToken): Promise<RefreshRetryResult<O>>` + the exported `RefreshRetryResult<O>` union, placed directly after `refreshStoredTokens` (its sole collaborator). The control flow is the choreography: non-401 first ⇒ `{ result, first }` (no refresh, no retry); 401 ⇒ `refreshStoredTokens()` once ⇒ `must_reregister` (reason passed through) / `retryable` both terminal-no-retry ⇒ `refreshed` ⇒ **re-read the rotated pair via the module's `readTokens()`** (TOCTOU: `null` ⇒ `must_reregister/no_stored_tokens`, no retry) ⇒ `retryWithToken(rotated.access_token)` once ⇒ `isUnauthorized(retry)` ⇒ `second_unauthorized`, else `{ result, retry }`. No new refresh machinery; classifiers' `if (status === 401) return { kind: "unauthorized" }` bodies untouched. Deleted the "401 terminal / no refresh / additive follow-on" comments on the wire-contract block, `SearchOutcome`, `LookupOutcome`, `classifySearchResponse`, `classifyLookupResponse`.
- **`src/tools/catalog.ts`** — both `case "unauthorized":` terminal arms replaced. Each `execute` now: `first = await searchCatalog/lookupCatalog(...)` → `refreshAndRetryOnce(first, o => o.kind === "unauthorized", at => searchCatalog/lookupCatalog(getSilApiUrl(), at, params/ids))` → switch the `RefreshRetryResult`: `result` ⇒ `mapSearchOutcome`/`mapLookupOutcome` (the ok/invalid_request/retryable tail, factored out); `must_reregister` ⇒ `clearTokens()` iff `invalid_grant` + `mustReregister(tool)`; `second_unauthorized` ⇒ `clearTokens()` + `mustReregister(tool)`; `retryable` ⇒ `transient(tool)`. New imports: `clearTokens`, `refreshAndRetryOnce`. Updated the two `execute`-flow header comments + the `mustReregister` doc-comment.
- **`src/tools/identity.ts`** — `sil_whoami`'s inline 401 block (the old `:169-208`) replaced with the same `refreshAndRetryOnce` call so there is exactly ONE choreography. Dropped the now-unused `refreshStoredTokens` import, added `refreshAndRetryOnce`. The `identityOutcomeToResult` `case "unauthorized":` unreachable-guard stays (the `result` outcome is structurally never `unauthorized`). Updated the `execute()` flow doc-comment.

**Decisions / trade-offs.**
- **Logging: dropped the success-path `sil_whoami_refreshed` info marker; kept the failure markers** (`<tool>_must_reregister` with `{ cause }`, `<tool>_refresh_retryable`) — and gave the two catalog tools the SAME markers, so operator observability is now *uniform* across the three tools rather than whoami-only. Rationale: logging is caller-owned (the helper does no I/O-logging), and the `RefreshRetryResult` union (pinned exactly by `refresh-retry.test.ts`) does not distinguish "result from passthrough" vs "result from retry", so the caller cannot cheaply know a refresh happened on the success path. No test asserts the `_refreshed` line; the success path is "invisible" by product design (outcome 1), and the diagnostic value (was the refresh path taken? did it dead-end?) is fully carried by the terminal/transient markers. This is a deliberate, uniform simplification, not an omission — flagged for the distiller.
- **The `mapSearchOutcome`/`mapLookupOutcome` `case "unauthorized":` arms are structurally unreachable** but kept exhaustive (they fall to the same terminal `mustReregister`) so a future refactor can't silently drop a variant — mirrors the existing `identity.ts` `identityOutcomeToResult` guard.
- **Helper stays generic over `O`** via the `isUnauthorized` predicate + `retryWithToken` thunk — no `any`, no cast pinning a concrete union inside the helper body (the generic-erosion risk the architect named). The predicate annotated `(o): boolean => o.kind === "unauthorized"` at each site.

**Test approach (qa wrote RED at `963865d`; dev made GREEN).** Full suite **372 passed / 0 failed**; typecheck + build clean. The TOCTOU unit test spies `vi.spyOn(credentials, "readTokens")` and relies on the helper's internal re-read hitting that live module binding — confirmed working (native ESM + Vitest 4 makes the namespace export mutable; the same binding `refreshStoredTokens` already uses for its pre-read). The whoami integration suite (16/16) is the regression net proving the re-pointing preserved observable behaviour exactly.

### → Handoff to Review (next agent: code-quality-guardian)

Runs against PR #11's diff (3 files: `sil-client.ts`, `catalog.ts`, `identity.ts`). Scrutinize:

- **The helper's outcome mapping is faithful and complete.** Each `RefreshRetryResult` variant maps to the right envelope at all three sites; `clearTokens()` fires on exactly `invalid_grant` + `second_unauthorized` and NOWHERE else (not `no_stored_tokens`, not `retryable`, not 403/5xx via `result`). The at-most-one-refresh bound is structural (no loop in the helper) — confirm there is no second `refreshStoredTokens` path.
- **Three-site parity is real, not three copies.** All three tools *call* the one helper (not re-inline the loop). `cross-tool-401-parity.integration.test.ts` is the structural guard (FLAG-10 canary) — it set-compares `refreshCount`/envelope class across tools and fails on drift.
- **Stub-free compliance.** No stubbed refresh, no `AUTH_DEV_BYPASS`; integration exercises the real `sil-client` + `credentials` + `refreshStoredTokens` against a mocked `fetch` only.
- **No backwards-compat residue.** The terminal-only 401 branches and the "single round-trip / no transparent refresh / additive follow-on" comments are *gone*, not commented-out or kept beside the new path. Grep the diff for any surviving "no refresh in this card"-style language.
- **No `any` at the helper boundary** — `O` stays parametric; reject any cast smuggling a concrete union into the helper body.
- **The deliberate logging trade-off** (dropped success-path `sil_whoami_refreshed`, uniform failure markers across all three) — confirm it is acceptable or flag it; no test depends on it.

## Review round 1 — code-quality-guardian

**Verdict: REVIEW.** Runs against PR #11's diff (commits `963865d` RED + `dd75853` GREEN). Gate confirmed green locally: `pnpm typecheck` clean (strict, no errors), `pnpm test` **372 passed / 0 failed** (29 files). The consolidation is excellent and the auth-choreography is structurally correct and secure; one real-but-narrow observability regression (P2) holds this at REVIEW rather than PASS. No P1.

**What is PASS-grade (the headline checks all hold):**

1. **Consolidation — the headline — is genuinely achieved (PASS).** All three sites route through the ONE helper: `refreshAndRetryOnce(` is called at exactly `identity.ts:178`, `catalog.ts:144`, `catalog.ts:280` — and nowhere else. `refreshStoredTokens()` is invoked in exactly ONE place in non-test src (`sil-client.ts:748`, inside the helper) — there is no fourth un-deduplicated 401 path. `sil_whoami` truly re-points off its old inline block (the old `origin/main:identity.ts` inline refresh/re-read/retry is gone; it now calls the helper identically to the catalog tools). Zero residual copy-paste. The cross-tool parity test (`cross-tool-401-parity.integration.test.ts`) is a *real* shared-behaviour guard, not three copies: it drives the same expired-token+401 scenario through all three tools and collapses each dimension (`status` / `refreshCount` / `readCount` / `tokensCleared`) to a `Set`, asserting size 1 — and includes an explicit FLAG-10 canary (`:414`) that fails if any one tool's `refreshCount` diverges. The divergence cannot silently return.

2. **Auth-choreography correctness + security (OWASP token-handling) — confirmed STRUCTURALLY (PASS).** The helper (`sil-client.ts:739-771`) is straight-line `first → refresh → re-read → retry` with NO loop — at-most-one refresh and at-most-one retry are structural, not happy-path. Second-401 → `second_unauthorized` terminal, never a second refresh (`:765-768`). Dead refresh (`invalid_grant` / `no_stored_tokens`) → terminal, NO retry (`:749-751`). Transient refresh (5xx/network/thrown) → `retryable`, NO retry (`:752-754`), tokens NOT cleared. The post-rotate re-read goes through the module's `readTokens` (`:759`) — TOCTOU-safe, `null` ⇒ `must_reregister/no_stored_tokens` with no retry. `clearTokens()` fires on exactly the two clearing terminals (`invalid_grant` guarded + `second_unauthorized`) at all three sites — never on `no_stored_tokens`/`retryable`/`result`. The unit test asserts refresh/retry COUNTS (storm guard at the unit boundary), and the TOCTOU test isolates the helper's own re-read via a `readTokens` spy — both run the REAL `refreshStoredTokens` against a mocked `fetch` only (stub-free). **No token material leaks**: the Bearer header is built in the client and never logged; the privacy invariant is genuinely tested — `valid-rt`/`expired-at`/`rotated-*` literals asserted absent from BOTH the result blob and the logs across the refresh path (`catalog-search.integration.test.ts:693-706`, and parity-wide).

3. **Strict typing (PASS).** `refreshAndRetryOnce<O>` stays parametric — the helper only ever returns an `O` produced by `first` or `retryWithToken`, never fabricates one, and inspects `O` only via the caller's `isUnauthorized` predicate. No `any`, no casts pinning a concrete union into the helper body (grep-confirmed zero `: any` / `as any` / `<any>` in all three impl files). The `(o): boolean => o.kind === "unauthorized"` predicate is annotated at each call site. `RefreshRetryResult<O>` is a clean discriminated union. `tsc --noEmit` passes.

4. **Stub-free + no backwards-compat residue (PASS).** Grep for "no transparent refresh / additive follow-on / single round-trip / 401 is terminal" in non-test src returns NOTHING — the terminal-401 branches and the deferral comments are deleted, not kept alongside. No `AUTH_DEV_BYPASS`, no `NODE_ENV` auth bypass. The old catalog terminal-401 `describe` blocks (incl. `not.toContain("/auth/refresh")`) are removed from both catalog integration suites; they now exercise refresh+retry. Tier coverage matches: `tiers: [unit, integration]` ↔ unit helper test + integration suites present; no e2e (correct — no host-load gate in this repo).

Complexity/bloat/anti-patterns: clean. The helper is ~30 lines, cyclomatic ~6, no nesting >2. The structurally-unreachable `case "unauthorized":` arms in `mapSearchOutcome`/`mapLookupOutcome`/`identityOutcomeToResult` are kept exhaustive *deliberately* (a future refactor can't silently drop a variant) and fall to the same terminal — that is correct exhaustiveness, not dead code. API/error envelopes are consistent across the three tools (shared `mustReregister`/`transient`/`notRegistered` vocabulary).

**P2 — the one finding that holds this at REVIEW: the silent-success refresh path is now UNOBSERVABLE, a regression against this card's own committed seam.**

- **What changed.** `origin/main:identity.ts:190` emitted `api.logger.info("sil_whoami_refreshed", {})` on the silent-success path (401 → good refresh → retry ok). The new code (`identity.ts` + both catalog tools) emits **no marker** on that path at any of the three tools. The failure markers ARE now uniform across all three (`<tool>_must_reregister {cause}`, `<tool>_refresh_retryable`) — a genuine improvement over whoami-only — but the *success* marker was dropped entirely rather than made uniform.
- **Why this matters (not nitpicking).** The product contract that the refresh is invisible is a **payload** concern (no `refreshed` flag in the agent-facing result) — that is correctly honored and must stay. Operator log observability is a *separate* axis, and this card's Discovery explicitly relied on it: the risk "Silent refresh hides a degrading session from the user" (card line 161) is mitigated *by name* with "the refresh event is still observable to operators via the existing non-credential log markers (`sil_*_refreshed` / `sil_*_must_reregister`)". A session that refreshes on nearly every call (TTL/cadence wrong upstream) is exactly the degrading-session signal an on-call engineer needs — and it is now **completely invisible in logs** (the failure markers don't fire on a *successful* refresh). Per the `code-logging` skill, a successful token refresh is a logworthy state transition + external-call + retry-attempt — not a "success case with no debugging value." This is strictly less observable than BOTH the prior whoami baseline and what the card's own risk mitigation commits to.
- **Verdict on the trade-off (the adjudication the handoff asked for):** the expert's reasoning — "uniform failure markers, and `RefreshRetryResult` doesn't distinguish result-from-passthrough vs result-from-retry so the caller can't cheaply know a refresh happened" — is honest but the obstacle is trivially removable, and the chosen resolution sacrifices a seam the card promised. **Do not accept the drop as-is; restore a uniform success marker.**

### → Handoff back to In Dev (if FAIL/REVIEW)

**Priority: P2 (no P1, no P3). One change, well-scoped. Keep everything else exactly as built — the consolidation, the helper, the invariants, and the uniform failure markers are all correct and should not be touched.**

1. **Restore an observable, uniform refresh-success marker across all three tools.** The silent-success path (helper returns `{ kind: "result" }` *after* a refresh+retry) must emit one non-credential info marker per tool — `sil_search_refreshed`, `sil_product_get_refreshed`, `sil_whoami_refreshed` — mirroring the now-uniform failure markers. This restores the `sil_*_refreshed` seam the card's risk-mitigation (line 161) names, and makes it uniform across all three (strictly better than the whoami-only baseline that existed before). It must NOT add any field to the agent-facing payload — outcome 1's invisible-to-the-agent contract stays inviolate; this is logs-only.
   - **The blocker the expert named is removable in the helper, cleanly and still strict-typed.** The `result` variant currently can't tell passthrough from post-retry. Make the helper carry that bit — e.g. widen the success discriminant of `RefreshRetryResult<O>` so the caller can distinguish them. Two acceptable shapes (dev's choice):
     - add `refreshed: boolean` to the `result` variant: `{ kind: "result"; outcome: O; refreshed: boolean }` (passthrough at `sil-client.ts:745` returns `refreshed: false`; the post-retry return at `:770` returns `refreshed: true`); the caller logs the marker iff `refreshed`; **or**
     - split the success kind: keep `{ kind: "result"; outcome: O }` for passthrough and add `{ kind: "recovered"; outcome: O }` for the post-refresh-retry success — the caller maps both to the same envelope but logs the marker only on `recovered`.
   - Either keeps `O` parametric (no `any`, no cast) and keeps the bound structural — it only surfaces a bit the helper already knows from its own control flow.
2. **Extend the helper unit test** (`refresh-retry.test.ts`) to pin the new discriminant: the one-refresh-success case asserts the `refreshed:true`/`recovered` signal; the non-401-passthrough case asserts `refreshed:false`/`result`. This keeps the "caller can know a refresh happened" contract enforced by test, not convention.
3. **Add a success-marker assertion to the cross-tool parity test** (`cross-tool-401-parity.integration.test.ts`, the retry-ok sub-outcome at `:329`): assert each tool emitted its `<tool>_refreshed` info marker exactly once — folding the restored seam into the same anti-divergence guard so it, too, cannot drift per-tool. (The mock `api.logger` already records calls; assert on it as the existing per-tool suites do.) The token-leak canary already covers that no token value appears in that marker — keep it.

No other changes requested. Re-run `pnpm typecheck` + `pnpm test` (expect green), push to the same branch/PR #11, and the next tick re-spawns the dev pair's output back to review.

## In Dev round 2 — expert-developer

**Addressed the round-1 P2 (restored the uniform `<tool>_refreshed` marker + `refreshed` discriminant).** qa committed the RED at `b22ded0` (7 new assertions on top of GREEN `dd75853`); this round turns them green with the one scoped change the reviewer's `→ Handoff back to In Dev` prescribed (option 1 — widen the success variant), commit `c8f9ed4`.

- **`src/lib/sil-client.ts`** — widened the `RefreshRetryResult<O>` `result` variant to `{ kind: "result"; outcome: O; refreshed: boolean }`. Set `refreshed: false` at the first-try passthrough return (the `!isUnauthorized(first)` branch) and `refreshed: true` at the post-refresh-retry success return. `O` stays parametric — no `any`, no cast; the at-most-one-refresh bound stays structural (the helper just surfaces a bit it already knew from its own control flow). Updated the union's doc-comment to document the discriminant.
- **`src/tools/identity.ts` (`sil_whoami`), `src/tools/catalog.ts` (`sil_search`, `sil_product_get`)** — in each `case "result":` arm, emit `api.logger.info("<tool>_refreshed", {})` iff `recovered.refreshed`, then return the existing mapping unchanged. Markers: `sil_whoami_refreshed`, `sil_search_refreshed`, `sil_product_get_refreshed` — matching the existing structured-marker shape (marker name = first positional arg, empty meta `{}`, no token material). NOT emitted on first-try (`refreshed: false`) success — qa's negative assertions pin that.

**Logs-only — the agent-facing payload is untouched.** No new field on any result envelope; outcome 1's invisible-to-the-agent contract stays inviolate. The restored seam is now *uniform* across all three tools (strictly better than the whoami-only `origin/main` baseline the consolidation had regressed), and folded into the cross-tool parity guard (`cross-tool-401-parity.integration.test.ts`) so it cannot drift per-tool again.

**Green gate:** `pnpm typecheck` clean (the 3 union type errors resolved on widening the variant), `pnpm test` **372 passed / 0 failed** (the 7 RED assertions now green, zero regressions across 29 files), `pnpm build` exit 0. Pushed `c8f9ed4` to PR #11 (fast-forward `dd75853..c8f9ed4`). Nothing else touched — every PASS-grade item from round 1 (the consolidation, the helper, the invariants, the uniform failure markers, stub-free/no-backcompat) is unchanged.

### → Handoff to Review round 2 (next agent: code-quality-guardian)

The diff since round 1 is exactly the P2 fix: 3 src files, +29/-3. Scrutinize only the delta — the rest was already PASSed.

- **The `refreshed` discriminant is faithful.** `false` at passthrough, `true` post-retry, set from the helper's own straight-line control flow (no new branch, no loop added). `O` stays parametric — confirm no `any`/cast crept into the widened variant.
- **The marker fires on exactly the silent-recovery path, uniformly.** Each tool emits `<tool>_refreshed` iff `recovered.refreshed`; never on first-try success (negative assertions pin it), never on a terminal/transient. No token material in the marker meta (`{}`), no payload field added.
- **The seam is folded into the anti-divergence guard.** The parity test now also collapses `<tool>_refreshed` count to a set of size 1 across the three tools — so the restored marker cannot disappear per-tool the way the original divergence (FLAG-10) did.

## Review round 2 — code-quality-guardian

**Verdict: PASS.** The round-1 P2 (silent-success refresh path unobservable) is genuinely and completely resolved by the prescribed fix; no new issues introduced; nothing PASS-grade from round 1 disturbed. Gate green locally: `pnpm typecheck` exit 0 (strict, no errors), `pnpm test` **372 passed / 0 failed** (29 files). Re-reviewed only the delta `dd75853..c8f9ed4` (qa RED `b22ded0` + expert GREEN `c8f9ed4`); round-1 PASS items (consolidation, the one helper, the at-most-one-refresh/TOCTOU/second-401 invariants, OWASP token-handling, strict typing, stub-free, no-backcompat) were re-confirmed undisturbed, not re-litigated.

**P2 resolution — verified against all five round-2 criteria:**

1. **The seam is restored, uniformly, and logs-only (CONFIRMED).** All three tools emit their `<tool>_refreshed` INFO marker on the silent-recovery path, gated on `recovered.refreshed`, inside the `case "result":` arm ONLY: `sil_search_refreshed` (`catalog.ts:154`), `sil_product_get_refreshed` (`catalog.ts:294`), `sil_whoami_refreshed` (`identity.ts:190`). Each carries empty meta `{}` — **no token material**. It is **NOT** a payload field: the integration tests assert `payload["sil_*_refreshed"]` is `undefined` on the recovery path (`catalog-search.integration.test.ts:662`, `catalog-lookup` mirror, `whoami.integration.test.ts:450`) — outcome-1 invisibility to the agent stays inviolate. It is **NOT** emitted on first-try (no-refresh) success: the `if (recovered.refreshed)` gate ensures it, and the happy-path tests pin `infoMarkerCount(... "sil_*_refreshed") === 0` (search `:455`, whoami `:393`, product_get mirror). The privacy invariant is tested on the marker itself — its serialized args contain no `rotated-at`/`rotated-rt`/`valid-rt`/`expired-at` and no `Bearer`.

2. **The discriminant is clean (CONFIRMED).** `RefreshRetryResult<O>`'s result variant widened to `{ kind: "result"; outcome: O; refreshed: boolean }` (`sil-client.ts:713`). `O` stays parametric — grep across all three impl files returns ZERO `: any` / `as any` / `<any>` / `as unknown`. No cast pins a concrete union into the helper body. `refreshed: false` is set at the first-try passthrough return (`:756`), `refreshed: true` at the post-refresh-retry success return (`:784`) — the helper merely surfaces a bit its own straight-line control flow already knew. The at-most-one-refresh bound stays **structural**: no new branch, no loop; `refreshStoredTokens()` is still invoked at exactly one site (`:759`); second-401 ⇒ `second_unauthorized` (`:779`) before any second refresh path could exist.

3. **The seam can't drift again (CONFIRMED).** Pinned at two tiers. Unit (`refresh-retry.test.ts`): the one-refresh-success case asserts `result.refreshed === true` (`:226`), the two passthrough cases assert `result.refreshed === false` (`:435`, `:470`). Cross-tool parity (`cross-tool-401-parity.integration.test.ts`): the retry-ok sub-outcome asserts each tool's `refreshedMarkerCount === 1` (`:375`) AND collapses `refreshedMarkerCount` across the three tools to a `Set` of size 1 (`:385`) — folding the restored marker into the same FLAG-10 anti-divergence guard. A tool that silently recovered without emitting its marker shows 0 while the others show 1 → set size 2 → fail. The same divergence mode (per-tool logging drift) is now structurally guarded.

4. **No scope creep (CONFIRMED).** `git diff --numstat dd75853..c8f9ed4` on src = `sil-client.ts +17/-3`, `catalog.ts +8/-0`, `identity.ts +4/-0` (the claimed +29/-3 across exactly 3 files; all additive except the union-variant widening). Only the discriminant + the three gated markers + their doc-comments changed. No-backcompat scan (deferral / terminal-401 / legacy / deprecated language in non-test src) returns NONE. The uniform failure markers (`_must_reregister {cause}`, `_refresh_retryable`), the helper control flow, the `clearTokens()` scoping, and the consolidation are byte-for-byte unchanged from round 1.

5. **Suite green (CONFIRMED).** 372/0 as expected; typecheck clean; build was reported exit 0 by the dev (the type errors resolved on widening the variant, consistent with a clean typecheck here).

The fix is exactly option 1 from the round-1 `→ Handoff back to In Dev`, executed cleanly. This is the canonical good shape for making a consolidated silent-recovery path observable to operators without leaking into the agent-facing payload. No findings — no P1, no P2, no P3.

**Status → `distilling`.** The orchestrator routes distilling → solutions-architect next; no handoff block (the distiller reads the merge-target diff directly).

## Distillation — solutions-architect

Searched all three INDEX files first (`docs/decisions/`, `docs/knowledge/`, `docs/product/`) and read the closest existing docs (`sil-two-origin-model`, `sil-response-classification`, `sil-api-identity-contract`, `sil-shared-catalog-client`) before writing anything.

**One new decision doc — the one genuinely non-obvious, cross-cutting constraint:**

- **`docs/decisions/sil-uniform-401-refresh-retry.md` (NEW)** — *Every sil-api-calling tool MUST route its 401 through the single generic `refreshAndRetryOnce<O>` helper (`sil-client.ts:747`), never a per-tool handler.* This is the FLAG-10 divergence-class killer and it **constrains the next sil-api tool added** (cart/checkout/order/…): write no terminal `case "unauthorized":` arm, call the helper, and add the tool to `cross-tool-401-parity.integration.test.ts`. Captures: the helper-vs-inline verdict + the two rejected alternatives; the helper/caller seam (helper owns the structural at-most-one-refresh bound + TOCTOU re-read + `RefreshRetryResult<O>` discriminant; caller owns predicate, retry thunk, envelope, `clearTokens()` scoping, logging); the two-axis observability contract (silent in payload, visible in logs via the uniform `<tool>_refreshed` marker); and the parity-test drift guard. Why a decision doc and not inline-only: the *implementation* is already richly self-documenting inline, but the **constraint on a future tool** is only discoverable from the decisions INDEX — the two sibling decision docs (`sil-shared-catalog-client`, `sil-two-origin-model`) each carry a "constraint on future work" section a tool author reads, and neither covered 401-recovery. A 4th tool author would otherwise re-fork a terminal handler (the exact regression). Distinct concern from both ⇒ new doc, one-topic-per-doc.

**Cross-link bumps (existing docs — wikilink added, no material body change, so `commit` left as-is; `updated_at`/`updated_by_card` bumped):**

- **`docs/decisions/sil-shared-catalog-client.md`** — added a line to the "constraint on future catalog tool" section pointing at the 401-recovery constraint (`[[sil-uniform-401-refresh-retry]]`), so a catalog-tool author hits it on the trail they already read.
- **`docs/decisions/sil-two-origin-model.md`** — added the cross-origin handshake pointer to its closing "see also" (401 on a sil-api read → refresh against sil-web → retry the sil-api read = the shared choreography).
- **`docs/decisions/INDEX.md`** — new row at top; both bumped rows' `Updated` cells moved to 2026-06-10; sorted newest-first.

**Deliberately NOT captured (would restate the code):**

- *The two-axis observability nuance as a standalone `docs/knowledge/` doc.* Already captured at the smallest viable scope — comprehensive inline WHY at `sil-client.ts:690-784` (the `RefreshRetryResult` union doc + the helper choreography doc, both documenting `refreshed: true/false` ⇒ logs-only marker, never a payload field) and at each call-site `case "result":` arm (`catalog.ts:154`, `:294`; `identity.ts:190`). The decision doc *references* those inline locations rather than re-stating them. No new inline comments were warranted — every relevant site is already self-documenting.
- *The bounded-loop invariants / TOCTOU / second-401 mechanics* — fully covered by the inline choreography comment + the unit suite (`refresh-retry.test.ts`) that pins each. Restating them in docs/ would be theater.

- INDEX.md updated: decisions (1 new row + 2 date bumps).

## PR Ready

PR #11 — https://github.com/Context4GPTs/sil-openclaw/pull/11

Distillation pushed to the same branch/PR (fast-forward, no `--force`): 1 new decision doc + 3 modified docs (`INDEX.md`, `sil-shared-catalog-client.md`, `sil-two-origin-model.md`). No `src/` changes (the implementation was already self-documenting inline — nothing to add). Card flipped to `pr-ready` locally (gitignored — stays in the worktree). Awaiting founder merge on GitHub; no auto-merge.

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
