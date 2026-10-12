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

describe("ask 1 — the journey terminates at one seller's terms", () => {
  it("runs GATHER → PRICE, each tool once, ending on a seller that came out of an offer", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();

    // GATHER — the read, in the buyer's own words, then the closest node's document.
    const read = await call("shopping_domain_search", { q: "boot liner for my Volvo XC40" }, "j1");
    const [closest] = read["matches"] as Record<string, unknown>[];
    expect(closest["path"]).toBe(DOMAIN);
    const doc = await call("shopping_domain_get", { path: closest["path"] }, "j2");
    expect(doc["status"]).toBe("ok");

    // GATHER's brief — ONE per session, opened before the first search, because both
    // priced steps name it. The id it answers is what the rest of the chain carries.
    const opened = await call(
      "shopping_brief_write",
      contractRequest("shopping_brief_write"),
      "j3",
    );
    expect(opened["status"]).toBe("ok");
    const brief = opened["id"] as string;
    expect(typeof brief).toBe("string");

    // 1 FIND — the same path, searched, under that brief. Never a shallower or
    // re-spelled path, and never a second brief.
    const results = await call(
      "shopping_search",
      {
        brief,
        domain: DOMAIN,
        query: "ski boots 27.5 flex 110",
        n: 3,
        specs: [{ key: "mondo_size", op: "eq", value: 27.5 }],
      },
      "j4",
    );
    expect(results["status"]).toBe("ok");
    const products = results["products"] as Record<string, unknown>[];
    const variantIds = products
      .flatMap((p) => p["variants"] as Record<string, unknown>[])
      .map((v) => v["id"] as string);
    expect(variantIds.length).toBeGreaterThan(0);

    // The dossier, by ids sil minted, then 2 PRICE — the live prices for the pick,
    // under the SAME brief id the search carried.
    const dossier = await call("shopping_product_get", { ids: variantIds }, "j5");
    expect(dossier["status"]).toBe("ok");

    const offers = await call("shopping_offers", { brief, ids: [variantIds[0]] }, "j6");
    const sellerIds = (offers["offers"] as Record<string, unknown>[]).map(
      (o) => o["seller_id"] as string,
    );
    expect(sellerIds.length).toBeGreaterThan(0);

    // PRICE's last read — whether those sellers ship to the buyer, and on what terms.
    const sellers = await call("shopping_seller_get", { ids: sellerIds }, "j7");
    expect(sellers["status"]).toBe("ok");
    for (const seller of sellers["sellers"] as Record<string, unknown>[]) {
      expect(["serviceable", "not_serviceable", "unknown"]).toContain(seller["ships"]);
    }

    // ONE brief, named by both priced legs — the link sil records the calls against.
    expect(router.search[0].body).toMatchObject({ brief });
    expect(router.offers[0].body).toMatchObject({ brief });
    expect(router.briefWrite).toHaveLength(1);

    // Each route hit exactly once, and nothing reached an unrouted path.
    expect(router.domainSearch).toHaveLength(1);
    expect(router.domainGet).toHaveLength(1);
    expect(router.search).toHaveLength(1);
    expect(router.product).toHaveLength(1);
    expect(router.offers).toHaveLength(1);
    expect(router.sellers).toHaveLength(1);
    expect(router.refresh).toEqual([]);
    expect(router.other).toEqual([]);
    expect(router.all).toHaveLength(7);
  });

  it("every id, price, seller and URL the agent can act on came out of a tool result", async () => {
    // The rule that outranks the journey: a product, price, seller or buy URL that did
    // not come out of a sil tool call never enters the shortlist. The plugin's half of
    // that is that it invents none of them.
    seedTokens(ACCESS, REFRESH);
    scriptTheJourney();
    const results = await call(
      "shopping_search",
      { brief: "b1", domain: DOMAIN, query: "boots", n: 3 },
      "k1",
    );
    const offers = await call("shopping_offers", { brief: "b1", ids: ["v1"] }, "k2");
    const sellers = await call("shopping_seller_get", { ids: ["s1"] }, "k3");

    const wireStrings = new Set<string>();
    const walk = (value: unknown): void => {
      if (typeof value === "string") wireStrings.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(contractResponse("shopping_search"));
    walk(contractResponse("shopping_offers"));
    walk(contractResponse("shopping_seller_get"));

    const presented: string[] = [];
    for (const product of results["products"] as Record<string, unknown>[]) {
      presented.push(product["id"] as string, product["title"] as string);
      for (const variant of product["variants"] as Record<string, unknown>[]) {
        presented.push(variant["id"] as string);
      }
    }
    for (const offer of offers["offers"] as Record<string, string>[]) {
      presented.push(offer["url"], offer["price"], offer["seller_name"]);
    }
    for (const seller of sellers["sellers"] as Record<string, string>[]) {
      presented.push(seller["host"], seller["name"]);
    }
    expect(presented.filter((s) => !wireStrings.has(s))).toEqual([]);
    expect(presented.length).toBeGreaterThan(10);
  });
});

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
