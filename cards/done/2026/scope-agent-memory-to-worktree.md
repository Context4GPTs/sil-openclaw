---
type: card
title: scope-agent-memory-to-worktree
slug: scope-agent-memory-to-worktree
work_type: chore          # feature | bug | refactor | chore | docs
tiers: [unit, integration, e2e]  # subset of [unit, integration, e2e] — set by solutions-architect during Discovery from the acceptance criteria below
status: done              # backlog | discovery | stand-by | in-dev | review | distilling | pr-ready | done | abandoned
agents: []                # current active agent set; updated by each handoff
priority: 2               # 1 = drop-everything, 2 = normal, 3 = nice-to-have
created: 2026-06-08
updated: 2026-06-08
base_branch: main         # the branch this card's worktree was cut from and the PR will target
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-scope-agent-memory-to-worktree
branch: card/scope-agent-memory-to-worktree
pr: https://github.com/Context4GPTs/sil-openclaw/pull/4  # set by devops-engineer at in-dev → review
merged_commit: c449fa6fed48d90ed6a7a447dffd98a4ef1d55cd  # set by /board-tick on PR-merge detection
epic_id: agent-memory-worktree-2026-06
---

## Intent (founder)

Agent memory currently lives as a tracked, real `.claude/agent-memory/` directory on the base branch, so sub-agents running inside a card worktree write into the base checkout and dirty `main` — which blocks the merge-back's `git pull --ff-only` and forces hand-commits (`board-sync.sh` papers over it today with a "agent-memory files only, benign — skip pull" branch). Make `.claude/agent-memory/` follow the exact model `cards/*.md` already uses: the real memory lives in the active card's worktree (tracked on the `card/<slug>` branch), the base checkout carries at most a gitignored symlink for Obsidian visibility, and `.claude/agent-memory/` is no longer tracked on base. Done means the base working tree stays clean throughout a board run, agent memory travels with the card it belongs to, and the board-sync benign-dirt workaround can be deleted.

## Epic notes (provisional — sibling Discovery owns the verdict)

Part of epic **`agent-memory-worktree-2026-06`** (siblings sil-openclaw, sil-services, sil-stage — the same cc-setup harness change in each). Cards already use the worktree-owned + gitignored-symlink model; this card brings `.claude/agent-memory/` into line with it. The notes below are a shallow, read-only starting hint from intake — Discovery owns the authoritative investigation and may revise or discard them.

**Likely change site (shallow guess):**
- `.gitignore` — add a `.claude/agent-memory/` block mirroring the existing `cards/*.md` symlink block (lines 6–9), with `!` exceptions for any committed scaffolding.
- Drop base tracking of existing memory: `git rm -r --cached .claude/agent-memory/` (Discovery decides whether existing content migrates into worktrees or is left as a frozen history snapshot).
- The memory **path resolution** — currently project-root-relative, so a sub-agent in a worktree writes into the *base* checkout's `.claude/agent-memory/`. Mirror the card mechanism (base `.claude/agent-memory/` becomes a gitignored symlink into the active worktree) or make the path worktree-relative. Candidate sites: agent launch / memory-write logic; `.claude/skills/repo-bootstrap/SKILL.md` (scaffolds `.claude/agent-memory/`).
- `.claude/scripts/board-sync.sh` — retire the "agent-memory files only, benign — skip pull" workaround once base stays clean.

**Unclear — Discovery to determine:** how merge-back should treat card-branch-tracked memory. Un-tracking on base while tracking on `card/<slug>` means a naive merge re-adds memory files to base (gitignore does not stop tracked-file merges). The resolution (separate ref, strip-at-merge, symlink-only-on-base, …) is Discovery's call.

**Acceptance (provisional):**
- Given an active card worktree, when a sub-agent writes agent memory during that card's work, then it lands in the worktree's `.claude/agent-memory/` (tracked on `card/<slug>`) and `git status` on the base checkout shows nothing.
- Given a board run, when `board-sync.sh` runs `git pull --ff-only` on base, then it is never blocked by agent-memory writes (the path is gitignored on base, like `cards/*.md`).
- Given Obsidian opens the base checkout, when viewing the active card's memory, then a gitignored symlink surfaces the worktree's memory (mirroring `cards/<slug>.md`).
- Given a card finishes, when its branch merges, then the base branch's `.claude/agent-memory/` is not littered with per-tick memory churn and the memory record persists with the card.

---

## Signals to orchestrator (append-only)

<!--
Any agent at any stage can append here when something matters one altitude up
to the orchestrator: a success criterion the PRD missed, a cross-card or
cross-sibling blocker, scope bleed, a reusable pattern, a duplicate-risk with
another card. Write what you know; the orchestrator decides what to do with it.

Format: - <YYYY-MM-DD> <agent> (<stage>) — <type>: <one-line body>

Types are open-ended; common ones: sc-candidate, blocked-on, duplicate-risk,
pattern, scope-bleed. Invent new types when the existing ones don't fit.

The orchestrator reads this every tick and records the signals it has acted on
in $MC/log/<goal_id>/, so entries are never deleted from here — they travel
with the card to cards/done/ or cards/abandoned/. Empty section is fine; the
orchestrator only reads when entries exist.
-->

- 2026-06-08 solutions-architect (discovery) — cross-sibling: the `.gitignore` agent-memory block, the `board-sync.sh` symlink shape, and the `repo-bootstrap/SKILL.md` reconciliation in this card must land byte-identical in the sil-services + sil-stage siblings of epic `agent-memory-worktree-2026-06`; keep them copy-pasteable. The `repo-bootstrap` edit in particular is a harness-contract fix shared verbatim across all cc-setup repos.
- 2026-06-08 solutions-architect (discovery) — premise-correction: `## Intent`'s "benign skip-pull branch in board-sync.sh" does not exist in this repo (verified: zero `agent-memory` refs in board-sync.sh; only a generic dirty-skip). The real workaround retired is the hand-commit-leftover-scratch discipline. If the founder copied the Intent text into the sibling cards, the same correction applies there.

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — solutions-architect, product-owner

<!-- Filled jointly by product-owner and solutions-architect. -->

### Approach + alternatives ruled out

**Chosen: make `.claude/agent-memory/` a gitignored-in-every-checkout, never-tracked, symlink-surfaced path — the *exact* model the live card already uses.** Concretely: (1) add a `.claude/agent-memory/` block to `.gitignore` that ignores the whole tree but keeps the per-agent `MEMORY.md` scaffolding visible (mirrors the `cards/*.md` + `!cards/_TEMPLATE.md` + `!cards/README.md` block at lines 6–9); (2) `git rm -r --cached .claude/agent-memory/` to drop base tracking; (3) `board-sync.sh` maintains a gitignored `.claude/agent-memory` **symlink on base → the single active worktree's copy** (one new symlink reconciled alongside the existing `cards/<slug>.md` symlink in Phases B/E, torn down in D). Memory then lives on-disk in whichever worktree the agent session is rooted in, is invisible to `git` on base, never merges, and Obsidian reads it through the symlink. This is the only variant under which acceptance B (memory travels with the card), C (base ff-pull never blocked; no scratch-commit), and D (Obsidian symlink) are all simultaneously true.

Why the symlink and not a worktree-relative path rewrite: the per-agent memory path is injected into each sub-agent prompt as an **absolute** `<session-root>/.claude/agent-memory/<agent>/` by a Claude Code platform built-in — there is no repo hook/settings file that computes it (confirmed: zero `agent-memory` refs in `.claude/hooks/` or `settings.json`). We cannot make it relative. But agents spawned *inside* a worktree session already get the worktree's own path, so the symlink is needed only for the base checkout's Obsidian view, exactly as with cards.

**Alternatives ruled out:**
- **Track memory on `card/<slug>`, let it merge to base via the PR** (the literal reading of `## Intent` "tracked on the card branch") — REJECTED: this re-introduces the merge-re-adds churn the card exists to kill. The live card itself is *not* tracked on its branch (verified: `git ls-files cards/` lists only scaffolding + `done/`); only the `cards/done/<YYYY>/` archive is. Mirroring cards faithfully means memory is gitignored-everywhere and never merges. (Reconciles criterion B — see the tier-tagged version below.)
- **Keep base tracking; strip `.claude/agent-memory/` at merge-back time** — REJECTED: adds a bespoke strip step to every mergeback, fights git instead of using gitignore, and leaves base dirty between ticks (the actual root cause). The card model proves you never need strip-at-merge if you never track the live artifact.
- **Move memory to a separate non-merging ref / orphan branch** — REJECTED: a whole new sync surface and teardown lifecycle for zero benefit over the symlink the harness already reconciles for cards. Maximal new machinery; YAGNI.
- **Per-card agent-memory symlink (1:1 with `cards/<slug>.md`)** — REJECTED: memory is per-*agent*, project-scoped, and accumulates across many cards (5 agent subdirs), not per-card. The base symlink is one link `.claude/agent-memory → <active-worktree>/.claude/agent-memory`, not one-per-card. (Resolves product-owner's open question on the cards/-analogy mismatch.)

### Affected files / surfaces

- **`.gitignore`** — add a `.claude/agent-memory/` block directly under the existing `cards/*.md` block (lines 6–9), same shape: ignore the tree, `!`-exempt the scaffolding the harness seeds. Decide the exempt set in dev — at minimum the per-agent `MEMORY.md` index files (so the agent-memory taxonomy/skeleton stays visible & shareable), or ignore everything (`.claude/agent-memory/`) if the team prefers a fully-local store. Note the broader `.claude/board-state.md` / `.claude/sync.log` ignores already live at lines 11–13; this is a sibling entry, not a new pattern.
- **Base git tracking** — `git rm -r --cached .claude/agent-memory/` to untrack the 13 currently-tracked files (`git ls-files .claude/agent-memory/`: 4 agent subdirs × MEMORY.md + notes). This is the one commit that lands on `main` via this card's PR. The on-disk copies stay; they become the base checkout's (now-gitignored) working copy until the symlink supersedes them.
- **`.claude/scripts/board-sync.sh`** — extend the symlink lifecycle to cover agent-memory, reusing the card-symlink code paths:
  - Phase B (`git worktree add` success) + Phase E (reconcile): after creating `cards/<slug>.md`, also ensure a base symlink `.claude/agent-memory → <wt>/.claude/agent-memory` when one is missing. Single link per active worktree, not per agent, not per card.
  - Phase D (teardown): `rm` the agent-memory symlink alongside the `cards/<slug>.md` symlink before `git worktree remove`.
  - Concurrency rule (NEW decision for dev): with 2+ active worktrees there is one base `.claude/agent-memory` slot. Point it at the most-recently-created active worktree (or leave whatever exists — first-wins) and document the choice in a WHY comment. Obsidian-visibility is best-effort; correctness of *writes* never depends on the base symlink (agents in a worktree write their own copy directly).
  - No change needed to Phase A's dirty-check — once base no longer tracks memory, agent writes are gitignored and the generic dirty-skip simply stops firing on their account.
- **`.claude/skills/repo-bootstrap/SKILL.md`** — currently INCONSISTENT with the target state and must be reconciled: line 43 lists `.claude/agent-memory/` as a "must-NOT-be-present / delete if found" cc-setup-only path, yet committed-mode `.gitignore` (the step-2 list, lines 91–99) does **not** ignore it — i.e. bootstrap's own contract would have memory tracked-on-base, the bug this card fixes. Update: add `.claude/agent-memory/` to the required `.gitignore` lines for **both** modes (step 2), and adjust the step-1 historical-leak / must-not-be-present guidance so a tracked `.claude/agent-memory/` is surfaced for `git rm --cached`, not silently expected.
- **Agent-memory path resolution** — NO code change. Confirmed the per-agent path is injected by a Claude Code platform built-in as an absolute `<session-root>/.claude/agent-memory/<agent>/`; no repo hook/settings file computes it (zero refs in `.claude/hooks/`, `.claude/settings.json`). Agents launched inside a worktree session already resolve to that worktree's copy. The Epic-notes "make the path worktree-relative" lever does not exist; the symlink is the mechanism.
- **`docs/`** — out of scope for dev; distillation (post-review) may add one `docs/knowledge/` note if the gitignore-everywhere-never-track-live invariant isn't already captured. Not a dev deliverable.

### Risks / failure modes

- **THE MERGE-RE-ADDS-TRACKED-FILES TRAP (the headline risk).** Un-tracking `.claude/agent-memory/` on base while *tracking* it on `card/<slug>` would NOT keep base clean: gitignore does not stop already-tracked files from merging, so the card's PR would re-add every memory file onto `main`, re-creating the exact churn this card removes (and worse — now per-card-divergent memory collides on merge). **How the chosen design avoids it:** memory is gitignored in **every** checkout (base *and* worktree) and is **never `git add`-ed on any branch** — identical to the live card (`git ls-files cards/` proves the live card is untracked; only `cards/done/<YYYY>/` is tracked). With nothing tracked-on-branch, there is nothing to merge; gitignore never has to "win" against a tracked file. This is why criterion B is tier-tagged as "lives in + travels-with the worktree, NOT merged to base via the PR" — the wording was reconciled to the architecture (see the note under Acceptance).
- **`git rm --cached` on a dirty memory tree.** If an agent has uncommitted memory edits in the base checkout when the untrack commit is built, `git rm -r --cached` is still safe (it only drops the index entry, leaves the file), but the dev must run it on a clean-enough base and verify `git status` after shows the files as untracked-and-ignored, not deleted. Test asserts post-state, not the command.
- **Stale base symlink target after teardown.** If Phase D removes a worktree but the agent-memory symlink reconcile misorders, a dangling `.claude/agent-memory` symlink could shadow the real on-disk memory on base (breaking the next non-worktree agent session's reads). Mitigation: mirror the existing dangling-`cards/*.md`-symlink cleanup (Phase E lines 143–145) for the agent-memory link, and only ever symlink when the target dir exists.
- **Concurrent-worktree Obsidian ambiguity.** One base slot, N active worktrees → Obsidian shows only one card's memory. This is acceptable (a visibility nicety, not correctness) but must be a documented WHY, or a future reader will "fix" it into per-card links and re-collide with the per-agent-cross-card reality.
- **Bootstrap drift across siblings.** sil-services and sil-stage carry the same `repo-bootstrap/SKILL.md`; fixing it here without the sibling cards doing the same leaves the harness contract inconsistent. Flagged to orchestrator (Signals) as a cross-sibling consistency item — the epic already scopes all three.
- **Scaffolding-exempt over-broad.** If the `!`-exempt set is too generous (e.g. `!**/project_*.md`), per-card project notes would leak back onto base tracking and re-introduce churn. Keep the exempt set to genuinely shared scaffolding (the `MEMORY.md` indices at most), or ignore the whole tree.

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.

product-owner framed the behavior; solutions-architect tagged tiers + reconciled storage claims (see notes on groups B and D, and the open-questions block).
-->

<!-- A. Base no longer tracks agent memory (the core delta) -->
- `[unit]` Given the base checkout on `main` after this card lands (no active card worktree), when `git ls-files .claude/agent-memory/` is run, then it lists no per-agent memory content (`feedback_*`, `project_*`, `reference_*`, etc.) — at most the `!`-exempt scaffolding (e.g. per-agent `MEMORY.md`), matching how `git ls-files cards/` lists no live card body, only the committed scaffolding (`_TEMPLATE.md`, `README.md`).
- `[unit]` Given the base checkout, when an agent (or anything) writes a non-scaffolding file under `.claude/agent-memory/`, then `git check-ignore -q` returns true for it and `git status` on base reports nothing to commit — the path is git-ignored, exactly as a stray `cards/<slug>.md` is ignored today.

<!-- B. The real memory lives in, and travels with, the active card worktree.
     RECONCILED by solutions-architect: the PO's first draft asserted memory is "tracked on
     card/<slug> and merges to base via the PR". That re-introduces the merge-re-adds churn this
     card exists to kill (gitignore does NOT block tracked-file merges). Mirroring the live card
     FAITHFULLY means gitignored-in-every-checkout + never-tracked-on-any-branch + never-merged —
     the memory "travels with the card" by living on-disk in that card's worktree, not by being a
     tracked, mergeable artifact. Behavioral intent (memory is co-located with the card; isolated
     across worktrees) is preserved; the storage claim is corrected. -->
- `[integration]` Given an active card worktree on `card/<slug>`, when a sub-agent rooted in that worktree writes agent memory during the card's work, then the file lands in the worktree's own `.claude/agent-memory/<agent>/` on disk (visible in `git -C <worktree> status` as gitignored/untracked, NOT staged for the card branch), so the memory record is co-located with the card for the life of the worktree — and `git diff <base>...card/<slug>` shows zero `.claude/agent-memory/` content, so the card's PR never carries memory onto base.
- `[integration]` Given two card worktrees active at once, when each runs sub-agents that write memory, then each worktree's memory is isolated to its own on-disk tree — neither writes into the base checkout nor into the other worktree — so concurrent board work cannot cross-contaminate memory.

<!-- C. board-sync's base ff-pull is never blocked by agent-memory writes -->
- `[integration]` Given a base checkout with gitignored agent-memory writes present on disk, when `board-sync.sh` Phase A runs its `git diff --quiet HEAD && git diff --cached --quiet` gate before `git pull --ff-only origin <base>`, then the gate sees a clean tree (the writes are git-ignored, invisible to `git diff`) and the pull proceeds — the run never hits `"$BASE: dirty working tree (skipped pull)"` on account of agent memory.
- `[e2e]` Given a full board run (sync → tick → a card's PR merges → done-archive), when the merge-back path builds the `cards/done/<YYYY>/<slug>.md` archive commit, then it carries only the card move + body with zero `.claude/agent-memory/` paths, and the prior discipline of hand-committing leftover memory scratch to keep base clean is no longer needed (and may be removed from the `board-tick-mergeback-git-gotchas` guidance) — the base working tree stays clean throughout the run.

<!-- D. Obsidian sees the active worktree's memory via ONE gitignored symlink.
     RECONCILED: not per-card (memory is per-agent/cross-card, not 1:1 with a card) — a single base
     link `.claude/agent-memory → <active-worktree>/.claude/agent-memory`. With 2+ worktrees one slot
     wins (documented WHY); writes never depend on it. -->
- `[integration]` Given exactly one active card worktree and no real `.claude/agent-memory/` dir shadowing it on base, when `board-sync.sh` Phase B/E reconciles, then a git-ignored symlink `.claude/agent-memory → <worktree>/.claude/agent-memory` exists on base so a reader (Obsidian) sees the active worktree's memory — mirroring the `cards/<slug>.md` symlink the same phases maintain.
- `[integration]` Given a card finishes and its worktree is torn down (upstream gone, card settled into `cards/done/`), when `board-sync.sh` Phase D/E reconciles, then the `.claude/agent-memory` symlink is removed and no dangling symlink remains — mirroring the existing dangling-`cards/*.md`-symlink cleanup at Phase E.

### Open questions (if any)

- PREMISE CORRECTION (resolved by Discovery, recorded so the dev pair and the sibling cards aren't misled): the `## Intent` says `board-sync.sh` "papers over it today with a 'agent-memory files only, benign — skip pull' branch." That carve-out does **not** exist in this repo's `board-sync.sh` — Phase A has only a generic dirty-tree skip, and `board-sync.sh` contains zero `agent-memory` references. The *actual* workaround being retired is the **hand-commit-the-scratch discipline** during merge-back (today `.claude/agent-memory/` is tracked, so the board-tick archive step must stage/commit leftover memory scratch to keep base clean — see the orchestrator's `board-tick-mergeback-git-gotchas` note). Criterion C2 is written against that real workaround. No founder input needed; this is a sharpening, not a blocker.
- For solutions-architect (mechanism, not behavior — flagged so the criteria above stay testable): criterion D assumes a per-card agent-memory symlink on base. But agent memory is **per-agent, project-scoped, and cross-card** (5 agent subdirs accumulate over many cards), whereas `cards/<slug>.md` is one file per card. So "the active card's memory" is not a clean 1:1 with a single card the way the card body is. Decide whether the base symlink points at *the* active worktree's `.claude/agent-memory/` (and what happens with 2+ concurrent worktrees — which one wins for Obsidian?), or whether memory is surfaced some other way. The behavior I assert (Obsidian can read the active card's memory; no dangling links) holds under whichever mechanism you pick; this note just flags that the cards/-symlink analogy is not exact.
  - **RESOLVED (solutions-architect):** one base symlink, not per-card — `.claude/agent-memory → <active-worktree>/.claude/agent-memory` (whole dir, all agent subdirs at once). The link is a single base "slot"; with 2+ concurrent worktrees it points at one (most-recently-reconciled / first-wins — dev picks and leaves a WHY comment). This is pure Obsidian-visibility; *write* correctness never depends on it, because each agent runs inside its worktree session and the platform injects that worktree's own absolute memory path. Criteria D1/D2 rewritten to single-link form. No founder input needed.
- ARCHITECT NOTE on acceptance B (recorded for founder visibility, not a blocker): the `## Intent` line "the real memory lives in the active card's worktree (tracked on the `card/<slug>` branch)" was taken literally in the PO's first draft. Discovery found the live **card** it cites as the model is itself NOT tracked on its branch — `cards/*.md` is gitignored in every checkout; only the `cards/done/<YYYY>/` archive is tracked. Faithfully mirroring cards therefore means agent-memory is **gitignored-everywhere and never merged**, which is also the only way to satisfy "base stays clean / workaround deletable". B's criteria were reconciled to that. If the founder truly wants memory *committed and merged per card* (a different model than cards use), that's a deliberate divergence to call out — but it would re-create the churn this card removes, so Discovery did not assume it.

<!-- escalate to founder if blocking -->

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**Where to start (smallest-first, each independently verifiable):**
1. `.gitignore` — add the `.claude/agent-memory/` block under the `cards/*.md` block (lines 6–9). Pick the exempt set: ignore the whole tree, or ignore-all-but the per-agent `MEMORY.md` indices. Keep the exempt set tight (scaffolding only) — see the "scaffolding-exempt over-broad" risk.
2. `git rm -r --cached .claude/agent-memory/` — the single untrack commit that lands on `main`. Verify after: `git status` shows the files untracked-and-ignored (NOT deleted from disk), `git ls-files .claude/agent-memory/` returns only the exempt scaffolding (or nothing).
3. `.claude/scripts/board-sync.sh` — add the agent-memory symlink to Phases B, D, E next to the existing `cards/<slug>.md` symlink logic (lines 59–64 create, 119–121 teardown, 131–145 reconcile). ONE link per active worktree (`.claude/agent-memory → <wt>/.claude/agent-memory`), only when the target dir exists and no real dir shadows it on base; remove on teardown; clean up if dangling. Phase A needs NO change — verify it stops dirty-skipping once base is untracked.
4. `.claude/skills/repo-bootstrap/SKILL.md` — reconcile its contract (it currently both says "delete agent-memory if present" at line 43 AND omits it from the committed-mode gitignore list at lines 91–99, which is self-contradictory). Add `.claude/agent-memory/` to the required gitignore lines for both modes (step 2); fix the step-1 must-not-be-present/historical-leak text so a tracked `.claude/agent-memory/` is flagged for `git rm --cached`.

**Constraints (do not violate):**
- **NEVER `git add` agent-memory content on any branch.** The whole design rests on memory being gitignored-in-every-checkout and never-tracked — identical to the live `cards/<slug>.md`. The moment memory is staged on `card/<slug>`, the merge-re-adds trap fires and base churn returns. (Distillation, which runs in-worktree, already stages only docs/source — never the card — so it is consistent with this; do not change that.)
- **Do NOT touch the agent-memory path injection** — it's a Claude Code platform built-in (absolute `<session-root>/.claude/agent-memory/<agent>/`), not a repo file. There is nothing to edit and no worktree-relative lever; the symlink is the only mechanism.
- This is a **harness/git-plumbing** card — no TypeScript, no `src/`, no `openclaw.plugin.json`. The plugin's build/test (`pnpm`) is untouched.

**Test strategy (tiers already tagged on each criterion):**
- `[unit]` — assert gitignore/tracking *properties* against real git: `git check-ignore -q .claude/agent-memory/<agent>/project_x.md` returns true; `git ls-files .claude/agent-memory/` excludes non-scaffolding. Fast, deterministic, no worktree needed.
- `[integration]` — exercise `board-sync.sh` against a throwaway temp git repo with a fake `card/*` worktree: assert the symlink is created on reconcile, removed on teardown, no dangling link survives, and the Phase-A clean-tree gate passes with gitignored memory writes present. qa-developer: drive the script directly (`bash board-sync.sh`) in a sandboxed `$TMPDIR` clone — do NOT run it against this real repo's worktrees.
- `[e2e]` — the full "base stays clean throughout a board run + done-archive carries no agent-memory paths" property. If a hermetic full-board-run harness is too heavy, qa may assert the merge-diff invariant directly: `git diff <base>...card/<slug>` (and a simulated done-archive commit) contain zero `.claude/agent-memory/` paths. Document whichever form is used.
- RED first (per `adversarial-testing`): the unit checks should FAIL on `main` today (memory IS tracked) and pass after step 2 — that red→green flip is the proof the untrack worked.

**Cross-sibling note:** this same change ships to sil-services and sil-stage under epic `agent-memory-worktree-2026-06`. Keep the `.gitignore` block, the `board-sync.sh` symlink shape, and the `repo-bootstrap` edit copy-pasteable so the siblings stay identical. (Signal logged to orchestrator.)

## In Dev — devops-engineer, qa-developer

### Implementation (devops-engineer)

All four steps shipped per the reconciled design (commit `2575fcb`; PR #4 → `main`). No `src/` production change — harness/git-plumbing only.

- **`.gitignore`** — `.claude/agent-memory` block under the `cards/*.md` block. **Exempt set = EMPTY** (whole tree, no `!`): the architect's "MEMORY.md indices at most, OR ignore everything" either/or resolves to ignore-everything because each agent's `MEMORY.md` is the *index of that agent's memories*, mutated on every write (living content, not a static skeleton), and there is no `.gitkeep`/`_TEMPLATE`/`README` inside `.claude/agent-memory/` to keep visible. Exempting `MEMORY.md` would dirty base on every write → re-block ff-pull → defeat criterion C. **NO trailing slash** (see the handoff finding).
- **Untrack** — `git rm -r --cached .claude/agent-memory/` (13 index entries). Verified post-state: 13 files still on disk; `check-ignore` exit 0; `ls-files` = 0; 0 untracked-not-ignored. Untrack + `.gitignore` in the SAME commit (no untracked-but-not-ignored window on `main`).
- **`board-sync.sh`** — `agent_memory_link()` helper; Phases B + E create, D removes-if-ours, E sweeps dangling. ONE base slot `.claude/agent-memory → <wt>/.claude/agent-memory`. Two subtle correctness points: (a) link text is `${wt#.claude/}/.claude/agent-memory` because the link is 2-deep and resolves relative to `.claude/` (verified by sandbox read-through); (b) `${wt%/}` canonicalization on both create and teardown-compare, because Phase B passes `$wt` slash-less but the D/E globs add a trailing slash — without it teardown's `readlink` compare misses and the link leaks. Teardown removes the slot only if `readlink` equals THIS worktree's text (never orphans another active worktree). First-wins concurrency, documented in a WHY header. `bash -n` + `shellcheck` clean.
- **`repo-bootstrap/SKILL.md`** — reconciled: agent-memory in the both-modes gitignore list (no slash, with rationale); removed from "delete if present"; added to the historical-leak check for `git rm -r --cached` when tracked.

### Test harness convention (qa-developer)

This is a harness/git-plumbing card — no `src/` app logic, so the tests assert git / gitignore / bash-script behavior. Chosen approach (lightest viable; record so review + distillation + the sibling cards reuse it):

- **vitest shells out to git/bash via `node:child_process`** (`execFileSync` / `cpSync`). This repo had no test that shelled out before; this card establishes the convention. The vitest tier file-name suffixes (`*.unit.test.ts`, `*.integration.test.ts`, `*.e2e.test.ts`) all match the existing `include: src/__tests__/**/*.test.ts` glob — no config change.
- **Unit** (`agent-memory-gitignore.unit.test.ts`): asserts git-tracking + git-ignore PROPERTIES against the **checkout the test runs in** (`git rev-parse --show-toplevel`, never a hardcoded path) — `git ls-files` empty, `git check-ignore` true for memory writes incl. MEMORY.md, plus a direct `.gitignore` pattern-shape check (no trailing slash). RED on `main`; GREEN after untrack + gitignore.
- **Integration** (`agent-memory-board-sync.integration.test.ts`) + **e2e** (`agent-memory-merge-clean.e2e.test.ts`): drive the real `board-sync.sh` / assert merge-diff invariants against **throwaway `$TMPDIR` git repos** built by the shared helper `src/__tests__/helpers/git-sandbox.ts` (bare origin + clone + real `git worktree add` of a `card/*` branch). **Never touch this repo's own worktrees.** Sandboxes use a non-protected base branch (`trunk`) + `commit.gpgsign false` for determinism and to stay clear of the repo's `pre-commit-guard` (which only intercepts the Bash *tool*, not vitest's child processes — confirmed).
- **e2e form** = merge-diff invariant (NOT a hermetic full-board-run), as the card's Test strategy explicitly authorizes. WHY: a real board run needs the Claude dispatcher + a live PR merge (non-hermetic, non-deterministic). The invariant the founder cares about (no `.claude/agent-memory/` ever crosses onto base via the card's PR diff or the done-archive commit) is fully captured deterministically; an embedded broken-model guard test proves the leak detector actually detects leaks (no false green).
- **Footgun for re-runners:** the worktree has no `node_modules`; run vitest via the main repo's binary with the worktree as cwd (symlink `node_modules` → main, or `pnpm install`). The symlink is gitignored.

### → Handoff to Review (next agent: code-quality-guardian)

**Adversarial finding caught + resolved during RED→GREEN (re-examine on the sibling cards):** a gitignore pattern with a **trailing slash** (`.claude/agent-memory/`) matches a directory but NOT the base **symlink** that `board-sync.sh` creates — so a trailing-slash rule leaves that symlink un-ignored, it surfaces as untracked, and Phase A's clean-tree gate skips the ff-pull = the exact bug acceptance group C exists to kill. The integration D1 test surfaced it; the fix is the slash-less form `.claude/agent-memory` (proven to ignore files-under-tree, MEMORY.md, the dir, AND the symlink). The implementation already ships the slash-less form — the sil-services + sil-stage siblings must use it too (do not copy a trailing-slash variant).

**Test files added (all on `card/<slug>`, committed alongside the impl):**
- `src/__tests__/agent-memory-gitignore.unit.test.ts` (10 tests — group A: ls-files empty, check-ignore true incl. MEMORY.md, cards-model anchor, trailing-slash guard)
- `src/__tests__/agent-memory-board-sync.integration.test.ts` (5 tests — D1 single-link ×2, D2 teardown+no-dangling, C1 Phase-A clean-gate, concurrent-worktree isolation)
- `src/__tests__/agent-memory-merge-clean.e2e.test.ts` (4 tests — C e2e merge-diff invariant + broken-model leak guard, done-archive zero-memory + base-stays-clean)
- `src/__tests__/helpers/git-sandbox.ts` (shared `$TMPDIR` sandbox helper)

19 new tests across the 3 files. Full suite green: 21 files / 225 tests. `pnpm typecheck` clean; tests excluded from `tsconfig.build.json`.

<!-- what to pay attention to, known smells -->

## Review round 1 — code-quality-guardian

**Verdict: PASS.** Harness/git-plumbing card reviewed against PR #4's diff (`main...card/scope-agent-memory-to-worktree`). Lenses calibrated to shell correctness, the gitignore-vs-symlink trap, test quality, acceptance coverage, and the hard-constraint audit — the app-code lenses (OWASP/types-at-boundaries/API/a11y) do not apply (no `src/` production code, no API, no UI). Every correctness-critical claim was verified empirically, not just read.

### What I verified (and how)

- **Shell correctness — `agent_memory_link()` + Phases B/D/E.** `bash -n` clean; `shellcheck` clean. The 2-deep relative link text `${wt#.claude/}/.claude/agent-memory` resolves correctly: built a throwaway tree with the link at `.claude/agent-memory` → it reads through to the worktree's dir, and the `../`-prefixed variant breaks — proving the shipped no-`../` form is the correct one (the link lives in `.claude/`, so it climbs no levels). `${wt%/}` canonicalization on both create (B) and teardown-compare (D) means the `readlink` equality check byte-matches despite Phase D's glob adding a trailing slash. `board-sync.sh:53-66, 101-103, 160-168, 190-204`.
- **Teardown never orphans another worktree's slot (the headline concurrency risk).** Reproduced both scenarios in isolation: (1) A holds slot → A tears down (removes its own via `readlink`-match) → Phase E re-points to surviving B (first-wins); (2) **B holds slot → A tears down → A's `readlink` compare fails to match → A leaves B's slot intact.** B's Obsidian view is preserved. The `readlink == this-worktree's-text` guard at `board-sync.sh:165-167` is exactly right. Dangling-sweep at `:202-204` mirrors the existing `cards/*.md` dangling cleanup.
- **The gitignore-vs-symlink trap.** Shipped form is slash-less `.claude/agent-memory` (`.gitignore:22`). Proven empirically: a trailing-slash pattern (`.claude/agent-memory/`) does NOT ignore the base symlink (`git check-ignore` → not ignored = untracked dirt that re-blocks Phase A's ff-pull = the exact bug this card kills), while the slash-less form ignores the symlink, files-under-tree, the dir, AND `MEMORY.md`. A real test (`agent-memory-gitignore.unit.test.ts:182-212`, "A2'") asserts the no-trailing-slash shape against the actual repo `.gitignore` — catching a regression the synthetic sandbox can't see.
- **Tests drive the REAL script, not a reimplementation.** `git-sandbox.ts` `runBoardSync()` `cpSync`s `BOARD_SYNC_SRC` (resolved relative to the test file) and runs it. Proven load-bearing by sabotage: commenting out the two `agent_memory_link` calls made the D1 integration tests go RED (2 failed) — so the tests genuinely exercise whatever the dev shipped. Sandboxes are `mkdtemp` `$TMPDIR` repos on a non-protected `trunk` base, `commit.gpgsign false`, torn down in `afterEach` — fully isolated from this repo's worktrees.
- **The red→green flip (the correctness proof).** Confirmed `git ls-tree main` tracks exactly **13** `.claude/agent-memory/**` files and main's `.gitignore` has **no** agent-memory entry → unit A1/A2 genuinely FAIL on `main`. On this branch: 0 tracked, path ignored → GREEN. The flip is real.
- **e2e merge-diff invariant + false-green guard.** The invariant form is explicitly authorized by the card's Test strategy. The broken-model self-check (`agent-memory-merge-clean.e2e.test.ts:109-130`) force-adds memory past gitignore and asserts the merge diff IS non-empty — a real guard proving the leak detector detects leaks. Done-archive tests assert both the staged set and the committed diff carry zero memory paths, and that base `git status` stays clean (closing the loop on the retired hand-commit-scratch discipline).
- **Acceptance coverage A/B/C/D.** All criteria map to passing tests. Full suite green: **21 files / 225 tests**; `pnpm typecheck` clean; tests excluded from `tsconfig.build.json`.
- **Hard-constraint audit.** Zero `.claude/agent-memory/` ADDs on the branch — exactly **13 deletions** (the untrack), nothing staged for add. No `src/` production change (only `src/__tests__/**`). Platform path-injection untouched (no `.claude/hooks/` or `settings.json` in the diff). `git rm -r --cached` + `.gitignore` land in the same commit (no untracked-but-not-ignored window on `main`).
- **Bloat / reuse / consistency.** `agent_memory_link()` mirrors the card-symlink pattern; the single-slot-vs-per-card semantic difference (with the first-wins WHY header) justifies the small helper over inlining — not needless duplication. `repo-bootstrap/SKILL.md` is now internally consistent: agent-memory removed from "delete-on-disk if present", added to the both-modes gitignore list (no slash + rationale), and folded into the historical-leak `git rm -r --cached` check. The prior self-contradiction (delete-if-present vs. omitted-from-gitignore) is fully resolved. The gitignore exempt set is correctly EMPTY (each `MEMORY.md` is living content, not static scaffolding).

### Non-blocking observations (no action required for this card)

- **P3 — pre-existing, out of scope:** the base `.gitignore` ignores `node_modules/` with a trailing slash, which (by the very mechanic this card documents) does not ignore a `node_modules` *symlink* — so the qa-developer footgun note's "The symlink is gitignored" is slightly inaccurate for the re-runner's symlink convenience. This is a test-runner ergonomics footnote, not part of the diff, and does not affect any shipped behavior. Mentioned only so the sibling cards' re-runners aren't surprised; no fix wanted here.
- **P3 — cross-sibling carry-forward (already signaled):** the slash-less `.gitignore` form, the `agent_memory_link()` shape, and the `repo-bootstrap` edit must land byte-identical in sil-services + sil-stage. The dev pair already flagged this; the trailing-slash trap is the one thing the siblings must not regress.

### → Handoff back to In Dev (if FAIL/REVIEW)

N/A — PASS. No fix list. Proceeds to distillation.

## Distillation — solutions-architect

<!-- Runs in the worktree on the card branch after Review PASS. Pushes to the same PR. Per the `distillation` skill: SEARCH docs/ INDEX files first; edit existing docs rather than creating duplicates. Captures land at smallest viable scope: inline WHY comments, docs/decisions/, docs/knowledge/, docs/product/, or CLAUDE.md. Then flips status to pr-ready. -->

## PR Ready

<!-- PR url; founder notification fires here -->

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
