/**
 * INTEGRATION — the retired-token sieve over the REAL `docs/**` tree.
 *
 * `docs/` is gitignored, so it exists only in the canonical checkout: these four
 * bars are the ones that cannot be fixtured, and they declare themselves
 * inapplicable rather than passing over an absent corpus (R1). The sieve's own
 * rules are proved by fixture in `lib/retired-tokens.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { docsRetiredTokenOffenders, inertExemptions } from "./helpers/retired-tokens.js";
import {
  DOCS_ROOT,
  docsEntries,
  docsEntryFloorOffenders,
  docsFiles,
  docsPresent,
} from "./helpers/docs-corpus.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS = docsPresent();

describe.skipIf(!DOCS)(`the real docs corpus (${DOCS_ROOT})`, () => {
  it("AC11 — no doc ASSERTS a retired token: every mention is buried, history-marked, or exempted by name", () => {
    // Offenders carry file → needle → line so a red is a fix list, not a verdict.
    expect(
      docsRetiredTokenOffenders(docsFiles()).map((o) => `${o.file}:${o.line} → ${o.needle} — ${o.text}`),
    ).toEqual([]);
  });

  it("AC12 — the corpus actually read is non-trivial, and every file in it is scanned", () => {
    // Every scan above returns [] over a gutted or half-read tree. Both halves of
    // the floor: enough was read, and nothing on disk escaped the `.md` filter.
    const files = docsFiles();
    expect(files.length).toBeGreaterThanOrEqual(25);
    expect(files.reduce((n, f) => n + f.body.length, 0)).toBeGreaterThan(150_000);
    expect(docsEntryFloorOffenders(docsEntries())).toEqual([]);
  });

  it("Pin 1 on the real table — no recorded exemption has stopped biting", () => {
    // Distinct from the fixture bite proof: that one shows the mechanism works,
    // this one shows TODAY's table is still load-bearing. A pair whose doc was
    // since corrected would otherwise sit there blind to the next retirement —
    // this card's own defect, one level down.
    expect(inertExemptions(docsFiles()).map((e) => `${e.file} → ${e.needle}`)).toEqual([]);
  });
});

describe("an absent docs corpus declares itself — it never scans empty and passes", () => {
  it("AC13 — `docsFiles()` THROWS on a missing or empty docs tree rather than returning []", () => {
    // R1, the highest-probability vacuous green: `docs/` does not exist in a card
    // worktree, which is where every in-dev run happens. A helper that returned []
    // would make each bar above pass without reading a byte. The throw is what
    // makes a forgotten `skipIf` an error instead of a green.
    const missing = mkdtempSync(join(tmpdir(), "sil-docs-missing-"));
    expect(docsPresent(missing)).toBe(false);
    expect(() => docsFiles(missing)).toThrow(/docs/);
    expect(() => docsEntries(missing)).toThrow(/docs/);

    const empty = mkdtempSync(join(tmpdir(), "sil-docs-empty-"));
    mkdirSync(join(empty, "docs"));
    expect(() => docsFiles(empty)).toThrow(/docs/);
  });

  it("AC14 — no test file fails for that absence: every test touching `docs/` gates on docsPresent()", () => {
    // R2 — a red nobody can fix trains the board to ignore red, and this card's
    // signal is only legible against an otherwise clean worktree run. Derived from
    // the test tree, never a hand list, so a NEW docs-reading test is caught too.
    const sources = (readdirSync(TESTS_DIR, { recursive: true }) as string[])
      .filter((rel) => rel.endsWith(".test.ts"))
      .filter((rel) => statSync(join(TESTS_DIR, rel)).isFile())
      .map((rel) => ({ rel, body: readFileSync(join(TESTS_DIR, rel), "utf8") }));
    const touching = sources.filter((s) => /["']docs["']/.test(s.body));
    expect(touching.length).toBeGreaterThan(0);
    expect(touching.filter((s) => !s.body.includes("docsPresent")).map((s) => s.rel)).toEqual([]);
  });
});
