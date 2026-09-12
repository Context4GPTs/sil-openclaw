/**
 * INTEGRATION — ask 1 of the contract's journey over ONE scripted `fetch`: a cold
 * category read, minted, searched, opened, priced and checked for shipping.
 *
 *   shopping_domain_search (matches: []) → shopping_domain_create → shopping_search
 *     → shopping_product_get → shopping_offers → shopping_seller_get
 *
 * THE READ IS PART OF THE CHAIN. Without it the cold start is an empty shelf straight
 * into a permanent, un-undoable global write, with only the agent's judgement in
 * between; the read is what turns that into a step the wire can witness.
 *
 * SCOPE, deliberately. This is the TOOL CHAIN, not the agent. What the agent SAYS — the
 * mint announcement, the naming of a gap, the untestable currency bound — belongs to the
 * skill and to sil-stage. What IS testable, and what this file exists to prove:
 *   - the tools compose into a terminating journey with no extra call and no tool
 *     standing in for another;
 *   - each hop calls exactly its own route, once — and the registry search and the mint,
 *     which share a PATH, are told apart by their VERB;
 *   - the mint body on the wire is the contract's, `type` and the two marks included and
 *     the retired registry vocabulary nowhere in it;
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

const DOMAIN = "product.sports.winter.ski.boots";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const harness = useShoppingHarness("journey");

/**
 * The scripted wire, in journey order. The registry search answers with the MINT
 * SIGNAL — the registry genuinely holds nothing for this ask — and every other route
 * answers with the contract's own example. Nothing else is scripted, so a tool reaching
 * a route it should not reach lands in `other` and fails loudly.
 */
function scriptTheJourney(): Router {
  return installRouter((kind) => {
    if (kind === "domainSearch") return ok({ status: "ok", matches: [] });
    if (kind === "domains") return ok(contractResponse("shopping_domain_create"));
    if (kind === "domainGet") return ok(contractResponse("shopping_domain_get"));
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

describe("ask 1 — the cold-start journey terminates at one seller's terms", () => {
  it("runs beat 2 → 6, each tool once, ending on a seller that came out of an offer", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();

    // Beat 2 — the read, in the buyer's own words. `matches: []` is a real answer and
    // the one thing that licenses the write below; anything else — a match to adopt, a
    // failed read — ends the cold start here.
    const read = await call("shopping_domain_search", { q: "ski boots" }, "j1");
    expect(read["status"]).toBe("ok");
    expect(read["matches"]).toEqual([]);
    // The write is still un-entered at this point in the journey.
    expect(router.domains).toEqual([]);

    // Beat 2's mint, at the path the agent meant, now that the read named nothing to
    // adopt. (The research that produces `guide` is web work, outside the tool surface.)
    const minted = await call("shopping_domain_create", contractRequest("shopping_domain_create"), "j2");
    expect(minted["status"]).toBe("ok");
    expect(minted["path"]).toBe(DOMAIN);

    // Beat 5 — the same path, searched. Never a shallower or re-spelled one.
    const results = await call(
      "shopping_search",
      {
        domain: DOMAIN,
        query: "ski boots for an advanced skier",
        n: 3,
        specs: [{ key: "mondo_size", op: "eq", value: 27.5 }],
      },
      "j3",
    );
    expect(results["status"]).toBe("ok");
    const products = results["products"] as Record<string, unknown>[];
    const variantIds = products
      .flatMap((p) => p["variants"] as Record<string, unknown>[])
      .map((v) => v["id"] as string);
    expect(variantIds.length).toBeGreaterThan(0);

    // Beat 6 — the dossier, by ids sil minted, then the live prices for the pick.
    const dossier = await call("shopping_product_get", { ids: variantIds }, "j4");
    expect(dossier["status"]).toBe("ok");

    const offers = await call("shopping_offers", { ids: [variantIds[0]] }, "j5");
    const sellerIds = (offers["offers"] as Record<string, unknown>[]).map(
      (o) => o["seller_id"] as string,
    );
    expect(sellerIds.length).toBeGreaterThan(0);

    // Beat 6's last read — whether those sellers ship to the buyer, and on what terms.
    const sellers = await call("shopping_seller_get", { ids: sellerIds }, "j6");
    expect(sellers["status"]).toBe("ok");
    for (const seller of sellers["sellers"] as Record<string, unknown>[]) {
      expect(["serviceable", "not_serviceable", "unknown"]).toContain(seller["ships"]);
    }

    // Each route hit exactly once, and nothing reached an unrouted path.
    expect(router.domainSearch).toHaveLength(1);
    expect(router.domains).toHaveLength(1);
    expect(router.search).toHaveLength(1);
    expect(router.product).toHaveLength(1);
    expect(router.offers).toHaveLength(1);
    expect(router.sellers).toHaveLength(1);
    expect(router.refresh).toEqual([]);
    expect(router.other).toEqual([]);
    expect(router.all).toHaveLength(6);
    // The two `/catalog/domains` calls are ONE read and ONE write, told apart by the
    // verb — never two of either.
    expect(router.domainSearch[0].method).toBe("GET");
    expect(router.domains[0].method).toBe("POST");
  });

  it("the mint body on the wire carries `type` and the marks — and none of the retired keys", async () => {
    // The registry write is where a stale vocabulary would come back, permanently and
    // for every shopper: `data_type`, `level` and `axis` are the shapes the contract
    // replaced, and the plugin forwards what it was handed, so this is the wire's own
    // witness that the agent contract's mint is what left the machine.
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();
    await call("shopping_domain_create", contractRequest("shopping_domain_create"), "t1");
    const body = router.domains[0].body as { specs: Record<string, unknown>[] };
    expect(body).toEqual(contractRequest("shopping_domain_create"));
    for (const spec of body.specs) {
      expect(typeof spec["type"]).toBe("string");
      expect(Object.keys(spec)).not.toContain("data_type");
      expect(Object.keys(spec)).not.toContain("level");
      expect(Object.keys(spec)).not.toContain("axis");
    }
  });

  it("every id, price, seller and URL the agent can act on came out of a tool result", async () => {
    // The rule that outranks the journey: a product, price, seller or buy URL that did
    // not come out of a sil tool call never enters the shortlist. The plugin's half of
    // that is that it invents none of them.
    seedTokens(ACCESS, REFRESH);
    scriptTheJourney();
    const results = await call("shopping_search", { domain: DOMAIN, query: "boots", n: 3 }, "k1");
    const offers = await call("shopping_offers", { ids: ["v1"] }, "k2");
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
  it("`shopping_search` never mints, and never opens a dossier of its own", async () => {
    // A search that auto-minted would hide a permanent global write inside a read; one
    // that pre-fetched the dossier would spend the agent's budget without being asked.
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();
    await call("shopping_search", { domain: DOMAIN, query: "boots", n: 3 }, "m1");
    expect(router.domains).toEqual([]);
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
    await call("shopping_offers", { ids: ["v1"] }, "m3");
    expect(router.sellers).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("`shopping_domain_create` performs NO read of its own — the read is the agent's step", async () => {
    // Read-before-mint is a DISCIPLINE the agent follows across two calls, never a
    // pre-check the mint runs for itself. A mint that silently read first would make the
    // discipline unobservable — the agent could skip it and the chain would look
    // identical — and it would hide a second round trip inside the one call with no undo.
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();
    await call("shopping_domain_create", { path: DOMAIN, guide: "g", specs: [] }, "m4");
    expect(router.domainSearch).toEqual([]);
    expect(router.domainGet).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("`shopping_domain_search` never mints — the read and the write share a path, not a verb", async () => {
    // The more dangerous direction: a read that reached the POST would coin a category
    // as a side effect of looking one up, with no undo and nothing able to detect it.
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();
    await call("shopping_domain_search", { q: "ski boots" }, "m5");
    expect(router.domains).toEqual([]);
    expect(router.domainSearch).toHaveLength(1);
    expect(router.all).toHaveLength(1);
  });

  it("`shopping_domain_get` reads the guide alone — it never searches the registry", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = scriptTheJourney();
    await call("shopping_domain_get", { path: DOMAIN }, "m6");
    expect(router.domainSearch).toEqual([]);
    expect(router.domains).toEqual([]);
    expect(router.all).toHaveLength(1);
  });
});
