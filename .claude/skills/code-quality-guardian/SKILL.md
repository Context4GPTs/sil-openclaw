---
name: code-quality-guardian
description: "Comprehensive code review after TDD completion. Enforces strict type safety, structured error logging (code-logging skill), security (OWASP), performance, complexity, bloat, code reuse, anti-pattern detection, refactor-consolidation analysis, API design, and accessibility. Issues PASS/REVIEW/FAIL verdict before PR creation."
---

# Code Quality Guardian

## Overview

Comprehensive post-TDD quality gate. Issues verdict: **PASS**, **REVIEW**, or **FAIL**.

## When to Use

- After TDD Red-Green-Refactor cycle AND live verification
- In the kanban flow: the PR is already open (expert-developer opens it at the in-dev → review transition). You review against the open PR's diff (`git diff <base_branch>...HEAD`).
- When asked to review code quality, security, or architecture

## Prerequisite: Live Verification

Before running this quality review, confirm live verification has passed. The `live-verification` skill must have been run (or skipped with documented reason). This ensures we're reviewing code that actually works as a running system, not just code that compiles and passes unit tests.

If live verification was skipped, note the reason in the review output.

## Review Workflow

### 1. Gather Context

```bash
# Use the card's base_branch from frontmatter (typically main or dev) — not a hardcoded branch name.
BASE_BRANCH=$(grep '^base_branch:' "cards/<slug>.md" | awk '{print $2}')
git diff --name-only "$BASE_BRANCH"...HEAD
git diff --stat "$BASE_BRANCH"...HEAD
```

Identify: file types, modules affected, public APIs changed, tests added.

### Reference Loading Strategy

Load reference files ONLY for dimensions relevant to the changed file types. Do NOT read all references upfront.

| File Types Changed | Load These References |
|---|---|
| Backend (.py, .ts, .js, .go, .rs, .java) | security-review, error-handling, performance-review, api-design, logging-observability |
| Frontend (.tsx, .jsx, .css, .html) | security-review, performance-review |
| Any code | bad-patterns, refactor-review, pattern-guide |

Read a reference ONLY when a finding in that dimension needs deeper investigation -- not before starting the review.

### 2. Security Audit (OWASP-Based)

See [references/security-review.md](references/security-review.md) for complete checklist.

**Critical checks:**
- Input validation at system boundaries
- SQL/command/LDAP injection prevention
- XSS prevention (output encoding)
- Authentication & session handling
- Secrets management
- Access control enforcement
- Cryptographic practices

Security issues cause automatic **FAIL**.

### 3. Type Safety Audit (MANDATORY)

**This check is MANDATORY.** All code must be type-safe with strict mode enabled.

**Requirements:**
- TypeScript: `strict: true` in tsconfig.json (enables all strict checks)
- Python: Type hints on all function signatures, run `mypy --strict` or `pyright`
- Go: No `interface{}` without explicit type assertion
- Other languages: Use strongest available type system features

**Check for:**
- Missing type annotations on function parameters and return types
- Use of `any` type (TypeScript) - each use must be justified with a comment
- Implicit `any` from untyped imports
- Missing null/undefined checks (use strict null checks)
- Type assertions without runtime validation at boundaries
- Generic types without constraints where constraints apply

**Type Safety Violations = FAIL**

| Severity | Issue | Action |
|----------|-------|--------|
| FAIL | Missing types on public API | Add explicit types |
| FAIL | `any` without justification | Replace with proper type or add comment |
| FAIL | Disabled strict mode | Enable strict mode |
| REVIEW | Complex union types | Consider discriminated unions |
| REVIEW | Excessive type assertions | Refactor to avoid |

### 4. Error Handling & Logging Audit

See [references/error-handling.md](references/error-handling.md) for patterns and anti-patterns.
**For logging standards, use the `code-logging` skill** which covers structured logging, required fields, and context propagation.

**Error Handling - Evaluate:**
- Exception specificity (no bare `except:`)
- Error propagation strategy (preserve context with `from e` or `cause`)
- Error message quality (specific, actionable, no sensitive data)
- Graceful degradation
- Recovery mechanisms
- User-facing error messages (helpful, not exposing internals)

**Error Logging - MANDATORY Requirements:**
- All errors MUST be logged with structured format (JSON key-value pairs)
- Required fields: `timestamp`, `level`, `event`, `request_id/trace_id`, `service`, `environment`
- Include high-cardinality fields: `user_id`, `request_id`, `transaction_id` (when available)
- Error logs MUST include: error type, error message, stack trace, and relevant context
- NO sensitive data in logs (passwords, tokens, PII)
- Use appropriate log levels: `error` for failures needing attention, `warn` for handled issues

**Examples:**
```typescript
// BAD - Unstructured, no context
console.log("Payment failed");

// GOOD - Structured with context
logger.error({
  event: "payment_failed",
  user_id: userId,
  transaction_id: txnId,
  error_type: error.name,
  error_message: error.message,
  amount: payment.amount,
  request_id: context.requestId
});
```

Silent error swallowing = **FAIL**.
Missing error logging = **FAIL**.
Unstructured error logs in production code = **REVIEW**.

### 5. Performance Review

See [references/performance-review.md](references/performance-review.md) for detailed guidance.

**Check for:**
- N+1 query patterns
- Missing database indexes
- Unbounded operations (loops, recursion)
- Memory leaks (unclosed resources, growing collections)
- Blocking operations in async code
- Missing pagination for large datasets
- Excessive object creation in hot paths
- Missing caching for expensive computations

### 6. Complexity Analysis

| Metric | OK | Warning | Fail |
|--------|-----|---------|------|
| Function length | < 20 | 20-40 | > 40 |
| Cyclomatic complexity | 1-5 | 6-10 | > 10 |
| Nesting depth | 1-2 | 3 | > 3 |
| Parameters | 1-3 | 4-5 | > 5 |
| Class responsibilities | 1 (SRP) | 2 | > 2 |

### 7. Code Reuse Analysis

- Duplicated logic that exists elsewhere
- Existing utilities that could be used
- Parallel implementations of same concept
- Opportunities for shared abstractions

### 8. Legacy Code & Backwards Compatibility Detection

**This check is MANDATORY.** Legacy code and backwards compatibility are not tolerated.

**Flag any of the following:**
- Deprecated APIs or methods (marked `@deprecated` or using outdated patterns)
- Compatibility shims for older environments/browsers/runtimes
- Polyfills for features natively supported by target environment
- Version-gated code paths (`if (version < X)`)
- Legacy wrappers that call through to modern implementations
- Fallback chains (`try modern; catch use legacy`)
- Feature detection branching (`if (feature) { modern } else { legacy }`)
- Re-exports of old function/type names for backwards compatibility
- Renamed but unused variables (`_oldName`) kept for compatibility
- Comments indicating legacy support (`// for backwards compatibility`, `// legacy`)
- Migration code that should have been removed
- Old API endpoints kept alongside new ones

**Legacy code = FAIL**
**Backwards compatibility hacks = FAIL**

### 9. Hardcoded Values Detection (MANDATORY)

**This check is MANDATORY.** No hardcoded values are tolerated. Use environment variables, configuration files, or constants with clear provenance.

**Flag any of the following:**
- Magic numbers (unexplained numeric literals in logic)
- Hardcoded URLs, hostnames, or ports
- Hardcoded file paths (absolute or environment-specific)
- Inline credentials, API keys, tokens (also covered by Security Audit)
- Hardcoded timeouts, retry counts, or limits without named constants
- Embedded email addresses, phone numbers, or contact info
- Environment-specific values (dev/staging/prod URLs, database names)
- Hardcoded feature flags or toggle values
- Inline regex patterns without named constants for non-trivial expressions
- Currency amounts, tax rates, or business-rule numbers without named constants
- Hardcoded error messages that should come from a message catalog or i18n

**Acceptable exceptions (not flagged):**
- `0`, `1`, `-1` in standard idioms (loop init, increment, sentinel)
- Boolean literals `true`/`false`
- Empty string `""` for initialization
- Mathematical constants used in obvious context (e.g., `360` for degrees, `100` for percentage)
- Test fixtures with inline values (test files only)

**How to fix:**
```typescript
// FAIL - Magic numbers and hardcoded config
const timeout = 5000;
const apiUrl = "https://api.example.com/v2";
const maxRetries = 3;
if (score > 0.85) { /* ... */ }

// PASS - Named constants from config
const SCORE_THRESHOLD = config.get("SCORE_THRESHOLD");
const timeout = env.API_TIMEOUT_MS;
const apiUrl = env.API_BASE_URL;
const maxRetries = env.MAX_RETRIES;
if (score > SCORE_THRESHOLD) { /* ... */ }
```

```python
# FAIL - Hardcoded business rules
def calculate_tax(amount: float) -> float:
    return amount * 0.21

# PASS - Configurable
TAX_RATE = Decimal(env("TAX_RATE"))
def calculate_tax(amount: Decimal) -> Decimal:
    return amount * TAX_RATE
```

**Hardcoded values = FAIL**

### 10. Bloat Detection

- Unused imports/variables/functions
- Dead code paths
- Over-abstraction (patterns without need)
- Premature generalization
- Wrapper functions that add no value
- Configuration for non-existent use cases

### 11. Pattern Assessment

See [references/pattern-guide.md](references/pattern-guide.md) for when patterns help vs hurt.

### 12. Bad Pattern & Anti-Pattern Detection

See [references/bad-patterns.md](references/bad-patterns.md) for the complete catalog of 17 anti-patterns with signals, severity triggers, and alternatives.

**Structural checks:**
- God Object — class with 3+ unrelated responsibilities → FAIL
- Arrow Anti-Pattern — nesting depth > 3 → FAIL
- Long Parameter Lists — 6+ positional params → FAIL
- Copy-Paste Programming — 10+ duplicated lines in 2+ locations → FAIL
- Lava Flow — dead/commented-out code → FAIL

**Type safety checks:**
- Primitive Obsession — same primitive validated 3+ times → FAIL
- Stringly-Typed Code — string matching drives core logic 3+ places → FAIL
- Boolean Blindness — 3+ boolean parameters → FAIL

**Design smell checks:**
- Feature Envy — method uses zero own-class state → FAIL; mild cases → REVIEW
- Shotgun Surgery — 8+ files for single change → FAIL; 5+ → REVIEW
- Middle Man — >80% delegation → FAIL; >50% → REVIEW
- Inappropriate Intimacy — crossing module boundaries → FAIL
- Message Chains — 6+ steps or cross-module → FAIL; 4+ → REVIEW
- Data Clumps, Divergent Change, Golden Hammer, Anemic Domain Model → REVIEW

### 13. Refactor-Consolidation & Re-Architecture Review

See [references/refactor-review.md](references/refactor-review.md) for the full analysis guide covering 11 dimensions.

**Architecture violations (FAIL):**
- Circular dependencies between modules
- Domain layer importing from infrastructure or presentation
- Shared module larger than any domain module (boundary violation)
- Duplicate types representing the same domain concept without transformation reason

**Structural concerns (REVIEW):**
- Low module cohesion (utils files > 200 lines, modules with 3+ unrelated groups)
- High coupling (fan-out > 8, module imported by 10+ others)
- Premature extractions (1-caller abstractions)
- Missed extractions (3+ duplications without shared abstraction)
- Logic at wrong architectural layer
- Single-implementor interfaces not at module boundaries
- Module size imbalance (5x peers at same level)

### 14. API Design Review

See [references/api-design.md](references/api-design.md) for guidelines.

**Check:**
- Consistent naming conventions
- Appropriate HTTP methods/status codes (REST)
- Request/response structure clarity
- Versioning strategy
- Documentation accuracy

### 15. Logging & Observability

See [references/logging-observability.md](references/logging-observability.md) for standards.

**Verify:**
- Appropriate log levels
- Structured logging where applicable
- Correlation IDs for request tracing
- No sensitive data in logs
- Error context preservation
- Metrics/health check endpoints (if applicable)

### 16. Dependency Review

- Outdated dependencies with known vulnerabilities
- Unnecessary dependencies (can be removed or replaced)
- License compatibility
- Dependency version pinning
- Import of entire library for one function

### 17. Accessibility Review (UI Code Only)

When reviewing frontend/UI code:
- Semantic HTML usage
- ARIA labels and roles
- Keyboard navigation
- Color contrast considerations
- Screen reader compatibility

### 18. Test Quality Review

- Tests cover behavior, not implementation details
- No redundant tests covering same path
- Clear test names describing scenario
- Specific, meaningful assertions
- Edge cases and error paths covered
- No flaky tests (race conditions, timing)

### 19. Documentation & Maintainability

- Public API methods documented (JSDoc, docstrings)
- Complex algorithms explained
- No misleading or stale comments
- README updated if behavior changed
- Breaking changes documented

## Verdict Criteria

### PASS

All of the following:
- No security vulnerabilities
- **Full type safety** - All code is strictly typed (no untyped `any`, strict mode enabled)
- Error handling is robust with proper structured logging
- **No hardcoded values** - All config, thresholds, and business rules externalized
- No performance anti-patterns
- Complexity within acceptable range
- Code builds on existing patterns
- **No structural anti-patterns** - No god objects, arrow patterns, copy-paste, lava flow
- **Sound architecture** - No circular deps, correct dependency direction, cohesive modules
- Tests are meaningful and comprehensive

### REVIEW (with comments)

One or more of:
- Minor complexity warnings
- Small reuse opportunities
- Non-critical performance suggestions
- Style inconsistencies
- Minor documentation gaps
- Unstructured error logs (not blocking but should improve)
- Complex union types that could use discriminated unions
- **Design smells** - Feature envy, data clumps, anemic domain model, divergent change, golden hammer
- **Structural concerns** - Low cohesion, high coupling, premature extractions, module size imbalance

### FAIL (rework required)

Any of the following:
- Security vulnerabilities (injection, XSS, exposed secrets)
- **Missing type annotations** on public APIs or function signatures
- **Use of `any` type** without explicit justification comment
- **Strict mode disabled** in TypeScript/type checker config
- **Missing error logging** - errors not logged with structured format
- Silent error swallowing or bare except clauses
- Critical performance issues (N+1, memory leaks, unbounded operations)
- Functions > 40 lines with complexity > 10
- Significant code duplication
- Missing input validation at system boundaries
- Tests that don't test actual behavior
- **Legacy code** - Deprecated APIs, outdated patterns, stale implementations
- **Backwards compatibility hacks** - Re-exports, renamed unused vars, fallback chains, polyfills for modern targets
- **Compatibility shims** - Wrapper functions, version checks, feature detection for old environments
- **Hardcoded values** - Magic numbers, inline URLs/paths, embedded config, business-rule literals without named constants
- **Structural anti-patterns** - God objects, arrow pattern (nesting >3), copy-paste (10+ lines, 2+ locations), lava flow, long parameter lists (6+), inappropriate intimacy across boundaries
- **Architecture violations** - Circular dependencies, domain importing infrastructure/presentation, duplicate domain types, shared module larger than domain modules

## Output Template

When writing the review report, use the template in [references/output-template.md](references/output-template.md).

## Integration

```
TDD (RED → GREEN → REFACTOR) → Live Verification → Open PR → Code Quality Guardian (review stage) → Distilling → PR Ready → Founder merges
```

- **FAIL** → status flips to `in-dev`, dev pair pushes fixes to the same branch / same PR, then re-trigger review
- **REVIEW** → same as FAIL — address comments, push, re-review
- **PASS** → status flips to `distilling`; solutions-architect runs the `distillation` skill and adds capture commits to the same PR

Live verification catches runtime failures (boot errors, API mismatches, UI regressions) that static review cannot detect. This guardian catches structural issues (security, types, complexity) that runtime testing cannot detect. Both gates are mandatory.

## Guiding Principles

1. **Security first** - Security issues are never acceptable
2. **Type safety is mandatory** - All code must be strictly typed; `any` requires justification
3. **Fail fast, log well** - Errors should be caught early and logged with full structured context
4. **No hardcoded values** - Every config value, threshold, and business rule must be externalized
5. **No legacy, no backwards compatibility** - Delete deprecated code; don't wrap or shim it
6. **Pragmatism over dogma** - Metrics guide, context decides
7. **Build on what exists** - Use established patterns and utilities
8. **Simplicity wins** - The simplest correct solution is best
9. **Context matters** - A utility script has different standards than core business logic
10. **Detect structural rot early** - Anti-patterns and architecture violations compound; catch them before they spread
