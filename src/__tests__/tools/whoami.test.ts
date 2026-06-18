/**
 * UNIT — sil_whoami tool (tier: unit, mock api + temp data dir, fetch spied so
 * nothing reaches the network).
 *
 * Covers the unit-tier acceptance criteria for `sil_whoami`:
 *   - the no-input tool-registration shape (Type.Object({}) — the JWT
 *     identifies the user, so no parameters);
 *   - the NOT-REGISTERED short-circuit: no tokens.json → a clear, structured
 *     "run sil_register" outcome with ZERO network calls, never an
 *     empty/null/ambiguous identity, never a crash, never a hang;
 *   - the success result carries ONLY the identity payload — no access token,
 *     no refresh token, no raw Authorization header echoed back to the agent;
 *   - the tokens/JWT/PII leak-canary: across success AND not-registered paths,
 *     no token value AND no PII string (name/address) appears in any logger
 *     call at any level.
 *
 * The read→401→refresh→retry-once CHOREOGRAPHY and the two-origin / no-storm
 * guarantees are the integration tier's job (whoami.integration.test.ts), where
 * the real sil-client + credentials + refresh are wired and only `fetch` is
 * mocked. Here we pin the tool's agent-facing contract and the privacy
 * invariants, with `fetch` stubbed.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override and the config-reset
 * machinery mirrored from the sil_register unit tests.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - src/tools/identity.ts#registerIdentityTools(api) also registers a
 *     `sil_whoami` tool (Type.Object({}) — no inputs);
 *   - execute() returns a jsonResult; on success the payload carries the
 *     authenticated user's identity (name + addresses) and NOTHING crediential;
 *   - with no tokens.json, execute() returns a terminal "not registered"
 *     payload naming `sil_register` as the recovery action and makes no fetch.
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
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerIdentityTools } from "../../tools/identity.js";
import { setWebUrl, setApiUrl } from "../../lib/config.js";
import { getDataDir, getTokensPath, getConfigPath } from "../../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const TOOL = "sil_whoami";

const REAL_IDENTITY = {
  name: "Ada Lovelace",
  addresses: [
    { line1: "12 Analytical Engine Way", city: "London", country: "GB" },
  ],
};

let dataDir: string;
let priorSilDataDir: string | undefined;

/** Parse a ToolResult's JSON payload. */
function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`tool result has no text payload: ${String(text)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Seed a valid token pair so whoami proceeds to the identity read. */
function seedTokens(access = "stored-at", refresh = "stored-rt"): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: access, refresh_token: refresh }),
    { mode: 0o600 },
  );
}

/** Install a fetch double that always returns a 200 real-identity envelope. */
function installIdentityOkFetch(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          protocol: "ucp",
          domain: "identity",
          result: REAL_IDENTITY,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-whoami-unit-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("sil_whoami — tool registration shape", () => {
  it("registers a sil_whoami tool with no input parameters", () => {
    const api = createMockPluginApi();
    registerIdentityTools(api);
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    expect(tool.label.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
    // No arguments — a TypeBox object with no properties (the JWT identifies
    // the user; whoami takes nothing).
    expect((tool.parameters as { type?: unknown }).type).toBe("object");
    const props = (tool.parameters as { properties?: Record<string, unknown> })
      .properties;
    expect(props === undefined || Object.keys(props).length === 0).toBe(true);
  });
});

describe("sil_whoami — not registered (no tokens.json) short-circuit", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // No tokens seeded. fetch is wired to FAIL loudly if the tool calls it —
    // a not-registered whoami must make ZERO network calls (nothing to auth).
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("not-registered must not hit the network"));
    api = createMockPluginApi();
    registerIdentityTools(api);
  });

  it("makes NO sil-api call (nothing to authenticate with)", async () => {
    await getTool(api, TOOL).execute("c1", {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a clear, structured outcome naming `sil_register` as the recovery", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    // The recovery action must be unambiguous and name the exact tool to run.
    expect(JSON.stringify(payload)).toContain("sil_register");
  });

  it("does NOT return an empty / null / ambiguous identity (no dead end)", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    // Not an empty object, not a null identity — a distinct, actionable state.
    expect(Object.keys(payload).length).toBeGreaterThan(0);
    // It must NOT masquerade as a real identity read.
    expect(payload["name"]).toBeUndefined();
    expect(payload["addresses"]).toBeUndefined();
    // It must carry a status/error marker the agent can branch on.
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/status|error|not.?registered/);
  });

  it("does NOT crash and resolves promptly (no hang) when not registered", async () => {
    // If execute() threw or hung, this await would reject or time out.
    const result = await getTool(api, TOOL).execute("c1", {});
    expect(result).toBeTypeOf("object");
    expect(result.content[0]?.text).toBeTypeOf("string");
  });

  // FIX C, criterion C-4 (card line 191) — the never-registered case must keep
  // its existing terminal `not_registered` contract. Fix C adds a NEW
  // "registered-but-persistence-failed" state to the not-registered branch
  // (identity.ts:170-172); this guard pins that the genuine never-registered
  // case is NOT swallowed or replaced by that new state. In a FRESH process with
  // no in-process persist-failure marker set and no tokens.json, whoami must
  // still return exactly `not_registered` with `sil_register` as the recovery.
  //
  // This is a REGRESSION GUARD (green today, must stay green through fix C): it
  // is the boundary the new persistence_failed branch must not cross.
  it("returns the EXACT `not_registered` status (NOT persistence_failed) with sil_register recovery — C-4 no-regression", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    // The exact existing terminal status — unchanged by fix C.
    expect(payload["status"]).toBe("not_registered");
    // It must NOT have been replaced/aliased by the new failed-persistence state.
    expect(payload["status"]).not.toBe("persistence_failed");
    // The recovery is the existing "run sil_register" (a bare re-register, since
    // nothing was ever persisted — there is no data dir to fix).
    expect(payload["recovery"]).toBe("sil_register");
    // No path/cause leaks into a genuine never-registered outcome (those belong
    // ONLY to the persistence_failed state).
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).not.toMatch(/eacces|enospc|enotdir|persistence.?failed/);
  });
});

describe("sil_whoami — success result carries ONLY identity (no credential echo)", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    seedTokens("secret-access-token", "secret-refresh-token");
    installIdentityOkFetch();
    api = createMockPluginApi();
    registerIdentityTools(api);
  });

  it("surfaces the authenticated user's name + addresses", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    const blob = JSON.stringify(payload);
    expect(blob).toContain("Ada Lovelace");
    expect(blob).toContain("Analytical Engine Way");
  });

  it("does NOT echo the access token, refresh token, or Authorization header", async () => {
    const blob = JSON.stringify(
      payloadOf(await getTool(api, TOOL).execute("c1", {})),
    );
    // Credentials must never travel back to the agent in the result.
    expect(blob).not.toContain("secret-access-token");
    expect(blob).not.toContain("secret-refresh-token");
    expect(blob).not.toMatch(/Bearer/i);
    expect(blob).not.toMatch(/authorization/i);
  });
});

describe("sil_whoami — tokens / JWT / PII never logged (leak-canary)", () => {
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

  it("on the SUCCESS path, no logger call carries a token value or PII (name/address)", async () => {
    seedTokens("leak-canary-access", "leak-canary-refresh");
    installIdentityOkFetch();
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});

    const blob = logBlob(api);
    // Credentials never logged.
    expect(blob).not.toContain("leak-canary-access");
    expect(blob).not.toContain("leak-canary-refresh");
    expect(blob).not.toMatch(/Bearer/i);
    // PII never logged — neither the name nor any address string.
    expect(blob).not.toContain("Ada Lovelace");
    expect(blob).not.toContain("Analytical Engine Way");
  });

  it("on the NOT-REGISTERED path, no logger call carries a token value", async () => {
    // Even with a (dead) token present but a not-registered/early outcome, the
    // token must not leak. Seed a token then assert no log line carries it on
    // any early-return path the tool may take.
    seedTokens("leak-canary-access-2", "leak-canary-refresh-2");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    // No refresh token rotation possible — refresh also 401s → terminal.
    // (Full terminal choreography is integration-tier; here we only assert the
    // log hygiene holds on a non-success path.)
    const api = createMockPluginApi();
    registerIdentityTools(api);

    await getTool(api, TOOL).execute("c1", {});

    const blob = logBlob(api);
    expect(blob).not.toContain("leak-canary-access-2");
    expect(blob).not.toContain("leak-canary-refresh-2");
    expect(blob).not.toMatch(/Bearer/i);
  });
});
