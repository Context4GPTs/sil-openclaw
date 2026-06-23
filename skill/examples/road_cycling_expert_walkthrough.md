# Worked example — a road-cycling shopping expert, end to end

A complete walkthrough from a free-form request through the interview ([`../references/brainstorm_interview.md`](../references/brainstorm_interview.md)) to a created expert via the engine ([`../references/agent_creation_engine.md`](../references/agent_creation_engine.md)), then on to its first **Spec-Driven Shopping (SDS)** session: domain-spec research at creation, first-shop user-spec capture, and a layered recommendation whose "why" cites all three layers. The transcript is illustrative — a real interview adapts to the user; this shows the *shape* of convergence, the load-bearing gates, and the SDS layering.

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

## 2b. Research the niche's decision-dimensions → the domain spec (the SDS pass)

With the niche concrete, actively research the dimensions a specialist optimizes that a layperson can't name — not restated persona prose:

> **Expert:** "For road components, the decision-dimensions that actually drive a good buy are: **groupset tier and cross-compatibility** (105 vs Ultegra vs Dura-Ace, and mechanical vs Di2 — mixing generations breaks shifting), **wheel rim depth vs. crosswind stability** (deeper rims buy aero but cost handling in gusts), **freehub/driver standard** (must match your hub), **gearing range** for your terrain, and **tyre clearance**. The big trade-off: deeper, aero wheels reward flat-and-fast riding but punish you on exposed climbs. Does that match how you think about it?"
> **User:** "Yes — and crosswind handling matters, I ride exposed coastal roads."

→ Converged **domain spec** (lands in `domainSpec` → `domain.md`): the dimensions above, what each means for a buyer, and the aero-vs-crosswind / groupset-compatibility trade-offs. This is researched, niche-concrete substance — exactly the layer a coarse "105 groupset, €1200" request never names.

## 3. Converge the persona (section 3)

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

The assembled spec — a valid `sil_profile_materialize` input. Note the researched **`domainSpec`** alongside persona + playbook (the `userSpec` is **not** here — it is captured later, on first shop):

```jsonc
{
  "agentId": "road-cycling-buyer",
  "name": "Road-Cycling Buyer",
  "persona": "A concise, knowledgeable road-cycling components advisor. Standing rules: always flag groupset compatibility; never recommend carbon-fibre handlebars.",
  "playbook": "## Elicitation style\nAsk at most one clarifying question, then search.\n\n## Answer→sil_search-param mapping\n- Budget → price_min/price_max (minor units). Secondhand-ok → condition: [\"secondhand\"]. Local shops → local_merchants: true, query in French. ship_to left empty (server resolves the registered default; no sil_whoami round-trip).\n\n## Recommendation rubric\nRank by groupset compatibility, then value, then weight. Brand X is a hard no.",
  "domainSpec": "## Road-cycling components — decision-dimensions\n- Groupset tier + cross-compatibility (105/Ultegra/Dura-Ace; mechanical vs Di2 — mixing generations breaks shifting).\n- Wheel rim depth vs. crosswind stability (deeper = more aero, worse in gusts).\n- Freehub/driver standard (must match the hub).\n- Gearing range for the rider's terrain; tyre clearance.\n## Trade-offs\n- Aero (deep wheels) vs. crosswind handling — the central tension; this rider's exposed coastal roads weight handling up.\n- Higher groupset tier buys shifting quality + weight, costs budget."
}
```

> **Expert:** "Here's the expert: a concise components advisor that flags compatibility, knows the niche dimensions (groupset cross-compat, aero-vs-crosswind, freehub standard), searches secondhand within ~€1200, biases to local French shops, and ranks compatibility → value → weight. Shall I create it?"

## 7. Explicit endorsement — the gate

> **User:** "Yes, create it."

**This affirmative act is the gate.** Up to this point, **zero engine steps have run** — nothing was written. Only now does the engine proceed.

## 8. Run the engine (after endorsement)

Following [`../references/agent_creation_engine.md`](../references/agent_creation_engine.md) in order:

1. **Validate the spec FIRST** — `agentId` lower-kebab & ≠ `main` ✓, `name` non-blank ✓, `persona` non-blank ✓, `workspace` present ✓.
2. **Collision check** — `openclaw agents list --json`; no existing `road-cycling-buyer` → proceed.
3. **Create the shell** — `openclaw agents add road-cycling-buyer --workspace ~/.openclaw/workspace-road-cycling-buyer --non-interactive --json`.
4. **Materialize artefacts** — `sil_profile_materialize` with the spec writes `persona.md`, `playbook.md`, **`domain.md`** (the researched domain spec), and `profile.json` into `$SIL_DATA_DIR/agents/road-cycling-buyer/`. No `user.md` yet — the user spec is captured on first shop.
5. **System framing** — copy `persona.md` into the agent's workspace `SOUL.md`.
6. **Wire sil** — `openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json` and `openclaw config set plugins.entries.sil.enabled true --strict-json`.
7. **Validate with the host's OWN check, THEN declare created** — `openclaw config validate --json` returns valid → outcome **`created`**.
8. **Tell the user** — the expert exists; opening it loads the persona + playbook + domain spec and it shops on its niche with **no further setup**.

## 9. First shop — capture the user spec ONCE (onboarding)

Later, the user opens the expert and shops for the first time ([`../references/expert_shopping.md`](../references/expert_shopping.md), Step 0). The expert has a domain spec but **no user spec yet**, so before searching it captures one — eliciting the user's standing attributes guided by the domain-spec's dimensions, in the persona's voice:

> **User:** "Find me a wheelset."
> **Expert:** "Before I search, a few standing things I'll keep so I never re-ask: your hub's freehub standard, your rider weight band (it bounds rim depth), and any hard no's. What's your setup?"
> **User:** "Shimano HG freehub, ~75 kg, I ride exposed coastal roads a lot. Hard no on rim brakes — I'm disc only. And nothing over €900 for wheels."
> **Expert:** "Kept: Shimano HG freehub, ~75 kg, exposed/crosswind-sensitive riding (soft preferences), and two **hard constraints** — disc-only (never rim brake) and a €900 wheel ceiling."

→ Persisted via **`sil_profile_materialize`** re-run for `road-cycling-buyer` with the new `userSpec` → writes `user.md`. The soft preferences and the **hard constraints** are marked distinctly (a weight bends; a hard constraint does not). This capture happens **once** — every later request reuses it and never re-asks these.

## 10. A layered recommendation — the "why" cites all three layers

Now the per-request loop runs. The expert **derives the intent spec**, layers intent → user → domain, and recommends with a "why" that cites all three:

> **Expert (intent spec):** "So this request: a **wheelset**, for your coastal/crosswind riding, under €900."
> **Expert (search + pick):** "I searched disc-only wheelsets with a Shimano HG freehub under €900 — the disc-only **hard constraint** is a real filter and a reject rule, so nothing rim-brake reaches you. Top pick: the [mid-depth alloy/carbon wheelset].
> **Why:** for your **exposed coastal roads** (your stored profile — I didn't re-ask) I weighted **crosswind stability over outright aero** — a domain trade-off where deeper rims would punish you in gusts — so I picked a **shallower 35 mm rim** over a 50 mm aero option that scored higher on paper. It's disc-only and Shimano HG, matching your hard constraints, and lands at €840, inside your ceiling."

That "why" cites the **derived intent** (a sub-€900 wheelset), a **stored user-spec attribute it did not re-ask** (coastal/crosswind profile), and a **researched domain-spec dimension** (rim depth vs. crosswind trade-off) — visible layered reasoning, not generic attribute matching. A pick rationale that named none of those would **fail the SDS bar** even if the wheelset were fine.

If the user later says "actually I've moved inland, aero matters more now" — that contradicts the stored *soft* preference, so the expert **updates the user spec** (re-materialize), visibly. But "find me a rim-brake bargain" never overrides the **hard** constraint: intent never beats a hard constraint.

## Edge cases this example would have handled

- **Collision** (a `road-cycling-buyer` already exists): the engine returns `collision`, writes nothing, and the conversation offers **refine-or-rename** — never clobbers.
- **Abandon before step 7** of the interview (user walks away pre-endorsement): nothing was created, nothing to tear down — the draft lived only in the conversation.
- **Creation is local + offline**: no sil registration was needed to create the expert; the user registers later, on first shop, via `sil_register`.
