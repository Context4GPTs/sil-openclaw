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

Today the plugin covers **identity, catalog, and dedicated shopping experts**. The rest of the UCP journey (cart, checkout, order, fulfillment) lands as those domains ship, and the same plugin grows with them.

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

So far your *general* agent did the shopping. Go one step further: mint a **dedicated** OpenClaw agent that shops a single niche like a true specialist — it **researches how to buy well in that niche itself**, then fits *you* the way an expert would.

**Spec-Driven Shopping (SDS).** Say *"make me a shopping expert for road-cycling gear"* and the plugin runs a **light** interview (≤10 questions) to narrow the niche and shape the persona — then **researches the niche deeply on its own** (the full how-to-buy-well: fit, gearing, geometry, the trade-offs) and derives the **dimensions** every request should be decomposed along. Open it later and on **every query** it refreshes that knowledge from the web, decomposes what you asked, and **learns your facts and taste as it goes** (your measurements, your budget, the rules it must never break) — captured once, never re-asked. It recommends with a "why" that cites *what you asked*, *a fact it remembered*, and *a niche mechanic you'd never have named*. **Nothing is created until you say "create it"** — and building one is local and offline, no sign-in required.

**1 — One light conversation builds the expert (it does the deep research itself):**

```text
you    make me a shopping expert for road-cycling gear

agent  Love it — let's shape it lightly. A complete bike, or
       components and apparel?

you    a complete road bike, my first proper one

agent  Got it. I've researched how to buy a first road bike well —
       fit (size from height AND inseam, stack/reach, saddle setback),
       endurance-vs-race geometry, gearing theory, the comfort/speed
       trade-offs. I'll decompose every request along use-case, terrain,
       budget, your fit envelope, timeline, and priorities.

         Road-Cycling Buyer — a patient first-bike advisor
         · always explains fit · never carbon bars

       shall I create it?

you    yes, create it

agent  done — "Road-Cycling Buyer" is live. Open it anytime;
       it shops your niche with no further setup.
```

**2 — The expert shops like a specialist, learning you as it goes:**

```text
you    (inside Road-Cycling Buyer)  find me a road bike, ~€1500

agent  Before I search — two numbers I'll keep so I never re-ask:
       your height and inseam. Any brand you won't touch?

you    178cm, 81cm inseam. No strong feelings, secondhand is fine

agent  searched sil — endurance, 54cm for your fit, ~€1500:

         1. Alloy endurance bike, 54cm, 105 (used)   €1420
         2. Carbon endurance bike, 54cm, 105 (used)  €1610

       Why #1: for your 178/81 fit a 54cm endurance frame sits where a
       first buyer wants it — fit and comfort outrank outright speed on a
       first bike — and it's inside your budget. Want detail or a link?
```

> **You teach it once; it stays an expert.** It keeps your facts and taste, web-refreshes its niche knowledge each visit, and never re-asks what it already knows. List the experts you've made, look at how one is set up, retire one you're done with — or **refine** one from what it watched you reject, so it gets sharper every session.

**What it remembers, and where it lives.** A dedicated expert learns your shopping-relevant facts as it goes — measurements, budget band, the rules it must never break, brand likes/dislikes — captured **only when a request actually needs them** (never a big up-front form) so it doesn't re-ask. All of it is stored **locally on your machine** (`$SIL_DATA_DIR/agents/<id>/`, owner-only `0600`), **per-user and per-expert**. It is **never pooled across users and never sent to a server** for training or aggregation — creating and running an expert is local and offline. The niche web-refresh reads public sources to keep the *domain* knowledge current; it does not upload anything about you. Inspect exactly what an expert holds with `sil_profile_get`, and delete an expert and everything it remembered with `sil_profile_remove`.

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
| `sil_search` | Search for purchasable products. A free-text `query` plus optional filters: `category`, `price_min`/`price_max`, `ship_to` (delivery destination — leave empty to ship to your registered address), `condition` (`new` / `secondhand`), `available`, and `local_merchants` (best-effort bias toward shops in the user's own country). Results are **localized** to the shopper; when they ask for local shops you can *optionally* issue the `query` in that country's language to surface more of them (e.g. a French query surfaces French stores) — a tactic, not a requirement, and never an override of a language the user deliberately chose. Returns a ranked list of variants — each with `id`, `title`, `price`, `availability`, `checkout_url`, `source`, plus (where the source provides them) evaluate-before-buy detail: a product/variant `url` to view, a `description`, `media`, the product `options`, and the `seller`'s **shipping & return policy links** — and a pagination `cursor`. Location filters take ISO codes (`US`, `CA`), not place names. |
| `sil_product_get` | Resolve `ids` you already hold to full products in UCP shape — `description`, `options`, `media`, the `seller`'s shipping & return policy links, and the featured purchasable variant with fresh `price`, `availability`, `url` (the page to view), and `checkout_url` (the link that buys). Re-fetch right before buying; those values are point-in-time, not guarantees. Ids that no longer resolve come back in `not_found`. |

**Your shopper** — create one shopper, then manage the domains it learns

| Tool | What it does |
|---|---|
| `sil_profile_materialize` | Write your shopper's behaviour artefacts under `$SIL_DATA_DIR/agents/<id>/`. One tool, two modes: **create** your shopper (the shared, cross-niche `user_spec.md` + a `profile.json` manifest, no niche pack), or **mint/refresh a domain** the first time you shop a niche (that niche's `domain_spec.md` (deep researched niche expertise) + `intent_spec.md` (the decomposition-dimension schema) + `playbook.md` (your niche shopping taste), alongside the shared `user_spec.md`). (The persona is the agent's host workspace `SOUL.md`, not a sil artefact.) Validate-first and fail-closed; it never clobbers an existing domain, and a second shopper is refused. |
| `sil_profile_list` | List your shopper and the domains it has learned. Takes no arguments. |
| `sil_profile_get` | Show your shopper — the overview (`name`, the shared `userSpec`, the domain index), or one domain's `domainSpec` + `intentSpec` + `playbook` when you pass a `domainSlug`. |
| `sil_profile_remove` | Forget ONE domain — pass its `domainSlug`; your shopper, your shared facts, and every other domain survive. Scoped and idempotent; the agent confirms with you before removing. |

---

## Skills

The plugin ships one bundled skill — **`sil-shopping`** 🛒 — that your agent loads automatically the first time you express a shopping intent. You don't invoke it; it's the playbook that makes the tools work well together:

- **Routes intent to the right tool.** *"find me a keyboard"* → `sil_search`, *"look these up"* → `sil_product_get`, *"who am I?"* → `sil_whoami`, *"sign me up"* → `sil_register`, *"set up my shopper"* → the create flow, *"what does my shopper know / forget the grocery domain"* → the `sil_profile_*` tools.
- **One shopper, many niches — minted on the fly.** Asked to set up shopping, it runs a short two-touchpoint onboarding (how your shopper should behave + your cross-niche facts and hard rules) and creates **one** shopper — creating nothing until you explicitly endorse the draft. From then on it shops *any* niche: it classifies what you're buying, reuses a niche it has already learned or **researches a new one on the spot** (announced, so you can correct it), and derives how to decompose every request — learning your facts and taste as it goes.
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
