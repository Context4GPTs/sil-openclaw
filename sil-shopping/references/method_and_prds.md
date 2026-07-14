---
name: method-and-prds
description: Beat 2 of the loop — load, mint or signal-refresh a domain's method — plus the intent-keyed PRD model, the method/PRD templates, the frontmatter-as-truth store, and discovery/manage via sil_profile_search / sil_profile_get / sil_profile_remove. Load when resolving a domain's method or managing what the shopper knows.
---

# Beat 2 — the domain method, intent-keyed PRDs, and the store

Beat 1 hands off a resolved `domain` — a **HIT** (method exists) or a **MISS** (no
method yet). Beat 2 turns that into a method body in context, ready for Beat 3 to
fill. Three paths.

## LOAD — the hot path (HIT, fresh)

A plain revisit **LOADS**: `sil_profile_get(domain)` reads the durable method body
— **no research**. This is the default on every revisit; the method is
**recovered, never rebuilt**. Loading its `## Search vocabulary` brings the coined
`ns.key` dimensions into context for Beat 4.

## MINT — cold (MISS)

No method exists, so **mint** one — this is where you **explore**. Research the niche
on the web **freely and often** to learn how it is *really* bought: its load-bearing
attributes, its failure modes, what separates a good buy from a bad one. The one
boundary — you research the **domain** (how it's bought), you **never source products**
from the web; every pick comes only from `sil_search` in Beat 4.

**The method is GENERAL — the whole product category, reusable across every intent.**
It holds *how the category is bought* and the *dimensions* that decide a buy — **never
this buyer's values** (those are the PRD). Mint at the **broadest slug whose buying
guide generalises**: `earbuds` serves gym, commute, and office; the gym specifics live
in the gym PRD, not a `wireless-gym-earbuds` method. Folding the use-context into the
domain forks a near-duplicate method per intent and kills reuse.

Persist with **`sil_learn create`** (`target: "method"`, domain + name + body) — the
file **is** the registration (it errors if the method already exists: a revisit LOADs,
a stale one REFRESHes with `write`). Never the setup-only `sil_profile_materialize`.
Then **announce** the inferred domain so the buyer can correct it. The method body
carries these sections, and only these:

- **`## How it's bought`** — the buying guide: load-bearing attributes, failure modes,
  what separates a good buy from a bad one — general to the category, not this buyer.
- **`## Search vocabulary`** — the spec **dimensions** you coin (`ns.key` + `data_type`
  + unit + `allowed_values` + why-it-matters) — names only, **no values**.
- **`## Durable taste`** — the buyer's cross-intent per-domain taste, seeded from
  `user_spec` (omit until something durable is known).
- **`## Volatility`** — the volatile axis + a rough refresh cadence.

The vocabulary is **canonicalized before persist**. `sil_specs` is
**precision-first** — two specs converge only when **every field** agrees within the
same `namespace` and `data_type`, so the name decides whether a concept converges or
forks: a synonym (`speed_mbps` vs `transfer_speed_mbps`) splits one concept into two
specs that never match. So coin for the match:

- **One concept, one spelling.** Reuse the exact `ns.key`, `display_name`,
  `data_type`, and `unit` you already coined for that concept — verbatim, across
  every domain (consult a sibling method with `sil_profile_get` only when the
  concept plausibly recurs, never an exhaustive scan).
- **Common attribute → conventional name.** For a widely-shared attribute you have
  **not** coined before (screen size, weight, RAM, waterproof rating, material…),
  take its **conventional** name — a Schelling point, there being no registry to
  read. Coin fresh only for a genuinely niche attribute.
- **Corroborate the name.** Carry a concept-naming **`description`** — the
  **corroborator** the dedupe leans on to merge synonyms and keep distinct concepts
  apart — and get **`data_type`** and **`namespace`** right, the hard floors a wrong
  value forks the concept past.

Submit the definitions to **`sil_specs`** (dedupe-or-create) and adopt the returned
**canonical** `ns.key`: **`matched`** → an equivalent exists, **drop your synonym for
the canonical**; **`created`** → yours is novel and canonical going forward (keep it).
Rewrite the `## Search vocabulary` and any PRD `## Search specs` predicates to those
names before persisting — the method is **born canonical**, never write-then-fix. This
is what makes `filters.specs` filter across methods; naming is never a gate — a
fragmenting name costs precision, never blocks a search. If `sil_specs` is **not
`ok`** (a registry blip), **do not block the mint**: persist the **raw coined names**
(every predicate reads `applied:false`) and shop on — convergence retries next
mint/refresh. Canonicalization is **silent to the buyer**: never surface `ns.key`
plumbing.

## REFRESH — signal-driven (HIT, stale)

A plain revisit LOADS; a refresh fires **only on a signal** — never on a TTL, not
every revisit. The three signals: the buyer **contradicts** the guide, the
**volatility marker** is overdue, or the buyer **explicitly asks**. Signal-driven,
not a clock.

Refresh is a **reconciled `write`**: load the current method, re-research **only** the
stale volatile material, **carry every buyer-authored line forward verbatim**, and
`sil_learn write` (`target: "method"`) the whole reconciled body — announce the delta.
The rewrite supersedes stale *research* claims and **never clobbers** a buyer line. The
method stays fully buyer-mutable — every edit is a `write` of the reconciled whole.

Canonicalize any **newly-coined** specs via `sil_specs` before persisting — same
convergence discipline (reuse a name already coined for the concept; take the
conventional name for a common attribute), resubmitting **only** specs not yet
carrying a canonical name (already-canonical names are stable).

## Intent-keyed PRDs

A PRD's identity is the **job-to-be-done**, keyed by three coordinates so it stays
queryable: `{ domain, product, intent }` → `ski/gloves-slope` (intent always present;
a context-free request keys `general`). It holds the method's dimensions **resolved to
this job** — the buyer's actual values — **specialized, never a copy of the method's
guide**. PRDs are **durable** and **revisitable** — re-buying the same thing, or
resuming an unfinished session, **recovers** the PRD, never rebuilds it. The PRD body
carries these sections:

- **`## Search specs`** — the load-bearing block: the **resolved predicate set**, a
  list of `{ ns, key, op, value, unit?, hard? }` entries **projected verbatim** into
  `sil_search`'s `filters.specs` at Beat 4 (one entry per decided dimension, keys drawn
  from the method's `## Search vocabulary`). A *"prefer X, Y/Z acceptable"* requirement
  is **one `op:in` set** over `{X, Y, Z}` — mark it `hard` only when a miss must
  reject-at-pick — with the X-preference applied as **Beat-5 ranking**, **never** a hard
  `eq` on X alone (that rejects the acceptable alternatives and empties the set).
- **`## Filled preferences`** — the buyer's stated durable answers, reconciled: **one
  truth per dimension**. A correction **rewrites** the line it changes; it never adds a
  second, contradicting one.
- **`## Notes / open`** — declined or unresolved dimensions, so the next session
  recovers rather than re-asks. A **non-answer** ("no budget stated") lives here,
  **never** as a preference.

Every PRD write is a whole-body **`sil_learn write`** (or **`create`** for the first
mint): read the current PRD, reconcile in context, write the coherent whole — so the
`## Search specs` block and `## Filled preferences` never drift apart or self-contradict.

## The store — frontmatter-as-truth (no manifest)

Artefacts live at `shopper/domains/<slug>/{method.md, prds/<product>-<intent>.md,
assets/}`. There is **no manifest** — each file's own **frontmatter** IS the truth,
discovered by a filesystem **scan** over those coordinates. Malformed frontmatter is
skipped and surfaced as `unreadable`, never half-read.

## Discovery + manage

- **Discover / reuse-before-mint** with **`sil_profile_search`** — queries artefact
  **frontmatter**, returns **coordinates** only (no bodies): the learned domains and
  their PRDs. The frontmatter-as-truth query, **not a manifest** and not a
  filesystem guess. The no-filter call is the "what does my shopper know?" overview.
- **Read one body** with **`sil_profile_get`** — `domainSlug` for the method body,
  `+prd` for that PRD's body. **Read before every `write`** — reconcile from the real
  current body, never from memory.
- **Remove** with **`sil_profile_remove`** — `domainSlug` alone removes the **whole
  domain** subtree; `+prd` removes **just that PRD** (method + siblings survive).
  Destructive: **confirm** with the buyer first.
