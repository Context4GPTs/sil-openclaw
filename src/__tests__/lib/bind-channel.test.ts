/**
 * UNIT — resolveBindChannel() channel-resolution precedence (tier: unit, pure,
 * in-memory, no I/O, no host).
 *
 * Card: bind-the-new-shopper-to-the-current-channel. The create bin has no session
 * context (a plugin tool receives only `(callId, params)`, and the bin is a spawned
 * subprocess), so the "current channel" arrives out-of-band from TWO sources:
 *   1. an explicit `spec.channel` field (the operator/skill override + test seam)
 *   2. the host's `OPENCLAW_MCP_MESSAGE_CHANNEL` env (the live-turn auto-detect)
 * This single-sources the branchy precedence into one pure, typed function so the
 * fail-open trigger is pinned exactly and cheaply, in a lib the bin imports (like
 * `profile-store` / `openclaw-allowlist`).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/bind-channel.ts` → `dist/lib/bind-channel.js`:
 *   resolveBindChannel({ specChannel?, envChannel? }): string | null
 *     · returns the FIRST non-blank of (specChannel, envChannel) — spec wins;
 *     · a blank/whitespace-only value counts as ABSENT (falls through);
 *     · both blank/absent ⇒ null (the fail-open "undetermined channel" trigger);
 *     · the returned value is TRIMMED — it flows straight into an `openclaw agents
 *       bind --bind <channel>` CLI arg, so no stray whitespace may ride along;
 *     · a non-string value (untrusted parsed JSON) counts as absent, never throws.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the implementation.
 */

import { describe, it, expect } from "vitest";

import { resolveBindChannel } from "../../lib/bind-channel.js";

describe("resolveBindChannel — precedence: spec.channel > OPENCLAW_MCP_MESSAGE_CHANNEL > null", () => {
  it("spec channel WINS over the env channel when both are present", () => {
    expect(resolveBindChannel({ specChannel: "telegram", envChannel: "whatsapp" })).toBe("telegram");
  });

  it("uses the env channel when spec is absent (undefined)", () => {
    expect(resolveBindChannel({ envChannel: "telegram" })).toBe("telegram");
    expect(resolveBindChannel({ specChannel: undefined, envChannel: "telegram" })).toBe("telegram");
  });

  it("uses the spec channel when the env is absent (undefined)", () => {
    expect(resolveBindChannel({ specChannel: "telegram" })).toBe("telegram");
    expect(resolveBindChannel({ specChannel: "telegram", envChannel: undefined })).toBe("telegram");
  });
});

describe("resolveBindChannel — blank/whitespace counts as ABSENT (fall through)", () => {
  it("a blank spec falls through to the env channel", () => {
    expect(resolveBindChannel({ specChannel: "   ", envChannel: "telegram" })).toBe("telegram");
    expect(resolveBindChannel({ specChannel: "\t\n ", envChannel: "telegram" })).toBe("telegram");
  });

  it("a blank env is ignored when the spec is present", () => {
    expect(resolveBindChannel({ specChannel: "telegram", envChannel: "   " })).toBe("telegram");
  });
});

describe("resolveBindChannel — the fail-open trigger: both blank/absent ⇒ null", () => {
  it("both absent (empty input, or explicit undefined) ⇒ null", () => {
    expect(resolveBindChannel({})).toBeNull();
    expect(resolveBindChannel({ specChannel: undefined, envChannel: undefined })).toBeNull();
  });

  it("both blank/whitespace ⇒ null", () => {
    expect(resolveBindChannel({ specChannel: "   ", envChannel: "\t \n" })).toBeNull();
  });

  it("empty strings on both sides ⇒ null (an empty string is blank)", () => {
    expect(resolveBindChannel({ specChannel: "", envChannel: "" })).toBeNull();
  });
});

describe("resolveBindChannel — the resolved value is CLI-arg clean (trimmed)", () => {
  it("trims surrounding whitespace off the resolved spec channel", () => {
    expect(resolveBindChannel({ specChannel: "  telegram  " })).toBe("telegram");
  });

  it("trims surrounding whitespace off the resolved env channel", () => {
    expect(resolveBindChannel({ envChannel: " slack\n" })).toBe("slack");
  });
});

describe("resolveBindChannel — untrusted JSON input never throws (non-string ⇒ absent)", () => {
  it("a non-string spec channel is treated as absent, falling back to the env", () => {
    // spec.channel arrives from JSON.parse (unknown) — a number/object/null must
    // never crash the resolver, and must not be bound as a channel.
    expect(
      resolveBindChannel({ specChannel: 123 as unknown as string, envChannel: "telegram" }),
    ).toBe("telegram");
    expect(
      resolveBindChannel({ specChannel: null as unknown as string, envChannel: "telegram" }),
    ).toBe("telegram");
    expect(
      resolveBindChannel({ specChannel: {} as unknown as string, envChannel: "telegram" }),
    ).toBe("telegram");
  });

  it("a non-string on BOTH sides ⇒ null (fail-open), never a thrown error", () => {
    expect(
      resolveBindChannel({
        specChannel: 1 as unknown as string,
        envChannel: [] as unknown as string,
      }),
    ).toBeNull();
  });
});
