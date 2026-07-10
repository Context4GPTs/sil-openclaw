---
name: search-param-mapping
description: The shop-time answer→sil_search parameter mapping — real params only, hard-constraint routing, the ship_to rule. Load when mapping a decomposed request into a sil_search call.
---

# Answer→`sil_search`-param mapping (the mapping is real)

Load this at shop time, when the shop loop maps a decomposed request into a
`sil_search` call ([`shop_loop.md`](shop_loop.md) Beat 5). The mapping targets the
**real `sil_search` parameters** and nothing else — never invent a filter.

**The param catalog lives in the `sil_search` tool description** — the full list and
their forms (`query`/`category`; `price_min`/`price_max` in the currency's ISO 4217
minor unit; `condition` = `["new"]`/`["secondhand"]`; `available`; `local_merchants`;
`ship_to` as ISO codes). Read it there; do not restate it here. Under SDS there is no
stored "answer→param" seller artefact — *what* to search on for a niche lives in the
active domain's `domain_spec.md`; this reference covers only the SDS layers that feed
the mapping and the two rules the mapping must hold.

## What feeds the mapping — the SDS layers

The mapping reads several layers, not just the user's words for this request:

- The **decomposed per-query intent** (the active `intent_spec.md` filled for this
  request — ephemeral) is most specific and wins for *preferences* (precedence
  **intent > playbook(domain) > user_spec(SHARED) > domain_spec(domain)**).
- The **shopping taste** (the active `playbook.md`) supplies standing preferences for
  *this niche* — a budget band → `price_min`/`price_max` exactly like a freshly-stated
  answer, but **never re-asked**. Taste is per-domain.
- The **shared user spec** (`user_spec.md`) supplies standing **facts** and the **hard
  constraints**, reused across **every** niche — a fact maps to a param like any answer.
- The **domain spec** supplies the niche's decision-mechanics — which attributes are
  load-bearing here — so the mapping knows what to map and what matters.

These layers are inputs to the same params, not new params. A stated taste with **no
matching param** (a colour, a brand, "eco-friendly") folds into the `query` text or the
recommendation rubric — **never a new filter**. There is no `color` or `brand` param;
inventing one emits invalid `sil_search` calls.

## Hard constraints — a real filter AND a reject-at-recommend rule, NEVER only `query`

A shared user-spec **hard constraint** ("never leather", "nothing over 8 kg", an
allergy, an age gate) is **inviolable** in every niche. A hard constraint carried
**only** as soft `query` text leaks — the catalog can still surface a violating item.
Route each to **two** points, **not merely `query`** (see
[`shop_loop.md`](shop_loop.md) Beat 5):

1. **A real `sil_search` filter where one exists** — "new/secondhand only" →
   `condition`; "in stock only" → `available` (omit for the in-stock default). Where a
   param matches, set it so the catalog never returns the violating item.
2. **An explicit reject-at-pick rubric rule** for a constraint with no matching param
   (no `material` filter for "never leather"): the constraint **rejects** any violating
   candidate outright, never down-weights it. A hard constraint is a reject, not a
   weight.

## `ship_to` stays EMPTY by default

Do **not** map the user's location onto `ship_to`, and do **not** call `sil_whoami` to
populate it. When `ship_to` is absent, sil-api resolves the user's **registered default
address** server-side. Set `ship_to` only to OVERRIDE the default with a *different*
destination (e.g. "ship this to my office in Germany"). The shopper inherits
location-aware search by construction — leave `ship_to` out.

## Worked example

For a road-cycling domain whose user said (this request + a stored budget taste in that
domain) "secondhand is fine, I'm in France and want local shops":

```
query:           "endurance road bike 105 groupset"   # niche descriptors
category:        "<the narrowed niche category>"
price_max:       120000        # €1200 → minor units (cents)
condition:       ["secondhand"]
local_merchants: true          # ranking bias; optionally query in French to surface more local shops
# ship_to: OMITTED — server resolves the registered default address
```

A non-param taste ("understated colours") folds into `query` or the rubric, never a new
filter.
