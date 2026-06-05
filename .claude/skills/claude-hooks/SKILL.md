---
name: claude-hooks
description: Create, manage, and configure Claude Code hooks to customize behavior at various lifecycle events. This skill should be used when users want to automate formatting, set up notifications, enforce security policies, add logging, or customize Claude Code's behavior through deterministic shell commands that execute at specific trigger points.
---

# Claude Hooks

## Overview

Manage Claude Code hooks - user-defined shell commands that execute at specific points in Claude's lifecycle. Hooks provide deterministic control over Claude Code behavior, ensuring certain actions always happen rather than relying on the LLM to choose to run them.

Use this skill to help users create, validate, and manage hooks for:
- Auto-formatting code after edits
- Logging commands and file changes
- Blocking edits to sensitive files
- Desktop notifications
- Running tests automatically
- Custom security policies

## Installation

The skill includes CLI tools packaged with uv for easy installation:

```bash
# Install from the skill directory
cd claude_hooks/
uv pip install .
```

This installs three CLI commands:
- `claude-hooks-init` - Interactive hook creation wizard
- `claude-hooks-validate` - Validate hook configurations
- `claude-hooks-list` - List all registered hooks

See `INSTALL.md` for detailed installation instructions and alternatives.

## Core Capabilities

### 1. Interactive Hook Creation

Use `claude-hooks-init` to guide users through creating hook configurations interactively.

**When to use**: User wants to create a new hook but needs guidance on event types, matchers, and commands.

**Usage**:
```bash
claude-hooks-init
```

The CLI will:
1. Ask where to save the hook (user-level or project-level)
2. Prompt for which hook event to use
3. Help select a tool matcher pattern
4. Collect the hook command
5. Save the configuration to the appropriate settings.json

**Example interaction**:
```
User: "Set up a hook to log all bash commands"

1. Run claude-hooks-init
2. Select "User settings" for scope
3. Select "PreToolUse" event
4. Enter matcher: "Bash"
5. Enter command: jq -r '"\(.tool_input.command) - \(.tool_input.description // \"No description\")"' >> ~/.claude/bash-command-log.txt
```

**Alternative**: Run directly without installation:
```bash
python3 claude_hooks/init_hook.py
```

### 2. Hook Validation

Use `claude-hooks-validate` to check hook configurations for errors.

**When to use**: After creating or modifying hooks, or when debugging hook issues.

**Usage**:
```bash
# Validate default location
claude-hooks-validate

# Validate specific file
claude-hooks-validate /path/to/settings.json
```

The validator checks for:
- Valid JSON structure
- Correct hook event names
- Proper matcher and hooks format
- Required fields presence
- Empty or malformed commands

**Alternative**: Run directly without installation:
```bash
python3 claude_hooks/validate_hook.py
```

### 3. Listing Active Hooks

Use `claude-hooks-list` to display all registered hooks in a readable format.

**When to use**: User wants to see what hooks are currently configured, or debug which hooks will execute.

**Usage**:
```bash
claude-hooks-list
```

Shows:
- User-level hooks (from ~/.claude/settings.json)
- Project-level hooks (from .claude/settings.json)
- Hook counts and organization by event type

**Alternative**: Run directly without installation:
```bash
python3 claude_hooks/list_hooks.py
```

### 4. Pre-Built Hook Templates

Use templates from `assets/hook_templates/` for common use cases.

**Available templates**:
- `auto-format.json` - Auto-format files based on extension (TypeScript, Python, Go, Rust)
- `command-logging.json` - Log all bash commands with timestamps
- `file-protection.json` - Block edits to sensitive files (.env, lock files, etc.)
- `desktop-notifications.json` - Desktop notifications for task completion and input requests
- `test-runner.json` - Auto-run tests after code changes

**When to use**: User wants a common hook configuration and needs a starting point.

**Usage pattern**:
1. Identify user's need (e.g., "auto-format TypeScript files")
2. Read the appropriate template from `assets/hook_templates/`
3. Explain the configuration
4. Help user merge it into their settings.json or adapt it to their needs

**Example**:
```
User: "I want to auto-format my TypeScript files after Claude edits them"

1. Read assets/hook_templates/auto-format.json
2. Explain the PostToolUse hook with Edit|Write matcher
3. Show how to add to .claude/settings.json or ~/.claude/settings.json
4. Test by having Claude edit a .ts file
```

## Hook Events Quick Reference

Consult `references/hook_events_reference.md` for complete event documentation, including:
- Event timing and lifecycle
- Available data structures for each event
- Exit code meanings
- Common use cases

**Most commonly used events**:

| Event | When it runs | Common uses |
|-------|-------------|-------------|
| PreToolUse | Before tool calls | Validation, blocking, logging |
| PostToolUse | After tool completion | Formatting, testing, cleanup |
| PermissionRequest | When permission needed | Auto-approve/deny rules |
| Notification | When Claude needs attention | Desktop alerts, sounds |
| Stop | After Claude finishes responding | Analytics, triggers |

**Key points**:
- PreToolUse can block operations (exit 1 or 2)
- PostToolUse is informational only
- All events receive JSON data on stdin
- Use jq for JSON parsing in bash hooks

## Creating Custom Hooks

### Basic Pattern

All hooks follow this structure in settings.json:

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern",
        "hooks": [
          {
            "type": "command",
            "command": "shell command here"
          }
        ]
      }
    ]
  }
}
```

### Workflow for Custom Hooks

1. **Identify the trigger point**
   - What event should trigger this? (PreToolUse, PostToolUse, etc.)
   - Consult `references/hook_events_reference.md` if unsure

2. **Define the matcher**
   - Which tools? Use `*` for all, `Bash` for commands, `Edit|Write` for file operations
   - Be specific to avoid unnecessary executions

3. **Write the command**
   - Use `jq` to parse JSON input from stdin
   - Extract needed fields: `.tool_input.command`, `.tool_input.file_path`, etc.
   - Return appropriate exit code (0 = allow, 1 = block with warning, 2 = block with error)

4. **Test the hook**
   - Validate with `claude-hooks-validate`
   - Trigger the hook by using Claude Code
   - Check logs or outputs to verify behavior

5. **Iterate and refine**
   - Add error handling
   - Consider edge cases
   - Review security implications

### Example: Block Git Push to Main

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' | { read cmd; if echo \"$cmd\" | grep -q 'git push.*main'; then echo '❌ Direct push to main not allowed'; exit 2; fi; }"
          }
        ]
      }
    ]
  }
}
```

**How this works**:
1. Triggers on all Bash tool calls (matcher: "Bash")
2. Extracts the command using jq
3. Checks if command contains "git push" and "main"
4. Exits with code 2 to block the operation with error message

## Common Patterns and Examples

For extensive examples beyond what's in SKILL.md, consult `references/hook_examples.md`, which includes:

- Code quality & formatting hooks
- Security & protection hooks
- Logging & analytics hooks
- Notification hooks
- Testing & CI/CD hooks
- Development workflow hooks
- Context management hooks
- Advanced patterns with state tracking

### Quick Examples

**Auto-format Python with Black**:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | { read f; [[ \"$f\" == *.py ]] && black \"$f\" 2>/dev/null || true; }"
          }
        ]
      }
    ]
  }
}
```

**Log file modifications**:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '\"[\" + (now | strftime(\"%Y-%m-%d %H:%M:%S\")) + \"] \" + .tool_input.file_path' >> ~/.claude/file-changes.log"
          }
        ]
      }
    ]
  }
}
```

**Desktop notification on completion**:
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "notify-send 'Claude Code' 'Task completed'"
          }
        ]
      }
    ]
  }
}
```

## Security Considerations

**CRITICAL**: Hooks execute with your credentials and environment access. Always review security implications.

Consult `references/security_best_practices.md` for comprehensive security guidance, including:

- Input validation techniques
- Command injection prevention
- File path sanitization
- Environment variable security
- Protecting sensitive data
- Secure error handling
- Audit and monitoring
- Principle of least privilege

**Key security rules**:

1. **Validate all input** - Never trust data from tool_input without validation
2. **Sanitize file paths** - Check for path traversal and unauthorized access
3. **Quote shell variables** - Always use `"$variable"` not `$variable`
4. **Whitelist, don't blacklist** - Define what's allowed rather than what's blocked
5. **Never log secrets** - Filter sensitive fields before logging
6. **Use exit codes correctly** - Exit 2 for critical blocks, 1 for warnings
7. **Fail securely** - Errors should not expose sensitive information

**Quick security check**:
```bash
# BAD - Command injection vulnerability
eval $(jq -r '.tool_input.command')

# GOOD - Validate before use
COMMAND=$(jq -r '.tool_input.command')
if [[ "$COMMAND" =~ ^(ls|pwd|git status)$ ]]; then
    eval "$COMMAND"
else
    echo "Command not allowed"
    exit 2
fi
```

## Troubleshooting

### Hook not executing
1. Validate configuration: `claude-hooks-validate`
2. Check matcher pattern matches the tool being used
3. Verify hook command has correct syntax
4. Test command manually with sample JSON input

### Hook blocking unintended operations
1. List all hooks: `claude-hooks-list`
2. Check matcher pattern - might be too broad
3. Review exit codes in hook command
4. Add conditional logic to narrow trigger conditions

### Hook command failing
1. Test command outside of Claude Code with sample JSON
2. Check for missing dependencies (jq, notify-send, etc.)
3. Verify file paths and permissions
4. Add error handling to hook command

### Finding hook configuration
- User-level: `~/.claude/settings.json`
- Project-level: `.claude/settings.json` (in project root)
- Use `claude-hooks-list` to see all active hooks

## Resources

### claude_hooks/
Python package providing CLI tools for hook management:
- `claude-hooks-init` - Interactive hook creation wizard
- `claude-hooks-validate` - Hook configuration validator
- `claude-hooks-list` - Display all registered hooks

Install with `uv pip install .` or run scripts directly with Python.

### references/
Comprehensive documentation loaded as needed:
- `hook_events_reference.md` - Complete event lifecycle and data structures
- `hook_examples.md` - Extensive practical examples beyond this guide
- `security_best_practices.md` - Security guidelines and patterns

Reference these files when users need deeper information about specific events, advanced patterns, or security considerations.

### assets/
Pre-built hook templates ready to use:
- `hook_templates/auto-format.json` - Multi-language auto-formatting
- `hook_templates/command-logging.json` - Bash command logging
- `hook_templates/file-protection.json` - Sensitive file protection
- `hook_templates/desktop-notifications.json` - Desktop alerts
- `hook_templates/test-runner.json` - Auto-test execution

Use these templates as starting points or examples for common use cases.
