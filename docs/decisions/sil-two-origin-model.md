---
id: sil-two-origin-model
title: The plugin talks to two sil origins (sil-web auth authority + sil-api domain reads)
tags: [architecture, config, auth, contracts, sil-api, sil-web]
card: sil-whoami-tool
commit: a635103
updated_at: 2026-06-08
updated_by_card: sil-whoami-tool
---

This plugin addresses **two distinct sil services at two distinct origins**, resolved from two distinct config keys — never one. Any future tool must pick the right origin for what it is doing.

| Service | Config key (resolution: pluginConfig → env → default) | What it owns | Used by |
|---|---|---|---|
| **sil-web** (`apps/sil-web`, Next) | `sil_api_url` → `SIL_API_URL` → `DEFAULT_API_URL` (`https://sil.4gpts.com`) | The **auth authority**: PKCE claim (`POST /api/v1/sessions/{id}/claim`) and token refresh (`POST /api/v1/auth/refresh`). `/api/v1/*` paths. | `claimSession`, `refreshSession`, `refreshStoredTokens` (`src/lib/sil-client.ts`) |
| **sil-api** (`services/sil-api`, Fastify) | `sil_api_base` → `SIL_API_BASE` → `DEFAULT_SIL_API_BASE` (placeholder, see below) | The **domain service**: identity read and all future commerce domains (fulfillment, payments, loyalty). **Bare** paths (`/identity`, NOT `/api/v1/identity`). | `fetchIdentity` (`src/lib/sil-client.ts`); resolver `getSilApiUrl()` (`src/lib/config.ts:79`) |

## Why two keys, not one

- **They are different services, likely different origins, deployed independently.** A single key cannot address both unless a gateway fronts them — which is not assumed. Overloading `sil_api_url` for the sil-api read was considered and **rejected**: it conflates two independently-deployable origins and makes a wrong-host call (identity request hitting sil-web) a silent misconfiguration.
- **sil-web is the *sole* auth authority** — it is the only holder of the Auth0 client secret. Token refresh therefore goes **only** to sil-web (`sil_api_url`), **never to Auth0 directly** and never to sil-api. `refreshStoredTokens` (`src/lib/sil-client.ts:291`) hard-codes this; the integration suite asserts no outbound request ever hits `auth0.com`. This is a security invariant, not a convenience.

## The constraint on future work

> Any new plugin tool that calls a sil-api **domain** (fulfillment, payments, loyalty, …) uses `getSilApiUrl()` / `sil_api_base` — the same origin as `fetchIdentity`. Only PKCE/claim/refresh use `getApiUrl()` / `sil_api_url`. The two resolvers (`config.ts:61` and `config.ts:79`) never cross-talk; keep it that way.

When you add a sil-api origin to anything, also add it to `openclaw.plugin.json#security.networkEndpoints` — the disclosure must name **both** origins.

## Known soft spot

`DEFAULT_SIL_API_BASE` (`config.ts:34`) is a **documented placeholder** (`https://api.sil.4gpts.com`) — the sil-api production URL is unpinned anywhere in the workspace. The override chain means tests and staging always set it explicitly via `sil_api_base` / `SIL_API_BASE`; only the fallback is a guess. Founder/devops must pin it at deploy (or set it to the same origin if a single gateway fronts both services).

See [[sil-api-identity-contract]] for the sil-api request/response shape, and [[sil-response-classification]] for how outcomes from both origins are classified.
