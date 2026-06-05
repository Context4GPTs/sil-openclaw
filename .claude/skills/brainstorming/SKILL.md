---
name: brainstorming
description: "You MUST use this before any creative work — creating features, building components, adding functionality, or modifying behavior. Convenes an agent council that brainstorms the design autonomously across rounds (opening → critique → ratification). Never asks the founder questions; ambiguity is resolved by recording the most defensible assumption on the card."
---

# Brainstorming — Agent Council

A small council of specialist agents turns an idea into a finished design, autonomously. The orchestrator is the only serial node; every council member runs in clean context, in parallel, in rounds.

## The Non-Negotiable Rule

> **No founder questions. Ever.** Ambiguity becomes a documented assumption on the card, never a blocker. The founder reads the finished design and overrides assumptions if they're wrong.

This is what makes the flow ambient — `/board-tick` can drive brainstorming on a card without anyone watching.

## When to Use

Before any creative work: new feature, new component, behavior change, non-trivial refactor.

**Skip the council** for: typo fixes, dependency bumps, doc-only edits, work whose entire surface is one obvious line. Convening a council costs roughly 15× the tokens of a single agent — only spend it when the design has real choices to make.

## Phase 0 — Context (orchestrator, solo)

Gather the inputs every council member will share. Paste these verbatim into each brief so all seats start from identical ground truth.

- The **kanban card** body in full
- `docs/decisions/INDEX.md` (then read matched docs) — prior choices that constrain this work
- `docs/knowledge/INDEX.md` (then read matched docs) — repo invariants, gotchas, contracts
- `docs/design/INDEX.md` (then `system.md` + `brand.md`) if the card is UI-shaped *and* the file exists — the `design-system` skill loads these in USE mode. Skip silently if `docs/design/INDEX.md` is absent (fresh repo: `design-system` skill will enter SETUP on the first UI card).
- Affected area: `git log --oneline -20 -- <path>` and a brief shape of key files

## Phase 1 — Pick the Council

Pick **2–5 agents** whose discipline actually bears on the card. Three is the common case. Five is the ceiling — bigger councils converge prematurely (academic finding) or duplicate work (Anthropic's finding from their research system).

| Card shape | Default council |
|---|---|
| Backend / API / data model | `solutions-architect`, `expert-developer`, `devops-engineer` |
| UI feature (visual, interactive) | `product-owner`, `style-quality-guardian`, `expert-developer` |
| Customer-facing flow | `product-owner`, `product-marketer`, `expert-developer` |
| Growth / activation mechanic | `product-marketer`, `product-owner`, `solutions-architect` |
| Refactor / architecture cleanup | `solutions-architect`, `expert-developer`, `code-quality-guardian` |
| Infra / deploy / observability | `devops-engineer`, `solutions-architect`, `expert-developer` |

**Heterogeneity is the point.** Each seat must have a distinct discipline — two `expert-developer`s is one seat, not two. Homogeneous pools rubber-stamp the first proposal.

`qa-developer` does **not** sit on the council. It owns RED tests after the design is settled.

## Phase 2 — Round 1: Opening Positions (parallel)

Spawn every council member in a **single message** (multiple `Agent` calls in parallel). Each gets the Round 1 brief from `references/round-briefs.md`, filled with the card and shared context.

Each opening position must include: APPROACH, ALTERNATIVES_REJECTED, ANTICIPATED_OBJECTION, ASSUMPTIONS, NON_NEGOTIABLES. Under 400 words each.

## Phase 3 — Round 2: Adversarial Critique (parallel)

Re-spawn every member, this time with **every other member's Round 1 output pasted in**. Use the Round 2 brief.

Each critique must cite **evidence** — a file:line, a `docs/decisions/` doc, a `docs/knowledge/` gotcha, or a named failure mode. Critiques without evidence don't count. This is the single most important rule of the round: it's how the council resists persuasion attacks (a confident, well-worded but wrong critique flipping the group).

Each seat outputs: CRITIQUES, CONFLICTS, SYNTHESIS, POSITION_UPDATE, ASSUMPTION_RISK.

## Phase 4 — Round 3: Ratification (orchestrator drafts, council ratifies)

The orchestrator synthesizes Round 2 into a single draft (Approach, Components, Data flow, Error handling, Testing strategy, Rollout). 400–600 words. Then re-spawn the council in parallel with the Round 3 brief.

Verdicts: `RATIFY`, `RATIFY-WITH-NOTES`, `DISSENT`.

**Convergence rules:**
- All seats RATIFY or RATIFY-WITH-NOTES → settled. Fold the notes you accept; record the rest under `## Open Tension`.
- Exactly one DISSENT with a specific, addressable `DISSENT_DELTA` → fold it, re-spawn that seat once for re-ratification.
- Two+ DISSENTS or a non-addressable dissent → record `## Open Tension` and ship the orchestrator's best-judgment draft. Three rounds is the cap. Research on multi-agent debate is clear: returns diminish sharply after round three.

## Phase 5 — Write the Card

Append `## Design` to the card body:

```markdown
## Design — agent council (<YYYY-MM-DD>)

**Council:** <seats>

**Agreed approach**
<3–6 sentences. The shipped design.>

**Alternatives considered and rejected**
- <one line each, with reason>

**Non-obvious constraints / trade-offs**
- <one line each>

**Assumptions (founder may override)**
- ASSUMPTION: <X> — because <Y>

**Open tension (if any)**
- <unresolved conflict, named seats, what each wanted>
```

If a decision is genuinely cross-cutting, capture it under `docs/decisions/` via the `distillation` skill (search the INDEX, edit an existing doc if one matches). Most brainstorms produce zero such captures — only capture what future agents need that the code won't tell them.

## Phase 6 — Handoff

The worktree already exists — the `/board-tick` dispatcher created it at the `backlog → discovery` transition (see [`.claude/skills/board/SKILL.md`](../board/SKILL.md)). Brainstorming runs inside that worktree, so the design write in Phase 5 is already on `card/<slug>`.

1. Hand the card to `qa-developer` for RED tests (per `adversarial-testing`)
2. `expert-developer` takes GREEN

No founder prompt before handoff. The `/board-tick` dispatcher routes from here.

## Hard Rules

- **No founder questions.** Ambiguity → documented assumption.
- **Clean context per round.** Spawn fresh agents each round; do not reuse a running agent.
- **Parallel within a round, serial across rounds.** The orchestrator is the only synchronization point.
- **Heterogeneous seats.** Each council member must hold a distinct discipline.
- **Three-round cap.** R1 + R2 + R3 (+ at most one re-ratification fold). Then ship.
- **Evidence-bound critique.** R2 critiques must cite file:line or a doc reference. No assertions.
- **Dissent is preserved.** Notes you reject go under `## Open Tension`, not the trash.
- **The card is the source of truth.** Never write the design to a separate file.
- **YAGNI is a council value.** Any seat may invoke YAGNI to delete a proposed feature; burden of proof shifts to whoever wants to keep it.

## Gotchas

- **Over-spawning.** Anthropic's early multi-agent system spawned 50 subagents for trivial queries. Map card shape → council size and stop. Two-seat councils are valid for narrow cards.
- **Premature convergence.** If R1 positions look suspiciously aligned, the council is homogeneous. Drop a redundant seat and replace it with one whose discipline cuts the opposite way (e.g. swap a second `expert-developer` for `code-quality-guardian` or `product-owner`).
- **Judge bottleneck.** The orchestrator synthesizes R2 into the R3 draft. If the orchestrator is a weaker model than the council members, it will under-represent strong arguments. The synthesizer must be at least as capable as the strongest debater.
- **Persuasion attack.** One confident, well-worded but wrong critique can flip the group. The evidence-citation requirement in R2 is the defense — enforce it strictly.
- **Distillation creep.** A brainstorm is not a distillation pass. Do not edit docs under `docs/knowledge/` / `docs/decisions/` during R1–R3; only the final card write may add cross-cutting entries, and only when genuinely cross-cutting.
- **Infinite ratification.** Two ratification rounds maximum. After that, `## Open Tension` exists for a reason. Ship.

## Reference

- `references/round-briefs.md` — paste-ready Round 1, 2, 3, 4 briefs with full output formats
