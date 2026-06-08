---
name: sil-api-identity-contract
description: The sil-api Bearer-authed identity-read surface sil_whoami calls — a DIFFERENT service/origin than sil-web, and the /identity handler is still a stub (real name+addresses is a cross-sibling dependency). Verify route files before relying on this.
metadata:
  type: project
---

`sil_whoami` (sil-openclaw) reads identity from **sil-api**, which is a real Fastify service at `sil-services/services/sil-api` (NOT `apps/` — apps only holds sil-web + sil-admin-console). This is a SEPARATE service and likely a separate origin from sil-web. See [[sil-web-auth-contract]] for the sil-web (claim/refresh) half.

**Why this matters:** the goal PRD (SC6/F6) and the card say `sil_whoami` "calls sil-api with a Bearer JWT and returns name + addresses." sil-api is where the Bearer JWT is validated, but the plugin's only configured origin (`getApiUrl()` → sil-web) is the WRONG one for this read.

**How to apply** (re-verify the route files — they may have changed since 2026-06-08):

- **Endpoint:** `POST /identity` — a **BARE path, NOT `/api/v1/identity`**. The sil-api-jwt-middleware card explicitly corrected the `/api/v1` premise: routes register bare (`/identity`, `/fulfillment`, `/payments`, `/loyalty`); `/health` is public; the eval client posts bare paths. Introducing `/api/v1` would break the live sil-stage eval. (`services/sil-api/src/handlers/register-domain.ts`, `server.ts`.)
- **Request body:** `SimplifiedAgentRequest` = `{ agent_id: string (1..200, required), on_behalf_of?: string, input?: Record<string,unknown> }`, validated by Fastify TypeBox. (`packages/schemas/src/request.ts`.)
- **Auth:** JWT middleware guards the four domain routes at the `preHandler` stage (merged, card `sil-api-jwt-middleware`). Missing/bad Bearer → 401 fixed body `{error:"unauthorized",message:"Authentication required"}` (identical for every cause, no oracle). Valid JWT whose `sub` has no users row → 403 `user_not_provisioned`. `body.on_behalf_of` present AND ≠ token `sub` → 403 `principal_mismatch`. JWKS unavailable → 503. So the plugin should send `agent_id` and EITHER omit `on_behalf_of` or set it to the token's own subject — never a different principal.
- **Response:** UCP envelope `{ protocol, version, domain:"identity", request_id, issued_at, enrichment:{agent_id, on_behalf_of?, enriched:true, source:"sil-api"}, result }`. (`services/sil-api/src/envelope.ts`.)
- **CRITICAL GAP — the `/identity` handler is a STUB.** `result` is currently `{ kind:"identity", verified:true, subject: on_behalf_of ?? agent_id, attributes:{tier:"standard"}, note:"stubbed identity result — scaffold stage" }` (`services/sil-api/src/handlers/identity.ts`). It does NOT return the real user `{ name, addresses }` from Postgres, and it does NOT derive identity from `req.user` (the JWT card flagged handler-rewiring-to-req.user as a deferred follow-on). SC6/F6 need a real handler that reads `req.user` (name) + queries `addresses` by `user.id`. **That is sil-services work — a cross-sibling blocker for sil_whoami's real-identity contract.**
- **DB shapes** (`packages/db/src/types.ts`): `UserRow = { id, auth0_sub, name, created_at, updated_at }`; `AddressRow` has `type ('shipping'|'billing'|'both')`, `is_default`, `label?`, `first_name`, `last_name`, `company?`, `street_address`, `extended_address?`, `address_locality`, `address_region?`, `postal_code`, `address_country`, `phone_number?`, timestamps.

**Two-origin consequence for the plugin:** identity-read is on sil-api; token refresh (SC7) is on sil-web (`POST /api/v1/auth/refresh`). The plugin's `config.ts` resolves ONE origin (sil-web). sil_whoami needs a SECOND origin for sil-api (a new config key, e.g. `sil_api_base`/`SIL_API_BASE`, resolved the same pluginConfig→env→default way), unless deployment fronts both behind one gateway. Record the chosen assumption on the card.
