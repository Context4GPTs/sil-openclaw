---
type: card
title: sil-register-tool
slug: sil-register-tool
work_type: feature
tiers: [unit, integration, e2e]
status: in-dev
agents: [expert-developer, qa-developer]
priority: 1
created: 2026-06-08
updated: 2026-06-08
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-sil-register-tool
branch: card/sil-register-tool
pr: null
merged_commit: null
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

### → Handoff to Review (next agent: code-quality-guardian)

<!-- what to pay attention to, known smells -->

## Review round 1 — code-quality-guardian

<!-- verdict + issues; runs against the open PR's diff (PR was opened by expert-developer at the in-dev → review transition) -->

### → Handoff back to In Dev (if FAIL/REVIEW)

<!-- fix list -->

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
