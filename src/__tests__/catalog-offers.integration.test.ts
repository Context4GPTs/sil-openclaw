/**
 * INTEGRATION — `shopping_offers` on the wire: the prices and seller terms, read live.
 *
 * Several offers on one variant ARE the price spread, and the spread is the answer. The
 * assertion that matters here is that every one of them crosses intact, each still
 * carrying its own currency, its own `observed_at` and its own `seller_fit` — a collapse
 * to a "best" offer, a lost timestamp, or a dropped `ships` turns a dated, sourced quote
 * into an undated claim about a seller nobody checked.
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
import { artifactErrors, contractResponse } from "./helpers/shopping-wire.js";

const TOOL = "shopping_offers";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

/** §3.6's ask: the session's brief and the picked variants. sil reads the rest. */
const ASK = { brief: "b1", ids: ["v1"] };

const harness = useShoppingHarness("offers");

const run = async (params: Record<string, unknown> = ASK) =>
  payloadOf(await getTool(harness.api, TOOL).execute("call-1", params));

describe("shopping_offers — one route, one request", () => {
  it("POSTs `/catalog/offers` with the whole ask and a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "offers" ? ok(contractResponse(TOOL)) : ok({})));
    await run();
    expect(router.offers).toHaveLength(1);
    const [req] = router.offers;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${getApiUrl()}/catalog/offers`);
    expect(req.body).toEqual(ASK);
    expect(bearerToken(req)).toBe(ACCESS);
    expect(router.product).toEqual([]);
    expect(router.other).toEqual([]);
  });

  it("the request is the brief and the ids and NOTHING else — seller rows and an address are refused", () => {
    // sil reads the brief's seller rows, its ceiling, the default address and the
    // profile's currency itself. The artifact IS the tool's `parameters`, so a field it
    // re-admitted is one the agent sends and the route never agreed to take.
    const sellerRows = [{ key: "return_window_days", op: "gte", value: 14 }];
    expect(artifactErrors(TOOL, "request", ASK)).toEqual([]);
    expect(artifactErrors(TOOL, "request", { ...ASK, seller_specs: sellerRows })).not.toEqual([]);
    expect(artifactErrors(TOOL, "request", { ...ASK, ship_to: "home" })).not.toEqual([]);
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

  it("`seller_fit` reaches the agent on EVERY offer, `ships` inside it", async () => {
    // The brief's seller rows are answered here and nowhere else. `ships` is always present
    // and `unknown` is an ordinary value of it — an offer arriving without `seller_fit`
    // would read as a seller with no terms rather than one sil has not read.
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok(contractResponse(TOOL)));
    const offers = (await run())["offers"] as Record<string, Record<string, unknown>>[];
    for (const offer of offers) {
      expect(Object.keys(offer["seller_fit"] ?? {})).toContain("ships");
      expect(["serviceable", "not_serviceable", "unknown"]).toContain(offer["seller_fit"]["ships"]);
    }
    // The contract's own body carries an unread seller beside a read one, so a
    // pass-through keeping only the answerable half shows up here.
    expect(offers.map((o) => o["seller_fit"]["ships"])).toContain("unknown");
  });

  it("the answer names the address its `ships` are about", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok(contractResponse(TOOL)));
    expect((await run())["ship_to"]).toBe("home");
  });
});
