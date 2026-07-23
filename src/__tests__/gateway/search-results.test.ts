/**
 * UNIT — the `sil.search_results` gateway method's registration + authorization
 * shape (tier: unit, mock api + temp data dir, `fetch` spied so nothing reaches
 * the network).
 *
 * The two unit-tier criteria that live at the HANDLER boundary:
 *
 *   C5 — the plugin declares `{scope: "operator.read"}` and implements NO scope
 *        logic of its own. The host authorizes role + scope BEFORE the handler
 *        runs (`authorizeGatewayMethod`, source-verified in `vendor/openclaw`);
 *        the plugin's whole contribution is the declaration. This file
 *        deliberately does NOT simulate the host's check — the mock is not the
 *        gateway, and asserting a mocked gate proves nothing.
 *   C6 — knowledge of a `callId` is NOT evidence of entitlement. The key is the
 *        HOST's id, visible to anyone who can see the tool frames, so the plugin
 *        controls no key entropy. Principal-scoping is the only gate.
 *
 * Plus the handler's own robustness contract: it NEVER throws (a thrown handler
 * is an opaque gateway error a client reads as a retryable transport fault, so a
 * permanent condition would leave a shopper's item spinning forever) and it
 * always emits EXACTLY ONE response frame.
 *
 * The wired end-to-end behaviour — search → store → resolve, the uniform failure
 * body, the >12 KB round trip — is the integration tier's job in
 * `search-results-method.integration.test.ts`. This file stays at the handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerSearchResultsMethod, SEARCH_RESULTS_METHOD } from "../../gateway/search-results.js";
import type { SearchResultPage } from "../../lib/search-results-store.js";
import { putSearchResult, __resetSearchResultsStore } from "../../lib/search-results-store.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";
import {
  createMockPluginApi,
  getGatewayMethod,
  registeredGatewayMethodNames,
  callGatewayMethod,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const ACCOUNT = "user-42";
const CALL_ID = "call_FSW68ywnbj8V6pZ5U8avz9Sn";

let dataDir: string;
let priorSilDataDir: string | undefined;

const PAGE: SearchResultPage = {
  status: "ok",
  products: [
    {
      id: "gid://product/a",
      title: "Aeron Chair",
      source: "herman-miller",
      variant: {
        id: "gid://variant/a1",
        title: "Aeron Chair — Graphite",
        price: { amount: 159_900, currency: "USD" },
        availability: { available: true, status: "in_stock" },
        checkout_url: "https://buy.example.com/aeron-a1",
      },
    },
  ],
};

function seedSession(id = ACCOUNT): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getTokensPath(), JSON.stringify({ access_token: "at", refresh_token: "rt" }), {
    mode: 0o600,
  });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ user: { id, name: "User" } }), {
    mode: 0o600,
  });
}

function registered(): MockPluginAPI {
  const api = createMockPluginApi();
  registerSearchResultsMethod(api);
  return api;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-gw-searchres-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  __resetSearchResultsStore();
  // Nothing here may reach the network: the resolve leg is a store read.
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("sil.search_results must not make a network call"),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetSearchResultsStore();
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

// ===========================================================================
// C5 — the declared scope IS the plugin's whole transport-layer contribution
// ===========================================================================

describe("C5 — scope is declared, never implemented", () => {
  it("registers the method under its exact wire name", () => {
    const api = registered();
    // The name is half of the cross-sibling contract; the client calls this
    // literal string. A gateway method is not manifest-declarable, so there is no
    // manifest mirror to catch a rename — this assertion is the only guard.
    expect(SEARCH_RESULTS_METHOD).toBe("sil.search_results");
    expect([...registeredGatewayMethodNames(api)]).toEqual(["sil.search_results"]);
  });

  it("declares `operator.read` — the narrowest scope that admits a paired client", () => {
    const api = registered();
    expect(getGatewayMethod(api, SEARCH_RESULTS_METHOD).opts?.scope).toBe("operator.read");
  });

  it("registering opens nothing — no timer, no socket, no fetch", () => {
    // `register()` must stay synchronous and hold no resource open, or a
    // long-lived handle blocks the host's gateway startup. Registering a closure
    // is legal; anything else is not.
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const api = createMockPluginApi();

    registerSearchResultsMethod(api);

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("ignores any scope-shaped value a CALLER puts in params — the host owns that gate", async () => {
    // A handler that read an inbound `scope` would be implementing its own
    // authorization out of caller-controlled data, which is a bypass by
    // construction. The host has already authorized before we run.
    seedSession();
    putSearchResult(CALL_ID, PAGE, ACCOUNT);
    const api = registered();

    const honest = await callGatewayMethod(api, SEARCH_RESULTS_METHOD, { callId: CALL_ID });
    const spoofed = await callGatewayMethod(api, SEARCH_RESULTS_METHOD, {
      callId: CALL_ID,
      scope: "operator.admin",
      scopes: ["operator.admin"],
    });
    expect(JSON.stringify(spoofed)).toBe(JSON.stringify(honest));
  });
});

// ===========================================================================
// C6 — a callId is not a capability
// ===========================================================================

describe("C6 — principal-scoping is the only gate", () => {
  it("resolves for the account that produced the page", async () => {
    seedSession();
    putSearchResult(CALL_ID, PAGE, ACCOUNT);
    const api = registered();

    const frames = await callGatewayMethod(api, SEARCH_RESULTS_METHOD, { callId: CALL_ID });
    expect(frames).toHaveLength(1);
    expect((frames[0]!.payload as Record<string, unknown>)["status"]).toBe("ok");
  });

  it("refuses a correct callId when the process holds NO live session", async () => {
    // The whole of C6 in one case: the caller knows the exact key — the same
    // string the client reads off the tool frames — and still gets nothing,
    // because entitlement is the sil ACCOUNT, not the id.
    putSearchResult(CALL_ID, PAGE, ACCOUNT);
    const api = registered(); // no tokens.json, no config.json seeded

    const frames = await callGatewayMethod(api, SEARCH_RESULTS_METHOD, { callId: CALL_ID });
    const body = frames[0]!.payload as Record<string, unknown>;
    expect(body["status"]).toBe("not_found");
    expect(JSON.stringify(frames)).not.toContain("checkout_url");
    expect(JSON.stringify(frames)).not.toContain("gid://product/a");
  });

  it("refuses when tokens are gone even though config.json still names the account", async () => {
    // `clearTokens()` unlinks tokens.json and leaves config.json in place, so a
    // principal read from config ALONE would still resolve after a logout. The
    // live-session check is what makes the logout real.
    seedSession();
    putSearchResult(CALL_ID, PAGE, ACCOUNT);
    rmSync(getTokensPath(), { force: true });
    const api = registered();

    const body = (await callGatewayMethod(api, SEARCH_RESULTS_METHOD, { callId: CALL_ID }))[0]!
      .payload as Record<string, unknown>;
    expect(body["status"]).toBe("not_found");
  });

  it("refuses after a re-registration as a different account", async () => {
    seedSession("account-a");
    putSearchResult(CALL_ID, PAGE, "account-a");
    seedSession("account-b");
    const api = registered();

    const body = (await callGatewayMethod(api, SEARCH_RESULTS_METHOD, { callId: CALL_ID }))[0]!
      .payload as Record<string, unknown>;
    expect(body["status"]).toBe("not_found");
  });
});

// ===========================================================================
// The handler never throws, and always answers exactly once
// ===========================================================================

describe("the handler always answers exactly once and never throws", () => {
  const HOSTILE: [string, Record<string, unknown>][] = [
    ["no params at all", {}],
    ["callId undefined", { callId: undefined }],
    ["callId null", { callId: null }],
    ["callId as a number", { callId: 7 }],
    ["callId as a boolean", { callId: true }],
    ["callId as an array", { callId: ["a", "b"] }],
    ["callId as a nested object", { callId: { toString: "not a function" } }],
    ["callId empty string", { callId: "" }],
    ["callId whitespace only", { callId: "   " }],
    ["callId with a NUL byte", { callId: "call_ null" }],
    ["callId with RTL + zero-width chars", { callId: "call_‮​_rtl" }],
    ["callId as an emoji run", { callId: "🛒🛒🛒" }],
    ["callId as a 100 KB string", { callId: "c".repeat(100_000) }],
    ["callId that looks like a prototype key", { callId: "__proto__" }],
    ["callId 'constructor'", { callId: "constructor" }],
    ["callId as a SQL-ish payload", { callId: "'; DROP TABLE results; --" }],
    ["callId as an XSS payload", { callId: "<script>alert(1)</script>" }],
    ["callId as a traversal payload", { callId: "../../../../etc/passwd" }],
  ];

  it.each(HOSTILE)("answers exactly one structured frame for %s", async (_label, params) => {
    seedSession();
    putSearchResult(CALL_ID, PAGE, ACCOUNT);
    const api = registered();

    const frames = await callGatewayMethod(api, SEARCH_RESULTS_METHOD, params);

    // Exactly one frame: zero frames is a client hung forever waiting on a
    // response that never comes; two is a protocol violation.
    expect(frames).toHaveLength(1);
    // `ok:false` is used for NOTHING — a client maps a method-level error to a
    // retryable transport fault, and none of these are retryable.
    expect(frames[0]!.ok).toBe(true);
    const body = frames[0]!.payload as Record<string, unknown>;
    expect(typeof body["status"]).toBe("string");
    expect(body["status"]).not.toBe("ok");
    // No hostile key ever addressed a real page.
    expect(JSON.stringify(frames)).not.toContain("checkout_url");
  });

  it("a prototype-shaped callId cannot reach an inherited Object property", async () => {
    // A store backed by a plain object rather than a Map would resolve
    // `__proto__` / `constructor` / `toString` to something truthy and hand a
    // caller an Object internal in place of a page.
    seedSession();
    const api = registered();

    for (const callId of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const body = (await callGatewayMethod(api, SEARCH_RESULTS_METHOD, { callId }))[0]!
        .payload as Record<string, unknown>;
      expect(body["status"]).toBe("not_found");
    }
  });

  it("never records an internal failure on a healthy path", async () => {
    // The handler's catch-all is a safety net, not a routine path. If it fires
    // during ordinary use, something is throwing that should not be — and the
    // uniform not-found body would hide it.
    seedSession();
    putSearchResult(CALL_ID, PAGE, ACCOUNT);
    const api = registered();

    await callGatewayMethod(api, SEARCH_RESULTS_METHOD, { callId: CALL_ID });
    await callGatewayMethod(api, SEARCH_RESULTS_METHOD, { callId: "call_unknown" });
    await callGatewayMethod(api, SEARCH_RESULTS_METHOD, {});

    expect(api.logger.error).not.toHaveBeenCalled();
  });
});
