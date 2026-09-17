---
name: brief
description: GATHER, the writing half — the session's brief and the buyer's profile, both held in sil under their account. Every want the buyer states becomes a spec before the next search, every lasting fact about them goes to the profile, product specs and seller specs are told apart, and a decision is logged in the buyer's own words. Load on any shopping intent.
---

# GATHER — the brief and the profile, both held in sil

**One brief per session, never one per category.** Boots and a helmet asked in one
conversation share it: each category's product specs sit under its own domain path, and
the seller specs belong to the whole brief. `shopping_brief_create` opens it on the
buyer's first shopping message; `shopping_brief_edit` changes it; every `shopping_search`
and `shopping_offers` call names its `id` as `brief`, so sil links the call to the job it
serves. `shopping_brief_read { id }` answers `not_found` when sil listed the briefs on
this account and that id was not one of them.

**A spec is `key · op · value · currency? · reason?`** — the key and the operator from the
domain read, the value typed as that key types it, `currency` on money, and `reason`, the
buyer's **own words** behind it. That is the whole vocabulary: no spec outranks another
and none is dropped for a single call. You change what is asked by changing the brief, and
a change the buyer decided is logged as a `decision`.

**Write before you search.** Every want the buyer states is a spec in the brief **before**
the next search, and every lasting fact about them is on the profile before it too. A
search that runs on a want you have not written is a search the next session cannot
repeat.

## The buyer's own facts go to the profile

`shopping_profile_edit` holds what is true of the buyer whatever they are buying:
`measurements[]` — a number with its unit, or a size as it is printed — and
`preferences[]`, a lasting taste in their own words. `sil_whoami` reads them back, which
is why they are never asked twice.

**A measurement is the buyer's; the spec it becomes is the brief's.** The category's guide
is what converts one into the other: a 27.2 cm foot becomes `mondo_size in [27, 27.5]`
with `reason` *"length 27.2 cm"*, and the 27.2 cm itself stays on the profile, in
centimetres, for every category that ever needs it. This job's budget is not a fact about
the person — it is a spec.

## Product spec or seller spec — the line the whole loop turns on

- A **product spec** describes the thing: it is written under the category's own domain
  path and rides `shopping_search`. *"I don't want used"* is the product spec
  `condition eq new`; *"about 100 mm forefoot"* is `last_width gte 100`.
- A **seller spec** describes who you would buy from: it is written under
  `domain: "seller"` and rides `shopping_offers`, **never** the search, which ranks and
  filters no seller by where it is. *"Greece only"* is the seller spec
  `country in ["GR"]`, and it belongs to the whole brief rather than to one category.
- **`ship_to` is the label of an address on file** (as `sil_whoami` lists them): it
  localizes the search to that address and excludes no seller anywhere, so it is never a
  market filter and never where a *buy-in-Greece* want belongs — omit it and sil uses the
  buyer's default address.

## The narrative, and what no spec can carry

The brief's `narrative` is the job in the buyer's terms, **rewritten whole** every time the
picture sharpens — never a line appended under a line it contradicts. A want no spec can
carry (*"nothing that looks like a rental boot"*) stays in the narrative **and you say so
in the same turn**, so the buyer knows sil is not filtering on it and can rephrase it into
something a key holds.

## A decision is the buyer's word, in one sentence

`shopping_brief_edit` takes the replacing specs (or `remove`, for keys whose specs go) and
a one-sentence `decision` saying **what changed and why**, logged with the time:
*"Ceiling raised 350 → 400 EUR: nothing in 27.5 at 100 mm or wider under 350."* A
rejection is a decision too — *"not the Salomon"* is `brand nin ["Salomon"]` and the
sentence that says why — and where no key carries it, it is the narrative and the
`decision` alone.

## When sil refuses a write

sil checks every spec against the registry as it is written, so a write is `ok` or it is
`invalid_request` naming the key, with a spec on that key that would pass — money as a
decimal string with a currency, an operator the key lists, a value its type takes. Fix
that key from the example it handed you and resend the write — never drop the want, never
re-word it into something vaguer, and never carry on as if it had been written, because
the buyer's ask is what the next search is made of.

A key the domain does not hold is kept exactly as written — the brief holds it and the
search records it — so a want ahead of the registry is never the thing you drop.
