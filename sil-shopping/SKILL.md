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

## Always-on behavioural contract

Three principles hold on every path, before any reference loads:

- **Act, don't narrate.** When intent maps to a tool, call it — don't re-confirm
  what was already stated.
- **Fail visibly, recover correctly.** Every tool returns a `status`. On a
  non-`ok` status, say what happened and follow the tool's own `recovery` hint —
  never improvise a different one.
- **Relay prices as point-in-time.** A price, availability, and `checkout_url`
  are a snapshot. Before the user buys, re-fetch with `sil_product_get` rather
  than trusting an earlier `sil_search` result.

## Session start

Confirm the `sil_*` tools are exposed. If they are missing from the tool list,
the host is filtering them because sil is not admitted at the host allow
surfaces — run the shipped admission helper `sil-openclaw-allowlist` (it
additively admits sil at `plugins.allow` + `tools.alsoAllow`, leaving other
trusted plugins untouched), then reopen the session so the tools load. Most flows
need an identity: calling a catalog tool first lets an unregistered outcome route
to `sil_register` (the [catalog tools reference](references/catalog_tools_reference.md)
has the taxonomy), or run `sil_register` up front when intent clearly requires it.

## Routing — read the stage, then match intent to a tool

**Read the stage from state — never guess it.** Two cheap session-level reads
settle which **stage** this session is in: the no-arg `sil_profile_get` overview
(its **`name` field** is the whole discriminator — present only when a shopper
exists) and `sil_whoami` (whether a sil **identity** is **registered** yet). Setup
is a **five-stage** onboarding **progression**;
[`references/setup_onboarding.md`](references/setup_onboarding.md) carries its full
script — the staged ladder, the after-register offer, and the per-search pitch —
so present only the current stage, and once setup is complete, shed all of it.

- **`name` absent ⇒ profile-less stage** — bare shopping is a first-class quick
  lookup; the setup path is offered first-class (see setup_onboarding).
- **`name` present ⇒ shopper stage** — the domain gate governs every
  `sil_search`-driven intent; setup stages 3–5 live here.

### Intent → tool (load the reference on demand)

| Intent | Tool | Reference |
|---|---|---|
| "sign me up" / "log me in" / "register" | `sil_register` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "who am I?" / show my saved name + addresses | `sil_whoami` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "find X" / "search for X" / browse a category or price range | `sil_search` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "look up these items" / re-check ids from a prior result | `sil_product_get` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "set up an agent that shops for me" / "create my shopper" | (onboarding, then the engine) | the two-step below |
| "what does my shopper know?" / "which domains has it learned?" | `sil_profile_get` (no `domainSlug`) | [`references/manage_domains.md`](references/manage_domains.md) |
| "show me the &lt;niche&gt; domain" | `sil_profile_get` (`domainSlug`) | [`references/manage_domains.md`](references/manage_domains.md) |
| "forget the &lt;niche&gt; domain" | `sil_profile_remove` | [`references/manage_domains.md`](references/manage_domains.md) |
| (as the shopper) a shopping intent on any niche | `sil_search` → `sil_product_get` | [`references/shop_loop.md`](references/shop_loop.md) |
| "remember this" — a fact or taste the shopper surfaced | `sil_remember` | [`references/shop_loop.md`](references/shop_loop.md) |
| "refine / sharpen my shopper" / fix a niche | (load → propose → confirm → persist) | [`references/refine_shopper.md`](references/refine_shopper.md) |

[`references/catalog_tools_reference.md`](references/catalog_tools_reference.md)
holds the per-tool behaviour and the shared status taxonomy — basic shopping needs
only that one. The shop-time answer→`sil_search`-param mapping lives in
[`references/search_param_mapping.md`](references/search_param_mapping.md); a full
worked run is
[`examples/multi_domain_shopper_walkthrough.md`](examples/multi_domain_shopper_walkthrough.md).

**Setting up the shopper — the endorsement-gated two-step.** Creating the shopper
is a profile-less-stage intent (a singleton — refused once one exists). (1)
**Onboard first:** run
[`references/brainstorm_interview.md`](references/brainstorm_interview.md), the
two-touchpoint onboarding. (2) **Only after** the user explicitly **endorses** the
assembled draft, run
[`references/agent_creation_engine.md`](references/agent_creation_engine.md) — the
ordered engine that persists the one sil-wired shopper. Running any engine step
before that endorsement is forbidden.

### Profile-less stage — the bare lane stays bare

**`name` absent.** A shopping intent takes the "find X" → `sil_search` row above
**unchanged** — no domain check, no mint, no pre-search question. Bare search is a
legitimate quick lookup; the only shopper nudge is the profile-less per-search
pitch ([`references/setup_onboarding.md`](references/setup_onboarding.md)). The
domain gate below does **not** bleed into this stage.

### Shopper stage — domain-gated search, non-skippable

**`name` present.** Running **as the shopper**, the **domain-exists check is
non-skippable on every** `sil_search`-driven query, and the bare 'find X' lane is
**not reachable** in this stage. Before any search, read the `sil_profile_get`
overview, classify the query's niche, and **reuse a learned domain or mint one** —
the shop loop's first beat. Then follow
[`references/shop_loop.md`](references/shop_loop.md): the profile-driven
**Spec-Driven Shopping** loop that web-refreshes the domain, decomposes the
request, and persists each surfaced fact or taste with a single `sil_remember`.

- **`domains: []` forces a mint first.** A shopper with no niche yet **mints the
  domain before searching** on the first shopping intent, **announced** with the
  inferred niche **stated so the user can correct it** — never a silent mint.
- **A domain-less `sil_search` is a process failure.** **Warn visibly** — name
  that the shopper spine was bypassed and these would be bare catalog results —
  then **self-correct** by running the skipped domain check. Never silently pass
  bare catalog results off as the shopper's work.

This gate governs the shopper's **reasoning, not the user's inbox**: a reused
domain plus a fully-resolved query passes straight through, asking nothing — it
protects recommendation **quality, never access**. It scopes to
`sil_search`-driven product discovery only; identity (`sil_register` /
`sil_whoami`), a direct `sil_product_get` id re-check, and shopper-management
intents (view / forget a domain) route normally, **ungated**.

**Per-query self-check (prose, not a tool).** At the end of a completed shopper
query, self-report the beats you ran — `profile_loaded → domain_classified →
domain_reused_or_minted → intent_decomposed → facts_remembered`. It is an
in-context guardrail, not a new tool, table, or telemetry surface.

The management + refinement flows load on demand:
[`references/manage_domains.md`](references/manage_domains.md) for view/forget over
the shopper's domains (two remove granularities, confirm-before-remove), and
[`references/refine_shopper.md`](references/refine_shopper.md) for sharpening the
shopper or one domain from observed sessions (confirm-before-persist).
