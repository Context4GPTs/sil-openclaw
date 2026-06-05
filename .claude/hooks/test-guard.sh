#!/bin/bash
# Test Guard Hook: Prevent non-qa-developer agents from modifying test files
#
# Uses file-based sentinel: qa-developer creates /tmp/.claude-qa-active-<hash>
# on start. This hook checks for that sentinel (60-minute TTL).

set -e

read -r FILE_PATH
[ -z "$FILE_PATH" ] && exit 0

# Check if this is a test file
IS_TEST=false
case "$FILE_PATH" in
  *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx)
    IS_TEST=true ;;
  *.test.py|*_test.py|*_test.go)
    IS_TEST=true ;;
  *.integration.test.*|*.e2e.test.*|*.acceptance.test.*)
    IS_TEST=true ;;
esac
if echo "$FILE_PATH" | grep -qE '(/__tests__/|/test/|/tests/|\.test\.)'; then
  IS_TEST=true
fi

[ "$IS_TEST" = "false" ] && exit 0

# Check for qa-developer sentinel (60-minute TTL)
GIT_WORK_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HASH=$(echo "$GIT_WORK_DIR" | shasum | cut -c1-8)
SENTINEL="/tmp/.claude-qa-active-$HASH"

if [ -f "$SENTINEL" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$SENTINEL" 2>/dev/null || stat -c %Y "$SENTINEL" 2>/dev/null || echo 0) ))
  [ "$AGE" -lt 3600 ] && exit 0
fi

echo "BLOCKED: Test file modification without qa-developer sentinel" >&2
echo "  File: $FILE_PATH" >&2
echo "  Test files are owned by the qa-developer agent." >&2
echo "  Use: Agent tool -> subagent_type: \"qa-developer\"" >&2
exit 2
