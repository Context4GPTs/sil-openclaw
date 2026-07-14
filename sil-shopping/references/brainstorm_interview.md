---
name: brainstorm-interview
description: The two-touchpoint shopper onboarding — persona + shared user-spec seed, converged with the user and endorsement-gated. Load when the user asks to set up or create their shopper.
---

# Set up your shopper — the onboarding interview

When the user asks to **set up shopping** ("create my shopper"), do **not** jump to the
engine. Run a short, **two-touchpoint** onboarding that shapes the shopper *with* them —
**pre-seeded from what they already said this session** — and create nothing until they
endorse the draft. The engine ([`agent_creation_engine.md`](agent_creation_engine.md)) runs
only **after** that explicit endorsement.

This is a **conversation, not a form-fill**. The shopper is a **generalist**: it goes deep on
whatever the user later buys, **lazily minting a domain on first shop**. Onboarding researches
**no niche** and picks **none** — it touches exactly two things: the **persona** and a
**shared user-spec seed**.

## Open with a reflected draft

Before asking anything, **pre-seed** from what the user said *this session* — the persona (how
it should behave) and the user-spec seed (sizes, hard limits, ethics rules mentioned in
passing) — then **reflect it back** ("from what you've told me, here's the shopper I'd set
up…") and ask only to confirm-or-adjust.

- **Pre-fill, don't interrogate** — fill only genuine gaps. Little said? Seed a **minimal
  honest** draft ("facts to be learned as we shop; no hard constraints yet") and say so —
  never fabricate a size or limit.
- **Session-only, local + offline** — no token, no `sil_whoami`, no network.
- **The pre-fill is a proposal, never consent** — the endorsement gate stands.

## The two touchpoints

| Artefact | Where | Holds |
|---|---|---|
| **`SOUL.md`** (persona) | host workspace | the shopper's voice / standing rules — a **generalist** |
| **`user_spec.md`** (shared) | sil data dir (**required**) | **cross-niche** facts + hard constraints (addresses, sizes, allergy/ethics rules, budget psychology) |

The niche packs — deep know-how, per-request template, niche taste — are **not authored
here**; they mint **lazily on first shop** ([`shop_loop.md`](shop_loop.md)).

1. **Persona** — confirm-or-adjust the seeded **voice/tone** and any **standing rules**. This
   surfaces voice, **not a niche**. Becomes the workspace **`SOUL.md`**.
2. **Shared user spec** — pre-fill the **cross-niche** facts and any **hard constraints**
   holding in *every* niche (addresses/sizes, an allergy or ethics rule, budget psychology).
   Reflect back; mark each **hard** (inviolable) vs **soft** (bendable). Seed what's offered;
   the rest is augmented per-query at shop time. Lands in `userSpec`. **No niche taste, no
   domain question, no intent dimensions here.**

## Assemble + endorse

- **Identity** — propose an `agentId` (lower-kebab, ≠ `main`) and a `name`; confirm both.
- **Assemble** — compose **`{ agentId, name, persona, userSpec }`**, present a readable
  summary, self-check the shape (`agentId` lower-kebab & ≠ `main`; non-blank
  `name`/`persona`/`userSpec`). Writes nothing — the engine's validate-first step is the
  authoritative gate.
- **Endorse — the gate** — ask for an explicit go-ahead. Endorsement is an affirmative act
  ("yes, create it") — **not** inferred from the last answer or from silence. **Only on that
  explicit yes** do you run the engine.

## Invariants

- **No creation without explicit endorsement** — zero engine steps before the "yes"; the draft
  lives only in the conversation, so an abandoned interview leaves no partial shopper.
- **Two touchpoints only** — persona, then shared user spec, both session-seeded. No niche
  researched or chosen; that is first-shop lazy mint.
- **Converge each touchpoint before advancing; stay re-entrant** — the user can revise earlier.
- **Singleton** — if a shopper exists the engine refuses (its `collision`); surface it, steer
  to shop-a-new-niche or refine, never clobber the existing.
- **Local + offline for identity** — never present registration or a token as a prerequisite,
  never pull `sil_whoami` to seed.
</content>
