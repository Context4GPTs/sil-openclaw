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
— **no research, and no registry read**. This is the default on every revisit; the
method is **recovered, never rebuilt**. Loading its `## Search vocabulary` brings that
domain's spec keys into context for Beat 4. A method that already records a settled
registry path is searched with **no `sil_domain_find` call at all** — the registry read
is the cold path's first move, never a per-search toll.

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

**sil's registry is the first place you explore — before the web.** It is the cheapest
read you have, and what it returns is what every other shopper already agreed to call
things. `sil_domain_find` runs *while* `## Search vocabulary` is being composed, so an
adopted path and its keys are recorded at creation rather than retrofitted afterwards;
the block below owns the detail.

Persist with **`sil_learn create`** (`target: "method"`, domain + name + body) — the
file **is** the registration (it errors if the method already exists: a revisit LOADs,
a stale one REFRESHes with `write`). Never the setup-only `sil_profile_materialize`.
Then **announce** the inferred domain so the buyer can correct it. The method body
carries these sections, and only these:

- **`## How it's bought`** — the buying guide: load-bearing attributes, failure modes,
  what separates a good buy from a bad one — general to the category, not this buyer.
- **`## Search vocabulary`** — the spec **dimensions** that decide a buy (`key` +
  `data_type` + unit + `allowed_values` + why-it-matters) — names only, **no values**.
- **`## Durable taste`** — the buyer's cross-intent per-domain taste, seeded from
  `user_spec` (omit until something durable is known).
- **`## Volatility`** — the volatile axis + a rough refresh cadence.

**The registry owns the spelling, and `sil_domain_find` is how you read it.** A `key`
sil holds is what a predicate can be evaluated against; a synonym (`speed_mbps` vs
`transfer_speed_mbps`) is simply outside the resolved vocabulary and comes back
`applied: false` — a named gap, never a filter. So:

- **Read in the buyer's own words, not a path guess.** `sil_domain_find`'s `q` is
  matched against each standing category's path text *and* its buying guide, so prose
  reaches a settled path that a path-shaped guess walks straight past. Budget: **at
  most 2 discovery reads** — the buyer's ask verbatim, then the plain category name
  only if the first returned nothing — **plus 1 `path` probe**. The probe asks a
  different question and does **not** count against the two: **≤2 + 1**.
- **Judge fit on the returned `guide`, never on how a path reads.** Four verdicts:
  - **adopt** — a guide describing *this* category ⇒ take that path verbatim, copy its
    `specs` keys into `## Search vocabulary`, coin nothing.
  - **descend** — a guide describing a *broader* category ⇒ the only mint permitted is
    a **descendant** of that path, never a sibling and never a re-rooted one.
  - **mint licensed** — a **`q` discovery read** came back `matches: []` beside
    `capped: false` ⇒ research, probe, coin. Only that read licenses a mint: a `path`
    probe never licenses one — it answers about the path you already guessed, and its
    `exists: false` is silent about the standing path under a different parent, the
    fork this route exists to prevent.
  - **narrow** — `capped: true` ⇒ the answer was bounded and the standing path may sit
    just past it. Sharpen the ask, read once more; the mint is **not** licensed.
- **One concept, one spelling — take the key sil already holds.** A domain in the
  registry resolves its own vocabulary; write those keys down here verbatim rather
  than coining beside them.
- **Coining is `sil_domain_create`'s job, once, for a NEW category** — its `specs` are
  the first keys of a path sil did not have. `path`-probe the exact path you are about
  to coin and write **only the keys it does not already inherit**: on `exists: false`
  the probe still returns the vocabulary that path would inherit, and the mint answers
  with the keys you handed it, so a skipped probe re-coins `brand` or `weight` off the
  root and forks the vocabulary on your first predicate. An existing path is refused
  and nothing is written; never coin a near-path variant to route around that refusal.
- **Common attribute → conventional name.** When you are coining a new category's first
  keys, a widely-shared attribute (screen size, weight, RAM, waterproof rating,
  material…) takes its **conventional** name. Coin fresh only for a genuinely niche one.
- **A read that did not return is not a read that returned nothing.** Any non-`ok`
  status — `invalid_request`, a transient, `not_registered` — leaves the mint out of
  reach: settle the read, never coin around it. And when `sil_search` refuses, its two
  refusals read alike, so `path`-probe the domain you submitted and let the stated
  `exists` decide — `true` means fix the predicate and re-issue, `false` means the
  domain was the problem. `false` ends the probe's job, not the discipline: read again
  in the buyer's own words (`q`), and coin only if that discovery read returns
  `matches: []` with `capped: false`. A permanent global write is never entered off
  refusal prose, and never off a probe.
- **A provisional match (`validated_at: null`) is adopted like any other.** It keeps its
  place in the answer, and re-minting it earns a refusal. Its first answers come from
  the web while sil catches up — say that to the buyer; every result and seller it
  named stays on the table.

Naming is never a gate — an unresolved key costs precision, never blocks a search — and
it is **silent to the buyer**: never surface key plumbing. Only the **keys** are
adopted: the registry's `guide` is the evidence you judge fit on, while
`## How it's bought` stays your own research.

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

Coin any new dimension under the same naming discipline as the mint.

## Intent-keyed PRDs

A PRD's identity is the **job-to-be-done**, keyed by three coordinates so it stays
queryable: `{ domain, product, intent }` → `ski/gloves-slope` (intent always present;
a context-free request keys `general`). It holds the method's dimensions **resolved to
this job** — the buyer's actual values — **specialized, never a copy of the method's
guide**. PRDs are **durable** and **revisitable** — re-buying the same thing, or
resuming an unfinished session, **recovers** the PRD, never rebuilds it. The PRD body
carries these sections:

- **`## Search specs`** — the load-bearing block: the **resolved predicate set**, a
  list of `{ key, op, value, currency?, hard? }` entries **projected** into
  `sil_search`'s `predicates` at Beat 4 (one entry per decided dimension, keys drawn
  from the method's `## Search vocabulary`). `currency` is **required** on a money
  predicate; `hard` is the shopper's own marker and stays here — the wire has no such
  field, and Beat 5 is where it is enforced. A *"prefer X, Y/Z acceptable"* requirement
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
