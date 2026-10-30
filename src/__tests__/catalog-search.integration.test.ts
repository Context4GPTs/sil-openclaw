/**
 * INTEGRATION — `shopping_search` on the wire: the beat-5 read, and the only tool whose
 * page is also buffered for a paired client to pull back.
 *
 * The spec rows are what this file guards. They are the buyer's requirements, typed, and
 * the plugin is pure transport for them: an op it re-spelled, a currency it filled in, or
 * a row it dropped would change what sil was asked without anything downstream noticing.
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
  seedTokens,
  useShoppingHarness,
} from "./helpers/shopping-harness.js";
import { SPEC_400, contractRequest, contractResponse } from "./helpers/shopping-wire.js";

const TOOL = "shopping_search";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const ASK = contractRequest(TOOL);

const harness = useShoppingHarness("search");

const run = async (params: Record<string, unknown> = ASK, callId = "call-1") =>
  payloadOf(await getTool(harness.api, TOOL).execute(callId, params));

describe("shopping_search — one route, the ask verbatim", () => {
  it("POSTs `/catalog/search` with the whole ask and a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "search" ? ok(contractResponse(TOOL)) : ok({})));
    await run();
    expect(router.search).toHaveLength(1);
    const [req] = router.search;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${getApiUrl()}/catalog/search`);
    expect(req.body).toEqual(ASK);
    expect(bearerToken(req)).toBe(ACCESS);
    expect(router.other).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("the price range keeps its currency, and no row is re-spelled or filled in", async () => {
    // sil holds no exchange rate anywhere, so a currency the plugin invented would make
    // a bound sil cannot test look like one it did.
    seedTokens(ACCESS, REFRESH);
    const router = installRouter(() => ok(contractResponse(TOOL)));
    await run();
    const body = router.search[0].body as typeof ASK;
    expect([body["specs"], body["price"]]).toEqual([ASK["specs"], ASK["price"]]);
  });

  it("the search carries NO seller side — seller rows are the brief's", async () => {
    // The offers read them off the brief and answer a term per seller. A search that
    // carried them would be refused by the route, and the agent would read the refusal
    // as a bad product row.
    seedTokens(ACCESS, REFRESH);
    const router = installRouter(() => ok(contractResponse(TOOL)));
    await run();
    expect(Object.keys(router.search[0].body as object).sort()).toEqual([
      "domain",
      "n",
      "price",
      "specs",
    ]);
  });

  it("the token reaches neither a log line nor the result", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok(contractResponse(TOOL)));
    const payload = await run();
    expect(logBlob(harness.api)).not.toContain(ACCESS);
    expect(JSON.stringify(payload)).not.toContain(ACCESS);
  });
});

describe("shopping_search — what the answer means", () => {
  it("the contract's 200 arrives verbatim: `holds`, `misses` and `unknown` intact", async () => {
    // The id lists are what say a value is unverified; a projection would quietly ruin them.
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok(contractResponse(TOOL)));
    expect(await run()).toEqual(contractResponse(TOOL));
  });

  it("`products: []` is a SUCCESS — an empty shortlist is an answer, not a failure", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok({ status: "ok", products: [] }));
    expect(await run()).toEqual({ status: "ok", products: [] });
  });

  it("a refused spec surfaces the route's own message, unrewritten", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ({ status: 400, body: SPEC_400 }));
    expect(await run()).toEqual({ status: "invalid_request", message: SPEC_400.message });
  });

  it("a 426 reaches the agent as sil's own message, not a transient failure", async () => {
    const message =
      "this sil plugin (0.6.0) is older than sil accepts (0.7.0); update the sil plugin";
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ({ status: 426, body: { error: "invalid_request", message } }));
    expect(await run()).toEqual({ status: "invalid_request", message });
  });
});
