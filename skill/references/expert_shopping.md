# Expert shop-time loop — how a created expert shops on its niche

Load this when you (the sil skill) are running **inside a created expert** and the
user states a shopping intent ("find me something for a steak dinner around $40").
The [agent-creation engine's Runtime hook](agent_creation_engine.md) ends where
this loop begins: the host has already injected the persona via the workspace
**`SOUL.md`** (the expert's voice, standing rules, hard-no's), and the sil skill
has read `$SIL_DATA_DIR/agents/<agentId>/profile.json` and loaded the four SDS
artefacts — all **present from creation** (seeded partial at creation, then
augmented every query): **`domain_spec.md`** (the deep researched niche
expertise), **`intent_spec.md`** (the decomposition-dimension schema),
**`user_spec.md`** (the user's domain-relevant facts + hard constraints,
**already present** and reinforced as you learn more), and **`playbook.md`** (the
user's shopping taste, **already present** and reinforced over time). Those
artefacts are now your operating instructions.

This is **shop time**, not create time. The expert behaves like a specialist a
user trusts, in the persona's voice — never a generic clerk. It consumes the
existing catalog tools **unchanged**; the rubric is applied by you at reasoning
time, not by any new tool.

This is **Spec-Driven Shopping (SDS)**, and **every query is a learning step** —
all four sil docs are **already present** (seeded partial at creation) and the
loop **augments / reinforces** them, it never fills them from nothing. On **every
query** the expert (a) keeps its `domain_spec.md` current from the **web**, (b)
**decomposes the request along the intent-spec dimensions** into an ephemeral
per-query intent and **sharpens** those dimensions, and (c) **augments the
already-present `user_spec.md`** with any new fact and **reinforces the
already-present `playbook.md`** with any taste this query surfaces — we keep
learning. It then layers **intent > playbook > user_spec > domain_spec** to drive
the catalog query and the pick. The layering is the product: the picked item's
"why" must visibly cite the layers
(see the [layering rules](#layering--precedence-intent--playbook--user--domain)).

The router's three always-on rules still hold (act-don't-narrate, follow the
tool's own `recovery`, re-check the chosen item before the user commits) — this
loop layers the profile-driven behaviour on top, it does not restate them.

## The loop (the order IS the spec)

Run these steps in order. An attribute the user already stated **or the user spec
already holds** is never re-asked.

### 1. Refresh the domain spec from the web — keep it current and complete

`domain_spec.md` is **not frozen at creation** — on every query, before anything
else, go to the **web** and **enhance the domain spec** so it stays current and
complete: new models, new standards, current prices, evolving technique. Fold
what you learn into the domain spec and **persist** the enhancement by re-running
**`sil_profile_materialize`** for this `agentId` with the updated `domainSpec`
(the in-place re-materialize — the same atomic store path the engine and refine
use). This is a **real web step** — if the host has no web/fetch tool available,
say so honestly and proceed on the existing domain spec; never pretend the refresh
happened.

### 2. Decompose the request along the intent-spec dimensions (ephemeral — NEVER persisted)

Read `intent_spec.md` — the decomposition **dimensions** a good query in this
niche must resolve — and **fill them in for *this* request** from the user's words
("a waterproof trail shoe for a wet ultra next month, around €160" → use-case:
trail/ultra; weather: wet/waterproof; budget: ~€160; timeline: next month). State
the filled decomposition back so the layering is legible. This filled instance is
the **per-query intent** — it is **ephemeral**: it lives only in this conversation
and is **NEVER persisted**. There is no intent artefact file of filled values, and
`sil_profile_materialize` is never called to store it. Only the `intent_spec.md`
*schema* is persisted (at creation / refine); the fill is throwaway.

### 3. Augment the already-present user side — facts to `user_spec.md`, taste to `playbook.md`

`user_spec.md` and `playbook.md` are **already present** (seeded partial at
creation) — this step **augments / reinforces** them, it does not build them from
nothing. Resolving the intent dimensions may surface a **new user fact** the store
doesn't yet hold (a body measurement, a compatibility detail, a hard constraint)
or a **new shopping taste** (price sensitivity, brand preference). Augment the
already-present doc with it — asked in-context for *this* query, in the persona's
voice, **only when a dimension actually needs it** — then persist it and never
re-ask:

- A **fact / measurement / hard constraint** → fold into the already-present
  `user_spec.md` and re-materialize (`sil_profile_materialize` with the updated
  `userSpec`). Mark each item as a **soft preference** (bendable) or a **hard
  constraint** (inviolable — "never leather", "nothing over 8 kg", an allergy, an
  age gate).
- A **shopping-taste preference** (budget band, brand likes/dislikes, general taste)
  → fold into the already-present `playbook.md` and re-materialize
  (`sil_profile_materialize` with the updated `playbook`).

The user side **grows incrementally, per-query** — augmenting what is already
there, never a big up-front onboarding form and never a one-time capture from
nothing. **We keep learning**: every query leaves `user_spec.md` and `playbook.md`
at least as sharp as it found them. Elicitation is
**need-driven and load-bearing**: only a dimension that is **missing** from BOTH
the request AND the stored user side is elicited, and you elicit it in the
**playbook's priority order** (the highest-priority missing dimension first, then
the next), in the persona's elicitation style — one or a few questions at a time.
This is **not a form** and **not a question battery**: you ask like a curious
expert, and an attribute the **user spec or playbook already holds is never
re-asked** — the stored value fills it in (never re-ask what the user already
stated). When the request plus the stored side already carry enough load-bearing
attributes for a defensible search, do **not** invent an extra battery — proceed
straight to the map+search steps. A request that contradicts a stored **soft**
preference **updates** the stored value (re-materialize), visibly, so the user
knows it changed (a **hard constraint** is not overridden by one request — see
precedence). The user spec / playbook are **per-user, per-expert, and local** —
written only to this user's `$SIL_DATA_DIR/agents/<agentId>/`, no server
aggregation, no cross-user signal (the same privacy posture as
[`refine_expert.md`](refine_expert.md)).

### Layering — precedence intent > playbook > user_spec > domain_spec

Resolve the layers in this order to drive the search and the pick:

- The **intent** (the per-query decomposition) narrows the field — what this
  request demands.
- The **playbook** (shopping taste) shapes preferences — price sensitivity, brand,
  general taste — within what the intent allows.
- The **user spec** fills in the standing **facts** the request left unsaid (the
  body measurement you kept from before, a compatibility constraint) — never
  re-asked — and carries the **hard constraints**.
- The **domain spec** supplies the **decision-mechanics and trade-offs** to reason
  over (for trail running, last volume and lug depth matter more than weight here)
  — the substrate, not a tiebreaker that overrides the user's wants.

**Precedence resolves conflicts: intent > playbook > user_spec > domain_spec — for
*preferences*.** A specific request overrides a standing taste, which overrides a
standing soft fact-preference, which overrides a domain default. **Exception —
hard constraints are inviolable:** a `user_spec.md` **hard constraint** is
**never** overridden by intent, taste, the domain, or the catalog. Intent can
override a soft preference; it can **never** override a hard constraint. A weight
bends; a hard constraint does not.

**Route every hard constraint to a real enforcement point, never only soft
`query` text.** A hard constraint must hold at **search-param time** (map it to a
real `sil_search` filter where one exists — e.g. `condition`, `available` — per
[`search_param_mapping.md`](search_param_mapping.md)), **in the rubric** (an
explicit **reject-at-pick** rule: a candidate that violates a hard constraint is
rejected outright, not merely down-weighted), and **in the final pick**. A
constraint carried only as free-text `query` is NOT enforced — the catalog can
still surface a violating item, and picking it is a **defect**, even if the
catalog returned it.

> **Terminology — "reject-at-pick" here = the "reject-at-…-rule" phrasing in
> [`search_param_mapping.md`](search_param_mapping.md) (same rule, one
> mechanism).** Both name the **one** rubric rule that discards a
> hard-constraint-violating candidate outright (a reject, never a down-weight),
> not two mechanisms.

### 4. Map the answers to well-formed `sil_search` params

Translate each filled intent dimension — **plus the standing user-spec facts, the
shopping taste, and the domain-spec mechanics** the layering brought in — to a
**real `sil_search` param** per [`search_param_mapping.md`](search_param_mapping.md)
— that reference owns the full answer→param table and the worked examples; **load
it, do not re-carry it here.** The load-bearing rules from it that govern this step:

- A stated taste with **no matching param** (a colour, a brand) folds into the
  `query` text or into the rubric — you **never invent a filter**. There is no
  `color` param, no `brand` param; inventing one emits an invalid `sil_search`
  call.
- A user-spec **hard constraint** maps to a **real filter where one exists**
  (`condition`, `available`) so the catalog never returns a violating item in the
  first place; where no param matches, it does NOT collapse to soft `query` text —
  it becomes an explicit **reject-at-pick** rubric rule (Step 6). A hard
  constraint left only as `query` free text is unenforced.
- Leave **`ship_to` empty** by default so the server resolves the user's
  registered default address. Do **not** call `sil_whoami` to populate it.

### 5. Search

Call `sil_search` with the mapped params. It returns purchasable variants
**best-first**.

### 6. Compare the candidates on the rubric — reject hard-constraint violators outright

The **rubric emerges here, at pick time** — it is not a stored seller artefact.
Build it from the **domain-spec dimensions and trade-offs** (reason over last
volume vs. weight, rim depth vs. crosswind — the mechanics the domain spec named)
**weighted by the shopping taste** (`playbook.md`) and the **user's facts**
(`user_spec.md`) and the **per-query intent**. A user-spec **hard constraint** is a
**reject-at-pick** rule, not a weight: any candidate that violates it is **removed
from contention outright** — never the pick, even if the catalog surfaced it and
even if it scores well on every other axis. (A soft preference, by contrast, only
down-weights.) The rubric informs your *reasoning*, not the list order: present
results **best-first** as `sil_search` returned them — **never re-rank** — but a
hard-constraint violator is never the pick.

### 7. Recommend — always with the "why" that cites the layers

Recommend with **domain-relevant rationale** in the expert's voice — the **"why"**.
Under SDS the "why" must make the layering **legible**: cite the **per-query
intent** (what this request demanded), at least one **stored user-spec fact or
taste you did NOT re-ask** ("you're a wide D-width, which I kept from before"), and
at least one **researched domain-spec dimension** ("for trail running, last volume
and lug depth matter more than weight here") — tied to the user's priorities ("so I
picked this because it holds the 105 groupset you wanted at the top of your
budget"). The **visible layering is the product**: a "why" that names no researched
domain dimension and reuses no stored user attribute is generic attribute matching
and **fails the SDS bar even if the picked product is fine**. Never hand back a
bare list, and never a rationale that could have come from generic search.

### 8. Re-fetch with `sil_product_get` before any buy

Price, availability, and `checkout_url` from `sil_search` are **point-in-time**.
Before you hand off to **buy / checkout / purchase**, **re-fetch** the chosen item
with `sil_product_get` for fresh price / availability / `checkout_url`. **Never
commit a buy off the stale `sil_search` snapshot** — buy off the fresh
`sil_product_get` detail, never the earlier `sil_search` result.

## When `sil_search` returns `ok` with `products: []` — relax and explain

An empty result on `status: ok` (`products: []`) is a normal, servable outcome —
**never a silent dead-end**. **Relax or re-frame** the params (loosen a
constraint, broaden the `query`) and **explain what you changed and why** ("I
dropped the secondhand-only filter because nothing matched it — here's what's new
in stock"). Do not just stop silently and do not leave the user with nothing.

## When the domain is genuinely unservable — an honest "no", never junk

When the catalog **cannot serve** the domain — out of the persona's scope,
**not shippable**, **age-gated**, or persistently empty after a reasonable
relax — say so **honestly**. This is a **different outcome** from the empty-but-
servable relax case above: there is no constraint to loosen, so you give an honest
"no". **Never fabricate** options and **never pad with junk** — handing back
irrelevant or unbuyable results to avoid saying "no" destroys trust. Honesty over
a hollow answer.

## When `sil_search` / `sil_product_get` returns a non-`ok` status

A non-`ok` status is **not an empty match** — do **not** treat a `retryable`
(transient / source down) or an auth failure like `products: []` and relax the
params; that is the wrong recovery. **Follow the tool's own `recovery` hint**
exactly and **never improvise** a different one. The full status taxonomy and the
per-status recovery rule live in
[`catalog_tools_reference.md`](catalog_tools_reference.md) — that reference owns
them; **load it, do not re-carry the taxonomy here.**
