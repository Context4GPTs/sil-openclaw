/**
 * git-sandbox — build throwaway git repos in $TMPDIR for harness/git-plumbing
 * tests (board-sync.sh symlink lifecycle; merge-diff invariants).
 *
 * WHY a real temp repo and not the repo under test: the board-sync /
 * agent-memory tests mutate git tracking state, create/remove worktrees,
 * and make commits. None of that may touch this real repo's worktrees (it
 * would corrupt live card state). Every sandbox is a fresh `mkdtemp` git
 * repo, torn down in afterEach. Determinism: fixed identity + no GPG sign +
 * a NON-protected default branch ("trunk") so the repo's own commit hooks
 * never interfere when these helpers shell out via execFileSync.
 *
 * The sandbox copies in the board-sync.sh FROM THE CHECKOUT UNDER TEST
 * (resolved relative to this file), so the integration tests exercise
 * whatever the devops-engineer actually edited — not a stale snapshot.
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root of the checkout under test (…/src/__tests__/helpers → root). */
export const REPO_ROOT = join(HERE, "..", "..", "..");
/** The board-sync.sh the tests drive — the one in THIS checkout. */
export const BOARD_SYNC_SRC = join(REPO_ROOT, ".claude", "scripts", "board-sync.sh");

/** Default base branch for sandboxes — deliberately NOT main/master/dev. */
export const BASE_BRANCH = "trunk";

export interface Sandbox {
  /** Root of the consumer clone (where board-sync.sh runs). */
  readonly dir: string;
  /** Bare origin the clone tracks. */
  readonly originDir: string;
  /** Run a git command in `dir` (or a -C target); returns trimmed stdout. */
  git(args: string[], cwd?: string): string;
  /** True iff `git check-ignore -q <relPath>` says the path is ignored. */
  gitIgnored(relPath: string): boolean;
  /** Run an arbitrary command in `dir`; returns trimmed stdout. */
  run(cmd: string, args: string[], cwd?: string): string;
  /** Copy this checkout's board-sync.sh into the sandbox and run it in `dir`. */
  runBoardSync(): { stdout: string; stderr: string };
  /** Absolute path inside the sandbox clone. */
  path(...parts: string[]): string;
  /** Remove the whole sandbox tree. */
  cleanup(): void;
}

function sh(
  cmd: string,
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout: stdout.toString(), stderr: "", status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
      status: e.status ?? 1,
    };
  }
}

/**
 * Create a sandbox: a bare origin + a consumer clone on `trunk` with the
 * cc-setup skeleton (cards/, .claude/scripts/). No card branch yet — the
 * caller adds one with `addCardBranch`.
 */
export function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "agent-mem-sbx-"));
  const originDir = join(root, "origin.git");
  const dir = join(root, "work");

  const gitGlobal = (args: string[], cwd: string) => {
    const r = sh("git", args, cwd);
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.stdout}`);
    }
    return r.stdout.trim();
  };

  // Bare origin + clone.
  mkdirSync(originDir, { recursive: true });
  gitGlobal(["init", "-q", "--bare", originDir], root);
  gitGlobal(["clone", "-q", originDir, dir], root);

  // Deterministic identity; no GPG; non-protected base branch.
  gitGlobal(["config", "user.email", "sandbox@test.invalid"], dir);
  gitGlobal(["config", "user.name", "sandbox"], dir);
  gitGlobal(["config", "commit.gpgsign", "false"], dir);
  gitGlobal(["checkout", "-q", "-b", BASE_BRANCH], dir);

  // Minimal cc-setup skeleton.
  mkdirSync(join(dir, "cards", "done"), { recursive: true });
  mkdirSync(join(dir, "cards", "abandoned"), { recursive: true });
  mkdirSync(join(dir, ".claude", "scripts"), { recursive: true });
  writeFileSync(join(dir, "cards", ".gitkeep"), "");
  // Mirror the gitignore block this card establishes, so the sandbox
  // behaves like the post-change repo (memory + card bodies ignored). The
  // agent-memory tree is ignored WHOLE — no `!`-exempt — because the
  // per-agent MEMORY.md is living content, not scaffolding (see the unit
  // test's header for the full rationale).
  //
  // NO TRAILING SLASH on the agent-memory pattern — this is load-bearing.
  // A trailing-slash pattern (`.claude/agent-memory/`) matches a directory
  // but NOT a symlink, so once board-sync replaces the base path with a
  // symlink into the active worktree, a trailing-slash pattern leaves that
  // symlink UN-ignored → it surfaces as untracked → Phase A's clean-tree
  // gate skips the ff-pull = the exact bug acceptance group C kills. The
  // no-slash form `.claude/agent-memory` ignores files-under-tree,
  // MEMORY.md, the dir, AND the symlink. (Proven empirically; see the
  // board-sync D1 failure report.)
  writeFileSync(
    join(dir, ".gitignore"),
    [
      ".claude/worktrees/",
      "cards/*.md",
      "!cards/_TEMPLATE.md",
      "!cards/README.md",
      ".claude/agent-memory",
      "",
    ].join("\n"),
  );
  gitGlobal(["add", "cards/.gitkeep", ".gitignore"], dir);
  gitGlobal(["commit", "-q", "-m", "skeleton"], dir);
  gitGlobal(["push", "-q", "origin", BASE_BRANCH], dir);

  const api: Sandbox = {
    dir,
    originDir,
    git(args, cwd = dir) {
      return gitGlobal(args, cwd);
    },
    gitIgnored(relPath) {
      // check-ignore -q: exit 0 = ignored, 1 = not ignored, 128 = error.
      const r = sh("git", ["check-ignore", "-q", relPath], dir);
      if (r.status === 0) return true;
      if (r.status === 1) return false;
      throw new Error(`git check-ignore ${relPath} errored: ${r.stderr}`);
    },
    run(cmd, args, cwd = dir) {
      const r = sh(cmd, args, cwd);
      if (r.status !== 0) {
        throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
      }
      return r.stdout.trim();
    },
    runBoardSync() {
      if (!existsSync(BOARD_SYNC_SRC)) {
        throw new Error(`board-sync.sh not found at ${BOARD_SYNC_SRC}`);
      }
      const dest = join(dir, ".claude", "scripts", "board-sync.sh");
      cpSync(BOARD_SYNC_SRC, dest);
      const r = sh("bash", [dest], dir);
      // board-sync.sh is expected to exit 0; surface non-zero for the test
      // to assert on, but don't throw (a phase may log+continue).
      return { stdout: r.stdout, stderr: r.stderr };
    },
    path(...parts) {
      return join(dir, ...parts);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };

  return api;
}

/**
 * Push a `card/<slug>` branch to origin carrying a card body file, then
 * fetch it into the clone so board-sync.sh can `git worktree add` it.
 * Returns the slug. The card body is committed; agent-memory is NOT (it is
 * gitignored — agents write it on disk inside the worktree at runtime,
 * which the caller simulates separately).
 */
export function addCardBranch(sbx: Sandbox, slug: string): void {
  const branch = `card/${slug}`;
  sbx.git(["checkout", "-q", "-b", branch, BASE_BRANCH]);
  // The card body would normally be gitignored too; force-add so the
  // worktree checkout has it (board-sync.sh symlinks cards/<slug>.md only
  // when the file exists in the worktree).
  writeFileSync(sbx.path("cards", `${slug}.md`), `# card ${slug}\n`);
  sbx.git(["add", "-f", `cards/${slug}.md`]);
  sbx.git(["commit", "-q", "-m", `card ${slug}`]);
  sbx.git(["push", "-q", "origin", branch]);
  sbx.git(["checkout", "-q", BASE_BRANCH]);
  sbx.git(["fetch", "-q", "--prune", "origin"]);
}

/**
 * Simulate an agent writing memory ON DISK inside a worktree (gitignored,
 * never staged) — what a sub-agent rooted in that worktree actually does.
 */
export function writeWorktreeMemory(
  worktreeDir: string,
  agent: string,
  filename: string,
  body = "note\n",
): void {
  const dir = join(worktreeDir, ".claude", "agent-memory", agent);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), body);
}
