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
done
# Remove dangling symlinks in cards/
for link in cards/*.md; do
  [ -L "$link" ] && [ ! -e "$link" ] && rm -f "$link" && log "$(basename "$link" .md): dangling symlink removed"
done

exit 0
