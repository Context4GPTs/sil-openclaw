---
name: refine-shopper
description: The refinement loop — sharpen the shopper or one domain from observed sessions, confirm-before-persist. Load when the user asks to refine, sharpen, or amend their shopper or a niche.
---

# Refine your shopper or one of its domains — the refinement loop

When the user wants to **sharpen their shopper** — "refine my shopper", "the cycling domain keeps surfacing the wrong stuff, let's fix it", "amend what you know about me" — do **not** re-onboard from scratch and do **not** quietly mutate anything. Run this **targeted-amend** loop: load the relevant artefact, propose concrete refinements drawn from what the shopper actually **observed** in real shopping sessions, let the user **confirm a subset**, and persist **only** the confirmed subset by re-running the existing persist step. Nothing changes silently; nothing persists without the user's explicit confirmation.

Refine has **two targets** — pick the one the user means:

- **The shopper itself** — the **shared `user_spec.md`** (cross-niche facts + hard constraints that carry across every niche), or the **persona** (the host `SOUL.md`).
- **One domain** — a single niche pack (target it by **slug**): its `domain_spec.md` (niche mechanics), `intent_spec.md` (decomposition dimensions), or `playbook.md` (the niche buying taste).

This is a distinct capability from creating the shopper ([`agent_creation_engine.md`](agent_creation_engine.md), which CREATES) and from the shop-time loop (which SHOPS). The default is a **targeted amend**, not a full cold re-onboard. Run these steps **in order, top to bottom** — the order is the spec.

## The refinement loop (run in this exact order)

1. **Trigger + load the target.** Refinement starts only when the user **explicitly asks** to sharpen the shopper or a **named** domain. At the end of a session you MAY *offer* to refine — but that offer is a prompt only: it loads nothing, proposes nothing, and persists nothing until the user accepts and then clears the explicit confirm gate in step 3. An ambiguous, silent, or off-topic remark is **never** a trigger. Once triggered, load the relevant artefacts with **`sil_profile_get { domainSlug? }`**:
   - To refine the **shopper**, load the **overview** (no `domainSlug`) — the shared `userSpec` + the domain index.
   - To refine **one domain**, pass its **`domainSlug`** — its `domainSpec` / `intentSpec` / `playbook` bodies **plus** the shared `userSpec`.
   The persona is the host workspace **`SOUL.md`**, read separately when a persona refinement is on the table. Everything you propose is grounded in what the shopper already is.

2. **Propose, session-grounded — concretely, never a generic template.** Propose a small set of **concrete refinements drawn from the observed session** — what the shopper actually saw in the just-completed (or in-progress) session. Each proposal must name **two things**:
   - **which artefact element it changes** — a **persona** standing rule (the host `SOUL.md`), a **shared user-spec** fact or hard constraint (`user_spec.md` — e.g. a standing measurement, "never leather" as a hard constraint — carries across every niche), or, within **one named domain**, a **domain-spec** mechanic (`domain_spec.md`), an **intent-spec** dimension (`intent_spec.md`), or a **buying-taste** preference (`playbook.md` — a brand the user keeps rejecting in this niche, a tightened budget band); and
   - **the concrete observed evidence behind it** — a `sil_search` param mapping that returned **relevant** vs **irrelevant** items, a question that turned out to matter (or was noise), a candidate the user **accepted** or **rejected**, or a fact/taste/constraint the user **volunteered but the spec never captured** (e.g. "you said 'nothing over 8kg' three times" → a shared `user_spec.md` hard constraint; "you rejected every leather option" → a shared hard constraint; "you kept asking about lug depth, which the cycling domain spec never covered" → that domain's `domain_spec.md` mechanic; "every cycling request turned on frame size, but its intent schema never decomposed on it" → that domain's `intent_spec.md` dimension).

   **Scope each proposal correctly:** a cross-niche fact/constraint or persona change targets the **shopper** (shared `user_spec.md` / `SOUL.md`); a niche-mechanical change targets **one domain's** pack. The **per-query intent** is ephemeral and is never a refine target — only a domain's `intent_spec.md` *dimension schema* is. Every proposal cites the observed evidence — it is **grounded**, not guesswork; a proposal not tied to anything the session showed is forbidden. (When the observed session is unavailable, do not invent one — see the fallback at the foot of this reference.)

3. **Confirm — the gate, before anything persists.** Present the proposals and let the user **confirm a subset** — all, some, or none (per-proposal accept/reject). Confirmation is an **explicit affirmative act** on specific proposals. It is **never inferred from silence**, and **never** from the user answering an **off-topic** / unrelated question. This is the strongest invariant of the loop, re-applying the create engine's endorsement discipline at refine time — *see [`brainstorm_interview.md`](brainstorm_interview.md) for the endorsement-gate discipline; do not restate it here.* Until the user confirms, the proposals live **only in the conversation**.

4. **Persist ONLY the confirmed subset — scoped to the right target.** Fold **only the confirmed** proposals into the right artefact, then re-run the engine's persist step over the matching target — refine is a **whole-doc path**, so it uses **`sil_profile_materialize`** (not `sil_remember`):
   - A **shared user-spec** change (cross-niche fact / hard constraint) → **`sil_profile_materialize { name, userSpec }`** with **NO `domain`** — read the current shared `userSpec`, fold the confirmed change in, pass it back. This overwrites only the shared `user_spec.md`; no domain pack is touched.
   - A **domain** change (a domain-spec mechanic, an intent-spec dimension, or a buying-taste preference for one niche) → **`sil_profile_materialize { name, userSpec, domain: { slug, name, domainSpec, intentSpec, playbook } }`** scoped to **that one slug** — read the current pack, fold the confirmed change into the relevant body, pass all three domain bodies (+ the unchanged shared `userSpec`) back. This re-mints exactly that one `domains/<slug>/` pack; sibling domains and the shared spec are untouched.
   - A **persona** change → refresh the agent's workspace **`SOUL.md`** via the host CLI — the persona is the `SOUL.md`, not a sil artefact, so a persona refinement is a host-CLI `SOUL.md` re-write, **NOT** a `sil_profile_materialize` call.

   The unconfirmed proposals are **discarded** with the conversation; nothing else persists. If the user confirms nothing, nothing changes. The re-materialize is an **atomic in-place re-write** of the targeted artefact(s) (the store's existing idiom; do **not** hand-roll a write under the sil data directory). **On a persist failure the prior artefacts are left intact** — the shopper is never served half-refined, and you tell the user the refinement **did not stick**. *Truthful failure-safety note: the re-write is per-file atomic and dir-preserving — a failed re-write never tears the shopper down and never serves a coherent half-refined pack (a broken manifest reads back as not-found, fail-closed). It is **not** a cross-file transaction; the safety property is "fails closed, prior state intact / never half-served", not "all files roll back together".*

5. **Close the loop — the refined shopper reflects the kept changes on re-run.** A later session loads the **updated** artefacts (the same Runtime hook the engine documents) and behaves accordingly — the new shared hard-no, the deeper cycling domain spec, the sharper intent dimensions, the tightened niche taste. The improvement is durable: refinement is **iterative, never one-shot** — a change that did not land well is itself refinable next time.

6. **Isolation — the targeted artefact only.** A domain refinement touches exactly that one `domains/<slug>/` pack — **siblings and the shared user spec are untouched** (unless the shared spec is the target). A shared-spec or persona refinement touches the shopper level and **no domain pack**. And the **generic, profile-less shopping path is untouched** (a plain sil session still shops exactly as today). One target's sharpening never leaks into another.

## Privacy + scope — per-user and local

The improvement is **per-user and local**: written only to this user's sil data directory (`$SIL_DATA_DIR/shopper/`), on this machine. There is **no server-side aggregation, no shared store, no cross-user signal** — the refine path calls **no server endpoint** and performs **no identity round-trip**. The shopper gets sharper for this user alone; nothing is pooled or shared.

## How a refinement reaches the `sil_search` params

A refinement to what the shopper searches on lands in an artefact — a shared fact in `user_spec.md`, or, within a domain, a mechanic in `domain_spec.md`, a dimension in `intent_spec.md`, or a taste in `playbook.md` — and those feed the **shop-time** mapping ([`search_param_mapping.md`](search_param_mapping.md)). The mapping maps **only onto real `sil_search` params** — a refined fact/taste with **no matching param** folds into the `query` text or the recommend-time rubric, **never an invented filter**. The `ship_to` rule is unchanged at refine time too: leave it empty (the server resolves the registered default) — no identity round-trip to populate it. **Do not restate the param table here** — point at [`search_param_mapping.md`](search_param_mapping.md).

## When there is no observed-session signal

If the user asks to refine but **no observed session** is available — a fresh session, or the prior session is out of context — do **not fabricate** session observations to propose against. Fall back to a **guided amend**: ask the user what they want to change (and apply the same confirm-before-persist gate to whatever they describe), or **invite them to shop a session first** so the next refinement has real evidence to ground proposals in. Never invent observations.
