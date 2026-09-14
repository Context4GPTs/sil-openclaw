/**
 * UNIT — how `sil_register` PRESENTS the link (mock api, temp data dir, fetch
 * stubbed so the armed background poll never reaches the network).
 *
 * A human reads `message` through a chat renderer that auto-links. The link
 * therefore sits on its OWN line, angle-bracket wrapped, so the target the
 * renderer produces is `open` byte-for-byte and nothing around it is folded in —
 * and the browser steer sits on the line ABOVE, never on the link's line.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

/** Steers TO the buyer's own default/system browser, naming a concrete one. */
const POSITIVE_STEER_RE = /\b(default|system)\b[\s\S]{0,40}\bbrowser\b/i;
/** … and AWAY from the in-app/built-in/embedded webview that blocks the cookie. */
const NEGATIVE_SURFACE_RE = /\b(in-?app|built-?in|embedded|webview|this app)\b/i;

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
 * A greedy chat auto-linker, modelling the class of renderer the presentation is
 * written for: an angle-bracket-delimited `<URL>` is ONE target bounded by the
 * bracket, while a bare URL runs to the next whitespace and swallows whatever
 * punctuation or prose is glued to it. Returns the targets it would produce.
 */
function greedyAutoLink(text: string): string[] {
  const targets: string[] = [];
  const bracketed = /<(https?:\/\/[^>\s]+)>/g;
  const spans: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = bracketed.exec(text)) !== null) {
    targets.push(m[1]!);
    spans.push([m.index, m.index + m[0].length]);
  }
  // Blank the bracketed spans so their URL is not re-matched as a bare one.
  let bare = text;
  for (const [start, end] of spans) {
    bare = bare.slice(0, start) + " ".repeat(end - start) + bare.slice(end);
  }
  const bareUrl = /https?:\/\/\S+/g;
  while ((m = bareUrl.exec(bare)) !== null) targets.push(m[0]);
  return targets;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-register-link-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
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

describe("sil_register — the presented link is one atomic target", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    api = createMockPluginApi();
    registerIdentityTools(api);
  });

  async function freshRegister(): Promise<Record<string, unknown>> {
    return payloadOf(await getTool(api, TOOL).execute("c1", {}));
  }

  it("the link line is exactly `<open>`, with the browser steer on the line above it", async () => {
    const payload = await freshRegister();
    const open = payload["open"] as string;
    const lines = (payload["message"] as string).split("\n");

    const linkLine = lines.findIndex((l) => l.includes(open));
    expect(linkLine).toBeGreaterThanOrEqual(0);
    expect(lines[linkLine]!.trim()).toBe(`<${open}>`);

    // The steer reads first, on its own earlier line — never folded onto the link.
    const steerLine = lines.findIndex((l) => NEGATIVE_SURFACE_RE.test(l));
    expect(steerLine).toBeGreaterThanOrEqual(0);
    expect(steerLine).toBeLessThan(linkLine);
    expect(lines[steerLine]!).toMatch(POSITIVE_STEER_RE);
  });

  it("a greedy auto-linker captures the whole link and nothing else", async () => {
    const payload = await freshRegister();
    const open = payload["open"] as string;

    expect(greedyAutoLink(payload["message"] as string)).toEqual([open]);

    // Guard-of-the-guard: the same linker over a BARE, prose-adjacent link does
    // NOT produce the URL — so the assertion above is the bracket doing work.
    expect(greedyAutoLink(`Open this link: ${open}, then sign in.`)).not.toEqual([
      open,
    ]);
  });

  it("`instructions` carries the same steer, so an agent relaying it cannot drop the half that matters", async () => {
    const instructions = (await freshRegister())["instructions"] as string;
    expect(instructions).toMatch(POSITIVE_STEER_RE);
    expect(instructions).toMatch(NEGATIVE_SURFACE_RE);
  });
});
