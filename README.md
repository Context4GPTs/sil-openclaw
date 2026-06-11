```
███████╗██╗██╗
██╔════╝██║██║
███████╗██║██║
╚════██║██║██║
███████║██║███████╗
╚══════╝╚═╝╚══════╝

        commerce, handled by your agent
```

**The shopping layer your agent runs for you.**

*You say what you want. Your agent searches the catalog, compares, and hands you a ready-to-buy link.*
*No store. No tabs. No forms.*

[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-sil--openclaw-cb3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/sil-openclaw)
[![ClawHub](https://img.shields.io/badge/ClawHub-sil-6f42c1)](https://clawhub.com)
[![stars](https://img.shields.io/github/stars/Context4GPTs/sil-openclaw?color=f5b700)](https://github.com/Context4GPTs/sil-openclaw)
[![last commit](https://img.shields.io/github/last-commit/Context4GPTs/sil-openclaw?color=9333ea)](https://github.com/Context4GPTs/sil-openclaw/commits)

**[Website](https://4gpts.com)** · **[Changelog](./CHANGELOG.md)** · **[Security](./SECURITY.md)** · **[Follow on X](https://x.com/4gpts)**

---

## Install

`sil-openclaw` is the [OpenClaw](https://openclaw.ai) plugin for **sil**. One install and your agent can shop the sil catalog on your behalf.

```bash
# ClawHub (recommended)
openclaw plugins install clawhub:sil

# npm
openclaw plugins install sil-openclaw

# Local checkout (dev / e2e)
openclaw plugins install /path/to/sil-openclaw
```

### First run

Two lines and you're shopping:

```text
1. Tell your agent:  "register me on sil"          (one browser sign-in, done)
2. Tell your agent:  "find me a mechanical keyboard under $100"
```

The agent loads the bundled skill on first commerce intent and takes it from there — searching, comparing, pulling up product detail, and handing back ready-to-buy links.

---

## What sil is

**A commerce catalog built for agents, not browsers.** That's sil.

sil is a [UCP](https://github.com/universal-commerce-protocol/ucp) (Universal Commerce Protocol) commerce service. `sil-openclaw` wires it into your OpenClaw agent so it can hold a sil identity and shop the catalog for you — find products, compare prices and availability, pull up full detail, and surface a checkout link the moment you say *buy*. Powered by [4GPTs](https://4gpts.com).

Today it covers **identity and catalog** — registration plus search and product lookup. The rest of the UCP journey (cart, checkout, order, fulfillment) lands as those domains ship, and the same plugin grows with them.

---

## See it in action

**You, shopping through your agent — no store, no tabs:**

```text
you    find me a mechanical keyboard under $100, tactile switches

agent  searched the sil catalog — 3 strong matches:

         1. Keychron V3 (Brown)    $89   in stock
         2. NuPhy Air75 V2         $99   in stock
         3. Akko 3068B             $72   low stock

       want detail on any of these, or a checkout link?

you    tell me about the keychron

agent  Keychron V3 — QMK/VIA, hot-swappable, Brown tactile.
         options:   ABS / PBT keycaps · US / ISO layout
         featured:  PBT keycaps, US layout — $89, ships in 2 days
       → checkout:  sil.4gpts.com/c/kc-v3-pbt-us

you    perfect, send it

agent  done — here's your checkout link, ready to pay:
       sil.4gpts.com/c/kc-v3-pbt-us
```

> **You said three things. The agent did the shopping** — searched, compared, fetched the detail, and handed you a ready-to-buy link. No browser, no forms, no fourteen open tabs.

---

## How it works

sil lives at **two origins**, and the plugin talks to each for one job: **sil-web** is the auth authority (registration + token refresh); **sil-api** is the domain service (your identity and the catalog).

```
   you                    your agent (OpenClaw)               sil
  ─────                   ─────────────────────              ─────
  "register me     ──▶    sil_register          ──▶   sil-web   PKCE sign-in +
   on sil"                                                      token refresh
                                │  tokens.json (0600, on your disk)
                                ▼
  "find me a       ──▶    sil_search            ──▶   sil-api   catalog
   keyboard"              sil_product_get                       search + lookup
                                │
   ◀── ranked products · prices · availability · checkout links ──┘
```

Every tool returns the **same JSON envelope** — a `status` (`ok`, `not_registered`, `must_reregister`, `forbidden`, `invalid_request`, `retryable`) plus, on success, its payload — so your agent always knows whether to act, re-register, or retry. An expired access token is refreshed transparently against sil-web (one refresh, one retry); a confirmed-dead session clears your tokens and asks you to register again.

And **`register()` opens nothing** — no sockets, no timers, no background service. Every network and disk operation happens inside a tool call, so the plugin adds zero idle footprint to your host.

### Tool surface

Namespaced `sil_*` so they never collide with other plugins:

| Tool | What it does |
|---|---|
| `sil_register` | Start browser sign-in; returns an `auth_url`, polls in the background, stores credentials once you're done. |
| `sil_whoami` | Your identity (name, addresses), refreshing an expired token transparently. |
| `sil_search` | Ranked purchasable variants for a `query` / `category` / price range — each with `id`, `title`, `price`, `availability`, `checkout_url` — plus a pagination `cursor`. |
| `sil_product_get` | Resolve `ids: string[]` to full products in UCP shape (description, options, featured variant); misses come back in `not_found`. |

---

## Configuration

Optional, under `plugins.entries.sil.config` in `~/.openclaw/openclaw.json`. Resolution is **override → env → default**.

| Key | Env | Default | Origin |
|---|---|---|---|
| `sil_web_url` | `SIL_WEB_URL` | `https://sil.4gpts.com` | sil-web — auth (registration, refresh) |
| `sil_api_url` | `SIL_API_URL` | `https://sil-api.4gpts.com` | sil-api — identity + catalog |

If your host runs a restrictive tool profile (`coding`, `messaging`, `minimal`), let sil through and restart the gateway:

```json
{ "tools": { "profile": "coding", "alsoAllow": ["sil"] } }
```

Use `alsoAllow`, not `allow` — `allow` runs *after* the profile filter and can't rescue a tool the profile already removed. The default `full` profile needs no patch.

---

## Files on disk

```
$SIL_DATA_DIR/                 # default: $XDG_DATA_HOME/sil, else ~/.local/share/sil
├── tokens.json                # access + refresh token   (mode 0600)
└── config.json                # the registered user's identity
```

The PKCE verifier never touches disk — it lives only in memory for the length of a sign-in. Uninstalling the plugin never touches this directory; your data stays where you can see and delete it.

---

## Security

The plugin holds your tokens and talks to sil on your behalf — you shouldn't have to take that on faith.

- **`register()` opens nothing.** No sockets, no timers, no daemon. All I/O is inside a tool call — zero idle footprint.
- **PKCE, verifier in memory only.** Sign-in uses PKCE; the verifier is never written to disk. Tokens and identity PII are never logged.
- **Credentials at `$SIL_DATA_DIR`, mode 0600.** The registration poll timer is bounded — it stops on the first terminal outcome or the session deadline.
- **Two origins, nothing else.** sil-web (auth) and sil-api (identity + catalog). No inbound webhook, no public URL, no third-party beacons.
- **No `child_process`, no native modules, no install scripts.** A minimal, auditable surface.

> **Full policy:** [SECURITY.md](./SECURITY.md) · machine-readable disclosure in [`openclaw.plugin.json#security`](./openclaw.plugin.json). **Found an issue?** DM [@4gpts on X](https://x.com/4gpts).

---

## Developing

```bash
pnpm install
pnpm build       # pnpm clean && tsc → dist/
pnpm test        # vitest (unit + integration)
pnpm typecheck   # tsc --noEmit
```

Releasing is two steps: `pnpm version <patch|minor|major>` (bump → sync manifest → cut changelog → test → tag → push), then `pnpm release` (build → pack once → npm `sil-openclaw` + ClawHub `sil`, the **same** tarball to both). Full guide in [`CLAUDE.md`](./CLAUDE.md#releasing); release notes in [`CHANGELOG.md`](./CHANGELOG.md). Adding a tool is three steps, enforced by a drift-guard test — see [`CLAUDE.md`](./CLAUDE.md#how-to-add-a-tool).

---

**Built by [4GPTs](https://4gpts.com)** · Apache-2.0 · [@4gpts on X](https://x.com/4gpts)
