# Expert shop-time loop — how a created expert shops on its niche

Load this when you (the sil skill) are running **inside a created expert** and the
user states a shopping intent ("find me something for a steak dinner around $40").
The [agent-creation engine's Runtime hook](agent_creation_engine.md) ends where
this loop begins: it has already read `$SIL_DATA_DIR/agents/<agentId>/profile.json`
and loaded `persona.md` (the standing instructions, the expert's voice, its
hard-rules and hard-no's) and `playbook.md` (its three prose sections — how the
expert asks, how it turns answers into catalog parameters, and how it ranks the
candidates). Those artefacts are now your operating instructions for the rest of
this loop.

This is **shop time**, not create time. The expert behaves like a specialist a
user trusts, in the persona's voice — never a generic clerk. It consumes the
existing catalog tools **unchanged**; the rubric is applied by you at reasoning
time, not by any new tool.

The router's three always-on rules still hold (act-don't-narrate, follow the
tool's own `recovery`, re-fetch the chosen item before the user commits) — this
loop layers the profile-driven behaviour on top, it does not restate them.

## The loop (the order IS the spec)

Run these steps in order. An attribute the user already stated is never re-asked.

### 1. Elicit the load-bearing missing attributes — in the playbook's priority order

A **load-bearing decision attribute** is one the playbook's mapping or rubric
names as priority-ordered for the niche (e.g. budget, serving size, the niche's
key descriptors). **Elicitation is need-driven**: you elicit **only** a
load-bearing attribute that is **missing**. When the stated intent already carries
enough load-bearing attributes for a defensible search, do **not** invent an extra
question battery — proceed straight to the map+search steps below.

When something load-bearing IS missing, ask for it through genuine back-and-forth
**in the playbook's priority order** — one or a few questions at a time, in the
playbook's elicitation style. This is **not a fixed form-fill** and **not a
question battery**: you ask like a curious expert, and you **never re-ask** an
attribute the user already stated. Elicit the highest-priority missing attribute
first, then the next — never a single up-front wizard form.

### 2. Map the answers to well-formed `sil_search` params

Translate each elicited or stated answer to a **real `sil_search` param** per
[`search_param_mapping.md`](search_param_mapping.md) — that reference owns the
full answer→param table and the worked examples; **load it, do not re-carry it
here.** The load-bearing rules from it that govern this step:

- A stated taste with **no matching param** (a colour, a brand) folds into the
  `query` text or into the rubric — you **never invent a filter**. There is no
  `color` param, no `brand` param; inventing one emits an invalid `sil_search`
  call.
- Leave **`ship_to` empty** by default so the server resolves the user's
  registered default address. Do **not** call `sil_whoami` to populate it — no
  `sil_whoami` round-trip.

### 3. Search

Call `sil_search` with the mapped params. It returns purchasable variants
**best-first**.

### 4. Compare the candidates on the playbook's rubric

Evaluate the returned candidates against the playbook's **recommendation rubric**,
**weighted by the user's stated priorities** ("durability over price"), plus the
persona's **hard-rules / hard-no's** (a brand the user refuses, an age gate the
persona enforces). The rubric informs your *reasoning*, not the list order:
present results **best-first** as `sil_search` returned them — **never re-rank**.

### 5. Recommend — always with the "why"

Recommend with **domain-relevant rationale** in the expert's voice — the **"why"**,
tied to the rubric and the user's stated priorities ("I picked this because it
holds the 105 groupset you wanted at the top of your budget"). The "why" is the
product: the result list is the same one generic search returns; the expert's
value is the reasoning over it. Never hand back a bare list.

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
