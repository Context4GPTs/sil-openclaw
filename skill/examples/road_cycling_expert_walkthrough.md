# Worked example — a road-cycling shopping expert, end to end

A complete walkthrough from a free-form request through the interview ([`../references/brainstorm_interview.md`](../references/brainstorm_interview.md)) to a created expert via the engine ([`../references/agent_creation_engine.md`](../references/agent_creation_engine.md)). The transcript is illustrative — a real interview adapts to the user; this shows the *shape* of convergence and the load-bearing gates.

## 1. The free-form request

> **User:** "I want an expert that shops for road-cycling gear for me."

Reflect the request back and open with one orienting question — not a form:

> **Expert:** "A shopping expert for road-cycling gear — let's shape it together. We can revise anything as we go. To start: are you after a complete bike, or kit and components (wheels, groupsets, apparel)?"

## 2. Narrow the (vague) domain FIRST

"Road-cycling gear" is broad. Narrow it before any other section:

> **User:** "Mostly components and apparel — I already have a frame."
> **Expert:** "Got it — so the niche is **road-cycling components & apparel for an existing frame** (wheels, groupsets, finishing kit, clothing), not complete bikes. Does that capture it?"
> **User:** "Yes."

The concrete, confirmed niche is locked before persona/mapping/rubric — the narrow-first gate is satisfied.

## 3. Converge the persona (section 2)

> **Expert:** "How should this expert come across — a terse spec-checker, or a chatty guide who explains trade-offs? Any standing rules?"
> **User:** "Knowledgeable but concise. Always flag compatibility issues with my groupset. No carbon-fibre handlebars — I don't trust them."
> **Expert:** "Persona: a concise, knowledgeable road-cycling components advisor; standing rules — always flag groupset compatibility, never recommend carbon handlebars. Good?"
> **User:** "Perfect."

→ lands in `persona`.

## 4. Converge the three playbook sections (3–5)

**Elicitation style:**
> **Expert:** "When you ask it to shop, should it search right away on a one-line request, or ask a clarifying question or two first?"
> **User:** "Ask at most one clarifying question, then search."

**Answer→`sil_search`-param mapping** (loading [`../references/search_param_mapping.md`](../references/search_param_mapping.md)):
> **Expert:** "For components the decision-attributes are budget, groupset tier, new vs. secondhand, and where you buy. Where do you stand?"
> **User:** "Budget around €1200, secondhand is fine, I'm in France and prefer local shops."

Translating each stated input to a real param:

```
query:           "road-cycling components 105 groupset"   # niche descriptors
category:        "cycling-components"
price_max:       120000        # €1200 → minor units (cents)
condition:       ["secondhand"]   # "secondhand is fine"
local_merchants: true             # "prefer local shops" → ranking bias; query issued in French
# ship_to: OMITTED — server resolves the registered default address; no sil_whoami round-trip
```

**Recommendation rubric:**
> **Expert:** "What matters most when I pick among results?"
> **User:** "Compatibility first, then value, then weight. Brand X is a hard no."

→ Rubric: rank by groupset compatibility, then value, then weight; exclude brand X. Tied to the user's *stated* priorities, not a fixed order.

All three sections are authored as prose into the single `playbook` string.

## 5. Derive + confirm the identity

> **Expert:** "I'll call it **Road-Cycling Buyer** (`road-cycling-buyer`). Good?"
> **User:** "Yes."

→ `agentId: road-cycling-buyer` (lower-kebab, ≠ `main`), `name: "Road-Cycling Buyer"`.

## 6. Assemble the draft and present it back

The assembled spec — a valid `sil_profile_materialize` input:

```jsonc
{
  "agentId": "road-cycling-buyer",
  "name": "Road-Cycling Buyer",
  "persona": "A concise, knowledgeable road-cycling components advisor. Standing rules: always flag groupset compatibility; never recommend carbon-fibre handlebars.",
  "playbook": "## Elicitation style\nAsk at most one clarifying question, then search.\n\n## Answer→sil_search-param mapping\n- Budget → price_min/price_max (minor units). Secondhand-ok → condition: [\"secondhand\"]. Local shops → local_merchants: true, query in French. ship_to left empty (server resolves the registered default; no sil_whoami round-trip).\n\n## Recommendation rubric\nRank by groupset compatibility, then value, then weight. Brand X is a hard no."
}
```

> **Expert:** "Here's the expert: a concise components advisor that flags compatibility, searches secondhand within ~€1200, biases to local French shops, and ranks compatibility → value → weight. Shall I create it?"

## 7. Explicit endorsement — the gate

> **User:** "Yes, create it."

**This affirmative act is the gate.** Up to this point, **zero engine steps have run** — nothing was written. Only now does the engine proceed.

## 8. Run the engine (after endorsement)

Following [`../references/agent_creation_engine.md`](../references/agent_creation_engine.md) in order:

1. **Validate the spec FIRST** — `agentId` lower-kebab & ≠ `main` ✓, `name` non-blank ✓, `persona` non-blank ✓, `workspace` present ✓.
2. **Collision check** — `openclaw agents list --json`; no existing `road-cycling-buyer` → proceed.
3. **Create the shell** — `openclaw agents add road-cycling-buyer --workspace ~/.openclaw/workspace-road-cycling-buyer --non-interactive --json`.
4. **Materialize artefacts** — `sil_profile_materialize` with the spec writes `persona.md`, `playbook.md`, `profile.json` into `$SIL_DATA_DIR/agents/road-cycling-buyer/`.
5. **System framing** — copy `persona.md` into the agent's workspace `SOUL.md`.
6. **Wire sil** — `openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json` and `openclaw config set plugins.entries.sil.enabled true --merge`.
7. **Validate with the host's OWN check, THEN declare created** — `openclaw config validate --json` returns valid → outcome **`created`**.
8. **Tell the user** — the expert exists; opening it loads the persona + playbook and it shops on its niche with **no further setup**.

## Edge cases this example would have handled

- **Collision** (a `road-cycling-buyer` already exists): the engine returns `collision`, writes nothing, and the conversation offers **refine-or-rename** — never clobbers.
- **Abandon before step 7** of the interview (user walks away pre-endorsement): nothing was created, nothing to tear down — the draft lived only in the conversation.
- **Creation is local + offline**: no sil registration was needed to create the expert; the user registers later, on first shop, via `sil_register`.
