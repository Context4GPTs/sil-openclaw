/**
 * The four v0 catalog tools, 1:1 with the four sil-api routes: `sil_search`
 * (`/catalog/search`), `sil_product_get` (`/catalog/lookup`), `sil_stores`
 * (`/catalog/stores`) and `sil_domain_create` (`/catalog/domains`).
 *
 * FOUR INTENTIONS, FOUR TOOLS, NEVER FLAGS ON ONE ANOTHER. No `mode`, no
 * `action`, no `include_stores`, no `refresh`, no `create_domain_if_missing`. A
 * model picks a tool by name at the moment of use; a flag hides the intention
 * inside a parameter it will not read — and one of these four performs a GLOBAL
 * registry write that nothing in the product can undo.
 *
 * THE TOOLS COMPUTE NO VERDICT. The agent's three-state veto (verified satisfies
 * · verified violates · not verified) is computed from `values[].state`,
 * `predicates[].applied` and `results[].maturity`. This layer's whole job is that
 * those three cross the boundary intact: the payload is gated structurally at its
 * top level and handed over VERBATIM. There is no projection here, deliberately —
 * a per-field projector drops exactly the fields the veto reads, and it would do
 * so while looking perfectly healthy.
 *
 * ONE GROUP, ONE FILE. All four share one origin, one Bearer, one 401
 * choreography and one error envelope, and a new `registerXTools` group has to be
 * hand-wired into three guards or it silently NARROWS them (CLAUDE.md). The
 * envelope helpers at the bottom are tool-parameterised and shared by all four.
 *
 * `execute()` is the same shape in every tool:
 *   1. no stored tokens → terminal `not_registered`, ZERO network calls;
 *   2. one call, one route, via the shared `refreshAndRetryOnce` 401 recovery
 *      (uniform across every sil-api-calling tool — never per-tool);
 *   3. map the outcome to the shared envelope.
 * There is no client-side request validation: every v0 route refuses before it
 * spends and names the offender in its message by design, so a second validator
 * here would only be a surface to drift. Bounds the HOST can enforce for free
 * (`maxItems`, `minimum`/`maximum`, `pattern`) are stated in the schemas — that is
 * the same bound written once more where the host reads it, not a validator.
 *
 * `register()` stays synchronous and opens nothing; all I/O is inside `execute()`.
 * The session token and Bearer header never reach a log line or a result.
 */

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import { getApiUrl } from "../lib/config.js";
import { clearTokens, readConfig, readTokens } from "../lib/credentials.js";
import { wiringAdvisories } from "../lib/host-wiring.js";
import { putSearchResult } from "../lib/search-results-store.js";
import {
  lookupCatalog,
  mintDomain,
  readStores,
  refreshAndRetryOnce,
  searchCatalog,
  type CatalogResultOutcome,
  type DomainMintParams,
  type MintOutcome,
  type SearchParams,
  type SearchPredicate,
  type SpecDefinitionInput,
  type StoresOutcome,
  type StoresParams,
} from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";

/** ltree's label alphabet, narrowed to the lowercase form the registry uses —
 * `@sil/schemas`' `DOMAIN_PATH_RE`, mirrored so a malformed path is refused by
 * the host with the same rule the route would have applied. */
const DOMAIN_PATH_PATTERN = "^[a-z0-9_]+(\\.[a-z0-9_]+)*$";

/** ISO 3166-1 alpha-2, either case — `@sil/schemas`' `SHIP_TO_COUNTRY_RE`. */
const COUNTRY_PATTERN = "^[A-Za-z]{2}$";

export function registerCatalogTools(api: PluginAPI): void {
  registerSearch(api);
  registerProductGet(api);
  registerStores(api);
  registerDomainCreate(api);
}

function registerSearch(api: PluginAPI): void {
  api.registerTool({
    name: "sil_search",
    label: "Search sil in one registry domain",
    description:
      "Search sil for buyable items in one registry domain. Send the domain path,"
      + " the buyer's own words as `query`, and their stated requirements as typed"
      + " predicates; get up to `n` results, best first. Present them in the order"
      + " returned — do not re-rank. Each result carries the values sil holds"
      + " (`unset` where it holds none), the merchant's own printed pairs, the"
      + " offers it has read, and `maturity` (`catalog` = built and verified by"
      + " sil; `web` = a listing read minutes ago, values honestly unset)."
      + " `predicates[]` says, per requirement, whether sil could apply it. A"
      + " requirement reported `applied: false`, or a result whose value is"
      + " `unset`, is NOT VERIFIED — neither a match nor a miss: keep the result"
      + " and name the missing value. Discipline: at most 4 calls per item; widen"
      + " soft requirements only; a hard requirement is never relaxed. If the"
      + " domain is not in sil's registry the call is refused — research how the"
      + " category is bought, then sil_domain_create at that same path.",
    parameters: Type.Object({
      domain: Type.String({
        pattern: DOMAIN_PATH_PATTERN,
        maxLength: 255,
        description:
          "The registry path to search, dot-separated and lowercase (e.g."
          + " product.sports.winter.ski.boots). Exactly one domain per call. A path"
          + " sil does not hold is refused — mint it with sil_domain_create rather"
          + " than retrying or guessing a shallower path.",
      }),
      query: Type.String({
        minLength: 1,
        maxLength: 512,
        description:
          "What the buyer asked for, in their own words. Free text — sil ranks"
          + " against it; requirements belong in `predicates`, not here.",
      }),
      n: Type.Integer({
        minimum: 1,
        maximum: 50,
        description:
          "How many results to return, 1–50. This is a spend knob: sil fetches"
          + " candidates from the web to fill it, so choose it for the shopper's"
          + " actual need. There is no default — state the number you want.",
      }),
      predicates: Type.Optional(
        Type.Array(
          Type.Object({
            key: Type.String({
              minLength: 1,
              maxLength: 64,
              description:
                "A spec key from this domain's vocabulary. A key sil has not"
                + " resolved is not an error — it comes back `applied: false`, a"
                + " named gap, and every result is still returned.",
            }),
            op: Type.Union(
              [
                Type.Literal("eq"),
                Type.Literal("neq"),
                Type.Literal("gte"),
                Type.Literal("lte"),
                Type.Literal("in"),
                Type.Literal("nin"),
                Type.Literal("exists"),
              ],
              { description: "The comparison sil should apply to this key." },
            ),
            value: Type.Unknown({
              description:
                "The operand: a scalar for eq/neq, a number for gte/lte, an array"
                + " for in/nin. Money travels as a decimal string.",
            }),
            currency: Type.Optional(
              Type.String({
                minLength: 3,
                maxLength: 3,
                description:
                  "Required on a money predicate. sil holds no exchange rate"
                  + " anywhere, so a cross-currency comparison is meaningless"
                  + " rather than approximate.",
              }),
            ),
          }),
          {
            maxItems: 32,
            description:
              "The buyer's stated requirements, typed. Each one comes back in"
              + " `predicates[]` saying whether sil could apply it — that answer,"
              + " not this list, is what tells you a result was verified.",
          },
        ),
      ),
      destination: Type.Optional(
        Type.String({
          pattern: COUNTRY_PATTERN,
          description:
            "Where the buyer is, as a 2-letter ISO 3166-1 country code. Leave it"
            + " out to ship to the buyer's own registered country — do not call"
            + " sil_whoami to fill it in.",
        }),
      ),
    }),
    async execute(callId, params) {
      const stored = readTokens();
      if (stored === null) return notRegistered("sil_search");

      const search = readSearchParams(params);
      const first = await searchCatalog(getApiUrl(), stored.access_token, search);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => searchCatalog(getApiUrl(), accessToken, search),
      );
      switch (recovered.kind) {
        case "result":
          if (recovered.refreshed) api.logger.info("sil_search_refreshed", {});
          // Buffer the page for a paired client to pull by this exact `callId`
          // (`sil.search_results`). A PURE SIDE EFFECT: the envelope returned
          // below is byte-identical to what every channel got before this
          // existed — no reference, no flag, no listener check. Only `ok` is
          // stored; the other outcomes steer recovery and carry no product data.
          // `advisories` stay OFF the page — they are operator copy, not products.
          if (recovered.outcome.kind === "ok") {
            const principal = readConfig()?.user?.id;
            if (principal !== undefined) {
              putSearchResult(callId, { status: "ok", ...recovered.outcome.result }, principal);
            }
          }
          return mapResultOutcome(api, "sil_search", recovered.outcome);
        case "must_reregister":
          if (recovered.reason === "invalid_grant") clearTokens();
          api.logger.info("sil_search_must_reregister", { cause: recovered.reason });
          return mustReregister("sil_search");
        case "second_unauthorized":
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

function registerProductGet(api: PluginAPI): void {
  api.registerTool({
    name: "sil_product_get",
    label: "Re-read sil results before the buyer decides",
    description:
      "Re-read up to 5 results you already hold, by the `ref` sil returned, before"
      + " the buyer decides. Same result object, with the top offers' prices read"
      + " live: every offer says `observed: live` (read just now) or `stored`"
      + " (quoted from storage — say the date it was read, never present it as the"
      + " current price). Only the offers move; values, pairs and media are the"
      + " stored read. A ref that resolves to nothing is absent from the results —"
      + " say that listing is gone, never substitute another product. Discipline:"
      + " the shortlist read — live prices, top-K bounded.",
    parameters: Type.Object({
      refs: Type.Array(
        Type.String({
          minLength: 1,
          maxLength: 2048,
          description:
            "A ref sil returned, verbatim: `variant:<uuid>` or `url:<url>`. It"
            + " comes back echoed on the result, so a ref missing from the results"
            + " is the one sil could not place.",
        }),
        {
          minItems: 1,
          maxItems: 5,
          description:
            "The shortlist, 1–5 refs. Trim it before the call, not after — the cap"
            + " is the route's and a longer batch is refused outright.",
        },
      ),
    }),
    async execute(_callId, params) {
      const stored = readTokens();
      if (stored === null) return notRegistered("sil_product_get");

      const refs = readRefs(params);
      const first = await lookupCatalog(getApiUrl(), stored.access_token, refs);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => lookupCatalog(getApiUrl(), accessToken, refs),
      );
      switch (recovered.kind) {
        case "result":
          if (recovered.refreshed) api.logger.info("sil_product_get_refreshed", {});
          return mapResultOutcome(api, "sil_product_get", recovered.outcome);
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

function registerStores(api: PluginAPI): void {
  api.registerTool({
    name: "sil_stores",
    label: "List every seller of one pick and whether it ships",
    description:
      "For one pick, list every seller that carries it and what sil knows about"
      + " shipping it to the buyer. Each seller carries `serviceability`:"
      + " `serviceable` (sil read a shipping route covering the destination),"
      + " `not_serviceable` (sil read this seller's policy and it excludes the"
      + " destination), or `unknown` (sil has not read this seller's policy)."
      + " `unknown` is an ordinary answer, not a degraded one, and never a reason"
      + " to drop a seller: keep it, say sil could not confirm shipping, and hand"
      + " over its URL. Costs and thresholds come as ranges per currency where sil"
      + " has read them and `unset` where it has not — `unset` is never zero and"
      + " never free. The `handoff` names its own promise: `source: buy_url` is a"
      + " checkout path, `source: url` is the listing page — say which one you are"
      + " handing over. Discipline: the pick's check — three states; `unknown` is"
      + " never no.",
    parameters: Type.Object({
      ref: Type.String({
        minLength: 1,
        maxLength: 2048,
        description:
          "The pick, as the single ref sil returned (`variant:<uuid>` or"
          + " `url:<url>`). One pick per call: serviceability is an answer about"
          + " this item, so a batch could not say which item it was about.",
      }),
      destination: Type.Optional(
        Type.String({
          pattern: COUNTRY_PATTERN,
          description:
            "Where the buyer is, as a 2-letter ISO 3166-1 country code. Leave it"
            + " out to use the buyer's own registered country — do not call"
            + " sil_whoami to fill it in. With neither, the call is refused rather"
            + " than answered for an unknown place: ask the buyer where it ships.",
        }),
      ),
    }),
    async execute(_callId, params) {
      const stored = readTokens();
      if (stored === null) return notRegistered("sil_stores");

      const query = readStoresParams(params);
      const first = await readStores(getApiUrl(), stored.access_token, query);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => readStores(getApiUrl(), accessToken, query),
      );
      switch (recovered.kind) {
        case "result":
          if (recovered.refreshed) api.logger.info("sil_stores_refreshed", {});
          return mapStoresOutcome(api, query.ref, recovered.outcome);
        case "must_reregister":
          if (recovered.reason === "invalid_grant") clearTokens();
          api.logger.info("sil_stores_must_reregister", { cause: recovered.reason });
          return mustReregister("sil_stores");
        case "second_unauthorized":
          clearTokens();
          api.logger.info("sil_stores_must_reregister", { cause: "retry_unauthorized" });
          return mustReregister("sil_stores");
        case "retryable":
          api.logger.info("sil_stores_refresh_retryable", {});
          return transient("sil_stores");
      }
    },
  });
}

function registerDomainCreate(api: PluginAPI): void {
  api.registerTool({
    name: "sil_domain_create",
    label: "Add a new category to sil's shared registry",
    description:
      "Add a NEW category to sil's shared registry: its path, a buying guide"
      + " written from research, and its first spec keys. Call it only after"
      + " reading up on the web on how that category is actually bought (never on"
      + " products), and only when sil's search refused the domain as unregistered."
      + " NEW nodes only — an existing path is refused and nothing is written; that"
      + " refusal means the category is already there, so re-issue the search on"
      + " the same path. Never mint a near-path variant to route around a refusal,"
      + " and never call this to change or extend a domain that exists. What you"
      + " write is global — every sil shopper sees it. A fresh node is provisional"
      + " until sil validates it: tell the buyer the first answers come from the"
      + " web while that catches up.",
    parameters: Type.Object({
      path: Type.String({
        pattern: DOMAIN_PATH_PATTERN,
        maxLength: 255,
        description:
          "The registry path to coin, dot-separated and lowercase. It must descend"
          + " from a path sil already holds, and it is permanent — there is no way"
          + " to rename or remove it, and a second node for one category splits the"
          + " vocabulary for every shopper, forever.",
      }),
      guide: Type.String({
        minLength: 1,
        maxLength: 4096,
        description:
          "How this category is actually bought — what separates the options, what"
          + " a buyer has to get right, what the numbers mean. This is the research"
          + " you did on the web, written down; it is the only output of that"
          + " research, and sil reads it when it extracts.",
      }),
      specs: Type.Array(
        Type.Object({
          key: Type.String({
            minLength: 1,
            maxLength: 64,
            description: "The spec's key, lowercase and stable (e.g. flex_index).",
          }),
          display_name: Type.String({
            minLength: 1,
            maxLength: 128,
            description: "What a buyer would call it.",
          }),
          description: Type.Optional(
            Type.String({
              maxLength: 1024,
              description: "What it means and how it is read on a listing.",
            }),
          ),
          data_type: Type.String({
            minLength: 1,
            maxLength: 32,
            description: "One of number, boolean, enum or money.",
          }),
          unit: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 32,
              description:
                "Required on a number: it is the storage SCALE every value of this"
                + " key is held in, not a label.",
            }),
          ),
          allowed_values: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
              minItems: 1,
              description: "An inline closed set. An enum declares this or a value_set.",
            }),
          ),
          value_set: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 32,
              description: "A registry-managed named set, where one already fits.",
            }),
          ),
          level: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 16,
              description:
                "product or variant. Omit it where the category is not sure which.",
            }),
          ),
        }),
        {
          maxItems: 50,
          description:
            "The keys this category is actually shopped on — the few a buyer"
            + " compares, not everything a spec sheet prints. A vocabulary is"
            + " curated; every shopper after this one inherits it.",
        },
      ),
    }),
    async execute(_callId, params) {
      const stored = readTokens();
      if (stored === null) return notRegistered("sil_domain_create");

      const mint = readMintParams(params);
      const first = await mintDomain(getApiUrl(), stored.access_token, mint);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => mintDomain(getApiUrl(), accessToken, mint),
      );
      switch (recovered.kind) {
        case "result":
          if (recovered.refreshed) api.logger.info("sil_domain_create_refreshed", {});
          return mapMintOutcome(api, recovered.outcome);
        case "must_reregister":
          if (recovered.reason === "invalid_grant") clearTokens();
          api.logger.info("sil_domain_create_must_reregister", { cause: recovered.reason });
          return mustReregister("sil_domain_create");
        case "second_unauthorized":
          clearTokens();
          api.logger.info("sil_domain_create_must_reregister", { cause: "retry_unauthorized" });
          return mustReregister("sil_domain_create");
        case "retryable":
          api.logger.info("sil_domain_create_refresh_retryable", {});
          return transient("sil_domain_create");
      }
    },
  });
}

/* ── outcome → envelope ─────────────────────────────────────────────────────── */

/** Map a search or lookup outcome that has ALREADY cleared the 401-recovery path
 * to the agent-facing envelope. The `unauthorized` arm is structurally
 * unreachable but kept exhaustive so a refactor cannot silently drop a variant. */
function mapResultOutcome(api: PluginAPI, tool: string, outcome: CatalogResultOutcome) {
  switch (outcome.kind) {
    case "ok":
      return jsonResult({ status: "ok", ...outcome.result, ...wiringAdvisories(api) });
    case "forbidden":
      return forbiddenResult(api, tool, outcome.reason);
    case "invalid_request":
      api.logger.info(`${tool}_invalid_request`, { error: outcome.error });
      return invalidRequest(outcome.error, outcome.message);
    case "retryable":
      api.logger.info(`${tool}_retryable`, outcome.source ? { source: outcome.source } : {});
      return transient(tool, outcome.source, outcome.detail);
    case "unauthorized":
      return mustReregister(tool);
  }
}

function mapStoresOutcome(api: PluginAPI, ref: string, outcome: StoresOutcome) {
  switch (outcome.kind) {
    case "ok":
      return jsonResult({ status: "ok", ...outcome.stores, ...wiringAdvisories(api) });
    case "not_found":
      api.logger.info("sil_stores_not_found", {});
      return notFound(ref, outcome.message);
    case "forbidden":
      return forbiddenResult(api, "sil_stores", outcome.reason);
    case "invalid_request":
      api.logger.info("sil_stores_invalid_request", { error: outcome.error });
      return invalidRequest(outcome.error, outcome.message);
    case "retryable":
      api.logger.info("sil_stores_retryable", outcome.source ? { source: outcome.source } : {});
      return transient("sil_stores", outcome.source, outcome.detail);
    case "unauthorized":
      return mustReregister("sil_stores");
  }
}

function mapMintOutcome(api: PluginAPI, outcome: MintOutcome) {
  switch (outcome.kind) {
    case "ok":
      api.logger.info("sil_domain_create_minted", { spec_count: outcome.domain.specs.length });
      return jsonResult({ status: "ok", ...outcome.domain, ...wiringAdvisories(api) });
    case "already_exists":
      api.logger.info("sil_domain_create_already_exists", {});
      return alreadyExists(outcome.path, outcome.message);
    case "forbidden":
      return forbiddenResult(api, "sil_domain_create", outcome.reason);
    case "invalid_request":
      api.logger.info("sil_domain_create_invalid_request", { error: outcome.error });
      return invalidRequest(outcome.error, outcome.message);
    case "retryable":
      api.logger.info(
        "sil_domain_create_retryable",
        outcome.source ? { source: outcome.source } : {},
      );
      return transient("sil_domain_create", outcome.source, outcome.detail);
    case "unauthorized":
      return mustReregister("sil_domain_create");
  }
}

/* ── reading the host-validated params ──────────────────────────────────────── */

/**
 * The SDK types `params` as `Record<string, unknown>` and the host has already
 * validated it against the schema above, so these readers narrow TYPES — they do
 * not re-validate semantics. `predicates` and `specs` are forwarded as read: this
 * layer never interprets an op, a value or a spec, and a second opinion on them
 * would be a contract to drift.
 */
function readSearchParams(params: Record<string, unknown>): SearchParams {
  const predicates = params["predicates"];
  const destination = params["destination"];
  return {
    domain: asString(params["domain"]),
    query: asString(params["query"]),
    n: typeof params["n"] === "number" ? params["n"] : 0,
    ...(Array.isArray(predicates) ? { predicates: predicates as SearchPredicate[] } : {}),
    ...(typeof destination === "string" ? { destination } : {}),
  };
}

function readRefs(params: Record<string, unknown>): string[] {
  const raw = params["refs"];
  return Array.isArray(raw) ? raw.filter((ref): ref is string => typeof ref === "string") : [];
}

function readStoresParams(params: Record<string, unknown>): StoresParams {
  const destination = params["destination"];
  return {
    ref: asString(params["ref"]),
    ...(typeof destination === "string" ? { destination } : {}),
  };
}

function readMintParams(params: Record<string, unknown>): DomainMintParams {
  const specs = params["specs"];
  return {
    path: asString(params["path"]),
    guide: asString(params["guide"]),
    specs: Array.isArray(specs) ? (specs as SpecDefinitionInput[]) : [],
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/* ── the shared envelopes ───────────────────────────────────────────────────── */

/** Not registered: a distinct, actionable outcome naming the recovery tool, with
 * no results field the agent could mistake for an empty answer. */
function notRegistered(tool: string) {
  return jsonResult({
    status: "not_registered",
    message:
      `Not registered on sil. Run sil_register to authenticate, then call ${tool} again.`,
    recovery: "sil_register",
  });
}

/**
 * sil refused the request (a 400), surfaced VERBATIM.
 *
 * Every v0 route refuses before it spends and names the offender in its own
 * message, so the message IS the agent's recourse and is never rewritten or
 * matched on here. `sil_search`'s two refusals — an unregistered domain and a
 * predicate the grammar rejects — carry the same `error: "invalid_request"` on
 * the wire, so the plugin cannot tell them apart without matching the sibling's
 * prose, which it refuses to do; the tool's own description carries the remedy
 * for each. No `recovery: sil_register` (auth is fine) and no retry hint
 * (re-sending the same body cannot succeed).
 */
function invalidRequest(error: string, message: string) {
  return jsonResult({ status: "invalid_request", error, message });
}

/** sil holds no such ref (a `sil_stores` 404). Terminal but NOT fatal and NOT
 * retryable: no retry and no re-registration can make sil hold it. The submitted
 * ref rides along so the agent can say which pick it could not place. */
function notFound(ref: string, message: string) {
  return jsonResult({ status: "not_found", ref, message });
}

/** The domain is already in the registry (a `sil_domain_create` 409). NOT a
 * failure and never framed as one: it means the vocabulary is already there, so
 * the recovery is to search that SAME path — never to mint a near-path variant,
 * which would split the category for every shopper with no way back. */
function alreadyExists(path: string, message: string) {
  return jsonResult({
    status: "already_exists",
    path,
    message:
      `The domain "${path}" is already in sil's registry, so nothing was written`
      + ` and nothing needs to be: search that same path. (${message})`,
    recovery: "sil_search",
  });
}

/** Terminal: the session is dead — reached only after the shared refresh-and-retry
 * choreography has exhausted its one refresh + one retry. */
function mustReregister(tool: string) {
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
 * The token CLEAR is gated on exactly `user_not_provisioned`: that token maps to
 * no account on this backend and is structurally dead, so clearing it lets the
 * next `sil_register` re-onboard instead of short-circuiting to
 * already-registered. A `principal_mismatch` can be transient and MUST NOT clear
 * — the exact-equality gate is the correctness boundary here, and a truthy or
 * prefix check would wipe a good session.
 */
function forbiddenResult(api: PluginAPI, tool: string, reason: string) {
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
