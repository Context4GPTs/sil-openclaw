---
name: domain-and-brief
description: Beat 2 of the loop — resolve each item's domain against sil's shared registry, adopt its guide, and run the exact-by-domain recall that raises the verdict ask — plus the shopper's two document kinds (the shopper document and Briefs), the flat store, and discovery/manage via sil_doc_find / sil_doc_read / sil_doc_write / sil_doc_remove. Load when classifying an item or reading and writing the shopper's own documents.
---

# The item's domain, the shopper's documents, and the store

## Beat 2 — DOMAIN: settle the item's category and adopt its guide

Beat 1 hands off a Brief whose `## Items` rows are in the buyer's words and carry **no
domain**. Beat 2 settles the domain **per item** and brings that category's shared
buying guide into the Brief, ready for Beat 3 to fill.

**Per item, and independently.** A two-item job runs Beat 2 twice, one resolution per
item. Neither item's domain is inferred from the other's — *boots* and *shell* live under
different parts of the tree, and carrying one across is how a job silently searches the
wrong category.

### The two reads Beat 2 makes

1. **`sil_domain_find { q: <the item's own prose> }`** — sil's shared registry: is there
   already a category for this, and what does it say about how the thing is bought?
2. **`sil_doc_find { kind: "brief", domain: <the resolved path> }`** — the shopper's own
   past jobs in this domain: an **exact-by-domain** recall. This is a different question
   from Beat 1's text recall and does not replace it.

**The recall's second job — the verdict ask.** When that read returns a Brief that is
`done` whose pick carries no `## Past purchases` row, the session **opens with the
verdict ask** on that pick, before the new job's fill. That is Beat 8's in-session
trigger and the rules are in [`fill_and_feedback.md`](fill_and_feedback.md). No prior
done Brief with an undecided pick means **no ask** — the trigger is the undecided pick,
never elapsed time and never a session count.

### Reading the registry: adopt whole, coin only when nothing stands

**sil's registry is the first place you explore — before the web.** It is the cheapest
read you have, and what it returns is what every other shopper already agreed to call
things.

- **Read in the buyer's own words, not a path guess.** `sil_domain_find`'s `q` is matched
  against each standing category's path text *and* its buying guide, so prose reaches a
  settled path that a path-shaped guess walks straight past. Budget: **at most 2 discovery
  reads** — the item's prose verbatim, then the plain category name only if the first
  returned nothing — **plus 1 `path` probe**. The probe asks a different question and
  does **not** count against the two: **≤2 + 1**.
- **Judge fit on the returned `guide`, never on how a path reads.** Four verdicts:
  - **adopt** — a guide describing *this* category ⇒ take that path **verbatim** and its
    resolved vocabulary keys **as-is**. **Coin nothing beside them**, and never edit an
    existing domain from a session: the registry is shared by every shopper.
  - **descend** — a guide describing a *broader* category ⇒ the only mint permitted is a
    **descendant** of that path, never a sibling and never a re-rooted one.
  - **mint licensed** — a **`q` discovery read** came back `matches: []` beside
    `capped: false` ⇒ research, probe, coin. Only that read licenses a mint: a `path`
    probe never licenses one — it answers about the path you already guessed, and its
    `exists: false` is silent about the standing path under a different parent, the fork
    this route exists to prevent.
  - **narrow** — `capped: true` ⇒ the answer was bounded and the standing path may sit
    just past it. Sharpen the ask, read once more; the mint is **not** licensed.
- **One concept, one spelling — take the key sil already holds.** A domain in the registry
  resolves its own vocabulary; use those keys **verbatim** in the Brief's predicate tables
  rather than coining beside them. A synonym (`speed_mbps` vs `transfer_speed_mbps`) is
  simply outside the resolved vocabulary and comes back `applied: false`.
- **A key the job needs that the vocabulary lacks is a NAMED GAP, never a coin.** It
  travels exactly two ways and no third: as an **unapplied predicate** on the search
  (it returns `applied: false` — a named gap, and never a reason to drop a result), and
  as a **`## Notes / open` row** on the Brief. Research coins it later, with evidence.
- **Coining is `sil_domain_create`'s job, once, for a NEW category** — its `specs` are the
  first keys of a path sil did not have. Research **how the category is bought** on the
  web first (never products), `path`-probe the exact path you are about to coin, and write
  **only the keys it does not already inherit**: on `exists: false` the probe still returns
  the vocabulary that path would inherit, so a skipped probe re-coins `brand` or `weight`
  off the root and forks the vocabulary on your first predicate. An existing path is
  refused and nothing is written; never coin a near-path variant to route around that
  refusal. Tell the buyer the first search answers from the web while validation catches up.
- **Common attribute → conventional name.** When you are coining a new category's first
  keys, a widely-shared attribute (screen size, weight, RAM, waterproof rating,
  material…) takes its **conventional** name. Coin fresh only for a genuinely niche one.
- **Name the axis the category is sold by.** Where merchants price and stock by ONE
  variant-level key — a boot's mondopoint, a tyre's width — mark that spec `axis: true`
  (it must be `level: variant`, and a category has at most one). sil keys a page's size
  selector on it when the page names no key; a colour or a fit is never the axis.
- **A read that did not return is not a read that returned nothing.** Any non-`ok` status
  — `invalid_request`, a transient, `not_registered` — leaves the mint out of reach:
  settle the read, never coin around it. And when `sil_search` refuses, its two refusals
  read alike, so `path`-probe the domain you submitted and let the stated `exists` decide
  — `true` means fix the predicate and re-issue, `false` means the domain was the problem.
  `false` ends the probe's job, not the discipline: read again in the buyer's own words
  (`q`), and coin only if that discovery read returns `matches: []` with `capped: false`.
  A permanent global write is never entered off refusal prose, and never off a probe.
- **A provisional match (`validated_at: null`) is adopted like any other.** It keeps its
  place in the answer, and re-minting it earns a refusal. Its first answers come from the
  web while sil catches up — say that to the buyer; every result and seller it named
  stays on the table.

Naming is never a gate — an unresolved key costs precision, never blocks a search — and it
is **silent to the buyer**: never surface key plumbing.

### What Beat 2 writes back

Three things, into the Brief, with one `sil_doc_write { mode: "replace" }`:

1. **The domain into that item's `## Items` row.**
2. **The adopted guide, copied in verbatim, into `## Buying guide`** under a
   `### <domain-path>` heading. The Brief records the guide **as it governed this job**,
   which is what keeps it standalone. Every later whole-body write re-emits this section
   **byte-faithful, never retyped**; only a Beat-2 re-run replaces it, wholesale, from
   the registry.
3. **Announce the inferred domain** so the buyer can correct it. A domain the buyer never
   sees is a domain they cannot fix.

**A Brief that already records a settled path is searched with no `sil_domain_find` call
at all** — the registry read is the cold path's first move, never a per-search toll. The
`## Buying guide` section already records what that read returned.

## The shopper's two document kinds

```
shopper           who you ARE      one   · facts about the person
brief:<slug>      what you WANT    many  · predicates for one job
```

There is no local copy of a domain and no local folder per category: the buying guide and
the vocabulary are the registry's, and taste about the person lives on the shopper
document. What is local is **the person and their jobs**.

### The shopper document — `ref: "shopper"`

Facts about the buyer, never written in any one domain's language: a foot is 285 mm
whether you are buying ski boots or crampons. Turning that into `last_width_mm ≥ 102` is
the Brief's job, and the guide is what knows the conversion.

- **`## Who`** · **`## Body`** — who they are, and their measurements, as facts.
- **`## Fit`** — the person × brand join, a table: brand · size · note. It is the one
  input that resolves to a **size** rather than a predicate.
- **`## Shopping`** — taste, as one scoped family. Root prose is the broadest scope; a
  `### <domain-path>` section narrows it; fill reads root plus every ancestor-or-self
  section, nearest first. **You** write the headings, at the broadest path where the
  content stays true — enriching an ancestor beats minting a leaf. A section describes
  **the person in the domain, never the domain** (*"decides silhouette first"* is the
  buyer; *"gripwalk soles don't fit older bindings"* belongs in the guide).
- **`## Constraints`** — the inviolable ones: ships-to, an allergy, a ceiling.
- **`## Past purchases`** — a table: what · when · verdict · **why**. The highest-signal
  section in the file, and Beat 8 is what writes it.

### A Brief — `ref: "brief:<slug>"`

Frontmatter: `title` and `status` (`active` | `done` | `dropped`). Sections:

- **`## Context`** — job-level background: the trip, the occasion, the total budget.
  Reasoned over; never sent as a query.
- **`## Items`** — a table (item · domain · status) plus **one prose subsection per row**.
  The scope, the fan-out and the completion count. Each subsection's prose is that item's
  free text — `sil_search`'s `query` leg for it — and in a taste-led domain it is the
  load-bearing field in the whole document.
- **`## Buying guide`** — the adopted guide, verbatim, keyed by `### <domain-path>`.
- **`## Hard constraints`** / **`## Preferences`** — predicate rows
  (domain · key · op · value · unit). **The section IS the hardness** — there is no
  `hard` column. `op` is one of `eq · neq · gte · lte · in · nin · exists`; a range is
  **two rows**, never an `in`.
- **`## Working from`** — links to what the job drew on.
- **`## Notes / open`** — one row per dimension that is unresolved or declined. Beat 4
  owns this section: it is read back next session as ASK's input, not left as sediment.

**Serviceability and job arithmetic never become predicate rows.** *Ships to Greece*
rides the search's `destination` and is checked per store with `sil_stores`; *about €1200
for everything* stays `## Context` prose, summed at Beat 6. The predicate tables carry
**registry keys only**.

## The store — flat, and the index is the only access path

```
$SIL_DATA_DIR/shopper/
  user_spec.md · briefs/<slug>.md
```

One file and one folder; no nesting. There is **no manifest** — each file's own
**frontmatter** IS the truth, discovered by a **scan**. Malformed frontmatter is surfaced
as `unreadable` and keeps its place, never half-read.

## Discovery + manage

- **`sil_doc_find { kind?, domain?, status?, query? }`** — the index, and the only
  discovery path. Returns **coordinates only, never bodies**: a Brief's ref, title,
  status and `## Items` rows. `domain` is a path prefix; `query` is a substring over slugs
  and titles; filters compose; the bare call is *"what does my shopper have?"*.
- **`sil_doc_read { ref }`** — one whole body plus frontmatter. **Read before every
  write** — reconcile from the real current body, never from memory.
  `not_found` means sil listed the containing directory and the document was not in it;
  a directory sil could **not** list is `unreadable`, as is a present-but-corrupt one —
  and `unreadable` is **never written over**.
- **`sil_doc_write { ref, mode, body, … }`** — `mode: create` fails if the ref exists,
  `mode: replace` fails if it does not. `body` is always the **whole reconciled markdown**
  — no append, no section patch, so a correction can never stack a row contradicting the
  one above it. A `ref: "shopper"` write that drops `## Body` or `## Constraints` deletes
  the person: read, reconcile, carry every section forward.
- **`sil_doc_remove { ref }`** — one Brief, never a cascade. Destructive: **confirm** with
  the buyer first. The shopper document is not removable — correct it with a `replace`.
