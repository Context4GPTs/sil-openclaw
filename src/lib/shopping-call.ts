/**
 * ONE authenticated call to sil-api, and the §4 envelopes every caller answers with.
 * Shared because the 401 choreography must not drift between the tools that make it — a
 * second copy is what `cross-tool-401-parity` forbids. The caller owns only the `ok` body.
 */

import type { PluginAPI, ToolResult } from "openclaw/plugin-sdk";

import { getApiUrl } from "./config.js";
import { clearTokens, readTokens } from "./credentials.js";
import {
  callShopping,
  refreshAndRetryOnce,
  type ShoppingOutcome,
  type ShoppingRoute,
} from "./sil-client.js";
import { jsonResult } from "./tool-result.js";

/** The guide read — the one route two tools take (`shopping_domain_get`, and
 * `shopping_brief_compile` under its own name). Two spellings of one path is a route
 * nobody owns. */
export const DOMAIN_GET_ROUTE = { method: "GET", path: "/catalog/domains/:path" } as const;

/**
 * What the agent runs next, PER STATUS — the 404 a path read answers, the 409 and the
 * too-shallow-path 400 the mint answers. Per status because one route's two refusals
 * have different next calls: the mint's 409 means search that path, its 400 means read
 * the registry again. A status absent here carries no recovery.
 */
export type RefusalRecovery = Partial<
  Record<"invalid_request" | "not_found" | "already_exists", string>
>;

/** A route, under the NAME of the tool the agent called: every log marker and every
 * recovery hint names that tool, never the route behind it. */
export interface ShoppingCall extends ShoppingRoute {
  readonly name: string;
  readonly recovery?: RefusalRecovery;
}

/** The API's own 200 body, or the refusal to hand the agent as it stands. */
export type CallResult =
  | { kind: "ok"; body: Record<string, unknown> }
  | { kind: "refused"; result: ToolResult };

/**
 * Call one route with the stored credentials, refreshing and retrying at most once.
 * Every non-`ok` outcome comes back as its finished envelope, so no caller re-derives
 * the taxonomy.
 */
export async function callRoute(
  api: PluginAPI,
  call: ShoppingCall,
  args: Record<string, unknown>,
): Promise<CallResult> {
  const stored = readTokens();
  if (stored === null) return { kind: "refused", result: notRegistered(call.name) };

  const first = await callShopping(getApiUrl(), stored.access_token, call, args);
  const recovered = await refreshAndRetryOnce(
    first,
    (o): boolean => o.kind === "unauthorized",
    (accessToken) => callShopping(getApiUrl(), accessToken, call, args),
  );
  switch (recovered.kind) {
    case "result":
      if (recovered.refreshed) api.logger.info(`${call.name}_refreshed`, {});
      return mapOutcome(api, call, recovered.outcome);
    case "must_reregister":
      if (recovered.reason === "invalid_grant") clearTokens();
      api.logger.info(`${call.name}_must_reregister`, { cause: recovered.reason });
      return { kind: "refused", result: mustReregister(call.name) };
    case "second_unauthorized":
      clearTokens();
      api.logger.info(`${call.name}_must_reregister`, { cause: "retry_unauthorized" });
      return { kind: "refused", result: mustReregister(call.name) };
    case "retryable":
      api.logger.info(`${call.name}_refresh_retryable`, {});
      return { kind: "refused", result: transient(call.name) };
  }
}

function mapOutcome(api: PluginAPI, call: ShoppingCall, outcome: ShoppingOutcome): CallResult {
  switch (outcome.kind) {
    case "ok":
      return { kind: "ok", body: outcome.body };
    case "invalid_request":
    case "not_found":
    case "already_exists":
      api.logger.info(`${call.name}_${outcome.kind}`, {});
      return {
        kind: "refused",
        result: refusal(outcome.kind, outcome.message, call.recovery?.[outcome.kind]),
      };
    case "forbidden":
      return { kind: "refused", result: forbiddenResult(api, call.name, outcome.reason) };
    case "retryable":
      api.logger.info(`${call.name}_retryable`, outcome.source ? { source: outcome.source } : {});
      return { kind: "refused", result: transient(call.name, outcome.source, outcome.detail) };
    case "unauthorized":
      // Structurally unreachable past the 401 choreography, kept exhaustive so a
      // refactor cannot silently drop a variant.
      return { kind: "refused", result: mustReregister(call.name) };
  }
}

/** Not registered: a distinct, actionable outcome naming the recovery tool, with
 * no results field the agent could mistake for an empty answer. */
function notRegistered(tool: string): ToolResult {
  return jsonResult({
    status: "not_registered",
    message:
      `Not registered on sil. Run sil_register to authenticate, then call ${tool} again.`,
    recovery: "sil_register",
  });
}

/**
 * A refusal the route made before it spent, surfaced VERBATIM: the message names the
 * offender in sil's own words, so it IS the agent's recourse and is never rewritten or
 * matched on here. Terminal but NOT fatal and NOT retryable — where a recovery exists it
 * is the next tool to call, never the same call again.
 */
function refusal(
  status: "invalid_request" | "not_found" | "already_exists",
  message: string,
  recovery?: string,
): ToolResult {
  return jsonResult({
    status,
    message,
    ...(recovery !== undefined ? { recovery } : {}),
  });
}

/** Terminal: the session is dead — reached only after the shared refresh-and-retry
 * choreography has exhausted its one refresh + one retry. */
function mustReregister(tool: string): ToolResult {
  return jsonResult({
    status: "must_reregister",
    message:
      `Your sil session has expired. Run sil_register to sign in again, then call ${tool} again.`,
    recovery: "sil_register",
  });
}

/**
 * A 403 — the token is valid but the user is not provisioned (or a principal
 * mismatch). Refreshing cannot help; this is not a 401.
 *
 * The token CLEAR is gated on exactly `user_not_provisioned`: that token maps to no
 * account on this backend and is structurally dead, so clearing it lets the next
 * `sil_register` re-onboard instead of short-circuiting to already-registered. A
 * `principal_mismatch` can be transient and MUST NOT clear — the exact-equality gate is
 * the correctness boundary here, and a truthy or prefix check would wipe a good session.
 */
function forbiddenResult(api: PluginAPI, tool: string, reason: string): ToolResult {
  api.logger.warn(`${tool}_forbidden`, { reason });
  if (reason === "user_not_provisioned") clearTokens();
  const message =
    reason === "user_not_provisioned"
      ? "Your sil account is not fully set up. Complete onboarding (run"
        + " sil_register) and try again."
      : "sil rejected this request (" + reason + "). Run sil_register to"
        + " re-establish your session, then try again.";
  return jsonResult({ status: "forbidden", reason, message, recovery: "sil_register" });
}

/**
 * Transient: retry, NOT a re-register (a false terminal on a transient sends the
 * agent down a recovery that cannot fix it). The two causally distinct failures
 * share `status: "retryable"` and split on ATTRIBUTION — `source` absent means
 * sil or the network is down and the copy names nothing it cannot identify;
 * `source` present means one named source is degraded and sil itself is fine, so
 * the copy must never say "sil is unavailable". `detail` (the upstream cause) is
 * relayed as its own field rather than folded into our sentence.
 */
export function transient(tool: string, source?: string, detail?: string): ToolResult {
  if (source === undefined) {
    return jsonResult({
      status: "retryable",
      message: `sil is temporarily unavailable. Please try ${tool} again.`,
    });
  }
  return jsonResult({
    status: "retryable",
    message:
      `The catalog source "${source}" is temporarily unavailable.`
      + ` sil itself is fine — retry ${tool} shortly.`,
    ...(detail !== undefined ? { detail } : {}),
  });
}
