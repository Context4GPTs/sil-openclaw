/**
 * INTEGRATION — `shopping_domain_search` on the wire: the registry read that precedes
 * every mint, driven end to end over a scripted `fetch`.
 *
 * The VERB is the whole safety property here. This read and the one permanent global
 * write share a path and are told apart by nothing else, so a call that reached the mint
 * bucket would be the undoable write performed by a discovery call. The router splits on
 * method for exactly that reason, and every assertion below reads both buckets.
 */

import { describe, it, expect } from "vitest";

import { getApiUrl } from "../lib/config.js";
import { getTool } from "./helpers/mock-plugin-api.js";
import {
  bearerToken,
  installRouter,
  logBlob,
  ok,
  payloadOf,
  queryOf,
  seedTokens,
  useShoppingHarness,
} from "./helpers/shopping-harness.js";
import { SEARCH_400, contractResponse } from "./helpers/shopping-wire.js";

const TOOL = "shopping_domain_search";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const harness = useShoppingHarness("domain-search");

const run = async (params: Record<string, unknown> = { q: "ski boots" }) =>
  payloadOf(await getTool(harness.api, TOOL).execute("call-1", params));

describe("shopping_domain_search — one route, one bodyless read", () => {
  it("GETs `/catalog/domains?q=…` with a Bearer and no body, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) =>
      kind === "domainSearch" ? ok(contractResponse(TOOL)) : ok({}),
    );
    await run();
    expect(router.domainSearch).toHaveLength(1);
    const [req] = router.domainSearch;
    expect(req.method).toBe("GET");
    expect(req.hasBody).toBe(false);
    expect(req.url.split("?")[0]).toBe(`${getApiUrl()}/catalog/domains`);
    expect(queryOf(req).get("q")).toBe("ski boots");
    expect(bearerToken(req)).toBe(ACCESS);
    // The mint shares this path. It must never have been touched.
    expect(router.domains).toEqual([]);
    expect(router.other).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("only the declared query key travels — nothing else in `params` reaches the URL", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) =>
      kind === "domainSearch" ? ok(contractResponse(TOOL)) : ok({}),
    );
    await run({ q: "ski boots", path: "product.sports" });
    expect([...queryOf(router.domainSearch[0]).keys()]).toEqual(["q"]);
  });

  it("the token reaches neither a log line nor the result", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domainSearch" ? ok(contractResponse(TOOL)) : ok({})));
    const payload = await run();
    expect(logBlob(harness.api)).not.toContain(ACCESS);
    expect(JSON.stringify(payload)).not.toContain(ACCESS);
  });
});

describe("shopping_domain_search — what the answer means", () => {
  it("the contract's own 200 arrives verbatim", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domainSearch" ? ok(contractResponse(TOOL)) : ok({})));
    expect(await run()).toEqual(contractResponse(TOOL));
  });

  it("`matches: []` is a SUCCESS — the one answer that licenses the mint", async () => {
    // Mapping the empty read to a failure would recreate the empty-shelf-straight-to-
    // the-mint behaviour the read exists to delete: the agent could no longer tell
    // "nothing stands here" from "the read did not happen".
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) =>
      kind === "domainSearch" ? ok({ status: "ok", matches: [] }) : ok({}),
    );
    expect(await run()).toEqual({ status: "ok", matches: [] });
  });

  it("a 400 surfaces the route's own message, unrewritten", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) =>
      kind === "domainSearch" ? { status: 400, body: SEARCH_400 } : ok({}),
    );
    expect(await run()).toEqual({
      status: "invalid_request",
      message: SEARCH_400.message,
    });
  });
});
