---
name: adversarial-testing
description: "Adversarial test generation and enforcement across unit, integration, and e2e tiers. Spawns qa-developer agents with clean context to write tests that challenge implementation. Tests are the specification — never adjusted to pass. Failed tests push back to coding agents. Use whenever writing, running, or adjusting tests."
---

# Adversarial Testing

## Philosophy

Tests are the specification. Implementation serves the tests, not the other way around.

```
TESTS ARE THE CONTRACT. IMPLEMENTATION IS THE SERVANT.
IF IMPLEMENTATION FAILS A TEST, THE IMPLEMENTATION IS WRONG.
NEVER WEAKEN A TEST TO MATCH BROKEN IMPLEMENTATION.
```

This skill is adversarial by design. The `qa-developer` agent acts as an independent auditor — hostile to shortcuts, suspicious of happy paths, relentless about edge cases. It exists to break things, not help them pass.

## When to Use

**Every testing operation routes through this skill:**

- Writing new tests (unit, integration, e2e)
- Running existing tests
- Evaluating test coverage
- Adjusting or modifying tests
- Investigating test failures
- Adding edge cases or regression tests

**Never bypass this skill for test operations.** Coding agents must not write, modify, or run tests directly. The `test-guard.sh` and `test-run-guard.sh` hooks enforce this.

## Core Rules

### 1. Clean Context — Always

Every `qa-developer` invocation starts with zero prior context. No inherited assumptions from coding agents. The agent loads requirements fresh from:

1. The kanban card (acceptance criteria, intent)
2. `docs/knowledge/INDEX.md` (then read matched docs) — existing contracts, flows, business rules
3. `docs/decisions/INDEX.md` (then read matched docs) — architectural choices that shape what to test
4. The code under test (interfaces only — not internals)

If the card lacks acceptance criteria, the `qa-developer` agent asks the user before writing a single test.

### 2. Never Adjust Tests to Pass

When a test fails:

- **DO NOT** weaken assertions to match actual behavior
- **DO NOT** add `skip` / `xfail` / `xit` / `todo` to make suites green
- **DO NOT** broaden expected values (e.g. `toBe(3)` → `toBeGreaterThan(0)`)
- **DO NOT** remove edge-case tests because they're "too strict"
- **DO NOT** mock away the problem instead of fixing the implementation

The ONLY valid reasons to modify a test:

- Requirements changed (confirmed by user or the card)
- Test has a genuine bug (wrong setup, typo, race in the test itself)
- Test tests implementation details instead of behavior (refactor to test behavior)

Even then, the `qa-developer` agent makes the change — never the coding agent.

### 3. Push Back to Coding Agents

When tests fail, the `qa-developer` agent produces a **failure report** and pushes back:

```
FAILURE REPORT
==============
Test:  <name>
Tier:  unit | integration | e2e
File:  <path>

Expected: <what the spec requires>
Actual:   <what the implementation produced>

Root cause: <why implementation is wrong>
Fix guidance: <what the implementation should change>

DO NOT MODIFY THIS TEST.
Fix the implementation to satisfy the specification.
```

The coding agent fixes the implementation and requests a re-run through this skill.

### 4. Three Testing Tiers

See [references/testing-tiers.md](references/testing-tiers.md) for details.

| Tier | Scope | Speed | Isolation |
|---|---|---|---|
| **Unit** | Single function/method | <100 ms | Full — no I/O, no network, no DB |
| **Integration** | Component boundaries, API contracts | <5 s | Partial — real dependencies, test DB |
| **E2E (Acceptance)** | Full user flows, business scenarios | <30 s | None — real system, real browser |

## Workflow

### Writing New Tests

Invoke the `qa-developer` agent with clean context:

```
Agent tool → subagent_type: "qa-developer"
Prompt: "Write adversarial [unit|integration|e2e] tests for [feature/module].
         Load requirements from the kanban card and docs/knowledge/ first (grep docs/knowledge/INDEX.md).
         Be adversarial — focus on edge cases, boundary conditions, error paths,
         and malformed inputs. Test what should break, not just what should work."
```

The agent:

1. Reads the card + `docs/knowledge/` + `docs/decisions/` (grep each folder's `INDEX.md`, then open matched docs)
2. Analyzes the specification — not the implementation
3. Writes tests for happy paths, error paths, edge cases, and boundaries
4. Runs tests to confirm they fail (RED) or pass against existing implementation
5. Reports results

### Running Tests

All test execution routes through `qa-developer`:

```
Agent tool → subagent_type: "qa-developer"
Prompt: "Run all [unit|integration|e2e] tests. Report failures with full context.
         Do not modify any tests. If tests fail, produce a failure report per test."
```

### Handling Failures

When coding agents report "tests are failing":

1. Do not let the coding agent touch the tests
2. Spawn a `qa-developer` agent to investigate
3. The `qa-developer` agent determines:
   - Is the test correct? → push back with a failure report
   - Is the test genuinely buggy? → fix the test (only the `qa-developer` agent)
   - Did requirements change? → confirm with user, then update test

### Modifying Existing Tests

Only the `qa-developer` agent modifies tests. Ever.

```
Agent tool → subagent_type: "qa-developer"
Prompt: "Review and update tests in [file/module]. Requirements may have changed:
         <describe change>. Load current requirements from the card and docs.
         Only modify tests where the specification has genuinely changed.
         Do not weaken any assertion."
```

## Adversarial Test Categories

### Boundary Conditions
- Empty inputs, null, undefined
- Maximum/minimum values
- Off-by-one (array bounds, pagination limits)
- Zero-length / single-character strings
- Negative numbers where positives expected

### Malformed Inputs
- Wrong types
- Missing required fields
- Extra unexpected fields
- Unicode edge cases (emoji, RTL, zero-width chars)
- SQL injection / XSS payloads in string inputs

### State & Timing
- Operations on uninitialized state
- Double-submit / idempotency
- Concurrent access patterns
- Timeout and cancellation
- Order-dependent operations

### Error Paths
- Network failures
- Permission denied
- Resource exhaustion (disk full, memory)
- Partial failures (3 of 5 items succeed)
- Cascading failures

### Security
- Authentication bypass attempts
- Authorization boundary tests
- Input sanitization
- Rate limiting
- CSRF / token validation

## Push-Back Protocol

See [references/push-back-protocol.md](references/push-back-protocol.md).

When a test fails:

1. `qa-developer` analyzes the failure
2. Produces a structured failure report
3. Sends the report to the coding agent
4. Coding agent fixes implementation (not tests)
5. Coding agent requests a re-run through this skill
6. Repeat until all tests pass

**Escalation:** If a coding agent modifies test files directly, `test-guard.sh` blocks the operation.

## Integration with Workflow

```
Brainstorm → Worktree → [adversarial-testing: write tests] → Build (GREEN) →
[adversarial-testing: run tests] → Verify Live → Quality Review → PR
```

- **Before implementation:** qa-developer writes failing tests (RED)
- **During implementation:** coding agents write code to pass tests (GREEN)
- **After implementation:** qa-developer runs full suite and adds adversarial edge cases
- **Before PR:** qa-developer does final coverage evaluation

## Coverage Evaluation

After implementation:

```
Agent tool → subagent_type: "qa-developer"
Prompt: "Evaluate test coverage for [module/feature]. Check:
         1. All public API methods have tests
         2. Happy path, error path, edge cases covered
         3. Integration boundaries tested
         4. E2E flows cover critical user journeys
         Report gaps. Write additional adversarial tests for the gaps."
```

## Verdicts

| Verdict | Meaning | Action |
|---|---|---|
| **PASS** | All tests pass, coverage adequate | Proceed to quality review |
| **FAIL** | Tests failing | Push back to coding agent |
| **GAPS** | Tests pass but coverage insufficient | Write additional tests |
