# Agent Config Templates

Templates for generating CLAUDE.md and AGENTS.md files. Each template combines
the base standards from `base-standards.md` with project-specific sections.

## CLAUDE.md Structure

Every generated CLAUDE.md follows this structure. The base standards sections
come from `base-standards.md` and are included verbatim. The project-specific
sections are discovered by analyzing the target repo.

```
┌─────────────────────────────┐
│  # Development Standards    │
│                             │
│  ## Critical Thinking Proto. │  ← base-standards.md (verbatim)
│  ## Philosophy              │  ← base-standards.md (verbatim)
│  ## Dependencies            │  ← base-standards.md (verbatim)
│  ## Code Quality Hard Limits│  ← base-standards.md (verbatim)
│  ## Error Handling          │  ← base-standards.md (verbatim)
│  ## Testing                 │  ← base-standards.md (verbatim)
│  ## CLI Tool Preferences    │  ← base-standards.md (filtered by stack)
│  ## Commits and PRs         │  ← base-standards.md (verbatim)
│  ## Code Review Order       │  ← base-standards.md (verbatim)
│  ## Completion Protocol     │  ← base-standards.md (verbatim)
│  ## Context Management      │  ← base-standards.md (verbatim)
│  ## Agent Teams             │  ← base-standards.md (verbatim)
│  ## Sandboxing              │  ← base-standards.md (verbatim)
│  ## GitHub Actions          │  ← base-standards.md (if applicable)
└─────────────────────────────┘
```

If the file exceeds 150 lines, move Context Management, Agent Teams, and
Sandboxing to `agent_docs/workflow-standards.md` and reference it.

---

## CLI Tool Preferences — Stack Filtering

Always include these universal rows:

| Purpose | Tool | Replaces |
|---------|------|----------|
| File search | `fd` | find |
| Code search | `rg` (ripgrep) | grep |
| Structural code search | `ast-grep` | regex hacks |
| Deletion | `trash` | rm -rf |

Add these based on detected stack:

**Python detected:**

| Purpose | Tool | Replaces |
|---------|------|----------|
| Linting (Python) | `ruff check` | pylint, flake8 |
| Formatting (Python) | `ruff format` | black |
| Types (Python) | `ty check` | mypy, pyright |
| Package mgmt (Python) | `uv` | pip, poetry |

**JS/TS detected:**

| Purpose | Tool | Replaces |
|---------|------|----------|
| Linting (JS/TS) | `oxlint` | eslint |
| Formatting (JS/TS) | `oxfmt` | prettier |
| Testing (JS/TS) | `vitest` | jest |

**Shell scripts detected:**

| Purpose | Tool | Replaces |
|---------|------|----------|
| Shell linting | `shellcheck` | manual review |
| Shell formatting | `shfmt` | manual |

**GitHub Actions detected:**

| Purpose | Tool | Replaces |
|---------|------|----------|
| GitHub Actions linting | `actionlint` | manual |
| GitHub Actions security | `zizmor` | manual |

---

## AGENTS.md Templates

### Universal Template

```markdown
# AGENTS.md

## Role
Expert [technology] developer with deep knowledge of [domain].

## Project
[Project name]: [One sentence description]

## Commands

### Development
- Start: `[command]`
- Build: `[command]`

### Testing
- All tests: `[command]`
- Single file: `[command] path/to/file.test.ts`
- Watch: `[command] --watch path/to/file.test.ts`

### Code Quality
- Lint: `[command] path/to/file.ts`
- Format: `[command] path/to/file.ts`
- Type check: `[command] path/to/file.ts`

## Style

Prefer:
```typescript
// Good: explicit, typed
function processUser(user: User): Result {
  if (!user.isActive) return { error: 'inactive' }
  return { data: transform(user) }
}
```

Avoid:
```typescript
// Bad: implicit, untyped
function processUser(user) {
  return user.isActive ? { data: transform(user) } : { error: 'inactive' }
}
```

## Git
- Branches: `feat/`, `fix/`, `refactor/`, `docs/`
- Commits: `type(scope): description`

## Boundaries

### Always
- Run relevant tests before marking work complete
- Use file-scoped commands over project-wide

### Ask First
- Architectural changes
- New dependencies
- Database migrations

### Never
- Commit secrets (`.env`, API keys, tokens)
- Modify `vendor/`, `generated/`, `node_modules/`
- Force push to main/master
- Run destructive operations without approval
```

### API/Backend Focused

```markdown
# AGENTS.md

## Role
Backend engineer specializing in [framework] APIs and [database] databases.

## Project
[Name]: RESTful/GraphQL API for [purpose].

## Commands

### Server
- Dev: `[command]`
- Prod: `[command]`

### Database
- Migrate: `[command]`
- Seed: `[command]`
- Reset: `[command]` (destructive)

### Testing
- Unit: `[command] tests/unit/`
- Integration: `[command] tests/integration/`
- Single: `[command] tests/path/to/test.ts`

### Quality
- Lint: `[command] src/path/to/file.ts`
- Type: `[command] src/path/to/file.ts`

## Patterns

### Request Handlers
```typescript
export async function handler(req: Request): Promise<Response> {
  const validated = schema.parse(await req.json())
  const result = await service.process(validated)
  return Response.json(result)
}
```

### Error Handling
```typescript
if (!resource) {
  throw new NotFoundError('Resource not found', { id })
}
```

## Boundaries

### Always
- Validate all input with schemas
- Return appropriate HTTP status codes
- Log errors with context

### Ask First
- Schema changes
- New endpoints
- Authentication changes

### Never
- Expose internal errors to clients
- Skip input validation
- Store passwords in plain text
```

---

## Stack-Specific Sections

### For React Projects
```markdown
## Component Patterns
- Server Components for data fetching
- Client Components for interactivity
- Composition over prop drilling

## Performance
- Use `next/dynamic` for heavy components
- Prefer `next/image` over `<img>`
- Avoid barrel imports from large libraries
```

### For Python Projects
```markdown
## Type Hints
- All public functions must have type hints
- Use `TypedDict` for complex dictionaries
- Prefer `dataclass` over plain dicts

## Testing
- Use `pytest` with fixtures
- Mock external services
- Test edge cases explicitly
```

### For Go Projects
```markdown
## Error Handling
- Always check errors
- Wrap errors with context: `fmt.Errorf("doing x: %w", err)`
- Return early on errors

## Testing
- Table-driven tests for multiple cases
- Use `testify` for assertions
- Mock interfaces, not implementations
```

### For Rust Projects
```markdown
## Error Handling
- Use `Result<T, E>` — never `unwrap()` in production code
- Use `thiserror` for library errors, `anyhow` for application errors
- Propagate errors with `?` operator

## Testing
- Unit tests in `#[cfg(test)]` modules alongside code
- Integration tests in `tests/` directory
- Use `proptest` for property-based testing
```

### For Ruby Projects
```markdown
## Style
- Follow community style guide (enforced by RuboCop)
- Prefer `frozen_string_literal: true` in all files
- Use keyword arguments for methods with 3+ parameters

## Testing
- RSpec with `describe`/`context`/`it` nesting
- Use `let` for lazy-evaluated test data
- Use `FactoryBot` for test fixtures, not raw fixtures
```

---

## Monorepo-Specific Sections

```markdown
## Package Boundaries
- `packages/shared/` - Types and utilities used by multiple packages
- `packages/ui/` - React components, no business logic
- `apps/*/` - Application-specific code

## Dependencies
- Shared deps in root `package.json`
- App-specific deps in app `package.json`
- Never duplicate versions

## Testing
- Test affected: `pnpm test --filter ...[HEAD^1]`
- Test package: `pnpm --filter @scope/package test`
```
