# Security Best Practices for Hooks

Hooks execute with your credentials and environment access. Follow these practices to avoid security issues.

## Critical Security Rules

### 1. Always Validate Input

Hooks receive JSON data from Claude. Malicious or malformed input could exploit your hooks.

**Bad Example:**
```bash
# DANGEROUS: Command injection vulnerability
eval $(jq -r '.tool_input.command')
```

**Good Example:**
```bash
# Safe: Validate before use
COMMAND=$(jq -r '.tool_input.command')
if echo "$COMMAND" | grep -qE '^(ls|pwd|git status)$'; then
    eval "$COMMAND"
else
    echo "Command not allowed"
    exit 2
fi
```

### 2. Never Execute Untrusted Code

Do not execute code directly from tool inputs without validation.

**Bad Example:**
```bash
# DANGEROUS: Executes arbitrary Python
python3 -c "$(jq -r '.tool_input.content')"
```

**Good Example:**
```bash
# Safe: Validate file path, then execute known script
FILE_PATH=$(jq -r '.tool_input.file_path')
if [[ "$FILE_PATH" == *.py ]] && [[ -f "$FILE_PATH" ]]; then
    python3 /path/to/your/validator.py "$FILE_PATH"
fi
```

### 3. Sanitize File Paths

Prevent path traversal attacks and unauthorized file access.

**Bad Example:**
```bash
# DANGEROUS: Can access any file
cat "$(jq -r '.tool_input.file_path')"
```

**Good Example:**
```python
import json
import os
import sys
from pathlib import Path

data = json.load(sys.stdin)
file_path = data.get('tool_input', {}).get('file_path', '')

# Resolve to absolute path and check it's within allowed directory
try:
    abs_path = Path(file_path).resolve()
    allowed_dir = Path.cwd().resolve()

    if allowed_dir not in abs_path.parents and abs_path != allowed_dir:
        print("Access denied: File outside project directory")
        sys.exit(2)

    # Safe to proceed
    with open(abs_path, 'r') as f:
        content = f.read()

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
```

### 4. Limit Network Access

Be cautious with hooks that make network requests.

**Bad Example:**
```bash
# DANGEROUS: Sends data to arbitrary URL
URL=$(jq -r '.tool_input.url')
curl -X POST "$URL" -d @sensitive-data.json
```

**Good Example:**
```bash
# Safe: Whitelist allowed endpoints
WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

MESSAGE=$(jq -r '.result')
curl -X POST "$WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"text\":\"$MESSAGE\"}"
```

### 5. Protect Sensitive Data

Never log or transmit sensitive information.

**Bad Example:**
```bash
# DANGEROUS: Logs might contain secrets
jq '.' >> ~/.claude/all-tool-calls.log
```

**Good Example:**
```bash
# Safe: Filter sensitive fields
jq 'del(.tool_input.password, .tool_input.api_key, .tool_input.token)' \
  >> ~/.claude/tool-calls.log
```

## Environment Variable Security

### Secure API Keys and Tokens

Store secrets in environment variables, never in hook code.

**Bad Example:**
```bash
# DANGEROUS: Hardcoded secret (example only - not a real key)
API_KEY="example-key-do-not-use"
curl -H "Authorization: Bearer $API_KEY" https://api.example.com
```

**Good Example:**
```bash
# Safe: Load from environment
if [ -z "$EXAMPLE_API_KEY" ]; then
    echo "Error: EXAMPLE_API_KEY not set"
    exit 1
fi

curl -H "Authorization: Bearer $EXAMPLE_API_KEY" https://api.example.com
```

### Isolate Sensitive Operations

Use dedicated scripts for operations requiring credentials.

```python
#!/usr/bin/env python3
# .claude/hooks/secure-operation.py

import os
import sys

# Check required environment variables
required_vars = ['API_KEY', 'API_SECRET']
missing = [v for v in required_vars if v not in os.environ]

if missing:
    print(f"Missing required environment variables: {', '.join(missing)}")
    sys.exit(1)

# Safe to proceed with authenticated operation
api_key = os.environ['API_KEY']
# ... perform operation
```

## File System Security

### Prevent Unauthorized Writes

Protect critical files and directories.

```python
#!/usr/bin/env python3
import json
import sys
from pathlib import Path

# Protected paths
PROTECTED = [
    '.git',
    '.env',
    '.env.production',
    'package-lock.json',
    'yarn.lock',
    'Cargo.lock'
]

data = json.load(sys.stdin)
file_path = data.get('tool_input', {}).get('file_path', '')

# Check if path is protected
if any(protected in file_path for protected in PROTECTED):
    print(f"❌ Cannot modify protected file: {file_path}")
    sys.exit(2)

# Allow operation
sys.exit(0)
```

### Use Temporary Files Safely

When creating temporary files, ensure proper permissions.

```python
import tempfile
import os

# Create temp file with restricted permissions
fd, temp_path = tempfile.mkstemp(suffix='.txt')
os.chmod(temp_path, 0o600)  # Owner read/write only

try:
    with os.fdopen(fd, 'w') as f:
        f.write(sensitive_data)
    # Use temp file
finally:
    os.unlink(temp_path)  # Clean up
```

## Command Injection Prevention

### Escape Shell Arguments

Never pass unvalidated input to shell commands.

**Bad Example:**
```bash
# DANGEROUS: Command injection
FILE=$(jq -r '.tool_input.file_path')
cat $FILE  # Vulnerable if FILE contains spaces or special chars
```

**Good Example:**
```bash
# Safe: Proper quoting
FILE=$(jq -r '.tool_input.file_path')
cat "$FILE"

# Or use array for complete safety
FILE=$(jq -r '.tool_input.file_path')
cat -- "$FILE"
```

### Use Language-Native APIs

Prefer Python/Node.js file operations over shell commands.

**Bad Example:**
```python
import subprocess
file_path = data.get('file_path')
subprocess.run(f'cat {file_path}', shell=True)  # DANGEROUS
```

**Good Example:**
```python
from pathlib import Path
file_path = Path(data.get('file_path'))
content = file_path.read_text()  # Safe
```

## Error Handling

### Fail Securely

Ensure errors don't expose sensitive information.

**Bad Example:**
```python
try:
    api_key = os.environ['SECRET_API_KEY']
    result = make_api_call(api_key)
except Exception as e:
    print(f"Error: {e}")  # Might leak API key in error
    sys.exit(1)
```

**Good Example:**
```python
try:
    api_key = os.environ.get('SECRET_API_KEY')
    if not api_key:
        raise ValueError("API key not configured")

    result = make_api_call(api_key)
except Exception:
    print("Error: API call failed")  # Generic message
    sys.exit(1)
```

### Clean Up on Failure

Ensure sensitive data is cleaned up even when errors occur.

```python
import tempfile
import os

temp_file = None
try:
    temp_file = tempfile.NamedTemporaryFile(delete=False)
    temp_file.write(sensitive_data)
    temp_file.close()

    # Process file
    process(temp_file.name)

finally:
    if temp_file and os.path.exists(temp_file.name):
        os.unlink(temp_file.name)
```

## Audit and Monitoring

### Log Security-Relevant Events

Track when sensitive operations occur.

```bash
#!/bin/bash
# Log protected file access attempts

FILE_PATH=$(jq -r '.tool_input.file_path')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [[ "$FILE_PATH" == *.env* ]] || [[ "$FILE_PATH" == *secret* ]]; then
    echo "[$TIMESTAMP] Attempted access to sensitive file: $FILE_PATH" \
      >> ~/.claude/security-audit.log
    exit 2
fi
```

### Implement Rate Limiting

Prevent abuse through excessive hook executions.

```python
#!/usr/bin/env python3
import json
import time
from pathlib import Path

RATE_LIMIT_FILE = Path.home() / '.claude' / 'rate-limit.json'
MAX_CALLS_PER_MINUTE = 60

# Load rate limit state
if RATE_LIMIT_FILE.exists():
    with open(RATE_LIMIT_FILE) as f:
        state = json.load(f)
else:
    state = {'calls': [], 'blocked': 0}

# Clean old entries (older than 1 minute)
now = time.time()
state['calls'] = [t for t in state['calls'] if now - t < 60]

# Check rate limit
if len(state['calls']) >= MAX_CALLS_PER_MINUTE:
    state['blocked'] += 1
    with open(RATE_LIMIT_FILE, 'w') as f:
        json.dump(state, f)
    print(f"Rate limit exceeded: {len(state['calls'])} calls in last minute")
    exit(2)

# Record this call
state['calls'].append(now)
with open(RATE_LIMIT_FILE, 'w') as f:
    json.dump(state, f)
```

## Principle of Least Privilege

### Grant Minimal Permissions

Run hooks with the minimum necessary permissions.

**Example: Read-only validation hook**
```python
#!/usr/bin/env python3
# This hook only reads files, never writes
import json
import sys
from pathlib import Path

data = json.load(sys.stdin)
file_path = Path(data.get('tool_input', {}).get('file_path', ''))

# Only read operations - never modify
if not file_path.exists():
    sys.exit(0)

try:
    content = file_path.read_text()
    # Perform validation
    if 'TODO' in content:
        print("Warning: File contains TODO items")
except Exception:
    pass  # Fail silently for read-only operation
```

### Scope Hooks Appropriately

Use project-level hooks for project-specific security, user-level for general policies.

**Project-level (.claude/settings.json):**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-project-structure.py"
          }
        ]
      }
    ]
  }
}
```

**User-level (~/.claude/settings.json):**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/global-security-check.py"
          }
        ]
      }
    ]
  }
}
```

## Security Checklist

Before deploying a hook, verify:

- [ ] Input validation for all external data
- [ ] No hardcoded secrets or credentials
- [ ] File paths validated and sanitized
- [ ] Commands properly quoted and escaped
- [ ] Network requests go to whitelisted endpoints only
- [ ] Sensitive data filtered from logs
- [ ] Error messages don't expose secrets
- [ ] Cleanup occurs even on failure
- [ ] Appropriate exit codes used
- [ ] Security-relevant events logged
- [ ] Hook runs with minimal necessary permissions
- [ ] Rate limiting considered for expensive operations
