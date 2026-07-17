---
name: fill-and-feedback
description: Beats 3 and 6 of the sil shopping loop. Beat 3 fills the PRD by precedence (multi-turn, authors the Search specs block, hard-constraint dual-enforce, the persistence split); Beat 6 is the reaction half (capture-gate, confirm-before-write, route-by-scope). Covers sil_learn, the one target+change write verb (create | write | attach-asset). Load within an active sil shopping loop.
---

# Beat 3 (Fill) and Beat 6 (Feedback) — via `sil_learn`

Beats 1–2 hand off the resolved PRD + method body. Beat 3 fills it; Beat 6 captures
what the reaction surfaces — both persist through **`sil_learn write`** (the whole
reconciled doc, never a stacked bullet).

## Beat 3 — Fill by precedence

Enumerate the load-bearing dimensions the method names, then resolve each down the
chain, **first hit wins**:

**request-intent > PRD filled-pref > method taste > user_spec fact > method default**

A pure **read-compose** — **most** dimensions **resolve** from stored state with
**no question** (a revisited niche does not re-ask).

**Elicit the residue — multi-turn.** Only a dimension that is unresolved **and**
load-bearing **and** not answerable from a sensible default goes to the buyer.
Pursue each until **resolved** or explicitly **declined**, then search. Each turn is
**a few at a time, never a battery**, each tied to **why**, playing the filled
understanding back.

**Author the `## Search specs` block.** As dimensions resolve, project each into a
`{ ns, key, op, value, unit?, hard? }` predicate (keys from the method's `## Search
vocabulary`) — the block Beat 4 sends verbatim. A **preferred-value-with-fallback**
("prefer ear hooks, fins acceptable") is **one `op:in` set** over the acceptable
values, **not** a hard `eq` on the favourite; the favourite is a **Beat-5 ranking**
preference. Mark a predicate **`hard: true`** only when a miss must **reject at pick** —
loose hard-marking empties result sets.

**Live request vs a stored durable pref — ask, don't guess.** When the request
contradicts a stored **durable** PRD preference, the request wins **this** search,
but ask whether it is **one-off** or **standing**. "Just this once" → ephemeral, no
write. "From now on" → a **standing** change: **`write`** the reconciled PRD (the
changed line rewritten in place). **Never silently overwrite** a standing preference.

**Hard constraints are inviolable — dual-enforced.** A `user_spec` `[hard]` line and a
PRD `## Search specs` `hard:true` predicate route to a real **filter** where one exists
**and** to Beat 5's **reject-at-pick** check — because a `specs` predicate can read
`applied:false`.

**The split — persist stated durable answers NOW.** Fill is the **first** of two
persistence moments: a durable answer the buyer **stated** during elicitation is
**written** into the PRD **now** — a `write` that folds it into `## Search specs` /
`## Filled preferences` — so an abandoned session still recovers what was settled. What
the buyer's **reaction** surfaces is **Beat 6's** write. One-off direction stays
**ephemeral**, **never written** by either.

**Decline never blocks.** A declined question narrows **quality**, never **access**
— proceed on the best-defensible params and **state the assumption** ("assuming
waterproofing, since it's for the slope"). Unresolved-and-declined dimensions land
in the PRD's **`## Notes / open`** so the next session recovers, not re-asks — a
non-answer is a note, never a preference.

## Beat 6 — Feedback: the reaction half

Beat 6 is the loop's **only reaction-time persistence**, a standing beat.

**The capture gate — most reactions persist nothing.** Write only a signal that is
**durable AND new** — no **duplicate** (not already stored), no **noise**, no
**empty** entry. A this-pick reaction ("too pricey this time") is not durable, never
written.

**Confirm before every durable write.** When the gate surfaces a new durable
candidate, **confirm before** writing it ("want me to remember you run Shimano?") —
**never a silent harvest**. The confirm is gated behind the candidate, so most
reactions ask nothing.

**Route by scope — the placement rule.** A confirmed signal lands at the **broadest
scope where it stays true**:

- a cross-domain **fact** / **hard** constraint → **`user_spec`**;
- a durable per-domain **taste** → the **method** (`## Durable taste`);
- a **this-job** preference or spec → the **PRD** (`## Filled preferences` /
  `## Search specs`);
- an **image** → **`attach-asset`** (per-domain).

**Every write is a reconciled whole-doc `write`.** Read the target
(`sil_profile_get`), fold the new signal into the coherent whole, and `sil_learn write`
it back — a correction **rewrites** the line it changes, so the doc **never stacks a
contradicting bullet**. There is no append/amend/retract; reconciliation is the only
update path.

**Re-scope = write-broader-then-write-narrower.** When a reaction shows a stored fact
is broader than where it lives, `write` it into the **broader** target and `write` the
**narrower** one without the moved line (two `sil_learn write` calls). There is **no
promote verb**.

## `sil_learn` — the one target + change write verb

`sil_learn` is the single **target + change** verb owning the whole method/PRD
lifecycle. `target` selects where the change lands (`user_spec` / `method` / `prd`);
the **kind** selects the change. **Three kinds:** **create** (mint a NEW method/PRD —
errors if one already exists), **write** (replace an existing doc's whole body with the
reconciled version you author — read it first, carry every buyer line forward),
**attach-asset** (persist image bytes, linked by path). Every capture is reviewable via
`sil_profile_get` and erasable via `sil_profile_remove` — never silently harvested.
