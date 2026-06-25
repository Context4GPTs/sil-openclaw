# sil catalog + identity tools — per-tool behaviour and the shared status taxonomy

Load this reference when driving any of the four core tools — `sil_register`,
`sil_whoami`, `sil_search`, `sil_product_get`. It holds how each tool behaves and
the status taxonomy every shopping tool shares. The router in `SKILL.md` names
which tool an intent maps to; this reference is what that tool actually does.

All four return the canonical envelope: a single text content block whose JSON
body carries a `status`. Prices are in the currency's ISO 4217 minor unit (e.g.
cents).

## How each tool behaves

- **`sil_register`** starts browser-based registration. It returns promptly with
  `status: "awaiting_browser"` and an `auth_url` — share that URL with the user.
  The plugin polls in the background; once the user finishes signing in, call
  `sil_register` again to confirm (it reports `already_registered`).
- **`sil_whoami`** returns the registered user's identity (name and addresses).
  An expired session token is refreshed transparently and the read retried; if the
  session is fully dead, the result names the recovery (`sil_register`).
- **`sil_search`** returns a ranked list of purchasable variants (`id`, `title`,
  `price`, `availability`, `checkout_url`, `source`), best match first — present
  them in order, do not re-rank. An empty list means nothing matched: a normal
  `ok` outcome, not an error. Use the returned `cursor` for the next page; its
  absence means no more results (never infer end-of-results from page size).
- **`sil_product_get`** is the lookup companion to `sil_search`. Pass ids already
  held and get the matching products back with fresh detail (description, options,
  the featured variant). Each variant carries an `inputs` list correlating it back
  to the id(s) asked about (the response is NOT in request order). Ids that no
  longer resolve come back in a `not_found` list — a normal partial-success
  outcome, not an error; the other products are still valid.

## Status taxonomy (shared across the shopping tools)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | Success. Catalog results may be empty (`products: []`) or partial (`not_found: [...]`) — still a success. | Relay the data. |
| `not_registered` | No stored credentials. | Run `sil_register`, then retry the tool. |
| `must_reregister` | The session is dead (refresh rejected / 401). | Run `sil_register` to sign in again, then retry. |
| `forbidden` | Authenticated but not authorized (e.g. account not provisioned). | Follow the message; usually complete onboarding via `sil_register`. |
| `invalid_request` | The query/ids were rejected (e.g. empty input). | Fix the input and call again — do NOT re-register. |
| `retryable` | A transient network/5xx blip. | Try the same call again — do NOT re-register. |

On a non-`ok` status, say what happened and follow the tool's own `recovery`
hint — never improvise a different one (re-registering can't fix a bad query or a
transient 5xx, and would derail the user).
