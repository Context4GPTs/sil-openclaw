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

/**
 * Format a JSON payload as a tool result. Each extra part becomes its OWN content
 * block — the only way to send something alongside a body whose keys are the API's
 * contract and may not be added to.
 */
export function jsonResult(data: unknown, ...extra: unknown[]): ToolResult {
  return {
    content: [data, ...extra].map((part) => ({
      type: "text" as const,
      text: JSON.stringify(part, null, 2),
    })),
  };
}
