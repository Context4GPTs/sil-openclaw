/**
 * INTEGRATION — the retired-token sieve over the REAL `docs/**` tree.
 *
 * `docs/` is gitignored, so it exists only in the canonical checkout: these four
 * bars are the ones that cannot be fixtured, and they declare themselves
 * inapplicable rather than passing over an absent corpus (R1). The sieve's own
 * rules are proved by fixture in `lib/retired-tokens.test.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCS_EXEMPTIONS,
  docsRetiredTokenOffenders,
  inertExemptions,
} from "./helpers/retired-tokens.js";
import {
  DOCS_ROOT,
  docsEntries,
  docsFiles,
  docsEntryFloorOffenders,
  docsPresent,
} from "./helpers/docs-corpus.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS = docsPresent();

describe.skipIf(!DOCS)(`the real docs corpus (${DOCS_ROOT})`, () => {
  it("AC11 — no doc ASSERTS a retired token: every mention is buried, history-marked, or exempted by name", () => {
    // Offenders carry file → needle → line so a red is a fix list, not a verdict.
    expect(
      docsRetiredTokenOffenders(docsFiles(), DOCS_EXEMPTIONS).map(
        (o) => `${o.file}:${o.line} → ${o.needle} — ${o.text}`,
      ),
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
    expect(inertExemptions(docsFiles(), DOCS_EXEMPTIONS).map((e) => `${e.file} → ${e.needle}`)).toEqual(
      [],
    );
  });
});

describe("an absent docs corpus declares itself — it never scans empty and passes", () => {
  it("AC13 — reading an absent or empty docs tree THROWS rather than returning []", () => {
    // R1, the highest-probability vacuous green: `docs/` does not exist in a card
    // worktree, which is where every in-dev run happens. A reader that answers []
    // makes every bar above pass without reading a byte, and the only thing
    // standing between that and a green suite is remembering the `skipIf` at each
    // call site — the hand-maintained discipline this repo keeps recording as
    // "narrows silently to green". The throw makes a forgotten gate an ERROR.
    const missing = mkdtempSync(join(tmpdir(), "sil-docs-missing-"));
    expect(docsPresent(missing)).toBe(false);
    expect(() => docsFiles(missing)).toThrow(/docs/);
    expect(() => docsEntries(missing)).toThrow(/docs/);

    // A tree that EXISTS and holds no prose is the same vacuous read wearing a
    // present-looking gate, so the throw cannot be conditioned on `docsPresent`.
    const gutted = mkdtempSync(join(tmpdir(), "sil-docs-gutted-"));
    mkdirSync(join(gutted, "docs"));
    expect(docsPresent(gutted)).toBe(true);
    expect(() => docsFiles(gutted)).toThrow(/docs/);

    // …and the entry floor is not the same guarantee: a tree holding FILES but no
    // prose passes the entry read, so the prose reader is the only thing left that
    // can refuse. Without this the sieve scans zero docs and reports [].
    const noProse = mkdtempSync(join(tmpdir(), "sil-docs-no-prose-"));
    mkdirSync(join(noProse, "docs"));
    writeFileSync(join(noProse, "docs", "diagram.png"), "");
    expect(docsEntries(noProse)).toEqual(["diagram.png"]);
    expect(() => docsFiles(noProse)).toThrow(/docs/);
  });

  it("AC14 — no test file fails for that absence: every test touching `docs/` gates on docsPresent()", () => {
    // R2 — a red nobody can fix trains the board to ignore red, and this card's
    // signal is only legible against an otherwise clean worktree run. Derived from
    // the test tree, never a hand list, so a NEW docs-reading test is caught too.
    const sources = (readdirSync(TESTS_DIR, { recursive: true }) as string[])
      .filter((rel) => rel.endsWith(".test.ts"))
      .filter((rel) => statSync(join(TESTS_DIR, rel)).isFile())
      .map((rel) => ({ rel, body: readFileSync(join(TESTS_DIR, rel), "utf8") }));
    // A STRING-LITERAL `docs` path segment — `join(ROOT, "docs")`, `"docs/…"`.
    // Deliberately not backticks: markdown-quoted `docs/` is how every comment in
    // this repo names the folder, and matching those would red six files that
    // touch nothing.
    const touching = sources.filter((s) => /["']docs(\/|["'])/.test(s.body));
    expect(touching.length).toBeGreaterThan(0);
    expect(touching.filter((s) => !s.body.includes("docsPresent")).map((s) => s.rel)).toEqual([]);
  });
});
