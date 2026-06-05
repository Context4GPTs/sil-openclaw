#!/bin/bash
# Notification hook: display macOS desktop notification
if command -v osascript &>/dev/null; then
  msg=$(jq -r '.message // "Claude needs your attention"')
  # Escape backslashes and double quotes for AppleScript string safety.
  esc=${msg//\\/\\\\}
  esc=${esc//\"/\\\"}
  osascript -e "display notification \"$esc\" with title \"Claude Code\"" 2>/dev/null
fi
