# Skill Authoring Reference

Guide for creating Claude Code skills with proper frontmatter and structure.

## Skill Frontmatter Fields

```yaml
---
name: my-skill                    # Required. Kebab-case identifier
description: >                    # Required. One sentence, shown in /help
  What this skill does and when to use it.
user-invocable: true              # Optional. Makes skill callable via /skill-name
disable-model-invocation: false   # Optional. Prevents Claude from auto-invoking
allowed-tools:                    # Optional. Restrict tools this skill can use
  - Read
  - Write
  - Bash
context:                          # Optional. Files auto-loaded into context
  - path: docs/ARCHITECTURE.md
    type: file
  - path: src/types/
    type: directory
---
```

## Field Details

### `name`
Kebab-case string. Used as the skill directory name and the `/command` name if user-invocable.

### `description`
Single sentence describing what triggers this skill. This appears in:
- `/help` output
- Skill suggestion hooks
- Agent tool descriptions

### `user-invocable`
When `true`, users can invoke with `/skill-name`. When `false` (default), the skill is only activated programmatically or via skill-eval suggestions.

### `disable-model-invocation`
When `true`, Claude cannot auto-invoke this skill based on context. The user must explicitly invoke it. Useful for destructive or expensive operations.

### `allowed-tools`
Restricts which tools the skill can use. If omitted, all tools are available.

### `context`
Files or directories automatically loaded into context when the skill activates. Reduces the need for explicit "read these files first" instructions.

## Skill Directory Structure

```
.claude/skills/my-skill/
  SKILL.md          # Main skill definition (with frontmatter)
  references/       # Reference materials read during execution
    guide.md
    templates.md
  scripts/          # Helper scripts called by the skill
    analyze.py
```

## Best Practices

1. **One skill, one job** — don't combine unrelated workflows
2. **References over inline** — put detailed templates in `references/`, not in SKILL.md
3. **Scripts for analysis** — use `scripts/` for deterministic analysis (repo detection, file scanning)
4. **Context loading** — use `context` frontmatter for files the skill always needs
5. **Clear triggers** — the description should make it obvious when to use this skill
