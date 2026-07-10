---
name: sil-shopping
description: 'Use for any sil shopping, identity, or shopper-setup intent: register or sign in, check the account, search the sil catalog for purchasable products, or look up products by id — plus the single-shopper lifecycle: create the shopper (a short two-touchpoint onboarding), see what it knows or which domains (niches) it has learned, view or forget a domain, refine it — or, as the shopper, run a Spec-Driven Shopping query on any niche and remember a fact or buying taste it surfaces. Drives sil_register, sil_whoami, sil_search, sil_product_get, sil_profile_materialize, sil_profile_get, sil_profile_remove, and sil_remember.'
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil-shopping

Drive the sil plugin's tools on the user's behalf: register them, read their
identity, help them find purchasable products — and, when asked, set up their
**shopper** (one sil-wired agent that shops every niche), then see what it knows,
view or forget a domain, or refine it. Read intent, route to the matching tool
(loading its reference on demand), call it, and report what came back.

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
`sil_whoami` (is a sil identity **registered** yet?) and the no-arg
`sil_profile_get` overview (its **`name` field** is the whole discriminator —
present only once a shopper exists).

- **No identity** ⇒ guide the user to register.
- **`name` absent ⇒ profile-less stage** — bare shopping is a first-class quick
  lookup; the setup path is offered alongside it.
- **`name` present ⇒ shopper stage** — shop through what you know about the person.

[`references/setup_onboarding.md`](references/setup_onboarding.md) owns the setup
script — the staged ladder, the after-register offer, the per-search pitch. Load
it while setup is incomplete; it sheds once a shopper exists.

### Intent → tool (load the reference on demand)

| Intent | Tool | Reference |
|---|---|---|
| "sign me up" / "log me in" / "register" | `sil_register` | [`catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "who am I?" / show my saved name + addresses | `sil_whoami` | [`catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "find X" / "search for X" / browse a category or price range | `sil_search` | [`catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "look up these items" / re-check ids from a prior result | `sil_product_get` | [`catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "set up an agent that shops for me" / "create my shopper" | (onboarding, then the engine) | the two-step below |
| "what does my shopper know?" / "which domains has it learned?" | `sil_profile_get` (no `domainSlug`) | [`manage_domains.md`](references/manage_domains.md) |
| "show me the &lt;niche&gt; domain" | `sil_profile_get` (`domainSlug`) | [`manage_domains.md`](references/manage_domains.md) |
| "forget the &lt;niche&gt; domain" | `sil_profile_remove` | [`manage_domains.md`](references/manage_domains.md) |
| (as the shopper) a shopping intent on any niche | `sil_search` → `sil_product_get` | [`shop_loop.md`](references/shop_loop.md) |
| "remember this" — a fact or taste the shopper surfaced | `sil_remember` | [`shop_loop.md`](references/shop_loop.md) |
| "refine / sharpen my shopper" / fix a niche | (load → propose → confirm → persist) | [`refine_shopper.md`](references/refine_shopper.md) |

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

### Profile-less stage — the bare lane stays bare

**`name` absent.** A shopping intent takes the "find X" → `sil_search` row above
**unchanged** — no domain check, no mint, no pre-search question. Bare search is a
legitimate quick lookup; the only nudge is the profile-less per-search pitch
([`references/setup_onboarding.md`](references/setup_onboarding.md)).

### Shopper stage — shop through what you know

**`name` present.** As the shopper, shop through what you know about the person:
classify the query's niche and **reuse a learned domain or mint one before
searching** — the shop loop's first beat — then follow
[`references/shop_loop.md`](references/shop_loop.md), the profile-driven
**Spec-Driven Shopping** loop that web-refreshes the domain, decomposes the
request, and persists each surfaced fact or taste with a single `sil_remember`.

- **An empty `domains` map means no niche yet:** the first shopping intent **mints
  the domain before searching**, **announced** with the inferred niche stated so
  the user can correct it — never a silent mint.

This shapes the shopper's **reasoning, not the user's inbox**: a reused domain plus
a fully-resolved query **passes straight through, asking nothing**. It scopes to
`sil_search`-driven product discovery only — identity (`sil_register` /
`sil_whoami`), a direct `sil_product_get` id re-check, and shopper-management
intents (view / forget a domain) route normally, **ungated**.

**Per-query self-check (prose, not a tool).** As you shop, keep track of which
beat you're on and that you resolved the domain before searching — an in-context
guardrail, not a new tool, table, or telemetry surface.

Management + refinement load on demand:
[`references/manage_domains.md`](references/manage_domains.md) (view/forget,
confirm-before-remove) and
[`references/refine_shopper.md`](references/refine_shopper.md) (sharpen from observed
sessions, confirm-before-persist).
