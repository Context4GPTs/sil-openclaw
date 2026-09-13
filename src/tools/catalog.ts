/**
 * The seven `shopping_*` tools, 1:1 with the sil-api catalog routes.
 *
 * A projection on the way back would drop exactly the fields the agent's honesty reading
 * is computed from (`fit`, `variants`, `webpage_info`) while looking healthy, so the body
 * crosses verbatim. A new `registerXTools` group has to be hand-wired into three guards
 * or it silently NARROWS them (CLAUDE.md), which is why all seven live in one group.
 */

import type { PluginAPI, ToolDefinition } from "openclaw/plugin-sdk";

import { requestSchema } from "../lib/artifacts.js";
import { readConfig } from "../lib/credentials.js";
import { wiringAdvisoryBlocks } from "../lib/host-wiring.js";
import { putSearchResult, type SearchResultPage } from "../lib/search-results-store.js";
import { callRoute, type ShoppingCall } from "../lib/shopping-call.js";
import { jsonResult } from "../lib/tool-result.js";

interface ShoppingTool extends ShoppingCall {
  readonly label: string;
  readonly description: string;
}

/** The tool whose page a paired client can pull back by `callId`. */
const SEARCH_TOOL = "shopping_search";

/** The guide read, as its own constant: it is the one route a second tool also takes,
 * and two spellings of one path is a route nobody owns. */
const DOMAIN_GET_ROUTE = { method: "GET", path: "/catalog/domains/:path" } as const;

export const SHOPPING_TOOLS = [
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
    ...DOMAIN_GET_ROUTE,
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
] as const satisfies readonly ShoppingTool[];

/** The seven names, as a literal union — so a table of one-per-tool anything is forced
 * to cover them all rather than quietly covering six. */
export type ShoppingToolName = (typeof SHOPPING_TOOLS)[number]["name"];

/**
 * Registers the seven, reading each one's request artifact off disk as it goes.
 *
 * That read is the ONE exception to "register() opens nothing": seven synchronous
 * `readFileSync`s that return immediately and hold no resource open, exactly as
 * `ensureDataDir`'s `mkdirSync` does. It is deliberately eager — an unreadable artifact
 * is a broken build, and failing loud at load beats a tool whose `parameters` the host
 * has already published by the time anyone finds out.
 */
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
      const called = await callRoute(api, tool, params);
      if (called.kind === "refused") return called.result;
      if (tool.name === SEARCH_TOOL) bufferPage(callId, called.body);
      // VERBATIM, and the advisory rides its own block: the body's keys are the API's
      // contract, so nothing of ours may sit beside them.
      return jsonResult(called.body, ...wiringAdvisoryBlocks(api));
    },
  };
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
