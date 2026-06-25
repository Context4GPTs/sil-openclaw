# Brainstorm a tailored shopping expert — the interview

When the user asks for a **shopping expert** — "make me a shopping expert for buying gifts", "set up a road-cycling gear agent", "I want an expert that shops for me" — do **not** jump to the engine. Run an **open, back-and-forth interview** that shapes the expert *with* the user, then **create nothing** until the user endorses the assembled draft. The agent-creation engine ([`agent_creation_engine.md`](agent_creation_engine.md)) only runs **after** that explicit endorsement.

This is a **conversation, not a form-fill.** The rule is **at least one touchpoint per document** — you walk the five artefacts in order, one touchpoint each, and the deep work (the domain research) is **yours**, not the user's. The depth comes from the agent's own research, not from interrogating the user.

## The five SDS artefacts — all four sil docs SEEDED at creation

A created expert runs on five artefacts. **All four sil docs are present (non-blank) from creation**, seeded *partial* by this interview + the agent's research, then **lazily augmented / reinforced on every query** ([`expert_shopping.md`](expert_shopping.md)). No sil doc is created blank or deferred to a later first shop. What grows is their *content* — we keep learning.

| Artefact | Where | What it holds | Seeded |
|---|---|---|---|
| **`SOUL.md`** (persona) | host workspace (via host CLI) | the expert's identity / voice / standing rules | at creation (§1 below); refined on persona refine, stable per query |
| **`domain_spec.md`** | sil data dir (**required**) | deep researched niche expertise — how to buy well, the full mechanics; web-refreshed every query | at creation (§2 — the agent's own research) |
| **`intent_spec.md`** | sil data dir (**required**) | the agent-specific **decomposition dimensions** (PRD-style) a query must resolve | at creation (§5 — derived from the domain) |
| **`user_spec.md`** | sil data dir (**required**) | the user's domain-relevant facts + hard constraints | seeded partial at creation (§3); augmented every query |
| **`playbook.md`** | sil data dir (**required**) | the user's **buying taste** (price sensitivity, brand, preferences) | seeded partial at creation (§4); augmented every query |

The per-query intent (the dimensions filled in for one request) is **ephemeral** — never persisted, never authored here.

## Principles for the interview

- **One touchpoint per document, walked in order.** Touch each of the five artefacts exactly once during setup (the domain is the exception — agent-researched, **zero questions**). Don't fire a fixed battery; don't over-burden the user. The deep domain spec is the **agent's own research**, never interrogated from the user.
- **The persona question comes first, and the niche falls out of it.** Asking "what kind of expert, and how should it behave?" surfaces the niche as a by-product — there is **no separate narrow-the-niche step**.
- **Research, don't interrogate.** The objective decision-mechanics of the domain are *yours* to research (web + knowledge); the user supplies the persona, one basic fact, one taste comparison, and a sign-off — not the domain expertise.
- **Converge, don't accumulate.** Reflect a short summary back and get a yes/adjust before advancing. The flow is **collaborative** and **re-entrant** — not a locked wizard; the user can revise an earlier section at any point.
- **Endorsement is a gate, not a formality.** Until the user explicitly says "create it", run **zero** engine steps. The draft lives only in the conversation.

## Run the interview in this order — one touchpoint per document

### 1. `SOUL.md` — ASK FIRST: persona + behaviour (the niche falls out of this)

Open by reflecting the request back ("a shopping expert — let's shape it together"), then ask the **persona/identity** question: **"What kind of expert do you want, and how should it behave?"** — its expertise, voice/tone (terse vs. chatty, cautious vs. opinionated), and any standing rules. This is **not** niche-narrowing: the **niche falls out of the answer** ("a patient first-bike advisor" → the niche is *first road bikes*). Reflect a short persona summary back and confirm. This becomes the host workspace **`SOUL.md`** (the persona is the agent's system framing — **not** a sil artefact, no `persona.md`). If the niche is still vague after the persona answer, fold one clarifying turn into this section — do not run a dedicated narrow-the-niche step.

### 2. `domain_spec.md` — NO QUESTION: the agent researches the web itself

With the niche surfaced from §1, **actively research it yourself (web + knowledge)** — pull *everything* about how to buy well in the niche, its **decision-attributes**, and its mechanics, deeply. For a bike that is the full domain: gearing/groupsets and gearing theory, frame types and geometry, **the complete process of fitting a bike to a person**, wheel/tyre selection, the trade-offs that drive a good buy. Converge a **deep domain spec**: how a person *should* buy in this niche, closing the gap where the consumer was uninformed (higher satisfaction, fewer returns). **The fit is everything** — this is researched substance, not restated persona prose and not generic filler; a shallow bullet list, or anything a layperson could have written, **fails the SDS bar** (business rule 4). Reflect the shape back briefly ("for a road bike, fit comes from stack/reach, saddle setback, crank length — here's how I'll think about your buy") and confirm. **Ask the user no domain question — you research it.** This lands in `domainSpec` (→ `domain_spec.md`). **If you lack web access, tell the user** you need web search, then compose `domain_spec.md` from well-established, public buying knowledge — never present a guess as verified research, and never silently proceed.

### 3. `user_spec.md` — ONE basic question

Ask the **single most-basic niche fact** the domain mechanics turn on — for shoes, *foot length + width*; for a bike, *height + leg length*. Plus any **hard constraint** the user volunteers ("never leather", an allergy, a budget hard-no). Seed a *partial* **`userSpec`**: the basic fact(s) + any stated hard constraints, marked **hard** (inviolable) vs **soft** (a bendable preference). Don't run a questionnaire — one basic question; the rest is **augmented per-query** at shop time. If the user gives little, seed a minimal honest body (e.g. "facts to be learned as we shop; no hard constraints stated yet") — non-blank, but partial. This lands in `userSpec` (→ `user_spec.md`).

### 4. `playbook.md` — ONE question: compare a set of options (buying taste)

Surface the user's **buying taste** with **one** question: ask them to **compare a set of options** ("of these three — a value alloy build, a mid-range carbon, a premium race bike — which appeals, and why?"). Their choice and reasoning reveal price sensitivity, brand leanings, and how they weigh value vs. performance — taste a direct "what's your budget?" wouldn't. Seed a *partial* **`playbook`** from the answer (budget feel, brand leanings, value-vs-performance lean), augmented per-query. This lands in `playbook` (→ `playbook.md`). The old seller's-method playbook (elicitation style + answer→param mapping + rubric) is gone: the voice folds into the persona, what to search on lives in the domain spec + the generic [`search_param_mapping.md`](search_param_mapping.md), and the rubric **emerges at recommend time** from the domain dimensions weighted by taste + facts + the per-query intent.

### 5. `intent_spec.md` — SIGN-OFF: present the decomposition dimensions

From what you learned writing the domain spec, derive the **decomposition dimensions** every query in this niche must resolve — a PRD-style schema (for cycling: use-case, terrain, budget band, fit envelope, timeline, compatibility, performance priorities, aesthetics). These are **agent-specific** — from *this* niche's domain spec, not a generic checklist. Present them and ask the user to **sign off** ("every request, I'll decompose along these — sound right?"). This is the **schema** (the dimensions to resolve), never a filled-in instance (that is the ephemeral per-query intent). This lands in `intentSpec` (→ `intent_spec.md`).

### 6. Derive the identity, assemble, endorse

- **Identity.** Propose an `agentId` (lower-kebab, `^[a-z0-9][a-z0-9-]*$`, never `main`) and a human-readable `name` ("Road-Cycling Buyer" / `road-cycling-buyer`) from the converged niche. **Confirm both** — never silently invent them.
- **Assemble + present.** Compose `{ agentId, name, persona, domainSpec, intentSpec, userSpec, playbook }` and present a **readable summary**: who the expert is, the **deep domain spec**, the **intent dimensions**, and the **seeded user spec + buying taste** (partial, to grow per-query). Self-check the shape against the engine's `sil_profile_materialize` contract: `agentId` lower-kebab & ≠ `main`, non-blank `name`/`persona`, and a non-blank `domainSpec`/`intentSpec`/`userSpec`/`playbook` (all four present, seeded partial, never absent). This is shape-only — it writes nothing; the engine's validate-first step is the authoritative gate.
- **Endorse — the gate.** Ask for an explicit go-ahead ("shall I create it?"). Endorsement is an **affirmative user act** on the assembled draft — "yes, create it" / "go ahead". It is **NOT** inferred from the user answering the last question, and **NOT** from silence. **Only on that explicit endorsement** do you proceed to the engine ([`agent_creation_engine.md`](agent_creation_engine.md)).

## Edge cases the interview handles gracefully

- **Collision (an expert with that id already exists).** The engine refuses a name collision (its `collision` outcome from `openclaw agents list`) and never clobbers an existing agent. Surface it and offer a **choice — rename under a new id, or refine the existing expert** — never silently mutate the id or overwrite.
- **Abandon mid-flow.** Because **no engine step runs before endorsement**, abandonment leaves **nothing created** — no host agent, no artefacts, no wiring, no teardown. Never "save progress" by writing artefacts early.
- **Creation is local + offline (for the user's identity).** Creating an expert neither requires nor performs sil registration. Do **NOT** present sil registration or a token as a prerequisite to create the expert; the expert registers the user later, on first shop, via `sil_register`. (The §2 domain research reaches the **web** for niche knowledge — the agent's own research, not the user's identity.)

## Business rules (invariants the interview holds on every path)

1. **No creation without explicit endorsement.** Nothing is written — not the host agent, the `SOUL.md`, the SDS artefacts, or the wiring — until the user explicitly endorses. The draft lives only in the conversation until then.
2. **Abandon-mid-flow creates nothing.** No engine step runs pre-endorsement, so an abandoned interview leaves no partial expert — automatic, not a teardown.
3. **One touchpoint per document, walked in order.** `SOUL.md` (ask first — persona, the niche falls out), `domain_spec.md` (no question — agent researches the web), `user_spec.md` (one basic fact), `playbook.md` (one compare-options question), `intent_spec.md` (sign-off). The deep domain expertise is the agent's **own research**, never interrogated. All four sil docs are **present (partial) from creation** — seeded fast, then augmented per-query; the user side is never "filled from empty later".
4. **The domain spec is DEEP and researched, never generic or restated persona prose.** It carries niche-concrete mechanics a layperson couldn't enumerate — the full how-to-buy-well (for a bike: the complete fit process, gearing theory, geometry — **the fit is everything**). A shallow bullet list or relabelled persona prose **fails SDS**. Research the niche; do not relabel latent knowledge. If you lack web access, say so, then compose it from well-established, public buying knowledge — never present a guess as verified research.
5. **The intent spec is derived FROM the domain spec, and is a schema not an instance.** The dimensions come from *this* niche's domain spec (agent-specific) and are the **template** to resolve — never the filled-in values for one request (the ephemeral per-query intent).
6. **Converge each section before advancing; stay re-entrant.** Reflect-and-confirm per section; let the user revise any earlier section.
7. **Refine-or-rename on collision; never clobber.** Defer to the engine's `collision` refusal; offer refine-or-rename.
8. **Creation is local + offline for the user's identity.** Never present sil registration / a token as a prerequisite to create. (Domain research may reach the web — the agent's research, not the user's account.)
9. **The persona is the host `SOUL.md`, not a sil artefact.** No `persona.md` in the sil store. The buying taste IS seeded — a *partial* `playbook.md` — but the old seller's-method playbook is gone (the rubric emerges at recommend time).

## After endorsement

Once the user has **explicitly endorsed** the assembled draft, proceed to [`agent_creation_engine.md`](agent_creation_engine.md) and run the engine steps in order. Until that explicit endorsement, **zero engine steps** have run.
