---
name: shop-loop
description: The Spec-Driven Shopping loop — the shopper shops any niche, minting domains on the fly, over a five-beat spine. Load when running as the shopper and the user states a shopping intent.
---

# Shop-time loop — how the one shopper shops any niche, minting domains on the fly

Load this when you (the sil skill) are running as the user's **shopper** and they state a shopping intent ("find me something for a steak dinner around $40"). There is **ONE shopper** — a generalist that goes deep on whatever the user shops for — and it holds **many domains** (niches it has learned), each **minted lazily on first shop**. The [engine's Runtime hook](agent_creation_engine.md) ends where this loop begins: the host has injected the shopper's persona via the workspace **`SOUL.md`** (voice, standing rules, hard-no's), and the sil skill has read `$SIL_DATA_DIR/shopper/profile.json` — the **shared `user_spec.md`** (the person's cross-niche facts + hard constraints) plus the slug-keyed **`domains`** map. The per-niche packs load lazily, at shop time, per the beats below.

This is **shop time**, not create time — behave like a specialist the user trusts, in the persona's voice. Consume the catalog tools **unchanged**; the rubric is applied by you at reasoning time, not by any new tool.

This is **Spec-Driven Shopping (SDS)** over **one shopper, many domains**. The **shared `user_spec.md`** carries the person across *every* niche — a fact learned while shopping niche A is reused in niche B **without being re-asked**. Each domain's pack is scoped to that niche: **`domain_spec.md`** (deep researched niche expertise), **`intent_spec.md`** (the decomposition-dimension schema), and **`playbook.md`** (the **shopping taste** for *this* niche). **Taste does not leak across domains** — a price band or brand leaning learned in A lives in A's playbook, never B's; only the shared facts and cross-cutting values carry.

The router's three always-on rules still hold (act-don't-narrate, follow the tool's own `recovery`, re-check the chosen item before commit) — this loop layers on top, it does not restate them.

**The router owns the entry gate; this file is the procedure it hard-routes into.** A reference binds only once it is loaded, so a shopper-present session's non-skippability is enforced **upstream, at the routing fork** — the stage gate in `SKILL.md` reads `sil_profile_get`, sees a shopper, and routes every `sil_search`-driven intent here before any bare search can run. Beat 1 below is that domain check as the *procedure to execute*, not the mechanism that catches a skip — the skip is already foreclosed by the always-loaded router.

## The five-beat spine — the order IS the spec, non-skippable on every query

Every shopping query runs these five beats **in order**; the order is not a suggestion. "Non-skippable" governs your **reasoning**, not the user's inbox — every beat RUNS every query, but a beat only ASKS the user when something is genuinely unresolved (a fully-resolved query asks nothing and passes straight through):

1. **Domain-exists check first** — classify the query's niche, read `profile.json.domains` (via the no-args `sil_profile_get`), reuse a semantically-matching domain or register a miss. This precedes search — the shopper never reaches search without first resolving which domain the query belongs to.
2. **Learn the domain on a miss** — mint the domain on the fly (deep `domain_spec` + derived `intent_spec` + partial `playbook`), or web-refresh it on a hit. Either way the pack is present and current before the gate; the shopper never searches a niche it does not hold.
3. **Gather what's missing from the user, before searching** — the elicitation gate: decompose the request, resolve each dimension against the request + the shared `user_spec` + the active `playbook` (+ `domain_spec` defaults) FIRST, then ask **only for what is genuinely unresolved**. Runs to completion before any `sil_search`.
4. **Persist what surfaced** — append each surfaced fact/taste with a single `sil_remember`, fired only when something new surfaced.
5. **Then search → rubric → recommend-with-why → re-fetch before purchase.**

## Beat 1 — Domain-exists check first (every query, non-skippable)

Before anything else, decide *which domain this query belongs to* and make sure the shopper holds it. No agent switch and no re-onboarding ever happens here — the **one** shopper handles every niche in the same session. This check is **non-skippable**: the shopper never reaches search without first resolving the domain.

### Classify the query's niche (skill reasoning — no tool call)

From the user's words, name the **shopping niche** this request belongs to ("a waterproof trail shoe for a wet ultra next month" → trail running; "a first road bike" → road cycling). This is your own reasoning, not a tool call — you need the niche to decide whether the shopper already knows it.

### Reuse an existing domain before minting — semantic slug dedup is YOUR job

Read `profile.json.domains` (via the no-args `sil_profile_get`) and match the classified niche against the slugs the shopper already holds **semantically — not by exact string**. If an existing domain covers this niche, **reuse it**: load that pack and go straight to the gate. The store enforces only *shape* (valid kebab, upsert-by-key) — it will happily mint `cycling`, `road-cycling`, and `bikes` as three thin packs for the **same** niche. **Reuse-before-mint is the shop loop's job**, load-bearing: without it the one shopper fragments into duplicate shallow domains and the "shop deep" promise dies. When torn between a close existing slug and a new one, **prefer the existing slug** — reuse over fragment. When no existing domain matches, register a **miss** — and learn it in Beat 2.

## Beat 2 — On a miss, learn the domain and how SDS decomposes in it

The pack must be present **and current** before the gate. On a **miss**, mint the niche on the fly — the research that used to run at create time runs **here, on first shop in this niche**. On a **hit** (a reused domain), the parallel web-refresh keeps that domain's spec current. Either way the shopper never searches a niche it does not hold-and-currently-know.

### On a miss — mint the domain on the fly, announced

When no existing domain matches, mint the niche **on the spot**:

- **Announce it — never silently.** Tell the user, in the shopper's voice, that this is a new niche ("I haven't shopped cycling for you yet — setting that up"). **State the inferred domain so the user can correct it** before it is used; a mis-inferred niche is the user's to fix.
- **Research the niche (web + knowledge).** Pull how to shop well in this niche deeply — its decision-attributes and mechanics — into a **deep `domainSpec`** (a shallow bullet list a layperson could write fails the SDS bar). Derive the **`intentSpec`** decomposition dimensions **from** that domain spec (agent-specific, a *schema* not a filled instance). Seed a *partial* **`playbook`** — the niche shopping taste, an honest non-blank "to be learned as we shop" body. If you lack a web tool, say so and compose the domain spec from well-established public shopping knowledge — never present a guess as verified research.
- **Persist with the whole-doc `sil_profile_materialize` — WITH the `domain` object.** Call **`sil_profile_materialize { name, userSpec, domain: { slug, name, domainSpec, intentSpec, playbook } }`** — the **deduped slug** from Beat 1, the deep `domainSpec`, the derived `intentSpec`, the partial `playbook`; `userSpec` is the current **shared** spec (the call re-persists it atomically alongside). One atomic call upserts `domains[slug]`. This is a **whole-doc path** (see Beat 4 + the cheap/heavy split) — `sil_profile_materialize`, **never** `sil_remember`.

### On a hit — web-refresh the active domain's spec

Before decomposing the request, go to the **web** and **enhance the active domain's `domain_spec.md`** so it stays current (new models, standards, prices, technique). Fold what you learn in and **persist** it by re-running **`sil_profile_materialize`** **with** the `domain` object carrying the updated `domainSpec` for this slug (the in-place re-mint — the same atomic store path the entry-mint and refine use). This is a **real web step** — if the host has no web/fetch tool, say so honestly and proceed on the existing domain spec; never pretend the refresh happened.

## Beat 3 — Gather what's missing from the user, before searching (the elicitation gate)

This is the promoted gate — a first-class, ordered step, **not** a clause folded inside the domain or the persist beat. It runs to completion **before any `sil_search`**: decompose the request, resolve each dimension against everything already known, then ask the user **only for what is genuinely unresolved**. It always RUNS; it asks only when something is missing.

### Decompose the request along the intent-spec dimensions (ephemeral — NEVER persisted)

Read the active domain's `intent_spec.md` — the decomposition **dimensions** a good query must resolve — and **fill them in for *this* request** from the user's words ("a waterproof trail shoe for a wet ultra next month, around €160" → use-case: trail/ultra; weather: wet; budget: ~€160; timeline: next month). State the filled decomposition back so the layering is legible. This filled instance is the **per-query intent** — **ephemeral**: it lives only in this conversation and is **NEVER persisted**. There is no intent artefact file of filled values, and `sil_profile_materialize` is never called to store it. Only the `intent_spec.md` *schema* is persisted; the fill is throwaway.

### Resolve each dimension, then elicit ONLY what is genuinely unresolved

For each decomposition dimension, **resolve it FIRST against — in order — the request's own words, the shared `user_spec` (standing facts + hard constraints, reused across every niche), the active `playbook` (this niche's standing taste), and any defensible `domain_spec` default.** Only then elicit, and elicit **only what is genuinely unresolved**. A dimension is genuinely unresolved, and *only then* asked, when it is **BOTH**:

- **load-bearing** — the active `domain_spec` / `intent_spec` marks it as materially changing the recommendation in this niche (not asked for completeness's sake), **AND**
- **still unfilled** after the resolve above — the request did not state it, and neither the shared `user_spec` nor the active `playbook` nor a domain default supplies it.

Elicitation is **need-driven**: only a dimension **missing** from BOTH the request AND the stored side is elicited — ask **only for what** a defensible pick actually needs, in the persona's voice, one or a few questions at a time, each tied to *why* the pick needs it — **never a battery**, never a form or questionnaire. An attribute the shared `user_spec` or the active `playbook` **already holds is never re-asked** — the stored value fills it silently; re-asking a known fact or taste is the exact defect this spine kills. When the request plus the stored side already carry every load-bearing dimension, **ask nothing and pass straight through** to Beat 5 — the gate is **bounded**, it does not hold the user hostage for perfect completeness. Elicitation gates search **quality, not access**: if the user skips or can't answer an elicited question, proceed on the **best defensible params**, state what you assumed, and never block shopping — a declined question narrows quality, never a dead-end.

## Beat 4 — Persist what surfaced (fact → shared user spec, taste → active domain)

When the gate surfaces a new user **fact** (a measurement, a compatibility detail, a hard constraint) or a new **shopping taste** for this niche (price sensitivity, brand leaning), persist it with a **single `sil_remember` call** — fired **only when something new surfaced** — so a future query fills it from the store instead of re-asking:

- A **fact / measurement / hard constraint** → **`sil_remember { kind: "fact", text, hard? }`** — the **cheap append** that adds one entry to the **shared** `user_spec.md` *without* re-emitting the whole doc. A fact carries across **every** niche (it never takes a `domain`). Mark a true, never-break rule ("never leather", "nothing over 8 kg", an allergy, an age gate) with **`hard: true`** so it appends as an inviolable constraint the reject-at-pick rule can grep; a bendable fact is a plain **soft** entry.
- A **shopping-taste preference** (budget band, brand likes/dislikes) → **`sil_remember { kind: "taste", text, domain }`** — one entry appended to **this niche's** `playbook.md`, the **active domain**. Pass the active domain's `domain` slug whenever the shopper holds more than one niche (with 2+ domains, omitting it is ambiguous and rejected). Taste is always **soft** — never `hard` — and is **scoped to this domain**: it shapes this niche's picks only, never another's.

**`sil_remember` is THE per-query persist verb** for a freshly surfaced fact or taste — the lightweight append the shopper takes *every query*, so rich information from the interaction is never lost under load. Reserve the **whole-doc `sil_profile_materialize`** round-trip for the heavy paths ONLY: the **Beat-2 mint** of a new domain, the Beat-2 domain-spec **web refresh**, a full **refine**/overwrite ([`refine_shopper.md`](refine_shopper.md)), and **contradiction-resolution** — when a new statement *contradicts* a stored soft preference, that visible rewrite is the whole-doc path, because an append is **accretive, never corrective**.

The shared user spec and the active domain's playbook **grow incrementally, per-query** — augmenting what is there, never a big up-front form. Fire this persist **only when something new actually surfaced** — a measurement stated, a brand preference revealed, a hard constraint learned, that the shared user spec / this domain's playbook did **not already hold**. If **nothing surfaced**, make **no `sil_remember` call**: no empty, duplicate, or noise entries. One discrete learning per call — two facts and a taste are three calls. A request that contradicts a stored **soft** preference **updates** it visibly (the whole-doc re-materialize); a **hard constraint** is not overridden (see precedence). Everything is **per-user, per-shopper, and local** — written only to this user's `$SIL_DATA_DIR/shopper/`, no server aggregation, no cross-user signal. Capture is **in the open**: each new fact or taste is elicited **in-context, in the persona's voice, only when a dimension needs it** — never silently harvested — and the user can review everything the shopper has stored with `sil_profile_get` (overview + per-domain) and erase a niche with `sil_profile_remove`.

### Layering — precedence intent > playbook(domain) > user_spec(SHARED) > domain_spec(domain)

- **Intent** (the per-query decomposition) narrows the field — what this request demands.
- **Playbook** (this domain's shopping taste) shapes preferences — price sensitivity, brand, taste — within what the intent allows. Scoped to the **active domain** only.
- **User spec** (the **shared**, agent-level spec) fills standing **facts** the request left unsaid (a measurement kept from before, a compatibility constraint) — never re-asked, reused across every niche — and carries the **hard constraints**.
- **Domain spec** (this domain's) supplies the **decision-mechanics and trade-offs** to reason over (for trail running, last volume and lug depth matter more than weight here) — the substrate, not a tiebreaker over the user's wants.

**Precedence resolves conflicts: intent > playbook > user_spec > domain_spec — for *preferences*.** A specific request overrides a standing taste, which overrides a soft fact-preference, which overrides a domain default. **Exception — hard constraints are inviolable:** a shared `user_spec.md` **hard constraint** is **never** overridden by intent, taste, the domain, or the catalog. Intent can override a soft preference; it can **never** override a hard constraint. A weight bends; a hard constraint does not.

**Route every hard constraint to a real enforcement point, never only soft `query` text.** A hard constraint must hold at **search-param time** (map it to a real `sil_search` filter where one exists — `condition`, `available` — per [`search_param_mapping.md`](search_param_mapping.md)), **in the rubric** (an explicit **reject-at-pick** rule: a violating candidate is rejected outright, not down-weighted), and **in the final pick**. A constraint carried only as free-text `query` is NOT enforced — the catalog can still surface a violating item, and picking it is a **defect**.

> **Terminology — "reject-at-pick" here = the "reject-at-…-rule" phrasing in [`search_param_mapping.md`](search_param_mapping.md) (same rule, one mechanism)** — the one rubric rule that discards a hard-constraint-violating candidate outright (a reject, never a down-weight).

## Beat 5 — Search → rubric → recommend-with-why → re-fetch before purchase

With the domain present, the gate run to completion, and anything surfaced persisted, run the search tail. This tail is **re-ordered, not re-designed** — best-first, never re-rank, reject-at-pick for hard constraints, re-fetch before purchase.

### Map the answers to well-formed `sil_search` params

Translate each filled intent dimension — **plus the shared user-spec facts, this domain's shopping taste, and the domain-spec mechanics** the layering brought in — to a **real `sil_search` param** per [`search_param_mapping.md`](search_param_mapping.md). That reference owns the full answer→param table and worked examples; **load it, do not re-carry it here.** The load-bearing rules that govern this step:

- A stated taste with **no matching param** (a colour, a brand) folds into the `query` text or the rubric — you **never invent a filter**. There is no `color` param, no `brand` param.
- A user-spec **hard constraint** maps to a **real filter where one exists** (`condition`, `available`) so the catalog never returns a violating item; where no param matches, it does NOT collapse to `query` text — it becomes an explicit **reject-at-pick** rubric rule (the compare step).
- Leave **`ship_to` empty** by default so the server resolves the registered default address. Do **not** call `sil_whoami` to populate it.

### Search

Call `sil_search` with the mapped params. It returns purchasable variants **best-first**.

### Compare the candidates on the rubric — reject hard-constraint violators outright

The **rubric emerges here, at pick time** — not a stored seller artefact. Build it from the active **domain-spec dimensions and trade-offs** (last volume vs. weight, rim depth vs. crosswind — the mechanics the domain spec named) **weighted by this domain's shopping taste** (`playbook.md`), the **shared user facts** (`user_spec.md`), and the **per-query intent**. A user-spec **hard constraint** is a **reject-at-pick** rule, not a weight: any candidate that violates it is **removed from contention outright** — never the pick, even if it scores well elsewhere. (A soft preference only down-weights.) The rubric informs your *reasoning*, not list order: present results **best-first** as `sil_search` returned them — **never re-rank** — but a hard-constraint violator is never the pick.

### Recommend — always with the "why" that cites the layers

Recommend with **domain-relevant rationale** in the shopper's voice — the **"why"** must make the layering **legible**: cite the **per-query intent** (what this request demanded), at least one **stored shared-user fact or this-domain taste you did NOT re-ask** ("you're a wide D-width, kept from before"), and at least one **researched domain-spec dimension** ("for trail running, last volume and lug depth matter more than weight here") — tied to the user's priorities. The **visible layering is the product**: a "why" that names no researched domain dimension and reuses no stored user attribute is generic attribute matching and **fails the SDS bar even if the picked product is fine**. Never hand back a bare list.

### Re-fetch with `sil_product_get` before any buy

Price, availability, and `checkout_url` from `sil_search` are **point-in-time**. Before any **buy / checkout**, **re-fetch** the chosen item with `sil_product_get` for fresh price / availability / `checkout_url`. **Never commit a buy off the stale `sil_search` snapshot.**

### After the recommendation — capture what surfaced via `sil_remember`

**After every recommendation, before the turn ends**, persist anything new the interaction surfaced that Beat 4 did not already capture — each via its **own single `sil_remember`** call (a person fact with `kind: "fact"` → the shared user spec, a niche buying taste with `kind: "taste"` + the active `domain` → this domain's playbook). This is the safety net that makes "every query is a learning step" hold under load: the whole-doc round-trip is the path the shopper skips, so this **cheap append** is the one that actually runs, and a measurement or brand preference voiced in the session is never lost to the conversation.

Fire this capture **only when something new actually surfaced** — a measurement stated, a brand preference revealed, a hard constraint learned, that the shared user spec / this domain's playbook did **not already hold**. If **nothing surfaced**, make **no `sil_remember` call**: no empty, duplicate, or noise entries. One discrete learning per call — two facts and a taste are three calls — and never silently; capture only what the interaction surfaced in the open. A **fact** carries to every niche (shared user spec); a **taste** stays in this domain.

## When `sil_search` returns `ok` with `products: []` — relax and explain

An empty result on `status: ok` is a normal, servable outcome — **never a silent dead-end**. **Relax or re-frame** the params (loosen a constraint, broaden the `query`) and **explain what you changed and why** ("I dropped the secondhand-only filter because nothing matched — here's what's in stock"). Never just stop silently.

## When the domain is genuinely unservable — an honest "no", never junk

When the catalog **cannot serve** the niche — out of scope, **not shippable**, **age-gated**, or persistently empty after a reasonable relax — say so **honestly**. This is a **different outcome** from the empty-but-servable relax case: there is no constraint to loosen, so you give an honest "no". **Never fabricate** options and **never pad with junk** — handing back unbuyable results destroys trust.

## When `sil_search` / `sil_product_get` returns a non-`ok` status

A non-`ok` status is **not an empty match** — do **not** treat a `retryable` or an auth failure like `products: []` and relax the params. **Follow the tool's own `recovery` hint** exactly and **never improvise**. The full taxonomy and per-status recovery live in [`catalog_tools_reference.md`](catalog_tools_reference.md) — **load it, do not re-carry the taxonomy here.**
