---
name: card-intake
description: "Quality gate that refines a founder's one-liner into a well-shaped backlog card before /board-add commits it. Use whenever the founder runs /board-add, says 'add a card to the backlog', 'let's add a card for X', 'new card: ...', or otherwise asks to create a kanban card. Returns refined (work_type, title, intent, priority) — or ABORT if the card shouldn't be created."
---

# Card Intake

A one-liner is rarely a well-shaped card. This skill sharpens the input before `/board-add` creates the `card/<slug>` branch + worktree. Run the seven checks below in order. Stop early if the founder confirms ABORT (duplicate, scope split, too vague).

## Inputs

The raw founder input: a `work_type` token and a title string. Example: `feature fix the thing`.

## Output

Either:
- `(work_type, title, intent, priority)` — feed these into `/board-add`'s mechanical steps.
- `ABORT` with a one-line reason — `/board-add` stops without creating a branch, worktree, or file.

## The seven checks

### 1. Duplicate probe

Scan active and terminal cards:

```bash
ls "$CLAUDE_PROJECT_DIR"/cards/*.md 2>/dev/null
ls "$CLAUDE_PROJECT_DIR"/cards/done/*/*.md 2>/dev/null
ls "$CLAUDE_PROJECT_DIR"/cards/abandoned/*/*.md 2>/dev/null
```

Match on slug similarity (shared trigrams) and on `title:` frontmatter (case-insensitive substring overlap of 3+ words). If any candidate matches, show the path + title and ask:

> "Found a possible duplicate: `<path>` — `<title>` (status: `<status>`). Proceed anyway / link to it / stop?"

If founder picks "stop" → return `ABORT: duplicate of <slug>`. "Link to it" → return `ABORT: founder will edit <slug>` (let them re-open the existing card themselves; don't auto-revive). "Proceed" → continue.

### 2. Title sharpening

Reject titles that are:
- Under 3 words after trimming
- Composed only of filler verbs (`fix`, `improve`, `update`, `add`, `change`, `tweak`) with no noun

For "fix the thing" / "improve stuff" / "add things", ask one targeted question — what specifically? Use the founder's reply as the new title. Don't loop more than once; if the second attempt is still vague, return `ABORT: title too vague`.

### 3. work_type challenge

Only correct obvious mismatches. Don't bikeshed.

- `feature` + title reads like a bug (`is broken`, `hangs`, `returns wrong`, `404s`, `crashes`) → suggest `bug`.
- `chore` + title implies code restructure (`extract`, `split`, `rename module`, `consolidate`) → suggest `refactor`.
- `refactor` + title is pure cleanup (`bump deps`, `remove dead file`, `delete TODO`) → suggest `chore`.

One-shot: ask, take the answer, move on.

### 4. Intent framing

For non-bug cards, the Intent is three lines:

```
**Problem:** <one sentence — what's wrong or missing today>
**Goal:** <one sentence — what good looks like>
**Success signal:** <one sentence — how we'll know it landed>
```

For `bug` cards, use Symptom / Expected / Repro instead:

```
**Symptom:** <what the user sees>
**Expected:** <what should happen>
**Repro:** <minimal steps>
```

Ask the founder for the missing pieces. Don't invent them — if the founder can't articulate the Success signal in one sentence, the card isn't ready (return `ABORT: success criteria undefined`).

### 5. Split check

If the framed Intent has two unrelated Goals, two distinct surfaces, or contains "and also" / "while we're at it" / "plus" — surface it:

> "This reads like two cards: `<A>` and `<B>`. Split, or keep as one?"

Don't force a split. If the founder keeps it as one, continue.

### 6. Priority + rationale

Default `priority: 2`. Confirm with the founder.

- `1` (drop-everything): require a one-line rationale. Append it as an HTML comment directly under the Intent block:
  ```html
  <!-- priority=1 rationale: <one line> -->
  ```
- `2`: no rationale.
- `3` (nice-to-have): no rationale.

### 7. Hand off

Return the refined tuple. `/board-add` does slug derivation, worktree creation, the initial card commit inside the worktree, and the push to `origin/card/<slug>`. This skill does not touch the filesystem beyond the duplicate probe reads, and does not touch the base branch at all.

## What this skill does NOT do

- Does not write to `cards/`. That's `/board-add`'s job (and it writes into the worktree, not the base branch).
- Does not create branches, worktrees, or push to origin.
- Does not auto-link cards or re-open abandoned ones.
- Does not assign agents, set worktrees, or modify frontmatter beyond the four fields it returns.
- Does not re-validate `work_type` against the allowed set — `/board-add` Step 2 still does that.
