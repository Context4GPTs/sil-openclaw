---
type: card
title: sil_register stops polling on premature not_found
slug: sil-register-stops-polling-on-premature-not-found
work_type: bug
tiers: [unit, integration]  # set by solutions-architect during Discovery from the acceptance criteria below
status: done      # backlog | discovery | stand-by | in-dev | review | distilling | pr-ready | done | abandoned
agents: []                # current active agent set; updated by each handoff
priority: 1               # 1 = drop-everything, 2 = normal, 3 = nice-to-have
created: 2026-06-12
updated: 2026-06-12
base_branch: main         # the branch this card's worktree was cut from and the PR will target
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-sil-register-stops-polling-on-premature-not-found
branch: card/sil-register-stops-polling-on-premature-not-found
pr: https://github.com/Context4GPTs/sil-openclaw/pull/18                  # set by expert-developer at in-dev → review
merged_commit: 8119222a11c31092abe3adc8c5be8e09a79cd245       # set by /board-tick on PR-merge detection
---

## Intent (founder)

**Symptom:** `sil_register` returns `awaiting_browser` with an auth URL, but in the normal interactive flow registration never completes — `sil_whoami` keeps returning null / `not_registered`. The logs show `sil_register_not_found` ~3s after start, then no further polling.

**Repro:** (always, in the normal interactive flow)
1. Call `sil_register`. The background claim-poll arms immediately at `POLL_INTERVAL_MS` (3s).
2. The pending session row is only INSERTed server-side when the user's browser opens the `auth_url` — the plugin deliberately does not pre-POST (`identity.ts:92-96`).
3. The first poll tick fires ~3s in — before a human has opened the page — so the claim endpoint 404s → `classifyClaimResponse` maps it to `{ kind: "not_found" }` (`sil-client.ts:412`).
4. `claimStep` treats `not_found` as terminal (`done:true`, grouped with `expired`/`already_claimed` at `identity.ts:312-315`) → the poll loop stops and `handleDone` logs `sil_register_not_found`.
5. The user then signs in + onboards into a session no poller is watching → `tokens.json` is never written → `sil_whoami` → null.

**Expected vs actual:**
- *Expected:* a 404 before the browser opens is the normal early state — the poll should keep ticking until the session appears (success) or the deadline elapses (timeout).
- *Actual:* the first premature 404 is treated as terminal and kills the loop ~3s in, before the user could plausibly have acted.

**Hypothesis (founder, confirmed against the code):** In `claimStep`, reclassify `not_found` from terminal to keep-polling — group it with `pending`/`retryable` (`done:false`) instead of with `expired`/`already_claimed`, and drop the now-dead `not_found` terminal branch in `handleDone`. The 30-min `POLL_DEADLINE_MS` (`poller.ts:29`) backstops it, so it cannot loop forever: a session that is never created still terminates as a `timeout`. This mirrors the klodi adapter, where the equivalent pre-session 404 maps to a non-terminal `http_error` that logs and lets the next tick re-poll (`../../klodi/klodi-plugin/adapters/openclaw/src/tools/register-poller.ts:336-356`); do it cleaner here by keeping sil's richer claim taxonomy rather than collapsing to a generic http error. Note `classifyClaimResponse` also folds 400 / other unexpected 4xx into `not_found` (`sil-client.ts:415-417`) — Discovery should decide whether a malformed-request 400 warrants its own non-polling terminal, or whether deadline-bounded keep-polling is acceptable for it too.

<!-- priority=1 rationale: breaks the primary registration path — in the normal interactive flow the first poll always 404s before the user can open the browser, so registration effectively never completes. -->

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

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — solutions-architect, product-owner

<!-- Filled jointly by product-owner and solutions-architect. -->

### Product behavior — registration polling flow (product-owner)

**The flow this card fixes — interactive browser registration**

- *Trigger:* the agent calls `sil_register` for a user who is not yet registered (`tokens.json` absent).
- *Actor:* a human, via the browser, acting at their own pace.
- *Outcome the founder cares about:* in the normal interactive flow — where the first background poll tick fires (~3s) **before** the human has opened the auth URL — registration **completes** once the user opens the URL and signs in. `sil_whoami` then resolves the identity.

**The governing business rule (this is the bug)**

> A claim `not_found` (HTTP 404) is the **normal early state** of a registration session, not a terminal failure. The pending session row is created server-side only when the user's browser opens the auth URL; until that happens every claim 404s. The poll must keep ticking through these early 404s until **one** of two real terminals is reached:
> - the session appears and the claim succeeds → tokens persisted, `sil_whoami` works (**success**); or
> - the 30-minute `POLL_DEADLINE_MS` elapses with no session ever appearing → **timeout** (never `not_found`).
>
> The first premature 404 must **never** end registration. Mid-flow, "the session does not exist *yet*" (404) is indistinguishable from "the user has not clicked yet" — so it can only be treated as keep-polling, bounded by the deadline.

**Why the deadline is the real terminal, not the 404**

A session's non-existence is not evidence the user abandoned it — it is the expected state for the entire window between `sil_register` returning and the human acting. The only signal that the attempt truly failed is the passage of time (the 30-min budget), which already backstops the loop. So "session never appeared" must surface as `timeout` — the outcome meaning "we waited the full window and nobody completed it", which is the recovery the agent already understands (re-run `sil_register`). Surfacing it as `not_found` is a category error: it reports a transient early state as a permanent verdict.

**Scope boundary (what this card does NOT change)**

- The success, `pending`, `expired` (410), `already_claimed` (409), `5xx`/network-retryable, and `timeout` behaviors are correct and stay exactly as they are. Only the terminality of the `not_found` (404) classification changes.
- A genuinely malformed claim request (HTTP 400) is a **different** semantic from the normal-flow 404 (see Open questions) — it is not part of the interactive happy path and is treated separately from the early-404 keep-polling rule.

### Root cause (solutions-architect — confirmed)

`src/tools/identity.ts:312-315` — `claimStep` routes the claim outcome `not_found` into the loop's **terminal** bucket (`return { done: true, outcome: outcome.kind }`, grouped with `expired`/`already_claimed`). The poll arms at `POLL_INTERVAL_MS = 3000` (`src/lib/poller.ts:27`); the server only INSERTs the pending-session row when the user's browser opens `auth_url` (`identity.ts:92-96`). So the first tick (~3s) hits the claim endpoint before the row exists, the server returns **404**, `classifyClaimResponse` maps it to `{ kind: "not_found" }` (`src/lib/sil-client.ts:412`), `claimStep` makes it terminal → the loop settles, `handleDone` logs `sil_register_not_found` (`identity.ts:348-349`), and the un-polled session is later completed by the human into a void → `tokens.json` never written → `sil_whoami` → null.

The founder hypothesis is **confirmed against the authoritative server contract**, not just the plugin. `sil-services/apps/sil-web/.../sessions/[id]/claim/route.ts:96-110` proves the pre-creation window returns a uniform 404 (`classify` finds no row → `errorResponse(404, 'not_found', …)`), while a *created-but-not-yet-completed* session already returns `200 { status: "pending" }` (route.ts:108-110) — which the loop polls through correctly. The **only** gap is the pre-creation 404 window, which `claimStep` wrongly treats as fatal.

### Why it happens (causal chain)

Under condition *"first poll tick fires before the human opens the browser"* (always true at the 3s cadence in the normal interactive flow), code path `claimStep` → `not_found` → `done:true` produces loop state *settled-terminal*, which violates the invariant *"only a successful claim or the deadline ends a registration poll."* A transient early state (session does not exist **yet**) is reported as a permanent verdict. Deterministic, not intermittent.

### Hypotheses considered

- ✓ **H1 — `claimStep` mis-maps `not_found` to terminal.** Confirmed. Evidence: `identity.ts:312-315` (terminal grouping), `poller.ts:27` (3s cadence beats the human), server `claim/route.ts:96-98` (pre-creation → uniform 404). Fix lives in the **loop mapping** (`claimStep`), not the classifier. Deadline backstop verified: `poller.ts:92-96` checks `now() - startedAt >= deadlineMs` at the head of every tick and settles `{ timedOut: true, outcome: "timeout" }`, so perpetual `done:false` terminates as `timeout`, never an infinite loop.
- ✗ **H2 — fix the classifier (`classifyClaimResponse`: collapse 404 → `pending`).** Rejected — *wrong layer*. The classifier is the single source of the HTTP→meaning taxonomy and a 404 genuinely *is* `not_found` on the wire; re-labelling it `pending` would lie about the response and erase the agent-facing log distinction (a 30-min `timeout` that was "404 the whole time — user never clicked" reads differently from one that was "pending the whole time — user stalled mid-onboarding"). Keeping the classifier pure also keeps the diff minimal: the 5 classifier unit tests asserting `404 → { kind: "not_found" }` (`sil-client.test.ts:115-129`) stay green, untouched. The catalog `not_found` (`LookupOutcome`, `sil-client.ts:395`) is a **separate union** — out of scope, unaffected.
- ✗ **H3 — the 3s interval is too aggressive (widen `POLL_INTERVAL_MS`).** Rejected. A longer interval only delays the premature 404; the human acts on their own clock (possibly minutes). No interval value makes "session not created yet" a terminal-worthy signal. The cadence is fine; the *classification of the response* is the defect.

### Approach + alternatives ruled out

- **Chosen: reclassify `not_found` as keep-polling inside `claimStep`; split 400/unexpected-4xx into a distinct terminal.** Two coupled edits in `src/tools/identity.ts`: (a) add `case "not_found":` to the `pending`/`retryable` keep-polling group (`return { done: false }`) and **delete** the dead `not_found` from the terminal group (`identity.ts:312-315`); (b) **delete** the `not_found` branch in `handleDone` (`identity.ts:344-352`, the `logger.warn(\`sil_register_not_found\`)`). The 30-min `POLL_DEADLINE_MS` (`poller.ts:29`) is the real backstop — a never-appearing session ends as `timeout`, already logged by `handleDone`'s `timedOut` branch (`identity.ts:339-342`). Mirrors klodi's pre-session-404 → non-terminal-then-re-poll, done cleaner by keeping sil's discriminated claim taxonomy rather than collapsing to a generic `http_error`. Plus the 400 split (see Open questions resolution): give 400/unexpected-4xx its **own** non-polling terminal `invalid_request` kind in `classifyClaimResponse` so it does NOT ride the now-keep-polling `not_found`. **No backwards-compat shim** — the old terminal `not_found` branch is removed, not gated.
- **Rejected: classifier-level collapse of 404 (H2).** Wrong layer; lies about the wire; loses the log distinction; larger test churn. See H2.
- **Rejected: widen the poll interval (H3).** Symptom-only; the human's pace is unbounded regardless of cadence. See H3.
- **Rejected: pre-POST the session at `sil_register` time so the row exists before the first poll.** The plugin deliberately does NOT pre-POST (`identity.ts:92-96`: opening the URL is what creates the session server-side). Reversing it is a much larger change to the auth contract and would litter the DB with rows for sessions users never open. Out of scope; the fix is plugin-side poll classification.
- **Rejected (for the 400 split): leave 400 folded into the keep-polling `not_found`.** A genuine 400 means "malformed request" — re-polling can never fix it (the same bad body 400s every tick), so folding it in would spin a known-bug for the full 30 minutes before a useless `timeout`. That is the *opposite* of fail-fast. See the Open questions resolution for why a distinct terminal is correct even though the case is unreachable today.

### Affected files / surfaces

- `src/tools/identity.ts` — **primary.** `claimStep` (`~295-317`): move `not_found` from the terminal group to the keep-polling `pending`/`retryable` group. `handleDone` (`~324-353`): delete the dead `not_found` branch and its `sil_register_not_found` warn; update the doc comments at `identity.ts:22-24`, `293`, `344` that still list `not_found` as a terminal.
- `src/lib/sil-client.ts` — `classifyClaimResponse` (`409-418`): split 400/unexpected-4xx out of the `not_found` branch into a new non-polling terminal `{ kind: "invalid_request" }`; add that variant to the `ClaimOutcome` union (`143-154`); update the wire-contract doc block (`13-18`) which currently documents `404 → not_found` as terminal. The pure-classifier behavior for 404 itself is **unchanged** (`404 → { kind: "not_found" }`); only the 400 mapping changes and only the *loop's* treatment of `not_found` changes (in `identity.ts`).
- **Tests (qa-developer owns RED):** `src/__tests__/register-claim.integration.test.ts` — the "terminal status codes stop the loop" table (`268-292`) currently asserts `404 → stops polling`; that 404 row must move to a "keeps polling then succeeds / times out" assertion. `src/__tests__/lib/sil-client.test.ts` — the `404 → not_found` unit assertions (`115-129`) stay; ADD a `400 → invalid_request` (non-polling terminal) assertion and confirm 400 is NOT `not_found`. New `claimStep`-level unit coverage that `not_found → { done: false }`.
- **Out of scope / untouched:** `src/lib/poller.ts` (the bounded-loop + deadline are already correct — they are the backstop, not the bug), the catalog `LookupOutcome.not_found` (separate union), `sil_whoami`, refresh.

### Risks / failure modes

- **Masking a permanent failure by polling a forever-404 session.** Bounded, by design: `poller.ts:92-96` settles `timeout` at the 30-min deadline, so the worst case of a never-created (or wrong-verifier) session is a 30-min bounded poll that writes nothing and ends as `timeout`. Acceptable — and it already matches the budget the perpetual-`pending` case lives under (`register-claim.integration.test.ts:332-353`).
- **Wrong-verifier 404 is indistinguishable from not-yet-created.** Confirmed at the server: the claim CAS folds the verifier into the SQL predicate, so "wrong verifier" and "unknown session" return a byte-identical 404 with no existence oracle (`claim/route.ts:11-13, 96-98`). The plugin therefore *cannot* treat a 404 as a security/permanent signal — keep-polling (deadline-bounded) is the only correct treatment. A wrong-verifier session simply times out after 30 min. (And the plugin sends the verifier matching the challenge it minted, so a wrong-verifier 404 against its own session can only arise from a PKCE-derivation drift — caught by the shared test vector, `pkce.ts:40-41`.)
- **The 400 split changes a classifier branch + the `ClaimOutcome` union.** Exhaustiveness is enforced by TypeScript: the `switch (outcome.kind)` in `claimStep` (`identity.ts:301`) has no `default`, so adding `invalid_request` forces the dev to handle it (as a `done:true` terminal that persists nothing + logs `sil_register_invalid_request`). A missed case fails `tsc`, not silently in prod.
- **A genuine 400 can't actually be produced by this plugin today (unreachable).** The distinct terminal is therefore *fail-fast insurance against contract drift*, not a live path — it must NOT get an integration test that fabricates a 400 the real client can never send (that would be a test against a state the product can't reach). The 400 coverage stays at the **unit** tier on the pure classifier only. See Open questions.
- **Doc-comment drift.** Several JSDoc blocks still call `not_found` a terminal (`identity.ts:22-24, 293, 344`; `sil-client.ts:13-18`). Stale comments that contradict the new behavior are a review-blocking smell here — they must be updated in the same change, not left behind.

### Acceptance criteria

<!--
Format: `[tier] Given <state>, when <action>, then <outcome>`. tier ∈ {unit, integration, e2e}.
product-owner framed the behavior + best-fit tier; solutions-architect reconciles tiers into the `tiers:` frontmatter.
-->

**Core regression — the early 404 must not terminate the poll**

- `[integration]` Given a not-yet-registered user has called `sil_register` and the first poll tick fires before the session exists (claim returns 404 `not_found`), when the loop ticks, then it keeps polling — it does NOT settle, persists no tokens, and leaves a live timer for the next tick (and it does NOT log a terminal `sil_register_not_found`).
- `[unit]` Given a single `claimStep` is run against a 404 `not_found` claim outcome, when it maps the outcome to the loop signal, then it returns `{ done: false }` (grouped with `pending`/`retryable`), NOT a `done: true` terminal.

**Recovery — once the session appears on a later tick, registration completes**

- `[integration]` Given the first claim tick returned 404 `not_found` (user had not yet acted), when a later tick claims a 200 token body (the user has now signed in), then the claim is honored — `tokens.json` + `config.json` are written exactly once, the loop stops with no leaked timer, and a subsequent `sil_whoami` resolves the identity.
- `[integration]` Given a sequence of early 404s followed by a `pending` then a success 200, when the poll runs across all ticks, then it polls through every early 404 and `pending` (call count ≥ the number of pre-success ticks) and ultimately persists the credentials — proving 404 and `pending` are equivalently non-terminal.

**Bound — a session that never appears terminates as timeout, never loops forever**

- `[integration]` Given a registration whose claim returns 404 `not_found` on every tick (the user never opens the URL), when the 30-minute `POLL_DEADLINE_MS` elapses, then the loop settles as `timeout` (logs `sil_register_timeout`, NOT `sil_register_not_found`), persists no tokens, leaves no live timer, and no further poll fires after the deadline.

**No dead terminal left behind**

- `[unit]` Given `not_found` is no longer a terminal claim result, when `handleDone` processes a terminal, then there is no surviving `not_found` terminal branch (the only failure terminals it logs are `expired` / `already_claimed` / `timeout`) — so a 404 can never reach `handleDone` as a terminal.

**Malformed-request 400 — its own non-polling terminal (solutions-architect; resolves the open question)**

- `[unit]` Given a malformed claim response (HTTP 400, or any other unexpected non-{200,409,410,404,5xx} status), when `classifyClaimResponse` classifies it, then the outcome is a distinct non-polling terminal `{ kind: "invalid_request" }` — NOT `not_found` (so it does NOT ride the keep-polling path) and NOT a 200/`pending`/`success`.
- `[unit]` Given a `claimStep` run against an `invalid_request` claim outcome, when it maps the outcome to the loop signal, then it returns `{ done: true, outcome: "invalid_request" }` (a terminal that persists no tokens) — keep-polling is reserved for `not_found`/`pending`/`retryable` only.

> **Tier reconciliation (solutions-architect):** confirmed the product-owner's tags. The poll-loop behaviors (early-404 keep-polling, recovery on a later success, the deadline→timeout bound, no-dead-terminal) are correctly `[integration]`/`[unit]` — they exercise the real poller + sil-client + credentials through `sil_register`'s `execute()` with only `fetch` mocked (the existing `register-claim.integration.test.ts` harness). The classifier 400-split and the single-`claimStep` mappings are `[unit]` (pure functions, no network). **No `e2e`** — there is no live sil-web/Postgres in this repo (the cross-service guarantee is sil-stage's deferred e2e), and the 400 case is *unreachable* from the real client, so it must stay a pure-classifier unit assertion and must NOT be given an integration test that fabricates a 400 the plugin can never actually send. **`tiers: [unit, integration]`.**

### Open questions (if any)

- **Malformed-request 400 — keep-polling or its own terminal? (for solutions-architect to resolve + tier.)** `classifyClaimResponse` currently folds HTTP 400 *and* any other unexpected 4xx into `not_found` (`src/lib/sil-client.ts:414-417`), so the same reclassification that makes 404 keep-polling would also make a malformed claim request (400) keep-polling for the full 30 minutes. **Product position:** a 400 is structurally different from the normal-flow 404 — it means "this request is malformed", which re-polling cannot fix (the same bad request 400s every tick), and it is never part of the interactive happy path. The product-correct behavior is for a genuine 400 to be a **non-polling terminal** with a re-run hint, while only the 404 (session-not-yet-created) keeps polling — i.e. split 400 out of the `not_found` branch rather than carrying it along. Whether that split earns a distinct classifier branch + outcome kind (vs. accepting deadline-bounded keep-polling for a should-never-happen 400) is a technical call for the architect. If 400 does get its own non-polling terminal, add a `[unit]` criterion: *Given a 400 malformed claim response, when classified, then the outcome is a non-polling terminal (not `not_found`, not keep-polling).* This question does not block the founder's success criterion (the normal flow's early miss is always a 404, never a 400).

> **RESOLVED (solutions-architect): give 400/unexpected-4xx its own non-polling terminal `invalid_request` kind; split it out of `not_found`.** The product-owner's instinct is correct, and the engineering evidence reinforces it from a second direction:
>
> 1. **The plugin cannot elicit a server 400 on the claim route today — it is structurally unreachable.** The server's *only* 400 path is `readVerifier` returning null on an absent/blank/non-string `code_verifier` (`claim/route.ts:113-123, 134-135`). But the plugin always mints a non-empty 43-char base64url verifier (`pkce.ts:75-77`, `newVerifier` = 32 random bytes → base64url) and always sends `{ code_verifier: <that> }` (`sil-client.ts:576`). So a claim-route 400 can only occur on a **contract drift / bug** (the server changing its 400 conditions, or a future malformed call), never on a real flow.
> 2. **For a should-never-happen response, fail-fast beats deadline-bounded spinning.** Folding 400 into the now-keep-polling `not_found` would make the plugin poll a *known-malformed* request for 30 minutes and then surface a misleading `timeout`. A distinct terminal `invalid_request` makes the bug **loud and immediate** (logs `sil_register_invalid_request`, stops at once, persists nothing) — exactly the production-grade-first posture: no speculative recovery for an unrecoverable state, fail fast and loud.
> 3. **It costs almost nothing and removes a real foot-gun.** One extra union variant + one classifier branch, exhaustiveness-checked by `tsc` at the `claimStep` switch (`identity.ts:301`). Without the split, the reclassification this card makes would *silently* turn every 400 into a 30-min poll — a regression hiding inside the fix.
>
> **Crucially, do NOT integration-test the 400** by fabricating a response the real client can't produce — that would be testing a state the product cannot reach (a stub-shaped test). The 400 split is verified at the **unit** tier on the pure classifier only (`classifyClaimResponse(400, …) → invalid_request`) plus the `claimStep` mapping. This is consistent with `complete-work-is-stub-free`: we assert the real classifier branch, not a synthetic flow.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**Where to start.** The whole fix is two files; the poller is correct and must not be touched.

1. **`src/tools/identity.ts` — `claimStep` (`~301-316`):** move `case "not_found":` up to join `case "pending": case "retryable":` returning `{ done: false }`. Remove `not_found` from the terminal group (leaving `case "expired": case "already_claimed":`). Add `case "invalid_request":` to the terminal group (`return { done: true, outcome: outcome.kind }`) — the `switch` has no `default`, so `tsc` forces this once the union grows.
2. **`src/tools/identity.ts` — `handleDone` (`~344-352`):** delete the `not_found` special-case and its `logger.warn(\`sil_register_not_found\`)`. The generic terminal logger below it already covers `expired`/`already_claimed`/`invalid_request` at `info`. (Decide whether `invalid_request` should log at `warn` since it signals a bug — recommended: yes, `warn`, mirroring the old `not_found` treatment but for the genuinely-anomalous case.)
3. **`src/lib/sil-client.ts` — `classifyClaimResponse` (`409-418`):** add `{ kind: "invalid_request" }` to the `ClaimOutcome` union (`143-154`); change the `status !== 200` fallthrough (`414-417`) from `return { kind: "not_found" }` to `return { kind: "invalid_request" }`. Leave `if (status === 404) return { kind: "not_found" }` exactly as-is.
4. **Doc comments:** update every block that still calls `not_found` terminal — `identity.ts:22-24` (the `execute()` flow comment), `identity.ts:293` (the `claimStep` comment), `identity.ts:344` (the `handleDone` comment), and the `sil-client.ts:13-18` wire-contract block. Stale comments contradicting the new behavior are a review-blocking smell.

**The invariant to preserve (do not regress).** The bounded poll + deadline backstop in `src/lib/poller.ts` is the safety net that makes keep-polling-on-404 safe: perpetual `{ done: false }` MUST still settle as `{ timedOut: true, outcome: "timeout" }` at `POLL_DEADLINE_MS` (`poller.ts:92-96`), with `vi.getTimerCount() === 0` after any exit. Keep-polling without the deadline would be an unbounded loop — the deadline is non-negotiable.

**Test strategy (qa-developer writes RED first, per adversarial-testing).**
- The headline RED test is the **early-404-then-success** poll path (the regression that proves the bug is fixed): script `fetch` to return 404 on the first tick(s), then a 200 token body, and assert the loop did NOT settle on the first 404 — it kept polling and ultimately persisted `tokens.json`. Model it on the existing `pending`-then-success integration test (`register-claim.integration.test.ts:236-255`); the 404 must behave identically to `pending`.
- **Flip** the existing terminal-table assertion: the `404` row in `register-claim.integration.test.ts:268-292` ("HTTP 404 → stops polling") currently encodes the bug — move 404 out of that table and into a keep-polling assertion. Leave 409/410 in the terminal table.
- Add the **perpetual-404 → timeout** integration test (404 every tick → settles `timeout`, logs `sil_register_timeout` NOT `sil_register_not_found`, no tokens, no leaked timer) — mirror the perpetual-`pending`→timeout test (`register-claim.integration.test.ts:332-353`).
- **Unit:** assert `classifyClaimResponse(400, …) → { kind: "invalid_request" }` and is NOT `not_found`; keep the `404 → not_found` unit assertions green (`sil-client.test.ts:115-129`); add `claimStep`-level coverage that `not_found → { done: false }` and `invalid_request → { done: true }`.
- **Do NOT** write an integration test that fabricates a server 400 — it is unreachable from the real client (see the resolved open question); 400 stays unit-only on the pure classifier.
- **Watch for** the un-awaited credential write on success (`handleDone` fires `writeTokens`/`writeConfig` un-awaited — `register-claim.integration.test.ts:97-112` documents the `settleAsyncIo` dance); the early-404-then-success test must drain it before asserting `tokens.json`.

**Standards.** Strict TS (no `any` at the union boundary — the new `invalid_request` variant rides the existing discriminated `ClaimOutcome`); fail fast (the 400 terminal is the fail-fast path); no backwards-compat shim (delete the old `not_found` terminal branch outright, do not gate it).

## In Dev — qa-developer, expert-developer

### RED phase — qa-developer (tests written first, all failing for the right reason)

**Files touched (tests only — no production source edited):**
- `src/__tests__/lib/sil-client.test.ts` — **3 tests added** (new block "a malformed 400 is its OWN non-polling terminal (NOT not_found)") + 1 passing guard ("400 invalid_request is NOT a 200-class outcome"). The existing `404 → not_found` unit assertions (the terminal-status block) are untouched and stay green. Docstring contract block updated to add the `invalid_request` `ClaimOutcome` variant + the 404-keeps-polling / 400-fails-fast split.
- `src/__tests__/register-claim.integration.test.ts` — **1 test flipped** (the terminal-status table: 404 row REMOVED, 409/410 retained) + **5 tests added** across three new blocks: premature-404-keeps-polling (first-404-doesn't-settle; early-404s→success→`sil_whoami` resolves; 404/pending interleaved), `claimStep(not_found)→done:false` via the harness, perpetual-404→timeout. Added `setApiUrl` import + `setApiUrl("")` teardown for the whoami leg's origin pin.

**Tally: 6 added, 1 flipped (+ docstring/import housekeeping). RED confirmed: 8 failing, 27 passing in the two targeted files.**

**Confirmed-failing output (current-buggy behavior — `not_found` is terminal + 400 folds into `not_found`):**
- `classifyClaimResponse(400, …)` → `expected 'not_found' to be 'invalid_request'` (×3 unit) — the classifier folds 400/unexpected-4xx into `not_found` (sil-client.ts:414-417).
- "does NOT settle on the FIRST 404" → `expected 1 to be greater than or equal to 2` — only ONE claim call fires; the loop settles on the first 404 and never ticks again.
- "polls through early 404s … sil_whoami resolves" → `expected 1 to be greater than or equal to 3` — dies on the first 404, never reaches the success tick.
- "404 and pending equivalently non-terminal" → `expected 1 to be greater than or equal to 4` — dies on the first 404.
- "a single 404 tick does not end the loop" → `expected 0 to be greater than 0` (`vi.getTimerCount()`) — the timer is already cleared after the first 404 tick; this is `claimStep(not_found)→done:true` directly.
- "perpetual 404 → timeout" → `expected [ 'sil_register_started' ] to include 'sil_register_timeout'` — the loop settles on the first 404 (logs `sil_register_not_found` at warn), so the deadline/timeout path is never reached.

**For the expert-developer (GREEN):**
- `claimStep(invalid_request) → {done:true, outcome:"invalid_request"}` (card item 6) is NOT runtime-tested: a real client cannot elicit a claim-route 400 (resolved open question), so the only honest surfaces would be a forbidden production export of the private `claimStep` or a forbidden fabricated-400 integration test. Its loop-wiring guarantee is enforced by **`tsc` exhaustiveness** — the `switch (outcome.kind)` in `claimStep` has no `default`, so adding `invalid_request` to the `ClaimOutcome` union forces you to handle it (group it with the `done:true` terminals that persist nothing). The classifier-level partition (`invalid_request` is a distinct kind from `not_found`/`pending`/`success`) IS pinned by the unit tests above.
- The `claimStep(not_found)→done:false` mapping is pinned via the integration harness (private `claimStep` exercised through its only real caller, the `sil_register` poll loop), not a direct unit — by design, no production export was added.
- Watch the un-awaited credential write: the early-404→success test drains it via the existing `settleAsyncIo`/`waitForTokens` dance before asserting `tokens.json`.

### GREEN phase — expert-developer (implementation, all tests pass)

**Production files changed (2 — exactly the surfaces Discovery named; poller untouched):**

- `src/lib/sil-client.ts` — (a) added `{ kind: "invalid_request" }` to the `ClaimOutcome` union; (b) in `classifyClaimResponse`, changed the `status !== 200` fallthrough from `return { kind: "not_found" }` → `return { kind: "invalid_request" }` (the `if (status === 404) return { kind: "not_found" }` line is unchanged — 404 stays `not_found` on the wire); (c) updated the wire-contract doc block (the `404` row now documents keep-polling-at-the-loop; added the `400/unexpected → invalid_request` non-polling-terminal row) + the `classifyClaimResponse` JSDoc.
- `src/tools/identity.ts` — (a) `claimStep`: moved `case "not_found":` up into the keep-polling group with `pending`/`retryable` (`return { done: false }`), removed it from the terminal group, and added `case "invalid_request":` to the terminal group (`return { done: true, outcome: outcome.kind }`); (b) `handleDone`: deleted the `not_found` special-case `warn` branch and replaced it with an `invalid_request` → `warn` branch (mirrors the old `not_found` severity, but for the genuinely-anomalous contract-drift case; `expired`/`already_claimed` stay at `info`, `timeout`/`success` untouched); (c) updated the `execute()` flow comment + the `claimStep` JSDoc to state 404 keeps polling and only the deadline ends a never-appearing session as `timeout`.

**Why `invalid_request` needed no runtime test (and didn't get a forbidden one):** the `claimStep(invalid_request) → done:true` wiring is guaranteed by `tsc` exhaustiveness — the `switch (outcome.kind)` has no `default`, so adding the union variant forced the terminal-group case (a missed case fails the build, not prod). Confirmed: `tsc --noEmit` is clean only WITH the case present. The classifier-level partition (`invalid_request` ≠ `not_found`/`pending`/`success`) is pinned by the qa unit tests. A real client cannot elicit a claim-route 400, so no integration test fabricates one (would test an unreachable state).

**The `{ kind: "not_found" }` union variant stays** — the classifier still emits it for a wire 404, and `claimStep` now consumes it as keep-polling. Removing it would be wrong; only its *loop treatment* changed.

**Verification (run via the main-repo `node_modules/.bin`; the fresh worktree has no own bins):**
- `pnpm typecheck` — clean (exit 0). This is also the proof the `invalid_request` exhaustiveness case is wired.
- `pnpm test` — **455 passed (455), 29 files**. The 8 previously-RED tests now pass; all 447 pre-existing tests still green (no over-reach). RED baseline before the fix was 8 failed / 447 passed.
- `pnpm build` — clean (exit 0), `dist/` emitted.
- Live-verification: build gate PASS. No app/API/UI surface — runtime behaviour is fully exercised at the integration tier (real poller + sil-client + credentials through `sil_register.execute()`, only `fetch` mocked), which is green.

### → Handoff to Review (next agent: code-quality-guardian)

**Diff is two files, both named at Discovery; `src/lib/poller.ts` is deliberately untouched** (the bounded loop + 30-min deadline are the safety net that makes keep-polling-on-404 safe — perpetual `{ done: false }` still settles as `{ timedOut: true, outcome: "timeout" }`, verified by the perpetual-404→timeout integration test leaving `vi.getTimerCount() === 0`).

Smells to check:
- **The deleted terminal `not_found` branch** in `claimStep` and the deleted `not_found`-`warn` in `handleDone` — confirm no backwards-compat shim was left (the old terminal path is removed outright, not gated). No `not_found` terminal can reach `handleDone` anymore.
- **The new union variant's exhaustiveness** — `invalid_request` is handled in the only `switch (outcome.kind)` over `ClaimOutcome` (in `claimStep`); `tsc` enforces this (no `default`). Confirm there is no second un-exhaustive switch over `ClaimOutcome` that silently accepts the new variant.
- **`not_found` union variant retained on purpose** — it is still the classifier's 404 mapping and `claimStep`'s keep-polling input; it is NOT dead. (Distinct from the catalog `LookupOutcome.not_found`, a separate union, untouched.)
- **Doc-comment accuracy** — every block that previously called `not_found` a terminal was updated (the `execute()` flow comment, the `claimStep` JSDoc, the `handleDone` inline comment, the `sil-client.ts` wire-contract block + `classifyClaimResponse` JSDoc). Stale comments contradicting the new behaviour were the explicitly-flagged review smell.
- **`handleDone` severity** — `invalid_request` logs at `warn` (signals a should-never-happen contract drift), `expired`/`already_claimed` stay at `info`. Deliberate, per the Discovery recommendation.
- **No new dependency, no `any` at the union boundary, no hardcoded config.** The success-path `settleAsyncIo`/`waitForTokens` un-awaited-credential-write behaviour is preserved unchanged (the success tests rely on it).

## Review round 1 — code-quality-guardian

**Verdict: PASS.** Surgical, correct, fully-tested bug fix. Two production files (exactly the surfaces Discovery named); `src/lib/poller.ts` deliberately untouched and confirmed so in the diff. No blocking issues, no non-blocking notes that warrant a ping-pong.

**Independent validation (run in the worktree against the main-repo `node_modules/.bin`; the fresh worktree carries no own bins):**
- `tsc --noEmit` — clean (exit 0, no output). This is also the proof that the `claimStep` exhaustiveness case for `invalid_request` is wired: the `switch (outcome.kind)` has no `default`, so an unhandled `ClaimOutcome` variant would fail the build.
- `vitest run` — **455 passed (455), 29 files** (exit 0). Matches the dev pair's claim exactly.
- `tsc -p tsconfig.build.json` — clean (exit 0), `dist/index.js` emitted. (The `pnpm clean`/rimraf pre-step only wipes stale tarball outputs; it has no bearing on compile correctness.)

**State-machine correctness (the heart of the card) — verified:**
1. **`not_found` is non-terminal on every path.** Classifier maps wire 404 → `{ kind: "not_found" }` (correct — it IS 404 on the wire; `sil-client.ts:429`). `claimStep` routes `not_found` into the keep-polling group `{ done:false }` (`identity.ts:308-311`). The poller fires `onDone` only on `{ done:true }` (`poller.ts:115`) or on the deadline (`poller.ts:93-94`), so `not_found` can never reach `handleDone` as a terminal — and `grep` confirms the `sil_register_not_found` marker is entirely gone from production code (no dead branch, no stale emit).
2. **Cannot spin forever.** The deadline check is the first statement of every `tick()` (`poller.ts:93`). A forever-404 yields perpetual `{ done:false }`, but the first tick after `POLL_DEADLINE_MS` settles `{ timedOut:true, outcome:"timeout" }` and `clearInterval`s. Bounded — proven by the perpetual-404→timeout integration test (`vi.getTimerCount() === 0` after, `sil_register_timeout` logged, not `not_found`).
3. **`invalid_request` terminal reachable & correct.** Any non-{200,409,410,404,5xx} status → `{ kind:"invalid_request" }` (`sil-client.ts:431-436`) → `claimStep` terminal group `{ done:true }`, persists nothing (`identity.ts:319-322`) → `handleDone` logs at WARN (`identity.ts:358-359`). Correctly identified as unreachable from this client today (the plugin always sends a valid 43-char verifier) → fail-fast contract-drift insurance, and correctly tested ONLY at the classifier/unit tier — no fabricated integration 400 (which would be a stub-shaped test against an unreachable state, forbidden by `complete-work-is-stub-free`).
4. **Exhaustiveness / no second un-exhaustive switch.** The `switch (outcome.kind)` in `claimStep` is the ONLY switch over `ClaimOutcome`, has no `default`, and covers all 7 variants. Other switches (`identity.ts:218` over `IdentityOutcome`; `catalog.ts:306/442` over the catalog union) are over different types — catalog's `invalid_request` is a distinct variant carrying `{ error, message }`, no collision.

**Standards sweep:** strict TS, no `any` at the union boundary; structured logging with correct levels (WARN for anomalous `invalid_request`, info for routine terminals) and no token material logged (matches `code-logging`); no hardcoded values (cadence/deadline are named constants in `poller.ts`); no backwards-compat shim (old terminal `not_found` branch deleted outright, not gated); no bloat; comment density appropriate — the dense JSDoc updates are warranted WHY-comments on non-obvious lazy-session-creation semantics, and the stale-comment smell Discovery flagged was fully cleared (`execute()` flow comment, `claimStep` JSDoc, `handleDone` inline, `classifyClaimResponse` JSDoc + wire-contract block).

**Tests are real (not stubs).** They drive the actual `sil_register.execute()` + `sil_whoami.execute()` through the real poller + sil-client + credentials with only `fetch` mocked at the boundary (the correct seam). The documented RED output is consistent with the buggy code (e.g. "does NOT settle on the FIRST 404" asserts `callCount >= 2`, which the old 404→terminal path fails at 1) — they pin the exact behavioral delta, would fail on revert, and assert no placeholder shape. `setApiUrl` is genuine production config (config.ts:70, called from prod at config.ts:112), used legitimately to pin the sil-api origin for the recovery test's whoami leg.

**Tier coverage:** matches `tiers: [unit, integration]` — classifier 400-split + single-`claimStep` mapping at unit; early-404-keep-polling, recovery-on-later-success, perpetual-404→timeout at integration. No `e2e` correctly (no live sil-web/Postgres in this repo; the 400 case is unreachable so must stay unit-only). All acceptance criteria are covered by the diff's test files.

### → Handoff back to In Dev (if FAIL/REVIEW)

n/a — PASS.

## Distillation — solutions-architect

<!-- Runs in the worktree on the card branch after Review PASS. Pushes to the same PR. Per the `distillation` skill: SEARCH docs/ INDEX files first; edit existing docs rather than creating duplicates. Captures land at smallest viable scope: inline WHY comments, docs/decisions/, docs/knowledge/, docs/product/, or CLAUDE.md. Then flips status to pr-ready. -->

- knowledge/sil-response-classification.md — **edited the canonical sil-classifier doc** (no new doc: search found this is the home for "how claim responses are classified", and its old text enumerated `409/410/404` as "distinct terminals", now stale). Two captures, both genuinely non-obvious and NOT self-evident from the per-file inline comments:
  1. Extended the claim trap (`## The 200-is-ambiguous traps` §1) to record the post-card taxonomy: `classifyClaimResponse` is **wire-pure**, `not_found` (404) is **no longer a terminal** (it's the normal pre-session early state — wrong-verifier ≡ unknown-session uniform 404, no existence oracle), and the new `invalid_request` (400/unexpected non-2xx) is the one hard-fail-fast classifier terminal (unreachable today → contract-drift insurance, WARN).
  2. Added a new section **"Terminality lives at the loop, not in the classifier"** — the cross-cutting invariant the bug turned on, which no single file states: the classifier reports wire-truth, the step mapper (`claimStep`) decides terminality; the only registration-poll terminals are a successful claim and the deadline (everything else keeps polling, bounded by `POLL_DEADLINE_MS`→`timeout`); keep-polling vs fail-fast outcomes must be **distinct union variants** (never folded); and the `switch` must keep **no `default`** so `tsc` exhaustiveness forces every future polled variant to declare its terminality. Forward-looking guidance for anyone adding a polled sil outcome.
- knowledge/INDEX.md — updated the `sil-response-classification` row (title + tags `poll, terminality, claim`, `Updated` → 2026-06-12) and re-sorted it to the top (now the freshest row).
- No inline source comments added: the diff's JSDoc/wire-contract comments already fully explain the per-line WHY (404-keeps-polling, deadline→timeout, 400→`invalid_request`-fail-fast, the WARN severity rationale, the exhaustiveness `switch`). The only gap was the *cross-cutting* "terminality lives at the loop" principle and the now-stale classifier-taxonomy enumeration — both captured in the knowledge doc above, not duplicated inline.
- No `docs/decisions/` or `docs/product/` capture: the locus-of-terminality is a repo *invariant/gotcha* (knowledge), not a contested choice with alternatives (decisions); the product-facing rule ("a 404 before the browser opens is the normal early state") is already captured behaviorally on the card's Discovery findings and is downstream of this invariant.

## PR Ready

<!-- PR url; founder notification fires here -->

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
