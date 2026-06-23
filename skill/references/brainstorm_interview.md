# Brainstorm a tailored shopping expert — the interview

When the user asks for a **shopping expert** — "make me a shopping expert for buying gifts", "set up a road-cycling gear agent", "I want an expert that shops for me" — do **not** jump to the engine. First run an **open, back-and-forth interview** that shapes the expert *with* the user, converging a spec tailored to *this* user. The agent-creation engine ([`agent_creation_engine.md`](agent_creation_engine.md)) only runs **after** the user explicitly endorses the assembled draft. This reference is the procedure; the engine is the machinery it feeds.

This is a **conversation, not a form-fill.** The job is to converge a tailored spec *collaboratively*, eliciting BOTH the domain's decision-attributes AND this user's own tastes, style, budget, and constraints — and to **create nothing** until the user endorses the assembled draft.

This expert runs on **Spec-Driven Shopping (SDS)**: it does not just fold latent knowledge into prose — it **actively researches the niche's real decision-dimensions** (a *domain spec*) so it can later optimize across the dimensions a layperson can't even name (for shoes: last shape, width, volume, terrain, gait — not "size 43, black"). The interview converges that researched domain spec alongside the persona and the playbook. (The user spec — this user's standing attributes + hard constraints — is captured later, on first shop, not here; see [`expert_shopping.md`](expert_shopping.md). The intent spec is per-request and ephemeral. This interview owns the *domain spec* and *persona* + *playbook*.)

## Principles for the interview

- **Act like a curious expert, not a wizard.** Ask open questions, reflect back what was heard, and let the user steer. Never fire a fixed battery of questions.
- **Narrow a vague domain first.** If the domain is broad or ambiguous, narrow it to a concrete, searchable niche *with* the user before building anything else (see step 2 below) — every downstream section depends on a narrowed niche.
- **Interleave domain and personal.** In every section, surface the objective decision-attributes of the domain AND ask where *this* user stands on them. A section that gathered only one side is incomplete.
- **Converge, don't accumulate.** Reflect a short summary back and get a "yes / adjust" before advancing. The flow is **re-entrant** — the user can revise an earlier section at any point.
- **Endorsement is a gate, not a formality.** Until the user explicitly says "create it", run **zero** engine steps (see Business rules below). The draft lives only in the conversation.

## The sections the interview converges → the four artefact slots

The engine materializes **four artefact slots** — `persona` (required) and three optional layers: `playbook`, the SDS **`domainSpec`**, and the SDS **`userSpec`** (captured later, on first shop). The interview's job is to fill `persona`, `playbook`, **and the researched `domainSpec`** (plus the `agentId` + `name` derived from the domain); the user spec is captured on first shop, not here.

| # | Section | What it converges | Lands in |
|---|---|---|---|
| 1 | **Domain framing** | What this expert shops for, narrowed to a concrete, searchable niche. | `agentId` + `name` |
| 2 | **Domain-spec research** | The niche's real decision-dimensions and how they trade off — actively researched, niche-concrete, not generic. | **`domainSpec`** (→ `domain.md`) |
| 3 | **Persona** | Who the expert *is*: its expertise, voice/tone, standing rules — reflecting this user. | `persona` |
| 4 | **Elicitation style** | How this expert talks to its future user when shopping — how many questions before searching, how proactive, how much it explains. | inside `playbook` |
| 5 | **Answer→`sil_search`-param mapping** | The domain's decision-attributes translated into concrete `sil_search` parameters this expert will set (see [`search_param_mapping.md`](search_param_mapping.md)). | inside `playbook` |
| 6 | **Comparison / recommendation rubric** | How this expert ranks and picks among results, weighted by the user's *stated* priorities. | inside `playbook` |

Sections 3–6 carry the **tailoring**: they must reflect what *this* user said, not a generic template. The persona goes in the spec's `persona` field; the elicitation style + the answer→param mapping + the rubric are authored as **prose** into the spec's single `playbook` string (the domain sub-skill — a SKILL.md-shaped markdown body, **not** JSON). The **domain spec** is its own first-class slot (`domainSpec` → `domain.md`), distinct from persona and playbook — researched niche dimensions, not restated persona prose. There is no structured field for the mapping, the style, or the rubric — they live as readable markdown sections inside `playbook`.

## Run the interview in this order

1. **Open with the domain, not a form.** Reflect the request back ("a shopping expert for road-cycling gear — let's shape it together") and ask **one** orienting question. Signal this is a conversation that can be revised, not a questionnaire. Do not ask for an `agentId`, a budget, and a tone all at once.

2. **Narrow a vague domain together FIRST — before any other section.** If the domain is broad or ambiguous ("an expert for gifts", "electronics"), do **not** proceed to the domain-spec research, persona, the mapping, or the rubric. Ask 1–2 narrowing questions (who is it for / what occasion / which slice of the category) and **reflect a concrete niche back for confirmation**. A too-broad niche makes the domain-spec research, the answer→param mapping, and the rubric useless, so this narrow-first gate protects every downstream section. Only once the niche is concrete and confirmed do you move on.

3. **Research the niche's decision-dimensions → the domain spec (the SDS pass).** With the niche concrete and confirmed, **actively research** the niche's real decision-dimensions — the things a specialist optimizes that a layperson can't even name — and how they **trade off**. For road bikes: frame stack/reach (fit), groupset tier, rim depth vs. crosswind stability, tyre clearance, gearing range — and the trade-offs (deeper rims buy aero but cost crosswind handling). Converge a **domain spec**: each dimension, what it means for a buyer, and how the dimensions trade against each other. This is **researched, niche-concrete substance — not restated persona prose and not generic, niche-agnostic filler**; a domain spec a layperson could have written fails the SDS bar (business rule 10). Reflect the dimensions back to the user ("for trail running, last volume and lug depth matter more than weight — does that track?") and confirm. This lands in `domainSpec` (→ `domain.md`), a slot distinct from persona and playbook.

4. **Converge the persona (interview section 3 — see the table above).** Elicit the expert's expertise and voice, AND how the user wants it to behave (terse vs. chatty, cautious vs. opinionated, any standing rules). Reflect a short persona summary back; get a yes/adjust before advancing.

5. **Converge the three playbook sections (interview sections 4–6: elicitation style, the mapping, the rubric), interleaving domain-attributes with the user's stance:**
   - **Elicitation style:** how should the expert talk to its future user — how many questions before it searches, how proactive, how much it explains its picks? Reflect back, confirm.
   - **Answer→`sil_search`-param mapping:** name the domain's decision-attributes ("for road bikes: frame material, groupset tier, wheel size, budget…"), ask the user's stance on each, and translate each stated input into a concrete `sil_search` param (see [`search_param_mapping.md`](search_param_mapping.md) for the param table, worked examples, and the `ship_to`-empty rule). Reflect the mapping back, confirm.
   - **Recommendation rubric:** ask what the user weighs most ("durability over price", "prefer secondhand", "brand X is a hard no"), and tie the expert's ranking/selection to those *stated* priorities — not a fixed order. Reflect back, confirm.

6. **Derive the identity, confirm it.** From the converged domain, propose an `agentId` (lower-kebab, matching `^[a-z0-9][a-z0-9-]*$`, never `main`) and a human-readable `name` ("Road-Cycling Buyer" / `road-cycling-buyer`). **Confirm both with the user** — never silently invent them.

7. **Assemble the draft and present it back.** Compose the spec — `{ agentId, name, persona, playbook, domainSpec }` — and present it to the user as a **readable summary**: who the expert is, **the researched domain spec (the niche dimensions it will optimize over)**, how it'll search (the mapping), and how it'll recommend (the rubric). Present the domain spec's dimensions in the readable summary, so the user sees the niche-concrete substance before endorsing. Self-check the shape against the engine's `sil_profile_materialize` input contract: `agentId` lower-kebab and ≠ `main`, non-blank `name`, non-blank `persona`, a non-blank `playbook` (the elicitation-style + mapping + rubric prose), and a non-blank `domainSpec` (the researched dimensions). This is a sanity pass; the engine's validate-first step is the authoritative gate — do not re-implement it here. This self-check is shape-only — it writes nothing, so `sil_profile_materialize` is NOT called here.

8. **Get explicit endorsement — the gate.** Ask for an explicit go-ahead ("shall I create it?"). Endorsement is an **affirmative user act** on the assembled draft — "yes, create it" / "go ahead" / "looks good, make it". It is **NOT** inferred from the user answering the last question, and **NOT** from silence. **Only on that explicit endorsement** do you proceed to the engine ([`agent_creation_engine.md`](agent_creation_engine.md)) and run its steps.

## Edge cases the interview handles gracefully

- **Collision (an expert with that id already exists).** The engine refuses a name collision — it returns the `collision` outcome from its `openclaw agents list` check and never clobbers an existing agent. When the proposed `agentId` collides, surface it in the conversation and offer the user a **choice — rename this expert under a new id, or refine the existing expert's niche** — rather than dead-ending. Never silently mutate the id, and never overwrite an existing expert. (Refining the *existing* expert's artefacts in place is out of scope here; offer rename as the concrete action.)
- **Abandon mid-flow.** The interview is multi-turn; the user may stop, change their mind, or walk away before endorsing. Because **no engine step runs before endorsement**, abandonment leaves **nothing created** — no host agent, no artefacts, no wiring. There is no partial expert to clean up and **no teardown needed**. Never "save progress" by writing artefacts early.
- **Creation is local + offline — no identity coupling.** Creating an expert neither requires nor performs sil registration. Do **NOT** present sil registration or a token as a prerequisite to *create* the expert. The expert registers the user later, on first shop, via `sil_register`. Building the expert never depends on the user having an identity.

## Business rules (invariants the interview holds on every path)

1. **No creation without explicit endorsement.** Nothing is written — not the host agent, not the artefacts, not the wiring — until the user explicitly endorses the assembled draft. The strongest invariant of this procedure: **nothing is created until** the user says yes, and the draft lives only in the conversation until then.
2. **Abandon-mid-flow creates nothing.** Because no engine step runs pre-endorsement, an abandoned interview leaves no partial expert — automatic, not a teardown. Never write artefacts early to "save progress"; the draft lives only in the conversation.
3. **Elicit BOTH sides.** The interview must elicit the domain's decision-attributes AND the user's personal tastes/style/budget/constraints. A spec built from only domain attributes (generic) or only preferences (no searchable mapping) is incomplete.
4. **Tailoring is real, not template.** The persona, the mapping, and the rubric must reflect the user's *stated* inputs — a stated budget becomes `price_min`/`price_max`; "prefer secondhand" becomes `condition`; "durability over price" becomes a rubric weight. A spec that ignores what the user said fails this procedure's purpose. The tailoring is **not a generic template**.
5. **Converge each section before advancing; stay re-entrant.** Reflect-and-confirm per section; let the user revise any earlier section. Collaborative, not a locked wizard.
6. **Narrow a vague domain first.** Never build persona/mapping/rubric on an un-narrowed niche — narrow with the user before proceeding.
7. **Refine-or-rename on collision; never clobber.** On an existing-name collision, offer refine-or-rename; never overwrite an existing expert (defers to the engine's `collision` refusal). Never clobber.
8. **Creation is local + offline — no identity coupling.** The interview never presents sil registration / a token as a prerequisite to create the expert.
9. **Search behaviour the expert inherits is correct by construction.** The answer→param mapping encodes the location-aware default: leave `ship_to` empty (server resolves the registered default), never instruct the expert to call `sil_whoami` to populate it (see [`search_param_mapping.md`](search_param_mapping.md)).
10. **The domain spec is researched and niche-specific, never generic.** The domain spec must name decision-dimensions concrete to *this* narrowed niche — substance a layperson couldn't enumerate. A generic, niche-agnostic domain spec, or one that merely restates the persona prose under a new heading, **fails SDS**: the whole point is that the domain spec carries the dimensions the expert optimizes over that a coarse "size 43, black" request never names. Research the niche; do not relabel latent knowledge.

## After endorsement

Once the user has **explicitly endorsed** the assembled draft, proceed to [`agent_creation_engine.md`](agent_creation_engine.md) and run the engine steps in order. Until that explicit endorsement, **zero engine steps** have run.
