/**
 * INTEGRATION — `shopping_domain_create` on the wire: the one permanent, global,
 * un-undoable write in the product.
 *
 * Two properties are asserted that no other file can: the mint body reaches the route
 * EXACTLY as the agent composed it — `type`, `variant_spec`, `product_spec`, and nothing
 * the plugin invented — and each of its two refusals is carried back with the next call
 * it licenses, which is a DIFFERENT call for each: a colliding path means the vocabulary
 * is already there, a path hung on the root means the ancestor is still unknown.
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
import {
  MINT_400,
  MINT_409,
  artifactErrors,
  contractRequest,
  contractResponse,
} from "./helpers/shopping-wire.js";

const TOOL = "shopping_domain_create";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const harness = useShoppingHarness("domain-create");

const run = async (params: Record<string, unknown> = contractRequest(TOOL)) =>
  payloadOf(await getTool(harness.api, TOOL).execute("call-1", params));

/** The keys a mint reply reports as an ancestor's, in order. */
const inheritedKeys = (body: Record<string, unknown>): Record<string, unknown>[] =>
  (body["specs"] as Record<string, unknown>[]).filter((s) => s["inherited"] === true);

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

  it("the request coins PRODUCT keys only — `seller_specs` is refused", () => {
    // Seller terms are never the agent's to coin: the base is sil's, and a branch key is
    // coined by research. The artifact is this tool's `parameters`, so a mint that tried
    // is refused before it reaches the one write nothing can undo.
    const body = contractRequest(TOOL);
    expect(artifactErrors(TOOL, "request", body)).toEqual([]);
    expect(
      artifactErrors(TOOL, "request", {
        ...body,
        seller_specs: [{ key: "bootfitting_service", display_name: "Bootfitting", type: "boolean" }],
      }),
    ).not.toEqual([]);
  });
});

describe("shopping_domain_create — what the answer means", () => {
  it("the contract's own 200 arrives verbatim — the keys as the registry accepted them", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domains" ? ok(contractResponse(TOOL)) : ok({})));
    expect(await run()).toEqual(contractResponse(TOOL));
  });

  it("a key the registry answers `inherited: true` reaches the agent carrying its mark", async () => {
    // The agent filters on an inherited key without having minted it, so the MARK is what
    // has to survive the hop — and the deep-equal above reads just as green over a reply
    // that never carried one, which is why this bar names it.
    seedTokens(ACCESS, REFRESH);
    const example = contractResponse(TOOL);
    expect(inheritedKeys(example).length).toBeGreaterThan(0); // guard-of-the-guard
    installRouter((kind) => (kind === "domains" ? ok(example) : ok({})));
    expect(inheritedKeys(await run())).toEqual(inheritedKeys(example));
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

  it("a path hung on the ROOT is `invalid_request`, and the recovery is to READ the registry again", async () => {
    // Draw 2 minted `product.ski_boots` and `product.ski_helmets` on the root — a fork
    // every later buyer inherits. The registry now refuses it, and the refusal needs a
    // DIFFERENT next call from the 409: nothing stands at that path, so searching it
    // finds nothing and the agent is left with no move. Every word of the message is
    // sil's own — the whole of the agent's recourse is in it.
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domains" ? { status: 400, body: MINT_400 } : ok({})));
    expect(await run()).toEqual({
      status: "invalid_request",
      message: MINT_400.message,
      recovery: "shopping_domain_search",
    });
  });
});
