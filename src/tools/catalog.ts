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
    label: "Read sil's registry for a domain",
    description:
      "What sil holds, and where it shelves it: read the registry in the buyer's own"
      + " words. `matches` are the domains that match, each with its path and a line on how"
      + " the thing is bought — judge fit on `about`, then take that path verbatim, or"
      + " descend under a broader one, never a sibling of a path that already stands. `tree`"
      + " is every standing path grouped by family: hang a new leaf where a specialist shop"
      + " would shelve it, and see that a setup of several things is several leaves."
      + " `matches: []` is the ONLY answer that licenses shopping_domain_create, and a"
      + " non-ok status is not an empty one. At most two reads per domain, then"
      + " shopping_domain_get for the document and the keys of the path you take.",
  },
  {
    name: "shopping_domain_get",
    ...DOMAIN_GET_ROUTE,
    label: "Read a domain's document and keys",
    recovery: { not_found: "shopping_domain_search" },
    description:
      "sil's own document on how this thing is bought well — read it before you ask the"
      + " buyer anything, and again when a want fits no key: the document GROWS as sil reads"
      + " pages. `guide` is markdown: what it is bought on, what goes wrong and what that"
      + " costs the buyer, what to trust, and what buying it online takes. `name` is its one"
      + " English name and `labels` the market's own words for it — read them, never send"
      + " them. `specs` are the keys it is bought by and `seller_specs` the seller terms it"
      + " is bought with; one read hands you both. Each key's `description` says how that"
      + " key moves the fit: what it decides, what goes wrong at either end, and how a"
      + " buyer's own fact becomes its value. Each key states its type, its operators, its"
      + " unit, any closed set, the `step` a number moves by, and `forms` — what pages"
      + " print, mapped to the value. Send that key and one of those operators, never a"
      + " synonym you coined: `specs` go to shopping_search, `seller_specs` to"
      + " shopping_offers. variant_spec marks the key an option is picked on (a size, a"
      + " colour), answered under each product's variants; product_spec tells one product"
      + " from the next. The root `product` always stands and carries the universals every"
      + " domain inherits; a path that does not stand answers not_found, and the recovery is"
      + " to read the registry again in their words.",
  },
  {
    name: "shopping_domain_create",
    method: "POST",
    path: "/catalog/domains",
    label: "Write a domain sil does not hold",
    // A colliding path means the vocabulary is already there, so search that same path.
    recovery: { already_exists: "shopping_search" },
    description:
      "The FALLBACK, and the one permanent global write in sil: a curated domain already"
      + " carries a document, and this writes one for a domain it does not hold. First: a"
      + " shopping_domain_search read that came back `matches: []`, and research on how the"
      + " domain is bought (never products). Hang the leaf where the `tree` shows its"
      + " family: different keys are a different leaf, another value of the same keys is a"
      + " value. `guide` is markdown every later buyer inherits: what the thing is bought"
      + " on, what goes wrong and what that costs the buyer, and what buying it online takes"
      + " — never \"go to a shop\". Each key's `description` does the same for one key. `name`"
      + " is its one English name, `labels` the words shops print; a spec carries `step`,"
      + " the increment its numbers move by, and `forms`, a printed form mapped to its"
      + " value. Mark variant_spec on the key an option is picked on, product_spec on one"
      + " telling products apart. Coin only keys a PRODUCT is bought by: seller terms are"
      + " never yours to coin, and shopping_domain_get answers them as `seller_specs`. You"
      + " inherit every ancestor's key and may not rename one: re-declare only to change its"
      + " unit, values or mark for your subtree; stating nothing new it answers `inherited:"
      + " true`, and a key naming a standing one binds and answers `bound_from`. A refusal"
      + " names the standing thing and the fix.",
  },
  {
    name: "shopping_brief_create",
    method: "POST",
    path: "/briefs/create",
    label: "Open the session's brief",
    description:
      "Once per SESSION: open the one brief this conversation works from — across"
      + " every domain the buyer asks about, never one per domain — and hold the `id`"
      + " it answers for the rest of the session, because every search and every offers"
      + " call names it. A new chat opens its own AFTER shopping_brief_read has shown what"
      + " is on file: carry every spec an earlier brief still holds true into this one, then"
      + " name that carry in the first shopping_brief_edit `decision`. `title` names the job"
      + " in a few words. `narrative` is the spec of the buy in the buyer's own terms — what"
      + " a good buy looks like for THEM, what it has to do for them, what would make it a"
      + " bad one — and a want no keyed spec can carry lives there and still counts. An"
      + " optional first `domain` with `specs` writes what they have already said: a"
      + " domain path carries that domain's product specs, `seller` carries the seller"
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
      "The brief's write: put every want the buyer states into the brief as it is settled,"
      + " with `reason` quoting their own words VERBATIM — never a"
      + " paraphrase, never a want they did not state. A want that reaches"
      + " no brief is a want the next call drops. A MEASUREMENT is never the spec: 27.2 cm is"
      + " the buyer's, and the spec is the size the thing is sold in —"
      + " `mondo_size in [27, 27.5]`, with that measurement as its `reason`; the key's"
      + " `description` says how one becomes the other."
      + " One write per `domain`: a domain path carries"
      + " that domain's product specs, `price` among them, and `seller` carries the"
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
      "The first read of a new chat: with no `id` it answers the buyer's briefs,"
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
      "The person rather than the job: write what is true of the buyer whatever"
      + " they are buying, the moment they say it and BEFORE the next search — only what"
      + " they stated UNAMBIGUOUSLY about themselves. A phrase that could mean two things"
      + " (\"wide forefoot and bit short\" — the foot, or the buyer?) is asked about, never"
      + " written here, because a lasting fact written wrong follows them into every"
      + " domain. Every `name` is lower snake_case: `foot_length`, never \"foot length\"."
      + " A"
      + " `measurements` entry is a number with its `unit`, or a size exactly as it is"
      + " printed; a `preferences` entry is a lasting taste in the buyer's own words."
      + " An entry replaces the one of the same `name`, and `remove` names the entries"
      + " that stopped being true. sil_whoami reads all of it back, so a fact written here"
      + " is one you never ask for again. What belongs to THIS job — a budget, a size for"
      + " these boots — is the brief's, through shopping_brief_edit: a measurement is the"
      + " buyer's, and the spec the domain's guide turns it into carries that"
      + " measurement as its `reason`.",
  },
  {
    name: SEARCH_TOOL,
    method: "POST",
    path: "/catalog/search",
    label: "Search sil in one settled domain",
    // A 404 here is the `brief` id and nothing else: a domain that does not stand is
    // refused as `invalid_request`, naming the path.
    recovery: { not_found: "shopping_brief_read" },
    description:
      "The products that fit the brief, in one settled domain. Search as often as the job"
      + " needs — a re-worded `query`, a different `n` — it is cheap and it is how you learn"
      + " what is out there. Send `brief` (the session's brief id) on EVERY call,"
      + " the domain path, and `query` — the thing as a shop lists it and the numbers"
      + " that pick the product, never a sentence; a budget, a market, a unit, a standard's"
      + " name, \"in stock\" and \"online\" are specs, and cost most of the offers."
      + " `n` counts VARIANTS — one size, one option — max 10. `specs`: every product"
      + " spec the brief holds for this domain, all of them and UNCHANGED — never a looser"
      + " bound, never one it does not hold — money a decimal STRING (`\"300\"`, never 300)."
      + " The brief's `seller` specs ride on shopping_offers, never on the search. Keep the"
      + " server's order, never re-rank; quote each variant's OWN `price` with its size."
      + " `fit`"
      + " answers the ask key by key: the value sil verified, or \"unknown\" where it holds"
      + " none — a gap to dig into with shopping_product_get, never a failed one."
      + " `host` is the shop; `printed` is that page's own pairs, never verified —"
      + " say \"the page says\". A `variants` entry with no option"
      + " values is a listing whose sizes sil has not read: say so — it prices like any"
      + " other. sil never says what it left out, so a want left off `specs` is one you will"
      + " not know you missed.",
  },
  {
    name: "shopping_product_get",
    method: "POST",
    path: "/catalog/product",
    label: "Read the whole dossier on a shortlisted variant",
    description:
      "The dossier: send 1–10 variant ids from a shopping_search answer and get"
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
      "Who sells it, at what price, on what terms — the only live read of a price."
      + " Worth a call once the buyer is interested in something: pricing a whole shortlist"
      + " buries the fit answer they asked for."
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
      + " ARE the price spread, and the spread is the answer — never one best.",
  },
  {
    name: "shopping_seller_get",
    method: "POST",
    path: "/catalog/sellers",
    label: "Read one seller's whole terms",
    description:
      "One seller's WHOLE terms: send 1–10 seller ids from shopping_offers, and"
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
