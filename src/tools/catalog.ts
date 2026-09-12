/**
 * The seven `shopping_*` tools, 1:1 with the seven sil-api catalog routes and 1:1 with
 * the agent contract's §3.1–§3.7.
 *
 * ONE TABLE DRIVES ALL OF IT. Each tool's `parameters` IS its committed request
 * artifact (`schema/shopping-*-request.schema.json`) and each `ok` result IS the API's
 * 200 body, handed over VERBATIM. The plugin adds no shape of its own in either
 * direction: a hand-written schema here would be a second copy of the request contract,
 * and a projection on the way back would drop exactly the fields the agent's honesty
 * reading is computed from (`fit`, `variants`, `webpage_info`) while looking healthy.
 *
 * SEVEN INTENTIONS, SEVEN TOOLS, NEVER FLAGS ON ONE ANOTHER. A model picks a tool by
 * name at the moment of use; a flag hides the intention inside a parameter it will not
 * read — and one of these seven performs a GLOBAL registry write that nothing in the
 * product can undo. That write and the read that licenses it share no path and no verb.
 *
 * ONE GROUP, ONE FILE. All seven share one origin, one Bearer, one 401 choreography and
 * one error envelope, and a new `registerXTools` group has to be hand-wired into three
 * guards or it silently NARROWS them (CLAUDE.md).
 *
 * There is NO client-side request validation: the host already validated the arguments
 * against the artifact, and the route refuses before it spends and names the offender.
 * `register()` opens nothing beyond reading the seven artifacts; the session token and
 * Bearer header never reach a log line or a result.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginAPI, ToolDefinition } from "openclaw/plugin-sdk";
import type { TSchema } from "typebox";

import { getApiUrl } from "../lib/config.js";
import { clearTokens, readConfig, readTokens } from "../lib/credentials.js";
import { wiringAdvisoryBlocks } from "../lib/host-wiring.js";
import { putSearchResult, type SearchResultPage } from "../lib/search-results-store.js";
import {
  callShopping,
  refreshAndRetryOnce,
  type ShoppingOutcome,
  type ShoppingRoute,
} from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";

interface ShoppingTool extends ShoppingRoute {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  /** What the agent runs next on a refusal only THIS route can produce — the 404 the
   * path read answers, the 409 the mint answers. Absent where no recovery exists. */
  readonly refusalRecovery?: string;
}

/** The tool whose page a paired client can pull back by `callId`. */
const SEARCH_TOOL = "shopping_search";

export const SHOPPING_TOOLS: readonly ShoppingTool[] = [
  {
    name: "shopping_domain_search",
    method: "GET",
    path: "/catalog/domains",
    query: ["q"],
    label: "Read sil's registry for a category",
    description:
      "Beat 2, what already stands: read sil's shared registry in the buyer's own words"
      + " and get back the categories that match, each with its path and a line on how"
      + " the thing is bought. Judge fit on `about`, then take that path verbatim, or"
      + " descend under a broader one — never a sibling of a path that already stands."
      + " `matches: []` is a real answer and the ONLY one that licenses"
      + " shopping_domain_create; a non-ok status is not an empty answer, so settle the"
      + " read before coining anything. At most two reads per category: the item's own"
      + " prose, then the plain category name. Pass the path you take to"
      + " shopping_domain_get for the guide and the keys.",
  },
  {
    name: "shopping_domain_get",
    method: "GET",
    path: "/catalog/domains/:path",
    label: "Read a category's buying guide and keys",
    refusalRecovery: "shopping_domain_search",
    description:
      "Beats 2 and 3, the category's guide and its keys: send one standing path and get"
      + " the buying guide plus every key the category is bought by. Copy the guide into"
      + " the Brief and translate the buyer's facts through it. Each key states the"
      + " operators it takes, its type, its unit and any closed set of values — send that"
      + " key and one of those operators to shopping_search, never a synonym you coined."
      + " A key marked variant_spec identifies a purchasable option (a size, a colour):"
      + " settle it before searching, and expect its values under each product's"
      + " variants. A key marked product_spec tells one product from the next. The root"
      + " `product` always stands and carries the universals every category inherits; a"
      + " path that does not stand answers not_found, and the recovery is to read the"
      + " registry again in the buyer's words.",
  },
  {
    name: "shopping_domain_create",
    method: "POST",
    path: "/catalog/domains",
    label: "Coin a new category in sil's registry",
    refusalRecovery: "shopping_search",
    description:
      "Beat 2's mint, and the one permanent global write in sil: coin a NEW category —"
      + " its path, a buying guide written from research, and the first keys it is bought"
      + " by. Two things must both hold first: a shopping_domain_search read came back"
      + " `matches: []`, and you have read up on the web on how the category is bought"
      + " (never on products). Mark variant_spec on a key that identifies a purchasable"
      + " option and product_spec on one that tells one product from the next; the"
      + " registry derives each key's operators from its type. A key an ancestor already"
      + " defines is refused by name, as `price` is. An existing path is refused and"
      + " nothing is written — that refusal means the vocabulary is already there, so"
      + " search that same path; never coin a near-path variant to route around it, and"
      + " never call this to change a category that exists. Every sil shopper sees what"
      + " you write and nothing can undo it.",
  },
  {
    name: SEARCH_TOOL,
    method: "POST",
    path: "/catalog/search",
    label: "Search sil in one settled category",
    description:
      "Beat 5: the products and variants that fit, in one settled category. Send the"
      + " domain path, the buyer's own words as `query`, how many products you want, and"
      + " the desired values as `specs` — one per hard row or preference, with the"
      + " operator the domain read listed for that key. `price` is a key every domain"
      + " has, and its currency is required: sil holds no exchange rate, so a bound in"
      + " another currency is one sil could not test — say so rather than dropping the"
      + " product. Present the products in the order returned and never re-rank them."
      + " `fit` answers the ask key by key with what sil verified, so a key absent from"
      + " it is a gap to name, never a miss. `variants` carries the options that fit, and"
      + " an empty list says no listed option fits. `webpage_info` means sil has not read"
      + " that page yet: its text is the merchant's own words, good for a provisional"
      + " pick and never presented as verified — its absence means the values were"
      + " verified. At most 4 calls per item, widening soft rows only; a hard row is"
      + " never relaxed.",
  },
  {
    name: "shopping_product_get",
    method: "POST",
    path: "/catalog/product",
    label: "Read the whole dossier on a shortlisted variant",
    description:
      "Beat 6, the dossier: send 1–10 variant ids from a shopping_search answer and get"
      + " the whole of what sil holds for each — the title, the maker, the page's own"
      + " description, the images, every key sil holds for it (not only the ones you"
      + " asked about), and `sources` naming which site each reading came from and when."
      + " Compare the shortlist on this before recommending, and quote a source's date"
      + " rather than implying sil read it just now. An id sil cannot place is simply"
      + " absent from the answer — say that listing could not be placed, and never"
      + " substitute another product. Ids are opaque: pass them back exactly as sil"
      + " minted them, and never read one.",
  },
  {
    name: "shopping_offers",
    method: "POST",
    path: "/catalog/offers",
    label: "List who sells a variant and at what price",
    description:
      "Beat 6, who sells the pick and at what price: send 1–10 variant ids and get one"
      + " entry per variant per seller, read live. Each carries the seller's name and id,"
      + " the price exactly as the page prints it with its own currency (sil converts"
      + " nothing), whether it can be bought now, the listing URL, and `observed_at` —"
      + " the moment sil read it, which is what dates the price for the buyer. Pass a"
      + " seller id on to shopping_seller_get to learn whether that seller ships to the"
      + " buyer and on what terms. Several offers on one variant ARE the price spread,"
      + " and the spread is the answer — never collapse it to a single best one.",
  },
  {
    name: "shopping_seller_get",
    method: "POST",
    path: "/catalog/sellers",
    label: "Check whether a seller ships to the buyer",
    description:
      "Beat 6, whether a seller ships to the buyer and on what terms: send 1–10 seller"
      + " ids from shopping_offers, and a destination country only when it is not the"
      + " buyer's own registered one. Each seller comes back with its name, host and"
      + " country, and `ships`: serviceable (sil read a route covering the destination),"
      + " not_serviceable (sil read this seller's policy and it excludes the destination),"
      + " or unknown (sil has read nothing about this seller). `unknown` is an ordinary"
      + " answer that keeps the seller — say sil could not confirm shipping, and hand the"
      + " buyer the listing. Where sil has read them, `shipping` carries the routes with"
      + " their cost, free-over threshold and days, and `returns` the window and any"
      + " restocking fee; a term the page never stated is simply absent, which is never"
      + " zero and never free. A `policy_url` of null means the terms were read off a"
      + " product page and sil holds no policy page.",
  },
];

export function registerCatalogTools(api: PluginAPI): void {
  for (const tool of SHOPPING_TOOLS) api.registerTool(defineTool(api, tool));
}

function defineTool(api: PluginAPI, tool: ShoppingTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: requestSchema(tool.name),
    async execute(callId, params) {
      const stored = readTokens();
      if (stored === null) return notRegistered(tool.name);

      const first = await callShopping(getApiUrl(), stored.access_token, tool, params);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => callShopping(getApiUrl(), accessToken, tool, params),
      );
      switch (recovered.kind) {
        case "result":
          if (recovered.refreshed) api.logger.info(`${tool.name}_refreshed`, {});
          return mapOutcome(api, tool, callId, recovered.outcome);
        case "must_reregister":
          if (recovered.reason === "invalid_grant") clearTokens();
          api.logger.info(`${tool.name}_must_reregister`, { cause: recovered.reason });
          return mustReregister(tool.name);
        case "second_unauthorized":
          clearTokens();
          api.logger.info(`${tool.name}_must_reregister`, { cause: "retry_unauthorized" });
          return mustReregister(tool.name);
        case "retryable":
          api.logger.info(`${tool.name}_refresh_retryable`, {});
          return transient(tool.name);
      }
    },
  };
}

/** The repo root's `schema/`, resolved from both `src/tools/` and `dist/tools/`. It
 * ships via `package.json#files`. */
const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema");

/**
 * The tool's request artifact, as the host's `parameters`.
 *
 * The three annotation keys are stripped: `$schema`, `$id` and `title` describe the
 * FILE, not the argument the model has to build, and a `$id` on a tool input invites a
 * host to resolve a URL nobody serves. A missing or shapeless artifact throws at
 * registration — a broken build, not a runtime state to model.
 */
function requestSchema(tool: string): TSchema {
  const stem = tool.slice("shopping_".length).replaceAll("_", "-");
  const path = join(SCHEMA_DIR, `shopping-${stem}-request.schema.json`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: request artifact is not a JSON Schema object`);
  }
  const schema: Record<string, unknown> = { ...parsed };
  for (const annotation of ["$schema", "$id", "title"]) delete schema[annotation];
  return schema as TSchema;
}

/* ── outcome → the contract's §4 vocabulary ─────────────────────────────────── */

function mapOutcome(api: PluginAPI, tool: ShoppingTool, callId: string, outcome: ShoppingOutcome) {
  switch (outcome.kind) {
    case "ok":
      if (tool.name === SEARCH_TOOL) bufferPage(callId, outcome.body);
      // VERBATIM, and the advisory rides its own block: the body's keys are the API's
      // contract, so nothing of ours may sit beside them.
      return jsonResult(outcome.body, ...wiringAdvisoryBlocks(api));
    case "invalid_request":
      api.logger.info(`${tool.name}_invalid_request`, {});
      return invalidRequest(outcome.message);
    case "not_found":
      api.logger.info(`${tool.name}_not_found`, {});
      return refusal("not_found", outcome.message, tool.refusalRecovery);
    case "already_exists":
      api.logger.info(`${tool.name}_already_exists`, {});
      return refusal("already_exists", outcome.message, tool.refusalRecovery);
    case "forbidden":
      return forbiddenResult(api, tool.name, outcome.reason);
    case "retryable":
      api.logger.info(`${tool.name}_retryable`, outcome.source ? { source: outcome.source } : {});
      return transient(tool.name, outcome.source, outcome.detail);
    case "unauthorized":
      // Structurally unreachable past the 401 choreography, kept exhaustive so a
      // refactor cannot silently drop a variant.
      return mustReregister(tool.name);
  }
}

/**
 * Buffer an `ok` search page for a paired client to pull by this exact `callId`
 * (`sil.search_results`). A PURE SIDE EFFECT: the result returned to the agent is
 * byte-identical to what every channel got before this existed. Only a body that
 * actually carries its `products` list is stored — the pull surface counts it.
 */
function bufferPage(callId: string, body: Record<string, unknown>): void {
  const principal = readConfig()?.user?.id;
  if (principal === undefined) return;
  if (!Array.isArray(body["products"])) return;
  putSearchResult(callId, body as SearchResultPage, principal);
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
 * The route refuses before it spends and names the offender in its own message, so the
 * message IS the agent's recourse and is never rewritten or matched on here. No
 * `recovery`: auth is fine, and re-sending the same body cannot succeed.
 */
function invalidRequest(message: string) {
  return jsonResult({ status: "invalid_request", message });
}

/** A refusal only one route can produce — a path the registry does not hold, or a mint
 * onto a path that already stands. Terminal but NOT fatal and NOT retryable, so the
 * recovery is the next tool to call rather than the same call again. */
function refusal(status: "not_found" | "already_exists", message: string, recovery?: string) {
  return jsonResult({
    status,
    message,
    ...(recovery !== undefined ? { recovery } : {}),
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
 * The token CLEAR is gated on exactly `user_not_provisioned`: that token maps to no
 * account on this backend and is structurally dead, so clearing it lets the next
 * `sil_register` re-onboard instead of short-circuiting to already-registered. A
 * `principal_mismatch` can be transient and MUST NOT clear — the exact-equality gate is
 * the correctness boundary here, and a truthy or prefix check would wipe a good session.
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
