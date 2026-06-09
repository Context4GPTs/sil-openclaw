/**
 * Catalog tools for the sil plugin.
 *
 * `sil_search` is a thin, typed product-discovery tool. An AI agent sends a
 * SIMPLIFIED structured query — free-text `query` plus optional filters
 * (`category`, `price_min`/`price_max`) and pagination (`cursor`/`limit`) — and
 * gets back a flat, ranked list of purchasable options: one featured variant per
 * product projected to `{ id, title, price, availability, checkout_url, source }`,
 * plus an opaque pagination `cursor`. The agent builds no UCP envelope and fills
 * no defaults; sil-api owns enrichment, ranking, and the envelope. The tool's job
 * is: validate the one invariant it owns (≥1 input), attach the stored Bearer
 * token, POST the bare `/catalog/search` on sil-api, and normalize the response.
 *
 * `execute()` flow (ALL I/O here; `register()` opens nothing — search is a
 * synchronous request/response, NOT a poll):
 *   1. Not registered (no stored tokens) → terminal `not_registered` + a
 *      `recovery: sil_register` hint, ZERO network calls (nothing to authenticate
 *      with). Mirrors `sil_whoami`'s not-registered path.
 *   2. Client-side input guard: a request with neither a non-empty `query` nor
 *      any filter is rejected with a structured validation error and makes NO
 *      network call (sil-api's `empty_search_input` 400 is the authoritative
 *      backstop). A filter-only request (e.g. `category` alone) is a valid browse.
 *   3. searchCatalog(getSilApiUrl(), token, params) → map the `SearchOutcome`:
 *        ok            → the ranked products + cursor;
 *        invalid_request (400) → surface sil-api's `{ error, message }`;
 *        unauthorized  (401)   → terminal re-register (single round-trip — no
 *                                transparent refresh in this card; that is the
 *                                additive follow-on `sil_whoami` already does);
 *        retryable (5xx/net)   → transient "try again", NO re-register hint.
 *
 * The three distinct sil-api outcomes (empty match 200 / invalid 400 / source
 * failure 500) surface as three DISTINGUISHABLE agent envelopes — an empty match
 * is a SUCCESS (`status: "ok"`, `products: []`), never an error. Distinct recovery
 * hints per error class, mirroring `identity.ts`: re-register sends the agent to
 * `sil_register`; a transient/invalid must NOT (re-registering can't fix a 5xx or
 * a bad query and would derail the user).
 *
 * Privacy: the access token and Bearer header never reach a log line or the
 * result; logs carry only non-credential status markers (search params are not
 * credentials, but are not logged either — nothing here needs them).
 *
 * `register()` stays synchronous and side-effect-free beyond registering tools —
 * no fetch, no timer, no unawaited promise. All I/O is inside `execute()`.
 */

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import { getSilApiUrl } from "../lib/config.js";
import { readTokens } from "../lib/credentials.js";
import { searchCatalog, type SearchParams, type SearchResult } from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";

export function registerCatalogTools(api: PluginAPI): void {
  registerSearch(api);
  // The sibling card `sil-product-get-plugin-tool` (SC2) adds registerProductGet(api)
  // here as a second call in this same group — no structural change, reusing the
  // shared sil-client catalog layer and this error-envelope taxonomy.
}

function registerSearch(api: PluginAPI): void {
  api.registerTool({
    name: "sil_search",
    label: "Search the sil catalog",
    description:
      "Search sil's catalog for purchasable products. Pass a free-text `query`"
      + " and/or filters (`category`, `price_min`/`price_max` in the currency's"
      + " minor units, e.g. cents). Returns a ranked list (best match first —"
      + " present results in order, do not re-rank), each item a purchasable"
      + " variant with id, title, price, availability, checkout_url, and source."
      + " Use the returned `cursor` to fetch the next page (its absence means no"
      + " more results — never infer end-of-results from the page size). An empty"
      + " result list means nothing matched (a normal outcome, not an error)."
      + " Requires registration (run sil_register first).",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description:
            "Free-text search query. Either this or at least one filter is required.",
        }),
      ),
      category: Type.Optional(
        Type.String({
          description: "Restrict results to a single product category.",
        }),
      ),
      price_min: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: "Minimum price, in the currency's ISO 4217 minor unit (e.g. cents).",
        }),
      ),
      price_max: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: "Maximum price, in the currency's ISO 4217 minor unit (e.g. cents).",
        }),
      ),
      cursor: Type.Optional(
        Type.String({
          description: "Opaque pagination cursor from a prior search's result.",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          description:
            "Requested maximum number of results. The server may return fewer.",
        }),
      ),
    }),
    async execute(_callId, params) {
      // 1 — not registered: terminal, zero network calls.
      const stored = readTokens();
      if (stored === null) {
        return notRegistered();
      }

      // Narrow the untrusted params (the SDK types `params` as
      // Record<string, unknown>; the host validates against the schema, but the
      // read site still guards — mirrors the defensive narrowing in sil-client).
      const search = readSearchParams(params);

      // 2 — client-side input guard: reject the obviously-empty request before
      // any network call. A filter-only request is a valid browse, not rejected.
      if (!hasUsableInput(search)) {
        return invalidInput();
      }

      // 3 — search and map the outcome to the agent-facing envelope.
      const outcome = await searchCatalog(getSilApiUrl(), stored.access_token, search);
      switch (outcome.kind) {
        case "ok":
          return searchResult(outcome.result);
        case "invalid_request":
          api.logger.info("sil_search_invalid_request", { error: outcome.error });
          return invalidRequest(outcome.error, outcome.message);
        case "unauthorized":
          api.logger.info("sil_search_unauthorized", {});
          return mustReregister();
        case "retryable":
          api.logger.info("sil_search_retryable", {});
          return transient();
      }
    },
  });
}

/** Narrow the untrusted `params` to the simplified {@link SearchParams}. A field
 * of the wrong type is dropped (treated as absent), not coerced — the host has
 * already validated against the schema, but a drifted on-disk call must not slip
 * a non-string into the query mapping. No `any`, no unchecked `as`. */
function readSearchParams(params: Record<string, unknown>): SearchParams {
  const result: SearchParams = {};
  const query = params["query"];
  if (typeof query === "string") result.query = query;
  const category = params["category"];
  if (typeof category === "string") result.category = category;
  const priceMin = params["price_min"];
  if (typeof priceMin === "number") result.price_min = priceMin;
  const priceMax = params["price_max"];
  if (typeof priceMax === "number") result.price_max = priceMax;
  const cursor = params["cursor"];
  if (typeof cursor === "string") result.cursor = cursor;
  const limit = params["limit"];
  if (typeof limit === "number") result.limit = limit;
  return result;
}

/** The one client-side invariant the tool owns: at least one recognized input.
 * A non-whitespace `query` OR any filter (`category` / `price_min` / `price_max`)
 * suffices. A bare `{}` or a whitespace-only `query` with no filter is rejected;
 * pagination params alone (`cursor`/`limit`) are NOT inputs — they refine an
 * existing search, they do not constitute one. */
function hasUsableInput(params: SearchParams): boolean {
  const hasQuery = typeof params.query === "string" && params.query.trim().length > 0;
  const hasFilter =
    typeof params.category === "string"
    || typeof params.price_min === "number"
    || typeof params.price_max === "number";
  return hasQuery || hasFilter;
}

/** Success: the ranked products + optional cursor — no token, no Bearer header.
 * An empty `products` list is a valid, successful empty match. */
function searchResult(result: SearchResult) {
  return jsonResult({ status: "ok", ...result });
}

/** Not registered: a distinct, actionable outcome naming the recovery tool. No
 * products field so the agent can't mistake it for an empty match. */
function notRegistered() {
  return jsonResult({
    status: "not_registered",
    message:
      "Not registered on sil. Run sil_register to authenticate, then call"
      + " sil_search again.",
    recovery: "sil_register",
  });
}

/** Client-side validation: the request named no usable input. Distinct from a
 * sil-api 400 (which carries the server's structured error) — this never hit the
 * network. No `recovery: sil_register` (auth is fine; the query is the problem). */
function invalidInput() {
  return jsonResult({
    status: "invalid_request",
    error: "empty_search_input",
    message:
      "Provide a search query or at least one filter (category, price_min, or"
      + " price_max).",
  });
}

/** sil-api rejected the request (a structured 400, e.g. empty_search_input).
 * Surface the server's `{ error, message }` so the agent fixes its query — NOT a
 * re-register (auth is fine) and NOT a transient retry (retrying the same bad
 * request won't help). Distinct from both the empty-match success and the 5xx. */
function invalidRequest(error: string, message: string) {
  return jsonResult({ status: "invalid_request", error, message });
}

/** Terminal: the session is dead (401). Re-register. Single round-trip — this
 * card does no transparent refresh (that is `sil_whoami`'s, an additive follow-on). */
function mustReregister() {
  return jsonResult({
    status: "must_reregister",
    message:
      "Your sil session has expired. Run sil_register to sign in again, then"
      + " call sil_search again.",
    recovery: "sil_register",
  });
}

/** Transient: a network/5xx blip — try again, NOT a re-register (a false terminal
 * on a transient would send the agent down a recovery path that can't fix it). */
function transient() {
  return jsonResult({
    status: "retryable",
    message: "sil is temporarily unavailable. Please try sil_search again.",
  });
}
