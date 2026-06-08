#!/bin/bash
# Kanban board sync — reconcile local git worktrees with remote card/* branches.
#
# Pure git: no Claude invocation, no interactive prompts. Safe in cron.
# Sourced by /board-tick Phase 1; runs standalone as the phone-side cron job.
#
# Phases:
#   A) git fetch --prune; ff-pull the base branch (so cards/done/ updates land)
#   B) Create local worktrees for new origin/card/* branches
#   C) ff-pull each existing worktree (skip if dirty or upstream gone)
#   D) Teardown worktrees whose upstream branch is gone AND whose card has
#      settled into cards/done/ or cards/abandoned/ on the base branch
#
# Teardown is conservative: a worktree whose upstream is gone but whose card
# has not yet been moved to done/abandoned is left in place — the dispatcher
# (/board-tick) is responsible for that move, after which the next sync run
# tears the worktree down.
#
# Phone cron line (Termux Debian):
#   */5 * * * * cd /path/to/repo && bash .claude/scripts/board-sync.sh >> .claude/sync.log 2>&1

set -uo pipefail

REPO_DIR=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$REPO_DIR" ] && { echo "[sync] not in a git repo"; exit 1; }
cd "$REPO_DIR" || exit 1

WT_ROOT=".claude/worktrees"
mkdir -p "$WT_ROOT"

log() { printf '[sync] %s\n' "$*"; }

# --- Agent-memory base symlink -----------------------------------------------
# Mirror of the cards/<slug>.md symlink, but with ONE crucial difference: there
# is a SINGLE base slot `.claude/agent-memory` (a whole directory), not one link
# per card. Agent memory is per-AGENT and project-scoped — it accumulates across
# many cards (every agent subdir at once) — so a per-card link makes no sense; we
# surface the whole agent-memory dir of one active worktree.
#
# WHY a single slot is correct (and why writes never depend on it): each agent
# runs INSIDE its own worktree session, and the Claude Code platform injects that
# worktree's own ABSOLUTE memory path — so memory WRITES always land in the right
# worktree regardless of this link. The link exists purely so a reader (Obsidian)
# opening the BASE checkout can see *an* active card's memory. With 2+ concurrent
# worktrees only one can occupy the slot: we use FIRST-WINS (whoever populated the
# slot keeps it until torn down) — stable, and since it's a visibility nicety not
# a correctness lever, "which card" is immaterial.
#
# Only ever link when the worktree actually has an agent-memory dir AND nothing
# already occupies the base slot (a real dir shadowing it, or another worktree's
# still-valid link — first-wins). [ ! -e ] is false for both a real dir and a
# live symlink, and true for a dangling symlink (cleaned up separately in Phase E).
agent_memory_link() {
  # $wt may arrive with a trailing slash (Phase E glob) or without (Phase B
  # concat); ${wt%/} canonicalizes both so the link text matches the teardown
  # comparison in Phase D byte-for-byte.
  local wt="${1%/}" slug="$2"
  local target_dir="$wt/.claude/agent-memory"
  local link_path=".claude/agent-memory"
  # Link text is resolved relative to the link's own dir (.claude/), so strip the
  # leading ".claude/" from $wt: ".claude/worktrees/card-x" -> "worktrees/card-x".
  local link_text="${wt#.claude/}/.claude/agent-memory"
  if [ -d "$target_dir" ] && [ ! -e "$link_path" ]; then
    ln -s "$link_text" "$link_path" 2>/dev/null && log "$slug: agent-memory symlink created"
  fi
}

# --- Phase A: fetch + ff-pull base branch ---
git fetch --prune origin >/dev/null 2>&1 || { log "fetch failed"; exit 1; }

BASE=$(git branch --show-current 2>/dev/null)
if [ -n "$BASE" ] && git show-ref --verify --quiet "refs/remotes/origin/$BASE"; then
  if git diff --quiet HEAD && git diff --cached --quiet; then
    git pull --ff-only origin "$BASE" >/dev/null 2>&1 || log "$BASE: pull non-ff (skipped)"
  else
    log "$BASE: dirty working tree (skipped pull)"
  fi
fi

# --- Phase B: create worktrees for new remote card branches ---
for ref in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin/card/ 2>/dev/null); do
  branch="${ref#origin/}"
  slug="${branch#card/}"
  wt="$WT_ROOT/card-$slug"
  [ -d "$wt" ] && continue

  if ! git show-ref --verify --quiet "refs/heads/$branch"; then
    git branch --track "$branch" "$ref" >/dev/null 2>&1 || { log "$slug: cannot track $ref"; continue; }
  fi

  if git worktree add "$wt" "$branch" >/dev/null 2>&1; then
    log "$slug: worktree created from $ref"

    # Create Obsidian symlink (cards/<slug>.md → worktree card file)
    card_file="$wt/cards/$slug.md"
    link_path="cards/$slug.md"
    if [ -f "$card_file" ] && [ ! -e "$link_path" ]; then
      ln -s "../$card_file" "$link_path" 2>/dev/null && log "$slug: symlink created"
    fi

    # Create the agent-memory symlink (.claude/agent-memory → this worktree's copy).
    # See agent_memory_link()'s header for the single-base-slot rationale.
    agent_memory_link "$wt" "$slug"

    # Sync env files (best-effort, mirrors worktree-ops Step 4a)
    find . -maxdepth 4 -type f \
      \( -name '.env' -o -name '.env.*' -o -name '.envrc' \) \
      -not -path '*/.claude/worktrees/*' \
      -not -path '*/node_modules/*' \
      -not -path '*/.git/*' \
      -not -path '*/.venv/*' \
      -not -path '*/vendor/*' \
      2>/dev/null | while read -r src; do
        rel="${src#./}"
        dest="$wt/$rel"
        [ -e "$dest" ] && continue
        mkdir -p "$(dirname "$dest")"
        cp "$src" "$dest" 2>/dev/null
    done
  else
    log "$slug: worktree add failed"
  fi
done

# --- Phase C: ff-pull existing worktrees ---
for wt in "$WT_ROOT"/card-*/; do
  [ -d "$wt" ] || continue
  branch=$(git -C "$wt" branch --show-current 2>/dev/null)
  [ -z "$branch" ] && continue
  slug="${branch#card/}"

  if ! git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    continue  # upstream gone — handled in Phase D
  fi

  if git -C "$wt" diff --quiet HEAD && git -C "$wt" diff --cached --quiet; then
    git -C "$wt" pull --ff-only origin "$branch" >/dev/null 2>&1 \
      || log "$slug: pull non-ff (manual resolve needed)"
  else
    log "$slug: dirty (skipped pull)"
  fi
done

# --- Phase D: teardown worktrees whose upstream is gone and card has settled ---
for wt in "$WT_ROOT"/card-*/; do
  [ -d "$wt" ] || continue
  branch=$(git -C "$wt" branch --show-current 2>/dev/null)
  [ -z "$branch" ] && continue
  slug="${branch#card/}"

  git show-ref --verify --quiet "refs/remotes/origin/$branch" && continue

  settled=0
  [ -d cards/done ] && find cards/done -name "$slug.md" 2>/dev/null | grep -q . && settled=1
  [ -d cards/abandoned ] && find cards/abandoned -name "$slug.md" 2>/dev/null | grep -q . && settled=1

  if [ "$settled" -eq 1 ]; then
    # Remove Obsidian symlink before teardown
    [ -L "cards/$slug.md" ] && rm -f "cards/$slug.md"
    # Remove the agent-memory slot ONLY if it points at THIS worktree (a single
    # base slot may belong to a different, still-active worktree — don't orphan
    # its Obsidian view). Dangling links from a vanished target are swept in
    # Phase E. Compare the stored link text against this worktree's expected text.
    wt_canon="${wt%/}"
    if [ -L ".claude/agent-memory" ] && \
       [ "$(readlink ".claude/agent-memory")" = "${wt_canon#.claude/}/.claude/agent-memory" ]; then
      rm -f ".claude/agent-memory" && log "$slug: agent-memory symlink removed"
    fi
    git worktree remove "$wt" --force >/dev/null 2>&1 || rm -rf "$wt"
    git branch -D "$branch" >/dev/null 2>&1 || true
    log "$slug: torn down (settled)"
  else
    log "$slug: upstream gone but not in done/abandoned — awaiting dispatcher"
  fi
done

# --- Phase E: reconcile Obsidian symlinks ---
# Create missing symlinks for existing worktrees; remove dangling ones.
for wt in "$WT_ROOT"/card-*/; do
  [ -d "$wt" ] || continue
  branch=$(git -C "$wt" branch --show-current 2>/dev/null)
  [ -z "$branch" ] && continue
  slug="${branch#card/}"
  card_file="$wt/cards/$slug.md"
  link_path="cards/$slug.md"
  if [ -f "$card_file" ] && [ ! -e "$link_path" ]; then
    ln -s "../$card_file" "$link_path" 2>/dev/null && log "$slug: symlink created (reconcile)"
  fi

  # Reconcile the single agent-memory slot: first active worktree with a memory
  # dir claims it (first-wins — agent_memory_link no-ops once the slot is taken).
  agent_memory_link "$wt" "$slug"
done
# Remove dangling symlinks in cards/
for link in cards/*.md; do
  [ -L "$link" ] && [ ! -e "$link" ] && rm -f "$link" && log "$(basename "$link" .md): dangling symlink removed"
done
# Remove a dangling agent-memory slot (its worktree vanished out from under it).
# -L && ! -e = symlink whose target no longer resolves; a live link or real dir
# is left untouched. This prevents a stale link from shadowing a non-worktree
# agent session's reads on base.
if [ -L ".claude/agent-memory" ] && [ ! -e ".claude/agent-memory" ]; then
  rm -f ".claude/agent-memory" && log "agent-memory: dangling symlink removed"
fi

exit 0
