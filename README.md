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

So far your *general* agent did the shopping. Go one step further, with **nothing to set up**: install the plugin and the agent you already have shops **any** niche like a specialist, learning how to buy well in each one the first time you shop it and getting sharper every session.

**Spec-Driven Shopping (SDS).** There is no setup step and no interview — just say what you want. The first time you ask for something in a new niche the plugin **classifies** what you're buying, **researches that niche deeply on the spot** (the full how-to-buy-well: fit, gearing, geometry, the trade-offs — announced, so you can correct it), and derives the **dimensions** every request in that niche is decomposed along, minting a reusable **domain**. Ask for that niche again and it reuses what it learned; ask for a new one and it learns that too, keeping *you* the same across all of them. On **every query** it reads sil's shared registry for how that category is bought, decomposes what you asked, and **learns your facts and taste as it goes** (your measurements, your budget, a brand you won't touch) — captured once, never re-asked. It recommends with a "why" that cites *what you asked*, *a fact it remembered*, and *a niche mechanic you'd never have named*.

**It learns a niche the first time you shop it, and keeps *you* across all of them:**

```text
you    find me a road bike, ~€1500

agent  New niche for us — road cycling. Let me learn how to buy one
       well (fit from height AND inseam, endurance-vs-race geometry,
       gearing, the comfort/speed trade-offs) — and two numbers I'll
       keep so I never re-ask: your height and inseam.

you    178cm, 81cm inseam. Secondhand is fine

agent  searched sil — endurance, 54cm for your fit, ~€1500:

         1. Alloy endurance bike, 54cm, 105 (used)   €1420
         2. Carbon endurance bike, 54cm, 105 (used)  €1610

       Why #1: for your 178/81 fit a 54cm endurance frame sits where a
       first buyer wants it — and it honours your "free returns only"
       rule. Want detail or a link?

you    later — find me a backpacking tent for two, under €250

agent  Different niche — camping. Learning how to buy a backpacking
       tent (season rating, packed weight, floor area)… and your
       returns rule carries straight over, no need to re-ask.
```

> **You teach it once; it stays sharp.** How a category is bought comes from sil's shared registry — read before the web, so it is current without you teaching it twice — and your own facts, taste and shopping jobs belong to your sil account rather than to one agent. Nothing to re-answer, and sharper every session.

**What it keeps on your machine: nothing of yours.** The plugin stores your sil credentials and its own configuration under `$SIL_DATA_DIR` (owner-only `0600`) and nothing else — no notes about you, no shopping jobs, no measurements. A shopping call reads that credential, rewrites it when sil refreshes it, and deletes it when the session is past refreshing. What your agent learns about you lives in your sil account, is **never pooled across users**, and is never used for training or aggregation. Research reads public sources to learn how a *category* is bought; it does not upload anything about you. If an earlier version left a `shopper/` folder under that directory, nothing reads it any more and you can delete it.

---

## Tools

Fourteen tools. The eleven the shopping loop calls are named `shopping_*` — for what
they do for you — and the three account tools keep the `sil_` name. Your agent calls them
for you; you just say what you want.

**Your account**

| Tool | What it does |
|---|---|
| `sil_register` | Start a browser sign-in and link your agent to your sil identity. Takes no arguments. |
| `sil_whoami` | Read your sil identity — name, country, the currency you price in, saved addresses, and the measurements and preferences sil holds for you — as the agent sees it. Takes no arguments. |
| `sil_doctor` | Check the install: file modes, credential health, host wiring, and whether a newer plugin is published. Reports; repairs only what is safe. |

**Your brief and your profile**

| Tool | What it does |
|---|---|
| `shopping_brief_create` | Open the shopping job this conversation works from — a title and what you are after in your own words, plus any wants you have already stated. One brief per conversation, across every category it covers. |
| `shopping_brief_edit` | Write a want, a change of mind or the end of the job into that brief: the values you want under the category they belong to, the seller terms under `seller`, the keys you have given up, and one sentence saying what you changed and why. |
| `shopping_brief_read` | With no arguments, your shopping jobs, newest first — so a new chat carries on where the last one stopped. With an `id`, that whole brief: what you are after, every want under its category, and the decisions you have already taken. |
| `shopping_profile_edit` | Write what is true of you whatever you are buying: a measurement with its unit, a size as it is printed, a lasting taste in your own words, or the currency you price in. Writing the same name again replaces it; `sil_whoami` reads it all back. A new currency changes which offers come first, never a price: sil converts nothing. |

**Shopping**

| Tool | What it does |
|---|---|
| `shopping_domain_search` | Read sil's shared registry in your own words and get back the categories that match, each with a line on how the thing is bought. An empty list is the one answer that licenses a mint. |
| `shopping_domain_get` | Read one standing category: its buying guide, and every key it is bought by with the operators, unit and allowed values each takes. |
| `shopping_domain_create` | Coin a NEW category — its path, a guide written from research, and its first keys. The one permanent, global write in sil; an existing path is refused and nothing is written. |
| `shopping_search` | Search one settled category, under the brief this conversation is working from. Send the brief's id, the domain, your own shopping words, how many products you want, the brief's own values for that category as `specs`, and `ship_to` — the label of one of your saved addresses, which localizes the search (your default one when it is left off) and rules no seller out. Products come back best-first with `fit` (what sil verified), their variants, a price range, and `webpage_info` where sil has not read the page yet. |
| `shopping_product_get` | Open the whole of what sil holds on 1–10 shortlisted variants: the description, the images, every key sil holds, and where each reading came from and when. |
| `shopping_offers` | Price 1–10 picked variants live, on your own terms: send the brief's id and the variant ids, and sil reads the rest — the brief's `seller` terms and price ceiling, your default address and your currency. It looks on the web for shops it does not hold yet, and each offer comes back with the price exactly as the page prints it, its currency, availability, the listing URL, the moment sil read it, and `seller_fit` — whether that seller ships to your address (`serviceable`, `not_serviceable` or `unknown`) and what it holds for each term on the brief. Shops in your currency and market come first. |
| `shopping_seller_get` | One seller's whole terms, for 1–10 of them: `specs` (every seller key sil holds a value for), whether it ships to you, and the shipping routes and return terms sil has read. `unknown` keeps the seller; it just means sil has not read that policy. |

**The wire is a contract, not a convention.** Each shopping tool's input schema IS the
artifact under [`schema/`](./schema), copied verbatim from sil-services, and each answer
is the API's own 200 body handed over untouched.

---

## Skills

The plugin ships one bundled skill — **`sil-shopping`** 🛒 — that your agent loads automatically the first time you express a shopping intent. You don't invoke it; it's the playbook that makes the tools work well together:

- **Routes intent to the right tool.** *"find me a keyboard"* → `shopping_search`, *"what does it cost?"* → `shopping_offers`, *"will it reach me?"* → `shopping_seller_get`, *"what was I shopping for?"* → `shopping_brief_read`, *"who am I?"* → `sil_whoami`, *"sign me up"* → `sil_register`.
- **Many niches, minted on the fly, with no preparation.** A shopping intent runs the loop on whatever agent holds the plugin: it classifies what you're buying, reuses a niche it has already learned or **researches a new one on the spot** (announced, so you can correct it), and derives how to decompose every request — learning your facts and taste as it goes.
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
