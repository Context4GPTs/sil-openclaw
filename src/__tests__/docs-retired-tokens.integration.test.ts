/**
 * INTEGRATION — the retired-token sieve over the REAL `docs/**`: the bars that
 * cannot be fixtured. `docs/` is gitignored, so absence is normal and must
 * declare itself rather than pass (R1); the rules are fixtured in `lib/`.
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

// AC13's visibility half. A skipped bar tells an operator NOTHING: the entire
// output of a docs-absent `vitest run` is `Tests N passed | M skipped`, which
// reads identically whether the sweep was inapplicable or DELETED. This bar
// always runs, and it declares the state where the gate is actually read.
it(
  DOCS
    ? `AC13 — the real docs corpus IS present at ${DOCS_ROOT}; the sweep below scanned it`
    : `AC13 — the real docs corpus is ABSENT at ${DOCS_ROOT}; the sweep below is inapplicable, and nothing passed over it`,
  () => {
    if (DOCS) {
      expect(docsFiles().length).toBeGreaterThan(0);
      return;
    }
    // The default reporter prints no passing test's NAME and swallows `console.*`
    // outright — measured. A raw write is the only channel that reaches `pnpm
    // test`, so the declaration is unmissable rather than merely recorded.
    process.stderr.write(
      `INAPPLICABLE — no docs corpus at ${DOCS_ROOT}: the docs retired-token sweep did not run. ` +
        `(\`docs/\` is gitignored; seed this worktree or run in the canonical checkout.)\n`,
    );
    // …and the declaration is bound to reality: an absent corpus must be
    // UNREADABLE, not merely unscanned, or the bars above could have passed.
    expect(() => docsFiles()).toThrow(/docs/);
  },
);

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

    // …and no doc holds an ODD number of fences: `maskFences` blanks a lone fence
    // to EOF, so one unterminated fence silently drops the rest of a file out of
    // the sieve — after the raw-length floor above has already passed it.
    expect(
      files.filter((f) => (f.body.match(/```/g) ?? []).length % 2 === 1).map((f) => f.path),
    ).toEqual([]);
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
    // R1's vacuous green: `docs/` is absent in every card worktree, so a reader
    // that answers [] makes every bar above pass without reading a byte — with
    // only a remembered `skipIf` per call site in the way, the hand-maintained
    // discipline this repo keeps recording as "narrows silently to green". The
    // throw makes a forgotten gate an ERROR instead.
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
    // The CALL, not the identifier: `import { docsPresent }` alone satisfied the
    // bare name while gating nothing.
    expect(touching.filter((s) => !s.body.includes("docsPresent(")).map((s) => s.rel)).toEqual([]);
  });
});
