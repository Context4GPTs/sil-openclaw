/**
 * INTEGRATION — `shopping_seller_get` on the wire: whether a seller ships to the buyer.
 *
 * THIS IS THE FILE THE HONESTY TURNS ON. `ships` fails closed — `not_serviceable` is a
 * positive claim needing a policy sil actually read, so `unknown` is an ordinary answer
 * and a common one. A consumer that drops `unknown` sellers collapses the shortlist while
 * looking like it filtered, which is invisible from outside and undetectable downstream.
 * So every seller the route sent must arrive, carrying everything it carried.
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

const TOOL = "shopping_seller_get";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const harness = useShoppingHarness("seller-get");

const run = async (params: Record<string, unknown> = { ids: ["s1", "s2"] }) =>
  payloadOf(await getTool(harness.api, TOOL).execute("call-1", params));

describe("shopping_seller_get — one route, one request", () => {
  it("POSTs `/catalog/sellers` with `{ ids }` and a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "sellers" ? ok(contractResponse(TOOL)) : ok({})));
    await run();
    expect(router.sellers).toHaveLength(1);
    const [req] = router.sellers;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${getApiUrl()}/catalog/sellers`);
    expect(req.body).toEqual({ ids: ["s1", "s2"] });
    expect(bearerToken(req)).toBe(ACCESS);
    expect(router.other).toEqual([]);
  });

  it("the request takes `ids` and NOTHING else — an address is refused", () => {
    // `ships` answers for the buyer's default address, so this call has no address to
    // send. The artifact IS the tool's `parameters`, so it is what the host validates
    // against: a re-added echo would be a field the route never agreed to.
    expect(artifactErrors(TOOL, "request", { ids: ["s1"] })).toEqual([]);
    expect(artifactErrors(TOOL, "request", { ids: ["s1"], ship_to: "home" })).not.toEqual([]);
  });
});

describe("shopping_seller_get — what the answer means", () => {
  it("the contract's own 200 arrives verbatim", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok(contractResponse(TOOL)));
    const payload = await run();
    expect(payload).toEqual(contractResponse(TOOL));
  });
});
