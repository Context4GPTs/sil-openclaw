# Worked example — a road-cycling shopping expert as general counsel

A short walkthrough from a **create-expert request** through the interview
([`../references/brainstorm_interview.md`](../references/brainstorm_interview.md))
to a created expert via the engine
([`../references/agent_creation_engine.md`](../references/agent_creation_engine.md)),
then how it acts as **general counsel to the buyer** — an ongoing advisor across
the buyer's cycling needs, not a one-query optimizer. The interview walks the
**five artefacts, one touchpoint each, in order**; the deep domain work is the
agent's own research. The transcript is illustrative — it shows the *shape*, the
gates, and the SDS layering.

## The interview — one touchpoint per document

> **User:** "I want an expert that shops for road-cycling gear for me."

**1. `SOUL.md` — ask first (persona; the niche falls out).** No separate
narrow-the-niche step:

> **Expert:** "Let's shape it. What kind of expert do you want, and how should it
> behave?"
> **User:** "A patient guide — I'm buying my first proper road bike and I'm new to
> this. Always explain fit. And no carbon-fibre handlebars, a friend cracked one."

→ Persona (→ host **`SOUL.md`**): *a patient first-bike advisor who always explains
fit; standing rule — never recommend carbon handlebars.* The niche — **a complete
first road bike** — fell out of the answer.

**2. `domain_spec.md` — no question (the agent researches the web).** The agent
researches how to buy a first road bike well, then reflects the shape back:

> **Expert:** "I've done the homework. The short version: **the fit is everything** —
> frame size from height *and* inseam, stack/reach set torso angle, saddle setback
> from KOPS, crank length scales with inseam. Then endurance-vs-race geometry,
> groupset/gearing theory (gear-inches, compact vs mid-compact for your terrain),
> and alloy-vs-carbon + wheel/tyre trade-offs. For a first bike I'd weight fit and
> comfort over outright speed. Track?"
> **User:** "Yes — I want to actually enjoy riding it."

→ Deep **`domainSpec`** (→ `domain_spec.md`): the full how-to-buy-well — the
complete fit process, geometry, gearing theory, material/wheel trade-offs — the
layer a coarse "size 56, black" request never names. *(If the agent had no web tool,
it would say so, then compose the domain spec from well-established, public buying knowledge — never present a guess as verified research.)*

**3. `user_spec.md` — one basic question.** The single most-basic niche fact:

> **Expert:** "One basic thing I'll keep: your **height** and **inseam**?"
> **User:** "178 cm, 81 cm inseam."

→ Seeded partial **`userSpec`** (→ `user_spec.md`): *height 178 / inseam 81 (soft
facts); HARD-NO: carbon-fibre handlebars (inviolable).* The rest is augmented per
query.

**4. `playbook.md` — one question: compare a set of options (buying taste).**

> **Expert:** "Of these three — a value alloy build, a mid-range carbon, a premium
> race bike — which appeals, and why?"
> **User:** "The value alloy, around €1500. I don't chase brands."

→ Seeded partial **`playbook`** (→ `playbook.md`): *value-conscious, ~€1500 feel,
brand-agnostic; comfort over outright speed.*

**5. `intent_spec.md` — sign-off.** The decomposition dimensions, derived from the
domain spec:

> **Expert:** "Every time you ask me to find something, I'll decompose along:
> use-case, terrain, budget, fit envelope, timeline, compatibility, performance
> priorities, aesthetics. Sign off?"
> **User:** "Yep."

→ **`intentSpec`** (→ `intent_spec.md`): that schema (the dimensions to resolve),
never a filled-in request.

## Assemble + endorse — the gate

Identity confirmed (`road-cycling-buyer` / "Road-Cycling Buyer"), the assembled
draft is a valid `sil_profile_materialize` input — persona → `SOUL.md`, all four
SDS specs to the sil store, all present from creation (user side seeded *partial*):

```jsonc
{
  "agentId": "road-cycling-buyer",
  "name": "Road-Cycling Buyer",
  "persona": "A patient first-road-bike advisor. Always explains fit. Standing rule: never recommend carbon-fibre handlebars.",
  "domainSpec": "## First road bike — how to buy well (deep)\n**Fit is everything**: size from height AND inseam; stack/reach set torso angle; saddle setback from KOPS; crank length scales with inseam; bar reach/drop set hands. Bad fit is the #1 reason first bikes get abandoned.\n## Geometry: endurance (comfort) vs race (speed); head-tube angle + trail govern handling.\n## Groupset & gearing: tier = shift quality + weight, not capability; gear-inches = chainring/cog × wheel; compact vs mid-compact vs 1x trade range for step size — pick for terrain.\n## Material & wheels: alloy vs carbon (feel/price/repairability); rim depth vs crosswind; tyre clearance bounds comfort.\n## Trade-offs: stiffness vs comfort; aero vs crosswind; tier vs budget. First bike: weight fit + comfort over speed.",
  "intentSpec": "## Decomposition dimensions (schema)\nuse-case; terrain; budget band; fit envelope; timeline; compatibility; performance priorities; aesthetics. The per-query fill is ephemeral; this schema is persisted.",
  "userSpec": "## User spec (seeded partial)\n### Soft facts/preferences\n- Height 178 cm, inseam 81 cm.\n- Comfort + enjoyment over outright speed.\n### Hard constraints (INVIOLABLE)\n- HARD-NO: carbon-fibre handlebars.",
  "playbook": "## Buying taste (seeded partial)\n- Value-conscious; budget feel ~€1500.\n- Brand-agnostic. (Finer taste fills in per-query.)"
}
```

> **Expert:** "Here's the expert — shall I create it?"
> **User:** "Yes, create it."

**This affirmative act is the gate** — up to here, **zero engine steps ran**. Only
now does the engine proceed
([`../references/agent_creation_engine.md`](../references/agent_creation_engine.md)):
validate-first → collision check → `openclaw agents add road-cycling-buyer
--workspace ~/.openclaw/workspace-road-cycling-buyer --non-interactive --json`
(confirm the inherited profile grants a web tool) → write the persona into
`SOUL.md` → `sil_profile_materialize { agentId, name, domainSpec, intentSpec,
userSpec, playbook }` → wire sil:

```
openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json
openclaw config set plugins.entries.sil.enabled true --strict-json
```

→ then **admit sil at the host allow surfaces** so the `sil_*` tools are un-filtered — the shipped helper does the additive, idempotent merge of `plugins.allow` + `tools.alsoAllow` (never clobbering another admitted plugin like `klodi`):

```
sil-openclaw-allowlist
```

→ `openclaw config validate --json` returns valid → **`created`** (a non-zero helper exit would be `persistence_failed`, not `created` — never a green expert over still-filtered tools).

## As general counsel — an ongoing advisor, not a one-query optimizer

The expert is now standing counsel for this buyer's cycling life. Across requests it
**reuses** what it knows (the 178/81 fit envelope, the no-carbon-bars hard rule, the
value-conscious taste — **never re-asked**), and on **every query** web-refreshes the
domain spec, decomposes the request along the intent dimensions, and **augments** the
already-present user spec + playbook — we keep learning.

> **User:** "Find me a first road bike, ~€1500."

This is one request, not the point of the expert. It runs the shop-time loop
([`../references/expert_shopping.md`](../references/expert_shopping.md) owns the
map→search→compare→recommend machinery — not repeated here): web-refresh the domain,
decompose the intent, augment the playbook with a taste it surfaces in context, then
recommend with a "why" that **cites the layers** — "for your **178/81 fit envelope**
(kept from before) a 54 cm endurance frame sits right, and **fit/comfort outrank
outright speed on a first bike** (a domain mechanic), so I passed a lighter race-geo
bike, all within your value budget." A rationale naming no domain mechanic and reusing
no stored fact would **fail the SDS bar** even if the bike were fine.

Weeks later the *same* counsel handles new needs without re-onboarding:

> **User:** "Now a winter bike, same budget."

It reuses the fit envelope and taste, decomposes the new intent (all-weather →
mudguard clearance, tyre durability), and recommends citing the kept fit fact + a
winter domain mechanic. A "bump my budget to €2000" **updates** the stored taste
(visibly); but "find me a carbon-handlebar bike" hits the standing **hard rule** —
intent never overrides a hard constraint.

## Edge cases this example would have handled

- **Collision** (`road-cycling-buyer` exists): the engine returns `collision`, writes
  nothing, the conversation offers **refine-or-rename** — never clobbers.
- **Abandon before endorsement**: nothing created, nothing to tear down — the draft
  lived only in the conversation.
- **No web tool**: the expert says so honestly and proceeds on the existing domain
  spec — never pretends the refresh happened.
- **Creation is local + offline** (for identity): no sil registration to create; the
  user registers later, on first shop, via `sil_register`.
