---
id: sil-api-identity-contract
title: sil-api identity read — GET /identity contract, request gotchas, and the deferred cross-service e2e
tags: [sil-api, identity, jwt, contract, cross-sibling, e2e]
card: sil-whoami-tool
commit: c6b18f7
updated_at: 2026-06-08
updated_by_card: sil-identity-read-verb-fix
---

The plugin reads `sil_whoami` against a **live, merged** sil-api identity-read contract: the real authenticated self-read (`GET /identity`, sil-api PR #7) returns the user's real `{name, addresses}`, and the entire plugin-side behavior is built and proven against a mocked sil-api boundary mirroring it.

## The contract the plugin consumes

`fetchIdentity` (`src/lib/sil-client.ts:270`) issues:

```
GET <sil_api_base>/identity           (bare path, NOT /api/v1 — that prefix is sil-web's)
Authorization: Bearer <stored access_token>
(no request body — the GET self-read derives its principal from the JWT `sub`)
```

Expected responses (classified by [[sil-response-classification]]):

| Status | Meaning | Plugin action |
|---|---|---|
| `200` UCP envelope `{ result: { name, addresses } }` | authenticated user's identity | unwrap `result`, return identity |
| `401` | access token expired/invalid | **refresh once via sil-web, retry once** (the only refresh trigger) |
| `403` `{error: user_not_provisioned}` | the human isn't onboarded | terminal; hint "complete onboarding / run sil_register" — **never refresh** |
| `403` `{error: principal_mismatch}` | structurally unreachable now (the bodyless GET sends no `on_behalf_of`); classifier still maps it | terminal distinct error — **never refresh** |
| `5xx` / network / abort | transient | retryable outcome |

## Non-obvious request gotchas (these bite if you get them wrong)

- **Send NO body on the GET.** The self-read derives its principal from the JWT `sub` (the Bearer header), not a request body — the route declares only a `response` schema (`handlers/identity.ts`). A GET body is at best ignored and in strict fetch environments throws, so `getJson` (`sil-client.ts:415`) sends no `content-type` and no body. This *eliminates* the `403 principal_mismatch` path entirely: with no body there is no `on_behalf_of` to mismatch the token `sub`, so the principal is unambiguously the token subject — exactly whoami's contract ("the user this token resolves to"). (The earlier POST-stub call sent `{ agent_id }`; that `AGENT_ID` constant is now removed.)
- **401 is refreshable; 403 is not.** Refreshing a valid-but-unprovisioned token (403) changes nothing — only 401 (expired/invalid token) reaches the refresh path. Conflating "any 4xx → refresh" wastes a rotation and still fails.

## The cross-sibling read — now live (the POST→GET pivot landed)

> sil-api's real authenticated self-read shipped as **`GET /identity`** (PR #7, `services/sil-api/src/handlers/identity.ts`): it derives the user from `req.user` (the JWT-decorated `UserRow`), loads their addresses, and returns `{ id, name, addresses }` enveloped under `result`. `POST /identity` stays the **agent enrich-stub** (`{kind, verified, subject, attributes, note}`, no name) — it serves the other domains' uniform shape, it was never the identity read.

This is exactly the pivot the `sil_whoami` card anticipated as "a one-line pivot in `fetchIdentity` + the mock if the follow-on introduces a `GET`." It has now happened: `fetchIdentity` (`sil-client.ts:270`) issues the bodyless GET, and the [[sil-response-classification]] gate moved with it (empty `addresses: []` is now a valid identity, gated by `name`). The plugin-side read is **no longer latent** — it codes against a merged contract.

**Still deferred — the cross-service e2e, NOT the plugin read:** the full cross-service **e2e** is owned by sil-stage's golden example (**goal SC9**): real PKCE → onboarding → claim → `sil_whoami` returns the user's real `{name, addresses}` against a live sil-api + Postgres. Not provable in this repo (no live sil-api/Postgres here); the strict [[sil-response-classification]] gate is what keeps the in-repo suite honest until then.

## Why this is safe to ship now

The hard part — the refresh choreography (read → 401 → refresh-once → retry-once, never loop) and the error taxonomy (401 vs 403 vs 5xx, terminal vs transient vs refreshable) — needs no live endpoint. It is fully specified and tested against the mocked contract, exactly as `sil_register`'s claim/refresh flow was proven against a mocked sil-web. Origin/auth details are in [[sil-two-origin-model]].
