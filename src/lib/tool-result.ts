/**
 * Shared helper for formatting tool results.
 *
 * Every tool returns the same canonical success shape — a single text
 * content part whose `text` is the JSON-stringified payload. `jsonResult`
 * is the primitive (lifted from the reference adapter
 * `klodi-plugin/adapters/openclaw/src/lib/tool-result.ts`). Each tool
 * builds its own structured payload and wraps it here, so the agent sees
 * one uniform envelope across the whole tool surface.
 */

import type { ToolResult } from "openclaw/plugin-sdk";

/** Format a successful JSON response as a tool result. */
export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
