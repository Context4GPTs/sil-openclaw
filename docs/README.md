---
id: docs-readme
title: Docs convention
tags: [meta, convention]
updated_at: 2026-05-21
---

# `docs/` — Repo Knowledge

Small, individually-addressable docs organized by area. One topic per file, frontmatter on every file, Obsidian-compatible (`[[wikilinks]]` resolve to file IDs).

## Folder taxonomy

| Folder | What lives here |
|---|---|
| `decisions/` | Cross-cutting choices that constrain future work (architecture, dependencies, contracts, naming). |
| `knowledge/` | Repo invariants, gotchas, non-obvious behavior. "X exists and behaves this non-obvious way." |
| `product/` | Product spec: flows, business rules, UX principles, glossary, personas. |
| `design/` | Brand identity, design tokens, screen specs. Owned by the `design-system` skill. Created lazily on the first UI card (SETUP mode); absent in a fresh repo until then. Consulted on every UI card once it exists. |

Add a new top-level folder only when an area is genuinely distinct and you expect ≥5 docs in it within the next quarter. Don't pre-create empty taxonomies.

## File anatomy

Every doc is a single Markdown file with this frontmatter:

```yaml
---
id: <kebab-slug>            # filename without .md, unique within the folder
title: <human-readable>     # shows in INDEX.md
tags: [<tag>, ...]          # lowercase, kebab-case; used for grep
card: <originating-slug>    # the kanban card that introduced this doc
commit: <sha>               # the commit that introduced this doc (full or short)
updated_at: <YYYY-MM-DD>    # last edit, ISO date
updated_by_card: <slug>     # the kanban card that last touched this doc
---
```

Body conventions:
- Lead with **one sentence** stating the fact / decision / invariant. The rest is rationale.
- Cross-reference with `[[other-doc-id]]` — Obsidian-style. Works across folders if IDs are globally unique; use `[[folder/id]]` if not.
- Cite code with `file:line` (e.g. `auth/session.py:42`).
- Keep individual docs short (target ≤150 lines). If a topic grows beyond that, split into linked siblings.

## `INDEX.md` per folder

Each folder has an `INDEX.md` table listing every doc in the folder, **sorted by `updated_at` descending** (newest first). The INDEX is maintained by hand (or by the `distillation` skill) as part of every write.

```markdown
| ID | Title | Tags | Updated |
|---|---|---|---|
| [[upstash-rate-limit]] | Use upstash redis for rate-limit counters | infra, redis | 2026-05-20 |
```

The INDEX is the **search entry point**. Agents grep the INDEX first, open the matched doc only if relevant.

## Write workflow (for agents)

When an agent has a new fact / decision / gotcha to capture:

1. **Pick the area** — `decisions`, `knowledge`, or `product`. If unsure, prefer `knowledge`.
2. **Search the INDEX**: `grep -i "<keyword>" docs/<area>/INDEX.md`. If multiple matches, read the candidate doc bodies.
3. **If a matching doc exists** → open it → update the body → bump frontmatter (`updated_at`, `commit`, `updated_by_card`). Update the INDEX row's `Updated` column. Re-sort the INDEX so newest is first.
4. **If no match exists** → create `docs/<area>/<kebab-slug>.md` with full frontmatter → add a new INDEX row at the top → commit both files together.
5. **Never edit cross-area** — a knowledge doc doesn't reach into decisions. If a single capture spans two areas, write two short docs and `[[link]]` them.

## Anti-patterns

- **Append-only mega-files** (the old `DECISIONS.md` / `KNOWLEDGE.md`) — don't recreate them.
- **One doc per card** — docs are organized by topic, not by card. Many cards may touch the same doc.
- **Empty stub docs** — only create a doc when you have something to write.
- **Renaming `id`** — once a doc exists, the `id` is its permanent address. Wikilinks would break. To "rename," supersede: write a new doc, mark the old one with `superseded_by: <new-id>` in frontmatter, remove from INDEX.

## Why this shape

- **Progressive disclosure** — agents only load the doc relevant to their current task, not a 2000-line append log.
- **Conflict-resistant** — parallel cards rarely touch the same doc, so merges don't churn.
- **Obsidian-readable** — the same vault works as a knowledge graph if a human wants to browse.
- **Searchable** — `grep INDEX.md` is fast; opening a single 100-line doc is cheap.

The `distillation` skill owns the workflow. See [`.claude/skills/distillation/SKILL.md`](../.claude/skills/distillation/SKILL.md).
