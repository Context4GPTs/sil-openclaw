#!/bin/bash
# PreToolUse hook for Edit|Write: protect protected branches from off-branch writes.
#
# Protected branches: main, master, dev (dev is the staging branch; main is the release target).
#
# Allowed on protected branches:
#   - cards/**                                            (kanban substrate — always)
#   - .claude/**                                          (meta-work: agents, hooks, skills, commands)
#   - .obsidian/**                                        (vault config: shared plugin set, view definitions)
#   - CLAUDE.md, README.md, BOARD.md, INDEX.base          (top-level repo signposts)
#   - .gitignore                                          (repo-level config)
#   - .config/**                                          (project config)
#
# Everything else is BLOCKED (exit 2) — must happen in a worktree.
# Distillation no longer needs a bypass: it runs in the worktree on card/<slug>.

read -r f
branch=$(git branch --show-current 2>/dev/null)

if [ "$branch" != 'main' ] && [ "$branch" != 'master' ] && [ "$branch" != 'dev' ]; then
  exit 0
fi

# Path-based allowlist
case "$f" in
  */cards/*|cards/*)              exit 0 ;;
  */.claude/*|.claude/*)          exit 0 ;;
  */.obsidian/*|.obsidian/*)      exit 0 ;;
  */CLAUDE.md|CLAUDE.md)          exit 0 ;;
  */README.md|README.md)          exit 0 ;;
  */BOARD.md|BOARD.md)            exit 0 ;;
  */INDEX.base|INDEX.base)        exit 0 ;;
  */.gitignore|.gitignore)        exit 0 ;;
  */.config/*|.config/*)          exit 0 ;;
esac

{
  echo ''
  echo "BLOCKED: Edits to $f on '$branch' require a worktree."
  echo "  Use the worktree-ops skill to create card/<slug> first."
  echo "  Authorized exceptions: cards/**, .claude/**, .obsidian/**, CLAUDE.md, README.md, BOARD.md, INDEX.base, .gitignore, .config/**"
  echo ''
} >&2
exit 2
