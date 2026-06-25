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
 *   3. searchCatalog(getApiUrl(), token, params) → map the `SearchOutcome`:
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
 * Privacy: the session token and Bearer header never reach a log line or the
 * result; logs carry only non-credential status markers (search params are not
 * credentials, but are not logged either — nothing here needs them).
 *
 * `register()` stays synchronous and side-effect-free beyond registering tools —
 * no fetch, no timer, no unawaited promise. All I/O is inside `execute()`.
 */

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import { getApiUrl } from "../lib/config.js";
import { clearTokens, readTokens } from "../lib/credentials.js";
import {
  lookupCatalog,
  refreshAndRetryOnce,
  searchCatalog,
  type LookupOutcome,
  type SearchOutcome,
  type SearchParams,
  type ShipTo,
} from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";

/**
 * The TIGHTENED ship-to format contract (founder re-spec 2026-06-11), pinned as a
 * `pattern` BOTH the local schema and sil-api's `@sil/schemas` `ShipTo` enforce
 * IDENTICALLY (byte-for-byte) — so the plugin rejects a malformed value client-side
 * instead of forwarding free text and eating an opaque, fail-late sil-api 400. These
 * same patterns are the schema `pattern` (so the host validates) AND the read-site
 * format gate (so a drifted on-disk call is rejected), defined once here to keep the
 * two in lockstep. The sil-services sibling
 * (`attach-buyer-ship-to-context-server-side-in-sil-ap`) MUST mirror these exactly;
 * the sil-stage eval verifies it end-to-end.
 *   - country (ships_to): ISO 3166-1 alpha-2, a 2-letter code.
 *   - region: ISO 3166-2 subdivision code (CA/NY/BY/97), bounded — NOT a place name.
 *   - postal_code: a single self-contained pattern (a length-cap lookahead 2–12
 *     chars, separators counted, + a structural body of alnum runs joined by single
 *     internal space/hyphen, no leading/trailing/doubled separator) — accepts real
 *     national formats (94107 / EC1A 1BB / K1A 0B1), rejects prose/injection/overlong.
 */
const COUNTRY_PATTERN = "^[A-Za-z]{2}$";
const REGION_PATTERN = "^[A-Za-z0-9]{1,3}$";
const POSTAL_PATTERN = "^(?=[A-Za-z0-9 -]{2,12}$)[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$";

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
      + " variant with id, title, price, availability, checkout_url, and source,"
      + " plus (where the source provides them) the evaluate-before-buy fields:"
      + " product and variant `url`, a short `description`, `media`, the product"
      + " `options` (the menu of choices), the `seller` (with policy/info links),"
      + " and arbitrary `metadata`. THREE DISTINCT ACTIONS the agent must not"
      + " conflate: (1) VIEW — a product's or variant's `url` opens the PAGE to"
      + " view / learn more; hand it to the user to SEE the item, it is NOT a"
      + " purchase. (2) DIG IN — `seller.links` are the seller's policy / info"
      + " links (refund policy, shipping policy, terms); follow one to answer"
      + " \"what's their return policy?\" without a web search. (3) BUY —"
      + " `checkout_url` is the variant permalink that commits the purchase; use it"
      + " ONLY to buy. A variant's `url` and its `checkout_url` are DIFFERENT"
      + " targets: `url` is the page (view / learn more) whereas `checkout_url`"
      + " buys — never hand back `checkout_url` for a \"show me / learn more\""
      + " intent, and never stall on `url` when the user said \"buy\"."
      + " Use the returned `cursor` to fetch the next page (its absence means no"
      + " more results — never infer end-of-results from the page size). An empty"
      + " result list means nothing matched (a normal outcome, not an error)."
      + " For the location filters, ALWAYS send standard ISO CODES, NOT free text or"
      + " natural-language place names — send the 2-letter country code \"US\", never"
      + " the name \"United States\"; send the subdivision code \"CA\", never the place"
      + " name \"California\". A free-text name is rejected; the code is not."
      + " Delivery destination: LEAVE `ship_to` EMPTY for \"ship to me\" — when it is"
      + " absent, sil-api resolves the user's REGISTERED DEFAULT ADDRESS server-side"
      + " and localizes results to it. Do NOT call sil_whoami (or any identity read)"
      + " to fetch the user's address and put it in `ship_to` — that round-trip is"
      + " wasted work and yields the same result as omitting it. Set `ship_to` ONLY"
      + " to OVERRIDE the default — to ship to a DIFFERENT destination than the"
      + " user's registered address (e.g. \"ship it to my office in Berlin\"). Its"
      + " fields: `country` = the 2-letter ISO 3166-1 alpha-2 code (US, GB, DE — a"
      + " code, NOT a country name); `region` (optional) = the ISO 3166-2 subdivision"
      + " code (CA, NY, BY — a code, NOT a place name); `postal_code` (optional) ="
      + " the destination postal/ZIP code. The other optional filters need no prior"
      + " tool call: `condition` (array; the values are exactly \"new\" or"
      + " \"secondhand\", lowercase) filters by product condition; `available`"
      + " (boolean) controls availability — the server returns only sale-ready items"
      + " by default, so set `available: false` to INCLUDE out-of-stock/unavailable"
      + " items. `local_merchants` (boolean) is a BEST-EFFORT BIAS toward shops based"
      + " in the user's OWN country (home-country / domestic / local sellers) — set it"
      + " ONLY when the shopper asks for local/domestic shops; it nudges local shops up"
      + " the ranking but does NOT restrict results to them, so never tell the user the"
      + " results are all local. To surface MORE local shops you MAY also issue the"
      + " `query` in that country's language (a Greek-language query surfaces Greek"
      + " shops) — optional, and never an override of a language the user deliberately"
      + " chose; pass NO country — sil resolves it server-side. Requires registration (run"
      + " sil_register first).",
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
      ship_to: Type.Optional(
        Type.Object(
          {
            country: Type.String({
              pattern: COUNTRY_PATTERN,
              description:
                "Destination country as a 2-letter ISO 3166-1 alpha-2 CODE (US, GB,"
                + " DE) — a code, NOT a country name (\"United States\" is rejected).",
            }),
            region: Type.Optional(
              Type.String({
                pattern: REGION_PATTERN,
                description:
                  "Destination region as an ISO 3166-2 subdivision CODE (CA, NY, BY)"
                  + " — a code, NOT a place name (\"California\" is rejected). Optional.",
              }),
            ),
            postal_code: Type.Optional(
              Type.String({
                pattern: POSTAL_PATTERN,
                description:
                  "Destination postal/ZIP code (e.g. 94107, EC1A 1BB, K1A 0B1)."
                  + " Optional refinement.",
              }),
            ),
          },
          {
            description:
              "Deliver-to destination for serviceability + localization. LEAVE EMPTY"
              + " for \"ship to me\": when absent/omitted, sil-api uses the user's"
              + " REGISTERED DEFAULT ADDRESS (resolved server-side) — do NOT call"
              + " sil_whoami to fetch and resubmit it. Set this ONLY to OVERRIDE the"
              + " default with a DIFFERENT destination than the registered address."
              + " Send ISO CODES, never free-text place names.",
          },
        ),
      ),
      local_merchants: Type.Optional(
        Type.Boolean({
          description:
            "Bias results toward shops based in the USER'S OWN country (home-country"
            + " / domestic / local sellers) — set true ONLY when the shopper asks for"
            + " local or domestic shops (e.g. \"buy from a Greek shop\", \"support"
            + " local businesses\"). This is a BEST-EFFORT BIAS, NOT a filter: it"
            + " nudges local shops up the ranking but does NOT restrict results to them"
            + " and does NOT guarantee every result is local — some local shops won't"
            + " be detected and some non-local shops may still appear, so never tell"
            + " the user the results are all local sellers. To surface MORE local"
            + " shops you MAY also issue the `query` in that country's language (a"
            + " Greek-language query surfaces Greek shops; an English query will not)"
            + " — optional, never overriding a language the user deliberately chose. You pass NO"
            + " country — sil resolves the user's country server-side from their"
            + " registered address, so do NOT call sil_whoami or pass a country. Omit"
            + " (or false) for the normal unbiased ranking.",
        }),
      ),
      condition: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Filter by product condition. The values are exactly \"new\" or"
            + " \"secondhand\" (lowercase; multiple are OR'd). Omit for no condition"
            + " filter.",
        }),
      ),
      available: Type.Optional(
        Type.Boolean({
          description:
            "Availability filter. The server returns only sale-ready items by"
            + " default; set false to INCLUDE unavailable/out-of-stock items. Omit"
            + " to keep the default (available only).",
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
      // A present-but-malformed location filter (bad FORMAT, not wrong type) is
      // rejected client-side BEFORE the input guard or any network call — a clear
      // `invalid_filter` beats an opaque, fail-late sil-api 400 (re-spec).
      const read = readSearchParams(params);
      if (read.kind === "invalid") {
        api.logger.info("sil_search_invalid_filter", { field: read.field });
        return invalidFilter(read.field);
      }
      const search = read.params;

      // 2 — client-side input guard: reject the obviously-empty request before
      // any network call. A filter-only request is a valid browse, not rejected.
      // (The new location filters are REFINEMENTS, not inputs — `hasUsableInput` is
      // unchanged, so a request of only-new-args is rejected as empty input.)
      if (!hasUsableInput(search)) {
        return invalidInput();
      }

      // 3 — search; on a 401 refresh-and-retry ONCE via the shared choreography
      // (the SAME path sil_whoami / sil_product_get use — 401 recovery is uniform
      // across every sil-api-calling tool, never per-tool).
      const first = await searchCatalog(getApiUrl(), stored.access_token, search);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => searchCatalog(getApiUrl(), accessToken, search),
      );
      switch (recovered.kind) {
        case "result":
          // On a silent recovery (`refreshed`: a 401 was healed by the refresh+retry)
          // emit the operator marker so a thrashing session is visible in logs —
          // logs-only, no token material, NOT a payload field (the agent never sees it).
          if (recovered.refreshed) api.logger.info("sil_search_refreshed", {});
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
    case "forbidden":
      // A 403 surfaces the SAME forbidden envelope `sil_whoami` emits — never the
      // false-transient `retryable`. On `user_not_provisioned` (and ONLY that exact
      // reason) the held token maps to no account on this backend and a refresh
      // cannot help — structurally dead, like the invalid_grant/second_unauthorized
      // clears below — so clear it HERE (the tool call site, never the pure
      // classifier) and the next sil_register re-onboards instead of short-circuiting
      // to already_registered. A `principal_mismatch` / unknown reason can be
      // transient and stays recoverable — it MUST NOT clear (the exact-equality gate
      // is the correctness boundary: a startsWith/truthy check would wrongly wipe a
      // good session).
      api.logger.warn("sil_search_forbidden", { reason: outcome.reason });
      if (outcome.reason === "user_not_provisioned") clearTokens();
      return forbidden(outcome.reason);
    case "invalid_request":
      api.logger.info("sil_search_invalid_request", { error: outcome.error });
      return invalidRequest(outcome.error, outcome.message);
    case "retryable":
      // A source-attributed 5xx names the failed source (outcome b); a sil/network
      // blip carries no source and stays the generic copy (outcome a). The log marker
      // records the source when present so a flaky source is visible to operators.
      api.logger.info("sil_search_retryable", outcome.source ? { source: outcome.source } : {});
      return transient("sil_search", outcome.source, outcome.detail);
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
 *   3. lookupCatalog(getApiUrl(), token, ids) → map the `LookupOutcome`:
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
 * Privacy + freshness: the session token and Bearer header never reach a log line
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
      + " (id, title, price, availability, checkout_url, options), and — where the"
      + " source provides them — the same evaluate-before-buy fields sil_search"
      + " surfaces: product and variant `url`, `media`, the product `options` menu,"
      + " the `seller` (with policy/info links), and `metadata`. The SAME three"
      + " distinct actions apply: (1) VIEW — a product's or variant's `url` opens"
      + " the PAGE to view / learn more (NOT a purchase); (2) DIG IN —"
      + " `seller.links` follow the seller's policy / info links (refund, shipping,"
      + " terms); (3) BUY — `checkout_url` is the variant permalink that commits the"
      + " purchase. A variant's `url` and its `checkout_url` are DIFFERENT targets:"
      + " `url` is the page (view) whereas `checkout_url` buys — do not conflate"
      + " them. Re-fetch right"
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
      const first = await lookupCatalog(getApiUrl(), stored.access_token, ids);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => lookupCatalog(getApiUrl(), accessToken, ids),
      );
      switch (recovered.kind) {
        case "result":
          // On a silent recovery (`refreshed`: a 401 was healed by the refresh+retry)
          // emit the operator marker so a thrashing session is visible in logs —
          // logs-only, no token material, NOT a payload field (the agent never sees it).
          if (recovered.refreshed) api.logger.info("sil_product_get_refreshed", {});
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
    case "forbidden":
      // Symmetric with sil_search (one vocabulary, AC2/AC7/AC10): a 403 is the shared
      // forbidden envelope, and `user_not_provisioned` — and ONLY that exact reason —
      // clears the structurally-dead token at this call site so recovery terminates
      // regardless of which catalog tool revealed the state. `principal_mismatch` /
      // unknown reasons survive (recoverable; the same exact-equality gate).
      api.logger.warn("sil_product_get_forbidden", { reason: outcome.reason });
      if (outcome.reason === "user_not_provisioned") clearTokens();
      return forbidden(outcome.reason);
    case "invalid_request":
      api.logger.info("sil_product_get_invalid_request", { error: outcome.error });
      return invalidRequest(outcome.error, outcome.message);
    case "retryable":
      // Symmetric with sil_search: a source-attributed 5xx names the source (outcome
      // b); a sil/network blip is the generic copy (outcome a). One error vocabulary.
      api.logger.info(
        "sil_product_get_retryable",
        outcome.source ? { source: outcome.source } : {},
      );
      return transient("sil_product_get", outcome.source, outcome.detail);
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

/** The outcome of narrowing ONE untrusted filter field. The three arms encode the
 * re-spec's behavioral split (founder directive 2026-06-11):
 *   - `ok`      — a valid, format-checked value to forward.
 *   - `absent`  — the field is absent OR the WRONG TYPE → DROP it (treat as unset),
 *                 never coerce. This is the established `readIds` discipline.
 *   - `invalid` — the field is the RIGHT type but a provided string fails its
 *                 FORMAT pattern (`country="United States"`, `region="California"`)
 *                 → REJECT the whole request client-side. `field` names the offender. */
type FilterRead<T> =
  | { kind: "ok"; value: T }
  | { kind: "absent" }
  | { kind: "invalid"; field: string };

/** The outcome of narrowing the whole param object: either the typed
 * {@link SearchParams} to forward, or the FIRST bad-format field that rejects the
 * request client-side (the read site owns FORMAT rejection; the wire owns
 * country-case normalization). */
type SearchParamsRead =
  | { kind: "ok"; params: SearchParams }
  | { kind: "invalid"; field: string };

/** Narrow the untrusted `params` to the simplified {@link SearchParams}, or report
 * the first bad-FORMAT filter field. A field of the wrong type is dropped (treated
 * as absent), not coerced — the host has already validated against the schema, but
 * a drifted on-disk call must not slip a non-string into the query mapping. No
 * `any`, no unchecked `as`.
 *
 * The serviceability/localization filters narrow by their own type: `ship_to` to an
 * object with a string `country` (a primitive/number is DROPPED), `condition` to a
 * string[] (a bare string is dropped), `available` and `local_merchants` to a boolean
 * (a string is dropped). The drop is TYPE-driven, never value-driven, so a valid
 * `available: false` survives — it is a boolean, the meaningful "include unavailable
 * items" signal, not a falsy value to discard.
 *
 * Beyond TYPE narrowing, `ship_to` also FORMAT-validates every provided string field
 * (country alpha-2, region 3166-2, postal bounded) against the shared patterns: a
 * present-but-malformed value returns an `invalid` read so the tool rejects the
 * request client-side with a clear `invalid_filter` error (better agent UX than an
 * opaque, fail-late sil-api 400). `condition` is NOT format-validated — its wire
 * stays OPEN (an unrecognized value still forwards; steering to new/secondhand lives
 * in the description only). `local_merchants` is a plain boolean bias (no format, no
 * country) — its whole steer lives in the description. The first bad field wins. */
function readSearchParams(params: Record<string, unknown>): SearchParamsRead {
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

  const shipTo = readShipTo(params["ship_to"]);
  if (shipTo.kind === "invalid") return { kind: "invalid", field: shipTo.field };
  if (shipTo.kind === "ok") result.ship_to = shipTo.value;

  const condition = readCondition(params["condition"]);
  if (condition !== null) result.condition = condition;
  const available = params["available"];
  if (typeof available === "boolean") result.available = available;
  // `local_merchants` is a plain boolean bias narrowed exactly like `available`:
  // a wrong type is DROPPED (treated as absent), never coerced. A valid `false`
  // survives the read site (type-driven, not value-driven); the omit-when-falsy
  // discipline for the BIAS itself lives at the wire (`buildSearchBody`), since
  // unlike `available:false`, a false bias carries no ranking signal.
  const localMerchants = params["local_merchants"];
  if (typeof localMerchants === "boolean") result.local_merchants = localMerchants;

  return { kind: "ok", params: result };
}

/** A non-null plain object, or null for anything else (arrays/primitives). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Narrow a `ship_to` arg to {@link ShipTo}. A non-object (a primitive `"US"`, a
 * number) or a missing/non-string `country` is `absent` (DROPPED — the wrong-TYPE
 * discipline). A provided string that fails its FORMAT pattern (`country`,
 * `region`, or `postal_code`) is `invalid` (REJECT the request). `country` is
 * uppercased on the WIRE (`buildSearchBody`), not here — the read site validates
 * FORMAT, the wire normalizes case; region/postal are carried verbatim. */
function readShipTo(raw: unknown): FilterRead<ShipTo> {
  const obj = asRecord(raw);
  if (obj === null) return { kind: "absent" };
  const country = obj["country"];
  if (typeof country !== "string" || country.length === 0) return { kind: "absent" };
  if (!matchesPattern(country, COUNTRY_PATTERN)) {
    return { kind: "invalid", field: "ship_to.country" };
  }
  const result: ShipTo = { country };
  const region = obj["region"];
  if (typeof region === "string") {
    if (!matchesPattern(region, REGION_PATTERN)) {
      return { kind: "invalid", field: "ship_to.region" };
    }
    result.region = region;
  }
  const postalCode = obj["postal_code"];
  if (typeof postalCode === "string") {
    if (!matchesPattern(postalCode, POSTAL_PATTERN)) {
      return { kind: "invalid", field: "ship_to.postal_code" };
    }
    result.postal_code = postalCode;
  }
  return { kind: "ok", value: result };
}

/** Test a value against one of the shared schema patterns, anchored exactly as the
 * schema's `pattern` is (the constants carry their own `^…$`). A fresh `RegExp` per
 * call keeps the patterns as plain shared strings (the schema needs the string form;
 * the read site needs to execute it) with no stateful `lastIndex` to reset. */
function matchesPattern(value: string, pattern: string): boolean {
  return new RegExp(pattern).test(value);
}

/** Narrow a `condition` arg to string[], or null if unusable. Requires an array (a
 * bare string is DROPPED, not wrapped); non-string entries are dropped. Returns
 * null for an empty/all-dropped array so the key is omitted rather than emitted
 * empty. The wire stays OPEN — values are NOT format-validated against a known set
 * (an unrecognized value like "refurbished" still forwards; steering to
 * new/secondhand is the description's job, not validation's). */
function readCondition(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const values = raw.filter((c): c is string => typeof c === "string");
  return values.length === 0 ? null : values;
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

/** Client-side validation: a location filter carried a malformed value (bad FORMAT,
 * not wrong type) — rejected BEFORE any network call (re-spec). Distinct from the
 * empty-input case (`empty_search_input`) and from a sil-api 400; the pinned machine
 * code is `invalid_filter`. No `recovery: sil_register` — auth is fine; the value
 * FORMAT is the problem. The message names the offending field and the required ISO
 * code form so the agent re-sends a code, not free text. */
function invalidFilter(field: string) {
  return jsonResult({
    status: "invalid_request",
    error: "invalid_filter",
    message:
      `The \`${field}\` filter is malformed. Send standard ISO codes, not`
      + " free-text names: country as a 2-letter ISO 3166-1 alpha-2 code (e.g."
      + " \"US\"), region as an ISO 3166-2 subdivision code (e.g. \"CA\"), and"
      + " postal_code as a destination postal/ZIP code.",
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

/** Terminal-but-distinct: a 403 — the token is valid but the user isn't provisioned
 * (or a principal mismatch / other reason). Refreshing would not help (a 403 is not
 * a 401). Surfaces the SAME envelope `sil_whoami`'s `forbidden()` (identity.ts) emits
 * — `{ status:"forbidden", reason, message, recovery:"sil_register" }`, byte-identical
 * including the reason-driven message branch — so the three sil-api tools speak ONE
 * error vocabulary (AC5). `user_not_provisioned` reads as an actionable onboarding
 * prompt; any other reason is the generic forbidden copy carrying the reason. The
 * recovery hint is always `sil_register` (the message names it, tool-agnostic — the
 * parity with `sil_whoami`'s envelope is byte-exact, so it carries no per-tool name).
 * The dead-token CLEAR is NOT here — it is the caller's decision (gated on
 * `user_not_provisioned`), so a `principal_mismatch` that still wants the legible
 * envelope does not have its token wiped. */
function forbidden(reason: string) {
  const message =
    reason === "user_not_provisioned"
      ? "Your sil account is not fully set up. Complete onboarding (run"
        + " sil_register) and try again."
      : "sil rejected this request (" + reason + "). Run sil_register to"
        + " re-establish your session, then try again.";
  return jsonResult({ status: "forbidden", reason, message, recovery: "sil_register" });
}

/** Transient: a retryable blip — try again, NOT a re-register (a false terminal on
 * a transient would send the agent down a recovery path that can't fix it). The two
 * causally-distinct transient failures share `status: "retryable"` (both succeed on
 * backoff) but split on ATTRIBUTION, which is the whole point of this card:
 *
 *   - `source` ABSENT (outcome a) — sil itself / the network / transport is down,
 *     OR a refresh-leg blip. The agent retries the same call; the copy stays the
 *     GENERIC "sil is temporarily unavailable" and names no source it cannot
 *     identify (attribution honesty).
 *   - `source` PRESENT (outcome b) — a specific catalog source is down or
 *     rate-limited. The copy NAMES that source and must NEVER say "sil is …
 *     unavailable" / "sil is down": sil is healthy, one source is degraded, often
 *     for seconds, and mis-attributing it to sil makes the agent abandon a working
 *     platform. `detail` (the upstream cause) is relayed when present.
 *
 * The source is named ONLY when the wire actually carried it (the classifier gates
 * on a real `source` field — see `retryableFromBody` in sil-client). The named-source
 * copy is SELF-AUTHORED around the source token rather than echoing the raw upstream
 * `detail` prose verbatim — the upstream wording is sil-api's to change and could
 * itself contain "sil is …" phrasing that would muddy the attribution; `detail` is
 * surfaced as a separate, clearly-delimited field instead. The `tool` name keeps the
 * retry guidance actionable; the status taxonomy is shared. */
function transient(tool: string, source?: string, detail?: string) {
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
