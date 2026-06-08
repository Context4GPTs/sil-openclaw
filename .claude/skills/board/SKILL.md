---
name: board
description: "Read and operate on the project's kanban board. Cards live as frontmatter files INSIDE per-card worktrees (`.claude/worktrees/card-<slug>/cards/<slug>.md`) from birth through pr-ready; the base branch only sees them in `cards/done/` and `cards/abandoned/` after merge/abandon. Visualized by `INDEX.base` (Kanban Bases View). Find the active card, route it to the right agent based on its agents: tag, enforce per-stage handoffs. Use whenever the user says 'work the board', 'pick up the next card', refers to a card by title, or runs /board-tick."
---

# Board

The kanban board is the union of:

- **Active cards**: one markdown file per card inside its own worktree — `.claude/worktrees/card-<slug>/cards/<slug>.md`. The worktree is created at card birth by `/board-add` and the card never leaves it until the PR merges (or the card is abandoned).
- **Terminal cards**: `cards/done/<YYYY>/<slug>.md` and `cards/abandoned/<YYYY>/<slug>.md` on the base branch, populated by the dispatcher (on merge) or `/board-close` (on abandon).

The base branch (`main` / `dev`) **never holds active cards**. It contains only `cards/_TEMPLATE.md`, `cards/README.md`, and the terminal subtrees. This is the architectural shift from the old base-branch-resident model — see `docs/decisions/` if a more detailed write-up gets distilled.

`INDEX.base` reads from both surfaces via a multi-folder filter; Obsidian renders the kanban honestly without any state mirroring.

## When to use this skill

- "Work the board" / "Pick up the next card" / "What's in progress?"
- The user names a card by title or slug
- The user moves a card (drags in Obsidian, or asks you to flip its status)
- `/board-tick` runs (this skill defines what the tick does)
- Before closing a card or running distillation, to enforce the contract

## Lifecycle

```
backlog                 /board-add creates card/<slug> branch + worktree + initial card commit;
                        the card file is born in <worktree>/cards/<slug>.md and pushed to origin/card/<slug>
                        — the base branch is NEVER written to
   ↓ /board-tick
discovery               research agents (solutions-architect + product-owner, plus product-marketer / devops-engineer
                        when relevant) flesh out the card body, commit + push to card/<slug>
   ↓ research agents complete + write handoff
stand-by                queued for dev spawn — entered from discovery handoff, from a review
                        FAIL/REVIEW bounce, or from a pr-ready base-drift bounce; awaiting next tick
   ↓ /board-tick
in-dev                  expert-developer + qa-developer; TDD; commits to card/<slug>
   ↓ agents open PR (targeting base_branch)
review                  code-quality-guardian (+ style-quality-guardian if UI) — runs against the open PR diff
   ↓ PASS               (FAIL/REVIEW → ↺ stand-by on the same branch, same PR; routing spawns dev next tick)
distilling              solutions-architect captures knowledge IN the worktree on card/<slug>; pushes to the same PR
   ↓ distillation commits land
pr-ready                PR fully ready; founder notification fires here. Each tick checks the
                        card branch is still cleanly mergeable into `base_branch` — trivial drift
                        is reconciled in place, but a conflict ↺ stand-by on the same branch and
                        same PR (routing spawns dev next tick — no founder intervention needed)
   ↓ founder merges on GitHub
   ↓ /board-tick detects merge via `gh pr view`
done                    base-branch `cards/<slug>.md` (brought in by the merge) is git-mv'd to
                        `cards/done/<YYYY>/<slug>.md`, frontmatter edited (status: done, merged_commit, agents: []),
                        committed + pushed; worktree torn down; local + remote branches deleted; terminal

  ⨯ abandoned          founder runs /board-close; card body is copied from the worktree to
                        cards/abandoned/<YYYY>/<slug>.md on the base branch; PR closed; worktree torn down
```

**Founder gate:** PR merge. That is the only human checkpoint.

## Card anatomy

See [`cards/_TEMPLATE.md`](../../../cards/_TEMPLATE.md) for the full template.

### Frontmatter (the state)

```yaml
type: card
title: <human title>
slug: <kebab-case-slug>
work_type: feature | bug | refactor | chore | docs
status: backlog | discovery | stand-by | in-dev | review | distilling | pr-ready | done | abandoned
agents: [<currently-active agent names>]
priority: 1 | 2 | 3
created: YYYY-MM-DD
updated: YYYY-MM-DD
base_branch: main | dev | <branch the card was cut from and the PR targets>
worktree: <absolute path>  # set by /board-add; null only after teardown on done/abandoned
branch: card/<slug>        # set by /board-add at creation
pr: <gh pr url | null>     # set by expert-developer at in-dev → review
merged_commit: <sha | null> # set by /board-tick on PR-merge detection
```

### Body (the audit trail)

Sections accumulate as the card progresses. Each agent:

1. Reads only its predecessor's `### → Handoff to <this stage>` block (plus the `## Intent`)
2. Does its work
3. Appends its stage section: `## <Stage> — <agent names>`
4. Appends a `### → Handoff to <next stage> (next agents: ...)` block
5. Updates frontmatter: `agents:` (next active set), `status:` (next stage), `updated:` (today)
6. Commits everything to `card/<slug>` in one commit and pushes

The dispatcher reads frontmatter to know what stage the card is at. The handoff sections are for the next agent, not for the dispatcher.

## Card location rule (critical)

- Active cards live **only** in their worktree: `.claude/worktrees/card-<slug>/cards/<slug>.md`. The base branch has no copy.
- The card is born in the worktree at the first commit (by `/board-add`) and only lands on the base branch via the PR merge — at which point the dispatcher immediately moves it to `cards/done/<YYYY>/<slug>.md`.
- Cross-device sync: `board-sync.sh` (sourced by `/board-tick` Phase 1, or run as cron on the passive device) fetches `origin/card/*` and creates local worktrees for any branches that don't have one yet. Each device independently maintains its own set of worktrees from the same git refs.
- The dispatcher (`/board-tick`) reads cards by listing `.claude/worktrees/card-*/cards/*.md`. **It does not read `cards/<slug>.md` on the base branch** — that file doesn't exist for active cards anymore.

Practical lookup for an in-progress card:

```bash
slug="<slug>"
card=".claude/worktrees/card-$slug/cards/$slug.md"
[ -f "$card" ] && echo "active: $card" || echo "not active locally"

# Terminal cards on the base branch:
find cards/done -name "$slug.md" 2>/dev/null
find cards/abandoned -name "$slug.md" 2>/dev/null
```

## Per-stage agent assignment

Default agent sets by stage (the previous stage's agent sets the next stage's `agents:`):

| Stage | Default agents | Notes |
|---|---|---|
| backlog | (none) | Awaiting dispatcher |
| discovery | `solutions-architect`, `product-owner` | Add `product-marketer` for product-facing features. Add `devops-engineer` for infra |
| stand-by | (none — idle until next tick) | |
| in-dev | `expert-developer`, `qa-developer` | TDD-paired (see `adversarial-testing` skill); replaces `expert-developer` with `devops-engineer` for infra cards |
| review | `code-quality-guardian` | Add `style-quality-guardian` if any UI/CSS/HTML changed |
| distilling | `solutions-architect` | Runs IN the worktree on the card branch; pushes to the same PR |
| pr-ready | (none — awaiting founder) | Founder-notification stage; each tick re-checks base-branch freshness, bouncing back to `stand-by` on conflict (routing spawns dev next tick) |
| done | (none — terminal) | Set by dispatcher on PR-merge detection |

Agents can override the next stage's set in their handoff if the card needs different roles.

## Operations

### Tick (the dispatcher)

`/board-tick` is a **thin wrapper**: it spawns a fresh sub-agent via the `Agent` tool that runs the dispatcher algorithm in isolated context. The full algorithm lives in `.claude/commands/board-tick.md` (passed verbatim to the sub-agent).

The dispatcher's four phases (per tick):

1. **Reconcile** — runs `bash .claude/scripts/board-sync.sh`: fetches origin, ff-pulls the base branch, creates worktrees for any new `origin/card/*` branches, ff-pulls each existing worktree, and tears down worktrees whose upstream is gone AND whose card has already settled into `cards/done/` or `cards/abandoned/`.
2. **Inventory** — scans `.claude/worktrees/card-*/cards/<slug>.md` and reads frontmatter.
3. **Dispatch** — advances stages: backlog → discovery, stage agents on completed handoffs, etc.
4. **Merge detection** — for `pr-ready` cards, `gh pr view --json state`. If `MERGED`, move the card from `cards/<slug>.md` (now on the base branch from the merge) to `cards/done/<YYYY>/<slug>.md`, edit frontmatter, commit on base, push, tear down worktree + branches.

**Recommended ambient mode: `/loop /board-tick` (no interval — self-paced).** The dispatcher picks the next-wakeup delay based on board state. Run in a dedicated dispatcher terminal.

**Convention: only one device runs `/board-tick` at a time.** The other device(s) keep Obsidian fresh by running `bash .claude/scripts/board-sync.sh` as a cron job. The cron-script never spawns agents — it's pure git reconciliation.

Tick output is appended to `.claude/board-state.md` (gitignored). `tail -f .claude/board-state.md` for ambient visibility.

WIP is **per agent class**, not global. The dispatcher won't spawn a second card for the same agent class if one is already active.

### Cross-device sync

Each device runs its own copy of `board-sync.sh`. Branches and the base-branch state are the single source of truth — worktrees are per-device working copies that the script reconciles to whatever `origin/card/*` currently says.

Phone cron line (Termux Debian):

```
*/5 * * * * cd /path/to/repo && bash .claude/scripts/board-sync.sh >> .claude/sync.log 2>&1
```

Adding a card from one device (`/board-add`) pushes `card/<slug>` to origin. The other device's next sync run creates a local worktree for it and the card appears in that device's `INDEX.base` view.

### Pick up a single card (manual)

When the user names a card or asks "work the board":

1. Find the worktree: `.claude/worktrees/card-<slug>/`. If missing, run `bash .claude/scripts/board-sync.sh` to reconcile.
2. Read frontmatter from `<worktree>/cards/<slug>.md`. The `agents:` list is who should be spawned next.
3. Read `## Intent` + the latest `### → Handoff to <this stage>` block.
4. Spawn the agent(s) via the `Agent` tool with `subagent_type: <name>`. Pass:
   - Path to the card file (inside the worktree)
   - The intent + handoff block
   - The skill chain implied by `work_type`

### Skill chain by work_type

| work_type | Discovery skills | Dev skills | Review skills |
|---|---|---|---|
| `feature` | `brainstorming` | `test-driven-development`, `adversarial-testing`, `live-verification` | `code-quality-guardian` (+ `style-quality-guardian` if UI) |
| `refactor` | `brainstorming` | `test-driven-development`, `adversarial-testing`, `live-verification` | `code-quality-guardian` |
| `bug` | `root-cause-analysis` | `test-driven-development`, `adversarial-testing` | `code-quality-guardian` |
| `chore` | (skip discovery if scope is clear) | — | `code-quality-guardian` light review |
| `docs` | (skip discovery if scope is clear) | — | (none — just merge) |

### Add a card (founder)

`/board-add <work_type> <title>` — invokes `card-intake` for refinement (duplicate probe, title sharpening, work_type challenge, Intent framing, split check, priority confirmation), then atomically creates the `card/<slug>` branch + worktree, writes the card file inside the worktree, and pushes. The base branch is never touched.

See [`.claude/skills/card-intake/SKILL.md`](../card-intake/SKILL.md) and [`.claude/commands/board-add.md`](../../commands/board-add.md).

### Close / abandon (founder)

`/board-close <slug>` — see `.claude/commands/board-close.md`. Copies the card body from the worktree to `cards/abandoned/<YYYY>/<slug>.md` on the base branch, edits frontmatter to `status: abandoned`, commits + pushes the base, closes the PR (if any), tears down the worktree, deletes local + remote branches.

## Hard rules

1. **One PR per card.** Review ↺ In Dev ping-pong adds commits to the same branch and same PR. Distillation adds to the same branch and same PR.
2. **The card file lives in the worktree from creation through pr-ready.** It only lands on the base branch via the PR merge, at which point the dispatcher immediately moves it to `cards/done/<YYYY>/`.
3. **No founder gate before PR merge.** Backlog auto-promotes when the dispatcher picks it up. Discovery auto-promotes. Stand By auto-promotes. Review PASS auto-promotes to distilling. Distillation auto-promotes to pr-ready. The founder reviews and merges the PR; that's the only checkpoint.
4. **No direct writes to `base_branch` except `cards/**` and `.claude/**`.** The `edit-branch-guard` hook is the enforcement. `/board-add` doesn't touch the base; only the dispatcher's done-move and `/board-close`'s abandon-move write `cards/done/` or `cards/abandoned/` on base.
5. **Knowledge capture is a stage, not a gate.** See [`.claude/skills/distillation/SKILL.md`](../distillation/SKILL.md).
6. **Card files are read from the worktree** for active cards, and from `cards/done/<YYYY>/` or `cards/abandoned/<YYYY>/` for terminal cards. Reading `cards/<slug>.md` on the base branch is a bug — that path is only used as a transient location between PR merge and the dispatcher's done-move.
7. **Only one device runs `/board-tick` at a time.** Convention, not enforcement. Other devices run `board-sync.sh` via cron for read-only sync.
