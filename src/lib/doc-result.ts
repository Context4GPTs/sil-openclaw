/**
 * One store failure, as the §4 envelope every reader of the shopper's documents answers
 * with. Shared by the four document verbs and `shopping_brief_compile`, so a corrupt
 * Brief reads the same whichever tool found it.
 */

import type { PluginAPI, ToolResult } from "openclaw/plugin-sdk";

import type { StoreFailure } from "./doc-store.js";
import { jsonResult } from "./tool-result.js";

export function docFailureResult(
  api: PluginAPI,
  tool: string,
  result: StoreFailure,
): ToolResult {
  if (result.kind === "invalid_request") {
    api.logger.warn(tool + "_invalid_request", { field: result.field });
    return jsonResult({ status: "invalid_request", field: result.field, message: result.message });
  }
  if (result.kind === "not_found") {
    api.logger.info(tool + "_not_found", {});
    return jsonResult({ status: "not_found", message: result.message });
  }
  if (result.kind === "unreadable") {
    // NOT KNOWN TO BE ABSENT — presence unsettled, or a body that will not parse. Steer
    // the agent to inspect/repair, NEVER write over it (silent loss of a recoverable
    // document). Distinct from not_found.
    api.logger.warn(tool + "_unreadable", { detail: result.detail });
    return jsonResult({
      status: "unreadable",
      message: result.message,
      recovery: "inspect_document",
    });
  }
  // `detail` carries the path Node named and stays in the log; the agent gets the errno
  // CODE, which is the part it can act on and the part that is not a store internal.
  api.logger.error(tool + "_persistence_failed", { detail: result.detail });
  return jsonResult({
    status: "persistence_failed",
    error: result.error,
    message: result.message,
    recovery: result.recovery,
  });
}
