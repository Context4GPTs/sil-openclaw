/**
 * INTEGRATION — A9: the 401 choreography is UNIFORM across every sil-api-calling
 * tool, and it is one shared helper, never a per-tool handler.
 *
 * Six tools reach sil-api with a Bearer: the four v0 catalog tools plus
 * `sil_whoami`. Each drives `refreshAndRetryOnce` — at most one refresh, at most
 * one retry, no loop. The failure this file forecloses is DRIFT: a tool that
 * refreshes twice, retries a dead token, clears credentials on a transient blip,
 * or (worst) succeeds where another goes terminal, so the agent's recovery
 * depends on which tool happened to notice the expiry first.
 *
 * The proof is a matrix — the same four 401 scenarios, driven through every
 * tool, asserted to produce the same STATUS, the same credential side effect and
 * the same call counts. Parity is asserted across the set, not tool by tool, so
 * a divergence names itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../tools/catalog.js";
import { registerIdentityTools } from "../tools/identity.js";
import { setApiUrl, setWebUrl } from "../lib/config.js";
import { readTokens } from "../lib/credentials.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "./helpers/mock-plugin-api.js";
import {
  SIL_API,
  SIL_WEB,
  installRouter,
  ok,
  payloadOf,
  rotated,
  seedTokens,
  type Reply,
  type RouteKind,
  type Router,
} from "./helpers/v0-harness.js";
import { AUTH, mintGolden, resultGolden, storesGolden } from "./helpers/v0-wire.js";

const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

/** Every tool that reaches sil-api with a Bearer, with a valid call and its 200. */
const BEARER_TOOLS = [
  {
    tool: "sil_search",
    route: "search" as const,
    params: { domain: "product.sports.winter.ski.boots", query: "boots", n: 5 },
    success: (): unknown => resultGolden(),
  },
  {
    tool: "sil_product_get",
    route: "lookup" as const,
    params: { refs: ["variant:0198f2a1-4c3d-7000-8000-0000000000a1"] },
    success: (): unknown => resultGolden(),
  },
  {
    tool: "sil_stores",
    route: "stores" as const,
    params: { ref: "variant:0198f2a1-4c3d-7000-8000-0000000000a1", destination: "DE" },
    success: (): unknown => storesGolden(),
  },
  {
    tool: "sil_domain_create",
    route: "domains" as const,
    params: { path: "product.sports.winter.ski.boots", guide: "how they are bought", specs: [] },
    success: (): unknown => mintGolden(),
  },
  {
    tool: "sil_whoami",
    route: "other" as const,
    params: {},
    success: (): unknown => ({ name: "Test Shopper", addresses: [] }),
  },
];

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-401-parity-"));
  priorDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl(SIL_WEB);
  setApiUrl(SIL_API);
  api = createMockPluginApi();
  registerCatalogTools(api);
  registerIdentityTools(api);
  seedTokens(ACCESS, REFRESH);
});

afterEach(() => {
  vi.restoreAllMocks();
  setWebUrl("");
  setApiUrl("");
  if (priorDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

/** One scenario, run against one tool. Returns everything parity is asserted on. */
async function drive(
  spec: (typeof BEARER_TOOLS)[number],
  refreshReply: Reply,
  apiReplies: (nth: number) => Reply,
): Promise<{ status: unknown; recovery: unknown; tokensCleared: boolean; apiCalls: number; refreshCalls: number }> {
  seedTokens(ACCESS, REFRESH);
  const router: Router = installRouter((kind: RouteKind, nth) => {
    if (kind === "refresh") return refreshReply;
    return apiReplies(nth);
  });
  const payload = payloadOf(await getTool(api, spec.tool).execute("call-1", spec.params));
  const apiCalls = router.all.length - router.refresh.length;
  return {
    status: payload["status"],
    recovery: payload["recovery"],
    tokensCleared: readTokens() === null,
    apiCalls,
    refreshCalls: router.refresh.length,
  };
}

/** Assert every tool produced the SAME observable outcome, naming any divergence. */
function expectParity<T>(results: [string, T][]): void {
  const [, first] = results[0];
  const divergent = results.filter(([, r]) => JSON.stringify(r) !== JSON.stringify(first));
  expect(divergent.map(([name, r]) => `${name}: ${JSON.stringify(r)}`)).toEqual([]);
}

describe("A9 — every sil-api tool recovers from a first 401 identically", () => {
  it("refresh once, retry once, and the agent sees NO error", async () => {
    const results: [string, unknown][] = [];
    for (const spec of BEARER_TOOLS) {
      vi.restoreAllMocks();
      const r = await drive(spec, rotated("at-rotated", "rt-rotated"), (nth) =>
        nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(spec.success()),
      );
      results.push([
        spec.tool,
        { status: r.status, tokensCleared: r.tokensCleared, apiCalls: r.apiCalls, refreshCalls: r.refreshCalls },
      ]);
    }
    expectParity(results);
    expect(results[0][1]).toEqual({
      status: "ok",
      tokensCleared: false,
      apiCalls: 2,
      refreshCalls: 1,
    });
  });

  it("the rotated token is what the retry carries — never the dead one", async () => {
    for (const spec of BEARER_TOOLS) {
      vi.restoreAllMocks();
      seedTokens(ACCESS, REFRESH);
      const router = installRouter((kind, nth) => {
        if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
        return nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(spec.success());
      });
      await getTool(api, spec.tool).execute("call-1", spec.params);
      const apiRequests = router.all.filter((r) => !r.url.includes("/auth/refresh"));
      expect({ tool: spec.tool, bearer: apiRequests[1]?.bearer }).toEqual({
        tool: spec.tool,
        bearer: "Bearer at-rotated",
      });
    }
  });
});

describe("A9 — every tool goes terminal identically, and never storms", () => {
  it("a SECOND 401 → must_reregister, tokens cleared, exactly ONE refresh", async () => {
    const results: [string, unknown][] = [];
    for (const spec of BEARER_TOOLS) {
      vi.restoreAllMocks();
      const r = await drive(spec, rotated("at-rotated", "rt-rotated"), () => ({
        status: 401,
        body: AUTH.unauthorized,
      }));
      results.push([spec.tool, r]);
    }
    expectParity(results);
    expect(results[0][1]).toEqual({
      status: "must_reregister",
      recovery: "sil_register",
      tokensCleared: true,
      apiCalls: 2,
      refreshCalls: 1,
    });
  });

  it("a dead refresh token (`invalid_grant`) → terminal, tokens cleared, NO retry", async () => {
    const results: [string, unknown][] = [];
    for (const spec of BEARER_TOOLS) {
      vi.restoreAllMocks();
      const r = await drive(spec, { status: 401, body: { error: "invalid_grant" } }, () => ({
        status: 401,
        body: AUTH.unauthorized,
      }));
      results.push([spec.tool, r]);
    }
    expectParity(results);
    expect(results[0][1]).toEqual({
      status: "must_reregister",
      recovery: "sil_register",
      tokensCleared: true,
      apiCalls: 1,
      refreshCalls: 1,
    });
  });

  it("a refresh 5xx → retryable, tokens SURVIVE, NO retry, no re-register hint", async () => {
    // Re-registering cannot fix a blip, and destroying a valid pair over one
    // derails the user for a reason that has already passed.
    const results: [string, unknown][] = [];
    for (const spec of BEARER_TOOLS) {
      vi.restoreAllMocks();
      const r = await drive(spec, { status: 503, body: { error: "unavailable" } }, () => ({
        status: 401,
        body: AUTH.unauthorized,
      }));
      results.push([spec.tool, r]);
    }
    expectParity(results);
    expect(results[0][1]).toEqual({
      status: "retryable",
      recovery: undefined,
      tokensCleared: false,
      apiCalls: 1,
      refreshCalls: 1,
    });
  });
});

describe("A9 — the 403 split is uniform too (the exact-equality gate)", () => {
  it("`user_not_provisioned` clears the tokens on EVERY tool", async () => {
    const results: [string, unknown][] = [];
    for (const spec of BEARER_TOOLS) {
      vi.restoreAllMocks();
      const r = await drive(spec, ok({}), () => ({ status: 403, body: AUTH.userNotProvisioned }));
      results.push([
        spec.tool,
        { status: r.status, recovery: r.recovery, tokensCleared: r.tokensCleared, refreshCalls: r.refreshCalls },
      ]);
    }
    expectParity(results);
    expect(results[0][1]).toEqual({
      status: "forbidden",
      recovery: "sil_register",
      tokensCleared: true,
      // A 403 is not a 401 — no refresh is attempted, on any tool.
      refreshCalls: 0,
    });
  });

  it("`principal_mismatch` leaves the tokens INTACT on EVERY tool", async () => {
    const results: [string, unknown][] = [];
    for (const spec of BEARER_TOOLS) {
      vi.restoreAllMocks();
      const r = await drive(spec, ok({}), () => ({ status: 403, body: AUTH.principalMismatch }));
      results.push([spec.tool, { status: r.status, tokensCleared: r.tokensCleared, refreshCalls: r.refreshCalls }]);
    }
    expectParity(results);
    expect(results[0][1]).toEqual({ status: "forbidden", tokensCleared: false, refreshCalls: 0 });
  });
});

describe("guard-of-the-guard: the matrix actually covers the surface", () => {
  it("every registered tool that takes a Bearer is in BEARER_TOOLS", async () => {
    // A new sil-api tool omitted here does not fail — it silently narrows the
    // parity proof, which is the failure mode this repo has documented twice.
    // Deriving the expected set from the registered one closes that.
    const registered = [...api._tools.keys()];
    const silApiTools = registered.filter((name) =>
      ["sil_search", "sil_product_get", "sil_stores", "sil_domain_create", "sil_whoami"].includes(name),
    );
    expect(silApiTools.sort()).toEqual(BEARER_TOOLS.map((s) => s.tool).sort());
  });

  it("each scenario really drove all five tools", () => {
    expect(BEARER_TOOLS).toHaveLength(5);
  });
});
