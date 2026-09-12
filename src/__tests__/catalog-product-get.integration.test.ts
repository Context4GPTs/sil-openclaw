/**
 * INTEGRATION — `shopping_product_get` on the wire: the beat-6 dossier.
 *
 * The ids are OPAQUE, and this file is where that is proved on the wire: they go out in
 * the order and the spelling sil minted them, with no dedupe (which would mask a
 * server-side regression) and no pre-trim (the 1–10 bound is the artifact's, enforced by
 * the host before `execute()` runs).
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

const TOOL = "shopping_product_get";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";
const IDS = ["v1", "v6", "v1"];

const harness = useShoppingHarness("product-get");

const run = async (params: Record<string, unknown> = { ids: IDS }) =>
  payloadOf(await getTool(harness.api, TOOL).execute("call-1", params));

describe("shopping_product_get — one route, the ids as minted", () => {
  it("POSTs `/catalog/product` with `{ ids }` and a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "product" ? ok(contractResponse(TOOL)) : ok({})));
    await run();
    expect(router.product).toHaveLength(1);
    const [req] = router.product;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${getApiUrl()}/catalog/product`);
    expect(bearerToken(req)).toBe(ACCESS);
    expect(router.other).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("a repeated id is NOT deduped — the list travels exactly as the agent sent it", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter(() => ok(contractResponse(TOOL)));
    await run();
    expect(router.product[0].body).toEqual({ ids: IDS });
  });
});

describe("shopping_product_get — what the answer means", () => {
  it("the contract's own 200 arrives verbatim — every spec key and every source", async () => {
    // `specs` carries more keys than the ask named and `sources` dates each reading;
    // both are what a projection here would silently drop.
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok(contractResponse(TOOL)));
    expect(await run()).toEqual(contractResponse(TOOL));
  });

  it("an id sil cannot place is an ABSENCE, not an error", async () => {
    // A miss is a shorter `variants` list on an `ok` body. Reading it as a failure would
    // lose the entries sil DID place, on a call the agent must be able to act on.
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok({ status: "ok", variants: [] }));
    expect(await run()).toEqual({ status: "ok", variants: [] });
  });
});
