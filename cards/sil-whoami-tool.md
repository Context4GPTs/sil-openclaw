---
type: card
title: sil-whoami-tool
slug: sil-whoami-tool
work_type: feature
tiers: []
status: discovery
agents: [product-owner, solutions-architect]
priority: 1
created: 2026-06-08
updated: 2026-06-08
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-sil-whoami-tool
branch: card/sil-whoami-tool
pr: null
merged_commit: null
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
- 2026-06-08 product-owner (discovery) — premise-correction: sil-api routes are at BARE paths (`/identity`, not `/api/v1/identity`); only sil-WEB uses `/api/v1/*` (claim + `/api/v1/auth/refresh`). The card intent's "call sil-api with Authorization: Bearer" is correct on the auth header but the endpoint path/verb/response-shape must be pinned to the (to-be-built) sil-api identity-read, not assumed. Refresh stays on sil-web `/api/v1/auth/refresh` (already built — `refreshStoredTokens()` in `src/lib/sil-client.ts`).

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

### Affected files / surfaces

<!-- bulleted list -->

### Risks / failure modes

<!-- solutions-architect owns the technical/implementation risks; product-owner's
user-facing risks are grouped below. -->

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

- `[tier]` Given no `tokens.json` exists in the plugin's data dir, when the agent calls `sil_whoami`, then the tool returns a clear, structured error that names the recovery action — run `sil_register` — and makes NO sil-api call (nothing to authenticate with). (Seed an empty/missing data dir; assert no `fetch`.)
- `[tier]` Given no `tokens.json` exists, when the agent calls `sil_whoami`, then the tool does NOT crash, does NOT return an empty/`null`/ambiguous identity, and does NOT hang — the result is an unambiguous "not registered, run `sil_register`" outcome the agent can act on.

**Happy path (valid access token)**

- `[tier]` Given a valid `tokens.json` (live access token), when the agent calls `sil_whoami`, then the tool calls sil-api with `Authorization: Bearer <access_token>` and returns the registered user's real identity — at least their name and addresses — for the user that token resolves to. (Mock the sil-api boundary to the agreed identity-read contract; assert the Authorization header carries the stored access token and the returned identity matches the authenticated user, NOT a hardcoded stub shape.)
- `[tier]` Given a valid access token, when `sil_whoami` calls sil-api, then it targets the resolved `sil_api_url` origin (pluginConfig → `SIL_API_URL` → default), not a hardcoded host. (Assert the request origin equals the resolved origin under an override.)
- `[tier]` Given the identity read succeeds on the first try (access token still valid), when `sil_whoami` returns, then NO refresh request is made — the refresh path is taken only on an actual 401 from sil-api. (Assert exactly one outbound sil-api call and zero calls to the sil-web refresh endpoint.)

**Transparent refresh (expired access token, valid refresh token)**

- `[tier]` Given the stored access token is expired (sil-api responds 401), when the agent calls `sil_whoami`, then the tool refreshes via sil-web `POST /api/v1/auth/refresh` with the stored refresh token, rotates `tokens.json` with the new pair, retries the sil-api identity read once with the new access token, and returns the user's identity — the agent sees the identity result, never an expiry/refresh state. (Mock sil-api: first call 401, second 200; mock sil-web refresh 200; assert tokens.json rotated and the retry used the NEW access token.)
- `[tier]` Given a refresh occurs, when `sil_whoami` refreshes, then it contacts ONLY sil-web (the resolved `sil_api_url` origin) — never an Auth0 host directly (sil-web is the sole auth authority / Auth0-secret holder). (Assert every outbound request host is the resolved origin; no `auth0.com`.)
- `[tier]` Given the access token was expired and refresh succeeded, when the retried read returns identity, then `tokens.json` holds the ROTATED pair (the old expired access token and old refresh token are gone), so a subsequent call uses fresh credentials without another refresh.

**Refresh also fails (dead refresh token)**

- `[tier]` Given the stored access token is expired AND the refresh token is rejected (sil-web returns 401 / invalid_grant), when the agent calls `sil_whoami`, then the tool surfaces a terminal "session expired — re-register" outcome guiding the user to run `sil_register`, and does NOT loop or retry the dead refresh. (Mock sil-api 401, sil-web refresh 401; assert a single refresh attempt and a terminal re-register result.)
- `[tier]` Given a refresh was rejected as invalid_grant, when `sil_whoami` returns the terminal outcome, then the now-known-dead session is not presented as valid — a confirmed-dead session never masquerades as live (so the user's recovery via `sil_register` is not blocked by a stale "registered" appearance). (Assert the terminal path does not report success; if the chosen mechanism clears `tokens.json`, assert a subsequent `sil_register` does not short-circuit on stale presence.)

**Bounded refresh (no storm)**

- `[tier]` Given sil-api persistently returns 401, when the agent calls `sil_whoami`, then the tool performs AT MOST one refresh + one retry per call — it never enters an unbounded refresh→retry loop. (Assert ≤1 refresh call and ≤1 retried identity read for a single `sil_whoami` invocation, even if the retry also 401s.)
- `[tier]` Given the retried identity read (after a successful refresh) STILL returns 401, when `sil_whoami` finishes, then it stops and surfaces a terminal outcome (does not refresh again) — a fresh access token that is still rejected is terminal, not cause for another refresh cycle.

**Security / privacy invariants**

- `[tier]` Given any `sil_whoami` path (success, refresh, not-registered, terminal), when the tool logs, then NO token value (access or refresh) and NO PII (name, addresses) appears in any log line at any level — only non-credential identifiers (e.g. a user id / status) may be logged. (Cross-level logger leak-canary, mirroring the register card's token-leak test, extended to assert no address/name string leaks either.)
- `[tier]` Given a successful identity read, when `sil_whoami` returns, then the tool result carries ONLY the intended identity payload (name, addresses, and any agreed identity fields) — it does not echo the access token, the refresh token, or the raw Authorization header back to the agent.
- `[tier]` Given a refresh occurs mid-call, when tokens are rotated, then the rotated token values touch only `tokens.json` (via the existing credential writer) and the in-flight retry — never a log line, never the returned result.

**Transient failure (network / 5xx — distinguished from terminal)**

- `[tier]` Given sil-api (or the sil-web refresh) returns a transient failure (network error / 5xx) rather than a 401, when the agent calls `sil_whoami`, then the tool surfaces a distinct retryable/try-again outcome — it does NOT tell the user to re-register (a re-register hint on a transient blip is a false terminal). (Distinguish 401 → auth/refresh path vs 5xx/network → transient outcome.)

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

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

<!-- specific guidance for the dev pair: where to start, constraints,
test strategy -->

## In Dev — <agents>

<!-- implementation + test notes -->

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

**Likely change site:** `src/tools/identity.ts` — add `sil_whoami` tool to the existing `registerIdentityTools(api)` group (same file as `sil_register`); tool name added to `openclaw.plugin.json#contracts.tools`. Reuses the credential storage module from `sil_register` (`tokens.json`/`config.json`). Shallow guess — Discovery to confirm.

**Acceptance (from PRD per-surface):**
- `sil_whoami` calls sil-api with the stored Bearer JWT and returns real user identity data (name, addresses).
- Token refresh is transparent to the agent — if access token expired, the tool refreshes via sil-web and retries.
- Error (not registered): returns error envelope with recovery hint to run `sil_register`.
- Registered in manifest (`contracts.tools`).
