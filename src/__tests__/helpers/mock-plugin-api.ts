/**
 * Mock PluginAPI factory for testing tool registration and the plugin
 * entry contract. Captures registered tools into a Map for assertion.
 *
 * Lifted from the reference adapter
 * `klodi-plugin/adapters/openclaw/src/__tests__/helpers/mock-plugin-api.ts`,
 * trimmed to what the sil skeleton's tests touch: tool registration,
 * the logger spies (so we can assert the `sil_plugin_loaded` marker),
 * and the `config` / `pluginConfig` surfaces (so config-override tests
 * can drive the two distinct sources OpenClaw injects).
 *
 * Production OpenClaw injects `config` as the FULL OpenClawConfig tree
 * (plain object — top-level keys like `agents`, `plugins`, etc.) and
 * `pluginConfig` as the plugin-scoped block validated against
 * `openclaw.plugin.json#configSchema`. Neither has a `.get()` method —
 * code that reaches for `api.config.get(...)` is reading the wrong
 * surface, and this double mirrors that plain-object shape so such a
 * mistake fails loudly here.
 *
 * The `service`/`runtime` surfaces from the reference are intentionally
 * dropped: the skeleton registers no long-lived service and the
 * "register opens nothing" criterion is asserted by spying on timers,
 * not by a runtime double.
 */

import { vi } from "vitest";
import type { PluginAPI, ToolDefinition } from "openclaw/plugin-sdk";

export interface MockPluginAPI extends PluginAPI {
  _tools: Map<string, ToolDefinition>;
}

export interface CreateMockPluginApiOptions {
  pluginConfig?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export function createMockPluginApi(
  options: CreateMockPluginApiOptions = {},
): MockPluginAPI {
  const tools = new Map<string, ToolDefinition>();

  return {
    _tools: tools,

    registerTool(tool: ToolDefinition): void {
      tools.set(tool.name, tool);
    },

    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },

    config: options.config ?? {},
    pluginConfig: options.pluginConfig ?? {},
  } as unknown as MockPluginAPI;
}

/** Retrieve a registered tool by name. Throws (listing what IS
 * registered) if not found — a missing tool name should produce a
 * legible failure, not an undefined-deref three lines later. */
export function getTool(api: MockPluginAPI, name: string): ToolDefinition {
  const tool = api._tools.get(name);
  if (!tool) {
    const registered = [...api._tools.keys()].join(", ") || "(none)";
    throw new Error(
      `Tool "${name}" not registered. Registered tools: ${registered}`,
    );
  }
  return tool;
}

/** The set of tool names registered against the mock api. The drift
 * guard set-compares this against `openclaw.plugin.json#contracts.tools`. */
export function registeredToolNames(api: MockPluginAPI): Set<string> {
  return new Set(api._tools.keys());
}
