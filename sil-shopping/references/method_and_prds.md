---
name: method-and-prds
description: Beat 2 of the loop — load, mint or signal-refresh a domain's method — plus the intent-keyed PRD model, the frontmatter-as-truth store, and discovery/manage via sil_profile_search / sil_profile_get / sil_profile_remove. Load when resolving a domain's method or managing what the shopper knows.
---

# Beat 2 — the domain method, intent-keyed PRDs, and the store

Beat 1 hands off a resolved `domain` — a **HIT** (the method exists) or a **MISS**
(no method yet). Beat 2 turns that into a method body in context, ready for Beat 3
to fill. Three paths, not one.

## LOAD — the hot path (HIT, fresh)

A plain revisit **LOADS**: `sil_profile_get(domain)` reads the durable method body
— **no research**, no round-trip. This is the default on every revisit; the method
is **recovered, never rebuilt**. Loading the method's `## Search vocabulary` also
brings its coined `ns.key` dimensions into context for Beat 4.

## MINT — cold (MISS)

No method exists, so **research** the niche (a web tool where available, else
public knowledge stated plainly) and **mint** one. Draft the buying guide + the
buyer's durable per-domain taste (seeded from `user_spec`) + the whole-domain
**spec vocabulary** you **coin** from the research (`ns.key` + data type + unit +
why-it-matters) + a **volatility marker** (the domain's volatile axis + rough
cadence). Persist with **`sil_learn create`** — `target: "method"`, with the domain
+ name + body — the file **is** the registration. The mint verb is **`sil_learn
create`**, never the **setup-only** `sil_profile_materialize` (which writes only the
shared `user_spec.md` and mints no domain). Then **announce** the inferred domain so
the buyer can correct it.

The coined vocabulary is **coined to converge, then canonicalized before persist**.
`sil_specs` is **precision-first** — two coined specs converge only when **every field**
agrees within the same `namespace` and `data_type`, so the name you coin decides whether a
concept converges or forks: a synonym (`speed_mbps` vs `transfer_speed_mbps`) splits one
concept into two specs that never match. So coin for the match. **One concept,
one spelling:** reuse the exact `ns.key`, `display_name`, `data_type`, and `unit` you
already coined for that concept — verbatim, across every domain (consult a sibling
method with `sil_profile_get` only when the concept plausibly recurs, never an
exhaustive scan). For a common, widely-shared attribute you have **not** coined before
(screen size, weight, RAM, waterproof rating, material…), take its **conventional**
name over a personal synonym — a Schelling point, since there is no registry to read.
Coin a fresh name only for a genuinely niche attribute. On each coined spec carry a
concept-naming **`description`** — the load-bearing **corroborator** the dedupe leans on
to merge true synonyms and the veto that keeps distinct concepts apart — and get
**`data_type`** and **`namespace`** right, the hard floors a wrong value forks the
concept past. Then submit the coined spec
definitions to **`sil_specs`** (dedupe-or-create) and adopt the returned **canonical**
`ns.key` for every spec: a **`matched`** result means an equivalent canonical spec
already exists — **drop your coined synonym and adopt the canonical name**; a
**`created`** result means yours is novel and is canonical going forward (keep it).
Rewrite the method's `## Search vocabulary` and any PRD `specs` predicates to those
canonical names, then persist — the method is **born canonical**, never
write-then-amend. This convergence is what makes `filters.specs` actually filter
across methods; good naming is never a gate — a fragmenting name never blocks a
search, it only costs precision. If `sil_specs` is **not `ok`** (a registry blip),
**do not block the mint**: persist with the **raw coined names** (every predicate
reads `applied:false`) and shop on — convergence retries on the next mint/refresh.
Canonicalization is **silent to the buyer**: never surface `ns.key` plumbing.

## REFRESH — signal-driven (HIT, stale)

A plain revisit LOADS; a refresh fires **only on a signal**, never on a TTL and
**not every revisit**. The three signals: the buyer **contradicts** the guide, the
method's own **volatility marker** is overdue, or the buyer **explicitly asks**. So
refresh is **signal-driven** — `contradict` · overdue volatility `marker` ·
`explicit ask` — not a clock.

Refresh is **create-with-merge**: load the current method, re-research **only** the
stale volatile material, **carry every buyer-authored line forward verbatim**,
re-emit the whole body via `sil_learn create` (overwrite), and announce the delta.
The merge **preserves** every **buyer** `sil_learn` edit — it rewrites stale
*research* claims and **never clobbers** a buyer edit. The method is fully
buyer-mutable at any time via `sil_learn` append/amend/retract.

Canonicalize any **newly-coined** specs via `sil_specs` before persisting the
refreshed method — coin them with the same convergence discipline (reuse a name you
already coined for the concept; take the conventional name for a common attribute)
and resubmit **only** the specs not yet carrying a canonical name (already-canonical
names are stable; do not resubmit them).

## Intent-keyed PRDs

A PRD's identity is the **job-to-be-done**. Its key carries three coordinates so it
stays queryable: `{ domain, product, intent }` → `ski/gloves-slope`. Intent is
always present (a context-free request keys `general`). A PRD holds the method's
requirements **specialized to this job** plus the buyer's **durable** filled
preferences (the per-job slice; the per-domain durable taste lives in the method).
PRDs are **durable** and **revisitable** — you re-buy the same thing, or you don't
finish in one session, and the PRD is **recovered**, never rebuilt.

## The store — frontmatter-as-truth (no manifest)

Artefacts live at `shopper/domains/<slug>/{method.md, prds/<product>-<intent>.md,
assets/}`. There is **no manifest** — each file's own **frontmatter** IS the source
of truth, discovered by a filesystem **scan** over those **coordinates**. A file
with malformed frontmatter is skipped and surfaced as `unreadable`, never half-read.

## Discovery + manage

- **Discover / reuse-before-mint** with **`sil_profile_search`** — it queries
  artefact **frontmatter** and returns **coordinates** only (no bodies): the
  domains the shopper has learned and its PRDs. This is the frontmatter-as-truth
  query, **not a manifest** and not a filesystem guess. The no-filter call is the
  "what does my shopper know?" overview.
- **Read one body** with **`sil_profile_get`** — `domainSlug` for the method body,
  `+prd` for that PRD's body.
- **Remove** with **`sil_profile_remove`** — `domainSlug` alone removes the
  **whole domain** subtree; `+prd` removes **just that PRD** (method + siblings
  survive). It is destructive: **confirm** with the buyer first.
