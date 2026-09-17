---
name: steps
description: The three steps of the shopping loop — find the products that fit the brief's product specs, price them and filter the sellers on the brief's seller specs, and when nothing fits, ask the buyer for the one change that would reach a product. Load on any shopping intent.
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

**`query` is the shopping words**: the category as a shop lists it, then the numbers that
pick the product — `ski boots 27.5 flex 110` — never a sentence and never the buyer's ask
restated. The budget, the ability and the trip are specs and narrative, not words for the
index.

**At most 4 `shopping_search` calls per category before you ask the buyer** — four
between one decision of theirs and the next. Call 1 is the brief as it stands; a further
call re-words `query` for recall and never relaxes a spec, because a spec changes only
when the buyer says so — that is step 3. The bound is per category: a two-category brief
gets two fan-outs of up to four, and spending one category's budget on another is a
defect, not a trade.

**Then read what came back.** `fit` carries the value sil holds for each product spec you
asked; a key absent from it is a gap you name, never a reason to drop a product.
`shopping_product_get` opens 1–10 shortlisted variants — the whole description, the images,
every key sil holds and where each reading came from. Order is the server's: report
best-first as returned, and never re-rank.

## Step 2 — PRICE: who sells them, and which sellers the brief will buy from

`shopping_offers` takes `brief`, 1–10 variant `ids`, and `seller_specs` — **all** of the
brief's seller specs, unchanged, and nothing else: a brief holding none sends none, and a
market the buyer never named is never one you read off the sellers you have just seen.
`ship_to` is an address label when the buyer named one, left out otherwise.

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

## Step 3 — DECIDE: nothing fits, so ask for the one change that reaches a product

**Name the spec that stands in the way, propose the ONE relaxation that reaches a product,
and wait.** Not a list of options, not a silent widening, and never a relaxation you have
not seen reach something: *"nothing in 27.5 at 100 mm or wider comes in under €350; the
Hawx Ultra meets the rest at €390 — shall I raise the ceiling?"* An answer that does not
choose the change is not a yes: the brief stands as written, and the buyer can redirect
instead.

**On the buyer's word, write it and go again.** `shopping_brief_edit` carries the replacing
spec (or `remove` for a want they dropped) **and** a one-sentence `decision` saying what
changed and why — then step 1 runs again with the brief as it now stands. A spec relaxed
on the wire and not in the brief is a widening that dies with the turn.

**When something does fit**, price it first: `shopping_offers` on the pick itself, with the
brief's seller specs, before you recommend anything — a recommendation with no dated price
behind it is a guess. Then lead with one recommendation and the *why* — a met spec, a
sentence from the guide, a fact sil already held — then one or two alternatives with a line
each. The price is quoted with the moment sil read it, whether that seller reaches the
buyer is said, a bound sil could not test is said out loud, and a number that came off a
page sil has not read is quoted as *"the seller's page says …"*.

A non-`ok` status is not an empty result: follow that tool's own `recovery` and never relax
the brief to route around it.
