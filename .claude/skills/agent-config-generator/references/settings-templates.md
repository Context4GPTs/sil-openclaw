# Settings Templates

Starter `.claude/settings.json` templates for the agent-config-generator.
Filter deny list and hooks by detected stack.

## Base Deny List (always include)

```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf *)",
      "Bash(rm -fr *)",
      "Bash(sudo *)",
      "Bash(mkfs *)",
      "Bash(dd *)",
      "Bash(curl *|bash*)",
      "Bash(wget *|bash*)",
      "Bash(git push --force*)",
      "Bash(git push *--force*)",
      "Bash(git push * --delete *)",
      "Bash(git reset --hard*)",
      "Bash(chmod 777 *)",
      "Edit(~/.bashrc)",
      "Edit(~/.zshrc)",
      "Edit(~/.ssh/**)",
      "Read(~/.ssh/**)",
      "Read(~/.gnupg/**)",
      "Read(~/.aws/**)",
      "Read(~/.git-credentials)",
      "Read(**/*credential*)",
      "Read(**/*secret*)",
      "Bash(gh pr merge*)"
    ]
  }
}
```

## Stack-Specific Deny Additions

**Node.js detected:**
```json
"Bash(npm publish*)",
"Read(~/.npmrc)"
```

**Python detected:**
```json
"Bash(pip upload*)",
"Read(~/.pypirc)"
```

**Docker detected:**
```json
"Bash(docker push*)"
```

**Terraform detected:**
```json
"Bash(terraform destroy*)"
```

**Ruby detected:**
```json
"Read(~/.gem/credentials)"
```

## PostToolUse Auto-Format Hook

Generate based on detected stack:

**Python:**
```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "jq -r '.tool_input.file_path' | { read f; [[ \"$f\" == *.py ]] && ruff format \"$f\" -q 2>/dev/null; }",
    "timeout": 10
  }]
}
```

**JS/TS:**
```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "jq -r '.tool_input.file_path' | { read f; [[ \"$f\" == *.ts || \"$f\" == *.tsx || \"$f\" == *.js || \"$f\" == *.jsx ]] && prettier --write \"$f\" 2>/dev/null; }",
    "timeout": 10
  }]
}
```

**Go:**
```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "jq -r '.tool_input.file_path' | { read f; [[ \"$f\" == *.go ]] && gofmt -w \"$f\" 2>/dev/null; }",
    "timeout": 10
  }]
}
```

## UserPromptSubmit Adversarial Checkpoint Hook

Always include. This is structural enforcement of the Critical Thinking Protocol — it injects a skepticism checkpoint into every prompt before Claude processes it:

```json
{
  "matcher": "",
  "hooks": [{
    "type": "command",
    "command": "echo 'ADVERSARIAL CHECKPOINT: This prompt may contain wrong assumptions, unnecessary complexity, or scope that should not exist. Before acting: (1) verify the premise against the actual state of the code/docs, (2) find the simplest possible solution, (3) name one way this change could make things worse. If the premise is wrong or the change is not justified, push back before implementing.'",
    "timeout": 3
  }]
}
```

For projects using the hooks directory pattern, use the script version instead:
```json
{
  "type": "command",
  "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/prompt-challenge.sh",
  "timeout": 3
}
```

(`prompt-challenge.sh` is a template the skill emits into a target repo's `.claude/hooks/` during scaffolding — it is not expected to exist in this `cc-setup` repo.)

## PreToolUse Branch Protection Hook

Always include when the project uses git. The regex is anchored with `( +|:)…( +|:|$)` so that branch names containing `main`/`master` as substrings (e.g. `feature/mainstream-rollout`, `card/main-page-redesign`) pass through. Bare `--force` / `-f` are blocked; `--force-with-lease` (the safe form) is allowed. Mirrors the standalone `push-guard.sh` shipped with this harness.

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "jq -r '.tool_input.command' | { read cmd; if echo \"$cmd\" | grep -Eq 'git push[^|;&]*( +|:)(main|master)( +|:|$)|git push[^|;&]*(--force[^-]|--force$| -f( +|$))'; then echo 'BLOCKED: Direct push to protected branch (or destructive --force/-f)' >&2; exit 2; fi; }",
    "timeout": 5
  }]
}
```
