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

describe("sil_register — system-browser steer (bounce-webview-auth-links-to-the-system-browser)", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    api = createMockPluginApi();
    registerIdentityTools(api);
  });

  // ── Resilient steer matchers ───────────────────────────────────────────────
  // The CONTRACT is "both halves present, case-insensitive" — the steer names a
  // concrete default/system browser to use AND warns away from an app's
  // built-in/in-app/embedded webview. Wording is the expert-developer's call
  // within product-owner's intent ("default browser (Safari/Chrome), not this
  // app's built-in browser"; neutral setup-step tone). These matchers pin the
  // semantic content WITHOUT brittle exact-string equality, so any faithful
  // phrasing reaches GREEN. They DELIBERATELY do not anchor on the precise term
  // "system browser" (the open question flags plain "default browser" as the
  // likely clearer phrasing) — either reads as the positive half.

  /** Positive half: steers TO the user's own default/system browser, naming a
   * concrete one (Safari / Chrome) so a non-technical user knows the action. */
  const POSITIVE_STEER_RE = /\b(default|system)\b[\s\S]{0,40}\bbrowser\b/i;
  /** Concrete browser named so the action is unmissable for a non-technical user. */
  const NAMED_BROWSER_RE = /\b(safari|chrome)\b/i;
  /** Negative half: steers AWAY from an in-app / built-in / embedded webview —
   * the cookie-blocking surface. Matches "built-in browser", "in-app browser",
   * "embedded webview", "this app's browser", etc. The "not" + the surface noun
   * are the two load-bearing tokens. */
  const NEGATIVE_NOT_RE = /\bnot\b/i;
  const NEGATIVE_SURFACE_RE = /\b(in-?app|built-?in|embedded|webview|this app)\b/i;

  it("message carries the system-browser steer — positive (default/system browser, named) AND negative (NOT the in-app/built-in browser) halves", async () => {
    // RED today: the current message is the generic "Open this URL in a browser
    // to register:" — it has NO default/system-browser steer and NO "not the
    // in-app browser" warning, so a user reading inside a chat client's webview
    // taps the link right there and dead-ends on Auth0's blocked cookie. The fix
    // adds an unmissable steer to the human-facing copy.
    const payload = await freshRegister(api);
    const message = payload["message"];
    expect(typeof message).toBe("string");
    const msg = message as string;

    // Positive half — steer TO the default/system browser, named concretely.
    expect(msg).toMatch(POSITIVE_STEER_RE);
    expect(msg).toMatch(NAMED_BROWSER_RE);

    // Negative half — steer AWAY from the in-app/built-in/embedded webview.
    expect(msg).toMatch(NEGATIVE_NOT_RE);
    expect(msg).toMatch(NEGATIVE_SURFACE_RE);

    // It must NOT remain the bare pre-card generic-browser copy. (A faithful fix
    // may keep the verb "browser" elsewhere, but it can no longer say ONLY
    // "Open this URL in a browser" with nothing steering the choice.)
    expect(msg).not.toBe(`Open this URL in a browser to register:\n<${payload["auth_url"]}>`);
  });

  it("instructions carries the matching steer so the agent relays 'open in the default browser, not the in-app browser'", async () => {
    // RED today: the current instructions are bare "Share the auth URL with the
    // user. The plugin is polling…" — an agent paraphrasing that to the human
    // re-introduces the generic "a browser" gap. The agent-facing copy must
    // carry the same steer as `message` so the two cannot diverge (criterion 2).
    const payload = await freshRegister(api);
    const instructions = payload["instructions"];
    expect(typeof instructions).toBe("string");
    const ins = instructions as string;

    // Positive half — the agent is primed to relay "default/system browser".
    expect(ins).toMatch(POSITIVE_STEER_RE);
    // Negative half — and to relay "not the in-app/built-in/embedded browser".
    expect(ins).toMatch(NEGATIVE_NOT_RE);
    expect(ins).toMatch(NEGATIVE_SURFACE_RE);

    // It must NOT remain the exact pre-card instructions (which carry no steer).
    expect(ins).not.toBe(
      "Share the auth URL with the user. The plugin is polling in the"
      + " background — once the user finishes signing in, call sil_register"
      + " again to confirm (it will report already_registered).",
    );
  });

  it("the steer is a separate lead line BEFORE the link line — it is NOT folded onto the atomic `<authUrl>` line (no #24 regression)", async () => {
    // Regression guard for criterion 5 / the #24 atomic-link contract, expressed
    // against the NEW copy: adding the steer must not glue prose onto the link's
    // own line. The line carrying the URL must STILL be exactly `<authUrl>` and
    // nothing else, and the steer text must live on a DIFFERENT (earlier) line.
    // This stays GREEN against any faithful implementation (steer as a lead line
    // before `\n<url>`); it goes RED only if the dev folds the steer onto the
    // link line — the precise greedy-auto-linker truncation #24 fixed.
    const payload = await freshRegister(api);
    const msg = payload["message"] as string;
    const authUrl = payload["auth_url"] as string;
    const lines = msg.split("\n");

    // The link sits alone on its own line, exactly `<authUrl>`.
    const linkLineIdx = lines.findIndex((l) => l.trim().includes(authUrl));
    expect(linkLineIdx).toBeGreaterThanOrEqual(0);
    expect(lines[linkLineIdx]!.trim()).toBe(`<${authUrl}>`);

    // The steer (the negative-surface token) appears on a DIFFERENT line, BEFORE
    // the link line — never on the link line itself. (A non-technical reader sees
    // the steer first, then the bare atomic link.)
    const steerLineIdx = lines.findIndex((l) => NEGATIVE_SURFACE_RE.test(l));
    expect(steerLineIdx).toBeGreaterThanOrEqual(0);
    expect(steerLineIdx).toBeLessThan(linkLineIdx);
    // The link line carries none of the steer prose.
    expect(NEGATIVE_SURFACE_RE.test(lines[linkLineIdx]!)).toBe(false);
    expect(POSITIVE_STEER_RE.test(lines[linkLineIdx]!)).toBe(false);
  });

  it("the new steer copy survives the greedy auto-linker with code_challenge intact (the #24 truncation defense holds with the steer added)", async () => {
    // Belt-and-braces over A-3: with the steer prose now present in `message`,
    // run the WHOLE message through the greedy auto-linker and assert the
    // bracketed URL is still captured WHOLE (code_challenge included). If a future
    // implementer folds the steer onto the link line, the bracket span breaks and
    // this goes RED alongside the line-placement guard above. GREEN today only
    // because A-2/A-3 hold; it must stay GREEN after the steer lands.
    const payload = await freshRegister(api);
    const message = payload["message"] as string;
    const authUrl = payload["auth_url"] as string;
    const expectedChallenge = new URL(authUrl).searchParams.get("code_challenge")!;

    const targets = greedyAutoLink(message);
    expect(targets.length).toBeGreaterThan(0);
    const carriesChallenge = targets.filter((t) =>
      t.includes(`code_challenge=${expectedChallenge}`),
    );
    expect(carriesChallenge.length).toBeGreaterThan(0);

    // auth_url itself is untouched by the steer — byte-for-byte the unwrapped,
    // un-re-encoded canonical URL (the #24 invariant; A-1 owns the full assertion,
    // this is the steer-context regression guard).
    expect(authUrl.startsWith("<")).toBe(false);
    expect(authUrl).not.toContain("<");
    expect(authUrl).not.toContain("&amp;");
    expect(authUrl).not.toContain("%26");
    expect(authUrl).toContain(`&code_challenge=${expectedChallenge}`);
  });

  it("the steer ships UNCONDITIONALLY — no host signal gates it (always-instruct verdict)", async () => {
    // Criterion 6 / the always-instruct verdict: the mock api exposes no
    // client/UA/surface signal (the real host surface has none either —
    // openclaw.d.ts:23-44), and `sil_register` takes NO params. So there is
    // nothing to gate on; calling execute() with the empty params it declares
    // must ALWAYS produce the steer. We assert it across two independent fresh
    // calls (distinct sessions) to pin "unconditional", not "happened once".
    const a = await freshRegister(api);
    const b = payloadOf(await getTool(api, TOOL).execute("c2", {}));

    for (const p of [a, b]) {
      const m = p["message"] as string;
      const i = p["instructions"] as string;
      expect(m).toMatch(POSITIVE_STEER_RE);
      expect(m).toMatch(NEGATIVE_SURFACE_RE);
      expect(i).toMatch(POSITIVE_STEER_RE);
      expect(i).toMatch(NEGATIVE_SURFACE_RE);
    }
    // Two distinct registration attempts (different sessions) — the steer is not
    // a one-shot, it is emitted on every awaiting_browser return.
    expect(a["session_id"]).not.toBe(b["session_id"]);
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
