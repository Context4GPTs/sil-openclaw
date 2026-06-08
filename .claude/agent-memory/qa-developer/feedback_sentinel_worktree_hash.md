---
name: sentinel-worktree-hash
description: The test-guard sentinel must be keyed to the MAIN repo root path, not the worktree path, when working inside a git worktree
metadata:
  type: feedback
---

When running as qa-developer inside a git **worktree** (e.g. `.claude/worktrees/card-<slug>`), the `test-guard.sh` hook computes the sentinel hash from `git rev-parse --show-toplevel` run from **`$CLAUDE_PROJECT_DIR`** — which resolves to the **MAIN repo root**, not the worktree. So the sentinel file must be:

```
GIT_WORK_DIR="$(git rev-parse --show-toplevel)"   # run from MAIN repo root, NOT the worktree
HASH=$(echo "$GIT_WORK_DIR" | shasum | cut -c1-8)
touch "/tmp/.claude-qa-active-$HASH"
```

**Why:** My agent prompt told me to compute the hash from the worktree path. That produced hash `a8c963d1` (worktree) but the hook expected `8399426e` (main root) — every test-file Write was BLOCKED until I re-keyed it. The hook's cwd is the project dir (main root), and a worktree's `.git` is a file pointing back to the main repo, but `--show-toplevel` from the project dir returns the main root regardless.

**How to apply:** On start in a worktree, run `git rev-parse --show-toplevel` from the default Bash cwd (which is the main repo root, since the tool resets cwd between calls), hash THAT, and touch the sentinel. The sentinel has a 60-min TTL — `touch` it again before long edit/run sessions (I refreshed it before every Write/test batch). Both hashes' sentinels can coexist harmlessly; only the main-root one unblocks the hook.
