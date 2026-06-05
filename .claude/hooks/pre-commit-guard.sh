#!/bin/bash
# PreToolUse hook: block dev commits to protected branches; allow card/meta commits.
#
# Protected branches: main, master, dev.
# Allowed on protected branches:
#   - all staged files match the allowlist (cards/, .claude/, top-level signposts)
#
# Anything else is BLOCKED — make a feature branch via worktree-ops first.
# Distillation no longer needs a bypass: it runs in the worktree on card/<slug>.

CMD=$(cat)

# Trigger on `git commit` only, not `git commit-tree` / `git commit-graph` / etc.
if ! echo "$CMD" | grep -Eq '(^|&&|;)\s*git commit($|[[:space:]])'; then
    exit 0
fi

# Resolve target dir if commit is in a subshell ('cd X && git commit').
# Support quoted paths (single and double) and unquoted paths without spaces.
target_dir=$(echo "$CMD" | sed -nE "s/^cd[[:space:]]+'([^']+)'.*/\1/p" | head -1)
[ -z "$target_dir" ] && target_dir=$(echo "$CMD" | sed -nE 's/^cd[[:space:]]+"([^"]+)".*/\1/p' | head -1)
[ -z "$target_dir" ] && target_dir=$(echo "$CMD" | sed -nE 's/^cd[[:space:]]+([^[:space:];&|"'"'"']+).*/\1/p' | head -1)

if [ -n "$target_dir" ] && [ -d "$target_dir" ]; then
    branch=$(git -C "$target_dir" branch --show-current 2>/dev/null)
    GIT=(git -C "$target_dir")
else
    branch=$(git branch --show-current 2>/dev/null)
    GIT=(git)
fi

if [ "$branch" != 'main' ] && [ "$branch" != 'master' ] && [ "$branch" != 'dev' ]; then
    exit 0
fi

# Staged-files allowlist check: if every staged path is meta/card, allow it
staged=$("${GIT[@]}" diff --cached --name-only 2>/dev/null)
empty_staged=0
if [ -z "$staged" ]; then
    # No staged files yet (e.g. `git commit -am`, which stages at commit time).
    # The hook fires before commit, so we can't see what -am will stage. Be strict: block.
    empty_staged=1
else
    only_allowed=1
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        case "$f" in
            cards/*) ;;
            .claude/*) ;;
            .obsidian/*) ;;
            CLAUDE.md|README.md|BOARD.md|INDEX.base|.gitignore) ;;
            .config/*) ;;
            *) only_allowed=0; break ;;
        esac
    done <<< "$staged"
    if [ "$only_allowed" = "1" ]; then
        exit 0
    fi
fi

echo '' >&2
echo "BLOCKED: Cannot commit dev work directly to '$branch'" >&2
if [ "$empty_staged" = "1" ]; then
    echo "  No files were staged when the hook fired." >&2
    echo "  If you used 'git commit -am' or '-a': the hook can't see what -a will stage," >&2
    echo "  so it blocks defensively. Stage explicitly first:" >&2
    echo "    git add <files>" >&2
    echo "    git commit -m '...'" >&2
else
    echo "  Use the worktree-ops skill to create a card/<slug> branch first." >&2
fi
echo "  Card-only and meta commits ARE allowed on protected branches — stage only those paths." >&2
echo "  Allowlist: cards/**, .claude/**, .obsidian/**, CLAUDE.md, README.md, BOARD.md, INDEX.base, .gitignore, .config/**" >&2
echo '' >&2
exit 2
