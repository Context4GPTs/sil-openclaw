---
type: card
title: sil-identity-read-verb-fix
slug: sil-identity-read-verb-fix
work_type: bug
tiers: [unit, integration]
status: done
agents: []
priority: 1
created: 2026-06-08
updated: 2026-06-08
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-sil-identity-read-verb-fix
branch: card/sil-identity-read-verb-fix
pr: https://github.com/Context4GPTs/sil-openclaw/pull/5
merged_commit: 414e600201701281aa41e77272d17196c319bc68
epic_id: identity-plugin-tools
origin: goal:identity-onboarding-slice
---

## Intent (founder)

**Symptom:** `sil_whoami` returns `retryable` instead of real identity data (`{ name, addresses }`) — the tool never surfaces the user's actual name or addresses even after a successful registration and onboarding flow.

**Repro:** Register via `sil_register`, complete Auth0 login + onboarding form (name + address). Then invoke `sil_whoami`. Always reproduces.

**Expected vs actual:** Expected: `{ status: "ok", identity: { name, addresses } }` with the user's real data from sil-api. Actual: `fetchIdentity` POSTs to `/identity` on sil-api, which hits the unauthenticated enrich **stub** (returns `{kind, verified, subject}` — no `name` field). `extractIdentity` finds no name → returns `retryable`.

**Hypothesis:** HTTP verb mismatch. sil-api's real authenticated identity self-read is at `GET /identity` (merged in PR #7, `handlers/identity.ts`), but `fetchIdentity` in `src/lib/sil-client.ts` uses `POST`. The fix is switching `fetchIdentity` to GET (and removing the request body, since the GET endpoint derives the user from the JWT `req.user`).

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

- 2026-06-08 qa-developer (in-dev) — distillation-note: `docs/knowledge/sil-response-classification.md` is STALE after this fix — its red-test count (~:23) and its "empty-addresses reject is an open edge" lines (~:29-31) no longer hold (empty `addresses: []` is now legitimately `ok`; the gate changed). The distilling solutions-architect must refresh it. (Surfaced by qa in its in-dev handoff; recorded by the orchestrator so it travels to the distilling stage.)

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

<!-- solutions-architect owns the recommended technical fix + implementation-level
alternatives (verb/endpoint confirmation against sil-api PR #7). product-owner's
product-framing notes below. -->

**Confirmed root cause (solutions-architect — verified end-to-end against the merged plugin AND sil-api code, not assumed).**

`fetchIdentity` (`src/lib/sil-client.ts:260-273`) issues `POST <silApiUrl>/identity` with body `{ agent_id }` and `Authorization: Bearer <token>`. On sil-api, `POST /identity` is the **enrich stub** (`sil-services/services/sil-api/src/handlers/register-domain.ts:33-40` + `handlers/identity.ts:26-32,95`): it returns the UCP envelope wrapping `{ kind, verified, subject, attributes, note }` — **no `name`, no `addresses`**. The real authenticated self-read is a **separate route, `GET /identity`** (`handlers/identity.ts:101-109`, sil-api PR #7 / commit `7d941ea`), which derives the user from `req.user` (the `UserRow` the JWT preHandler decorates — `middleware/auth.ts:440`), loads their addresses, and returns `{ id, name, addresses }` enveloped under `result`. Because the plugin POSTs, it hits the stub; the stub body has no `name`; `extractIdentity` (`src/lib/sil-client.ts:325-343`) returns `null` (it requires a `name`); so `classifyIdentityResponse` (`:197-206`) maps the 200 → `retryable`. **The founder's verb hypothesis is CONFIRMED: it is a verb/endpoint mismatch — POST-stub vs GET-self-read.**

**The Authorization header is already correct — this is NOT an auth-header bug.** The intent calls the current call "unauthenticated"; it is not. `fetchIdentity:267` already sends `Bearer <token>`, and the GET route validates exactly that header (`middleware/auth.ts:417,440`). The header construction carries over to the GET unchanged.

**Recommended fix (the minimum that restores the live read).** In `fetchIdentity` only: change the request from `POST … { agent_id }` to a **GET** with **no body** (the GET route takes no request body — `handlers/identity.ts:101-103` declares only a `response` schema; the principal is `req.user` from the JWT). Keep the `Authorization: Bearer <token>` header. This needs a `getJson(url, { authorization })` path alongside the existing `postJson` (or a `method`-parameterised request helper) — the timeout/abort, header-merge, and never-log-the-token invariants all carry over unchanged. **Plus the empty-addresses relax in `extractIdentity` that the PO's product framing forces (see below)** — I concur and the sil-api contract now *grounds* it: `handlers/identity.ts` + `packages/schemas/src/identity.ts:63,71-72` explicitly return `addresses: []` for a provisioned user with no address, so the strict `addresses.length === 0` reject (`sil-client.ts:340`) would strand a real authenticated user on a false `retryable` forever. Relax `extractIdentity` to: usable iff `name` is a non-empty string AND `addresses` is an array (drop the non-empty-array requirement). The `name` requirement stays — that is what keeps the anti-false-green guard biting against the stub shape (stub has no `name`).

**Implementation-level alternatives ruled out (solutions-architect):**
- **Trust the intent's "unauthenticated stub" framing and add/repair an Authorization header.** Rejected: verified `fetchIdentity:267` already sends the Bearer correctly; the header is not the defect. The defect is verb+path. Chasing the header wastes the fix and risks touching the (correct) refresh path.
- **Add `on_behalf_of` to the request to "scope" the read.** Rejected: the GET self-read sends no body at all; `on_behalf_of` only exists on the POST `SimplifiedAgentRequest`, and on sil-api an `on_behalf_of` ≠ token-sub is a guaranteed **403 `principal_mismatch`** (`middleware/auth.ts:433-438`). Switching to a bodyless GET *eliminates* that 403 path entirely — a strict improvement; the self-read principal is always the JWT subject.
- **Make sil-api's `POST /identity` stub return real `{name, addresses}` instead of switching the plugin verb.** Rejected: that is cross-sibling work in sil-services, and PR #7 *already* shipped the real read at `GET /identity` deliberately (the POST stays the agent enrich-stub for the other domains' uniform shape). The plugin must match the contract that exists; this card is plugin-local by design.
- **Map a no-identity 200 to a new distinct outcome (e.g. `not_onboarded`) instead of `retryable`.** Rejected as out-of-scope: the merged taxonomy already routes "valid token, unprovisioned user" to the **403 `forbidden`/`user_not_provisioned`** terminal (`middleware/auth.ts:221,381`), which the plugin surfaces with an onboarding hint. A real 200 that lacks `name` is a server fault (the GET always populates `name` from `req.user`), so `retryable` is the honest classification. No new outcome is warranted.

**Product framing (product-owner).** This is a regression fix on a flow `sil_whoami` already specifies completely (see `cards/done/2026/sil-whoami-tool.md`): the *proof-of-identity* tool returns the registered human's real `{name, addresses}`, live from sil-api with the stored Bearer token. The behavioral contract, the refresh choreography, and the error taxonomy are all already built and reviewed-PASS — **nothing about the product promise changes here.** The bug is that the tool, post-onboarding, returns `retryable` instead of the user's real identity, so the promise is unmet at runtime. The fix must restore the happy path WITHOUT regressing the two guards that prior card built: (1) the *anti-false-green* gate (a 200 that carries no usable identity must still classify `retryable`, never a false `ok` — see `docs/knowledge/sil-response-classification.md`), and (2) the refresh-once / 401-vs-403 / transient-vs-terminal taxonomy. In product terms: a successful read after onboarding returns identity; a genuinely-not-yet-ready read still correctly says `retryable` — the fix narrows the false-`retryable` to ONLY the legitimately-pending case.

**Two premise corrections (load-bearing — both now confirmed by solutions-architect's root-cause read above, recorded so the dev pair doesn't re-chase the intent's framing).** The founder's `## Intent` is the goal, not the spec; two points in the hypothesis don't match the merged plugin code:

1. **The current call is NOT unauthenticated.** The intent says `fetchIdentity` "hits the unauthenticated enrich stub." But `fetchIdentity` (`src/lib/sil-client.ts:260-273`) already sends `Authorization: Bearer ${token}` (line 267). The defect is the **verb/endpoint/shape mismatch** with the real sil-api read, NOT a missing credential. Framing it as "unauthenticated" would send the dev down the wrong path (chasing a header that is already correct).
2. **The plugin's POST + `{agent_id}` + envelope shape was a deliberate, recorded choice — and its pivot was pre-planned.** The `sil_whoami` card's architect coded `fetchIdentity` against sil-api's *then-current* `POST /identity` stub contract and explicitly recorded (that card's Signals + `docs/knowledge/sil-api-identity-contract.md:43`): *"If the follow-on instead introduces a `GET /me` [or `GET /identity`], it's a one-line pivot in `fetchIdentity` + the mock — a known, cheap change, not a surprise."* The founder's hypothesis (sil-api PR #7 shipped the real read as `GET /identity` deriving the user from JWT `req.user`, no body) is **exactly that anticipated pivot** — and solutions-architect has now confirmed it against sil-api PR #7's `handlers/identity.ts` (see "Confirmed root cause" above). The plugin-side mock + `fetchIdentity` move to match the bodyless GET.

**The empty-addresses decision is now forced (product call — see Open questions).** The `sil_whoami` card deliberately deferred one product decision to "when the real sil-api read lands": `extractIdentity` (`src/lib/sil-client.ts:325-343`) requires BOTH a non-empty `name` AND a non-empty `addresses` array, so a real user with a `name` but **zero addresses** classifies `retryable` — a soft dead-end (`docs/knowledge/sil-response-classification.md:31`, that card's review §"Empty-addresses behavior"). **This card is that landing.** The product decision: **a valid `name` with zero addresses IS a valid identity** — `addresses` is a list that is legitimately empty for a user who has onboarded but not yet added an address, and telling that user "temporarily unavailable, try again" is a false-transient dead-end they can never escape by retrying. So the fix must relax the `addresses.length === 0` reject: identity is usable when `name` is a non-empty string and `addresses` is an array (possibly empty). The anti-false-green guard is **preserved** by keeping the `name` requirement (the stub shape has no `name`, so it still → `retryable`). This is a behavior change beyond the verb swap; it is in-scope because the same `retryable`-instead-of-identity symptom covers both the canonical repro (name+address) and the name-only user, and fixing only the verb would leave the name-only user still broken.

**Product-level alternatives ruled out (product-owner):**
- **Fix only the verb; leave the empty-addresses gate strict.** Rejected: it fixes the canonical repro (user with an address) but leaves a real, authenticated, name-only user stuck on a false `retryable` forever — the same class of bug this card exists to kill. The deferred decision (`sil-response-classification.md:31`) comes due now; punting it re-files the same bug.
- **Relax the gate to accept a 200 with neither name nor addresses (e.g. any 200 → ok).** Rejected: that destroys the anti-false-green guard — the suite could go green against the `/identity` stub, and `sil_whoami` could surface a non-identity placeholder as success. The `name` requirement is the load-bearing half of the gate and must stay (`docs/knowledge/sil-response-classification.md:19`).
- **Return locally-cached `config.json` identity when the live read still fails.** Rejected (re-affirming the `sil_whoami` card's call): the promise is the *live* authoritative record; a silent stale fallback makes the tool lie. The fix is to make the live read succeed, not to mask its failure.
- **Block this card on a live sil-api/Postgres e2e to prove the fix.** Rejected: the in-repo proof is the mocked-boundary integration test shaped to sil-api PR #7's confirmed contract (same model the `sil_whoami` card shipped under). The true cross-service e2e is owned by sil-stage (goal SC9); requiring it here would stall a priority-1 regression on infra this repo doesn't have.

### Affected files / surfaces

**Production change sites (solutions-architect) — both in one file, `src/lib/sil-client.ts`:**
- **`fetchIdentity` (`:260-273`)** — the sole verb/path/body site. Change `POST … { agent_id }` → `GET` with no body; keep the `Authorization: Bearer <token>` header. The `AGENT_ID` constant (`:67`) becomes dead for this call (still used by nothing else — confirm and remove if now unused, or leave if a future POST tool wants it; dev's call).
- **`postJson` (`:376-393`)** — needs a GET sibling. Either add `getJson(url, extraHeaders)` or generalise to a `method`-parameterised `request(...)` helper. Carry over verbatim: the `AbortController`/`REQUEST_TIMEOUT_MS` timeout, the header merge, and the never-log-the-token invariant. A GET sends no `content-type`/body.
- **`extractIdentity` (`:325-343`)** — relax the empty-addresses reject (the PO-forced product decision; I concur — grounded by sil-api returning `addresses: []` for an addressless provisioned user). Drop the `addresses.length === 0 → null` line (`:340`); keep `Array.isArray` and the non-empty-`name` requirement (`:332-333`). Update the doc-comment (`:312-324`) which currently states both fields are required.
- **`IdentityAddress` interface (`:98-105`)** — no change required. It is all-optional and tolerates extra fields; the sil-api `AddressWire` shape (`street_address`/`address_locality`/… — `packages/schemas/src/identity.ts:30-56`) differs from the interface's hint fields (`line1`/`city`/…) but `extractIdentity` only filters on `asRecord(a) !== null`, so addresses pass through untyped. Worth a one-line WHY comment that the wire shape is sil-api's `AddressWire`, not these hint fields.

**No change needed (verified):**
- `src/tools/identity.ts` (the `sil_whoami` tool) — calls `fetchIdentity(getSilApiUrl(), token)` (`:170,196`); the verb/body is fully encapsulated in `fetchIdentity`. The refresh-once / 401-vs-403 / terminal taxonomy is untouched.
- `src/lib/config.ts` `getSilApiUrl()` — the sil-api origin resolution is already correct and used.
- `classifyIdentityResponse` (`:197-206`) — its status branches are correct against the GET route's error taxonomy (401/403/503/5xx all map as the GET emits them); only the body-shape gate moves, and that moves *inside* `extractIdentity`.

**Cross-sibling references (read-only, for the dev — do NOT edit):**
- `sil-services/services/sil-api/src/handlers/identity.ts:101-109` — the GET route the fix targets; confirms no request body, response under envelope `result` = `{ id, name, addresses }`.
- `sil-services/packages/schemas/src/identity.ts` — the `IdentityReadResult` + `AddressWire` wire shapes the mock should mirror.

**Test surfaces that must move with the fix (qa-developer):**
- `src/__tests__/whoami.integration.test.ts` — its fetch router (`installRouter`, `:113-180`) routes on URL substring and **never asserts the HTTP method**, so it is GREEN against the POST today and does NOT catch this bug. It must add a **method assertion** (`init.method === "GET"`) and a **no-body assertion** on the identity request. This is the RED test (see Handoff).
- `src/__tests__/lib/identity-classify.test.ts` — add a case: a 200 with a non-empty `name` and **empty `addresses: []`** must now classify `ok` (the relaxed gate). The existing "name but NO addresses → not ok" cases (`:172-184`) must be updated: name + `addresses: []` is now `ok`; the stub-shape and no-`name` cases stay `retryable`.

### Risks / failure modes

<!-- solutions-architect owns the technical/implementation risks; product-owner's
user-facing risks are grouped below. -->

**Product / user-facing failure modes (product-owner)**

- **Partial fix — verb swapped, name-only user still broken.** If the fix changes only the verb/endpoint and leaves `extractIdentity` requiring `addresses.length > 0`, the canonical repro (name+address) is fixed but a real authenticated user who onboarded a name but no address still gets a false `retryable` — the identical symptom this card targets, re-filed. The empty-addresses relax (see Approach) must ship in the same change.
- **Anti-false-green guard regressed.** If, while relaxing the address requirement, the `name` requirement is also dropped, the suite can go green against sil-api's `/identity` stub shape and `sil_whoami` can surface a non-identity placeholder as `ok`. The mutation-verified gate (`docs/knowledge/sil-response-classification.md:23`) must still bite: a 200 with no `name` MUST classify `retryable`. The fix narrows the gate (empty addresses now OK), it does not remove it.
- **Genuinely-pending read mislabelled as fixed.** The fix must not turn the *legitimately not-yet-ready* case (the read truly cannot return an identity yet) into a false `ok`. After the fix, `retryable` must remain the correct, honest outcome whenever there is no usable identity (no `name`) — the tool tells the truth in both directions: identity when present, `retryable` when genuinely absent.
- **Refresh / terminal taxonomy collateral damage.** A verb change in `fetchIdentity` touches the function that feeds the whole read→401→refresh→retry-once flow. If the change perturbs status classification, an expired-access user could see a re-register dead-end (instead of a transparent refresh) or a transient 5xx could be mislabelled terminal. The refresh-once, 401-vs-403, and transient-vs-terminal guarantees (all reviewed-PASS on the `sil_whoami` card) must hold unchanged after the fix.
- **PII / credential hygiene on the changed call.** The verb/body change rewrites the request construction in `fetchIdentity`. Tokens, the refresh token, and the Bearer header must still never reach a log line or the result; identity PII (name, addresses) stays in the result but never logged. The existing leak-canary tests must still pass against the changed request shape.
- **Recovery hint still actionable.** Every non-`ok` outcome must remain a named, recoverable action (not-registered → `sil_register`; session expired → re-register; forbidden → onboarding hint; transient → try again). The fix must not collapse a distinct terminal into a bare error or an ambiguous empty result.

**Technical / implementation failure modes (solutions-architect)**

- **The existing integration test is GREEN against the bug — it masks the fix.** `whoami.integration.test.ts`'s fetch double routes on `url.includes("/identity")` and never inspects `init.method`, so a POST and a GET are indistinguishable to it; it returns the real-identity envelope either way. **Consequence:** without a new method/no-body assertion, the dev could "fix" nothing and the suite would still pass, OR could break the verb and the suite would still pass. The RED test MUST assert the verb is GET and no body is sent — that is the only in-repo signal that catches this class of bug (the live cross-service proof is sil-stage's e2e, SC9, deferred). This is the single most important risk on the card.
- **GET request helper drops a carried-over invariant.** Splitting a GET path out of `postJson` risks losing the `AbortController` timeout, the header merge, or (worst) re-introducing a token into a log line. The new `getJson`/`request` must carry all three verbatim; the leak-canary assertions in `whoami.integration.test.ts:581-622` must still bite against the new request shape.
- **A GET with a body.** Some `fetch` setups silently drop a GET body; sending `{ agent_id }` on a GET is at best ignored and at worst a runtime error in strict environments. The fix must send NO body on the GET (and assert it) — not "POST body adapted to GET".
- **Over-relaxing `extractIdentity` past the `name` gate.** The empty-addresses relax is one line (`addresses.length === 0` reject removed). If the dev also weakens the `name` check (e.g. accepts a missing/empty name, or unwraps the wrong field), the anti-false-green guard dies and the stub 200 reads as `ok`. The relax is surgical: `name` non-empty string still required; `addresses` becomes "array, possibly empty".
- **Address wire-shape confusion.** sil-api returns `AddressWire` (`street_address`, `address_locality`, `postal_code`, `address_country`, …), NOT the `IdentityAddress` hint fields (`line1`/`city`/…). `extractIdentity` correctly passes addresses through untyped, so this is not a correctness bug *today* — but a dev "tidying" `extractIdentity` to read `line1`/`city` would silently drop real address data. Leave addresses opaque; do not map fields in the plugin.
- **`AGENT_ID` constant left as a misleading dead reference.** After the GET switch, `AGENT_ID` (`:67`) is no longer sent. Leaving it wired into a removed code path, or a stale comment claiming the request carries `agent_id`, would mislead the next reader. Remove it if unused, or comment why it's retained.

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.
-->

<!-- Tiers tagged by solutions-architect; behavioral wording is a starting point
product-owner may refine. Union of tiers used here is reflected in `tiers:` frontmatter. -->

**The verb fix (the root cause):**
- `[integration]` Given a stored valid access token, when `sil_whoami` runs, then the identity request to sil-api uses HTTP **GET** (not POST) and sends **no request body**. *(This is the RED test — `whoami.integration.test.ts` currently asserts neither and so passes against the buggy POST.)*
- `[integration]` Given a stored valid access token and a sil-api `GET /identity` 200 returning `{ result: { name, addresses } }`, when `sil_whoami` runs, then it surfaces the real `{ name, addresses }` and the request carries `Authorization: Bearer <stored access token>` to the resolved sil-api origin.

**The empty-addresses relax (the forced product decision):**
- `[unit]` Given a 200 body with a non-empty `name` and `addresses: []`, when `classifyIdentityResponse` runs, then it returns `ok` with that identity (empty address list is a valid identity).
- `[unit]` Given a 200 body with a non-empty `name` and a non-empty `addresses` array, when `extractIdentity`/`classifyIdentityResponse` runs, then it returns `ok` and addresses pass through opaquely (sil-api `AddressWire` fields preserved, not remapped).

**The anti-false-green guard must still bite (no regression):**
- `[unit]` Given a 200 body carrying the current sil-api stub shape `{ kind, verified, subject, attributes, note }` (no `name`), when `classifyIdentityResponse` runs, then it returns `retryable`, never `ok`.
- `[unit]` Given a 200 body with addresses but no `name` (or an empty/null/non-object body), when `classifyIdentityResponse` runs, then it returns `retryable`, never `ok`.

**The read→refresh→retry taxonomy must hold unchanged after the verb swap:**
- `[integration]` Given a 401 on the first identity GET and a successful refresh, when `sil_whoami` runs, then it refreshes once via sil-web, rotates `tokens.json`, retries the identity GET exactly once with the new token, and surfaces the identity — at most one refresh and one retry.
- `[integration]` Given a 403 `user_not_provisioned` on the identity GET, when `sil_whoami` runs, then no refresh is attempted, `tokens.json` is not cleared, and a terminal onboarding-hint outcome is surfaced (401-vs-403 split preserved).
- `[integration]` Given a 5xx or a thrown network error on the identity GET, when `sil_whoami` runs, then a transient "try again" outcome is surfaced (no refresh, no re-register hint, tokens not cleared).

**Credential hygiene on the changed request:**
- `[integration]` Given a refresh occurs mid-call, when `sil_whoami` runs, then no access token, refresh token, or `Bearer` string appears in any log line or the result, and identity PII (name, addresses) never appears in a log line — asserted against the new GET request shape.

**Whole-tool / user-POV outcomes (product-owner — additive; the request/classifier criteria above are the mechanism, these pin the end-to-end outcomes the founder reported):**
- `[integration]` Given the founder's exact repro — a registered user who completed onboarding with a name AND an address, with a valid stored access token — when the agent calls `sil_whoami`, then the tool returns `{ status: "ok", identity: { name, addresses } }` with that user's real name and addresses, NOT `retryable`. *(The reported bug closing at the tool level — assert the full result envelope, not only the classifier outcome.)*
- `[integration]` Given a stored valid access token and a first-try successful identity read, when `sil_whoami` returns, then exactly ONE sil-api request is made and ZERO sil-web refresh requests are made — the happy path neither over-fetches nor needlessly refreshes after the verb fix.
- `[unit]` Given no `tokens.json` exists, when the agent calls `sil_whoami`, then the tool returns the unambiguous "not registered — run `sil_register`" outcome and makes ZERO sil-api requests — the not-registered short-circuit is untouched by the verb change.

### Open questions (if any)

**None blocking.** One product decision is now made (not deferred), recorded as an assumption the founder may override:

- **ASSUMPTION (empty-addresses): a valid `name` with zero addresses IS a usable identity.** The `sil_whoami` card deferred this; sil-api PR #7 makes it concrete by returning `addresses: []` for a provisioned, address-less user (`packages/schemas/src/identity.ts:63`). product-owner's call (which solutions-architect concurs with): surface that user's identity rather than strand them on a false `retryable` they can never escape. If the founder instead wants "no address ⇒ not-yet-ready / prompt to add an address", that is a one-line revert in `extractIdentity` plus a copy decision — flag it and it changes back. The `name` requirement is non-negotiable either way (it is the anti-false-green guard).

No questions for sil-services: the `GET /identity` contract is merged and read-confirmed; this card is plugin-local.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**Start here (qa-developer — RED first):** the bug hides behind a too-loose test. `whoami.integration.test.ts`'s fetch double (`installRouter`, `:113-180`) routes on `url.includes("/identity")` and **never asserts `init.method` or the absence of a body**, so it is GREEN against the buggy POST. Write the RED test by tightening it:
1. In the happy-path identity case, assert the recorded identity request used **GET** (`init.method === "GET"`) and carried **no body**. This FAILS now (the tool sends POST + `{ agent_id }`) and PASSES after the verb swap. This is the load-bearing RED — it is the only in-repo signal for this bug class.
2. In `identity-classify.test.ts`, add `[unit]`: a 200 with non-empty `name` + `addresses: []` → `ok`; and **update** the existing `:172-184` "name but no addresses → not ok" expectation — name + empty array is now `ok`, while the stub shape and the no-`name` cases stay `retryable`. The name-only-no-array (non-array `addresses`) and stub cases must still be RED-guarded as `retryable`.

**Then (expert-developer — GREEN):** the production change is confined to `src/lib/sil-client.ts`:
1. `fetchIdentity` (`:260-273`): swap `postJson(url, { agent_id }, { authorization })` → a GET with no body, same `Authorization: Bearer <token>` header, same `<silApiUrl>/identity` path. Add `getJson(url, extraHeaders)` (or a `method`-parameterised `request(...)`) next to `postJson` (`:376-393`), carrying the `AbortController` timeout, the header merge, and the never-log-the-token invariant verbatim. A GET sends no `content-type` and no body.
2. `extractIdentity` (`:325-343`): delete the `addresses.length === 0 → null` reject (`:340`); keep `Array.isArray(rawAddresses)` and the non-empty-`name` requirement (`:332-333`). Update the doc-comment (`:312-324`) so it no longer says both fields are required.
3. Clean up: `AGENT_ID` (`:67`) is now unused by this call — remove it (or comment why retained). Add a one-line WHY on `IdentityAddress` (`:98-105`) that addresses are sil-api's `AddressWire` shape, passed through opaquely.

**Constraints (do NOT regress — all reviewed-PASS on the `sil_whoami` card):**
- The `sil_whoami` tool (`src/tools/identity.ts`) needs **no change** — the verb is fully inside `fetchIdentity`. Don't touch the refresh-once / 401-vs-403 / terminal-vs-transient flow.
- `classifyIdentityResponse` status branches stay as-is; only the body-shape gate moves, and it moves *inside* `extractIdentity`.
- The leak-canary assertions (`whoami.integration.test.ts:581-622`) must still bite against the new GET request — verify no token reaches a log or the result.

**Mock fidelity (qa-developer):** keep the happy-path mock returning the **enveloped** real identity (`{ protocol, version, domain, result: { name, addresses } }`) — that mirrors sil-api's actual `GET /identity` response (`handlers/identity.ts:107` via `envelope.ts`). For the empty-addresses case, return `result: { id, name, addresses: [] }`. Do NOT return the stub shape on the happy path (that is the false-green trap the existing anti-stub assertions guard).

**Out of scope (new cards, not this one):** real cross-service e2e against a live sil-api + Postgres (goal SC9, sil-stage); any change to sil-api's POST enrich stub.

## In Dev — expert-developer, qa-developer

**Outcome: all gates GREEN.** `pnpm test` → **227 passed** (21 files), `pnpm typecheck` clean, `pnpm build` clean (`dist/index.js` emitted). Live verification: build + plugin-load + manifest-contract gates pass; the `whoami.integration.test.ts` suite IS the integration smoke (real `sil_whoami` → real sil-client → mocked `fetch` boundary — the live ceiling in this repo; the cross-service e2e against a live sil-api+Postgres is sil-stage SC9, deferred as the card scoped).

**The production change is confined to `src/lib/sil-client.ts`** — four surgical edits, exactly as the handoff specified, nothing in `src/tools/identity.ts` (refresh/taxonomy untouched) and nothing cross-sibling:

1. **`fetchIdentity` (now ~`:254-283`)** — `POST … { agent_id }` → **`getJson(url, { authorization: \`Bearer ${token}\` })`**: a bodyless GET to `<silApiUrl>/identity`. The Bearer header is carried over verbatim (it was already correct — never an auth bug). Doc-comment rewritten to state the verb is the whole point (POST = enrich-stub, GET = real self-read) and that the bodyless GET eliminates the `principal_mismatch` 403 path.
2. **`getJson` helper added next to `postJson` (~`:415`)** — I chose a **GET sibling over a `method`-parameterised `request(...)`**: the GET path differs materially (no `content-type`, no body, no `JSON.stringify`), so two focused functions read cleaner than one branchy one. Carried over **verbatim**: the `AbortController`/`REQUEST_TIMEOUT_MS` timeout, the header merge, and the never-log-the-token invariant. The GET sends **no body and no `content-type`**.
3. **`extractIdentity` (~`:340-357`)** — dropped ONLY the `addresses.length === 0 → null` reject. **Kept** `Array.isArray(rawAddresses)` and the **non-empty `name`** gate (the anti-false-green guard). Subtle correctness point preserved: a body with `name` but **no `addresses` key** still → null (`Array.isArray(undefined) === false`); only a present-but-EMPTY array now passes. Doc-comment updated to explain `addresses: []` is a real provisioned-but-addressless identity.
4. **Cleanup** — removed the now-dead `AGENT_ID` constant (grep-confirmed it had zero other references after the verb swap). Added a WHY comment on `IdentityAddress` that addresses pass through **opaque** and the real wire shape is sil-api's `AddressWire` (`street_address`/`address_locality`/…), NOT the `line1`/`city` hint fields — do not remap. Rewrote the module-header wire-contract block (was `POST … body { agent_id }`).

**Test approach (qa-developer, RED-first — TDD integrity verified):** the bug was masked because the old `whoami.integration.test.ts` router never inspected `init.method`. qa extended the recorder to capture `method` + `hasBody` and added GET/no-body assertions across the identity cases (load-bearing RED at the happy-path; refresh request asserted to stay **POST** so the two verbs can't be conflated). I confirmed the RED genuinely bites: temporarily reverting `fetchIdentity` to POST produced `AssertionError: expected 'POST' to be 'GET'`, then the GET fix went green — a true RED→GREEN, not a false-green test. qa also added the unit-tier empty-addresses cases to `identity-classify.test.ts` (`name` + `addresses: []` → ok, bare and enveloped; anti-false-green guards still bite: `addresses: []` with no/empty `name` → not ok).

**Surprising / worth noting:** the existing `identity-classify.test.ts:172` ("name but NO addresses → not ok") did **not** break under the relax, because it passes `{ name }` with the `addresses` key **absent** — caught by the surviving `Array.isArray` check, which is a stricter gate than the dropped empty-array reject. The relax is therefore narrower than "addresses optional": absent/non-array `addresses` is still rejected; only `[]` is newly accepted.

### → Handoff to Review (next agent: code-quality-guardian)

**Scope of the diff:** `src/lib/sil-client.ts` (production) + `src/__tests__/whoami.integration.test.ts` and `src/__tests__/lib/identity-classify.test.ts` (qa's RED tests). No UI/CSS/HTML — `style-quality-guardian` not needed.

**Where to focus your review:**
- **The `name` gate must stay intact in `extractIdentity`.** This is the anti-false-green guard (`docs/knowledge/sil-response-classification.md`). The relax dropped exactly one line (the empty-array reject); the `name` non-empty check and `Array.isArray` are both retained. Confirm the stub shape (`{kind, verified, subject, …}`, no `name`) still → `retryable`.
- **`getJson` must not leak the token.** The Bearer header is passed straight to `fetch` and never logged — same invariant as `postJson`. The leak-canary block in `whoami.integration.test.ts` (~`:581-622` originally) asserts no token/refresh-token/`Bearer`/PII reaches any log line or the result, against the new GET shape. Verify the duplication between `getJson`/`postJson` (AbortController + timer + finally) is acceptable — I judged two focused functions clearer than one parameterised helper.
- **GET sends no body.** `getJson` passes no `body` and no `content-type` to `fetch`; qa asserts `hasBody === false` on the identity request. This is the strict-fetch-safety constraint.

**Deliberate trade-offs / known non-smells:**
- **`getJson`/`postJson` share ~6 lines of AbortController boilerplate.** Deliberate (rule of three not met — two call shapes, materially different bodies). A `request(method, …)` helper would need conditional body/content-type logic; I judged that noisier. If you disagree, it's a clean refactor, but the behavior is identical either way.
- **`IdentityAddress` interface keeps its `line1`/`city` hint fields** even though the wire shape is `AddressWire`. Left intentionally (with a WHY comment) — addresses pass through opaque and `extractIdentity` never reads these fields; ripping them out is out-of-scope churn for this bug card.

**Verified no regression:** the refresh-once / 401-vs-403 / transient-vs-terminal taxonomy and the `sil_whoami` tool (`src/tools/identity.ts`) are untouched; all their integration tests still pass.

## Review round 1 — code-quality-guardian

**Verdict: PASS.**

Sound, secure, surgically-scoped regression fix. The production change is confined to `src/lib/sil-client.ts` (68 ins / 31 del) exactly as the handoff specified; `src/tools/identity.ts` (refresh / 401-vs-403 / terminal-vs-transient taxonomy) is untouched. Gates re-run clean in the worktree: **`pnpm typecheck` exit 0, `pnpm test` 230/230 (21 files)**. I independently mutation-verified TDD integrity — both REDs genuinely bite (see below), so this is true RED→GREEN, not false-green.

### Load-bearing concerns — each verified

- **TDD integrity — the load-bearing verb RED genuinely catches the bug.** Reverting `fetchIdentity` to `postJson(url, { agent_id }, …)` produced **6 failures** across `whoami.integration.test.ts` with `AssertionError: expected 'POST' to be 'GET'` (`whoami.integration.test.ts:649,716` among them), then green on restore. The old router never inspected `init.method`; the new recorder captures `method` + `hasBody` (`:101-110, :145-146`) and the new test (`:303-345`) asserts the identity read is **GET + `hasBody === false` + no `agent_id` in body**. Real, not cosmetic.
- **Empty-addresses relax RED bites, and ONLY the relax — the `name` gate survives.** Restoring the `if (addresses.length === 0) return null` reject turned exactly **2 tests red** (`identity-classify.test.ts` bare + enveloped empty-array cases) while all anti-false-green guards stayed green (16 passed). `extractIdentity` (`sil-client.ts:340-357`) keeps `typeof name !== "string" || name.length === 0 → null` (`:348`) and `!Array.isArray(rawAddresses) → null` (`:351`). The stub shape (`{kind, verified, subject, …}`, no `name`) still → `retryable`. The relax is surgical: present-but-empty array now passes; absent / non-array `addresses` and missing/empty `name` are all still rejected (tests `:239-258`).
- **Token hygiene on the new GET path is intact.** `getJson` (`sil-client.ts:415-430`) carries the `postJson` invariants verbatim — `AbortController` + `REQUEST_TIMEOUT_MS` timeout, `finally { clearTimeout(timer) }`, and `extraHeaders` passed straight to `fetch`, never to a log line. The leak-canary block (`whoami.integration.test.ts:706-725`) asserts no token/refresh-token reaches the request body, against the new GET shape — and it failed under my POST mutation, confirming it bites on the new shape. The bodyless GET *removes* an exfil surface (no body to audit).
- **GET sends no body.** `getJson` passes no `body` and no `content-type` (`:422-425`); the test asserts `hasBody === false` independently of body content (`:336-340`). Strict-fetch-safe.
- **No taxonomy regression.** `src/tools/identity.ts` untouched; `classifyIdentityResponse` status branches unchanged (only the body-shape gate moved, inside `extractIdentity`). The refresh-retry / 403-terminal / 5xx-transient / thrown-fetch integration tests all now additionally assert the read is a bodyless GET and the refresh leg stays POST (`:409-415, :537-541, :627-631, :646-650`) — the two verbs cannot be conflated. All pass.
- **Addresses pass through opaque — not remapped.** `extractIdentity` filters on `asRecord(a) !== null` only and never reads individual fields; the new unit test (`identity-classify.test.ts:104-122`) asserts the `AddressWire` field names (`street_address`/`address_locality`/`postal_code`/`address_country`) survive verbatim. The `IdentityAddress` `line1`/`city` hint fields are retained intentionally with a WHY comment — correct call, ripping them out is out-of-scope churn.

### Cross-sibling contract — confirmed against actual sil-api source

Every load-bearing comment claim verified against `sil-services/services/sil-api/src/handlers/identity.ts` (not assumed): GET `/identity` declares only a `response` schema and takes **no request body** (`:101-103`); derives the principal from `req.user` own-data-scoped via `req.user.id` (`:105-106`); returns `{id, name, addresses}` enveloped (`:107` via `buildIdentityReadResult` `:73-82`); `POST /identity` is the enrich-stub with no `name` (`:26-32`); `addresses: []` for an addressless user (`addresses.map(toAddressWire)` over `[]`, `:80`); and the `AddressWire` field names match the WHY comment exactly (`:52-57`).

### Full-lens sweep — clean

Type safety (no `any`, typecheck clean) · error handling (`retryable` mapping + timer cleanup preserved) · no hardcoded values (`AGENT_ID` dead constant correctly removed — grep-confirmed zero live refs) · no legacy/backwards-compat (old POST path deleted outright, no fallback) · complexity (`getJson` 16 lines, cyclomatic ~1) · the deliberate ~6-line `getJson`/`postJson` AbortController duplication is a sound, documented rule-of-three judgment (materially different bodies) — not a smell · tier coverage matches (`tiers: [unit, integration]` ↔ the two test files; every acceptance criterion tier-tagged) · knowledge capture is exemplary (inline WHY on every non-obvious decision).

### Note to distillation (next stage)

The card's Signals flag is correct: **`docs/knowledge/sil-response-classification.md` is now stale** and must be refreshed by the distilling solutions-architect, in three specific places — (1) `:19` describes the identity read as `POST /identity` requiring a **non-empty** `addresses` array (both halves now wrong — verb is GET, empty array is valid); (2) `:23` cites "6 tests red" for the accept-any-200 mutation (the count/shape changed); (3) the entire `:29-31` "Known open edge" section is obsolete — the deferred empty-addresses decision is now resolved (empty array IS a valid identity). No doc edit is owed by this PR — that capture is the distillation stage's job.

### → Handoff back to In Dev (if FAIL/REVIEW)

N/A — PASS.

## Distillation — solutions-architect

<!-- Runs in the worktree on the card branch after Review PASS. Pushes to the same PR. Per the `distillation` skill: SEARCH docs/ INDEX files first; edit existing docs rather than creating duplicates. Captures land at smallest viable scope: inline WHY comments, docs/decisions/, docs/knowledge/, docs/product/, or CLAUDE.md. Then flips status to pr-ready. -->

Searched `docs/knowledge/INDEX.md` first — no new docs; **edited the two existing docs in place** that this fix made stale (no duplicates created). The inline WHY captures in `src/lib/sil-client.ts` were already landed by the dev pair (reviewer called them "exemplary"), so no code-level capture was owed — this pass is the `docs/knowledge/` reconciliation only. No `docs/decisions/` or `docs/product/` capture warranted (the *choices* — verb pivot, empty-addresses relax — were already recorded on the predecessor card and in these knowledge docs; the relax was an anticipated, pre-recorded decision, not a newly-contested one).

- **knowledge/sil-response-classification.md** — refreshed the three flagged stale spots against the merged behavior:
  - `§The two-200s traps` (was `:19`) — identity read corrected `POST /identity` → bodyless **`GET /identity`**; the body gate corrected from "requires a non-empty `addresses` array" → "requires non-empty `name` + `addresses` is an **array (may be empty)**"; added that the verb itself is load-bearing (POST = enrich-stub, GET = real self-read).
  - `§Why res.ok is banned` (was `:23`) — mutation count corrected **"6 tests red" → "7 tests red"** and re-pointed at `extractIdentity` (drop `name`+`Array.isArray` gates). **Empirically re-verified**: applied the accept-any-200 mutation in the worktree → 7 failures in `identity-classify.test.ts` (incl. the named "200 stub vs 200 real differ only by body" guard), then restored clean (18/18 green).
  - `§Known open edge` → renamed **`§Empty-addresses: a valid identity, gated by name (resolved)`** — the deferred decision is now resolved (empty `addresses: []` IS a valid identity, gated by `name`); documented the surgical narrowness (only `[]` newly passes; absent/non-array `addresses` and missing/empty `name` still rejected).
  - Frontmatter: `commit a635103 → c6b18f7`, `updated_by_card → sil-identity-read-verb-fix`.
- **knowledge/sil-api-identity-contract.md** — the predecessor card recorded the POST→GET pivot as *anticipated*; updated **anticipated → done**:
  - Title + opening: "latent/not-yet-live" → "live, merged (`GET /identity`, PR #7)"; the contract block corrected `POST … body {agent_id}` → bodyless `GET`.
  - Request gotchas: the `agent_id`-required and OMIT-`on_behalf_of` POST-body gotchas replaced by "send NO body on the GET" (and noted the bodyless GET *eliminates* the `principal_mismatch` 403 path; `AGENT_ID` constant removed). 401-vs-403 gotcha kept (verb-independent).
  - `§The latent cross-sibling dependency` → **`§The cross-sibling read — now live (the POST→GET pivot landed)`**; preserved the still-true deferral — the cross-service **e2e (sil-stage, goal SC9)** remains deferred, only the *plugin read* is no longer latent.
  - `403 principal_mismatch` table row reworded to "structurally unreachable now (bodyless GET); classifier still maps it". Title/tags frontmatter (`blocked-on` tag dropped, `latent`→`deferred e2e`); `commit → c6b18f7`, `updated_by_card → sil-identity-read-verb-fix`.
- **knowledge/INDEX.md** — updated the `sil-api-identity-contract` row's title + tags to match. Both rows stay dated 2026-06-08; sort order unchanged.

No inline / `decisions/` / `product/` / CLAUDE.md captures this pass.

## PR Ready

<!-- PR url; founder notification fires here -->

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
