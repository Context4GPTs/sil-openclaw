```
███████╗██╗██╗
██╔════╝██║██║
███████╗██║██║
╚════██║██║██║
███████║██║███████╗
╚══════╝╚═╝╚══════╝

        Shop like you code
```

**The shopping layer your agent runs for you.**

*Introducing Spec Driven Shopping: the way Agents should be shopping.*

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

Today the plugin covers **identity, catalog, and a personal multi-domain shopper**. The rest of the UCP journey (cart, checkout, order, fulfillment) lands as those domains ship, and the same plugin grows with them.

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

## Turn your OpenClaw into your personal shopping expert

So far your *general* agent did the shopping. Go one step further, with **nothing to set up**: install the plugin and the agent you already have shops **any** niche like a specialist, getting sharper about *you* every session.

**Spec-Driven Shopping (SDS).** There is no setup step and no interview — just say what you want. The plugin finds the node in sil's **domain graph** for what you're buying and reads the **specs** it is bought along (fit, gearing, geometry, the trade-offs) — what every request there is decomposed into. It decomposes what you asked, **learns your facts and taste as it goes** (your measurements, your budget, a brand you won't touch) — captured once, never re-asked — and recommends with a "why" that cites *what you asked*, *a fact it remembered*, and *a niche mechanic you'd never have named*.

**Every niche reads sil's own node, and keeps *you* across all of them:**

```text
you    find me a road bike, ~€1500

agent  [shopping_domain_search "road bike" → shopping_domain_get]
       Road bikes are bought on fit from height AND inseam, endurance
       vs race geometry, and gearing. Two numbers I'll keep so I never
       re-ask: your height and inseam.

you    178cm, 81cm inseam. Secondhand is fine

agent  searched sil — endurance, 54cm for your fit, ~€1500:

         1. Alloy endurance bike, 54cm, 105 (used)   €1420
         2. Carbon endurance bike, 54cm, 105 (used)  €1610

       Why #1: for your 178/81 fit a 54cm endurance frame sits where a
       first buyer wants it — and it honours your "free returns only"
       rule. Want detail or a link?

you    later — find me a backpacking tent for two, under €250

agent  [shopping_domain_search "backpacking tent" → shopping_domain_get]
       Tents are bought on season rating, packed weight and floor
       area… and your returns rule carries straight over.
```

> **You teach it once; it stays sharp.** How a thing is bought comes from sil's domain graph, the same for every agent, and your own facts, taste and shopping jobs belong to your sil account rather than to one agent. Nothing to re-answer, and sharper every session.

**What it keeps on your machine: nothing of yours.** The plugin stores your sil credentials and its own configuration under `$SIL_DATA_DIR` (owner-only `0600`) and nothing else — no notes about you, no shopping jobs, no measurements. A shopping call reads that credential, rewrites it when sil refreshes it, and deletes it when the session is past refreshing. What your agent learns about you lives in your sil account, is **never pooled across users**, and is never used for training or aggregation. If an earlier version left a `shopper/` folder under that directory, nothing reads it any more and you can delete it.

---

## Tools

Fifteen tools. The twelve the shopping loop calls are named `shopping_*` — for what
they do for you — and the three account tools keep the `sil_` name. Your agent calls them
for you; you just say what you want.

**Your account**

| Tool | What it does |
|---|---|
| `sil_register` | Start a browser sign-in and link your agent to your sil identity. Takes no arguments. |
| `sil_whoami` | Read your sil identity — name, country, the currency you price in, language, gender and your default address — as the agent sees it. Takes no arguments. |
| `sil_doctor` | Check the install: file modes, credential health, host wiring, and whether a newer plugin is published. Reports; repairs only what is safe. |

**What sil keeps about you, and your briefs**

| Tool | What it does |
|---|---|
| `shopping_user_read` | Everything sil keeps about you — measurements, memories, preferences, purchases — each with what it gives you back. |
| `shopping_user_remember` | Keep what lasts, in the turn you say it, with "forget that" as the undo. |
| `shopping_user_forget` | Erase rows you name, or everything, on your word. |
| `shopping_brief_write` | Open a brief for a buy with requirements, or update one: a title, what you are after in your own words, specs by domain, decisions and the end of the job. |
| `shopping_brief_read` | With no arguments, your shopping jobs, newest first. With an `id`, that whole brief. |

**Shopping**

| Tool | What it does |
|---|---|
| `shopping_domain_search` | Say what the thing is called, in English, and get back up to three leaves (buyable kinds of thing), each its `path` and `name`. Empty when sil holds no such leaf. |
| `shopping_content` | The passages sil holds that bear on what you said, read on the line through a place — the place, its kinds, beneath it and above it — by words, within a token budget. Each is one shape: kind, title, author, text, url, date. |
| `shopping_domain_get` | How to search a leaf, or the kind above its leaves: send what you want and a word for each spec you are after, and get the place's `name` and one line per spec a search takes — `spec`, `type`, `unit`, `values`, `operators`, and on a spec that decides the buy `decides` with its `why` — the `reached` lines your words reach first, then the most held, a page at a time (`page` reads on). A shelf or domain is refused as `not_a_leaf`; an area sil does not carry yet as `not_carried`. |
| `shopping_search` | Search a leaf, or the kind above its leaves, on every want settled — specs, a `price` range, words only for what no spec holds. Answers the ask numbered (`asked`), how many products and shops were weighed and how many hold every ask (`search_stats`), and product cards in sil's order: title, brand, up to five pictures, `holds` · `misses` · `unknown` as ask numbers, the price range, how many shops sell it, and its variants with one `recommended`. Money is an integer in the currency's minor unit: €130 is 13000. |
| `shopping_product_get` | Up to three products whole: the values their variants share, once; the page's description, pros and cons; reviews; and each variant with what sets it apart, its starting price and its pictures. Pick the variants to buy here. |
| `shopping_offers` | Every offer of 1–10 picked variants: the shop (and whether it ships to you), the price in its own currency, a struck price, availability, a plan or bundle where it is one, the listing URL and the day sil read it. Shops reaching you first, cheapest first; nothing marks a best. A long list ends with `next_page` (`page` reads on). |
| `shopping_seller_get` | The shops' terms, for 1–10 of them: delivery to you (cost, free over, days), returns, warranty, promotions as the shop prints them, every other term sil holds, policy links and reviews; `page` reads on. |

**The wire is a contract, not a convention.** Each shopping tool's input schema IS the
artifact under [`schema/`](./schema), copied verbatim from sil-services, and each answer
is the API's own 200 body handed over untouched.

---

## Skills

The plugin ships one bundled skill — **`sil-shopping`** 🛒 — that your agent loads automatically the first time you express a shopping intent. You don't invoke it; it's the playbook that makes the tools work well together:

- **Routes intent to the right tool.** *"find me a keyboard"* → `shopping_search`, *"what does it cost?"* → `shopping_offers`, *"will it reach me?"* → `shopping_seller_get`, *"what was I shopping for?"* → `shopping_brief_read`, *"who am I?"* → `sil_whoami`, *"sign me up"* → `sil_register`.
- **Many niches, with no preparation.** A shopping intent runs the loop on whatever agent holds the plugin: it finds the place sil shelves what you're buying (`shopping_domain_search`), reads the specs it is bought along (`shopping_domain_get`), and decomposes every request along them — learning your facts and taste as it goes.
- **Recovers the right way.** Every tool reports a status; the skill follows that tool's own recovery hint — re-register, fix the query, or retry — instead of guessing a fix that won't work.
- **Keeps prices honest.** A price is dated only where sil dated it, so the skill re-reads an item's offers right before you buy and quotes the moment they were read.
- **Says what sil verified, and says the rest as what it is.** A key sil holds no value for is named as a gap, not passed off as a miss; a page sil has not read yet is quoted as the seller's own words; a seller sil knows nothing about keeps its place.

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

Releasing is two steps: `pnpm version <patch|minor|major>` (bump → sync manifest → cut changelog → test → tag → push), then `pnpm release` (build → pack → **stage** on npm as `sil-openclaw` → a maintainer approves it with 2FA under npmjs.com's Staged Packages → the same contents to ClawHub as `@4gpts/sil`, only once npm serves them byte-identical). Staged publishing needs no 2FA-bypass token, which npm is retiring from publishing. Release notes in [`CHANGELOG.md`](https://github.com/Context4GPTs/sil-openclaw/blob/main/CHANGELOG.md). Adding a tool is three steps, enforced by a drift-guard test.

---

**Built by [4GPTs](https://4gpts.com)** · Apache-2.0 · [@4gpts on X](https://x.com/4gpts)
