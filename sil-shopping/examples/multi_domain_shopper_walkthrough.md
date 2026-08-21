---
name: multi-domain-shopper-walkthrough
description: A worked eight-beat run — create one shopper (after endorsement), then a single two-item job across two unrelated categories, showing beat 1 running once, beats 2–7 running per item, one merged ASK turn before any search, and a later session opening with the verdict ask. Illustrative, not a spec.
---

# Worked run — one shopper, one two-item job, eight beats

Illustrative only — authoritative rules live in the beat references.

## Create the shopper (once, after endorsement)

The two-touchpoint interview assembles a draft persona + a seed for the shopper document.
Only after the user **endorses** it does the engine run `openclaw agents add` and write
`user_spec.md` — nothing before that. The result is **one** shopper, a **singleton**. The
seed holds one durable fact — *ships to Berlin; allergic to wool* — true in every category,
so it lives in the shopper document's `## Constraints`.

## The job: "a week in Chamonix — I need boots and a shell"

### Beat 1 — BRIEF (once for the whole job)

`sil_doc_find { kind: "brief", query: "chamonix ski" }` → nothing open. Open one Brief,
`brief:chamonix-feb`, and write **scope only**:

```
## Items
| item  | domain | status |
|---|---|---|
| boots |        | open   |
| shell |        | open   |

### boots
Boots that won't blister — resort, not touring. The rental Langes sat wrong over the instep.

### shell
Something that packs down small. Nothing shiny.
```

Both domain cells are **empty** — the categories are not settled yet, and an unclassified
item is a legal, writable state. Beat 1 does not run again for this job.

### Beat 2 — DOMAIN (twice: once per item)

- **boots** — `sil_domain_find { q: "boots that won't blister, resort skiing" }` returns a
  guide describing ski boots ⇒ **adopt** that path verbatim, copy its guide into the Brief's
  `## Buying guide`, write the path into the boots row, and announce it. The
  exact-by-domain `sil_doc_find` in that domain returns nothing done, so **no verdict ask**.
- **shell** — a second, independent read. Its guide is about outerwear; nothing about the
  boots resolution carried across. Adopted, written into the shell row, announced.

The guide names `liner_type` as decisive for boots, and the resolved vocabulary has no key
for the *instep volume* the buyer described — so that travels as an **unapplied predicate**
plus a `## Notes / open` row, and is never coined into the shared registry.

### Beat 3 — FILL (per item)

The shopper document is read first: the wool exclusion becomes `fibre_wool_pct eq 0` in
`## Hard constraints` (it reaches **both** items — it is scoped at the root), and the
recorded foot width becomes `last_width_mm gte 102` on the boots only. Neither sentence
appears in either source; the guide did the translation. Each item gets its `applies:`
line. Fill asks nothing.

### Beat 4 — ASK (once, merged, before any search)

Two open dimensions survive fill — `liner_type` for the boots, packed volume for the shell
— and both are load-bearing per their guides. They go out in **one turn**, each carrying
why it decides the buy, with the filled understanding played back for correction. The
buyer answers the first and skips the second: the shell's dimension is written to
`## Notes / open`, the assumption is stated in the same turn, and **the search still runs**.

### Beat 5 — SEARCH (per item, ≤ 4 calls each)

Two independent fan-outs, issued concurrently. Each starts with its tightest projection —
the ancestor-scoped rows as `predicates`, the item's own subsection prose as `query` — then
widens **soft** rows only. The boots' four calls do not spend the shell's budget.

### Beat 6 — REFLECT (per item)

The veto runs first on three states. Two boot results come back `maturity: web` with their
widths honestly `unset` ⇒ **NOT VERIFIED**, kept and flagged with the missing key named.
One is `applied: true, state: "set"` at 98 mm ⇒ **VIOLATED**, out. The job's stated ceiling
is summed across both picks here, not turned into a predicate. A hero plus one alternative,
each with a why.

### Beat 7 — FEEDBACK (per item)

*"I always end up in Arc'teryx for shells"* is durable and buyer-originated ⇒ the shopper
document's `## Shopping` gains it at the **outerwear** scope, re-derived whole, silently.
The boots row goes `picked`; the shell row stays `open`, so **the job stays open** — a pick
ends an item, never the job.

## Six weeks later — Beat 8 (VERDICT), out of band

The buyer opens a new boots job. Beat 2's exact-by-domain recall finds `brief:chamonix-feb`
`done` with a pick carrying no `## Past purchases` row, so the session opens with one plain
question naming the thing: *"before we shop boots again — how did they work out?"*

*"Bad — heels blistered by day three."* One `sil_doc_write { ref: "shopper", mode:
"replace" }` writes three things: the `## Past purchases` row (what · when · verdict ·
**why**, in the buyer's own words), a `## Fit` row because the shell size taught something,
and the `## Shopping` section that said *"runs a snug last"* — **re-derived whole**, not
caveated. Nothing else is written: there is no review, and none is offered.

Had the buyer declined, nothing would be written, the ask would not repeat that session,
and the new job would run unaffected.

## The singleton edge

"Set me up a second shopper" → the engine refuses: **a shopper already exists**. Steer to
opening a new Brief, or correcting the current one with `sil_doc_write` — never a second
shopper.
