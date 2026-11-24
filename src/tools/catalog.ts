/**
 * The twelve `shopping_*` tools, 1:1 with the sil-api user, brief and catalog routes.
 * Bodies cross verbatim: sil's answer is the agent's answer, and the screen's.
 */

import { randomUUID } from "node:crypto";

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
      + " before a forget. What it answers is never asked again; say a row when you use it. A"
      + " price row is `value` with `unit` its currency; money is in the minor unit: €130 is"
      + " 13000.",
  },
  {
    name: "shopping_user_remember",
    method: "POST",
    path: "/user/remember",
    label: "Keep what lasts about the buyer",
    description:
      "Keep what will matter next time about the buyer (how they use it, what they value, a"
      + " cap for this kind of thing, a measurement) in the turn you learn it, before any"
      + " search. This is the only place the buyer is kept: \"remember this\" means this call,"
      + " not a note or memory file. A one-off wish for this buy rides on its calls instead."
      + " Send whole rows: `{ rows: [{ kind: \"measurement\", what: \"foot length\", value:"
      + " 27.2, unit: \"cm\", place: \"Running shoes\", gives_back: \"shoes are searched in"
      + " their size without asking\", source: \"told\" }] }`. The other kinds, same row:"
      + " `kind: \"preference\"` with `subject`, `op`, `value` and `reason` (a price in the"
      + " minor unit with `unit` its currency: €130 is 13000); `kind: \"memory\"` with `text`;"
      + " `kind: \"purchase\"` with `product` and `when`. `place` is the `name` of the kind you"
      + " are shopping, from the domain read; `source` is \"agent\" for what you inferred. How"
      + " they use it, in their words, is a memory; a taste or a cap is a preference, always"
      + " with `subject`, `op` and `value`. Once it answers `ok`, say what you kept, what it is"
      + " for next time (its `gives_back`), and that \"forget that\" undoes it.",
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
    description:
      "Place the thing the buyer named: the leaves sil holds for it. Search the leaf; while the"
      + " buyer has not chosen between leaves of one kind, read and search the kind above them.",
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
      "Read sil's guides before you teach or ask: the passages sil holds on a place that bear"
      + " on `about`. Send the buyer's own words as `about` (clarity, texture, quiet). Each"
      + " passage carries its `title`, `author`, `publish_date` and `url`: when you teach from"
      + " one, name it by its `title` or `author`, never \"the guide\" alone, and its date when"
      + " it has one. A taste the buyer gives (fruity, grippy) goes through here before you"
      + " search: the passage gives the route; a taste is no spec. A question's why comes from"
      + " here or from a spec's `why`. Nothing held: say so, never fill it from the web.",
  },
  {
    name: "shopping_search",
    method: "POST",
    path: "/catalog/search",
    label: "Search sil's products",
    recovery: { not_found: "shopping_brief_read" },
    description:
      "Search once per settled ask. On a considered buy, first say the route you think best"
      + " and why, then the search, part by part, each with its why; send exactly what you said."
      + " `domain` is the leaf, or the kind above while the buyer has not chosen between its"
      + " leaves: your own route is a lean until they take it, so the search still covers the"
      + " other kind. `specs` `{ spec, op, value }` from the domain read, each a want the buyer"
      + " said or sil keeps and none of your own. Send only what must hold (what it is for, a"
      + " size, a hard cap): a taste or a soft want (fruity, quiet) is no spec, it pushes down"
      + " every product that says nothing about it. A brand they named is the `brand` spec on"
      + " every kind, never the `query`; on a kind, `leaf` with `in` or `nin` rules a leaf in or"
      + " out. `price` is the range `{ min?, max?, currency }`;"
      + " money is in the minor unit: €130 is 13000; \"around\" a sum is searched a fifth wider,"
      + " and you say so. `query` holds only the buyer's"
      + " own word for a name or a model: good `query: \"Speedgoat\"` when they named it, bad"
      + " `query: \"light grippy trail shoe\"`, which is wants, not a name. `n`: 8 to weigh a"
      + " kind or show a range, 1 to 3 for a product they named. Back come `asked` numbered,"
      + " `search_stats`, and the closest cards with `holds`, `misses` and `unknown` as ask"
      + " numbers, `price_range` and `variants`, each with its own `price_range`, one"
      + " `recommended`. After it, say what came back: how wide you looked, by sil's own counts"
      + " (`search_stats`: the products and shops sil weighed in this kind, never a brand's"
      + " count; `with_all_specs` is how many sil could test on every ask, not how many pass; a"
      + " page of eight is the eight you asked for). When few fit or many are unknown, say what came"
      + " back and ask the one question that would change it, or ask before relaxing a want,"
      + " rather than searching again in other words.",
  },
  {
    name: "shopping_product_get",
    method: "POST",
    path: "/catalog/product",
    label: "Read shortlisted products whole",
    description:
      "Read the products the buyer leans to whole: values once, reviews, every picture, and"
      + " each variant with what sets it apart and its `price_range`, cheapest to dearest offer."
      + " Pick the variant here, then read its offers before you name the pick; money is in the"
      + " minor unit: €130 is 13000.",
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
      + " offer, shops shipping there first, each with its shop's `name`, whether it `ships`, its"
      + " `delivery` there, `returns_days` and own `promotions`, then `price`, `was`, `pack` or"
      + " `plan`, its stock, its `url` and `read_on`, the day sil read it; nothing marks a best."
      + " Tell the buyer where to buy and why there, with one link, the offer's `url`; when"
      + " they choose, hand over in that turn, even if you linked it before. `ships:"
      + " unknown` is sil not having read that shop's delivery: say so, never \"delivers\", and"
      + " never hand over to a shop that does not ship to them. A promotion is its shop's alone:"
      + " quote it on that shop's offers only. A `was`: say it was higher, judge on the price. A"
      + " bundle (`pack.with`) is one offer; a `plan` price is the plan's. Money is in the minor"
      + " unit: €130 is 13000. Send `page` = `next_page` only when a shop the buyer needs may be"
      + " past it. Warranty, policies, reviews and other terms come from `shopping_seller_get`.",
  },
  {
    name: "shopping_seller_get",
    method: "POST",
    path: "/catalog/sellers",
    label: "Read the shops' terms",
    description:
      "Every term of the shops the offers named, delivered to `ship_to` (the default address"
      + " when absent): the delivery, returns and promotions the offers carry, and warranty,"
      + " policies, reviews and other terms; money is in the minor unit: €130 is 13000. A"
      + " promotion is its shop's alone: quote it on that shop's offers only. Ask whether they"
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

/** sil's record reads a `none/` model as no agent turn — `tools.invoke` runs a tool outside one,
 * handing over no model and, at most, the host's own session key (`main`), never a turn's. */
const NO_TURN_MODEL = "none/sil-openclaw";

export interface Run {
  readonly caller: Omit<Caller, "toolCallId">;
  /** The turn's conversation; absent off-turn, so the screen never follows an off-turn call. */
  readonly conversation: string | undefined;
}

/** Who is calling, as the host hands it to a tool factory once per agent run. */
export function runOf(
  ctx: { activeModel?: { provider?: string; modelId?: string }; sessionId?: string },
  pluginVersion: string,
  openclawVersion: string | undefined,
): Run {
  const { provider, modelId } = ctx.activeModel ?? {};
  const model = provider && modelId ? `${provider}/${modelId}` : undefined;
  const conversation = model !== undefined ? ctx.sessionId || undefined : undefined;
  return {
    caller: {
      pluginVersion,
      ...(openclawVersion !== undefined ? { openclawVersion } : {}),
      sessionId: conversation ?? randomUUID(),
      model: model ?? NO_TURN_MODEL,
    },
    conversation,
  };
}

function defineTool(
  api: PluginAPI,
  tool: ShoppingTool,
  parameters: ToolDefinition["parameters"],
  run: Run,
): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters,
    async execute(callId, params) {
      const called = await callRoute(api, tool, params, { ...run.caller, toolCallId: callId });
      if (called.kind === "refused") return jsonResult(called.body);
      keepAnswer(api, callId, run.conversation, called.body);
      // The advisory rides its own block: nothing of ours may sit beside the body's keys.
      return jsonResult(called.body, ...wiringAdvisoryBlocks(api));
    },
  };
}
