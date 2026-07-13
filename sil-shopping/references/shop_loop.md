---
name: shop-loop
description: The six-beat Spec-Driven Shopping loop — the state machine the shopper runs on every niche. Owns Beat 1 (classify), Beat 4 (search-space) and Beat 5 (reflect); routes Beats 2, 3 and 6 to the references that own them. Load when shopping as the shopper.
---

# The six-beat Spec-Driven Shopping loop

As the shopper you run one loop on every request — a **six-beat** state machine.
Most of it is reasoning over what you already know; you only ask the buyer about
the genuine residue. The beats run **in this order**:

1. **Classify** — resolve the request's `{domain, product, intent}` and reuse a
   learned domain/PRD before minting (owned here, below).
2. **Method load / mint / refresh** — recover or research the domain's method +
   its intent-keyed PRDs — [`method_and_prds.md`](method_and_prds.md).
3. **Fill** — resolve the PRD by precedence, eliciting only the residue (Beat 3).
4. **Search-space** — project the filled PRD into a bounded fan-out (owned here).
5. **Reflect** — judge best-available against the PRD + method (owned here).
6. **Feedback** — capture what the reaction surfaced (Beat 6).

Beats 2, 3 and 6 live in their references; this file owns Beats 1, 4 and 5.

## Beat 1 — Classify: `{domain, product, intent}`, reuse before mint

Resolve the request through **three coordinates, top-down**: the **domain** (the
niche that owns the method), the **product** type within it, and the **intent**
(the use-context that reshapes the requirements). **Intent is always present**: a
**context-free** request keys the `general` intent (`ski/boots-general`), so every
job carries all three coordinates and stays uniformly queryable.

**Reuse-before-mint.** Query existing coordinates with **`sil_profile_search`**
(the frontmatter-as-truth discovery tool — never a filesystem guess) and
**semantic-match** the request against them: **prefer existing** when a learned
domain/PRD already covers the job, and only mint when nothing does. The one guard
against over-merging is the requirements-divergence test — two requests share a
PRD only if they resolve to the same requirements.

**Never over-ask just to key.** Keying **never** forces an extra question: a
silent request keys `general` and moves on. When intent is genuinely
requirement-defining but the request is silent, that surfaces as the first Beat-3
question — not a keying interrogation here.

**Announce a mint.** A new-domain or new-PRD mint is **announced** — state the
inferred `domain / product / intent` so the buyer can **correct** it — **never
silent**. A reuse passes through with no announcement.

## Beat 4 — Search-space: a bounded, priority-ordered fan-out (not a re-rank)

Project the filled PRD onto **`sil_search`** as a **bounded ≤ 4 priority-ordered**
fan-out, not one search and not unbounded — the bound is a production budget (each
call is a round-trip + tokens):

- **Call 1 is the tightest projection of the PRD's core** (its load-bearing
  requirements); **calls 2–4 are deliberate widenings** — relax the least
  load-bearing requirement, an adjacent phrasing that improves recall, or an
  explicit either/or branch. **Core first, widenings after** — that is the
  **priority order**.
- **Merge by dedup + concatenate in issue order — this is NOT a re-rank.**
  Concatenate the per-call backend-ranked lists in issue order and **drop** any
  product already **seen** in an earlier call. Because issue order *is* priority
  order, concatenation **never re-ranks** a backend list nor lifts a peripheral
  hit above a core one — the engine owns order *within* each call, the fan-out
  owns order *across* calls.
- **Project onto existing params + query enrichment now.** Map each requirement
  onto the **existing** `sil_search` **param** where one fits (`category`,
  `price_min`/`price_max`, `condition`, `available`, `local_merchants`); a
  requirement with no param folds into the free-text `query`. Leave **`ship_to`**
  empty (the server resolves the registered default). **Never invent** a filter
  that isn't a real param — see
  [`search_param_mapping.md`](search_param_mapping.md).

## Beat 5 — Reflect: honesty pass first, judgment not threshold, propose-and-wait

Take Beat 4's merged issue-order list and its per-call `specs_status`. Run in
order — **honesty pass → judge → branch** — and **never re-rank**: the engine owns
order, you own the verdict.

**1 — Honesty pass, first.** Before judging fitness, walk the survivors and
**reject-at-pick** any candidate that violates a *hard* constraint the backend
could not enforce — exactly the predicates the response marked **`applied:false`**,
plus the `user_spec` `[hard]` markers. A violator is removed from contention, never
the pick; if rejection empties the set, fall through to the empty path.

**2 — Judge, then branch.** Weigh the best surviving candidate against the PRD +
method. Whether it satisfies or falls short is a **judgment** call, **not a
threshold** and not a mechanical any-unmet-requirement rule — read the whole set.

- **Satisfies → a hero + 1–2 justified alternatives.** Lead with **one**
  recommendation carrying the SDS-bar *why* (a met requirement, a researched method
  mechanic, and a stored preference reused without re-asking), then **one or two**
  considered **alternatives**, each with a one-line reason. Best-first **as
  returned** — **never re-rank**, never a bare list.
- **Shortfall or empty → propose a specific relaxation and wait.** Name the gap,
  show the closest survivors, and **propose** the specific change that would widen
  it — then **wait** for the buyer's nod. **No silent re-search** and no silent
  auto-widen; the buyer can redirect instead.

A **non-`ok`** status is not an empty match — do not relax params; follow that
tool's own **`recovery`** exactly.

**Then Beat 6.** The buyer's reaction to the recommendation is what Beat 6 captures
— [`fill_and_feedback.md`](fill_and_feedback.md).
