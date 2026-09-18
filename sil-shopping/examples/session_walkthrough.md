---
name: session-walkthrough
description: A worked run of one buyer's session — cold open, the category settled, one question for everything the guide says decides the buy, the first search only once the brief holds all of it, fit talked before any seller, the pick priced on its own, one spec the buyer is asked to give up, then the next morning's chat opening its own brief off the first and a second category joining it. Illustrative, not a spec.
---

# Worked run — one buyer, one brief per morning

Illustrative only; the rules live in the references. Nothing is set up first, and the
buyer is never asked anything sil already holds.

## *"I want to buy ski boots for my trip. I am an advanced skier."*

`sil_whoami` → registered, home address in Greece, `gender: "male"`, no measurements yet.
`shopping_brief_read {}` → `briefs: []`. So this is a cold open, and the agent says so in
one line rather than asking anything.

`shopping_domain_search { "q": "ski boots for an advanced skier" }` → `matches: []`. That
empty list is the licence: the agent researches how ski boots are bought, mints
`product.sports.winter.ski.boots` with `shopping_domain_create`, and reads it back with
`shopping_domain_get` — *"Bought on stiffness, forefoot width and binding compatibility"*,
over the keys `mondo_size`, `last_width`, `sole_norm`, `flex_index`, `skill_level` and the
root's `gender`.

That guide is the list of what has to be in the brief before the first search. The profile
answers `gender`; the buyer has answered their level; the other three are missing, so they
are **one** question, not three turns:

*"Before I search — three things decide the fit and I have none of them. Your foot length in
cm, your forefoot width at the widest point, and the binding you'll mount these to."*

## *"length 27.3 cm, forefoot 102 mm, Alpine bindings"*

Facts about the person, so they go to the profile — once, for every category that will
ever need them:

```
shopping_profile_edit
{ "measurements": [ { "name": "foot_length", "value": 27.3, "unit": "cm" },
                    { "name": "forefoot_width", "value": 102, "unit": "mm" } ] }
→ { "status": "ok" }
```

The guide maps them; the brief takes the specs, each carrying the buyer's words as its
`reason`. None of them is the measurement as typed: 27.3 cm is the size 27.5 is sold as, a
last two millimetres under the forefoot still packs out to it, *"Alpine bindings"* is every
sole norm an alpine binding takes, and *"advanced"* is a floor rather than a bracket.

```
shopping_brief_create
{ "title": "Ski boots",
  "narrative": "Advanced skier, 27.3 cm foot, 102 mm forefoot, alpine bindings. Fit decides before brand.",
  "domain": "product.sports.winter.ski.boots",
  "specs": [ { "key": "mondo_size",  "op": "in",  "value": [27, 27.5], "reason": "length 27.3 cm" },
             { "key": "last_width",  "op": "gte", "value": 100,        "reason": "forefoot 102 mm" },
             { "key": "sole_norm",   "op": "in",  "value": ["alpine_iso5355", "gripwalk_iso23223"], "reason": "Alpine bindings" },
             { "key": "skill_level", "op": "nin", "value": ["beginner", "intermediate"], "reason": "I am an advanced skier" },
             { "key": "gender",      "op": "eq",  "value": "mens",     "reason": "gender male on file" } ] }
→ { "status": "ok", "id": "b1" }
```

`last_width gte 102` would have been the measurement wearing a spec's clothes, and it throws
away most of the boots that fit; `sole_norm eq "alpine_iso5355"` would have answered a
question the buyer never asked, since the binding takes GripWalk too.

## Step 1 — FIND, and nothing but fit

```
shopping_search
{ "brief": "b1", "domain": "product.sports.winter.ski.boots",
  "query": "ski boots 27.5 flex 110", "n": 8,
  "specs": [ { "key": "mondo_size",  "op": "in",  "value": [27, 27.5] },
             { "key": "last_width",  "op": "gte", "value": 100 },
             { "key": "sole_norm",   "op": "in",  "value": ["alpine_iso5355", "gripwalk_iso23223"] },
             { "key": "skill_level", "op": "nin", "value": ["beginner", "intermediate"] },
             { "key": "gender",      "op": "eq",  "value": "mens" } ] }
```

Every product spec the brief holds for this category, the same five, typed as the domain
read types them. `query` is shop words: *"men's alpine ski boots advanced 27.5 wide 102mm
Alpine ISO 5355"* is the same ask written as a sentence, and the index answers it with
motorcycle boots.

Three boots come back in 27.5 — `v1`, `v6`, `v9`. The agent opens them with
`shopping_product_get` and reports **fit**: which last each one runs, what flex, which sole
norms, and where `fit` came back *"unknown"* so the buyer knows what sil could not confirm.
No seller, no shipping, no prices off a page — the buyer is choosing a boot, not a shop.

## *"Take the Nordica. I'm buying in Greece, up to 400 euros."*

Two wants, two domains, two writes — the budget is this job's, the market is the seller's:

```
shopping_brief_edit
{ "id": "b1", "domain": "product.sports.winter.ski.boots",
  "specs": [ { "key": "price", "op": "lte", "value": "400", "currency": "EUR", "reason": "up to 400 euros" } ] }

shopping_brief_edit
{ "id": "b1", "domain": "seller",
  "specs": [ { "key": "country", "op": "in", "value": ["GR"], "reason": "I'm buying in Greece" } ] }
```

## Step 2 — PRICE, the pick and only the pick

```
shopping_offers
{ "brief": "b1", "ids": ["v6"],
  "seller_specs": [ { "key": "country", "op": "in", "value": ["GR"] } ] }
```

One id, because one boot is being bought. Two offers come back: `seller_fit` carries no
`country` on either — sil has not read where they are — and one answers `ships: unknown`.
The agent says exactly that: €399 at freerider.gr as sil read it at 10:02Z, which the page
says cannot be bought now, and CAD 649.95 at a seller sil could not test against a euro
bound. Neither is dropped, and both listings go to the buyer.

## Step 3 — one change, then wait

Nothing under €400 can be bought today, so one spec and one question: *"At 27.5, 100 mm or
wider with an alpine-compatible sole, €400 is the one I cannot fill — raise it to €450?"*
Then it waits. An answer that does not choose the change is not a yes; on their word,
`shopping_brief_edit` writes the new ceiling with a one-sentence `decision` and step 1 runs
again. Tonight the buyer says nothing, and the chat ends with the brief as written.

## The next morning — *"Boots again."*

`sil_whoami` → the two measurements and the gender are still there.
`shopping_brief_read {}` → `b1`, newest first; `shopping_brief_read { "id": "b1" }` → the
whole brief. That is a read, not this chat's brief:

```
shopping_brief_create
{ "title": "Ski boots, day 2",
  "narrative": "Same boots job: advanced skier, 27.3 cm foot, 102 mm forefoot, alpine bindings, Greece, €400.",
  "domain": "product.sports.winter.ski.boots",
  "specs": [ { "key": "mondo_size",  "op": "in",  "value": [27, 27.5], "reason": "length 27.3 cm" },
             { "key": "last_width",  "op": "gte", "value": 100,        "reason": "forefoot 102 mm" },
             { "key": "sole_norm",   "op": "in",  "value": ["alpine_iso5355", "gripwalk_iso23223"], "reason": "Alpine bindings" },
             { "key": "skill_level", "op": "nin", "value": ["beginner", "intermediate"], "reason": "I am an advanced skier" },
             { "key": "gender",      "op": "eq",  "value": "mens",     "reason": "gender male on file" },
             { "key": "price",       "op": "lte", "value": "400", "currency": "EUR", "reason": "up to 400 euros" } ] }
→ { "status": "ok", "id": "b2" }

shopping_brief_edit
{ "id": "b2",
  "decision": "Carried size, last, sole norms, level, gender and the 400 EUR ceiling from brief b1 of 16 Sep; nothing in it was contradicted." }
```

The seller spec `country in ["GR"]` is written onto `b2` too, and the agent asks
**nothing**: not the size, not the width, not the binding, not the budget, not the market.
The first search of the morning runs on `b2`.

## *"A helmet."*

The same brief, a new domain. `shopping_domain_search { "q": "ski helmet" }` settles the
category, `shopping_domain_get` says what a helmet is bought on — and the one question
covers whatever of that the profile does not already answer:

```
shopping_brief_edit
{ "id": "b2", "domain": "product.sports.winter.ski.helmets",
  "specs": [ { "key": "head_circumference", "op": "in", "value": [57, 58], "reason": "hat size 57–58 cm" } ] }
```

The seller spec `country in ["GR"]` already stands for the whole of `b2`, so the helmet's
offers are filtered on it without writing it again — and a third brief is never opened for
a second thing in the same conversation.
