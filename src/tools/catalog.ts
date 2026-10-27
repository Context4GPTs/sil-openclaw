/**
 * The twelve `shopping_*` tools, 1:1 with the sil-api user, brief and catalog routes.
 * Bodies cross verbatim: sil's answer is the agent's answer, and the screen's.
 */

import type { PluginAPI, ToolDefinition } from "openclaw/plugin-sdk/plugin-entry";

import { keepAnswer } from "../lib/answers.js";
import { requestSchema } from "../lib/artifacts.js";
import { readHostVersion, wiringAdvisoryBlocks } from "../lib/host-wiring.js";
import { DOMAIN_GET_ROUTE, callRoute, type ShoppingCall } from "../lib/shopping-call.js";
import type { Caller } from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";
import { readInstalledVersion } from "../lib/version-advisory.js";

interface ShoppingTool extends ShoppingCall {
  readonly label: string;
  readonly description: string;
}

export const SHOPPING_TOOLS = [
  {
    name: "shopping_user_read",
    method: "POST",
    path: "/user/read",
    label: "Read what sil keeps about the buyer",
    description:
      "Know the buyer: everything kept about them is here, never in your own memory files."
      + " Read once per conversation before asking anything, when they ask what you keep, and"
      + " before a forget. A price row is `value` with `unit` its currency; money is in the"
      + " minor unit: €130 is 13000.",
  },
  {
    name: "shopping_user_remember",
    method: "POST",
    path: "/user/remember",
    label: "Keep what lasts about the buyer",
    description:
      "Keep what will matter next time about the buyer (how they use it, what they value, a"
      + " cap for this kind of thing, a measurement) in the turn you learn it, before any"
      + " search, and say so with the undo. This is the only place the buyer is kept: \"remember"
      + " this\" means this call, not a note or memory file. A one-off wish for this buy rides on"
      + " its calls instead. Each row's `place` is the `name` of the kind you are shopping, from"
      + " the domain read. A price is `value` with `unit` its currency; money is in the minor"
      + " unit: €130 is 13000.",
  },
  {
    name: "shopping_user_forget",
    method: "POST",
    path: "/user/forget",
    label: "Erase what sil keeps, on the buyer's word",
    description: "Erase what sil keeps, only after saying what goes and the buyer saying yes.",
  },
  {
    name: "shopping_brief_write",
    method: "POST",
    path: "/briefs/write",
    label: "Open or update a brief",
    recovery: { not_found: "shopping_brief_read" },
    description:
      "Write down a buy that spans asks or conversations; no other call needs one. Spec rows"
      + " are `{ spec, op, value }`, a money row `{ spec: \"price\", range: { min?, max?, currency"
      + " } }`; money is in the minor unit: €130 is 13000.",
  },
  {
    name: "shopping_brief_read",
    method: "POST",
    path: "/briefs/read",
    label: "Read a brief, or list the buyer's briefs",
    description: "Pick a written-down buy up again; money is in the minor unit: €130 is 13000.",
  },
  {
    name: "shopping_domain_search",
    method: "GET",
    path: "/catalog/domains",
    query: ["query"],
    label: "Place the thing",
    description: "Place the thing the buyer named: the leaves sil holds for it.",
  },
  {
    name: "shopping_domain_get",
    ...DOMAIN_GET_ROUTE,
    label: "Read how to search a place",
    recovery: { not_found: "shopping_domain_search" },
    description:
      "Learn what decides a leaf or the kind above its leaves, and how to search it: send"
      + " `path`, the buyer's words in English as `query`, and a word per spec you are after."
      + " Back come the place's `name` and one line per spec (`spec`, `type`, `unit`, `values`,"
      + " `operators`), and a spec marked `decides` carries its `why`, to teach and ask from."
      + " The first `reached` lines answer the buyer's words; when `reached` is every line on"
      + " the page and `next_page` is there, more of what they asked for is past it. Send `page`"
      + " = `next_page` then, and when a spec you need is not on the page.",
  },
  {
    name: "shopping_content",
    method: "POST",
    path: "/catalog/content",
    label: "Read what sil holds about it",
    recovery: { not_found: "shopping_domain_search" },
    description:
      "Teach before you ask: the passages sil holds on a place that bear on `about`. Send the"
      + " buyer's own taste words as `about` (clarity, texture, quiet), then turn the passage"
      + " into specs from the domain read or into the question that decides. A question's why"
      + " comes from here or from a spec's `why`.",
  },
  {
    name: "shopping_search",
    method: "POST",
    path: "/catalog/search",
    label: "Search sil's products",
    recovery: { not_found: "shopping_brief_read" },
    description:
      "Search once per settled ask: `specs` `{ spec, op, value }` from the domain read and"
      + " `price` the range `{ min?, max?, currency }`, each a want the buyer said or sil keeps;"
      + " money is in the minor unit: €130 is 13000. `query` holds only the buyer's own words"
      + " for what no spec holds, and no brand, model or product they did not name: good `query:"
      + " \"clarity\"` when no spec holds clarity, bad `query: \"Eureka Mignon\"` when the buyer"
      + " never said it. Back come `asked` numbered, `search_stats` to explain the shortlist,"
      + " and the closest cards with `holds`, `misses` and `unknown` as ask numbers,"
      + " `price_range` and `variants`, one `recommended`. When few fit or many are unknown,"
      + " tell the buyer what came back and ask the one question that would change it, or ask"
      + " before relaxing a want, rather than searching again in other words.",
  },
  {
    name: "shopping_product_get",
    method: "POST",
    path: "/catalog/product",
    label: "Read shortlisted products whole",
    description:
      "Read the products the buyer leans to whole: values once, reviews, every picture, and"
      + " each variant with what sets it apart and its `starting_from`. Pick the variants to buy"
      + " here; money is in the minor unit: €130 is 13000.",
  },
  {
    name: "shopping_offers",
    method: "POST",
    path: "/catalog/offers",
    label: "Where to buy the picked variants",
    recovery: { not_found: "shopping_brief_read" },
    description:
      "Where to buy: variant ids from `shopping_product_get`, never product ids, and"
      + " `ship_to`, one of the buyer's addresses by name (the default when absent). Every"
      + " offer, shops shipping there first, each with its shop, whether it `ships`, `price`,"
      + " `was`, `pack` or `plan`, and its stock; nothing marks a best. Money is in the minor"
      + " unit: €130 is 13000. Send `page` = `next_page` only when a shop the buyer needs may be"
      + " past it. Delivery and returns come from `shopping_seller_get`.",
  },
  {
    name: "shopping_seller_get",
    method: "POST",
    path: "/catalog/sellers",
    label: "Read the shops' terms",
    description:
      "The terms of the shops the offers named, delivered to `ship_to` (the default address"
      + " when absent): delivery cost, `free_over` and days, returns, warranty and promotions;"
      + " money is in the minor unit: €130 is 13000. Quote a promotion and ask whether they"
      + " qualify; a reduced price only from its `discount`, on their yes. Send `page` ="
      + " `next_page` only when a shop the buyer needs may be past it.",
  },
] as const satisfies readonly ShoppingTool[];

/** The twelve names, as a literal union, so a one-per-tool table must cover them all. */
export type ShoppingToolName = (typeof SHOPPING_TOOLS)[number]["name"];

/**
 * Registers the twelve, reading each request artifact off disk eagerly: an unreadable
 * artifact is a broken build and should fail at load. Each tool is a factory because the
 * host hands the conversation and model only to a factory, once per agent run.
 */
export function registerCatalogTools(api: PluginAPI): void {
  const pluginVersion = readInstalledVersion();
  const openclawVersion = readHostVersion(api) ?? undefined;
  for (const tool of SHOPPING_TOOLS) {
    const parameters = requestSchema(tool.name);
    api.registerTool(
      (ctx) => defineTool(api, tool, parameters, runOf(ctx, pluginVersion, openclawVersion)),
      { name: tool.name },
    );
  }
}

/** Who is calling, as the host hands it to a tool factory once per agent run. */
export function runOf(
  ctx: { activeModel?: { provider?: string; modelId?: string }; sessionId?: string },
  pluginVersion: string,
  openclawVersion: string | undefined,
): Omit<Caller, "toolCallId"> {
  const { provider, modelId } = ctx.activeModel ?? {};
  return {
    pluginVersion,
    ...(openclawVersion !== undefined ? { openclawVersion } : {}),
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    ...(provider && modelId ? { model: `${provider}/${modelId}` } : {}),
  };
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
      if (called.kind === "refused") return jsonResult(called.body);
      keepAnswer(api, callId, run.sessionId, called.body);
      // The advisory rides its own block: nothing of ours may sit beside the body's keys.
      return jsonResult(called.body, ...wiringAdvisoryBlocks(api));
    },
  };
}
