---
name: repo-bootstrap
description: "Validate, reconcile, and seed a repo that has just received a copy-paste of the cc-setup harness. Runs IN the target repo (the Claude session is rooted in the target, not in cc-setup). Pre-flights the copy is complete; enforces the chosen mode's .gitignore state; invokes agent-config-generator for CLAUDE.md/AGENTS.md; spawns solutions-architect to migrate docs/ into the cc-setup taxonomy. Does NOT commit, push, or create branches — the founder owns git state. Use when the founder has just copy-pasted the harness into a repo and says 'bootstrap this repo', 'complete the bootstrap', 'finish setting up X', or similar."
---

# Repo Bootstrap

The cc-setup harness arrives in a target repo via founder-driven copy-paste. This skill takes over from there: validate the copy, reconcile the mode-specific `.gitignore` state, seed project identity files (`CLAUDE.md`, `AGENTS.md`, `docs/`). The skill never touches git state — the founder reviews via `git diff` / `git status` and commits manually.

## Prerequisites

Before invoking this skill, the founder must have copy-pasted into the target repo:

- `.claude/` — full harness: `agents/`, `skills/`, `hooks/`, `commands/`, `scripts/`, `rules/`, `settings.json`
- `cards/_TEMPLATE.md`, `cards/README.md`, `cards/done/.gitkeep`, `cards/abandoned/.gitkeep`
- `BOARD.md`, `INDEX.base`
- `.obsidian/` — Obsidian vault config. Required for `BOARD.md` and `INDEX.base` to render the kanban view (depends on the Bases plugin manifest + community-plugins manifest).

And must have chosen a **mode**:

- **committed**: harness is checked into the repo. Cross-device sync works. Default for internal repos (e.g. `4gpts-p2p-marketplace`).
- **gitignored**: harness lives on disk locally only. Public repo stays pristine. Single-device kanban — that's the deliberate tradeoff. Default for published repos (e.g. `klodi-plugin`).

See the `harness-distribution-modes` memory entry for the per-repo cheat sheet.

## What this skill does

The Claude session is rooted in the target repo. Everything happens in-place. The skill never reaches back to cc-setup.

### 1. Validate the copy

Confirm these exist in the target:

- `.claude/agents/`, `.claude/skills/`, `.claude/hooks/`, `.claude/commands/`, `.claude/scripts/`, `.claude/rules/`, `.claude/settings.json`
- `cards/_TEMPLATE.md`, `cards/README.md`
- `BOARD.md`, `INDEX.base`
- `.obsidian/`

If anything is missing, list what's missing and stop. The founder re-copies and re-invokes.

Also confirm these are **NOT** present on disk (they're cc-setup-only — should never have been copied):

- `.claude/agent-memory/`, `.claude/worktrees/`, `.claude/board-state.md`
- `.claude/scheduled_tasks.lock`, `.claude/sync.log`
- `.claude/AUDIT_REPORT.md`, `.claude/PARENT_CLAUDE.template.md`

If any are present, delete them.

**Historical-leak check** (this catches the case where a cc-setup-only file was committed to the target's git history in a past life — common for `.claude/scheduled_tasks.lock`, which is a lockfile Claude Code's built-in scheduled-tasks subsystem writes and sometimes fails to clean up on abnormal exit):

Run `git ls-files .claude/` in the target and check each result against the cc-setup-only list above. If any are **tracked by git** (even when absent from the worktree), surface them to the founder with the recommended cleanup:

```
git rm <path>          # untrack
# (.gitignore is reconciled in step 2)
```

Do **not** run `git rm` yourself. Report and move on — the founder owns git state.

Sanity-check `.claude/settings.json` parses as valid JSON.

### 2. Reconcile `.gitignore`

If the founder hasn't stated the mode, ask before continuing.

Required lines in **both** modes:

```
.claude/worktrees/
.claude/worktree-description.txt
.claude/board-state.md
.claude/sync.log
.claude/scheduled_tasks.lock
```

Additional required lines in **gitignored** mode (public-repo case — nothing kanban or Obsidian-related leaks into the published artifact):

```
.claude/
cards/
BOARD.md
*.base
.obsidian/
```

Notes:
- `*.base` catches `INDEX.base` and any future Obsidian Bases files added later.
- `.obsidian/` covers the entire vault config (plugin manifests, workspace state, community plugins). The narrower per-machine subset used in cc-setup's own `.gitignore` (`.obsidian/workspace`, `.obsidian/cache`, etc.) is for committed-mode repos; public repos exclude the lot.
- If the target has any other Obsidian artifacts (`*.canvas`, `*.excalidraw.md`, etc.), add them too — generalize the rule, don't enumerate exhaustively in advance.

In **committed** mode, ensure the gitignored-mode lines are **absent** (the harness and substrate must stay tracked). For Obsidian per-machine state in committed mode, ensure cc-setup's narrower pattern is present instead:

```
.obsidian/workspace
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/cache
.obsidian/plugins/*/data.json
```

Apply minimal edits via the `Edit` tool — append missing lines, remove lines that contradict the chosen mode. Do not rewrite the whole `.gitignore`.

### 3. Generate CLAUDE.md + AGENTS.md

Invoke the `agent-config-generator` skill via the `Skill` tool with this brief:

> This repo just received the cc-setup kanban+agent harness on disk. The generated `CLAUDE.md` and `AGENTS.md` MUST reference the harness — `.claude/skills/`, `.claude/agents/`, `cards/`, `BOARD.md`, the board flow (`/board-add`, `/board-tick`, `/board-close`), cards-as-living-documents — not generic AI-agent boilerplate. Preserve any project-specific facts from the existing `CLAUDE.md` / `AGENTS.md` in this repo (e.g. the plugin's contract surface, the adapters/registry split, package layout). Replace stale or harness-unaware sections.

### 4. Migrate `docs/` into the cc-setup taxonomy

Spawn a `solutions-architect` agent (via the `Agent` tool, `subagent_type: solutions-architect`) with this brief:

> Read this repo's existing `docs/`. Seed `docs/decisions/`, `docs/knowledge/`, `docs/product/` per the taxonomy at `docs/README.md` (just copied from cc-setup). Migrate existing docs into the taxonomy — do not delete content. Return a summary: what moved, what was created fresh, what's flagged for founder review.

### 5. Conditionally invoke design-system SETUP

Skip if the target has no UI surface (plugin contracts, libraries, backend services).

Invoke if the target has a frontend / brand surface, by calling the `design-system` skill in SETUP mode.

### 6. Stop. Report. Hand back to the founder.

Print:

- Files **modified**: list (typically `CLAUDE.md`, `AGENTS.md`, `.gitignore`)
- Files **added**: list (typically `docs/decisions/*`, `docs/knowledge/*`, `docs/product/*`)
- **Historical-leak findings** (from step 1, if any): cc-setup-only files that are tracked in git history despite being absent from the worktree, with the suggested `git rm <path>` commands. The founder runs these manually before committing.
- A reminder of mode-specific commit scope:
  - **committed**: stage everything new + modified, including `.claude/`, `cards/`, `BOARD.md`, `INDEX.base`, and `.obsidian/`.
  - **gitignored**: only `CLAUDE.md`, `AGENTS.md`, `docs/*`, and `.gitignore` will appear in `git status` — `.claude/`, `cards/`, `BOARD.md`, `*.base`, `.obsidian/` are invisible to git by design.
- Suggested commit message:
  - `chore: bootstrap cc-setup harness` (committed mode)
  - `chore: bootstrap cc-setup harness identity (gitignore harness locally)` (gitignored mode)

Do **not** commit. Do **not** create a branch. Do **not** push.

## Re-sync workflow

When cc-setup evolves and a target needs the update:

1. Founder re-copies the harness from cc-setup (overwriting the on-disk copy).
2. Founder re-invokes this skill.
3. Skill detects this is a re-sync by checking whether the target's `CLAUDE.md` already references `.claude/skills/` or the board flow.
4. On re-sync, skill runs **only** steps 1 (validate) and 2 (reconcile `.gitignore`). Steps 3–5 (identity files, docs migration) are first-bootstrap-only — those evolve through normal card work, not through harness re-syncs.

## Per-repo cheat sheet

| Repo | Mode | UI surface? | design-system SETUP? |
|---|---|---|---|
| `klodi-plugin` | gitignored | no | no |
| `4gpts-p2p-marketplace` | committed | maybe | only if a frontend exists |
| `cc-setup` (self) | n/a — upstream | n/a | n/a |

## Hard rules

- Never commit, branch, or push. The founder owns git state.
- Never reach back to cc-setup. The session is rooted in the target; everything the skill needs is on disk locally (the founder already copied it).
- Never auto-resolve ambiguity. If mode is unstated or files are unexpectedly missing, ask.
- Never overwrite the founder's project-specific facts in `CLAUDE.md` / `AGENTS.md`. Preserve, augment, replace generic boilerplate only.

## See also

- `[[harness-distribution-modes]]` — memory entry
- `.claude/skills/agent-config-generator/SKILL.md`
- `.claude/skills/design-system/SKILL.md` (SETUP mode)
- `.claude/agents/solutions-architect.md`
