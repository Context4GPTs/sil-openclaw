#!/usr/bin/env python3
"""
Interactive hook configuration script for Claude Code.
Creates hook configurations in ~/.claude/settings.json or .claude/settings.json
"""

import json
import os
import sys
from pathlib import Path

# Hook event types
HOOK_EVENTS = [
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "UserPromptSubmit",
    "Notification",
    "Stop",
    "SubagentStop",
    "PreCompact",
    "SessionStart",
    "SessionEnd"
]

# Common tool matchers
COMMON_MATCHERS = {
    "All tools": "*",
    "Bash commands": "Bash",
    "File operations": "Edit|Write",
    "File reads": "Read",
    "File searches": "Glob|Grep",
}

def get_settings_path(scope):
    """Get the path to the settings file based on scope."""
    if scope == "user":
        return Path.home() / ".claude" / "settings.json"
    else:  # project
        return Path.cwd() / ".claude" / "settings.json"

def load_settings(settings_path):
    """Load existing settings or create new structure."""
    if settings_path.exists():
        with open(settings_path, 'r') as f:
            return json.load(f)
    return {}

def save_settings(settings_path, settings):
    """Save settings to file."""
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    with open(settings_path, 'w') as f:
        json.dump(settings, f, indent=2)
    print(f"\n✅ Hook configuration saved to {settings_path}")

def select_option(prompt, options):
    """Interactive option selection."""
    print(f"\n{prompt}")
    for i, option in enumerate(options, 1):
        print(f"  {i}. {option}")

    while True:
        try:
            choice = input("\nSelect option (number): ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(options):
                return options[idx]
            print(f"Please enter a number between 1 and {len(options)}")
        except (ValueError, KeyboardInterrupt):
            print("\nCancelled")
            sys.exit(0)

def main():
    print("🪝 Claude Code Hook Configuration\n")

    # Select scope
    scope_choice = select_option(
        "Where should this hook be saved?",
        ["User settings (applies to all projects)", "Project settings (this project only)"]
    )
    scope = "user" if "User" in scope_choice else "project"

    # Select hook event
    event = select_option("Which hook event?", HOOK_EVENTS)

    # Select matcher
    print("\nWhich tools should trigger this hook?")
    print("Common options:")
    for name, pattern in COMMON_MATCHERS.items():
        print(f"  - {name}: {pattern}")

    matcher = input("\nEnter matcher pattern (or press Enter for '*'): ").strip() or "*"

    # Get hook command
    print("\nEnter the hook command:")
    print("Examples:")
    print("  - jq -r '.tool_input.command' >> ~/.claude/command-log.txt")
    print("  - notify-send 'Claude' 'Task complete'")
    print("  - python3 /path/to/validator.py")

    command = input("\nCommand: ").strip()
    if not command:
        print("❌ Command cannot be empty")
        sys.exit(1)

    # Load and update settings
    settings_path = get_settings_path(scope)
    settings = load_settings(settings_path)

    # Initialize hooks structure
    if "hooks" not in settings:
        settings["hooks"] = {}
    if event not in settings["hooks"]:
        settings["hooks"][event] = []

    # Find or create matcher entry
    matcher_entry = None
    for entry in settings["hooks"][event]:
        if entry.get("matcher") == matcher:
            matcher_entry = entry
            break

    if matcher_entry is None:
        matcher_entry = {
            "matcher": matcher,
            "hooks": []
        }
        settings["hooks"][event].append(matcher_entry)

    # Add hook
    hook_config = {
        "type": "command",
        "command": command
    }
    matcher_entry["hooks"].append(hook_config)

    # Save
    save_settings(settings_path, settings)

    print(f"\n📋 Hook registered:")
    print(f"   Event: {event}")
    print(f"   Matcher: {matcher}")
    print(f"   Command: {command}")
    print(f"\n💡 Test your hook by using Claude Code and checking the results")

if __name__ == "__main__":
    main()
