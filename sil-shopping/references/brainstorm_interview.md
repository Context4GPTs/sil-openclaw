---
name: brainstorm-interview
description: The two-touchpoint shopper onboarding — persona + shared user-spec seed, converged with the user and endorsement-gated. Load when the user asks to set up or create their shopper.
---

# Set up your shopper — the onboarding interview

When the user asks to **set up shopping** — "create my shopper", "set up an agent
that shops for me" — do **not** jump to the engine. Run a short, **two-touchpoint**
onboarding that shapes the shopper *with* the user — **pre-seeded from what they
already said this session** — then create nothing until the user endorses the
assembled draft. The engine ([`agent_creation_engine.md`](agent_creation_engine.md))
runs only **after** that explicit endorsement.

This is a **conversation, not a form-fill** — and a short one. The shopper is a
**generalist**: it goes deep on whatever the user later buys, **lazily minting a
domain on first shop** in each niche. So onboarding does **not** research any niche
and does **not** ask the user to pick one. It touches exactly **two** things: the
**persona** (how the shopper behaves) and a **shared user-spec seed** (cross-niche
facts + hard constraints).

## Open with a reflected draft, not a cold question

Before asking anything, **pre-seed** a draft from what the user already said *this
session*: the **persona** (their words on how the shopper should behave) and the
**shared user-spec seed** (any sizes, hard limits, or ethics rules mentioned in
passing). Then **open by reflecting that draft back** — *"from what you've told me,
here's the shopper I'd set up…"* — and ask only to confirm-or-adjust. That is the
rich (a filled draft) + light (one confirm) shape.

- **Pre-fill, don't interrogate.** Ask only to fill genuine gaps, never to re-collect
  what the user already told you. If the session gave little, seed a **minimal
  honest** draft ("cross-niche facts to be learned as we shop; no hard constraints
  stated yet") and say so — never fabricate a size or a limit.
- **Session-only — local + offline.** The seed is assembled **only** from this
  conversation. It reads **no token**, does **not** pull `sil_whoami`, and makes **no
  network call**. (The shopper registers the user later, on first shop.)
- **The pre-fill is a proposal, never consent.** The endorsement gate below is
  untouched.

## The two touchpoints

| Artefact | Where | What it holds |
|---|---|---|
| **`SOUL.md`** (persona) | host workspace | the shopper's voice / standing rules — a **generalist**, not a niche specialist |
| **`user_spec.md`** (shared) | sil data dir (**required**) | the user's **cross-niche** facts + hard constraints (addresses, sizes, allergy/ethics rules, budget psychology) |

The niche packs — the deep niche know-how, the per-request template, and the niche
shopping taste — are **not authored here**; they are **minted lazily on first shop**
in each niche ([`shop_loop.md`](shop_loop.md)). Never research a niche here.

**1. Persona — reflect back, confirm.** Open by reflecting the session-seeded persona
draft ("from what you've told me, your shopper sounds like…"), then confirm-or-adjust
its **voice/tone** and any **standing rules**. This surfaces voice, **not a niche** —
a generalist that shops whatever the user buys. It becomes the host workspace
**`SOUL.md`** (no `persona.md`).

**2. Shared user spec — seed the cross-niche facts + hard constraints.** Pre-fill the
**shared user spec** from the session: **cross-niche** facts and any **hard
constraints** that should hold in *every* niche — addresses / sizes, an allergy or
ethics rule ("never leather"), a budget psychology. Reflect the seed back and mark
each **hard** (inviolable) vs **soft** (bendable). Seed what the user offered; the
rest is augmented per-query at shop time. This lands in `userSpec` (→ the shared
`user_spec.md`). **No niche taste, no domain question, no intent dimensions** are
gathered here.

## Assemble + endorse

- **Identity.** Propose an `agentId` (lower-kebab, `^[a-z0-9][a-z0-9-]*$`, never
  `main`) and a `name` ("My Shopper" / `my-shopper`). Confirm both.
- **Assemble + present.** Compose **`{ agentId, name, persona, userSpec }`** and
  present a readable summary: who the shopper is and the seeded shared user spec
  (partial, to grow per-query). Self-check the shape — `agentId` lower-kebab & ≠
  `main`, non-blank `name`/`persona`, non-blank shared `userSpec` (the only sil
  artefact at create). This writes nothing; the engine's validate-first step is the
  authoritative gate.
- **Endorse — the gate.** Ask for an explicit go-ahead ("shall I create your
  shopper?"). Endorsement is an affirmative act on the assembled draft — "yes, create
  it". It is **not** inferred from the last answer and **not** from silence. **Only on
  that explicit endorsement** do you proceed to the engine
  ([`agent_creation_engine.md`](agent_creation_engine.md)).

## Invariants (hold on every path)

- **No creation without explicit endorsement.** **Zero engine steps** run before the
  explicit "yes"; the draft lives only in the conversation. **Nothing is created**
  until then, so an abandoned interview leaves no partial shopper.
- **Two touchpoints only** — persona, then shared user spec, both pre-seeded from the
  session. No niche is researched or chosen here; that is first-shop lazy mint.
- **Converge each touchpoint before advancing; stay re-entrant** — the user can revise
  an earlier touchpoint at any point.
- **Singleton.** If a shopper already exists, the engine refuses a second create (its
  `collision`, "a shopper already exists") — surface it and steer to shop-a-new-niche
  or refine; never clobber the existing one.
- **Local + offline for identity.** Never present sil registration or a token as a
  prerequisite to create, and never pull `sil_whoami` to seed — the seed is
  session-only.
