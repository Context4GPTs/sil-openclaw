/**
 * UNIT — sil_register atomic-link presentation (tier: unit, mock api + temp
 * data dir, fetch stubbed so the background poll never escapes the test).
 *
 * Covers acceptance fix **A — atomic, unbreakable registration link** (card
 * lines 172-177). The reported production break: `sil_register` returns the
 * auth URL `…/authorize?session=…&code_challenge=…` INLINE in a human-readable
 * `message` prose string, and a chat-surface auto-linker terminates the link at
 * the `&`, dropping `code_challenge` — so the opened link 400s
 * `invalid_code_challenge`.
 *
 * The fix is purely PRESENTATION (the URL is correct on the wire): present the
 * link on its OWN line, wrapped in angle brackets `<…>` (the RFC-3986 / Markdown
 * convention that bounds a greedy linker around the whole URL, `&` included),
 * while keeping `auth_url` the canonical, byte-for-byte UNWRAPPED structured
 * field that agents parse. The verifier (the claim secret) must never appear in
 * any result field while doing so.
 *
 * Tier rationale: A is asserted on the RETURNED tool-result shape (no I/O, no
 * network), so it is unit. The poll→claim lifecycle is the integration tier's
 * job (register-claim.integration.test.ts).
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override + the config-reset machinery
 * mirrored from the sil_register unit tests; fetch is stubbed to a
 * never-resolving promise so the armed background poll can't reach the network
 * nor settle during the test. Fake timers ensure no live timer leaks.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - sil_register's fresh-registration result still carries `auth_url` as a
 *     complete, UNWRAPPED string `<host>/authorize?session=<uuid>&code_challenge=<43-char S256>`;
 *   - the human-facing presented link (the `message`, or whichever field a human
 *     renders) carries that full URL on its OWN line, angle-bracket wrapped, so a
 *     greedy auto-linker that stops a BARE url at `&` still captures `code_challenge`;
 *   - NO PKCE verifier appears in ANY result field.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerIdentityTools } from "../../tools/identity.js";
import { setWebUrl } from "../../lib/config.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const TOOL = "sil_register";
const CHALLENGE_RE = /[A-Za-z0-9_-]{43}/;

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

/**
 * A GREEDY chat auto-linker, modelling the EXACT class of renderer that caused
 * the production break: it linkifies a bare `http(s)://…` run of "URL-safe"
 * characters and TERMINATES the link at the first `&` (treating `&` as a prose
 * separator / entity boundary). On a BARE inline URL this drops
 * `&code_challenge=…`. The fix's angle-bracket `<…>` wrap is meant to give the
 * linker an explicit "this whole span is one link" delimiter so the captured
 * target includes everything up to the closing `>` — `&code_challenge` included.
 *
 * Returns the list of link targets the renderer would produce from `text`.
 * Models both behaviours:
 *   - an angle-bracket-delimited `<URL>` → the WHOLE URL is one link target
 *     (the bracket bounds it, so `&` inside is captured);
 *   - an undelimited bare URL → the link target STOPS at the first `&`.
 */
function greedyAutoLink(text: string): string[] {
  const targets: string[] = [];

  // 1) Angle-bracket-delimited links: <scheme://...> — the entire inner span
  //    is one target (this is what the fix relies on; `&` inside is kept).
  const bracketed = /<((?:https?:\/\/)[^>\s]+)>/g;
  let m: RegExpExecArray | null;
  const bracketSpans: Array<[number, number]> = [];
  while ((m = bracketed.exec(text)) !== null) {
    targets.push(m[1]!);
    bracketSpans.push([m.index, m.index + m[0].length]);
  }

  // 2) Bare (undelimited) URLs anywhere NOT already inside a <...> span. A bare
  //    URL is linkified only up to the first `&` (the greedy-linker bug). We
  //    blank out the bracketed spans first so a `<...>` URL isn't also matched
  //    here as a bare URL.
  let bare = text;
  for (const [start, end] of bracketSpans) {
    bare = bare.slice(0, start) + " ".repeat(end - start) + bare.slice(end);
  }
  // Match a bare URL run, stopping at whitespace OR `&` (the truncation bug).
  const bareUrl = /https?:\/\/[^\s&<>]+/g;
  while ((m = bareUrl.exec(bare)) !== null) {
    targets.push(m[0]);
  }

  return targets;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-register-link-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  // Reset config singleton + env so each test starts at the default host.
  setWebUrl("");
  delete process.env["SIL_WEB_URL"];
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  setWebUrl("");
  delete process.env["SIL_WEB_URL"];
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Arm a fresh registration and return the parsed result payload. fetch hangs
 * (never resolves) so the background poll can't escape; fake timers keep any
 * armed interval from leaking past the test.
 */
async function freshRegister(api: MockPluginAPI): Promise<Record<string, unknown>> {
  return payloadOf(await getTool(api, TOOL).execute("c1", {}));
}

describe("sil_register — A: auth_url stays the complete, UNWRAPPED machine field", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    api = createMockPluginApi();
    registerIdentityTools(api);
  });

  it("auth_url is exactly <host>/authorize?session=<uuid>&code_challenge=<43-char S256> — no <> wrap, no encoding", async () => {
    // A-1: the existing `auth_url` contract is preserved byte-for-byte. Agents
    // parse THIS field, so it must remain a plain, parseable URL — never the
    // angle-bracket-wrapped human presentation, never percent-encoded.
    const payload = await freshRegister(api);
    const authUrl = payload["auth_url"];
    expect(typeof authUrl).toBe("string");
    const s = authUrl as string;

    // Not wrapped in angle brackets — the wrapping is for the human surface ONLY.
    expect(s.startsWith("<")).toBe(false);
    expect(s.endsWith(">")).toBe(false);
    expect(s).not.toContain("<");
    expect(s).not.toContain(">");

    // It is a parseable URL carrying BOTH params, unencoded `&` separator.
    const url = new URL(s);
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("session")).toBe(payload["session_id"]);
    const challenge = url.searchParams.get("code_challenge");
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // EXACTLY the two query params — no extras, and the verifier is NOT one.
    expect([...url.searchParams.keys()].sort()).toEqual([
      "code_challenge",
      "session",
    ]);
    // The raw string uses a literal `&` (not `&amp;` / `%26`) between the two —
    // mangling the wire URL is the explicitly-ruled-out alternative.
    expect(s).toContain(`&code_challenge=${challenge}`);
    expect(s).not.toContain("&amp;");
    expect(s).not.toContain("%26");
  });
});

describe("sil_register — A: the human-presented link is one atomic, unbreakable target", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    api = createMockPluginApi();
    registerIdentityTools(api);
  });

  it("the presented message carries the FULL url (both session + code_challenge), on its own line, angle-bracket wrapped", async () => {
    // A-2: the human-facing presented link must carry the full URL including
    // BOTH params as a single atomic target — on its own line, wrapped in
    // angle brackets so a chat auto-linker captures the entire URL.
    const payload = await freshRegister(api);
    const message = payload["message"];
    expect(typeof message).toBe("string");
    const msg = message as string;
    const authUrl = payload["auth_url"] as string;

    // The full, unwrapped URL value appears in the message (both params present).
    expect(msg).toContain(authUrl);
    expect(msg).toContain(`session=${payload["session_id"]}`);
    expect(msg).toMatch(CHALLENGE_RE);

    // It is angle-bracket wrapped: the exact `<authUrl>` token appears.
    expect(msg).toContain(`<${authUrl}>`);

    // … and it sits on its OWN line — the line that contains the wrapped URL
    // contains ONLY the wrapped URL (no trailing prose that a linker could fold
    // the `&` into, and no leading prose glued to the `<`).
    const ownLine = msg
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.includes(authUrl));
    expect(ownLine).toBeDefined();
    expect(ownLine).toBe(`<${authUrl}>`);
  });

  it("survives a GREEDY auto-linker that truncates a BARE url at the first & — the extracted target still has code_challenge (the EXACT production regression)", async () => {
    // A-3: THE load-bearing RED for this card — the precise reported break. Run
    // the presented message through a greedy auto-linker that stops a BARE URL
    // at the first `&`. Because the URL is angle-bracket delimited, the linker
    // must capture the WHOLE URL, so the extracted/linkified target STILL
    // contains `code_challenge=…`.
    //
    // EXPECT RED against current code: today `message` is the prose
    // `"Open this URL in a browser to register: <authUrl>"` with a BARE url, so
    // the greedy linker truncates the target at the `&` and `code_challenge` is
    // dropped — exactly the production 400.
    const payload = await freshRegister(api);
    const authUrl = payload["auth_url"] as string;
    const message = payload["message"] as string;
    const expectedChallenge = new URL(authUrl).searchParams.get("code_challenge")!;

    const targets = greedyAutoLink(message);

    // The linker produced at least one target …
    expect(targets.length).toBeGreaterThan(0);
    // … and AT LEAST ONE captured target carries the full URL INCLUDING
    // code_challenge (the bracket delimiter defeats the &-truncation).
    const carriesChallenge = targets.filter((t) =>
      t.includes(`code_challenge=${expectedChallenge}`),
    );
    expect(carriesChallenge.length).toBeGreaterThan(0);

    // The headline regression assertion, stated as a guard: it must NOT be the
    // case that EVERY linkified target was truncated at the `&` (which is what
    // the bare-URL prose produces today). At least one target keeps the
    // challenge — so the opened link cannot 400 invalid_code_challenge.
    const allTruncated = targets.every(
      (t) => !t.includes("code_challenge"),
    );
    expect(allTruncated).toBe(false);

    // Self-check the linker model is faithful: the SAME greedy linker, run over
    // the BARE url (the current buggy presentation), DOES truncate at `&` —
    // proving the test would catch a regression to a bare URL, not a no-op.
    const bareTargets = greedyAutoLink(`Open this URL to register: ${authUrl}`);
    expect(bareTargets.some((t) => t.includes("code_challenge"))).toBe(false);
  });
});

describe("sil_register — A: the atomic-link presentation never leaks the PKCE verifier", () => {
  let api: MockPluginAPI;
  let sentVerifier: string | null;

  beforeEach(() => {
    vi.useFakeTimers();
    sentVerifier = null;
    // Capture the verifier the only place it legitimately leaves the process —
    // the claim POST body — so we can assert that SPECIFIC value is absent from
    // every result field, not merely the substring "verifier".
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
    api = createMockPluginApi();
    registerIdentityTools(api);
  });

  it("no result field (auth_url, message, session_id, instructions, …) contains the verifier or the word 'verifier'", async () => {
    // A-4: the atomic-link change must not leak the claim secret. The verifier
    // lives only in the poll closure; it must never enter auth_url/message/etc.
    const payload = await freshRegister(api);

    // Drive one poll tick so the claim body (carrying the verifier) is built and
    // captured by the fetch spy above.
    await vi.advanceTimersByTimeAsync(5000);

    const blob = JSON.stringify(payload);
    // No field literally named/containing "verifier".
    expect(blob).not.toMatch(/verifier/i);
    // And — the strong form — the SPECIFIC minted verifier value is absent from
    // every field of the result (auth_url, message, instructions included).
    if (sentVerifier) {
      expect(blob).not.toContain(sentVerifier);
      // Belt-and-braces per field that a human or agent reads.
      expect(payload["auth_url"] as string).not.toContain(sentVerifier);
      expect(payload["message"] as string).not.toContain(sentVerifier);
      expect(String(payload["instructions"] ?? "")).not.toContain(sentVerifier);
    }
  });
});
