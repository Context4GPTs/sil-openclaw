/**
 * INTEGRATION — `sil_search` wired end to end over a mocked `fetch` (tier:
 * integration). The real tool, the real sil-client, the real credentials module
 * and the real `refreshAndRetryOnce` all run; only the network boundary is
 * doubled.
 *
 * WHAT THIS FILE IS FOR. `sil_search` is where the veto's three inputs cross the
 * tool boundary, and the criterion is FIDELITY: `predicates[]` complete, a
 * `values` entry for every resolved key INCLUDING the `unset` ones, `maturity`
 * per result, `report` verbatim. Dropping, compacting or "cleaning up" any of
 * them silently disarms the veto — the tool would look fine and the product
 * would be wrong. That is why the happy path is driven by the CHECKED-IN GOLDEN
 * (`src/__tests__/fixtures/`, copied from `sil-services` `dev` @ `6a2b5ba` and
 * Ajv-validated against the committed artifact) rather than a body written here:
 * a hand-made fixture omits exactly the fields nobody remembered, and certifies
 * a contract that does not exist.
 *
 * TWO ORIGINS, pinned to distinct hosts so a misfire is caught: the search reads
 * sil-api at the BARE `/catalog/search`; a 401 refreshes against sil-web.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** This suite's own fixtures directory — the plugin's only link to `@sil/schemas`. */
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

import { registerCatalogTools } from "../tools/catalog.js";
import { setApiUrl, setWebUrl, getApiUrl } from "../lib/config.js";
import { getTokensPath, readTokens } from "../lib/credentials.js";
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
  rotated,
  seedTokens,
  type Router,
} from "./helpers/v0-harness.js";
import {
  AUTH,
  GOLDEN_REFS,
  SEARCH_400,
  clone,
  resultEmpty,
  resultGolden,
  resultMissing,
} from "./helpers/v0-wire.js";

const TOOL = "sil_search";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

const PARAMS = {
  domain: "product.sports.winter.ski.boots",
  query: "stiff all-mountain boots for a wide foot",
  n: 8,
  predicates: [{ key: "flex_index", op: "gte", value: 110 }],
  destination: "DE",
};

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-v0-search-"));
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
  params: Record<string, unknown> = PARAMS,
  callId = "call-1",
): Promise<Record<string, unknown>> {
  return payloadOf(await getTool(api, TOOL).execute(callId, params));
}

/** The tool payload minus the envelope's own additions — what the route sent. */
function routeBodyOf(payload: Record<string, unknown>): Record<string, unknown> {
  const { status: _status, advisories: _advisories, ...body } = payload;
  return body;
}

describe("A10 — the golden fixture is the artifact link", () => {
  let router: Router;

  beforeEach(() => {
    seedTokens(ACCESS, REFRESH);
    router = installRouter((kind) => (kind === "search" ? ok(resultGolden()) : ok({})));
  });

  it("the golden drives the tool to `ok`", async () => {
    expect((await run())["status"]).toBe("ok");
  });

  it("the payload equals the fixture VERBATIM — nothing added, dropped or re-ordered", async () => {
    // The whole of A3 and A10 in one assertion: a projection cannot pass it, and
    // neither can a defaulted key, a renamed field or a reordered list.
    expect(routeBodyOf(await run())).toEqual(resultGolden());
  });

  it("the fixture itself carries `offers[].observed` on EVERY offer (guard-of-the-guard)", () => {
    // A hand-written fixture would quietly omit `observed` and certify a
    // contract that does not exist. `observed` is REQUIRED on both routes by the
    // sibling's own schema, deliberately, for the omitted-key-vs-stated-gap
    // reason that governs the whole wire.
    const results = resultGolden()["results"] as Record<string, unknown>[];
    const offers = results.flatMap((r) => r["offers"] as Record<string, unknown>[]);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.filter((o) => o["observed"] === undefined)).toEqual([]);
    // Both states present, so a test asserting one is not passing by accident.
    expect(new Set(offers.map((o) => o["observed"]))).toEqual(new Set(["live", "stored"]));
  });

  it("the fixture's PROVENANCE is recorded beside it — the source repo, ref and commit", () => {
    // Wire types are mirrored, never imported, so the fixture is the only thing
    // binding this plugin to `@sil/schemas`. A fixture with no stated source is
    // indistinguishable from one somebody invented.
    const readme = readFileSync(join(FIXTURES_DIR, "README.md"), "utf8");
    expect(existsSync(join(FIXTURES_DIR, "catalog-result-response.golden.json"))).toBe(true);
    expect(readme).toContain("sil-services");
    expect(readme).toContain("catalog-result-response.golden.json");
    // A commit, not "latest" — a moving reference is not provenance.
    expect(readme).toMatch(/\b[0-9a-f]{7,40}\b/);
  });

  it("exactly ONE fetch is issued, and no request reaches an unrouted path", async () => {
    await run();
    expect(router.all).toHaveLength(1);
    expect(router.other).toEqual([]);
  });
});

describe("the veto's three inputs cross the tool boundary INTACT", () => {
  beforeEach(() => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "search" ? ok(resultGolden()) : ok({})));
  });

  it("`predicates[]` arrives complete — every entry, in submission order", async () => {
    const payload = await run();
    expect(payload["predicates"]).toEqual(resultGolden()["predicates"]);
  });

  it("an `applied: false` predicate is SURFACED, not dropped", async () => {
    // A key outside the resolved vocabulary is not an error — it is a named gap
    // the agent turns into NOT VERIFIED. Dropping it reports the requirement as
    // satisfied.
    const payload = await run();
    const predicates = payload["predicates"] as { key: string; applied: unknown }[];
    expect(predicates.find((p) => p.key === "buckle_count")?.applied).toBe(false);
  });

  it("NO result is dropped because a predicate did not apply", async () => {
    const payload = await run();
    expect((payload["results"] as unknown[]).length).toBe(2);
  });

  it("every `values` entry survives, `unset` ones included", async () => {
    const payload = await run();
    const values = (payload["results"] as Record<string, unknown>[])[0]["values"];
    expect(values).toEqual({
      brand: {
        state: "set",
        value: "Lange",
        origin: "observed",
        source_ref: "url:https://evo.com/lange-lx-120",
        observed_at: "2026-01-15T10:00:00.000Z",
      },
      flex_index: { state: "unset" },
    });
  });

  it("`maturity` is present on EVERY result", async () => {
    const payload = await run();
    const results = payload["results"] as Record<string, unknown>[];
    expect(results.map((r) => r["maturity"])).toEqual(["catalog", "web"]);
  });

  it("`report` crosses verbatim — `blocked` is what stops a short answer reading as exhaustive", async () => {
    const payload = await run();
    expect(payload["report"]).toEqual({ searches: 1, fetched: 2, blocked: 1 });
  });

  it("`sources` crosses verbatim, so every ref stays followable", async () => {
    const payload = await run();
    expect(payload["sources"]).toEqual(resultGolden()["sources"]);
  });

  it("server rank order is preserved — no sort, no filter, no dedupe", async () => {
    const payload = await run();
    expect((payload["results"] as Record<string, unknown>[]).map((r) => r["ref"])).toEqual([
      GOLDEN_REFS.catalog,
      GOLDEN_REFS.web,
    ]);
  });

  it("a `maturity: 'web'` result carries NO exclusion / invalid / lower-confidence marker", async () => {
    const payload = await run();
    const web = (payload["results"] as Record<string, unknown>[])[1];
    expect(web["ref"]).toBe(GOLDEN_REFS.web);
    for (const banned of ["flagged", "excluded", "invalid", "confidence", "verified", "score"]) {
      expect(web).not.toHaveProperty(banned);
    }
  });

  it("a decimal price is still the same STRING at the tool boundary", async () => {
    const payload = await run();
    const offer = ((payload["results"] as Record<string, unknown>[])[0]["offers"] as Record<
      string,
      unknown
    >[])[0];
    expect(offer["price"]).toBe("449.990000");
  });

  it("absent optionals are still ABSENT in `content[0].text`", async () => {
    // Serialization is where a `null` gets manufactured. `JSON.stringify` drops
    // `undefined`, so a defaulted-to-undefined field would LOOK correct here —
    // the assertion is on the parsed text, which is what the agent receives.
    const payload = await run();
    const first = (payload["results"] as Record<string, unknown>[])[0];
    expect(first["product"]).not.toHaveProperty("description");
    expect((first["offers"] as Record<string, unknown>[])[0]).not.toHaveProperty("buy_url");
    expect(
      ((first["offers"] as Record<string, unknown>[])[0]["seller"] as Record<string, unknown>),
    ).not.toHaveProperty("display_name");
  });

  it("a server field the plugin does not declare still reaches the agent", async () => {
    const wire = resultGolden();
    (wire["results"] as Record<string, unknown>[])[0]["sil_future_field"] = { nested: true };
    installRouter((kind) => (kind === "search" ? ok(clone(wire)) : ok({})));
    const payload = await run();
    expect((payload["results"] as Record<string, unknown>[])[0]["sil_future_field"]).toEqual({
      nested: true,
    });
  });
});

describe("A8 — one route, one request", () => {
  it("POSTs `getApiUrl()` + `/catalog/search` with a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "search" ? ok(resultGolden()) : ok({})));
    await run();
    expect(router.search).toHaveLength(1);
    expect(router.search[0].url).toBe(`${getApiUrl()}/catalog/search`);
    expect(router.search[0].method).toBe("POST");
    expect(bearerToken(router.search[0])).toBe(ACCESS);
    // Not a single request to any other route or origin.
    expect(router.lookup).toEqual([]);
    expect(router.stores).toEqual([]);
    expect(router.domains).toEqual([]);
    expect(router.refresh).toEqual([]);
    expect(router.other).toEqual([]);
  });

  it("sends the agent's parameters and nothing the route would 400 on", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "search" ? ok(resultGolden()) : ok({})));
    await run();
    expect(router.search[0].body).toEqual(PARAMS);
  });

  it("the token never appears in a log line", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "search" ? ok(resultGolden()) : ok({})));
    await run();
    expect(logBlob(api)).not.toContain(ACCESS);
    expect(logBlob(api)).not.toContain(REFRESH);
  });

  it("the token never appears in the tool result", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "search" ? ok(resultGolden()) : ok({})));
    expect(JSON.stringify(await run())).not.toContain(ACCESS);
  });
});

describe("the outcome taxonomy, at the tool boundary", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it("a 200 with `results: []` is a SUCCESS with an empty list, not an error", async () => {
    installRouter((kind) => (kind === "search" ? ok(resultEmpty()) : ok({})));
    const payload = await run();
    expect(payload["status"]).toBe("ok");
    expect(payload["results"]).toEqual([]);
  });

  it("A1 at the tool — a 200 missing `predicates` surfaces `retryable`, never `ok`", async () => {
    installRouter((kind) => (kind === "search" ? ok(resultMissing("predicates")) : ok({})));
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(payload).not.toHaveProperty("results");
  });

  it("a route body declaring its own `status` never becomes the tool's dispatch key", async () => {
    // The envelope is `{ status: "ok", ...routeBody, ...wiringAdvisories(api) }`
    // and the later spread wins, so an unguarded body hands the agent
    // `status: "partial"` — a sil-services value sitting inside the TOOL's status
    // taxonomy, with no recovery arm to match it, on a ToolResult that looks
    // perfectly healthy. The unit gate refuses it; this is the consequence the
    // gate exists for, asserted where the agent actually reads it.
    installRouter((kind) =>
      kind === "search" ? ok({ ...resultGolden(), status: "partial" }) : ok({}),
    );
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(payload["status"]).not.toBe("partial");
    expect(payload).not.toHaveProperty("results");
  });

  it("a route body declaring its own `advisories` cannot displace the plugin's", async () => {
    // The mirror-image loss: ours is the LAST spread, so an unguarded body would
    // have its `advisories` silently overwritten by the plugin's — the one place
    // a verbatim pass-through drops a server field. Refused whole instead, so the
    // route's array never surfaces under the key the agent reads as sil's own
    // wiring findings.
    installRouter((kind) =>
      kind === "search"
        ? ok({ ...resultGolden(), advisories: [{ id: "route.side_channel", severity: "warn" }] })
        : ok({}),
    );
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(payload).not.toHaveProperty("advisories");
    expect(payload).not.toHaveProperty("results");
  });

  it("the unknown-domain 400 surfaces the route's message VERBATIM, with no added copy", async () => {
    installRouter((kind) =>
      kind === "search" ? { status: 400, body: SEARCH_400.unknownDomain } : ok({}),
    );
    const payload = await run();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["message"]).toBe(SEARCH_400.unknownDomain.message);
    // The message already says "mint it first". The plugin adds nothing, so it
    // cannot drift from the sibling's wording.
    expect(payload["error"]).toBe("invalid_request");
  });

  it("the refusal is never framed as 'sil has nothing' and never as a retry", async () => {
    installRouter((kind) =>
      kind === "search" ? { status: 400, body: SEARCH_400.unknownDomain } : ok({}),
    );
    const payload = await run();
    expect(payload["status"]).not.toBe("retryable");
    expect(payload).not.toHaveProperty("results");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/no products|try again/);
  });

  it("the two 400s reach the agent as DIFFERENT payloads — the message is the discriminator", async () => {
    // The wire has no other one: `handlers/search.ts:84` and `:97` both send
    // `error: "invalid_request"`. Both messages cross verbatim, so an agent can
    // tell them apart; a MACHINE-readable split needs a distinct `error` code
    // from sil-services and is signalled up, not faked here.
    installRouter((kind) =>
      kind === "search" ? { status: 400, body: SEARCH_400.unknownDomain } : ok({}),
    );
    const domain = await run(PARAMS, "call-a");
    vi.restoreAllMocks();
    installRouter((kind) =>
      kind === "search" ? { status: 400, body: SEARCH_400.predicateGrammar } : ok({}),
    );
    const grammar = await run(PARAMS, "call-b");
    expect(domain).not.toEqual(grammar);
    expect(domain["message"]).not.toBe(grammar["message"]);
  });

  it("a 403 `user_not_provisioned` is forbidden, clears the tokens, and points at sil_register", async () => {
    installRouter((kind) =>
      kind === "search" ? { status: 403, body: AUTH.userNotProvisioned } : ok({}),
    );
    const payload = await run();
    expect(payload["status"]).toBe("forbidden");
    expect(payload["reason"]).toBe("user_not_provisioned");
    expect(payload["recovery"]).toBe("sil_register");
    expect(readTokens()).toBeNull();
  });

  it("a 403 `principal_mismatch` is forbidden but leaves the tokens INTACT", async () => {
    // The exact-equality gate: only `user_not_provisioned` clears. A mismatch is
    // a caller defect, and destroying a working session over it is a worse bug
    // than the mismatch.
    installRouter((kind) =>
      kind === "search" ? { status: 403, body: AUTH.principalMismatch } : ok({}),
    );
    const payload = await run();
    expect(payload["status"]).toBe("forbidden");
    expect(payload["reason"]).toBe("principal_mismatch");
    expect(readTokens()?.access_token).toBe(ACCESS);
    expect(existsSync(getTokensPath())).toBe(true);
  });

  it("a 503 is retryable and does NOT point at sil_register", async () => {
    installRouter((kind) =>
      kind === "search" ? { status: 503, body: AUTH.serviceUnavailable } : ok({}),
    );
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).toBeUndefined();
    expect(readTokens()?.access_token).toBe(ACCESS);
  });

  it("a network failure is retryable, never a fabricated empty result set", async () => {
    installRouter((kind) => (kind === "search" ? "network-error" : ok({})));
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(payload).not.toHaveProperty("results");
  });
});

describe("A9 — the 401 choreography, on this tool", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it("a first 401 recovers silently: refresh once, retry once, agent sees no error", async () => {
    const router = installRouter((kind, nth) => {
      if (kind === "search") return nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(resultGolden());
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("ok");
    expect(router.search).toHaveLength(2);
    expect(router.refresh).toHaveLength(1);
    expect(bearerToken(router.search[1])).toBe("at-rotated");
    expect(readTokens()?.access_token).toBe("at-rotated");
  });

  it("the silent recovery is visible to the OPERATOR, exactly once", async () => {
    const api2 = createMockPluginApi();
    registerCatalogTools(api2);
    installRouter((kind, nth) => {
      if (kind === "search") return nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(resultGolden());
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    await getTool(api2, TOOL).execute("call-1", PARAMS);
    expect(infoMarkerCount(api2, "sil_search_refreshed")).toBe(1);
  });

  it("a first-try success emits NO refresh marker", async () => {
    installRouter((kind) => (kind === "search" ? ok(resultGolden()) : ok({})));
    await run();
    expect(infoMarkerCount(api, "sil_search_refreshed")).toBe(0);
  });

  it("a SECOND 401 is terminal `must_reregister`, tokens cleared, and NEVER a second refresh", async () => {
    const router = installRouter((kind) => {
      if (kind === "search") return { status: 401, body: AUTH.unauthorized };
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("must_reregister");
    expect(payload["recovery"]).toBe("sil_register");
    expect(router.refresh).toHaveLength(1);
    expect(router.search).toHaveLength(2);
    expect(readTokens()).toBeNull();
  });

  it("a dead refresh token (`invalid_grant`) is terminal with NO retry", async () => {
    const router = installRouter((kind) => {
      if (kind === "search") return { status: 401, body: AUTH.unauthorized };
      if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("must_reregister");
    expect(router.search).toHaveLength(1);
    expect(readTokens()).toBeNull();
  });

  it("a refresh 5xx is TRANSIENT — retryable, no retry, and the tokens survive", async () => {
    // Re-registering cannot fix a blip, and destroying a valid pair over one
    // would derail the user for a reason that has already passed.
    const router = installRouter((kind) => {
      if (kind === "search") return { status: 401, body: AUTH.unauthorized };
      if (kind === "refresh") return { status: 503, body: { error: "unavailable" } };
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).toBeUndefined();
    expect(router.search).toHaveLength(1);
    expect(readTokens()?.refresh_token).toBe(REFRESH);
  });
});

describe("A12 — the envelope is channel-agnostic", () => {
  it("`sil_search`'s ToolResult is byte-identical with and without the gateway method", async () => {
    // The buffer write is a pure SIDE EFFECT on the `ok` arm: no flag, no added
    // key, no listener check. If the envelope differed, the agent's answer would
    // depend on whether a client happened to be paired.
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "search" ? ok(resultGolden()) : ok({})));

    const withoutMethod = createMockPluginApi();
    registerCatalogTools(withoutMethod);
    const a = await getTool(withoutMethod, TOOL).execute("call-x", PARAMS);

    const withMethod = createMockPluginApi();
    registerCatalogTools(withMethod);
    const { registerSearchResultsMethod } = await import("../gateway/search-results.js");
    registerSearchResultsMethod(withMethod);
    const b = await getTool(withMethod, TOOL).execute("call-x", PARAMS);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("`advisories` never enter the buffered page — that page is product data only", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "search" ? ok(resultGolden()) : ok({})));
    const { getSearchResult, __resetSearchResultsStore } = await import(
      "../lib/search-results-store.js"
    );
    __resetSearchResultsStore();
    await run(PARAMS, "call-buffered");
    // The principal is whatever the tool binds the page to; the page's SHAPE is
    // what matters here, and `advisories` must not be in it under any principal.
    const serialized = JSON.stringify(getSearchResult("call-buffered", "") ?? {});
    expect(serialized).not.toContain("advisories");
  });
});
