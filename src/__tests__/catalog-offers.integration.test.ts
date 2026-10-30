/**
 * INTEGRATION — `shopping_offers` on the wire: the picked variants' ids go to sil once,
 * and its answer crosses untouched.
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

});

