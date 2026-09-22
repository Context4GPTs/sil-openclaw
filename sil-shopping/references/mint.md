---
name: mint
description: The fallback — sil does not hold a domain for what the buyer is buying, so you write one. How to be sure it is really missing, where the leaf hangs, what the document says, what sil refuses, and what you ask the buyer once it stands. Load only when shopping_domain_search came back with no match, or when shopping_search refused the domain.
---

# Minting a domain sil does not hold

A domain sil has curated already carries a document: a markdown guide on how the thing is
bought well, and the keys it is bought by. **That is the normal path** — read it with
`shopping_domain_get` and get on with the job.

This file is the fallback. The registry is **global and permanent**, so what you write here
is what every later buyer inherits. A mint runs once, but the document is not frozen: sil
grows it from the guide-like pages your own searches fetch, so a word, a value or a key
missing today may stand tomorrow.

## First, be sure it is missing

1. **`shopping_domain_search { q }`** in the buyer's own words, not a path guess — `q` is
   matched against each standing path's text *and* its guide, so prose finds a domain that a
   path-shaped guess walks past. At most two reads: their own sentence, then the plain name.
2. **Judge fit on the `about` that comes back, never on how a path reads.**
   - a line describing *this* thing ⇒ **adopt** that path verbatim, read it with
     `shopping_domain_get`, use its keys as they are, coin nothing beside them;
   - a line describing a *broader* thing ⇒ the only mint allowed is a **descendant** of that
     path, never a sibling and never a re-rooted one;
   - **`matches: []`** ⇒ and only then, research how the thing is bought and write one.
3. **Then read the `tree` for where the family sits.** It groups every standing path by its
   family, which is how you shelve the new leaf where a specialist shop would.
4. **A read that did not return is not a read that returned nothing.** Any non-`ok` status
   leaves the mint out of reach: settle the read first. A `shopping_domain_get` answering
   `not_found` licenses nothing either — it is silent about the standing path under another
   parent, which is the fork this exists to prevent.

```json
{ "q": "pour-over coffee dripper" }

→ { "status": "ok", "matches": [],
    "tree": [ { "family": "product.coffee", "domains": 2,
                "paths": [ { "path": "product.coffee.espresso_machines", "name": "espresso machines" },
                           { "path": "product.coffee.grinders",          "name": "coffee grinders" } ] } ] }
```

Nothing there is a dripper, and `product.coffee` is where the gear is shelved, so the leaf
to write is `product.coffee.pour_over_drippers`.

When `shopping_search` refuses with `invalid_request`, its refusals read alike — a domain the
registry does not hold and a spec row it will not take carry the same status. Read the domain
you submitted with `shopping_domain_get`: a guide back means fix the row and re-send,
`not_found` means the domain was the problem.

## A leaf or a value

Things bought on different keys are different leaves; the same keys with another value is a
value; one thing has one leaf. An espresso machine, a dripper, a grinder and a kettle share
almost no keys, so they are four sibling leaves under `product.coffee` — never four values
of one `brew_method`, never a kitchen department. A black dripper is a value of `color`.

- **A path names its ancestors** — the way the thing is shelved, dotted and lower-case:
  `product.coffee.pour_over_drippers`, never `product.pour_over_drippers` hung on the root,
  which sil refuses and which would be a fork every later buyer inherits.
- **A setup of several things is several domains.** *"Everything for pour-over at home"* is
  a dripper, a grinder and a kettle: find or mint each, and run each search in the domain of
  the thing it is for. A kettle searched under coffee makers runs on the wrong keys.

## What the document has to say

Write the guide the way sil's own read: **markdown, explanatory, for an agent who has never
sold this thing.** Four things earn their place.
- **What it is bought on** — the few things that actually decide it, said plainly.
- **What goes wrong** — each common mistake and what it costs the buyer in real terms. Not
  "poor extraction": *the water runs through in ninety seconds and the cup is thin and
  sour.* This is what lets a later agent explain why a question matters.
- **What to trust** — whose numbers mean something, whose tags are marketing, and which
  comparisons do not hold across makers.
- **What buying it online takes** — what stands in for handling the thing: a measurement
  taken at home, a tolerance, a return window. Never "go to a shop" — they came here instead.

Research it on the web first — how the thing is bought, never products.

## The axis

One key is the axis the thing is sold in — the variant the buyer picks on the page. Mark it
`variant_spec: true`, give it the `unit` it is printed in and the `step` the maker moves it
by, and map what shops print onto its values with `forms`. A colour is never that key: a
dripper is chosen by size and then offered in colours.

```json
{ "key": "brew_capacity", "display_name": "Brew capacity", "type": "number", "unit": "cups",
  "step": 1, "variant_spec": true, "labels": ["size", "μέγεθος"],
  "description": "How much the cone brews in one pour. A 01 overflows past two cups; a 02 run for one pours thin.",
  "forms": { "01": "2", "02": "4", "1-4 cups": "4", "03": "6" } }
```

A value a page prints off that grid is not a value — sil keeps it as a proposed row.

## The values

Enumerate the ways the thing is made **before** you coin an enum: one with no
`allowed_values` is refused, because nothing can ever be asked of it. Where the values are
numbers, use a number with a `unit` and a `step` instead.

```json
{ "key": "material", "display_name": "Material", "type": "enum", "allowed_values": ["ceramic", "glass", "plastic", "metal"],
  "description": "What the cone is made of. Ceramic holds the temperature and chips; plastic loses a degree and survives everything." }
```

## The name

**`name` is what the thing is called, in English, and there is one.** Everything else the
market calls it goes in `labels`, in any language: what shops print in a listing title,
never a dictionary form. A Greek shop prints *καφετιέρα φίλτρου*, so that is the label —
*καφεμηχανές* is the dictionary word and finds nothing:
`{ "name": "pour-over dripper", "labels": ["dripper", "καφετιέρα φίλτρου", "V60"] }`.

**One concept, one spelling.** A widely shared attribute takes its conventional name; coin a
fresh one only for a genuinely niche attribute.

## The bind

- **You inherit every ancestor's key and may never rename one.** Use it by its own name.
- **Re-declare a key only to change its configuration for your subtree** — unit, values, mark.
- Re-declared with nothing the ancestor does not already say, it is not coined again: the
  reply answers `inherited: true`, and you filter on it anyway.
- **A key that names a standing one binds to it.** Send `colour` and sil answers the standing
  `color`, names what it bound in `bound_from`, and keeps your spelling as a label of it.
  Never flip an inherited key's mark to get a different shape — a `gender` re-declared as a
  variant spec made every product read `gender: unknown`.
- **Seller terms are never yours to coin.** Read them off `shopping_domain_get`'s `seller_specs`.

```json
{ "key": "colour", "display_name": "Colour", "type": "enum", "allowed_values": ["black", "white"] }

→ { "key": "color", "variant_spec": true, "inherited": true, "bound_from": "colour" }
```

## The questions the mint just earned

The keys you coined are the questions you now owe the buyer — one message, before the first
search, each with what it costs them to get it wrong, never the field it fills. You coined
them because they decide the buy: asking nothing is a search run on your own guesses.

> Three things decide a dripper, and I'd rather ask than guess. How many cups you brew at
> once — a small cone overflows past two, a big one run for one pours thin. What it's made
> of — ceramic holds the heat and chips, plastic survives the sink and loses you a degree.
> And whether you have filters already, because the cone size has to match the pack.

## What sil refuses, and what to send instead

Each is an `invalid_request` whose `message` names the standing thing and the fix.

- **A name that already stands.** *"product.coffee.espresso_machines already stands for
  "espresso machines" — adopt it, or descend from it"*: your `name`, a `label` or your
  path's last word collided.
- **An enum with no values.** *"spec "size" is an enum with no allowed_values — list its
  values, or make it a number with a unit and a step"*.
- **A mark flipped on an inherited key.** *"spec "gender" is a product spec at product — a
  leaf cannot make it a variant spec; drop the mark"*.
- **A path hung on the root.** Only the path's root has to stand already, but a path
  directly under `product` is refused: name the family, or no family can give the leaf words.

## A mint, whole

```json
{ "path": "product.coffee.pour_over_drippers", "name": "pour-over dripper",
  "labels": ["dripper", "καφετιέρα φίλτρου"],
  "guide": "A pour-over dripper is bought on two things: how much it brews at once and what it is made of. …\n\n## What goes wrong\n\n- **A cone too big for the cup.** … The water runs the bed dry, the cup is thin and sour, and no grind setting rescues it. …\n\n## What to trust\n\nThe maker's own cup rating and filter size. A shop's \"barista grade\" tag measures nothing. …\n\n## Buying it online\n\nNothing has to be handled: count the cups actually poured in a morning, and buy where the filter pack is sold beside it …",
  "specs": [
    { "key": "brew_capacity", "display_name": "Brew capacity", "type": "number", "unit": "cups",
      "step": 1, "variant_spec": true, "labels": ["size", "μέγεθος"],
      "forms": { "01": "2", "02": "4", "1-4 cups": "4", "03": "6" },
      "description": "How much the cone brews in one pour. A 01 overflows past two; a 02 run for one pours thin." },
    { "key": "material", "display_name": "Material", "type": "enum", "allowed_values": ["ceramic", "glass", "plastic", "metal"],
      "description": "What the cone is made of, which decides the heat it takes out of the pour." },
    { "key": "colour", "display_name": "Colour", "type": "enum", "allowed_values": ["black", "white"],
      "description": "The finish it is sold in." } ] }

→ { "status": "ok", "path": "product.coffee.pour_over_drippers",
    "specs": [ { "key": "brew_capacity", "variant_spec": true },
               { "key": "material" },
               { "key": "color", "variant_spec": true, "inherited": true, "bound_from": "colour" } ] }
```

`colour` is the bind: the root already defines `color` as a variant spec, so nothing was
coined and `colour` is now one of its labels. Naming is silent to the buyer — the one thing
you tell them is the domain you settled on, before a search spends on it.
