# Agent Definitions

Frontmatter for `.claude/agents/*.md` files. Two layers: Claude Code primitives that the runtime reads, and harness conventions that are documentation-only.

## Claude Code primitives (runtime-enforced)

```yaml
---
name: agent-name                  # kebab-case identifier
description: >                    # one sentence, used by the Agent tool
  What this agent does and when to use it.
tools: Read, Write, Edit, ...     # comma-separated tool names
model: opus                       # default to opus for quality
---
```

These four fields shape what the agent can do at runtime. `tools` is the actual capability grant.

## Harness conventions (documentation-only)

```yaml
memory: project                   # marker — actual memory is the file-based system in memory/; this field documents scope intent
skills:                           # list of skills this agent typically invokes — discoverability metadata, NOT a capability grant
  - skill-name
hooks:                            # agent-scoped hooks (rare; most flow through .claude/settings.json)
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "..."
---
```

`memory:` and `skills:` are not behaviors Claude Code enforces — they document intent for orchestrators and readers. In particular, listing a skill in `skills:` does NOT auto-load `<skill>/SKILL.md` into the agent's context. The agent must `Read` the skill file itself (or invoke the `Skill` tool when the skill is in its available-skills list). Treat `skills:` as "this agent commonly uses these" — a hint, not a contract.

## Conventions

- **Deliberation agents** (`solutions-architect`, `code-quality-guardian`, `style-quality-guardian`) are expected to read the diff and relevant `INDEX.md` docs before they write or commit. Their bodies spell out the read-first sequence per stage. They are not run in Claude Code's `plan` permission mode — that mode gates writes behind `ExitPlanMode`, which would break the in-worktree commit flow.
- The `qa-developer` agent creates a `/tmp/.claude-qa-active-<hash>` sentinel on start; the `test-guard` and `test-run-guard` hooks use it to allow test-file edits and test execution for ~60 minutes.
- Agents that produce artifacts should document their working directory in the agent body.

## Card lifecycle contract

Every agent that participates in the kanban flow MUST follow the handoff contract:

1. **Read** the card's `## Intent` + the latest `### → Handoff to <this stage>` block. Don't re-read the whole card body — the handoff is the contract for what to do.
2. **Work** inside the worktree (`card/<slug>` branch) — never edit the base-branch copy of the card.
3. **Append** to the card body:
   - `## <Stage> — <agent names>` section with notes, findings, decisions
   - `### → Handoff to <next stage> (next agents: ...)` block (unless terminal)
4. **Update** card frontmatter:
   - `status:` — the next lane
   - `agents:` — the next stage's agent set (the dispatcher reads this to know who to spawn)
   - `updated:` — today
5. **Commit** on the branch (one commit captures handoff + body + frontmatter): `git commit -m "card: <slug> → <next-status>"`

Stage ownership at a glance:

| Stage | Default agents |
|---|---|
| `discovery` | `solutions-architect`, `product-owner` (+ `devops-engineer` for infra, + `product-marketer` for product-facing features) |
| `stand-by` | (idle — no agent runs; next tick promotes the card to `in-dev`) |
| `in-dev` | `expert-developer`, `qa-developer` (or `devops-engineer` + `qa-developer` for infra) |
| `review` | `code-quality-guardian` (+ `style-quality-guardian` if UI) |
| `distilling` | `solutions-architect` (in worktree, on card branch, pushes to same PR) |
| `pr-ready` | (idle — waiting on founder to merge the PR) |

The full state machine is in [`.claude/skills/board/SKILL.md`](../skills/board/SKILL.md).
