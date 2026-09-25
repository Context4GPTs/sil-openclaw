/**
 * INTEGRATION — `shopping_domain_get` on the wire: the category's guide and keys, read
 * by path.
 *
 * The path is a PATH SEGMENT, and that is the whole risk in this file. Concatenating it
 * would let a stray `/` re-route the call — to the registry search, to the mint's own
 * path, or off the route table entirely — so the segment is URL-encoded and the router
 * is asked which bucket the request actually landed in.
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
import { DOMAIN_GET_404, contractResponse } from "./helpers/shopping-wire.js";

const TOOL = "shopping_domain_get";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";
const PATH = "product.sports.winter.ski.boots";

const harness = useShoppingHarness("domain-get");

const run = async (params: Record<string, unknown> = { path: PATH }) =>
  payloadOf(await getTool(harness.api, TOOL).execute("call-1", params));

describe("shopping_domain_get — the path is a segment, not a query", () => {
  it("GETs `/catalog/domains/<path>` with a Bearer and no body, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) =>
      kind === "domainGet" ? ok(contractResponse(TOOL)) : ok({}),
    );
    await run();
    expect(router.domainGet).toHaveLength(1);
    const [req] = router.domainGet;
    expect(req.method).toBe("GET");
    expect(req.hasBody).toBe(false);
    expect(req.url).toBe(`${getApiUrl()}/catalog/domains/${PATH}`);
    expect(bearerToken(req)).toBe(ACCESS);
    expect(router.domainSearch).toEqual([]);
    expect(router.domains).toEqual([]);
    expect(router.other).toEqual([]);
  });

  it.each([
    ["absent", {}],
    ["not a string", { path: 42 }],
    ["empty", { path: "" }],
    ["null", { path: null }],
  ])("refuses locally when `path` is %s — zero network, and the field is named", async (_label, params) => {
    // THE bar the whole local refusal exists for. The host does NOT validate a plugin
    // tool's arguments against its `parameters` (openclaw 2026.9.3 runs one `Value.Check`,
    // and it is inside `eraseSessionFileTool`), so nothing upstream stops an empty
    // segment. Sent, it becomes a GET of `/catalog/domains` — the REGISTRY SEARCH — and
    // the agent reads an answer about a different route as an answer about its own.
    seedTokens(ACCESS, REFRESH);
    const router = installRouter(() => ok(contractResponse(TOOL)));
    const payload = await run(params as Record<string, unknown>);
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["message"]).toContain("`path`");
    expect(router.all).toEqual([]);
  });

  it("a `/` in the path is ENCODED — it can never split the segment and re-route the call", async () => {
    // The host validates `path` against the artifact's pattern, so this shape cannot
    // arrive in production. That is exactly why it is driven here: the encode is the
    // defence that has no other witness, and without it this request lands on a
    // different route while looking perfectly healthy.
    seedTokens(ACCESS, REFRESH);
    const router = installRouter(() => ok(contractResponse(TOOL)));
    await run({ path: "product/../search" });
    expect(router.domainGet).toHaveLength(1);
    expect(router.domainGet[0].url).toBe(
      `${getApiUrl()}/catalog/domains/product%2F..%2Fsearch`,
    );
    expect(router.search).toEqual([]);
    expect(router.other).toEqual([]);
  });
});

describe("shopping_domain_get — what the answer means", () => {
  it("the contract's own 200 arrives verbatim, guide and every key's operators intact", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domainGet" ? ok(contractResponse(TOOL)) : ok({})));
    expect(await run()).toEqual(contractResponse(TOOL));
  });

  it("a path that does not stand is `not_found`, and the recovery is the registry read", async () => {
    // Terminal but not fatal: no retry can make sil hold it, and guessing a second path
    // is how a category forks. The agent is sent back to read in the buyer's words.
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domainGet" ? { status: 404, body: DOMAIN_GET_404 } : ok({})));
    expect(await run()).toEqual({
      status: "not_found",
      message: DOMAIN_GET_404.message,
      recovery: "shopping_domain_search",
    });
  });
});
