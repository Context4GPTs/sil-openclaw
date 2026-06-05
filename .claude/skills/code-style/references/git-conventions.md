# Git Conventions

## Commit Messages

Format: `<type>(<scope>): <description>`

### Types

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change (no bug fix, no new feature) |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks |
| `style` | Code style changes (formatting) |
| `perf` | Performance improvements |

### Examples

```
feat(auth): add JWT token validation
fix(api): handle empty response from payment service
refactor(db): simplify query builder interface
docs(readme): update installation instructions
test(auth): add integration tests for login flow
chore(deps): update lodash to 4.17.21
```

## Branch Names

Format: `<type>/<short-description>`

### Examples

```
feat/add-user-authentication
fix/login-timeout-issue
refactor/database-layer
docs/api-documentation
```

## Knowledge Capture in Commits

Per the `distillation` skill, every non-trivial change captures its learning at the smallest viable scope:

- An inline WHY comment at the change site (narrow scope)
- A new or updated doc under `docs/decisions/` (cross-cutting choices)
- A new or updated doc under `docs/knowledge/` (repo-level gotchas or invariants)
- A new or updated doc under `docs/product/` (flows, business rules, UX principles)

Search the relevant `INDEX.md` before creating a new doc — prefer editing an existing one.

Stage those edits in the **same commit** as the code they document — not a separate commit. They do not need their own commit type.

## PR Titles

Same format as commit messages:

```
feat(auth): implement OAuth2 login flow
fix(checkout): correct tax calculation for EU
```
