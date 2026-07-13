---
name: sil-shopping
description: 'Use for any sil shopping, identity, or shopper-setup intent: register or sign in, check the account, search the sil catalog for purchasable products, or look up products by id — plus the single-shopper lifecycle: create the shopper (a short two-touchpoint onboarding), search what it knows or which domains (niches) it has learned, view or forget a domain or one of its PRDs, refine it — or, as the shopper, run the six-beat Spec-Driven Shopping loop on any niche and learn a fact or buying taste it surfaces. Drives sil_register, sil_whoami, sil_search, sil_product_get, sil_profile_materialize, sil_profile_search, sil_profile_get, sil_profile_remove, and sil_learn.'
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil-shopping

Drive the sil plugin's tools on the user's behalf: register them, read their
identity, help them find purchasable products — and, when asked, set up their
**shopper** (one sil-wired agent that shops every niche), then search what it
knows, view or forget a domain, or refine it. Read intent, route to the matching
tool or reference (loading it on demand), call it, and report what came back.

## Always-on contract

- **Act, don't narrate.** When intent maps to a tool, call it — don't re-confirm
  what was already stated.
- **Follow the tool's own `recovery`.** Every tool returns a `status`; on a
  non-`ok` one, say what happened and follow that tool's `recovery` hint, never
  improvise another. The taxonomy lives in
  [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md).
- **Prices are point-in-time.** Before the user buys, re-fetch the item with
  `sil_product_get` rather than trusting an earlier `sil_search` snapshot.

## Session start

Confirm the `sil_*` tools are exposed. If they are missing, the host is filtering
them — run the shipped admission helper `sil-openclaw-allowlist` (it additively
admits sil at `plugins.allow` + `tools.alsoAllow`), then reopen the session. Most
flows need an identity: calling a catalog tool first lets an unregistered outcome
route to `sil_register`, or run `sil_register` up front when intent requires it.

## Routing — read the stage, then match intent to a tool

**Read the stage from state — never guess it.** Two cheap reads settle it:
`sil_whoami` (is a sil identity **registered** yet?) and `sil_profile_search` (is
a shopper set up — does it return any `domains`?).

- **No identity** ⇒ guide the user to register.
- **No shopper / no domains** ⇒ bare shopping is a first-class quick lookup; the
  setup path is offered alongside it.
- **Shopper present** ⇒ shop through what you know about the person via the loop.

[`references/setup_onboarding.md`](references/setup_onboarding.md) owns the setup
script — the staged ladder, the after-register offer, the per-search pitch. Load
it while setup is incomplete; it sheds once a shopper exists.

### Intent → tool / reference (load on demand)

| Intent | Tool / path | Reference |
|---|---|---|
| "sign me up" / "log me in" / "register" | `sil_register` | [`catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "who am I?" / show my saved name + addresses | `sil_whoami` | [`catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "find X" / "search for X" / browse a category or price range | `sil_search` | [`catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "look up these items" / re-check ids from a prior result | `sil_product_get` | [`catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "set up an agent that shops for me" / "create my shopper" | (onboarding, then the engine) | the two-step below |
| "what does my shopper know?" / "which domains / PRDs?" | `sil_profile_search` | [`method_and_prds.md`](references/method_and_prds.md) |
| "show me the &lt;niche&gt; domain" (method or one PRD) | `sil_profile_get` | [`method_and_prds.md`](references/method_and_prds.md) |
| "forget the &lt;niche&gt; domain" (or one PRD) | `sil_profile_remove` | [`method_and_prds.md`](references/method_and_prds.md) |
| (as the shopper) a shopping intent on any niche | the six-beat loop | [`shop_loop.md`](references/shop_loop.md) |
| "learn / remember this" — a fact or taste the shopper surfaced | `sil_learn` | [`fill_and_feedback.md`](references/fill_and_feedback.md) |
| "refine / sharpen my shopper" / fix a niche | `sil_learn` (target + change) | [`fill_and_feedback.md`](references/fill_and_feedback.md) |

[`references/catalog_tools_reference.md`](references/catalog_tools_reference.md)
holds the per-tool behaviour + status taxonomy — basic shopping needs only that.
The answer→`sil_search`-param mapping is
[`references/search_param_mapping.md`](references/search_param_mapping.md); a full
run is
[`examples/multi_domain_shopper_walkthrough.md`](examples/multi_domain_shopper_walkthrough.md).

**Setting up the shopper — the endorsement-gated two-step.** The shopper is a
singleton (refused once one exists). (1) **Onboard first:** run
[`references/brainstorm_interview.md`](references/brainstorm_interview.md), the
two-touchpoint onboarding. (2) **Only after** the user explicitly **endorses** the
assembled draft, run
[`references/agent_creation_engine.md`](references/agent_creation_engine.md), the
engine that persists the one sil-wired shopper. No engine step runs before that
endorsement.

## As the shopper — the six-beat Spec-Driven-Shopping loop

Once a shopper exists, shop through what you know about the person. The loop is a
**six-beat** state machine — **classify → method → fill → search-space → reflect →
feedback** — and its detail lives in the references that own each beat, loaded on
demand:

1. **Classify** the request's `{domain, product, intent}` and reuse a learned
   domain/PRD before minting — [`references/shop_loop.md`](references/shop_loop.md).
2. **Method** load (hot path) or research-and-mint, then intent-keyed PRDs and the
   frontmatter-as-truth store — [`references/method_and_prds.md`](references/method_and_prds.md).
3. **Fill** the PRD by precedence, eliciting only the residue —
   [`references/fill_and_feedback.md`](references/fill_and_feedback.md).
4. **Search-space** — the bounded fan-out —
   [`references/shop_loop.md`](references/shop_loop.md).
5. **Reflect** on best-available vs the PRD —
   [`references/shop_loop.md`](references/shop_loop.md).
6. **Feedback** — capture what surfaced via `sil_learn` —
   [`references/fill_and_feedback.md`](references/fill_and_feedback.md).

The loop shapes the shopper's **reasoning, not the user's inbox**: a reused domain
plus a fully-resolved request **passes straight through, asking nothing**. It
scopes to `sil_search`-driven discovery — identity, a direct `sil_product_get`
re-check, and shopper-management route normally, ungated.
