/**
 * UNIT — the pure `refreshAndRetryOnce<O>` bounded refresh-and-retry helper
 * (tier: unit, real `refreshStoredTokens` against a mocked `fetch` boundary +
 * real `SIL_DATA_DIR` token seeding — NOT a stubbed refresh).
 *
 * This is the single 401-recovery choreography the card extracts so `sil_search`,
 * `sil_product_get`, and `sil_whoami` cannot drift apart again (FLAG-10). The
 * helper is the control-flow core mirrored out of `identity.ts:170-208`: given a
 * first outcome, an `isUnauthorized` predicate, and a token-bearing retry thunk,
 * it does AT MOST ONE refresh (via the real `refreshStoredTokens`) and AT MOST ONE
 * retry, then returns a small typed discriminant the caller maps to its own
 * envelope. The bound is STRUCTURAL (straight-line first → refresh → retry, no
 * loop), and these tests assert the refresh/retry COUNTS so "at most once" is
 * enforced structurally, not merely by the happy path.
 *
 * STUB-FREE (`.claude/rules/complete-work-is-stub-free.md`): the helper's only I/O
 * is `refreshStoredTokens()` + `readTokens()`, and BOTH run for real here. The
 * refresh-leg outcomes (refreshed / invalid_grant / retryable) are driven through
 * the REAL `refreshStoredTokens` by mocking ONLY `fetch` (the sil-web /auth/refresh
 * boundary) and seeding a real `tokens.json` under a temp `SIL_DATA_DIR` — exactly
 * as `whoami.integration.test.ts` exercises the same primitive. The `first`
 * outcome, the `isUnauthorized` predicate, and the `retryWithToken` thunk are the
 * helper's PARAMETRIC inputs (a generic `O`), supplied by the test as the caller
 * would supply them — they are inputs to the function under test, not stubs of
 * production code. No `AUTH_DEV_BYPASS`, no stubbed refresh.
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts` (or a colocated `src/lib/refresh-retry.ts`):
 *
 *   export type RefreshRetryResult<O> =
 *     | { kind: "result"; outcome: O }
 *     | { kind: "must_reregister"; reason: "invalid_grant" | "no_stored_tokens" }
 *     | { kind: "retryable" }
 *     | { kind: "second_unauthorized" };
 *
 *   export function refreshAndRetryOnce<O>(
 *     first: O,
 *     isUnauthorized: (o: O) => boolean,
 *     retryWithToken: (accessToken: string) => Promise<O>,
 *   ): Promise<RefreshRetryResult<O>>;
 *
 * Behaviour (the immutable spec):
 *   - first NOT unauthorized            → { kind: "result", outcome: first }, and
 *                                          NEITHER refreshStoredTokens NOR the thunk
 *                                          is called (refresh is reachable only via
 *                                          a first-call 401).
 *   - first unauthorized, refresh OK,
 *     re-read OK, retry NOT unauthorized → { kind: "result", outcome: <retry> };
 *                                          exactly ONE refresh + exactly ONE retry.
 *   - first unauthorized, refresh OK,
 *     re-read OK, retry STILL 401        → { kind: "second_unauthorized" }; exactly
 *                                          ONE refresh (NEVER a second), exactly ONE
 *                                          retry (a freshly-rotated-still-401 token
 *                                          is structurally dead).
 *   - first unauthorized, refresh
 *     invalid_grant                      → { kind: "must_reregister",
 *                                            reason: "invalid_grant" }; the thunk is
 *                                          NEVER called (no rotated token to retry).
 *   - first unauthorized, refresh
 *     retryable (5xx/network)            → { kind: "retryable" }; the thunk is NEVER
 *                                          called (a blip is transient, not dead).
 *   - first unauthorized, refresh OK,
 *     but the rotated pair re-read is
 *     gone (TOCTOU)                      → { kind: "must_reregister",
 *                                            reason: "no_stored_tokens" }; the thunk
 *                                          is NEVER called with a stale/absent token.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { refreshAndRetryOnce } from "../../lib/sil-client.js";
import { setApiUrl } from "../../lib/config.js";
import * as credentials from "../../lib/credentials.js";
import { getDataDir, getTokensPath, readTokens } from "../../lib/credentials.js";

const SIL_WEB = "https://sil-web.test.example.com"; // refresh origin (the ONLY leg)

/**
 * A minimal generic outcome union standing in for the three real outcome unions
 * (`SearchOutcome` / `LookupOutcome` / `IdentityOutcome`). The helper is generic
 * over `O` and inspects it ONLY through the caller-supplied `isUnauthorized`
 * predicate — so a tiny local union is a faithful `O`, proving the helper never
 * fabricates or inspects a concrete outcome shape.
 */
type Outcome =
  | { kind: "ok"; marker: string }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "retryable" };

const isUnauthorized = (o: Outcome): boolean => o.kind === "unauthorized";

const UNAUTHORIZED: Outcome = { kind: "unauthorized" };

let dataDir: string;
let priorSilDataDir: string | undefined;

/** Seed a stored token pair so the real `refreshStoredTokens` has a refresh token
 * to exchange (it reads `tokens.json` for `refresh_token` before contacting
 * sil-web). */
function seedTokens(access: string, refresh: string): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: access, refresh_token: refresh }),
    { mode: 0o600 },
  );
}

type Reply = { status: number; body: unknown } | "network-error";

/** One recorded outbound refresh request. */
interface RecordedRefresh {
  url: string;
  body: unknown;
}

/**
 * Route the sil-web `/auth/refresh` POST (the helper's only network leg, via the
 * real `refreshStoredTokens`). `reply(nthRefresh)` decides each refresh response;
 * any non-refresh URL is a hard failure (the helper must contact ONLY the refresh
 * endpoint — never the original read; that is the caller's `retryWithToken`).
 */
function installRefreshRouter(reply: (nthRefresh: number) => Reply): {
  refresh: RecordedRefresh[];
} {
  const refresh: RecordedRefresh[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (!url.includes("/auth/refresh")) {
        return Promise.reject(
          new Error(`unexpected fetch to ${url} — helper must contact ONLY /auth/refresh`),
        );
      }
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      refresh.push({ url, body });
      const r = reply(refresh.length - 1);
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
  return { refresh };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-refresh-retry-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  // refreshStoredTokens posts to getApiUrl() (sil-web). Pin it to a known host.
  setApiUrl(SIL_WEB);
});

afterEach(() => {
  vi.restoreAllMocks();
  setApiUrl("");
  delete process.env["SIL_API_URL"];
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("refreshAndRetryOnce — one-refresh-max success (the bound is structural)", () => {
  it("first 401 → refresh once → retry once with the rotated token → result (counts: 1 refresh, 1 retry)", async () => {
    // AC[unit]: first unauthorized, refresh succeeds, retry returns a non-401 ok.
    seedTokens("expired-at", "valid-rt");
    const rec = installRefreshRouter(() => ({
      status: 200,
      body: { access_token: "rotated-at", refresh_token: "rotated-rt" },
    }));

    const retryTokens: string[] = [];
    const retryWithToken = (accessToken: string): Promise<Outcome> => {
      retryTokens.push(accessToken);
      return Promise.resolve({ kind: "ok", marker: "retried-ok" });
    };

    const result = await refreshAndRetryOnce<Outcome>(
      UNAUTHORIZED,
      isUnauthorized,
      retryWithToken,
    );

    // The discriminant the caller maps: the retry's outcome, passed through.
    expect(result.kind).toBe("result");
    if (result.kind === "result") {
      expect(result.outcome).toEqual({ kind: "ok", marker: "retried-ok" });
    }
    // EXACTLY one refresh and EXACTLY one retry — the bound is structural.
    expect(rec.refresh.length).toBe(1);
    expect(retryTokens.length).toBe(1);
    // The refresh exchanged the STORED refresh token.
    expect((rec.refresh[0]!.body as { refresh_token?: string }).refresh_token).toBe("valid-rt");
    // The retry carried the ROTATED access token (proves re-read after rotation,
    // not a reuse of the stale `first`-call token).
    expect(retryTokens[0]).toBe("rotated-at");
    // tokens.json now holds the rotated pair (the real refresh persisted).
    const tokens = readTokens();
    expect(tokens!.access_token).toBe("rotated-at");
    expect(tokens!.refresh_token).toBe("rotated-rt");
  });
});

describe("refreshAndRetryOnce — a second 401 after a good refresh is terminal (the storm guard)", () => {
  it("first 401 → refresh OK → retry STILL 401 → second_unauthorized, NEVER a second refresh", async () => {
    // AC[unit]: the cardinal risk. A freshly-rotated token still rejected is
    // structurally dead — terminal, never another refresh cycle.
    seedTokens("expired-at", "valid-rt");
    const rec = installRefreshRouter(() => ({
      status: 200,
      body: { access_token: "rotated-at", refresh_token: "rotated-rt" },
    }));

    let retryCalls = 0;
    const retryWithToken = (): Promise<Outcome> => {
      retryCalls += 1;
      return Promise.resolve(UNAUTHORIZED); // the rotated token is ALSO rejected
    };

    const result = await refreshAndRetryOnce<Outcome>(
      UNAUTHORIZED,
      isUnauthorized,
      retryWithToken,
    );

    expect(result.kind).toBe("second_unauthorized");
    // EXACTLY one refresh (never a second on a freshly-rotated-still-401) and
    // EXACTLY one retry. This is the no-storm bound at the unit boundary.
    expect(rec.refresh.length).toBe(1);
    expect(retryCalls).toBe(1);
  });
});

describe("refreshAndRetryOnce — a dead refresh (invalid_grant) is terminal, with NO retry", () => {
  it("first 401 → refresh invalid_grant → must_reregister(invalid_grant), thunk NEVER called", async () => {
    // AC[unit]: a failed refresh leaves NO rotated token to retry with, so the
    // retry must not fire (retrying with the stale `first` token would be wrong).
    seedTokens("expired-at", "dead-rt");
    const rec = installRefreshRouter(() => ({ status: 401, body: { error: "invalid_grant" } }));

    let retryCalls = 0;
    const retryWithToken = (): Promise<Outcome> => {
      retryCalls += 1;
      return Promise.resolve({ kind: "ok", marker: "must-not-happen" });
    };

    const result = await refreshAndRetryOnce<Outcome>(
      UNAUTHORIZED,
      isUnauthorized,
      retryWithToken,
    );

    expect(result.kind).toBe("must_reregister");
    if (result.kind === "must_reregister") {
      expect(result.reason).toBe("invalid_grant");
    }
    // One refresh attempt, and the retry thunk was NEVER invoked.
    expect(rec.refresh.length).toBe(1);
    expect(retryCalls).toBe(0);
  });
});

describe("refreshAndRetryOnce — a transient refresh (5xx/network) surfaces retryable, NOT a re-register", () => {
  it("first 401 → refresh 5xx → retryable, thunk NEVER called", async () => {
    // AC[unit]: a refresh-leg 5xx is a blip, not a dead session. It must NOT be
    // mapped to a terminal re-register (the false-terminal trap), and the retry
    // must not fire (there is no rotated token).
    seedTokens("expired-at", "valid-rt");
    const rec = installRefreshRouter(() => ({ status: 503, body: { error: "unavailable" } }));

    let retryCalls = 0;
    const retryWithToken = (): Promise<Outcome> => {
      retryCalls += 1;
      return Promise.resolve({ kind: "ok", marker: "must-not-happen" });
    };

    const result = await refreshAndRetryOnce<Outcome>(
      UNAUTHORIZED,
      isUnauthorized,
      retryWithToken,
    );

    expect(result.kind).toBe("retryable");
    expect(rec.refresh.length).toBe(1);
    expect(retryCalls).toBe(0);
  });

  it("first 401 → refresh network-error (thrown fetch) → retryable, thunk NEVER called", async () => {
    // The network-throw arm of the same transient invariant: a thrown fetch on
    // the refresh leg (timeout / DNS hang) is `retryable`, never a re-register.
    seedTokens("expired-at", "valid-rt");
    const rec = installRefreshRouter(() => "network-error");

    let retryCalls = 0;
    const retryWithToken = (): Promise<Outcome> => {
      retryCalls += 1;
      return Promise.resolve({ kind: "ok", marker: "must-not-happen" });
    };

    const result = await refreshAndRetryOnce<Outcome>(
      UNAUTHORIZED,
      isUnauthorized,
      retryWithToken,
    );

    expect(result.kind).toBe("retryable");
    expect(rec.refresh.length).toBe(1);
    expect(retryCalls).toBe(0);
  });
});

describe("refreshAndRetryOnce — TOCTOU: rotated pair gone before re-read is terminal, with NO retry", () => {
  it("first 401 → refresh OK → tokens.json gone on the post-rotate re-read → must_reregister(no_stored_tokens), thunk NEVER called", async () => {
    // AC[unit]: if tokens.json disappears between the rotate (inside
    // refreshStoredTokens, which writes the new pair) and the HELPER's own
    // re-read of that pair, the helper must NOT retry with a stale/absent token —
    // it goes terminal `no_stored_tokens`.
    //
    // The race lives INSIDE the helper (between refreshStoredTokens returning and
    // the helper's readTokens()), so a fetch mock alone cannot reach it — a real
    // refresh re-writes tokens.json on success. We isolate the helper's OWN
    // re-read by spying readTokens: the FIRST read (refreshStoredTokens' internal
    // read of the refresh token) sees the seeded pair so the real refresh still
    // fires + rotates; every read AFTER it (the helper's post-rotate re-read)
    // yields null — the file "vanished" at exactly the guarded seam. The refresh
    // (real fetch + real classifyRefresh → `refreshed`) is NOT stubbed.
    seedTokens("expired-at", "valid-rt");
    const rec = installRefreshRouter(() => ({
      status: 200,
      body: { access_token: "rotated-at", refresh_token: "rotated-rt" },
    }));

    const seeded = { access_token: "expired-at", refresh_token: "valid-rt" };
    let readCalls = 0;
    vi.spyOn(credentials, "readTokens").mockImplementation(() => {
      readCalls += 1;
      // Call 1 = refreshStoredTokens' internal read (needs the refresh token);
      // call 2+ = the helper's post-rotate re-read (the TOCTOU — now empty).
      return readCalls === 1 ? seeded : null;
    });

    let retryCalls = 0;
    const retryWithToken = (): Promise<Outcome> => {
      retryCalls += 1;
      return Promise.resolve({ kind: "ok", marker: "must-not-happen" });
    };

    const result = await refreshAndRetryOnce<Outcome>(
      UNAUTHORIZED,
      isUnauthorized,
      retryWithToken,
    );

    expect(result.kind).toBe("must_reregister");
    if (result.kind === "must_reregister") {
      expect(result.reason).toBe("no_stored_tokens");
    }
    // The refresh leg DID fire (the seeded refresh token reached sil-web), and the
    // helper re-read AFTER it — but the retry was NOT made (no usable rotated token).
    expect(rec.refresh.length).toBe(1);
    expect(readCalls).toBeGreaterThanOrEqual(2); // internal read + the helper's re-read
    expect(retryCalls).toBe(0);
  });
});

describe("refreshAndRetryOnce — a non-401 first outcome passes through untouched", () => {
  it("first is ok → result(first), refresh NEVER attempted, thunk NEVER called", async () => {
    // AC[unit]: the refresh path is reachable ONLY via a first-call 401. Any
    // non-unauthorized first outcome short-circuits to passthrough.
    seedTokens("valid-at", "valid-rt");
    const rec = installRefreshRouter(() => ({
      status: 200,
      body: { access_token: "x", refresh_token: "y" },
    }));

    let retryCalls = 0;
    const retryWithToken = (): Promise<Outcome> => {
      retryCalls += 1;
      return Promise.resolve({ kind: "ok", marker: "must-not-happen" });
    };

    const first: Outcome = { kind: "ok", marker: "first-call-ok" };
    const result = await refreshAndRetryOnce<Outcome>(first, isUnauthorized, retryWithToken);

    expect(result.kind).toBe("result");
    if (result.kind === "result") {
      // The SAME first outcome, passed straight through.
      expect(result.outcome).toBe(first);
      expect(result.outcome).toEqual({ kind: "ok", marker: "first-call-ok" });
    }
    // No refresh, no retry — the helper did not touch the network at all.
    expect(rec.refresh.length).toBe(0);
    expect(retryCalls).toBe(0);
  });

  it("first is forbidden (403) → result(first), refresh NEVER attempted (403 is not a refresh trigger)", async () => {
    // Belt-and-braces over a SECOND non-401 kind: a 403/forbidden first outcome
    // must also pass through (only 401 triggers the refresh — a 403 token is valid
    // but unprovisioned, refreshing it changes nothing). Guards the predicate's
    // contract — `isUnauthorized` is the ONLY gate into the refresh path.
    seedTokens("valid-at", "valid-rt");
    const rec = installRefreshRouter(() => ({
      status: 200,
      body: { access_token: "x", refresh_token: "y" },
    }));

    let retryCalls = 0;
    const retryWithToken = (): Promise<Outcome> => {
      retryCalls += 1;
      return Promise.resolve({ kind: "ok", marker: "must-not-happen" });
    };

    const first: Outcome = { kind: "forbidden" };
    const result = await refreshAndRetryOnce<Outcome>(first, isUnauthorized, retryWithToken);

    expect(result.kind).toBe("result");
    if (result.kind === "result") {
      expect(result.outcome).toBe(first);
    }
    expect(rec.refresh.length).toBe(0);
    expect(retryCalls).toBe(0);
  });
});
