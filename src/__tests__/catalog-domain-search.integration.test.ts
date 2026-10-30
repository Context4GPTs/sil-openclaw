/**
 * INTEGRATION — `shopping_domain_search` on the wire: the registry read, driven end to end
 * over a scripted `fetch`.
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

  it("`matches: []` is a SUCCESS, not a failed read", async () => {
    // Mapped to a failure, the agent could no longer tell "nothing matched these words"
    // from "the read did not happen".
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
