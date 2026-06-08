/**
 * INTEGRATION — board-sync.sh agent-memory symlink lifecycle + Phase-A gate
 * (tier: integration — drives the REAL `.claude/scripts/board-sync.sh`
 * from the checkout under test against a throwaway $TMPDIR git repo with a
 * real `card/*` worktree. NEVER touches this repo's own worktrees.)
 *
 * Card: scope-agent-memory-to-worktree — acceptance groups C (Phase-A gate)
 * and D (single base symlink: create on reconcile, remove on teardown, no
 * dangling link).
 *
 *   D1  With exactly one active card worktree and no real agent-memory dir
 *       shadowing base, board-sync reconcile creates a gitignored symlink
 *       `.claude/agent-memory → <worktree>/.claude/agent-memory` on base.
 *   D2  When the worktree is torn down (upstream gone + card settled into
 *       cards/done/), the symlink is removed and no dangling link remains.
 *   C1  With gitignored agent-memory writes present on disk at base, the
 *       Phase-A clean-tree gate (`git diff --quiet HEAD && --cached`) still
 *       sees a clean tree and the pull proceeds — never "dirty (skipped)".
 *   (isolation) Two active worktrees each keep their own on-disk memory;
 *       neither writes into base nor into the other.
 *
 * RED-PROOF: today's board-sync.sh has ZERO agent-memory symlink logic
 * (it only maintains the cards/<slug>.md symlink). So D1/D2 FAIL now —
 * no `.claude/agent-memory` symlink is ever created. They pass once the
 * devops-engineer extends Phases B/D/E with the single agent-memory link,
 * mirroring the cards/<slug>.md link. Do NOT relax these to "symlink OR
 * nothing" — the symlink is the deliverable.
 *
 * These tests assert the SINGLE-link design the architect reconciled (one
 * `.claude/agent-memory` slot per active worktree, NOT one-per-card and NOT
 * one-per-agent). If the implementation produces per-agent or per-card
 * links, the count assertion in D1 fails — by design.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import {
  makeSandbox,
  addCardBranch,
  writeWorktreeMemory,
  type Sandbox,
} from "./helpers/git-sandbox.js";

let sandboxes: Sandbox[] = [];
function fresh(): Sandbox {
  const s = makeSandbox();
  sandboxes.push(s);
  return s;
}
afterEach(() => {
  for (const s of sandboxes) s.cleanup();
  sandboxes = [];
});

/** Is `p` a symlink (dangling or not)? */
function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
/** Does the symlink at `p` resolve to an existing target? */
function isLiveSymlink(p: string): boolean {
  return isSymlink(p) && existsSync(p);
}
function isDanglingSymlink(p: string): boolean {
  return isSymlink(p) && !existsSync(p);
}

describe("board-sync agent-memory symlink — create on reconcile (D1)", () => {
  it("creates a single gitignored `.claude/agent-memory` symlink → the active worktree", () => {
    const sbx = fresh();
    addCardBranch(sbx, "demo");

    // First run: Phase B creates the worktree. Agent then writes memory on
    // disk inside it (gitignored) before the next reconcile.
    sbx.runBoardSync();
    const wt = sbx.path(".claude", "worktrees", "card-demo");
    expect(existsSync(wt), "Phase B did not create the card worktree").toBe(true);
    writeWorktreeMemory(wt, "qa-developer", "project_demo.md");

    // Reconcile run: Phase B/E must surface the worktree's memory on base.
    sbx.runBoardSync();

    const link = sbx.path(".claude", "agent-memory");
    expect(
      isLiveSymlink(link),
      "board-sync.sh did not create a live `.claude/agent-memory` symlink on base — " +
        "extend Phases B/E to symlink `.claude/agent-memory → <worktree>/.claude/agent-memory` " +
        "next to the cards/<slug>.md link.",
    ).toBe(true);

    // It must point INTO the active worktree's memory dir, not elsewhere.
    const target = readlinkSync(link);
    expect(
      target,
      `symlink target ${target} does not reference the card-demo worktree's agent-memory`,
    ).toMatch(/card-demo[/\\]\.claude[/\\]agent-memory\/?$/);

    // The symlink itself must be git-ignored on base (like the card link),
    // so it never shows up as untracked and never dirties the ff-pull gate.
    expect(
      sbx.gitIgnored(".claude/agent-memory"),
      "the `.claude/agent-memory` symlink is NOT git-ignored on base — it would surface " +
        "as untracked and re-block board-sync's clean-tree gate.",
    ).toBe(true);
  });

  it("creates exactly ONE base memory link, not one-per-agent and not one-per-card", () => {
    const sbx = fresh();
    addCardBranch(sbx, "demo");
    sbx.runBoardSync();
    const wt = sbx.path(".claude", "worktrees", "card-demo");
    // Multiple agents write — the base must still surface ONE whole-dir link.
    writeWorktreeMemory(wt, "qa-developer", "project_demo.md");
    writeWorktreeMemory(wt, "expert-developer", "project_demo.md");
    sbx.runBoardSync();

    // The single slot is `.claude/agent-memory` (a link to the dir).
    const link = sbx.path(".claude", "agent-memory");
    expect(isLiveSymlink(link)).toBe(true);

    // There must NOT be per-agent links like `.claude/agent-memory-qa-developer`.
    expect(isSymlink(sbx.path(".claude", "agent-memory-qa-developer"))).toBe(false);
    expect(isSymlink(sbx.path(".claude", "agent-memory-expert-developer"))).toBe(false);
  });
});

describe("board-sync agent-memory symlink — teardown (D2)", () => {
  it("removes the symlink and leaves no dangling link once the worktree is torn down", () => {
    const sbx = fresh();
    addCardBranch(sbx, "demo");
    sbx.runBoardSync();
    const wt = sbx.path(".claude", "worktrees", "card-demo");
    writeWorktreeMemory(wt, "qa-developer", "project_demo.md");
    sbx.runBoardSync();

    const link = sbx.path(".claude", "agent-memory");
    expect(isLiveSymlink(link), "precondition: link should exist before teardown").toBe(true);

    // Simulate the card settling: delete the upstream branch and move the
    // card into cards/done/ on base — exactly the Phase-D teardown trigger.
    sbx.git(["push", "-q", "origin", "--delete", "card/demo"]);
    sbx.git(["fetch", "-q", "--prune", "origin"]);
    const doneDir = join("cards", "done", "2026");
    sbx.run("mkdir", ["-p", sbx.path(doneDir)]);
    sbx.run("cp", [sbx.path("cards", "demo.md"), sbx.path(doneDir, "demo.md")]);
    // (cards/demo.md on base is just the symlink; cards/done/ is tracked.)
    sbx.git(["add", "-f", `${doneDir}/demo.md`]);
    sbx.git(["commit", "-q", "-m", "archive demo"]);

    // Teardown run: Phase D removes the worktree; the memory link must go too.
    sbx.runBoardSync();

    expect(existsSync(wt), "worktree should be torn down").toBe(false);
    expect(
      isSymlink(link),
      "`.claude/agent-memory` symlink survived worktree teardown — Phase D must `rm` it " +
        "alongside the cards/<slug>.md link.",
    ).toBe(false);
    expect(
      isDanglingSymlink(link),
      "a DANGLING `.claude/agent-memory` symlink remains, shadowing real base memory — " +
        "Phase E must clean it up like dangling card links.",
    ).toBe(false);
  });
});

describe("board-sync Phase-A clean-tree gate is not tripped by gitignored memory (C1)", () => {
  it("does not report the base as dirty when only gitignored agent-memory writes are present", () => {
    const sbx = fresh();
    // Write memory directly on the BASE checkout (gitignored per the
    // sandbox's .gitignore) — simulating a non-worktree agent session.
    writeWorktreeMemory(sbx.dir, "qa-developer", "project_base.md");
    writeWorktreeMemory(sbx.dir, "solutions-architect", "feedback_x.md");

    // Sanity: the writes are genuinely git-ignored (so Phase A's
    // `git diff` sees nothing). If this fails, the .gitignore block is wrong.
    const status = sbx.git(["status", "--porcelain"]);
    expect(
      status,
      `gitignored memory writes leaked into \`git status\`:\n${status}`,
    ).toBe("");

    const { stdout } = sbx.runBoardSync();
    // Phase A logs "<BASE>: dirty working tree (skipped pull)" ONLY when the
    // tree is dirty. With memory ignored, that line must never appear.
    expect(
      stdout,
      "Phase A reported a dirty tree on account of gitignored agent-memory — " +
        "the writes must be invisible to `git diff` (check the .gitignore block).",
    ).not.toMatch(/dirty working tree \(skipped pull\)/);
  });
});

describe("board-sync agent-memory isolation across concurrent worktrees", () => {
  it("each worktree keeps its own on-disk memory; neither writes into base nor the other", () => {
    const sbx = fresh();
    addCardBranch(sbx, "alpha");
    addCardBranch(sbx, "beta");
    sbx.runBoardSync(); // creates both worktrees

    const wtA = sbx.path(".claude", "worktrees", "card-alpha");
    const wtB = sbx.path(".claude", "worktrees", "card-beta");
    expect(existsSync(wtA) && existsSync(wtB), "both worktrees should exist").toBe(true);

    // Each worktree's agent writes distinct memory on disk.
    writeWorktreeMemory(wtA, "qa-developer", "project_alpha.md", "ALPHA\n");
    writeWorktreeMemory(wtB, "qa-developer", "project_beta.md", "BETA\n");

    // Isolation: alpha's file exists only under wtA; beta's only under wtB.
    expect(existsSync(join(wtA, ".claude/agent-memory/qa-developer/project_alpha.md"))).toBe(true);
    expect(existsSync(join(wtB, ".claude/agent-memory/qa-developer/project_alpha.md"))).toBe(false);
    expect(existsSync(join(wtB, ".claude/agent-memory/qa-developer/project_beta.md"))).toBe(true);
    expect(existsSync(join(wtA, ".claude/agent-memory/qa-developer/project_beta.md"))).toBe(false);

    // Neither write created a REAL agent-memory dir on base (only a symlink
    // may exist there). A real directory would mean an agent wrote into the
    // base checkout — the bug this card kills.
    const baseMem = sbx.path(".claude", "agent-memory");
    if (existsSync(baseMem)) {
      expect(
        isSymlink(baseMem),
        "base `.claude/agent-memory` is a real directory, not a symlink — an agent wrote " +
          "into the base checkout instead of its worktree.",
      ).toBe(true);
    }
  });
});
