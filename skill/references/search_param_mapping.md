# Answer→`sil_search`-param mapping (the mapping is real)

Load this at shop time, when an expert's loop maps a decomposed request into a `sil_search` call ([`expert_shopping.md`](expert_shopping.md) Step 4). The mapping must target the **real `sil_search` parameters** (the shopping loop's catalog tool, named in `SKILL.md`) and nothing else — never invent a filter. (Under SDS there is no stored "answer→param mapping" seller artefact — the niche knowledge of *what* to search on lives in the domain spec; this reference is the generic param table the mapping draws on.)

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

## SDS mapping inputs — the decomposed intent, the user facts, the buying taste, the domain mechanics

Under [Spec-Driven Shopping](expert_shopping.md), the mapping reads several layers, not only the user's words for *this* request:

- The **decomposed per-query intent** (the `intent_spec.md` dimensions filled in for this request — ephemeral) is the most specific layer and wins for *preferences* (precedence **intent > playbook > user_spec > domain_spec**).
- The **buying taste** (`playbook.md`) supplies the user's standing preferences — budget band, brand likes/dislikes — these map to params (a budget band → `price_min`/`price_max`) exactly like a freshly-stated answer would, but are **never re-asked**.
- The **user spec** (`user_spec.md`) supplies the user's standing **facts** (a foot profile, a compatibility detail) and the **hard constraints** — facts map to params like any stated answer; the stored value fills the param, never re-asked.
- The **domain spec** (`domain_spec.md`) supplies the niche's **decision-mechanics** — which attributes are load-bearing for *this* niche (last volume, rim depth, gearing range), so the mapping knows what to map and what matters.

The param table itself is **unchanged** — these layers are inputs to the same mapping, not new params. A domain dimension, a standing user fact, or a taste with **no matching param** folds into `query`/rubric per the no-invented-filter rule above, exactly like any other non-param taste.

## Hard constraints — route to a real filter AND a reject-at-recommend rule, NEVER only `query` text

A **user-spec hard constraint** ("never leather", "nothing over 8 kg", an allergy, an age gate) is **inviolable** — the expert never recommends a violating item. A hard constraint carried **only** as soft `query` free text leaks: the catalog can still surface a violating product, and recommending it is a defect. So map every hard constraint to **two** enforcement points, **not merely `query`**:

1. **A real `sil_search` filter where one exists.** "New only" / "secondhand only" → `condition`; "in stock only" → `available` (omit for the in-stock default). Where a param matches the constraint, set it so the catalog never returns the violating item at all.
2. **An explicit reject-at-recommend rubric rule** (`expert_shopping.md` Step 4). For a constraint with **no matching param** (no `material` filter for "never leather"), the constraint becomes a rubric rule that **rejects** any violating candidate outright — **never recommend** it — rather than down-weighting it. A hard constraint is a reject, not a weight.

A hard constraint that lands **only** in `query` text is **not** enforced — it is a hint, not a filter, and the catalog may ignore it. Route it to a filter and a reject rule; the `query` text is at most an additional nudge, never the sole carrier of an inviolable constraint.

## `ship_to` stays EMPTY by default — inline rule (do not skip)

Do **not** map the user's location onto `ship_to`, and do **not** instruct the expert to call `sil_whoami` to populate it. When `ship_to` is absent, sil-api resolves the user's **registered default address** server-side. Set `ship_to` (a `{ country, region?, postal_code? }` object of ISO codes) **only** to OVERRIDE the default with a *different* destination than the registered address (e.g. "ship this to my office in Germany"). The expert inherits correct location-aware search by construction — leave `ship_to` out, and never round-trip `sil_whoami` to fill it.

## Worked param examples

At shop time the mapping translates the decomposed intent + the stored facts/taste into concrete params. For a road-cycling expert whose user said (this request, plus a stored €1200 budget taste) "secondhand is fine, I'm in France and want local shops":

```
query:           "<niche descriptors from the answer>"   # e.g. "endurance road bike 105 groupset"
category:        "<the narrowed niche category>"
price_max:       120000        # €1200 → minor units (cents)
condition:       ["secondhand"]   # "secondhand is fine"
local_merchants: true             # "want local shops" → ranking bias; issue query in French
# ship_to: OMITTED — server resolves the registered default address; no sil_whoami round-trip
```

Budget → `price_max` (cents), "secondhand is fine" → `condition`, "want local shops" → `local_merchants: true`; `ship_to` left out so the server resolves the registered default. A non-param taste ("understated colours") folds into `query` or the rubric, never a new filter.
