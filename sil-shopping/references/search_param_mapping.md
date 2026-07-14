---
name: search-param-mapping
description: The shop-time answer→sil_search parameter mapping — real params only, hard-constraint routing, the ship_to rule. Load when mapping a decomposed request into a sil_search call.
---

# Answer→`sil_search`-param mapping (the mapping is real)

Load at shop time, when the loop maps a decomposed request into a `sil_search` call
([`shop_loop.md`](shop_loop.md) Beat 5). The mapping targets the **real `sil_search`
parameters** and nothing else — **never invent a filter**.

**The param catalog lives in the `sil_search` tool description** (`query`/`category`;
`price_min`/`price_max` in ISO 4217 minor units; `condition`; `available`; `local_merchants`;
`ship_to` as ISO codes) — read it there, don't restate it. *What* to search on for a niche
lives in the active domain's **method**; this reference covers only the layers feeding the
mapping and the two rules it must hold.

## What feeds the mapping

Fill precedence (see [`fill_and_feedback.md`](fill_and_feedback.md)):
**request-intent > PRD filled-pref > method taste > user_spec fact > method default**. The
layers:

- **filled PRD** — wins for *preferences*; maps like a fresh answer but is **never re-asked**.
- **per-domain taste** (in the **method**) — standing niche preferences; a budget band →
  `price_min`/`price_max`.
- **shared user spec** (`user_spec.md`) — standing **facts** + the **hard constraints**, reused
  across **every** niche.
- **method** — the niche's decision-mechanics: which attributes are load-bearing.

These feed the *same* params, not new ones. A taste with **no matching param** (a colour,
brand, "eco-friendly") folds into `query` text or the recommendation reflection — **never a new
filter**. There is no `color`/`brand` param; inventing one emits invalid calls.

## Hard constraints — a real filter AND a reject-at-pick rule, NEVER only `query`

A shared user-spec **hard constraint** ("never leather", "nothing over 8 kg", an allergy, an
age gate) is **inviolable**. Carried **only** as `query` text it leaks — the catalog can still
surface a violator. Route each **two** ways:

1. **A real filter where one exists** — "new/secondhand only" → `condition`; "in stock only" →
   `available`. Set it so the catalog never returns the violator.
2. **An explicit reject-at-pick rule** where no param matches (no `material` filter for "never
   leather"): **reject** any violating candidate outright, never down-weight it. A hard
   constraint is a reject, not a weight.

## `ship_to` stays EMPTY by default

Don't map the user's location onto `ship_to`, and don't call `sil_whoami` for it. When absent,
sil-api resolves the **registered default address** server-side. Set `ship_to` only to OVERRIDE
with a *different* destination ("ship this to my office in Germany"). Location-aware search is
inherited by construction — leave `ship_to` out.

## Worked example

Road-cycling domain, user said "secondhand is fine, I'm in France and want local shops":

```
query:           "endurance road bike 105 groupset"
category:        "<narrowed niche category>"
price_max:       120000        # €1200 → minor units
condition:       ["secondhand"]
local_merchants: true          # ranking bias; optionally query in French for more local shops
# ship_to: OMITTED — server resolves the registered default
```

A non-param taste ("understated colours") folds into `query` or the reflection, never a filter.
</content>
