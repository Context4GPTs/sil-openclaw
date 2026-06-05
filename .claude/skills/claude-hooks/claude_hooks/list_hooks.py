#!/usr/bin/env python3
"""
Lists all registered Claude Code hooks in a readable format.
Shows both user-level and project-level hooks.
"""

import json
import sys
from pathlib import Path

def load_hooks(config_path):
    """Load hooks from settings file."""
    if not config_path.exists():
        return None

    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
            return config.get("hooks", {})
    except (json.JSONDecodeError, IOError):
        return None

def format_command(command, max_length=80):
    """Format command for display, truncating if necessary."""
    if len(command) <= max_length:
        return command
    return command[:max_length-3] + "..."

def print_hooks(title, config_path):
    """Print hooks from a configuration file."""
    hooks = load_hooks(config_path)

    if hooks is None:
        print(f"\n{title}")
        print(f"  📁 {config_path}")
        print(f"  ⚠️  No hooks configured")
        return 0

    if not hooks:
        print(f"\n{title}")
        print(f"  📁 {config_path}")
        print(f"  ⚠️  No hooks configured")
        return 0

    print(f"\n{title}")
    print(f"  📁 {config_path}\n")

    total_hooks = 0
    for event, matchers in sorted(hooks.items()):
        print(f"  🪝 {event}")

        for matcher_entry in matchers:
            matcher = matcher_entry.get("matcher", "*")
            print(f"     Matcher: {matcher}")

            for hook in matcher_entry.get("hooks", []):
                command = hook.get("command", "")
                print(f"       → {format_command(command)}")
                total_hooks += 1

        print()

    return total_hooks

def main():
    print("🪝 Claude Code Hooks Configuration\n")
    print("=" * 80)

    # Check user-level hooks
    user_config = Path.home() / ".claude" / "settings.json"
    user_count = print_hooks("User-level hooks (apply to all projects)", user_config)

    # Check project-level hooks
    project_config = Path.cwd() / ".claude" / "settings.json"
    project_count = print_hooks("Project-level hooks (this project only)", project_config)

    # Summary
    print("=" * 80)
    total = user_count + project_count
    print(f"\n📊 Total: {total} hook(s) configured")
    print(f"   User-level: {user_count}")
    print(f"   Project-level: {project_count}")

    if total == 0:
        print("\n💡 Use scripts/init_hook.py to create your first hook")

if __name__ == "__main__":
    main()
