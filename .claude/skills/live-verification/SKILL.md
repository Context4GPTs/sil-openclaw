---
name: live-verification
description: "Build, run, and verify the application live before committing. Closes the feedback loop: build gate, runtime health, API smoke tests, browser verification, integration flows, teardown. Use after TDD passes and before quality review."
---

# Live Verification

## Purpose

Unit tests verify logic. Static analysis verifies structure. Live verification verifies the **system works** when you actually run it. This skill closes the gap between "tests pass" and "it works in production."

## When to Use

- After the TDD cycle completes (tests pass)
- Before running `code-quality-guardian`
- Before creating a PR
- After any change that affects runtime behavior

## When to Skip

- Documentation-only changes
- Config file changes that don't affect runtime
- Test-only changes (no production code modified)
- CI/CD pipeline changes (verified by CI itself)

## Verification Phases

### Phase 1: Build Gate

The project must compile and bundle without errors.

| Indicator | Build Command |
|---|---|
| `package.json` with `build` script | `pnpm build` |
| `tsconfig.json` (no build script) | `pnpm exec tsc --noEmit` |
| `pyproject.toml` | `uv build` |
| `Cargo.toml` | `cargo build` |
| `go.mod` | `go build ./...` |
| `Dockerfile` | `docker build .` |

**Catches:** import errors, type errors at module boundaries, missing dependencies, broken build configs.

**FAIL:** any build error. Zero tolerance.

### Phase 2: Run Gate

Start the application and verify it boots.

| Indicator | Start Command | Health Check |
|---|---|---|
| `package.json` with `dev` script | `pnpm dev &` | `curl -sf http://localhost:${PORT:-3000}/` |
| `package.json` with `start` script | `pnpm start &` | `curl -sf http://localhost:${PORT:-3000}/` |
| `pyproject.toml` / `main.py` | `uv run python -m ${MODULE} &` | `curl -sf http://localhost:${PORT:-8000}/` |
| `Cargo.toml` | `cargo run &` | `curl -sf http://localhost:${PORT:-8080}/` |
| `go.mod` | `go run . &` | `curl -sf http://localhost:${PORT:-8080}/` |
| `docker-compose.yml` | `docker compose up -d` | `docker compose ps --format json` |

**Wait for readiness:** poll the health endpoint with retries (max 30 s, 2 s interval). Prefer `/health` or `/api/health` if available.

**Catches:** runtime config errors, missing env vars, circular dependencies, DB connection failures, port conflicts, crash-on-boot.

**FAIL:** app doesn't start within 30 s, or health check fails.

### Phase 3: API Smoke Tests

Hit the actual endpoints affected by the change.

1. Read `git diff --name-only` to identify changed files
2. Identify affected API routes from changed files
3. For each affected endpoint, verify:
   - Response status is expected (200, 201, etc.)
   - Response body matches expected shape (required fields present)
   - Error endpoints return proper error format
   - Auth-required endpoints reject unauthenticated requests

```bash
curl -sf -o /dev/null -w "%{http_code}" http://localhost:${PORT}/api/endpoint
curl -sf http://localhost:${PORT}/api/endpoint | jq 'keys'
curl -sf -o /dev/null -w "%{http_code}" http://localhost:${PORT}/api/protected  # expect 401/403
```

**Catches:** serialization bugs, middleware ordering, auth misconfiguration, response shape mismatches, runtime type errors that compile but fail at runtime.

**FAIL:** any endpoint returns unexpected status or crashes.

### Phase 4: Browser Verification (UI changes only)

**Skip if:** no frontend files changed (no `.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css` modifications).

Use whatever browser tool the project has wired up (Playwright, Puppeteer, the Chrome DevTools MCP, or a manual browser session). If nothing is configured, open the affected page manually and verify by hand.

**Verify:**
- Page renders without JS errors (check the devtools console)
- Key interactive elements are visible and enabled
- Changed UI elements reflect the new behavior
- Forms submit correctly
- Navigation works

Capture a screenshot or short note for the record.

**Catches:** hydration mismatches, CSS regressions, broken event handlers, JS runtime errors, missing DOM elements, accessibility regressions.

**FAIL:** JS errors on page load, missing key elements, broken interactions.

### Phase 5: Integration Smoke Test

Run a full user flow against the running app. Not mocked, not stubbed.

Pick the flow most relevant to the change:

- **CRUD flow:** create, read back, update, verify, delete, verify deletion
- **Auth flow:** login → access protected resource → logout → verify protection
- **Form flow:** navigate, fill, submit, verify result
- **Data flow:** input at one end, verify it appears at the other end

Combine `curl` for API flows and the browser tool for UI flows.

**Catches:** state management bugs, race conditions, persistence issues, cross-component integration failures, broken contracts between frontend and backend.

**FAIL:** any step in the flow produces unexpected results.

### Phase 6: Teardown

```bash
kill %1 2>/dev/null || true
docker compose down 2>/dev/null || true
trash verification.png 2>/dev/null || true
```

Clean up any test data the verification created.

## Output Template

```markdown
## Live Verification Results

### Build Gate
- [PASS/FAIL] — `pnpm build` completed in Xs
- Errors: [none / list]

### Run Gate
- [PASS/FAIL] — app started on port XXXX
- Health check: [PASS/FAIL] — response time Xms
- Boot errors: [none / list]

### API Smoke Tests
- [PASS/FAIL] — X/Y endpoints verified
- [endpoint]: [status] [response time]
- Failures: [none / list]

### Browser Verification
- [PASS/SKIP/FAIL] — [reason if skipped]
- Pages checked: [list]
- JS errors: [none / list]
- Interactions: [all working / failures]

### Integration Smoke
- [PASS/FAIL] — [flow name]
- Steps: X/Y passed
- Failures: [none / list]

### Verdict: [PASS / FAIL]
```

## Integration with Workflow

```
TDD (RED → GREEN → REFACTOR)
    ↓
LIVE VERIFICATION (build → run → API → browser → integration → teardown)
    ↓
OPEN PR (worktree-ops Part 2)
    ↓
CODE QUALITY GUARDIAN (review stage, against the open PR's diff)
    ↓
DISTILLING → PR READY → founder merges
```

Live verification runs AFTER tests pass and BEFORE opening the PR. If verification fails, return to implementation — the code compiles and passes tests but doesn't work as a system. The PR is opened only once live-verification is green; the review stage then runs against the open PR.

## Rules

- Never skip the build gate — if it doesn't compile, nothing else matters
- Never commit code that hasn't been run — unit tests verify logic, not systems
- Always teardown — don't leave processes or test data behind
- Browser verification is mandatory for UI changes — "it renders" is the minimum bar
- Integration smoke uses real data flows — no mocks, no stubs
- Report results even when passing — the verification log is evidence
- If verification fails, fix and re-verify — don't just re-run tests
