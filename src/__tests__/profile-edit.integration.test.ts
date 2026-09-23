/**
 * INTEGRATION — `shopping_profile_edit` sets the buyer's `currency` (contract §3.9).
 *
 * "My prices in dollars from now on" is this call and nothing else: every money row
 * naming no currency means the profile's, so a currency the host refused or the plugin
 * re-spelled leaves the buyer's offers ordered in the old one while the agent says it
 * changed.
 */

import { describe, it, expect } from "vitest";

import { getTool } from "./helpers/mock-plugin-api.js";
import { installRouter, ok, seedTokens, useShoppingHarness } from "./helpers/shopping-harness.js";
import { artifactErrors, contractResponse } from "./helpers/shopping-wire.js";

const TOOL = "shopping_profile_edit";
const ASK = { currency: "USD" };

const harness = useShoppingHarness("profile-edit");

describe("shopping_profile_edit — the buyer's currency", () => {
  it("`currency` is a parameter the host admits, and reaches `/profile/edit` verbatim", async () => {
    expect(artifactErrors(TOOL, "request", ASK)).toEqual([]);
    seedTokens("at-live-token", "rt-live-token");
    const router = installRouter(() => ok(contractResponse(TOOL)));
    await getTool(harness.api, TOOL).execute("call-1", ASK);
    expect(router.profileEdit.map((r) => r.body)).toEqual([ASK]);
    expect(router.other).toEqual([]);
  });
});
