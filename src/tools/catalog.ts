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
      "Know the buyer: every row sil keeps about them, read once per conversation before"
      + " asking anything, and before any forget.",
  },
  {
    name: "shopping_user_remember",
    method: "POST",
    path: "/user/remember",
    label: "Keep what lasts about the buyer",
    description: "Keep what will matter next time about the buyer, the turn you learn it.",
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
    description: "Write down a buy that spans asks or conversations; no other call needs one.",
  },
  {
    name: "shopping_brief_read",
    method: "POST",
    path: "/briefs/read",
    label: "Read a brief, or list the buyer's briefs",
    description: "Pick a written-down buy up again.",
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
      "Learn how to search a leaf: send the buyer's ask and the specs you are after, and get"
      + " the keys a search takes, those first.",
  },
  {
    name: "shopping_content",
    method: "POST",
    path: "/catalog/content",
    label: "Read what sil holds about it",
    recovery: { not_found: "shopping_domain_search" },
    description: "Teach before you ask: the passages sil holds that bear on what the buyer said.",
  },
  {
    name: "shopping_search",
    method: "POST",
    path: "/catalog/search",
    label: "Search sil's products",
    recovery: { not_found: "shopping_brief_read" },
    description: "Search once on what is settled: product cards in sil's order, to shortlist from.",
  },
  {
    name: "shopping_product_get",
    method: "POST",
    path: "/catalog/product",
    label: "Read shortlisted products whole",
    description: "Read the products the buyer leans to whole, and pick the variants to buy there.",
  },
  {
    name: "shopping_offers",
    method: "POST",
    path: "/catalog/offers",
    label: "Where to buy the picked variants",
    recovery: { not_found: "shopping_brief_read" },
    description: "Where to buy the picked variants: every offer, each with its shop.",
  },
  {
    name: "shopping_seller_get",
    method: "POST",
    path: "/catalog/sellers",
    label: "Read the shops' terms",
    description:
      "The terms of the shops the offers named: delivery, returns, warranty and promotions.",
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
