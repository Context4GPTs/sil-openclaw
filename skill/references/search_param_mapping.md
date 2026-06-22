# Answer→`sil_search`-param mapping (the mapping is real)

Load this while converging interview section 4 (the answer→`sil_search`-param mapping) in [`brainstorm_interview.md`](brainstorm_interview.md). The mapping must target the **real `sil_search` parameters** (the shopping loop's catalog tool, named in `SKILL.md`) and nothing else — never invent a filter.

## The parameters available to map onto

| User's stated input | `sil_search` param it maps to |
|---|---|
| A budget ("under €1500", "€800–1200") | `price_min` / `price_max` — **in the currency's ISO 4217 minor unit** (cents): €1500 → `price_max: 150000` |
| "Prefer secondhand" / "used is fine" | `condition: ["secondhand"]` |
| "New only" | `condition: ["new"]` |
| The narrowed niche + key descriptors | `query` (free text) and/or `category` |
| "In stock only" (the default) / "show me out-of-stock too" | `available` (omit for in-stock default; `false` to include unavailable) |
| "Buy from a local/domestic shop" | `local_merchants: true` (a best-effort ranking *bias*, not a hard filter — also issue the `query` in the user's language to actually surface local shops) |

A stated taste with **no matching param** (e.g. "I like bold colours", "prefer eco-friendly brands") does **not** become a new param — fold it into the `query` text or into the recommendation rubric. There is no `color` filter, no `brand` filter; inventing one produces an expert that emits invalid `sil_search` calls at shop time.

## `ship_to` stays EMPTY by default — inline rule (do not skip)

Do **not** map the user's location onto `ship_to`, and do **not** instruct the expert to call `sil_whoami` to populate it. When `ship_to` is absent, sil-api resolves the user's **registered default address** server-side. Set `ship_to` (a `{ country, region?, postal_code? }` object of ISO codes) **only** to OVERRIDE the default with a *different* destination than the registered address (e.g. "ship this to my office in Germany"). The expert inherits correct location-aware search by construction — leave `ship_to` out, and never round-trip `sil_whoami` to fill it.

## Worked param examples

A converged mapping translates the user's stated inputs into concrete params the expert will set at shop time. For a road-cycling expert whose user said "budget around €1200, secondhand is fine, I'm in France and want local shops":

```
query:           "<niche descriptors from the answer>"   # e.g. "endurance road bike 105 groupset"
category:        "<the narrowed niche category>"
price_max:       120000        # €1200 → minor units (cents)
condition:       ["secondhand"]   # "secondhand is fine"
local_merchants: true             # "want local shops" → ranking bias; issue query in French
# ship_to: OMITTED — server resolves the registered default address; no sil_whoami round-trip
```

The stated budget became `price_max` (in cents), "secondhand is fine" became `condition`, "want local shops" became `local_merchants: true` — and `ship_to` was deliberately left out so the server resolves the registered default. A non-param taste ("I like understated colours") would fold into `query` text or the rubric, never a new filter.
