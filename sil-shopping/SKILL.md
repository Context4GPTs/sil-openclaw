---
name: sil-shopping
description: 'Use when the user explicitly asks to shop with sil or manage their sil shopper: register or check their sil account, search sil in one registry domain, re-read results by ref, list a pick''s sellers and where to buy, add a new category to the registry, set up their one shopper (a two-touchpoint, endorsement-gated onboarding), view or forget what it has learned (domains/PRDs), or — running as that shopper — execute the six-beat Spec-Driven Shopping loop and record a fact or taste it surfaced. Drives sil_register, sil_whoami, sil_search, sil_product_get, sil_stores, sil_domain_create, sil_profile_materialize, sil_profile_search, sil_profile_get, sil_profile_remove, sil_learn, sil_doctor.'
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil-shopping

Drive the sil plugin's tools on the user's behalf: read intent, route to the
matching tool or reference (loading on demand), call it, report what came back. The
**shopper** is one sil-wired agent that shops every niche — set it up, search what
it knows, view or forget a domain, refine it.

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
- **Buy-intent in an unlearned niche ⇒ mint first — and there are TWO mints, for
  two different stores.** *Your* method is local: a niche you have not learned is a
  MISS, `sil_profile_search` returns it with `next_step: mint_domain`, and you
  research the buying guide and `sil_learn create` the method before shopping.
  *sil's* category is global: `sil_search` takes one registry `domain` and refuses a
  path the registry does not hold, which is a routing signal — not a failure and not
  an empty shelf. Answer it with `sil_domain_create` at the path you actually meant,
  then re-issue the search. Never coin a shallower or re-spelled path to dodge a
  refusal: the registry is shared by every shopper and nothing can undo a mint.
- **Every pick comes out of a sil tool.** A product, price, seller or buy URL that
  did not come back from `sil_search` / `sil_product_get` / `sil_stores` never
  enters the shortlist — never from the open web, even when sil returns nothing and
  even when the buyer asks. Zero results is an answer; the web researches a
  category, it never sources a pick.
- **Your memory is the sil store, never a `MEMORY.md`.** Persist and recall every
  shopping fact, taste, and domain method through `sil_learn` / `sil_profile_*` — a
  workspace `MEMORY.md` is not the shopper's memory; do not read or write it.

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
`sil_whoami` (is a sil identity **registered**?) and `sil_profile_search` (is a
shopper set up — any `domains`?).

- **No identity** ⇒ guide the user to register.
- **No shopper / no domains** ⇒ a one-off search still works, but it is never bare:
  `sil_search` needs a registry `domain`, so settle the category first (and coin it
  with `sil_domain_create` when sil refuses it). Offer the setup path alongside.
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
| `sil_search` refused the domain as unregistered, after research | `sil_domain_create` | — |
| "set up an agent that shops for me" / "create my shopper" | (onboarding, then the engine) | [`agent_creation_engine.md`](references/agent_creation_engine.md) |
| "what does my shopper know?" / "which domains / PRDs?" | `sil_profile_search` | [`method_and_prds.md`](references/method_and_prds.md) |
| "show me the &lt;niche&gt; domain" (method or one PRD) | `sil_profile_get` | [`method_and_prds.md`](references/method_and_prds.md) |
| "forget the &lt;niche&gt; domain" (or one PRD) | `sil_profile_remove` | [`method_and_prds.md`](references/method_and_prds.md) |
| (as the shopper) a shopping intent on any niche | the six-beat loop | [`shop_loop.md`](references/shop_loop.md) |
| "learn / remember this" — a fact or taste the shopper surfaced | `sil_learn` | [`fill_and_feedback.md`](references/fill_and_feedback.md) |
| "refine / sharpen my shopper" / fix a niche | `sil_learn` (target + change) | [`fill_and_feedback.md`](references/fill_and_feedback.md) |
| "sil is broken" / "check my sil install" / a store or identity read misbehaves | `sil_doctor` | — |

Each core tool's behaviour + status taxonomy live in its own tool definition and
response (the `recovery`/`status` it returns) — basic shopping needs only that. A full
run: [`examples/multi_domain_shopper_walkthrough.md`](examples/multi_domain_shopper_walkthrough.md).

**Setting up the shopper — endorsement-gated.** The shopper is a singleton (refused
once one exists). Run
[`references/agent_creation_engine.md`](references/agent_creation_engine.md) — it holds
both the two-touchpoint onboarding and the engine that persists the one sil-wired
shopper. Nothing is created until the user explicitly **endorses** the draft.

## As the shopper — the six-beat Spec-Driven-Shopping loop

Once a shopper exists, shop through what you know about the person. The loop is a
**six-beat** state machine — **classify → method → fill → search-space → reflect →
feedback** — loaded on demand from the references that own each beat: **1 classify,
4 search-space, 5 reflect** → [`references/shop_loop.md`](references/shop_loop.md);
**2 method** (load/mint/refresh, intent-keyed PRDs, the frontmatter-as-truth store)
→ [`references/method_and_prds.md`](references/method_and_prds.md); **3 fill, 6
feedback** → [`references/fill_and_feedback.md`](references/fill_and_feedback.md).

**Beat 4 is bounded: ≤ 4 spec-filtered `sil_search` calls** per request — the tightest
projection of the PRD's core first, then deliberate widenings; never brand-by-brand
enumeration.

The loop shapes the shopper's **reasoning, not the user's inbox**: a reused domain
plus a fully-resolved request **passes straight through, asking nothing**. It gates
only `sil_search`-driven discovery — identity, a direct `sil_product_get` re-check,
and shopper-management run ungated.
