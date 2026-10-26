/**
 * INTEGRATION — ask 1 of the contract's journey over ONE scripted `fetch`: a category
 * found, read, searched, opened, priced and checked for shipping.
 *
 *   shopping_domain_search → shopping_domain_get → shopping_brief_write
 *     → shopping_search → shopping_product_get → shopping_offers → shopping_seller_get
 *
 * SCOPE, deliberately. This is the TOOL CHAIN, not the agent. What the agent SAYS — the
 * naming of a gap, the untestable currency bound — belongs to the skill and to sil-stage.
 * What IS testable, and what this file exists to prove:
 *   - the tools compose into a terminating journey with no extra call and no tool
 *     standing in for another;
 *   - each hop calls exactly its own route, once;
 *   - every product, price, seller and URL the agent can act on came out of a tool
 *     result, never out of anything the plugin invented.
 */

import { describe, it, expect } from "vitest";

import { getTool } from "./helpers/mock-plugin-api.js";
import {
  installRouter,
  ok,
  payloadOf,
  seedTokens,
  useShoppingHarness,
  type Router,
} from "./helpers/shopping-harness.js";
import { contractRequest, contractResponse } from "./helpers/shopping-wire.js";

const DOMAIN =
  "product.food_kitchen.coffee_and_coffee_equipment.coffee_equipment.coffee_grinders.hand_coffee_grinders";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const harness = useShoppingHarness("journey");

/**
 * The scripted wire, in journey order: every route answers with the contract's own
 * example. Nothing else is scripted, so a tool reaching a route it should not reach
 * lands in `other` and fails loudly.
 */
function scriptTheJourney(): Router {
  return installRouter((kind) => {
    if (kind === "domainSearch") return ok(contractResponse("shopping_domain_search"));
    if (kind === "domainGet") return ok(contractResponse("shopping_domain_get"));
    if (kind === "briefWrite") return ok(contractResponse("shopping_brief_write"));
    if (kind === "search") return ok(contractResponse("shopping_search"));
    if (kind === "product") return ok(contractResponse("shopping_product_get"));
    if (kind === "offers") return ok(contractResponse("shopping_offers"));
    if (kind === "sellers") return ok(contractResponse("shopping_seller_get"));
    return ok({});
  });
}

const call = async (
  tool: string,
  params: Record<string, unknown>,
  callId: string,
): Promise<Record<string, unknown>> =>
  payloadOf(await getTool(harness.api, tool).execute(callId, params));

describe("no tool stands in for another, across the whole journey", () => {
  it("`shopping_search` never opens a dossier of its own", async () => {
    // One that pre-fetched the dossier would spend the agent's budget without being asked.
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();
    await call("shopping_search", { brief: "b1", domain: DOMAIN, query: "boots", n: 3 }, "m1");
    expect(router.product).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("`shopping_product_get` never prices — that is `shopping_offers`' route", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();
    await call("shopping_product_get", { ids: ["v1"] }, "m2");
    expect(router.offers).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("`shopping_offers` never reads a seller's terms — that is `shopping_seller_get`'s", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();
    await call("shopping_offers", { brief: "b1", ids: ["v1"] }, "m3");
    expect(router.sellers).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("`shopping_domain_get` reads the guide alone — it never searches the registry", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();
    await call("shopping_domain_get", { path: DOMAIN }, "m6");
    expect(router.domainSearch).toEqual([]);
    expect(router.all).toHaveLength(1);
  });
});
