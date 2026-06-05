#!/bin/bash
# Test Run Guard: Warn when non-qa-developer agents run tests directly
#
# Uses file-based sentinel: qa-developer creates /tmp/.claude-qa-active-<hash>

set -e

read -r CMD
[ -z "$CMD" ] && exit 0

IS_TEST_CMD=false
if echo "$CMD" | grep -qE '(^|\s|&&|;|\|)(npm\s+test|npx\s+(jest|vitest|mocha|playwright|cypress)|yarn\s+test|pnpm\s+test|bun\s+test)(\s|$|&&|;|\|)'; then
  IS_TEST_CMD=true
fi
if echo "$CMD" | grep -qE '(^|\s|&&|;|\|)(pytest|python\s+-m\s+(pytest|unittest)|nosetests)(\s|$|&&|;|\|)'; then
  IS_TEST_CMD=true
fi
if echo "$CMD" | grep -qE '(^|\s|&&|;|\|)(go\s+test|cargo\s+test|bundle\s+exec\s+rspec|rspec|mvn\s+test|gradle\s+test)(\s|$|&&|;|\|)'; then
  IS_TEST_CMD=true
fi

[ "$IS_TEST_CMD" = "false" ] && exit 0

# Check for qa-developer sentinel (60-minute TTL)
GIT_WORK_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HASH=$(echo "$GIT_WORK_DIR" | shasum | cut -c1-8)
SENTINEL="/tmp/.claude-qa-active-$HASH"

if [ -f "$SENTINEL" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$SENTINEL" 2>/dev/null || stat -c %Y "$SENTINEL" 2>/dev/null || echo 0) ))
  [ "$AGE" -lt 3600 ] && exit 0
fi

echo "WARNING: Direct test execution without qa-developer sentinel" >&2
echo "  Command: $CMD" >&2
echo "  Recommended: Agent tool -> subagent_type: \"qa-developer\"" >&2
exit 0
