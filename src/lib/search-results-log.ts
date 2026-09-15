/**
 * The `sil_search_results_*` operator markers, with their fields repeated INLINE in the
 * message. The host hands the structured object to the log FILE only — the console line
 * a container's `docker logs` shows is the message alone (`createSubsystemLogger`'s
 * `emitLog`, vendor/openclaw). Fields-only, a delivery miss reads `[plugins]
 * sil_search_results_miss` with no callId to join on and no cause.
 */

import type { PluginAPI } from "openclaw/plugin-sdk";

/** The four outcomes of the delivery buffer, plus the handler's own fault. `skipped` is
 * the BUFFER side: a search whose page was never stored, and why. */
export type SearchResultsEvent = "hit" | "miss" | "skipped" | "invalid" | "failed";

// `severity`, never `level` — that word followed by a colon is a retired registry
// needle, and one live occurrence switches it off across the whole docs sweep.
export function logSearchResults(
  api: PluginAPI,
  severity: "info" | "error",
  event: SearchResultsEvent,
  fields: Record<string, string | number | boolean>,
): void {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`);
  api.logger[severity](`sil_search_results_${event} ${pairs.join(" ")}`, fields);
}
