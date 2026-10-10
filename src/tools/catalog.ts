/**
 * The twelve `shopping_*` tools, 1:1 with the sil-api user, brief and catalog routes.
 *
 * A projection on the way back would drop exactly the fields the agent's honesty reading
 * is computed from (`fit`, `unknown`, `variants`, `printed`) while looking healthy, so the
 * body crosses verbatim. A new `registerXTools` group has to be hand-wired into three guards
 * or it silently NARROWS them (CLAUDE.md), which is why all twelve live in one group.
 */

import type { PluginAPI, ToolDefinition } from "openclaw/plugin-sdk/plugin-entry";

import { requestSchema } from "../lib/artifacts.js";
import { readConfig } from "../lib/credentials.js";
import { readHostVersion, wiringAdvisoryBlocks } from "../lib/host-wiring.js";
import { logSearchResults } from "../lib/search-results-log.js";
import { putSearchResult, type SearchResultPage } from "../lib/search-results-store.js";
import { DOMAIN_GET_ROUTE, callRoute, type ShoppingCall } from "../lib/shopping-call.js";
import type { Caller } from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";
import { readInstalledVersion } from "../lib/version-advisory.js";

interface ShoppingTool extends ShoppingCall {
  readonly label: string;
  readonly description: string;
}

/** The tool whose page a paired client can pull back by `callId`. */
const SEARCH_TOOL = "shopping_search";

export const SHOPPING_TOOLS = [
  {
    name: "shopping_user_read",
    method: "POST",
    path: "/user/read",
    label: "Read what sil keeps about the buyer",
    description:
      "Every row sil keeps about the buyer — measurements, memories, preferences, purchases"
      + " — each with its `id`, what it gives back and its source. Read it once per"
      + " conversation before asking anything, and before any forget; say a row when you use it.",
  },
  {
    name: "shopping_user_remember",
    method: "POST",
    path: "/user/remember",
    label: "Keep what lasts about the buyer",
    description:
      "Keep what is lasting about the buyer, in the turn that settles it, and say so with"
      + " \"forget that\" as the undo. What changes only this buy rides on the call or in a"
      + " brief, never here.",
  },
  {
    name: "shopping_user_forget",
    method: "POST",
    path: "/user/forget",
    label: "Erase what sil keeps, on the buyer's word",
    description:
      "Erase rows by `ids`, or everything with `all`, only after saying what goes and the"
      + " buyer saying yes. The answer states what went and what sil cannot reach.",
  },
  {
    name: "shopping_brief_write",
    method: "POST",
    path: "/briefs/write",
    label: "Open or update a brief",
    recovery: { not_found: "shopping_brief_read" },
    description:
      "Write the requirements of a buy that spans asks or conversations: a title, a"
      + " narrative in the buyer's terms and specs by domain. Without `id` it opens a brief"
      + " and answers its `id`; with one it updates it.",
  },
  {
    name: "shopping_brief_read",
    method: "POST",
    path: "/briefs/read",
    label: "Read a brief, or list the buyer's briefs",
    description:
      "Pick a buy up again: with an `id` the whole brief, without one the buyer's briefs,"
      + " newest first.",
  },
  {
    name: "shopping_domain_search",
    method: "GET",
    path: "/catalog/domains",
    query: ["q"],
    label: "Find the place for a thing",
    description:
      "Place a thing: send `q`, what it is called, in English, and get the leaves it"
      + " could be, best first. An empty answer means sil does not carry it yet.",
  },
  {
    name: "shopping_domain_get",
    ...DOMAIN_GET_ROUTE,
    label: "Read a place's specs",
    recovery: { not_found: "shopping_domain_search" },
    description:
      "What decides the buy in a leaf, from a path shopping_domain_search answered: the"
      + " keys it is bought by, their operators and units, and the seller terms. Send those"
      + " keys, never a synonym you coined.",
  },
  {
    name: "shopping_content",
    method: "POST",
    path: "/catalog/content",
    label: "Grep what sil holds about it",
    recovery: { not_found: "shopping_domain_search" },
    description:
      "Grep sil's library under a `path` for `q`: its own guides and the sources it read,"
      + " as whole passages quoted verbatim. Empty `passages` means sil holds nothing on it.",
  },
  {
    name: SEARCH_TOOL,
    method: "POST",
    path: "/catalog/search",
    label: "Search sil's products",
    recovery: { not_found: "shopping_brief_read" },
    description:
      "The products that fit, by what decides the buy, in one leaf or the kind above"
      + " several. Search as often as the job needs; `fit` states per key what sil verified"
      + " and what it holds nothing on.",
  },
  {
    name: "shopping_product_get",
    method: "POST",
    path: "/catalog/product",
    label: "Read the whole dossier on a shortlisted variant",
    description:
      "One product whole: send 1–10 variant ids from a search and get everything sil holds"
      + " for each, with the source and date of every reading.",
  },
  {
    name: "shopping_offers",
    method: "POST",
    path: "/catalog/offers",
    label: "List who sells a variant, at what price and on what terms",
    recovery: { not_found: "shopping_brief_read" },
    description:
      "Who sells the picked variants, at what price and on what terms — the only live read"
      + " of a price, and so a price check too.",
  },
  {
    name: "shopping_seller_get",
    method: "POST",
    path: "/catalog/sellers",
    label: "Read one seller's whole terms",
    description:
      "A seller's terms and standing: send 1–10 seller ids from shopping_offers and get"
      + " their shipping, returns and reviews where sil has read them.",
  },
] as const satisfies readonly ShoppingTool[];

/** The twelve names, as a literal union — so a table of one-per-tool anything is forced
 * to cover them all rather than quietly covering ten. */
export type ShoppingToolName = (typeof SHOPPING_TOOLS)[number]["name"];

/**
 * Registers the twelve, reading each one's request artifact off disk as it goes.
 *
 * That read is the ONE exception to "register() opens nothing": twelve synchronous
 * `readFileSync`s that return immediately and hold no resource open, exactly as
 * `ensureDataDir`'s `mkdirSync` does. It is deliberately eager — an unreadable artifact
 * is a broken build, and failing loud at load beats a tool whose `parameters` the host
 * has already published by the time anyone finds out.
 *
 * Each tool is a factory because the host hands the conversation and the model only to a
 * factory, once per agent run; every call that run makes says who is calling.
 */
export function registerCatalogTools(api: PluginAPI): void {
  const pluginVersion = readInstalledVersion();
  const openclawVersion = readHostVersion(api) ?? undefined;
  for (const tool of SHOPPING_TOOLS) {
    const parameters = requestSchema(tool.name);
    api.registerTool(
      (ctx) => {
        const { provider, modelId } = ctx.activeModel ?? {};
        const run = {
          pluginVersion,
          ...(openclawVersion !== undefined ? { openclawVersion } : {}),
          ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
          ...(provider && modelId ? { model: `${provider}/${modelId}` } : {}),
        };
        return defineTool(api, tool, parameters, run);
      },
      { name: tool.name },
    );
  }
}

function defineTool(
  api: PluginAPI,
  tool: ShoppingTool,
  parameters: ToolDefinition["parameters"],
  run: Omit<Caller, "toolCallId">,
): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters,
    async execute(callId, params) {
      const called = await callRoute(api, tool, params, { ...run, toolCallId: callId });
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
