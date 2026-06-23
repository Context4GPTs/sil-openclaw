# Brainstorm a tailored shopping expert — the interview

When the user asks for a **shopping expert** — "make me a shopping expert for buying gifts", "set up a road-cycling gear agent", "I want an expert that shops for me" — do **not** jump to the engine. First run an **open, back-and-forth interview** that shapes the expert *with* the user. The agent-creation engine ([`agent_creation_engine.md`](agent_creation_engine.md)) only runs **after** the user explicitly endorses the assembled draft. This reference is the procedure; the engine is the machinery it feeds.

This is a **conversation, not a form-fill** — and **setup is LIGHT: at most 10 questions.** Don't over-burden the user. The job is to converge a tailored spec collaboratively, then **create nothing** until the user endorses the assembled draft.

This expert runs **entirely on Spec-Driven Shopping (SDS)**: rather than folding latent knowledge into prose, the agent **actively researches the niche itself** (web + its own knowledge) so it can later optimize across the dimensions a layperson can't even name (for a bike: gearing theory, frame geometry, the complete fitting process — not "size 56, black"). **The depth comes from the agent's OWN research, not from interrogating the user.** Setup stays light precisely because the agent does the deep work; the user only narrows the niche, shapes the persona, and confirms.

## The five SDS artefacts — and which the interview fills

A created expert runs on five artefacts. The interview fills only what creation needs; the user side fills **lazily, later** (on first shop), not here.

| Artefact | Where | What it holds | Filled |
|---|---|---|---|
| **`SOUL.md`** (persona) | host workspace (via host CLI) | the expert's identity / voice / standing rules | **at creation** (this interview → §Persona) |
| **`domain_spec.md`** | sil data dir (**required**) | deep researched niche expertise — how to buy well, the full mechanics; web-refreshed every query | **at creation** (this interview → the domain-research pass) |
| **`intent_spec.md`** | sil data dir (**required**) | the agent-specific **decomposition dimensions** (PRD-style) a query must resolve, derived from the domain | **at creation** (this interview → derived from the domain spec) |
| **`user_spec.md`** | sil data dir (lazy) | the user's domain-relevant facts + hard constraints | **lazily, per-query** at shop time — **NOT here** |
| **`playbook.md`** | sil data dir (lazy) | the user's **buying taste** (price sensitivity, brand, preferences) | **lazily, per-query** at shop time — **NOT here** |

The interview converges three things: the **persona** (→ `SOUL.md`), the **researched `domainSpec`** (→ `domain_spec.md`), and the **derived `intentSpec`** dimension schema (→ `intent_spec.md`) — plus the `agentId` + `name` derived from the domain. The **user spec** and the **buying taste** are captured **lazily on first shop** ([`expert_shopping.md`](expert_shopping.md)), not in this interview. The per-query intent (the dimensions filled in for one request) is **ephemeral** — never persisted, never authored here.

## Principles for the interview

- **Act like a curious expert, not a wizard.** Ask open questions, reflect back what was heard, and let the user steer. Never fire a fixed battery of questions.
- **Setup is LIGHT — at most 10 questions.** The deep domain spec comes from the **agent's own research**, not from interrogating the user. Keep the user's burden minimal: narrow the niche, shape the persona, confirm the researched dimensions. Don't turn the interview into a deep-domain interrogation — research it yourself.
- **Narrow a vague domain first.** If the domain is broad or ambiguous, narrow it to a concrete, searchable niche *with* the user before researching anything else (see step 2) — the domain research depends on a narrowed niche.
- **Research, don't interrogate.** The objective decision-mechanics of the domain are *yours to research* (web + knowledge); the user supplies the niche, the persona, and a yes/adjust on what you found — not the domain expertise itself.
- **Converge, don't accumulate.** Reflect a short summary back and get a "yes / adjust" before advancing. The flow is **re-entrant** — the user can revise an earlier section at any point.
- **Endorsement is a gate, not a formality.** Until the user explicitly says "create it", run **zero** engine steps (see Business rules below). The draft lives only in the conversation.

## The sections the interview converges → the creation-time artefacts

| # | Section | What it converges | Lands in |
|---|---|---|---|
| 1 | **Domain framing** | What this expert shops for, narrowed to a concrete, searchable niche. | `agentId` + `name` |
| 2 | **Domain-spec research** | Deep researched niche expertise — how to buy well and the full mechanics (the agent researches it; the user confirms). | **`domainSpec`** (→ `domain_spec.md`) |
| 3 | **Intent-spec derivation** | The decomposition **dimensions** a good query must resolve, **derived from the domain spec** (a PRD-style schema). | **`intentSpec`** (→ `intent_spec.md`) |
| 4 | **Persona** | Who the expert *is*: its expertise, voice/tone, standing rules — reflecting this user. | persona (→ host **`SOUL.md`**) |

The persona is written into the host workspace **`SOUL.md`** by the engine (it is the agent's system framing — **not** a sil artefact, no `persona.md`). The **buying taste** (price sensitivity, brand, preferences) is **NOT** converged here — it is the lazy `playbook.md`, captured per-query at shop time. The old "elicitation style + answer→param mapping + rubric" seller's-method playbook is gone: the elicitation voice folds into the persona; what to search on lives in the domain spec + the generic [`search_param_mapping.md`](search_param_mapping.md); the recommendation rubric **emerges at recommend time** from the domain spec's dimensions weighted by the user's taste + facts + the per-query intent (it is not a stored seller artefact).

## Run the interview in this order

1. **Open with the domain, not a form.** Reflect the request back ("a shopping expert for road-cycling gear — let's shape it together") and ask **one** orienting question. Signal this is a light, revisable conversation, not a questionnaire. Do not ask for an `agentId`, a budget, and a tone all at once.

2. **Narrow a vague domain together FIRST — before any other section.** If the domain is broad or ambiguous ("an expert for gifts", "electronics"), do **not** proceed to the domain research, intent dimensions, or persona. Ask 1–2 narrowing questions (who is it for / what occasion / which slice of the category) and **reflect a concrete niche back for confirmation**. A too-broad niche makes the domain research and the intent dimensions useless, so this narrow-first gate protects everything downstream. Only once the niche is concrete and confirmed do you move on.

3. **Research the niche DEEPLY → the domain spec (the SDS research pass).** With the niche concrete and confirmed, **actively research it yourself (web + knowledge)** — pull *everything* about how to buy well in the niche, understanding the category, its **decision-attributes**, and its mechanics deeply. For a bicycle that is the full domain: gearing/groupsets and gearing theory, frame types and geometry, **the complete process of fitting a bike to a person** (the mechanics, not a bullet list), wheel/tyre selection, the trade-offs that drive a good buy. Converge a **deep domain spec**: how a person *should* buy in this niche, closing the gap where the consumer was uninformed (the value: higher satisfaction, fewer returns). This is **researched substance — not restated persona prose and not generic filler**; a shallow 5-bullet "decision-dimensions" list, or anything a layperson could have written, **fails the SDS bar** (business rule 10). Reflect the shape back to the user briefly ("for a road bike, fit comes from stack/reach, saddle setback, crank length — and gearing from your terrain; here's how I'll think about your buy") and confirm. This lands in `domainSpec` (→ `domain_spec.md`). **Do not interrogate the user for the domain's decision-attributes — you research them.** The personal side — the user's own tastes, budget, style, and hard constraints — is **not** elicited here either; it fills lazily, per-query, at shop time ([`expert_shopping.md`](expert_shopping.md)). The interview elicits BOTH the niche's decision-attributes (by research) and reflects them against the user (persona + confirmation), but the deep work is yours.

4. **Derive the intent-spec dimensions FROM the domain spec.** From what you learned writing the domain spec, derive the **decomposition dimensions** a good shopping query in this niche must resolve — a **PRD-style template** for a purchase. For cycling: use-case (commute/race/endurance), terrain, budget, timeline, compatibility-with-existing-setup, performance priorities, aesthetics. These are **agent-specific** — they come from *this* niche's domain spec, not a generic checklist. This is the **schema** (the dimensions to resolve), **not** a filled-in instance for any one request. Reflect them back briefly and confirm. This lands in `intentSpec` (→ `intent_spec.md`).

5. **Converge the persona (interview section 4).** Elicit the expert's expertise and voice, AND how the user wants it to behave (terse vs. chatty, cautious vs. opinionated, any standing rules — including how it talks when shopping). Reflect a short persona summary back; get a yes/adjust before advancing. This becomes the host workspace **`SOUL.md`**.

6. **Derive the identity, confirm it.** From the converged domain, propose an `agentId` (lower-kebab, matching `^[a-z0-9][a-z0-9-]*$`, never `main`) and a human-readable `name` ("Road-Cycling Buyer" / `road-cycling-buyer`). **Confirm both with the user** — never silently invent them.

7. **Assemble the draft and present it back.** Compose the spec — `{ agentId, name, persona, domainSpec, intentSpec }` — and present it as a **readable summary**: who the expert is, **the deep domain spec (the niche expertise and mechanics it researched)**, and **the intent dimensions it will decompose every request along**. Present the domain spec's depth and the intent dimensions in the readable summary, so the user sees the researched substance before endorsing. Self-check the shape against the engine's `sil_profile_materialize` input contract: `agentId` lower-kebab and ≠ `main`, non-blank `name`, non-blank `persona`, a non-blank `domainSpec` (deep, researched), and a non-blank `intentSpec` (the derived dimensions). The user spec and the buying taste are **absent** at creation (lazy). This is a sanity pass; the engine's validate-first step is the authoritative gate — do not re-implement it here. This self-check is shape-only — it writes nothing, so `sil_profile_materialize` is NOT called here.

8. **Get explicit endorsement — the gate.** Ask for an explicit go-ahead ("shall I create it?"). Endorsement is an **affirmative user act** on the assembled draft — "yes, create it" / "go ahead" / "looks good, make it". It is **NOT** inferred from the user answering the last question, and **NOT** from silence. **Only on that explicit endorsement** do you proceed to the engine ([`agent_creation_engine.md`](agent_creation_engine.md)) and run its steps.

## Edge cases the interview handles gracefully

- **Collision (an expert with that id already exists).** The engine refuses a name collision — it returns the `collision` outcome from its `openclaw agents list` check and never clobbers an existing agent. When the proposed `agentId` collides, surface it in the conversation and offer the user a **choice — rename this expert under a new id, or refine the existing expert's niche** — rather than dead-ending. Never silently mutate the id, and never overwrite an existing expert. (Refining the *existing* expert's artefacts in place is out of scope here; offer rename as the concrete action.)
- **Abandon mid-flow.** The interview is multi-turn; the user may stop, change their mind, or walk away before endorsing. Because **no engine step runs before endorsement**, abandonment leaves **nothing created** — no host agent, no artefacts, no wiring. There is no partial expert to clean up and **no teardown needed**. Never "save progress" by writing artefacts early.
- **Creation is local + offline (for the user's identity) — no identity coupling.** Creating an expert neither requires nor performs sil registration. Do **NOT** present sil registration or a token as a prerequisite to *create* the expert. The expert registers the user later, on first shop, via `sil_register`. (The domain research at creation reaches the **web** for niche knowledge — that is the agent's own research, not the user's identity.)

## Business rules (invariants the interview holds on every path)

1. **No creation without explicit endorsement.** Nothing is written — not the host agent, not the `SOUL.md`, not the SDS artefacts, not the wiring — until the user explicitly endorses the assembled draft. The strongest invariant: **nothing is created until** the user says yes, and the draft lives only in the conversation until then.
2. **Abandon-mid-flow creates nothing.** Because no engine step runs pre-endorsement, an abandoned interview leaves no partial expert — automatic, not a teardown. Never write artefacts early to "save progress".
3. **Setup is LIGHT — at most 10 questions.** Don't over-burden the user. The deep domain expertise is the **agent's own research (web + knowledge)**, never interrogated from the user. Setup converges only: narrowed niche, persona, researched domain spec, derived intent-spec dimensions. The user spec / buying taste fill lazily later.
4. **The domain spec is DEEP and researched, never generic or restated persona prose.** It must carry niche-concrete mechanics a layperson couldn't enumerate — the full how-to-buy-well of the niche (for a bike: the complete fit process, gearing theory, geometry). A shallow bullet list or relabelled persona prose **fails SDS**: the whole point is the depth the agent researched that a coarse request never names. Research the niche; do not relabel latent knowledge.
5. **The intent spec is derived FROM the domain spec, and is a schema not an instance.** The decomposition dimensions come from *this* niche's domain spec (agent-specific), and they are the **template** of dimensions to resolve — never the filled-in values for one request (those are the ephemeral per-query intent).
6. **Converge each section before advancing; stay re-entrant.** Reflect-and-confirm per section; let the user revise any earlier section. Collaborative, not a locked wizard.
7. **Narrow a vague domain first.** Never research the domain or derive intent dimensions on an un-narrowed niche — narrow with the user before proceeding.
8. **Refine-or-rename on collision; never clobber.** On an existing-name collision, offer refine-or-rename; never overwrite an existing expert (defers to the engine's `collision` refusal).
9. **Creation is local + offline for the user's identity.** The interview never presents sil registration / a token as a prerequisite to create the expert. (Domain research may reach the web for niche knowledge — that is the agent's research, not the user's account.)
10. **The persona is the host `SOUL.md`, not a sil artefact.** The persona/voice is written into the workspace `SOUL.md` by the engine. There is no `persona.md` in the sil store and no buying-taste / mapping / rubric "playbook" authored at creation — the taste is the lazy `playbook.md`, and the rubric emerges at recommend time.

## After endorsement

Once the user has **explicitly endorsed** the assembled draft, proceed to [`agent_creation_engine.md`](agent_creation_engine.md) and run the engine steps in order. Until that explicit endorsement, **zero engine steps** have run.
