/**
 * `sil.search_results` — the plugin-owned gateway method a paired client calls
 * to pull a `sil_search` page by the `callId` it already saw on the tool
 * identity frames.
 *
 * NOT a tool, which is why it lives outside `src/tools/`: it never reaches the
 * model, starts no run, and has no agent-facing surface. It is also not
 * manifest-declarable — the host's `contracts` vocabulary is a closed set with
 * no gateway-method key, so REGISTRATION IS THE DECLARATION.
 *
 * Two layers of authorization, each owned where it belongs. The HOST enforces
 * role + `operator.read` before this handler runs (from the `{scope}` opt), so
 * the plugin implements no scope logic and offers no bypass. The PLUGIN
 * enforces the one thing the host cannot know: that the page belongs to the sil
 * ACCOUNT that produced it, not to the machine or the socket. That is the only
 * gate that matters here — the key is the host's `callId`, visible to anyone who
 * can see the frames, so knowing one is never evidence of entitlement.
 *
 * Every outcome rides `respond(true, <structured body>)`; `ok:false` is used for
 * nothing. A client reads a method-level ERROR as a transport fault worth
 * retrying, and an unknown, expired, or foreign reference is not retryable —
 * retrying it forever would leave the shopper's item spinning. So the failure is
 * a successful response carrying a structured non-`ok` body, exactly as every
 * sil tool already carries `status:"not_registered"` inside a successful result.
 *
 * The four failure causes are ONE body on the wire. A caller must not be able to
 * tell "never existed" from "expired" from "not yours" — the distinction is a
 * log marker, and nothing on the wire has a field, shape, or timing tell.
 */

import type { PluginAPI, RespondFn } from "openclaw/plugin-sdk";

import { hasTokens, readConfig } from "../lib/credentials.js";
import { getSearchResult, searchResultMiss } from "../lib/search-results-store.js";

export const SEARCH_RESULTS_METHOD = "sil.search_results";

/** The ONE failure body: unknown ≡ expired ≡ wrong-principal ≡ no live session.
 * A client must be able to tell this apart from a genuine empty match (which is
 * `{status:"ok", products:[]}`), or it renders a silent empty grid for what is
 * actually a delivery failure. */
const NOT_FOUND = {
  status: "not_found",
  error: "result_unavailable",
  message:
    "No search results are available for this call. They may never have been"
    + " stored, or the retention window has elapsed — run the search again.",
} as const;

const INVALID_REQUEST = {
  status: "invalid_request",
  error: "invalid_call_id",
  message: "sil.search_results requires a non-empty string `callId`.",
} as const;

export function registerSearchResultsMethod(api: PluginAPI): void {
  api.registerGatewayMethod(
    SEARCH_RESULTS_METHOD,
    ({ params, respond }) => {
      // A throw out of here is an opaque gateway error the client reads as a
      // retryable transport fault, so it would leave a shopper's item spinning
      // forever on a permanent condition. Fail closed to the uniform body.
      try {
        resolve(api, params, respond);
      } catch (err) {
        api.logger.error("sil_search_results_failed", {
          cause: err instanceof Error ? err.message : String(err),
        });
        respond(true, NOT_FOUND);
      }
    },
    { scope: "operator.read" },
  );
}

function resolve(
  api: PluginAPI,
  params: Record<string, unknown>,
  respond: RespondFn,
): void {
  const callId = params["callId"];
  if (typeof callId !== "string" || callId.length === 0) {
    api.logger.info("sil_search_results_invalid", { reason: "invalid_call_id" });
    respond(true, INVALID_REQUEST);
    return;
  }

  // The principal is the sil account holding a LIVE session. `clearTokens()`
  // unlinks tokens.json and leaves config.json intact, so the token check is
  // what makes a logged-out plugin resolve nothing — a page belongs to the
  // identity that produced it, never to the machine.
  const principal = hasTokens() ? readConfig()?.user?.id : undefined;
  if (principal === undefined) {
    api.logger.info("sil_search_results_miss", { found: false, reason: "no_principal" });
    respond(true, NOT_FOUND);
    return;
  }

  const page = getSearchResult(callId, principal);
  if (page === null) {
    api.logger.info("sil_search_results_miss", {
      found: false,
      reason: searchResultMiss(callId, principal),
    });
    respond(true, NOT_FOUND);
    return;
  }

  api.logger.info("sil_search_results_hit", { found: true, count: page.products.length });
  // Handed over BY REFERENCE, aliasing the array the agent envelope already
  // serialized. Deliberate: both paths JSON-serialize immediately and neither
  // mutates, so a defensive clone would copy ~50 KB per resolve for nothing.
  respond(true, page);
}
