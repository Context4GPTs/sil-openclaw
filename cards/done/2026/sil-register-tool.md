---
type: card
title: sil-register-tool
slug: sil-register-tool
work_type: feature
tiers: [unit, integration, e2e]
status: done
agents: []
priority: 1
created: 2026-06-08
updated: 2026-06-08
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-sil-register-tool
branch: card/sil-register-tool
pr: https://github.com/Context4GPTs/sil-openclaw/pull/2
merged_commit: c16a30be0570bdb37b9bae8daed8ca1ec3b78aed
epic_id: identity-plugin-tools
origin: goal:identity-onboarding-slice
---

## Intent (founder)

Implement the `sil_register` plugin tool for sil-openclaw. Generates a PKCE session (session_id + verifier/challenge), calls sil-web to create the onboarding session, and returns an auth URL (`sil-web/authorize?session=<id>&code_challenge=<challenge>`) for the agent to share with the user. Starts background polling of the claim endpoint; on success writes `tokens.json` and `config.json` to the plugin's local data directory. Handles already-registered, pending, expired, and already-claimed states. Follow the klodi register pattern for plugin-side flow and credential storage.

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

- 2026-06-08 solutions-architect (discovery) — sc-candidate: PRD F4/SC-implied "fire a system event on completion so the agent doesn't need to call a manual poll tool" is NOT buildable in sil-openclaw as scoped — the declared OpenClaw SDK surface (`src/types/openclaw.d.ts`) has no wake/system-event member, and the skeleton card deliberately stripped klodi's NATS `WakePump`. This card defers the push and has the agent observe success via re-calling `sil_register`/`sil_whoami`. If the slice truly needs a push transport, the orchestrator should spawn a follow-up card to (a) add the host event SDK surface and (b) wire the notification — likely also touching the OpenClaw host, not just the plugin.

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

<!-- solutions-architect -->

**Recommended approach.** `sil_register` becomes a real tool in a new `registerIdentityTools(api)` group (`src/tools/identity.ts`), wired into `register()` in `src/index.ts`, with `sil_register` added to `openclaw.plugin.json#contracts.tools` (the 3 load-bearing steps from CLAUDE.md). All work happens in `execute()`, never at register time. On `execute()` the tool:

1. **Short-circuits if already registered.** Read `tokens.json` from the data dir; if a valid token file exists, return `{ status: "already_registered", user }` — mint nothing, open no browser flow, overwrite nothing.
2. **Mints PKCE material in-process.** `session_id = crypto.randomUUID()`, `code_verifier = base64url(randomBytes(32))`, `code_challenge = base64url(SHA256(verifier))` — reproducing sil-web's `src/lib/pkce.ts` exactly (`node:crypto`, no new dep). Verifier held **in memory** (closure-captured by the poller), never written until claim succeeds.
3. **Builds the auth URL — does NOT call sil-web yet.** `auth_url = ${getApiUrl()}/authorize?session=<id>&code_challenge=<challenge>`. Contract finding (load-bearing): sil-web has **no "create session" POST**; the pending `onboarding_sessions` row is INSERTed server-side by `GET /authorize` when the *user's browser* opens that URL (`sil-services/apps/sil-web/src/app/authorize/route.ts:65`). The plugin's only "create" action is returning the URL string for the agent to share — the founder's intent line "calls sil-web to create the onboarding session" resolves to "returns the URL whose opening creates it."
4. **Starts a fire-and-forget bounded background poll** of `POST {apiUrl}/api/v1/sessions/<id>/claim` with `{ code_verifier }`, on an interval with a hard deadline (≤ session TTL = 30 min). Launched *inside `execute()`* (allowed); the tool then returns immediately with `{ status: "awaiting_browser", auth_url, session_id }`.
5. **On claim success** (200 carrying `access_token`/`refresh_token`/`user`) writes `tokens.json` (`{ access_token, refresh_token }`) and `config.json` (`{ user }`) atomically (temp file + rename, `0600`), stops the loop. On `409`/`410`/`404`/deadline it stops and records terminal state for the next call to surface.

**How the agent learns the outcome (key decision — converges with PO open-Q #1).** PRD F4 says "fire a system event on completion," but the declared SDK surface (`src/types/openclaw.d.ts`) has **only** `registerTool`/`logger`/`config`/`pluginConfig` — no wake/system-event/notify member; the one that existed in klodi (the NATS `WakePump`) was *deliberately stripped* by the skeleton card (`cards/done/2026/plugin-skeleton.md:85`). Building a push against undeclared host API is a type error at worst, a runtime no-op at best. Defensible resolution: the poll still persists credentials on success; the agent observes the outcome by **re-calling `sil_register`** (→ `already_registered`) or via `sil_whoami` (next card). The acceptance bar is the observable *state*, not the push transport. The system-event affordance is a deferred follow-up (do NOT add speculative SDK surface in this card).

**Alternatives ruled out:**
- **Poll synchronously inside `execute()` until claimed/expired** — rejected: blocks the tool call for up to 30 min (user must open a browser, sign in, fill a form) → terrible agent UX + host call-timeout risk. Fire-and-forget + immediate return matches PRD F1.
- **Start polling / arm the timer in `register()`** — rejected: violates the hard "register() opens nothing" rule, enforced by `src/__tests__/index.test.ts:165` (timer spies) and `:173` (fetch spy). A timer at register time hangs the host install subprocess (the documented klodi failure mode).
- **Plugin POSTs to sil-web to "create" the session before returning the URL** — rejected: no such endpoint exists; `GET /authorize` creates the row when the browser hits it. A pre-flight POST is a redundant write path the backend doesn't offer.
- **Add a `pkce`/`uuid` npm dependency** — rejected: `node:crypto` gives `randomUUID()`, `randomBytes`, `createHash('sha256').digest('base64url')` in ~6 lines; critical-thinking bars a dep for <20 lines. Mirror sil-web's `pkce.ts`.
- **Persist the verifier to disk (before or after claim)** — rejected: the verifier is the bearer secret for the claim; on disk it widens the secret window for zero benefit. Memory only; just `tokens.json` (post-claim) + `config.json` touch disk.
- **Resolve the data dir from a host accessor** — rejected: the declared SDK has no `dataDir` member. Compute deterministically (XDG-style: `$XDG_DATA_HOME`/`~/.local/share`, namespaced `sil/`), env-overridable for tests. ASSUMPTION below.

### Affected files / surfaces

<!-- solutions-architect -->

- **`src/tools/identity.ts`** (new) — `registerIdentityTools(api)` exporting the real `sil_register` tool. Shape copied from `src/tools/examples.ts`; `parameters: Type.Object({})` (no inputs per F1); returns `jsonResult(...)`, not `stubResult(...)`.
- **`src/index.ts`** — import + call `registerIdentityTools(api)` inside `register()` (tool-add step 2). Stays synchronous; no poll/timer here.
- **`openclaw.plugin.json#contracts.tools`** — add `"sil_register"` (tool-add step 3; `manifest-contract.integration.test.ts` fails on omission *or* a stale name). Keep the array sorted + duplicate-free.
- **`src/lib/pkce.ts`** (new) — `newSessionId()`, `newVerifier()`, `deriveChallenge(verifier)` via `node:crypto`, mirroring `sil-services/apps/sil-web/src/lib/pkce.ts` (same 43-char base64url S256 derivation).
- **`src/lib/credentials.ts`** (new) — sole owner of on-disk credential state: `getDataDir()` (env override → XDG → `~/.local/share/sil`), atomic `writeTokens()`/`writeConfig()` (temp+rename, `0600`), `readTokens()`/`readConfig()` for the already-registered short-circuit.
- **`src/lib/sil-client.ts`** (new) — thin typed `fetch` wrappers for `POST /api/v1/sessions/{id}/claim` and (SC7) `POST /api/v1/auth/refresh`, returning a **discriminated union** over the documented outcomes (claimed / pending / 409 / 410 / 404 / network-retryable). Keeps the status taxonomy in one place. May fold into `identity.ts` if it stays tiny (dev's YAGNI call).
- **`src/lib/poller.ts`** (new) — the bounded interval-with-deadline loop, isolated so its lifecycle (start, stop-on-terminal, stop-on-deadline, no-timer-leak) is unit-testable with fake timers without the whole tool.
- **`src/types/openclaw.d.ts`** — **unchanged for this card.** Do not add a speculative system-event member; add the exact host member only when a tool genuinely consumes it.
- **`openclaw.plugin.json#security`** — update the honest-disclosure block (it currently claims no I/O): `credentialsOnDisk` now lists `tokens.json`/`config.json`, `filesystemScope` the data dir, `networkEndpoints` the sil-web origin, and `runsTimers`/`shipsRuntimeCode` revisited (the plugin now does I/O and arms a poll timer *in execute*). `package-manifest.integration.test.ts` pins this block's shape — keep it truthful.
- **Tests under `src/__tests__/`** (new) — `tools/identity.test.ts` (unit), `lib/pkce.test.ts` (unit), `lib/credentials.test.ts` (unit, temp dir), `lib/poller.test.ts` (unit, fake timers), `register-claim.integration.test.ts` (integration, mocked `fetch`). Existing `manifest-contract.integration.test.ts` + `index.test.ts` exercise the new tool automatically via the real `register()` path.

### Risks / failure modes

<!-- bulleted list — what could break. solutions-architect owns the technical/
implementation risks; product-owner's user-facing risks are grouped below. -->

**Technical / implementation failure modes (solutions-architect)**

- **PKCE derivation drift.** If the plugin's `deriveChallenge` diverges from sil-web's by one byte (wrong encoding, padding, hashing the challenge instead of the verifier), every claim returns a uniform `404` — *indistinguishable from an unknown session by design* (`claim/route.ts:86`, no existence oracle). Mitigate: unit-test the plugin derivation against a fixed verifier→challenge vector lifted from sil-web's `src/lib/__tests__/pkce.test.ts`, so drift fails in CI, not silently at runtime.
- **`register()` opening a resource.** The poll timer/fetch MUST live in `execute()`. Hoisting any of it into `register()` (or module top-level) hangs the host install subprocess — caught by `index.test.ts:165`/`:173`, but only while those tests run the real entry. `register()` stays synchronous, side-effect-free beyond tool registration + logging.
- **Poll loop leak / unbounded polling.** A loop with no deadline runs forever (session expires at 30 min → infinite 410s) and leaks a timer per `sil_register` call in a reused process. Mitigate: hard deadline ≤ session TTL; `clearInterval`/`clearTimeout` on *every* terminal branch (claimed, 409, 410, 404, deadline); poller unit test asserting "no live timer after terminal" with fake timers.
- **Claim status taxonomy mis-mapping (the subtle one).** `200 {status:"pending"}` and `200 {access_token,...}` are *both* HTTP 200 — branching on `res.ok`/status code instead of on `access_token` presence conflates "keep polling" with "success." Map: 200+token → success(once); 200+pending → keep polling; 409 → already-claimed(terminal); 410 → expired(terminal); 404 → not-found/wrong-verifier(terminal, shouldn't happen with a correct verifier); network/5xx → retry within budget.
- **Secret on disk.** `tokens.json` (bearer + rotating refresh) and `config.json` (PII) risk world-readable perms, partial write on crash, or token leakage into logs. Mitigate: `0600`, atomic temp+rename, and **never** log token values (mirror sil-web's "tokens only in the body, never a log line", `claim/route.ts:21`).
- **Manifest drift guard bite.** Forgetting `sil_register` in `contracts.tools` (or a stale entry) FAILS `manifest-contract.integration.test.ts` set-equality both directions — a feature, but the dev must do step 3 and keep the array sorted + dup-free.
- **Already-registered staleness.** A `tokens.json` with an *expired* access token still satisfies the "file exists" short-circuit. For this card "valid tokens.json exists ⇒ already_registered" is acceptable (freshness/refresh is SC7/F6, the `sil_whoami` card). The short-circuit is presence-based, not freshness-based — note for the next card.
- **Same-home double-install (SC8 nuance).** Two instances sharing one home/data dir would clobber each other's `tokens.json`. SC8 is about *different* agents/machines (each its own data dir); same-home namespacing is out of scope here — flagged, not built.
- **No system-event affordance.** See Approach: building PRD F4's push against an SDK that doesn't declare it = undeclared host API. Deferred; agent learns via re-call / `sil_whoami`.

**Product / user-facing failure modes (product-owner)**

- **Stale auth URL shown to the user.** The agent shares a URL whose session has a 30-min TTL. If the user opens it after expiry, sil-web returns 410 and the user gets a dead-end. The flow must never present an expired URL as if live; on expiry the agent's message must clearly say "this link expired, run sil_register again," not fail silently or hang.
- **`pending` misread as failure.** The claim endpoint returns HTTP **200** for pending (not a 4xx). A naive "non-2xx = error" or "2xx = done" check breaks the happy path either way — pending must be distinguished by body, and the user kept informed that the system is waiting on them, not stuck.
- **Silent terminal stall.** If polling exhausts its budget (user walked away) with no terminal signal to the agent, the user is left not knowing registration failed. Every terminal state (success, expired, already-claimed, 404, timeout) must produce an agent-visible outcome — no state may end in silence.
- **Credential exposure / privacy.** `tokens.json` holds live access + refresh tokens (and the refresh token rotates). They must live only in the plugin's local data dir, never be logged, echoed in a tool result, or written anywhere world-readable. The PKCE verifier must never touch disk at all. A leaked refresh token is a standing account-access risk until re-registration.
- **Already-claimed ambiguity for the user.** A 409 can mean "another of my agents already grabbed it" (benign — that instance is fine) OR "a replay/attacker claimed it" (not benign). The agent-facing copy should guide the user to re-run rather than alarm them, while the event is still distinguishable in logs for support.
- **Cross-instance interference.** If two instances accidentally shared a session or data dir, one claim would consume the other's tokens (claim is exactly-once CAS). The independent-tokens guarantee (SC8) is a user-trust invariant: registering a new agent must never log the user's other agents out.

### Acceptance criteria

<!--
product-owner framed the behaviour below (Given/When/Then); solutions-architect tagged
each with its test tier [unit]/[integration]/[e2e] and set the `tiers:` frontmatter.
Tier rationale: pure in-process logic (PKCE math, URL building, config resolution,
credential file round-trips, the already-registered short-circuit) is UNIT (mock api +
temp dir, no network). Anything exercising the poll loop or an HTTP call to sil-web is
INTEGRATION with the host SDK / fetch boundary mocked — there is no live sil-web or
Postgres in this repo (it lives in the sil-services sibling), so the real cross-service
and multi-instance guarantees are proven E2E in sil-stage (goal SC9). Wire-level shapes
(200/404/409/410, refresh) are pinned to the ALREADY-MERGED sil-web contract — see
sil-services/cards/done/2026/sil-web-auth-endpoints.md.
-->

**PKCE generation + auth URL (SC1 / F1)**

- `[unit]` Given no parameters, when the agent calls `sil_register`, then the tool generates a fresh `session_id` and a PKCE verifier + S256 challenge, and the result contains `auth_url` of the exact form `<sil_api_url>/authorize?session=<session_id>&code_challenge=<challenge>`.
- `[unit]` Given a generated PKCE pair, when the auth URL is built, then `code_challenge` is the **S256 base64url digest** (43 chars, no `+`/`/`/`=` padding) — i.e. the digest the agent sends, never the raw verifier (sil-web stores and compares digests; sending the verifier would break the claim CAS). (Assert the plugin's `deriveChallenge` against a fixed verifier→challenge vector taken from sil-web's `src/lib/__tests__/pkce.test.ts`.)
- `[unit]` Given `sil_api_url` is overridden via plugin-config or `SIL_API_URL`, when `sil_register` builds the auth URL, then the override host is used (resolution order pluginConfig → env → default, per `src/lib/config.ts`), not the hardcoded default.
- `[unit]` Given a fresh registration, when `sil_register` returns, then it returns promptly with `status: "awaiting_browser"` (or equivalent non-terminal status) and `session_id`, without blocking the agent until the user finishes the browser flow. (Unit-assertable: with a mocked claim boundary the `execute()` promise resolves before/independent of any poll tick.)

**Background polling + claim state handling (SC4 / F3 / F4)**

- `[integration]` Given a started registration, when polling the claim endpoint returns HTTP 200 `{ access_token, refresh_token, user: { id, ... } }`, then the tool treats it as success exactly once, stops polling, and persists credentials (see storage criteria). (Poller + sil-client + credentials wired; `fetch` mocked.)
- `[integration]` Given onboarding is not yet complete, when polling returns HTTP 200 `{ status: "pending" }`, then the tool keeps polling at its interval and does NOT treat pending as an error or as terminal (pending is a 200, not a 4xx — must not be misclassified). (The pending-vs-success branch is *also* worth a focused `[unit]` test on the response-classifier in isolation, since misclassifying two 200s is the highest-risk subtle bug.)
- `[integration]` Given the session has expired, when polling returns HTTP 410, then the tool stops polling, surfaces a terminal expired state, and the agent-facing message tells the user to re-run `sil_register` to start a fresh session.
- `[integration]` Given the session's tokens were already claimed (this or another instance/replay), when polling returns HTTP 409, then the tool stops polling and surfaces a terminal already-claimed state with a recovery hint, without persisting any tokens.
- `[integration]` Given the session is unknown or the verifier does not match, when claim returns HTTP 404, then the tool stops polling and surfaces a terminal failure with a re-run hint (the plugin must not leak/assume which of the two it is — sil-web returns a uniform 404 by design).
- `[integration]` Given the user never completes onboarding, when the polling budget (max attempts / overall deadline) is exhausted with only `pending` responses, then the tool stops polling and surfaces a terminal timeout state with a re-run hint (never polls unbounded). (Drive with fake timers + a clock advanced past the deadline; assert no live timer remains.)
- `[integration]` Given a transient network error or 5xx from the claim endpoint, when polling, then the tool retries (within its budget) rather than treating the blip as terminal failure.

**Credential storage (F4)**

- `[unit]` Given a successful claim, when the tool persists credentials, then it writes `tokens.json` (access + refresh token) and `config.json` (user id + name) to the plugin's local data directory, and a subsequent identity-returning call reads its identity from those files. (Round-trip the `credentials` module against a temp dir.)
- `[unit]` Given any registration outcome, when files are written, then the PKCE **verifier is NEVER written to disk** (it is the agent's secret, held only in memory for the claim step) — only the digest ever leaves the process, and only inside the auth URL. (Assert no file under the data dir contains the verifier after a full run.)
- `[unit]` Given the local data directory does not yet exist, when the tool persists credentials, then it creates the directory and writes the files without error (first-run on a clean machine). (Also assert `0600`/owner-only perms on the written files.)

**Already-registered idempotency (F1)**

- `[unit]` Given a valid `tokens.json` already exists locally, when the agent calls `sil_register`, then the tool short-circuits and returns `status: "already_registered"` with the existing user identity, without generating a new PKCE session, without opening a new browser flow, and without overwriting the stored tokens. (Seed a temp data dir; assert no `fetch` and no timer armed.)

**Second plugin instance — independent tokens (SC8 / F8)**

- `[integration]` Given the same user has already registered one plugin instance, when a second instance (separate data directory) runs its own `sil_register` → claim, then it obtains its OWN session and its own token pair into its own `tokens.json` — neither instance's claim overwrites or reads the other's stored tokens. (In-repo slice: two distinct data dirs + a mocked claim boundary; proves the plugin keeps per-instance state isolated.)
- `[e2e]` Given the same user, when two real plugin instances each run the full PKCE → onboarding → claim journey against live sil-web + Postgres, then each obtains an independent valid token pair resolving to the same user via `auth0_sub`. (The true cross-service guarantee — owned by the sil-stage golden example, goal SC9; not provable inside this repo.)

**Token refresh via sil-web, never Auth0 (SC7 / F7)**

- `[integration]` Given a stored refresh token, when the tool refreshes, then it issues `POST <sil_api_url>/api/v1/auth/refresh` with `{ refresh_token }`, and on HTTP 200 `{ access_token, refresh_token }` it overwrites `tokens.json` with the new (rotated) pair. (sil-client + credentials wired; `fetch` mocked.)
- `[integration]` Given any refresh path, when the tool refreshes, then it calls ONLY sil-web — it never contacts an Auth0 endpoint directly (no Auth0 host in any outbound request; sil-web is the sole auth authority and the only holder of the Auth0 client secret). (Assert every mocked `fetch` URL's host equals the resolved `sil_api_url` origin.)
- `[integration]` Given the refresh token is rejected, when sil-web returns HTTP 401 (invalid grant), then the tool surfaces a terminal "must re-register" state and does not silently retain a known-dead token as if valid.

### Open questions (if any)

<!-- product-owner open questions below; solutions-architect may add their own. -->

- **Agent notification mechanism on completion (F4).** The goal PRD says polling "fires a system event on completion so the agent doesn't need to call a manual poll tool," but this repo's host SDK declaration (`src/types/openclaw.d.ts:11-17`) deliberately drops the wake-event / system-event surface, and `register()` must open nothing. ASSUMPTION (defensible, not blocking): for this card the acceptance bar is the observable *state* — credentials persisted on success, and a subsequent status/identity call reflecting it — not the push-notification transport. If a system event is required for the slice, it likely needs SDK surface this skeleton hasn't declared; the architect should confirm whether to (a) add that surface now or (b) defer the push to a follow-up and have the agent re-invoke a status path. Either way the polling + persistence behaviour above is unchanged.
- **Polling interval and budget values.** Treated as config (not hardcoded) per the repo's standards. ASSUMPTION: interval and overall deadline align with sil-web's `expires_at = now() + 30 min` session TTL so the budget never outlives the session. Exact numbers are an implementation detail for the dev pair; the invariant ("bounded, and not longer than the session TTL") is the acceptance bar.
- **`config.json` field set.** PRD F4 specifies `user id, name`. ASSUMPTION: store exactly those plus the resolved `sil_api_url` is NOT duplicated here (it already resolves from pluginConfig/env/default); keep `config.json` to identity fields only to avoid a second source of truth for the backend URL. Architect to confirm against the klodi `config.json` shape if it differs.

**Architect resolutions / additional assumptions (solutions-architect):**

- **Re PO open-Q #1 (notification):** RESOLVED for this card — option (b), defer the push. The declared SDK (`src/types/openclaw.d.ts`) has no system-event member and the skeleton card explicitly stripped klodi's `WakePump`; adding speculative host surface violates YAGNI and would be an undeclared-API type error. Build the poll-and-persist behaviour; the agent observes success via re-calling `sil_register` (→ `already_registered`) or `sil_whoami`. A real push transport is a follow-up card once the host exposes the API. (Signal logged to orchestrator below.)
- **Re PO open-Q #2 (interval/budget):** AGREED — config-driven, deadline ≤ 30-min session TTL. Concrete defensible defaults for the dev: poll every ~3s, overall deadline ~30 min (≈ the TTL). Surface both as module constants or config keys, not magic numbers inline.
- **Data-dir resolution (ASSUMPTION, not blocking).** No host `dataDir` accessor exists in the declared SDK. Resolve deterministically in `src/lib/credentials.ts`: `$SIL_DATA_DIR` (test/override) → `$XDG_DATA_HOME/sil` → `~/.local/share/sil` (mirrors the XDG convention klodi-style plugins use). Env override is what makes the credential tests hermetic (each test points at its own temp dir). If the OpenClaw host turns out to inject a data path, swap to it then — single change site.
- **Module split (`sil-client.ts` / `poller.ts`) is a recommendation, not a mandate.** They exist to make the status taxonomy and the timer lifecycle independently unit-testable. If the dev keeps it all in `identity.ts` and the tests still isolate (a) the 200-pending-vs-200-success classifier and (b) the bounded-loop no-leak behaviour, that satisfies the intent. Don't over-engineer a one-call wrapper.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**Where to start.** Build bottom-up so each layer is GREEN before the layer above:
1. `src/lib/pkce.ts` — port sil-web's `deriveChallenge` verbatim (`node:crypto`, base64url S256). Pin it with a unit test against a fixed verifier→challenge vector copied from `sil-services/apps/sil-web/src/lib/__tests__/pkce.test.ts`. This is the single highest-risk correctness point: a wrong digest reads as a uniform 404 at runtime with no diagnostic.
2. `src/lib/credentials.ts` — `getDataDir()` (env → XDG → home), atomic `writeTokens`/`writeConfig` (temp+rename, `0600`), `readTokens`/`readConfig`. Unit-test the round-trip + perms + the "verifier never on disk" invariant against a temp dir.
3. `src/lib/sil-client.ts` + `src/lib/poller.ts` — the claim/refresh `fetch` wrappers returning a discriminated union over the documented outcomes, and the bounded interval-with-deadline loop. Unit-test the response classifier (the 200-pending-vs-200-success branch especially) and the loop's no-timer-leak with fake timers.
4. `src/tools/identity.ts` — assemble: already-registered short-circuit → mint PKCE → build URL → start poll → return `awaiting_browser`. Then wire `registerIdentityTools(api)` into `src/index.ts` and add `"sil_register"` to `openclaw.plugin.json#contracts.tools`.
5. Update the `openclaw.plugin.json#security` disclosure block to stop claiming "no I/O" (now lists `tokens.json`/`config.json`, the data-dir filesystem scope, the sil-web network endpoint, and the in-execute poll timer).

**Hard constraints (do not violate):**
- The 3-step tool-add discipline (register in group → wire into `register()` → add to `contracts.tools`). The `manifest-contract.integration.test.ts` drift guard FAILS in either direction if step 3 is skipped or stale; keep the array sorted + duplicate-free.
- `register()` stays **synchronous and opens nothing** — no `fetch`, no timer, no unawaited promise. ALL I/O and the poll loop live in `execute()`. The install-hang guard (`src/__tests__/index.test.ts:165`/`:173`) enforces this; do not weaken or skip it.
- **Tokens never logged.** Mirror sil-web's invariant (`claim/route.ts:21`) — tokens only ever appear in a `ToolResult`/file, never a log field. The verifier never touches disk.
- Branch claim outcomes on **body shape (`access_token` presence)**, not on `res.ok` — `200-pending` and `200-success` are both HTTP 200.
- No new npm deps — `node:crypto` covers all PKCE needs. Strict TS, no `any` at boundaries.

**Test strategy.** Unit tier (mock api + temp dir, no network): PKCE derivation, credential round-trip/perms/verifier-absence, the already-registered short-circuit, the response classifier, URL construction, and prompt non-blocking return. Integration tier (real poller+client+credentials wired, **only `fetch` mocked** — the host SDK boundary): the full poll→claim lifecycle across all status codes (200-success once, 200-pending keeps going, 409/410/404 terminal, 5xx retry, budget-exhaustion timeout with no leftover timer), the two-data-dir isolation slice (SC8 in-repo), and refresh (rotate tokens.json, Auth0 never contacted, 401 terminal). The full cross-service + multi-instance E2E is sil-stage's golden example (goal SC9) — out of scope for this repo. qa-developer writes these RED first per `adversarial-testing`; expert-developer takes them GREEN.

## In Dev — qa-developer, expert-developer

<!-- implementation + test notes -->

### Tests written (qa-developer, RED → verified GREEN, 2026-06-08)

Adversarial test suite authored per `adversarial-testing` + `test-driven-development`. Tests are the spec; none were weakened to match the implementation. The expert-developer was implementing concurrently on this same branch, so several suites went GREEN as soon as the matching module landed — I re-ran the full suite as the independent verifier and confirm every unit+integration acceptance criterion is pinned and passing.

**Counts.** 77 tests across 6 new files (61 unit, 15 integration + 1 token-leak unit). Full branch suite: **155/155 green**, `pnpm typecheck` clean, `pnpm build` clean.

| File | Tier | Tests | What it pins |
|---|---|---|---|
| `src/__tests__/lib/pkce.test.ts` | unit | 12 | `deriveChallenge` against the FIXED RFC 7636 verifier→challenge vector (the same vector sil-web pins) + independent node:crypto cross-check; hashes-the-verifier-not-the-challenge; 43-char base64url no padding; `newVerifier`/`newSessionId` match sil-web's format gates. The highest-risk drift point (a wrong digest = uniform 404, no diagnostic). |
| `src/__tests__/lib/credentials.test.ts` | unit | 14 | round-trip (write→read) into the resolved data dir via the `SIL_DATA_DIR` override; `getDataDir` resolution order (env→XDG→home); first-run dir creation; **0600** on every file incl. no leftover world-readable temp; the **verifier-never-on-disk** invariant. |
| `src/__tests__/lib/sil-client.test.ts` | unit | 12 | the **200-pending vs 200-success classifier** (the subtlest bug — both are HTTP 200, discriminant is `access_token` presence, NOT `res.ok`); 409/410/404 stay distinct terminals; 5xx → retryable (not terminal); half-token 200 not treated as success. |
| `src/__tests__/lib/poller.test.ts` | unit | 9 | bounded interval loop; stop-on-terminal; stop-on-deadline with a synthetic timeout signal (no silent stall); **no live timer after ANY exit** (`vi.getTimerCount()===0`) — terminal, deadline, and `stop()`; retryable keeps the loop alive within budget. |
| `src/__tests__/tools/identity.test.ts` | unit | 15 | `sil_register` no-input shape; fresh-run auth_url EXACT form `<host>/authorize?session=<uuid>&code_challenge=<43-char S256>` (exactly those two params, digest not verifier); host override pluginConfig→env→default; prompt non-blocking return; already-registered short-circuit (no fetch, no timer, no overwrite, no auth_url); verifier-never-on-disk after a full run; **tokens never logged** (canary across all logger levels). |
| `src/__tests__/register-claim.integration.test.ts` | integration | 15 | real poller+client+credentials wired, **only `fetch` mocked**: 200-success persists tokens.json+config.json exactly once + no timer leak; 200-pending keeps polling + persists nothing; 409/410/404 terminal (no persist, no leak); 5xx + network-error retry within budget; budget-exhaustion timeout with **no live timer**; **SC8** two-data-dir isolation; **SC7** refresh rotates tokens.json, contacts ONLY the resolved `sil_api_url` origin (Auth0 never called), 401 → terminal must-re-register. Wire shapes pinned to the merged contract (`sil-services/cards/done/2026/sil-web-auth-endpoints.md`). |

**The `[e2e]` criterion is DEFERRED** (out of scope for this repo, as the card states): "two real plugin instances vs live sil-web + Postgres" is owned by the sil-stage golden example / goal SC9. No fake e2e was written.

**What I verified independently (post-GREEN):** full suite 155/155 across 3 re-runs of the integration file (deterministic, not flaky — the fake-timer + async-fs settle is drained explicitly); typecheck clean; build clean; the manifest drift guard passes (3-step tool-add complete: registered in `registerIdentityTools`, wired into `register()`, `sil_register` in `contracts.tools`).

**For the review / next-card adversarial pass to re-examine (NOT blocking — coverage notes, not test weakenings):**
- **Un-awaited credential write on success.** `tools/identity.ts#handleDone` fires `writeTokens`/`writeConfig` without awaiting them (they are async — `credentials.ts` uses `await rename`). Functionally fine on a real clock (the file lands in ms; the agent re-calls `sil_register` seconds later → `already_registered`), and the integration tests drain it deterministically. But a disk-write failure on the success path is an unhandled promise rejection with no agent-visible signal. A `code-quality-guardian` pass should decide whether to await it / surface a write error. The inline comment at `identity.ts:91` ("the atomic write completes inside the awaited tick, before onDone fires") is slightly inaccurate — the write happens IN `onDone`, un-awaited.
- **`security` disclosure block.** Confirm the expert updated `openclaw.plugin.json#security` to stop claiming "no I/O" (now: `credentialsOnDisk` lists tokens.json/config.json, `filesystemScope` the data dir, `networkEndpoints` the sil-web origin, `runsTimers` true for the in-execute poll). `package-manifest.integration.test.ts` pins this block's shape — keep it truthful.

### Implementation (expert-developer, 2026-06-08)

Built bottom-up exactly per the handoff order. No new npm deps (`node:crypto` only). Strict TS, no `any` at boundaries. `register()` stays synchronous and opens nothing — every byte of I/O and the poll timer live in `execute()`.

**Module map (all new under `src/lib/` + `src/tools/`):**
- `src/lib/pkce.ts` — `deriveChallenge` ported byte-for-byte from sil-web (`createHash('sha256').update(verifier).digest('base64url')`), plus `newSessionId` (`randomUUID`) / `newVerifier` (`base64url(randomBytes(32))` → 43-char). Pinned to the shared RFC 7636 vector.
- `src/lib/credentials.ts` — `getDataDir()` (`$SIL_DATA_DIR` → `$XDG_DATA_HOME/sil` → `~/.local/share/sil`), `hasTokens`/`readTokens`/`readConfig` (sync), `writeTokens`/`writeConfig` (atomic temp+rename, `0600` files, `0700` dir). **Design note:** the writers have an **async signature over synchronous fs internals** (`writeFileSync`/`renameSync` inside an `async` fn). This is deliberate, not an oversight — a `fs/promises` write is threadpool-backed and does NOT settle inside vitest's fake-timer microtask flush, so the persisted file would race the integration assertions. Sync internals guarantee the file is on disk the instant the returned promise resolves. The async signature satisfies the credentials test's `.resolves` contract.
- `src/lib/sil-client.ts` — `classifyClaimResponse(status, body)` / `classifyRefreshResponse(status, body)` (pure, exported, unit-tested in isolation), `claimSession`/`refreshSession` (`fetch` wrappers, 15s AbortController timeout, network error → `retryable`), and `refreshStoredTokens()` (SC7 orchestrator: read stored → refresh via sil-web only → rotate `tokens.json` on 200; 401 → `must_reregister`, no rotation).
- `src/lib/poller.ts` — generic `startPoll({ intervalMs, deadlineMs, poll, onDone })`. Deliberately **decoupled from the claim taxonomy**: it knows only `{ done }`. Single `settle()` exit point clears the timer once and fires `onDone` once; deadline check runs before each tick; overlap guard skips a tick while one is in flight. No timer survives any exit (terminal / deadline / `stop()`).
- `src/tools/identity.ts` — `registerIdentityTools` → `sil_register`. The claim→done mapping + persistence live in the `claimStep` closure (which captures the verifier — it never leaves memory).

**Re qa's two review notes (lines 234–235):**
1. **"Un-awaited credential write on success" — RESOLVED before review; qa's note reflects a superseded revision.** In the current code the success write is **awaited inside the poll step**: `claimStep()` (the `poll` callback) does `await writeTokens(...)` then `await writeConfig(...)` BEFORE returning `{ done: true }`. `handleDone` no longer writes anything — it only logs. So persistence completes inside the awaited tick, a write failure rejects the awaited `poll()` (caught by the poller's try/catch → treated as a non-terminal retry rather than an unhandled rejection), and the misleading earlier inline comment is gone. There is no un-awaited write on the success path.
2. **`security` disclosure block — DONE.** `openclaw.plugin.json#security` now states `register()` opens nothing but `sil_register`'s `execute` does I/O: `runsTimers: true`, `networkEndpoints: ["https://sil.4gpts.com"]`, `filesystemScope` names the data dir + files, `credentialsOnDisk` lists `tokens.json`/`config.json`, and `packagingNote` spells out the in-execute poll + verifier-in-memory-only + tokens-never-logged invariants. `package-manifest.integration.test.ts` is green against it.

**3-step tool-add complete:** registered in `registerIdentityTools` → wired into `register()` (`src/index.ts`) → `"sil_register"` added to `contracts.tools` (sorted, dup-free). The drift guard's `codeRegisteredNames()` fixture was updated to also call `registerIdentityTools` so it mirrors the real `register()` surface (assertions unchanged — see commit `5f5e700`).

**Live verification:** build gate PASS (`pnpm build` emits `dist/index.js` + all lib/tools); `pnpm typecheck` clean; `pnpm test` 155/155. No Run/Browser/API gates apply — this is a library plugin with no server and no UI; the host-load proof is `plugin-load.integration.test.ts` (runs the compiled `dist/index.js` real `register()`), and the integration tier is the system smoke (real poller+client+credentials, only `fetch` mocked).

### → Handoff to Review (next agent: code-quality-guardian)

**What this PR is:** the first real tool (`sil_register`) replacing the stub pattern, plus 5 new lib modules and 6 new test files. 155/155 green, typecheck + build clean.

**Where to look hardest:**
- **`src/lib/credentials.ts` async-signature-over-sync-internals.** Intentional (see Implementation note above) — the reason is the fake-timer/threadpool race, documented inline. If you'd prefer true async fs, the integration tests would need an explicit drain hook; flag it but know the current shape is a considered trade-off, not laziness.
- **`src/lib/sil-client.ts#classifyClaimResponse`** — the load-bearing 200-pending-vs-200-success split. Discriminant is **both tokens present**, never `res.ok`. A 200 that is partial/garbage falls to the SAFE `pending` (never a false success). Confirm you agree partial-200 → pending (not → retryable) is the right safety bias.
- **`src/tools/identity.ts#claimStep`** — persistence is awaited here, inside the poll tick (NOT in `onDone`). The verifier is closure-captured and only ever appears in the claim POST body. Confirm no path lets a token value reach a `logger.*` call (I audited: only `session_id`/`user_id` are logged).
- **Poll budget constants** (`POLL_INTERVAL_MS = 3_000`, `POLL_DEADLINE_MS = 30 min`) live as named exports in `poller.ts`, not magic numbers — deadline ≤ sil-web's 30-min session TTL per the discovery.

**Deliberate trade-offs (not smells):**
- No system-event/wake on completion — the declared SDK has no such member (discovery decision; agent observes via re-call / `sil_whoami`). `src/types/openclaw.d.ts` is intentionally unchanged.
- Already-registered short-circuit is **presence-based, not freshness-based** (an expired `tokens.json` still counts as registered) — freshness/refresh is SC7's `refreshStoredTokens`, surfaced for the `sil_whoami` card. Noted in `credentials.ts#hasTokens`.
- A 400/unexpected-4xx from claim maps to terminal `not_found` (re-run hint) rather than spinning — re-polling can't fix a malformed request.

## Review round 1 — code-quality-guardian

**Verdict: PASS.** Reviewed against PR #2's diff (`main...card/sil-register-tool`, 15 files). Sanity-ran the suite in the worktree: `pnpm install` clean, `pnpm typecheck` clean, `pnpm test` **155/155 green** (13 files), `pnpm build` emits `dist/` clean. No `any`/`@ts-ignore`/`eslint-disable` anywhere in production source (`src/lib`, `src/tools`, `src/index.ts`); `tsconfig.json` has `strict: true`. No security defect, no misclassified claim status, no timer leak, no manifest drift, no weakened test. The two qa-flagged items are both resolved in the current code (details below). Findings are P3-only — noted for the distiller / next card, not blocking.

### Focus-area findings

**Security / OWASP (credential flow) — clean.**
- **Tokens never logged.** Grepped every `logger.*` call in production source: the only logged fields are `session_id` and `user_id` (`identity.ts:100,168,176,185,187`; `index.ts:46`). No token/verifier reaches any log line at any level. Pinned by the `identity.test.ts` cross-level leak-canary test.
- **PKCE verifier never on disk, never in a result.** Held only in the `claimStep` closure (`identity.ts:78,96,131-136`); only its S256 digest leaves the process, inside the auth URL. Pinned three ways (`identity.test.ts`, `credentials.test.ts`, the claim-body interceptor test).
- **`tokens.json` / `config.json` `0600`, atomic.** `credentials.ts:writeJsonAtomic` writes a same-dir temp (`0600`) then `renameSync` then belt-and-braces `chmodSync(0600)`; dir created `0700`. Pinned by the perms tests incl. "no leftover world-readable temp."
- **Refresh hits only sil-web, never Auth0.** `refreshStoredTokens` → `refreshSession` posts to `<resolved sil_api_url>/api/v1/auth/refresh` only; pinned by the integration "every request origin == resolved origin / no auth0.com" assertions. No Auth0 host anywhere in outbound requests.
- **No secret in error paths.** Network/parse failures are caught and mapped to discriminated outcomes (`retryable`/`pending`); no token is interpolated into any message.

**Correctness traps from Discovery — all handled correctly.**
- **Claim branched on body shape, not `res.ok`.** `sil-client.ts#classifyClaimResponse:81-107` — 409/410/404 first, 5xx → retryable, then 200 classified by *both tokens present*; a partial/garbage 200 falls to the **safe non-terminal `pending`**, never a false success. The subtlest bug in the card is correct and exhaustively unit-pinned (incl. half-token → not success).
- **PKCE S256 derivation matches sil-web byte-for-byte.** `pkce.ts:deriveChallenge` is `createHash("sha256").update(verifier).digest("base64url")`; pinned to the fixed RFC 7636 vector `dBjftJeZ…` → `E9Melhoa…` (the same vector sil-web pins) plus an independent in-test cross-check, so the assertion isn't circular.
- **Poll loop bounded, no timer leak on ANY exit.** `poller.ts` routes every terminal (claimed / 409 / 410 / 404 / deadline / `stop()`) through one `settle()` that clears the interval once and fires `onDone` once; deadline checked before each tick; overlap guard prevents stacked in-flight ticks. `vi.getTimerCount()===0` asserted on terminal, deadline, and stop paths.
- **`register()` synchronous, opens nothing.** `index.ts:register` only applies config overrides, calls the two registrars, and logs. No fetch, no timer, no unawaited promise. All I/O + the poll timer live in `execute()`. The install-hang guard in `index.test.ts` is intact.

**qa review item #1 (un-awaited credential write on success) — RESOLVED in current code; the expert's reply is accurate.** The success write is **awaited inside the poll step**: `identity.ts#claimStep:142-146` does `await writeTokens(...)` then `await writeConfig(...)` *before* returning `{ done: true }`. `handleDone` (`:160`) writes nothing — it only logs. A write throw is caught by the poller's `tick()` try/catch (`poller.ts:103-112`) → treated as non-terminal → next tick re-polls → the CAS-consumed session returns **409 already_claimed** → terminal, no persist; the agent re-registers cleanly on its next call. So a disk-write failure is **not** an unhandled rejection and **not** a silent false-success. The only residue is a cosmetic doc-staleness: the integration-test helper `settleAsyncIo` (`register-claim.integration.test.ts`) still narrates "onDone fires the write un-awaited (identity.ts:165)", describing the superseded revision. Harmless (the drain still works) — flagged P3 for cleanup, not blocking.

**qa review item #2 (security disclosure block) — truthful, but its test-pinning claim is inaccurate.** `openclaw.plugin.json#security` is honest: `runsTimers: true`, `networkEndpoints: ["https://sil.4gpts.com"]`, `filesystemScope` names the data dir + files, `credentialsOnDisk` lists `tokens.json`/`config.json`, and `packagingNote` spells out in-execute I/O + verifier-in-memory-only + tokens-never-logged. It no longer claims "no I/O." **However**, the card's repeated claim that `package-manifest.integration.test.ts` "pins this block's shape" is wrong — that test asserts package.json shape and the manifest's id/name/description/version/skills/contracts.tools/configSchema, but reads **nothing** under `security`. So the disclosure is currently truthful yet **unguarded** against future regression. P3 (see below).

**Standard axes — clean.** Strict types, discriminated unions for both claim and refresh outcomes, named constants for the poll budget (`POLL_INTERVAL_MS`/`POLL_DEADLINE_MS`, deadline ≤ sil-web's 30-min TTL), no hardcoded secrets (the default URL is a documented config default with a pluginConfig→env→default override chain), no legacy/compat shims, no god object (clean split: pkce / credentials / sil-client / poller / tool), correct dependency direction, functions within length+complexity limits. The manifest drift guard (`manifest-contract.integration.test.ts`) was correctly updated to also call `registerIdentityTools` so it mirrors the real `register()` surface, and its failure-direction proofs still bite both ways.

**Tier coverage — complete.** `tiers: [unit, integration, e2e]` populated; every acceptance criterion carries a tier tag; the unit + integration test files in the diff match the claimed coverage (77 new tests, full suite 155); the single `[e2e]` criterion is explicitly deferred to sil-stage / goal SC9 and the card says so. No gap.

**Knowledge capture — satisfied for PASS.** Every non-obvious decision carries a thorough inline WHY comment (PKCE byte-match-or-uniform-404; 200-pending-vs-200-success discriminant; async-signature-over-sync-fs rationale; single-exit no-timer-leak; register()-opens-nothing; verifier-never-on-disk). `docs/decisions/INDEX.md` and `docs/knowledge/INDEX.md` are still empty — lifting the cross-cutting ones into docs is the distiller's job (guidance below), not a blocker.

### P3 nits (non-blocking — for the distiller / next card)

1. **Stale test-helper comment.** `register-claim.integration.test.ts#settleAsyncIo` (and a parallel drain note in `identity.test.ts`'s token-leak test) describe the old un-awaited-write revision and cite `identity.ts:165`. The write is now awaited in `claimStep`; the drain loop is harmless belt-and-braces against the async fs settle. Trim the comment to match reality when next touching the file.
2. **`security` block is truthful but untested.** No test asserts the disclosure stays honest, despite the card narrative implying one does. A future edit could regress it to "no I/O" silently. Worth a small drift guard (assert `runsTimers === true`, `networkEndpoints`/`credentialsOnDisk`/`filesystemScope` non-empty whenever a real tool is registered) — natural to fold into `package-manifest.integration.test.ts`.
3. **Distiller guidance.** Strong `docs/decisions/` candidates that currently live only as inline comments: (a) the PKCE cross-repo contract — plugin `deriveChallenge` MUST equal sil-web's, drift reads as a uniform 404 with no oracle, pinned by a shared vector; (b) the `200-pending` vs `200-success` body-shape discriminant (branch on token presence, never `res.ok`); (c) the deliberate async-signature-over-synchronous-fs trade-off in `credentials.ts` and *why* (fake-timer/threadpool race); (d) the security-disclosure invariants (verifier-in-memory-only, tokens-never-logged, `0600` atomic, sil-web-is-sole-auth-authority). All are cross-cutting constraints on the upcoming `sil_whoami`/refresh card.

No handoff back to In Dev — this PASSes. Status → `distilling`.

## Distillation — solutions-architect

<!-- Runs in the worktree on the card branch after Review PASS. Pushes to the same PR. Per the `distillation` skill: SEARCH docs/ INDEX files first; edit existing docs rather than creating duplicates. Captures land at smallest viable scope: inline WHY comments, docs/decisions/, docs/knowledge/, docs/product/, or CLAUDE.md. Then flips status to pr-ready. -->

## PR Ready

<!-- PR url; founder notification fires here -->

## Epic notes (provisional — sibling Discovery owns the verdict)

**Likely change site:** `src/tools/` — new `registerIdentityTools(api)` group with `sil_register` tool; wired into `register()` in `src/index.ts`; tool name added to `openclaw.plugin.json#contracts.tools`. Credential storage under the plugin's local data directory (`tokens.json`, `config.json`). Shallow guess — Discovery to confirm.

**Acceptance (from PRD per-surface):**
- `sil_register` is a real tool (replacing stubs). Generates PKCE material and returns a working auth URL.
- Polling logic handles pending/success/expired/already-claimed states.
- Credential storage (`tokens.json`/`config.json`) works.
- Registered in manifest (`contracts.tools`).
- A second plugin instance for the same user gets its own valid tokens.
- Token refresh (SC7) flows through sil-web — plugin calls `POST /api/v1/auth/refresh`, never Auth0 directly.
