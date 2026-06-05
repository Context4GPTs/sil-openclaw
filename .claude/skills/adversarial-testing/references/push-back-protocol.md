# Push-Back Protocol

## Contents
- Failure Report Format
- Push-Back Rules
- Escalation Procedure
- Acceptable Test Modifications
- Communication Template

---

## Failure Report Format

When a test fails, the qa-developer agent produces a structured failure report. This report is the communication contract between the QA and implementation agents.

```
╔══════════════════════════════════════════════════════════╗
║                    FAILURE REPORT                        ║
╠══════════════════════════════════════════════════════════╣
║ Test:     [full test name / describe block path]         ║
║ Tier:     [UNIT | INTEGRATION | E2E]                     ║
║ File:     [relative path to test file:line number]       ║
║ Run at:   [timestamp]                                    ║
╠══════════════════════════════════════════════════════════╣
║ EXPECTED (per specification):                            ║
║   [what the spec/requirements say should happen]         ║
║                                                          ║
║ ACTUAL (implementation behavior):                        ║
║   [what the implementation actually produced]            ║
║                                                          ║
║ ROOT CAUSE ANALYSIS:                                     ║
║   [why the implementation is wrong — reference to        ║
║    specific code paths, missing logic, wrong branching]  ║
║                                                          ║
║ FIX GUIDANCE:                                            ║
║   [specific, actionable guidance for the coding agent]   ║
║                                                          ║
║ SPECIFICATION SOURCE:                                    ║
║   [reference to product doc, API contract, or            ║
║    requirement that defines the expected behavior]       ║
╠══════════════════════════════════════════════════════════╣
║ ⚠️  DO NOT MODIFY THIS TEST                              ║
║ Fix the implementation to satisfy the specification.     ║
╚══════════════════════════════════════════════════════════╝
```

---

## Push-Back Rules

### Rule 1: Tests Are Read-Only for Coding Agents

Coding agents (expert-developer, general-purpose) must NEVER:
- Edit test files
- Add skip/xfail/todo annotations
- Modify assertions
- Change test setup to match broken behavior
- Delete tests that inconveniently fail

Violation is caught by hooks and blocked.

### Rule 2: Failure Reports Are Mandatory

Every test failure produces a failure report. No silent failures. No "I'll fix the test." The report goes to the coding agent with explicit instructions.

### Rule 3: Re-Runs Go Through This Skill

After a coding agent claims to have fixed the implementation:

```
Agent tool → subagent_type: "qa-developer"
Prompt: "Re-run failing tests from the previous failure report.
         Verify fixes. Do not modify tests."
```

The coding agent does NOT run tests directly. The qa-developer agent verifies.

### Rule 4: Three Strikes Escalation

If the same test fails three times after implementation "fixes":

1. First failure: Standard failure report
2. Second failure: Failure report with "RECURRING" flag
3. Third failure: Escalate to user with full history

```
ESCALATION: Test [name] has failed 3 times despite implementation fixes.
Previous failure reports attached. This may indicate a design problem
that requires architectural change, not just a code fix.
```

---

## Escalation Procedure

### Level 1: Standard Push-Back
- Failure report sent to coding agent
- Coding agent fixes implementation
- qa-developer re-runs

### Level 2: Recurring Failure
- Same test fails again after "fix"
- Failure report includes diff of what changed
- Warning: "Previous fix did not address the root cause"

### Level 3: User Escalation
- Three failures on the same test
- Full history report to user
- Recommendation: requirement clarification or design change needed

### Level 4: Specification Dispute
- Coding agent believes the test is wrong
- Coding agent must NOT modify the test
- Coding agent sends a dispute request to the qa-developer agent:

```
Agent tool → subagent_type: "qa-developer"
Prompt: "Dispute: Coding agent believes test [name] is incorrect.
         Their argument: [argument]. Review the test against the
         specification. If the test is genuinely wrong, fix it.
         If the test is correct, produce a rebuttal with
         specification references."
```

The qa-developer agent adjudicates. If the test is wrong, only the qa-developer agent fixes it.

---

## Acceptable Test Modifications

Tests may be modified ONLY by the qa-developer agent, and ONLY for these reasons:

| Reason | Example | Who Approves |
|--------|---------|-------------|
| **Requirement changed** | Product doc updated, acceptance criteria revised | User confirms |
| **Test bug** | Typo in assertion, wrong test setup, flaky timing | qa-developer self-approves |
| **Testing implementation details** | Test asserts on internal state instead of behavior | qa-developer refactors |
| **New edge case discovered** | Additional adversarial test needed | qa-developer adds |

### NEVER acceptable:

| Modification | Why It's Wrong |
|-------------|---------------|
| Weakening assertion to match actual | Hiding a bug |
| Adding skip/xfail | Ignoring a bug |
| Removing a test | Destroying the specification |
| Broadening expected values | Lowering the bar |
| Mocking away the failure point | Sweeping under the rug |

---

## Communication Template

### From qa-developer to coding agent (failure):

```
TEST FAILURE — Action required

[Failure Report as above]

Instructions:
1. Read the failure report carefully
2. Fix the IMPLEMENTATION (not the test)
3. When done, request a re-run:
   "Run adversarial tests for [module]"
4. Do NOT edit any test files
```

### From qa-developer to coding agent (pass):

```
ALL TESTS PASS — Verdict: PASS

Summary:
- Unit tests:        [X] passed, [Y] failed
- Integration tests: [X] passed, [Y] failed
- E2E tests:         [X] passed, [Y] failed
- Coverage:          [adequate | gaps identified]

[If GAPS verdict, additional tests will be written]
```

### From coding agent to qa-developer (dispute):

```
TEST DISPUTE — Request for review

Test: [test name]
File: [test file]
My argument: [why the test might be wrong]
Evidence: [specific spec reference or logical argument]

I have NOT modified the test. Requesting qa-developer review.
```
