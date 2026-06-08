---
name: identity-onboarding-slice
description: The identity-onboarding-slice goal — cross-sibling auth/identity flow across sil-openclaw (plugin) + sil-services (sil-web, sil-api). Architecture facts a product spec must respect.
metadata:
  type: project
---

Goal `identity-onboarding-slice` (origin tag `goal:identity-onboarding-slice`) builds an
agent-identity flow split across two sibling repos. As product-owner shaping cards here,
these cross-sibling facts constrain what behavior is even buildable.

**Why:** the founder's card intents repeatedly assume sil-api endpoints/shapes that don't
match the merged code; getting the premise right is half the discovery work.

**How to apply:** before writing acceptance criteria for any identity card, check the
actual sil-services state — the intent's endpoint/path/shape is often stale.

## The two backends are NOT interchangeable
- **sil-web** (`sil-services/apps/sil-web`) = the auth authority. Holds the Auth0 client
  secret. Owns the PKCE browser flow + `POST /api/v1/sessions/{id}/claim` + `POST
  /api/v1/auth/refresh`. Uses `/api/v1/*` paths. Refresh goes here, NEVER Auth0 directly.
- **sil-api** (`sil-services/services/sil-api`) = the resource/commerce API. Routes at
  **BARE paths** (`/identity`, `/fulfillment`, `/payments`, `/loyalty`; `/health` public).
  NO `/api/v1` prefix. Guarded by a JWT middleware (Bearer → JWKS verify → load
  `req.user` by `auth0_sub`). 401 uniform `{error:"unauthorized"}` for any token failure;
  403 `user_not_provisioned` / `principal_mismatch` are a DIFFERENT class (not refreshable).

## sil-api domain handlers are STILL STUBS (as of 2026-06-08)
`/identity` returns a fixed `{kind, verified, subject, attributes, note}` — it reads
neither `req.user` nor addresses. There is NO real authenticated identity-read returning
the user's DB name + addresses yet, despite `UserRow`/`AddressRow` existing in `@sil/db`.
The JWT card's own design said "addresses are per-domain queries by user.id, not preloaded"
— i.e. the read was deferred. Any plugin tool that needs real PII from sil-api is LATENT on
a sil-services follow-on; build/test the plugin side against a MOCKED boundary and signal
the dependency. See [[premise-correct-against-merged-code]].

## sil-api gate is latent in staging
sil-stage runs sil-api in BYPASS mode (fixture user, no real Bearer enforcement) until it
sends real tokens. Live cross-service identity proof is owned E2E by sil-stage (goal SC9),
not provable inside sil-openclaw.

## Plugin-side credential primitives already exist (reuse, don't re-build)
In `sil-openclaw/src/lib/`: `credentials.ts` (`tokens.json`/`config.json`, `0600`, atomic),
`sil-client.ts#refreshStoredTokens()` (read → sil-web-only refresh → rotate; 401 →
`must_reregister`; no-stored → `must_reregister`; 5xx → retryable), `config.ts#getApiUrl()`
(pluginConfig → `SIL_API_URL` → default `https://sil.4gpts.com`). `sil_register`'s
already-registered short-circuit is PRESENCE-based, not freshness-based — so a dead token
left in `tokens.json` blocks re-register; "a dead session never masquerades as live" is the
product invariant that fixes this.
