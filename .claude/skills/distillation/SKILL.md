---
name: distillation
description: "Post-review stage skill: captures non-obvious learnings from a merged-ready card into the smallest viable scope (inline comment, docs/decisions/, docs/knowledge/, docs/product/, or CLAUDE.md). Always SEARCHES the existing docs before writing — finds and updates existing docs rather than creating duplicates. Owned by solutions-architect on the `review → distilling → pr-ready` transition."
---

# Distillation

The **final stage** of every card before PR-ready. Reads the merge diff + card body, captures what a future agent would need to know that the code and git log won't tell them, and writes those captures at the **smallest viable scope** using a **search-before-write** discipline.

## When It Runs

```
... → review (PASS) → distilling → pr-ready → (founder merges) → done
```

Runs **inside the worktree** on `card/<slug>`. Same branch as the implementation; the distillation commits land on the same PR. The dispatcher spawns `solutions-architect` at the `review → distilling` transition.

## The Question

> *If a future agent (or human) hits this same situation, what is the one thing they'd need to know that isn't already obvious from reading the code or the git log?*

If the answer is "nothing" — skip capture. **Many cards capture zero**, and that's correct. Over-capture is worse than under-capture.

## Phase 0 — Worktree Confirmation

```bash
git rev-parse --show-toplevel    # must be the worktree path, not the main checkout
git branch --show-current        # must be card/<slug>
```

If either is wrong: abort, re-spawn with `cd $worktree`. Distillation is **never** authorized on the base branch.

## Phase 1 — Read Everything

- The full card body in the worktree (Intent + every stage section).
- The **prospective merge diff** — what the open PR will land on `base_branch`. Compute with `git diff <base_branch>...HEAD` (three-dot range from the merge base). This is the same diff the PR shows; nothing is merged yet.
- The card's `## Discovery findings`, `## In Dev`, `## Review findings` sections.

## Phase 2 — Decide What to Capture

For each non-obvious thing the work did or established, pick **one scope** in order of preference:

| Scope | Use when | Lives where |
|---|---|---|
| **Inline WHY comment** | Insight applies to one line / function / block. | At the site of surprise, in the code. |
| **`docs/decisions/`** | Cross-cutting choice (architecture, contracts, dependencies, naming) that constrains future work. | New or existing doc in `docs/decisions/`. |
| **`docs/knowledge/`** | Repo invariant or gotcha — "X exists and behaves this non-obvious way." | New or existing doc in `docs/knowledge/`. |
| **`docs/product/`** | Flow, business rule, UX principle, glossary, persona. | New or existing doc in `docs/product/`. |
| **`CLAUDE.md`** | A new project-wide **convention** every future card should follow. | Inside the relevant CLAUDE.md section. |

Narrower beats broader. If an inline comment would do, use that. Reserve the docs folders for things multiple future cards will need.

## Phase 3 — Search Before You Write

This is the discipline that prevents the docs/ folders from drifting into hundreds of orphan files.

For each non-inline capture, **before creating a new doc**:

1. `grep -i "<keyword>" docs/<area>/INDEX.md` — does an INDEX row already match?
2. If yes → open the matched doc and read it. If the new capture **extends or contradicts** it, edit in place. Bump `updated_at`, `commit`, `updated_by_card`. Update the INDEX row's `Updated` column. Re-sort INDEX so the freshest row is at the top.
3. If no → only then create `docs/<area>/<kebab-slug>.md` with full frontmatter. Add a new INDEX row at the top. Commit both files in the same change.

Full procedure with examples lives in [`references/search-and-write.md`](references/search-and-write.md).

## Phase 4 — Write the Captures

Apply each capture at its chosen scope. Keep individual captures small:

- Inline comment: one line, WHY only, never WHAT.
- Doc body: ≤150 lines. Lead with one sentence stating the fact; rest is rationale.
- CLAUDE.md edit: insert in the existing relevant section, don't append blindly.

Frontmatter discipline on every new or edited doc:

```yaml
---
id: <kebab-slug>            # must match filename
title: <human-readable>
tags: [<tag>, ...]
card: <originating-card>    # the card that FIRST introduced this doc (don't change on updates)
commit: <sha>               # the commit that introduced or last meaningfully changed the doc
updated_at: <YYYY-MM-DD>
updated_by_card: <this-card-slug>
---
```

`commit` is bumped only when the doc body materially changes — not on a minor tag edit. `updated_at` and `updated_by_card` always bump.

## Phase 5 — Summarize on the Card

Append a `## Distillation` section to the card body:

```markdown
## Distillation — solutions-architect

- Inline: <file:line> — <why-comment>
- decisions/<doc-id>.md — <new doc or one-line summary of edit>
- knowledge/<doc-id>.md — <new doc or one-line summary of edit>
- product/<doc-id>.md — <new doc or one-line summary of edit>
- CLAUDE.md §<section> — <convention added/edited>
- INDEX.md updated: decisions, knowledge
```

If nothing was captured, write a single explicit line:

```markdown
## Distillation — solutions-architect

- (no non-obvious learnings — work was straightforward)
```

This makes "nothing to capture" an explicit positive signal, not a silent skip.

## Phase 6 — Commit and Push

1. Update card frontmatter: `status: pr-ready`, `agents: []`, `updated: <today>`.
2. `git add` the touched files. **Tracked mode:** the card + any docs touched + any inline-commented source files. **Gitignored mode** (`git check-ignore -q cards/<slug>.md` is true): stage **only** the docs and inline-commented source files — never the card; its distillation section stays a local-only edit on disk.
3. `git commit -m "distill: <slug>"`. In gitignored mode, if nothing tracked changed (the capture lived only on the card body), there is nothing to commit — skip the commit + push; the local `pr-ready` flip in step 1 is what the dispatcher reads.
4. `git push` — lands on the same PR opened at in-dev → review.
5. The dispatcher observes `status: pr-ready` on the next tick and fires the founder notification.

## What NOT to Capture

- Anything `git log -p` or `git blame` already tells you.
- Restatements of clearly-named code.
- Personal preferences ("I prefer X").
- Decisions that were never contested.
- "We did X" — only "we did X because Y".
- Anything already captured in an existing doc (the search-first phase exists to catch this).
- Card-specific implementation details — those belong in the card body, not in docs/.

## Hard Rules

- **Search before write.** Every non-inline capture grep's the relevant INDEX first.
- **Edit, don't duplicate.** A new doc is the last resort, not the default.
- **One topic per doc.** If a single capture spans two topics, write two short docs and `[[link]]` them.
- **INDEX stays sorted.** Newest `updated_at` at the top.
- **Distillation is not redesign.** Don't restructure docs during a distillation pass — that's a separate card.
- **No silent skips.** If nothing to capture, write the "(no non-obvious learnings)" line.

## Gotchas

- **Drift toward many tiny docs.** If you're tempted to create a 10-line doc, ask whether it could be appended to an existing one. The search step exists to surface that option.
- **Frontmatter copy-paste errors.** The `id` must match the filename, and the filename must be kebab-case. Wikilinks `[[id]]` break silently on mismatch.
- **`updated_by_card` confusion.** This is the *current* card touching the doc, even if the doc was originally written by a different card. `card` (without the prefix) is the originating card; do not rewrite it.
- **Skipping search on "obviously new" topics.** Agents tend to assume newness. Run grep anyway — the cost is ~1 grep, the benefit is the docs/ folder staying small.
- **Capturing into the wrong area.** If unsure between `knowledge/` and `decisions/`: was this a *choice* with alternatives? → `decisions/`. Was this an *invariant or gotcha* that exists in the code regardless of choice? → `knowledge/`.

## Reference

- [`references/search-and-write.md`](references/search-and-write.md) — full search procedure, worked examples, edge cases.
