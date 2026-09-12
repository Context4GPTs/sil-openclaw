---
name: shop-loop
description: The eight-beat shopping loop — the state machine the shopper runs on every job. Owns Beat 1 (BRIEF), Beat 5 (SEARCH) and Beat 6 (REFLECT); routes Beats 2, 3, 4, 7 and 8 to the references that own them. Load when shopping as the shopper.
---

# The eight-beat shopping loop

One job is one **Brief** — one thing or several, one domain or several, no structural
difference. The loop has **eight beats**, and they do not all run at the same rate:

| # | Beat | Cadence | Owned by |
|---|---|---|---|
| 1 | **BRIEF** — scope the job in the buyer's words | **once per job** | here |
| 2 | **DOMAIN** — resolve the item's category, adopt its guide | **per item** | [`domain_and_brief.md`](domain_and_brief.md) |
| 3 | **FILL** — resolve the spec rows from what you already hold | **per item** | [`fill_and_feedback.md`](fill_and_feedback.md) |
| 4 | **ASK** — the one gate for what is still open and load-bearing | **per item** | [`fill_and_feedback.md`](fill_and_feedback.md) |
| 5 | **SEARCH** — the bounded fan-out | **per item** | here |
| 6 | **REFLECT** — veto on three states, then judge | **per item** | here |
| 7 | **FEEDBACK** — capture what the reaction surfaced | **per item** | [`fill_and_feedback.md`](fill_and_feedback.md) |
| 8 | **VERDICT** — did the thing actually work? | **out of band, once per bought item** | [`fill_and_feedback.md`](fill_and_feedback.md) |

**The cadence is the shape.** BRIEF decides scope once; running it again per item
silently re-scopes the job. Beats 2–7 run **once per item**, independently — two items
get two domain resolutions, two fills, two fan-outs. VERDICT is not in this run at all:
it fires days or weeks later, and Beat 2's recall is what raises it.

This file owns Beats 1, 5 and 6.

## Beat 1 — BRIEF: scope the job, in the buyer's words, before any domain

**Recall first** — `shopping_doc_find { kind: "brief", query: <the buyer's own words> }`
is a **text** recall, and when an open Brief already covers this job you **reuse it**
rather than open a second Brief for one job. This is the first of two recalls and it does
not replace the second: Beat 2 runs an **exact-by-domain** recall over a different
question, and neither subsumes the other.

**Then decide scope, and only scope.** The Brief gets an `## Items` table with **one row
per thing being bought**, and one **prose subsection per row** carrying that thing in the
buyer's own words. **No domains yet** — classification is Beat 2's job, per item.

- **An unclassified item is a legal, writable state.** When the category is not settled,
  write the row with an **empty domain cell** and carry on. It is never an error, never a
  question that has to be answered first, and never a reason to hold up the job.
- **The `item` label is the key, not the domain** — it is what the buyer calls the thing.
- **`## Context` is job-level background** — the trip, the occasion, the total budget.
  It is reasoned over; it is never sent as a search query.

Write it with `shopping_doc_write { ref: "brief:<slug>", mode: "create", title, status:
"active" }`, body = the whole markdown. The document model, section by section, is in
[`domain_and_brief.md`](domain_and_brief.md).

**Completion is arithmetic, not judgment.** *Am I done?* is the count of `## Items` rows
still `open`. **A pick ends an item, never the job** — on a two-item job with one picked
and one open, the job is open, and saying otherwise abandons the second thing the buyer
asked for.

## Beat 5 — SEARCH: a bounded, priority-ordered fan-out, PER ITEM

Beat 5 **projects** what Beats 3–4 resolved; it never re-derives it. For **each item**:

- **`specs`** — every `## Hard constraints` and `## Preferences` row whose `domain` is
  **ancestor-or-self** of that item's domain, sent as `{ key, op, value, currency? }`.
  `product.fibre_wool_pct = 0` reaches every item; a boots-scoped row reaches the boots
  only. `price` is a key every domain has without the read listing it, and its
  `currency` is **required** — sil holds no exchange rate. Hardness is the row's
  **section**, not a wire field — it is Beat 6 that enforces it.
- **`query`** — that item's own subsection prose, which **you author**. The plugin is pure
  transport and never folds a spec row into `query`.
- **`n`** is a spend knob (the web leg fetches candidates to fill it) — choose it for the
  actual need rather than always asking for the ceiling.

**The bound is ≤ 4 priority-ordered `shopping_search` calls PER ITEM.** It is never spent
across the whole job: each item gets its own fan-out, and halving one item's budget
because another item spent it is not the bound, it is a bug.

- **Call 1 is the tightest projection.** **Calls 2–4 are deliberate widenings**: relax the
  least load-bearing **soft** row, an adjacent phrasing that lifts recall, or an explicit
  either/or branch. **A hard row is never relaxed.**
- **Merge = dedup + concatenate in issue order — never a re-rank.** Issue order *is*
  priority order: the server owns order within a call, the fan-out across calls.
- **Items are searched concurrently** — they are independent, and the server's own
  per-host and per-principal ceilings bound the blast radius.
- **Then read each product's `fit`, row by row.** It carries the value sil holds for
  every product-level key the ask named, and nothing else. A key absent from it is a
  named gap — sil holds no value for it — and never a reason to drop a product. It is
  what Beat 6 reads.

**Beat 5's reads are four, and only four:** `shopping_search`, `shopping_product_get`
(the whole dossier on a shortlisted variant), `shopping_offers` (dated prices per seller,
read live) and `shopping_seller_get` (whether that seller ships to the buyer, and on what
terms). There is no review read in this version and none is named; do not invent one, and
do not substitute the open web.

## Beat 6 — REFLECT: veto first, on three states, then judge

Take Beat 5's merged issue-order list and each product's `fit`. Run
**veto → ask-or-judge → branch**, and **never re-rank**: the server owns order, you own
the verdict.

**1 — The veto, first.** Sort every survivor against each *hard* row into exactly one of
three buckets, from what sil actually handed you — the value under that key in `fit`, the
`variants` that came back, and the currency each price is in:

- **VIOLATED** — `fit` carries the key **and** the value sil holds fails the hard row.
  Out; it never becomes the pick. A requested variant spec is failed the same way: an
  empty `variants` says no listed option fits.
- **NOT VERIFIED** — the key is **absent from `fit`**, so sil holds no value for it, or
  the only evidence is `webpage_info` (the page's own words, which sil has not read yet),
  or the price is in a currency the buyer's bound could not be tested against. It stays
  in, **flagged**, with the missing key named. Never silently passed and never silently
  dropped.
- **VERIFIED** — `fit` carries the key and the value passes.

`webpage_info` never vetoes on its own: a product carrying it is a real listing whose
values sil has not read yet, so it lands in NOT VERIFIED, never in VIOLATED. The
**absence** of `webpage_info` is the positive signal — those values were verified.

**Job arithmetic runs here too** — a total budget stated in `## Context` is summed across
the job's picks at pick time, never turned into a spec row.

**2 — Re-enter ASK when the set cannot answer.** When **not-verified dominates** the
surviving set, or the guide marks the risk **unrecoverable after purchase**, go back to
**Beat 4 ASK** before presenting anything. That is ASK's second entry point.

**3 — Judge, then branch.** Weigh the best surviving candidate against the Brief and the
guide. Satisfies-or-falls-short is a **judgment**, not a threshold and not a mechanical
any-unmet-row rule — read the whole set. Before you recommend, open the pick:
`shopping_product_get` for the whole dossier and where each reading came from,
`shopping_offers` for who sells it and at what dated price, `shopping_seller_get` for
whether that seller reaches the buyer.

- **Satisfies → a hero + 1–2 justified alternatives.** Lead with **one** recommendation
  carrying the *why* (a met row, a guide mechanic, a stored fact reused without
  re-asking), then one or two considered **alternatives**, each with a one-line reason.
  Best-first **as returned** — never a re-rank, never a bare list.
- **Shortfall or empty → propose a specific relaxation and wait.** Name the gap, show the
  closest survivors, **propose** the specific change that would widen it, then **wait**.
  No silent re-search, no silent auto-widen; the buyer can redirect instead.

A **non-`ok`** status is not an empty match — do not relax the ask; follow that tool's own
**`recovery`** exactly.

**Then Beat 7.** The buyer's reaction is what Beat 7 captures —
[`fill_and_feedback.md`](fill_and_feedback.md).
