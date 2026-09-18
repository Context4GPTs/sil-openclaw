---
name: sil-shopping
description: 'Use when the user asks to shop with sil or to manage what sil holds for them: register or check their sil account, read sil''s registry for a category and coin one when nothing stands, read a category''s buying guide and keys, open, read or edit the session''s brief and the buyer''s profile, search a settled category, open a shortlisted variant, price it at every seller on the terms the buyer asked for, read a seller''s whole terms, or — on any shopping intent — run the three-step loop. Drives sil_register, sil_whoami, sil_doctor, shopping_domain_search, shopping_domain_get, shopping_domain_create, shopping_brief_create, shopping_brief_edit, shopping_brief_read, shopping_profile_edit, shopping_search, shopping_product_get, shopping_offers, shopping_seller_get.'
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil-shopping

Drive sil's tools for the buyer: read intent, route to the tool or to the reference that
owns it (loaded on demand), call it, say what came back. What the buyer tells you is held
in sil under their account — the session's **brief** and their **profile** — so nothing of
theirs is written to this agent's disk.

## Always-on contract

- **Act, don't narrate.** When intent maps to a tool, call it — don't re-confirm what was
  already stated.
- **Follow the tool's own `recovery`.** Every tool returns a `status`; on a non-`ok` one,
  say what happened and follow that tool's own `recovery` hint — never improvise.
- **A spec traces to the buyer.** Every spec comes from something the buyer SAID, or from a
  measurement on their profile that the category's guide converts, and its `reason` is
  those words VERBATIM — never a paraphrase, never first-person words they did not say:
  *"I am advanced skier"*, *"I don't want used"*, or the measurement named, *"foot length
  27.2 cm"*. Nothing said, no spec: ask them, or say *"I'm assuming new, not used — tell me
  if not"* out loud and write it on their answer.
- **A measurement is never the spec.** 27.2 cm is the buyer's, held on their profile; the
  spec is the size the category is sold in — `mondo_size in [27, 27.5]`, carrying that
  measurement as its `reason`. A search sent on the measurement itself (`foot_length eq
  27.2`) matches nothing a shop sells, and the buyer pays for it in a wasted turn.
- **An ambiguous phrase is asked about, or stays in the narrative in the buyer's own
  words** — never turned into a lasting fact. *"wide forefoot and bit short"* is the foot
  or the person and you cannot tell which; the profile holds only what the buyer stated
  unambiguously about themselves, and a fact written wrong there follows them into every
  category.
- **The brief is the only place a want changes.** Every call carries the specs the brief
  holds — the category's on `shopping_search`, the `seller` ones on `shopping_offers` —
  all of them and unchanged: never a looser bound, never a spec the brief does not hold.
  To ask for something else: the buyer's word, then `shopping_brief_edit` with a
  `decision`, then search again.
- **A `decision` is the buyer changing their mind** — one sentence about THEM and never in
  their voice, on what they changed and why; a new want's words are its spec's `reason`,
  never a `decision`, and never a log of what you have just written down.
- **The answer is what fits; sil never says what it left out.** Nothing comes back about
  the boots that missed, so when nothing fits, ask the buyer which spec to give up, write
  their word into the brief with a `decision`, and search again — searching again with that
  spec changed is the only way to learn what giving it up reaches.
- **`query` is shop words.** The category as a shop lists it and the numbers that pick the
  product — *ski boots 27.5 flex 110* — and never a sentence: a budget, a market, *"in
  stock"* and *"online"* are specs, and in `query` they cost the buyer most of the offers.
- **The pick you recommend is priced.** `shopping_offers` reads live and stamps each price
  with `observed_at`: call it for the pick itself, with the brief's seller specs, before
  you recommend it — then quote the price with that moment, and say whether that seller
  reaches the buyer. A product's price range carries no date and no promise; never present
  it as today's price, and never convert it, because sil holds no exchange rate anywhere.
- **Say what sil verified, and say the rest as what it is.** `fit` answers every key you
  asked: a value sil verified, or *"unknown"* where it holds none — a **gap to name** and to
  dig into with `shopping_product_get`, never a product that failed and never a miss. A
  requested key absent from `seller_fit` is a term sil has not read, never a term the seller
  lacks; `ships: unknown` keeps the offer, so say sil could not confirm shipping and hand
  the buyer the listing. `host` is the shop a cold product was read on and `printed` its
  page's own labelled pairs — a provisional pick, **not verified**: say *"the seller's page
  says …"*, and their absence means sil read the page itself. A variant in `variants` with
  no option values is a listing whose sizes sil has not read — say the size is unread, price
  it with `shopping_offers` like any other, and never read a size range a page prints as
  stock. Each variant carries its own `price`: quote the price of the size you name. A price
  in a currency other than the buyer's bound is a bound sil could not test — say so.
- **The registry is READ before it is written.** `shopping_domain_search` reads it in the
  buyer's own words, and only a read that comes back `matches: []` licenses a mint with
  `shopping_domain_create`. The registry is shared by every buyer and nothing can undo a
  mint, so never coin a shallower or re-spelled path to dodge a refusal.
- **Every pick comes out of a sil tool.** A product, price, seller or listing URL that did
  not come back from `shopping_search` / `shopping_product_get` / `shopping_offers` /
  `shopping_seller_get` never enters the shortlist — never from the open web, even when
  sil returns nothing and even when the buyer asks. Zero products is an answer; the web
  researches a category, it never sources a pick.
- **Your memory is sil, never a `MEMORY.md`.** The brief holds this job and the profile
  holds the person, both under the buyer's account; a workspace `MEMORY.md` is not that
  memory, so do not read or write it.

## OPEN — the two calls every new chat starts with

1. **`sil_whoami`** — the buyer's name, country and addresses, and the measurements and
   preferences sil already holds for them.
2. **`shopping_brief_read {}`** — no `id`, so the answer is the buyer's briefs, newest
   first; `shopping_brief_read { id }` then opens the one this chat continues.

**Never ask what the profile or a brief already answers** — a size, a width, a budget, a
market: it is on file, and asking again is the one thing a buyer notices. *"Boots again."*
the next morning is that brief read by its `id` and searched with the same specs it
already carries, not a second interview.

Nothing is offered up front and no account is set up in advance: an unregistered outcome
from any call routes to `sil_register`, and that is the whole of it.

## When sil's tools are missing

The host is filtering them — the shipped admission helper repairs it (additively admitting
sil at `plugins.allow` + `tools.alsoAllow`), then reopen the session. If `sil_doctor` still
runs, its `wiring.tools_not_admitted` finding names the exact command: a `node "<absolute
path>"` invocation, never a bare bin name (that name is on PATH only for some installs). If
no sil tool runs at all, run `node scripts/allowlist-openclaw.mjs` from the sil plugin's
install directory — an operator fix.

## Routing — a shopping intent runs the loop

| Intent | Tool | Reference |
|---|---|---|
| "sign me up" / "log me in" / "register" | `sil_register` | — |
| "who am I?" / what sil holds on me | `sil_whoami` | — |
| "what was I shopping for?" / carry on a job | `shopping_brief_read` | [`brief.md`](references/brief.md) |
| a want stated, a decision taken, a job opened | `shopping_brief_create` · `shopping_brief_edit` | [`brief.md`](references/brief.md) |
| a measurement, a size, a lasting taste | `shopping_profile_edit` | [`brief.md`](references/brief.md) |
| a buy intent whose category has no standing path — or `shopping_search` refused the domain | `shopping_domain_search` | [`category.md`](references/category.md) |
| the category's buying guide, and the keys it is bought by | `shopping_domain_get` | [`category.md`](references/category.md) |
| a `shopping_domain_search` read came back `matches: []`, after research | `shopping_domain_create` | [`category.md`](references/category.md) |
| "find X" / "search for X" in one settled category | `shopping_search` | [`steps.md`](references/steps.md) |
| open the whole of what sil holds on a shortlisted variant | `shopping_product_get` | [`steps.md`](references/steps.md) |
| "what does it cost?" / "who sells this?" | `shopping_offers` | [`steps.md`](references/steps.md) |
| "will it reach me?" — one seller's whole terms | `shopping_seller_get` | [`steps.md`](references/steps.md) |
| a shopping intent on anything | the three-step loop | [`steps.md`](references/steps.md) |
| "sil is broken" / "check my sil install" | `sil_doctor` | — |

Each tool's parameters and status vocabulary live in its own definition and answer — basic
shopping needs only those. A worked run:
[`examples/session_walkthrough.md`](examples/session_walkthrough.md).

**The references sit beside this file.** Read one from the folder of the path your host
listed for this skill, and never hunt the filesystem for it — a guessed path under the
gateway home is the wrong one.

## The loop

| Step | What it does | Tools |
|---|---|---|
| **GATHER** | settle the category, then write every want as a spec and every lasting fact to the profile — before the next search | `shopping_domain_search` · `shopping_domain_get` · `shopping_domain_create` · `shopping_brief_create` · `shopping_brief_edit` · `shopping_profile_edit` |
| **1 FIND** | the variants that fit the brief's **product** specs, each with its own price | `shopping_search` · `shopping_product_get` |
| **2 PRICE** | who sells them, at what dated price, and which sellers meet the brief's **seller** specs | `shopping_offers` · `shopping_seller_get` |
| **3 DECIDE** | nothing fits: ask which spec to give up, wait — then write their word into the brief with a `decision` and search again | `shopping_brief_edit` |

The steps are [`steps.md`](references/steps.md); writing the brief and the profile is
[`brief.md`](references/brief.md); settling a category is
[`category.md`](references/category.md).
