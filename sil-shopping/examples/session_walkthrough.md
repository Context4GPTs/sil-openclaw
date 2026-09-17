---
name: session-walkthrough
description: A worked run of one buyer's session — cold open, the category settled, every want written as a spec before the first search, offers filtered on the brief's seller specs, one relaxation proposed and waited for, then the next morning's session reusing the same brief and a second category joining it. Illustrative, not a spec.
---

# Worked run — one buyer, one brief, two mornings

Illustrative only; the rules live in the references. Nothing is set up first, and the
buyer is never asked anything sil already holds.

## *"I want to buy a ski boot. I am advanced skier with wide forefoot and bit short."*

`sil_whoami` → registered, home address in Greece, no measurements yet.
`shopping_brief_read {}` → `briefs: []`. So this is a cold open, and the agent says so in
one line rather than asking anything.

`shopping_domain_search { "q": "ski boots for an advanced skier with a wide forefoot" }` →
`matches: []`. That empty list is the licence: the agent researches how ski boots are
bought, mints `product.sports.winter.ski.boots` with `shopping_domain_create`, and reads
it back with `shopping_domain_get` — Mondopoint length, last width, flex index, model
year, discipline, and the seller terms the category is bought with.

```
shopping_brief_create
{ "title": "Ski boots",
  "narrative": "Advanced skier, short wide foot. Fit decides before brand.",
  "domain": "product.sports.winter.ski.boots",
  "specs": [ { "key": "skill_level", "op": "eq", "value": "advanced", "reason": "I am advanced skier" } ] }
→ { "status": "ok", "id": "b1" }
```

`skill_level` is a key this domain does not hold. It is written anyway: the brief keeps it
and the search records it. *Wide* and *bit short* are not numbers yet, so the agent asks
for the two the guide says decide the fit — foot length and forefoot width.

## *"length 27.2 cm, forefoot 101 mm, for sneakers I wear a US 9 size"*

Facts about the person, so they go to the profile — once, for every category that will
ever need them:

```
shopping_profile_edit
{ "measurements": [ { "name": "foot_length", "value": 27.2, "unit": "cm" },
                    { "name": "forefoot_width", "value": 101, "unit": "mm" },
                    { "name": "shoe_size_us", "value": 9 } ] }
→ { "status": "ok" }
```

The guide converts them, and the brief takes the specs — each carrying the measurement as
its `reason`:

```
shopping_brief_edit
{ "id": "b1", "domain": "product.sports.winter.ski.boots",
  "specs": [ { "key": "mondo_size", "op": "in",  "value": [27, 27.5], "reason": "length 27.2 cm" },
             { "key": "last_width", "op": "gte", "value": 100, "reason": "forefoot 101 mm" } ] }
```

## *"I want to buy online. Give me options that I can buy in Greece only. Also my top of the budget range is 350 euros. I don't want used."*

Three wants, two domains, two writes — and the narrative rewritten whole:

```
shopping_brief_edit
{ "id": "b1", "domain": "product.sports.winter.ski.boots",
  "narrative": "Advanced skier, short wide foot. Buying online, new only, from Greece. Fit decides before brand.",
  "specs": [ { "key": "price", "op": "lte", "value": "350", "currency": "EUR", "reason": "my top of the budget range is 350 euros" },
             { "key": "condition", "op": "eq", "value": "new", "reason": "I don't want used" } ] }

shopping_brief_edit
{ "id": "b1", "domain": "seller",
  "specs": [ { "key": "country", "op": "in", "value": ["GR"], "reason": "options that I can buy in Greece only" } ] }
```

*Greece only* is a **seller** spec. It rides the offers, not the search — and `ship_to` is
left off entirely, because the buyer's home address is already the default one.

## Step 1, then step 2

```
shopping_search
{ "brief": "b1", "domain": "product.sports.winter.ski.boots",
  "query": "ski boots 27.5 flex 110", "n": 8,
  "specs": [ { "key": "mondo_size", "op": "in",  "value": [27, 27.5] },
             { "key": "last_width", "op": "gte", "value": 100 },
             { "key": "skill_level", "op": "eq", "value": "advanced" },
             { "key": "price",      "op": "lte", "value": "350", "currency": "EUR" },
             { "key": "condition",  "op": "eq",  "value": "new" } ] }
```

Every product spec the brief holds for this category, the same ones, typed as the domain
read types them — `price` a decimal string with its currency. Two products come back in
27.5; the agent opens both with `shopping_product_get`, then prices them:

```
shopping_offers
{ "brief": "b1", "ids": ["v1", "v6"],
  "seller_specs": [ { "key": "country", "op": "in", "value": ["GR"] } ] }
```

Both offers answer `seller_fit` with no `country` — sil has not read where either seller
is — and one is `ships: unknown`. The agent says exactly that: two listings, neither
confirmed as a Greek seller, one at $939.95 that sil could not test against a euro bound.

## Step 3 — one change, then wait

*"In 27.5 at 100 mm or wider, nothing sil can confirm comes in under €350 — the Hawx Ultra
is the only one meeting the rest. Raise the ceiling to €400?"* Then it waits.

## *"Actually, 400 euros."*

```
shopping_brief_edit
{ "id": "b1", "domain": "product.sports.winter.ski.boots",
  "specs": [ { "key": "price", "op": "lte", "value": "400", "currency": "EUR", "reason": "Actually, 400 euros." } ],
  "decision": "Ceiling raised 350 → 400 EUR: nothing in 27.5 at 100 mm or wider under 350." }
```

The spec on `price` is replaced, the decision is logged with its time, and step 1 runs
again with the brief as it now stands.

## The next morning — *"Boots again."*

`sil_whoami` → the three measurements are still there. `shopping_brief_read {}` → `b1`,
newest first; `shopping_brief_read { "id": "b1" }` → the whole brief. The agent searches
with the same five specs and the €400 ceiling, and asks **nothing**: not the size, not the
width, not the budget, not the market.

## *"A helmet."*

The same brief, a new domain. `shopping_domain_search { "q": "ski helmet" }` settles the
category, and its specs are written under that path:

```
shopping_brief_edit
{ "id": "b1", "domain": "product.sports.winter.ski.helmets",
  "specs": [ { "key": "head_circumference", "op": "in", "value": [57, 58], "reason": "hat size 57–58 cm" } ] }
```

The seller spec `country in ["GR"]` already stands for the whole brief, so the helmet's
offers are filtered on it without writing it again — and a second brief is never opened
for a second thing in the same conversation.
