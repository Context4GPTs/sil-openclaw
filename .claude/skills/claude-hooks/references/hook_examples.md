# Hook Examples

Practical examples of Claude Code hooks for common use cases.

## Code Quality & Formatting

### Auto-format Python files

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | { read file_path; if echo \"$file_path\" | grep -q '\\.py$'; then black \"$file_path\" 2>/dev/null || true; fi; }"
          }
        ]
      }
    ]
  }
}
```

### Auto-format Go files

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | { read file_path; if echo \"$file_path\" | grep -q '\\.go$'; then gofmt -w \"$file_path\" 2>/dev/null || true; fi; }"
          }
        ]
      }
    ]
  }
}
```

### Run ESLint on JavaScript/TypeScript

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | { read file_path; if echo \"$file_path\" | grep -qE '\\.(js|ts|jsx|tsx)$'; then npx eslint --fix \"$file_path\" 2>/dev/null || true; fi; }"
          }
        ]
      }
    ]
  }
}
```

## Security & Protection

### Block edits to production config

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"import json, sys; data=json.load(sys.stdin); path=data.get('tool_input',{}).get('file_path',''); sys.exit(2 if 'production.yaml' in path or 'prod.env' in path else 0)\""
          }
        ]
      }
    ]
  }
}
```

### Require approval for git push

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"import json, sys; data=json.load(sys.stdin); cmd=data.get('tool_input',{}).get('command',''); sys.exit(1 if 'git push' in cmd else 0)\""
          }
        ]
      }
    ]
  }
}
```

### Prevent deletion of important directories

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"import json, sys, re; data=json.load(sys.stdin); cmd=data.get('tool_input',{}).get('command',''); dangerous=re.search(r'rm.*(-rf|-fr).*(/|~|\\$HOME)', cmd); sys.exit(2 if dangerous else 0)\""
          }
        ]
      }
    ]
  }
}
```

## Logging & Analytics

### Log all bash commands with timestamps

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '\"[\" + (now | strftime(\"%Y-%m-%d %H:%M:%S\")) + \"] \" + .tool_input.command' >> ~/.claude/bash-history.log"
          }
        ]
      }
    ]
  }
}
```

### Track file modifications

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '\"[\" + (now | strftime(\"%Y-%m-%d %H:%M:%S\")) + \"] Modified: \" + .tool_input.file_path' >> ~/.claude/file-changes.log"
          }
        ]
      }
    ]
  }
}
```

### Session analytics

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '{session_id, duration_ms, total_turns, timestamp: (now | strftime(\"%Y-%m-%d %H:%M:%S\"))}' >> ~/.claude/sessions.jsonl"
          }
        ]
      }
    ]
  }
}
```

## Notifications

### Desktop notification on completion

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "notify-send 'Claude Code' 'Task completed' -u normal"
          }
        ]
      }
    ]
  }
}
```

### Sound alert when awaiting input

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "afplay /System/Library/Sounds/Glass.aiff"
          }
        ]
      }
    ]
  }
}
```

### Slack notification for subagent completion

```bash
#!/bin/bash
# Save as: .claude/hooks/slack-notify.sh

WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

MESSAGE=$(jq -r '
  "Subagent *" + .subagent_type + "* completed\n" +
  "Result: " + .result + "\n" +
  "Task ID: " + .task_id
')

curl -X POST "$WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"text\":\"$MESSAGE\"}"
```

```json
{
  "hooks": {
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/slack-notify.sh"
          }
        ]
      }
    ]
  }
}
```

## Testing & CI/CD

### Auto-run tests after code changes

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | { read file_path; if echo \"$file_path\" | grep -q '/src/'; then npm test 2>&1 | head -20; fi; }"
          }
        ]
      }
    ]
  }
}
```

### Trigger CI on git push

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' | { read cmd; if echo \"$cmd\" | grep -q 'git push'; then curl -X POST https://ci.example.com/trigger; fi; }"
          }
        ]
      }
    ]
  }
}
```

## Development Workflow

### Auto-add copyright headers

```bash
#!/usr/bin/env python3
# Save as: .claude/hooks/add-copyright.py

import json
import sys
from pathlib import Path

COPYRIGHT = """# Copyright (c) 2026 Your Company
# Licensed under MIT License
"""

data = json.load(sys.stdin)
file_path = data.get('tool_input', {}).get('file_path', '')

if file_path.endswith('.py'):
    with open(file_path, 'r') as f:
        content = f.read()

    if 'Copyright' not in content:
        with open(file_path, 'w') as f:
            f.write(COPYRIGHT + '\n' + content)
```

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/add-copyright.py"
          }
        ]
      }
    ]
  }
}
```

### Enforce commit message format

```bash
#!/bin/bash
# Save as: .claude/hooks/validate-commit.sh

COMMAND=$(jq -r '.tool_input.command')

if echo "$COMMAND" | grep -q 'git commit'; then
    # Extract commit message
    MSG=$(echo "$COMMAND" | sed -n 's/.*-m "\([^"]*\)".*/\1/p')

    # Check conventional commits format
    if ! echo "$MSG" | grep -qE '^(feat|fix|docs|style|refactor|test|chore)(\([a-z-]+\))?:'; then
        echo "❌ Commit message must follow conventional commits format"
        echo "   Example: feat(auth): add login functionality"
        exit 2
    fi
fi
```

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-commit.sh"
          }
        ]
      }
    ]
  }
}
```

## Context Management

### Export context before compaction

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "jq '.' > ~/.claude/context-backup-$(date +%Y%m%d-%H%M%S).json"
          }
        ]
      }
    ]
  }
}
```

### Load project context on session start

```bash
#!/bin/bash
# Save as: .claude/hooks/load-context.sh

PROJECT_DIR=$(jq -r '.working_directory')

if [ -f "$PROJECT_DIR/.claude/context.md" ]; then
    echo "📋 Project context loaded from .claude/context.md"
fi
```

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/load-context.sh"
          }
        ]
      }
    ]
  }
}
```

## Advanced Patterns

### Multi-hook pipeline

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "scripts/format.sh"
          },
          {
            "type": "command",
            "command": "scripts/lint.sh"
          },
          {
            "type": "command",
            "command": "scripts/test.sh"
          }
        ]
      }
    ]
  }
}
```

### Conditional execution with jq

```bash
# Only run for TypeScript files larger than 100 lines
jq -r '
  .tool_input.file_path as $path |
  if ($path | endswith(".ts")) then
    ($path | @sh) as $safe_path |
    if (($safe_path | "wc -l " + . | @sh) | tonumber > 100) then
      "npx prettier --write " + $safe_path
    else
      "echo Skipping small file"
    end
  else
    "echo Not a TypeScript file"
  end
' | bash
```

### State tracking between hooks

```bash
#!/bin/bash
# Track modified files across session

STATE_FILE=~/.claude/modified-files.txt

FILE_PATH=$(jq -r '.tool_input.file_path')

echo "$FILE_PATH" >> "$STATE_FILE"
sort -u "$STATE_FILE" -o "$STATE_FILE"

echo "📝 Total files modified this session: $(wc -l < "$STATE_FILE")"
```
