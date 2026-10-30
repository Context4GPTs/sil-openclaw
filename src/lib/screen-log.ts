/**
 * The `sil_screen_*` operator markers. Fields repeat INLINE in the message: the host hands
 * the structured object to the log file only, and the console line is the message alone.
 */

import type { PluginAPI } from "openclaw/plugin-sdk/plugin-entry";

export type ScreenEvent =
  | "answer_skipped"
  | "answer_hit"
  | "answer_miss"
  | "call_answered"
  | "call_refused"
  | "invalid"
  | "failed";

const MAX_FIELD_CHARS = 128;

/** Ids come from the screen: a raw newline would forge a second marker line. */
const render = (value: string | number | boolean): string =>
  String(value)
    .replace(/[^\x21-\x7E]/g, "_")
    .slice(0, MAX_FIELD_CHARS);

export function logScreen(
  api: PluginAPI,
  severity: "info" | "error",
  event: ScreenEvent,
  fields: Record<string, string | number | boolean>,
): void {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${render(value)}`);
  api.logger[severity](`sil_screen_${event} ${pairs.join(" ")}`, fields);
}
