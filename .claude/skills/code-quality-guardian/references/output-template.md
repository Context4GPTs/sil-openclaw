```markdown
# Code Quality Review

## Summary
[1-2 sentence assessment]

## Verdict: [PASS | REVIEW | FAIL]

## Live Verification
- [PASS/SKIP] - [Build: PASS, Run: PASS, API: X/Y, Browser: PASS/SKIP, Integration: PASS]
- Skip reason: [if skipped: docs-only / config-only / test-only]

## Security
- [PASS/REVIEW/FAIL] - [Details]
- Input validation: [Status]
- Injection prevention: [Status]
- Secrets handling: [Status]

## Type Safety
- [PASS/REVIEW/FAIL] - [Details]
- Strict mode enabled: [Yes/No]
- Missing type annotations: [List or "None"]
- `any` usage: [Count and justification status]
- Null safety: [Status]

## Error Handling & Logging
- [PASS/REVIEW/FAIL] - [Details]
- Exception specificity: [Status]
- Error messages: [Status]
- Structured logging: [Yes/No - following code-logging skill standards]
- Required log fields: [Present/Missing: timestamp, level, event, request_id, service, environment]
- High-cardinality fields: [Present/Missing for debugging]
- Sensitive data in logs: [None/Found]

## Performance
- [PASS/REVIEW/FAIL] - [Details]
- Database queries: [Status]
- Memory management: [Status]
- Async handling: [Status]

## Complexity
- [file:line - function - metric: value - OK/WARNING/FAIL]

## Code Reuse
- [Reuse opportunities or "Building on existing patterns"]

## Legacy Code & Backwards Compatibility
- [PASS/FAIL] - [Details]
- Deprecated APIs: [None/Found]
- Compatibility shims: [None/Found]
- Backwards compat hacks: [None/Found]
- Unnecessary polyfills: [None/Found]

## Hardcoded Values
- [PASS/FAIL] - [Details]
- Magic numbers: [None/Found - list with file:line]
- Hardcoded URLs/paths: [None/Found]
- Embedded config: [None/Found]
- Business-rule literals: [None/Found]
- Environment-specific values: [None/Found]

## Bloat
- [Items flagged or "None detected"]

## Patterns
- [Appropriate/Recommended/Overused]

## Bad Patterns
- [PASS/REVIEW/FAIL] - [Details]
- Structural: [God Object/Arrow/Copy-Paste/Lava Flow/Long Params - None/Found]
- Type safety: [Primitive Obsession/Stringly-Typed/Boolean Blindness - None/Found]
- Design smells: [Feature Envy/Shotgun Surgery/Middle Man/etc. - None/Found]

## Refactor-Consolidation
- [PASS/REVIEW/FAIL] - [Details]
- Cohesion: [Status]
- Coupling: [Circular deps: None/Found, Fan-out: OK/High]
- Dependency direction: [Violations: None/Found]
- Consolidation: [Duplicate types: None/Found]
- Module boundaries: [Aligned/Misaligned]

## API Design (if applicable)
- [Assessment]

## Logging & Observability
- [Assessment]

## Dependencies
- [Issues or "Up to date, minimal"]

## Accessibility (UI only)
- [Assessment or N/A]

## Test Quality
- [Assessment]

## Documentation
- [Assessment]

## Required Actions (REVIEW/FAIL only)
1. [Specific action with file:line reference]

## Recommendations
- [Non-blocking improvements]
```
