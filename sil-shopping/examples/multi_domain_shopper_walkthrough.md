# Worked example — one shopper, two unrelated niches, one session

A short walkthrough of the **headline capability**: create **ONE shopper**
([`../references/brainstorm_interview.md`](../references/brainstorm_interview.md) →
[`../references/agent_creation_engine.md`](../references/agent_creation_engine.md)),
then shop **two unrelated niches in the same session** — the second **minted on
the fly** — with a **shared fact reused across both** and **per-domain taste that
does not leak**. The transcript is illustrative — it shows the *shape*, the gates,
and the SDS layering, not exact wording.

## Onboarding — two touchpoints, NO niche research

> **User:** "Set up something that shops for me."

The shopper is a **generalist** — onboarding touches only the persona and the
shared user spec; it researches **no** niche.

**1. `SOUL.md` — ask first (persona; a generalist, NOT a niche).**

> **Shopper:** "Let's set up your shopper. How do you want it to behave?"
> **User:** "Be concise and a bit opinionated — and never recommend anything with
> leather, it's an ethics thing for me."

→ Persona (→ host **`SOUL.md`**): *concise, lightly opinionated generalist.* No
niche is chosen — it will shop whatever the user buys.

**2. `user_spec.md` (shared) — seed the cross-niche facts + hard constraints.**

> **Shopper:** "Anything I should always know — sizes, where to ship, hard rules?"
> **User:** "Ship to 12 Rue Centrale, Lyon, France. And the no-leather rule is
> absolute."

→ Seeded partial **shared `userSpec`** (→ `user_spec.md`): *ship-to Lyon, France
(soft fact); **HARD-NO: leather** (inviolable, carries across every niche).* The
rest is augmented per query.

## Assemble + endorse — the gate

Identity confirmed (`my-shopper` / "My Shopper"), the assembled draft is a valid
`sil_profile_materialize` **create** input — persona → `SOUL.md`, the **shared
user spec only** (no domain pack at create):

```jsonc
{
  "agentId": "my-shopper",
  "name": "My Shopper",
  "persona": "A concise, lightly opinionated generalist shopper.",
  "userSpec": "## Shared user spec (seeded partial)\n### Soft facts\n- Ship-to: 12 Rue Centrale, Lyon, France.\n### Hard constraints (INVIOLABLE — every niche)\n- HARD-NO: leather (ethics)."
}
```

> **Shopper:** "Here's your shopper — shall I create it?"
> **User:** "Yes, create it."

**This affirmative act is the gate** — up to here, **zero engine steps ran**. Only
now does the engine proceed
([`../references/agent_creation_engine.md`](../references/agent_creation_engine.md)):
validate-first → singleton check → `openclaw agents add my-shopper --workspace
~/.openclaw/workspace-my-shopper --non-interactive --json` (confirm the inherited
profile grants a web tool) → write the persona into `SOUL.md` →
`sil_profile_materialize { agentId, name, userSpec }` **(NO `domain` — writes the
shared `user_spec.md` + `profile.json` with an empty `domains: {}`)** → wire sil:

```
openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json
openclaw config set plugins.entries.sil.enabled true --strict-json
```

→ then **admit sil at the host allow surfaces** so the `sil_*` tools are un-filtered
— the shipped helper does the additive, idempotent merge of `plugins.allow` +
`tools.alsoAllow` (never clobbering another admitted plugin like `klodi`):

```
sil-openclaw-allowlist
```

→ `openclaw config validate --json` returns valid → **`created`** (a non-zero
helper exit would be `persistence_failed`, not `created` — never a green shopper
over still-filtered tools). The shopper now exists with an **empty `domains` map** —
healthy; it will mint each niche on first shop.

## Niche A — road cycling (minted on the fly, announced)

> **User:** "Find me a first road bike, around €1500."

The shop loop ([`../references/shop_loop.md`](../references/shop_loop.md) owns the
machinery — not repeated here) classifies the niche (**road cycling**), reads
`profile.json.domains`, finds **no** matching domain, and **mints it on the spot —
announced**:

> **Shopper:** "I haven't shopped cycling for you yet — setting that up now (road
> cycling, first bike). One sec while I do the homework."

It **researches** the niche deeply (the deep `domainSpec` — the full how-to-buy:
**fit is everything** — frame size from height *and* inseam, stack/reach, saddle
setback, crank length; geometry; gearing theory; material/wheel trade-offs),
derives the `intentSpec` dimensions, seeds a partial `playbook`, then persists with
the **whole-doc** mint:

```jsonc
sil_profile_materialize {
  agentId: "my-shopper",
  name: "My Shopper",
  userSpec: "…the current shared spec (re-persisted)…",
  domain: {
    slug: "road-cycling", name: "Road cycling",
    domainSpec: "## First road bike — how to buy well (deep)\nFit is everything: size from height AND inseam; stack/reach set torso angle; saddle setback from KOPS; crank length scales with inseam…\n## Geometry: endurance vs race. ## Gearing: gear-inches, compact vs mid-compact. ## Material/wheels: alloy vs carbon; rim depth vs crosswind.",
    intentSpec: "## Dimensions (schema)\nuse-case; terrain; budget band; fit envelope; timeline; compatibility; performance priorities; aesthetics.",
    playbook: "## Buying taste (seeded partial)\nTo be learned as we shop."
  }
}
```

Then the loop runs on the active **road-cycling** domain: decompose the intent
(first bike, ~€1500), map → `sil_search` → compare on the rubric, and recommend
with a **"why" that cites the layers** — "for a first bike **fit/comfort outrank
outright speed** (a domain mechanic), a 54 cm endurance frame sits right, and I kept
it within your value budget; **no leather anywhere** (your standing hard rule)." A
rationale naming no domain mechanic and reusing no stored fact would **fail the SDS
bar** even if the bike were fine.

The session surfaces a **taste**, captured the **cheap** way — one append, scoped to
this domain:

> **User:** "I don't chase brands — value over name."

```
sil_remember { agentId: "my-shopper", kind: "taste", text: "Value over brand; ~€1500 band.", domain: "road-cycling" }
```

That taste lands in **`domains/road-cycling/playbook.md`** — this niche only.

## Niche B — espresso (a SECOND niche, same session, no switch)

Moments later, **same session, no agent switch, no re-onboarding**:

> **User:** "Different thing — I want a home espresso machine, decent but not crazy."

The loop classifies the niche (**espresso**), reads `profile.json.domains`, finds
no match, and **mints espresso on the fly — announced** ("new niche for me —
setting up espresso") with its own deep `domainSpec` (boiler type, PID, pressure
profiling, portafilter size, grinder pairing), `intentSpec`, and partial `playbook`,
via a second whole-doc `sil_profile_materialize` with `domain.slug: "espresso"`.

**The shared fact carries — without being re-asked:**

> **Shopper:** "I'll ship to your Lyon address as usual" — **the ship-to from the
> shared `user_spec.md`, captured during onboarding, reused in espresso with no
> re-ask.** The **no-leather hard rule** also still applies (it rejects a
> leather-wrapped tamper handle outright).

**The niche taste does NOT leak:** the *value-over-brand, ~€1500* taste lives in
`domains/road-cycling/playbook.md` and **does not shape** the espresso picks —
espresso starts with its own (partial) taste, learned fresh:

> **User:** "For coffee I'll happily pay for a known reliable brand."

```
sil_remember { agentId: "my-shopper", kind: "taste", text: "Pays up for a reliable known brand.", domain: "espresso" }
```

→ lands in **`domains/espresso/playbook.md`** only. Road cycling's "value over
brand" and espresso's "pay for a known brand" coexist **without contradiction** —
that is per-domain taste isolation. A **fact** (a new measurement, a hard rule) would
instead go to the **shared** `user_spec.md` (`kind: "fact"`) and carry to *both*
niches.

## The singleton edge — refuse a second shopper

> **User:** "Can you make me a second shopper just for coffee?"
> **Shopper:** "You already have a shopper — it handles every niche. I've added
> espresso as a domain on it; I won't create a second shopper. Want me to refine
> the espresso domain instead?"

The engine's **singleton refusal** (`collision`, "a shopper already exists") — one
shopper, many domains; you never mint a second.

## Edge cases this example would have handled

- **Reuse before mint** — asking for "another road bike, this time for winter" reuses
  the **existing `road-cycling` domain** (semantic dedup), never mints a near-duplicate
  `cycling` / `bikes` pack.
- **Forget one domain ≠ decommission the shopper** — "forget espresso" runs
  `sil_profile_remove { agentId, domainSlug: "espresso" }` (artefact-only; the shopper,
  the shared user spec, and the road-cycling domain survive). Tearing down the whole
  shopper is the separate host-CLI-first path.
- **No web tool**: the shopper says so honestly at mint time and composes the domain
  spec from public buying knowledge — never pretends the research happened.
- **Creation is local + offline** (for identity): no sil registration to create; the
  user registers later, on first shop, via `sil_register`.
