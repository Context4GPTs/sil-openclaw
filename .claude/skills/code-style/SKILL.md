---
name: code-style
description: Enforce code style conventions for formatting, naming, comments, and git conventions. This skill activates when editing code files to ensure consistent style across the codebase.
---

# Code Style Guide

## Overview

Enforces consistent code style conventions. Activates automatically when editing code files.

## Quick Reference

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | `kebab-case` | `user-service.ts` |
| Classes | `PascalCase` | `UserService` |
| Functions | `camelCase` / `snake_case` | `getUser` / `get_user` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES` |
| Private | Prefix with `_` | `_internalState` |

### Formatting

| File Type | Indentation |
|-----------|-------------|
| JSON, YAML, HTML, CSS | 2 spaces |
| Python | 4 spaces |
| JavaScript/TypeScript | 2 spaces |
| Go | tabs |

- **Line length**: 100 chars (code), 80 chars (comments)
- **Whitespace**: No trailing, single newline at EOF

### Import Organization

Three groups, separated by blank lines:
1. Standard library
2. Third-party packages
3. Local modules

### Comments

- Comment **why**, not **what**
- No obvious comments ("loop through users")
- Use docstrings for public APIs

### Error Messages

```python
# Good - specific with context
raise ValueError(f"User ID must be non-empty string, got: {repr(user_id)}")

# Bad - vague
raise ValueError("Invalid input")
```

## Language-Specific Guides

Load **only** the reference that matches the file extension you're editing. Loading all three is wasteful and the conventions can conflict.

| File extension | Load |
|---|---|
| `*.py` | [references/language-python.md](references/language-python.md) |
| `*.js`, `*.jsx`, `*.ts`, `*.tsx`, `*.mjs`, `*.cjs` | [references/language-javascript.md](references/language-javascript.md) |
| `*.go` | [references/language-go.md](references/language-go.md) |
| Anything else | Stay with the Quick Reference above — no language-specific load. |

## Git Conventions

See [references/git-conventions.md](references/git-conventions.md) for commit messages, branch naming, and PR titles.

## Auto-Formatting

PostToolUse hooks run formatters automatically (see `.claude/settings.json` → `PostToolUse` Edit|Write):

| Language | Formatter |
|----------|-----------|
| Python | `ruff format` (preferred), falls back to `black` |
| JS/TS | `prettier` |
| Go | `gofmt` |

## Style Checklist

- [ ] Consistent indentation
- [ ] Line lengths within limits
- [ ] Naming follows conventions
- [ ] Imports organized in groups
- [ ] Comments explain WHY
- [ ] Error messages specific
- [ ] Commit message format correct
