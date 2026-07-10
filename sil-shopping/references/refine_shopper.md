---
name: refine-shopper
description: The refinement loop — sharpen the shopper or one domain from observed sessions, confirm-before-persist. Load when the user asks to refine, sharpen, or amend their shopper or a niche.
---

# Refine your shopper or one of its domains — the refinement loop

When the user wants to **sharpen their shopper** — "refine my shopper", "the cycling
domain keeps surfacing the wrong stuff", "amend what you know about me" — do **not**
re-onboard and do **not** quietly mutate anything. Run this **targeted-amend** loop:
load the relevant artefact, propose refinements drawn from what the shopper actually
**observed** in real sessions, let the user **confirm a subset**, and persist **only**
the confirmed subset. Nothing changes silently; nothing persists without confirmation.

Refine has **two targets**:

- **The shopper itself** — the **shared `user_spec.md`** (cross-niche facts + hard
  constraints), or the **persona** (the host `SOUL.md`).
- **One domain** — a single niche **domain pack**, targeted by **slug**: its
  `domain_spec.md`, `intent_spec.md`, or `playbook.md`.

This is distinct from creating the shopper
([`agent_creation_engine.md`](agent_creation_engine.md)) and from the shop loop (which
SHOPS). Run the steps **in order**.

## The refinement loop

1. **Trigger + load the target.** Refinement starts only when the user **explicitly
   asks** to sharpen the shopper or a **named** domain. At session end you MAY *offer*
   to refine, but that offer loads/proposes/persists nothing until the user accepts and
   clears the confirm gate (step 3). Load with **`sil_profile_get { domainSlug? }`** —
   the overview (no slug) for the shopper, or a `domainSlug` for one domain's pack (+
   the shared `userSpec`). Read the persona from the host **`SOUL.md`** when it is on
   the table.
2. **Propose, session-grounded — never a generic template.** Propose a small set of
   **concrete refinements drawn from the observed session** — what the shopper actually
   saw. Each proposal names **which artefact element it changes** (a persona rule, a
   shared `user_spec.md` fact/constraint, or — within one named domain — a
   `domain_spec.md` mechanic, an `intent_spec.md` dimension, or a `playbook.md` taste)
   **and the concrete observed evidence** (a param mapping that returned relevant vs
   irrelevant items, a candidate accepted or rejected, a fact the user volunteered but
   the spec never captured — "you said 'nothing over 8kg' three times" → a shared hard
   constraint; "you kept asking about lug depth" → that domain's `domain_spec.md`).
   Scope each correctly: a cross-niche fact/constraint or persona change targets the
   **shopper**; a niche-mechanical change targets **one domain's** pack. The per-query
   intent is ephemeral and never a refine target — only a domain's `intent_spec.md`
   *schema* is. Every proposal cites its evidence; an ungrounded one is not proposed.
3. **Confirm — the gate.** Present the proposals and let the user **confirm a subset** —
   all, some, or none (per-proposal accept/reject). Confirmation is an explicit
   affirmative act; it is **never inferred from silence**, and never from an
   **off-topic** reply. Until the user confirms, the proposals live only in the
   conversation. (This re-applies the create engine's endorsement discipline — see
   [`brainstorm_interview.md`](brainstorm_interview.md); do not restate it here.)
4. **Persist ONLY the confirmed subset — scoped to the right target.** Fold **only the
   confirmed** proposals in and re-run the engine's persist step — refine is a
   **whole-doc** path, so it uses **`sil_profile_materialize`** (not `sil_remember`):
   - A **shared user-spec** change → **`sil_profile_materialize { name, userSpec }`**
     with **no `domain`** — overwrites only the shared `user_spec.md`.
   - A **domain** change → **`sil_profile_materialize { name, userSpec, domain: { slug,
     name, domainSpec, intentSpec, playbook } }`** scoped to **that one slug** —
     re-mints exactly that `domains/<slug>/` pack; siblings + the shared spec untouched.
   - A **persona** change → refresh the workspace **`SOUL.md`** via the host CLI — a
     persona refinement is a host-CLI `SOUL.md` re-write, **not** a
     `sil_profile_materialize` call.
   The re-materialize is an **atomic in-place re-write** (the store's idiom; do not
   hand-roll a write). **On a persist failure the prior artefacts are left intact** —
   never a half-refined shopper — and you tell the user the refinement did not stick.
5. **Close the loop.** A later session loads the **updated** artefacts and behaves
   accordingly. Refinement is iterative — a change that did not land is refinable next
   time.
6. **Isolation.** A domain refinement touches exactly that one `domains/<slug>/` pack —
   **siblings and the shared user spec are untouched** unless the shared spec is the
   target — and the profile-less path is untouched. One target's sharpening never leaks
   into another.

## Per-user + local

The improvement is **per-user and local**: written only to this user's sil data
directory (`$SIL_DATA_DIR/shopper/`), on this machine. No server-side aggregation, no
cross-user signal, no identity round-trip.

## How a refinement reaches the params

A refined fact / mechanic / dimension / taste lands in an artefact and feeds the
**shop-time** mapping ([`search_param_mapping.md`](search_param_mapping.md)) — real
`sil_search` params only; a refinement with no matching param folds into `query` or the
rubric, never an invented filter. The `ship_to` rule is unchanged (leave it empty; the
server resolves the registered default). **Do not restate the param table here** — point
at [`search_param_mapping.md`](search_param_mapping.md).

## When there is no observed-session signal

If the user asks to refine but **no observed session** is available (a fresh session, or
the prior one is out of context), do **not fabricate** observations. Fall back to a
**guided amend**: ask the user what to change (apply the same confirm-before-persist
gate), or **invite them to shop a session first** so the next refinement has real
evidence. Never invent observations.
