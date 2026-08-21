---
name: sil-shopping
description: 'Use when the user explicitly asks to shop with sil or manage their sil shopper: register or check their sil account, search sil in one registry domain, re-read results by ref, list a pick''s sellers and where to buy, read the registry for a category before coining one and add a new category to it, set up their one shopper (a two-touchpoint, endorsement-gated onboarding), list, read, write or remove the shopper''s own documents (the shopper document and its Briefs), or — running as that shopper — execute the eight-beat shopping loop. Drives sil_register, sil_whoami, sil_search, sil_product_get, sil_stores, sil_domain_find, sil_domain_create, sil_doc_find, sil_doc_read, sil_doc_write, sil_doc_remove, sil_doctor.'
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
- **Prices are point-in-time, and only `observed` says which.** Re-read with
  `sil_product_get` before the user buys. Every offer says `observed: live` (read
  just now) or `stored` — quote a `stored` price with the date it was read, never
  as the current one.
- **Sil holds no value ⇒ say so.** `unset`, `applied: false`, `maturity: web` and
  `serviceability: unknown` are ordinary answers that KEEP their subject. Present
  the result and name the gap; never drop a result or a seller for carrying one,
  and never read an `unset` cost as zero or free.
- **Two stores, and each is READ before it is written.** *sil's registry* is
  **global**: `sil_domain_find` reads it in the buyer's own words, and only when that
  read names no adoptable match — and states the answer was complete (`capped: false`)
  — do you coin one with `sil_domain_create` and re-issue the search. Never coin a
  shallower or re-spelled path to dodge a refusal: the registry is shared by every
  shopper and nothing can undo a mint. *The shopper's documents* are **local**:
  `sil_doc_read` before every `sil_doc_write`, because a write replaces the whole body
  and an unread section is a section deleted. `sil_search` refusing a path the registry
  does not hold is a routing signal, not a failure and not an empty shelf.
- **Every pick comes out of a sil tool.** A product, price, seller or buy URL that
  did not come back from `sil_search` / `sil_product_get` / `sil_stores` never
  enters the shortlist — never from the open web, even when sil returns nothing and
  even when the buyer asks. Zero results is an answer; the web researches a
  category, it never sources a pick.
- **Your memory is the sil store, never a `MEMORY.md`.** Persist and recall every
  shopping fact, taste and job through `sil_doc_read` / `sil_doc_write` — a workspace
  `MEMORY.md` is not the shopper's memory; do not read or write it.

## Session start

Confirm the `sil_*` tools are exposed. If missing, the host is filtering them — the
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
`sil_whoami` (is a sil identity **registered**?) and a bare `sil_doc_find` (is a
shopper set up — is there a `shopper` document?).

- **No identity** ⇒ guide the user to register.
- **No shopper** ⇒ a one-off search still works, but it is never bare: `sil_search`
  needs a registry `domain`, so settle the category first. `sil_domain_find` is HOW
  you settle it; `sil_domain_create` is what you do only when that read named nothing
  to adopt. Offer the setup path alongside.
- **Shopper present** ⇒ shop through what you know about the person via the loop.

[`references/setup_onboarding.md`](references/setup_onboarding.md) owns the setup
script — the staged ladder, the after-register offer, the per-search pitch. Load
while setup is incomplete; it sheds once a shopper exists.

### Intent → tool / reference (load on demand)

| Intent | Tool / path | Reference |
|---|---|---|
| "sign me up" / "log me in" / "register" | `sil_register` | — |
| "who am I?" / show my saved name + addresses | `sil_whoami` | — |
| "find X" / "search for X" in one settled category | `sil_search` | — |
| re-read the shortlist before deciding (≤5 refs from a prior result) | `sil_product_get` | — |
| "where can I buy this?" / does the pick ship to me | `sil_stores` | — |
| a buy intent whose category has no settled registry path — or `sil_search` refused the domain, or refused a predicate and you cannot tell which | `sil_domain_find` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| a `sil_domain_find` **discovery** read (`q`) came back `matches: []` with `capped: false`, after research — a `path` probe never licenses a mint | `sil_domain_create` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| "set up an agent that shops for me" / "create my shopper" | (onboarding, then the engine) | [`agent_creation_engine.md`](references/agent_creation_engine.md) |
| "what does my shopper have?" / "which jobs are open?" | `sil_doc_find` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| "show me my shopper" / "show me the &lt;job&gt; brief" | `sil_doc_read` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| "remember this" / "that's wrong, fix it" — a fact, a taste, a job edit | `sil_doc_write` | [`fill_and_feedback.md`](references/fill_and_feedback.md) |
| "forget that job" / "delete the &lt;job&gt; brief" | `sil_doc_remove` | [`domain_and_brief.md`](references/domain_and_brief.md) |
| (as the shopper) a shopping intent on anything | the eight-beat loop | [`shop_loop.md`](references/shop_loop.md) |
| "sil is broken" / "check my sil install" / a store or identity read misbehaves | `sil_doctor` | — |

Each core tool's behaviour + status taxonomy live in its own tool definition and
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

**Beat 5 is bounded: ≤ 4 `sil_search` calls PER ITEM** — the tightest projection first,
then deliberate widenings of soft rows only; never brand-by-brand enumeration. The bound
is per item, never per job: a two-item job gets two fan-outs of up to four.

The loop shapes the shopper's **reasoning, not the user's inbox**: a settled domain plus
a fully-resolved request **passes straight through beat 4, asking nothing**. It gates
only `sil_search`-driven discovery — identity, a direct `sil_product_get` re-check,
and shopper-management run ungated.
