---
name: agent-config-generator
description: Creates or updates CLAUDE.md and AGENTS.md files following industry best practices. This skill should be used when the user wants to create, update, optimize, or review their repository's AI agent configuration files. Triggers on requests involving "CLAUDE.md", "AGENTS.md", "agent config", "agent instructions", or when setting up a new repository for AI coding agents.
---

# Agent Config Generator

Generate production-quality CLAUDE.md and AGENTS.md files that maximize AI coding agent effectiveness.

## When to Use

- Creating a new CLAUDE.md or AGENTS.md file
- Updating existing agent configuration files
- Optimizing agent instructions for better performance
- Setting up a repository for AI-assisted development
- Reviewing and improving existing agent configurations

## Core Principles

### 1. Concise is Critical

CLAUDE.md goes into every conversation context. Each line has compounding cost across all sessions.

**Target lengths:**
- CLAUDE.md: ≤60 lines ideal, ≤150 lines max
- AGENTS.md: ≤150 lines ideal

**Test each line:** "Does the agent need this? Can the agent infer this from code?"

### 2. Base Standards + Project-Specific

Every generated CLAUDE.md has two layers:

1. **Base standards** from `references/base-standards.md` — philosophy, quality limits, error handling, testing, CLI preferences, commits, context management, agent teams, sandboxing, GitHub Actions. These are non-negotiable and apply to every project.
2. **Project-specific** sections — stack, structure, commands, conventions discovered by analyzing the target repo.

The base standards are the backbone. The project-specific sections wrap around them.

### 3. Three Essential Components (WHY, WHAT, HOW)

Every agent config must answer:

1. **WHAT** - Technology stack, project structure, codebase architecture
2. **WHY** - Project purpose, component functions, design decisions
3. **HOW** - Build commands, test procedures, verification methods

### 4. Progressive Disclosure

Keep core files lean. Reference detailed docs elsewhere:

```
agent_docs/
├── building.md
├── testing.md
├── architecture.md
└── domain_terms.md
```

Direct agents to these files when relevant rather than duplicating content.

## Workflow

### Step 1: Load Base Standards

Read `references/base-standards.md` in this skill directory. These standards are always included in the generated CLAUDE.md. They cover:

- Critical Thinking Protocol (adversarial evaluation of all prompts and reasoning)
- Philosophy (13 rules)
- Dependencies
- Code Quality Hard Limits
- Error Handling
- Testing
- CLI Tool Preferences (filter rows by target stack)
- Commits and PRs
- Code Review Order
- Completion Protocol (build, run, verify live, quality review)
- Context Management
- Agent Teams
- Sandboxing
- GitHub Actions

### Step 2: Analyze the Repository

Gather context before writing:

1. **Read project docs first**: Read all docs in `docs/` to understand the project:
   - `docs/README.md` — docs taxonomy and write conventions
   - `docs/decisions/INDEX.md` — past architectural / product choices (then read matched docs)
   - `docs/knowledge/INDEX.md` — repo-level facts, flows, invariants, gotchas (then read matched docs)
   - `docs/product/INDEX.md` — flows, business rules, UX principles, glossary (then read matched docs)
   - Any other project-specific docs the team has authored (paths vary by project)
2. **Identify tech stack**: Languages, frameworks, package managers
3. **Map project structure**: Key directories, entry points, config files
4. **Discover workflows**: Build, test, lint, deploy commands
5. **Note conventions**: Naming patterns, file organization, code style
6. **Find existing docs**: README, CONTRIBUTING, existing agent configs

Use `scripts/analyze_repo.py` for automated detection.

### Step 3: Determine File Strategy

Choose which files to create:

| Scenario | Files to Create |
|----------|----------------|
| Claude-only usage | CLAUDE.md |
| Multi-agent/tool usage | AGENTS.md (universal) |
| Both Claude and others | Both files (CLAUDE.md for Claude-specific, AGENTS.md for universal) |

### Step 4: Generate CLAUDE.md

Combine base standards with project-specific content. Sections wrapped in `<!-- IF:stack -->` / `<!-- /IF:stack -->` markers are conditional — strip sections that don't match the detected stack. For example, a Python-only project strips `<!-- IF:js-ts -->` blocks. The Dependencies section is entirely conditional.

Structure:

```markdown
# Development Standards

## Critical Thinking Protocol
[From base-standards.md — include verbatim.
The adversarial evaluation stance. Must appear before Philosophy.]

## Philosophy
[From base-standards.md — include all 13 rules verbatim]

## Dependencies
[From base-standards.md — include verbatim]

## Code Quality Hard Limits
[From base-standards.md — include verbatim]

## Error Handling
[From base-standards.md — include verbatim]

## Testing
[From base-standards.md — include verbatim]

## CLI Tool Preferences
[From base-standards.md — filter to rows relevant to detected stack.
Always include universal rows: fd, rg, ast-grep, trash.
Add stack-specific rows based on detected languages.]

## Commits and PRs
[From base-standards.md — include verbatim]

## Code Review Order
[From base-standards.md — include verbatim]

## Completion Protocol
[From base-standards.md — include verbatim.
Includes build, run, verify live, quality review, and commit gates.]

## Context Management
[From base-standards.md — include verbatim]

## Agent Teams
[From base-standards.md — include verbatim]

## Sandboxing
[From base-standards.md — include verbatim]

## GitHub Actions
[From base-standards.md — include verbatim.
Omit if project has no GitHub Actions.]
```

If the CLAUDE.md would exceed 150 lines with all base standards, move the less-referenced sections (Sandboxing, Agent Teams, Context Management) into a separate `agent_docs/workflow-standards.md` and reference it from CLAUDE.md.

### Step 5: Generate AGENTS.md (if needed)

Follow the structure from `references/templates.md`. Include the same base standards philosophy but adapted for multi-tool format.

### Step 6: Generate Coding Rules

Create `.claude/rules/coding-rules.md` with the critical subset of philosophy rules in emphatic tone, referencing CLAUDE.md for the full set:

```markdown
# Coding Rules

CRITICAL RULES
- No backwards compatibility. No legacy code. Rewrite, build, test, deploy, run.
- NO RE-EXPORTS. Especially from shared. Shared is the main contract between the services.
- NO remapping data with minimal change. Reuse the same stuff.
- ABSOLUTELY NO BLOAT. EVERY LINE OF CODE THAT YOU WRITE SHOULD BE MEANINGFUL. If you don't think it is then you should refactor something existing to solve the problem.
- We are writing strict typed code.
- ALL ISSUES ARE ISSUES. THERE ARE NO MINOR ISSUES. THERE IS NO FIXING LATER.
- NEVER EVER NEVER use hardcoded values. If you need to set something put it in env vars or SOLVE IT PROPERLY.
- Internal GitHub dependencies (same org) MUST use `git+https` URLs. No npm shorthand, no SSH, no tarballs. Example: `"git+https://github.com/OrgAds/package-name.git#branch"`

See /CLAUDE.md for complete development philosophy, quality thresholds, and toolchain preferences.
```

### Step 6b: Generate Path-Specific Rules

Using `references/rules-templates.md`, generate `.claude/rules/` files based on `analyze_repo.py` output field `suggested_rules_domains`:

- `critical-thinking.md` — **always generated** (no `paths` frontmatter, loads into every conversation)
- `dependency-rules.md` — if any dependency manifest detected (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`)
- `api-rules.md` — if API directories detected
- `test-rules.md` — if test files/directories detected
- `component-rules.md` — if `.tsx`/`.jsx` or `components/` detected
- `infra-rules.md` — if `.github/`, Dockerfile, or Terraform detected

Domain-specific rule files have `paths` frontmatter so they only load when Claude touches matching files. `critical-thinking.md` has no paths — it loads always.

### Step 7: Generate Starter settings.json

Using `references/settings-templates.md`, produce a minimal `.claude/settings.json`:

1. **Deny list** — base deny list + stack-specific additions (Node: npm publish, Python: pip upload, Docker: docker push, Terraform: terraform destroy)
2. **UserPromptSubmit adversarial checkpoint** — injects Critical Thinking checkpoint into every prompt (always include)
3. **PostToolUse auto-format hook** — language-appropriate formatter (ruff for Python, prettier for JS/TS, gofmt for Go)
4. **PreToolUse branch protection** — block direct push to main/dev

Filter the deny list to the detected stack. Don't include Terraform rules for a Python-only project.

See also `references/skill-authoring.md` for documenting available skill frontmatter fields when advising users who want to create skills.

## Anti-Patterns to Avoid

### 1. Omitting Base Standards

Never generate a CLAUDE.md without the philosophy and quality sections. A project-specific-only CLAUDE.md is incomplete.

### 2. Style Guidelines in Agent Config

Never include linting rules—use deterministic tools instead:

```markdown
<!-- BAD -->
## Style
- Use 2 spaces for indentation
- Always use semicolons

<!-- GOOD -->
## Lint
`npm run lint -- --fix path/to/file.ts`
```

### 3. Vague Instructions

```markdown
<!-- BAD -->
Write clean code and follow best practices.

<!-- GOOD -->
Use functional components with hooks. Extract shared logic into custom hooks in `src/hooks/`.
```

### 4. Duplicate Information

Don't repeat what's in README or package.json. Reference instead:

```markdown
See `README.md` for detailed setup instructions.
```

### 5. Hotfix-Style Rules

Avoid temporary workarounds that don't apply universally:

```markdown
<!-- BAD -->
When working on auth, remember to update the session timeout.

<!-- GOOD - put in separate doc -->
See `docs/auth.md` for authentication workflow details.
```

### 6. Project-Wide Commands for File Operations

```markdown
<!-- BAD -->
Run `npm test` to verify changes.

<!-- GOOD -->
- Full suite: `npm test`
- Single file: `npm test -- path/to/file.test.ts`
- Watch mode: `npm test -- --watch path/to/file.test.ts`
```

## Quality Checklist

Before finalizing, verify:

- [ ] Base standards (Critical Thinking Protocol, Philosophy, Quality Limits, Error Handling, Testing, Completion Protocol) are included
- [ ] CLI Tool Preferences filtered to relevant stack
- [ ] ≤150 lines total (ideally ≤60 for CLAUDE.md)
- [ ] All commands are file-scoped where possible
- [ ] Real code examples, not descriptions
- [ ] No style rules (use linter instead)
- [ ] No secrets or absolute paths
- [ ] References detailed docs rather than embedding them
- [ ] Each instruction is universally applicable
- [ ] Coding rules file generated at `.claude/rules/coding-rules.md`

## Iteration Strategy

After initial creation:

1. Use the agent on real tasks
2. Note where it struggles or makes mistakes
3. Add rules only for repeated issues
4. Remove rules that don't improve outcomes

The best agent configs evolve through usage, not upfront planning.
