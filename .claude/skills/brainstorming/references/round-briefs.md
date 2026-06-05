# Council Round Briefs

Paste-ready templates for each round. The orchestrator fills the `<placeholders>` and spawns every council member with the appropriate brief in a single message (parallel).

Each brief follows Anthropic's four-part subagent contract: **Objective**, **Output Format**, **Tool Guidance**, **Task Boundaries**.

---

## Round 1 — Opening Position

```
You are joining a brainstorming council for this kanban card.

## Card
<full card body verbatim>

## Shared context (read-only)
- docs/decisions/ (excerpt — grep `docs/decisions/INDEX.md` for the affected area, then paste matched docs): <paste>
- docs/knowledge/ (excerpt — grep `docs/knowledge/INDEX.md` for the affected area, then paste matched docs): <paste>
- Design system (if UI work): <paste relevant tokens / patterns>
- Recent activity in affected area:
<git log --oneline -20 -- <paths> + brief file shape>

## Your seat
<agent role — e.g. "solutions-architect">

## Other council seats
<comma-separated list>

## Objective
Produce a Round 1 opening position from your discipline's perspective.
You will NEVER ask the founder a question. When the card is ambiguous,
record the most defensible assumption and proceed.

## Output format (exact section headers)
APPROACH: <2–4 sentences>
ALTERNATIVES_REJECTED:
- <one line each, with reason>
ANTICIPATED_OBJECTION: <one bullet — strongest objection from another seat + your pre-emptive answer>
ASSUMPTIONS:
- <"Assumed X because Y" — one per ambiguity in the card>
NON_NEGOTIABLES:
- <hard limits from your discipline: a11y, security, perf budgets, brand integrity, etc.>

## Tool guidance
Read, Grep, Glob. Read-only Bash for `git log` only. No file writes.

## Boundaries
- Stay in your discipline's lane. Do not preempt another seat's expertise.
- Under 400 words total.
- No code, no diagrams, no diffs.
- Do not invent facts about the codebase. Cite file:line when claiming current behavior.
```

---

## Round 2 — Adversarial Critique

```
You are continuing the brainstorming council for this card.

## Card
<same as Round 1>

## Shared context (read-only)
<same as Round 1>

## Round 1 — all opening positions
<paste every member's full Round 1 output verbatim, labeled by seat>

## Your seat
<agent role>

## Objective
Adversarial critique. You will identify the SINGLE strongest flaw in each
other member's approach, name real conflicts, propose a synthesis, and
update your own position if other seats produced evidence that weakens it.

Heterogeneity matters. Do not converge on another seat's position out of
politeness — the council fails by premature consensus more often than by
disagreement.

## Output format
CRITIQUES:
- <seat>: <flaw — specific. Cite file:line, a `docs/decisions/` doc, a `docs/knowledge/` gotcha, or a concrete failure mode. Do not assert; show evidence.>
CONFLICTS:
- <real disagreements between approaches, not surface wording>
SYNTHESIS: <2–4 sentences — the design you'd ship, keeping what's strongest from each seat>
POSITION_UPDATE: <If Round 1 was weakened, say so and update. If unchanged, say "unchanged" + one-line why.>
ASSUMPTION_RISK:
- <assumption> — SAFE | LOAD-BEARING

## Tool guidance
Read, Grep, Glob, read-only Bash. No file writes.

## Boundaries
- Under 400 words total.
- Critiques without evidence (file ref / doc ref / failure mode) DO NOT COUNT.
  Vague critiques are how persuasion attacks work in multi-agent debate.
- No code, no diagrams.
```

---

## Round 3 — Ratification

```
You are continuing the brainstorming council for this card.

## Card
<same as Round 1>

## Synthesis draft (orchestrator)
<orchestrator's draft of the design, 400–600 words.
Sections: Approach, Components, Data flow / interactions, Error handling,
Testing strategy, Rollout / risk.>

## Round 2 — your own critique and position update
<paste this seat's R2 output so the agent sees their own prior stance>

## Your seat
<agent role>

## Objective
Ratify or dissent on the synthesis draft.

## Output format
VERDICT: RATIFY | RATIFY-WITH-NOTES | DISSENT
NOTES (only if RATIFY-WITH-NOTES):
- <one line each>
DISSENT_DELTA (only if DISSENT): <the single change that would flip you to RATIFY>

## Tool guidance
Read, Grep. No file writes.

## Boundaries
- Under 150 words total.
- One verdict only.
- DISSENT must be addressable. "I just don't like it" is not a dissent.
```

---

## Optional Round 4 — Re-ratification (only after a fold)

Only used if Round 3 produced ONE actionable DISSENT and the orchestrator folded the dissent's `DISSENT_DELTA` into the draft. Re-spawn only the seats that previously dissented; the rest are already on record as RATIFY.

Use the Round 3 template above with the updated draft. **One re-spawn maximum.** If the council still doesn't converge, record the disagreement as `## Open Tension` on the card and ship the orchestrator's best-judgment draft.
