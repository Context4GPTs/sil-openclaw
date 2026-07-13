---
name: fill-and-feedback
description: Beat 3 (fill the PRD by precedence, multi-turn, hard-constraint dual-enforce, the persistence split) and Beat 6 (the reaction half — capture-gate, confirm-before-write, route-by-scope), plus sil_learn, the one target+change write verb. Load when eliciting requirements or capturing what a reaction surfaced.
---

# Beat 3 (Fill) and Beat 6 (Feedback) — via `sil_learn`

Beats 1–2 hand off the resolved PRD + the method body. Beat 3 fills the PRD; Beat 6
captures what the reaction surfaces. Both persist through **`sil_learn`**.

## Beat 3 — Fill by precedence

Enumerate the load-bearing dimensions the method names, then resolve each by
walking the chain top-down, **first hit wins**:

**request-intent > PRD filled-pref > method taste > user_spec fact > method default**

This is a pure **read-compose** — **most** dimensions **resolve** from stored state
with **no question**, which is the whole point of the chain (a revisited niche does
not re-ask).

**Elicit the residue — multi-turn.** Only a dimension that is unresolved **and**
load-bearing **and** not answerable from a sensible default goes to the buyer.
Elicitation is **multi-turn**: keep pursuing each until it is **resolved** or
explicitly **declined**, then search. Each turn stays **a few at a time, never a
battery**, each tied to **why**, and plays the filled understanding back.

**Live request vs a stored durable pref — ask, don't guess.** When the request
contradicts a stored **durable** PRD preference, the request wins **this** search,
but ask whether it is **one-off** or a **standing** change rather than assuming.
"Just this once" → ephemeral, no write. "From now on" → a **standing** change:
**amend** the stored preference. **Never silently overwrite** a standing preference.

**Hard constraints are inviolable — dual-enforced.** `user_spec [hard]` + PRD hard
requirements are **inviolable**. Each is routed to a real **filter** where one
exists **and** handed to Beat 5's **reject-at-pick** check — belt and suspenders,
because a `specs` predicate can read `applied:false`.

**The split — persist stated durable answers NOW.** Fill is the **first** of two
persistence moments: a durable answer the buyer **stated** during elicitation is
**written** to the PRD's *Filled preferences* **now**, via `sil_learn` — so an
abandoned session still recovers what was settled. What the buyer's **reaction**
surfaces is **Beat 6's** write (the **reaction half**). One-off direction stays
**ephemeral** and is **never written** by either.

**Decline never blocks.** A declined question narrows **quality**, never **access**
— proceed on the best-defensible params and **state the assumption** ("assuming
waterproofing, since it's for the slope"). Unresolved-and-declined dimensions land
in the PRD's *Notes / open* so the next session recovers rather than re-asks.

## Beat 6 — Feedback: the reaction half

Beat 6 is the loop's **only reaction-time persistence** and a standing beat.

**The capture gate — most reactions persist nothing.** Write only a signal that is
**durable AND new** — **no duplicate** (**not already stored**), no **noise**, no
**empty** entry. A this-pick reaction ("too pricey this time") is not durable and
is never written.

**Confirm before every durable write.** When the gate surfaces a new durable
candidate, **confirm before** writing it ("want me to remember you run Shimano?")
— **never a silent harvest**. The confirm is gated behind the candidate, so most
reactions ask nothing.

**Route by scope — the placement rule.** A confirmed signal lands at the
**broadest scope where it stays true**:

- a cross-domain **fact** / **hard** constraint → **`user_spec`**;
- a durable per-domain **taste** → the **method**;
- a **this-job** preference → the **PRD**;
- an **image** → **`attach-asset`** (per-domain).

**Pick the kind.** New learning → **append**; a reaction that contradicts a stored
**soft** pref → **amend** (it **supersedes** — **never a stacked bullet**, never a
second bullet); a withdrawal → **retract**.

**Re-scope = write-broader-then-retract-narrower.** When a reaction shows a stored
fact is broader than where it lives, write it to the **broader** target and
**retract** the narrower copy (two `sil_learn` calls). There is **no promote verb**.

## `sil_learn` — the one target + change write verb

`sil_learn` is the single **target + change** verb owning the whole method/PRD
lifecycle. `target` selects where the change lands (`user_spec` / `method` /
`prd`); the **kind** selects the change. Its **five kinds**: **create** (mint a
whole method/PRD), **append**, **amend**, **retract**, and **attach-asset** (persist
image bytes, linked by path). Every capture is reviewable via `sil_profile_get` and
erasable via `sil_profile_remove` — never silently harvested.
