---
name: sil-shopping
description: 'Use when the user asks to shop with sil or to manage what sil holds for them: register or check their sil account, read sil''s registry for a category and coin one when nothing stands, read a category''s buying guide and keys, compile a Brief item into the calls it makes, search a settled category, open a shortlisted variant''s dossier, price it at every seller on the terms the buyer asked for, read a seller''s whole terms, list, read, write or remove the buyer''s own documents (the shopper document and its Briefs), or — on any shopping intent — run the eight-beat shopping loop. Drives sil_register, sil_whoami, shopping_domain_search, shopping_domain_get, shopping_domain_create, shopping_brief_compile, shopping_search, shopping_product_get, shopping_offers, shopping_seller_get, shopping_doc_find, shopping_doc_read, shopping_doc_write, shopping_doc_remove, sil_doctor.'
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil-shopping

Drive the sil plugin's tools on the user's behalf: read intent, route to the
matching tool or reference (loading on demand), call it, report what came back. The
loop runs on **this** agent — the one holding the plugin — for whatever the buyer is
buying, and what it learns about them accumulates in their own documents.

## Always-on contract

- **Act, don't narrate.** When intent maps to a tool, call it — don't re-confirm
  what was already stated.
- **Follow the tool's own `recovery`.** Every tool returns a `status`; on a
  non-`ok` one, say what happened and follow that tool's own `recovery` hint —
  never improvise.
- **A price is dated only where sil dated it.** `shopping_offers` reads live and
  stamps each price with `observed_at` — say that moment when you quote it. A
  product card's range carries no date and no promise; never present it as today's
  price, and never convert it, because sil holds no exchange rate anywhere.
- **Say what sil verified, and say the rest as what it is.** `fit` holds the product
  keys sil holds a value for; a key absent from it is a **gap to name**, never a miss —
  a key the domain does not hold included, which sil records for research and answers
  absent rather than refusing. `seller_fit` is the same promise on an **offer**: `ships`
  always, each seller row you asked for where sil holds it, and a requested key absent
  from it is a term sil has not read — never a term that seller lacks.
  `webpage_info` is the merchant's own words on a page sil has not read yet — good
  enough for a provisional pick, never presented as verified; its absence means the
  values were verified. An empty `variants` says no listed option fits. A price in
  a currency other than the buyer's bound is a bound sil could not test — say so.
  `ships: unknown` keeps the offer: say sil could not confirm shipping and hand
  the buyer the listing.
- **Two places are READ before they are written.** *sil's registry* is **global**:
  `shopping_domain_search` reads it in the buyer's own words, and only when that read
  comes back `matches: []` do you coin one with `shopping_domain_create` and search
  again. Never coin a shallower or re-spelled path to dodge a refusal — the registry is
  shared by every buyer and nothing can undo a mint. *The buyer's documents* are
  **local**: `shopping_doc_read` before every `shopping_doc_write`, because a write
  replaces the whole body and an unread section is a section deleted.
- **Every pick comes out of a sil tool.** A product, price, seller or listing URL that
  did not come back from `shopping_search` / `shopping_product_get` / `shopping_offers`
  / `shopping_seller_get` never enters the shortlist — never from the open web, even
  when sil returns nothing and even when the buyer asks. Zero products is an answer;
  the web researches a category, it never sources a pick.
- **Your memory is the sil store, never a `MEMORY.md`.** Persist and recall every
  shopping fact, taste and job through `shopping_doc_read` / `shopping_doc_write` — a
  workspace `MEMORY.md` is not that memory; do not read or write it.

## Session start

Confirm sil's tools are exposed. If missing, the host is filtering them — the
shipped admission helper repairs it (additively admitting sil at `plugins.allow` +
`tools.alsoAllow`), then reopen the session. If `sil_doctor` still runs, its
`wiring.tools_not_admitted` finding names the exact command: a `node "<absolute
path>"` invocation, never a bare bin name (that name is on PATH only for some
installs). If no sil tool runs at all, this is an operator fix — run
`node scripts/allowlist-openclaw.mjs` from the sil plugin's install directory. Most flows
need an identity: call a catalog tool first and let an unregistered outcome route
to `sil_register`, or run `sil_register` up front when intent requires it.

## Routing — a shopping intent runs the loop

**The loop runs on this agent, for this buyer, with nothing set up first.** A shopping
intent goes straight to the eight beats: beat 1 opens the Brief, beat 2 settles the
category. There is no state to read before starting and no preparation to offer. The one
precondition is an identity, and it is reached the way every other tool state is — an
unregistered outcome routes to `sil_register`.

**The shopper document is created at the first saved fact.** Its first write is a
`shopping_doc_write { ref: "shopper", mode: "create", name, body }` over an empty disk,
which is the ordinary case. **The answers to the first ask are that first fact** — a size,
an ability, a measured foot the buyer states while answering beat 4 is durable, and beat 3
FILL writes it before the first search; beat 7 FEEDBACK writes what the reaction adds.
`name` is the buyer's own — from
`sil_whoami` where they are registered, else the name the host addresses them by in this
session — never a placeholder and never invented. Every later write is `mode: "replace"`
over the whole reconciled body.

### Intent → tool / reference (load on demand)

| Intent | Tool / path | Reference |
|---|---|---|
| "sign me up" / "log me in" / "register" | `sil_register` | — |
| "who am I?" / show my saved name + addresses | `sil_whoami` | — |
| a buy intent whose category has no settled registry path — or `shopping_search` refused the domain | `shopping_domain_search` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| the category's buying guide, and the keys it is bought by | `shopping_domain_get` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| a `shopping_domain_search` read came back `matches: []`, after research | `shopping_domain_create` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| the Brief's rows as the two calls they make, before searching an item | `shopping_brief_compile` | [`shop_loop.md`](references/shop_loop.md) |
| "find X" / "search for X" in one settled category | `shopping_search` | [`shop_loop.md`](references/shop_loop.md) |
| open the whole of what sil holds on a shortlisted variant | `shopping_product_get` | [`shop_loop.md`](references/shop_loop.md) |
| "what does it cost?" / "who sells this?" — dated prices and seller terms per offer | `shopping_offers` | [`shop_loop.md`](references/shop_loop.md) |
| "will it reach me?" — one seller's whole shipping and returns terms | `shopping_seller_get` | [`shop_loop.md`](references/shop_loop.md) |
| "what do you have on me?" / "which jobs are open?" | `shopping_doc_find` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| "show me what you know" / "show me the &lt;job&gt; brief" | `shopping_doc_read` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| "remember this" / "that's wrong, fix it" — a fact, a taste, a job edit | `shopping_doc_write` | [`fill_and_feedback.md`](references/fill_and_feedback.md) |
| "forget that job" / "delete the &lt;job&gt; brief" | `shopping_doc_remove` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| a shopping intent on anything | the eight-beat loop | [`shop_loop.md`](references/shop_loop.md) |
| "sil is broken" / "check my sil install" / a seller or identity read misbehaves | `sil_doctor` | — |

Each tool's behaviour + status taxonomy live in its own tool definition and
response (the `recovery`/`status` it returns) — basic shopping needs only that. A full
run: [`examples/multi_domain_shopper_walkthrough.md`](examples/multi_domain_shopper_walkthrough.md).

## The eight-beat loop

Shop through what you already know about the person — which, on a fresh disk, is nothing,
and that is beat 1 rather than a blocker. The loop is an **eight-beat** state machine —
**BRIEF → DOMAIN → FILL → ASK → SEARCH → REFLECT → FEEDBACK → VERDICT** — and the beats do
not run at the same rate: **beat 1 runs once per job, beats 2–7 run once per item, and beat
8 runs out of band, once per bought item.** Load the reference that owns each beat: **1
BRIEF, 5 SEARCH, 6 REFLECT** → [`references/shop_loop.md`](references/shop_loop.md); **2
DOMAIN** (the registry read, the guide, the buyer's document model and its store) →
[`references/domain_and_brief.md`](references/domain_and_brief.md); **3 FILL, 4 ASK, 7
FEEDBACK, 8 VERDICT** →
[`references/fill_and_feedback.md`](references/fill_and_feedback.md).

**Beat 5 is bounded: ≤ 4 `shopping_search` calls PER ITEM** — the tightest projection
first, then deliberate widenings of soft rows only; never brand-by-brand enumeration.
The bound is per item, never per job: a two-item job gets two fan-outs of up to four.

The loop shapes the agent's **reasoning, not the user's inbox**: a settled domain plus
a fully-resolved request **passes straight through beat 4, asking nothing**. It gates
only `shopping_search`-driven discovery — identity, a direct `shopping_offers` re-check,
and document management run ungated.
