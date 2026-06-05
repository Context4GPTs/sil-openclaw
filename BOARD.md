# BOARD

This file is a stub. The kanban board lives in worktree-resident frontmatter files, rendered by Obsidian.

- **Cards (active)**: `.claude/worktrees/card-<slug>/cards/<slug>.md` — the card file lives in its own per-card worktree on branch `card/<slug>`, born at `/board-add` time and never on the base branch until PR merge
- **Cards (terminal)**: `cards/done/<YYYY>/` and `cards/abandoned/<YYYY>/` on the base branch
- **Visualization**: [`INDEX.base`](INDEX.base) — open in Obsidian (core Bases plugin renders the views as tabs; the Kanban Bases View community plugin handles the kanban view specifically)
- **Manual**: [`.claude/skills/board/SKILL.md`](.claude/skills/board/SKILL.md)
- **Dispatcher**: [`/board-tick`](.claude/commands/board-tick.md) — advance the board one step. Recommended ambient mode: `/loop /board-tick` (self-paced, runs in a dedicated terminal). Scoped variant: `/board-tick <slug>`.
- **Cross-device sync**: [`.claude/scripts/board-sync.sh`](.claude/scripts/board-sync.sh) — pure git reconciliation; runs as Phase 1 of `/board-tick` AND as a cron job on read-only devices (e.g., phone Termux).
- **Ambient log**: `.claude/board-state.md` (gitignored). `tail -f` it from any terminal to watch board activity.
- **Add a card**: [`/board-add <work_type> <title>`](.claude/commands/board-add.md)
- **Abandon a card**: [`/board-close <slug>`](.claude/commands/board-close.md)

## Why worktree-resident

The previous base-branch-resident model committed the card file to `main` first and let it go stale once the worktree was created. `INDEX.base` (reading from `cards/` on `main`) showed wrong status for every active card, and cross-device coordination was impossible without mirror commits or a snapshot file.

In the worktree-resident model, the card file lives in exactly one place: its `card/<slug>` branch, checked out as `.claude/worktrees/card-<slug>/cards/<slug>.md`. Every device reconciles its local worktrees from `origin/card/*` via `board-sync.sh`. Obsidian's `BOARD.base` reads from the worktree paths directly — no mirror, no snapshot, no staleness.

## Required Obsidian plugins

Install via Settings → Community plugins → Browse:

- **Kanban Bases View** (welchcanavan) — renders the kanban view of `INDEX.base` as drag-and-drop columns
- **Calendar Bases** (edrickleong) — optional, for date-scheduled cards

Obsidian indexes hidden (dot-prefixed) directories like `.claude/worktrees/` only when the vault setting "Files and links → Detect all file extensions" is on AND the dot-folder is not in the "Excluded files" list. Verify both before opening — otherwise the kanban will show only terminal cards.
