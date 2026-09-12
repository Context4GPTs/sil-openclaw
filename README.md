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

So far your *general* agent did the shopping. Go one step further: create **one** persistent shopper that learns *you* once, then shops **any** niche like a specialist — it researches how to buy well in each niche the first time you shop it, and gets sharper every session.

**Spec-Driven Shopping (SDS).** Say *"set up my shopper"* and the plugin runs a **light** interview (≤10 questions) to shape how it should behave (the persona) and capture your **cross-niche** facts and the rules it must never break — and that's the whole setup. **No niche is researched up front.** From then on you just shop. The first time you ask for something in a new niche it **classifies** what you're buying, **researches that niche deeply on the spot** (the full how-to-buy-well: fit, gearing, geometry, the trade-offs — announced, so you can correct it), and derives the **dimensions** every request in that niche is decomposed along — minting a reusable **domain**. Ask for that niche again and it reuses what it learned; ask for a new one and it learns that too, keeping *you* the same across all of them. On **every query** it reads sil's shared registry for how that category is bought, decomposes what you asked, and **learns your facts and taste as it goes** (your measurements, your budget, a brand you won't touch) — captured once, never re-asked. It recommends with a "why" that cites *what you asked*, *a fact it remembered*, and *a niche mechanic you'd never have named*. **Nothing is created until you say so**, and a second shopper is refused — there is exactly one of you. Creating and running it is local and offline, no sign-in required.

**1 — One light conversation creates your shopper (no niche research yet):**

```text
you    set up my shopper

agent  Love it — let's shape it lightly. Should it shop patient and
       thorough, or fast and decisive? Anything it must always do,
       or never do?

you    thorough, and never recommend anything I can't return

agent  Got it — I'll keep your cross-niche rules (free returns only)
       and learn each niche the first time you shop it. Nothing to
       research up front.

         Your Shopper — a thorough, returns-first buyer
         · learns any niche on first shop · keeps your facts across all of them

       shall I create it?

you    yes, create it

agent  done — your shopper is live. Just tell it what you want;
       it learns the niche on the fly.
```

**2 — It learns a niche the first time you shop it, and keeps *you* across all of them:**

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

> **You teach it once; it stays sharp.** Your facts and taste live on one shopper document; each shopping job gets its own Brief. How a category is bought comes from sil's shared registry — read before the web, so it is current without you teaching it twice — and every pick, rejection and verdict you give it is written back to those documents. Nothing to re-answer, and sharper every session.

**What it remembers, and where it lives.** Your shopper learns your shopping-relevant facts as it goes — measurements, budget band, the rules it must never break, brand likes/dislikes — captured **only when a request actually needs them** (never a big up-front form) so it doesn't re-ask. All of it is stored **locally on your machine** (`$SIL_DATA_DIR/shopper/`, owner-only `0600`), **per-user (one shopper, one document per shopping job)**. It is **never pooled across users and never sent to a server** for training or aggregation — creating and running your shopper is local and offline. Research reads public sources to learn how a *category* is bought; it does not upload anything about you. Inspect exactly what your shopper holds with `shopping_doc_find` / `shopping_doc_read`, and forget a job it kept with `shopping_doc_remove`.

---

## Tools

Fourteen tools. The eleven the shopping loop calls are named `shopping_*` — for what they
do for you — and the three account tools keep the `sil_` name. Your agent calls them for
you; you just say what you want.

**Your account**

| Tool | What it does |
|---|---|
| `sil_register` | Start a browser sign-in and link your agent to your sil identity. Takes no arguments. |
| `sil_whoami` | Read your sil identity — name and saved addresses — as the agent sees it. Takes no arguments. |
| `sil_doctor` | Check the install: file modes, credential health, host wiring, and whether a newer plugin is published. Reports; repairs only what is safe. |

**Shopping**

| Tool | What it does |
|---|---|
| `shopping_domain_search` | Read sil's shared registry in your own words and get back the categories that match, each with a line on how the thing is bought. An empty list is the one answer that licenses a mint. |
| `shopping_domain_get` | Read one standing category: its buying guide, and every key it is bought by with the operators, unit and allowed values each takes. |
| `shopping_domain_create` | Coin a NEW category — its path, a guide written from research, and its first keys. The one permanent, global write in sil; an existing path is refused and nothing is written. |
| `shopping_search` | Search one settled category. Send the domain, your own words, how many products you want, and the values you want as `specs`. Products come back best-first with `fit` (what sil verified), their variants, a price range, and `webpage_info` where sil has not read the page yet. |
| `shopping_product_get` | Open the whole of what sil holds on 1–10 shortlisted variants: the description, the images, every key sil holds, and where each reading came from and when. |
| `shopping_offers` | Price 1–10 variants live: one entry per seller, each with the price exactly as the page prints it, its currency, availability, the listing URL and the moment sil read it. |
| `shopping_seller_get` | For 1–10 sellers, whether each ships to you — `serviceable`, `not_serviceable`, or `unknown` — plus the shipping routes and return terms sil has read. `unknown` keeps the seller; it just means sil has not read that policy. |

**Your shopper's documents** — two kinds, four verbs, all on your own disk

Everything the shopper knows lives in markdown under `$SIL_DATA_DIR/shopper/`: one
**shopper document** (`user_spec.md` — who you are) and one **Brief** per shopping job
(`briefs/<slug>.md` — what you want). A document is addressed by a `ref`: `"shopper"` or
`"brief:<slug>"`.

| Tool | What it does |
|---|---|
| `shopping_doc_find` | List what your shopper has, as **coordinates only** — ref, title, status, the job's items — never bodies. Filters by `kind`, `domain`, `status` and free text, all composable. |
| `shopping_doc_read` | Read ONE whole document body plus its frontmatter. A present-but-corrupt document answers `unreadable` and is repaired, never overwritten. |
| `shopping_doc_write` | Write ONE document — `body` is always the **whole** reconciled markdown, so a correction rewrites the line it changes instead of stacking a contradicting one. |
| `shopping_doc_remove` | Forget ONE Brief. Never a cascade, and the shopper document itself is not removable. |

**The wire is a contract, not a convention.** Each shopping tool's input schema IS the
artifact under [`schema/`](./schema), copied verbatim from sil-services, and each answer
is the API's own 200 body handed over untouched.

---

## Skills

The plugin ships one bundled skill — **`sil-shopping`** 🛒 — that your agent loads automatically the first time you express a shopping intent. You don't invoke it; it's the playbook that makes the tools work well together:

- **Routes intent to the right tool.** *"find me a keyboard"* → `shopping_search`, *"what does it cost?"* → `shopping_offers`, *"will it reach me?"* → `shopping_seller_get`, *"who am I?"* → `sil_whoami`, *"sign me up"* → `sil_register`, *"set up my shopper"* → the create flow, *"what does my shopper have / forget that job"* → the `shopping_doc_*` tools.
- **One shopper, many niches — minted on the fly.** Asked to set up shopping, it runs a short two-touchpoint onboarding (how your shopper should behave + your cross-niche facts and hard rules) and creates **one** shopper — creating nothing until you explicitly endorse the draft. From then on it shops *any* niche: it classifies what you're buying, reuses a niche it has already learned or **researches a new one on the spot** (announced, so you can correct it), and derives how to decompose every request — learning your facts and taste as it goes.
- **Recovers the right way.** Every tool reports a status; the skill follows that tool's own recovery hint — re-register, fix the query, or retry — instead of guessing a fix that won't work.
- **Keeps prices honest.** A price is dated only where sil dated it, so the skill re-reads an item's offers right before you buy and quotes the moment they were read.
- **Says what sil verified, and says the rest as what it is.** A key sil holds no value for is named as a gap, not passed off as a miss; a page sil has not read yet is quoted as the merchant's own words; a seller sil knows nothing about keeps its place.

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
