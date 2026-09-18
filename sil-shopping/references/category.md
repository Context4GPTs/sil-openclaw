---
name: category
description: GATHER, the category half — settle what the buyer is buying against sil's shared registry, read that category's buying guide and the keys it is bought by, and coin a new category only when nothing stands. Load when a category is not settled yet, or when shopping_search refuses the domain.
---

# GATHER — the category: read the registry, coin only when nothing stands

sil's registry is **global**: every buyer shops the categories it holds, and nothing can
undo a mint. So it is read first, adopted whole, and coined only on an empty read.

1. **`shopping_domain_search { q }`** — is there a standing category for this, and what
   does it say about how the thing is bought?
2. **`shopping_domain_get { path }`** — that category's buying guide and every key it is
   bought by, with the type, unit, allowed values and operators each takes. This read is
   what turns the buyer's words into specs, so it runs before the first search.
3. **`shopping_domain_create`** — the mint, and only on `matches: []`.

**Read in the buyer's own words, not a path guess.** `q` is matched against each standing
category's path text *and* its buying guide, so prose reaches a settled path that a
path-shaped guess walks straight past. Budget: at most **2 reads** — the buyer's own
sentence, then the plain category name only if the first came back empty.

**Judge fit on the returned `about`, never on how a path reads.** Three verdicts:

- **adopt** — a line describing *this* category ⇒ take that path **verbatim**, read it
  with `shopping_domain_get`, and use its keys as they are. Coin nothing beside them, and
  never edit a standing domain from a session.
- **descend** — a line describing a *broader* category ⇒ the only mint permitted is a
  **descendant** of that path, never a sibling and never a re-rooted one.
- **mint licensed** — the read came back `matches: []` ⇒ research how the category is
  bought, then coin. That empty list is the **only** thing that licenses a mint. A
  `shopping_domain_get` that answers `not_found` never licenses one: it says nothing about
  the standing path under a different parent, which is the fork this discipline prevents.

**A minted path names its ancestors** — the way the thing is shelved (sport, season,
discipline, item), dotted and lower-case: `product.sports.winter.ski.boots`, never
`product.ski_boots` hung on the root, which is a fork every later buyer inherits. When the
read returned only the root, coin that whole path under it.

**One concept, one spelling — take the key sil already holds.** A standing domain carries
its own keys: use them **verbatim** as the brief's specs and as every call's specs, rather
than coining a synonym beside them, which is simply a key sil holds no value for. When you
are coining a new category's first keys, a widely-shared attribute (screen size, weight,
RAM, waterproof rating, material…) takes its **conventional name**; coin fresh only for a
genuinely niche one.

**Mark the keys the category is SOLD by.** `variant_spec: true` marks a key that
identifies a purchasable variant — a boot's size, a colour — and `product_spec: true` one
that tells one product from the next, a model year or an edition; the registry derives
each key's operators from the type.

**The guide names what the thing is bought on, and those keys are settled before the FIRST
search.** *"Bought on stiffness, forefoot width and binding compatibility"* is the answer's
whole shape: read it off `shopping_domain_get`, add the key the category is sized by, and
hold a spec for each in the brief — from the profile, or from one question that lists every
one of them still missing. A buyer who has not said their size is a buyer you cannot
shortlist for, and a search on two of the four is an answer about a category, not about
them.

**A category inherits every key its ancestors define and may not rename one.** To change a
key for your own subtree — its unit, its allowed values, its variant or product mark —
declare that key with the configuration you want: your definition wins below your path,
and nothing converts. Declared with nothing the ancestor's definition does not already
say, a key is **not coined again**: the mint answers `ok` and reports it `inherited: true`,
usable in the brief and in the search exactly like a key you minted.

**Seller terms are never yours to coin.** The base is sil's and a branch key is coined by
research, so read them from `shopping_domain_get`'s `seller_specs` and write them as the
brief's seller specs.

**A key the job needs that the domain lacks is written and sent, never coined.** The brief
keeps it and `shopping_search` takes it, answers the products it found, leaves that key
absent from `fit` and records the ask so research can coin what buyers need.
`shopping_domain_create` is for a category sil does not have, never for a key a standing
one is missing.

**A read that did not return is not a read that returned nothing.** Any non-`ok` status —
`invalid_request`, a transient, `not_registered` — leaves the mint out of reach: settle the
read, never coin around it. And when `shopping_search` refuses with `invalid_request`, its
refusals read alike — a domain the registry does not hold and a spec row it will not take
carry the same status — so read the domain you submitted with `shopping_domain_get` and let
its answer decide: a guide back means fix the row and re-issue, `not_found` means the
domain was the problem. Then read again in the buyer's own words, and coin only if that
comes back `matches: []`. The search's own `not_found` is about the `brief` id instead —
that id is not one of this buyer's briefs — and no domain read will fix it.

**A brief that already carries a settled path is searched with no registry read at all** —
the registry read is the cold path's first move, never a per-search toll.

Naming is silent to the buyer: never surface key plumbing. The one thing they are told is
**the category you settled on**, so they can correct it before the search spends on it.
