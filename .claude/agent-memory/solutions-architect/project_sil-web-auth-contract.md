---
name: sil-web-auth-contract
description: The authoritative PKCE/claim/refresh HTTP surface the sil-openclaw plugin integrates with. Verify against the route files before relying on field names.
metadata:
  type: project
---

The sil-web backend that `sil-openclaw`'s `sil_register`/`sil_whoami` tools call lives at `sil-services/apps/sil-web` (a Next.js app, sibling repo). Its auth surface is already implemented and is the contract the plugin must match.

**Why:** The card says "follow the klodi register pattern," but there is no klodi repo in this workspace — `sil-services/apps/sil-web` is the real backend, and its route handlers are the ground truth, not any klodi memory.

**How to apply:** Before designing/implementing any plugin tool that talks to sil-web, re-read these route files (they may have changed since this note). As of 2026-06-08:

- **PKCE roles (load-bearing):** the *agent/plugin* mints `session_id` (UUID v4) and the `code_verifier`, derives `code_challenge = base64url(SHA256(verifier))` — exactly 43 base64url chars. sil-web's `src/lib/pkce.ts` (`deriveChallenge`, `isValidCodeChallenge`, `isValidSessionId`) is the canonical derivation; the plugin must reproduce it with `node:crypto`. sil-web stores only the challenge.
- **There is NO "create session" POST.** The pending `onboarding_sessions` row is INSERTed server-side by `GET /authorize?session=<uuid>&code_challenge=<challenge>` (`apps/sil-web/src/app/authorize/route.ts`) — i.e. when the *user's browser* opens the auth URL, not by any plugin pre-flight call. The plugin's `sil_register` only builds the URL string `${APP_BASE_URL}/authorize?session=...&code_challenge=...` and hands it to the agent. Treating "call sil-web to create a session" as a plugin→server POST is wrong.
- **Claim:** `POST /api/v1/sessions/{id}/claim` body `{ code_verifier }`. 200 `{ access_token, refresh_token, user: { id } }` exactly once (atomic CAS). 200 `{ status: "pending" }` while onboarding incomplete. 409 already_claimed. 410 expired (status OR past expires_at). 404 not_found — byte-identical for wrong-verifier AND unknown-session (no existence oracle). Tokens appear only in the 200 body, never logged. Sessions expire 30 min after authorize.
- **Refresh (SC7):** `POST /api/v1/auth/refresh` body `{ refresh_token }` → 200 `{ access_token, refresh_token, expires_in, token_type }`; 401 invalid_grant on rejection. Stateless pass-through to Auth0. Plugin NEVER calls Auth0 directly.
- **Base URL:** the plugin already resolves the backend origin via `src/lib/config.ts` `getApiUrl()` (pluginConfig `sil_api_url` → `SIL_API_URL` env → `https://sil.4gpts.com`). That is the value to prefix onto `/authorize` and the `/api/v1/*` paths.

The full goal PRD (SC1–SC9, F1–F9) is `mission-control-sil/goals/identity-onboarding-slice.md`.
