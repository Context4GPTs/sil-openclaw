/**
 * INTEGRATION — `shopping_offers` on the wire: the beat-6 prices, read live.
 *
 * Several offers on one variant ARE the price spread, and the spread is the answer. The
 * assertion that matters here is that every one of them crosses intact, each still
 * carrying its own currency and its own `observed_at` — a collapse to a "best" offer, or
 * a lost timestamp, turns a dated quote into an undated claim.
 */

import { describe, it, expect } from "vitest";

import { getApiUrl } from "../lib/config.js";
import { getTool } from "./helpers/mock-plugin-api.js";
import {
  bearerToken,
  installRouter,
  ok,
  payloadOf,
  seedTokens,
  useShoppingHarness,
} from "./helpers/shopping-harness.js";
import { contractResponse } from "./helpers/shopping-wire.js";

const TOOL = "shopping_offers";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const harness = useShoppingHarness("offers");

const run = async (params: Record<string, unknown> = { ids: ["v1"] }) =>
  payloadOf(await getTool(harness.api, TOOL).execute("call-1", params));

describe("shopping_offers — one route, one request", () => {
  it("POSTs `/catalog/offers` with `{ ids }` and a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "offers" ? ok(contractResponse(TOOL)) : ok({})));
    await run();
    expect(router.offers).toHaveLength(1);
    const [req] = router.offers;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${getApiUrl()}/catalog/offers`);
    expect(req.body).toEqual({ ids: ["v1"] });
    expect(bearerToken(req)).toBe(ACCESS);
    expect(router.product).toEqual([]);
    expect(router.other).toEqual([]);
  });
});

describe("shopping_offers — what the answer means", () => {
  it("the contract's own 200 arrives verbatim — every seller, price, currency and date", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok(contractResponse(TOOL)));
    const payload = await run();
    expect(payload).toEqual(contractResponse(TOOL));
    const offers = payload["offers"] as Record<string, unknown>[];
    // The spread, not a winner: two sellers for one variant, each dated and priced.
    expect(offers.length).toBeGreaterThan(1);
    expect(new Set(offers.map((o) => o["seller_id"])).size).toBe(offers.length);
    for (const offer of offers) {
      expect(offer["currency"]).toEqual(expect.any(String));
      expect(offer["observed_at"]).toEqual(expect.any(String));
    }
  });
});
