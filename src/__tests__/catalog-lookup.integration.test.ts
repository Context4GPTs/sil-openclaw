/**
 * INTEGRATION — `sil_product_get` wired end to end over a mocked `fetch`.
 *
 * The lookup is the ONLY v0 route that spends money to make an answer more
 * current, so it is also the only one that can charge for freshness and not
 * deliver it. Two things follow and both are pinned here:
 *
 *   - `observed` + `observed_at` ride EVERY offer. `live` means read during this
 *     call; `stored` means quoted, with the date it was read. A `stored` price
 *     presented as the current price is the defect the route exists to prevent.
 *   - a ref that resolves to nothing is an ABSENCE, not an error and never a
 *     substitution — and the caller can say exactly WHICH refs missed, because
 *     `results[].ref` echoes the submitted ref verbatim.
 *
 * A4 lives here too, behaviourally: the same body through `sil_search` and
 * `sil_product_get` produces the same result object, because the two routes
 * answer with the same object by contract.
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
import { AUTH, GOLDEN_REFS, clone, resultFor, resultGolden, resultMissing } from "./helpers/v0-wire.js";

const TOOL = "sil_product_get";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";
const REFS = [GOLDEN_REFS.catalog, GOLDEN_REFS.web];

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-v0-lookup-"));
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

async function run(refs: string[] = REFS, callId = "call-1"): Promise<Record<string, unknown>> {
  return payloadOf(await getTool(api, TOOL).execute(callId, { refs }));
}

describe("A8 — one route, one request", () => {
  it("POSTs `/catalog/lookup` with `{ refs }` and a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "lookup" ? ok(resultGolden()) : ok({})));
    await run();
    expect(router.lookup).toHaveLength(1);
    expect(router.lookup[0].url).toBe(`${getApiUrl()}/catalog/lookup`);
    expect(router.lookup[0].body).toEqual({ refs: REFS });
    expect(bearerToken(router.lookup[0])).toBe(ACCESS);
    expect(router.search).toEqual([]);
    expect(router.stores).toEqual([]);
    expect(router.domains).toEqual([]);
    expect(router.other).toEqual([]);
  });

  it("the token never reaches a log line or the result", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "lookup" ? ok(resultGolden()) : ok({})));
    const payload = await run();
    expect(logBlob(api)).not.toContain(ACCESS);
    expect(JSON.stringify(payload)).not.toContain(ACCESS);
  });
});

describe("freshness is a claim, and `observed` is the only thing licensed to make it", () => {
  beforeEach(() => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "lookup" ? ok(resultGolden()) : ok({})));
  });

  it("EVERY offer carries `observed` and `observed_at`", async () => {
    const payload = await run();
    const offers = (payload["results"] as Record<string, unknown>[]).flatMap(
      (r) => r["offers"] as Record<string, unknown>[],
    );
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.filter((o) => o["observed"] === undefined)).toEqual([]);
    expect(offers.filter((o) => o["observed_at"] === undefined)).toEqual([]);
  });

  it("both states cross intact — `live` and `stored` are not collapsed to one", async () => {
    const payload = await run();
    const observed = (payload["results"] as Record<string, unknown>[])
      .flatMap((r) => r["offers"] as Record<string, unknown>[])
      .map((o) => o["observed"]);
    expect(new Set(observed)).toEqual(new Set(["live", "stored"]));
  });

  it("`observed` is never defaulted to `live` — an unfetched price must not claim freshness", async () => {
    // A stub that labels an offer `live` without fetching would have to forge
    // the timestamp too; the plugin must not do the first half for it.
    const payload = await run();
    const stored = (payload["results"] as Record<string, unknown>[])
      .flatMap((r) => r["offers"] as Record<string, unknown>[])
      .filter((o) => o["observed"] === "stored");
    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0]["observed_at"]).toBe("2026-01-15T10:00:00.000Z");
  });

  it("only the OFFERS are the fresh read — values, pairs and media cross as stored", async () => {
    const payload = await run();
    expect(payload["results"]).toEqual(resultGolden()["results"]);
    expect(payload["sources"]).toEqual(resultGolden()["sources"]);
  });
});

describe("a miss is an ABSENCE — the caller can say exactly which refs missed", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it("a submitted ref that resolved to nothing is simply absent from `results`", async () => {
    // The route drops it and counts it in `lookup_executed.not_found_count`;
    // that is unambiguous ONLY because `results[].ref` echoes the submitted ref.
    const missing = "variant:0198f2a1-4c3d-7000-8000-00000000dead";
    installRouter((kind) => (kind === "lookup" ? ok(resultGolden()) : ok({})));
    const payload = await run([...REFS, missing]);
    expect(payload["status"]).toBe("ok");
    expect(resultFor(payload, missing)).toBeUndefined();
    expect(resultFor(payload, GOLDEN_REFS.catalog)).toBeDefined();
  });

  it("the miss is a SUCCESS, not an error", async () => {
    installRouter((kind) => (kind === "lookup" ? ok({ ...resultGolden(), results: [] }) : ok({})));
    const payload = await run(["variant:gone-a", "variant:gone-b"]);
    expect(payload["status"]).toBe("ok");
    expect(payload["results"]).toEqual([]);
    expect(payload["status"]).not.toBe("retryable");
    expect(payload["status"]).not.toBe("not_found");
  });

  it("nothing is substituted for a missing ref — the result count matches the WIRE, not the request", async () => {
    installRouter((kind) => (kind === "lookup" ? ok(resultGolden()) : ok({})));
    const payload = await run([...REFS, "variant:gone-a", "variant:gone-b"]);
    expect((payload["results"] as unknown[]).length).toBe(2);
  });

  it("the echoed refs are exactly the wire's — never rewritten to what they resolved to", async () => {
    installRouter((kind) => (kind === "lookup" ? ok(resultGolden()) : ok({})));
    const payload = await run();
    expect((payload["results"] as Record<string, unknown>[]).map((r) => r["ref"])).toEqual([
      GOLDEN_REFS.catalog,
      GOLDEN_REFS.web,
    ]);
  });

  it("set-difference over the echoed refs names the misses exactly", async () => {
    const missing = ["variant:gone-a", "url:https://x.example/gone-b"];
    installRouter((kind) => (kind === "lookup" ? ok(resultGolden()) : ok({})));
    const submitted = [...REFS, ...missing];
    const payload = await run(submitted);
    const returned = new Set((payload["results"] as Record<string, unknown>[]).map((r) => r["ref"]));
    expect(submitted.filter((ref) => !returned.has(ref))).toEqual(missing);
  });
});

describe("A4 — the same body, the same result object, from either route", () => {
  it("`sil_search` and `sil_product_get` produce identical payloads for one wire body", async () => {
    // Not a tautology: the two tools call two routes through two call functions
    // and two envelope builders. What must not drift is the RESULT half. Only
    // the envelope's own additions are stripped before comparing.
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) =>
      kind === "search" || kind === "lookup" ? ok(resultGolden()) : ok({}),
    );

    const lookup = await run(REFS, "call-lookup");
    const search = payloadOf(
      await getTool(api, "sil_search").execute("call-search", {
        domain: "product.sports.winter.ski.boots",
        query: "boots",
        n: 2,
      }),
    );

    const strip = (p: Record<string, unknown>): Record<string, unknown> => {
      const { status: _s, advisories: _a, ...rest } = p;
      return rest;
    };
    expect(strip(lookup)).toEqual(strip(search));
    expect(lookup["status"]).toBe("ok");
    expect(search["status"]).toBe("ok");
  });

  it("A1 applies identically — a 200 missing `report` is `retryable` on BOTH routes", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) =>
      kind === "search" || kind === "lookup" ? ok(resultMissing("report")) : ok({}),
    );
    expect((await run(REFS, "call-l"))["status"]).toBe("retryable");
    const search = payloadOf(
      await getTool(api, "sil_search").execute("call-s", {
        domain: "product.x",
        query: "q",
        n: 1,
      }),
    );
    expect(search["status"]).toBe("retryable");
  });
});

describe("pass-through, at this tool too", () => {
  it("an additive server field reaches the agent unchanged", async () => {
    seedTokens(ACCESS, REFRESH);
    const wire = resultGolden();
    (wire["results"] as Record<string, unknown>[])[1]["sil_future_field"] = 42;
    installRouter((kind) => (kind === "lookup" ? ok(clone(wire)) : ok({})));
    const payload = await run();
    expect((payload["results"] as Record<string, unknown>[])[1]["sil_future_field"]).toBe(42);
  });

  it("a decimal price is still the same string", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "lookup" ? ok(resultGolden()) : ok({})));
    const payload = await run();
    const offers = (payload["results"] as Record<string, unknown>[])[1]["offers"] as Record<
      string,
      unknown
    >[];
    expect(offers[0]["price"]).toBe("529.000000");
    expect(offers[0]["list_price"]).toBe("599.000000");
  });
});

describe("the shared taxonomy behaves exactly as `sil_search`'s", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it("a 400 naming the offending ref surfaces verbatim", async () => {
    const body = {
      error: "invalid_request",
      message: 'ref "seller:evo.com" is not a lookup ref — use variant:<uuid> or url:<url>',
    };
    installRouter((kind) => (kind === "lookup" ? { status: 400, body } : ok({})));
    const payload = await run(["seller:evo.com"]);
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["message"]).toBe(body.message);
  });

  it("A9 — a first 401 recovers silently through the SAME refreshAndRetryOnce", async () => {
    const router = installRouter((kind, nth) => {
      if (kind === "lookup") return nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(resultGolden());
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("ok");
    expect(router.refresh).toHaveLength(1);
    expect(bearerToken(router.lookup[1])).toBe("at-rotated");
  });

  it("403 `user_not_provisioned` clears the tokens; `principal_mismatch` does not", async () => {
    installRouter((kind) =>
      kind === "lookup" ? { status: 403, body: AUTH.principalMismatch } : ok({}),
    );
    expect((await run(REFS, "call-a"))["reason"]).toBe("principal_mismatch");
    expect(readTokens()?.access_token).toBe(ACCESS);

    vi.restoreAllMocks();
    installRouter((kind) =>
      kind === "lookup" ? { status: 403, body: AUTH.userNotProvisioned } : ok({}),
    );
    expect((await run(REFS, "call-b"))["reason"]).toBe("user_not_provisioned");
    expect(readTokens()).toBeNull();
  });

  it("a lookup NEVER writes the search-results buffer — that side effect is `sil_search`'s alone", async () => {
    const { getSearchResult, __resetSearchResultsStore } = await import(
      "../lib/search-results-store.js"
    );
    __resetSearchResultsStore();
    installRouter((kind) => (kind === "lookup" ? ok(resultGolden()) : ok({})));
    await run(REFS, "call-lookup-buffer");
    expect(getSearchResult("call-lookup-buffer", "")).toBeNull();
  });
});
