#!/usr/bin/env python3
"""
Validates Claude Code hook configurations.
Checks for common errors and provides helpful feedback.
"""

import json
import sys
from pathlib import Path

VALID_EVENTS = {
    "PreToolUse", "PermissionRequest", "PostToolUse", "UserPromptSubmit",
    "Notification", "Stop", "SubagentStop", "PreCompact", "SessionStart", "SessionEnd"
}

def validate_hook_config(config_path):
    """Validate hook configuration file."""
    errors = []
    warnings = []

    # Load config
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        return [f"❌ Invalid JSON: {e}"], []
    except FileNotFoundError:
        return [f"❌ File not found: {config_path}"], []

    # Check hooks structure
    if "hooks" not in config:
        warnings.append("⚠️  No hooks defined in configuration")
        return errors, warnings

    hooks = config["hooks"]
    if not isinstance(hooks, dict):
        errors.append("❌ 'hooks' must be an object")
        return errors, warnings

    # Validate each event
    for event, matchers in hooks.items():
        if event not in VALID_EVENTS:
            errors.append(f"❌ Invalid event type: {event}")
            errors.append(f"   Valid events: {', '.join(sorted(VALID_EVENTS))}")
            continue

        if not isinstance(matchers, list):
            errors.append(f"❌ Event '{event}' must have a list of matchers")
            continue

        # Validate matchers
        for i, matcher_entry in enumerate(matchers):
            if not isinstance(matcher_entry, dict):
                errors.append(f"❌ Event '{event}' matcher #{i+1} must be an object")
                continue

            if "matcher" not in matcher_entry:
                errors.append(f"❌ Event '{event}' matcher #{i+1} missing 'matcher' field")

            if "hooks" not in matcher_entry:
                errors.append(f"❌ Event '{event}' matcher #{i+1} missing 'hooks' field")
                continue

            if not isinstance(matcher_entry["hooks"], list):
                errors.append(f"❌ Event '{event}' matcher #{i+1} 'hooks' must be a list")
                continue

            # Validate individual hooks
            for j, hook in enumerate(matcher_entry["hooks"]):
                if not isinstance(hook, dict):
                    errors.append(f"❌ Event '{event}' matcher #{i+1} hook #{j+1} must be an object")
                    continue

                if "type" not in hook:
                    errors.append(f"❌ Event '{event}' matcher #{i+1} hook #{j+1} missing 'type'")
                elif hook["type"] != "command":
                    warnings.append(f"⚠️  Event '{event}' matcher #{i+1} hook #{j+1} has unknown type: {hook['type']}")

                if "command" not in hook:
                    errors.append(f"❌ Event '{event}' matcher #{i+1} hook #{j+1} missing 'command'")
                elif not hook["command"].strip():
                    errors.append(f"❌ Event '{event}' matcher #{i+1} hook #{j+1} has empty command")

    return errors, warnings

def main():
    if len(sys.argv) > 1:
        config_path = Path(sys.argv[1])
    else:
        # Check common locations
        user_config = Path.home() / ".claude" / "settings.json"
        project_config = Path.cwd() / ".claude" / "settings.json"

        if project_config.exists():
            config_path = project_config
        elif user_config.exists():
            config_path = user_config
        else:
            print("❌ No settings.json found")
            print(f"   Checked: {user_config}")
            print(f"   Checked: {project_config}")
            sys.exit(1)

    print(f"🔍 Validating hook configuration: {config_path}\n")

    errors, warnings = validate_hook_config(config_path)

    # Print results
    if warnings:
        for warning in warnings:
            print(warning)
        print()

    if errors:
        for error in errors:
            print(error)
        print(f"\n❌ Validation failed with {len(errors)} error(s)")
        sys.exit(1)
    else:
        print("✅ Hook configuration is valid")
        sys.exit(0)

if __name__ == "__main__":
    main()
