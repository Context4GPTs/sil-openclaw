/**
 * INTEGRATION — every shopping call says who is calling, and sil-api refuses one that
 * does not. The values come from the host's per-run tool context and `execute`'s call id;
 * a missing one is left off, never guessed.
 */

import { describe, it, expect } from "vitest";

import type { ToolContext } from "openclaw/plugin-sdk/plugin-entry";

import { readInstalledVersion } from "../lib/version-advisory.js";
import { SHOPPING_TOOLS, registerCatalogTools } from "../tools/catalog.js";
import { createMockPluginApi, getTool } from "./helpers/mock-plugin-api.js";
import {
  installRouter,
  ok,
  rotated,
  seedTokens,
  useShoppingHarness,
  type Recorded,
} from "./helpers/shopping-harness.js";

const SESSION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
// The host hands this beside `sessionId`; it carries the chat handle and must never leave.
const SESSION_KEY = "agent:main:telegram:direct:+306912345678";
const CTX = {
  sessionId: SESSION_ID,
  sessionKey: SESSION_KEY,
  activeModel: { provider: "openrouter", modelId: "anthropic/claude-sonnet-5", modelRef: "x" },
} as ToolContext;

useShoppingHarness("caller-headers");

function apiFor(ctx: ToolContext) {
  const api = createMockPluginApi({ runtime: { version: "2026.9.3" } });
  registerCatalogTools(api);
  return (name: string) => getTool(api, name, ctx);
}

const silHeaders = (req: Recorded): Record<string, string> =>
  Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith("sil-")));

describe("caller headers", () => {
  it("each of the eleven sends exactly the six caller headers, from the run's context", async () => {
    seedTokens("at", "rt");
    const router = installRouter(() => ok({ status: "ok" }));
    const tool = apiFor(CTX);
    for (const { name } of SHOPPING_TOOLS) {
      await tool(name).execute(`call_${name}`, { path: "coffee.espresso", q: "espresso" });
    }

    expect(router.all).toHaveLength(SHOPPING_TOOLS.length);
    for (const [i, req] of router.all.entries()) {
      expect(silHeaders(req)).toEqual({
        "sil-session-id": SESSION_ID,
        "sil-tool-call-id": `call_${SHOPPING_TOOLS[i].name}`,
        "sil-attempt": "1",
        "sil-model": "openrouter/anthropic/claude-sonnet-5",
        "sil-openclaw-version": "2026.9.3",
        "sil-plugin-version": readInstalledVersion(),
      });
      const others = Object.keys(req.headers).filter((k) => !k.startsWith("sil-"));
      expect(others.sort()).toEqual(
        req.method === "GET" ? ["authorization"] : ["authorization", "content-type"],
      );
      expect(JSON.stringify(req)).not.toContain(SESSION_KEY);
    }
  });

  it("the retry after a refreshed sign-in is attempt 2 of the same tool call", async () => {
    seedTokens("at-dead", "rt");
    const router = installRouter((kind, nth) => {
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return nth === 0 ? { status: 401, body: {} } : ok({ status: "ok" });
    });
    await apiFor(CTX)("shopping_brief_read").execute("call_retry", {});

    expect(router.briefRead.map((r) => [r.headers["sil-tool-call-id"], r.headers["sil-attempt"]]))
      .toEqual([["call_retry", "1"], ["call_retry", "2"]]);
  });

  it("a run without a session or a whole model sends the call without those headers", async () => {
    seedTokens("at", "rt");
    const router = installRouter(() => ok({ status: "ok" }));
    for (const ctx of [{}, { activeModel: { provider: "openrouter" } }] as ToolContext[]) {
      await apiFor(ctx)("shopping_brief_read").execute("call_bare", {});
    }

    expect(router.briefRead).toHaveLength(2);
    for (const req of router.briefRead) {
      expect(Object.keys(silHeaders(req)).sort()).toEqual([
        "sil-attempt",
        "sil-openclaw-version",
        "sil-plugin-version",
        "sil-tool-call-id",
      ]);
    }
  });
});
