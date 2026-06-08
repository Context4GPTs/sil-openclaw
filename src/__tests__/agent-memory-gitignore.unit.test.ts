/**
 * UNIT — `.claude/agent-memory/` git-tracking + git-ignore PROPERTIES
 * (tier: unit — shells out to `git` against the checkout the test runs in;
 * no temp repos, no worktrees, no network. Asserts the two core git
 * properties this card flips: memory is NOT tracked, and stray memory
 * writes ARE ignored — exactly how `cards/*.md` already behaves.)
 *
 * Card: scope-agent-memory-to-worktree — acceptance group A.
 *
 *   A1  `git ls-files .claude/agent-memory/` lists NOTHING — the entire
 *       tree is untracked, mirroring how `git ls-files cards/` lists no
 *       live card body.
 *   A2  Any write under `.claude/agent-memory/` is git-ignored
 *       (`git check-ignore -q` => true) and leaves `git status` clean —
 *       exactly as a stray `cards/<slug>.md` is.
 *
 * EXEMPT SET = EMPTY (whole tree ignored, incl. per-agent MEMORY.md).
 * The architect framed this as an either/or — "MEMORY.md indices at most,
 * OR ignore everything". Settled to ignore-everything because each agent's
 * MEMORY.md is the *index of that agent's memories*, mutated on every
 * memory write — living content, not static scaffolding. Tracking it
 * (`!`-exempt) would dirty the base tree on every write and re-block
 * board-sync's ff-pull gate — the exact failure mode acceptance group C
 * and the card Intent exist to kill. There is no static scaffolding file
 * inside agent-memory (no .gitkeep/_TEMPLATE/README), and repo-bootstrap
 * treats the whole dir as a non-shipped "delete if present" path. So the
 * exempt set is empty — nothing under agent-memory is tracked, the same as
 * nothing live under cards/ is tracked.
 *
 * RED-PROOF (why this file MUST fail before the dev's untrack commit):
 * on `main` today, all 13 `.claude/agent-memory/**` files are TRACKED and
 * the path is NOT in `.gitignore`. So:
 *   - A1 fails: `git ls-files` returns feedback_/project_/reference_/MEMORY.
 *   - A2 fails: `git check-ignore -q` returns exit 1 (NOT ignored).
 * The red→green flip after `git rm -r --cached .claude/agent-memory/` +
 * the `.gitignore` block is the proof the card's core delta landed. These
 * assertions are written to FAIL on `main` and pass only post-change — do
 * NOT weaken them to match a tracked state.
 *
 * The test resolves the git root dynamically via `git rev-parse
 * --show-toplevel` (NEVER a hardcoded worktree path), so the same file is
 * correct in the worktree, on `main` after merge, and verbatim in the
 * sil-services / sil-stage siblings of the epic.
 *
 * Contract this file pins for the implementation (devops-engineer):
 *   `.gitignore` ignores the ENTIRE `.claude/agent-memory/` tree with no
 *   `!`-exempt, AND base tracks zero agent-memory files.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Repo root of the checkout this test is running in (worktree or main). */
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

/** Read the repo-root .gitignore as text (empty string if absent). */
function readGitignore(): string {
  try {
    return readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
  } catch {
    return "";
  }
}

/** Run a git command in REPO_ROOT; return trimmed stdout. */
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

/**
 * `git check-ignore -q <path>` exit code: 0 = path IS ignored, 1 = NOT
 * ignored, 128 = error. We map to a boolean and let any other code throw.
 */
function isIgnored(relPath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", relPath], { cwd: REPO_ROOT });
    return true; // exit 0
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 1) return false;
    throw err; // 128 or anything else is a real failure, not "not ignored"
  }
}

describe("agent-memory git-tracking (A1) — base tracks no agent memory at all", () => {
  it("`git ls-files .claude/agent-memory/` lists nothing (whole tree untracked, MEMORY.md included)", () => {
    const tracked = git(["ls-files", ".claude/agent-memory/"])
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Adversarial: enumerate the offenders in the failure message so the
    // RED state is self-explanatory (13 files tracked on main today).
    expect(
      tracked,
      `agent-memory content is still TRACKED on this branch — run \`git rm -r --cached .claude/agent-memory/\` ` +
        `and ignore the whole tree (no \`!\`-exempt). Offending tracked files:\n  ${tracked.join("\n  ")}`,
    ).toEqual([]);
  });

  it("mirrors the cards model: `git ls-files cards/` likewise carries no live card body, only scaffolding (anchors A1's expectation)", () => {
    // This is the reference behavior the card says to mirror. It already
    // passes today (cards are gitignored), so it documents the *target*
    // shape for agent-memory and guards against the cards model silently
    // changing underneath us.
    const trackedCards = git(["ls-files", "cards/"])
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      // cards/done/** is the archived-card store (legitimately tracked);
      // the live-card analogy is about the top-level cards/*.md body.
      .filter((f) => !f.startsWith("cards/done/"));

    const liveCardBodies = trackedCards.filter(
      (f) =>
        f.endsWith(".md") &&
        f !== "cards/README.md" &&
        f !== "cards/_TEMPLATE.md",
    );

    expect(
      liveCardBodies,
      `cards model regressed — a live card body is tracked: ${liveCardBodies.join(", ")}`,
    ).toEqual([]);
  });
});

describe("agent-memory git-ignore (A2) — every memory write is ignored, like a stray card", () => {
  // Representative per-agent paths an agent actually writes, INCLUDING the
  // per-agent MEMORY.md index (living content, must be ignored too). We
  // assert the PROPERTY (ignored) without creating files — `git
  // check-ignore` works on hypothetical paths, keeping the test pure and
  // side-effect-free (no writes into the real repo).
  const sampleWrites = [
    ".claude/agent-memory/qa-developer/project_some-card.md",
    ".claude/agent-memory/qa-developer/feedback_some-rule.md",
    ".claude/agent-memory/qa-developer/MEMORY.md",
    ".claude/agent-memory/expert-developer/reference_some-system.md",
    ".claude/agent-memory/expert-developer/MEMORY.md",
    ".claude/agent-memory/solutions-architect/project_another-card.md",
  ];

  for (const path of sampleWrites) {
    it(`\`git check-ignore\` reports IGNORED for ${path}`, () => {
      expect(
        isIgnored(path),
        `${path} is NOT git-ignored — ignore the whole \`.claude/agent-memory/\` tree in .gitignore ` +
          `(mirroring the cards/*.md block, with NO \`!\`-exempt). Until then an agent write here dirties the working tree.`,
      ).toBe(true);
    });
  }

  it("a stray `cards/<slug>.md` is ignored today — the exact precedent A2 mirrors", () => {
    // Anchors the analogy: cards already get this treatment. If this ever
    // fails, the model we're copying changed, not our code.
    expect(isIgnored("cards/some-stray-card.md")).toBe(true);
  });
});

describe("agent-memory git-ignore (A2') — the base SYMLINK must be ignored, not just files under it", () => {
  // THE TRAILING-SLASH TRAP. board-sync.sh replaces the base
  // `.claude/agent-memory` path with a SYMLINK into the active worktree
  // (Phase B/E). A gitignore pattern that ends in a slash
  // (`.claude/agent-memory/`) matches a DIRECTORY but NOT a symlink — so a
  // trailing-slash rule leaves the base symlink UN-ignored, it surfaces as
  // untracked, and board-sync Phase A's clean-tree gate then skips the
  // ff-pull. That is the precise failure mode acceptance group C exists to
  // prevent. The no-slash form `.claude/agent-memory` ignores files under
  // the tree, MEMORY.md, the dir, AND the symlink (verified empirically).
  //
  // This test asserts directly on the .gitignore pattern shape, catching a
  // trailing-slash regression in the REAL repo's .gitignore that the
  // synthetic-gitignore integration sandbox cannot see.

  it("the .gitignore agent-memory entry has NO trailing slash (so it matches the base symlink, not only a dir)", () => {
    // Direct assertion on the mechanism. The card's fix IS a gitignore
    // pattern; "no trailing slash" is a concrete correctness property
    // because a trailing slash provably fails to match the base symlink
    // board-sync creates. This is RED on the current implementation (which
    // ships `.claude/agent-memory/` with a slash) and the failure report to
    // the devops-engineer asks for the one-character fix.
    const entries = readGitignore()
      .split("\n")
      .map((l) => l.trim())
      // The agent-memory ignore line (not a comment, not the negation, not
      // a sub-path under it).
      .filter(
        (l) =>
          /(^|\/)\.claude\/agent-memory\/?$/.test(l) && !l.startsWith("#") && !l.startsWith("!"),
      );

    expect(
      entries.length,
      "no `.claude/agent-memory` ignore entry found in .gitignore",
    ).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(
        entry.endsWith("/"),
        `the .gitignore entry "${entry}" ends in a trailing slash — drop it. ` +
          `A trailing-slash pattern matches a directory but NOT the symlink board-sync creates ` +
          `on base, leaving it untracked and re-blocking the ff-pull gate (acceptance group C).`,
      ).toBe(false);
    }
  });
});
