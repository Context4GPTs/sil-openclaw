---
id: sil-response-classification
title: Classify sil responses on body shape, not HTTP status (and never on res.ok)
tags: [sil-api, sil-web, http, classification, gotcha, false-green]
card: sil-whoami-tool
commit: c6b18f7
updated_at: 2026-06-08
updated_by_card: sil-identity-read-verb-fix
---

Every sil HTTP response is classified by a **pure, exported, unit-tested classifier** that branches on HTTP status **and, for `200`, the response body shape** — never on `res.ok`. This exists because sil returns semantically-distinct outcomes under the *same* HTTP status, so the status code alone is not enough to decide what happened.

The classifiers all live in `src/lib/sil-client.ts`: `classifyClaimResponse`, `classifyRefreshResponse`, `classifyIdentityResponse`. Each returns a discriminated union so the meaning is decided in one place and callers switch on `kind`.

## The two-200s traps (why body shape, not status)

1. **Claim: `200`-pending vs `200`-success.** `POST /api/v1/sessions/{id}/claim` returns HTTP `200` both while the browser leg is still in progress (`{status:"pending"}`) and when the tokens are ready (`{access_token, refresh_token, user}`). The discriminant is **the presence of both tokens in the body** (`classifyClaimResponse`, `sil-client.ts:136`) — *not* the status. A malformed/partial `200` falls to the **safe non-terminal** `pending`, never to a false `success` that would persist a non-credential as tokens.

2. **Identity: anti-false-green `200`.** The authenticated self-read is **`GET /identity`** (a bodyless GET — `fetchIdentity`, `sil-client.ts:270`), which returns HTTP `200` with the real `{name, addresses}` payload. The discriminant is the **non-empty `name`**: `extractIdentity` (`sil-client.ts:340`) requires a non-empty `name` string AND that `addresses` is an **array** (which **may be empty** — `addresses: []` is a real, authenticated identity for a user who onboarded a name but no address; see below). Any `200` that yields no usable `name` — sil-api's *enrich-stub* shape `{kind, verified, subject, attributes, note}` that `POST /identity` still returns (no name), or a partial/garbage `200` — classifies as `retryable`, **never `ok`**. This is the load-bearing guard: **the test suite cannot go green while `sil_whoami` reads the stub shape** — i.e. it cannot false-green while the product promise (real PII over the wire) is unmet. The verb is itself load-bearing: POST hits the enrich-stub (no name), GET hits the real self-read. See [[sil-api-identity-contract]].

## Why `res.ok` is banned

`res.ok` is true for the entire `2xx` range and tells you nothing about *which* `200` you got. Branching on it would conflate "keep polling" with "success" (claim) and "stub placeholder" with "real identity" (identity) — the two highest-risk subtle bugs in the flow. The classifier unit tests are **mutation-verified**: forcing `extractIdentity` to accept any `200` as `ok` (drop the non-empty-`name` and `Array.isArray` gates) turns **7 tests red** in `identity-classify.test.ts`, so the guard demonstrably bites rather than coincidentally passing.

## When you add a new sil call

Write a pure `classifyXResponse(status, body)` returning a discriminated union, export it, unit-test it in isolation (especially every `200` sub-case), and have the `fetchX` wrapper delegate to it. Map network errors / timeouts / aborts to the union's `retryable` variant — never let them throw past the wrapper.

## Empty-addresses: a valid identity, gated by `name` (resolved)

A real authenticated user with a valid `name` but **zero addresses** classifies **`ok`**, not `retryable`. `addresses` is a list that is legitimately empty for someone who has onboarded a name but not yet added an address; sil-api returns `addresses: []` for exactly that user (`handlers/identity.ts` → `buildIdentityReadResult`), and telling them "temporarily unavailable, try again" would strand them on a false transient they could never escape by retrying.

So `extractIdentity` (`sil-client.ts:340`) requires `name` to be a non-empty string and `addresses` to be an **array**, but **does not** require the array to be non-empty. The relax is surgical — it is *only* the empty array that newly passes: an **absent** or **non-array** `addresses` is still rejected (`Array.isArray(undefined) === false`), and a missing/empty `name` is still rejected. The `name` gate is what keeps the anti-false-green guard biting — the enrich-stub shape has no `name`, so it still → `retryable`. (This edge was deferred on [[sil-api-identity-contract]] while the real read was latent; it is now resolved — name + empty-addresses is a valid identity.)
