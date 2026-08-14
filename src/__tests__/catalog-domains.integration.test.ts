/**
 * INTEGRATION — `sil_domain_create` wired end to end over a mocked `fetch`.
 *
 * This tool performs v0's ONE registry write and the write is PERMANENT: no
 * delete route, no upsert, and an existing path is refused rather than changed.
 * Two outcomes carry the whole product weight:
 *
 *   - a 200 is born FENCED (`validated_at: null`). The catalog leg does not run,
 *     every predicate reports `applied: false`, results come back
 *     `maturity: "web"`. That is a fence, not an empty catalog — and the agent
 *     can only say so once if the signal survives the tool boundary.
 *   - a 409 is NOT a failure. Read as one it invites minting a near-path
 *     variant, which forks the taxonomy for every sil shopper, forever.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../tools/catalog.js";
import { setApiUrl, setWebUrl, getApiUrl } from "../lib/config.js";
import { readTokens } from "../lib/credentials.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "./helpers/mock-plugin-api.js";
import {
  SIL_API,
  SIL_WEB,
  bearerToken,
  installRouter,
  logBlob,
  ok,
  payloadOf,
  rotated,
  seedTokens,
} from "./helpers/v0-harness.js";
import { AUTH, MINT_409, mintGolden } from "./helpers/v0-wire.js";

const TOOL = "sil_domain_create";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const MINT = {
  path: "product.sports.winter.ski.boots",
  guide:
    "Ski boots are bought by fit first: last width in millimetres, then flex index for the " +
    "skier's weight and aggression, then shell shape. Size is mondopoint.",
  specs: [
    { key: "flex_index", display_name: "Flex index", data_type: "number", unit: "index" },
    { key: "last_width_mm", display_name: "Last width", data_type: "number", unit: "mm" },
    { key: "brand", display_name: "Brand", data_type: "enum", value_set: "brands" },
  ],
};

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-v0-mint-"));
  priorDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl(SIL_WEB);
  setApiUrl(SIL_API);
  api = createMockPluginApi();
  registerCatalogTools(api);
});

afterEach(() => {
  vi.restoreAllMocks();
  setWebUrl("");
  setApiUrl("");
  if (priorDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

async function run(
  params: Record<string, unknown> = MINT,
  callId = "call-1",
): Promise<Record<string, unknown>> {
  return payloadOf(await getTool(api, TOOL).execute(callId, params));
}

describe("A8 — one route, one request", () => {
  it("POSTs `/catalog/domains` with `{ path, guide, specs }` and a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "domains" ? ok(mintGolden()) : ok({})));
    await run();
    expect(router.domains).toHaveLength(1);
    expect(router.domains[0].url).toBe(`${getApiUrl()}/catalog/domains`);
    expect(router.domains[0].method).toBe("POST");
    expect(router.domains[0].body).toEqual(MINT);
    expect(bearerToken(router.domains[0])).toBe(ACCESS);
    expect(router.search).toEqual([]);
    expect(router.lookup).toEqual([]);
    expect(router.stores).toEqual([]);
    expect(router.other).toEqual([]);
  });

  it("exactly ONE write is attempted — the mint is never retried on its own", async () => {
    // A retried mint against a route with no idempotency key is how a transient
    // blip becomes a second node.
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "domains" ? { status: 500, body: {} } : ok({})));
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(router.domains).toHaveLength(1);
  });

  it("the token never reaches a log line or the result", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domains" ? ok(mintGolden()) : ok({})));
    const payload = await run();
    expect(logBlob(api)).not.toContain(ACCESS);
    expect(JSON.stringify(payload)).not.toContain(ACCESS);
  });
});

describe("a successful mint carries the provisional signal, explicitly", () => {
  beforeEach(() => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domains" ? ok(mintGolden()) : ok({})));
  });

  it("`validated_at: null` is PRESENT in the agent's payload", async () => {
    // The agent states the web-first expectation ONCE, off this field. A stripped
    // falsy nothing makes a fence look like an empty catalog, and the agent
    // re-mints around it.
    const payload = await run();
    expect(payload["status"]).toBe("ok");
    expect(payload).toHaveProperty("validated_at");
    expect(payload["validated_at"]).toBeNull();
  });

  it("`validated_at` survives JSON serialization as `null`, not as an absent key", async () => {
    const raw = (await getTool(api, TOOL).execute("call-raw", MINT)).content[0].text as string;
    expect(raw).toContain('"validated_at"');
    expect(JSON.parse(raw)).toHaveProperty("validated_at", null);
  });

  it("the path and the minted spec keys cross verbatim", async () => {
    const payload = await run();
    expect(payload["path"]).toBe("product.sports.winter.ski.boots");
    expect(payload["specs"]).toEqual(["flex_index", "last_width_mm", "brand"]);
  });

  it("the mint result is NOT written to the search-results buffer", async () => {
    const { getSearchResult, __resetSearchResultsStore } = await import(
      "../lib/search-results-store.js"
    );
    __resetSearchResultsStore();
    await run(MINT, "call-mint-buffer");
    expect(getSearchResult("call-mint-buffer", "")).toBeNull();
  });
});

describe("A5 — the 409 is a NON-error whose recovery is re-issuing the search", () => {
  beforeEach(() => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "domains" ? { status: 409, body: MINT_409 } : ok({})));
  });

  it("surfaces `already_exists`, carrying the SAME path the agent submitted", async () => {
    const payload = await run();
    expect(payload["status"]).toBe("already_exists");
    expect(payload["path"]).toBe(MINT.path);
  });

  it("its recovery is the SEARCH, never a re-register and never another mint", async () => {
    const payload = await run();
    expect(payload["recovery"]).toBe("sil_search");
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(payload["recovery"]).not.toBe("sil_domain_create");
  });

  it("it is NOT framed as a failure — not `invalid_request`, not `retryable`, not an error", async () => {
    const payload = await run();
    for (const failure of ["invalid_request", "retryable", "must_reregister", "forbidden", "error"]) {
      expect(payload["status"]).not.toBe(failure);
    }
  });

  it("it never suggests a different or shallower path", async () => {
    // Minting `product.ski_boots` because the deep path 409'd is the
    // permanent-damage move: two nodes for one category, split forever.
    const payload = await run();
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toMatch(/shallower|another path|different path|try .*\bpath\b/);
    expect(payload["path"]).toBe(MINT.path);
  });

  it("the tokens are untouched — a 409 says nothing about the session", async () => {
    await run();
    expect(readTokens()?.access_token).toBe(ACCESS);
  });
});

describe("the refusals that ARE failures", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it("a 400 naming the offending spec surfaces verbatim", async () => {
    const body = {
      error: "invalid_request",
      message: 'spec "flex_index": a number spec must declare a unit',
    };
    installRouter((kind) => (kind === "domains" ? { status: 400, body } : ok({})));
    const payload = await run();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["message"]).toBe(body.message);
    // The message names the KEY — that is the agent's whole recourse to an
    // all-or-nothing mint failure, and it is why `data_type` stays a plain
    // string on both sides rather than a union that 400s on a schema path.
    expect(payload["message"]).toContain("flex_index");
  });

  it("a 400 MissingRoot surfaces verbatim — a path must descend from a registry root", async () => {
    const body = { error: "invalid_request", message: 'no registry root for path "zzz.ski.boots"' };
    installRouter((kind) => (kind === "domains" ? { status: 400, body } : ok({})));
    const payload = await run({ ...MINT, path: "zzz.ski.boots" });
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["message"]).toBe(body.message);
  });

  it("A1 at the tool — a 200 whose `validated_at` is not null is `retryable`", async () => {
    // A domain cannot be born validated; a body claiming so is a wire the plugin
    // does not understand, and passing it on would make the fence invisible.
    installRouter((kind) =>
      kind === "domains"
        ? ok({ ...mintGolden(), validated_at: "2026-01-01T00:00:00.000Z" })
        : ok({}),
    );
    expect((await run())["status"]).toBe("retryable");
  });

  it("A9 — a first 401 recovers silently through the shared choreography", async () => {
    const router = installRouter((kind, nth) => {
      if (kind === "domains") return nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(mintGolden());
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("ok");
    expect(router.refresh).toHaveLength(1);
    expect(router.domains).toHaveLength(2);
    expect(bearerToken(router.domains[1])).toBe("at-rotated");
  });

  it("403 `user_not_provisioned` clears the tokens; `principal_mismatch` does not", async () => {
    installRouter((kind) =>
      kind === "domains" ? { status: 403, body: AUTH.principalMismatch } : ok({}),
    );
    expect((await run(MINT, "call-a"))["reason"]).toBe("principal_mismatch");
    expect(readTokens()?.access_token).toBe(ACCESS);

    vi.restoreAllMocks();
    installRouter((kind) =>
      kind === "domains" ? { status: 403, body: AUTH.userNotProvisioned } : ok({}),
    );
    expect((await run(MINT, "call-b"))["reason"]).toBe("user_not_provisioned");
    expect(readTokens()).toBeNull();
  });
});
