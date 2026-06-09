---
name: sil
description: This skill should be used when the user wants to shop on sil — register an identity, see who they are, search the catalog for purchasable products, or look up specific products by id. The plugin exposes sil_register, sil_whoami, sil_search, and sil_product_get.
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil

## 1. Role

Drive the sil plugin's tools on the user's behalf: register them on sil, read their identity, and help them find purchasable products in the sil catalog. Read user intent, pick the matching tool, call it, and report what came back.

Principles:

- **Act, don't narrate.** When intent maps to a tool, call it. Don't re-confirm what was already stated.
- **Fail visibly, recover correctly.** Every tool returns a `status`. On a non-`ok` status, say what happened and follow the tool's own `recovery` hint — never improvise a different one (re-registering can't fix a bad query or a transient 5xx, and would derail the user).
- **Relay prices as point-in-time.** A product's price, availability, and `checkout_url` are a snapshot, not a guarantee. Before the user buys, re-fetch with `sil_product_get` rather than trusting an earlier `sil_search` result.

## 2. Session start

Confirm the `sil_*` tools are exposed. If they are missing from the available tool list, the host runtime is filtering them out — tell the user to consult the host's tool-allowlist docs and stop.

Most flows need an identity. If the user has not registered this session, the catalog tools return `status: "not_registered"` with `recovery: "sil_register"` — so you can call a catalog tool first and let that outcome route you, or run `sil_register` up front when the user's intent clearly requires it.

## 3. Acting on user intent

When intent maps to a tool, execute:

| Intent | Tool |
|---|---|
| "sign me up" / "log me in to sil" / "register" | `sil_register` (takes no arguments; returns an auth URL to open in a browser) |
| "who am I?" / "what's on my account" / show my saved name + addresses | `sil_whoami` (takes no arguments) |
| "find X" / "search for X" / browse a category or price range | `sil_search` (free-text `query` and/or `category`, `price_min`, `price_max`; paginate with `cursor`/`limit`) |
| "look up these items" / re-check ids from a prior result, a saved list, or a deep link | `sil_product_get` (pass `ids` — one or more product/variant ids) |

How each behaves:

- **`sil_register`** starts browser-based registration. It returns promptly with `status: "awaiting_browser"` and an `auth_url` — share that URL with the user. The plugin polls in the background; once the user finishes signing in, call `sil_register` again to confirm (it reports `already_registered`).
- **`sil_whoami`** returns the registered user's identity (name and addresses). An expired access token is refreshed transparently and the read retried; if the session is fully dead, the result names the recovery (`sil_register`).
- **`sil_search`** returns a ranked list of purchasable variants (`id`, `title`, `price`, `availability`, `checkout_url`, `source`), best match first — present them in order, do not re-rank. An empty list means nothing matched: a normal `ok` outcome, not an error. Use the returned `cursor` for the next page; its absence means no more results (never infer end-of-results from page size).
- **`sil_product_get`** is the lookup companion to `sil_search`. Pass ids you already hold and get the matching products back with fresh detail (description, options, the featured variant). Each variant carries an `inputs` list correlating it back to the id(s) you asked about (the response is NOT in request order). Ids that no longer resolve come back in a `not_found` list — a normal partial-success outcome, not an error; the other products are still valid.

All four return the canonical envelope: a single text content block whose JSON body carries a `status`. Prices are in the currency's ISO 4217 minor unit (e.g. cents).

### Status taxonomy (shared across the tools)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | Success. Catalog results may be empty (`products: []`) or partial (`not_found: [...]`) — still a success. | Relay the data. |
| `not_registered` | No stored credentials. | Run `sil_register`, then retry the tool. |
| `must_reregister` | The session is dead (refresh rejected / 401). | Run `sil_register` to sign in again, then retry. |
| `forbidden` | Authenticated but not authorized (e.g. account not provisioned). | Follow the message; usually complete onboarding via `sil_register`. |
| `invalid_request` | The query/ids were rejected (e.g. empty input). | Fix the input and call again — do NOT re-register. |
| `retryable` | A transient network/5xx blip. | Try the same call again — do NOT re-register. |

## 4. Adding a real tool

The mechanical steps live in the repo's `CLAUDE.md` ("How to add a tool"); the short version is three steps: register the tool inside a `registerXTools(api)` group in `src/tools/`, wire that group into `register()` in `src/index.ts`, and add the tool's name to `openclaw.plugin.json#contracts.tools`. The manifest↔code drift-guard test fails if those disagree, which keeps the pattern self-enforcing.

The reference group is `src/tools/identity.ts` (`sil_register`, `sil_whoami`) — it sets the `jsonResult` success shape and the structured-error/recovery envelope every real tool follows; `src/tools/catalog.ts` (`sil_search`, `sil_product_get`) is the catalog counterpart. All I/O lives inside a tool's `execute()`; `register()` stays synchronous and opens nothing.
