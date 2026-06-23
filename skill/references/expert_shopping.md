# Expert shop-time loop — how a created expert shops on its niche

Load this when you (the sil skill) are running **inside a created expert** and the
user states a shopping intent ("find me something for a steak dinner around $40").
The [agent-creation engine's Runtime hook](agent_creation_engine.md) ends where
this loop begins: it has already read `$SIL_DATA_DIR/agents/<agentId>/profile.json`
and loaded `persona.md` (the standing instructions, the expert's voice, its
hard-rules and hard-no's), `playbook.md` (its three prose sections — how the
expert asks, how it turns answers into catalog parameters, and how it ranks the
candidates), and the two SDS specs when present: `domain.md` (the researched
**domain spec** — the niche decision-dimensions and trade-offs) and `user.md`
(the **user spec** — this user's standing attributes + hard constraints). Those
artefacts are now your operating instructions for the rest of this loop.

This is **shop time**, not create time. The expert behaves like a specialist a
user trusts, in the persona's voice — never a generic clerk. It consumes the
existing catalog tools **unchanged**; the rubric is applied by you at reasoning
time, not by any new tool.

This is **Spec-Driven Shopping (SDS)**: rather than generic attribute matching,
the expert reasons over **three layered specs** — it captures the **user spec**
once on first shop, then on every request **derives an ephemeral intent spec**
and **layers intent → user → domain** to drive the search and the pick. The
layering is the product: the picked item's "why" must visibly cite all three
layers (see the [layering rules](#layering--precedence-intent--user--domain)).

The router's three always-on rules still hold (act-don't-narrate, follow the
tool's own `recovery`, re-fetch the chosen item before the user commits) — this
loop layers the profile-driven behaviour on top, it does not restate them.

## Step 0 — capture the user spec ONCE, on first shop (then reuse it)

Before the per-request loop, check whether this expert already holds a **user
spec** (`user.md`, loaded at session start). It carries the user's **standing
niche-relevant attributes** (their foot profile, climate, the budget band they
live in) and their **hard constraints** (the rules the expert never breaks).

- **No user spec yet (first shop / onboarding):** before searching, **capture
  one**. Elicit the user's standing attributes and hard constraints **guided by
  the domain spec's dimensions** — ask about the dimensions that matter for *this*
  niche (a running-shoe expert asks foot width / arch / typical terrain, not a
  generic form), **in the persona's voice**. Mark each captured item as a **soft
  preference** (bendable) or a **hard constraint** (inviolable — "never leather",
  "nothing over 8 kg", an allergy, an age gate). Then **persist it** by re-running
  **`sil_profile_materialize`** for this `agentId` with the new `userSpec` (the
  in-place re-materialize — same atomic store path the engine and refine use).
- **User spec already exists:** **reuse it** — do **not** re-capture it, and
  **never re-ask** any attribute it already holds. Only attributes neither the
  request nor the user spec supplies are elicited (Step 1).
- **A request that contradicts a standing attribute:** when the user's words
  contradict a stored **soft preference**, **update the user spec** to the new
  value (re-materialize) — visibly, so the user knows it changed — rather than
  silently ignoring either the stored value or the request. (A **hard constraint**
  is not overridden by a single request; see precedence below.)

The user spec is **per-user, per-expert, and local** — written only to this
user's `$SIL_DATA_DIR/agents/<agentId>/`, no server aggregation, no cross-user
signal (the same privacy posture as [`refine_expert.md`](refine_expert.md)).

## The loop (the order IS the spec)

Run these steps in order. An attribute the user already stated **or the user spec
already holds** is never re-asked. On every request, before eliciting, **derive
the intent spec** and **layer it with the user + domain specs** (the two sections
below) — the layering drives the whole loop, from eliciting through the pick.

### Derive the intent spec (per request, ephemeral — NEVER persisted)

On each new request, **derive an intent spec**: a short, explicit statement of
**what *this* request demands** — read from the user's words ("a waterproof trail
shoe for a wet ultra next month, around €160"). State it back so the layering is
legible ("so: trail, waterproof, ultra-distance cushioning, ~€160"). The intent
spec is **ephemeral — it lives only in this conversation and is NEVER persisted**;
there is no intent artefact file, and `sil_profile_materialize` is never called to store it.
It exists to be **layered** with the two persisted specs.

### Layering — precedence intent > user > domain

Resolve the three layers in this order to drive the search and the pick:

- The **intent spec** narrows the field — what this request demands.
- The **user spec** fills in the **standing attributes the request left unsaid**
  (the foot width you kept from before, the budget band) — never re-asked.
- The **domain spec** supplies the **decision-dimensions and trade-offs** to
  reason over (for trail running, last volume and lug depth matter more than
  weight here) — the substrate, not a tiebreaker that overrides the user's wants.

**Precedence resolves conflicts: intent > user > domain — for *preferences*.** A
specific request overrides a standing **soft** user preference, which overrides a
domain default. **Exception — hard constraints are inviolable:** a user-spec
**hard constraint** is **never** overridden by intent (or by the domain, or by
the catalog). Intent can override a soft user *preference*; it can **never**
override a hard *constraint*. A weight bends; a hard constraint does not.

**Route every hard constraint to a real enforcement point, never only soft
`query` text.** A hard constraint must hold at **search-param time** (map it to a
real `sil_search` filter where one exists — e.g. `condition`, `available` — per
[`search_param_mapping.md`](search_param_mapping.md)), **in the rubric** (an
explicit **reject-at-pick** rule: a candidate that violates a hard constraint
is rejected outright, not merely down-weighted), and **in the final pick**. A
constraint carried only as free-text `query` is NOT enforced — the catalog can
still surface a violating item, and picking it is a **defect**, even if the
catalog returned it.

### 1. Elicit the load-bearing missing attributes — in the playbook's priority order

A **load-bearing decision attribute** is one the playbook's mapping or rubric — or
the **domain spec's dimensions** — names as priority-ordered for the niche (e.g.
budget, serving size, the niche's key descriptors, a domain dimension like last
volume). **Elicitation is need-driven**: you elicit **only** a load-bearing
attribute that is **missing** from BOTH the request (the intent spec) AND the
**user spec**. An attribute the **user spec already holds is never re-asked** —
the standing value fills it in (the layering's whole point). When the intent spec
plus the user spec already carry enough load-bearing attributes for a defensible
search, do **not** invent an extra question battery — proceed straight to the
map+search steps below.

When something load-bearing IS missing from both layers, ask for it through
genuine back-and-forth **in the playbook's priority order** — one or a few
questions at a time, in the playbook's elicitation style. This is **not a fixed
form-fill** and **not a question battery**: you ask like a curious expert, and you
**never re-ask** an attribute the user already stated or the user spec holds.
Elicit the highest-priority missing attribute first, then the next — never a
single up-front wizard form.

### 2. Map the answers to well-formed `sil_search` params

Translate each elicited or stated answer — **plus the standing user-spec
attributes and the domain-spec dimensions** the layering brought in — to a **real
`sil_search` param** per [`search_param_mapping.md`](search_param_mapping.md) —
that reference owns the full answer→param table and the worked examples; **load
it, do not re-carry it here.** The load-bearing rules from it that govern this
step:

- A stated taste with **no matching param** (a colour, a brand) folds into the
  `query` text or into the rubric — you **never invent a filter**. There is no
  `color` param, no `brand` param; inventing one emits an invalid `sil_search`
  call.
- A user-spec **hard constraint** maps to a **real filter where one exists**
  (`condition`, `available`) so the catalog never returns a violating item in the
  first place; where no param matches, it does NOT collapse to soft `query` text —
  it becomes an explicit **reject-at-pick** rubric rule (Step 4). A hard
  constraint left only as `query` free text is unenforced.
- Leave **`ship_to` empty** by default so the server resolves the user's
  registered default address. Do **not** call `sil_whoami` to populate it — no
  `sil_whoami` round-trip.

### 3. Search

Call `sil_search` with the mapped params. It returns purchasable variants
**best-first**.

### 4. Compare the candidates on the playbook's rubric — reject hard-constraint violators outright

Evaluate the returned candidates against the playbook's **recommendation rubric**,
**weighted by the user's stated priorities** ("durability over price"), the
**domain-spec dimensions and trade-offs** (reason over last volume vs. weight, rim
depth vs. crosswind — the dimensions the domain spec named), plus the persona's
and user spec's **hard-rules / hard-no's**. A user-spec **hard constraint** is a
**reject-at-recommend** rule, not a weight: any candidate that violates it is
**removed from contention outright** — never recommended, even if the catalog
surfaced it and even if it scores well on every other axis. (A soft preference, by
contrast, only down-weights.) The rubric informs your *reasoning*, not the list
order: present results **best-first** as `sil_search` returned them — **never
re-rank** — but a hard-constraint violator is never the pick.

### 5. Recommend — always with the "why" that cites all three layers

Recommend with **domain-relevant rationale** in the expert's voice — the **"why"**.
Under SDS the "why" must make the layering **legible**: cite the **derived intent**
(what this request demanded), at least one **stored user-spec attribute you did NOT
re-ask** ("you're a wide D-width, which I kept from before"), and at least one
**researched domain-spec dimension** ("for trail running, last volume and lug depth
matter more than weight here") — tied to the user's stated priorities ("so I picked
this because it holds the 105 groupset you wanted at the top of your budget"). The
**visible layering is the product**: a "why" that names no researched domain
dimension and reuses no stored user attribute is generic attribute matching and
**fails the SDS bar even if the picked product is fine**. Never hand back a bare
list, and never a rationale that could have come from generic search.

### 6. Re-fetch with `sil_product_get` before any buy

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
