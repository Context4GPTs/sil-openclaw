---
name: multi-domain-shopper-walkthrough
description: A worked eight-beat run on a cold disk — one two-item job across two unrelated categories, showing beat 1 running once per job, beats 2–7 running per item, the buyer's document minted at the first saved fact, one merged ask turn before any search, and a later session opening with the verdict ask, out of band. Illustrative, not a spec.
---

# Worked run — one two-item job, eight beats, nothing set up first

Illustrative only — authoritative rules live in the beat references. The disk is empty
when this starts: there is no document, no Brief and no preparation, and none is asked for.

## The job: "a week in Chamonix — I need boots and a shell"

### Beat 1 — BRIEF (once per job)

`shopping_doc_find { kind: "brief", query: "chamonix ski" }` → nothing open. Open one Brief,
`brief:chamonix-feb`, and write **scope only**:

```
## Items
| item  | domain | status |
|---|---|---|
| boots |        | open   |
| shell |        | open   |

### boots
Boots that won't blister — resort, not touring, and the rental Langes sat wrong over the
instep.

### shell
Something that packs down small, nothing shiny.
```

Both domain cells are **empty** — the categories are not settled yet, and an unclassified
item is a legal, writable state. Beat 1 does not run again for this job.

### Beat 2 — DOMAIN (twice: once per item)

- **boots** — `shopping_domain_search { q: "boots that won't blister, resort skiing" }`
  names a path whose `about` describes ski boots ⇒ **adopt** it verbatim, read it with
  `shopping_domain_get`, copy its guide into the Brief's `## Buying guide`, write the path
  into the boots row, and announce it. The
  exact-by-domain `shopping_doc_find` in that domain returns nothing done, so **no verdict ask**.
- **shell** — a second, independent read. Its guide is about outerwear; nothing about the
  boots resolution carried across. Adopted, written into the shell row, announced.

The guide names `liner_type` as decisive for boots, and the domain read returned no key
for the *instep volume* the buyer described. That one is **sent anyway** — the search
takes it, answers the products it found, leaves it absent from `fit` and records the ask
for research — **and** written as a `## Notes / open` row, to be judged at beat 6 from
what the pages print. It is never coined into the shared registry from this session.

### Beat 3 — FILL (per item)

`shopping_doc_read { ref: "shopper" }` answers `not_found`: sil listed the directory that
would hold it and nothing was there. So this fill has only the buyer's own sentence to
work from, and the guide to translate it. *"Nothing with wool in it"* is durable — true
whatever they are buying next — so beat 3 saves it, and **that first saved fact is what
mints the document**:

```
shopping_doc_write { ref: "shopper", mode: "create", name: "Ioannis", body: "## Constraints\nNo wool — reacts to it.\n" }
```

`name` came from `sil_whoami`. From there the fill proceeds as always: the wool exclusion
becomes `fibre_wool_pct eq 0` in `## Hard constraints` (it reaches **both** items — it is
scoped at the root), and the instep note stays open. Each item gets its `applies:` line
and its `search:` line — `search: ski boots resort` and `search: ski shell packable`, the
words a shop lists the thing by. Fill asks nothing.

### Beat 4 — ASK (once, merged, before any search)

Two open dimensions survive fill — `liner_type` for the boots, packed volume for the shell
— and both are load-bearing per their guides. They go out in **one turn**, opening with the
`Heard:` playback of every fact stated so far and each question carrying why it decides the
buy. The buyer answers the first and skips the second: the shell's dimension is written to
`## Notes / open`, the assumption is stated in the same turn, and **the search still runs**.

### Beat 5 — SEARCH (per item, ≤ 4 calls each)

Two independent fan-outs, issued concurrently. `shopping_brief_compile { ref, item }`
builds each one — the ancestor-scoped rows as `specs`, the item's `search:` line as
`query` — and the agent adds `n` and the `ship_to` label the buyer's `## Constraints`
names. Each starts with that tightest projection, then widens **soft** rows only, and each
widening is an edit to the Brief and a second compile. The boots' four calls do not spend
the shell's budget. The compile's `seller_specs` is held back for beat 6.

### Beat 6 — REFLECT (per item)

The veto runs first on three states. Two boot products come back carrying `webpage_info`
and an empty `fit` ⇒ **NOT VERIFIED**, kept and flagged with the missing key named. A third
carries `fit: { fibre_wool_pct: 12 }` ⇒ **VIOLATED**, out. A fourth is in budget but its
price is in dollars against a euro row — a bound sil could not test, said out loud. The
job's stated ceiling is summed across both picks here, never turned into a spec row.
`shopping_offers` prices the two survivors with the compile's `seller_specs` and the same
`ship_to`: each offer comes back with `seller_fit`, so the seller rows are vetoed per
offer — one seller's `ships: not_serviceable` is VIOLATED for that offer, an `unknown` is
NOT VERIFIED and keeps it. `shopping_product_get` opens the survivors and
`shopping_seller_get` reads the chosen seller's whole terms. A hero plus one alternative,
each with a why.

### Beat 7 — FEEDBACK (per item)

*"I always end up in Arc'teryx for shells"* is durable and buyer-originated ⇒ the document's
`## Shopping` gains it at the **outerwear** scope, re-derived whole, silently. Had beat 3
saved nothing, this would have been the `mode: "create"` write instead — whichever beat
holds the first durable fact is the one that mints the document.

The boots row goes `picked`; the shell row stays `open`, so **the job stays open** — a pick
ends an item, never the job.

## Six weeks later — Beat 8 (VERDICT), out of band

The buyer opens a new boots job. Beat 2's exact-by-domain recall finds `brief:chamonix-feb`
`done` with a pick carrying no `## Past purchases` row, so the session opens with one plain
question naming the thing: *"before we shop boots again — how did they work out?"*

*"Bad — heels blistered by day three."* One `shopping_doc_write { ref: "shopper", mode:
"replace" }` writes three things: the `## Past purchases` row (what · when · verdict ·
**why**, in the buyer's own words), a `## Fit` row because the size taught something,
and the `## Shopping` section that said *"runs a snug last"* — **re-derived whole**, not
caveated. Nothing else is written: there is no review, and none is offered.

Had the buyer declined, nothing would be written, the ask would not repeat that session,
and the new job would run unaffected.
