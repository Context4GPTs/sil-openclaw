# Expert shop-time loop — how a created expert shops on its niche

Load this when you (the sil skill) are running **inside a created expert** and the user states a shopping intent ("find me something for a steak dinner around $40"). The [engine's Runtime hook](agent_creation_engine.md) ends where this loop begins: the host has injected the persona via the workspace **`SOUL.md`** (voice, standing rules, hard-no's), and the sil skill has read `$SIL_DATA_DIR/agents/<agentId>/profile.json` and loaded the four SDS artefacts — all **present from creation** (seeded partial, augmented every query): **`domain_spec.md`** (deep researched niche expertise), **`intent_spec.md`** (the decomposition-dimension schema), **`user_spec.md`** (the user's facts + hard constraints), and **`playbook.md`** (the user's shopping taste — price sensitivity, brand, preferences). Those are now your operating instructions.

This is **shop time**, not create time — behave like a specialist the user trusts, in the persona's voice. Consume the catalog tools **unchanged**; the rubric is applied by you at reasoning time, not by any new tool.

This is **Spec-Driven Shopping (SDS)**, and **every query is a learning step** — all four sil docs are already present and the loop **augments / reinforces** them, never fills them from nothing. On **every query** the expert (a) keeps `domain_spec.md` current from the **web**, (b) **decomposes the request along the intent-spec dimensions** into an ephemeral per-query intent, and (c) **augments** `user_spec.md` with any new fact and `playbook.md` with any taste this query surfaces — we keep learning. It then layers **intent > playbook > user_spec > domain_spec** to drive the catalog query and the pick. The layering is the product: the pick's "why" must visibly cite the layers.

The router's three always-on rules still hold (act-don't-narrate, follow the tool's own `recovery`, re-check the chosen item before commit) — this loop layers on top, it does not restate them.

## The loop (the order IS the spec)

Run these steps in order. An attribute the user already stated **or the user spec already holds** is never re-asked.

### 1. Refresh the domain spec from the web

Before anything else, go to the **web** and **enhance `domain_spec.md`** so it stays current and complete (new models, standards, prices, technique). Fold what you learn in and **persist** it by re-running **`sil_profile_materialize`** for this `agentId` with the updated `domainSpec` (the in-place re-materialize — the same atomic store path the engine and refine use). This is a **real web step** — if the host has no web/fetch tool, say so honestly and proceed on the existing domain spec; never pretend the refresh happened.

### 2. Decompose the request along the intent-spec dimensions (ephemeral — NEVER persisted)

Read `intent_spec.md` — the decomposition **dimensions** a good query must resolve — and **fill them in for *this* request** from the user's words ("a waterproof trail shoe for a wet ultra next month, around €160" → use-case: trail/ultra; weather: wet; budget: ~€160; timeline: next month). State the filled decomposition back so the layering is legible. This filled instance is the **per-query intent** — **ephemeral**: it lives only in this conversation and is **NEVER persisted**. There is no intent artefact file of filled values, and `sil_profile_materialize` is never called to store it. Only the `intent_spec.md` *schema* is persisted; the fill is throwaway.

### 3. Augment the already-present user side — facts to `user_spec.md`, taste to `playbook.md`, via `sil_remember`

`user_spec.md` and `playbook.md` are **already present** (seeded partial at creation) — this step **augments** them, it does not build them from nothing. Resolving the intent dimensions may surface a new user **fact** (a measurement, a compatibility detail, a hard constraint) or a new **shopping taste** (price sensitivity, brand preference) — asked in-context for *this* query, in the persona's voice, **only when a dimension actually needs it** — then persist it and never re-ask:

- A **fact / measurement / hard constraint** → persist it with a SINGLE **`sil_remember { agentId, kind: "fact", text, hard? }`** call — the **cheap append** that adds one entry to `user_spec.md` *without* re-emitting the whole doc. Mark a true, never-break rule ("never leather", "nothing over 8 kg", an allergy, an age gate) with **`hard: true`** so it appends as an inviolable constraint the reject-at-pick rule can grep; a bendable fact is a plain **soft** entry.
- A **shopping-taste preference** (budget band, brand likes/dislikes) → persist it with a SINGLE **`sil_remember { agentId, kind: "taste", text, domain? }`** call — one entry appended to this niche's `playbook.md` (the **active domain**; pass `domain` when the shopper holds more than one niche). Taste is always **soft** — never `hard`.

**`sil_remember` is THE per-query persist verb** for a freshly surfaced fact or taste — the lightweight append the model takes *every query*, so rich information from the interaction is never lost under load. Reserve the **whole-doc `sil_profile_materialize`** round-trip for the heavy paths ONLY: the Step-1 domain-spec **web refresh**, a full **refine**/overwrite ([`refine_expert.md`](refine_expert.md)), and **contradiction-resolution** — when a new statement *contradicts* a stored soft preference, that visible rewrite is the whole-doc path, because an append is **accretive, never corrective**.

The user side **grows incrementally, per-query** — augmenting what is already there, never a big up-front form, never a one-time capture from nothing. **We keep learning**: every query leaves both docs at least as sharp as it found them. Elicitation is **need-driven and load-bearing**: only a dimension **missing** from BOTH the request AND the stored user side is elicited, in the **playbook's priority order** (highest-priority missing dimension first), in the persona's style — one or a few questions at a time. This is **not a form** and **not a question battery**: an attribute the user spec or playbook **already holds is never re-asked** — the stored value fills it (never re-ask what the user already stated). When the request plus the stored side already carry enough load-bearing attributes for a defensible search, proceed **straight to** the map+search steps — do not invent an extra battery. A request that contradicts a stored **soft** preference **updates** it (re-materialize), visibly (a **hard constraint** is not overridden — see precedence). The user spec / playbook are **per-user, per-expert, and local** — written only to this user's `$SIL_DATA_DIR/agents/<agentId>/`, no server aggregation, no cross-user signal (same posture as [`refine_expert.md`](refine_expert.md)). Capture is **in the open**: each new fact or taste is elicited **in-context, in the persona's voice, only when a dimension needs it** — never silently harvested — and the user can review everything an expert has stored with `sil_profile_get` and erase it (the whole expert) with `sil_profile_remove`.

### Layering — precedence intent > playbook > user_spec > domain_spec

- **Intent** (the per-query decomposition) narrows the field — what this request demands.
- **Playbook** (shopping taste) shapes preferences — price sensitivity, brand, taste — within what the intent allows.
- **User spec** fills standing **facts** the request left unsaid (a measurement kept from before, a compatibility constraint) — never re-asked — and carries the **hard constraints**.
- **Domain spec** supplies the **decision-mechanics and trade-offs** to reason over (for trail running, last volume and lug depth matter more than weight here) — the substrate, not a tiebreaker over the user's wants.

**Precedence resolves conflicts: intent > playbook > user_spec > domain_spec — for *preferences*.** A specific request overrides a standing taste, which overrides a soft fact-preference, which overrides a domain default. **Exception — hard constraints are inviolable:** a `user_spec.md` **hard constraint** is **never** overridden by intent, taste, the domain, or the catalog. Intent can override a soft preference; it can **never** override a hard constraint. A weight bends; a hard constraint does not.

**Route every hard constraint to a real enforcement point, never only soft `query` text.** A hard constraint must hold at **search-param time** (map it to a real `sil_search` filter where one exists — `condition`, `available` — per [`search_param_mapping.md`](search_param_mapping.md)), **in the rubric** (an explicit **reject-at-pick** rule: a violating candidate is rejected outright, not down-weighted), and **in the final pick**. A constraint carried only as free-text `query` is NOT enforced — the catalog can still surface a violating item, and picking it is a **defect**.

> **Terminology — "reject-at-pick" here = the "reject-at-…-rule" phrasing in [`search_param_mapping.md`](search_param_mapping.md) (same rule, one mechanism)** — the one rubric rule that discards a hard-constraint-violating candidate outright (a reject, never a down-weight).

### 4. Map the answers to well-formed `sil_search` params

Translate each filled intent dimension — **plus the standing user-spec facts, the shopping taste, and the domain-spec mechanics** the layering brought in — to a **real `sil_search` param** per [`search_param_mapping.md`](search_param_mapping.md). That reference owns the full answer→param table and worked examples; **load it, do not re-carry it here.** The load-bearing rules that govern this step:

- A stated taste with **no matching param** (a colour, a brand) folds into the `query` text or the rubric — you **never invent a filter**. There is no `color` param, no `brand` param.
- A user-spec **hard constraint** maps to a **real filter where one exists** (`condition`, `available`) so the catalog never returns a violating item; where no param matches, it does NOT collapse to `query` text — it becomes an explicit **reject-at-pick** rubric rule (Step 6).
- Leave **`ship_to` empty** by default so the server resolves the registered default address. Do **not** call `sil_whoami` to populate it.

### 5. Search

Call `sil_search` with the mapped params. It returns purchasable variants **best-first**.

### 6. Compare the candidates on the rubric — reject hard-constraint violators outright

The **rubric emerges here, at pick time** — not a stored seller artefact. Build it from the **domain-spec dimensions and trade-offs** (last volume vs. weight, rim depth vs. crosswind — the mechanics the domain spec named) **weighted by the shopping taste** (`playbook.md`), the **user's facts** (`user_spec.md`), and the **per-query intent**. A user-spec **hard constraint** is a **reject-at-pick** rule, not a weight: any candidate that violates it is **removed from contention outright** — never the pick, even if it scores well elsewhere. (A soft preference only down-weights.) The rubric informs your *reasoning*, not list order: present results **best-first** as `sil_search` returned them — **never re-rank** — but a hard-constraint violator is never the pick.

### 7. Recommend — always with the "why" that cites the layers

Recommend with **domain-relevant rationale** in the expert's voice — the **"why"** must make the layering **legible**: cite the **per-query intent** (what this request demanded), at least one **stored user-spec fact or taste you did NOT re-ask** ("you're a wide D-width, kept from before"), and at least one **researched domain-spec dimension** ("for trail running, last volume and lug depth matter more than weight here") — tied to the user's priorities. The **visible layering is the product**: a "why" that names no researched domain dimension and reuses no stored user attribute is generic attribute matching and **fails the SDS bar even if the picked product is fine**. Never hand back a bare list.

### 8. Re-fetch with `sil_product_get` before any buy

Price, availability, and `checkout_url` from `sil_search` are **point-in-time**. Before any **buy / checkout**, **re-fetch** the chosen item with `sil_product_get` for fresh price / availability / `checkout_url`. **Never commit a buy off the stale `sil_search` snapshot.**

### 9. After the recommendation — capture what surfaced via `sil_remember`

**After every recommendation, before the turn ends**, persist anything new the interaction surfaced — each via its **own single `sil_remember`** call (a person fact with `kind: "fact"`, a niche buying taste with `kind: "taste"`). This is the safety net that makes "every query is a learning step" hold under load: the whole-doc round-trip is the path the model skips, so this **cheap append** is the one that actually runs, and a measurement or brand preference voiced in the session is never lost to the conversation.

Fire this capture **only when something new actually surfaced** — a measurement stated, a brand preference revealed, a hard constraint learned, that the user spec / playbook did **not already hold**. If **nothing surfaced**, make **no `sil_remember` call**: no empty, duplicate, or noise entries. One discrete learning per call — two facts and a taste are three calls — and never silently; capture only what the interaction surfaced in the open.

## When `sil_search` returns `ok` with `products: []` — relax and explain

An empty result on `status: ok` is a normal, servable outcome — **never a silent dead-end**. **Relax or re-frame** the params (loosen a constraint, broaden the `query`) and **explain what you changed and why** ("I dropped the secondhand-only filter because nothing matched — here's what's in stock"). Never just stop silently.

## When the domain is genuinely unservable — an honest "no", never junk

When the catalog **cannot serve** the domain — out of scope, **not shippable**, **age-gated**, or persistently empty after a reasonable relax — say so **honestly**. This is a **different outcome** from the empty-but-servable relax case: there is no constraint to loosen, so you give an honest "no". **Never fabricate** options and **never pad with junk** — handing back unbuyable results destroys trust.

## When `sil_search` / `sil_product_get` returns a non-`ok` status

A non-`ok` status is **not an empty match** — do **not** treat a `retryable` or an auth failure like `products: []` and relax the params. **Follow the tool's own `recovery` hint** exactly and **never improvise**. The full taxonomy and per-status recovery live in [`catalog_tools_reference.md`](catalog_tools_reference.md) — **load it, do not re-carry the taxonomy here.**
