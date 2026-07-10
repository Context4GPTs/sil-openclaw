---
name: multi-domain-shopper-walkthrough
description: Worked end-to-end example — create one shopper, then shop two unrelated niches in one session with a shared fact reused across both and per-domain taste kept isolated.
---

# Worked example — one shopper, two unrelated niches, one session

The headline: create **one shopper**
([`../references/brainstorm_interview.md`](../references/brainstorm_interview.md) →
[`../references/agent_creation_engine.md`](../references/agent_creation_engine.md)), then
shop **two unrelated niches in the same session** — the second **minted on the fly** —
with a **shared fact reused across both** and **per-domain taste that does not leak**. It
shows the shape and the gates, not exact wording; the machinery lives in the references.

## Onboarding — two touchpoints, no niche research

> **User:** "Set up something that shops for me."

A **generalist** — onboarding touches only the persona and the shared user spec, no niche.

> **Shopper:** "How do you want it to behave?"
> **User:** "Concise and a bit opinionated — never recommend anything with leather, it's
> an ethics thing."
> **Shopper:** "Anything I should always know — sizes, where to ship, hard rules?"
> **User:** "Ship to 12 Rue Centrale, Lyon, France. The no-leather rule is absolute."

→ persona (→ host `SOUL.md`): *concise, lightly opinionated generalist.* Shared
`userSpec`: *ship-to Lyon (soft fact); **HARD-NO: leather** (inviolable, carries across
every niche).*

## Assemble + endorse

```jsonc
{
  "agentId": "my-shopper", "name": "My Shopper",
  "persona": "A concise, lightly opinionated generalist shopper.",
  "userSpec": "### Soft facts\n- Ship-to: 12 Rue Centrale, Lyon, France.\n### Hard constraints (INVIOLABLE — every niche)\n- HARD-NO: leather (ethics)."
}
```

> **Shopper:** "Here's your shopper — shall I create it?"  **User:** "Yes, create it."

**This affirmative act is the gate** — up to here, zero engine steps ran. Only now does
the engine run — `openclaw agents add my-shopper …` → persona into `SOUL.md` →
`sil_profile_materialize { name, userSpec }` (no `domain`; writes the shared
`user_spec.md` + an empty `domains: {}`) → wire + admit sil → validate → **`created`**,
with an **empty `domains` map** (healthy; each niche mints on first shop).

## Niche A — road cycling (minted on the fly, announced)

> **User:** "Find me a first road bike, around €1500."

The shop loop classifies the niche (**road cycling**), finds no match, and **mints it on
the spot — announced** ("I haven't shopped cycling for you yet — setting that up"). It
researches a deep `domainSpec` (fit is everything; geometry; gearing; material/wheel
trade-offs), derives the `intentSpec`, seeds a partial `playbook`, and persists with the
whole-doc `sil_profile_materialize` carrying `domain.slug: "road-cycling"`. It recommends
with a **"why" that cites the layers** — "for a first bike **fit/comfort outrank outright
speed** (a domain mechanic), a 54 cm endurance frame fits, kept within your value budget;
**no leather anywhere** (your standing hard rule)."

A taste surfaces, captured the cheap way — one append, scoped to this domain:

> **User:** "I don't chase brands — value over name."

```
sil_remember { kind: "taste", text: "Value over brand; ~€1500 band.", domain: "road-cycling" }
```

→ lands in `domains/road-cycling/playbook.md` only.

## Niche B — espresso (a second niche, same session, no switch)

> **User:** "Different thing — a home espresso machine, decent but not crazy."

Same session, **no agent switch, no re-onboarding**. The loop classifies **espresso**,
finds no match, and **mints espresso on the fly — announced**, with its own deep
`domainSpec` (boiler type, PID, pressure profiling, grinder pairing) via a second
whole-doc `sil_profile_materialize` (`domain.slug: "espresso"`).

**The shared fact carries — without being re-asked:** the ship-to from the shared
`user_spec.md` is reused in espresso with **no re-ask** ("I'll ship to your Lyon address
as usual"), and the no-leather hard rule still rejects a leather-wrapped tamper handle.

**The niche taste does not leak:** the *value-over-brand* taste lives in
`domains/road-cycling/playbook.md` and does not shape the espresso picks — espresso learns
its own:

> **User:** "For coffee I'll happily pay for a known reliable brand."

```
sil_remember { kind: "taste", text: "Pays up for a reliable known brand.", domain: "espresso" }
```

→ `domains/espresso/playbook.md` only. The two tastes coexist without contradiction —
per-domain taste isolation. A **fact** would instead go to the shared `user_spec.md`
(`kind: "fact"`) and carry to *both* niches.

## The singleton edge — refuse a second shopper

> **User:** "Can you make me a second shopper just for coffee?"
> **Shopper:** "You already have a shopper — it handles every niche. I've added espresso
> as a domain; I won't create a second. Want me to refine the espresso domain instead?"

The engine's **singleton refusal** (`collision`, "a shopper already exists") — one
shopper, many domains.

## Edge cases this example would have handled

- **Reuse before mint** — "another road bike, for winter" reuses the existing
  `road-cycling` domain (semantic dedup), never a near-duplicate pack.
- **Forget one domain ≠ decommission the shopper** — "forget espresso" runs
  `sil_profile_remove { domainSlug: "espresso" }`; the shopper, shared user spec, and
  road-cycling domain survive.
- **No web tool** — the shopper says so honestly at mint time and composes from public
  knowledge, never pretending the research happened.
- **Creation is local + offline** — no sil registration to create; the user registers
  later, on first shop.
