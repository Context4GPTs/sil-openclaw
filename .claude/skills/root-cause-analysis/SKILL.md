---
name: root-cause-analysis
description: "Discovery-stage skill for `bug` cards. Investigates a bug with parallel competing hypotheses, runs an adversarial debate, and writes the confirmed root cause + recommended fix path into the card body. Does NOT implement the fix — that's standard TDD in Dev. Use whenever a bug's root cause is not obvious from the symptom."
---

# Root Cause Analysis

Discovery-only. Produces a **confirmed root cause** and a **recommended fix approach**, written into the card's `## Discovery findings`. The fix itself runs in Dev via `test-driven-development` + `adversarial-testing` + `live-verification` — never in this skill.

## Philosophy

```
ANALYSIS BEFORE FIX. EVIDENCE BEFORE OPINION.
A FIX WITHOUT A CONFIRMED ROOT CAUSE IS A GUESS.
```

This skill exists to prevent the most common bug-fixing failure: anchoring on the first plausible cause, patching symptoms, and shipping a regression three weeks later.

## When to Use

- Card's `work_type` is `bug` AND the symptom doesn't point at one obvious file/line.
- Stack trace ambiguous; reproduction intermittent; multiple plausible causes.
- Skip the skill (route directly to Dev TDD) only when the cause is genuinely one-line obvious.

## What This Skill Does NOT Do

- **No fix implementation** — that's expert-developer + qa-developer in Dev.
- **No test writing** — qa-developer owns RED tests after Discovery hands off.
- **No verification** — `live-verification` runs in Dev.
- **No knowledge capture** — distillation runs post-review, in the worktree, via the `distillation` skill.

If you find yourself editing code or tests inside this skill, you've drifted out of scope.

## Phase 0 — Worktree Already Exists

The dispatcher created `card/<slug>` and the worktree at `backlog → discovery`. **Do not create another.** Confirm you're in the worktree:

```bash
git rev-parse --show-toplevel    # must be the worktree path
git branch --show-current        # must be card/<slug>
```

If either is wrong, abort and re-spawn with `cd $worktree` instructions.

## Phase 1 — Error Analysis (solo)

Read:
- The card body — Intent, reproduction steps, error logs/stack traces, affected modules.
- The affected files: `git log --oneline -20 -- <files>` for recent changes.
- Related config and env references.
- `docs/knowledge/INDEX.md` — grep for the affected area; relevant gotchas open as full doc reads.
- `docs/decisions/INDEX.md` — grep for prior choices that constrain the surface.

Extract: error type, stack trace, affected modules, trigger conditions, intermittent-vs-deterministic.

## Phase 2 — Formulate Hypotheses

Produce **2–4 competing hypotheses**. Each must be:

- **Specific** — names a file, function, or interaction.
- **Testable** — describes what evidence would confirm or deny it.
- **Distinct** — not a re-skinning of another hypothesis.

If you can only produce one hypothesis, you're anchoring. Force at least one alternative even if it feels less likely — the point of the parallel investigation is to disprove the dominant theory.

## Phase 3 — Parallel Investigation

Spawn **one investigator agent per hypothesis** in a single message (multiple `Agent` tool calls in parallel). You stay in delegate mode and do not investigate directly.

### Investigator brief

```
Hypothesis: <one-sentence theory naming a file/function/interaction>

Error context:
- <stack trace / symptom>
- <reproduction steps>
- <affected files>

Your job (read-only):
1. Investigate ONLY this hypothesis. Do not pivot to another theory.
2. Report evidence FOR (with file:line references) and evidence AGAINST.
3. State confidence: high / medium / low.
4. If confirmed, propose a fix approach in 2–3 sentences.
5. Do NOT write code. Do NOT modify files.

Tools: Read, Grep, Glob, Bash (read-only commands only).
Output under 300 words.

Format:
EVIDENCE_FOR:
- <file:line — what it shows>
EVIDENCE_AGAINST:
- <file:line — what it shows>
CONFIDENCE: high|medium|low
FIX_APPROACH (if confirmed): <2-3 sentences>
```

## Phase 4 — Adversarial Debate

After all investigators report, surface the strongest opposing evidence and re-spawn the two most credible investigators with each other's findings attached. They must respond to the counter-evidence specifically.

Convergence criteria:

- Two+ investigators converge on the same cause from different angles → **strong signal**.
- One investigator finds evidence that eliminates all other hypotheses → **confirmed**.
- All hypotheses disproven → formulate new ones, repeat Phase 3.

Shut down the investigation team the moment the root cause is confirmed.

## Phase 5 — Write Discovery Findings + Handoff

Append to the card body's `## Discovery findings — <agents>` section:

```markdown
### Root cause
<file:line — one or two sentences naming exactly what's wrong>

### Why it happens
<short causal chain: under condition X, code path Y produces state Z which violates invariant W>

### Hypotheses considered
- ✓ <confirmed hypothesis> — evidence at <file:line>
- ✗ <rejected hypothesis> — disproven by <evidence>
- ✗ <rejected hypothesis> — disproven by <evidence>

### Recommended fix approach
<2–4 sentences. What changes. Where. Why this is the minimum viable fix.>

### Acceptance criteria (tier-tagged)
- [unit] <test that would have caught this>
- [integration] <test for the interaction that broke>
- [e2e] <only if user-visible behavior was affected>
```

Then flip frontmatter `status: stand-by`, `agents: []`, `updated: <today>`. Commit on the card branch. The dispatcher picks it up and routes to Dev.

## Hard Rules

- **Two+ hypotheses, always.** Single-hypothesis investigations are anchored.
- **Investigators report evidence, not opinions.** "I think X" without `file:line` doesn't count.
- **No code in this skill.** If you're tempted to edit anything outside the card body, stop.
- **Handoff is the deliverable.** A confirmed root cause without acceptance criteria is incomplete.

## Gotchas

- **First-investigator anchoring** — if you read Investigator #1's report before Investigator #2 finishes, you'll bias the debate. Wait for all reports before reading any.
- **Phantom hypotheses** — vague "maybe it's a race condition" without a named file is not a hypothesis. Force specificity or drop it.
- **Investigation creep** — agents discover bugs adjacent to the one they're chasing. That's a NEW card, not a scope expansion.
- **Reproducing-the-bug bias** — if reproduction is intermittent, two investigators may see different behavior. Note this explicitly in the findings — the intermittency itself is part of the root cause.
