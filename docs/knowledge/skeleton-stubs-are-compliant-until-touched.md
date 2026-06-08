---
id: skeleton-stubs-are-compliant-until-touched
title: The sil_ping/sil_echo skeleton stubs are NOT a stub-free violation — de-stubbing is gated on touch
tags: [stub, skeleton, complete-work-is-stub-free, examples, copy-me, gotcha, review]
card: adopt-the-stub-free-rule
commit: 9b2aa18
updated_at: 2026-06-08
updated_by_card: adopt-the-stub-free-rule
---

The `sil_ping`/`sil_echo` stubs in `src/tools/examples.ts` do **not** violate the auto-loaded [`complete-work-is-stub-free.md`](../../.claude/rules/complete-work-is-stub-free.md) rule — do not flag them in review. The skeleton is the *unworked starting state*, not work taken to done; the rule de-stubs **on touch**, so a stub here becomes non-compliant only the moment a real tool is built on top of it.

## Why this needs recording

The rule and the skeleton are now **co-loaded** in every session (the rule auto-loads via `.claude/rules/*.md`; the skeleton is the whole repo's reason to exist — `CLAUDE.md`, "a skeleton... exists to be copied"). Reading "completed work is stub-free" next to two tools that `return stubResult(...)` invites the false conclusion that the repo ships a rule violation. It does not, and without this note the same reconciliation gets re-derived (or wrongly flagged) every time someone reads the two together. Neither the code nor the rule text states the reconciliation — each states only its own half.

## The reconciliation

Two facts that look contradictory but aren't:

- **The code half** (`src/tools/examples.ts:4`): the file is "THE PATTERN A DEVELOPER COPIES TO ADD A REAL TOOL." Both tools are deliberately the same shape, returning `stubResult(name, params)`, differing only in name/schema — so it is demonstrably a *pattern*, not one example. A real tool swaps `stubResult(...)` for `jsonResult(<real payload>)` once it has a backend (`examples.ts:22-23`).
- **The rule half** (`complete-work-is-stub-free.md`, "On touch, not big-bang"): de-stubbing is gated on **touch** — "a domain's stub is removed when that domain is next worked, as part of that work — never... deferred to a separate big-bang migration." "Done" and "still stubbed" are mutually exclusive *for work taken through development to done*.

They reconcile because **no tool here has been taken to done.** The skeleton is the pre-work baseline the rule explicitly leaves alone. Adopting the rule (card `adopt-the-stub-free-rule`) therefore touched **zero** `src/` code — it did not retroactively condemn the skeleton, and there is no behavior to test for the stubs (a test asserting they "comply" is exactly the test-theater the rule deletes).

## The trigger that flips compliance

A stub becomes non-compliant the instant a real tool is built on top of it. When you next work `examples.ts` (or any tool path) to add a real, backend-backed tool, **de-stub it first as part of that work** — `stubResult → jsonResult`, remove the placeholder, and do not leave or test a stub in the path you exercise. Until that touch, the stub is the correct, compliant starting state.
