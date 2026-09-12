/**
 * INTEGRATION — the plugin half of A1: every shopping tool hands the API's 200 body to
 * the agent VERBATIM, and that body is one the committed response artifact admits.
 *
 * TWO HALVES, AND NEITHER ALONE IS THE BAR. Equality alone would pass on a fixture a
 * test author invented, so the bodies are the agent contract's own worked examples
 * (`scripts/contract-examples.mjs` lifts them out of `agent-contract.md`). Validation
 * alone would pass on a body the plugin then reshaped. Together they say: what
 * sil-services promised is what the agent received.
 *
 * The refusal teeth are here too, because a pass-through that cannot refuse is a
 * pass-through nobody can trust: an extra field fails the artifact, and a 200 that does
 * not state `status: "ok"` is a broken contract rather than a degraded answer.
 */

import { describe, it, expect } from "vitest";

import { getTool } from "./helpers/mock-plugin-api.js";
import {
  installRouter,
  ok,
  payloadOf,
  seedTokens,
  useShoppingHarness,
} from "./helpers/shopping-harness.js";
import {
  SHOPPING_TOOLS,
  artifactErrors,
  contractResponse,
  type ShoppingToolName,
} from "./helpers/shopping-wire.js";

const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

/** The smallest valid call per tool — the wire shape is each tool's own file's job. */
const CALL: Record<ShoppingToolName, Record<string, unknown>> = {
  shopping_domain_search: { q: "ski boots" },
  shopping_domain_get: { path: "product.sports.winter.ski.boots" },
  shopping_domain_create: {
    path: "product.sports.winter.ski.boots",
    guide: "how they are bought",
    specs: [{ key: "mondo_size", display_name: "Mondopoint size", type: "number" }],
  },
  shopping_search: { domain: "product.sports.winter.ski.boots", query: "boots", n: 3 },
  shopping_product_get: { ids: ["v1"] },
  shopping_offers: { ids: ["v1"] },
  shopping_seller_get: { ids: ["s1"] },
};

const harness = useShoppingHarness("pass-through");

const run = async (tool: ShoppingToolName): Promise<Record<string, unknown>> =>
  payloadOf(await getTool(harness.api, tool).execute("call-1", CALL[tool]));

describe("A1 — the contract's own examples validate against the committed artifacts", () => {
  it.each(SHOPPING_TOOLS)("%s's example response is admitted by its response artifact", (tool) => {
    // A red here is a defect in the contract or the artifact, never in the plugin: the
    // two are one source, rendered from one TypeBox object, and this is where they meet.
    expect(artifactErrors(tool, "response", contractResponse(tool))).toEqual([]);
  });
});

describe("A1 — every shopping tool passes the body through unchanged", () => {
  it.each(SHOPPING_TOOLS)("%s returns the API's body, deep-equal, nothing added", async (tool) => {
    seedTokens(ACCESS, REFRESH);
    const body = contractResponse(tool);
    installRouter(() => ok(body));
    const payload = await run(tool);
    expect(payload).toEqual(body);
    expect(Object.keys(payload).sort()).toEqual(Object.keys(body).sort());
  });
});

describe("A1 — the refusal teeth", () => {
  it("an extra field on the API body FAILS the artifact (the validation bites)", async () => {
    // Guard-of-the-guard. Every artifact is `additionalProperties: false`, so a body
    // carrying a field the contract never defined must be rejected by the validator —
    // otherwise the bars above pass on anything.
    const rogue = { ...contractResponse("shopping_search"), leaked_internal_count: 3 };
    expect(artifactErrors("shopping_search", "response", rogue)).not.toEqual([]);
  });

  it.each(SHOPPING_TOOLS)("%s: a 200 that is not `status: ok` becomes `retryable`", async (tool) => {
    // The one thing the plugin owns on the way back. Every 200 the API means as an answer
    // says so; a 200 that does not is a broken contract, and handing it on as success
    // would put a status the agent has no recovery arm for into its dispatch key.
    seedTokens(ACCESS, REFRESH);
    installRouter(() => ok({ status: "partial", products: [] }));
    expect((await run(tool))["status"]).toBe("retryable");
  });
});
