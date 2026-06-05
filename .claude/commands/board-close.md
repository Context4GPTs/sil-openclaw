---
description: "Manually abandon a kanban card. Usage: /board-close <slug>. Copies the worktree-resident card body to cards/abandoned/<YYYY>/ on the base branch, flips status to abandoned, closes any open PR, tears down the worktree and its branches."
---

# Board close

Founder-driven abandonment of a card. Use when work is cancelled, scope killed, or the card was created in error.

## Usage

```
/board-close <slug>
```

With a reason note appended to the card:

```
/board-close <slug> reason="<one-line reason>"
```

## Algorithm

1. **Locate the card.** In the worktree-resident model, an active card lives at:

   ```
   .claude/worktrees/card-<slug>/cards/<slug>.md
   ```

   If that path doesn't exist, look for the terminal copies:
   - `cards/done/**/<slug>.md` → already done; print "already done" and stop.
   - `cards/abandoned/**/<slug>.md` → already abandoned; print and stop.

   If nowhere → print "card not found: no worktree, no done/, no abandoned/" and stop.

2. **Read frontmatter** from the worktree's card file. Capture:
   - `base_branch:` — where the abandoned file will be committed
   - `pr:` — PR URL (may be null)
   - `branch:` — should be `card/<slug>`
   - All other fields for the body copy

3. **Close the PR** (if any). If `pr:` is set:
   ```bash
   gh pr comment "$pr_url" --body "Closing — card abandoned via /board-close. Reason: $reason"
   gh pr close "$pr_url"
   ```
   Do NOT use `gh pr merge`. Do NOT delete the remote branch yet — let Step 7 handle it.

4. **Switch to the base branch in the main checkout** (not the worktree). Ensure clean tree first:
   ```bash
   MAIN_DIR=$(git worktree list | head -1 | awk '{print $1}')
   cd "$MAIN_DIR"
   git diff --quiet HEAD && git diff --cached --quiet || {
     echo "Base checkout is dirty. Resolve before abandoning."
     exit 1
   }
   git checkout "$base_branch"
   ```

5. **Copy the card body from the worktree to `cards/abandoned/<YYYY>/`** on the base branch, editing frontmatter as the file is written:
   ```bash
   year=$(date +%Y)
   today=$(date +%Y-%m-%d)
   mkdir -p "cards/abandoned/$year"
   cp ".claude/worktrees/card-$slug/cards/$slug.md" "cards/abandoned/$year/$slug.md"
   ```
   Then edit `cards/abandoned/$year/$slug.md` frontmatter:
   - `status: abandoned`
   - `agents: []`
   - `updated: $today`

   And append the abandonment section to the body:
   ```markdown
   ## Abandoned — founder

   - Date: <today>
   - Reason: <reason or "no reason given">
   - PR state at close: <pr_url + state, if any>
   - Worktree torn down: yes
   ```

6. **Commit on the base branch — tracked-mode repos only**:
   ```bash
   if git check-ignore -q "cards/abandoned/$year/$slug.md"; then
     : # Gitignored mode (public repo): the abandoned card is a local-only archive.
       # Nothing to commit or push — skip straight to teardown.
   else
     git add "cards/abandoned/$year/$slug.md"
     git commit -m "abandon: card/$slug"
     git push origin "$base_branch"
   fi
   ```
   The `edit-branch-guard` allowlist permits `cards/**` writes on protected branches (tracked mode).

7. **Tear down the worktree + branches**:
   ```bash
   git worktree remove ".claude/worktrees/card-$slug" --force
   git branch -D "card/$slug" 2>/dev/null
   git push origin --delete "card/$slug" 2>/dev/null || true
   ```

   Force-delete is correct: the work is being thrown away. This is one of the only places we accept `-D` on a kanban branch.

8. **Other devices** will see the abandoned file in `cards/abandoned/<YYYY>/` after their next `board-sync.sh` cron run (which also pulls the base branch). Their local `card-<slug>` worktree, if any, becomes a teardown candidate — Phase D of the sync script removes it on the next run because the upstream branch is gone AND `cards/abandoned/<YYYY>/<slug>.md` exists.

## Reporting

```
Abandoned: cards/abandoned/<YYYY>/<slug>.md
Worktree:  torn down (was at .claude/worktrees/card-<slug>)
Branch:    card/<slug> deleted locally and on origin
PR:        closed (<url>)        — or: none
```

## Failure modes

- **Card not found**: print where you looked (`.claude/worktrees/card-<slug>/`, `cards/done/`, `cards/abandoned/`), stop.
- **Already done** (in `cards/done/<YYYY>/`): print and stop. Done cards are terminal; manual `git rm` is required for full deletion.
- **Already abandoned** (in `cards/abandoned/<YYYY>/`): print and stop.
- **Base checkout dirty**: refuse. The founder must commit or stash before abandoning.
- **Worktree teardown fails** (uncommitted changes inside the worktree): refuse and surface the dirty status. The founder must clean up or pass an explicit `--force` flag (not implemented by default).
- **PR close fails**: warn but continue — the abandonment is local; the PR can be closed manually on GitHub.
- **Remote branch delete fails**: warn but continue — push-guard allows deletes of `card/*` branches; the most likely cause is the branch was already deleted server-side.
