---
name: worktree-ops
description: "Worktree-resident card lifecycle + GitHub CLI operations. The worktree is created at card birth by /board-add; this skill covers what happens inside it — committing on the card branch, pushing, opening the PR. Use whenever an agent commits work inside a card/<slug> worktree, or when a non-card ad-hoc worktree is genuinely needed (rare)."
---

# Worktree Ops

In the worktree-resident card model, **the worktree is created at card birth** by `/board-add` — not by an agent later. The card file lives in `<worktree>/cards/<slug>.md` from the first commit. Discovery, dev, review, and distillation all run inside this same worktree on the same `card/<slug>` branch, accumulating handoff sections on the card body and pushing to one PR.

This skill covers two things:

1. **Inside the worktree**: committing, pushing, opening the PR.
2. **Ad-hoc worktrees** (rare): if you genuinely need a worktree outside the kanban flow, the legacy manual creation steps live here.

Agents are **blocked from running `gh pr merge`** — humans merge on GitHub.

---

## Part 1: Inside the card worktree (the common path)

The worktree, branch, base_branch, and env files all already exist when you arrive. Your job is to add your stage's contribution.

> **Gitignored-mode repos (public repos where `cards/` is git-ignored).** Run `git check-ignore -q "cards/$SLUG.md"` once at the start. If it reports ignored, **the card file is never committed, pushed, or PR'd** — it stays a local-only working document in the worktree. You still edit its frontmatter and append your handoff sections on disk (that's the living record), but you `git add` **only the real deliverables** (code, tests, files under `docs/**`). The `card/<slug>` branch and its PR therefore carry implementation only — never the card body. In tracked-mode repos (the default — most siblings) the card is staged alongside the work exactly as shown below. Treat every `git add cards/<slug>.md` step in this skill as a no-op when in gitignored mode.

### Before every commit: `git status` is mandatory

The `pre-commit-guard.sh` hook is permissive on `card/<slug>` branches. Still, stage explicitly — never `git add -A` blindly.

Stage:
- Code, tests, config the work actually changed
- The card file itself (`cards/<slug>.md`) — your stage section + updated frontmatter. **Gitignored mode: skip — the card edits stay uncommitted on disk; stage only the deliverables below.**
- Any docs touched for this card under `docs/decisions/`, `docs/knowledge/`, or `docs/product/` (plus the matching `INDEX.md` rows) — see the `distillation` skill

Exclude:
- Build outputs, coverage reports (`dist/`, `build/`, `coverage/`, `.next/`)
- Test artifacts (`.pytest_cache/`)
- Temp files, logs
- Env files (already gitignored)

### Commit message convention

```
card/<slug>: <stage> <short summary>
```

Examples:

```
card/rate-limit: discovery — research + acceptance criteria
card/rate-limit: in-dev — implement middleware with tests
card/rate-limit: review-fix — rate-limit key uses sha256 not md5
card/rate-limit: distill — capture caching decision in docs/decisions/
```

### Open the PR (in-dev → review transition only)

Open the PR when transitioning `in-dev → review`. The dispatcher does NOT open PRs; the expert-developer or qa-developer at the end of the in-dev stage does.

```bash
gh auth status   # confirm auth

# Push the branch (in gitignored mode board-add didn't push — this creates origin/card/$SLUG):
git push origin "card/$SLUG"

gh pr create \
  --base  "$BASE_BRANCH" \
  --title "<work_type>: <card title>" \
  --body  "$(cat <<EOF
## Card
\`cards/$SLUG.md\` (lives in the card/$SLUG branch — see the body for the full intent + handoffs).

## Summary
- <what changed and why>

## Test plan
- [ ] <tests run>

## Distillation target
Knowledge capture happens **after Review PASS** in the \`distilling\` stage — \`solutions-architect\` runs in this same worktree, commits to this same branch, and pushes here so the PR ends up containing implementation + tests + distillation in one mergeable unit.
EOF
)"

gh pr checks    # watch CI; investigate failures
```

Once the PR is open, write the URL back into the card frontmatter:

```bash
# Edit cards/$SLUG.md frontmatter (pr: <url>, updated: <today>) on disk.
# Tracked mode: commit + push the card update. Gitignored mode: it stays local (no-op).
if ! git check-ignore -q "cards/$SLUG.md"; then
  git add "cards/$SLUG.md"
  git commit -m "card/$SLUG: in-dev → review (PR opened)"
  git push origin "card/$SLUG"
fi
```

### After Review PASS (distilling)

Solutions-architect runs the `distillation` skill inside this same worktree on this same branch. Pushes more commits to the PR. Flips status to `pr-ready`.

### After PR merge

The dispatcher's next `/board-tick` detects the merge via `gh pr view --json state`, moves the card to `cards/done/<YYYY>/<slug>.md` on the base branch, and tears down the worktree + local branch. Manual cleanup is unnecessary.

### Common gh operations

```bash
gh pr list
gh pr view <num>
gh pr checks
gh pr comment <num> --body "..."

gh issue list --assignee @me
gh issue view <num>
gh issue create
gh issue close <num>

gh run list
gh run view <id>

gh auth status
gh auth login
gh auth refresh
```

If a `gh` call fails with "permission denied," confirm you're not on the merge call (`gh pr merge` is blocked by repo policy).

---

## Part 2: Ad-hoc worktrees (non-card work, rare)

If you genuinely need a worktree outside the kanban flow — e.g., spike experiments that don't warrant a card — these are the manual steps. **Always prefer `/board-add`**; an ad-hoc worktree has no card, no handoff trail, no PR template.

### Step 1: Record the base branch

```bash
BASE_BRANCH=$(git branch --show-current)
BASE_HEAD=$(git rev-parse HEAD)
echo "Base branch: $BASE_BRANCH at ${BASE_HEAD:0:7}"
```

### Step 2: Enter the worktree

Call `EnterWorktree` with `name: <branch-name>`. This creates `.claude/worktrees/<branch>/` and switches the session into it.

The `verify-enter-worktree.sh` PostToolUse hook runs automatically and exits 2 if the new worktree was created from the wrong commit.

### Step 3: Manual verification

```bash
EXPECTED_BRANCH="<branch>"
CURRENT_DIR=$(pwd)
CURRENT_BRANCH=$(git branch --show-current)
CURRENT_HEAD=$(git rev-parse HEAD)

[[ "$CURRENT_DIR" == *".claude/worktrees/"* ]] || { echo "FAIL: not in worktrees/"; exit 1; }
[[ "$CURRENT_BRANCH" == "$EXPECTED_BRANCH" ]]   || { echo "FAIL: wrong branch"; exit 1; }
[[ "$CURRENT_HEAD" == "$BASE_HEAD" ]]           || { echo "FAIL: HEAD mismatch"; exit 1; }
git worktree list | grep -q "$CURRENT_DIR"      || { echo "FAIL: not in worktree list"; exit 1; }
```

### Step 4: Sync env files

The kanban path's `board-sync.sh` and `/board-add` already handle this for `card/*` worktrees. For an ad-hoc worktree, copy by hand:

```bash
MAIN_DIR=$(git worktree list | head -1 | awk '{print $1}')
WORKTREE_DIR=$(pwd)

find "$MAIN_DIR" -maxdepth 4 -type f \
  \( -name '.env' -o -name '.env.*' -o -name '.envrc' \) \
  -not -path '*/.claude/worktrees/*' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/.venv/*' \
  -not -path '*/vendor/*' \
  2>/dev/null | while read -r src; do
    rel="${src#"$MAIN_DIR"/}"
    dest="$WORKTREE_DIR/$rel"
    [ -e "$dest" ] && continue
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
done
```

Symlink dependency directories if needed (`node_modules/`, `.venv/`, `vendor/`). The footgun: dep-modifying commands inside the worktree mutate the main checkout's dependencies. If the work changes deps, delete the symlink and run a fresh install:

```bash
rm node_modules && pnpm install   # then never symlink it back for this worktree
```

---

## Rules

- For kanban work, the worktree is created by `/board-add`, not by this skill. Agents arrive at an already-set-up worktree.
- Branch name is always `card/<slug>` for kanban work. Ad-hoc names are only for non-card work, which should be rare.
- The card file lives in `<worktree>/cards/<slug>.md` for the entire active lifecycle. In tracked-mode repos the base branch holds it only after the PR merges (the dispatcher moves it to `cards/done/<YYYY>/`). In gitignored-mode repos the base branch never holds the card at all — the dispatcher copies the body from the worktree into the (also-ignored) `cards/done/<YYYY>/` on merge.
- Never use `git add -A` — stage intentionally.
- Never run `gh pr merge` — humans merge on GitHub.
- Never manually `git worktree add` for a card branch — that's `/board-add`'s job (creation) or `board-sync.sh`'s job (cross-device reconciliation).
- If verification fails on an ad-hoc worktree, the workflow stops; do not retry blindly.
