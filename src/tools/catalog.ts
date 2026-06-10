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
 *        unauthorized  (401)   → refresh-and-retry ONCE via the shared
 *                                `refreshAndRetryOnce` choreography (sil-web refresh,
 *                                re-read rotated pair, retry once). The agent never
 *                                sees a recovered 401; a second 401 or a dead refresh
 *                                is terminal re-register (tokens cleared); a refresh
 *                                5xx/network blip is transient "try again". 401
 *                                recovery is UNIFORM across sil_search /
 *                                sil_product_get / sil_whoami — never per-tool;
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
import { clearTokens, readTokens } from "../lib/credentials.js";
import {
  lookupCatalog,
  refreshAndRetryOnce,
  searchCatalog,
  type LookupOutcome,
  type SearchOutcome,
  type SearchParams,
} from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";

export function registerCatalogTools(api: PluginAPI): void {
  registerSearch(api);
  registerProductGet(api);
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
        return notRegistered("sil_search");
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

      // 3 — search; on a 401 refresh-and-retry ONCE via the shared choreography
      // (the SAME path sil_whoami / sil_product_get use — 401 recovery is uniform
      // across every sil-api-calling tool, never per-tool).
      const first = await searchCatalog(getSilApiUrl(), stored.access_token, search);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => searchCatalog(getSilApiUrl(), accessToken, search),
      );
      switch (recovered.kind) {
        case "result":
          return mapSearchOutcome(api, recovered.outcome);
        case "must_reregister":
          // A dead refresh token (invalid_grant) is cleared so the agent's
          // sil_register recovery is not blocked by stale presence; a TOCTOU
          // empty re-read (no_stored_tokens) has nothing to clear.
          if (recovered.reason === "invalid_grant") clearTokens();
          api.logger.info("sil_search_must_reregister", { cause: recovered.reason });
          return mustReregister("sil_search");
        case "second_unauthorized":
          // A freshly-rotated token STILL rejected is structurally dead — clear it.
          clearTokens();
          api.logger.info("sil_search_must_reregister", { cause: "retry_unauthorized" });
          return mustReregister("sil_search");
        case "retryable":
          api.logger.info("sil_search_refresh_retryable", {});
          return transient("sil_search");
      }
    },
  });
}

/** Map a search outcome that has ALREADY cleared the 401-recovery path (so it is
 * never `unauthorized` — that is the refresh trigger, handled by the caller via
 * {@link refreshAndRetryOnce}) to the agent-facing envelope. The `unauthorized`
 * arm is structurally unreachable but kept exhaustive so a future refactor can't
 * silently drop a variant — it falls to the same terminal re-register. */
function mapSearchOutcome(api: PluginAPI, outcome: SearchOutcome) {
  switch (outcome.kind) {
    case "ok":
      return searchResult(outcome);
    case "invalid_request":
      api.logger.info("sil_search_invalid_request", { error: outcome.error });
      return invalidRequest(outcome.error, outcome.message);
    case "retryable":
      api.logger.info("sil_search_retryable", {});
      return transient("sil_search");
    case "unauthorized":
      return mustReregister("sil_search");
  }
}

/**
 * `sil_product_get` — the lookup COMPANION to `sil_search`. The agent passes ids
 * it already holds (from a prior `sil_search`, a saved list, deep links, or cart
 * validation) and gets back the matching products in UCP shape, each with its
 * FRESH featured variant `{ id, title, price, availability, checkout_url, ... }`.
 * RICH where search is LEAN: lookup adds the description, the variant's options,
 * and — its defining feature — the per-variant `inputs` correlation, because the
 * response does NOT preserve request order and one id can resolve to a variant of
 * another id's product. The agent builds no envelope and fills no defaults; the
 * tool sends just `{ ids }`, sil-api owns enrichment + the `not_found` messaging.
 *
 * `execute()` flow (ALL I/O here; `register()` opens nothing — a synchronous
 * request/response, NOT a poll). MIRRORS `sil_search` and shares its taxonomy:
 *   1. Not registered (no stored tokens) → terminal `not_registered` + a
 *      `recovery: sil_register` hint, ZERO network calls. Mirrors `sil_whoami`.
 *   2. Client-side guard: an empty `ids` (after dropping non-strings) is rejected
 *      with a structured validation error and NO network call (sil-api's
 *      `minItems:1` schema 400 is the authoritative backstop).
 *   3. lookupCatalog(getSilApiUrl(), token, ids) → map the `LookupOutcome`:
 *        ok            → the resolved products + the `not_found` id list (a PARTIAL
 *                        or ALL-MISSED hit is `status:"ok"` — a SUCCESS, never an
 *                        error, with NO recovery hint: re-running won't conjure a
 *                        delisted product);
 *        invalid_request (400) → surface sil-api's `{ error, message }`;
 *        unauthorized  (401)   → refresh-and-retry ONCE via the shared
 *                                `refreshAndRetryOnce` choreography (parity with
 *                                `sil_search` and `sil_whoami` — 401 recovery is
 *                                uniform). Recovered 401 is invisible; second 401 /
 *                                dead refresh is terminal re-register (tokens
 *                                cleared); a refresh 5xx/network blip is transient;
 *        retryable (5xx/net)   → transient "try again", NO re-register hint.
 *
 * The unfound-ids outcome is the headline: a lookup that resolves SOME (or NONE)
 * of its ids is a success the agent relays ("3 of your 4 items are still
 * available; 1 is no longer listed"), distinguished from the two true-error
 * classes (not-registered/401 and source/transport failure) by DISTINCT recovery
 * hints. One wrong hint = one misdirected user.
 *
 * Privacy + freshness: the access token and Bearer header never reach a log line
 * or the result; the products are always live-fetched (never cached — freshness is
 * the reason this tool exists; a cached `checkout_url`/price is a broken purchase).
 */
function registerProductGet(api: PluginAPI): void {
  api.registerTool({
    name: "sil_product_get",
    label: "Look up sil products by id",
    description:
      "Look up sil products or variants by id — the companion to sil_search."
      + " Pass `ids` (one or more product/variant ids you already hold, e.g. from"
      + " a prior sil_search result) and get the matching products back with FRESH"
      + " detail: each product's description plus its featured purchasable variant"
      + " (id, title, price, availability, checkout_url, options). Re-fetch right"
      + " before the user buys — prices, availability, and checkout_url are"
      + " point-in-time, not guarantees. Each variant carries an `inputs` list"
      + " correlating it back to the id(s) you asked about (the response is NOT in"
      + " request order). Ids that no longer resolve come back in a `not_found`"
      + " list — that is a normal outcome, not an error (the other products are"
      + " still valid). Requires registration (run sil_register first).",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        minItems: 1,
        description:
          "Product or variant ids to resolve (at least one). Typically ids from a"
          + " prior sil_search result, a saved list, or a deep link.",
      }),
    }),
    async execute(_callId, params) {
      // 1 — not registered: terminal, zero network calls.
      const stored = readTokens();
      if (stored === null) {
        return notRegistered("sil_product_get");
      }

      // Narrow the untrusted params (the SDK types `params` as
      // Record<string, unknown>; the host validates against the schema, but the
      // read site still guards — non-string entries are dropped, not coerced).
      const ids = readIds(params);

      // 2 — client-side input guard: reject an empty `ids` before any network
      // call (sil-api's `minItems:1` schema 400 is the authoritative backstop).
      if (ids.length === 0) {
        return invalidIds();
      }

      // 3 — look up; on a 401 refresh-and-retry ONCE via the shared choreography
      // (the SAME path sil_whoami / sil_search use). A partial/all-missed hit is
      // `ok` + `not_found`.
      const first = await lookupCatalog(getSilApiUrl(), stored.access_token, ids);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => lookupCatalog(getSilApiUrl(), accessToken, ids),
      );
      switch (recovered.kind) {
        case "result":
          return mapLookupOutcome(api, recovered.outcome);
        case "must_reregister":
          if (recovered.reason === "invalid_grant") clearTokens();
          api.logger.info("sil_product_get_must_reregister", { cause: recovered.reason });
          return mustReregister("sil_product_get");
        case "second_unauthorized":
          clearTokens();
          api.logger.info("sil_product_get_must_reregister", { cause: "retry_unauthorized" });
          return mustReregister("sil_product_get");
        case "retryable":
          api.logger.info("sil_product_get_refresh_retryable", {});
          return transient("sil_product_get");
      }
    },
  });
}

/** Map a lookup outcome that has ALREADY cleared the 401-recovery path (never
 * `unauthorized` — the refresh trigger handled by {@link refreshAndRetryOnce}) to
 * the agent-facing envelope. The `unauthorized` arm is structurally unreachable
 * but kept exhaustive (falls to the same terminal re-register) so a future
 * refactor can't silently drop a variant. */
function mapLookupOutcome(api: PluginAPI, outcome: LookupOutcome) {
  switch (outcome.kind) {
    case "ok":
      return lookupResult(outcome);
    case "invalid_request":
      api.logger.info("sil_product_get_invalid_request", { error: outcome.error });
      return invalidRequest(outcome.error, outcome.message);
    case "retryable":
      api.logger.info("sil_product_get_retryable", {});
      return transient("sil_product_get");
    case "unauthorized":
      return mustReregister("sil_product_get");
  }
}

/** Narrow the untrusted `params` to a string[] of ids. A non-string entry is
 * DROPPED (treated as absent), not coerced — the host has already validated
 * against the schema, but a drifted on-disk call must not slip a non-string into
 * the id list. No `any`, no unchecked `as`. */
function readIds(params: Record<string, unknown>): string[] {
  const raw = params["ids"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}

/** Success: the resolved products + optional `not_found` id list — no token, no
 * Bearer header. An empty `products` list WITH a `not_found` list is a valid,
 * successful all-missed lookup. The `ok` outcome already carries `products` (+
 * optional `not_found`); spread its payload (minus the `kind` discriminant) onto
 * the agent-facing `{ status: "ok", ... }` envelope. A `not_found` list is
 * partial-success DATA, NOT an error and NOT a recovery hint. */
function lookupResult(outcome: Extract<LookupOutcome, { kind: "ok" }>) {
  const { kind: _kind, ...payload } = outcome;
  return jsonResult({ status: "ok", ...payload });
}

/** Client-side validation: the request named no usable id. Distinct from a sil-api
 * 400 (which carries the server's structured error) — this never hit the network.
 * No `recovery: sil_register` (auth is fine; the input is the problem). */
function invalidIds() {
  return jsonResult({
    status: "invalid_request",
    error: "empty_ids",
    message: "Provide at least one product or variant id to look up.",
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
 * An empty `products` list is a valid, successful empty match. The `ok` outcome
 * already carries `products` (+ optional `cursor`); spread its payload (minus the
 * `kind` discriminant) onto the agent-facing `{ status: "ok", ... }` envelope. */
function searchResult(outcome: Extract<SearchOutcome, { kind: "ok" }>) {
  const { kind: _kind, ...payload } = outcome;
  return jsonResult({ status: "ok", ...payload });
}

/** Not registered: a distinct, actionable outcome naming the recovery tool. No
 * products field so the agent can't mistake it for an empty match. The `tool`
 * name keeps the message actionable per-tool (re-run THIS tool) while the
 * status/recovery taxonomy stays shared across the catalog tools. */
function notRegistered(tool: string) {
  return jsonResult({
    status: "not_registered",
    message:
      `Not registered on sil. Run sil_register to authenticate, then call ${tool} again.`,
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

/** Terminal: the session is dead — reached only after the shared refresh-and-retry
 * choreography ({@link refreshAndRetryOnce}) has exhausted its one refresh + one
 * retry (a second 401, or a dead `invalid_grant` refresh token). Re-register. The
 * `tool` name keeps the message actionable while the taxonomy stays shared. */
function mustReregister(tool: string) {
  return jsonResult({
    status: "must_reregister",
    message:
      `Your sil session has expired. Run sil_register to sign in again, then call ${tool} again.`,
    recovery: "sil_register",
  });
}

/** Transient: a network/5xx blip — try again, NOT a re-register (a false terminal
 * on a transient would send the agent down a recovery path that can't fix it).
 * The `tool` name keeps the retry guidance actionable; the taxonomy is shared. */
function transient(tool: string) {
  return jsonResult({
    status: "retryable",
    message: `sil is temporarily unavailable. Please try ${tool} again.`,
  });
}
