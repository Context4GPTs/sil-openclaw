---
name: fill-ask-feedback-verdict
description: Beats 3, 4, 7 and 8 of the shopping loop. Beat 3 FILL resolves the Brief's spec rows from what is already held; Beat 4 ASK is the one gate for what is still open and load-bearing, and owns the ## Notes / open surface; Beat 7 FEEDBACK captures what the reaction surfaced; Beat 8 VERDICT is the out-of-band did-it-work read. All four write through shopping_doc_write. Load within an active sil shopping loop.
---

# The four writing beats — FILL · ASK · FEEDBACK · VERDICT

All four persist the same way: `shopping_doc_read` the target, reconcile in context, then
`shopping_doc_write { mode: "replace" }` the **whole** body back. There is no append and no
section patch, so a correction rewrites the line it changes and never stacks a second,
contradicting one.

## Beat 3 — FILL: resolve from what you already hold

**Read the shopper FIRST, then the guide.** `## Shopping` (root plus every
ancestor-or-self section of this item's domain, nearest first) · `## Fit` ·
`## Constraints` · `## Past purchases` — and only then the guide, whose job is to
**translate** those facts and fill what the buyer left open. That order is what keeps a
shared, deliberately impersonal guide from writing a repeat buyer's Brief; the guide
frames the job only on a true cold start.

**Translate, don't reference.** The shopper document says *"foot wide, ~104 mm"* and
*"wool is out"*; the guide says a shell should clear the ball by ~2 mm; the Brief ends
with `last_width gte 102` and `fibre_wool_pct eq 0` — **neither of which appears in
either source**. The fact is durable, the conversion is domain knowledge, and the
spec row is this job's.

**Precedence, first hit wins:**

> what the buyer said in THIS job > a **selected** thing's specs, translated > a
> **resident** thing's specs, translated > a shopper fact, translated (nearest
> `## Shopping` section first) > the guide's default > nothing at all

Every thing you read lands in **`## Working from`** — an unrecorded read is a nag; a
recorded one is a link the buyer can check and delete.

**Compile both tables.** Each resolved dimension becomes a row in `## Hard constraints`
or `## Preferences` — the section IS the hardness. Keys come from what the domain read
returned, verbatim. **A hard row is never filled around**: the veto applies at pick
(Beat 6), never during fill. A *"prefer X, Y/Z acceptable"* requirement is **one `op: in`
set** over `{X, Y, Z}` with the X-preference weighed as Beat-6 judgment — never a hard
`eq` on X alone, which rejects the acceptable alternatives and empties the set.

**Write each item's `applies:` line** — the materialized partition, **keys only, never
values**: for item domain D, every row whose `domain` is ancestor-or-self of D. Decided
once, visible in the document, checkable. Restating the values is how a corrected row
and its copy come to disagree.

**FILL's job is to RESOLVE, and it stops there.** What it could not resolve is handed
untouched to Beat 4 ASK, which is the only beat that puts a question to the buyer.

## Beat 4 — ASK: one gate, and it owns `## Notes / open`

ASK is a **beat**, not a step inside fill, and that is the whole point: `## Notes / open`
has to be a **surface** the next session reads, not a record it writes and forgets.

**When.** After fill has resolved all it can for an item, and **before that item's first
`shopping_search` call**. No search is issued for an item whose ASK has not run.

**What qualifies — all three, or it is not asked.** The dimension is (1) still
unresolved, (2) load-bearing *per the guide* — the guide is what says it decides the buy
— and (3) not answerable from a defensible default. **On a warm domain ASK asks nothing
and the loop passes straight to Beat 5, and that is the common case.**

**Its input is last session's `## Notes / open` rows.** Read them back and re-ask **only**
what is still unresolved and still load-bearing. The section is consumed, not merely
written.

**How to ask.** A **few at a time, never a battery**. Each question carries **why it
decides the buy**, in the guide's own terms. The turn **plays back the filled
understanding** so a mis-translation is as cheap for the buyer to correct as an answer is
to give. **Two items both holding an open dimension are merged into ONE turn** — per-item
beats do not mean per-item interrogations.

**Elicitation gates QUALITY, never ACCESS.** A declined question, or one the buyer simply
does not answer, still searches: proceed on the **best defensible reading**, **state the
assumption in the same turn** ("assuming waterproofing, since it's for the slope"), and
write the dimension as a **`## Notes / open` row**. A half-resolved Brief runs.

**ASK has two entry points.** Here, and again from Beat 6 when not-verified dominates the
surviving set or the guide marks the risk unrecoverable after purchase. Neither of them
is inside fill.

## Beat 7 — FEEDBACK: the reaction is the signal

The buyer's reaction to the results is the loop's workhorse signal — the rule-out, the
pick, the recurring correction. Write the item's and the Brief's `status`, and the
matching `## Shopping` section when the signal earns it.

**Capture is silent — an open store, no confirm.** Every confirm costs a question, and
what replaces the gate is **visibility**: the shopper document is readable whole with
`shopping_doc_read`, and any line in it is one turn from gone.

**Three disciplines, and each one is a veto on writing:**

- **A this-pick reaction is never written.** *"Too pricey this time"* is about today.
- **Only what the buyer said or did** — never a value that arrived from the guide, and
  never one you inferred from the shortlist.
- **Broadest-true placement.** A fact true in every domain goes to the root; taste true in
  one goes to that domain's `### <domain-path>` section. Enriching an ancestor beats
  minting a leaf.

**Re-derive the touched section, never append.** Read the shopper document, fold the
signal into the coherent whole, write the whole thing back.

## Beat 8 — VERDICT: did the thing actually work?

**Out of band** — days or weeks after the buy, **once per bought item**. It is the loop's
sparse falsifier: sil has no checkout, so a click proves nothing, and Beat 7 is the
workhorse.

**The trigger is Beat 2's exact-by-domain recall**: a prior Brief in this domain is `done`
and its pick carries no `## Past purchases` row. **No timer, no counting threshold** — the
buyer is already in the domain, which is what makes the question cheap. **At most one
verdict ask per session**, on the **oldest** undecided pick, and it opens the session
**before the new job's fill**.

**Ask one plain question, naming the actual thing** — *"before we shop boots again: how
did the Salomons work out?"* — not a survey, not a rating scale.

**An answer writes three places, in one `shopping_doc_write { ref: "shopper", mode:
"replace" }`:**

1. **A `## Past purchases` row** — what · when · verdict · **why**.
2. **`## Fit`** — a row, but **only when the size taught something**.
3. **Every `## Shopping` section the answer contradicts, RE-DERIVED WHOLE** — the
   contradicted line rewritten, never caveated and never a second appended line beside
   it. `## Shopping` says where the buyer is now; `## Past purchases` is the dated
   evidence for why.

**The why is the buyer's own reason.** A verdict with no why falsifies nothing, and an
inferred why is worse than none — never derive it from the pick, the guide or the price.
On a bare `good` / `bad`, **ask once** for the reason and write the row either way,
leaving the why **empty** rather than fabricating one.

**A decline writes nothing**, is not repeated that session, and does not touch the new
job — the buyer came here to shop.

**What Beat 8 does NOT do, in this version.** It writes the shopper's own document and
nothing else: **no review is written, no review tool is called** (none exists), and the
shopper never offers to publish or share the verdict.
