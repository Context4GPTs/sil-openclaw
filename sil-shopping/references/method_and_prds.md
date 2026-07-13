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

The coined vocabulary is canonicalized via `sil_specs` only where that endpoint
exists (Phase 3). Until then it is **coined-and-used raw** — every predicate reads
`applied:false`, so `sil_specs` is **not** called and nothing is stubbed.

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
