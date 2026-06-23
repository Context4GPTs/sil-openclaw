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

[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/Context4GPTs/sil-openclaw/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/sil-openclaw?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/sil-openclaw)
[![ClawHub](https://img.shields.io/badge/ClawHub-sil-6f42c1)](https://clawhub.com)
[![stars](https://img.shields.io/github/stars/Context4GPTs/sil-openclaw?color=f5b700)](https://github.com/Context4GPTs/sil-openclaw)
[![last commit](https://img.shields.io/github/last-commit/Context4GPTs/sil-openclaw?color=9333ea)](https://github.com/Context4GPTs/sil-openclaw/commits/main)

**[Website](https://4gpts.com)** · **[Changelog](https://github.com/Context4GPTs/sil-openclaw/blob/main/CHANGELOG.md)** · **[Security](https://github.com/Context4GPTs/sil-openclaw/blob/main/SECURITY.md)** · **[Follow on X](https://x.com/4gpts)**

---

## Install

`sil-openclaw` is the [OpenClaw](https://openclaw.ai) plugin for **sil**. One install and your agent can shop the sil catalog on your behalf.

```bash
# ClawHub (recommended)
openclaw plugins install clawhub:@4gpts/sil

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

Today the plugin covers **identity, catalog, and dedicated shopping experts** — registration, catalog search and product lookup, plus a one-conversation flow that mints a new OpenClaw agent pre-wired to shop a single niche for you. The rest of the UCP journey (cart, checkout, order, fulfillment) lands as those domains ship, and the same plugin grows with them.

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

## Turn your OpenClaw into a shopping expert

So far your *general* agent did the shopping. Go one step further: mint a **dedicated** OpenClaw agent that shops a single niche like a specialist — its taste, budget, and hard rules baked in once, then reused on every visit.

**TL;DR** — say *"make me a shopping expert for road-cycling gear"* and the plugin **interviews you** (the niche, your taste, your budget, the rules it must never break), then creates a real OpenClaw agent wired to sil with that persona and playbook. Open it later and it already knows your niche: it asks only what's still missing, searches sil with your constraints pre-set, and ranks results your way. **Nothing is created until you say "create it"** — and building one is local and offline, no sign-in required.

**1 — One conversation builds the expert:**

```text
you    make me a shopping expert for road-cycling gear

agent  Love it — let's shape it together. Components and apparel,
       or complete bikes too?

you    components and apparel, I've got the frame. ~€1200 budget,
       secondhand is fine, and I'm in France

agent  Here's the expert I'll build:

         Road-Cycling Buyer — a concise components advisor
         · always flags groupset compatibility · never carbon bars
         · searches secondhand to ~€1200, French shops first
         · ranks compatibility → value → weight

       shall I create it?

you    yes, create it

agent  done — "Road-Cycling Buyer" is live. Open it anytime;
       it shops your niche with no further setup.
```

**2 — The expert shops like a specialist, not a clerk:**

```text
you    (inside Road-Cycling Buyer)  I need new wheels

agent  what groupset are you running? — so I only show compatible builds

you    Shimano 105

agent  searched sil — secondhand, France-first, 105-compatible:

         1. Fulcrum Racing 4 (used)    €420   Shimano HG ✓ · 1560 g
         2. DT Swiss P1800 (used)      €505   Shimano HG ✓ · 1700 g

       ranked compatibility → value → weight, the way you set it up.
       want detail or a checkout link on either?
```

> **You teach it once; it stays an expert.** List the experts you've made, look at how one is set up, retire one you're done with — or **refine** one from what it watched you reject, so it gets sharper every session.

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
| `sil_search` | Search for purchasable products. A free-text `query` plus optional filters: `category`, `price_min`/`price_max`, `ship_to` (delivery destination — leave empty to ship to your registered address), `condition` (`new` / `secondhand`), `available`, and `local_merchants` (best-effort bias toward shops in the user's own country). Results are **localized** to the shopper — issue the `query` in their own language for the best local results (e.g. search in French for French stores). Returns a ranked list of variants — each with `id`, `title`, `price`, `availability`, `checkout_url`, `source`, plus (where the source provides them) evaluate-before-buy detail: a product/variant `url` to view, a `description`, `media`, the product `options`, and the `seller`'s **shipping & return policy links** — and a pagination `cursor`. Location filters take ISO codes (`US`, `CA`), not place names. |
| `sil_product_get` | Resolve `ids` you already hold to full products in UCP shape — `description`, `options`, `media`, the `seller`'s shipping & return policy links, and the featured purchasable variant with fresh `price`, `availability`, `url` (the page to view), and `checkout_url` (the link that buys). Re-fetch right before buying; those values are point-in-time, not guarantees. Ids that no longer resolve come back in `not_found`. |

**Experts** — create and manage dedicated shopping agents

| Tool | What it does |
|---|---|
| `sil_profile_materialize` | Persist a created expert's behaviour artefacts — `persona.md`, an optional `playbook.md` domain sub-skill, and a `profile.json` manifest — under `$SIL_DATA_DIR/agents/<id>/`. Driven by the skill's creation engine once you endorse the draft; validate-first and fail-closed, it never clobbers an existing expert. |
| `sil_profile_list` | List the experts you've created, most-recently-made first. Takes no arguments. |
| `sil_profile_get` | Show one expert in full — `name`, `persona`, optional `playbook`, manifest path, and `createdAt`. |
| `sil_profile_remove` | Delete one expert's behaviour artefacts. Scoped and idempotent; the agent confirms with you before removing. |

---

## Skills

The plugin ships one bundled skill — **`sil`** 🛒 — that your agent loads automatically the first time you express a shopping intent. You don't invoke it; it's the playbook that makes the tools work well together:

- **Routes intent to the right tool.** *"find me a keyboard"* → `sil_search`, *"look these up"* → `sil_product_get`, *"who am I?"* → `sil_whoami`, *"sign me up"* → `sil_register`, *"make me an expert for X"* → the create flow, *"list / show / remove my experts"* → the `sil_profile_*` tools.
- **Interviews before it builds.** Asked for a shopping expert, it runs an open interview to shape the niche, persona, and rules *with* you — and creates nothing until you explicitly endorse the assembled draft.
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

Releasing is two steps: `pnpm version <patch|minor|major>` (bump → sync manifest → cut changelog → test → tag → push), then `pnpm release` (build → pack → npm `sil-openclaw` + ClawHub `@4gpts/sil` — the same contents, re-packed under each registry's name). Release notes in [`CHANGELOG.md`](https://github.com/Context4GPTs/sil-openclaw/blob/main/CHANGELOG.md). Adding a tool is three steps, enforced by a drift-guard test.

---

**Built by [4GPTs](https://4gpts.com)** · Apache-2.0 · [@4gpts on X](https://x.com/4gpts)
