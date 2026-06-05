#!/bin/bash
# PreToolUse hook for Bash: protect main/master/dev from
#   - direct pushes (incl. refspec form HEAD:main), UNLESS every commit being
#     pushed only touches allowlisted paths (cards/**, .claude/**, .obsidian/**,
#     top-level signposts, .config/**). This is the same allowlist that
#     pre-commit-guard.sh applies to staged files — kept in sync intentionally,
#     so merge-back commits (dispatcher done-move, /board-close abandon-move,
#     meta edits) can flow without manual founder pushes.
#   - branch deletes (--delete, -d, :main old-syntax)
#   - destructive force-pushes (--force, -f) — --force-with-lease is allowed (safe form)
# Card branches (card/<slug>) are free to push, delete, and force-with-lease.
read -r cmd

# 1. Block destructive force-push (applies everywhere, not just protected branches).
if echo "$cmd" | grep -Eq 'git push[^|;&]*(--force[^-]|--force$| -f( +|$))'; then
  echo 'BLOCKED: Destructive --force/-f push not allowed' >&2
  echo '  Use --force-with-lease for safe force-push on card/<slug>.' >&2
  exit 2
fi

# 2. If push doesn't target a protected branch, pass through.
#    The regex is word-boundary anchored via space/colon/end after the branch name, so
#    card/main-page-redesign and card/dev-thing pass through cleanly.
if ! echo "$cmd" | grep -Eq 'git push[^|;&]*( +|:)(main|master|dev)( +|:|$)'; then
  exit 0
fi

# 3. Identify which protected branch is being targeted (first match wins).
target=''
for b in dev main master; do
  if echo "$cmd" | grep -Eq "( +|:)$b( +|:|$)"; then
    target="$b"; break
  fi
done

# 4. Branch deletes on protected branches are never allowed (no content allowlist).
if echo "$cmd" | grep -Eq '(^|[[:space:]])(--delete|-d)([[:space:]]|$)' \
   || echo "$cmd" | grep -Eq "git push[^|;&]*[[:space:]]:$target([[:space:]]|:|$)"; then
  {
    echo "BLOCKED: deleting protected branch ($target) not allowed"
    echo '  --delete/-d and the :branch refspec form are both rejected.'
  } >&2
  exit 2
fi

# 5. Inspect commits that would be pushed against the path allowlist.
#    Worktrees share refs with the main checkout, so the named ref `$target`
#    resolves to the same commit regardless of where the push was invoked.
#    Using $CLAUDE_PROJECT_DIR keeps us pinned to the canonical repo dir.
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || {
  echo "BLOCKED: cannot enter \$CLAUDE_PROJECT_DIR ($CLAUDE_PROJECT_DIR)" >&2
  exit 2
}

if ! git rev-parse --verify "refs/heads/$target" >/dev/null 2>&1; then
  echo "BLOCKED: local '$target' branch not found; cannot verify push contents" >&2
  exit 2
fi

if ! git rev-parse --verify "refs/remotes/origin/$target" >/dev/null 2>&1; then
  {
    echo "BLOCKED: origin/$target not found locally; cannot verify push contents"
    echo "  Run 'git fetch origin' first so the hook can compare commits."
  } >&2
  exit 2
fi

changed=$(git diff --name-only "origin/$target..$target" 2>/dev/null)
if [ -z "$changed" ]; then
  # No commits ahead of origin — let git handle the no-op push.
  exit 0
fi

# Allowlist mirrors pre-commit-guard.sh:47-54. Keep them in lockstep.
non_allowed=''
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    cards/*) ;;
    .claude/*) ;;
    .obsidian/*) ;;
    CLAUDE.md|README.md|BOARD.md|INDEX.base|.gitignore) ;;
    .config/*) ;;
    *) non_allowed="$non_allowed$f"$'\n' ;;
  esac
done <<< "$changed"

if [ -n "$non_allowed" ]; then
  {
    echo ''
    echo "BLOCKED: git push targeting protected branch ($target) not allowed"
    echo '  Commits being pushed touch non-allowlisted paths:'
    printf '%s' "$non_allowed" | sed 's/^/    /'
    echo '  Allowlist (mirrors pre-commit-guard): cards/**, .claude/**, .obsidian/**, CLAUDE.md, README.md, BOARD.md, INDEX.base, .gitignore, .config/**'
    echo '  Push or merge a card/<slug> branch instead.'
    echo ''
  } >&2
  exit 2
fi

# Every changed path is allowlisted — merge-back / meta push is safe.
exit 0
