---
description: "Create a new kanban card in Backlog. Usage: /board-add <work_type> <title>. Creates the card/<slug> branch + worktree atomically, writes the card file inside the worktree, pushes to origin. The base branch is never touched."
---

# Board add

Create a new kanban card. The card is born in its own `card/<slug>` branch + worktree — the base branch (`main` or `dev`) never holds the card file. Founder-only entry point.

## Usage

```
/board-add <work_type> <title>
```

Example:

```
/board-add feature Add rate-limit to /api/track
/board-add bug    Login button hangs on slow networks
/board-add docs   Document the dispatcher loop
```

`<work_type>` must be one of: `feature`, `bug`, `refactor`, `chore`, `docs`.

## Algorithm

0. **Invoke the `card-intake` skill** with the founder's raw input before any mechanical work. It returns a refined `(work_type, title, intent, priority)` — feed those into the steps below. If card-intake returns `ABORT`, stop without creating anything. See `.claude/skills/card-intake/SKILL.md`.

1. **Parse arguments** from `$ARGUMENTS`. First token = `work_type`. Remainder = `title`.

2. **Validate `work_type`** is in the allowed set. If not, error out with the allowed list.

3. **Capture the base branch** the card is being cut from:
   ```bash
   BASE_BRANCH=$(git branch --show-current)
   BASE_HEAD=$(git rev-parse HEAD)
   ```
   This must be `main`, `master`, or `dev`. If on any other branch, refuse — card creation is a base-branch operation.

4. **Derive `slug`** from `title`:
   - lowercase
   - replace whitespace and punctuation with `-`
   - collapse multiple `-` to one
   - strip leading/trailing `-`
   - truncate to 50 chars

5. **Check uniqueness**: no local branch `card/<slug>`, no remote `origin/card/<slug>`, no worktree `.claude/worktrees/card-<slug>`, no file under `cards/done/**/<slug>.md` or `cards/abandoned/**/<slug>.md`. If any collision, append `-2`, `-3`, etc.

6. **Create the worktree + branch atomically** off the base branch HEAD:
   ```bash
   git worktree add -b "card/$SLUG" ".claude/worktrees/card-$SLUG" "$BASE_BRANCH"
   ```
   The `verify-enter-worktree.sh` hook only fires for the `EnterWorktree` tool, not raw `git worktree`. That's fine here — we know the base is exactly `$BASE_BRANCH` because we just read it.

7. **Sync env files into the worktree** (mirrors `worktree-ops` Step 4a):
   ```bash
   MAIN_DIR=$(git worktree list | head -1 | awk '{print $1}')
   WT="$MAIN_DIR/.claude/worktrees/card-$SLUG"
   find "$MAIN_DIR" -maxdepth 4 -type f \
     \( -name '.env' -o -name '.env.*' -o -name '.envrc' \) \
     -not -path '*/.claude/worktrees/*' \
     -not -path '*/node_modules/*' \
     -not -path '*/.git/*' \
     -not -path '*/.venv/*' \
     -not -path '*/vendor/*' \
     2>/dev/null | while read -r src; do
       rel="${src#"$MAIN_DIR"/}"
       dest="$WT/$rel"
       [ -e "$dest" ] && continue
       mkdir -p "$(dirname "$dest")"
       cp "$src" "$dest"
   done
   ```

8. **Write the card file inside the worktree** by copying `cards/_TEMPLATE.md` and filling frontmatter:
   - `title:` — refined title
   - `slug:` — derived slug
   - `work_type:` — refined work_type
   - `status: backlog`
   - `agents: []`
   - `priority:` — refined priority (default 2)
   - `created:` — today (`date +%Y-%m-%d`)
   - `updated:` — today
   - `base_branch:` — the captured `$BASE_BRANCH`
   - `branch: card/<slug>`
   - `worktree:` — absolute path of the worktree directory
   - Body: write the framed Intent block from card-intake under `## Intent (founder)`. Strip the unused alt-Intent template comment (the `bug` placeholder if work_type ≠ bug, or vice versa).

9. **Commit + push on the card branch** (skipped in gitignored-mode repos):
   ```bash
   cd "$WT"
   if git check-ignore -q "cards/$SLUG.md"; then
     # Gitignored mode (public repo): cards/ is excluded from git.
     # Skip commit + push — the remote card/<slug> ref is created when the
     # first implementation commit lands during in-dev. Single-device kanban
     # until then is the deliberate tradeoff for keeping public repos pristine.
     PUSHED="local-only (gitignored mode — origin ref created on first dev commit)"
   else
     git add "cards/$SLUG.md"
     git commit -m "card: add $SLUG"
     git push -u origin "card/$SLUG"
     PUSHED="origin/card/$SLUG"
   fi
   ```
   The base branch (`main`/`dev`) is never modified. The `pre-commit-guard` and `edit-branch-guard` hooks don't fire here — we're inside the worktree on `card/<slug>`, not on a protected branch.

10. **Return to the base branch directory** the founder was sitting in, so the session is back where they invoked the command from.

## Reporting

```
Created: card/<slug>
Worktree: .claude/worktrees/card-<slug>/
Card:    cards/<slug>.md (inside the worktree)
Status:  backlog
Type:    <work_type>
Title:   <title>
Base:    <base_branch>
Pushed:  <$PUSHED — either "origin/card/<slug>" or the gitignored-mode local-only message>
Next:    /board-tick picks it up; or edit the Intent inside the worktree first.
```

## Failure modes

- **Invalid work_type**: stop, print the allowed list.
- **`cards/_TEMPLATE.md` missing**: stop, instruct the founder to restore it from git history.
- **Not on a protected branch** (main/master/dev): refuse. Card creation must be initiated from a base branch — that's what `card/<slug>` will be cut from. Print: "Switch to your base branch (main or dev) first."
- **Uncommitted work on the base branch**: refuse. Print the dirty status and ask for resolution. (The worktree creation itself doesn't require a clean base, but the founder should know the worktree captures the current dirty state, which is rarely what they want.)
- **Slug collision** with existing local branch, remote branch, worktree, or done/abandoned card: append `-2`, `-3`, etc. Surface the collision in the report.
- **Push fails** (e.g., no remote configured, auth missing): leave the branch + worktree intact locally and surface the push error. The founder can retry with `git push -u origin card/<slug>` from inside the worktree.
