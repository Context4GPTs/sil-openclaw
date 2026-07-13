/**
 * INTEGRATION — sil_specs canonicalization against sil-api (tier: integration).
 *
 * CARD `sds-specs-client-tool` (epic `spec-driven-shopping-redesign`, Phase 3). The
 * real `sil_specs` tool wired through the real sil-client (`specsCatalog` +
 * `classifySpecsResponse` + `extractSpecsResult`) and the real credentials module.
 * The ONLY thing mocked is `fetch` — the host/network boundary. There is no live
 * sil-api or Postgres in this repo; the true cross-service guarantee (a real registry
 * dedupe over the wire) is sil-stage's deferred eval. Here we prove the whole
 * PLUGIN-SIDE contract — param→request mapping, the outcome taxonomy, the matched/
 * created resolution surfacing, the shared 401 choreography, and token privacy —
 * against a mocked boundary, exactly as `catalog-search.integration.test.ts` proves
 * search.
 *
 * TWO ORIGINS: the canonicalization targets the resolved **sil-api** origin
 * (`getApiUrl`), at the BARE path `/catalog/specs` — NOT `/api/v1`. On a 401 the tool
 * refreshes transparently against the **sil-web** origin (`getWebUrl`, via the real
 * `refreshStoredTokens`) and retries the canonicalization ONCE — the SAME
 * refresh-and-retry-once choreography `sil_search` / `sil_product_get` / `sil_whoami`
 * perform (`sil_specs` is the 4th sil-api tool on the shared seam). Both origins are
 * pinned to distinct known hosts so the origin + path assertions are exact.
 *
 * Wire shapes verified against the LIVE handler (sil-services
 * `services/sil-api/src/handlers/specs.ts` + `@sil/schemas` `specs.ts`):
 *   request body (SpecsRequest): { query: string, specs: SpecDefinition[] } — bare,
 *     NO filters/context/envelope (pure transport).
 *   response (200): the BARE `{ resolved: SpecResolution[] }` — `resolved` TOP-LEVEL,
 *     NO `ucp` meta, NO `result` wrapper (#56's bare-envelope decision; the design
 *     doc's `{ ucp, resolved }` is STALE).
 *   400 { error, message }                        → invalid_request envelope
 *   401                                           → refresh-and-retry-once (see below)
 *   403 { error: user_not_provisioned|principal_mismatch } → forbidden envelope
 *   5xx / network / timeout                       → retryable envelope (BARE — no source)
 *
 *   refresh (sil-web):  POST <sil-web>/api/v1/auth/refresh { refresh_token }
 *     200 { access_token, refresh_token }         → rotate tokens.json, retry once
 *     401 { error: "invalid_grant" }              → terminal re-register, tokens cleared
 *     5xx / network                               → transient retryable, NO retry
 *
 * THE anti-false-green (complete-work-is-stub-free): the happy-path mock returns the
 * REAL `{ resolved: SpecResolution[] }` shape (each entry a matched/created resolution
 * carrying a usable `canonical` ref). The suite asserts the tool surfaces the resolved
 * verdict — so it is UNABLE to go green against a `{ stub: true }` echo.
 *
 * EXPECT RED today: `sil_specs` is not registered and `specsCatalog` /
 * `classifySpecsResponse` do not exist — every `getTool(api, "sil_specs")` throws.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../tools/catalog.js";
// The AC7 end-to-end recovery proof drives sil_register (after a sil_specs 403 clears
// the dead token) on the SAME api + data dir — so identity tools register alongside.
import { registerIdentityTools } from "../tools/identity.js";
import { setWebUrl, setApiUrl, getWebUrl, getApiUrl } from "../lib/config.js";
import { getDataDir, getTokensPath } from "../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

const TOOL = "sil_specs";
const SIL_WEB = "https://sil-web.test.example.com"; // auth origin
const SIL_API = "https://sil-api.test.example.com"; // canonicalization origin

/** Two coined spec definitions the method submits (the request half). */
const SPEC_WATERPROOFING = {
  namespace: "product",
  key: "waterproofing",
  display_name: "Waterproofing",
  data_type: "number",
  unit: "mm",
};
const SPEC_HANDMADE = {
  namespace: "seller",
  key: "handmade",
  display_name: "Handmade",
  data_type: "boolean",
};

/** A `matched` resolution — the coined "waterproofing" deduped to the EXISTING
 * canonical "waterproof_rating" (submitted ≠ canonical: adopt the canonical). */
const RES_MATCHED = {
  namespace: "product",
  key: "waterproof_rating",
  display_name: "Waterproof Rating",
  data_type: "number",
  unit: "mm",
  is_filterable: true,
  is_comparable: true,
  submitted: { namespace: "product", key: "waterproofing" },
  canonical: { namespace: "product", key: "waterproof_rating" },
  status: "matched",
};

/** A `created` resolution — the novel "handmade" registered as canonical
 * (submitted === canonical: keep your own). */
const RES_CREATED = {
  namespace: "seller",
  key: "handmade",
  display_name: "Handmade",
  data_type: "boolean",
  is_filterable: true,
  is_comparable: false,
  submitted: { namespace: "seller", key: "handmade" },
  canonical: { namespace: "seller", key: "handmade" },
  status: "created",
};

/** The REAL bare sil-api specs body — `resolved` at the TOP LEVEL, no `ucp`/`result`
 * wrapper. A `{ stub: true }` echo carries no `resolved`, so the assertions below
 * cannot pass against the skeleton stub. */
function specsEnvelope(resolved: unknown[]): unknown {
  return { resolved };
}

let dataDir: string;
let priorSilDataDir: string | undefined;

/** One recorded outbound request. */
interface Recorded {
  url: string;
  method: string;
  bearer: string | null;
  body: unknown;
  hasBody: boolean;
}

type Reply = { status: number; body: unknown } | "network-error";

/**
 * A URL-routing fetch double cloned from catalog-search.integration.test.ts.
 * `reply(kind, nthOfKind, req)` decides each response given whether the request is a
 * `specs` (sil-api /catalog/specs), a `refresh` (sil-web /auth/refresh — the
 * transparent 401 recovery leg, reached via the real `refreshStoredTokens`), or
 * `other`. Records every request so origin, path, the Bearer header, the mapped body,
 * and call COUNTS (including "exactly one refresh") are all assertable.
 */
function installRouter(
  reply: (
    kind: "specs" | "refresh" | "other",
    nthOfKind: number,
    req: Recorded,
  ) => Reply,
): { all: Recorded[]; specs: Recorded[]; refresh: Recorded[] } {
  const all: Recorded[] = [];
  const specs: Recorded[] = [];
  const refresh: Recorded[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const bearer = headers["Authorization"] ?? headers["authorization"] ?? null;
      const method = (init?.method ?? "GET").toUpperCase();
      const hasBody = init?.body !== undefined && init?.body !== null;
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const req: Recorded = { url, method, bearer, body, hasBody };
      all.push(req);

      // Order matters: /auth/refresh is the sil-web leg; /catalog/specs the sil-api
      // leg. Check refresh first so a future shared path can't be misrouted.
      let kind: "specs" | "refresh" | "other";
      if (url.includes("/auth/refresh")) kind = "refresh";
      else if (url.includes("/catalog/specs")) kind = "specs";
      else kind = "other";

      let nthOfKind: number;
      if (kind === "specs") {
        specs.push(req);
        nthOfKind = specs.length - 1;
      } else if (kind === "refresh") {
        refresh.push(req);
        nthOfKind = refresh.length - 1;
      } else {
        nthOfKind = all.length - 1;
      }

      const r = reply(kind, nthOfKind, req);
      if (r === "network-error") {
        return Promise.reject(new Error("simulated network failure"));
      }
      return Promise.resolve(
        new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  );

  return { all, specs, refresh };
}

/** Parse a ToolResult payload. */
function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("no tool payload");
  return JSON.parse(text) as Record<string, unknown>;
}

/** Seed a stored token pair so the canonicalization proceeds to the read. */
function seedTokens(access: string, refresh: string): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: access, refresh_token: refresh }),
    { mode: 0o600 },
  );
}

/** The Bearer token value carried on a recorded request (stripped of scheme). */
function bearerToken(req: Recorded): string | null {
  if (req.bearer === null) return null;
  return req.bearer.replace(/^Bearer\s+/i, "");
}

/** Collect every argument to every logger level, serialized. */
function logBlob(api: MockPluginAPI): string {
  return [api.logger.info, api.logger.warn, api.logger.error, api.logger.debug]
    .flatMap((fn) => vi.mocked(fn).mock.calls.map((c) => JSON.stringify(c)))
    .join("\n");
}

/** Count `api.logger.info(marker, …)` calls whose first positional arg is `marker`. */
function infoMarkerCount(api: MockPluginAPI, marker: string): number {
  return vi
    .mocked(api.logger.info)
    .mock.calls.filter((c) => c[0] === marker).length;
}

/** The standard two-spec request the happy-path scenarios submit. */
const REQUEST = { query: "hiking gloves", specs: [SPEC_WATERPROOFING, SPEC_HANDMADE] };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-specs-int-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl(SIL_WEB);
  setApiUrl(SIL_API);
});

afterEach(() => {
  vi.restoreAllMocks();
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("sil_specs — param → request mapping (bare path, sil-api origin, Bearer)", () => {
  it("POSTs the BARE /catalog/specs path on the sil-api origin (NOT /api/v1, NOT sil-web)", async () => {
    seedTokens("the-access-token", "the-refresh-token");
    const rec = installRouter((kind) =>
      kind === "specs"
        ? { status: 200, body: specsEnvelope([RES_MATCHED, RES_CREATED]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", REQUEST);

    expect(rec.specs.length).toBe(1);
    const req = rec.specs[0]!;
    const u = new URL(req.url);
    expect(u.pathname).toBe("/catalog/specs");
    expect(req.url).not.toContain("/api/v1");
    expect(u.origin).toBe(new URL(getApiUrl()).origin);
    expect(u.origin).not.toBe(new URL(getWebUrl()).origin);
    expect(req.method).toBe("POST");
    expect(req.hasBody).toBe(true);
    expect(bearerToken(req)).toBe("the-access-token");
  });

  it("sends the body EXACTLY { query, specs } — the definitions forwarded VERBATIM (no envelope, no filters)", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "specs"
        ? { status: 200, body: specsEnvelope([RES_MATCHED, RES_CREATED]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", REQUEST);

    expect(rec.specs.length).toBe(1);
    const body = rec.specs[0]!.body as Record<string, unknown>;
    expect(body).toEqual({ query: "hiking gloves", specs: [SPEC_WATERPROOFING, SPEC_HANDMADE] });
    // Belt-and-braces: NO client-built envelope / filters / context.
    for (const forbidden of ["filters", "context", "protocol", "domain", "enrichment", "pagination"]) {
      expect(body[forbidden]).toBeUndefined();
    }
  });
});

describe("sil_specs — AC1/AC2/AC3: happy path surfaces the resolved verdict faithfully (matched + created)", () => {
  it("returns status ok with ONE resolution per submitted spec, each matched or created (no partial)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs"
        ? { status: 200, body: specsEnvelope([RES_MATCHED, RES_CREATED]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    // The product promise — surfaced from the REAL bare envelope. A `{ stub: true }`
    // echo carries no `resolved`, so this can't go green on a stub.
    expect(JSON.stringify(payload)).not.toContain('"stub"');
    expect(payload["status"]).toBe("ok");
    const resolved = payload["resolved"] as Array<Record<string, unknown>>;
    expect(Array.isArray(resolved)).toBe(true);
    // One resolution per submitted spec — no partial adopt.
    expect(resolved).toHaveLength(2);
    const statuses = resolved.map((r) => r["status"]);
    expect(statuses).toEqual(["matched", "created"]);
  });

  it("AC2 — a `matched` surfaces the EXISTING canonical name (canonical ≠ submitted) for the method to adopt", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs" ? { status: 200, body: specsEnvelope([RES_MATCHED]) } : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [SPEC_WATERPROOFING] }),
    );

    const r = (payload["resolved"] as Array<Record<string, unknown>>)[0]!;
    expect(r["status"]).toBe("matched");
    expect(r["canonical"]).toEqual({ namespace: "product", key: "waterproof_rating" });
    expect(r["submitted"]).toEqual({ namespace: "product", key: "waterproofing" });
    expect(r["canonical"]).not.toEqual(r["submitted"]);
  });

  it("AC3 — a `created` echoes the submitted name (canonical === submitted)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs" ? { status: 200, body: specsEnvelope([RES_CREATED]) } : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [SPEC_HANDMADE] }),
    );

    const r = (payload["resolved"] as Array<Record<string, unknown>>)[0]!;
    expect(r["status"]).toBe("created");
    expect(r["canonical"]).toEqual(r["submitted"]);
  });

  it("surfaces the canonical DEFINITION verbatim (display_name/data_type/is_filterable) — the method persists it whole", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs" ? { status: 200, body: specsEnvelope([RES_MATCHED, RES_CREATED]) } : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    // Faithful pass-through: the resolved array equals the wire array verbatim (the
    // client trusts the backend's dedupe authority; it does not narrow the def the
    // method must persist).
    expect(payload["resolved"]).toEqual([RES_MATCHED, RES_CREATED]);
    // A first-try success is NOT a silent recovery — the refreshed marker must NOT fire.
    expect(infoMarkerCount(api, "sil_specs_refreshed")).toBe(0);
  });
});

describe("sil_specs — AC5: not registered (no tokens.json) short-circuit", () => {
  it("makes NO sil-api call and names sil_register as the recovery", async () => {
    // No tokens seeded.
    const rec = installRouter(() => ({ status: 200, body: specsEnvelope([RES_MATCHED]) }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(rec.all.length).toBe(0); // zero network
    expect(payload["status"]).toBe("not_registered");
    expect(payload["resolved"]).toBeUndefined();
    expect(JSON.stringify(payload)).toContain("sil_register");
  });
});

describe("sil_specs — AC6: 401 refresh-and-retry-once (uniform with sil_search / sil_product_get / sil_whoami)", () => {
  it("recovered 401: refresh once, retry once with the ROTATED token (same body), return ok — invisible to the agent", async () => {
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind, nth) => {
      if (kind === "specs") {
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: specsEnvelope([RES_MATCHED, RES_CREATED]) };
      }
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).toBe("ok");
    expect(rec.specs.length).toBe(2); // failed read + one retry
    expect(rec.refresh.length).toBe(1); // exactly one refresh
    // The retry carried the ROTATED token and the SAME body.
    expect(bearerToken(rec.specs[1]!)).toBe("rotated-at");
    expect(rec.specs[1]!.body).toEqual({ query: "hiking gloves", specs: [SPEC_WATERPROOFING, SPEC_HANDMADE] });
    // The silent-recovery operator marker fires EXACTLY ONCE (logs-only; NOT a payload field).
    expect(infoMarkerCount(api, "sil_specs_refreshed")).toBe(1);
    expect(JSON.stringify(payload)).not.toContain("refreshed"); // never leaks to the agent
  });

  it("second-401: a freshly-rotated token STILL rejected → must_reregister (exactly one refresh, NO storm), tokens cleared", async () => {
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind) => {
      if (kind === "specs") return { status: 401, body: { error: "unauthorized" } }; // ALWAYS 401
      if (kind === "refresh") return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).toBe("must_reregister");
    expect(payload["recovery"]).toBe("sil_register");
    expect(rec.refresh.length).toBe(1); // exactly one refresh, NEVER a second
    expect(rec.specs.length).toBe(2); // initial + exactly one retry
    expect(existsSync(getTokensPath())).toBe(false); // rotated pair is structurally dead → cleared
  });

  it("invalid_grant: a dead refresh token → must_reregister, NO retry, tokens cleared", async () => {
    seedTokens("expired-at", "dead-rt");
    const rec = installRouter((kind) => {
      if (kind === "specs") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).toBe("must_reregister");
    expect(payload["recovery"]).toBe("sil_register");
    expect(rec.refresh.length).toBe(1);
    expect(rec.specs.length).toBe(1); // the original 401 only — NO retry without a rotated token
    expect(existsSync(getTokensPath())).toBe(false);
  });

  it("refresh-5xx: a refresh-leg blip → retryable (NO re-register hint), NO retry, tokens KEPT", async () => {
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind) => {
      if (kind === "specs") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 503, body: { error: "unavailable" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register"); // a refresh blip is NOT a dead session
    expect(rec.refresh.length).toBe(1);
    expect(rec.specs.length).toBe(1); // NO retry — no rotated token
    expect(existsSync(getTokensPath())).toBe(true); // the pair may be fine — kept
  });
});

describe("sil_specs — AC7: 403 forbidden (shared envelope; user_not_provisioned clears the dead token)", () => {
  it("403 user_not_provisioned → forbidden envelope, the dead token is CLEARED at the call site", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) =>
      kind === "specs"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).toBe("forbidden");
    expect(payload["reason"]).toBe("user_not_provisioned");
    // NOT refreshed — a 403 is terminal-but-recoverable, no refresh leg fires.
    expect(rec.refresh.length).toBe(0);
    // user_not_provisioned clears the structurally-dead token so the next sil_register
    // re-onboards (parity with sil_search / sil_whoami).
    expect(existsSync(getTokensPath())).toBe(false);
  });

  it("403 principal_mismatch → forbidden envelope carrying the reason, but the token is KEPT (recoverable)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs"
        ? { status: 403, body: { error: "principal_mismatch" } }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).toBe("forbidden");
    expect(payload["reason"]).toBe("principal_mismatch");
    // The exact-equality clear gate: only user_not_provisioned clears — a
    // principal_mismatch is recoverable and MUST keep its token.
    expect(existsSync(getTokensPath())).toBe(true);
  });
});

describe("sil_specs — AC8: 5xx / network → retryable (NO re-register hint, BARE — never names a source)", () => {
  it("5xx → retryable, NO recovery:sil_register", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs"
        ? { status: 500, body: { error: "internal_error", message: "registry DB unavailable" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/sil_register/);
  });

  it("a 5xx carrying a `source` field STILL surfaces a BARE retryable — NO source named (registry has no external source)", async () => {
    // The taxonomy-over-copy guard at the wired tier: search's source-named retryable
    // (outcome b) must NOT be copied to specs. Even if a spurious `source` rides a
    // specs 5xx, the agent-facing envelope names no source and no detail.
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs"
        ? { status: 500, body: { error: "source_unavailable", message: "x", source: "shopify" } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).toBe("retryable");
    expect(payload).not.toHaveProperty("detail");
    expect(JSON.stringify(payload)).not.toContain("shopify");
  });

  it("network error / timeout (thrown fetch) → retryable", async () => {
    seedTokens("at", "rt");
    const rec = installRouter((kind) => (kind === "specs" ? "network-error" : { status: 200, body: {} }));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(rec.specs.length).toBe(1); // exactly one round-trip — no storm
    expect(payload["status"]).toBe("retryable");
  });
});

describe("sil_specs — 400 → invalid_request (surfaces the server's { error, message })", () => {
  it("400 → invalid_request carrying { error, message }, NOT retryable and NOT re-register", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs"
        ? { status: 400, body: { error: "invalid_request", message: "specs[0].display_name is required." } }
        : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).toBe("invalid_request");
    expect(payload["status"]).not.toBe("retryable");
    expect(payload["recovery"]).not.toBe("sil_register");
  });
});

describe("sil_specs — AC9: anti-false-green (a 200 with no usable resolved array → retryable, never a false ok)", () => {
  it("a stub 200 ({stub, tool, echo}) → retryable, NEVER ok", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs"
        ? { status: 200, body: { stub: true, tool: "sil_specs", echo: REQUEST } }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).not.toBe("ok");
    expect(payload["status"]).toBe("retryable");
  });

  it("an EMPTY resolved:[] → retryable (STRICTER than search — a 1:1 request owes ≥1 resolution, no empty-match success)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs" ? { status: 200, body: specsEnvelope([]) } : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).not.toBe("ok");
    expect(payload["status"]).toBe("retryable");
  });

  it("a resolved entry with no usable canonical ref → whole 200 falls to retryable (reject-whole, no partial adopt)", async () => {
    seedTokens("at", "rt");
    installRouter((kind) =>
      kind === "specs"
        ? { status: 200, body: specsEnvelope([RES_MATCHED, { namespace: "x", key: "y", status: "created" }]) }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));

    expect(payload["status"]).not.toBe("ok");
    expect(payload["status"]).toBe("retryable");
  });
});

describe("sil_specs — the outcomes map to distinct agent-facing status strings (taxonomy)", () => {
  it("ok / invalid_request / retryable / forbidden are FOUR distinct statuses", async () => {
    async function statusFor(reply: Reply): Promise<unknown> {
      seedTokens("at", "rt");
      installRouter((kind) => (kind === "specs" ? reply : { status: 500, body: {} }));
      const api = createMockPluginApi();
      registerCatalogTools(api);
      const payload = payloadOf(await getTool(api, TOOL).execute("c1", REQUEST));
      vi.restoreAllMocks();
      return payload["status"];
    }

    const ok = await statusFor({ status: 200, body: specsEnvelope([RES_MATCHED, RES_CREATED]) });
    const invalid = await statusFor({ status: 400, body: { error: "invalid_request", message: "x" } });
    const retry = await statusFor({ status: 500, body: {} });
    const forbid = await statusFor({ status: 403, body: { error: "user_not_provisioned" } });

    expect(ok).toBe("ok");
    expect(invalid).toBe("invalid_request");
    expect(retry).toBe("retryable");
    expect(forbid).toBe("forbidden");
    expect(new Set([ok, invalid, retry, forbid]).size).toBe(4);
  });
});

describe("sil_specs — token privacy (never logged, never echoed)", () => {
  it("on the SUCCESS path, no logger call and no result carries the access token or a Bearer header", async () => {
    seedTokens("secret-specs-access", "secret-specs-refresh");
    installRouter((kind) =>
      kind === "specs" ? { status: 200, body: specsEnvelope([RES_MATCHED]) } : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [SPEC_WATERPROOFING] }),
    );

    const logs = logBlob(api);
    const result = JSON.stringify(payload);
    for (const blob of [logs, result]) {
      expect(blob).not.toContain("secret-specs-access");
      expect(blob).not.toContain("secret-specs-refresh");
      expect(blob).not.toMatch(/Bearer/i);
    }
  });
});
