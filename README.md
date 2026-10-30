```
███████╗██╗██╗
██╔════╝██║██║
███████╗██║██║
╚════██║██║██║
███████║██║███████╗
╚══════╝╚═╝╚══════╝

        Shop like you code
```

**The Shopping Interface Layer for personal AI agents.**

[![license](https://img.shields.io/badge/license-Apache--2.0-8a4b22)](https://github.com/Context4GPTs/sil-openclaw/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/sil-openclaw?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/sil-openclaw)
[![ClawHub](https://img.shields.io/badge/ClawHub-sil-6f42c1)](https://clawhub.com)
[![open beta](https://img.shields.io/badge/status-open%20beta-e09a68)](https://4gpts.com/en/sil)
[![last commit](https://img.shields.io/github/last-commit/Context4GPTs/sil-openclaw?color=9333ea)](https://github.com/Context4GPTs/sil-openclaw/commits/main)

**[Website](https://4gpts.com)** · **[Examples](./EXAMPLES.md)** · **[Changelog](./CHANGELOG.md)** · **[Security](./SECURITY.md)** · **[Follow on X](https://x.com/4gpts)**

---

## Install

```bash
openclaw plugins install clawhub:@4gpts/sil      # ClawHub (recommended)
openclaw plugins install sil-openclaw            # npm
openclaw plugins install /path/to/sil-openclaw   # local checkout
```

> [!TIP]
> Then tell your agent **register me on sil** (one browser sign-in, done) and ask for something:
> *"I'm getting into espresso. What grinder should I start with?"*
> The bundled skill takes it from there. More to try in [EXAMPLES.md](./EXAMPLES.md).

---

## Why an interface, not a search box

An agent that shops for you needs what a knowledgeable friend has: what decides the buy, the products as they are, the craft, the whole market, you, and the honesty to say "I don't know". A search engine gives it pages. A product feed gives it a shelf. SIL gives it the rest.

| Your agent needs | Search engine | Product feed | SIL |
|---|---|---|---|
| What decides the buy | — | — | the deciding specs of each kind of thing, with why |
| Product facts | pages to scrape, each shop's own words | the seller's fields | one record per product, same keys, one unit, read from the makers' and shops' own pages |
| The craft | ten links | — | guides with their author and source |
| The shops | whoever ranks, whoever paid | whoever joined | every shop SIL has read: price, delivery to you, returns, promotions, dated. Nobody pays to be first |
| You | an ad profile | — | your facts and rules, in your account, across agents, never pooled or trained on |
| What it doesn't know | filled in | silent | met · missed · unknown; "not carried" is an answer |
| A turn | fetch, parse, normalise, judge | read a shelf | a few typed, paged calls; seconds |

That is **Spec Driven Shopping**: you say what you need, the agent holds every product to it and tells you what meets it, what misses, and where nobody knows.

---

## What a turn looks like

Whatever you ask to buy, your agent:

1. **Knows you first.** Reads what SIL already keeps about you: country, currency, address, your facts and your rules. Nothing you've said is asked twice.
2. **Places the ask.** Finds the kind of thing you're buying and how it is bought: which specs decide it, and why. It asks you only what decides.
3. **Teaches while it asks.** Pulls the guide passage behind the trade-off, with its author and source, so you learn the thing as you buy it.
4. **Gets all the facts, and what's missing.** Searches with every want as a spec. Every product comes back held to your asks, and a blank stays a blank:

   ```diff
   + 1Zpresso K-Ultra   espresso and pour-over · 20 µm steps · 0.7 kg   meets all
   - 1Zpresso J-Ultra   espresso only · 8 µm steps · 0.67 kg            misses pour-over
   # 1Zpresso ZP6       pour-over only · 48 mm burrs                    step size unknown
   ```

5. **Shows the whole market.** For the pick, every shop SIL has read: price in its currency, delivery to your address, returns, the shop's own promotions, and the day it was read. Re-read before you buy.
6. **Says why.** At the shortlist, the pick and the offer: what you asked, what it remembered about you, and the mechanic of the thing you'd never have named.
7. **Keeps what matters.** A measurement, a rule, a brand you won't buy, a buy that takes days: kept in your SIL account for next time, on your word. *"Forget that"* undoes it.
8. **Hands you the shop's own page.** SIL has no checkout of its own. You buy where the shop sells.

**Sil Studio**, the screen beside your agent that shows what it found, is in closed beta: ask for a place with *Join the SIL beta* on [4gpts.com](https://4gpts.com/en/sil).

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
| `shopping_product_get` | Up to three products whole: the values their variants share, once; the page's description, pros and cons; reviews; and each variant with what sets it apart, the range its offers are priced over and its pictures. Pick the variants to buy here. |
| `shopping_offers` | Every offer of 1–10 picked variants: the shop by name, whether it ships to you, its delivery there, its returns window and its own promotions; the price in its own currency, a struck price, availability, a plan or bundle where it is one, the listing URL and the day sil read it. Shops reaching you first, cheapest first; nothing marks a best. A long list ends with `next_page` (`page` reads on). |
| `shopping_seller_get` | The shops whole, for 1–10 of them: the delivery, returns and promotions the offers carry, and warranty, every other term sil holds, policy links and reviews; `page` reads on. |

**The wire is a contract, not a convention.** Each shopping tool's input schema IS the
artifact under [`schema/`](./schema), copied verbatim from sil-services, and each answer
is the API's own 200 body handed over untouched.

---

## Skills

The plugin ships one bundled skill — **`sil-shopping`** 🛒 — that your agent loads automatically the first time you express a shopping intent. You don't invoke it; it's the playbook that makes the tools work well together:

- **Routes intent to the right tool.** *"find me a keyboard"* → `shopping_search`, *"what does it cost?"* → `shopping_offers`, *"what's the warranty?"* → `shopping_seller_get`, *"what was I shopping for?"* → `shopping_brief_read`, *"who am I?"* → `sil_whoami`, *"sign me up"* → `sil_register`.
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
