# Refine an existing expert from observed sessions — the refinement loop

When the user wants to **sharpen an expert they already have** — "refine my road-cycling buyer", "the gift buyer keeps surfacing the wrong stuff, let's fix it", "amend this expert" — do **not** re-brainstorm it from scratch and do **not** quietly mutate it. Run this **targeted-amend** loop: load the existing expert, propose concrete refinements drawn from what the agent actually **observed** in real shopping sessions under it, let the user **confirm a subset**, and persist **only** the confirmed subset by re-running the existing persist step. Nothing changes silently; nothing persists without the user's explicit confirmation.

This is a distinct capability from creating an expert ([`agent_creation_engine.md`](agent_creation_engine.md), which CREATES) and from the shop-time loop (which SHOPS). Refining **sharpens an existing expert** — the named one — from observed evidence. The default is a **targeted amend**, not a full cold re-brainstorm; a wholesale re-shape via the full interview remains available only on explicit request.

Run these steps **in order, top to bottom** — the order is the spec.

## The refinement loop (run in this exact order)

1. **Trigger + load the named expert.** The user names the expert to refine (or an end-of-session signal invites a refinement). Load that one expert's current artefacts with **`sil_profile_get { agentId }`** — the manifest plus the `persona` and `playbook` bodies. This is the working expert you are about to sharpen; everything you propose is grounded in what it already is.

2. **Propose, session-grounded — concretely, never a generic template.** Propose a small set of **concrete refinements drawn from the observed session** — what the agent actually saw in the just-completed (or in-progress) shopping session under this expert. Each proposal must name **two things**:
   - **which artefact element it changes** — a `persona` standing rule, a `playbook` answer→param **mapping** entry, or a recommendation **rubric** weight; and
   - **the concrete observed evidence behind it** — a `sil_search` param mapping that returned **relevant** vs **irrelevant** items, a question that turned out to matter (or was noise), a candidate the user **accepted** or **rejected**, or a taste/constraint the user **volunteered but the playbook never captured** (e.g. "you said 'nothing over 8kg' three times", "you rejected every leather option").

   Every proposal cites the observed evidence — it is **grounded**, not guesswork. This is **not a generic template** and **not** a plausible-sounding ungrounded "improvement"; a proposal not tied to anything the session showed is forbidden. (When the observed session is unavailable, do not invent one — see the fallback at the foot of this reference.)

3. **Confirm — the gate, before anything persists.** Present the proposals and let the user **confirm a subset** — all, some, or none (per-proposal accept/reject; the user chooses **which to keep**). Confirmation is an **explicit affirmative act** on specific proposals. It is **never inferred from silence**, and **never** from the user answering an **off-topic** / unrelated question. This is the strongest invariant of the loop, re-applying the create engine's endorsement discipline at refine time — *see [`brainstorm_interview.md`](brainstorm_interview.md) for the endorsement-gate discipline; do not restate it here.* Until the user confirms, the proposals live **only in the conversation**.

4. **Persist ONLY the confirmed subset.** Fold **only the confirmed** proposals into the expert's **full** spec (persona drift → the `persona` body; mapping / rubric / elicitation drift → the `playbook` body), then re-run the engine's persist step — **`sil_profile_materialize { agentId, name, persona, playbook? }`** — over that one `agentId`. The unconfirmed proposals are **discarded** with the conversation; nothing else persists, no more than what the user agreed to. If the user confirms nothing, nothing changes.

   The re-materialize is an **atomic in-place re-write** of that one expert's artefacts — `persona.md` and `playbook.md` are overwritten and the manifest refreshed, all-or-nothing per file (the store's existing idiom; do **not** hand-roll a write under the sil data directory). **On a persist failure the prior artefacts are left intact** — the expert is never served half-refined, and you tell the user the refinement **did not stick** (the failure leaves the prior state unchanged, so there is nothing to undo). *Truthful failure-safety note: the re-write is per-file atomic and dir-preserving — a failed re-write never tears the expert down and never serves a coherent half-refined expert (a broken manifest reads back as not-found, fail-closed). It is **not** a cross-file transaction; the safety property is "fails closed, prior expert intact / never half-served", not "all three files roll back together".*

   When a confirmed refinement changes the **persona** (the expert's system framing), also refresh the agent's workspace `SOUL.md` via the host CLI — the wiring half, mirroring the engine's persona-as-system-framing step. Behaviour artefacts go to the sil data directory via the plugin tool; the `SOUL.md` refresh is host-CLI; identity is untouched.

5. **Close the loop — the refined expert reflects the kept changes on re-run.** A later session opened inside the refined expert loads the **updated** artefacts (the same Runtime hook the engine documents) and behaves accordingly — the sharper mapping, the new hard-no, the re-weighted rubric. The improvement is durable: refinement is **iterative, never one-shot** — a change that did not land well is itself refinable next time.

6. **Isolation + the no-signal fallback.** A refinement touches exactly the named expert's `agents/<agentId>/` directory — keyed off the single validated `agentId`. **Other experts are untouched** (no sibling expert's artefacts mutate), and the **generic, profile-less shopping path is untouched** (a plain sil session still shops exactly as today). One expert's sharpening never leaks into another or into generic shopping.

## Privacy + scope — per-user and local

The improvement is **per-user and local**: it is written only to this user's sil data directory (`$SIL_DATA_DIR/agents/<agentId>/`), on this machine. There is **no server-side aggregation, no shared store, no shared expert, and no cross-user signal** — the refine path calls **no server endpoint** and performs **no identity round-trip**. The expert gets sharper for this user alone; nothing is pooled or shared.

## Refining the answer→`sil_search`-param mapping

A refinement to the mapping (e.g. a taste the user volunteered but the playbook never captured) maps **only onto real `sil_search` params** — and a volunteered taste with **no matching param** folds into the `query` text or the recommendation **rubric**, **never an invented filter**. The `ship_to` rule is unchanged at refine time too: leave it empty (the server resolves the registered default) — no identity round-trip to populate it. **Do not restate the param table here** — point at [`search_param_mapping.md`](search_param_mapping.md) (the table, the worked params, and the `ship_to`-empty rule); refining the mapping uses exactly those rules.

## When there is no observed-session signal

If the user asks to refine but **no observed session** is available — a fresh session, or the prior session is out of context — do **not fabricate** session observations to propose against. Fall back to a **guided amend**: ask the user what they want to change (and apply the same confirm-before-persist gate to whatever they describe), or **invite them to shop a session first** so the next refinement has real evidence to ground proposals in. Never invent observations.
