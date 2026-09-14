---
name: shop-loop
description: The eight-beat shopping loop — the state machine this agent runs on every job. Owns Beat 1 (BRIEF), Beat 5 (SEARCH) and Beat 6 (REFLECT); routes Beats 2, 3, 4, 7 and 8 to the references that own them. Load on a shopping intent.
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
per thing being bought**, and one **prose subsection per row**: the buyer's own words for
that thing, **one sentence**, never a specification restated from the spec rows and never
grown as facts arrive — the rows carry the facts, and a widening edits a row, not the
sentence. **No domains yet** — classification is Beat 2's job, per item.

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

Beat 5 **projects** what Beats 3–4 resolved; it never re-derives it. **Call
`shopping_brief_compile { ref, item }` per item** and send what it answers:

- **`domain`, `query` and `specs`** go to `shopping_search`. `query` is that item's
  subsection as it stands — the buyer's one sentence, never a specification rebuilt from
  the spec rows. `specs` is every `## Hard constraints` and `## Preferences` row whose
  `domain` is **ancestor-or-self** of that item's domain. `price` is a key every domain
  has without the read listing it, and its `currency` is **required** — sil holds no
  exchange rate. Hardness is the row's **section**, not a wire field — it is Beat 6 that
  enforces it.
- **`seller_specs`** is not sent here at all. It is Beat 6's ask, on the shortlisted
  variants, and it is answered **per offer**.
- **You add `n`** — a spend knob (the web leg fetches candidates to fill it), chosen for
  the actual need rather than always the ceiling.
- **You add `ship_to`** — the address **label** the buyer's `## Constraints` names, and
  **nothing at all** when it names none: sil then uses their default address. It is a
  label as `sil_whoami` lists them, never a country, and it localizes the search to that
  address without changing what is asked.

**Pass the compiled body through — never re-type it.** Copy `domain`, `query` and the
`specs` array into the call exactly as they came back: **every value as it was answered**,
a money value a decimal **string** (`"300"` — not `300`, not `"300.00"`). Re-typing a
value is how a perfectly good row gets refused and the call is spent for nothing.

A **widening is an edit to the Brief and a second compile**, never a row rewritten on the
wire — otherwise the Brief stops being what the next session reuses, and the widening is
gone with the turn.

**The bound is ≤ 4 priority-ordered `shopping_search` calls PER ITEM.** It is never spent
across the whole job: each item gets its own fan-out, and halving one item's budget
because another item spent it is not the bound, it is a bug.

- **Call 1 is the tightest projection.** **Calls 2–4 are deliberate widenings**: relax the
  least load-bearing **soft** row, an adjacent phrasing that lifts recall, or an explicit
  either/or branch. **A hard row is never relaxed.**
- **A relaxation is searched before it is proposed.** Beat 6 offers the buyer only a
  widening it has already seen reach a product — never a guess at one.
- **Merge = dedup + concatenate in issue order — never a re-rank.** Issue order *is*
  priority order: the server owns order within a call, the fan-out across calls.
- **Items are searched concurrently** — they are independent, and the server's own
  per-host and per-principal ceilings bound the blast radius.
- **Then read each product's `fit`, row by row.** It carries the value sil holds for
  every product-level key the ask named, and nothing else. A key absent from it is a
  named gap — sil holds no value for it, a key the domain does not hold included — and
  never a reason to drop a product. It is what Beat 6 reads.

**Beat 5's reads are four, and only four:** `shopping_search`, `shopping_product_get`
(the whole dossier on a shortlisted variant), `shopping_offers` (dated prices and the
seller terms you asked for, per offer, read live) and `shopping_seller_get` (one seller's
whole terms). There is no review read in this version and none is named; do not invent
one, and do not substitute the open web.

## Beat 6 — REFLECT: veto first, on three states, then judge

Take Beat 5's merged issue-order list and each product's `fit`. Run
**veto → ask-or-judge → branch**, and **never re-rank**: the server owns order, you own
the verdict.

**0 — Price the shortlist, on the buyer's own terms.** Call `shopping_offers` with the
shortlisted variant ids, the compile's **`seller_specs`**, and the same **`ship_to`**
label. Each offer comes back with `seller_fit`: `ships` always, and each seller row you
asked for, answered for **that** seller. The seller rows are vetoed here — never on the
product, which knows nothing about who sells it.

**1 — The veto, first.** Sort every survivor against each *hard* row into exactly one of
three buckets, from what sil actually handed you — the value under that key in `fit`, the
value under that key in an offer's `seller_fit`, the `variants` that came back, and the
currency each price is in:

- **VIOLATED** — `fit` carries the key **and** the value sil holds fails the hard row.
  Out; it never becomes the pick. A requested variant spec is failed the same way: an
  empty `variants` says no listed option fits. On the seller side, `ships:
  not_serviceable` against a ships-to need is VIOLATED for that offer — sil read that
  seller's policy and it excludes the address — as is a `seller_fit` value that fails its
  row. A product is out only when **every** offer for it is.
- **NOT VERIFIED** — the key is **absent from `fit`**, so sil holds no value for it (a
  key the domain does not hold included: it was sent, recorded, and answered absent), or
  the only evidence is `webpage_info` (the page's own words, which sil has not read yet),
  or the price is in a currency the buyer's bound could not be tested against. On the
  seller side: `ships: unknown`, and a requested seller key **absent from `seller_fit`** —
  a term sil has not read, never a term the seller lacks. It stays
  in, **flagged**, with the missing key named. Never silently passed and never silently
  dropped.
- **VERIFIED** — `fit` or that offer's `seller_fit` carries the key and the value passes.

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
`shopping_product_get` for the whole dossier and where each reading came from, and
`shopping_seller_get` for the chosen seller's whole terms — `specs`, its routes and its
returns — beside the `seller_fit` the offer already answered.

- **Satisfies → a hero + 1–2 justified alternatives.** Lead with **one** recommendation
  carrying the *why* (a met row, a guide mechanic, a stored fact reused without
  re-asking), then one or two considered **alternatives**, each with a one-line reason.
  Best-first **as returned** — never a re-rank, never a bare list.
- **Shortfall or empty → propose a specific relaxation and wait.** Name the gap, show the
  closest survivors, **propose** the specific change that would widen it, then **wait**.
  No silent re-search, no silent auto-widen. **An answer that does not choose the widening
  is not a yes** — every hard row stands, the shortfall is restated as it was, and the
  buyer can redirect instead.

A **non-`ok`** status is not an empty match — do not relax the ask; follow that tool's own
**`recovery`** exactly.

**Then Beat 7.** The buyer's reaction is what Beat 7 captures —
[`fill_and_feedback.md`](fill_and_feedback.md).
