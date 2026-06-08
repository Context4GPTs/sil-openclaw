# Cards

The kanban substrate. One file per unit of work, born and grown inside its own per-card worktree. The card is the **living document** for that work — agents accumulate handoff sections on it through every stage.

## Layout

```
cards/
├── README.md              ← this file
├── _TEMPLATE.md           ← starter (not used directly; /board-add copies it into the worktree)
├── done/<YYYY>/           ← terminal: success (dispatcher moves the file here on PR merge)
└── abandoned/<YYYY>/      ← terminal: killed (/board-close moves the file here)

.claude/worktrees/
└── card-<slug>/           ← per-card worktree on branch `card/<slug>`
    └── cards/
        └── <slug>.md      ← THE card file (active lifecycle lives here, never on the base branch)
```

The base branch (`main` / `dev`) **does not hold active cards**. The only card files committed to the base branch are the terminal copies under `cards/done/<YYYY>/` and `cards/abandoned/<YYYY>/`, plus this README and `_TEMPLATE.md`.

## Lifecycle

```
            /board-add creates branch + worktree + initial card commit, pushes origin/card/<slug>
                  │
                  ▼
       backlog → discovery → stand-by → in-dev → review → distilling → pr-ready → done
                                ▲                                                    │
                                └── ↺ review FAIL/REVIEW or pr-ready base drift ─────┘
                                                                                    ↑
                                                                  founder merges PR │
                                                                                    │
                                       ⨯ abandoned (founder kills via /board-close) │
                                                                                    │
                  /board-tick detects merge → git mv into cards/done/<YYYY>/ ───────┘
                                                  (on base branch)
```

- **/board-add** creates the worktree at card birth. The card file is born in `<worktree>/cards/<slug>.md` and pushed to `origin/card/<slug>`. No base-branch commit.
- **Discovery → pr-ready**: each stage's agent commits its handoff section to `card/<slug>` and pushes. The card file accumulates the full audit trail on the branch.
- **review PASS**: solutions-architect runs the `distillation` skill in the same worktree and pushes to the same PR.
- **pr-ready** is the founder notification — the PR contains implementation + tests + distillation. Each tick re-checks that the card branch is still cleanly mergeable into `base_branch`; trivial drift is reconciled in place, but a conflict bounces the card back to `stand-by` on the same branch and same PR.
- **Bounces to stand-by**: review FAIL/REVIEW and pr-ready base-drift both flip the card back to `stand-by` rather than `in-dev` directly. The dispatcher's existing `stand-by → spawn dev pair` routing then autonomously spawns the dev pair next tick — no founder intervention required for either bounce.
- **done** is terminal: the dispatcher detects the PR merge, git-mv's `cards/<slug>.md` (now on the base branch via the merge) to `cards/done/<YYYY>/<slug>.md`, edits frontmatter, commits + pushes the base branch, tears down the worktree + branches.

## Cross-device sync

Each device runs its own copy of `.claude/scripts/board-sync.sh` — pure git, no Claude invocation. The script reconciles local worktrees with `origin/card/*`: creates missing ones, ff-pulls existing ones, tears down those whose upstream is gone and whose card has settled into `done/` or `abandoned/`.

- **Laptop (active dispatcher)**: `/loop /board-tick` calls `board-sync.sh` as its Phase 1, then dispatches agents.
- **Phone (passive viewer)**: a cron line runs `board-sync.sh` every few minutes. No agents are spawned.

```
# Phone cron (Termux Debian)
*/5 * * * * cd /path/to/repo && bash .claude/scripts/board-sync.sh >> .claude/sync.log 2>&1
```

Convention: only one device runs `/board-tick` at a time. Other devices stay read-only via cron.

## See also

- [`INDEX.base`](../INDEX.base) — Obsidian Bases kanban view (reads from `.claude/worktrees/*/cards/` + `cards/done/` + `cards/abandoned/`)
- [`.claude/skills/board/SKILL.md`](../.claude/skills/board/SKILL.md) — operating manual
- [`.claude/commands/board-add.md`](../.claude/commands/board-add.md) — create a card
- [`.claude/commands/board-tick.md`](../.claude/commands/board-tick.md) — dispatcher
- [`.claude/commands/board-close.md`](../.claude/commands/board-close.md) — abandon a card
- [`.claude/scripts/board-sync.sh`](../.claude/scripts/board-sync.sh) — git reconciliation script
- [`.claude/skills/distillation/SKILL.md`](../.claude/skills/distillation/SKILL.md) — distillation skill
- [`docs/README.md`](../docs/README.md) — docs taxonomy + frontmatter convention
