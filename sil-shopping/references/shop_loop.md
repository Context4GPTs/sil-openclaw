---
name: shop-loop
description: The Spec-Driven Shopping loop — the one shopper shops any niche, reusing or minting a domain on the fly, then decomposing the request and learning from it. Load when running as the shopper and the user states a shopping intent.
---

# Shop-time loop — how the one shopper shops any niche

Load this when you (the sil skill) run as the user's **shopper** and they state a
shopping intent. There is **one shopper** — a generalist holding **many domains**
(niches), each **minted lazily on first shop**. The [engine's Runtime
hook](agent_creation_engine.md) leaves you here: the persona is injected via
**`SOUL.md`**, and the skill has read the shared **`user_spec.md`** (cross-niche facts +
hard constraints, reused across every niche) plus the slug-keyed **`domains`** map from
`$SIL_DATA_DIR/shopper/profile.json`.

This is **Spec-Driven Shopping (SDS)**: a fact from niche A is reused in niche B without
being re-asked, while each domain's **`domain_spec.md`** (deep niche expertise),
**`intent_spec.md`** (decomposition schema), and **`playbook.md`** (the **shopping
taste**) stay niche-scoped — taste does not leak, only shared facts carry. Behave like a
specialist in the persona's voice; apply the rubric at reasoning time, not via a new tool.

## The five beats — run every query, in order

A beat only **asks** when something is genuinely unresolved; a fully-resolved query asks
nothing and passes straight through.

1. **Domain-exists check** — classify the niche, reuse a matching domain or register a miss.
2. **Learn on a miss** (or refresh on a hit) — the pack is present and current before you search.
3. **Gather what's missing before searching** — resolve each dimension, then ask only what's unresolved.
4. **Persist what surfaced** — a single `sil_remember` per new fact or taste.
5. **Search → rubric → recommend-with-why → re-fetch before purchase.**

## Beat 1 — Domain-exists check

Name the **shopping niche** this request belongs to ("a waterproof trail shoe for a wet
ultra" → trail running) — your reasoning, no tool call. Then read `profile.json.domains`
(via the no-args `sil_profile_get`) and match the niche **semantically, not by exact
string**. If a domain covers it, **reuse it** and go to the gate. **Reuse-before-mint**
is the shop loop's job: the store enforces only shape, so without **semantic dedup** the
shopper fragments into duplicate thin packs (`cycling`, `road-cycling`,
`bikes` for one niche). Torn between a close existing slug and a new one, prefer the
existing. No match ⇒ register a **miss** for Beat 2.

## Beat 2 — Learn the domain (mint on a miss, refresh on a hit)

**On a miss — mint the domain on the fly, announced.** Tell the user, in the shopper's
voice — **never silently** — that this is a new niche ("I haven't shopped cycling for
you yet — setting that up"), and **state the inferred niche so the user can correct it**.
**Research** it (web + knowledge) into a **deep `domainSpec`** (a shallow bullet list a
layperson could write fails the SDS bar), derive the **`intentSpec`** dimensions, and
seed a partial **`playbook`**. No web tool? Say so and compose from public knowledge —
never present a guess as verified research. Persist with the **whole-doc**
**`sil_profile_materialize { name, userSpec, domain: { slug, name, domainSpec,
intentSpec, playbook } }`** — the deduped slug from Beat 1, `userSpec` re-persisted
atomically alongside. One atomic call upserts `domains[slug]`. Never `sil_remember`.

**On a hit — web-refresh the active domain's `domain_spec.md`** so it stays current, and
persist by re-running `sil_profile_materialize` with the `domain` object carrying the
fresh `domainSpec`. A real web step — no web tool? Say so and proceed on the existing
spec; never pretend the refresh happened.

## Beat 3 — Gather what's missing before searching

Runs to completion **before any `sil_search`**. Read the active `intent_spec.md`
dimensions and fill them for **this** request ("a waterproof trail shoe for a wet ultra,
around €160" → use-case: trail/ultra; weather: wet; budget: ~€160). This filled
**per-query intent** is **ephemeral** — it lives only in this conversation and is
**never persisted**; only the `intent_spec.md` *schema* is stored.

Resolve each dimension against — in order — the **request**, the shared **`user_spec`**,
the active **`playbook`**, and any defensible `domain_spec` default. Then **elicit only
what is genuinely unresolved** — a dimension the `domain_spec`/`intent_spec` marks
**load-bearing** *and* still unfilled. Ask in the persona's voice, a few at a time, each
tied to *why* — never a battery. A stored attribute is never re-asked. When everything
load-bearing is covered, **ask nothing and pass straight through** to Beat 5. If the user
skips a question, proceed on the best defensible params and state what you assumed — a
declined question narrows quality, never access.

## Beat 4 — Persist what surfaced (fact → shared user spec, taste → active domain)

When the interaction surfaces a new user **fact** or **shopping taste**, persist it with
a **single `sil_remember`** — fired **only when something new surfaced**:

- A **fact / measurement / hard constraint** → **`sil_remember { kind: "fact", text,
  hard? }`** — the cheap append to the **shared** `user_spec.md`. A fact carries across
  every niche (no `domain`). Mark a never-break rule (an allergy, an ethics rule, an age
  gate) with **`hard: true`**; a bendable fact is a soft entry.
- A **shopping taste** (budget band, brand leaning) → **`sil_remember { kind: "taste",
  text, domain }`** — one entry to **this niche's** `playbook.md`, the **active domain**.
  Pass the active `domain` slug (with 2+ domains, omitting it is rejected). Taste is soft
  and scoped to this domain.

Reserve the **whole-doc** `sil_profile_materialize` for the heavy paths only — the Beat-2
mint, the web refresh, a full **refine** ([`refine_shopper.md`](refine_shopper.md)), and
**contradiction-resolution** (a new statement contradicting a stored *soft* preference is
a visible whole-doc rewrite; an append is accretive, never corrective). One learning per
call; if nothing surfaced, no call. Capture is **in the open** — never silently harvested
— reviewable with `sil_profile_get`, erasable with `sil_profile_remove`, per-user and
local under `$SIL_DATA_DIR/shopper/`.

### Layering — precedence intent > playbook(domain) > user_spec(SHARED) > domain_spec(domain)

- **Intent** narrows the field. **Playbook** shapes preferences within it. **User spec**
  (the **shared** spec) fills standing **facts** the request left unsaid and carries the
  **hard constraints**. **Domain spec** supplies the decision-mechanics — the substrate.

A specific request overrides a standing taste, over a soft fact-preference, over a domain
default. **Hard constraints are inviolable:** a shared `user_spec.md` **hard constraint**
is **never overridden** by intent, taste, the domain, or the catalog. Route each to a
real enforcement point — a `sil_search` filter where one exists (`condition`,
`available`, per [`search_param_mapping.md`](search_param_mapping.md)) **and** a
reject-at-pick rubric rule (rejected outright, not down-weighted). A constraint carried
only as free-text `query` is not enforced.

## Beat 5 — Search → rubric → recommend-with-why → re-fetch before purchase

Best-first, never re-rank, reject-at-pick for hard constraints, re-fetch before purchase.

**Map the answers to `sil_search` params.** Translate each filled dimension — plus the
shared facts, this domain's taste, and the domain-spec mechanics — to real params per
[`search_param_mapping.md`](search_param_mapping.md) (that reference owns the table; do
not re-carry it). A taste with no matching param folds into `query` or the rubric —
**never invent a filter**. Leave **`ship_to` empty** so the server resolves the
registered default; do not call `sil_whoami` to populate it.

**Search.** Call `sil_search` with the mapped params. It returns purchasable variants
best-first.

**Compare on the rubric — reject hard-constraint violators outright.** Build the rubric
from the active domain-spec dimensions, weighted by this domain's taste, the shared user
facts, and the per-query intent. A hard constraint is a **reject-at-pick** rule: a
violating candidate is removed from contention, never the pick. Present results
**best-first** as returned — **never re-rank** — but a violator is never the pick.

**Recommend — always with the "why" that cites the layers.** The "why" must cite the
per-query intent, at least one stored shared fact or this-domain taste you did **not**
re-ask ("you're a wide D-width, kept from before"), and at least one researched
domain-spec dimension ("for trail running, last volume and lug depth matter more than
weight here"). A "why" naming no researched dimension and reusing no stored attribute is
generic attribute matching and **fails the SDS bar** even if the product is fine. Never
hand back a bare list.

**Re-fetch with `sil_product_get` before any buy.** Price, availability, and
`checkout_url` from `sil_search` are **point-in-time**. Before any buy / checkout,
re-fetch the chosen item with `sil_product_get`. Never commit a buy off the stale
`sil_search` snapshot.

**After every recommendation, before the turn ends,** persist anything the interaction
newly surfaced that Beat 4 did not capture — each via a single `sil_remember` (a fact
`kind: "fact"` → shared user spec; a taste `kind: "taste"` + the active `domain` → this
domain's playbook) — and **only when something surfaced** (no empty, duplicate, or noise
entries).

## Empty, unservable, and non-`ok` results

- **`ok` with `products: []`** — a normal, servable outcome. **Relax or re-frame** the
  params and **explain** the change ("I dropped the secondhand-only filter — here's
  what's in stock"). Never stop silently.
- **Genuinely unservable** (out of scope, not shippable, age-gated, or persistently
  empty after a reasonable relax) — say so **honestly**. Never fabricate options and
  never pad with junk.
- **A non-`ok` status** is not an empty match — do not relax the params. **Follow the
  tool's own `recovery`** exactly and never improvise. The taxonomy lives in
  [`catalog_tools_reference.md`](catalog_tools_reference.md); load it, don't re-carry it.
