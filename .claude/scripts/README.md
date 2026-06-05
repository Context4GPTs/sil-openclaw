# Scripts

Standalone shell scripts that run outside Claude Code — typically via cron or as Phase 1 of a slash command.

## `board-sync.sh`

Reconciles local kanban worktrees with remote `card/*` branches. Pure git: no Claude invocation, no interactive prompts.

### What it does

1. **Fetch** `origin` with `--prune`, then ff-pull the current base branch (so any `cards/done/<YYYY>/` or `cards/abandoned/<YYYY>/` updates from the dispatcher land locally).
2. **Create** a local worktree at `.claude/worktrees/card-<slug>/` for every `origin/card/<slug>` that doesn't have one yet. Env files (`.env`, `.envrc`, etc.) are copied in automatically.
3. **Fast-forward pull** each existing worktree from its upstream. Dirty or non-ff worktrees are skipped with a warning.
4. **Tear down** worktrees whose upstream branch is gone (PR merged + branch deleted) **and** whose card has already settled into `cards/done/<YYYY>/<slug>.md` or `cards/abandoned/<YYYY>/<slug>.md` on the base branch. This conservative guard ensures the dispatcher gets a chance to do the done-move before the worktree disappears.

The script never spawns agents, never opens PRs, never edits card frontmatter, never touches the base branch beyond the ff-pull. It is safe to run from cron on a read-only device.

### Run it manually

```bash
cd /path/to/repo
bash .claude/scripts/board-sync.sh
```

Output is one line per significant event:

```
[sync] worktree-resident-cards: worktree created from origin/card/worktree-resident-cards
[sync] worktree-resident-cards: dirty (skipped pull)
[sync] some-merged-card: upstream gone but not in done/abandoned — awaiting dispatcher
[sync] some-merged-card: torn down (settled)
```

### Run it via cron (phone / passive device)

Termux Debian on Android:

```bash
# Install cron if missing
apt install cron

# Edit the user crontab
crontab -e
```

Add:

```
*/5 * * * * cd /path/to/repo && bash .claude/scripts/board-sync.sh >> .claude/sync.log 2>&1
```

Then start cron:

```bash
service cron start
```

### Verify it's working

After the cron line is installed, wait 5 minutes and check the log:

```bash
tail -f .claude/sync.log
```

You should see periodic blocks of `[sync] ...` output. If the log is empty after 5 minutes:

- Confirm cron is running: `service cron status`
- Confirm the path in the crontab is correct: `crontab -l`
- Run the script manually once to surface any errors: `bash .claude/scripts/board-sync.sh`

### When it does NOT do the right thing

- **A worktree pull fails non-ff**: the script logs it and skips. Resolve manually in the worktree (rebase or hard-reset).
- **A worktree is dirty**: the script skips its pull. Commit or stash inside the worktree.
- **Fetch fails** (no network): the script exits 1; cron will retry on the next interval.
- **An "upstream gone but not in done/abandoned" line persists**: the dispatcher hasn't run a tick that processed the merge yet. Run `/board-tick` on the active device.

The script is idempotent — running it multiple times produces the same end state, so cron retries are safe.
