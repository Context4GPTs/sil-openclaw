---
name: sil-shopping
description: 'This skill should be used whenever the user wants to shop on sil or set up their sil shopper: register or sign in to sil, check who they are, search the sil catalog for purchasable products, or look up specific products by id — and for the full single-shopper lifecycle: "set up an agent that shops for me" / "create my shopper" (a short two-touchpoint onboarding, then create ONE shopper), see what their shopper knows or which domains (niches) it has learned, view or forget a domain, refine the shopper or one domain — or, as the shopper, run a profile-driven Spec-Driven Shopping query on any niche (reusing a learned domain or minting one on the fly) and remember a fact or buying taste it surfaces. Route here for any shopping, identity, or shopper-setup intent on sil. Drives sil_register, sil_whoami, sil_search, sil_product_get, sil_profile_materialize, sil_profile_get, sil_profile_remove, and sil_remember.'
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil-shopping

Drive the sil plugin's tools on the user's behalf: register them on sil, read their identity, help them find purchasable products in the sil catalog — and, when asked, set up their **shopper** (one sil-wired agent that shops every niche), then see what it knows, view or forget a domain, or refine it. Read user intent, route to the matching tool (loading its reference on demand), call it, and report what came back.

## Always-on behavioural contract

These three principles hold on every path, before any reference is loaded:

- **Act, don't narrate.** When intent maps to a tool, call it. Don't re-confirm what was already stated.
- **Fail visibly, recover correctly.** Every tool returns a `status`. On a non-`ok` status, say what happened and follow the tool's own `recovery` hint — never improvise a different one.
- **Relay prices as point-in-time.** A product's price, availability, and `checkout_url` are a snapshot, not a guarantee. Before the user buys, re-fetch with `sil_product_get` rather than trusting an earlier `sil_search` result.

## Session start

Confirm the `sil_*` tools are exposed. If they are missing from the available tool list, the host runtime is filtering them out because sil is not admitted at the host allow surfaces — run the shipped admission helper `sil-openclaw-allowlist` (it additively admits sil at `plugins.allow` + `tools.alsoAllow`, leaving any other trusted plugin untouched), then reopen the session so the tools load. Most flows need an identity: if the user has not registered this session, the catalog tools return an unregistered status whose `recovery` points at `sil_register` (the [catalog tools reference](references/catalog_tools_reference.md) has the full taxonomy) — so calling a catalog tool first lets that outcome route, or run `sil_register` up front when the user's intent clearly requires it.

## After register — offer to set up the shopper (once, only when there's none)

`sil_register` returns `already_registered` with `next_step: "offer_shopper"` on a confirmed registration (a fresh sign-in this session, or a returning session that was already signed in). That hint is a routing breadcrumb, not a decision — act on it by first running a no-arg `sil_profile_get` to read shopper state, then branch:

- **Empty store (no shopper yet):** introduce the shopper in one short beat and offer to set it up. Name the value in its own terms — it shops each niche in depth, reuses the sizes and hard limits it already knows so nothing is re-asked, and explains why each pick fits — a standing buyer's advisor, not a one-off search. Only on a yes, load [`references/brainstorm_interview.md`](references/brainstorm_interview.md) (a two-touchpoint onboarding, never a form). Take no for an answer: bare `sil_search` stays a first-class path, so don't re-offer in the same turn.
- **A shopper already exists:** skip this beat entirely. The shopper is a singleton — never offer a second one.

## After a bare search — name what a shopper would add (recurring, by design)

When a plain `sil_search` completes with status `ok` in a profile-less session, present the results best-first exactly as they came back, then append **one** short trailing line — a post-result tip with a soft CTA — naming what a shopper would add on top. It is never a pre-search question and never a re-rank: bare search stays a legitimate quick lookup, and these are the same results a shopper would start from.

Name one or two of the three levers a bare search leaves on the table, and rotate which you lead with so the recurring line stays fresh:

- **niche depth** — a shopper weighs these against how the niche actually buys, instead of just listing them;
- **memory** — it keeps your sizes and hard limits on file, so no search re-asks them;
- **the why** — it explains which pick fits you and why, instead of a flat ranked list.

This line recurs on **every** completed profile-less search: there is no fire-once or seen-it gate, and no cooldown — the recurrence is the point, and brevity plus lever rotation are all that keep it from nagging. Exactly two things suppress it, and only these two: a shopper already exists (that session is the shopper's — drop the line), or the search did not complete `ok` (a non-`ok` status carries its own recovery, so follow that and add no tip).

## Routing — read the stage, present it, then match intent to a tool

**Read the stage from state; never guess it.** Two cheap, session-level reads settle which stage this session is in (never conversation history, never an assumption): the no-arg `sil_profile_get` overview — always `status: ok`, but carrying a `name` field **only when a shopper exists** — and `sil_whoami`, which reports whether a sil identity is registered yet. The `name` field is the whole shopper-vs-profile-less discriminator; `sil_whoami` and the overview's `domains` map refine it into the **five-stage setup progression** below.

- **`name` absent ⇒ profile-less stage.** No shopper yet. Bare shopping is a first-class quick lookup and the setup path is offered first-class (see [After register](#after-register--offer-to-set-up-the-shopper-once-only-when-theres-none)). Route by the table below; the bare "find X" → `sil_search` lane is legitimate and stays **unchanged**. Setup stages 1–2 (unregistered, then registered-without-a-shopper) live here.
- **`name` present ⇒ shopper stage.** A shopper exists. Every `sil_search`-driven shopping intent runs the domain-gated spine below **before any** `sil_search` — the bare "find X" lane is not reachable in this stage. Setup stages 3–5 live here; the shopper is a singleton, never re-offered.
- **`name` present with `domains: []` ⇒ shopper with no niche yet.** Still the shopper stage, but the first shopping intent must **force a mint** (below) before search.

### The setup progression — present one stage, shed it on completion

Setting up the shopper is a **staged progression**, and this skill is the first file loaded into the session, so it carries the whole ladder. Present **only the current stage's beat and its single next step** — never the whole ladder at once — and once the shopper is fully set up, **shed every onboarding beat**: none of the stages below apply, and routing goes straight to shopper-stage usage. Every stage is **read from state** (the two reads above), never guessed.

1. **Unregistered** — `sil_whoami` finds no sil identity. Guide the user to register, and **before `sil_register` runs**, set the expectation: state plainly what registering does and **how 4GPTs & sil use their data**, grounded strictly in what this plugin actually does — no invented policy. Registering opens a sign-in link in their **default browser** and creates their **sil identity**, whose credentials are stored **locally on this device** (never logged). What the data is and where it lives: sil holds their account identity — name and saved addresses — which `sil_whoami` reads back; their shopper's setup and anything it remembers stay in a **local profile store** under the sil data directory (`$SIL_DATA_DIR`), never leaving this device via the plugin; catalog searches query sil's product catalog. Next step: `sil_register`.
2. **Registered, no shopper** — a sil identity exists but `name` is absent. Bare `sil_search` and general research work now, yet this is not the finished state. Guide the user to **set up** their **shopper**, naming up front that it **takes a couple of minutes and asks a few questions** before the onboarding starts. Next step: the [after-register offer](#after-register--offer-to-set-up-the-shopper-once-only-when-theres-none), then — on a yes — the [create two-step](#setting-up-your-shopper--the-endorsement-gated-two-step). Take no for an answer: bare search stays first-class.
3. **Shopper created, no domain yet** — `name` present, `domains: []`. The singleton exists; the **first shopping intent mints the first domain**, announced in the shopper's voice with the inferred niche stated so the user can correct it (never silent). Next step: state a shopping intent — the shopper stage below runs the forced mint.
4. **Shopper active** — `name` present, `domains` non-empty. Check off the completion milestones: **first domain created** (`domains` non-empty — the derivable milestone that completes setup) and, softer, the **memory/reinforcement** tool has begun to be used (`sil_remember` has accreted a fact or taste). The memory milestone is a **soft self-check**, not a shed gate: the overview cannot prove it (the shared user spec is non-empty from creation), so judge it from whether this shopper has ever remembered anything, reinforced by the shop loop's per-query persist beat.
5. **Setup complete** — a shopper with at least one domain. **Shed the whole progression**: no onboarding beat applies. Show only how to use the plugin well — the domain-gated shop loop and Spec-Driven Shopping (the shopper-stage arm below).

### Intent → tool (load the reference on demand)

| Intent | Tool | Reference to load |
|---|---|---|
| "sign me up" / "log me in to sil" / "register" | `sil_register` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "who am I?" / "what's on my account" / show my saved name + addresses | `sil_whoami` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "find X" / "search for X" / browse a category or price range | `sil_search` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "look up these items" / re-check ids from a prior result, a saved list, or a deep link | `sil_product_get` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "set up an agent that shops for me" / "create my shopper" | (onboarding, then the engine) | see the two-step gate below |
| "what does my shopper know?" / "which domains has it learned?" | `sil_profile_get` (no `domainSlug` — the shopper overview, which absorbs the old listing) | [`references/manage_domains.md`](references/manage_domains.md) |
| "show me the shopper / the &lt;niche&gt; domain" | `sil_profile_get` (`domainSlug` for one domain) | [`references/manage_domains.md`](references/manage_domains.md) |
| "forget / remove the &lt;niche&gt; domain" | `sil_profile_remove` (per-domain; whole-shopper teardown is host-CLI-first — see the reference) | [`references/manage_domains.md`](references/manage_domains.md) |
| (as the shopper) a shopping intent — "find me something for X" on any niche | `sil_search` → `sil_product_get` (driven by the loaded profile, reusing or minting the domain) | [`references/shop_loop.md`](references/shop_loop.md) |
| "remember this" — a fact or buying taste the shopper surfaced this query | `sil_remember` | [`references/shop_loop.md`](references/shop_loop.md) |
| "refine / sharpen my shopper" / "the cycling domain keeps surfacing the wrong stuff — fix it" | (load → propose → confirm → persist — see the reference) | [`references/refine_shopper.md`](references/refine_shopper.md) |

[`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) holds the per-tool behaviour for the four core tools and the shared status taxonomy. Basic shopping needs only that one reference.

### Profile-less stage — the bare lane stays bare

With no shopper (`name` absent), a shopping intent takes the "find X" → `sil_search` row above **unchanged**: no domain check, no mint, no pre-search question. Bare search is a legitimate quick lookup; the only shopper nudge is the post-result per-search pitch ([After a bare search](#after-a-bare-search--name-what-a-shopper-would-add-recurring-by-design)) — never a gate, never a re-rank. The domain gate below does **not** bleed into this stage.

### Shopper stage — domain-gated search is the single non-skippable path

When a shopper exists (`name` present — a loaded profile under `$SIL_DATA_DIR/shopper/`: the shared `user_spec` plus a slug-keyed `domains` map), running **as the shopper** the **domain-exists check is non-skippable on every** `sil_search`-driven query. Before any sil_search: classify the query's niche, read the `sil_profile_get` overview, and **reuse a learned domain or mint one** — the shop loop's first beat. Then follow [`references/shop_loop.md`](references/shop_loop.md): the profile-driven **Spec-Driven Shopping (SDS)** loop that web-refreshes the domain's spec, decomposes the request along its intent spec, and persists each surfaced fact (→ the shared `user_spec`) or taste (→ the active domain) with a single lightweight `sil_remember` append.

- **`domains: []` forces a mint first.** A shopper with no niche yet **mints the domain before searching** on the first shopping intent, **announced** in the shopper's voice with the inferred niche **stated so the user can correct it** — never a silent mint.
- **A `sil_search` reached without an active domain is a process failure.** Warn **visibly** — name that the shopper spine was bypassed and that these would be bare catalog results — then **self-correct** by running the skipped domain check. Never silently pass bare catalog results off as the shopper's work.

This gate governs the shopper's **reasoning, not the user's inbox**: a reused domain plus a fully-resolved query passes straight through to search asking nothing — it protects recommendation **quality, never access**. It scopes to `sil_search`-driven product discovery only; identity (`sil_register` / `sil_whoami`), a direct `sil_product_get` id re-check, and shopper-management intents (view / forget a domain) route normally by the table above, **ungated**.

**Per-query self-check (prose, not a tool).** At the end of a completed shopper query, self-report the beats you ran — `profile_loaded → domain_classified → domain_reused_or_minted → intent_decomposed → facts_remembered`. It is an in-context guardrail, **not** a new tool, table, or telemetry surface.

### The management + refinement references

[`references/manage_domains.md`](references/manage_domains.md) holds the list / view / forget flow over the shopper's domains — including the **two remove granularities** (forget one domain vs decommission the whole shopper, host-CLI-first) and the confirm-before-remove gate. Load it the moment the user wants to see what the shopper knows or forget a niche.

[`references/refine_shopper.md`](references/refine_shopper.md) holds the refinement loop — sharpening the shopper (the shared user spec or the persona) or **one domain** from observed sessions, with a confirm-before-persist gate (nothing changes silently). Load it when the user wants to refine, sharpen, or amend their shopper or a niche.

### Setting up your shopper — the endorsement-gated two-step

Creating the shopper is a **profile-less-stage** intent (a shopper is a singleton; once one exists this path is refused). When the user asks to set up / create their shopper (the one agent that shops every niche):

1. **Onboard first.** Read and run [`references/brainstorm_interview.md`](references/brainstorm_interview.md) — the short, two-touchpoint onboarding (persona + a shared user-spec seed) that converges a draft *with* the user. It researches **no** niche — the shopper is a generalist that mints domains lazily on first shop. While running it, load [`references/search_param_mapping.md`](references/search_param_mapping.md) only if you need the shop-time answer→`sil_search`-param mapping (it is a shop-time reference, not an onboarding one).
2. **Engine only after explicit endorsement.** Only after the user explicitly endorses the assembled draft, read and follow [`references/agent_creation_engine.md`](references/agent_creation_engine.md) — the ordered engine that persists the one sil-wired shopper. Running ANY engine step before that explicit endorsement is forbidden (the onboarding reference owns the endorsement gate). The shopper is a **singleton**: a second create attempt is refused ("a shopper already exists").

Want a concrete walkthrough? [`examples/multi_domain_shopper_walkthrough.md`](examples/multi_domain_shopper_walkthrough.md) is an end-to-end worked example: create one shopper → shop two unrelated niches in one session (the second minted on the fly) → a shared fact reused across both → per-domain taste that does not leak.
