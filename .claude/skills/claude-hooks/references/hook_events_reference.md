# Hook Events Reference

Complete reference for all Claude Code hook events, their timing, and available data.

## Event Lifecycle

```
SessionStart
    ↓
UserPromptSubmit → PreToolUse → [Tool Execution] → PostToolUse
    ↑                   ↓
    └── PermissionRequest (if needed)

PreCompact (when context is getting full)

Notification (when Claude needs attention)

Stop (after Claude finishes responding)

SubagentStop (when background tasks complete)

SessionEnd (when session terminates)
```

## Hook Events

### PreToolUse

**Timing**: Before any tool call executes

**Purpose**: Validate, modify, or block tool calls before execution

**Exit codes**:
- `0` - Allow tool to proceed
- `1` - Block tool with warning message
- `2` - Block tool with error message

**Available data**:
```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "ls -la",
    "description": "List files"
  }
}
```

**Common use cases**:
- Validate bash commands before execution
- Block operations on sensitive files
- Log all tool calls
- Enforce naming conventions

### PostToolUse

**Timing**: After tool call completes successfully

**Purpose**: React to completed tool calls, perform cleanup, or trigger follow-up actions

**Exit codes**: Ignored (informational only)

**Available data**:
```json
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/path/to/file.ts",
    "old_string": "...",
    "new_string": "..."
  },
  "tool_output": "File edited successfully"
}
```

**Common use cases**:
- Auto-format files after editing
- Run linters after code changes
- Update documentation
- Trigger builds or tests

### PermissionRequest

**Timing**: When Claude requests user permission

**Purpose**: Auto-approve or auto-deny permission requests based on rules

**Exit codes**:
- `0` - Auto-approve the request
- `1` - Auto-deny the request
- Other - Show permission dialog to user

**Available data**:
```json
{
  "request_type": "tool_permission",
  "tool_name": "Bash",
  "details": "Run git push"
}
```

**Common use cases**:
- Auto-approve safe read-only commands
- Auto-deny destructive operations
- Enforce team policies
- Time-based permissions (e.g., no deployments after 5pm)

### UserPromptSubmit

**Timing**: When user submits a prompt, before Claude processes it

**Purpose**: Preprocess, validate, or augment user prompts

**Exit codes**:
- `0` - Continue with prompt
- `1` - Block prompt with warning
- `2` - Block prompt with error

**Available data**:
```json
{
  "prompt": "Add login functionality",
  "attachments": [
    {"type": "file", "path": "/path/to/design.png"}
  ]
}
```

**Common use cases**:
- Add context automatically (e.g., current sprint goals)
- Validate prompt against policies
- Log all user requests
- Template expansion

### Notification

**Timing**: When Claude sends a notification (needs input, task complete, etc.)

**Purpose**: Custom notification delivery

**Exit codes**: Ignored

**Available data**:
```json
{
  "type": "awaiting_input",
  "message": "Waiting for your response"
}
```

**Common use cases**:
- Desktop notifications
- Slack/Teams messages
- Sound alerts
- Mobile push notifications

### Stop

**Timing**: After Claude finishes responding to user

**Purpose**: React to completion of Claude's response

**Exit codes**: Ignored

**Available data**:
```json
{
  "turn_count": 5,
  "tools_used": ["Read", "Edit", "Bash"],
  "duration_ms": 12500
}
```

**Common use cases**:
- Performance tracking
- Usage analytics
- Auto-save session state
- Trigger CI/CD pipelines

### SubagentStop

**Timing**: When a background subagent task completes

**Purpose**: React to completion of async tasks

**Exit codes**: Ignored

**Available data**:
```json
{
  "subagent_type": "test-runner",
  "task_id": "abc123",
  "result": "success",
  "output": "All tests passed"
}
```

**Common use cases**:
- Notify on test completion
- Chain dependent tasks
- Aggregate results
- Update dashboards

### PreCompact

**Timing**: Before Claude compacts the conversation to save context

**Purpose**: Save state before context is compressed

**Exit codes**:
- `0` - Allow compaction
- `1` - Delay compaction (use sparingly)

**Available data**:
```json
{
  "current_tokens": 185000,
  "max_tokens": 200000,
  "messages_count": 143
}
```

**Common use cases**:
- Export conversation before compaction
- Save important context externally
- Create checkpoints
- Archive decisions

### SessionStart

**Timing**: When Claude Code session starts or resumes

**Purpose**: Initialize session state, restore context

**Exit codes**: Ignored

**Available data**:
```json
{
  "session_id": "xyz789",
  "is_resume": false,
  "working_directory": "/path/to/project"
}
```

**Common use cases**:
- Load project-specific context
- Initialize development environment
- Restore previous state
- Set up monitoring

### SessionEnd

**Timing**: When Claude Code session terminates

**Purpose**: Cleanup, save state, final reporting

**Exit codes**: Ignored

**Available data**:
```json
{
  "session_id": "xyz789",
  "duration_ms": 1800000,
  "total_turns": 47,
  "reason": "user_exit"
}
```

**Common use cases**:
- Save session summary
- Generate reports
- Cleanup temporary files
- Update time tracking

## Exit Code Summary

| Exit Code | PreToolUse | PermissionRequest | UserPromptSubmit | PreCompact |
|-----------|------------|-------------------|------------------|------------|
| 0         | Allow      | Auto-approve      | Continue         | Allow      |
| 1         | Block (warn) | Auto-deny       | Block (warn)     | Delay      |
| 2         | Block (error) | Show dialog    | Block (error)    | -          |
| Other     | Block (error) | Show dialog    | Block (error)    | Allow      |

## Data Access Patterns

Access tool input fields:
```bash
jq -r '.tool_input.command'              # Bash command
jq -r '.tool_input.file_path'            # File path from Edit/Write/Read
jq -r '.tool_input.pattern'              # Pattern from Grep/Glob
```

Check tool type:
```bash
jq -r '.tool_name'                       # Returns tool name
```

Access nested data:
```bash
jq -r '.tool_input.content' | wc -l      # Count lines in Write content
jq -r '.attachments[0].path'             # First attachment path
```
