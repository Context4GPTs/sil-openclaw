---
name: domain-and-brief
description: Beat 2 of the loop — resolve each item's domain against sil's shared registry, read its buying guide and keys, and run the exact-by-domain recall that raises the verdict ask — plus the shopper's two document kinds (the shopper document and Briefs), the flat store, and discovery/manage via shopping_doc_find / shopping_doc_read / shopping_doc_write / shopping_doc_remove. Load when classifying an item or reading and writing the shopper's own documents.
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

### The reads Beat 2 makes

1. **`shopping_domain_search { q: <the item's own prose> }`** — sil's shared registry: is
   there already a category for this, and what does it say about how the thing is bought?
2. **`shopping_domain_get { path: <the adopted path> }`** — that category's buying guide
   and every key it is bought by, once a path is settled.
3. **`shopping_doc_find { kind: "brief", domain: <the resolved path> }`** — the shopper's
   own past jobs in this domain: an **exact-by-domain** recall. This is a different
   question from Beat 1's text recall and does not replace it.

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

- **Read in the buyer's own words, not a path guess.** `shopping_domain_search`'s `q` is
  matched against each standing category's path text *and* its buying guide, so prose
  reaches a settled path that a path-shaped guess walks straight past. Budget: **at most
  2 reads** — the item's prose verbatim, then the plain category name only if the first
  returned nothing.
- **Judge fit on the returned `about`, never on how a path reads.** Three verdicts:
  - **adopt** — a line describing *this* category ⇒ take that path **verbatim**, read it
    with `shopping_domain_get`, and use its keys **as-is**. **Coin nothing beside them**,
    and never edit an existing domain from a session: the registry is shared by every
    shopper.
  - **descend** — a line describing a *broader* category ⇒ the only mint permitted is a
    **descendant** of that path, never a sibling and never a re-rooted one.
  - **mint licensed** — the read came back `matches: []` ⇒ research, then coin. That
    empty list is the **only** thing that licenses a mint. A `shopping_domain_get` that
    answers `not_found` never licenses one: it says nothing about the standing path
    under a different parent, which is the fork this discipline exists to prevent.
- **One concept, one spelling — take the key sil already holds.** A standing domain
  carries its own keys; use them **verbatim** in the Brief's spec tables rather than
  coining beside them. A synonym (`speed_mbps` vs `transfer_speed_mbps`) is simply
  outside what the registry holds, so sil holds no value for it.
- **A key the job needs that the domain lacks is a NAMED GAP, never a coin.** It travels
  exactly two ways and no third: as a spec row on the search whose key comes back absent
  from `fit` (a named gap, and never a reason to drop a product), and as a
  **`## Notes / open` row** on the Brief. Research coins it later, with evidence.
- **Coining is `shopping_domain_create`'s job, once, for a NEW category** — its `specs`
  are the first keys of a path sil did not have. Research **how the category is bought**
  on the web first (never products), and coin only the keys the path does not already
  inherit: a key an ancestor already defines is refused by name, as `price` is. Mark
  `variant_spec: true` on a key that identifies a purchasable option — a boot's size, a
  colour — and `product_spec: true` on one that tells one product from the next, a model
  year or an edition; the registry derives each key's operators from its `type`. An
  existing path is refused and nothing is written; never coin a near-path variant to
  route around that refusal. Tell the buyer the first search answers from the pages
  themselves while sil reads them.
- **Common attribute → conventional name.** When you are coining a new category's first
  keys, a widely-shared attribute (screen size, weight, RAM, waterproof rating,
  material…) takes its **conventional** name. Coin fresh only for a genuinely niche one.
- **Mark the keys the category is SOLD by.** A key merchants stock and price by — a
  boot's mondopoint, a ski's length, a colour — is `variant_spec: true`, and its values
  come back under each product's `variants`. Settle those before searching; a buyer who
  has not said their size is a buyer you cannot shortlist for.
- **A read that did not return is not a read that returned nothing.** Any non-`ok` status
  — `invalid_request`, a transient, `not_registered` — leaves the mint out of reach:
  settle the read, never coin around it. And when `shopping_search` refuses, its refusals
  read alike, so read the domain you submitted with `shopping_domain_get` and let its
  answer decide — a guide back means fix the spec row and re-issue, `not_found` means the
  domain was the problem. That ends the read's job, not the discipline: read again in the
  buyer's own words with `shopping_domain_search`, and coin only if that comes back
  `matches: []`. A permanent global write is never entered off refusal prose.

Naming is never a gate — a key sil holds no value for costs precision, never blocks a
search — and it is **silent to the buyer**: never surface key plumbing.

### What Beat 2 writes back

Three things, into the Brief, with one `shopping_doc_write { mode: "replace" }`:

1. **The domain into that item's `## Items` row.**
2. **The adopted guide, copied in verbatim, into `## Buying guide`** under a
   `### <domain-path>` heading. The Brief records the guide **as it governed this job**,
   which is what keeps it standalone. Every later whole-body write re-emits this section
   **byte-faithful, never retyped**; only a Beat-2 re-run replaces it, wholesale, from
   the registry.
3. **Announce the inferred domain** so the buyer can correct it. A domain the buyer never
   sees is a domain they cannot fix.

**A Brief that already records a settled path is searched with no registry read at all**
— the registry read is the cold path's first move, never a per-search toll. The
`## Buying guide` section already records what that read returned.

## The shopper's two document kinds

```
shopper           who you ARE      one   · facts about the person
brief:<slug>      what you WANT    many  · the spec rows for one job
```

There is no local copy of a domain and no local folder per category: the buying guide and
the keys are the registry's, and taste about the person lives on the shopper document.
What is local is **the person and their jobs**.

### The shopper document — `ref: "shopper"`

Facts about the buyer, never written in any one domain's language: a foot is 285 mm
whether you are buying ski boots or crampons. Turning that into `last_width ≥ 102` is
the Brief's job, and the guide is what knows the conversion.

- **`## Who`** · **`## Body`** — who they are, and their measurements, as facts.
- **`## Fit`** — the person × brand join, a table: brand · size · note. It is the one
  input that resolves to a **size** rather than a spec row.
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
  free text — `shopping_search`'s `query` leg for it — and in a taste-led domain it is
  the load-bearing field in the whole document.
- **`## Buying guide`** — the adopted guide, verbatim, keyed by `### <domain-path>`.
- **`## Hard constraints`** / **`## Preferences`** — spec rows
  (domain · key · op · value · unit). **The section IS the hardness** — there is no
  `hard` column. `op` is one of `eq · neq · gte · lte · in · nin`, taken from what the
  domain read listed for that key; a range is **two rows**, never an `in`.
- **`## Working from`** — links to what the job drew on.
- **`## Notes / open`** — one row per dimension that is unresolved or declined. Beat 4
  owns this section: it is read back next session as ASK's input, not left as sediment.

**Shipping and job arithmetic never become spec rows.** *Ships to Greece* is answered per
seller by `shopping_seller_get`; *about €1200 for everything* stays `## Context` prose,
summed at Beat 6. The spec tables carry **registry keys only**.

## The store — flat, and the index is the only access path

```
$SIL_DATA_DIR/shopper/
  user_spec.md · briefs/<slug>.md
```

One file and one folder; no nesting. There is **no manifest** — each file's own
**frontmatter** IS the truth, discovered by a **scan**. Malformed frontmatter is surfaced
as `unreadable` and keeps its place, never half-read.

## Discovery + manage

- **`shopping_doc_find { kind?, domain?, status?, query? }`** — the index, and the only
  discovery path. Returns **coordinates only, never bodies**: a Brief's ref, title,
  status and `## Items` rows. `domain` is a path prefix; `query` is a substring over slugs
  and titles; filters compose; the bare call is *"what does my shopper have?"*.
- **`shopping_doc_read { ref }`** — one whole body plus frontmatter. **Read before every
  write** — reconcile from the real current body, never from memory.
  `not_found` means sil listed the containing directory and the document was not in it;
  a directory sil could **not** list is `unreadable`, as is a present-but-corrupt one —
  and `unreadable` is **never written over**.
- **`shopping_doc_write { ref, mode, body, … }`** — `mode: create` fails if the ref
  exists, `mode: replace` fails if it does not. `body` is always the **whole reconciled
  markdown** — no append, no section patch, so a correction can never stack a row
  contradicting the one above it. A `ref: "shopper"` write that drops `## Body` or
  `## Constraints` deletes the person: read, reconcile, carry every section forward.
- **`shopping_doc_remove { ref }`** — one Brief, never a cascade. Destructive: **confirm**
  with the buyer first. The shopper document is not removable — correct it with a
  `replace`.
