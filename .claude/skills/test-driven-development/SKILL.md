---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over. No exceptions.

## Using the qa-developer Agent

**IMPORTANT**: For writing tests, use the `qa-developer` agent via the Agent tool:

```
Agent tool → subagent_type: "qa-developer"
```

The qa-developer agent specializes in:
- Writing failing tests first (RED phase)
- Evaluating test quality and coverage
- Ensuring tests fail for the right reasons
- Following TDD best practices

**Always delegate test writing to qa-developer** rather than writing tests directly.

## When to Use

**Always:** Features, bug fixes, refactoring, behavior changes.

**Exceptions (ask human):** Throwaway prototypes, generated code, config files.

## Tier Selection

Every test belongs to a tier — unit, integration, or e2e. See `.claude/skills/adversarial-testing/references/testing-tiers.md` for the full definitions and decision tree.

When working from a kanban card, the tier is already chosen for you: each acceptance criterion is tagged `[unit|integration|e2e]`. Write the test in the file convention for that tier.

Without a card, pick by scope:
- Pure logic, no I/O → **unit**
- Component or service boundary → **integration**
- Full user flow through the running system → **e2e**

## Red-Green-Refactor

### RED - Write Failing Test (Use qa-developer agent)

**Invoke the qa-developer agent** to write the failing test:

```
Use Agent tool with subagent_type="qa-developer" and prompt:
"Write a failing test for [feature/bug description]"
```

Write one minimal test showing what should happen.

```typescript
test('retries failed operations 3 times', async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  };
  const result = await retryOperation(operation);
  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```

**Run test. Verify it fails for the right reason.**

### GREEN - Minimal Code

Write simplest code to pass:

```typescript
async function retryOperation<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  throw new Error('unreachable');
}
```

**Run test. Verify it passes. All tests still green.**

### REFACTOR - Clean Up

After green only: remove duplication, improve names, extract helpers.

Keep tests green. Don't add behavior.

**Repeat** for next feature.

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | One thing | `test('validates email and domain and whitespace')` |
| **Clear** | Name describes behavior | `test('test1')` |
| **Real** | Tests real code | Tests mock behavior |

## Example: Bug Fix

**Bug:** Empty email accepted

**RED:**
```typescript
test('rejects empty email', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});
```

**GREEN:**
```typescript
function submitForm(data: FormData) {
  if (!data.email?.trim()) {
    return { error: 'Email required' };
  }
}
```

## Verification Checklist

- [ ] Every function has a test
- [ ] Watched each test fail before implementing
- [ ] Wrote minimal code to pass
- [ ] All tests pass
- [ ] Mocks only if unavoidable
- [ ] Edge cases covered

Can't check all boxes? Start over with TDD.

## When Stuck

| Problem | Solution |
|---------|----------|
| Don't know how to test | Write wished-for API first |
| Test too complicated | Design too complicated |
| Must mock everything | Code too coupled |
| Test setup huge | Simplify design |

## References

- **Why TDD Matters**: See [references/why-tdd-matters.md](references/why-tdd-matters.md)
- **Testing Anti-Patterns**: See [testing-anti-patterns.md](testing-anti-patterns.md)

## Final Rule

```
Production code → test exists and failed first
Otherwise → not TDD
```

No exceptions without human permission.
