/**
 * Shared helpers for formatting tool results.
 *
 * Every tool returns the same canonical success shape — a single text
 * content part whose `text` is the JSON-stringified payload. `jsonResult`
 * is the primitive (lifted from the reference adapter
 * `klodi-plugin/adapters/openclaw/src/lib/tool-result.ts`); `stubResult`
 * wraps it so every skeleton stub answers with an *identical* envelope
 * (`{ stub: true, tool, echo }`). That identical shape is what makes
 * "follow the existing pattern" a pattern and not a pile of one-offs:
 * a new tool copies the `stubResult(name, params)` call and only its
 * name + parameter schema differ.
 *
 * A real tool replaces `stubResult(...)` with `jsonResult(<real data>)`
 * once it has a backend to call — the result shape the agent sees does
 * not change.
 */

import type { ToolResult } from "openclaw/plugin-sdk";

/** Format a successful JSON response as a tool result. */
export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Placeholder result for a stub tool: echoes the call back so the
 * request→response wiring is demonstrably real even though no work is
 * done. `tool` names which stub answered; `echo` returns the params
 * verbatim so a caller can confirm the schema round-tripped.
 *
 * Performs no I/O — no network, no timer, no filesystem, no credential
 * read. Replacing this call with `jsonResult(<real payload>)` is the
 * only edit needed to turn a stub into a real tool.
 */
export function stubResult(
  tool: string,
  params: Record<string, unknown>,
): ToolResult {
  return jsonResult({ stub: true, tool, echo: params });
}
