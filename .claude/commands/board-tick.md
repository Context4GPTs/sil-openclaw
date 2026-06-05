---
description: "Advance the kanban board by one tick. Top-level Claude runs the algorithm directly: Phase 1 syncs worktrees with origin, Phase 2 routes each card based on its status, Phase 3 logs and reschedules. Optional <slug> argument scopes the tick to one card."
---

# Board tick

Cards live in worktrees. Each card has a status. Each status maps to an action. A tick:

1. Syncs local state with origin.
2. For each card in scope, applies the action for its status.
3. Logs the result and (under `/loop`) schedules the next wakeup.

Top-level Claude IS the orchestrator — it calls `Agent` directly to spawn specialists, reads card frontmatter, runs the sync script, writes the tick log. The state machine is a routing map, not a contract. Agents own status transitions within their stage (including backward ones, like `review → stand-by` on FAIL). The orchestrator owns transitions driven by external observation — merge detection (`pr-ready → done`) and base-drift detection (`pr-ready → stand-by`). Both backward bounces land on `stand-by` so the existing `stand-by → spawn dev pair` routing autonomously picks them up next tick — no founder-in-the-loop ever required.

## Usage

```
/board-tick              # whole board
/board-tick <slug>       # operate only on card/<slug>
```

The recommended ambient driver is `/loop /board-tick`. The tick self-paces by emitting `NEXT_WAKEUP: <seconds>` as the last line of stdout, which `/loop` reads to schedule the next invocation. Only one device runs `/board-tick` at a time; the phone keeps Obsidian fresh via the cron line in `.claude/scripts/board-sync.sh`.

## Operating principles

These constrain how every step executes:

1. **Fully autonomous.** Never `AskUserQuestion`. Never ask for clarification. Decide and continue.
2. **Failure is information, not a halt.** Log the failure, do nothing else for that card, continue with the next. Spawn raises → leave frontmatter unchanged. Agent declines → log and skip. Push-guard rejects → log the rejected paths and continue.
3. **Frontmatter follows action.** Spawn (or other state-mutating action) first; edit `status:` and `agents:` only after the action succeeded. This prevents phantom in-flight states where frontmatter claims agents are running but the spawn failed.
4. **Agents own their stage.** In-stage status transitions — forward and backward — are agent decisions. The orchestrator never enforces timers or polices agents, but does flip status on observable external events (PR merged → `done`, base drifted → `stand-by`).
5. **Call `Agent` directly.** No `SPAWN_REQUEST` strings emitted to an outer wrapper. No delegating to a `general-purpose` sub-agent to spawn specialists. Top-level Claude has the tool; use it.

## Phase 1 — Sync

```bash
bash .claude/scripts/board-sync.sh
```

Fetches origin, ff-pulls the base branch, creates worktrees for new remote `card/*` branches, ff-pulls existing worktrees, tears down worktrees whose upstream is gone AND whose card has settled into `cards/done/` or `cards/abandoned/`. Any `[sync]` warnings go into the tick report verbatim. Non-zero exit is non-fatal — work with local state and surface `SYNC <slug>: <warning>`.

## Phase 2 — Route each card

For each `.claude/worktrees/card-*/`:

- Read `<worktree>/cards/<slug>.md`. Parse frontmatter: `status`, `agents`, `priority`, `base_branch`, `pr`, `updated`.
- If `SCOPE` is non-empty and the slug doesn't match, skip.
- Track per-agent-class WIP across ALL active worktrees (even in scoped mode — a scoped tick must not over-subscribe an agent busy elsewhere).
- **Merge short-circuit (stage-independent):** if the frontmatter has `pr:` set, run **Check merge** (below) *before* routing on status. A PR can merge while the card is still at `review` or `distilling`, not only at `pr-ready` — detecting it only at `pr-ready` strands the card and spawns an agent on already-merged work (e.g. a distillation commit pushed to an already-merged branch goes nowhere). If Check merge finds `state == MERGED`, it runs the merge-back path and tears the card down — skip the status action entirely. If not merged (or the `gh` call fails — log and continue per principle 2), fall through to the status action.
- Apply the action for the card's status.

### Routing table

| Status | Action |
|---|---|
| `backlog` | If discovery WIP available → **Spawn discovery** (below). |
| `discovery` | No-op (agents working). |
| `stand-by` | If dev pair WIP available → spawn `expert-developer` + `qa-developer` (or `devops-engineer` + `qa-developer` for infra cards). They flip status to `in-dev` when they begin. |
| `in-dev` | No-op (agents working). |
| `review` | If no quality agent active globally → spawn `code-quality-guardian` (and `style-quality-guardian` if the diff touches UI/CSS/HTML). |
| `distilling` | If `solutions-architect` WIP available → spawn it with the `distillation` skill. The agent commits + pushes + flips status to `pr-ready`. |
| `pr-ready` | Merge is detected by the stage-independent short-circuit above; if the card is still `pr-ready` (not merged), **check freshness** (below) and emit `PR_READY card/<slug>` so notifications fire each tick the card sits unmerged. |
| `done`, `abandoned` | No-op (terminal). |

If a card's status is missing or in an unexpected combination with other fields (e.g., `pr:` set but `status: in-dev`), emit `NOTE card/<slug> <observation>` and skip. Do not auto-mutate.

### Spawn discovery

1. Choose the agent set:
   - Always: `solutions-architect`, `product-owner`
   - Add `devops-engineer` if `work_type: infra` or the card body mentions infrastructure
   - Add `product-marketer` if the card is product-facing (landing, onboarding, marketing copy, naming)
2. Spawn all chosen agents in parallel via `Agent` (single message, multiple tool calls). Each prompt points to `<worktree>/cards/<slug>.md`.
3. If any spawn raises, emit `ERROR dispatch_failed: <reason>` and do nothing else for this card. Frontmatter stays at `backlog`. Next tick retries.
4. Inside the worktree, edit `cards/<slug>.md` frontmatter:
   ```yaml
   status: discovery
   agents: [<the agents you spawned>]
   updated: <today>
   ```
5. **Tracked mode only:** `git add cards/<slug>.md && git commit -m "card/<slug>: → discovery"`. In gitignored mode (`git check-ignore -q cards/<slug>.md` is true) the step-4 frontmatter flip stays a local-only edit — skip the commit.
6. **Tracked mode only:** `git push origin card/<slug>`. In gitignored mode there is nothing to push yet — the `card/<slug>` origin ref is created when the first implementation commit lands in-dev.

### Check merge

Invoked by the **stage-independent merge short-circuit** (Phase 2) for **any** card with `pr:` set — `review`, `distilling`, or `pr-ready` — not just `pr-ready` cards.

```bash
gh pr view "$pr_url" --json state,mergeCommit
```

If `state == MERGED`:

1. Capture `mergeCommit.oid` as `MERGE_SHA`.
2. Archive the card body into `cards/done/<YYYY>/<slug>.md` on the base checkout. **The source depends on repo mode** — run `git check-ignore -q "cards/<slug>.md"`:
   - **Tracked mode (default):** the PR merge brought the card onto the base branch; Phase 1's `git pull --ff-only` already pulled it to `cards/<slug>.md`. Move it: `mkdir -p cards/done/<YYYY> && git mv cards/<slug>.md cards/done/<YYYY>/<slug>.md`.
   - **Gitignored mode (public repos):** the PR never carried the card. Copy the living card from the worktree instead: `mkdir -p cards/done/<YYYY> && cp "$wt/cards/<slug>.md" cards/done/<YYYY>/<slug>.md`. Since `cards/` is git-ignored on base, this is an untracked local archive.
3. Edit the archived file's frontmatter: `status: done`, `merged_commit: <MERGE_SHA>`, `agents: []`, `updated: <today>`.
4. **Land the archive — tracked mode only.** If `git check-ignore -q cards/done/<YYYY>/<slug>.md` is false: `git add cards/done/<YYYY>/<slug>.md && git commit -m "done: card/<slug>"`, then `git push origin <base_branch>` (the push-guard allows it: every changed path is in the meta allowlist — `cards/**`, `.claude/**`, `.obsidian/**`, top-level signposts, `.config/**`; a merge-back commit touching only `cards/done/<YYYY>/<slug>.md` sails through; on rejection log the rejected paths and continue per principle 2). If it's true (gitignored mode): **skip the commit + push** — the archive is local-only and nothing lands on the base branch.
5. Tear down:
   ```bash
   git worktree remove "$wt" --force
   git branch -D card/<slug>
   git push origin --delete card/<slug> || true   # GitHub may have auto-deleted
   ```
6. Emit `card/<slug> <status>→done (merge <sha>, worktree torn down)`, where `<status>` is the stage the card was at when the merge was detected (`pr-ready` in the common case; `review` or `distilling` when the short-circuit catches an early merge).

If `state != MERGED`, no-op — return to the card's status action: for a `pr-ready` card that's **Check freshness** plus the `PR_READY` emit; for `review`/`distilling` it's the normal stage routing.

### Check freshness

A `pr-ready` card must stay cleanly mergeable into its `base_branch` (read from the card's frontmatter — could be `main`, `dev`, or whatever the card was cut from). When sibling PRs merge first, the base advances and a previously-clean card can develop conflicts before the founder gets to it. This step keeps `pr-ready` honest each tick.

**Outcomes (the orchestrator picks based on what it observes):**

- **Already in sync** with `origin/<base_branch>` → no-op. Emit `card/<slug> pr-ready: in sync`.
- **Drift, trivially reconcilable** (the base moved, no conflicting hunks) → bring the base changes into the card branch and push. Stay `pr-ready`. CI re-runs against the new tip — that re-validation is what catches semantic drift the textual reconcile can't see, so leaving CI broken is not a clean outcome. Emit `card/<slug> pr-ready: reconciled with <base_branch>`.
- **Drift, judgment required** (conflicting hunks, or any reconcile failure) → abort cleanly so the worktree is never half-applied. Append `### → Handoff back to In Dev (base drift)` to the card body, naming the conflicting files + hunks and what the base introduced. Flip frontmatter: `status: stand-by`, `agents: []`, `updated: <today>`. Commit + push the card update on `card/<slug>`. Same branch, same PR — the next tick's `stand-by` routing autonomously spawns the dev pair (subject to WIP), exactly as on a `review FAIL → stand-by` bounce. The developer arrives at `in-dev` briefed by the latest `### → Handoff back to In Dev` block. Emit `card/<slug> pr-ready→stand-by (base drift)`.

How to reconcile (rebase vs merge, ff vs non-ff, which ref to compare against) is the orchestrator's call as long as one of the outcomes above is reached. Per principle 2: if the step fails for any reason not mapped here (network, push rejected, weird local state), log and continue — the card stays `pr-ready` and the next tick retries.

## Phase 3 — Log, notify, reschedule

### Stale check

For each non-terminal card with `(today - updated) > 7 days` and `status != backlog`: emit `STALE card/<slug>`. The founder decides what to do; the orchestrator does not auto-act.

### Append the report

```bash
STATE_FILE="$CLAUDE_PROJECT_DIR/.claude/board-state.md"
mkdir -p "$(dirname "$STATE_FILE")"
[ ! -f "$STATE_FILE" ] && printf "# Board State Log\n\nAppend-only tick log. Tail this for ambient visibility.\n\n" > "$STATE_FILE"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf "## %s\n\n%s\n\n---\n\n" "$TS" "$TICK_REPORT" >> "$STATE_FILE"
```

The file is gitignored. Tail it: `tail -f .claude/board-state.md`.

### Notify

```bash
notify() {
  local title="$1" message="$2"
  local m=${message//\\/\\\\}; m=${m//\"/\\\"}
  local t=${title//\\/\\\\}; t=${t//\"/\\\"}
  command -v osascript &>/dev/null && \
    osascript -e "display notification \"$m\" with title \"$t\"" 2>/dev/null
}

while IFS= read -r line; do
  case "$line" in
    "PR_READY "*)
      slug=$(echo "$line" | awk '{print $2}' | sed 's|card/||')
      notify "Kanban: PR ready" "$slug needs your review"
      ;;
    "STALE "*)
      slug=$(echo "$line" | awk '{print $2}' | sed 's|card/||')
      notify "Kanban: stale card" "$line"
      ;;
    "ERROR "*)
      notify "Kanban: dispatcher error" "$line"
      ;;
  esac
done <<< "$TICK_REPORT"
```

### Schedule next wakeup

If invoked from `/loop`, emit as the LAST line of stdout:

```
NEXT_WAKEUP: <seconds>
```

- `300` (5 min) — any transition happened or any agent is mid-stage
- `1800` (30 min) — agent-driven stages but nothing moved this tick
- `7200` (2 hr) — all non-terminal cards are in `pr-ready` (awaiting human merge)
- `7200` (2 hr) — zero non-terminal cards exist; the board is idle (NOT a stop condition)

The loop never self-terminates. An empty board is idle, not done — keep ticking so cards added later are picked up automatically. The only thing that stops an ambient `/loop /board-tick` is its cron's 7-day expiry, after which the founder re-arms it.

Omit when invoked manually.

## Report format

One line per card touched:

```
card/<slug> backlog→discovery (spawned: solutions-architect, product-owner)
card/<slug> review→distilling (spawned: solutions-architect)
card/<slug> distilling→pr-ready (distillation committed to branch)
card/<slug> pr-ready: in sync
card/<slug> pr-ready: reconciled with <base_branch>
card/<slug> pr-ready→stand-by (base drift)
card/<slug> pr-ready→done (merge <sha>, worktree torn down)
PR_READY card/<slug>
SKIP card/<slug> in-dev (expert-developer WIP saturated)
NOTE card/<slug> <observation>
STALE card/<slug> review (idle 9d)
SYNC <slug>: <warning>
ERROR dispatch_failed: <reason>
```

If nothing moved: `board-tick: no transitions`.

## WIP

Per-agent-class WIP defaults to 1 across the whole board. Override via env: `BOARD_WIP_<AGENT_NAME>=N`. Scoped mode still tracks whole-board WIP — a scoped tick cannot over-subscribe an agent busy on another card.

## Boundaries

- Do NOT call `gh pr merge`. Humans merge on GitHub.
- Do NOT call `git worktree add`. `/board-add` (creation) and `board-sync.sh` (reconciliation) own that path. The orchestrator only reads worktrees and tears them down post-merge.
- The card file lives in `<worktree>/cards/<slug>.md` for the entire active lifecycle. The base branch sees the card only after the PR merges (then it's moved into `cards/done/<YYYY>/`).
