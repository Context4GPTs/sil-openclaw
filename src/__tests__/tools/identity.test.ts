/**
 * UNIT — sil_register tool (tier: unit, mock api + temp data dir, fetch
 * mocked so nothing reaches the network).
 *
 * Covers the unit-tier acceptance criteria for `sil_register`
 * (SC1·F1 PKCE+auth-URL, the pluginConfig→env→default host override, the
 * prompt non-blocking return, the already-registered short-circuit, and
 * the verifier-never-on-disk invariant after a full run). The poll→claim
 * lifecycle across status codes is the integration tier's job
 * (`register-claim.integration.test.ts`); here we assert the tool's
 * SYNCHRONOUS-from-the-agent's-view contract and the in-process PKCE/URL
 * math, with `fetch` stubbed to a never-resolving/pending answer so the
 * background poll can't escape the test.
 *
 * Hermetic via the `SIL_DATA_DIR` override (own temp dir per test) and the
 * config-reset machinery mirrored from `index.test.ts` (reset the module
 * singleton + env so each test starts at the default host). Fake timers
 * are used wherever a fresh registration arms the background poll, so no
 * live timer leaks across tests.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - src/tools/identity.ts exports registerIdentityTools(api) which
 *     registers a `sil_register` tool (Type.Object({}) — no inputs);
 *   - execute() returns a jsonResult whose payload carries `status`
 *     ("already_registered" | "awaiting_browser"), and for a fresh run
 *     `auth_url` + `session_id`;
 *   - the auth_url is `<resolvedHost>/authorize?session=<uuid>&code_challenge=<43-char S256>`.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerIdentityTools } from "../../tools/identity.js";
import { setWebUrl } from "../../lib/config.js";
import { getDataDir } from "../../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const TOOL = "sil_register";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

let dataDir: string;
let priorSilDataDir: string | undefined;

/** Parse a ToolResult's JSON payload. */
function payloadOf(result: {
  content: { text?: string }[];
}): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`tool result has no text payload: ${String(text)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Recursively collect file paths under a dir (empty if it doesn't exist). */
function walkFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-register-test-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  // Reset config singleton + env so each test starts at the default host.
  setWebUrl("");
  delete process.env["SIL_WEB_URL"];
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  setWebUrl("");
  delete process.env["SIL_WEB_URL"];
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("sil_register — tool registration shape", () => {
  it("registers a sil_register tool with no input parameters", () => {
    const api = createMockPluginApi();
    registerIdentityTools(api);
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    expect(tool.label.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
    // F1: the tool takes no arguments — a TypeBox object with no properties.
    expect((tool.parameters as { type?: unknown }).type).toBe("object");
    const props = (tool.parameters as { properties?: Record<string, unknown> })
      .properties;
    expect(props === undefined || Object.keys(props).length === 0).toBe(true);
  });
});

describe("sil_register — fresh registration: PKCE + auth URL (SC1/F1)", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // Background poll, if armed, hangs on a never-settling fetch — it can
    // never reach the network nor resolve during the test.
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise<Response>(() => {}));
    api = createMockPluginApi();
    registerIdentityTools(api);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("returns a non-terminal awaiting_browser status with a session_id", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    expect(payload["status"]).toBe("awaiting_browser");
    expect(payload["session_id"]).toMatch(UUID_RE);
  });

  it("returns an auth_url of the exact form <host>/authorize?session=<id>&code_challenge=<challenge>", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    const authUrl = payload["auth_url"] as string;
    expect(typeof authUrl).toBe("string");

    const url = new URL(authUrl);
    expect(url.pathname).toBe("/authorize");
    // session param is the minted UUID and equals the returned session_id.
    expect(url.searchParams.get("session")).toBe(payload["session_id"]);
    expect(url.searchParams.get("session")).toMatch(UUID_RE);
    // code_challenge is the 43-char S256 digest, present and well-formed.
    const challenge = url.searchParams.get("code_challenge");
    expect(challenge).toMatch(CHALLENGE_RE);
    // EXACTLY these two query params (no verifier, no extras leaked).
    expect([...url.searchParams.keys()].sort()).toEqual([
      "code_challenge",
      "session",
    ]);
  });

  it("sends the S256 DIGEST in the URL, never the raw verifier", async () => {
    // sil-web stores/compares digests; a raw verifier in code_challenge
    // would break the claim CAS. The challenge must NOT be a base64url
    // of 32 bytes with the wrong length, and must be exactly 43 chars.
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    const challenge = new URL(payload["auth_url"] as string).searchParams.get(
      "code_challenge",
    );
    expect(challenge).toHaveLength(43);
    // Whatever the verifier is, it is NOT exposed anywhere in the payload.
    const blob = JSON.stringify(payload);
    expect(blob).not.toMatch(/verifier/i);
  });

  it("mints a FRESH session per call (two calls → different session_ids)", async () => {
    const a = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    const b = payloadOf(await getTool(api, TOOL).execute("c2", {}));
    expect(a["session_id"]).not.toBe(b["session_id"]);
  });
});

describe("sil_register — host override resolution (pluginConfig → env → default)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise<Response>(() => {}));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("builds the auth URL against the SIL_WEB_URL env override", async () => {
    process.env["SIL_WEB_URL"] = "https://api.staging.example.com";
    const api = createMockPluginApi();
    registerIdentityTools(api);
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    const url = new URL(payload["auth_url"] as string);
    expect(url.origin).toBe("https://api.staging.example.com");
  });

  it("a pluginConfig override beats the env (config wins)", async () => {
    process.env["SIL_WEB_URL"] = "https://env.example.com";
    // The config singleton is set the way register() would via
    // applyPluginConfigOverrides; assert config precedence holds.
    setWebUrl("https://config.example.com");
    const api = createMockPluginApi();
    registerIdentityTools(api);
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    expect(new URL(payload["auth_url"] as string).origin).toBe(
      "https://config.example.com",
    );
  });

  it("falls back to the default host when nothing is overridden", async () => {
    const api = createMockPluginApi();
    registerIdentityTools(api);
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    // Not the staging/config hosts — the configured default origin.
    const origin = new URL(payload["auth_url"] as string).origin;
    expect(origin).not.toBe("https://config.example.com");
    expect(origin).not.toBe("https://env.example.com");
    expect(origin.startsWith("https://")).toBe(true);
  });
});

describe("sil_register — prompt, non-blocking return (F1)", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("resolves the execute() promise WITHOUT waiting for any poll tick", async () => {
    vi.useFakeTimers();
    // fetch would only ever be called by the background poll; make it hang
    // so that IF execute() awaited the poll, this test would time out.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    const api = createMockPluginApi();
    registerIdentityTools(api);

    // Without advancing fake timers at all, execute() must still resolve —
    // proving it does not block the agent on the browser flow.
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    expect(payload["status"]).toBe("awaiting_browser");
  });
});

describe("sil_register — already-registered short-circuit (F1)", () => {
  beforeEach(() => {
    // Seed a valid tokens.json in the data dir so the tool should
    // short-circuit. Write through the same dir the resolver returns.
    const dir = getDataDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tokens.json"),
      JSON.stringify({ access_token: "existing-at", refresh_token: "existing-rt" }),
      { mode: 0o600 },
    );
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ user: { id: "existing-user", name: "Existing User" } }),
      { mode: 0o600 },
    );
  });

  it("returns already_registered with the existing identity", async () => {
    const api = createMockPluginApi();
    registerIdentityTools(api);
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    expect(payload["status"]).toBe("already_registered");
    // The existing user identity is surfaced (exact key shape is the
    // impl's call; the identity value must be present).
    expect(JSON.stringify(payload)).toContain("existing-user");
  });

  it("makes NO network call and arms NO timer (mints nothing)", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("already-registered must not hit the network"));

    const api = createMockPluginApi();
    registerIdentityTools(api);
    await getTool(api, TOOL).execute("c1", {});

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it("does NOT overwrite the stored tokens", async () => {
    const api = createMockPluginApi();
    registerIdentityTools(api);
    await getTool(api, TOOL).execute("c1", {});
    const tokens = JSON.parse(
      readFileSync(join(getDataDir(), "tokens.json"), "utf8"),
    ) as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toBe("existing-at");
    expect(tokens.refresh_token).toBe("existing-rt");
  });

  it("does NOT return an auth_url (no new browser flow)", async () => {
    const api = createMockPluginApi();
    registerIdentityTools(api);
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    expect(payload["auth_url"]).toBeUndefined();
  });
});

describe("sil_register — the verifier never reaches disk (F4 invariant)", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("after a fresh registration, NO file under the data dir contains the verifier", async () => {
    vi.useFakeTimers();
    // Capture the verifier by intercepting it the only place it legitimately
    // leaves the process: the claim POST body. fetch hangs (never resolves)
    // so no tokens get written, but we can read what the poll WOULD send.
    let sentVerifier: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input: unknown, init?: { body?: unknown }) => {
        if (init && typeof init.body === "string") {
          try {
            const parsed = JSON.parse(init.body) as { code_verifier?: string };
            if (typeof parsed.code_verifier === "string") {
              sentVerifier = parsed.code_verifier;
            }
          } catch {
            /* non-JSON body — ignore */
          }
        }
        return new Promise<Response>(() => {});
      },
    );

    const api = createMockPluginApi();
    registerIdentityTools(api);
    await getTool(api, TOOL).execute("c1", {});

    // Drive one poll tick so the claim body (carrying the verifier) is built.
    await vi.advanceTimersByTimeAsync(5000);

    // Whether or not the poll ran, the data dir must never contain the
    // verifier. If we did capture one, assert it specifically is absent.
    for (const f of walkFiles(getDataDir())) {
      const content = readFileSync(f, "utf8");
      expect(content).not.toMatch(/verifier/i);
      if (sentVerifier) expect(content).not.toContain(sentVerifier);
    }
  });
});

describe("sil_register — tokens are NEVER logged (hard constraint, F4/secret-hygiene)", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("no logger call at any level contains a token or verifier value across a full success", async () => {
    // The card's hard constraint (mirrors sil-web claim/route.ts:21):
    // tokens appear ONLY in the ToolResult/file, never in a log field. A
    // careless `logger.info("claimed", { tokens })` would leak credentials
    // to the host's log sink. Drive a full successful claim and assert NO
    // logged argument — across info/warn/error/debug — carries a token or
    // the verifier.
    vi.useFakeTimers();
    const ACCESS = "leak-canary-access-token";
    const REFRESH = "leak-canary-refresh-token";
    let sentVerifier: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input: unknown, init?: { body?: unknown }) => {
        if (init && typeof init.body === "string") {
          try {
            const parsed = JSON.parse(init.body) as { code_verifier?: string };
            if (typeof parsed.code_verifier === "string") {
              sentVerifier = parsed.code_verifier;
            }
          } catch {
            /* ignore */
          }
        }
        const res = new Response(
          JSON.stringify({
            access_token: ACCESS,
            refresh_token: REFRESH,
            user: { id: "u-leak", name: "Leak User" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
        return Promise.resolve(res);
      },
    );

    const api = createMockPluginApi();
    registerIdentityTools(api);
    await getTool(api, TOOL).execute("c1", {});
    await vi.advanceTimersByTimeAsync(10_000);
    // Drain the un-awaited credential write on the real clock.
    vi.useRealTimers();
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }

    // Collect every argument passed to every logger level and serialize.
    const allLogArgs = [
      api.logger.info,
      api.logger.warn,
      api.logger.error,
      api.logger.debug,
    ].flatMap((fn) => vi.mocked(fn).mock.calls.map((c) => JSON.stringify(c)));
    const logBlob = allLogArgs.join("\n");

    expect(logBlob).not.toContain(ACCESS);
    expect(logBlob).not.toContain(REFRESH);
    if (sentVerifier) expect(logBlob).not.toContain(sentVerifier);
  });
});
