---
name: brief
description: GATHER, the writing half — the session's brief and the buyer's profile, both held in sil under their account. This chat opens its own brief carrying what an earlier one still holds true, every want and everything the guide says decides the buy becomes a spec before the first search, every lasting fact about them goes to the profile, product specs and seller specs are told apart, and a decision records what the buyer changed. Load on any shopping intent.
---

# GATHER — the brief and the profile, both held in sil

**One brief per session, never one per category, and never an earlier session's.** Boots
and a helmet asked in one conversation share this chat's brief: each category's product
specs sit under its own domain path, and the seller specs belong to the whole brief.
`shopping_brief_create` opens it on the buyer's first shopping message; `shopping_brief_edit`
changes it; every `shopping_search` and `shopping_offers` call names its `id` as `brief`, so
sil links the call to the job it serves. An id that is not this buyer's answers `not_found`
— on the brief calls and on those two alike — and `shopping_brief_read` with no `id` lists
the briefs that are.

**A new chat reads the earlier briefs, then carries them into its own.** `shopping_brief_read`
is a read: it says what the buyer has already settled so you ask none of it again, and it is
never a brief you search on. Open this session's with `shopping_brief_create`, writing every
spec those reads hold that is still true, then send one `shopping_brief_edit` whose
`decision` names the carry — *"Carried size 27/27.5, last 102 mm and the two sole norms from
the 16 Sep boots brief; the trip and the budget are this session's own."* That sentence is
the only `decision` that is not a mind changed: it says where these specs came from, which a
`reason` quoting another session's words cannot.

**A spec is `key · op · value · currency? · reason?`** — the key and the operator from the
domain read, the value typed as that key types it, `currency` on money, and `reason`, the
buyer's **own words** behind it, quoted verbatim: *"I am advanced skier"*, *"I don't want
used"*, or the measurement the guide converted, *"length 27.2 cm"*. Never a paraphrase and
never first-person words they did not say, because that line is what the next session reads
to know what they actually asked for. A want they never stated gets no spec at all: ask, or
say the assumption out loud — *"I'm assuming new, not used"* — and write it on their answer.
That is the whole vocabulary: no spec outranks another and none is dropped for a single
call.

**Write before you search, and write all of it.** Every want the buyer states is a spec in
the brief **before** the next search, and every lasting fact about them is on the profile
before it too. Before the FIRST search of a category, everything the guide says the thing is
bought on carries a spec as well — for a ski boot, size, forefoot width, sole norm and
stiffness — taken from the profile, or asked in ONE question that lists all of them at once.
A search that runs on a want you have not written is a search the next session cannot
repeat; a search that runs before the buy is decided shortlists the wrong thing.

## The buyer's own facts go to the profile

`shopping_profile_edit` holds what is true of the buyer whatever they are buying:
`measurements[]` — a number with its unit, or a size as it is printed — and
`preferences[]`, a lasting taste in their own words. `sil_whoami` reads them back, along
with the `gender` sil holds, which is why they are never asked twice.

**Only what the buyer stated unambiguously about themselves reaches it.** *"wide forefoot
and bit short"* is the foot or the person and you cannot tell which: ask, or leave it in
the narrative in their own words until they settle it. A lasting fact written wrong follows
them into every category they ever shop. Every `name` is lower snake_case — `foot_length`,
never *"foot length"*, which the write refuses.

**A measurement is never the spec, and the guide's RULE is what maps it.** A 27.2 cm foot
becomes `mondo_size in [27, 27.5]` — the size the category is sold in — with `reason`
*"length 27.2 cm"*, and the 27.2 cm itself stays on the profile, in centimetres, for every
category that ever needs it. Map by what the guide says the number means, never by the
number as typed:

- **a width is a fit range, not a floor.** A 102 mm forefoot is `last_width gte 100`: a last
  two millimetres under the foot packs out, and `gte 102` throws away most of what fits.
- **a level is a floor.** *"advanced skier"* takes `skill_level` with `in`, naming their
  level and every level the domain read lists above it — or `nin` and the levels below,
  which is the same floor written from the other end. `eq` alone loses the stiffer boots
  built for exactly this buyer.
- **a standard is every norm the buyer's kit accepts.** *"Alpine binding"* is `sole_norm in
  ["alpine_iso5355", "gripwalk_iso23223"]`, because an alpine binding sold since 2018 mounts
  both — one norm alone is a different question from the one they asked.
- **what the buyer wears is `gender`**, from `sil_whoami` and in the domain's own spelling:
  `male` writes `gender eq mens`, `female` writes `gender eq womens`. No gender on file, or
  `other`, is asked once alongside the rest — never inferred from a name, a brand or a size.

Where the guide states no rule for a number the buyer gave, ask them what it should mean
rather than translating it literally: `foot_length eq 27.2` is a key no shop lists, and a
bound nothing was built to matches nothing. This job's budget is not a fact about the person
— it is a spec.

## Product spec or seller spec — the line the whole loop turns on

- A **product spec** describes the thing: it is written under the category's own domain
  path and rides `shopping_search`. *"I don't want used"* is the product spec
  `condition eq new`; *"about 100 mm forefoot"* is `last_width gte 100`.
- A **seller spec** describes who you would buy from: it is written under
  `domain: "seller"` and rides `shopping_offers`, **never** the search, which ranks and
  filters no seller by where it is. *"Greece only"* is the seller spec
  `country in ["GR"]`, and it belongs to the whole brief rather than to one category.
- **A seller spec is written when the buyer says it and read when the pick is priced.** It
  waits in the brief through every fit turn: who sells a candidate and where they ship is
  step 2's answer for the one pick, not a line under each name on a shortlist.
- **`ship_to` is the label of an address on file** (as `sil_whoami` lists them): it
  localizes the search to that address and excludes no seller anywhere, so it is never a
  market filter and never where a *buy-in-Greece* want belongs — leave it out and sil uses
  the buyer's default address, and never send a word like *"default"*, which is no label
  and is refused.

## The narrative, and what no spec can carry

The brief's `narrative` is the job in the buyer's terms, **rewritten whole** every time the
picture sharpens — never a line appended under a line it contradicts. A want no spec can
carry (*"nothing that looks like a rental boot"*) stays in the narrative **and you say so
in the same turn**, so the buyer knows sil is not filtering on it and can rephrase it into
something a key holds.

## A decision is the buyer's word, in one sentence

`shopping_brief_edit` takes the replacing specs (or `remove`, for keys whose specs go) and
a one-sentence `decision` saying **what changed and why**, logged with the time:
*"Ceiling raised 350 → 400 EUR: nothing in 27.5 at 100 mm or wider under 350."* It is
written **about the buyer, never in their voice** — *"I changed my budget so you can find
more"* is the agent wearing their words. It is written only where the buyer **changed their
mind**, or on the one carry above: an answer to a question you asked is not a change, a new
want is its spec's `reason` rather than a decision, and a list of what you have just written
down is not a decision either. A rejection is a decision too — *"not the Salomon"* is
`brand nin ["Salomon"]` and the sentence that says why — and where no key carries it, it is
the narrative and the `decision` alone.

## When sil refuses a write

sil checks every spec against the registry as it is written, so a write is `ok` or it is
`invalid_request` naming the key, with a spec on that key that would pass — money as a
decimal string with a currency, an operator the key lists, a value its type takes. Fix
that key from the example it handed you and resend the write — never drop the want, never
re-word it into something vaguer, and never carry on as if it had been written, because
the buyer's ask is what the next search is made of.

A key the domain does not hold is kept exactly as written — the brief holds it and the
search records it — so a want ahead of the registry is never the thing you drop.
