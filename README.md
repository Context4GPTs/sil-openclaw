# sil-openclaw

The OpenClaw plugin for **sil** — your agent registers a sil identity, then searches and looks up purchasable products in the sil commerce catalog on your behalf.

[![ClawHub](https://img.shields.io/badge/ClawHub-sil-6f42c1)](https://clawhub.com)
[![npm](https://img.shields.io/badge/npm-sil--openclaw-cb3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/sil-openclaw)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

---

## Install

```bash
# ClawHub (recommended)
openclaw plugins install clawhub:sil

# npm
openclaw plugins install sil-openclaw

# Local checkout (dev / e2e)
openclaw plugins install /path/to/sil-openclaw
```

Then tell your agent: ***"register me on sil"***. One browser sign-in, done.

From there, ***"find me a wireless keyboard under $80"*** or ***"look up product sku_123"*** is all the catalog needs.

---

## Host prerequisites

- **Node 22+** on the OpenClaw host (native `fetch` + Web Crypto).
- **Tool access.** If `tools.profile` is `coding`, `messaging`, or `minimal`, sil's tools get filtered out by the profile. Add this to `~/.openclaw/openclaw.json` and restart the gateway:

  ```json
  { "tools": { "profile": "coding", "alsoAllow": ["sil"] } }
  ```

  Use `alsoAllow`, not `allow` — the top-level `allow` runs after the profile filter and can't rescue tools the profile has already removed. The default `full` profile needs no patch.

---

## Config keys

Under `plugins.entries.sil.config` in `~/.openclaw/openclaw.json`. Both optional; resolution is **override → env → default**.

| Key | Env fallback | Default | Purpose |
|---|---|---|---|
| `sil_web_url` | `SIL_WEB_URL` | `https://sil.4gpts.com` | **sil-web** — the auth authority (registration, token refresh). |
| `sil_api_url` | `SIL_API_URL` | `https://sil-api.4gpts.com` | **sil-api** — the domain service (`sil_whoami` identity, `sil_search` / `sil_product_get` catalog). |

Override only for staging or self-hosted deployments.

---

## Files on disk

```
$SIL_DATA_DIR/                 # default: $XDG_DATA_HOME/sil, else ~/.local/share/sil
├── tokens.json                # access + refresh token   (mode 0600)
└── config.json                # the registered user's identity
```

The PKCE verifier used during registration lives **only in memory** — it is never written to disk. A confirmed-dead session clears `tokens.json`; uninstalling the plugin never touches this directory.

---

## Tool surface

Every tool is namespaced `sil_*` so it never collides with other plugins — your agent gets them all once the plugin is registered. Each returns a single JSON envelope carrying a `status` (`ok`, `not_registered`, `must_reregister`, `forbidden`, `invalid_request`, or `retryable`) and, on success, its payload. All I/O happens inside a tool's `execute()`; `register()` opens nothing.

#### Identity

- `sil_register` — start browser-based registration; returns an `auth_url` to open. The plugin polls in the background and stores credentials once sign-in completes.
- `sil_whoami` — the registered user's identity (name, addresses), transparently refreshing an expired access token (one refresh against sil-web, then one retry).

#### Catalog

- `sil_search` — a ranked list of purchasable variants for a `query` / `category` / `price_min` / `price_max`, with a pagination `cursor` and `limit`. Each result carries `id`, `title`, `price`, `availability`, `checkout_url`, and `source`.
- `sil_product_get` — resolve `ids: string[]` to full products in UCP shape (description, options, featured variant); each variant carries an `inputs` correlation, and unresolved ids come back in `not_found`.

---

## Bundled skill

The plugin ships an OpenClaw skill — an operational playbook your agent loads automatically when the user expresses commerce intent (register, search, look up, buy). No separate install; it's wired in via `skills: ["./skill"]` in `openclaw.plugin.json`.

| File | What it does |
|---|---|
| `skill/SKILL.md` | Runtime playbook — register → whoami → search → product lookup, the shared status envelope, and the re-register / token-refresh flows. |

---

## Security

OpenClaw-specific highlights — [`SECURITY.md`](./SECURITY.md) is the authoritative trust model, and `openclaw.plugin.json#security` is the machine-readable disclosure.

- **`register()` opens nothing** — no sockets, no timers, no long-lived service. Every network and disk operation lives inside a tool's `execute()`.
- **PKCE, verifier in memory only.** Registration uses PKCE; the verifier is never written to disk, and tokens and identity PII are never logged.
- **Credentials at `$SIL_DATA_DIR`, mode 0600.** The registration poll timer is bounded — it stops on the first terminal claim outcome or the session deadline.
- **No `child_process`, no native modules, no install scripts.** Two outbound origins only — sil-web (auth) and sil-api (identity + catalog). No inbound webhook, no public URL.

---

## Developing

```bash
pnpm install
pnpm build            # pnpm clean && tsc → dist/
pnpm test             # vitest (unit + integration)
pnpm typecheck        # tsc --noEmit
```

Releasing is two steps — `pnpm version <patch|minor|major>` (bump → sync manifest → cut changelog → test → tag → push), then `pnpm release` (build → pack once → npm `sil-openclaw` + ClawHub `sil`, the **same** tarball to both). See the [Releasing](./CLAUDE.md#releasing) guide and [`CHANGELOG.md`](./CHANGELOG.md). Build emits no `.d.ts` or source maps from plugin source.

---

## About sil

sil is a [UCP](https://github.com/universal-commerce-protocol/ucp) (Universal Commerce Protocol) commerce service. This plugin wires OpenClaw into sil so an agent can hold a sil identity and shop the catalog on its owner's behalf — identity and catalog today, the rest of the commerce journey (cart, checkout, order, fulfillment) as those domains land.
