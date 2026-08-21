/**
 * INTEGRATION — `sil_domain_find` wired end to end over a mocked `fetch`.
 *
 * THE VERB IS THE WHOLE SAFETY PROPERTY. `/catalog/domains` is the first sil-api
 * path served by two verbs, and the two could not be further apart: `GET` reads
 * the registry and writes nothing, `POST` performs v0's ONE permanent,
 * un-undoable global write. A read that used the wrong verb would turn a
 * discovery call into a mint — so the shared double buckets by METHOD, and every
 * assertion below reads `router.domainFind` (the read) and `router.domains` (the
 * mint) as separate lists. A read that reached the mint bucket fails loudly here
 * rather than being narrated as safe.
 *
 * TWO ANSWERS CARRY THE PRODUCT WEIGHT, and they are the two an ordinary "did it
 * return 200" test cannot tell apart:
 *
 *   - `matches: []` beside `capped: false` is a SUCCESS and the ONLY thing that
 *     licenses the mint. Read as a failure — or as an absence — the agent is back
 *     to the cold-start behaviour this card exists to delete.
 *   - the payload passes through VERBATIM. `inherited` and `defined_at` are what
 *     let an agent coin only the keys a path does not already inherit; a
 *     projector that dropped them would leave that rule unexecutable while every
 *     status assertion here stayed green.
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
  infoMarkerCount,
  installRouter,
  logBlob,
  ok,
  payloadOf,
  queryOf,
  rotated,
  seedTokens,
} from "./helpers/v0-harness.js";
import {
  AUTH,
  FIND_400_BOTH,
  FIND_400_NEITHER,
  GOLDEN_DOMAINS,
  domainFindCapped,
  domainFindEmpty,
  domainFindGolden,
  domainFindProbeMiss,
  matchFor,
} from "./helpers/v0-wire.js";

const TOOL = "sil_domain_find";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const ASK = { q: "ski boots for a heavy aggressive skier" };
const PROBE = { path: "product.sports.winter.ski.boots.freeride" };

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-v0-find-"));
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
  params: Record<string, unknown> = ASK,
  callId = "call-1",
): Promise<Record<string, unknown>> {
  return payloadOf(await getTool(api, TOOL).execute(callId, params));
}

/** The double, answering the read with `body` and everything else with `{}`. */
function serve(body: unknown = domainFindGolden()) {
  return installRouter((kind) => (kind === "domainFind" ? ok(body) : ok({})));
}

describe("one route, one request — and the write is never entered", () => {
  it("GETs `/catalog/domains?q=…` with a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = serve();
    await run();

    expect(router.domainFind).toHaveLength(1);
    const [request] = router.domainFind;
    expect(request.method).toBe("GET");
    expect(request.url.startsWith(`${getApiUrl()}/catalog/domains?`)).toBe(true);
    expect([...queryOf(request).keys()]).toEqual(["q"]);
    expect(queryOf(request).get("q")).toBe(ASK.q);
    expect(bearerToken(request)).toBe(ACCESS);
  });

  it("the GET carries NO body and NO content-type — it is a read", async () => {
    // A GET body is at best ignored and in strict fetch environments throws; the
    // principal comes from the Bearer JWT, never from a request body.
    seedTokens(ACCESS, REFRESH);
    const router = serve();
    await run();
    expect(router.domainFind[0].hasBody).toBe(false);
    expect(router.domainFind[0].body).toBeNull();
  });

  it("the MINT bucket stays empty — a read never performs the global write", async () => {
    // The structural half of BR-1. `POST /catalog/domains` and
    // `GET /catalog/domains` are separate buckets in the double precisely so
    // this is an assertion rather than a claim.
    seedTokens(ACCESS, REFRESH);
    const router = serve();
    await run();
    expect(router.domains).toEqual([]);
  });

  it("no other route is touched, and nothing lands unrouted", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = serve();
    await run();
    expect(router.search).toEqual([]);
    expect(router.lookup).toEqual([]);
    expect(router.stores).toEqual([]);
    expect(router.refresh).toEqual([]);
    expect(router.other).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("a `path` probe GETs the same route with exactly `?path=`", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = serve(domainFindProbeMiss(PROBE.path));
    await run(PROBE);
    expect(router.domainFind).toHaveLength(1);
    expect([...queryOf(router.domainFind[0]).keys()]).toEqual(["path"]);
    expect(queryOf(router.domainFind[0]).get("path")).toBe(PROBE.path);
    expect(router.domains).toEqual([]);
  });

  it("the token never reaches a log line or the result", async () => {
    seedTokens(ACCESS, REFRESH);
    serve();
    const payload = await run();
    expect(logBlob(api)).not.toContain(ACCESS);
    expect(logBlob(api)).not.toContain(REFRESH);
    expect(JSON.stringify(payload)).not.toContain(ACCESS);
  });

  it("the buyer's ask does not leak into a log line either", async () => {
    // The ask is the buyer's own words. It travels to sil-api as the read's
    // evidence; it is not operator telemetry.
    seedTokens(ACCESS, REFRESH);
    serve();
    await run();
    expect(logBlob(api)).not.toContain(ASK.q);
  });

  it("the read is NOT written to the search-results buffer — it holds no products", async () => {
    const { getSearchResult, __resetSearchResultsStore } = await import(
      "../lib/search-results-store.js"
    );
    __resetSearchResultsStore();
    seedTokens(ACCESS, REFRESH);
    serve();
    await run(ASK, "call-find-buffer");
    expect(getSearchResult("call-find-buffer", "")).toBeNull();
  });
});

describe("the answer crosses the tool boundary whole", () => {
  beforeEach(() => {
    seedTokens(ACCESS, REFRESH);
    serve();
  });

  it("`status: ok` beside the wire body, unprojected", async () => {
    const payload = await run();
    const wire = domainFindGolden();
    expect(payload["status"]).toBe("ok");
    expect(payload["matches"]).toEqual(wire["matches"]);
    expect(payload["capped"]).toEqual(wire["capped"]);
  });

  it("`capped: false` is PRESENT, not stripped as a falsy nothing", async () => {
    // Half the mint licence. A dropped `capped` reads as "the list was complete"
    // to an agent that cannot see it was never told.
    const payload = await run();
    expect(payload).toHaveProperty("capped");
    expect(payload["capped"]).toBe(false);
  });

  it("`capped` survives JSON serialization as `false`, not as an absent key", async () => {
    const raw = (await getTool(api, TOOL).execute("call-raw", ASK)).content[0].text as string;
    expect(raw).toContain('"capped"');
    expect(JSON.parse(raw)).toHaveProperty("capped", false);
  });

  it("every `DomainSpecWire` field arrives — including the two BR-4 is computed from", async () => {
    // `inherited` and `defined_at` are what let an agent coin ONLY the keys a
    // path does not already inherit. A projector that dropped them would leave
    // that rule unexecutable while every status assertion in this file stayed
    // green — which is why this is asserted field by field, on a real body.
    const payload = await run();
    const match = matchFor(payload, GOLDEN_DOMAINS.validated);
    const specs = match["specs"] as Record<string, unknown>[];
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(Object.keys(spec).sort()).toEqual([
        "allowed_values",
        "data_type",
        "defined_at",
        "display_name",
        "inherited",
        "key",
        "level",
        "unit",
        "value_set",
      ]);
    }
  });

  it("the INHERITED key keeps its ancestor's `defined_at` — the shadow rule, made visible", async () => {
    const payload = await run();
    const specs = matchFor(payload, GOLDEN_DOMAINS.validated)["specs"] as Record<
      string,
      unknown
    >[];
    const brand = specs.find((s) => s["key"] === "brand");
    expect(brand?.["inherited"]).toBe(true);
    expect(brand?.["defined_at"]).toBe("product");
    expect(brand?.["value_set"]).toBe("brands");
    const flex = specs.find((s) => s["key"] === "flex_index");
    expect(flex?.["inherited"]).toBe(false);
    expect(flex?.["unit"]).toBe("count");
  });

  it("a NULL field is a stated fact, not a dropped key", async () => {
    // `unit: null` on an enum and `allowed_values: null` on a number are the
    // answer, and an omitted key is a different one.
    const payload = await run();
    const specs = matchFor(payload, GOLDEN_DOMAINS.validated)["specs"] as Record<
      string,
      unknown
    >[];
    const brand = specs.find((s) => s["key"] === "brand");
    expect(brand).toHaveProperty("unit", null);
    expect(brand).toHaveProperty("allowed_values", null);
    const soleNorm = specs.find((s) => s["key"] === "sole_norm");
    expect(soleNorm?.["allowed_values"]).toEqual(["gripwalk", "alpine"]);
    expect(soleNorm).toHaveProperty("value_set", null);
  });

  it("the `guide` is verbatim and untruncated — it is what fit is judged on", async () => {
    // A shortened guide reads as a complete one, and adopting a domain that is
    // not the buyer's pollutes silently — harder to see than a duplicate mint.
    const payload = await run();
    const wire = matchFor(domainFindGolden(), GOLDEN_DOMAINS.validated);
    expect(matchFor(payload, GOLDEN_DOMAINS.validated)["guide"]).toBe(wire["guide"]);
  });

  it("a FENCED match keeps its place, with the fence stated", async () => {
    // `validated_at: null` means minted but not yet validated. It is a real
    // domain, it is adopted like any other, and re-minting it earns a 409 —
    // so it must be returned, never quietly held back.
    const payload = await run();
    const fenced = matchFor(payload, GOLDEN_DOMAINS.fenced);
    expect(fenced).toHaveProperty("validated_at", null);
    expect(fenced["exists"]).toBe(true);
  });

  it("`exists` is present on every match", async () => {
    const payload = await run();
    for (const match of payload["matches"] as Record<string, unknown>[]) {
      expect(typeof match["exists"]).toBe("boolean");
    }
  });
});

describe("the empty answer is the MINT SIGNAL, and it is a success", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it("`matches: []` with `capped: false` reaches the agent as `ok`", async () => {
    serve(domainFindEmpty());
    const payload = await run();
    expect(payload["status"]).toBe("ok");
    expect(payload["matches"]).toEqual([]);
    expect(payload["capped"]).toBe(false);
  });

  it("the empty answer is never framed as a failure or an absence", async () => {
    serve(domainFindEmpty());
    const payload = await run();
    for (const failure of ["not_found", "invalid_request", "retryable", "must_reregister", "error"]) {
      expect(payload["status"]).not.toBe(failure);
    }
    expect(payload).not.toHaveProperty("recovery");
  });

  it("`matches: []` survives serialization as an empty array, not an absent key", async () => {
    serve(domainFindEmpty());
    const raw = (await getTool(api, TOOL).execute("call-empty", ASK)).content[0].text as string;
    expect(raw).toContain('"matches"');
    expect(JSON.parse(raw)).toHaveProperty("matches", []);
  });

  it("`capped: true` crosses intact — a bounded list is not an empty one", async () => {
    // The one that re-creates the whole defect if it is lost: an agent that
    // reads a bounded list, sees nothing fit and mints, while the standing path
    // sat just past the bound.
    serve(domainFindCapped());
    const payload = await run();
    expect(payload["status"]).toBe("ok");
    expect(payload["capped"]).toBe(true);
  });
});

describe("the probe answers about ONE path, and states both facts", () => {
  it("`exists: false` arrives beside the vocabulary the path WOULD inherit", async () => {
    seedTokens(ACCESS, REFRESH);
    serve(domainFindProbeMiss(PROBE.path));
    const payload = await run(PROBE);
    expect(payload["status"]).toBe("ok");
    const [match] = payload["matches"] as Record<string, unknown>[];
    expect(match["path"]).toBe(PROBE.path);
    expect(match["exists"]).toBe(false);
    expect(match).toHaveProperty("guide", null);
    expect((match["specs"] as unknown[]).length).toBeGreaterThan(0);
  });

  it("a probe MISS is NOT an empty answer — `matches` carries one element", async () => {
    // The distinction BR-4 rests on: a probe answers only about the path already
    // guessed, so its miss can shape a mint but must never license one.
    seedTokens(ACCESS, REFRESH);
    serve(domainFindProbeMiss(PROBE.path));
    const payload = await run(PROBE);
    expect((payload["matches"] as unknown[]).length).toBe(1);
  });
});

describe("the refusals", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it.each([
    ["neither", FIND_400_NEITHER, {}],
    ["both", FIND_400_BOTH, { q: "ski boots", path: "product.sports.winter.ski.boots" }],
  ])("a 400 for %s surfaces the route's own message VERBATIM", async (_label, body, params) => {
    installRouter((kind) => (kind === "domainFind" ? { status: 400, body } : ok({})));
    const payload = await run(params);
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_request");
    expect(payload["message"]).toBe(body.message);
    // No `recovery` on a 400: auth is fine, and re-sending the same querystring
    // cannot succeed.
    expect(payload).not.toHaveProperty("recovery");
  });

  it("a refusal carries NO `matches` the agent could read as an empty shelf", async () => {
    // BR-2, at the tool boundary: a read that did not return is not a read that
    // returned nothing.
    installRouter((kind) =>
      kind === "domainFind" ? { status: 400, body: FIND_400_NEITHER } : ok({}),
    );
    const payload = await run({});
    expect(payload).not.toHaveProperty("matches");
    expect(payload).not.toHaveProperty("capped");
  });

  it("a transient failure carries no `matches` either, and asks for a retry", async () => {
    installRouter((kind) => (kind === "domainFind" ? { status: 503, body: {} } : ok({})));
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(payload).not.toHaveProperty("matches");
    expect(payload["recovery"]).not.toBe("sil_register");
  });

  it("a network failure is `retryable`, and exactly one request was attempted", async () => {
    const router = installRouter((kind) => (kind === "domainFind" ? "network-error" : ok({})));
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(router.domainFind).toHaveLength(1);
  });

  it("a 200 the gate refuses is `retryable`, never a false `ok`", async () => {
    // A body that cannot state `capped` cannot support the mint decision, so it
    // is unusable rather than degraded.
    const body = domainFindGolden();
    delete body["capped"];
    serve(body);
    expect((await run())["status"]).toBe("retryable");
  });
});

describe("A9 — the 401 choreography is the shared one", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it("a first 401 recovers silently — one refresh, one retry, the agent sees `ok`", async () => {
    const router = installRouter((kind, nth) => {
      if (kind === "domainFind") {
        return nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(domainFindGolden());
      }
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("ok");
    expect(router.refresh).toHaveLength(1);
    expect(router.domainFind).toHaveLength(2);
    expect(bearerToken(router.domainFind[1])).toBe("at-rotated");
    // The operator's only view of an otherwise-invisible recovery. Logs-only —
    // it adds no field to the agent-facing payload.
    expect(infoMarkerCount(api, "sil_domain_find_refreshed")).toBe(1);
    expect(payload).not.toHaveProperty("refreshed");
  });

  it("the retry re-sends the SAME querystring — a recovery never re-asks a different question", async () => {
    const router = installRouter((kind, nth) => {
      if (kind === "domainFind") {
        return nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(domainFindGolden());
      }
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    await run();
    expect(queryOf(router.domainFind[1]).get("q")).toBe(queryOf(router.domainFind[0]).get("q"));
    expect([...queryOf(router.domainFind[1]).keys()]).toEqual(["q"]);
  });

  it("a SECOND 401 clears the tokens and is terminal `must_reregister`", async () => {
    const router = installRouter((kind) => {
      if (kind === "domainFind") return { status: 401, body: AUTH.unauthorized };
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("must_reregister");
    expect(payload["recovery"]).toBe("sil_register");
    expect(readTokens()).toBeNull();
    expect(router.refresh).toHaveLength(1);
    expect(router.domainFind).toHaveLength(2);
  });

  it("a refresh 5xx is `retryable`, the tokens SURVIVE, and no retry is made", async () => {
    const router = installRouter((kind) => {
      if (kind === "domainFind") return { status: 401, body: AUTH.unauthorized };
      if (kind === "refresh") return { status: 503, body: { error: "unavailable" } };
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(readTokens()?.access_token).toBe(ACCESS);
    expect(router.domainFind).toHaveLength(1);
  });

  it("403 `user_not_provisioned` clears the tokens; `principal_mismatch` does not", async () => {
    installRouter((kind) =>
      kind === "domainFind" ? { status: 403, body: AUTH.principalMismatch } : ok({}),
    );
    expect((await run(ASK, "call-a"))["reason"]).toBe("principal_mismatch");
    expect(readTokens()?.access_token).toBe(ACCESS);

    vi.restoreAllMocks();
    installRouter((kind) =>
      kind === "domainFind" ? { status: 403, body: AUTH.userNotProvisioned } : ok({}),
    );
    expect((await run(ASK, "call-b"))["reason"]).toBe("user_not_provisioned");
    expect(readTokens()).toBeNull();
  });

  it("no 401 path ever reaches the MINT route", async () => {
    // The worst available failure on this surface: a recovery that retried the
    // wrong verb would perform the permanent write while recovering from an
    // expired session.
    const router = installRouter((kind, nth) => {
      if (kind === "domainFind") {
        return nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(domainFindGolden());
      }
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    await run();
    expect(router.domains).toEqual([]);
    expect(router.other).toEqual([]);
  });
});
