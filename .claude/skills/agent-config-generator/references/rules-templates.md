# Path-Specific Rules Templates

These templates generate `.claude/rules/` files with `paths` frontmatter.
Claude Code loads these rules automatically when the agent touches matching files.

## How to Use

The agent-config-generator selects applicable rule domains based on `analyze_repo.py`
output field `suggested_rules_domains`. For each domain, generate the corresponding
rule file in `.claude/rules/`.

---

## dependency-rules.md

```markdown
---
paths:
  - "**/package.json"
  - "**/pnpm-workspace.yaml"
  - "**/pnpm-lock.yaml"
  - "**/requirements.txt"
  - "**/requirements*.txt"
  - "**/pyproject.toml"
  - "**/go.mod"
  - "**/Cargo.toml"
  - "**/Gemfile"
---

# Dependency Rules

- Internal GitHub dependencies (same org) MUST use `git+https` URLs
- No npm shorthand (`org/repo`), no SSH (`git@github.com:`), no tarballs
- JS/TS format: `"git+https://github.com/OrgAds/package-name.git#branch"`
- Python format: `package @ git+https://github.com/OrgAds/repo.git@branch`
- Always pin to a branch (`#dev`, `#main`). Never bare URLs or tags.
- External (public registry) dependencies: pin exact versions
```

## api-rules.md

```markdown
---
paths:
  - src/api/**
  - src/routes/**
  - app/api/**
  - api/**
---

# API Rules

- Validate all input with schemas at the boundary
- Return appropriate HTTP status codes (don't wrap everything in 200)
- Include request ID in error responses
- Never expose internal errors to clients
- Auth checks happen before business logic
- Rate limiting on public endpoints
- Log errors with context: operation, input shape, suggested fix
```

## test-rules.md

```markdown
---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - __tests__/**
  - tests/**
  - test/**
---

# Test Rules

- Tests are the specification — never weaken tests to match broken implementation
- AAA pattern: Arrange, Act, Assert
- Each test is independent — no shared mutable state between tests
- Test behavior, not implementation — refactors must not break tests
- Name tests descriptively: `test_empty_cart_has_zero_total`
- Mock boundaries only (network, disk, clock) — never mock business logic
- Test edges: empty inputs, boundaries, malformed data, missing resources
```

## component-rules.md

```markdown
---
paths:
  - "**/components/**"
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/views/**"
  - "**/screens/**"
---

# Component Rules

- Accessibility first: semantic HTML, ARIA labels, keyboard navigation, focus management
- Composition over prop drilling — use context or compound components
- Server Components for data fetching, Client Components for interactivity
- No inline styles — use design system tokens
- Every interactive element has visible focus indicator
- Images have alt text, decorative images use alt=""
- Color contrast meets WCAG AA (4.5:1 text, 3:1 large text)
```

## infra-rules.md

```markdown
---
paths:
  - .github/**
  - Dockerfile
  - docker-compose*
  - "**/deploy/**"
  - "**/infra/**"
  - "**/*.tf"
---

# Infrastructure Rules

- Pin all GitHub Actions to full SHA hash with version comment
- Scan workflows with zizmor before committing
- Lint with actionlint
- No secrets in code or CI configs — use secret management
- Docker: pin base images to digest, run as non-root, multi-stage builds
- Every deploy is reversible
```

---

## critical-thinking.md

**Always generated.** This rule is not conditional on detected domains — it applies to every project. No `paths` frontmatter means it loads into every conversation, every file, every action.

```markdown
# Critical Thinking — All Changes

Before every change — code, docs, config, analysis, anything — answer silently:

1. **What problem does this solve?** State it in one sentence or stop — you don't understand it yet.
2. **Is the premise correct?** The user may be solving the wrong problem. Check the actual state first.
3. **Simpler alternative?** Could you solve this by removing something? Reusing what exists? Doing nothing?
4. **What breaks?** Name at least one failure mode. If you can't, you haven't thought hard enough.
5. **Pattern consistency?** Does this match how things already work, or does it introduce a new pattern without justification?
6. **Who said this is needed?** Trace the request to its origin. Is it the user's first instinct? A subagent's recommendation? Your own assumption? All three are suspect.

Push back immediately if the request would:
- Add complexity without articulable benefit
- Introduce an abstraction for a one-time use
- Add a dependency for something achievable in 20 lines
- Loosen types, swallow errors, or add silent failures
- Use hardcoded values that belong in configuration
- Add documentation that restates what the code already says
- Solve a hypothetical future problem instead of a real current one
```

---

## Domain Detection

`analyze_repo.py` suggests which rule domains apply:

| Signal | Domain |
|--------|--------|
| `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile` | dependency-rules |
| `src/api/`, `src/routes/`, `app/api/` dirs | api-rules |
| `*.test.*`, `*.spec.*`, `tests/` dir | test-rules |
| `*.tsx`, `*.jsx`, `components/` dir | component-rules |
| `.github/`, `Dockerfile`, `*.tf` | infra-rules |
