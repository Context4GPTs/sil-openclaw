---
name: sil-shopping
description: 'Use when the user explicitly asks to shop with sil or manage their sil shopper: register or check their sil account, read sil''s registry for a category and coin one when nothing stands, read a category''s buying guide and keys, search a settled category, open a shortlisted variant''s dossier, price it at every seller and check whether that seller ships to the buyer, set up their one shopper (a two-touchpoint, endorsement-gated onboarding), list, read, write or remove the shopper''s own documents (the shopper document and its Briefs), or — running as that shopper — execute the eight-beat shopping loop. Drives sil_register, sil_whoami, shopping_domain_search, shopping_domain_get, shopping_domain_create, shopping_search, shopping_product_get, shopping_offers, shopping_seller_get, shopping_doc_find, shopping_doc_read, shopping_doc_write, shopping_doc_remove, sil_doctor.'
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil-shopping

Drive the sil plugin's tools on the user's behalf: read intent, route to the
matching tool or reference (loading on demand), call it, report what came back. The
**shopper** is one sil-wired agent that shops every category — set it up, read and
write its documents, and run the loop on every job.

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
- **Say what sil verified, and say the rest as what it is.** `fit` holds the keys
  sil holds a value for; a key absent from it is a **gap to name**, never a miss.
  `webpage_info` is the merchant's own words on a page sil has not read yet — good
  enough for a provisional pick, never presented as verified; its absence means the
  values were verified. An empty `variants` says no listed option fits. A price in
  a currency other than the buyer's bound is a bound sil could not test — say so.
  `ships: unknown` keeps the seller: say sil could not confirm shipping and hand
  the buyer the listing.
- **Two places are READ before they are written.** *sil's registry* is **global**:
  `shopping_domain_search` reads it in the buyer's own words, and only when that read
  comes back `matches: []` do you coin one with `shopping_domain_create` and search
  again. Never coin a shallower or re-spelled path to dodge a refusal — the registry is
  shared by every shopper and nothing can undo a mint. *The shopper's documents* are
  **local**: `shopping_doc_read` before every `shopping_doc_write`, because a write
  replaces the whole body and an unread section is a section deleted.
- **Every pick comes out of a sil tool.** A product, price, seller or listing URL that
  did not come back from `shopping_search` / `shopping_product_get` / `shopping_offers`
  / `shopping_seller_get` never enters the shortlist — never from the open web, even
  when sil returns nothing and even when the buyer asks. Zero products is an answer;
  the web researches a category, it never sources a pick.
- **Your memory is the sil store, never a `MEMORY.md`.** Persist and recall every
  shopping fact, taste and job through `shopping_doc_read` / `shopping_doc_write` — a
  workspace `MEMORY.md` is not the shopper's memory; do not read or write it.

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

## Routing — read the stage, then match intent to a tool

**Read the stage from state — never guess.** Two cheap reads settle it:
`sil_whoami` (is a sil identity **registered**?) and a bare `shopping_doc_find` (is a
shopper set up — is there a `shopper` document?).

- **No identity** ⇒ guide the user to register.
- **No shopper** ⇒ a one-off search still works, but it is never bare:
  `shopping_search` needs a settled `domain`, so settle the category first.
  `shopping_domain_search` is HOW you settle it; `shopping_domain_create` is what you do
  only when that read named nothing to adopt. Offer the setup path alongside.
- **Shopper present** ⇒ shop through what you know about the person via the loop.

[`references/setup_onboarding.md`](references/setup_onboarding.md) owns the setup
script — the staged ladder, the after-register offer, the per-search pitch. Load
while setup is incomplete; it sheds once a shopper exists.

### Intent → tool / reference (load on demand)

| Intent | Tool / path | Reference |
|---|---|---|
| "sign me up" / "log me in" / "register" | `sil_register` | — |
| "who am I?" / show my saved name + addresses | `sil_whoami` | — |
| a buy intent whose category has no settled registry path — or `shopping_search` refused the domain | `shopping_domain_search` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| the category's buying guide, and the keys it is bought by | `shopping_domain_get` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| a `shopping_domain_search` read came back `matches: []`, after research | `shopping_domain_create` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| "find X" / "search for X" in one settled category | `shopping_search` | [`shop_loop.md`](references/shop_loop.md) |
| open the whole of what sil holds on a shortlisted variant | `shopping_product_get` | [`shop_loop.md`](references/shop_loop.md) |
| "what does it cost?" / "who sells this?" — dated prices per seller | `shopping_offers` | [`shop_loop.md`](references/shop_loop.md) |
| "will it reach me?" — a seller's shipping and returns terms | `shopping_seller_get` | [`shop_loop.md`](references/shop_loop.md) |
| "set up an agent that shops for me" / "create my shopper" | (onboarding, then the engine) | [`agent_creation_engine.md`](references/agent_creation_engine.md) |
| "what does my shopper have?" / "which jobs are open?" | `shopping_doc_find` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| "show me my shopper" / "show me the &lt;job&gt; brief" | `shopping_doc_read` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| "remember this" / "that's wrong, fix it" — a fact, a taste, a job edit | `shopping_doc_write` | [`fill_and_feedback.md`](references/fill_and_feedback.md) |
| "forget that job" / "delete the &lt;job&gt; brief" | `shopping_doc_remove` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| (as the shopper) a shopping intent on anything | the eight-beat loop | [`shop_loop.md`](references/shop_loop.md) |
| "sil is broken" / "check my sil install" / a seller or identity read misbehaves | `sil_doctor` | — |

Each tool's behaviour + status taxonomy live in its own tool definition and
response (the `recovery`/`status` it returns) — basic shopping needs only that. A full
run: [`examples/multi_domain_shopper_walkthrough.md`](examples/multi_domain_shopper_walkthrough.md).

**Setting up the shopper — endorsement-gated.** The shopper is a singleton (refused
once one exists). Run
[`references/agent_creation_engine.md`](references/agent_creation_engine.md) — it holds
both the two-touchpoint onboarding and the engine that persists the one sil-wired
shopper. Nothing is created until the user explicitly **endorses** the draft.

## As the shopper — the eight-beat loop

Once a shopper exists, shop through what you know about the person. The loop is an
**eight-beat** state machine — **BRIEF → DOMAIN → FILL → ASK → SEARCH → REFLECT →
FEEDBACK → VERDICT** — and the beats do not run at the same rate: **beat 1 runs once
per job, beats 2–7 run once per item, and beat 8 runs out of band, once per bought
item.** Load the reference that owns each beat: **1 BRIEF, 5 SEARCH, 6 REFLECT** →
[`references/shop_loop.md`](references/shop_loop.md); **2 DOMAIN** (the registry read,
the guide, the shopper's document model and its store) →
[`references/domain_and_brief.md`](references/domain_and_brief.md); **3 FILL, 4 ASK, 7
FEEDBACK, 8 VERDICT** →
[`references/fill_and_feedback.md`](references/fill_and_feedback.md).

**Beat 5 is bounded: ≤ 4 `shopping_search` calls PER ITEM** — the tightest projection
first, then deliberate widenings of soft rows only; never brand-by-brand enumeration.
The bound is per item, never per job: a two-item job gets two fan-outs of up to four.

The loop shapes the shopper's **reasoning, not the user's inbox**: a settled domain plus
a fully-resolved request **passes straight through beat 4, asking nothing**. It gates
only `shopping_search`-driven discovery — identity, a direct `shopping_offers` re-check,
and shopper-management run ungated.
