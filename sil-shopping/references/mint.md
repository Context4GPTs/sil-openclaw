---
name: mint
description: The fallback — sil does not hold a domain for what the buyer is buying, so you write one. How to be sure it is really missing, and what the document you write has to say. Load only when shopping_domain_search came back with no match, or when shopping_search refused the domain.
---

# Minting a domain sil does not hold

A domain sil has curated already carries a document: a markdown guide on how the thing is
bought well, and the keys it is bought by. **That is the normal path** — read it with
`shopping_domain_get` and get on with the job.

This file is the fallback. The registry is **global and permanent**: every buyer shops the
domains it holds, nothing undoes a mint, and no session can edit a domain that already
stands. So what you write here is what every later buyer inherits.

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
3. **A read that did not return is not a read that returned nothing.** Any non-`ok` status
   leaves the mint out of reach: settle the read first. A `shopping_domain_get` answering
   `not_found` licenses nothing either — it says nothing about the standing path under a
   different parent, which is the fork this exists to prevent.

When `shopping_search` refuses with `invalid_request`, its refusals read alike — a domain
the registry does not hold and a spec row it will not take carry the same status. Read the
domain you submitted with `shopping_domain_get`: a guide back means fix the row and re-send;
`not_found` means the domain was the problem. The search's own `not_found` is about the
`brief` id instead, and no domain read will fix that.

## What the document has to say

Write the guide the way sil's own read: **markdown, explanatory, for an agent who has never
sold this thing.** Four things earn their place.

- **What it is bought on** — the few things that actually decide it, said plainly.
- **What goes wrong** — each common mistake and what it costs the buyer in real terms. Not
  "poor fit": *the heel lifts, the shin bangs the tongue all day, and in a twisting fall the
  knee takes the load.* This is what lets a later agent explain why a question matters.
- **What to trust** — whose numbers mean something, whose tags are marketing, which
  comparisons do not hold across makers.
- **What buying it online takes** — what stands in for handling the thing: a measurement
  taken at home, a tolerance, a return window. Never "go to a shop": the buyer came here
  instead of a shop.

Research it on the web first — how the thing is bought, never products.

## The keys

Coin only the keys a **product** is bought by, and give each one's `description` the same
job the guide has, for that one key: what it decides, what goes wrong at either end of it,
and how a buyer's own fact becomes a value for it.

- **A path names its ancestors** — the way the thing is shelved, dotted and lower-case:
  `product.sports.winter.ski.boots`, never `product.ski_boots` hung on the root, which is a
  fork every later buyer inherits. A path directly under `product` is refused.
- **Mark what the thing is sold by.** `variant_spec: true` marks a key that identifies a
  purchasable variant — a size, a colour; `product_spec: true` one that tells one product
  from the next — a model year, an edition. The registry derives each key's operators.
- **One concept, one spelling.** A widely shared attribute takes its conventional name;
  coin fresh only for a genuinely niche one.
- **You inherit every ancestor's key and may not rename one.** Re-declare a key only to
  change its configuration for your subtree — the unit, the allowed values, the variant or
  product mark. Re-declared with nothing the ancestor does not already say, it is not coined
  again: the mint answers `ok` and reports it `inherited: true`, and you filter on it
  anyway. **Never flip an inherited key's mark to get a different shape** — a `gender`
  redeclared as a variant spec made every product read `gender: unknown`.
- **Seller terms are never yours to coin.** The base is sil's; read them off
  `shopping_domain_get`'s `seller_specs`.
- **A key the job needs that the domain lacks is written into the brief and sent, never
  coined.** `shopping_search` takes it, leaves it absent from `fit`, and records the ask so
  research can coin what buyers actually need. The mint is for a domain sil does not have,
  never for a key a standing one is missing.

Naming is silent to the buyer. The one thing you tell them is the domain you settled on,
so they can correct it before a search spends on it.
