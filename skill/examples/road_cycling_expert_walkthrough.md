# Worked example — a road-cycling shopping expert, end to end

A complete walkthrough from a free-form request through the **light** interview
([`../references/brainstorm_interview.md`](../references/brainstorm_interview.md))
to a created expert via the engine
([`../references/agent_creation_engine.md`](../references/agent_creation_engine.md)),
then on to its **Spec-Driven Shopping (SDS)** sessions: a **deep** domain spec
researched at creation, the **intent-spec dimensions** derived from it, a
**per-query web refresh** of the domain, a **lazily-captured** user fact + buying
taste, and a layered recommendation whose "why" cites the intent + a stored user
fact + a domain mechanic. The transcript is illustrative — a real interview adapts
to the user; this shows the *shape*, the gates, and the SDS layering. **Setup is
light (≤10 questions); the depth comes from the agent's own research.**

## 1. The free-form request

> **User:** "I want an expert that shops for road-cycling gear for me."

Reflect the request back and open with one orienting question — not a form:

> **Expert:** "A shopping expert for road-cycling gear — let's shape it together,
> lightly. We can revise anything. To start: are you after a complete bike, or kit
> and components (wheels, groupsets, apparel)?"

## 2. Narrow the (vague) domain FIRST

"Road-cycling gear" is broad. Narrow it before researching anything:

> **User:** "A complete road bike, actually — my first proper one."
> **Expert:** "Got it — the niche is **a complete road bike for a first proper
> buyer**, not components or apparel. Does that capture it?"
> **User:** "Yes."

The concrete, confirmed niche is locked before the research — the narrow-first gate
is satisfied. *(Questions so far: ~2.)*

## 3. Research the niche DEEPLY → the domain spec (the agent's own research)

With the niche concrete, the agent **researches it itself** (web + knowledge) —
pulling *everything* about how to buy a road bike well. It does **not** interrogate
the user for this; it reflects the depth back briefly and confirms the shape:

> **Expert:** "I've done the homework on how to buy a first road bike well. The
> short version of what drives a good buy:
> - **Fit is everything** — the full fitting process: frame size from your
>   height *and* inseam (not height alone); **stack & reach** set torso angle;
>   **saddle setback** from KOPS (knee-over-pedal-spindle); **crank length** scales
>   with inseam; **bar reach + drop** set hand position. A bike that doesn't fit is
>   the #1 reason first bikes get abandoned.
> - **Frame geometry** — endurance vs. race: head-tube angle + trail govern
>   handling; chainstay length trades stiffness against comfort; endurance geo
>   (taller stack, slacker) suits a first buyer better than aggressive race geo.
> - **Groupset & gearing theory** — 105 vs Ultegra vs Dura-Ace (tier = shift
>   quality + weight, not capability); **gear-inches = chainring/cog × wheel
>   diameter**; compact (50/34) vs mid-compact (52/36) vs 1x trade total range for
>   step size — pick range for your terrain, not bragging rights.
> - **Frame material & wheels** — alloy vs carbon (ride feel, price, repairability);
>   rim depth vs. crosswind stability (deeper = more aero, worse in gusts); tyre
>   clearance bounds how wide/comfortable you can go.
>
> The big trade-offs: a stiffer frame buys power transfer but costs all-day
> comfort; deeper wheels buy aero but punish you in crosswinds; a higher groupset
> tier buys shift quality + weight but costs budget. For a first bike I'd weight
> **fit and comfort over outright speed**. Does that track?"
> **User:** "Yes — comfort matters, I want to actually enjoy riding it."

→ Converged **domain spec** (lands in `domainSpec` → `domain_spec.md`): the full
**how-to-buy-well** of a first road bike — the complete fitting process (size,
stack/reach, saddle setback, crank length, bar reach), endurance-vs-race geometry,
gearing theory, material and wheel trade-offs, and the trade-offs that drive the
buy. This is deep researched substance — exactly the layer a coarse "size 56,
black" request never names. *(No question budget spent — the agent researched it.)*

## 4. Derive the intent-spec dimensions FROM the domain spec

From what it learned, the agent derives the **decomposition dimensions** every road-
bike query must resolve — a PRD-style schema, not a filled-in request:

> **Expert:** "So every time you ask me to find a bike, I'll decompose it along:
> **use-case** (commute / fitness / racing / touring), **terrain** (flat / hilly /
> mixed), **budget band**, **fit envelope** (your body measurements), **timeline**,
> **compatibility** (anything you're keeping — pedals, etc.), **performance
> priorities** (comfort vs. speed vs. weight), and **aesthetics**. That's my
> checklist for a good buy. Sound right?"
> **User:** "Yep."

→ Converged **intent spec** (lands in `intentSpec` → `intent_spec.md`): those
dimensions, derived from *this* niche's domain spec. It is the **schema** of what to
resolve, never the values for one request (those are the ephemeral per-query intent).
*(Question budget: ~3 total so far.)*

## 5. Converge the persona

> **Expert:** "How should this expert come across — a terse spec-checker, or a
> patient guide for a first buyer? Any standing rules?"
> **User:** "Patient and clear, I'm new to this. Always explain fit. No carbon-fibre
> handlebars — a friend cracked one and it scared me."
> **Expert:** "Persona: a patient, clear first-bike advisor who always explains fit;
> standing rule — never recommend carbon handlebars. Good?"
> **User:** "Perfect."

→ becomes the host workspace **`SOUL.md`** (the persona is the agent's system
framing — not a sil artefact). *(Question budget: ~5 total. Well under 10.)*

## 6. Derive + confirm the identity

> **Expert:** "I'll call it **Road-Cycling Buyer** (`road-cycling-buyer`). Good?"
> **User:** "Yes."

→ `agentId: road-cycling-buyer` (lower-kebab, ≠ `main`), `name: "Road-Cycling Buyer"`.

## 7. Assemble the draft and present it back

The assembled spec — a valid `sil_profile_materialize` input. The persona goes to
`SOUL.md` (host); the two **required** SDS specs go to the sil store. The user spec
and buying taste are **absent** — they fill lazily on first shop:

```jsonc
{
  "agentId": "road-cycling-buyer",
  "name": "Road-Cycling Buyer",
  "persona": "A patient, clear first-road-bike advisor. Always explains fit. Standing rule: never recommend carbon-fibre handlebars.",
  "domainSpec": "## First road bike — how to buy well (deep)\n### Fit (the full process)\nFrame size from height AND inseam; stack/reach set torso angle; saddle setback from KOPS; crank length scales with inseam; bar reach + drop set hand position. Bad fit is the #1 reason first bikes get abandoned.\n### Geometry\nEndurance (taller stack, slacker, longer chainstays — comfort) vs race (aggressive — speed). Head-tube angle + trail govern handling.\n### Groupset & gearing theory\n105/Ultegra/Dura-Ace = shift quality + weight, not capability. gear-inches = chainring/cog × wheel diameter. Compact vs mid-compact vs 1x trade range for step size — pick for terrain.\n### Material & wheels\nAlloy vs carbon (feel/price/repairability); rim depth vs crosswind stability; tyre clearance bounds comfort.\n### Trade-offs\nStiffness vs comfort; aero (deep wheels) vs crosswind handling; groupset tier vs budget. For a first bike: weight fit + comfort over outright speed.",
  "intentSpec": "## Decomposition dimensions for a road-bike query (schema)\nuse-case (commute/fitness/racing/touring); terrain (flat/hilly/mixed); budget band; fit envelope (body measurements); timeline; compatibility (kept parts); performance priorities (comfort/speed/weight); aesthetics.\nEach is a dimension the per-query intent fills in — the fill is ephemeral; this schema is persisted."
}
```

> **Expert:** "Here's the expert: a patient first-bike advisor that knows the full
> fit process, geometry, gearing theory, and the comfort-vs-speed trade-offs, and
> that decomposes every request along use-case, terrain, budget, fit, timeline,
> compatibility, priorities, and looks. Shall I create it?"

## 8. Explicit endorsement — the gate

> **User:** "Yes, create it."

**This affirmative act is the gate.** Up to this point, **zero engine steps have
run** — nothing was written. Only now does the engine proceed.

## 9. Run the engine (after endorsement)

Following [`../references/agent_creation_engine.md`](../references/agent_creation_engine.md) in order:

1. **Validate the spec FIRST** — `agentId` lower-kebab & ≠ `main` ✓, `name` ✓,
   `persona` ✓, `workspace` ✓, **`domainSpec` non-blank ✓, `intentSpec` non-blank ✓**.
2. **Collision check** — `openclaw agents list --json`; no existing
   `road-cycling-buyer` → proceed.
3. **Create the shell** — `openclaw agents add road-cycling-buyer --workspace
   ~/.openclaw/workspace-road-cycling-buyer --non-interactive --json`; confirm the
   inherited tool profile grants a **web/fetch** tool (SDS needs it for the per-query
   domain refresh).
4. **Persona → `SOUL.md` (host CLI)** — write the persona text directly into the
   agent's workspace `SOUL.md`. No `persona.md`, no copy step.
5. **Materialize SDS artefacts** — `sil_profile_materialize { agentId, name,
   domainSpec, intentSpec }` writes `domain_spec.md`, `intent_spec.md`, and
   `profile.json` into `$SIL_DATA_DIR/agents/road-cycling-buyer/`. No
   `user_spec.md` / `playbook.md` yet — those fill lazily, per-query.
6. **Wire sil** — `openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json` and `openclaw config set plugins.entries.sil.enabled true --strict-json`.
7. **Validate with the host's OWN check, THEN declare created** — `openclaw config
   validate --json` returns valid → outcome **`created`**.
8. **Tell the user** — the expert exists; opening it loads the domain spec + intent
   spec and it shops on its niche with **no further setup**.

## 10. First query — web-refresh the domain, decompose, lazily capture what's needed

Later the user opens the expert and shops
([`../references/expert_shopping.md`](../references/expert_shopping.md)). On **every
query** the expert refreshes the domain, decomposes the request, and captures only
what a dimension actually needs — **lazily**, not as an up-front form:

> **User:** "Find me a road bike, budget around €1500."

**(1) Web-refresh the domain spec.** The expert hits the web to keep the domain
current — this season's 105 groupset revision, current alloy-vs-carbon price
crossover at the €1500 band — and re-materializes the enhanced `domain_spec.md`.

**(2) Decompose along the intent dimensions (ephemeral).** "So: **use-case** fitness
(your words earlier), **budget** ~€1500, **performance priority** comfort. Missing
for a good fit: your **fit envelope**." The filled decomposition is the per-query
intent — it is never persisted.

**(3) Lazily capture the one missing thing.** A defensible pick needs the fit
envelope, so the expert asks for it **now, in context** (not a wizard form):

> **Expert:** "Before I search — for fit I need two numbers I'll keep so I never
> re-ask: your **height** and **inseam**. And one taste check: any brand you love or
> won't touch?"
> **User:** "178 cm, 81 cm inseam. No strong brand feelings, but secondhand is fine
> if it saves money."

→ The fit facts fold into **`user_spec.md`** (re-materialize: height 178 cm, inseam
81 cm — soft facts) and the taste folds into **`playbook.md`** (re-materialize:
budget ~€1500, secondhand acceptable, brand-agnostic). Both are now stored and
**never re-asked**.

**(4–6) Map → search → compare.** Mapping the decomposition + the stored facts/taste:

```
query:      "endurance road bike 105 groupset 54cm"   # fit envelope → size band
category:   "road-bikes"
price_max:  150000        # €1500 → minor units (cents)
condition:  ["secondhand"]   # taste: secondhand is fine
# ship_to: OMITTED — server resolves the registered default; no sil_whoami round-trip
```

The recommendation **rubric emerges here**: rank on the domain-spec mechanics (fit +
comfort first for a first bike), weighted by the taste (value-conscious, ~€1500) and
the intent (fitness use). No hard constraints to reject on this query.

## 11. A layered recommendation — the "why" cites the layers

> **Expert (intent):** "This request: a **fitness road bike**, ~€1500, comfort-first."
> **Expert (pick + why):** "Top pick: the [alloy endurance road bike, 54 cm, 105
> groupset] at €1420 secondhand.
> **Why:** for your **178 cm / 81 cm inseam** (your stored fit envelope — I didn't
> re-ask) a **54 cm endurance frame** puts the stack/reach where a first buyer wants
> it — a domain mechanic: **fit and comfort outrank outright speed on a first bike**,
> so I passed over a stiffer race-geo bike that was lighter on paper. It runs a
> compact 50/34 — the gearing range that suits mixed terrain — and lands under your
> €1500 with room, matching your value-conscious taste."

That "why" cites the **per-query intent** (a ~€1500 fitness bike), a **stored
user-spec fact it did not re-ask** (the 178/81 fit envelope), and a **researched
domain-spec mechanic** (fit/comfort over speed; the compact-gearing-for-terrain
reasoning) — visible layered reasoning, not generic attribute matching. A pick
rationale that named none of those would **fail the SDS bar** even if the bike were
fine.

## 12. A second query — facts reused, taste honoured, hard constraint respected

> **User (weeks later):** "Now find me a winter bike for the same budget."

The expert **reuses** the stored fit envelope (178/81 — never re-asked) and taste
(~€1500, secondhand ok), web-refreshes the domain, decomposes the new intent
(use-case: winter/all-weather → mudguard clearance, durability), and recommends —
citing the kept fit fact + a domain mechanic (tyre clearance for winter tyres +
guards). If the user now says "actually bump my budget to €2000," that **updates**
the stored taste (a soft preference → re-materialize, visibly). But if they ever say
"find me a carbon-handlebar bike," the persona's standing **hard rule** holds — intent
never overrides a hard constraint.

## Edge cases this example would have handled

- **Collision** (a `road-cycling-buyer` already exists): the engine returns
  `collision`, writes nothing, and the conversation offers **refine-or-rename** —
  never clobbers.
- **Abandon before step 8** of the interview (user walks away pre-endorsement):
  nothing was created, nothing to tear down — the draft lived only in the conversation.
- **No web tool available**: the expert says so honestly and proceeds on the
  existing domain spec — it never pretends the refresh happened.
- **Creation is local + offline** (for the user's identity): no sil registration was
  needed to create the expert; the user registers later, on first shop, via
  `sil_register`.
