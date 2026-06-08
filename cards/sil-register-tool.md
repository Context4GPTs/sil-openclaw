---
type: card
title: sil-register-tool
slug: sil-register-tool
work_type: feature
tiers: []
status: backlog
agents: []
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

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — product-owner

<!-- Filled jointly by product-owner and solutions-architect. -->

### Approach + alternatives ruled out

<!-- 1–3 lines per alternative, with the reason it lost -->

### Affected files / surfaces

<!-- bulleted list -->

### Risks / failure modes

<!-- bulleted list — what could break. solutions-architect owns the technical/
implementation risks; product-owner's user-facing risks are grouped below. -->

**Product / user-facing failure modes (product-owner)**

- **Stale auth URL shown to the user.** The agent shares a URL whose session has a 30-min TTL. If the user opens it after expiry, sil-web returns 410 and the user gets a dead-end. The flow must never present an expired URL as if live; on expiry the agent's message must clearly say "this link expired, run sil_register again," not fail silently or hang.
- **`pending` misread as failure.** The claim endpoint returns HTTP **200** for pending (not a 4xx). A naive "non-2xx = error" or "2xx = done" check breaks the happy path either way — pending must be distinguished by body, and the user kept informed that the system is waiting on them, not stuck.
- **Silent terminal stall.** If polling exhausts its budget (user walked away) with no terminal signal to the agent, the user is left not knowing registration failed. Every terminal state (success, expired, already-claimed, 404, timeout) must produce an agent-visible outcome — no state may end in silence.
- **Credential exposure / privacy.** `tokens.json` holds live access + refresh tokens (and the refresh token rotates). They must live only in the plugin's local data dir, never be logged, echoed in a tool result, or written anywhere world-readable. The PKCE verifier must never touch disk at all. A leaked refresh token is a standing account-access risk until re-registration.
- **Already-claimed ambiguity for the user.** A 409 can mean "another of my agents already grabbed it" (benign — that instance is fine) OR "a replay/attacker claimed it" (not benign). The agent-facing copy should guide the user to re-run rather than alarm them, while the event is still distinguishable in logs for support.
- **Cross-instance interference.** If two instances accidentally shared a session or data dir, one claim would consume the other's tokens (claim is exactly-once CAS). The independent-tokens guarantee (SC8) is a user-trust invariant: registering a new agent must never log the user's other agents out.

### Acceptance criteria

<!--
product-owner framed the behaviour below (Given/When/Then). Tier tags are left as
`[tier?]` for solutions-architect to replace with [unit]/[integration]/[e2e] and to
set the `tiers:` frontmatter. Wire-level shapes (200/404/409/410, refresh) are pinned
to the ALREADY-MERGED sil-web contract — see sil-services/cards/done/2026/sil-web-auth-endpoints.md.
-->

**PKCE generation + auth URL (SC1 / F1)**

- `[tier?]` Given no parameters, when the agent calls `sil_register`, then the tool generates a fresh `session_id` and a PKCE verifier + S256 challenge, and the result contains `auth_url` of the exact form `<sil_api_url>/authorize?session=<session_id>&code_challenge=<challenge>`.
- `[tier?]` Given a generated PKCE pair, when the auth URL is built, then `code_challenge` is the **S256 base64url digest** (43 chars, no `+`/`/`/`=` padding) — i.e. the digest the agent sends, never the raw verifier (sil-web stores and compares digests; sending the verifier would break the claim CAS).
- `[tier?]` Given `sil_api_url` is overridden via plugin-config or `SIL_API_URL`, when `sil_register` builds the auth URL, then the override host is used (resolution order pluginConfig → env → default, per `src/lib/config.ts`), not the hardcoded default.
- `[tier?]` Given a fresh registration, when `sil_register` returns, then it returns promptly with `status: "awaiting_browser"` (or equivalent non-terminal status) and `session_id`, without blocking the agent until the user finishes the browser flow.

**Background polling + claim state handling (SC4 / F3 / F4)**

- `[tier?]` Given a started registration, when polling the claim endpoint returns HTTP 200 `{ access_token, refresh_token, user: { id, ... } }`, then the tool treats it as success exactly once, stops polling, and persists credentials (see storage criteria).
- `[tier?]` Given onboarding is not yet complete, when polling returns HTTP 200 `{ status: "pending" }`, then the tool keeps polling at its interval and does NOT treat pending as an error or as terminal (pending is a 200, not a 4xx — must not be misclassified).
- `[tier?]` Given the session has expired, when polling returns HTTP 410, then the tool stops polling, surfaces a terminal expired state, and the agent-facing message tells the user to re-run `sil_register` to start a fresh session.
- `[tier?]` Given the session's tokens were already claimed (this or another instance/replay), when polling returns HTTP 409, then the tool stops polling and surfaces a terminal already-claimed state with a recovery hint, without persisting any tokens.
- `[tier?]` Given the session is unknown or the verifier does not match, when claim returns HTTP 404, then the tool stops polling and surfaces a terminal failure with a re-run hint (the plugin must not leak/assume which of the two it is — sil-web returns a uniform 404 by design).
- `[tier?]` Given the user never completes onboarding, when the polling budget (max attempts / overall deadline) is exhausted with only `pending` responses, then the tool stops polling and surfaces a terminal timeout state with a re-run hint (never polls unbounded).
- `[tier?]` Given a transient network error or 5xx from the claim endpoint, when polling, then the tool retries (within its budget) rather than treating the blip as terminal failure.

**Credential storage (F4)**

- `[tier?]` Given a successful claim, when the tool persists credentials, then it writes `tokens.json` (access + refresh token) and `config.json` (user id + name) to the plugin's local data directory, and a subsequent identity-returning call reads its identity from those files.
- `[tier?]` Given any registration outcome, when files are written, then the PKCE **verifier is NEVER written to disk** (it is the agent's secret, held only in memory for the claim step) — only the digest ever leaves the process, and only inside the auth URL.
- `[tier?]` Given the local data directory does not yet exist, when the tool persists credentials, then it creates the directory and writes the files without error (first-run on a clean machine).

**Already-registered idempotency (F1)**

- `[tier?]` Given a valid `tokens.json` already exists locally, when the agent calls `sil_register`, then the tool short-circuits and returns `status: "already_registered"` with the existing user identity, without generating a new PKCE session, without opening a new browser flow, and without overwriting the stored tokens.

**Second plugin instance — independent tokens (SC8 / F8)**

- `[tier?]` Given the same user has already registered one plugin instance, when a second instance (separate data directory) runs its own `sil_register` → claim, then it obtains its OWN session and its own token pair into its own `tokens.json` — one instance's success does not consume or invalidate the other's session, and neither instance's claim affects the other's stored tokens.

**Token refresh via sil-web, never Auth0 (SC7 / F7)**

- `[tier?]` Given a stored refresh token, when the tool refreshes, then it issues `POST <sil_api_url>/api/v1/auth/refresh` with `{ refresh_token }`, and on HTTP 200 `{ access_token, refresh_token }` it overwrites `tokens.json` with the new (rotated) pair.
- `[tier?]` Given any refresh path, when the tool refreshes, then it calls ONLY sil-web — it never contacts an Auth0 endpoint directly (no Auth0 host in any outbound request; sil-web is the sole auth authority and the only holder of the Auth0 client secret).
- `[tier?]` Given the refresh token is rejected, when sil-web returns HTTP 401 (invalid grant), then the tool surfaces a terminal "must re-register" state and does not silently retain a known-dead token as if valid.

### Open questions (if any)

<!-- product-owner open questions below; solutions-architect may add their own. -->

- **Agent notification mechanism on completion (F4).** The goal PRD says polling "fires a system event on completion so the agent doesn't need to call a manual poll tool," but this repo's host SDK declaration (`src/types/openclaw.d.ts:11-17`) deliberately drops the wake-event / system-event surface, and `register()` must open nothing. ASSUMPTION (defensible, not blocking): for this card the acceptance bar is the observable *state* — credentials persisted on success, and a subsequent status/identity call reflecting it — not the push-notification transport. If a system event is required for the slice, it likely needs SDK surface this skeleton hasn't declared; the architect should confirm whether to (a) add that surface now or (b) defer the push to a follow-up and have the agent re-invoke a status path. Either way the polling + persistence behaviour above is unchanged.
- **Polling interval and budget values.** Treated as config (not hardcoded) per the repo's standards. ASSUMPTION: interval and overall deadline align with sil-web's `expires_at = now() + 30 min` session TTL so the budget never outlives the session. Exact numbers are an implementation detail for the dev pair; the invariant ("bounded, and not longer than the session TTL") is the acceptance bar.
- **`config.json` field set.** PRD F4 specifies `user id, name`. ASSUMPTION: store exactly those plus the resolved `sil_api_url` is NOT duplicated here (it already resolves from pluginConfig/env/default); keep `config.json` to identity fields only to avoid a second source of truth for the backend URL. Architect to confirm against the klodi `config.json` shape if it differs.

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

**Likely change site:** `src/tools/` — new `registerIdentityTools(api)` group with `sil_register` tool; wired into `register()` in `src/index.ts`; tool name added to `openclaw.plugin.json#contracts.tools`. Credential storage under the plugin's local data directory (`tokens.json`, `config.json`). Shallow guess — Discovery to confirm.

**Acceptance (from PRD per-surface):**
- `sil_register` is a real tool (replacing stubs). Generates PKCE material and returns a working auth URL.
- Polling logic handles pending/success/expired/already-claimed states.
- Credential storage (`tokens.json`/`config.json`) works.
- Registered in manifest (`contracts.tools`).
- A second plugin instance for the same user gets its own valid tokens.
- Token refresh (SC7) flows through sil-web — plugin calls `POST /api/v1/auth/refresh`, never Auth0 directly.
