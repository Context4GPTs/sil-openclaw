# Hooks

Deterministic enforcement layer. The hooks are intentionally minimal — kanban cards drive workflow, not hooks.

Protected branches: `main`, `master`, `dev` (dev is the staging branch; main is the release target).

## Wired in `.claude/settings.json`

| Trigger | Hook | Purpose |
|---|---|---|
| `PreToolUse` `Bash` | `pre-commit-guard.sh` | Block `git commit` on protected branches for dev work. Allows: card-only or meta-only commits (allowlist matches `edit-branch-guard`). |
| `PreToolUse` `Bash` | `push-guard.sh` | Block `git push` targeting protected branches — pushes, deletes (`--delete`/`-d`/`:branch`), and refspecs (`HEAD:main`). Block `--force`/`-f` (`--force-with-lease` is allowed). **Cards/meta-only commits ahead of `origin/<branch>` are allowed** so the dispatcher's done-move and `/board-close`'s abandon-move can push without manual founder intervention — allowlist mirrors `pre-commit-guard.sh` (`cards/**`, `.claude/**`, `.obsidian/**`, `CLAUDE.md`, `README.md`, `BOARD.md`, `INDEX.base`, `.gitignore`, `.config/**`). Card branches are unrestricted. |
| `PreToolUse` `Bash` | `test-run-guard.sh` | Warn when test commands run without the `qa-developer` sentinel. Exit 0 (warn-only). |
| `PreToolUse` `Edit\|Write` | `edit-branch-guard.sh` | **Block** (exit 2) non-card edits on protected branches. Allows `cards/**`, `.claude/**`, `.obsidian/**`, `CLAUDE.md`, `README.md`, `BOARD.md`, `INDEX.base`, `.gitignore`, `.config/**`. |
| `PreToolUse` `Edit\|Write` | `test-guard.sh` | Block test-file edits without the `qa-developer` sentinel. Exit 2. |
| `PostToolUse` `EnterWorktree` | `verify-enter-worktree.sh` | Block (exit 2) if the new worktree's HEAD does not match the main repo's current branch tip. Essential — `EnterWorktree` occasionally bases worktrees on `origin/main` by accident. **Only fires on the `EnterWorktree` tool.** Raw `git worktree add` in a Bash call bypasses this hook silently; the `worktree-ops` skill is the only sanctioned creation path. |
| `PostToolUse` `Edit\|Write` | inline auto-format | Run `ruff` / `prettier` / `gofmt` on the saved file if available. |
| `Notification` | `desktop-notification.sh` | macOS notification when Claude needs attention. |

The `CLAUDE_DISTILLER=1` bypass that used to live in these hooks is gone — distillation now runs in the worktree on `card/<slug>` like every other stage agent, so no bypass is needed.

## QA sentinel

`qa-developer` creates `/tmp/.claude-qa-active-<repo-hash>` on start. `test-guard` and `test-run-guard` check for the sentinel (60-minute TTL) before allowing test-file edits or test execution by other agents.

This enforces the `adversarial-testing` skill's rule: **test files are owned by `qa-developer`** so coding agents cannot quietly weaken a failing test.

**Limitation:** the sentinel is per-worktree (hashed from `git rev-parse --show-toplevel`), not per-agent-instance. Within the 60-minute window after `qa-developer` last touched the worktree, any agent operating in the same worktree (e.g. `expert-developer` in the GREEN phase) can edit test files and run tests — the hook can't distinguish them. Treat the sentinel as best-effort: it stops casual edits by unrelated sessions, not deliberate violations in the same TDD pair. The adversarial-testing skill's other rules (clean context per qa-developer spawn, no test weakening) still carry the load.

## Disabling a hook

Comment out the relevant block in `.claude/settings.json`. Do not skip hooks with `--no-verify` on commits — the hooks block real foot-guns.

## Transient artifacts on protected branches

`edit-branch-guard.sh` blocks writes to anything outside the allowlist (`cards/**`, `.claude/**`, top-level signposts) when the current branch is `main`, `master`, or `dev`. If an agent needs to write a transient artifact while sitting on a protected branch (audit reports, ad-hoc notes, scratch docs) it must place the file **inside the allowlist** — typically `.claude/<name>.md` or `cards/<slug>.md`. Writing to repo root, `docs/`, or any other path will be blocked by exit 2.

## Auto-formatting

Install the formatter that matches your project:

```bash
# Python
pip install ruff

# JavaScript/TypeScript
npm install -g prettier

# Go is bundled with gofmt
```
