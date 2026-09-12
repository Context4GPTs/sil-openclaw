/**
 * INTEGRATION — `shopping_domain_create` on the wire: the one permanent, global,
 * un-undoable write in the product.
 *
 * Two properties are asserted that no other file can: the mint body reaches the route
 * EXACTLY as the agent composed it — `type`, `variant_spec`, `product_spec`, and nothing
 * the plugin invented — and the 409 is carried back as a recovery rather than a failure,
 * because a colliding path means the vocabulary is already there.
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
import { MINT_409, contractRequest, contractResponse } from "./helpers/shopping-wire.js";

const TOOL = "shopping_domain_create";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const harness = useShoppingHarness("domain-create");

const run = async (params: Record<string, unknown> = contractRequest(TOOL)) =>
  payloadOf(await getTool(harness.api, TOOL).execute("call-1", params));

describe("shopping_domain_create — one write, and only one", () => {
  it("POSTs the contract's own mint body to `/catalog/domains`, verbatim, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "domains" ? ok(contractResponse(TOOL)) : ok({})));
    await run();
    expect(router.domains).toHaveLength(1);
    const [req] = router.domains;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${getApiUrl()}/catalog/domains`);
    expect(req.body).toEqual(contractRequest(TOOL));
    expect(bearerToken(req)).toBe(ACCESS);
    expect(router.domainSearch).toEqual([]);
    expect(router.domainGet).toEqual([]);
    expect(router.other).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("each spec travels with `type` and its marks — and with nothing retired beside them", async () => {
    // The mint is the surface the retired registry vocabulary would come back through:
    // it is the only call that WRITES key definitions, so a stale `data_type`, `level`
    // or `axis` reaching it forks the registry for every shopper, permanently.
    seedTokens(ACCESS, REFRESH);
    const router = installRouter(() => ok(contractResponse(TOOL)));
    await run();
    const specs = (router.domains[0].body as { specs: Record<string, unknown>[] }).specs;
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(spec).toHaveProperty("type");
      for (const retired of ["data_type", "level", "axis", "value_set"]) {
        expect(spec).not.toHaveProperty(retired);
      }
    }
    expect(specs.some((s) => s["variant_spec"] === true)).toBe(true);
    expect(specs.some((s) => s["product_spec"] === true)).toBe(true);
  });
});

describe("shopping_domain_create — what the answer means", () => {
  it("the contract's own 200 arrives verbatim — the keys as the registry accepted them", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domains" ? ok(contractResponse(TOOL)) : ok({})));
    expect(await run()).toEqual(contractResponse(TOOL));
  });

  it("a colliding path is `already_exists`, and the recovery is to SEARCH that same path", async () => {
    // Never framed as a failure and never a licence to coin a near-path variant: that
    // would split the category for every shopper with no way back.
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domains" ? { status: 409, body: MINT_409 } : ok({})));
    expect(await run()).toEqual({
      status: "already_exists",
      message: MINT_409.message,
      recovery: "shopping_search",
    });
  });
});
