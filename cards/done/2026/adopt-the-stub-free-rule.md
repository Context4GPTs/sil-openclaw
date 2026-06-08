---
type: card
title: Adopt the stub-free rule
slug: adopt-the-stub-free-rule
work_type: chore
tiers: [unit]
status: done
agents: []
priority: 2
created: 2026-06-08
updated: 2026-06-08
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-adopt-the-stub-free-rule
branch: card/adopt-the-stub-free-rule
pr: https://github.com/Context4GPTs/sil-openclaw/pull/7
merged_commit: 8fb3228621f20fee3fbb97104cb98f933e39bf36
epic_id: stub-free-completion-2026-06
---

## Intent (founder)

Adopt the standing "completed work is stub-free" rule in sil-openclaw so every dev pair here auto-loads it, matching the parent orchestrator and the other sil siblings. sil-openclaw isn't otherwise touched by this epic — its `sil_ping`/`sil_echo` skeleton stubs are the deliberate copy-me pattern, de-stubbed on touch when a real tool replaces them — so this is a dedicated, config-only rule-adoption card.

## Epic notes (provisional — sibling Discovery owns the verdict)

**Epic** `stub-free-completion-2026-06` — adopt "completed work is stub-free" across the sil siblings + parent. Durable record: the `founder-directive / stub-free` Signal on sil-stage `cards/done/2026/stage-identity-e2e.md`.

**Likely change site (shallow guess — Discovery may overturn):**
- Add `.claude/rules/complete-work-is-stub-free.md` — copy the sil parent folder's `.claude/rules/complete-work-is-stub-free.md` (one level above this repo) verbatim. sil-openclaw already has `production-grade-first.md`, so only the new rule is added.
- Optionally reference it from the CLAUDE.md "Standards" section alongside the existing rule links — keep it minimal (Discovery's call).

**Draft acceptance (Given/When/Then — provisional):**
- Given the card merges, then `.claude/rules/complete-work-is-stub-free.md` exists in sil-openclaw, byte-identical to the parent's canonical copy, and auto-loads.

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

- 2026-06-08 product-owner (discovery) — sc-candidate: epic `stub-free-completion-2026-06` has no automated guard keeping the adopted rule byte-identical across siblings + parent. Each sibling copies the parent canonical copy at adoption time, but nothing detects later drift. Candidate epic-level follow-up: a periodic cross-sibling sha256 check of `.claude/rules/complete-work-is-stub-free.md` (out of scope for this config-only card).
- 2026-06-08 product-owner (discovery) — pattern: "adopt a standing parent rule into a sibling" is a repeatable shape for this epic — drop the byte-identical file into `.claude/rules/` (auto-load is glob-by-convention, no settings/manifest wiring) + optionally add a discoverability link in the sibling's `CLAUDE.md` Standards section. Other siblings adopting the rule can follow the same two-step.

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — product-owner, solutions-architect

<!-- Filled jointly by product-owner and solutions-architect. -->

**Premise check (product-owner).** Verified against this repo's state — the intent holds, with one nuance worth recording so the dev pair and reviewer don't misread it:

- The card asserts sil-openclaw is otherwise untouched by this epic because `sil_ping`/`sil_echo` are a **deliberate copy-me skeleton**, not work-in-progress to finish. Confirmed: `src/tools/examples.ts` is documented in-file as "THE PATTERN A DEVELOPER COPIES TO ADD A REAL TOOL," both tools return `stubResult(...)`, and `CLAUDE.md` frames the whole repo as "a skeleton... exists to be copied." These stubs are the product, not a debt.
- **Tension, and why it is not a real one:** the rule we are adopting says "completed work is stub-free." Do the skeleton stubs violate it? No — the same rule scopes de-stubbing **on touch**: "a domain's stub is removed when that domain is next worked... never deferred to a separate big-bang migration." No tool here has been "taken through development to done"; the skeleton is the unworked starting state. The stubs become non-compliant only the moment a real tool is built on top of one, at which point that work must de-stub it first. So adopting the rule does **not** retroactively condemn the skeleton, and this card correctly touches zero `src/` code. The reviewer should not flag `examples.ts` as a rule violation.

### Approach + alternatives ruled out

- **Chosen:** drop `.claude/rules/complete-work-is-stub-free.md` into this repo, byte-identical to the parent canonical copy (`../../.claude/rules/complete-work-is-stub-free.md`, sha256 `ee9eca6c…95ccd99`, 1677 bytes). The file's internal links to `production-grade-first.md` resolve correctly because that sibling rule is already present here. **Auto-load is glob-by-convention:** `.claude/settings.json` does not enumerate rules — the harness injects every `.claude/rules/*.md` as project instructions (all four existing rules are already injected this way). So presence of the file is sufficient for it to auto-load; no settings edit, no manifest entry, no wiring. (solutions-architect owns the final change-site/auto-load confirmation under Affected files.)
- **Alternative — author a sil-openclaw–specific variant of the rule:** rejected. The epic's intent is a *shared standing rule* across siblings + parent; a local fork would drift and defeat the point. The rule is already generic (it speaks of stubs/tests/NODE_ENV, not any one repo). Byte-identity is the feature.
- **Alternative — also add a behavioral test or CI check that asserts the skeleton stubs comply:** rejected as ceremony. The skeleton stubs are compliant precisely *because* they are untouched; there is no behavior to assert and `production-grade-first.md` rejects tests with no production value. (Tier framing below reflects this — see Acceptance criteria.)
- **Alternative — symlink to the parent rule instead of copying (solutions-architect):** rejected. The three rules already here are *real copies* — each byte-identical to the parent by SHA-256 (`production-grade-first.md` `388ee118…`, `critical-thinking.md` `1b629ecd…`, `railway-prod-safety.md` `ce58843b…`) — so symlinking would break the established convention. Worse, a symlink whose target sits one level *above* the repo root does not survive `git clone` / CI checkout / the OpenClaw publish payload; the repo must be self-contained. Copy is the only portable, convention-matching choice (and the drift it accepts is the cost — see Risks).

### Affected files / surfaces

**Change-site + auto-load confirmation (solutions-architect — confirmed, the shallow guess holds exactly).**

- **`.claude/rules/complete-work-is-stub-free.md`** — NEW. Byte-identical copy of the canonical source; this is the entire functional change.
  - **Byte-source (authoritative):** `/Users/knitlybak/GitHub/4gpts/sil/.claude/rules/complete-work-is-stub-free.md` — SHA-256 `ee9eca6cd2ea7627c1925d1961d11e242fd77bd557bddb95b60a5c6c195ccd99`, 1677 bytes. This exact text is also auto-injected into this repo's context (it auto-loads at the *parent* level), but copy from the parent **file on disk** — that is the byte-source, not the injected-context rendering (avoids a subtle whitespace/encoding mismatch).
  - **Git status — committed normally (unlike the card file):** `.claude/rules/` is git-tracked on this branch (`git ls-files` lists the three existing rules) and the new path is **not** gitignored (`git check-ignore` exits 1). The dev pair commits + pushes this file on `card/adopt-the-stub-free-rule` the normal way.
  - **Convention confirmed = copy, not symlink:** the three rules already here are each byte-identical to the parent by SHA-256 (`production-grade-first.md` `388ee118…`, `critical-thinking.md` `1b629ecd…`, `railway-prod-safety.md` `ce58843b…`). A symlink would break that convention and, pointing one level *above* the repo root, would not survive `git clone` / CI checkout / the OpenClaw publish payload. Use a real file copy.
  - **Relative link does not dangle:** the rule's only relative link is `[production-grade-first.md](./production-grade-first.md)`; that target already exists at `.claude/rules/production-grade-first.md` (verified). No other path in the file is repo-relative.
- **`CLAUDE.md` "Standards" section** — OPTIONAL one-line pointer (concur with product-owner: include it; it's the only human-visible signal the rule is active). **Not load-bearing** — proof: `railway-prod-safety.md` auto-loads today without being named in `CLAUDE.md`. Default include; dropping it fails no acceptance criterion.
- **No other surface.** No `settings.json` edit, no hook, no manifest/`contracts.tools` entry, no `src/` change. Verified the auto-load is pure file-presence convention: neither this repo's nor the parent's `settings.json` mentions the rules dir, and no hook enumerates it — the harness injects every `.claude/rules/*.md` as project instructions.

### Risks / failure modes

_Architecture/portability angle (solutions-architect):_
- **Wrong placement → silent no-load.** If the file lands at repo-root or with a typo in name/extension instead of `.claude/rules/complete-work-is-stub-free.md`, it simply won't be injected and nothing errors. Mitigation: exact destination path is in the Handoff; verify by confirming the rule text appears in a fresh session's project-instructions block.
- **Byte-source confusion.** Copying from the injected-context *rendering* rather than the parent *file on disk* risks a whitespace/encoding mismatch that fails the byte-identity criterion. Mitigation: copy the file at the authoritative path, then `diff`/`shasum` against it.
- **No drift guard is by design, not omission.** Adding a byte-identity check over `.claude/rules/` that reaches a path *above* the repo root would be non-portable ceremony, out of scope here. Drift is the accepted cost of the copy convention (see the rejected symlink alternative).

_Product/intent angle (product-owner):_
- **Drift from the canonical parent copy.** The rule's value is that it is *the same* rule everywhere; a future local edit (or a parent edit that doesn't propagate) silently forks it. There is no automated guard keeping the copies in sync. Mitigation: adopt byte-identical now and treat any future change to this rule as a parent-first edit that fans out — the byte-identity acceptance criterion is the checkable anchor. (A periodic cross-sibling hash check is a candidate epic-level follow-up, out of scope for this card — flagged to orchestrator below.)
- **Contributors don't notice the rule is auto-loaded.** Because auto-load is glob-by-convention (no enumeration to read), a human skimming `.claude/settings.json` won't see the rule listed and may assume it's inert. Mitigation: add the rule to the `CLAUDE.md` "Standards" section's rule links alongside `production-grade-first.md`, purely for human discoverability — this is the only reason to touch CLAUDE.md; it is *not* a load mechanism.
- **Skeleton stubs misread as a rule violation.** Once this rule is auto-loaded, a future agent or reviewer could flag `src/tools/examples.ts` as "completed work that is still stubbed." It is not (see Premise check) — the skeleton is unworked, and the rule de-stubs on touch. Mitigation: the Premise-check note above is the durable record; the distillation stage should consider lifting it into `docs/knowledge/` so the reasoning outlives this card.

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.
-->

_Behavioral framing by product-owner; tiers tagged by solutions-architect (resolved below the list)._

**Honesty note:** this card adds one static config file. The deliverable is the *presence and byte-identity* of a rule file, not runtime behavior. There is no product code path to exercise, so the criteria below are existence/identity assertions, not behavioral tests of the system. Per `production-grade-first.md` and the rule being adopted, we deliberately add **no** test that asserts the skeleton stubs "comply" — that would be ceremony with no production value. (Tier question — whether *any* committed automated test earns its keep — is resolved in the Tier-resolution note after the list: no, these are lightweight `[unit]`-altitude static checks run once during Dev, not vitest files.)

- `[unit]` Given the card merges, when the repo's `.claude/rules/` directory is listed, then `complete-work-is-stub-free.md` is present.
- `[unit]` Given the file is present, when its bytes are compared to the parent canonical copy at `../../.claude/rules/complete-work-is-stub-free.md`, then they are identical (sha256 `ee9eca6c…95ccd99`, 1677 bytes).
- `[unit]` Given the file is present, when a Claude Code session starts in this repo, then the rule is auto-loaded as project instructions. (Satisfied by glob-by-convention: presence in `.claude/rules/*.md` is sufficient — verified the same way the existing four rules are already injected; there is no settings/manifest entry to assert.)
- `[unit]` Given the rule references `production-grade-first.md` via a relative link, when the file is added, then that link resolves — the target sibling rule already exists in this repo's `.claude/rules/`.
- `[unit]` Given the rule is adopted, when `src/tools/examples.ts` is inspected, then it is unchanged by this card — the skeleton stubs remain (compliant-until-touched, not a violation). Negative/scope guard: this card touches zero `src/` code.

**Tier resolution (solutions-architect — answering the honesty note above).** All five are tagged `[unit]` — the lightest tier, fitting pure static-content / existence / scope assertions. They are **verified once by hand during Dev** (an `ls`, a `shasum`/`diff`, a link-existence check, a `git diff --stat` showing zero `src/` change, and an observational "rule text appears in a fresh session's project-instructions"). **No committed automated test is added, and none should be:** there is no runtime behavior to exercise, no existing drift-guard pattern over `.claude/rules/` to extend, and a persistent test that hashes a path one level *above* the repo root would itself be non-portable — exactly the ceremony `production-grade-first.md` and `complete-work-is-stub-free.md` reject. `[unit]` here means "a lightweight static check at the unit altitude," not "write a vitest." `tiers:` frontmatter set to `[unit]` (the union of tiers used).

### Open questions (if any)

<!-- escalate to founder if blocking -->

None blocking. Two assumptions recorded in lieu of founder questions (this stage never asks):

- **ASSUMPTION:** the parent folder's `.claude/rules/complete-work-is-stub-free.md` is *the* canonical byte source for all siblings (vs. an already-adopted sibling being canonical). Defensible because the parent `CLAUDE.md` describes the parent as the orchestration root that "bakes [production-grade-first] into every card," the rules live there as the cross-sibling source, and a cross-check found no sibling has adopted it yet — so the parent copy is the only canonical candidate. If the founder later designates a different canonical source, the fix is a one-line re-copy.
- **ASSUMPTION:** referencing the rule from `CLAUDE.md` "Standards" is *in scope* for this card (the Intent calls it "optional... Discovery's call"). Recorded decision: **do it**, because auto-load is invisible in `settings.json` and the link is the only signal a human contributor gets that the rule is active. It is a one-line addition mirroring the existing `production-grade-first.md` link, not ceremony. The architect/dev pair may drop it if they judge the discoverability benefit absent, but the default is to include it.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**This is a config-only chore. Do not add test theater.**

1. **The one functional change — copy the byte-source, preserving bytes exactly:**
   - Source: `/Users/knitlybak/GitHub/4gpts/sil/.claude/rules/complete-work-is-stub-free.md` (SHA-256 `ee9eca6cd2ea7627c1925d1961d11e242fd77bd557bddb95b60a5c6c195ccd99`, 1677 bytes).
   - Destination: `.claude/rules/complete-work-is-stub-free.md` (in this worktree, on `card/adopt-the-stub-free-rule`).
   - Use a real file copy (e.g. `cp`), **not** a symlink. Then `shasum -a 256` / `diff` source vs destination to prove byte-identity.
   - This file is git-tracked and not gitignored — `git add` + commit + push it normally (contrast the card file, which is gitignored).
2. **Optional pointer:** add `complete-work-is-stub-free.md` to the named-rules sentence in `CLAUDE.md` "Standards" (one line, alongside `critical-thinking.md` / `production-grade-first.md`). Default: include (human discoverability — auto-load is invisible in `settings.json`). Skip only if you want a minimal diff; not load-bearing.
3. **Verify auto-load (this is the acceptance, not a committed test):** confirm the new rule's text appears in the project-instructions context the same way the existing three rules do. The relative link `./production-grade-first.md` already resolves — sibling rule is present.
4. **Do NOT touch `src/`.** No `examples.ts` change, no manifest/`contracts.tools` entry, no `settings.json`/hook change. Per product-owner's premise check, the `sil_ping`/`sil_echo` skeleton stubs are the deliberate copy-me pattern and are rule-compliant *because untouched*; adopting this rule does not retroactively condemn them. Reviewer should not flag `examples.ts`.

**qa-developer test strategy (honest — read this before reaching for the test runner):** there is **nothing to RED-test** in the vitest sense. This is a static markdown file with no runtime behavior, and there is no existing drift-guard pattern over `.claude/rules/` to extend (the integration tests guard the plugin manifest/`contracts.tools`, not the rules dir). A committed test that hashes a file one level above the repo root would be non-portable and is exactly the ceremony both `production-grade-first.md` and `complete-work-is-stub-free.md` reject. Acceptance is the five `[unit]`-tier static checks above, performed once during Dev: file present, byte-identical (`shasum`/`diff`), link resolves, `src/` untouched (`git diff --stat`), and rule auto-loads in a fresh session's context. qa-developer's contribution is confirming those, not authoring a test file. If `pnpm test` is run at all, it is only to confirm the existing suite stays green (no regression from the config change) — which it must, since `src/` is untouched.

## In Dev — expert-developer, qa-developer

**The one functional change landed exactly as Discovery specified.** `.claude/rules/complete-work-is-stub-free.md` was created by a real `cp` from the parent byte-source `/Users/knitlybak/GitHub/4gpts/sil/.claude/rules/complete-work-is-stub-free.md`. Byte-identity proven three ways:

- `shasum -a 256` of source AND destination both = `ee9eca6cd2ea7627c1925d1961d11e242fd77bd557bddb95b60a5c6c195ccd99`
- `wc -c` of destination = `1677` (matches the expected 1677 bytes)
- `diff source dest` exits 0 (byte-identical, silent)
- Destination is a **regular file, not a symlink** (`[ -L ... ]` false) — matches the convention of the three existing rules.

**Optional pointer included (Discovery default).** Folded `complete-work-is-stub-free.md` into the existing named-rules sentence in `CLAUDE.md` "Standards", mirroring the existing `[…](./.claude/rules/…)` link style. One line; purely for human discoverability. Not load-bearing — auto-load is glob-by-convention.

**Auto-load verified by convention, not wiring.** `.claude/settings.json` has no `rules` reference (grep confirms); the harness injects every `.claude/rules/*.md` as project instructions. All four rules now present in `.claude/rules/`. The rule's only relative link `./production-grade-first.md` resolves to the existing sibling rule.

**Test approach — no test theater, as Discovery directed.** There is no runtime behavior to RED-test for a static markdown rule, and no existing drift-guard over `.claude/rules/` to extend. No vitest file was added. Acceptance was the five `[unit]`-altitude static checks, each performed once during Dev (all pass): file present, byte-identical, link resolves, `src/` untouched (`git diff --stat` clean of `src/`), auto-load by convention. `pnpm install` then `pnpm test` confirms the **existing** suite stays green: **23 files / 250 tests pass** — `src/` is untouched so it must, and does.

**Live-verification: skipped per the skill's own gate** — this is a config/docs-only change (no `src/` production code modified; build is `tsc`-only over untouched `src/`). The 250-test green run is the regression gate.

**Nothing surprising.** Discovery's premise check, change-site confirmation, and tier resolution all held exactly. Zero `src/` change; the gitignored card stayed local-only; only the tracked rule file + the one-line `CLAUDE.md` edit were committed.

### → Handoff to Review (next agent: code-quality-guardian)

**Config-only chore — runs against PR #7 (https://github.com/Context4GPTs/sil-openclaw/pull/7).** The diff is exactly two files: the new `.claude/rules/complete-work-is-stub-free.md` (33 lines, byte-identical to the parent canonical copy) and a one-line `CLAUDE.md` "Standards" addition. No `src/`, no tests, no `settings.json`/manifest/hook changes.

What to check:
- **Byte-identity is the acceptance** — if you re-verify, `shasum -a 256 .claude/rules/complete-work-is-stub-free.md` must be `ee9eca6c…95ccd99` (1677 bytes), matching `../../.claude/rules/complete-work-is-stub-free.md`. It's a real copy, not a symlink (a symlink above the repo root wouldn't survive clone/CI/publish — see Discovery's rejected alternative).
- **Do NOT flag `src/tools/examples.ts`.** The `sil_ping`/`sil_echo` skeleton stubs are the deliberate copy-me pattern and are rule-compliant *because untouched* (the rule de-stubs on touch, not retroactively). This is the explicit premise check; adopting the rule does not condemn the skeleton. This card touches zero `src/` code by design.
- **No test was added, by design** — there is no runtime behavior to assert and no drift-guard pattern over `.claude/rules/` to extend. A persistent test hashing a path one level above the repo root would be non-portable ceremony, which `production-grade-first.md` and the very rule being adopted reject. The existing 250-test suite stays green.

No known smells. Deliberate trade-off (Discovery-blessed): the copy convention accepts future drift from the parent with no automated cross-sibling guard — a candidate epic-level follow-up flagged to the orchestrator, out of scope here.

## Review round 1 — code-quality-guardian

**Verdict: PASS.** Config-only chore, reviewed against PR #7's diff (base `main` ← `card/adopt-the-stub-free-rule`). The diff is exactly the two files Discovery and In Dev specified — `.claude/rules/complete-work-is-stub-free.md` (NEW, +33) and a one-line `CLAUDE.md` "Standards" edit (+1/−1) — and every claim in the In Dev handoff re-verifies independently. No P1/P2/P3 findings.

**Deliverable verification (re-run, not taken on trust):**
- **Byte-identity holds** — `shasum -a 256 .claude/rules/complete-work-is-stub-free.md` = `ee9eca6cd2ea7627c1925d1961d11e242fd77bd557bddb95b60a5c6c195ccd99`, identical to the parent canonical source `/Users/knitlybak/GitHub/4gpts/sil/.claude/rules/complete-work-is-stub-free.md`; `wc -c` = 1677 on both; `diff src dst` exits 0 (silent). This byte-identity is the deliverable's entire value, and it is exact.
- **Real file, not a symlink** — `[ -L ]` false; `-rw-r--r-- … 1677 … complete-work-is-stub-free.md`. Matches the convention of the three pre-existing rules and survives clone/CI/publish (the rejected-symlink concern from Discovery does not apply).
- **Git state correct** — tracked on the branch, not gitignored (so it commits + ships normally, unlike the gitignored card file).
- **Relative link resolves** — the file's only repo-relative link `./production-grade-first.md` points to an existing sibling rule in `.claude/rules/`; no dangling link.

**`CLAUDE.md` edit — clean, minimal, in-style:** the new rule link is folded into the existing Oxford-comma rules sentence using the identical `[`…`](./.claude/rules/…)` link style, and the prose ordinals are correctly re-numbered ("the latter" → "the second … the third …"). Well-formed markdown, no scope bleed, no broken links.

**Scope + regression:**
- **Diff contains nothing unexpected** — `gh pr view 7` confirms exactly 2 files; zero `src/` changes; no `settings.json` / `openclaw.plugin.json` / hook / `package.json` / `tsconfig` changes.
- **`src/tools/examples.ts` is correctly untouched** — the `sil_ping`/`sil_echo` skeleton stubs are the deliberate copy-me pattern, rule-compliant *because untouched* (the rule de-stubs on touch, not retroactively). Not flagged, per Discovery's premise check.
- **No test added — correct, not a gap.** A markdown rule has no runtime behavior to assert, and a persistent test hashing a path one level above the repo root would be non-portable ceremony that `production-grade-first.md` and the very rule being adopted reject. Acceptance is the five `[unit]`-altitude static checks, all of which I re-verified above.
- **Existing suite green** — `pnpm test`: 23 files / 250 tests pass. `src/` is untouched, so no regression, confirmed.

**Tier coverage:** `tiers: [unit]` matches the acceptance criteria's tags and the (deliberately test-free) nature of a static-config chore. No mismatch.

**Knowledge capture:** No Review-level gap. The one non-obvious piece of reasoning (why the skeleton stubs are not a stub-free violation) is already richly recorded in the card's Premise check, and Discovery explicitly flagged lifting it into `docs/knowledge/` as a distillation-stage consideration — correctly deferred to the next stage, not a finding here.

Transitioning to `distilling` (solutions-architect owns next). Did not merge or close the PR — humans merge.

### → Handoff back to In Dev (if FAIL/REVIEW)

N/A — PASS, no rework required.

## Distillation — solutions-architect

- **knowledge/skeleton-stubs-are-compliant-until-touched.md** — NEW. Captures the one invariant Discovery + Review both earmarked: the `sil_ping`/`sil_echo` skeleton stubs in `src/tools/examples.ts` are **not** a `complete-work-is-stub-free` violation — the skeleton is the unworked starting state and de-stubbing is gated on touch, so a stub here becomes non-compliant only when a real tool is built on top of it. Records *why* this needs saying (the rule and the skeleton are now co-loaded, so the false "ships a rule violation" reading gets re-derived/re-flagged otherwise) and the trigger that flips compliance (next time the tool path is worked, de-stub first). Cites `examples.ts:4` and `:22-23` and the rule's "On touch, not big-bang" section; cross-links the rule. Not derivable from either the code or the rule alone — each states only its own half.
- **INDEX.md updated: knowledge** — new row added at top (freshest `2026-06-08` write).
- **No inline comment, no other scope.** `examples.ts` already documents the copy-me pattern and the `stubResult → jsonResult` on-touch swap in its header; this card touches **zero `src/`** by design, so a code comment about a rule that doesn't condemn the file would be diff-expanding, code-restating ceremony (`production-grade-first.md`). The merge diff itself (the two config files: the byte-identical rule + the one-line `CLAUDE.md` pointer) holds nothing else non-obvious — its reasoning is already fully in the card body. `docs/knowledge/` is the correct and only capture.

## PR Ready

<!-- PR url; founder notification fires here -->

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
