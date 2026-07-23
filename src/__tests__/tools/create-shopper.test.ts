/**
 * UNIT — the recovery hint is what makes B3's omission free.
 *
 * B3's contract is that a failure line carries NO byte of a third-party or host
 * error stream. That is only acceptable because diagnosability is preserved a
 * different way: the hint names the command the USER can re-run themselves to
 * see the host's own message. A hint that says "try again" pays the leak's price
 * and buys nothing.
 *
 * The command must be one the host always has — `openclaw …`. It may NOT be a
 * sil bin: `openclaw plugins install` (the ClawHub channel) links no bins, and
 * naming one is the exact failure `0.3.8` shipped
 * (`[[plugin-skill-prose-cannot-reach-its-own-tree]]`, `create-shopper-bin.md`).
 *
 * API per the dev's published in-dev contract:
 *   export function buildRecoveryHint(step: "config" | "workspace"): string;
 *
 * Card: clear-the-clawhub-suspicious-flag-review-findings (slice M, B3 [unit]).
 */

import { describe, it, expect } from "vitest";

import { buildRecoveryHint } from "../../tools/create-shopper.js";

const STEPS = ["config", "workspace"] as const;

describe("buildRecoveryHint — names a command the user can actually run", () => {
  for (const step of STEPS) {
    describe(`step: ${step}`, () => {
      const hint = (): string => buildRecoveryHint(step);

      it("returns non-empty, bounded prose", () => {
        const h = hint();
        expect(typeof h).toBe("string");
        expect(h.trim().length, "the hint is empty").toBeGreaterThan(20);
        expect(h.length, "the hint is a paragraph, not a hint").toBeLessThanOrEqual(300);
      });

      it("names an `openclaw <subcommand>` the host always has on PATH", () => {
        expect(hint(), "the hint names no openclaw command").toMatch(/\bopenclaw\s+[a-z][a-z-]*/);
      });

      it("names NO sil bin — those are unlinked on the ClawHub channel", () => {
        const h = hint();
        expect(h).not.toMatch(/sil-openclaw-(create-shopper|allowlist)/);
        expect(h).not.toMatch(/\bnode\s+["']?\/|\.mjs\b/);
      });

      it("is addressed to the person, not to the agent's next tool call", () => {
        // The card's own risk: "the suggestion must read as 'ask the user to
        // run', so an agent does not adopt it as its own next step."
        expect(hint()).toMatch(/\byou\b|\byour\b|\brun\b/i);
      });

      it("carries no host error text and no unfilled placeholder", () => {
        const h = hint();
        expect(h).not.toMatch(/undefined|null|\[object Object\]|\{\{|<[A-Z_]+>/);
      });
    });
  }

  it("the two steps produce DIFFERENT hints — a generic one diagnoses nothing", () => {
    const hints = STEPS.map((s) => buildRecoveryHint(s));
    expect(new Set(hints).size, `hints collapsed: ${JSON.stringify(hints)}`).toBe(STEPS.length);
  });

  it("is pure — the same step yields the same hint, and it touches nothing", () => {
    for (const step of STEPS) {
      expect(buildRecoveryHint(step)).toBe(buildRecoveryHint(step));
    }
  });
});
