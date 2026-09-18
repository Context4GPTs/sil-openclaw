---
name: steps
description: The three steps of the shopping loop — find the products that fit the brief's product specs and talk only fit, price the one pick the buyer is ready to buy and filter its sellers on the brief's seller specs, and when nothing fits, ask which spec the buyer will give up, then search again. Load on any shopping intent.
---

# The three steps

The brief is written first ([`brief.md`](brief.md)) and the category settled
([`category.md`](category.md)). Then: find, price, decide — and decide runs step 1 again.

## Step 1 — FIND: the products that fit the brief's product specs

`shopping_search` takes `brief` (the id, so sil links the search to the job), `domain`,
`query`, `n`, and `specs` — **all** of the brief's product specs under that category,
unchanged: the same keys, the same operators, the same values it holds, never a looser
bound and never a spec the brief does not hold. You write them yourself from the brief,
like flags on a command line; nothing compiles them for you, and a spec left out of a call
is a want the buyer has to state twice.

**The first search of a category waits for the deciding specs.** The guide from
`shopping_domain_get` says what the thing is bought on — for a ski boot, size, forefoot
width, sole norm and stiffness, plus the `gender` it is cut for — and every one of them is
in the brief before this call, from the profile or from one question that lists all that is
still missing at once. Two of those four shortlist a category, not a buyer.

**`query` is the shopping words**: the category as a shop lists it, then the model words and
the numbers that pick the product — `ski boots 27.5 flex 110` — never a sentence and never
the buyer's ask restated. A unit, a standard's name, a budget, a market, *"in stock"* and
*"online"* are specs, not words for the index: `men's alpine ski boots advanced 27.5 wide
102mm Alpine ISO 5355` came back with motorcycle boots, where the four shop words came back
with forty offers.

**`n` counts variants, at most 10** — one size, one option, each under the product that
carries it, each with its own `price`. Quote a price per size, never one price for a
product whose sizes are priced differently.

**At most 4 `shopping_search` calls per category before you ask the buyer** — four
between one decision of theirs and the next. Call 1 is the brief as it stands; a further
call re-words `query` for recall and never relaxes a spec, because a spec changes only
when the buyer says so — that is step 3. The bound is per category: a two-category brief
gets two fan-outs of up to four, and spending one category's budget on another is a
defect, not a trade.

**Then read what came back.** `fit` answers every product spec you asked, key by key: the
value sil holds, or *"unknown"* where it holds none — a gap you name and dig into, never a
reason to drop a product. `host` names the shop a cold product was read on and `printed`
carries that page's own labelled pairs, which are the page talking and not sil's reading; a
product with neither was read by sil itself. A variant with no option values is a listing
whose sizes sil has not read: it prices and opens on its id like any other.
`shopping_product_get` opens 1–10 shortlisted variants — the whole description, the images,
every key sil holds and where each reading came from. Order is the server's: report
best-first as returned, and never re-rank.

**This step says nothing about sellers.** No shipping, no country, no *"in Greece"* — until
the buyer has a pick, every turn is about whether the boot fits and what each candidate
trades away against the brief. Sellers are step 2, and step 2 is about the pick.

## Step 2 — PRICE: who sells the pick, and which sellers the brief will buy from

**`shopping_offers` is for the pick**, not for the shortlist: call it for the variant the
buyer has settled on, or the one they ask the price of, once fit is decided. Pricing every
candidate spends their turn on sellers for boots they were never going to buy, and the fit
answer they asked for arrives under six shipping caveats.

`shopping_offers` takes `brief`, 1–10 variant `ids`, and `seller_specs` — **all** of the
brief's seller specs, unchanged, and nothing else: a brief holding none sends none, and a
market the buyer never named is never one you read off the sellers you have just seen.
`ship_to` is an address label when the buyer named one, left out otherwise. A variant with
no option values is priced here like any other id — as its page prints it — so say the
size is unread and hand the buyer the listing anyway.

Each offer answers `seller_fit`, and your turn says **which sellers meet the brief and
which sil has not read**:

- a requested key **absent** from `seller_fit` is a term sil has not read — never a term
  that seller lacks, and never reported as a failed one;
- `country` absent is sil not having read where that seller is: say that, never a claim
  about where it ships from, and never a reason to drop the offer;
- `ships: unknown` keeps the offer — say sil could not confirm shipping and hand the buyer
  the listing; `not_serviceable` is a policy sil read that excludes the address.

`shopping_seller_get` reads 1–10 sellers' whole terms — `specs`, the shipping routes and
the returns — when an offer is close enough that the terms decide it.

## Step 3 — DECIDE: nothing fits, so ask which spec the buyer will give up

**Name the spec that stands in the way, ask for the ONE change that would give it up, and
wait.** Not a list of options, not a silent widening: *"nothing in 27.5 at 100 mm or wider
comes in under €350; the Hawx Ultra meets the rest at €390 — shall I raise the ceiling?"*
An answer that does not choose the change is not a yes: the brief stands as written, and
the buyer can redirect instead.

**sil never says what it left out**, so nothing tells you what giving a spec up would
reach — searching again with that spec changed is the only way to find out, and it is why
the ask goes to the buyer instead of a guess.

**On the buyer's word, write it and go again.** `shopping_brief_edit` carries the replacing
spec (or `remove` for a want they dropped) **and** a one-sentence `decision` saying what
changed and why — then step 1 runs again with the brief as it now stands. A spec relaxed
on the wire and not in the brief is a widening that dies with the turn.

**When something does fit**, lead with one recommendation and the *why* — a met spec, a
sentence from the guide, a fact sil already held — then one or two alternatives with a line
each, all of it about fit. `shopping_offers` on that pick, with the brief's seller specs, is
what puts a price under the recommendation: a recommendation with no dated price behind it
is a guess. The price is quoted with the size it belongs to and the moment sil read it,
whether that seller reaches the buyer is said, a bound sil could not test is said out loud,
a size sil has not read is said to be unread, and a number off a page sil has not read is
quoted as *"the seller's page says …"*.

A non-`ok` status is not an empty result: follow that tool's own `recovery` and never relax
the brief to route around it.
