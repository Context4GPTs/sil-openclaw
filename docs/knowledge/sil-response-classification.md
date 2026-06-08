---
id: sil-response-classification
title: Classify sil responses on body shape, not HTTP status (and never on res.ok)
tags: [sil-api, sil-web, http, classification, gotcha, false-green]
card: sil-whoami-tool
commit: a635103
updated_at: 2026-06-08
updated_by_card: sil-whoami-tool
---

Every sil HTTP response is classified by a **pure, exported, unit-tested classifier** that branches on HTTP status **and, for `200`, the response body shape** — never on `res.ok`. This exists because sil returns semantically-distinct outcomes under the *same* HTTP status, so the status code alone is not enough to decide what happened.

The classifiers all live in `src/lib/sil-client.ts`: `classifyClaimResponse`, `classifyRefreshResponse`, `classifyIdentityResponse`. Each returns a discriminated union so the meaning is decided in one place and callers switch on `kind`.

## The two-200s traps (why body shape, not status)

1. **Claim: `200`-pending vs `200`-success.** `POST /api/v1/sessions/{id}/claim` returns HTTP `200` both while the browser leg is still in progress (`{status:"pending"}`) and when the tokens are ready (`{access_token, refresh_token, user}`). The discriminant is **the presence of both tokens in the body** (`classifyClaimResponse`, `sil-client.ts:136`) — *not* the status. A malformed/partial `200` falls to the **safe non-terminal** `pending`, never to a false `success` that would persist a non-credential as tokens.

2. **Identity: anti-false-green `200`.** `POST /identity` returns HTTP `200`, but the real `{name, addresses}` payload is **latent on a sil-services follow-on** — sil-api's `/identity` is still a stub returning `{kind, verified, subject, attributes, note}` (no name, no addresses). `extractIdentity` (`sil-client.ts:325`) requires **both** a non-empty `name` AND a non-empty `addresses` array; any `200` that yields no usable identity (the current stub shape, or a partial/garbage `200`) classifies as `retryable`, **never `ok`**. This is the load-bearing guard: **the test suite cannot go green while `sil_whoami` returns the stub shape** — i.e. it cannot false-green while the product promise (real PII over the wire) is unmet. See [[sil-api-identity-contract]].

## Why `res.ok` is banned

`res.ok` is true for the entire `2xx` range and tells you nothing about *which* `200` you got. Branching on it would conflate "keep polling" with "success" (claim) and "stub placeholder" with "real identity" (identity) — the two highest-risk subtle bugs in the flow. The classifier unit tests are **mutation-verified**: forcing `classifyIdentityResponse` to accept any `200` as `ok` turns exactly 6 tests red (`identity-classify.test.ts`), so the guard demonstrably bites rather than coincidentally passing.

## When you add a new sil call

Write a pure `classifyXResponse(status, body)` returning a discriminated union, export it, unit-test it in isolation (especially every `200` sub-case), and have the `fetchX` wrapper delegate to it. Map network errors / timeouts / aborts to the union's `retryable` variant — never let them throw past the wrapper.

## Known open edge (identity)

`extractIdentity` rejecting `addresses.length === 0` means a real authenticated user with a valid `name` but **zero addresses** currently classifies `retryable` ("temporarily unavailable") — a non-transient state mislabelled transient. This is **accepted for now**: no real user can reach it until the sil-api identity-read ships (the path is latent), and the acceptance criteria ("at least their name and addresses") never pinned the empty case. When the real read lands, the architect/PO decides whether name + empty-addresses is a valid identity; if yes, relax the `addresses.length === 0` reject in `extractIdentity` and add the test. Tracked in [[sil-api-identity-contract]].
