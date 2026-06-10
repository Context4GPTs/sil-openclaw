/**
 * INTEGRATION — the poll→claim lifecycle + refresh (tier: integration).
 *
 * The real poller + sil-client + credentials, wired through the actual
 * `sil_register` tool's execute(). The ONLY thing mocked is `fetch` —
 * that is the host/network boundary (there is no live sil-web or Postgres
 * in this repo; the true cross-service guarantee is sil-stage's e2e, goal
 * SC9, deferred). Fake timers drive the poll clock deterministically.
 *
 * Wire shapes are pinned to the ALREADY-MERGED contract
 * (`sil-services/cards/done/2026/sil-web-auth-endpoints.md`,
 * `claim/route.ts`, `auth/refresh/route.ts`):
 *   claim   200 {access_token,refresh_token,user} → success (once)
 *   claim   200 {status:"pending"}                → keep polling
 *   claim   409 / 410 / 404                       → terminal
 *   claim   5xx / network throw                   → retry within budget
 *   refresh 200 {access_token,refresh_token}      → rotate tokens.json
 *   refresh 401 {error:"invalid_grant"}           → terminal "must re-register"
 *
 * Covers (integration tier):
 *   SC4/F3/F4  full claim lifecycle across every status code;
 *   budget exhaustion → terminal timeout, NO live timer remains;
 *   SC8 (in-repo) two-data-dir isolation;
 *   SC7/F7 refresh rotates tokens.json, contacts ONLY sil-web, 401 terminal.
 *
 * Contract pinned for the implementation (expert-developer):
 *   - registerIdentityTools(api) / sil_register execute() starts a real
 *     bounded poll of POST <host>/api/v1/sessions/<id>/claim with
 *     { code_verifier } and, on a 200-with-access_token, writes tokens.json
 *     + config.json (atomic, 0600) into getDataDir();
 *   - a refresh entry point `refreshStoredTokens()` (sited in sil-client.ts
 *     / credentials.ts / identity.ts — the dev's call) reads the stored
 *     refresh token, POSTs <host>/api/v1/auth/refresh { refresh_token },
 *     rotates tokens.json on 200, and returns a terminal "must re-register"
 *     signal on 401 — contacting ONLY the resolved sil_web_url origin.
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
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerIdentityTools } from "../tools/identity.js";
import { refreshStoredTokens } from "../lib/sil-client.js";
import { setWebUrl, getWebUrl } from "../lib/config.js";
import { getDataDir, readTokens } from "../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
} from "./helpers/mock-plugin-api.js";

const TOOL = "sil_register";
const HOST = "https://sil-web.test.example.com";

let dataDir: string;
let priorSilDataDir: string | undefined;

interface StoredTokens {
  access_token: string;
  refresh_token: string;
}

/** Read a JSON file under the (resolved) data dir, or null. */
function readJsonInDataDir<T>(name: string): T | null {
  const path = join(getDataDir(), name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Parse a ToolResult payload. */
function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("no tool payload");
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Flush the credential write that `onDone` fires un-awaited after a claim
 * settles. The success path persists via async fs (writeFile→rename→chmod);
 * those are REAL libuv ops that don't drain under fake timers. After a
 * terminal the poller has already cleared its interval (no live fake timer),
 * so we can safely drop to the real clock, yield a few macrotasks for the
 * write chain to land, and return. Tests that read tokens.json after a
 * success MUST await this first — otherwise they race the disk write.
 *
 * NOTE for the dev pair: this settle dance is necessary BECAUSE the tool's
 * `handleDone` does not await `writeTokens`/`writeConfig` (identity.ts:165).
 * Functionally fine on a real clock, but it means a disk-write failure on
 * the success path is an unhandled rejection with no agent-visible signal —
 * flagged in the QA handoff for the review pass, not weakened here.
 */
async function settleAsyncIo(): Promise<void> {
  vi.useRealTimers();
  // A few real macrotask turns: enough for writeFile→rename→chmod to settle.
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

/** Poll the real filesystem until `tokens.json` appears (or time out). Used
 * after settleAsyncIo for an extra safety margin on slow CI disks. */
async function waitForTokens(timeoutMs = 1000): Promise<StoredTokens | null> {
  const deadline = Date.now() + timeoutMs;
  // Already on real timers via settleAsyncIo by the time this is called.
  while (Date.now() < deadline) {
    const t = readTokens();
    if (t !== null) return t;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return readTokens();
}

/**
 * A programmable fetch double. `respond` is called per request and returns
 * a queued Response (or throws to simulate a network error). Every request
 * URL is recorded so we can assert the Auth0-never-contacted invariant.
 */
function installFetch(
  respond: (url: string, init: RequestInit | undefined, callIndex: number) =>
    | { status: number; body: unknown }
    | "network-error",
): { calledUrls: string[]; callCount: () => number } {
  const calledUrls: string[] = [];
  let i = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      calledUrls.push(url);
      const r = respond(url, init, i++);
      if (r === "network-error") {
        return Promise.reject(new Error("simulated network failure"));
      }
      const res = new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json" },
      });
      return Promise.resolve(res);
    },
  );
  return { calledUrls, callCount: () => i };
}

const SUCCESS_BODY = {
  access_token: "fresh-at",
  refresh_token: "fresh-rt",
  user: { id: "user-42", name: "Polled User" },
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-claim-int-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl(HOST); // pin a known origin so host assertions are exact
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setWebUrl("");
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("claim lifecycle — 200 success persists credentials exactly once", () => {
  it("on a 200 token body, writes tokens.json + config.json and stops polling", async () => {
    const fx = installFetch(() => ({ status: 200, body: SUCCESS_BODY }));
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});
    // Drive the poll until the first tick claims.
    await vi.advanceTimersByTimeAsync(10_000);

    // Exactly-once + no leak are checked on the FAKE clock, immediately after
    // the claim tick (the poller clears its interval at settle): no further
    // poll fires and no timer remains.
    const callsAfterSuccess = fx.callCount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fx.callCount()).toBe(callsAfterSuccess);
    expect(vi.getTimerCount()).toBe(0);

    // The credential write is fired un-awaited in onDone — drain it on the
    // real clock before asserting the files landed.
    await settleAsyncIo();
    const tokens = await waitForTokens();
    expect(tokens).not.toBeNull();
    expect(tokens!.access_token).toBe("fresh-at");
    expect(tokens!.refresh_token).toBe("fresh-rt");

    const config = readJsonInDataDir<Record<string, unknown>>("config.json");
    expect(JSON.stringify(config)).toContain("user-42");
  });

  it("posts { code_verifier } to <host>/api/v1/sessions/<id>/claim", async () => {
    let claimUrl = "";
    let claimBody: unknown = null;
    installFetch((url, init) => {
      claimUrl = url;
      claimBody = init?.body;
      return { status: 200, body: SUCCESS_BODY };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    await vi.advanceTimersByTimeAsync(10_000);

    const sessionId = payload["session_id"] as string;
    expect(claimUrl).toBe(`${HOST}/api/v1/sessions/${sessionId}/claim`);
    const parsed = JSON.parse(claimBody as string) as { code_verifier?: string };
    expect(typeof parsed.code_verifier).toBe("string");
    expect(parsed.code_verifier!.length).toBeGreaterThanOrEqual(32);

    // Drain the un-awaited success write so it can't ENOENT against teardown.
    await settleAsyncIo();
    await waitForTokens();
  });
});

describe("claim lifecycle — 200 pending keeps polling (NOT terminal)", () => {
  it("polls again after a {status:'pending'} 200, then succeeds", async () => {
    let n = 0;
    const fx = installFetch(() => {
      n += 1;
      // First two ticks pending, third tick success.
      if (n < 3) return { status: 200, body: { status: "pending" } };
      return { status: 200, body: SUCCESS_BODY };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});
    await vi.advanceTimersByTimeAsync(30_000);

    // It kept polling through pending (≥3 calls) and ultimately persisted.
    expect(fx.callCount()).toBeGreaterThanOrEqual(3);
    await settleAsyncIo();
    expect((await waitForTokens())!.access_token).toBe("fresh-at");
  });

  it("does NOT persist anything while only pending is returned", async () => {
    installFetch(() => ({ status: 200, body: { status: "pending" } }));
    const api = createMockPluginApi();
    registerIdentityTools(api);
    await getTool(api, TOOL).execute("c1", {});
    await vi.advanceTimersByTimeAsync(15_000);
    // Pending is not success — no tokens file may appear.
    expect(readTokens()).toBeNull();
  });
});

describe("claim lifecycle — terminal status codes stop the loop", () => {
  for (const { code, body } of [
    { code: 410, body: { error: "session_expired", message: "Ask your agent to start again." } },
    { code: 409, body: { error: "already_claimed", message: "This session was already claimed." } },
    { code: 404, body: { error: "not_found", message: "Session not found." } },
  ]) {
    it(`HTTP ${code} → stops polling, persists NO tokens, no timer remains`, async () => {
      const fx = installFetch(() => ({ status: code, body }));
      const api = createMockPluginApi();
      registerIdentityTools(api);

      await getTool(api, TOOL).execute("c1", {});
      await vi.advanceTimersByTimeAsync(10_000);

      const callsAfterTerminal = fx.callCount();
      await vi.advanceTimersByTimeAsync(60_000);
      // No further polling after the terminal code.
      expect(fx.callCount()).toBe(callsAfterTerminal);
      // No tokens persisted on any terminal-failure path.
      expect(readTokens()).toBeNull();
      // No leaked timer.
      expect(vi.getTimerCount()).toBe(0);
    });
  }
});

describe("claim lifecycle — transient failures retry within budget", () => {
  it("retries after a 5xx and then succeeds (5xx is not terminal)", async () => {
    let n = 0;
    const fx = installFetch(() => {
      n += 1;
      if (n === 1) return { status: 503, body: { error: "unavailable" } };
      if (n === 2) return { status: 500, body: { error: "boom" } };
      return { status: 200, body: SUCCESS_BODY };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fx.callCount()).toBeGreaterThanOrEqual(3);
    await settleAsyncIo();
    expect((await waitForTokens())!.access_token).toBe("fresh-at");
  });

  it("retries after a network error (thrown fetch) and then succeeds", async () => {
    let n = 0;
    installFetch(() => {
      n += 1;
      if (n <= 2) return "network-error";
      return { status: 200, body: SUCCESS_BODY };
    });
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});
    await vi.advanceTimersByTimeAsync(30_000);

    await settleAsyncIo();
    expect((await waitForTokens())!.access_token).toBe("fresh-at");
  });
});

describe("claim lifecycle — budget exhaustion (never unbounded)", () => {
  it("stops at the deadline under perpetual pending, leaves NO live timer", async () => {
    const fx = installFetch(() => ({ status: 200, body: { status: "pending" } }));
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});
    // Advance well past any sane deadline (the session TTL is 30 min;
    // the budget must be ≤ that).
    await vi.advanceTimersByTimeAsync(45 * 60 * 1000);

    const callsAtDeadline = fx.callCount();
    // The clock keeps running; no more polls may fire — the loop is bounded.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(fx.callCount()).toBe(callsAtDeadline);

    // The verdict-critical assertion: no leftover timer after timeout.
    expect(vi.getTimerCount()).toBe(0);
    // And nothing was persisted (the user never finished).
    expect(readTokens()).toBeNull();
  });
});

describe("claim lifecycle — only sil-web is contacted (no Auth0 leg)", () => {
  it("every claim request targets the resolved sil_web_url origin", async () => {
    const fx = installFetch(() => ({ status: 200, body: SUCCESS_BODY }));
    const api = createMockPluginApi();
    registerIdentityTools(api);
    await getTool(api, TOOL).execute("c1", {});
    await vi.advanceTimersByTimeAsync(10_000);

    const resolvedOrigin = new URL(getWebUrl()).origin;
    for (const url of fx.calledUrls) {
      expect(new URL(url).origin).toBe(resolvedOrigin);
    }
    // Belt-and-suspenders: no auth0 host anywhere.
    for (const url of fx.calledUrls) {
      expect(url).not.toMatch(/auth0\.com/i);
    }
    // Drain the un-awaited success write so it can't ENOENT against teardown.
    await settleAsyncIo();
    await waitForTokens();
  });
});

describe("SC8 (in-repo) — two instances, two data dirs, independent tokens", () => {
  it("each instance claims into its OWN tokens.json; neither reads/overwrites the other", async () => {
    // Instance A: its own data dir + its own session/tokens.
    const dirA = mkdtempSync(join(tmpdir(), "sil-inst-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "sil-inst-b-"));
    try {
      // --- Instance A ---
      process.env["SIL_DATA_DIR"] = dirA;
      setWebUrl(HOST);
      installFetch(() => ({
        status: 200,
        body: { access_token: "at-A", refresh_token: "rt-A", user: { id: "user-42" } },
      }));
      const apiA = createMockPluginApi();
      registerIdentityTools(apiA);
      const payloadA = payloadOf(await getTool(apiA, TOOL).execute("a", {}));
      await vi.advanceTimersByTimeAsync(10_000);
      // Drain A's un-awaited success write (switches to real timers).
      await settleAsyncIo();
      await waitForTokens();
      vi.restoreAllMocks();

      // --- Instance B (separate data dir) ---
      process.env["SIL_DATA_DIR"] = dirB;
      setWebUrl(HOST);
      vi.useFakeTimers();
      installFetch(() => ({
        status: 200,
        body: { access_token: "at-B", refresh_token: "rt-B", user: { id: "user-42" } },
      }));
      const apiB = createMockPluginApi();
      registerIdentityTools(apiB);
      const payloadB = payloadOf(await getTool(apiB, TOOL).execute("b", {}));
      await vi.advanceTimersByTimeAsync(10_000);
      // Drain B's un-awaited success write.
      await settleAsyncIo();
      await waitForTokens();

      // Distinct sessions.
      expect(payloadA["session_id"]).not.toBe(payloadB["session_id"]);

      // Each dir holds its OWN token pair — no cross-contamination.
      const tokA = JSON.parse(readFileSync(join(dirA, "tokens.json"), "utf8")) as StoredTokens;
      const tokB = JSON.parse(readFileSync(join(dirB, "tokens.json"), "utf8")) as StoredTokens;
      expect(tokA.access_token).toBe("at-A");
      expect(tokB.access_token).toBe("at-B");
      expect(tokA.access_token).not.toBe(tokB.access_token);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});

describe("SC7/F7 — token refresh via sil-web, never Auth0", () => {
  beforeEach(() => {
    // Seed a stored token pair to refresh.
    const dir = getDataDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tokens.json"),
      JSON.stringify({ access_token: "old-at", refresh_token: "old-rt" }),
      { mode: 0o600 },
    );
  });

  it("POSTs <host>/api/v1/auth/refresh { refresh_token } and rotates tokens.json on 200", async () => {
    let refreshUrl = "";
    let refreshBody: unknown = null;
    installFetch((url, init) => {
      refreshUrl = url;
      refreshBody = init?.body;
      return {
        status: 200,
        body: { access_token: "rotated-at", refresh_token: "rotated-rt" },
      };
    });

    await refreshStoredTokens();

    expect(refreshUrl).toBe(`${HOST}/api/v1/auth/refresh`);
    const parsed = JSON.parse(refreshBody as string) as { refresh_token?: string };
    expect(parsed.refresh_token).toBe("old-rt");

    // tokens.json now carries the ROTATED pair.
    const tokens = readTokens();
    expect(tokens!.access_token).toBe("rotated-at");
    expect(tokens!.refresh_token).toBe("rotated-rt");
  });

  it("contacts ONLY the resolved sil_web_url origin (Auth0 is never called directly)", async () => {
    const fx = installFetch(() => ({
      status: 200,
      body: { access_token: "rotated-at", refresh_token: "rotated-rt" },
    }));
    await refreshStoredTokens();

    const resolvedOrigin = new URL(getWebUrl()).origin;
    expect(fx.calledUrls.length).toBeGreaterThan(0);
    for (const url of fx.calledUrls) {
      expect(new URL(url).origin).toBe(resolvedOrigin);
      expect(url).not.toMatch(/auth0\.com/i);
    }
  });

  it("on a 401 invalid_grant, surfaces a terminal must-re-register and does NOT keep the dead token as valid", async () => {
    installFetch(() => ({
      status: 401,
      body: { error: "invalid_grant", message: "The refresh token was rejected." },
    }));

    const result = await refreshStoredTokens();
    // The shape is the impl's call; assert a terminal must-re-register
    // signal is surfaced (not a silent success).
    const blob = JSON.stringify(result);
    expect(blob).toMatch(/re-?register|invalid_grant|must.*register/i);

    // The known-dead token must not be presented as a fresh, valid pair.
    // Either tokens.json is cleared, or it is NOT silently overwritten with
    // a "valid" marker — at minimum the access token was not rotated to a
    // new value (no new pair was minted from a rejected refresh).
    const tokens = readTokens();
    if (tokens !== null) {
      expect(tokens.access_token).not.toBe("rotated-at");
    }
  });
});
