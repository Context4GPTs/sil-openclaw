---
name: catalog-tools-reference
description: Per-tool behaviour of the four core sil tools (register, whoami, search, product-get) and the shared status taxonomy. Load when driving any core catalog or identity tool.
---

# sil catalog + identity tools — per-tool behaviour and the shared status taxonomy

Load this when driving any of the four core tools — `sil_register`, `sil_whoami`,
`sil_search`, `sil_product_get`. The router names which tool an intent maps to; this
reference is what each does, plus the status taxonomy they all share. All four return a
single JSON body carrying a `status`; prices are in the currency's ISO 4217 minor unit.

## Per-tool behaviour

- **`sil_register`** starts browser-based registration: it returns promptly with
  `status: "awaiting_browser"` and an `auth_url` — share that URL. The plugin polls in
  the background; once the user signs in, call `sil_register` again to confirm (it
  reports `already_registered`).
- **`sil_whoami`** returns the registered user's identity (name + addresses). An expired
  token is refreshed transparently; a fully-dead session names the recovery
  (`sil_register`).
- **`sil_search`** returns a ranked list of purchasable variants (`id`, `title`,
  `price`, `availability`, `checkout_url`, `source`), best match first — present in
  order, do not re-rank. An empty list is a normal `ok` outcome, not an error. Use the
  returned `cursor` for the next page; its absence means no more results.
- **`sil_product_get`** is the lookup companion — pass ids you already hold and get the
  matching products back with fresh detail. Each variant carries an `inputs` list
  correlating it to the id(s) asked about (the response is not in request order). Ids
  that no longer resolve come back in a `not_found` list — a normal partial success.

## Status taxonomy (shared across the shopping tools)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | Success. Catalog results may be empty (`products: []`) or partial (`not_found: [...]`) — still a success. | Relay the data. |
| `not_registered` | No stored credentials. | Run `sil_register`, then retry the tool. |
| `must_reregister` | The session is dead (refresh rejected / 401). | Run `sil_register` to sign in again, then retry. |
| `forbidden` | Authenticated but not authorized (e.g. account not provisioned). | Follow the message; usually complete onboarding via `sil_register`. |
| `invalid_request` | The query/ids were rejected (e.g. empty input). | Fix the input and call again — do NOT re-register. |
| `retryable` | A transient network/5xx blip. | Try the same call again — do NOT re-register. |

On a non-`ok` status, say what happened and follow the tool's own `recovery` hint —
never improvise a different one (re-registering can't fix a bad query or a transient
5xx).
