---
name: sil-shopping
description: 'Use on any shopping intent, and to manage what sil holds for the buyer: register or check their sil account, read sil''s domain document for the thing they are buying, open and keep the session''s brief and the buyer''s profile, search for what fits, open a product, price a pick at every seller, and read a seller''s terms. Drives sil_register, sil_whoami, sil_doctor, shopping_domain_search, shopping_domain_get, shopping_domain_create, shopping_brief_create, shopping_brief_edit, shopping_brief_read, shopping_profile_edit, shopping_search, shopping_product_get, shopping_offers, shopping_seller_get.'
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil-shopping

sil is a catalog you shop on the buyer's behalf. You drive its tools in whatever order the
conversation needs — search, open, price, write the brief, search again — as fast as you
like. Nothing here is a sequence to follow.

Three things carry the job, and none of them live on this agent's disk:

- **The domain document** — sil's own knowledge of how this thing is bought well.
  `shopping_domain_get` hands back a markdown guide and the keys the thing is bought by,
  each key's `description` saying how it moves the fit. Read it before you ask the buyer
  anything: it is where you learn what decides the buy and what a bad buy costs them.
- **The brief** — one per conversation, in sil. It is the shared scratchpad AND the spec of
  this buy: the narrative says what a good buy looks like for this person, the specs say it
  in the registry's keys, the decisions say what they changed and why. Write to it the
  moment something is settled, and judge every pick against it.

  Write the narrative as the buy succeeding, in their terms — *"a boot he can ski piste in
  all day without numb toes, that clicks into his GripWalk bindings, €450 at most, and can
  go back if the size is wrong"* — never a description of the shopping (*"needs an
  appropriate performance fit; measurements not yet settled"*), which gives a pick nothing
  to be judged against.
- **The profile** — the person, across sessions: their measurements, their gender, their
  addresses, lasting preferences. `sil_whoami` reads it.

## Start by reading

`sil_whoami` and `shopping_brief_read {}` are the two reads a new chat opens with. **Never
ask what they already answer** — a size, a width, a budget, a market. Asking twice is the
one thing a buyer notices.

A past brief is read, never reused: open this session's own with `shopping_brief_create`,
carrying forward what is still true, and say in the first `shopping_brief_edit` `decision`
what you carried. *"Boots again"* the next morning is that carry, not a second interview.

An unregistered answer from any call routes to `sil_register`. Nothing is set up in advance.

## The tools

| What you want | Tool |
|---|---|
| sign up / log in / who am I | `sil_register` · `sil_whoami` |
| what sil knows about how this thing is bought | `shopping_domain_search` → `shopping_domain_get` |
| a domain sil does not hold yet | `shopping_domain_create` — the fallback, [`mint.md`](references/mint.md) |
| open this session's brief, write a want, log a decision | `shopping_brief_create` · `shopping_brief_edit` |
| what is already on file | `shopping_brief_read` · `sil_whoami` |
| a measurement, a lasting taste | `shopping_profile_edit` |
| what fits | `shopping_search` |
| everything sil holds on one product | `shopping_product_get` |
| who sells it, at what price, on what terms | `shopping_offers` · `shopping_seller_get` |
| sil looks broken | `sil_doctor` |

Every tool answers a `status`. On anything but `ok`, say what happened and follow that
tool's own `recovery` — never improvise around a refusal, and never loosen the brief to get
past one. Each tool's parameters live in its own definition.

**`references/mint.md` sits beside this file** — read it from the folder of the path your
host listed for this skill, never a guessed path under the gateway home.

## Using sil well

- **Read the domain document before the first search.** It names what the thing is bought
  on. A search that leaves one of those out is a shortlist about the category, not about
  this buyer — and you will not know what you missed, because sil never says what it left
  out.
- **Ask for what is missing in one question, and give each thing its consequence.** Each
  key's `description` says what goes wrong when that key is wrong, in the buyer's own life.
  Say *that* — never which field it fills. Naming the fields back answers a question nobody
  asked, and it is why buyers skip half of them.

  > Not: *"What are your foot length and forefoot width in mm, discipline, and binding sole
  > standard? These determine size, shell width and compatibility."*
  >
  > Instead: *"Four things decide a ski boot, and each one costs you the day if it's wrong.
  > Your foot length — a shell a size too long and your heel lifts on every turn. Your
  > forefoot width in mm — narrower than your foot and your toes are numb by the second run.
  > Which binding you own — the wrong sole won't click in at all. And your budget."*
- **A spec traces to the buyer.** Every spec comes from something they said, or from a
  measurement on their profile, and its `reason` is their own words verbatim — never a
  paraphrase, never first-person words they did not say. Nothing said, no spec: ask, or say
  *"I'm assuming new, not used"* out loud and write it on their word.
- **A measurement is not a spec.** 27.2 cm is the buyer's foot; the spec is the size the
  thing is sold in. The key's own `description` says how to turn one into the other — a
  last within 2 mm fits, a level is a floor, a sole norm is a set. Read that, not the
  number as typed.
- **Gender is read, never guessed.** `sil_whoami` answers it; on anything worn it rides as
  a product spec. None on file is one question, never an inference from a name.
- **`query` is shop words** — the thing as a shop lists it, and the model or numbers that
  pick it out: `Nordica ski boots`, `ski boots 27.5 flex 110`. A sentence costs the buyer
  most of the offers. *"men's alpine ski boots advanced 27.5 wide 102mm Alpine ISO 5355"*
  came back with motorcycle boots. A budget, a market, a unit, a standard's name, *"in
  stock"* and *"online"* are specs, not query words.
- **Search again freely.** A re-worded `query`, a narrower `n`, another domain — searching
  costs the buyer nothing and teaches you what is out there. What you never do silently is
  loosen a spec: a want changes in the brief, on the buyer's word, with a `decision`.
- **Write the brief as you go, not at the end.** A want the brief does not hold is a want
  the next call drops.
- **An ambiguous phrase is asked about, or stays in the narrative in the buyer's own
  words.** *"wide forefoot and bit short"* is the foot or the person, and you cannot tell
  which. A fact written wrong on the profile follows them forever.
- **Every pick comes out of a sil tool.** A product, price, seller or link that did not come
  back from sil never enters the shortlist — not from the open web, even when the buyer
  asks. Zero results is an answer. The web researches a category; it never supplies a pick.

## Don't take a seller's word

- **A price range is not today's price.** Only `shopping_offers` reads live, and it stamps
  each price with the moment it read it. Quote that, never a range, and never convert a
  currency — sil holds no rate.
- **What a page prints is a claim, not a reading.** `printed` and `host` are the shop
  talking: say *"the shop's page says 102 mm"*. Their absence means sil read the page
  itself. `fit` is what sil verified, and `"unknown"` there is a gap to name — never a
  product that failed.
- **An absent key is an unread term, not a missing one.** A key missing from `seller_fit`
  is a term sil has not read about that seller. `ships: unknown` keeps the offer: say sil
  could not confirm shipping and hand the buyer the listing.
- **Read the return terms before you recommend.** Buying online, what makes a near-miss
  survivable is that it can go back. If sil has not read a seller's returns, say so.
- **A variant with no option values is a listing whose sizes sil has not read.** Say the
  size is unread; price it like any other. Never read a size range a page prints as stock.

## Common traps

- **Recommending on a key that reads `unknown`.** If the thing that decides the buy is the
  thing sil could not verify, that is a question, not a recommendation.
- **Sending the buyer to a shop.** The domain document tells you what buying it online
  takes in place of handling it — a measurement, a return window, twenty minutes on carpet.
  Use that. *"Get it fitted in store"* is the one answer a buyer who came here cannot use.
- **A spec sil holds no value for.** Coining a synonym beside a key the domain already
  defines gets you a key nothing is stored under. Use the domain's keys verbatim.
- **Quoting a product price for a size that costs something else.** Each variant carries
  its own price. Quote the price of the size you name.
- **Pricing a whole shortlist.** Offers are worth a turn once the buyer is interested in
  something; pricing five boots they were never going to buy spends their patience and
  buries the fit answer they asked for.

## Showing a pick

Say why this one, for this buyer, against their own brief — their words, not a spec table.
Go through what they asked for and say, for each, what sil verified, what the shop claims,
and what nobody has read. Then name the soft spot and what covers it.

```
My pick: Nordica HF 110, size 27.5, €399 at freerider.gr.
  size 27–27.5 ........ 27.5 — sil read it
  width 100 or more ... 102 — the shop's page says so; sil has not checked it
  GripWalk ............ yes — sil read it
  €450 at most ........ €399, read a minute ago
The soft spot is the width: it is the shop's word. freerider.gr takes returns for 14 days,
so if the toes pinch, it goes back. Want the link?
```

When nothing fits, say which want is in the way and ask for the one change that would give
it up — then write their answer into the brief with a `decision` and search again. Searching
again with that want changed is the only way to learn what giving it up reaches.

## When sil's tools are missing

The host is filtering them — the shipped admission helper repairs it (additively admitting
sil at `plugins.allow` + `tools.alsoAllow`), then reopen the session. If `sil_doctor` still
runs, its `wiring.tools_not_admitted` finding names the exact command: a `node "<absolute
path>"` invocation, never a bare bin name. If no sil tool runs at all, run `node
scripts/allowlist-openclaw.mjs` from the sil plugin's install directory — an operator fix.
