---
type: card
title: sil-whoami-tool
slug: sil-whoami-tool
work_type: feature
tiers: [unit, integration, e2e]
status: done
agents: []
priority: 1
created: 2026-06-08
updated: 2026-06-08
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-sil-whoami-tool
branch: card/sil-whoami-tool
pr: https://github.com/Context4GPTs/sil-openclaw/pull/3
merged_commit: f6f9c96f2c398e579a3ccee77d2e879e5e416191
epic_id: identity-plugin-tools
origin: goal:identity-onboarding-slice
---

## Intent (founder)

Implement the `sil_whoami` plugin tool for sil-openclaw. Reads the stored access token from `tokens.json` (written by `sil_register`), calls sil-api with `Authorization: Bearer <JWT>`, and returns the registered user's real identity data (name, addresses) from the database. If the token is expired, transparently refreshes via sil-web `POST /api/v1/auth/refresh` using the stored refresh token, updates `tokens.json` with the new pair, and retries. If not registered (no `tokens.json`), returns an error with a recovery hint to run `sil_register`.

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

- 2026-06-08 product-owner (discovery) — blocked-on: the founder intent ("call sil-api, return the user's real name + addresses") depends on a sil-api identity-READ endpoint that DOES NOT EXIST yet. sil-api's `/identity` is a POST stub (`services/sil-api/src/handlers/identity.ts`) returning `{kind, verified, subject, attributes, note}` — it reads neither `req.user` nor addresses, returns no name, no addresses. The JWT middleware (`sil-api-jwt-middleware`, merged) loads `req.user = UserRow {id, auth0_sub, name}` but the JWT card's own Design assumption says "addresses/instruments are per-domain queries by user.id, not preloaded" — i.e. nobody has written the read. No in-flight sil-services card adds one. **This card's plugin-side behavior (read token → Bearer call → transparent refresh-on-401 → not-registered/terminal guidance → privacy invariants) is fully buildable & testable today against the merged contracts with a MOCKED sil-api boundary; the live happy-path returning real PII is latent until sil-services ships the real identity-read.** Recommend the orchestrator spawn a sil-services follow-on card: a real authenticated identity-read on sil-api that returns the `req.user` name + the user's `addresses` (AddressRow already exists in `@sil/db`). Until then sil-api also runs in BYPASS mode in sil-stage (fixture user, no real Bearer enforcement) per the JWT card's Signals.
- 2026-06-08 solutions-architect (discovery) — pattern: the sil-services identity-read follow-on (above) should REUSE sil-api's existing domain shape — `POST /identity` (bare path, NOT /api/v1 — the JWT card corrected that premise), body `SimplifiedAgentRequest`, response = UCP envelope — and change ONLY the `result` payload from the stub to real `{ name, addresses }` derived from `req.user` + an addresses-by-user.id query. That keeps the verb/path/auth/envelope stable so the plugin codes against them now; the follow-on is a payload swap, not a new endpoint shape. (If the founder prefers a GET `/me` instead, it's a cheap one-line pivot on the plugin's `fetchIdentity`, recorded on the card.)
- 2026-06-08 solutions-architect (discovery) — pattern: TWO-ORIGIN reality for the plugin — identity-read is on **sil-api** (`services/sil-api`, Fastify), token-refresh is on **sil-web** (`apps/sil-web`, Next). These are different services and likely different origins. The plugin's `config.ts` models ONE origin (`sil_api_url` → sil-web, used by the merged `refreshStoredTokens`); this card adds a SECOND key `sil_api_base` (→ sil-api) for the read. Cross-cutting for any future plugin tool that calls sil-api domains (fulfillment/payments/loyalty) — they all share the sil-api origin, not sil-web's. The sil-api production URL is unpinned anywhere in the workspace; founder/devops should pin `SIL_API_BASE` (or confirm a single-gateway origin) at deploy — recorded as an ASSUMPTION on the card (placeholder default).
- 2026-06-08 product-owner (discovery) — premise-correction: sil-api routes are at BARE paths (`/identity`, not `/api/v1/identity`); only sil-WEB uses `/api/v1/*` (claim + `/api/v1/auth/refresh`). The card intent's "call sil-api with Authorization: Bearer" is correct on the auth header but the endpoint path/verb/response-shape must be pinned to the (to-be-built) sil-api identity-read, not assumed. Refresh stays on sil-web `/api/v1/auth/refresh` (already built — `refreshStoredTokens()` in `src/lib/sil-client.ts`).
- 2026-06-08 orchestrator (pr-ready) — contract-risk: `AGENT_ID = "sil-openclaw"` is hardcoded (`src/lib/sil-client.ts:67`) and sent as `SimplifiedAgentRequest.agent_id` in the `/identity` POST body. Founder flagged a possible conflation: this is the AGENT-SOFTWARE label, NOT the user identity (the user is carried by `Authorization: Bearer <JWT>` minted at registration) and NOT the per-registration PKCE `session_id`. Static-constant + deferred `sil_agent_id` config key is defensible IF `agent_id` is telemetry/routing — but that rests on the LATENT/stubbed sil-api `/identity` contract. RISK: if sil-api ever uses `agent_id` for authorization, or to distinguish a user's MULTIPLE agent instances (SC8 "second instance gets its own identity"), one shared constant across all installs is insufficient — promote to the `sil_agent_id` config key (single change-site already commented at `sil-client.ts:64-66`). The sil-services identity-read follow-on (see blocked-on above) must pin what `agent_id` is actually used for; if it's more than a label, the plugin needs a per-deployment value, not a constant.

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

<!-- solutions-architect owns the recommended technical approach + the
implementation-level alternatives. product-owner's product-framing notes below. -->

**Product framing (product-owner).** `sil_whoami` is the *proof-of-identity* tool: the agent (and through it, the user) confirms "who am I, as far as sil is concerned?" — the registered human's real name and addresses, fetched live from sil-api with the stored Bearer token. It is the natural companion to `sil_register`: register establishes the credential, whoami exercises it. Three product invariants shape every flow:

1. **No dead ends.** Every outcome is actionable. Not registered → "run `sil_register`". Session fully expired → "re-register". The agent is never left with an empty, ambiguous, or crashed result it cannot act on.
2. **Refresh is invisible.** An expired *access* token is a routine, expected condition (access tokens are short-lived by design), NOT an error the user should ever see. The tool refreshes via sil-web and retries silently; the user sees only their identity data. The user only hears about auth when the *refresh* token is also dead (true terminal — re-register).
3. **PII discipline mirrors `sil_register`.** The identity payload (name, addresses) is PII and tokens are credentials; both are held to the same bar the register card set — tokens/verifier never logged or echoed beyond the intended result, identity returned to the agent but never written to a log line.

**Key premise correction (load-bearing — see Signals).** The intent assumes a sil-api endpoint that returns the user's real name + addresses. That endpoint does **not exist today**: sil-api's `/identity` is a POST stub that returns a fixed `{kind, verified, subject, attributes, note}` shape and reads neither `req.user` nor addresses. So the *live* happy path (real PII over the wire) is **latent on a sil-services follow-on**. The plugin-side behavior contract this card specifies — token read, Bearer call, transparent refresh-on-401, not-registered/terminal guidance, bounded retry, privacy invariants — is fully specifiable and testable **today against a mocked sil-api boundary**, exactly as the register card proved its claim/refresh flow against a mocked sil-web. The happy-path acceptance criterion is therefore written against the *contract the tool consumes* (sil-api, given a valid Bearer, returns the authenticated user's identity = name + addresses for the user that token resolves to), with the exact wire shape flagged as an ASSUMPTION to be pinned when the endpoint lands.

**Product-level alternatives ruled out (product-owner):**
- **Surface "access token expired" to the user / agent as an error or a required action.** Rejected: violates invariant 2. Access-token expiry is the *expected* steady state, not a fault; making the agent handle it defeats the point of storing a refresh token. The refresh+retry is the tool's job, transparently.
- **On expired access token, return identity from the locally cached `config.json` instead of refreshing.** Rejected: `sil_whoami`'s product promise is *live* identity from sil-api (the source of truth — the user may have edited their addresses since registration). Returning stale local data silently would make the tool lie. (The cached `config.user` is a fallback identifier for *register*'s short-circuit, not a substitute for the authoritative read.)
- **Loop refresh→retry until it works.** Rejected: an unbounded refresh storm on a persistently-401'ing endpoint is a self-DoS and hides a real terminal state. Exactly one refresh + one retry per call (invariant: bounded), then a clear terminal outcome.
- **Treat "not registered" as an empty/success result.** Rejected: an empty identity is ambiguous (is the user anonymous? is something broken?). Not-registered is a distinct, recoverable state with a specific recovery action (`sil_register`), and must read as such.
- **Block this card until sil-api ships the real read.** Rejected: the entire plugin-side contract (the hard part — the refresh choreography and the error taxonomy) is buildable and provable now against a mocked boundary; blocking would stall the slice for a dependency that only affects the final wire shape. Build now, pin the shape later, signal the dependency (done).

**Recommended technical approach (solutions-architect).** `sil_whoami` joins the EXISTING `registerIdentityTools(api)` group in `src/tools/identity.ts` (where `sil_register` lives), so step 2 of the 3-step tool-add (wire group into `register()`) is already done — only step 1 (register the tool) and step 3 (add `"sil_whoami"` to `contracts.tools`, sorted + dup-free; the drift guard bites both ways) apply. No parameters (`Type.Object({})`); the JWT identifies the user. All I/O in `execute()`; `register()` opens nothing; **no timer** — whoami is a synchronous request/response, not a poll (do NOT import `poller.ts`). The flow is **read → 401 → refresh → retry-once**, reusing the merged lib modules verbatim:

1. **Read the stored token** with `readTokens()` (`credentials.ts`). `null` → terminal `not_registered` result with a recovery hint to run `sil_register`, **zero network calls**. This is the freshness/presence check the register card explicitly deferred here.
2. **Call sil-api with `Authorization: Bearer <access_token>`** via a NEW `fetchIdentity(silApiUrl, token)` in `src/lib/sil-client.ts`, returning a discriminated union (`ok` / `unauthorized` / `forbidden{reason}` / `retryable`), classified by status + a pure exported `classifyIdentityResponse(status, body)` (mirrors `classifyClaimResponse`/`classifyRefreshResponse`, unit-tested in isolation). 200→ok; **401→unauthorized** (drives refresh); 403→forbidden (`user_not_provisioned`/`principal_mismatch`, terminal, distinct hint); 5xx/network/abort→retryable.
3. **On 401, refresh transparently — exactly once** via the merged `refreshStoredTokens()` (reads the stored refresh token, POSTs sil-web `/api/v1/auth/refresh`, rotates `tokens.json` on success, never touches Auth0). Map its 3-variant union explicitly: `refreshed` → re-read tokens, retry the identity call **once**; `must_reregister` (401 invalid_grant OR no_stored_tokens) → terminal `must_reregister`, do NOT retry; `retryable` → terminal transient. Invariant: at most one refresh + one retry per call.
4. **Second 401 after a successful refresh → terminal `must_reregister`** (a freshly-rotated token still rejected is structurally dead). Never loop.

**Why reuse over new code (the core architectural call).** `readTokens`/`writeTokens`, the `sil-client` fetch+timeout+classify scaffolding, and `refreshStoredTokens` (the whole SC7 rotate-via-sil-web orchestration) were built + reviewed-PASS in the register card precisely so this card consumes them. `refreshStoredTokens` already encodes "refresh only through sil-web, rotate `tokens.json`, 401→must_reregister, no Auth0" — re-implementing any of it would duplicate the highest-risk auth logic. The ONLY genuinely new plugin code is the identity-read wrapper + the read/refresh/retry orchestration. (See Signals: the sil-api identity endpoint + the second origin are cross-cutting findings.)

**Two-origin reality (load-bearing — see Open-question resolutions).** Identity-read is on **sil-api** (`services/sil-api`, a Fastify service); token refresh is on **sil-web** (`apps/sil-web`) — different services, different origins. The plugin's `config.ts` `getApiUrl()` resolves ONE origin (sil-web), which `refreshStoredTokens` correctly uses for `/api/v1/auth/refresh`. The identity call needs sil-api's origin → add a distinct `getSilApiUrl()` (`sil_api_base` pluginConfig → `SIL_API_BASE` env → default), do NOT overload `sil_api_url` (it is semantically sil-web's). The sil-api path is the **bare** `/identity` (NOT `/api/v1/identity` — the sil-api-jwt-middleware card corrected that premise; bare paths are what the sil-stage eval posts). So the PO's acceptance criteria that say "resolved `sil_api_url` origin" split into TWO independently-asserted origins: identity read → resolved sil-api origin; refresh → resolved sil-web origin.

**Technical alternatives ruled out (solutions-architect):**
- **A new credential/refresh module for whoami.** Rejected: `readTokens` + `refreshStoredTokens` already do this, reviewed-PASS. The refresh orchestration must have ONE owner (`sil-client.ts`).
- **A background poll/timer (mirroring `sil_register`).** Rejected: whoami is synchronous request/response — read, call, maybe-refresh, return. No browser wait, no loop, no `poller.ts`. Arming a timer would cargo-cult register's shape.
- **Overload `sil_api_url` for both services.** Rejected: different origins; one key can't address both unless a gateway fronts them (not assumed). A distinct `sil_api_base` keeps each origin honest and independently deployable.
- **Decode the JWT client-side to pre-check `exp` or extract identity.** Rejected: the plugin is not the token's audience and must not trust its own decode for an auth decision; identity is sil-api's authoritative read, not a local claim. React to the authoritative 401 — the one signal that means "rejected now."
- **Retry on a plain 401 without refreshing.** Rejected: a bare retry of the same dead token is a guaranteed second 401; only a refresh can change the outcome.
- **Treat any 4xx as the refresh trigger.** Rejected: 401 is refreshable; 403 (`user_not_provisioned`/`principal_mismatch`) is NOT — refreshing an unprovisioned-but-valid token changes nothing. `classifyIdentityResponse` splits 401 from 403.

### Affected files / surfaces

<!-- solutions-architect -->

- **`src/tools/identity.ts`** (extend) — add `registerWhoami(api)`, called from the EXISTING `registerIdentityTools(api)` (alongside `registerRegister`). `sil_whoami`: `parameters: Type.Object({})`, `execute()` runs read→refresh→retry-once, returns `jsonResult(...)` — success identity OR a terminal `{ status, message }` envelope with a recovery hint. Mirror `sil_register`'s result-shape discipline. No timer, no poll.
- **`src/lib/sil-client.ts`** (extend) — add `classifyIdentityResponse(status, body)` (pure, exported) and `fetchIdentity(silApiUrl, token)` (`<silApiUrl>/identity`, `Authorization: Bearer <token>`, body `{ agent_id }`), returning the `ok`/`unauthorized`/`forbidden`/`retryable` union. Reuse the existing `postJson`/timeout/`readJsonBody`/`stripTrailingSlash` helpers (add a Bearer header). `refreshStoredTokens` reused AS-IS (no change).
- **`src/lib/config.ts`** (extend) — add `getSilApiUrl()` (resolves `sil_api_base` pluginConfig → `SIL_API_BASE` env → a sil-api default) + extend `SilPluginConfig`/`applyPluginConfigOverrides` for the new key. `getApiUrl()` (sil-web) untouched. ASSUMPTION on the default value (Open questions).
- **`openclaw.plugin.json`** — (a) `contracts.tools`: + `"sil_whoami"` (sorted, dup-free — `manifest-contract.integration.test.ts` fails either direction). (b) `configSchema` + `uiHints`: + `sil_api_base` (matching the `sil_api_url` entry's shape). (c) `security.networkEndpoints`: + the sil-api origin (currently only `https://sil.4gpts.com`) — the disclosure must name BOTH origins now. No new `credentialsOnDisk`/`filesystemScope` (whoami reads existing files; refresh rotation is already disclosed).
- **`src/types/openclaw.d.ts`** — **unchanged.** whoami uses only `registerTool`/`logger`/`pluginConfig`, all declared. No speculative surface.
- **Tests under `src/__tests__/`** — `lib/sil-client.test.ts` extended (or sibling) for `classifyIdentityResponse` (200/401/403/5xx split, unit); `tools/identity.test.ts` extended for the not-registered short-circuit (no fetch), the no-input shape, and the tokens/JWT/PII-never-logged canary; a `whoami.integration.test.ts` (real tool + `sil-client` + `credentials` wired, **only `fetch` mocked**): happy-path read; 401→refresh→rotate→retry-success; refresh-also-fails→terminal (assert exactly 2 identity fetches + 1 refresh); two-origin assertion (identity host == sil-api origin, refresh host == sil-web origin, no auth0.com). The existing manifest + package-manifest integration tests exercise the new name + security block automatically.

### Risks / failure modes

<!-- solutions-architect owns the technical/implementation risks; product-owner's
user-facing risks are grouped below. -->

**Technical / implementation failure modes (solutions-architect)**

- **Infinite refresh-retry loop (the cardinal risk).** A whoami that refreshes-and-retries without a hard cap storms sil-web + sil-api on a persistently-401'ing token (self-DoS, masks a terminal state). Mitigate: the flow is structurally **at most one refresh + one retry** — a second 401 after a successful refresh is terminal `must_reregister`, never another refresh. Pin with an integration test asserting exactly two identity-fetch calls (initial + one retry) and exactly one refresh call on the refresh-then-still-401 path.
- **`refreshStoredTokens` reused incorrectly.** Its contract is a 3-variant union (`refreshed` / `must_reregister{invalid_grant|no_stored_tokens}` / `retryable`) — branching on `.status` is mandatory. Treating any non-`refreshed` as retryable would loop on a dead refresh token; treating `retryable` as terminal would fail a transient blip. Map each variant explicitly (Approach step 3). The `no_stored_tokens` variant also covers a `tokens.json` deleted between the initial read and the refresh (a TOCTOU the union already handles).
- **Token / JWT / Bearer leakage into logs or the result.** The access token, refresh token, and the Bearer header value are credentials — none may reach a `logger.*` call or the `ToolResult`. Identity PII (name, addresses) goes in the result (the point) but must never be logged. Mitigate: log only structured markers (`sil_whoami_unauthorized`, `sil_whoami_refreshed`, `sil_whoami_must_reregister`) with no token/identity field; a cross-level leak-canary (the register card's pattern, extended to assert no name/address string leaks). The Bearer header is built at the fetch site and never logged.
- **`tokens.json` rotation under concurrent tools.** `refreshStoredTokens` does a read-modify-write (`writeTokens` = atomic temp+rename, `0600`). If a second tool (another `sil_whoami`, or a `sil_register` re-run) rotates concurrently, last-writer-wins and an in-flight retry may use a just-superseded token — at worst one extra 401→refresh cycle, self-correcting because the retry re-reads `tokens.json`. Acceptable for this card (same bound as the register card's same-home note); the atomic write prevents a torn file. Flagged, not solved (cross-process locking is out of scope).
- **Two-origin misconfiguration (silent wrong-host call).** If `getSilApiUrl()` defaults while `sil_api_url` points at staging (or vice-versa), the identity call hits the wrong service → network error / 404 / 401. Mitigate: distinct config keys with clear defaults + the integration test asserting identity-request host == resolved sil-api origin AND refresh-request host == resolved sil-web origin (independently pinned; extends the register card's "every refresh origin == resolved origin / no auth0.com").
- **401 vs 403 conflation.** sil-api returns 401 for bad/missing/expired token (refreshable) and 403 for `user_not_provisioned`/`principal_mismatch` (NOT refreshable). "Any 4xx → refresh" wastes a rotation and still fails. Map 401→refresh, 403→terminal-distinct-hint. `classifyIdentityResponse` owns this split, unit-tested.
- **`agent_id` / `on_behalf_of` self-inflicted 403.** sil-api's `SimplifiedAgentRequest` requires `agent_id` (1..200); the JWT middleware 403s `principal_mismatch` when `on_behalf_of` ≠ token `sub`. The plugin has no inherent agent id in the declared SDK. ASSUMPTION (Open questions): send a stable `agent_id` and OMIT `on_behalf_of` so the JWT `sub` is the principal — sending a mismatching `on_behalf_of` is a guaranteed 403.
- **Manifest drift guard bite (×2 surfaces).** Forgetting `"sil_whoami"` in `contracts.tools` fails the drift guard; and the second `networkEndpoints` origin is truthful-but-unguarded unless `package-manifest.integration.test.ts` is extended to assert under `security` (the register review flagged it asserts nothing there today — worth a small assertion, per that card's P3).
- **Identity wire-shape latent on sil-services.** sil-api's `/identity` is a stub returning `{kind, verified, subject, attributes, note}` — NOT `{name, addresses}`. `fetchIdentity`/`classifyIdentityResponse` must parse the *eventual real* shape; until it lands the integration test mocks the assumed shape. Parse defensively (narrow to the fields whoami surfaces, tolerate extras) so the tool doesn't break when the real handler ships. Cross-sibling dependency signaled.

**Product / user-facing failure modes (product-owner)**

- **Refresh leaks into the user's view.** If the refresh-on-401 path surfaces any intermediate "token expired / refreshing" state to the agent, the user sees plumbing instead of their data — invariant 2 broken. The expired-access→refresh→retry sequence must be wholly internal; a successful call after a refresh is indistinguishable (to the agent) from one that needed none.
- **Stale identity presented as live.** If the tool ever falls back to `config.json`'s cached user on a failed/expired read, it returns data that may no longer match sil-api (the user edited an address). `sil_whoami` promises the authoritative record; a silent stale read is a correctness/trust failure, not a graceful degrade.
- **Ambiguous not-registered result.** Returning an empty object, `null`, a generic error, or (worst) crashing when `tokens.json` is absent leaves the agent unable to recover. The user must be told exactly one thing: run `sil_register`. Anything vaguer is a dead end.
- **Terminal session-expired mistaken for a transient blip (or vice-versa).** If a dead *refresh* token (sil-web 401) is retried like a network hiccup, the tool spins and never tells the user to re-register; if a transient 5xx is treated as terminal, the user is told to re-register when a retry would have worked. The two must be distinguished: refresh-401 = terminal re-register; network/5xx = bounded retry.
- **Dead token retained as valid.** After a refresh rejection, if the tool leaves the now-known-dead token pair in `tokens.json` and reports normally, the next call silently fails the same way (and `sil_register` would short-circuit on the stale presence). A confirmed-dead session must not be presented as a working one — the user's next action (`sil_register`) must not be blocked by stale credentials. (Whether to clear `tokens.json` on terminal is an architect/dev mechanism call; the product invariant is "a dead session never masquerades as live.")
- **Credential / PII exposure.** Tokens (access + refresh) and the identity payload (name, addresses = PII) must never reach a log line or any field of the tool result other than the intended identity data. A token in a debug log is a standing account-access risk; an address in a log is a privacy breach. Same bar as `sil_register` (which the review confirmed logs only `session_id`/`user_id`).
- **Refresh contacting Auth0 directly.** If any refresh path reached Auth0 instead of sil-web, it would bypass the sole-auth-authority model (sil-web holds the Auth0 client secret) and likely fail or leak. Refresh must hit ONLY sil-web `/api/v1/auth/refresh` — already enforced by the merged `refreshStoredTokens()`, but the new whoami flow must route through it, not re-implement a refresh.
- **Latent-endpoint confusion.** Because the real sil-api identity-read does not exist yet (Signals), an implementer could wire `sil_whoami` against the existing `/identity` *stub* and "pass" while returning a fixed verification shape with no name/addresses — a false green. The happy-path test must assert the tool returns the *authenticated user's* name + addresses (mock the boundary to the agreed real-read contract), not the current stub payload, so the suite cannot be green while the product promise is unmet.

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.

product-owner framed the behaviour below (Given/When/Then); the `[tier]` tag and the
`tiers:` frontmatter are the solutions-architect's to add. Wire shapes are pinned to the
ALREADY-MERGED contracts where they exist (sil-web refresh — sil-services/cards/done/2026/
sil-web-auth-endpoints.md; JWT/Bearer behavior — sil-services/cards/done/2026/
sil-api-jwt-middleware.md) and to an ASSUMED sil-api identity-read contract where the
endpoint is not yet built (see Open questions + Signals). There is no live sil-api or
Postgres in THIS repo, so the cross-service happy path is proven against a MOCKED sil-api
boundary here and is owned E2E by sil-stage (goal SC9), exactly as the register card did.
-->

**Not registered (no credential)**

- `[unit]` Given no `tokens.json` exists in the plugin's data dir, when the agent calls `sil_whoami`, then the tool returns a clear, structured error that names the recovery action — run `sil_register` — and makes NO sil-api call (nothing to authenticate with). (Seed an empty/missing data dir; assert no `fetch`.)
- `[unit]` Given no `tokens.json` exists, when the agent calls `sil_whoami`, then the tool does NOT crash, does NOT return an empty/`null`/ambiguous identity, and does NOT hang — the result is an unambiguous "not registered, run `sil_register`" outcome the agent can act on.

**Happy path (valid access token)**

- `[integration]` Given a valid `tokens.json` (live access token), when the agent calls `sil_whoami`, then the tool calls sil-api with `Authorization: Bearer <access_token>` and returns the registered user's real identity — at least their name and addresses — for the user that token resolves to. (Mock the sil-api boundary to the agreed identity-read contract; assert the Authorization header carries the stored access token and the returned identity matches the authenticated user, NOT a hardcoded stub shape.)
- `[integration]` Given a valid access token, when `sil_whoami` calls sil-api, then it targets the resolved sil-api origin (pluginConfig `sil_api_base` → `SIL_API_BASE` → default — the sil-api service origin, distinct from sil-web's `sil_api_url`; see architect resolution), not a hardcoded host. (Assert the request origin equals the resolved sil-api origin under an override.)
- `[integration]` Given the identity read succeeds on the first try (access token still valid), when `sil_whoami` returns, then NO refresh request is made — the refresh path is taken only on an actual 401 from sil-api. (Assert exactly one outbound sil-api call and zero calls to the sil-web refresh endpoint.)

**Transparent refresh (expired access token, valid refresh token)**

- `[integration]` Given the stored access token is expired (sil-api responds 401), when the agent calls `sil_whoami`, then the tool refreshes via sil-web `POST /api/v1/auth/refresh` with the stored refresh token, rotates `tokens.json` with the new pair, retries the sil-api identity read once with the new access token, and returns the user's identity — the agent sees the identity result, never an expiry/refresh state. (Mock sil-api: first call 401, second 200; mock sil-web refresh 200; assert tokens.json rotated and the retry used the NEW access token.)
- `[integration]` Given a refresh occurs, when `sil_whoami` refreshes, then it contacts ONLY sil-web (the resolved sil-web `sil_api_url` origin) — never an Auth0 host directly (sil-web is the sole auth authority / Auth0-secret holder). (Assert every outbound refresh request host is the resolved sil-web origin; no `auth0.com`.)
- `[integration]` Given the access token was expired and refresh succeeded, when the retried read returns identity, then `tokens.json` holds the ROTATED pair (the old expired access token and old refresh token are gone), so a subsequent call uses fresh credentials without another refresh.

**Refresh also fails (dead refresh token)**

- `[integration]` Given the stored access token is expired AND the refresh token is rejected (sil-web returns 401 / invalid_grant), when the agent calls `sil_whoami`, then the tool surfaces a terminal "session expired — re-register" outcome guiding the user to run `sil_register`, and does NOT loop or retry the dead refresh. (Mock sil-api 401, sil-web refresh 401; assert a single refresh attempt and a terminal re-register result.)
- `[integration]` Given a refresh was rejected as invalid_grant, when `sil_whoami` returns the terminal outcome, then the now-known-dead session is not presented as valid — a confirmed-dead session never masquerades as live (so the user's recovery via `sil_register` is not blocked by a stale "registered" appearance). (Assert the terminal path does not report success; if the chosen mechanism clears `tokens.json`, assert a subsequent `sil_register` does not short-circuit on stale presence.)

**Bounded refresh (no storm)**

- `[integration]` Given sil-api persistently returns 401, when the agent calls `sil_whoami`, then the tool performs AT MOST one refresh + one retry per call — it never enters an unbounded refresh→retry loop. (Assert ≤1 refresh call and ≤1 retried identity read for a single `sil_whoami` invocation, even if the retry also 401s.)
- `[integration]` Given the retried identity read (after a successful refresh) STILL returns 401, when `sil_whoami` finishes, then it stops and surfaces a terminal outcome (does not refresh again) — a fresh access token that is still rejected is terminal, not cause for another refresh cycle.

**Security / privacy invariants**

- `[integration]` Given any `sil_whoami` path (success, refresh, not-registered, terminal), when the tool logs, then NO token value (access or refresh) and NO PII (name, addresses) appears in any log line at any level — only non-credential identifiers (e.g. a user id / status) may be logged. (Cross-level logger leak-canary, mirroring the register card's token-leak test, extended to assert no address/name string leaks either.)
- `[unit]` Given a successful identity read, when `sil_whoami` returns, then the tool result carries ONLY the intended identity payload (name, addresses, and any agreed identity fields) — it does not echo the access token, the refresh token, or the raw Authorization header back to the agent.
- `[integration]` Given a refresh occurs mid-call, when tokens are rotated, then the rotated token values touch only `tokens.json` (via the existing credential writer) and the in-flight retry — never a log line, never the returned result.

**Transient failure (network / 5xx — distinguished from terminal)**

- `[integration]` Given sil-api (or the sil-web refresh) returns a transient failure (network error / 5xx) rather than a 401, when the agent calls `sil_whoami`, then the tool surfaces a distinct retryable/try-again outcome — it does NOT tell the user to re-register (a re-register hint on a transient blip is a false terminal). (Distinguish 401 → auth/refresh path vs 5xx/network → transient outcome.)

**Pure-logic units (solutions-architect — the in-process pieces, no network)**

- `[unit]` Given a sil-api identity response, when `classifyIdentityResponse(status, body)` runs, then it maps 200(+valid identity body)→`ok`, 401→`unauthorized`, 403→`forbidden` (carrying the `user_not_provisioned` / `principal_mismatch` reason), and 5xx/non-classifiable→`retryable` — branching on status (and body shape for 200), never on `res.ok`. (Pure function, unit-tested in isolation like `classifyClaimResponse` — this is the highest-risk auth-branch logic; a partial/garbage 200 must NOT read as `ok`.)
- `[unit]` Given `sil_api_base` is overridden via plugin-config or `SIL_API_BASE`, when `getSilApiUrl()` resolves, then the override origin is used (resolution order pluginConfig → env → default), distinct from `getApiUrl()` (sil-web); and given neither is set, the documented sil-api default is returned. (Mirror the existing `sil_api_url` resolution tests.)
- `[unit]` Given no parameters, when the agent calls `sil_whoami`, then the tool accepts an empty input object (`Type.Object({})`) and the call shape matches the host SDK contract — no required inputs (the JWT identifies the user). (Tool-registration / parameter-schema unit, like `sil_register`'s no-input shape.)

**Full cross-service journey (e2e — owned by sil-stage / goal SC9, not provable in this repo)**

- `[e2e]` Given a user who completed the real PKCE → onboarding → claim journey, when the agent calls `sil_whoami` against a live sil-api + Postgres with the stored Bearer JWT, then it returns the user's real `{ name, addresses }` matching what was entered during onboarding. (The true cross-service guarantee — owned by sil-stage's golden example, goal SC9; **additionally blocked on the sil-services follow-on** that makes sil-api's `/identity` return real PII from `req.user` + the addresses query. Not provable inside this repo — there is no live sil-api/Postgres here.)

### Open questions (if any)

<!-- product-owner open questions below; solutions-architect may add their own. -->

- **The sil-api identity-read endpoint does not exist yet (the one genuine dependency — signaled, not blocking).** sil-api's `/identity` is a POST stub returning `{kind, verified, subject, attributes, note}` (no name, no addresses, ignores `req.user`); no in-flight sil-services card adds a real authenticated identity-read. ASSUMPTION (defensible, lets this card proceed): the plugin-side behavior contract — Bearer read, transparent refresh-on-401, not-registered/terminal guidance, bounded retry, privacy — is built and tested NOW against a MOCKED sil-api boundary shaped to the agreed read contract; the live PII path goes green when sil-services ships the endpoint. The orchestrator should spawn that sil-services follow-on (a real authenticated read returning the `req.user` name + the user's `addresses` — both already typed in `@sil/db` as `UserRow`/`AddressRow`). Not blocking: the hard part (the refresh choreography + error taxonomy) needs no live endpoint.
- **Exact identity-read wire contract (endpoint path, verb, request body, response shape).** ASSUMPTION until the sil-api follow-on pins it: the read is authenticated by the stored `Authorization: Bearer <access_token>` and returns the authenticated user's name + addresses (the user the token resolves to via the JWT middleware's `req.user`). OPEN sub-points for the architect / the sil-api card to decide, recorded so they're not silently assumed:
  - **GET vs POST.** A whoami read is naturally a `GET` (e.g. `GET /identity` or `GET /me`), but sil-api's current domain pattern is `POST /<domain>` with a `SimplifiedAgentRequest` body (`agent_id` required). If the real read reuses the POST+envelope pattern, `sil_whoami` must send a minimal valid body; if it's a new GET, no body. The architect should pick the defensible default for the mock contract (a GET read keyed purely off the Bearer is the cleaner whoami shape) and flag that the sil-api card is the authority.
  - **Envelope vs bare.** Whether identity comes back wrapped in the UCP envelope (`{protocol, version, domain, ..., result}`) or as a bare identity object. ASSUMPTION: the tool returns the *identity* to the agent regardless of wrapper — if the endpoint wraps, the tool unwraps `result` so the agent sees identity, not transport metadata.
  - **`on_behalf_of` / `principal_mismatch`.** The JWT middleware 403s `principal_mismatch` when a request body's `on_behalf_of` ≠ the token `sub`. If the read is a POST carrying `on_behalf_of`, the tool must NOT supply a mismatching principal (simplest: omit `on_behalf_of`, or set it from the token's user). A GET read sidesteps this. Recorded so the implementer doesn't trip the 403.
- **Auth-error taxonomy on the read (which status = "refresh and retry").** ASSUMPTION pinned to the merged JWT middleware: sil-api returns a uniform **401** `{error:"unauthorized"}` for an expired/invalid access token → this is the refresh-and-retry trigger. A **403** is a *different* class (`user_not_provisioned` = the human isn't onboarded; `principal_mismatch` = a bug in our request) — a 403 must NOT trigger a refresh (refreshing the same user's token won't fix provisioning) and should surface its own actionable outcome (e.g. user_not_provisioned → "complete onboarding / run `sil_register`"). The architect should confirm 401-only-triggers-refresh and decide the 403 surfaces; the bounded-refresh and refresh-only-on-401 criteria above hold either way.
- **Whether to clear `tokens.json` on a terminal refresh-rejection.** Product invariant is "a dead session never masquerades as live" (so the user's `sil_register` recovery isn't blocked by stale presence — recall `sil_register`'s short-circuit is *presence-based*). The MECHANISM (clear the file vs let `sil_register` overwrite vs a freshness check) is an architect/dev call; ASSUMPTION: clearing on a confirmed `invalid_grant` is the cleanest (it makes the next `sil_register` mint a fresh session rather than short-circuit on a dead pair), but any mechanism satisfying the invariant is acceptable. Flagged because it touches the cross-card interaction with `sil_register`.
- **Reuse `refreshStoredTokens()` vs re-implement refresh.** ASSUMPTION (strong): `sil_whoami` reuses the EXISTING `refreshStoredTokens()` in `src/lib/sil-client.ts` (read stored → sil-web-only refresh → rotate `tokens.json`; 401 → `must_reregister`; no-stored → `must_reregister`; 5xx → retryable). It already encodes the "only sil-web, never Auth0" and "don't retain a dead token" invariants and is integration-tested. The tool should NOT grow a second refresh path. The architect should confirm the discriminated result maps cleanly onto the whoami outcomes (refreshed → retry; must_reregister → terminal; retryable → transient).

**Architect resolutions (solutions-architect — deciding the points flagged above; none blocking):**

- **Two origins, two config keys (RESOLVED + ASSUMPTION on the default).** Identity-read is on **sil-api** (`services/sil-api`, Fastify), refresh is on **sil-web** (`apps/sil-web`) — confirmed distinct services in the sibling repo. Add `getSilApiUrl()` resolving `sil_api_base` pluginConfig → `SIL_API_BASE` env → a sil-api default; keep `getApiUrl()` (sil-web) for refresh. Do NOT overload `sil_api_url`. Default value is a documented placeholder (e.g. `https://api.sil.4gpts.com`, or the same origin if deployment fronts both behind one gateway) — flagged for founder/devops to pin at deploy; the override chain means tests + staging set it explicitly, only the default is a guess.
- **GET vs POST + envelope (RESOLVED for the mock contract).** Code the plugin against sil-api's CURRENT live shape: `POST /identity` (bare path), body `SimplifiedAgentRequest` `{ agent_id }`, response = UCP envelope with the identity in `result`. Rationale: this is what the merged JWT middleware guards and what the eval posts today — building against the existing POST+envelope pattern means the only thing the sil-services follow-on must change is the `result` *payload* (stub → real `{name, addresses}`), not the verb/path/auth. The tool **unwraps `result`** so the agent sees identity, not transport metadata. (If the follow-on instead introduces a GET `/me`, that's a one-line change to `fetchIdentity` + the mock — recorded so it's a known, cheap pivot, not a surprise.)
- **`agent_id` + `on_behalf_of` (RESOLVED).** Send a stable `agent_id` (constant `"sil-openclaw"`; a `sil_agent_id` config key is YAGNI until per-deployment identity is wanted) and **OMIT `on_behalf_of`** so the JWT `sub` is the principal — this structurally avoids the middleware's 403 `principal_mismatch` (which fires only on `on_behalf_of ≠ sub`). The identity returned is "the user this token resolves to," exactly whoami's contract.
- **401-only-triggers-refresh; 403 is terminal (RESOLVED).** Confirmed against the merged middleware: 401 (uniform `unauthorized`) = expired/invalid token → refresh-and-retry-once. 403 = `user_not_provisioned` (the human isn't onboarded → surface "complete onboarding / run `sil_register`") or `principal_mismatch` (our bug — should not occur given we omit `on_behalf_of`; surface a distinct internal error) → **never refresh**. `classifyIdentityResponse` splits these; refreshing a 403 changes nothing.
- **Clear `tokens.json` on confirmed `invalid_grant` (RESOLVED — mechanism).** On a terminal `must_reregister` caused by `invalid_grant`, clear `tokens.json` so the next `sil_register` mints a fresh session rather than short-circuiting on the dead pair (the register short-circuit is presence-based). This satisfies the PO's "a dead session never masquerades as live" invariant with the cleanest cross-card interaction. Add a `clearTokens()` (or `deleteTokens()`) to `credentials.ts` if one doesn't exist (it's the credential module's job; small, atomic unlink). Do NOT clear on `retryable`/transient (the token may be fine; only a *confirmed* invalid_grant is dead). Pin with the criterion already written (subsequent `sil_register` does not short-circuit after a cleared dead session).
- **Reuse `refreshStoredTokens()` (RESOLVED — strong).** Confirmed: its 3-variant union maps cleanly — `refreshed`→re-read+retry-once; `must_reregister`→terminal (then clear per above); `retryable`→terminal transient. No second refresh path. This is the central reuse decision.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

<!-- solutions-architect -->

**Where to start.** This card is mostly *assembly of existing, reviewed-PASS parts* — build bottom-up:
1. `src/lib/config.ts` — add `getSilApiUrl()` + the `sil_api_base` override (mirror `getApiUrl`/`applyPluginConfigOverrides`). Unit-test the pluginConfig→env→default resolution.
2. `src/lib/credentials.ts` — add `clearTokens()` (atomic unlink, tolerant of absence) for the dead-session clear. Unit-test against a temp dir.
3. `src/lib/sil-client.ts` — add `classifyIdentityResponse(status, body)` (pure, exported — unit-test the 200/401/403/5xx split in isolation, like `classifyClaimResponse`) and `fetchIdentity(silApiUrl, token)` (`POST <silApiUrl>/identity`, Bearer header, body `{ agent_id }`; reuse `postJson`/timeout/`readJsonBody`). `refreshStoredTokens` reused unchanged.
4. `src/tools/identity.ts` — add `registerWhoami(api)`, call from `registerIdentityTools`. Implement read→401→refresh→retry-once exactly per Approach; unwrap the envelope `result`; clear tokens on confirmed invalid_grant. Then `"sil_whoami"` → `contracts.tools` (sorted, dup-free) + the second `networkEndpoints` origin + the `sil_api_base` configSchema/uiHints entries.

**Hard constraints (do not violate):**
- **3-step tool-add — but step 2 (wire group into `register()`) is ALREADY done** (the group exists); do step 1 (register `sil_whoami`) + step 3 (`contracts.tools`). Drift guard fails either direction.
- **`register()` opens nothing**; whoami's fetches live in `execute()`. **No timer / no `poller.ts`** — whoami is synchronous request/response, not a poll.
- **At most one refresh + one retry** per call. Second 401 after a successful refresh = terminal `must_reregister`. Never loop refresh.
- **Tokens / JWT / Bearer never logged or echoed**; identity PII returned in the result but never logged. Reuse the register card's leak-canary pattern, extended to name/address strings.
- **Two origins, independently asserted:** identity-read → resolved sil-api origin (`getSilApiUrl`); refresh → resolved sil-web origin (`getApiUrl`, via `refreshStoredTokens`). No `auth0.com` on any path.
- **Reuse, don't re-implement** `readTokens`/`writeTokens`/`refreshStoredTokens` + the `sil-client` helpers. New code = the identity wrapper + classifier + `getSilApiUrl` + `clearTokens` + the tool orchestration.
- No new npm deps. Strict TS, no `any` at boundaries. Branch identity outcomes on the classifier union, not raw `res.ok`. Parse the envelope `result` defensively (the real PII shape is latent on the sil-services follow-on).

**Test strategy.** qa-developer writes RED first (`adversarial-testing`), expert-developer GREEN. Unit tier (mock api + temp dir, no network): `classifyIdentityResponse` (200/401/403/5xx — the highest-risk pure logic), `getSilApiUrl` resolution, `clearTokens`, the not-registered short-circuit (no fetch), the no-input tool shape, the success-result-carries-only-identity shape, the tokens/JWT/PII leak-canary. Integration tier (real tool + `sil-client` + `credentials` wired, **only `fetch` mocked**): happy-path read; 401→refresh→rotate→retry-success; refresh-also-fails (invalid_grant)→terminal `must_reregister`+clear (assert exactly 2 identity fetches + 1 refresh — the no-storm bound); transient 5xx/network→retryable outcome; two-origin assertion (identity host == sil-api origin, refresh host == sil-web origin, no auth0.com); not-registered→terminal hint, zero fetches. **Critical anti-false-green (PO's "latent-endpoint confusion"):** the happy-path mock must return the agreed *real* `{name, addresses}` contract and the test must assert the tool surfaces the authenticated user's name + addresses — NOT the current stub's `{kind, verified, subject, attributes, note}`, so the suite can't be green while the product promise is unmet. The true cross-service E2E (real sil-api + Postgres + real PII handler) is sil-stage's golden example (goal SC9) — out of scope here AND blocked on the sil-services follow-on (signaled).

## In Dev — expert-developer, qa-developer

Built exactly to the architect's bottom-up handoff. Pure assembly of the merged,
reviewed-PASS register-card parts plus the genuinely-new identity wrapper + the
read→refresh→retry-once orchestration. **206 tests green; `pnpm build`,
`pnpm typecheck`, full suite all pass.**

**What was built (production only — qa owns `src/__tests__/**`):**

1. **`src/lib/config.ts`** — `getSilApiUrl()` / `setSilApiUrl()` / `getSilApiUrlSource()`
   + the `sil_api_base` key on `SilPluginConfig` + `applyPluginConfigOverrides`.
   This is the **second origin** — sil-api (identity read), distinct from
   sil-web's `sil_api_url` (refresh). Resolution mirrors `getApiUrl` exactly
   (pluginConfig → `SIL_API_BASE` env → `DEFAULT_SIL_API_BASE`). Note the setter
   is named `setSilApiUrl` (qa's pinned contract) though it backs the
   `_silApiBase` field / `sil_api_base` key — a deliberate naming asymmetry to
   match the test surface, not a bug.
2. **`src/lib/credentials.ts`** — `clearTokens()` (atomic `unlinkSync`, tolerant
   of absence; scoped to `tokens.json` only, leaves `config.json`). Added
   `unlinkSync` to the existing `node:fs` import.
3. **`src/lib/sil-client.ts`** — `classifyIdentityResponse(status, body)` (pure,
   exported; 401→`unauthorized`, 403→`forbidden{reason}`, 5xx/non-200→`retryable`,
   200→body-gated `ok`) + `fetchIdentity(silApiUrl, token)` (`POST <silApiUrl>/identity`,
   `Authorization: Bearer`, body `{ agent_id: "sil-openclaw" }`). Reused
   `postJson`/timeout/`readJsonBody`/`stripTrailingSlash` (extended `postJson`
   with an optional `extraHeaders` arg for the Bearer). `refreshStoredTokens`
   reused **verbatim**. The `extractIdentity` unwrapper requires **both** a
   non-empty `name` AND a non-empty `addresses` array → null otherwise (this is
   the anti-false-green gate: the current `/identity` stub shape and any partial
   200 fall to `retryable`, never `ok`).
4. **`src/tools/identity.ts`** — `registerWhoami(api)` wired into the existing
   `registerIdentityTools`. Control flow exactly per the handoff: read token
   (none → terminal `not_registered`, **zero fetch**) → `fetchIdentity` → on 401
   only: `refreshStoredTokens` (sil-web) → on `refreshed` re-read rotated tokens
   + retry **once** → second 401/non-ok → `clearTokens` + terminal `must_reregister`.
   **At most one refresh + one retry — structurally cannot loop.** `forbidden`
   and `retryable` get distinct terminal/transient outcomes; envelope `result`
   unwrapped in `extractIdentity`. Result envelopes carry a `status` + a
   `recovery: "sil_register"` hint where actionable; success nests identity under
   `identity` (so `name`/`addresses` are never top-level on a non-success path).
5. **`openclaw.plugin.json`** — `+ "sil_whoami"` in `contracts.tools` (sorted);
   `+ sil_api_base` configSchema + uiHints; `+ https://api.sil.4gpts.com` as the
   second `networkEndpoints` origin; `packagingNote` updated.
6. **`src/index.ts`** — load log now also emits `sil_api_base` + its source
   (config hosts, not credentials — safe; aids deploy-time two-origin diagnosis;
   justifies the `getSilApiUrlSource` export).

**Live verification.** Build gate PASS (`dist/index.js` emitted — the manifest
`main` entry). Run/API/Browser/integration-smoke phases N/A: this is a library
plugin with no server or UI. The integration test (real tool + sil-client +
credentials wired, only `fetch` mocked) is the system-level proof and is green.

**Design-impacting choices for distillation (solutions-architect):**
- **Two-origin config model** (`sil_api_url`=sil-web vs `sil_api_base`=sil-api)
  is cross-cutting — every future plugin tool calling a sil-api domain
  (fulfillment/payments/loyalty) shares `sil_api_base`. Candidate for
  `docs/decisions/`.
- **`AGENT_ID = "sil-openclaw"` constant** + the **OMIT-`on_behalf_of`** rule
  (so the JWT `sub` is the principal, structurally avoiding 403
  `principal_mismatch`) is a non-obvious sil-api contract gotcha — candidate for
  `docs/knowledge/`.
- **The anti-false-green gate** (`extractIdentity` requires name + addresses;
  stub 200 → `retryable`) encodes the latent-endpoint dependency in code —
  worth a `docs/knowledge/` note tying it to the sil-services follow-on.

### QA coverage note (qa-developer — independent verifier)

**Tests authored RED-first (51 new `it()` across 5 files; `src/__tests__/**`, qa-owned). Full suite 206 pass / 18 files; `pnpm typecheck` clean — re-run independently after the expert reported GREEN.**

- `lib/identity-classify.test.ts` (unit, 14) — `classifyIdentityResponse` 200/401/403/5xx split + the **anti-false-green body gate**. **Mutation-verified**: forcing the classifier to accept any 200 as `ok` fails 6 of these (incl. "STUB body is NOT ok", "name-but-no-addresses is NOT ok") — the tests bite, not coincidentally green against the parallel impl.
- `lib/sil-api-url.test.ts` (unit, 9) — `getSilApiUrl` resolution **independent of** `getApiUrl`/`sil_api_url` (the two-origin keys never cross-talk).
- `lib/clear-tokens.test.ts` (unit, 4) — `clearTokens` removes tokens.json, tolerant of absence (no throw), scoped (leaves config.json).
- `tools/whoami.test.ts` (unit, 9) — no-input shape; not-registered short-circuit (zero fetch, names `sil_register`, no empty/null/crash/hang); success result identity-only (no token/Bearer echo); tokens+JWT+**PII** leak-canary.
- `whoami.integration.test.ts` (integration, 15; real tool+sil-client+credentials, only `fetch` mocked, URL-routed two-origin double) — happy-path real `{name,addresses}` + Bearer + sil-api origin + no-refresh-on-success; 401→refresh→rotate→retry-NEW-token→identity; refresh-also-fails→terminal+cleared+subsequent-`sil_register`-no-shortcircuit, **exactly 2 identity + 1 refresh** (no-storm); second-401-after-refresh terminal; **403 forbidden terminal at the wired tier** (no refresh, tokens NOT cleared, onboarding hint, not transient-framed); 5xx+network→retryable; two-origin (identity==sil-api, refresh==sil-web, no `auth0.com`); not-registered→zero fetch; rotated tokens reach only tokens.json + retry, never logs/result.

**Every unit + integration acceptance criterion maps to ≥1 test.** e2e (SC9) correctly left out of scope (no live sil-api/Postgres; blocked on the sil-services follow-on) — not faked.

**One signal for the review pass (behavioral question, not a test defect):** the `extractIdentity` gate rejects a 200 with a non-empty `name` but **zero** `addresses` → `retryable` → whoami surfaces "temporarily unavailable" + does not clear tokens. For a real, authenticated user who has simply not added an address yet, that is a non-transient condition mislabelled transient (a soft dead-end). The dev frames the strict gate as the anti-false-green feature (correct vs the stub), but the **empty-but-valid** case is a separate axis the acceptance criteria don't pin ("at least their name and addresses" is ambiguous on empty). I did not encode a contradicting test. When the real sil-api read lands, the architect/PO should decide whether name + empty-addresses is a valid identity; if yes, relax the `addresses.length === 0` reject in `sil-client.ts#extractIdentity` and I'll add the test. Until then the strict gate is acceptable (it cannot produce a false success).

### → Handoff to Review (next agent: code-quality-guardian)

**Pay attention to:**
- **Bounded refresh (the cardinal risk).** Verify the flow in
  `registerWhoami.execute()` can take **at most one refresh + one retry**. A
  second 401 after a successful refresh → `clearTokens` + `mustReregister`, never
  another `refreshStoredTokens`. The integration test pins exact call counts
  (1 identity + 1 refresh on dead-refresh; 2 identity + 1 refresh on
  refresh-then-still-401) — confirm no code path escapes that bound.
- **Two origins, asserted independently.** Identity → `getSilApiUrl()` (sil-api);
  refresh → `getApiUrl()` via `refreshStoredTokens` (sil-web). Never `auth0.com`.
  Outcomes branch on the `classifyIdentityResponse` / `RefreshStoredResult`
  unions, never raw `res.ok`.
- **Secret/PII hygiene.** Tokens, the refresh token, and the Bearer header never
  reach a `logger.*` call or the `ToolResult`; identity PII (name/addresses) is
  in the result but never logged. Logs carry only status markers
  (`sil_whoami_refreshed`, `sil_whoami_must_reregister`, `sil_whoami_forbidden`,
  …). Leak-canary tests cover success + not-registered + rotated-token paths.

**Deliberate trade-offs / known smells (not defects):**
- **Naming asymmetry:** `setSilApiUrl()` sets the `_silApiBase` field backing the
  `sil_api_base` key. Done to match qa's pinned test contract; the *key* is
  consistently `sil_api_base` everywhere user-facing (manifest, env, pluginConfig).
- **`DEFAULT_SIL_API_BASE = "https://api.sil.4gpts.com"` is a documented
  PLACEHOLDER.** The sil-api production URL is unpinned in the workspace; the
  override chain means tests + staging always set it explicitly — only the
  fallback is a guess. Flagged for founder/devops to pin at deploy (and recorded
  on the card's architect resolutions).
- **`getSilApiUrlSource()`** exists for the load-log symmetry with
  `getApiUrlSource()` — not dead code, used in `index.ts`.

**Latent live path — IMPORTANT for the reviewer.** The sil-api `/identity`
endpoint that returns real `{name, addresses}` **does not exist yet** — sil-api's
`/identity` is still a POST stub returning `{kind, verified, subject, attributes,
note}`. The entire plugin-side contract here is built + proven against a **mocked
sil-api boundary**; the live PII happy-path is blocked on a **sil-services
follow-on** (signaled to the orchestrator in the card's Signals block). The
`extractIdentity` gate is deliberately strict so the suite **cannot go green
against the current stub** — that strictness is the feature, not an over-fit.
No live network verification of the real read is possible in this repo (no live
sil-api/Postgres); the true cross-service E2E is sil-stage's golden example
(goal SC9).

## Review round 1 — code-quality-guardian

**Verdict: PASS** (one non-blocking P3 nit, carried from the register card).

Reviewed against PR #3 diff (`git diff main...card/sil-whoami-tool`). Sanity gate
re-run independently: `pnpm install` clean, `pnpm typecheck` clean (strict, no
`any`), `pnpm test` **206 pass / 18 files GREEN**. This is a PASS on green tests.

### Anti-false-green gate — VERIFIED REAL (mutation-checked, not trusted)

I did not take qa's mutation claim on faith. I temporarily weakened
`extractIdentity` (`src/lib/sil-client.ts`) to accept ANY 200 as `ok` and re-ran:
**exactly 6 tests went red** — `identity-classify.test.ts`'s "STUB body is NOT
ok", "wrapped STUB is NOT ok", "name-but-no-addresses is NOT ok",
"addresses-but-no-name is NOT ok", "empty/null/non-object is NOT ok", and "does
NOT branch on res.ok". File restored; suite back to 206 GREEN. The gate genuinely
bites: the suite **cannot go green while `sil_whoami` returns the current
`/identity` stub shape** `{kind,verified,subject,attributes,note}`. This is the
feature, not over-fit. Matches qa's report precisely.

### Refresh choreography (the cardinal risk) — CORRECT, read from code

Traced `registerWhoami.execute()` (`src/tools/identity.ts:162-209`) line by line,
not just via tests:
- First `fetchIdentity` → if `first.kind !== "unauthorized"`, returns immediately
  (`:171-173`) — **no refresh on success / 403 / 5xx**.
- On 401 → exactly ONE `refreshStoredTokens()` (`:176`). `must_reregister` →
  terminal + `clearTokens()` **only on `invalid_grant`** (`:177-183`); `retryable`
  → terminal transient (`:184-187`); `refreshed` → re-read rotated tokens, exactly
  ONE retry (`:190-196`).
- Retry: `ok` → return (`:197-199`); `unauthorized` → `clearTokens()` + terminal,
  **NEVER another refresh** (`:200-206`); 403/5xx → `identityOutcomeToResult`
  (`:208`).
- **Structurally at most one refresh + one retry — no path loops.** Exact
  call-count assertions pin it: 1 identity + 1 refresh on dead-refresh; 2 identity
  + 1 refresh on refresh-then-still-401 (`whoami.integration.test.ts:388-417,
  501-526`). The exhaustive switch in `identityOutcomeToResult` (`:215-229`) keeps
  a future refactor from silently dropping a variant.

### 403 handling — CORRECT

`classifyIdentityResponse` (`sil-client.ts:197-206`) splits 401→`unauthorized`,
403→`forbidden{reason}`; only 401 reaches the refresh branch (the `!==
"unauthorized"` short-circuit). 403 → terminal, **no refresh, no `clearTokens`**
(the token is valid, just unprovisioned). Both pinned at the wired tier
(`whoami.integration.test.ts:443-498`).

### Two origins — CORRECT, no auth0 leak

Identity → `getSilApiUrl()` (sil-api, `sil_api_base`); refresh → `getApiUrl()` via
`refreshStoredTokens` (sil-web, `sil_api_url`). Distinct keys, distinct resolvers,
**no cross-talk** (`config.ts:79-87`; pinned `sil-api-url.test.ts:86-103`).
`grep auth0` across `src/` + manifest: zero production hits — every match is a doc
comment, a test assertion proving Auth0 is never contacted, or a test fixture
`subject` string. Origins asserted independently + no-auth0 on every request
(`whoami.integration.test.ts:353-384`).

### Secret / PII hygiene — CLEAN

Read every `logger.*` call in `identity.ts`: all carry only non-credential markers
(`session_id`, `cause` enum, `reason` enum, or `{}`). No token, Bearer, name, or
address reaches a log line. `identityResult` (`:233-235`) returns `{status,
identity}` only — never the token/Bearer. Leak-canary covers success +
not-registered + rotated-token across all four levels (`whoami.test.ts:221-276`,
`whoami.integration.test.ts:581-622`). `clearTokens` (`credentials.ts:135-143`) is
atomic `unlinkSync`, absence-tolerant, scoped to `tokens.json` (leaves
`config.json`), files stay `0600`.

### Reuse, types, manifest, complexity — all PASS

- **Reuse:** `readTokens`/`writeTokens`/`refreshStoredTokens`/`postJson`/
  `readJsonBody`/`stripTrailingSlash` reused; `postJson` extended with an additive
  optional `extraHeaders` for the Bearer. New code = identity wrapper + classifier
  + `getSilApiUrl` + `clearTokens` + orchestration only. Outcomes branch on the
  classifier/refresh unions, never `res.ok`.
- **Types:** strict `tsc` clean; boundaries narrow `unknown` via `asRecord`; no
  `any`, no `@ts-ignore`/`@ts-expect-error`, no `eslint-disable`.
- **Manifest drift guard:** `contracts.tools` = `["sil_echo","sil_ping",
  "sil_register","sil_whoami"]` — sorted + dup-free (verified). Both manifest
  integration tests green (20 tests). Second origin `https://api.sil.4gpts.com`
  added to `networkEndpoints`; `configSchema`/`uiHints` carry `sil_api_base`;
  `packagingNote` updated and accurate.
- **Hardcoded values:** `AGENT_ID = "sil-openclaw"` and `REQUEST_TIMEOUT_MS =
  15_000` are named constants with justifying comments; `DEFAULT_SIL_API_BASE` is a
  documented placeholder overridable via config/env. No magic numbers in logic.
- **Complexity:** `execute()` is ~46 lines, linear, cyclomatic ~8, nesting depth 2.
  Kept as one function deliberately so the "at most one refresh + one retry"
  bound is structurally visible; helpers are small + single-purpose. Acceptable.

### Empty-addresses behavior — ACCEPTED for now (signal for PO, not a defect)

The flagged behavioral signal: a 200 with a valid `name` but ZERO `addresses`
classifies as `retryable` ("temporarily unavailable") because `extractIdentity`
(`sil-client.ts:325-343`) requires `addresses.length > 0`. **Decision: accept (a),
do not block.** Reasoning: (1) the acceptance criteria say "at least their name
and addresses" — genuinely ambiguous on the empty case, never pinned; (2) the live
PII read is latent on the sil-services follow-on, so no real user can reach this
path today — it is a latent-path edge, exactly the kind not to block on; (3) the
strict gate's job *right now* (cannot false-green against the stub) is correct and
load-bearing, while relaxing `addresses.length === 0` is a forward-looking product
call best made when the real read lands. qa recorded this cleanly and encoded no
contradicting test. **Signal to PO/architect:** when the real sil-api identity-read
ships, decide whether `name` + empty-`addresses` is a valid identity; if yes, relax
the reject in `extractIdentity` and qa adds the test. Until then the strict gate is
the safer default (it cannot produce a false success).

### Non-blocking nit (P3) — no fix required this card

- **`package-manifest.integration.test.ts` asserts nothing under `security`.** The
  second `networkEndpoints` origin (and the `credentialsOnDisk`/`filesystemScope`
  disclosure) is **truthful and correct** but not regression-guarded by a test —
  the exact P3 the register-card review flagged and this card's own risk list
  re-noted. Not a defect (the disclosure is accurate); a future hardening could add
  a small assertion that `security.networkEndpoints` contains both origins. Left as
  a carried-forward nit, consistent with how the register card treated it.

### Knowledge-capture check — adequate, queued for distilling

Non-obvious logic carries inline WHY throughout (module headers, `AGENT_ID`,
`clearTokens`, `extractIdentity`'s anti-false-green rationale, the two-origin
model in `config.ts`). The dev queued three distillation candidates (two-origin
config model → `docs/decisions/`; `AGENT_ID` + omit-`on_behalf_of` 403 gotcha →
`docs/knowledge/`; anti-false-green gate tying to the sil-services follow-on →
`docs/knowledge/`). Appropriate to capture in the distilling stage — no gap that
blocks PASS.

### Tier coverage — matches

`tiers: [unit, integration, e2e]` frontmatter matches the criteria tags and the
test files present (unit: `identity-classify`, `sil-api-url`, `clear-tokens`,
`whoami`; integration: `whoami.integration` + the two manifest tests; e2e
correctly out of scope — owned by sil-stage goal SC9, blocked on the sil-services
follow-on, not faked).

## Distillation — solutions-architect

Searched all three `docs/*/INDEX.md` first — all empty (this is the first card to
capture into `docs/`; the predecessor `sil_register` merged before its distillation
ran, so its learnings were never lifted). Created three cross-cutting docs and folded
the orphaned register-card knowledge into them where it belonged, staying in scope.

- **decisions/sil-two-origin-model.md** (NEW) — the plugin addresses TWO sil
  services with DISTINCT config keys: `sil_api_url`=sil-web (auth authority —
  claim/refresh, `/api/v1/*`, sole Auth0-secret holder) vs `sil_api_base`=sil-api
  (domain reads — bare `/identity` + future fulfillment/payments/loyalty). Constrains
  every future tool's origin choice. Folds in the register-card's "refresh only via
  sil-web, never Auth0" invariant (same origin-authority decision). Notes the
  `DEFAULT_SIL_API_BASE` placeholder for founder/devops to pin at deploy.
- **knowledge/sil-response-classification.md** (NEW) — repo invariant: classify sil
  responses on BODY SHAPE, not HTTP status, and never on `res.ok`. One doc covering
  BOTH `200`-discriminants — claim's 200-pending-vs-200-success (folded in from the
  orphaned register card) and identity's anti-false-green 200-with-no-name→`retryable`
  (the gate that stops the suite green-ing against the `/identity` stub). Records the
  mutation-verification and the empty-addresses open edge.
- **knowledge/sil-api-identity-contract.md** (NEW) — single source of truth for the
  sil-api identity-read contract (POST `/identity` bare path, Bearer, `{agent_id}`),
  the request gotchas (`agent_id` required; OMIT `on_behalf_of` or guaranteed 403;
  401-refreshable vs 403-terminal), and the LATENT cross-sibling dependency: sil-api's
  `/identity` is still a stub, so the live PII happy path AND the sil-stage e2e (goal
  SC9) are blocked on a sil-services follow-on that swaps only the `result` payload.
- INDEX.md updated: decisions (1 row), knowledge (2 rows).

**Deliberately NOT captured:**
- No new inline `// WHY:` comments — the dev already commented every site of surprise
  thoroughly: the refresh-once invariant (`src/tools/identity.ts:189,201-202,226-227`),
  the two-origin model (`src/lib/config.ts:1-34`), the anti-false-green gate
  (`src/lib/sil-client.ts:312-343`), `clearTokens` rationale
  (`src/lib/credentials.ts:128-143`). Adding more would restate the code (forbidden by
  the distillation skill + critical-thinking.md).
- No `docs/product/` doc — the PO's three flow invariants (no dead ends / invisible
  refresh / PII discipline) live in the card body and need no separate product doc yet;
  no future card depends on extracting them.
- No `CLAUDE.md` convention edit — the docs taxonomy already documents itself; this card
  introduced no new project-wide convention beyond what the three docs capture.

## PR Ready

<!-- PR url; founder notification fires here -->

## Epic notes (provisional — sibling Discovery owns the verdict)

**Likely change site:** `src/tools/identity.ts` — add `sil_whoami` tool to the existing `registerIdentityTools(api)` group (same file as `sil_register`); tool name added to `openclaw.plugin.json#contracts.tools`. Reuses the credential storage module from `sil_register` (`tokens.json`/`config.json`). Shallow guess — Discovery to confirm.

**Acceptance (from PRD per-surface):**
- `sil_whoami` calls sil-api with the stored Bearer JWT and returns real user identity data (name, addresses).
- Token refresh is transparent to the agent — if access token expired, the tool refreshes via sil-web and retries.
- Error (not registered): returns error envelope with recovery hint to run `sil_register`.
- Registered in manifest (`contracts.tools`).
