/**
 * The `sil_search_results_*` operator markers, with their fields repeated INLINE in the
 * message. The host hands the structured object to the log FILE only — the console line
 * a container's `docker logs` shows is the message alone (`createSubsystemLogger`'s
 * `emitLog`, vendor/openclaw). Fields-only, a delivery miss reads `[plugins]
 * sil_search_results_miss` with no callId to join on and no cause.
 */

import type { PluginAPI } from "openclaw/plugin-sdk/plugin-entry";

/** The four outcomes of the delivery buffer, plus the handler's own fault. `skipped` is
 * the BUFFER side: a search whose page was never stored, and why. */
export type SearchResultsEvent = "hit" | "miss" | "skipped" | "invalid" | "failed";

// `severity`, never `level` — `docsNeedleExclusions()` drops any retired needle whose
// string occurs in live `src/`, and that word plus a colon is one: renaming REDs AC16.

/** Long enough for a host `callId` (28 chars) and every cause below, short enough that
 * no single call can run the line away. */
const MAX_FIELD_CHARS = 128;

/** The `callId` is the CLIENT's string, checked only for being a non-empty one: raw, a
 * newline in it forges a second marker on its own console line, whitespace splits one
 * pair into several, and length is unbounded. The MESSAGE takes this; `fields` keeps the
 * value as it arrived. */
const render = (value: string | number | boolean): string =>
  String(value)
    .replace(/[^\x21-\x7E]/g, "_")
    .slice(0, MAX_FIELD_CHARS);

export function logSearchResults(
  api: PluginAPI,
  severity: "info" | "error",
  event: SearchResultsEvent,
  fields: Record<string, string | number | boolean>,
): void {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${render(value)}`);
  api.logger[severity](`sil_search_results_${event} ${pairs.join(" ")}`, fields);
}
