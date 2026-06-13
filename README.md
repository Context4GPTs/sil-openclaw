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

sil is a [UCP](https://github.com/universal-commerce-protocol/ucp) (Universal Commerce Protocol) commerce service, and `sil-openclaw` wires it into your OpenClaw agent — so it can find products, compare prices and availability, pull up full detail, and surface a checkout link the moment you say *buy*. Powered by [4GPTs](https://4gpts.com).

Today the plugin covers **identity and catalog** — registration plus search and product lookup. The rest of the UCP journey (cart, checkout, order, fulfillment) lands as those domains ship, and the same plugin grows with them.

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

## Identity & authentication

**sil gives your agent an identity — and the capability to use it.** One browser sign-in links your OpenClaw agent to a sil identity it holds on your behalf — your name, your saved addresses. That identity is what lets the agent *transact*: it can search, compare, and surface checkout links with any merchant that speaks [UCP](https://github.com/universal-commerce-protocol/ucp) (the Universal Commerce Protocol), all under your account, without you ever touching a store login.

Registering is the only manual step. After that the agent carries your identity for you — ask *"who am I on sil?"* anytime to see exactly what it's holding.

---

## Tools

Namespaced `sil_*` so they never collide with other plugins. Your agent calls them for you — you just say what you want.

**Identity**

| Tool | What it does |
|---|---|
| `sil_register` | Start a browser sign-in and link your agent to your sil identity. Returns an `auth_url` to open; once you've signed in, the agent is registered and can transact. Takes no arguments. |
| `sil_whoami` | Read your sil identity — name and saved addresses — as the agent sees it. Takes no arguments. |

**Catalog**

| Tool | What it does |
|---|---|
| `sil_search` | Search for purchasable products. A free-text `query` plus optional filters: `category`, `price_min`/`price_max`, `ship_to` (delivery destination — leave empty to ship to your registered address), `condition` (`new` / `secondhand`), `available`, and `local_merchants` (best-effort bias toward shops in the user's own country — pair with a same-language query). Returns a ranked list of variants — each with `id`, `title`, `price`, `availability`, `checkout_url`, `source` — and a pagination `cursor`. Location filters take ISO codes (`US`, `CA`), not place names. |
| `sil_product_get` | Resolve `ids` you already hold to full products in UCP shape — description, options, and the featured purchasable variant with fresh `price`, `availability`, and `checkout_url`. Re-fetch right before buying; those values are point-in-time, not guarantees. Ids that no longer resolve come back in `not_found`. |

---

## Skills

The plugin ships one bundled skill — **`sil`** 🛒 — that your agent loads automatically the first time you express a shopping intent. You don't invoke it; it's the playbook that makes the four tools work well together:

- **Routes intent to the right tool.** *"find me a keyboard"* → `sil_search`, *"look these up"* → `sil_product_get`, *"who am I?"* → `sil_whoami`, *"sign me up"* → `sil_register`.
- **Recovers the right way.** Every tool reports a status; the skill follows that tool's own recovery hint — re-register, fix the query, or retry — instead of guessing a fix that won't work.
- **Keeps prices honest.** It treats price, availability, and checkout links as point-in-time and re-checks an item right before you buy, so the link you get is the link you pay.

Because the skill ships inside the plugin, installing the plugin installs the skill — there's nothing extra to set up.

---

## Security

The plugin holds your sil credentials and transacts on your behalf. The full disclosure — what it touches, what it stores, and how to report an issue — is in **[SECURITY.md](./SECURITY.md)**.

---

## Developing

```bash
pnpm install
pnpm build       # pnpm clean && tsc → dist/
pnpm test        # vitest (unit + integration)
pnpm typecheck   # tsc --noEmit
```

Releasing is two steps: `pnpm version <patch|minor|major>` (bump → sync manifest → cut changelog → test → tag → push), then `pnpm release` (build → pack → npm `sil-openclaw` + ClawHub `@4gpts/sil` — the same contents, re-packed under each registry's name). Full guide in [`CLAUDE.md`](./CLAUDE.md#releasing); release notes in [`CHANGELOG.md`](./CHANGELOG.md). Adding a tool is three steps, enforced by a drift-guard test — see [`CLAUDE.md`](./CLAUDE.md#how-to-add-a-tool).

---

**Built by [4GPTs](https://4gpts.com)** · Apache-2.0 · [@4gpts on X](https://x.com/4gpts)
