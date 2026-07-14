---
name: catalog-tools-reference
description: Per-tool behaviour of the four core sil tools (register, whoami, search, product-get) and the shared status taxonomy. Load when driving any core catalog or identity tool.
---

# sil catalog + identity tools — per-tool behaviour and the shared status taxonomy

The router names which tool an intent maps to; this covers what each does plus the status
taxonomy they all share. All four return a single JSON body with a `status`; prices are in the
currency's ISO 4217 minor unit.

## Per-tool behaviour

- **`sil_register`** starts browser registration: returns promptly with
  `status: "awaiting_browser"` + an `auth_url` — share it. The plugin polls in the background;
  once the user signs in, call `sil_register` again to confirm (→ `already_registered`).
- **`sil_whoami`** returns the registered identity (name + addresses). An expired token
  refreshes transparently; a dead session names the recovery (`sil_register`).
- **`sil_search`** returns a ranked list of purchasable variants (`id`, `title`, `price`,
  `availability`, `checkout_url`, `source`), best first — present in order, don't re-rank. An
  empty list is a normal `ok`. Use the returned `cursor` for the next page; its absence means
  no more results.
- **`sil_product_get`** — pass ids you already hold, get the matching products with fresh
  detail. Each variant carries an `inputs` list correlating it to the id(s) asked about (not in
  request order). Unresolvable ids come back in `not_found` — a normal partial success.

## Status taxonomy (shared across the shopping tools)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | Success. Results may be empty (`products: []`) or partial (`not_found: [...]`) — still success. | Relay the data. |
| `not_registered` | No stored credentials. | Run `sil_register`, then retry. |
| `must_reregister` | Session dead (refresh rejected / 401). | Run `sil_register`, then retry. |
| `forbidden` | Authenticated but not authorized (e.g. account not provisioned). | Follow the message; usually complete onboarding via `sil_register`. |
| `invalid_request` | Query/ids rejected (e.g. empty input). | Fix the input and call again — do NOT re-register. |
| `retryable` | A transient network/5xx blip. | Retry the same call — do NOT re-register. |

On a non-`ok` status, say what happened and follow the tool's own `recovery` hint — never
improvise a different one (re-registering can't fix a bad query or a transient 5xx).
</content>
