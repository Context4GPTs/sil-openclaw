/**
 * INTEGRATION — the three tools that name a brief id all answer its 404 with the read
 * that lists the buyer's briefs.
 *
 * The wiring is one optional field per tool in the route table, and nothing else reads
 * it: deleted, every tier stays green while the agent gets a terminal refusal with no
 * next move and re-issues the same id. So each tool is driven through a real 404 and the
 * WHOLE payload is pinned — the route's own message, plus the recovery.
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
import { BRIEF_404, type ShoppingToolName } from "./helpers/shopping-wire.js";

const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

/** Every tool whose request carries a brief id, with the smallest call that carries one.
 * A literal list, because deriving it from the `recovery` field under test would empty
 * itself with the wiring. */
const BRIEF_BEARING: [ShoppingToolName, Record<string, unknown>][] = [
  ["shopping_brief_edit", { id: "b1", decision: "Ceiling raised 350 → 400 EUR." }],
  [
    "shopping_search",
    { brief: "b1", domain: "product.sports.winter.ski.boots", query: "ski boots 27.5", n: 3 },
  ],
  ["shopping_offers", { brief: "b1", ids: ["v1"] }],
];

const harness = useShoppingHarness("brief-404");

describe("a brief id that is not the buyer's — one 404, one recovery, three tools", () => {
  it.each(BRIEF_BEARING)("%s answers not_found with `shopping_brief_read`", async (tool, params) => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "refresh" ? ok({}) : { status: 404, body: BRIEF_404 }));
    expect(payloadOf(await getTool(harness.api, tool).execute("call-1", params))).toEqual({
      status: "not_found",
      message: BRIEF_404.message,
      recovery: "shopping_brief_read",
    });
  });
});
