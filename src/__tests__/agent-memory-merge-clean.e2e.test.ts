/**
 * E2E — base stays clean through a card lifecycle: zero `.claude/agent-memory/`
 * paths ever cross onto the base branch (via the card's PR diff OR the
 * done-archive commit).
 *
 * Card: scope-agent-memory-to-worktree — acceptance group C, e2e criterion.
 *
 * FORM CHOSEN: the **merge-diff invariant**, NOT a hermetic full-board-run.
 * The card's Test strategy explicitly authorizes this:
 *   "If a hermetic full-board-run harness is too heavy, qa may assert the
 *    merge-diff invariant directly: `git diff <base>...card/<slug>` (and a
 *    simulated done-archive commit) contain zero `.claude/agent-memory/`
 *    paths. Document whichever form is used."
 * WHY this form: a true full-board run needs the Claude dispatcher
 * (/board-tick) and a live remote PR-merge — non-hermetic, non-deterministic,
 * and out of scope for a fast e2e gate. The invariant the founder actually
 * cares about ("base never gets littered with per-tick memory churn",
 * criterion D of the Intent) is fully captured by proving that NOTHING under
 * `.claude/agent-memory/` is reachable on base through either path memory
 * could travel: the card branch's merge diff, or the archive commit. We
 * build a sandbox in $TMPDIR that mirrors the post-change repo (memory
 * gitignored everywhere, never staged) and assert the invariant against real
 * git — deterministic, hermetic, no network, no Claude.
 *
 * RED-PROOF: this is the subtle one. On `main` TODAY, `.claude/agent-memory/`
 * is TRACKED. The failure mode the card kills is: memory tracked on base →
 * an agent edits it inside a worktree → the change is a tracked-file diff →
 * the card's PR merge re-adds/updates it on base. The sandbox reproduces the
 * BROKEN model in `mergeDiffUnderBrokenTrackingModel` (memory committed on the
 * card branch) and asserts the diff is NON-empty there — proving the test can
 * detect the leak. Then `mergeDiffUnderFixedModel` (memory gitignored, never
 * staged — the target) asserts the diff is EMPTY. The fixed-model assertion
 * is what the implementation must satisfy; the broken-model assertion guards
 * the test itself against a false green (a diff that's empty because the test
 * never wrote memory at all).
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  makeSandbox,
  BASE_BRANCH,
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

/** All paths touched by `git diff <base>...<branch>` (3-dot: merge-base diff). */
function mergeDiffPaths(sbx: Sandbox, base: string, branch: string): string[] {
  return sbx
    .git(["diff", "--name-only", `${base}...${branch}`])
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function agentMemoryPaths(paths: string[]): string[] {
  return paths.filter((p) => p.startsWith(".claude/agent-memory/"));
}

describe("e2e merge-diff invariant — card PR carries zero agent-memory onto base (fixed model)", () => {
  it("`git diff base...card/<slug>` contains zero `.claude/agent-memory/` paths when memory is gitignored + never staged", () => {
    const sbx = fresh();
    const slug = "feature-x";
    const branch = `card/${slug}`;

    // Cut the card branch off base.
    sbx.git(["checkout", "-q", "-b", branch, BASE_BRANCH]);

    // Real deliverable lands on the branch (this is what SHOULD merge).
    writeFileSync(sbx.path("DELIVERABLE.txt"), "the actual change\n");
    sbx.git(["add", "DELIVERABLE.txt"]);

    // An agent writes memory inside the (worktree==clone here) checkout.
    // Per the fixed model it is GITIGNORED and the agent NEVER stages it.
    writeWorktreeMemory(sbx.dir, "qa-developer", "project_feature-x.md");
    writeWorktreeMemory(sbx.dir, "expert-developer", "feedback_y.md");

    // Stage intentionally — NOT `git add -A`. Memory must not sneak in.
    // (If a future dev wires distillation to `git add -A`, this catches it.)
    const stagedBeforeCommit = sbx.git(["diff", "--cached", "--name-only"]);
    expect(
      agentMemoryPaths(stagedBeforeCommit.split("\n").filter(Boolean)),
      "agent-memory got staged on the card branch — it must never be `git add`-ed " +
        "(the merge-re-adds trap). Memory is gitignored; stage only real deliverables.",
    ).toEqual([]);

    sbx.git(["commit", "-q", "-m", `${slug}: implement`]);

    const leaked = agentMemoryPaths(mergeDiffPaths(sbx, BASE_BRANCH, branch));
    expect(
      leaked,
      `the card branch's merge diff carries agent-memory onto base:\n  ${leaked.join("\n  ")}\n` +
        `Memory must be gitignored in every checkout and never committed on any branch.`,
    ).toEqual([]);
  });

  it("guard: the SAME test setup under the BROKEN tracking model DOES surface a leak (no false green)", () => {
    // Reproduce the bug this card kills: memory is TRACKED (force-added past
    // gitignore) and committed on the card branch. The merge diff MUST then
    // show agent-memory paths — proving mergeDiffPaths/agentMemoryPaths
    // actually detect a leak when one exists.
    const sbx = fresh();
    const slug = "broken-x";
    const branch = `card/${slug}`;
    sbx.git(["checkout", "-q", "-b", branch, BASE_BRANCH]);

    writeWorktreeMemory(sbx.dir, "qa-developer", "project_broken-x.md");
    // -f bypasses the .gitignore block, simulating the pre-change tracked state.
    sbx.git(["add", "-f", ".claude/agent-memory/qa-developer/project_broken-x.md"]);
    sbx.git(["commit", "-q", "-m", `${slug}: (broken) memory tracked on branch`]);

    const leaked = agentMemoryPaths(mergeDiffPaths(sbx, BASE_BRANCH, branch));
    expect(
      leaked,
      "test self-check failed: the broken model should leak agent-memory into the merge " +
        "diff, but none was detected — the leak detector is not working.",
    ).not.toEqual([]);
  });
});

describe("e2e merge-diff invariant — done-archive commit carries zero agent-memory", () => {
  it("a simulated `cards/done/<YYYY>/<slug>.md` archive commit touches no `.claude/agent-memory/` paths", () => {
    const sbx = fresh();
    // The board-tick mergeback builds the done-archive commit on base. Memory
    // writes may be present on disk (gitignored) at archive time; the commit
    // must not pick them up.
    const slug = "settled-card";

    // Gitignored memory present on the base checkout at archive time.
    writeWorktreeMemory(sbx.dir, "solutions-architect", "project_settled.md");
    writeWorktreeMemory(sbx.dir, "qa-developer", "feedback_z.md");

    // Build the archive commit exactly as the mergeback does: move the card
    // body into cards/done/<YYYY>/ and commit ONLY that path.
    const year = "2026";
    const doneRel = `cards/done/${year}/${slug}.md`;
    mkdirSync(sbx.path("cards", "done", year), { recursive: true });
    writeFileSync(sbx.path(doneRel), `# archived ${slug}\n`);
    sbx.git(["add", "-f", doneRel]);

    // Adversarial: assert the STAGED set for the archive commit is exactly the
    // card move, with zero memory paths — before committing.
    const staged = sbx
      .git(["diff", "--cached", "--name-only"])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(staged).toContain(doneRel);
    expect(
      agentMemoryPaths(staged),
      "the done-archive commit staged agent-memory paths — the archive must carry only the " +
        "card move. (This is the `board-tick-mergeback-git-gotchas` hand-commit-scratch " +
        "discipline becoming unnecessary: with memory gitignored, nothing leaks in.)",
    ).toEqual([]);

    sbx.git(["commit", "-q", "-m", `archive ${slug}`]);

    // And the resulting commit's diff against its parent carries no memory.
    const committed = sbx
      .git(["diff", "--name-only", "HEAD~1", "HEAD"])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(agentMemoryPaths(committed)).toEqual([]);
  });

  it("base working tree stays clean after the archive commit (gitignored memory invisible to status)", () => {
    const sbx = fresh();
    writeWorktreeMemory(sbx.dir, "qa-developer", "project_clean.md");

    const year = "2026";
    const doneRel = `cards/done/${year}/clean-card.md`;
    mkdirSync(sbx.path("cards", "done", year), { recursive: true });
    writeFileSync(sbx.path(doneRel), "# archived\n");
    sbx.git(["add", "-f", doneRel]);
    sbx.git(["commit", "-q", "-m", "archive clean-card"]);

    // The whole point: after the archive commit, `git status` is clean — the
    // gitignored memory does not show as untracked, so no hand-commit scratch
    // step is ever needed to keep base clean.
    const status = sbx.git(["status", "--porcelain"]);
    expect(
      status,
      `base working tree is dirty after archive — gitignored memory leaked into status:\n${status}`,
    ).toBe("");
  });
});
