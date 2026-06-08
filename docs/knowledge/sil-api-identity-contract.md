---
id: sil-api-identity-contract
title: sil-api identity read — contract, request gotchas, and the latent cross-sibling dependency
tags: [sil-api, identity, jwt, contract, cross-sibling, blocked-on, e2e]
card: sil-whoami-tool
commit: a635103
updated_at: 2026-06-08
updated_by_card: sil-whoami-tool
---

The plugin codes `sil_whoami` against an **agreed but not-yet-live** sil-api identity-read contract: the live happy path (real PII over the wire) is **blocked on a sil-services follow-on**, while the entire plugin-side behavior is built and proven today against a mocked sil-api boundary.

## The contract the plugin consumes

`fetchIdentity` (`src/lib/sil-client.ts:260`) issues:

```
POST <sil_api_base>/identity          (bare path, NOT /api/v1 — that prefix is sil-web's)
Authorization: Bearer <stored access_token>
body: { agent_id: "sil-openclaw" }    (sil-api's SimplifiedAgentRequest)
```

Expected responses (classified by [[sil-response-classification]]):

| Status | Meaning | Plugin action |
|---|---|---|
| `200` UCP envelope `{ result: { name, addresses } }` | authenticated user's identity | unwrap `result`, return identity |
| `401` | access token expired/invalid | **refresh once via sil-web, retry once** (the only refresh trigger) |
| `403` `{error: user_not_provisioned}` | the human isn't onboarded | terminal; hint "complete onboarding / run sil_register" — **never refresh** |
| `403` `{error: principal_mismatch}` | our request bug (should not occur) | terminal distinct error — **never refresh** |
| `5xx` / network / abort | transient | retryable outcome |

## Non-obvious request gotchas (these bite if you get them wrong)

- **`agent_id` is required** (`SimplifiedAgentRequest`, 1..200 chars). A constant `AGENT_ID = "sil-openclaw"` (`sil-client.ts:67`) — this plugin *is* the agent. A per-deployment `sil_agent_id` config key is YAGNI until per-deployment identity is actually wanted.
- **OMIT `on_behalf_of`.** sil-api's JWT middleware returns `403 principal_mismatch` when a request body's `on_behalf_of` ≠ the token `sub`. By omitting it, the JWT `sub` *is* the principal — exactly whoami's contract ("the user this token resolves to"). Sending a mismatching `on_behalf_of` is a **guaranteed 403**.
- **401 is refreshable; 403 is not.** Refreshing a valid-but-unprovisioned token (403) changes nothing — only 401 (expired/invalid token) reaches the refresh path. Conflating "any 4xx → refresh" wastes a rotation and still fails.

## The latent cross-sibling dependency (single source of truth)

> sil-api's `/identity` is currently a **POST stub** (`services/sil-api/src/handlers/identity.ts`) returning `{kind, verified, subject, attributes, note}` — no name, no addresses, ignores `req.user`. The real `{name, addresses}` payload **does not exist yet**.

The sil-services **follow-on** must change **only the `result` payload** of the existing `POST /identity` (stub → real `{name, addresses}` derived from `req.user.name` + an addresses-by-`user.id` query — both already typed in `@sil/db` as `UserRow`/`AddressRow`). The verb/path/auth/envelope stay stable, so the plugin already codes against them. (If the follow-on instead introduces a `GET /me`, it's a one-line pivot in `fetchIdentity` + the mock — a known, cheap change, not a surprise.)

**Two things are blocked on this follow-on:**
1. The live `sil_whoami` happy path returning real PII (works today only against the mocked boundary).
2. The full cross-service **e2e** — owned by sil-stage's golden example (**goal SC9**): real PKCE → onboarding → claim → `sil_whoami` returns the user's real `{name, addresses}` against a live sil-api + Postgres. Not provable in this repo (no live sil-api/Postgres here); the strict [[sil-response-classification]] gate is what keeps the in-repo suite honest until then.

## Why this is safe to ship now

The hard part — the refresh choreography (read → 401 → refresh-once → retry-once, never loop) and the error taxonomy (401 vs 403 vs 5xx, terminal vs transient vs refreshable) — needs no live endpoint. It is fully specified and tested against the mocked contract, exactly as `sil_register`'s claim/refresh flow was proven against a mocked sil-web. Origin/auth details are in [[sil-two-origin-model]].
