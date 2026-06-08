---
type: card
title: sil-whoami-tool
slug: sil-whoami-tool
work_type: feature
tiers: []
status: backlog
agents: []
priority: 1
created: 2026-06-08
updated: 2026-06-08
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-sil-whoami-tool
branch: card/sil-whoami-tool
pr: null
merged_commit: null
epic_id: identity-plugin-tools
origin: goal:identity-onboarding-slice
---

## Intent (founder)

Implement the `sil_whoami` plugin tool for sil-openclaw. Reads the stored access token from `tokens.json` (written by `sil_register`), calls sil-api with `Authorization: Bearer <JWT>`, and returns the registered user's real identity data (name, addresses) from the database. If the token is expired, transparently refreshes via sil-web `POST /api/v1/auth/refresh` using the stored refresh token, updates `tokens.json` with the new pair, and retries. If not registered (no `tokens.json`), returns an error with a recovery hint to run `sil_register`.

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

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — <agents tag themselves here>

<!-- Filled jointly by product-owner and solutions-architect. -->

### Approach + alternatives ruled out

<!-- 1–3 lines per alternative, with the reason it lost -->

### Affected files / surfaces

<!-- bulleted list -->

### Risks / failure modes

<!-- bulleted list — what could break -->

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.
-->

### Open questions (if any)

<!-- escalate to founder if blocking -->

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

<!-- specific guidance for the dev pair: where to start, constraints,
test strategy -->

## In Dev — <agents>

<!-- implementation + test notes -->

### → Handoff to Review (next agent: code-quality-guardian)

<!-- what to pay attention to, known smells -->

## Review round 1 — code-quality-guardian

<!-- verdict + issues; runs against the open PR's diff (PR was opened by expert-developer at the in-dev → review transition) -->

### → Handoff back to In Dev (if FAIL/REVIEW)

<!-- fix list -->

## Distillation — solutions-architect

<!-- Runs in the worktree on the card branch after Review PASS. Pushes to the same PR. Per the `distillation` skill: SEARCH docs/ INDEX files first; edit existing docs rather than creating duplicates. Captures land at smallest viable scope: inline WHY comments, docs/decisions/, docs/knowledge/, docs/product/, or CLAUDE.md. Then flips status to pr-ready. -->

## PR Ready

<!-- PR url; founder notification fires here -->

## Epic notes (provisional — sibling Discovery owns the verdict)

**Likely change site:** `src/tools/identity.ts` — add `sil_whoami` tool to the existing `registerIdentityTools(api)` group (same file as `sil_register`); tool name added to `openclaw.plugin.json#contracts.tools`. Reuses the credential storage module from `sil_register` (`tokens.json`/`config.json`). Shallow guess — Discovery to confirm.

**Acceptance (from PRD per-surface):**
- `sil_whoami` calls sil-api with the stored Bearer JWT and returns real user identity data (name, addresses).
- Token refresh is transparent to the agent — if access token expired, the tool refreshes via sil-web and retries.
- Error (not registered): returns error envelope with recovery hint to run `sil_register`.
- Registered in manifest (`contracts.tools`).
