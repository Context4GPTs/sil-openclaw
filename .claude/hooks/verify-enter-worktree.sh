#!/bin/bash
# PostToolUse hook for EnterWorktree.
#
# EnterWorktree occasionally creates a worktree whose HEAD is origin/main
# instead of the branch the user was on. The main repo's HEAD is untouched
# by EnterWorktree, so we can read it post-hoc and compare.
#
# Exits 2 on mismatch so the agent gets stderr feedback and does not
# proceed with work on the wrong base.

set -u

INPUT=$(cat)

# Re-entering an existing worktree (path:) has no base to verify
PATH_ARG=$(echo "$INPUT" | jq -r '.tool_input.path // ""' 2>/dev/null)
[ -n "$PATH_ARG" ] && exit 0

GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || exit 0
COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
GIT_DIR_ABS=$(cd "$GIT_DIR" 2>/dev/null && pwd -P) || exit 0
COMMON_DIR_ABS=$(cd "$COMMON_DIR" 2>/dev/null && pwd -P) || exit 0

# Equal paths mean we are not in a worktree — the tool likely failed
[ "$GIT_DIR_ABS" = "$COMMON_DIR_ABS" ] && exit 0

MAIN=$(dirname "$COMMON_DIR_ABS")
[ -d "$MAIN" ] || exit 0

EXPECTED_BRANCH=$(git -C "$MAIN" branch --show-current 2>/dev/null)
EXPECTED_HEAD=$(git -C "$MAIN" rev-parse HEAD 2>/dev/null)
[ -z "$EXPECTED_HEAD" ] && exit 0

CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$CURRENT_HEAD" ] && exit 0

if [ "$CURRENT_HEAD" != "$EXPECTED_HEAD" ]; then
  BRANCH_LABEL="${EXPECTED_BRANCH:-(detached HEAD)}"
  {
    echo ""
    echo "WORKTREE BASE MISMATCH"
    echo "  Expected base: $BRANCH_LABEL (${EXPECTED_HEAD:0:7})"
    echo "  Worktree HEAD: ${CURRENT_HEAD:0:7} on branch '$CURRENT_BRANCH'"
    echo ""
    echo "  EnterWorktree created the worktree from the wrong commit."
    echo "  Commits here will diverge from '$BRANCH_LABEL'."
    echo ""
    echo "  Fix (inside the worktree):"
    echo "    git reset --hard $EXPECTED_HEAD"
    [ -n "$EXPECTED_BRANCH" ] && \
      echo "    # matches tip of '$EXPECTED_BRANCH' in the main repo"
    echo ""
  } >&2
  exit 2
fi

exit 0
