/**
 * UNIT — deriveAgentId() display-name → shopper-id derivation (tier: unit, pure,
 * in-memory, no I/O, no host).
 *
 * Card: derive-shopper-agentid-from-display-name. Onboarding used to make the user
 * invent TWO names for ONE shopper — a lower-kebab `agentId` AND a friendly display
 * `name`. This card deletes the id-authoring step: the user supplies ONE friendly
 * `name` and the bin derives `agentId = deriveAgentId(name)` invisibly. This is the
 * pure, total resolver the bin imports (like `resolveBindChannel` /
 * `src/lib/bind-channel.ts`), unit-tested here so its edge-dense derivation (empty /
 * `main` / unicode / hyphen-collapse) is pinned cheaply rather than only through the
 * slow spawn-the-bin integration tier.
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/derive-agent-id.ts` → `dist/lib/derive-agent-id.js`:
 *   deriveAgentId(name: string): string
 *     · lowercase → NFKD-normalize + strip combining marks (so `Café` keeps `cafe`,
 *       not `caf`) → replace each run of non-`[a-z0-9]` with a single `-` → trim
 *       edge hyphens;
 *     · a slug that comes out EMPTY (emoji/punctuation/hyphens/whitespace only) folds
 *       to the fallback constant `sil-shopper` — NEVER `""`;
 *     · a slug equal to the host-reserved `main` folds to `sil-shopper` — a shopper
 *       must never land on `main` (the host `/agent main` handle);
 *     · POSTCONDITION (total): the result ALWAYS matches `^[a-z0-9][a-z0-9-]*$`,
 *       never starts/ends with a hyphen, and is never `main`. No throw, ever.
 *     · DETERMINISTIC: the same `name` always derives the same id.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the implementation.
 */

import { describe, it, expect } from "vitest";

import { deriveAgentId } from "../../lib/derive-agent-id.js";

/** The path-segment shape a shopper id must satisfy — the lib's postcondition. */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
/** The empty/`main`-slug fallback constant. */
const FALLBACK = "sil-shopper";

describe("deriveAgentId — a friendly name derives a deterministic lower-kebab id", () => {
  it('a multi-word name lowercases and hyphenates each whitespace run ("My Shopper" → "my-shopper")', () => {
    expect(deriveAgentId("My Shopper")).toBe("my-shopper");
  });

  it("is deterministic — the same name always derives the same id", () => {
    expect(deriveAgentId("My Shopper")).toBe(deriveAgentId("My Shopper"));
    expect(deriveAgentId("Café Buyer")).toBe(deriveAgentId("Café Buyer"));
  });

  it("keeps digits and single-word names intact", () => {
    expect(deriveAgentId("shopper")).toBe("shopper");
    expect(deriveAgentId("Buyer 2000")).toBe("buyer-2000");
    expect(deriveAgentId("A")).toBe("a");
    expect(deriveAgentId("123")).toBe("123");
  });
});

describe("deriveAgentId — non-[a-z0-9] runs collapse to ONE hyphen; edge hyphens are trimmed", () => {
  it('interspersed punctuation/emoji collapse to a single hyphen ("My   Shopper!! 🛍️" → "my-shopper")', () => {
    expect(deriveAgentId("My   Shopper!! 🛍️")).toBe("my-shopper");
  });

  it("never emits a double hyphen or a leading/trailing hyphen", () => {
    expect(deriveAgentId("My  Shopper!")).toBe("my-shopper");
    expect(deriveAgentId("  --My Shopper--  ")).toBe("my-shopper");
    expect(deriveAgentId("!Shopper!")).toBe("shopper");
  });
});

describe("deriveAgentId — a slug equal to the reserved `main` folds to the fallback", () => {
  for (const name of ["main", "Main", "MAIN", "MAIN!", "  main  "]) {
    it(`"${name}" (slug === "main") → ${FALLBACK}, never "main"`, () => {
      const id = deriveAgentId(name);
      expect(id).toBe(FALLBACK);
      expect(id).not.toBe("main");
    });
  }
});

describe("deriveAgentId — an EMPTY slug folds to the fallback (never `\"\"`)", () => {
  for (const name of ["🛍️", "!!!", "---", "   ", "@#$%", "‑‑‑"]) {
    it(`"${name}" (slug empty) → ${FALLBACK}, never ""`, () => {
      const id = deriveAgentId(name);
      expect(id).toBe(FALLBACK);
      expect(id).not.toBe("");
    });
  }
});

describe("deriveAgentId — diacritics NFKD-normalize (combining marks stripped, letters kept)", () => {
  it('"Café Buyer" → "cafe-buyer" (the é keeps its base `e`, not dropped mid-word)', () => {
    // The architecture DECIDED NFKD + strip-combining-marks (Approach section) — a
    // plain ascii-strip that dropped the é to yield "caf-buyer" is data loss and is
    // NOT the production-grade bar this pins.
    expect(deriveAgentId("Café Buyer")).toBe("cafe-buyer");
  });

  it('"Zoë Picks" → "zoe-picks" (diaeresis stripped, base letter kept)', () => {
    expect(deriveAgentId("Zoë Picks")).toBe("zoe-picks");
  });
});

describe("deriveAgentId — POSTCONDITION: total, always AGENT_ID_RE, never `main`, never edge-hyphen", () => {
  const NAMES = [
    "My Shopper",
    "My   Shopper!! 🛍️",
    "🛍️",
    "!!!",
    "---",
    "   ",
    "main",
    "Main",
    "MAIN!",
    "Café Buyer",
    "  --x--  ",
    "A",
    "123",
    "Buyer 2000",
    "a".repeat(500),
    "日本語ショッパー",
    "shop💥💥keeper",
  ];

  for (const name of NAMES) {
    it(`"${name.length > 24 ? name.slice(0, 24) + "…" : name}" → a valid, non-empty, non-\`main\` id`, () => {
      const id = deriveAgentId(name);
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      expect(id).toMatch(AGENT_ID_RE);
      expect(id.startsWith("-")).toBe(false);
      expect(id.endsWith("-")).toBe(false);
      expect(id.includes("--")).toBe(false);
      expect(id).not.toBe("main");
    });
  }
});
