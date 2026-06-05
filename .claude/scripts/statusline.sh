#!/usr/bin/env bash
# Claude Code statusline: context usage, cost, duration, cache hit rate
# ASCII-only output (TUI statusline doesn't support ANSI escapes or multi-byte Unicode)

set -euo pipefail

# Parse environment variables provided by Claude Code
MODEL="${CLAUDE_MODEL:-unknown}"
# Use git toplevel for branch detection; CLAUDE_PROJECT_DIR for folder name
GIT_WORK_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FOLDER=$(basename "$GIT_WORK_DIR")
BRANCH=$(git -C "$GIT_WORK_DIR" branch --show-current 2>/dev/null || echo "detached")

# Context usage
CONTEXT_USED="${CLAUDE_CONTEXT_TOKENS_USED:-0}"
CONTEXT_MAX="${CLAUDE_CONTEXT_TOKENS_MAX:-200000}"

if [ "$CONTEXT_MAX" -gt 0 ]; then
    PERCENT=$(( CONTEXT_USED * 100 / CONTEXT_MAX ))
    REMAINING=$(( 100 - PERCENT ))
else
    PERCENT=0
    REMAINING=100
fi

# Progress bar (12 chars wide, ASCII only - TUI doesn't support ANSI/Unicode)
BAR_WIDTH=12
FILLED=$(( REMAINING * BAR_WIDTH / 100 ))
EMPTY=$(( BAR_WIDTH - FILLED ))
BAR=$(printf '%0.s#' $(seq 1 "$FILLED" 2>/dev/null) || true)
BAR="${BAR}$(printf '%0.s-' $(seq 1 "$EMPTY" 2>/dev/null) || true)"

# Cost
COST="${CLAUDE_SESSION_COST:-0.00}"

# Duration
START="${CLAUDE_SESSION_START:-}"
if [ -n "$START" ]; then
    NOW=$(date +%s)
    ELAPSED=$(( NOW - START ))
    MINS=$(( ELAPSED / 60 ))
    SECS=$(( ELAPSED % 60 ))
    DURATION="${MINS}m ${SECS}s"
else
    DURATION="--"
fi

# Cache hit rate
CACHE_HITS="${CLAUDE_CACHE_READ_TOKENS:-0}"
CACHE_TOTAL="${CLAUDE_CACHE_CREATION_TOKENS:-0}"
if [ "$CACHE_TOTAL" -gt 0 ] && [ "$CACHE_HITS" -gt 0 ]; then
    CACHE_RATE=$(( CACHE_HITS * 100 / (CACHE_HITS + CACHE_TOTAL) ))
    CACHE_STR="cache ${CACHE_RATE}%"
else
    CACHE_STR="cache --"
fi

# Output
printf "[%s] %s | %s\n" "$MODEL" "$FOLDER" "$BRANCH"
printf "[%s] %d%% | \$%s | %s | %s\n" "$BAR" "$REMAINING" "$COST" "$DURATION" "$CACHE_STR"
