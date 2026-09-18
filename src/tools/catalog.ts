/**
 * The eleven `shopping_*` tools, 1:1 with the sil-api catalog, brief and profile routes.
 *
 * A projection on the way back would drop exactly the fields the agent's honesty reading
 * is computed from (`fit`, `unknown`, `variants`, `printed`) while looking healthy, so the
 * body crosses verbatim. A new `registerXTools` group has to be hand-wired into three guards
 * or it silently NARROWS them (CLAUDE.md), which is why all eleven live in one group.
 */

import type { PluginAPI, ToolDefinition } from "openclaw/plugin-sdk";

import { requestSchema } from "../lib/artifacts.js";
import { readConfig } from "../lib/credentials.js";
import { wiringAdvisoryBlocks } from "../lib/host-wiring.js";
import { logSearchResults } from "../lib/search-results-log.js";
import { putSearchResult, type SearchResultPage } from "../lib/search-results-store.js";
import { DOMAIN_GET_ROUTE, callRoute, type ShoppingCall } from "../lib/shopping-call.js";
import { jsonResult } from "../lib/tool-result.js";

interface ShoppingTool extends ShoppingCall {
  readonly label: string;
  readonly description: string;
}

/** The tool whose page a paired client can pull back by `callId`. */
const SEARCH_TOOL = "shopping_search";

export const SHOPPING_TOOLS = [
  {
    name: "shopping_domain_search",
    method: "GET",
    path: "/catalog/domains",
    query: ["q"],
    label: "Read sil's registry for a category",
    description:
      "GATHER, what already stands: read sil's shared registry in the buyer's own words"
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
    recovery: { not_found: "shopping_domain_search" },
    description:
      "GATHER, the category's guide and its two vocabularies: send one standing"
      + " path and get the buying guide, every key the category is bought by as `specs`,"
      + " and the seller terms it is bought with as `seller_specs` — the base every"
      + " category shares (returns, restocking, the shipping terms of a route) plus this"
      + " category's own branch. One read hands you both. Translate the buyer's facts"
      + " through the guide and write each one into the brief as a spec, with their own"
      + " words as its `reason`. Each key states the operators it"
      + " takes, its type, its unit and any closed set of values — send that key and one"
      + " of those operators, never a synonym you coined: a `specs` key goes to"
      + " shopping_search, a `seller_specs` key to shopping_offers. A key marked"
      + " variant_spec identifies a purchasable option (a size, a colour): settle it"
      + " before searching, and expect its values under each product's variants. A key"
      + " marked product_spec tells one product from the next. The root `product` always"
      + " stands and carries the universals every category inherits; a path that does not"
      + " stand answers not_found, and the recovery is to read the registry again in the"
      + " buyer's words.",
  },
  {
    name: "shopping_domain_create",
    method: "POST",
    path: "/catalog/domains",
    label: "Coin a new category in sil's registry",
    // A colliding path means the vocabulary is already there, so search that same path.
    recovery: { already_exists: "shopping_search" },
    description:
      "GATHER's mint, the one permanent global write in sil: coin a NEW category — its"
      + " path, a buying guide from research, and the first keys it is bought by. Two things"
      + " must hold first: a shopping_domain_search read came back `matches: []`, and you have"
      + " read up on the web how the category is bought (never on products). Mark variant_spec"
      + " on a key that identifies a purchasable option, product_spec on one that tells one"
      + " product from the next; the registry derives each key's operators from its type. Coin"
      + " only the keys a PRODUCT is bought by: a category's seller terms are never yours to"
      + " coin — the base is sil's and a branch key is coined by research — and"
      + " shopping_domain_get answers them as `seller_specs`. You inherit every ancestor's key"
      + " and may not rename one: re-declare one only to change its configuration for your"
      + " subtree — its unit, its allowed values, its variant or product mark — and it wins"
      + " below this path, converting nothing. Re-declared with nothing the ancestor does not"
      + " already say, it is not coined again: the mint answers ok and reports it"
      + " `inherited: true`, so you filter on it without having minted it. An existing path is"
      + " refused and nothing is written: the vocabulary is already there, so search that same"
      + " path; never coin a near-path variant to route around it, and never call this to"
      + " change one that exists. Every sil shopper sees what you write and nothing can undo"
      + " it.",
  },
  {
    name: "shopping_brief_create",
    method: "POST",
    path: "/briefs/create",
    label: "Open the session's brief",
    description:
      "GATHER, once per SESSION: open the one brief this conversation works from — across"
      + " every category the buyer asks about, never one per category — and hold the `id`"
      + " it answers for the rest of the session, because every search and every offers"
      + " call names it. A new chat opens its own AFTER shopping_brief_read has shown what"
      + " is on file: carry every spec an earlier brief still holds true into this one, then"
      + " name that carry in the first shopping_brief_edit `decision`. `title` names the job"
      + " in a few words. `narrative` is what the"
      + " buyer is after in their own terms, and a want no spec can carry lives there. An"
      + " optional first `domain` with `specs` writes what they have already said: a"
      + " category path carries that category's product specs, `seller` carries the seller"
      + " specs, and each spec is a key and an operator shopping_domain_get listed whose"
      + " `reason` quotes the buyer VERBATIM — their own words, or the measurement the"
      + " guide converted — never a paraphrase and never a want they did not state. On"
      + " anything worn, the `gender` sil_whoami holds is a product spec in the registry's"
      + " own spelling — male → `gender eq mens`, female → `gender eq womens` — asked once"
      + " where the profile answers none or `other`, and never inferred. Everything after"
      + " this is shopping_brief_edit.",
  },
  {
    name: "shopping_brief_edit",
    method: "POST",
    path: "/briefs/edit",
    label: "Write a want or a decision into the brief",
    // The id is the only thing a 404 can be about here, and the bare read lists what is.
    recovery: { not_found: "shopping_brief_read" },
    description:
      "GATHER and DECIDE, the write: put every want the buyer states into the brief BEFORE"
      + " the next search, with `reason` quoting their own words VERBATIM — never a"
      + " paraphrase, never a want they did not state. A want that reaches"
      + " no brief is a want sil never sees. A MEASUREMENT is never the spec: 27.2 cm is"
      + " the buyer's, and the spec is the size the category is sold in —"
      + " `mondo_size in [27, 27.5]`, with that measurement as its `reason`."
      + " One write per `domain`: a category path carries"
      + " that category's product specs, `price` among them, and `seller` carries the"
      + " seller specs, which belong to the whole brief. `specs` REPLACE every spec on the"
      + " keys they name — a range is the two rows on its key — `remove` names the keys"
      + " whose specs go, and `narrative` replaces the whole narrative. When the buyer"
      + " changes their mind — and only then — send the new spec together with `decision`:"
      + " one sentence ABOUT them, never in their voice, saying what they changed and"
      + " why. A new want's words are its spec's `reason`, never a `decision`, and never a"
      + " log of what you have just written down."
      + " Send `status: \"closed\"` when the job is over. An"
      + " invalid_request names the key and shows a spec on it that passes — fix that row"
      + " and send it again, and never give the want up. A brief id that is not the"
      + " buyer's answers not_found; shopping_brief_read with no `id` lists their briefs.",
  },
  {
    name: "shopping_brief_read",
    method: "POST",
    path: "/briefs/read",
    label: "Read the brief, or list the buyer's briefs",
    description:
      "OPEN, the first read of a new chat: with no `id` it answers the buyer's briefs,"
      + " newest first, each with its title, its domains and when it was last written."
      + " Call it with sil_whoami before you ask the buyer anything, so a job already"
      + " under way is continued rather than interviewed a second time. With an `id` it"
      + " answers that brief whole: the title, the narrative, every spec under the domain"
      + " it sits on (`seller` for the seller specs), and the decisions already taken with"
      + " the time of each. What comes back is a READ: it says what the buyer has already"
      + " settled so you ask none of it again, and the specs still true are carried into"
      + " this session's own brief with shopping_brief_create — the search runs on that"
      + " one, never on an earlier session's. New wants go in through shopping_brief_edit.",
  },
  {
    name: "shopping_profile_edit",
    method: "POST",
    path: "/profile/edit",
    label: "Write what is true of the buyer",
    description:
      "GATHER, the person rather than the job: write what is true of the buyer whatever"
      + " they are buying, the moment they say it and BEFORE the next search — only what"
      + " they stated UNAMBIGUOUSLY about themselves. A phrase that could mean two things"
      + " (\"wide forefoot and bit short\" — the foot, or the buyer?) is asked about, never"
      + " written here, because a lasting fact written wrong follows them into every"
      + " category. Every `name` is lower snake_case: `foot_length`, never \"foot length\"."
      + " A"
      + " `measurements` entry is a number with its `unit`, or a size exactly as it is"
      + " printed; a `preferences` entry is a lasting taste in the buyer's own words."
      + " An entry replaces the one of the same `name`, and `remove` names the entries"
      + " that stopped being true. sil_whoami reads all of it back, so a fact written here"
      + " is one you never ask for again. What belongs to THIS job — a budget, a size for"
      + " these boots — is the brief's, through shopping_brief_edit: a measurement is the"
      + " buyer's, and the spec the category's guide turns it into carries that"
      + " measurement as its `reason`.",
  },
  {
    name: SEARCH_TOOL,
    method: "POST",
    path: "/catalog/search",
    label: "Search sil in one settled category",
    // A 404 here is the `brief` id and nothing else: a domain that does not stand is
    // refused as `invalid_request`, naming the path.
    recovery: { not_found: "shopping_brief_read" },
    description:
      "FIND: the products that fit the brief, in one settled category. Before the FIRST call"
      + " the brief holds a spec for everything the guide says it is bought on — from"
      + " the profile, or ONE question. Send `brief` (the session's brief id) on EVERY call,"
      + " the domain path, and `query` — the category as a shop lists it and the numbers"
      + " that pick the product, never a sentence; a budget, a market, a unit, a standard's"
      + " name, \"in stock\" and \"online\" are specs, and cost most of the offers."
      + " `n` counts VARIANTS — one size, one option — max 10. `specs`: every product"
      + " spec the brief holds for this category, all of them and UNCHANGED — never a looser"
      + " bound, never one it does not hold — money a decimal STRING (`\"300\"`, never 300)."
      + " The brief's `seller` specs ride on shopping_offers, never on the search. Keep the"
      + " server's order, never re-rank; quote each variant's OWN `price` with its size."
      + " `fit`"
      + " answers the ask key by key: the value sil verified, or \"unknown\" where it holds"
      + " none — a gap to dig into with shopping_product_get, never a failed one."
      + " `host` is the shop; `printed` is that page's own pairs, never verified —"
      + " say \"the page says\". A `variants` entry with no option"
      + " values is a listing whose sizes sil has not read: say so — it prices like any"
      + " other once it is the pick. At most 4 calls per CATEGORY before you ask. Talk fit"
      + " here: the pick is priced by shopping_offers, never the shortlist.",
  },
  {
    name: "shopping_product_get",
    method: "POST",
    path: "/catalog/product",
    label: "Read the whole dossier on a shortlisted variant",
    description:
      "FIND's dossier: send 1–10 variant ids from a shopping_search answer and get"
      + " the whole of what sil holds for each — the title, the maker, the page's own"
      + " description, the images, every key sil holds for it (not only the ones you"
      + " asked about), and `sources` naming which site each reading came from and when."
      + " This is where a key the search answered \"unknown\" is dug out. A variant with no"
      + " option values is a listing whose sizes sil has not read, and its id opens here"
      + " like any other: the answer carries that page whole, so the sizes it prints are"
      + " the page's own words — say the size is unread, never that it is in stock."
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
    label: "List who sells a variant, at what price and on what terms",
    // Same as the search: the only 404 this route answers is a brief that is not
    // the buyer's.
    recovery: { not_found: "shopping_brief_read" },
    description:
      "PRICE: who sells the pick, at what price, on what terms — call it for the variant"
      + " the buyer settled on or asks about, never for a shortlist."
      + " Send `brief` (the session's brief id) on EVERY call, 1–10 variant ids, and"
      + " `seller_specs`:"
      + " the brief's `seller` specs, all of them, UNCHANGED, and nothing else — a brief"
      + " holding none sends none, and a `country` the brief lacks is never yours"
      + " to add. A variant with no option values is a listing whose sizes sil"
      + " has not read: send its id like any other, priced as its page prints —"
      + " say the size is unread. One entry per variant per seller, read live: the seller's"
      + " name and id, the price exactly as the page"
      + " prints it, its own currency (sil converts nothing), whether it can be"
      + " bought now, the listing URL, `observed_at` — when sil read it, which"
      + " dates the price — and `seller_fit`. `seller_fit` answers the"
      + " brief's seller specs: `ships` is always"
      + " there — serviceable, not_serviceable or unknown for that address — and each"
      + " requested key carries that seller's value if sil holds one. `unknown` is an"
      + " ordinary answer that keeps the offer: say sil could not confirm shipping and"
      + " hand over the listing. A requested key absent from `seller_fit` is a term"
      + " sil has not read, never a term the seller lacks. Several offers on one variant"
      + " ARE the price spread, and the spread is the answer — never one best. One"
      + " seller's whole terms are shopping_seller_get's.",
  },
  {
    name: "shopping_seller_get",
    method: "POST",
    path: "/catalog/sellers",
    label: "Read one seller's whole terms",
    description:
      "PRICE, one seller's WHOLE terms: send 1–10 seller ids from shopping_offers, and"
      + " nothing else. Each seller comes back with its name, host and country, `specs` —"
      + " every seller key sil holds a value for, base and branch, as the dossier's `specs`"
      + " are a product's — and `ships`, which answers for the buyer's default address:"
      + " serviceable (sil read a route covering it), not_serviceable (sil read this"
      + " seller's policy and it excludes it), or unknown (sil has read nothing about this"
      + " seller). `unknown` is an ordinary answer that keeps the seller — say sil could not"
      + " confirm shipping, and hand the buyer the listing; an empty `specs` is the same"
      + " answer about its terms. Where sil has read them, `shipping` carries the routes"
      + " with their cost, free-over threshold and days, and `returns` the window and any"
      + " restocking fee; a term the page never stated is simply absent, which is never zero"
      + " and never free. A `policy_url` of null means the terms were read off a product"
      + " page and sil holds no policy page. This is the details read: whether an offer"
      + " meets the buyer's own seller rows is `seller_fit` on that offer, from"
      + " shopping_offers.",
  },
] as const satisfies readonly ShoppingTool[];

/** The eleven names, as a literal union — so a table of one-per-tool anything is forced
 * to cover them all rather than quietly covering ten. */
export type ShoppingToolName = (typeof SHOPPING_TOOLS)[number]["name"];

/**
 * Registers the eleven, reading each one's request artifact off disk as it goes.
 *
 * That read is the ONE exception to "register() opens nothing": eleven synchronous
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
      if (called.kind === "refused") {
        if (tool.name === SEARCH_TOOL) skipped(api, callId, `refused:${called.status}`);
        return called.result;
      }
      if (tool.name === SEARCH_TOOL) bufferPage(api, callId, called.body);
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
function bufferPage(api: PluginAPI, callId: string, body: Record<string, unknown>): void {
  const principal = readConfig()?.user?.id;
  if (principal === undefined) {
    skipped(api, callId, "no_principal");
    return;
  }
  if (!Array.isArray(body["products"])) {
    skipped(api, callId, "no_products");
    return;
  }
  putSearchResult(callId, body as SearchResultPage, principal);
}

/** Why this `callId` will resolve nothing, logged where the decision is made. The pull
 * says only `not_found` — deliberately — so this line is the whole of an operator's
 * account of a search a client could not render. */
function skipped(api: PluginAPI, callId: string, reason: string): void {
  logSearchResults(api, "info", "skipped", { callId, reason });
}
