/**
 * INTEGRATION — sil_whoami read → refresh → retry-once (tier: integration).
 *
 * The real `sil_whoami` tool wired through the real sil-client (identity read
 * + classifier + refreshStoredTokens) and the real credentials module. The
 * ONLY thing mocked is `fetch` — the host/network boundary. There is no live
 * sil-api or Postgres in this repo; the true cross-service guarantee (real PII
 * over the wire from a live sil-api) is sil-stage's e2e (goal SC9), deferred
 * AND additionally blocked on the sil-services follow-on that makes sil-api's
 * /identity return real `{name, addresses}` (Signals). Here we prove the whole
 * PLUGIN-SIDE contract — the refresh choreography + error taxonomy + privacy —
 * against a mocked boundary, exactly as the register card proved its claim flow.
 *
 * TWO ORIGINS (architect "two-origin reality"): the identity read targets the
 * resolved **sil-api** origin (`getApiUrl`); the refresh targets the resolved
 * **sil-web** origin (`getWebUrl`, via `refreshStoredTokens`). The fetch double
 * routes by URL and records every request so both origins are asserted
 * independently and Auth0 is proven never contacted.
 *
 * Wire shapes:
 *   - identity (sil-api):  POST <sil-api>/identity, Authorization: Bearer <at>
 *       200 envelope { ..., result: { name, addresses } } → ok
 *       401                                               → refresh-and-retry
 *       5xx / network throw                               → retryable
 *   - refresh (sil-web):   POST <sil-web>/api/v1/auth/refresh { refresh_token }
 *       200 { access_token, refresh_token }               → rotate tokens.json
 *       401 { error: "invalid_grant" }                    → terminal re-register
 *   (refresh shape pinned to the ALREADY-MERGED sil-web contract; identity shape
 *    is the agreed real-read contract the sil-services follow-on will satisfy.)
 *
 * THE anti-false-green (PO "latent-endpoint confusion"): the happy-path mock
 * returns the agreed REAL `{name, addresses}` and the test asserts the tool
 * surfaces the authenticated user's name + addresses — NOT the current sil-api
 * stub shape `{kind, verified, subject, attributes, note}`. The suite is unable
 * to go green while the product promise (return real identity) is unmet.
 *
 * Contract pinned for the implementation (expert-developer):
 *   - registerIdentityTools(api) registers sil_whoami; execute() reads
 *     tokens.json, POSTs <sil-api>/identity with Authorization: Bearer <at>,
 *     and on a 401 calls refreshStoredTokens() (sil-web only), re-reads the
 *     rotated tokens, retries the identity read EXACTLY ONCE, then surfaces the
 *     identity or a terminal/transient envelope. At most one refresh + one
 *     retry per call. On a confirmed invalid_grant, tokens.json is cleared.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerIdentityTools } from "../tools/identity.js";
import { setWebUrl, setApiUrl, getWebUrl, getApiUrl } from "../lib/config.js";
import { getDataDir, getTokensPath, readTokens } from "../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

const TOOL = "sil_whoami";
const SIL_WEB = "https://sil-web.test.example.com"; // refresh origin
const SIL_API = "https://sil-api.test.example.com"; // identity-read origin

const REAL_IDENTITY = {
  name: "Ada Lovelace",
  addresses: [
    { line1: "12 Analytical Engine Way", city: "London", country: "GB" },
  ],
};

/** The agreed real-read response: identity in a UCP envelope's `result`. */
function identityEnvelope(identity: unknown = REAL_IDENTITY): unknown {
  return { protocol: "ucp", version: "0.1", domain: "identity", result: identity };
}

let dataDir: string;
let priorSilDataDir: string | undefined;

interface StoredTokens {
  access_token: string;
  refresh_token: string;
}

/** One recorded outbound request. */
interface Recorded {
  url: string;
  /** The HTTP verb fetch was called with (defaults to "GET" when init omits it,
   * mirroring the fetch spec). Recorded so the identity-read verb is assertable:
   * the bug is the read using POST; the fix is GET-with-no-body. */
  method: string;
  bearer: string | null;
  /** The parsed request body, or null when none was sent. A correct identity GET
   * carries NO body; the buggy POST carried `{ agent_id }`. */
  body: unknown;
  /** Whether a request body was present AT ALL (distinct from a body that parses
   * to null) — a GET must send no body, asserted independently of its content. */
  hasBody: boolean;
}

type Reply = { status: number; body: unknown } | "network-error";

/**
 * A URL-routing fetch double. `reply(kind, callIndexForKind, req)` decides each
 * response given whether the request is an `identity` (sil-api /identity) or a
 * `refresh` (sil-web /auth/refresh) call. Records every request (url, bearer,
 * body) so origins, the Bearer header, and call COUNTS are all assertable.
 */
function installRouter(
  reply: (
    kind: "identity" | "refresh" | "other",
    nthOfKind: number,
    req: Recorded,
  ) => Reply,
): {
  all: Recorded[];
  identity: Recorded[];
  refresh: Recorded[];
} {
  const all: Recorded[] = [];
  const identity: Recorded[] = [];
  const refresh: Recorded[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const bearer =
        headers["Authorization"] ??
        headers["authorization"] ??
        null;
      // The fetch spec defaults a method-less request to GET; mirror that so an
      // implementation that passes no `method` reads as GET, not undefined.
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

      let kind: "identity" | "refresh" | "other";
      if (url.includes("/auth/refresh")) kind = "refresh";
      else if (url.includes("/identity")) kind = "identity";
      else kind = "other";

      // nthOfKind = the 0-based index of THIS request among its kind. Push
      // first, then derive the index as length-1, so the buckets and the index
      // can never disagree.
      let nthOfKind: number;
      if (kind === "identity") {
        identity.push(req);
        nthOfKind = identity.length - 1;
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

  return { all, identity, refresh };
}

/** Parse a ToolResult payload. */
function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("no tool payload");
  return JSON.parse(text) as Record<string, unknown>;
}

/** Seed a stored token pair so whoami proceeds to the identity read. */
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
  return [
    api.logger.info,
    api.logger.warn,
    api.logger.error,
    api.logger.debug,
  ]
    .flatMap((fn) => vi.mocked(fn).mock.calls.map((c) => JSON.stringify(c)))
    .join("\n");
}

/**
 * Count how many `api.logger.info(marker, …)` calls used `marker` as their first
 * argument. The marker name is the FIRST positional arg of the info call (the
 * convention every `sil_*` log marker in this plugin follows). Used to assert the
 * `sil_whoami_refreshed` operator marker fires exactly once on the silent-recovery
 * path and ZERO times on a first-try (no-refresh) success — restoring the seam
 * `origin/main:identity.ts` emitted but the refactor dropped (review round 1).
 */
function infoMarkerCount(api: MockPluginAPI, marker: string): number {
  return vi
    .mocked(api.logger.info)
    .mock.calls.filter((c) => c[0] === marker).length;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-whoami-int-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  // Pin BOTH origins to distinct known hosts so the two-origin assertions are
  // exact and independent.
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

describe("sil_whoami — happy path (valid access token)", () => {
  it("returns the authenticated user's REAL name + addresses (NOT the stub shape)", async () => {
    // Anti-false-green: the mock returns the agreed real identity contract.
    seedTokens("valid-at", "valid-rt");
    installRouter((kind) =>
      kind === "identity"
        ? { status: 200, body: identityEnvelope() }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerIdentityTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    const blob = JSON.stringify(payload);
    // The product promise: real identity, surfaced (unwrapped from the envelope).
    expect(blob).toContain("Ada Lovelace");
    expect(blob).toContain("Analytical Engine Way");
    // And NOT the current sil-api stub payload shape — if the tool were wired to
    // the stub it would pass with these markers and no name/addresses.
    expect(blob).not.toContain("\"kind\"");
    expect(blob).not.toContain("\"verified\"");
    expect(blob).not.toContain("\"note\"");

    // The founder's reported bug, closed at the TOOL level: the full result
    // envelope is `{ status: "ok", identity: { name, addresses } }` — NOT the
    // `retryable` the bug produced. Assert the structured shape, not just markers.
    expect(payload["status"]).toBe("ok");
    expect(payload["status"]).not.toBe("retryable");
    const identity = payload["identity"] as { name?: unknown; addresses?: unknown };
    expect(identity).toBeDefined();
    expect(identity.name).toBe("Ada Lovelace");
    expect(Array.isArray(identity.addresses)).toBe(true);
    expect((identity.addresses as unknown[]).length).toBe(1);
  });

  it("calls sil-api with Authorization: Bearer <stored access token>", async () => {
    seedTokens("the-stored-access-token", "the-stored-refresh-token");
    const rec = installRouter((kind) =>
      kind === "identity"
        ? { status: 200, body: identityEnvelope() }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});

    expect(rec.identity.length).toBe(1);
    expect(bearerToken(rec.identity[0]!)).toBe("the-stored-access-token");
  });

  it("reads identity with HTTP GET and sends NO request body (the verb fix)", async () => {
    // THE LOAD-BEARING RED for this card. The bug: fetchIdentity POSTs to
    // <sil-api>/identity (the unauthenticated enrich STUB, which carries no
    // `name`), instead of GET-ing the real authenticated self-read (sil-api PR
    // #7, which derives the user from the JWT `req.user` and takes NO body).
    //
    // The pre-existing router routed on `url.includes("/identity")` and never
    // inspected `init.method`, so a POST and a GET were indistinguishable to it
    // — the suite stayed GREEN against the buggy POST AND would stay green if
    // the dev broke the verb. This assertion is the ONLY in-repo signal for the
    // bug class (the true cross-service proof is sil-stage's e2e, SC9, deferred).
    //
    // EXPECT THIS TEST RED against current code (tool sends POST + `{agent_id}`)
    // and GREEN only after fetchIdentity switches POST→GET with no body.
    seedTokens("valid-at", "valid-rt");
    const rec = installRouter((kind) =>
      kind === "identity"
        ? { status: 200, body: identityEnvelope() }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});

    expect(rec.identity.length).toBe(1);
    const req = rec.identity[0]!;
    // The verb is GET — the real self-read route, not the POST enrich stub.
    expect(req.method).toBe("GET");
    // And no request body at all: the GET derives the principal from the JWT;
    // a GET-with-a-body is at best ignored, at worst a runtime error in strict
    // environments. This asserts the absence of the body INDEPENDENTLY of its
    // content (a parsed-null body and a never-sent body are different things).
    expect(req.hasBody).toBe(false);
    expect(req.body).toBeNull();
    // Specifically: the stale POST payload `{ agent_id }` is gone — a "POST body
    // adapted to a GET" would still carry agent_id and is also wrong.
    expect(JSON.stringify(req.body ?? {})).not.toContain("agent_id");
  });

  it("targets the resolved sil-api origin (sil_api_url), not sil-web, not a hardcoded host", async () => {
    seedTokens("valid-at", "valid-rt");
    const rec = installRouter((kind) =>
      kind === "identity"
        ? { status: 200, body: identityEnvelope() }
        : { status: 500, body: {} },
    );
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});

    const silApiOrigin = new URL(getApiUrl()).origin;
    expect(rec.identity.length).toBe(1);
    expect(new URL(rec.identity[0]!.url).origin).toBe(silApiOrigin);
    // It is NOT the sil-web origin (the two must not be conflated).
    expect(new URL(rec.identity[0]!.url).origin).not.toBe(new URL(getWebUrl()).origin);
  });

  it("makes NO refresh request when the first read succeeds", async () => {
    seedTokens("valid-at", "valid-rt");
    const rec = installRouter((kind) =>
      kind === "identity"
        ? { status: 200, body: identityEnvelope() }
        : { status: 200, body: { access_token: "x", refresh_token: "y" } },
    );
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});

    expect(rec.identity.length).toBe(1);
    expect(rec.refresh.length).toBe(0); // refresh is taken ONLY on a real 401
    // NEGATIVE half of the observability seam (review-round-1 fix): a first-try
    // success took no refresh, so the `sil_whoami_refreshed` marker must NOT fire.
    // The marker keys off the helper's `refreshed:false` passthrough discriminant.
    expect(infoMarkerCount(api, "sil_whoami_refreshed")).toBe(0);
  });
});

describe("sil_whoami — transparent refresh (expired access, valid refresh)", () => {
  it("401 → refresh via sil-web → rotate tokens.json → retry once with the NEW token → identity", async () => {
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind, nth) => {
      if (kind === "identity") {
        // First identity call 401 (expired); second (after refresh) 200.
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: identityEnvelope() };
      }
      if (kind === "refresh") {
        return {
          status: 200,
          body: { access_token: "rotated-at", refresh_token: "rotated-rt" },
        };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));

    // Exactly two identity reads (initial 401 + one retry) and one refresh.
    expect(rec.identity.length).toBe(2);
    expect(rec.refresh.length).toBe(1);
    // The refresh used the stored refresh token.
    expect((rec.refresh[0]!.body as { refresh_token?: string }).refresh_token).toBe("valid-rt");
    // The RETRY carried the NEW access token (proves re-read after rotation).
    expect(bearerToken(rec.identity[1]!)).toBe("rotated-at");
    // The taxonomy holds against the NEW request shape: BOTH identity reads —
    // the initial AND the retry-after-refresh — are bodyless GETs (the verb fix
    // must not regress the refresh-retry path back to a POST). The refresh leg
    // (sil-web) stays a POST with a body, as its own contract requires.
    for (const r of rec.identity) {
      expect(r.method).toBe("GET");
      expect(r.hasBody).toBe(false);
    }
    expect(rec.refresh[0]!.method).toBe("POST");
    // tokens.json now holds the rotated pair (old expired token is gone).
    const tokens = readTokens();
    expect(tokens!.access_token).toBe("rotated-at");
    expect(tokens!.refresh_token).toBe("rotated-rt");
    // The agent sees identity — never an expiry/refresh state.
    expect(JSON.stringify(payload)).toContain("Ada Lovelace");

    // OPERATOR-OBSERVABILITY SEAM (review-round-1 fix; card line 161): the silent
    // recovery is invisible in the PAYLOAD but MUST be observable in operator logs.
    // `origin/main:identity.ts` emitted `sil_whoami_refreshed` here; the consolidation
    // dropped it (the regression this fix restores). Assert the marker fired EXACTLY
    // ONCE on the recovered-401 path. RED until whoami re-emits it via the helper's
    // `refreshed: true` signal — logs-only, NOT a payload field.
    expect(infoMarkerCount(api, "sil_whoami_refreshed")).toBe(1);
    // Logs-only — the marker does NOT add a field to the agent-facing payload.
    expect(payload["sil_whoami_refreshed"]).toBeUndefined();
    // The marker carries NO token material (privacy invariant holds on the marker).
    const refreshedMarkerArgs = vi
      .mocked(api.logger.info)
      .mock.calls.filter((c) => c[0] === "sil_whoami_refreshed");
    const refreshedMarkerBlob = JSON.stringify(refreshedMarkerArgs);
    expect(refreshedMarkerBlob).not.toContain("rotated-at");
    expect(refreshedMarkerBlob).not.toContain("rotated-rt");
    expect(refreshedMarkerBlob).not.toContain("valid-rt");
    expect(refreshedMarkerBlob).not.toContain("expired-at");
    expect(refreshedMarkerBlob).not.toMatch(/Bearer/i);
  });

  it("the refresh contacts ONLY sil-web (never Auth0); identity ONLY sil-api", async () => {
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind, nth) => {
      if (kind === "identity") {
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: identityEnvelope() };
      }
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});

    const silApiOrigin = new URL(getApiUrl()).origin;
    const silWebOrigin = new URL(getWebUrl()).origin;
    // Two origins, asserted INDEPENDENTLY.
    for (const r of rec.identity) {
      expect(new URL(r.url).origin).toBe(silApiOrigin);
    }
    for (const r of rec.refresh) {
      expect(new URL(r.url).origin).toBe(silWebOrigin);
    }
    // No Auth0 on ANY path.
    for (const r of rec.all) {
      expect(r.url).not.toMatch(/auth0\.com/i);
    }
  });
});

describe("sil_whoami — refresh also fails (dead refresh token)", () => {
  it("invalid_grant → terminal must-re-register, tokens cleared, exactly 2 identity fetches + 1 refresh", async () => {
    seedTokens("expired-at", "dead-rt");
    const rec = installRouter((kind) => {
      if (kind === "identity") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));

    // Terminal re-register outcome — guides the user to sil_register.
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/re-?register|sil_register|must.*register|session.*expired/);
    // Not presented as success.
    expect(payload["name"]).toBeUndefined();
    expect(payload["addresses"]).toBeUndefined();

    // The NO-STORM bound: with a dead refresh token, the tool does NOT retry the
    // identity read after the failed refresh — exactly ONE identity fetch and
    // ONE refresh. (A retry-after-failed-refresh, or a second refresh, is a bug.)
    expect(rec.refresh.length).toBe(1);
    expect(rec.identity.length).toBe(1);

    // The confirmed-dead session must not masquerade as live: tokens.json is
    // cleared so a subsequent sil_register does not short-circuit on stale presence.
    expect(existsSync(getTokensPath())).toBe(false);
    expect(readTokens()).toBeNull();
  });

  it("a subsequent sil_register does NOT short-circuit after the dead session is cleared", async () => {
    // The cross-card interaction: sil_register's short-circuit is presence-based
    // (hasTokens()). After whoami clears a dead pair, register must mint anew.
    seedTokens("expired-at", "dead-rt");
    installRouter((kind) => {
      if (kind === "identity") return { status: 401, body: { error: "unauthorized" } };
      if (kind === "refresh") return { status: 401, body: { error: "invalid_grant" } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);
    await getTool(api, TOOL).execute("c1", {});

    // tokens cleared — register must NOT report already_registered.
    vi.restoreAllMocks();
    // sil_register arms a background poll; stub fetch so it can't escape.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    const regPayload = payloadOf(await getTool(api, "sil_register").execute("c2", {}));
    expect(regPayload["status"]).not.toBe("already_registered");
  });
});

describe("sil_whoami — 403 forbidden is terminal (NEVER refreshed)", () => {
  it("403 user_not_provisioned → distinct terminal outcome, NO refresh attempted", async () => {
    // Architect risk "401 vs 403 conflation": a 403 is a valid-but-unprovisioned
    // (or principal-mismatch) token — refreshing it changes nothing. A tool that
    // refreshed on any 4xx would burn a pointless refresh and still fail. The
    // classifier splits 401/403 (unit-tested); THIS proves the WIRED tool acts
    // on the split — 403 must not enter the refresh path.
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    const rec = installRouter((kind) =>
      kind === "identity"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: { access_token: "x", refresh_token: "y" } },
    );
    const api = createMockPluginApi();
    registerIdentityTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));

    // NO refresh on a 403 (the load-bearing assertion), and exactly one read.
    expect(rec.refresh.length).toBe(0);
    expect(rec.identity.length).toBe(1);
    // The 403-terminal split is exercised against the NEW request shape: the
    // read that produced the 403 was a bodyless GET (the verb fix must not
    // perturb the 401-vs-403 taxonomy).
    expect(rec.identity[0]!.method).toBe("GET");
    expect(rec.identity[0]!.hasBody).toBe(false);
    // Surfaces a terminal, actionable outcome — not a success, not a transient
    // "try again" (a 403 won't fix itself on retry), not a silent empty.
    expect(payload["name"]).toBeUndefined();
    expect(payload["addresses"]).toBeUndefined();
    const blob = JSON.stringify(payload).toLowerCase();
    // Carries the actionable provisioning/onboarding hint distinct from the
    // 401/5xx outcomes (a 403 is "you aren't set up", not "auth expired" or
    // "server hiccup").
    expect(blob).toMatch(/provision|onboard|forbidden|not.*set.up/);
    // NOT framed as a transient/temporary server condition — a 403 won't clear
    // itself by waiting (it may legitimately tell the user to fix-then-retry,
    // but it must not read as a passive "temporary, try later" blip).
    expect(blob).not.toMatch(/temporar|transient|unavailable|try.again.later/);
  });

  it("does NOT clear tokens.json on a 403 (the token is valid, just unprovisioned)", async () => {
    // Only a CONFIRMED invalid_grant clears tokens. A 403 token is still a valid
    // credential (the human just isn't onboarded) — clearing it would force a
    // pointless re-register. The dead-session clear must be scoped to 401/refresh.
    seedTokens("valid-but-unprovisioned-at", "valid-rt");
    installRouter((kind) =>
      kind === "identity"
        ? { status: 403, body: { error: "user_not_provisioned" } }
        : { status: 200, body: { access_token: "x", refresh_token: "y" } },
    );
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});

    // The valid token survives — not cleared on a 403.
    expect(readTokens()).not.toBeNull();
    expect(readTokens()!.access_token).toBe("valid-but-unprovisioned-at");
  });
});

describe("sil_whoami — bounded refresh (no storm)", () => {
  it("a SECOND 401 after a successful refresh is terminal — no second refresh, no third read", async () => {
    // The cardinal risk: a freshly-rotated token still rejected must be terminal,
    // never another refresh cycle. At most one refresh + one retry per call.
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter((kind) => {
      // Identity ALWAYS 401 (even after a good refresh — structurally dead).
      if (kind === "identity") return { status: 401, body: { error: "unauthorized" } };
      // Refresh succeeds (rotates), so the tool DOES retry once.
      if (kind === "refresh") {
        return { status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } };
      }
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));

    // Exactly: read(401) → refresh(200) → retry-read(401) → STOP.
    expect(rec.identity.length).toBe(2); // initial + exactly one retry
    expect(rec.refresh.length).toBe(1); // exactly one refresh, never a second
    // Surfaces a terminal outcome, not a success, not an infinite spin.
    expect(payload["name"]).toBeUndefined();
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/re-?register|sil_register|must.*register|expired|error|status/);
  });
});

describe("sil_whoami — transient failure (network / 5xx, distinguished from terminal)", () => {
  it("a 5xx from sil-api → retryable/try-again outcome, NOT a re-register hint, no refresh", async () => {
    seedTokens("valid-at", "valid-rt");
    const rec = installRouter((kind) =>
      kind === "identity" ? { status: 503, body: { error: "unavailable" } } : { status: 200, body: {} },
    );
    const api = createMockPluginApi();
    registerIdentityTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));

    // A transient blip is NOT terminal: the agent is told to try again, not to
    // re-register (a false terminal on a 5xx is the product risk).
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).not.toMatch(/re-?register/);
    expect(blob).toMatch(/retry|try.again|temporar|transient|unavailable|later/);
    // A 5xx is not a 401 — no refresh is attempted.
    expect(rec.refresh.length).toBe(0);
    // Tokens are NOT cleared on a transient (the token may be fine).
    expect(readTokens()).not.toBeNull();
    // The transient path is bound to the NEW request shape: the read that hit
    // the 5xx was a bodyless GET.
    expect(rec.identity.length).toBe(1);
    expect(rec.identity[0]!.method).toBe("GET");
    expect(rec.identity[0]!.hasBody).toBe(false);
  });

  it("a network error (thrown fetch) on the identity read → retryable, not terminal", async () => {
    seedTokens("valid-at", "valid-rt");
    const rec = installRouter((kind) => (kind === "identity" ? "network-error" : { status: 200, body: {} }));
    const api = createMockPluginApi();
    registerIdentityTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).not.toMatch(/re-?register/);
    expect(blob).toMatch(/retry|try.again|temporar|transient|network|later/);
    expect(rec.refresh.length).toBe(0);
    expect(readTokens()).not.toBeNull();
    // The thrown-fetch path is bound to the NEW request shape: the attempted
    // read (recorded before the throw) was a bodyless GET.
    expect(rec.identity.length).toBe(1);
    expect(rec.identity[0]!.method).toBe("GET");
    expect(rec.identity[0]!.hasBody).toBe(false);
  });
});

describe("sil_whoami — not registered (no tokens.json)", () => {
  it("makes ZERO fetches and returns a run-sil_register terminal hint", async () => {
    // No tokens seeded.
    const rec = installRouter(() => ({ status: 200, body: identityEnvelope() }));
    const api = createMockPluginApi();
    registerIdentityTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));

    expect(rec.all.length).toBe(0); // nothing to authenticate with → no network
    expect(JSON.stringify(payload)).toContain("sil_register");
    expect(payload["name"]).toBeUndefined();
  });
});

describe("sil_whoami — rotated tokens never leak to logs or the result", () => {
  it("on a refresh mid-call, the rotated token values touch only tokens.json + the retry", async () => {
    seedTokens("expired-at", "valid-rt");
    const ROT_AT = "rotated-secret-access";
    const ROT_RT = "rotated-secret-refresh";
    const rec = installRouter((kind, nth) => {
      if (kind === "identity") {
        return nth === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: identityEnvelope() };
      }
      if (kind === "refresh") return { status: 200, body: { access_token: ROT_AT, refresh_token: ROT_RT } };
      return { status: 500, body: {} };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));

    // Result carries identity, never the rotated credentials.
    const resultBlob = JSON.stringify(payload);
    expect(resultBlob).not.toContain(ROT_AT);
    expect(resultBlob).not.toContain(ROT_RT);

    // No logger call at any level carries a rotated token, the old refresh token,
    // a Bearer string, or PII.
    const logs = logBlob(api);
    expect(logs).not.toContain(ROT_AT);
    expect(logs).not.toContain(ROT_RT);
    expect(logs).not.toContain("valid-rt");
    expect(logs).not.toContain("expired-at");
    expect(logs).not.toMatch(/Bearer/i);
    expect(logs).not.toContain("Ada Lovelace");
    expect(logs).not.toContain("Analytical Engine Way");

    // The rotated token DID reach the only legitimate places: tokens.json + the
    // retry request's Bearer header.
    const onDisk = JSON.parse(readFileSync(getTokensPath(), "utf8")) as StoredTokens;
    expect(onDisk.access_token).toBe(ROT_AT);
    expect(bearerToken(rec.identity[1]!)).toBe(ROT_AT);

    // Hygiene asserted against the NEW GET request shape: the credential travels
    // ONLY in the Authorization header, never in a request body. Both identity
    // reads are bodyless GETs, and no recorded identity request body carries any
    // token (the bug's POST body would have been a new exfil surface to audit;
    // a bodyless GET removes it entirely).
    for (const r of rec.identity) {
      expect(r.method).toBe("GET");
      expect(r.hasBody).toBe(false);
      const reqBodyBlob = JSON.stringify(r.body ?? {});
      expect(reqBodyBlob).not.toContain(ROT_AT);
      expect(reqBodyBlob).not.toContain(ROT_RT);
      expect(reqBodyBlob).not.toContain("valid-rt");
      expect(reqBodyBlob).not.toContain("expired-at");
    }
  });
});
