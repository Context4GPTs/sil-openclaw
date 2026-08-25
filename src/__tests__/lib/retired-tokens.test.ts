/**
 * UNIT — the docs half of the retired-token guard, proved over FIXTURES.
 *
 * `docs/` is gitignored and does not exist in a card worktree, so a bar written
 * against the real corpus would pass vacuously wherever the work happens (R1/R7).
 * Every rule below is therefore driven through the sieve as `{path, body}` pairs,
 * which is the whole reason it is a pure function.
 *
 * Tier: unit — pure string logic over in-memory docs. The needle DERIVATION reads
 * `src/**` (tracked, always present) and is unit by the architect's tier ruling.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCS_EXCLUDED_NEEDLES,
  DOCS_EXEMPTIONS,
  RETIRED_TOKENS,
  docsNeedleExclusions,
  docsNeedles,
  docsRetiredTokenOffenders,
  inertExemptions,
  retiredTokenOffenders,
  type DocFile,
  type DocsExemption,
} from "../helpers/retired-tokens.js";
import {
  DOCS_NONPROSE_EXTENSIONS,
  docsEntryFloorOffenders,
} from "../helpers/docs-corpus.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A fixture doc built from LINES, so an expected line number is read off the
 * array rather than counted by hand. */
const docOf = (path: string, lines: string[]): DocFile => ({ path, body: lines.join("\n") });
const lineOf = (lines: string[], fragment: string): number =>
  lines.findIndex((l) => l.includes(fragment)) + 1;
/** Offenders as `file:line → needle` — the shape a red has to name (AC4). */
const named = (offenders: ReturnType<typeof docsRetiredTokenOffenders>): string[] =>
  offenders.map((o) => `${o.file}:${o.line} → ${o.needle}`);

/** Every tracked source file OUTSIDE `src/__tests__` — the derivation's own input,
 * walked independently here so a derivation that scans the wrong root is caught. */
function liveSourceFiles(): string[] {
  const src = join(REPO_ROOT, "src");
  return (readdirSync(src, { recursive: true }) as string[])
    .filter((rel) => !rel.startsWith("__tests__"))
    .map((rel) => join(src, rel))
    .filter((abs) => statSync(abs).isFile());
}

describe("docs needle DERIVATION — a needle that names live code is not a docs needle", () => {
  it("AC1 — every excluded needle is excluded BECAUSE it occurs in live source, and says where", () => {
    // Attribution is what separates a derivation from a hand list wearing its
    // clothes: each excluded needle must point at a real non-test source file
    // that really contains it.
    const exclusions = docsNeedleExclusions();
    const unattributable: string[] = [];
    for (const { needle, files } of exclusions) {
      if (files.length === 0) {
        unattributable.push(`${needle} → no attribution`);
        continue;
      }
      for (const rel of files) {
        const abs = join(REPO_ROOT, rel);
        if (rel.startsWith("src/__tests__") || !rel.startsWith("src/")) {
          unattributable.push(`${needle} → ${rel} is not live source`);
        } else if (!readFileSync(abs, "utf8").toLowerCase().includes(needle)) {
          unattributable.push(`${needle} → ${rel} does not contain it`);
        }
      }
    }
    expect(unattributable).toEqual([]);

    // …and the derivation is COMPLETE: walked independently, the needles that
    // occur in live source are exactly the excluded ones.
    const bodies = liveSourceFiles().map((abs) => readFileSync(abs, "utf8").toLowerCase());
    const occurring = RETIRED_TOKENS.filter((t) => bodies.some((b) => b.includes(t)));
    expect([...occurring].sort()).toEqual([...exclusions.map((e) => e.needle)].sort());
  });

  it("AC2 — the docs set only SUBTRACTS: the bundle keeps every needle and keeps its blanket forbid", () => {
    const needles = docsNeedles();
    expect(needles.filter((n) => !RETIRED_TOKENS.includes(n))).toEqual([]);
    expect(needles.length).toBeLessThan(RETIRED_TOKENS.length);

    // R5's cheapest wrong cure is deleting a needle from the shared list to clear
    // a docs RED. The four the docs side subtracts are the ones under that
    // pressure, so the shared list must still carry them.
    expect(RETIRED_TOKENS.filter((t) => !DOCS_EXCLUDED_NEEDLES.includes(t)).length).toBe(
      RETIRED_TOKENS.length - DOCS_EXCLUDED_NEEDLES.length,
    );

    // The bundle scan is a BLANKET forbid: a disavowal clears the docs side and
    // must not clear the bundle side. Every needle, including the subtracted four.
    const unguarded = RETIRED_TOKENS.filter(
      (t) => !retiredTokenOffenders(`\`${t}\` was deleted 2026-08-24 and is no longer used.`).includes(t),
    );
    expect(unguarded).toEqual([]);
  });

  it("AC3 — the derived docs needle set is non-empty (a rule that excludes everything guards nothing)", () => {
    expect(docsNeedles().length).toBeGreaterThan(0);
  });

  it("AC16 — the EXCLUDED set equals the recorded literal (a new live identifier cannot switch a needle off silently)", () => {
    // Pin 2. Layer 1 subtracts silently: without this literal, adding a live
    // identifier containing a needle disables it across all of `docs/` with no red.
    expect([...DOCS_EXCLUDED_NEEDLES].sort()).toEqual([
      "canonical",
      "domainslug",
      "method.md",
      "prd",
    ]);
    expect([...docsNeedleExclusions().map((e) => e.needle)].sort()).toEqual([
      ...DOCS_EXCLUDED_NEEDLES,
    ].sort());
  });

  it("AC17 — matchability by BITE: every derived needle is caught in an asserting sentence, every excluded one is not", () => {
    // A needle present-but-unmatchable (upper-cased, mistyped) sits in the list
    // looking protective. Drive each one through the real docs sieve instead.
    const caught = (written: string): boolean =>
      docsRetiredTokenOffenders(
        [docOf("knowledge/synthetic.md", [`Then call ${written} to record it.`])],
        [],
      ).length > 0;
    const derived = RETIRED_TOKENS.filter((t) => !DOCS_EXCLUDED_NEEDLES.includes(t));
    expect(derived.filter((t) => !caught(t))).toEqual([]);
    expect(RETIRED_TOKENS.filter((t) => DOCS_EXCLUDED_NEEDLES.includes(t) && caught(t))).toEqual([]);

    // …and the docs sieve lowers the BODY, exactly as the bundle scan does. A
    // terminology word is Title-cased mid-sentence all the time (`Rubric`,
    // `Playbook`), so a case-sensitive docs scan would let the two corpora diverge
    // on case with nothing red — the needles are guarded lower-case, not the prose.
    expect(derived.filter((t) => !caught(t.toUpperCase()))).toEqual([]);
  });
});

describe("the docs SIEVE — a retired token is DISAVOWED here, not expunged", () => {
  it("AC4 — prose that ASSERTS a derived needle offends, and the red names file → needle → line", () => {
    const lines = [
      "---",
      "id: how-the-shopper-records",
      "title: How the shopper records a finding",
      "tags: [gotcha]",
      "---",
      "",
      "Call `sil_learn` to record it.",
    ];
    const offenders = docsRetiredTokenOffenders([docOf("knowledge/how-the-shopper-records.md", lines)], []);
    expect(named(offenders)).toEqual([
      `knowledge/how-the-shopper-records.md:${lineOf(lines, "Call `sil_learn`")} → sil_learn`,
    ]);
    expect(offenders[0].text).toContain("Call `sil_learn` to record it.");
  });

  it("AC5 — the same needle BURIED in a disavowal passes (docs must keep the record of what changed)", () => {
    const lines = [
      "---",
      "id: how-the-shopper-records",
      "title: How the shopper records a finding",
      "tags: [gotcha]",
      "---",
      "",
      "`sil_learn` was deleted 2026-08-24 — use `sil_doc_write`.",
    ];
    expect(docsRetiredTokenOffenders([docOf("knowledge/how-the-shopper-records.md", lines)], [])).toEqual([]);
  });

  it("AC8 — a partially-reversed doc still offends BELOW its banner (the banner is not a file-wide pass)", () => {
    // The `sds-specs-vocabulary-is-bottom-up.md` shape, where the only true
    // positives live. The banner carries two disavowal words; a file-scoped or
    // paragraph-scoped allowance would false-GREEN the assertion three lines down.
    // `reversed` in `tags:` must NOT exempt — only `history-only` does.
    const lines = [
      "---",
      "id: sds-specs-vocabulary",
      "title: Spec matching is a vocabulary problem",
      "tags: [architecture, reversed, partly-reversed]",
      "---",
      "",
      "> **REVERSED in part, 2026-08-24** — the bottom-up half is deleted, superseded by the registry.",
      "",
      "Keys are coined by `sil_learn` from the domain research, and every method reuses that spelling.",
    ];
    expect(named(docsRetiredTokenOffenders([docOf("knowledge/sds-specs-vocabulary.md", lines)], []))).toEqual([
      `knowledge/sds-specs-vocabulary.md:${lineOf(lines, "Keys are coined")} → sil_learn`,
    ]);
  });

  it("AC9 — a fence QUOTES an artefact and passes; the same needle inline in live prose offends", () => {
    // In `docs/` a fenced block quotes what a guard or a store looked like; in the
    // bundle a fence is what the agent copies. Inline backticks are how nearly
    // every real assertion is written, so they must stay in scope.
    const lines = [
      "---",
      "id: guard-doc",
      "title: The needle block",
      "tags: [testing]",
      "---",
      "",
      "The list it scans is quoted verbatim below.",
      "",
      "```",
      "profile.json  domain_spec  sil_learn",
      "```",
      "",
      "The shopper calls `sil_learn` after every search.",
    ];
    expect(named(docsRetiredTokenOffenders([docOf("knowledge/guard-doc.md", lines)], []))).toEqual([
      `knowledge/guard-doc.md:${lineOf(lines, "The shopper calls")} → sil_learn`,
    ]);
  });

  it("AC10 — a non-`.md` docs file forces a decision at the FLOOR instead of being silently skipped", () => {
    // The `.mdx` escape this repo has already measured on the bundle: the sieve
    // reads `.md`, so a renamed file leaves the corpus with nothing red. The floor
    // is what catches it — proved by showing the sieve alone does not.
    const entries = ["README.md", "knowledge/a-doc.md", "knowledge/new-notes.mdx", "decisions/INDEX.md"];
    expect(docsEntryFloorOffenders(entries)).toEqual(["knowledge/new-notes.mdx"]);
    // Empty today (37/37 are `.md`). `docs/design/` may earn an entry here — that
    // is the deliberate decision the floor exists to force, and it costs a diff line.
    expect([...DOCS_NONPROSE_EXTENSIONS]).toEqual([]);
    const escaped: DocFile = {
      path: "knowledge/new-notes.mdx",
      body: "The shopper calls `sil_learn` after every search.",
    };
    expect(docsRetiredTokenOffenders([escaped], [])).toEqual([]);
  });
});

describe("the WHOLESALE exemption — history in its entirety, announced where the next agent decides", () => {
  const HISTORY_DOC = [
    "---",
    "id: sds-old-model",
    "title: The old artefact model",
    "tags: [architecture, superseded, history-only]",
    "---",
    "",
    "The shopper calls `sil_learn` with a `target` and a `change`.",
    "",
    "`profile.json` is the store of record, and `sil_profile_materialize` writes the five artefacts.",
  ];
  const indexRowTagged = (tags: string): DocFile => ({
    path: "decisions/INDEX.md",
    body: [
      "---",
      "id: decisions-index",
      "title: Decisions index",
      "tags: [meta]",
      "---",
      "",
      "| ID | Title | Tags | Updated |",
      "|---|---|---|---|",
      `| [[sds-old-model]] | The old artefact model | ${tags} | 2026-08-24 |`,
    ].join("\n"),
  });

  it("AC6 — `history-only` in frontmatter AND in its INDEX row exempts the whole doc", () => {
    const corpus = [
      docOf("decisions/sds-old-model.md", HISTORY_DOC),
      indexRowTagged("architecture, superseded, history-only"),
    ];
    expect(docsRetiredTokenOffenders(corpus, [])).toEqual([]);
  });

  it("AC7 — the same doc offends when its INDEX row does not carry the marker (one frontmatter line does not buy it)", () => {
    // The only delta from AC6 is the tags CELL of the INDEX row. The exemption is
    // earned by being announced where the next agent decides whether to open the
    // doc — a marker buried in frontmatter reaches nobody who did not already open it.
    const corpus = [
      docOf("decisions/sds-old-model.md", HISTORY_DOC),
      indexRowTagged("architecture, superseded"),
    ];
    expect(named(docsRetiredTokenOffenders(corpus, []))).toEqual([
      `decisions/sds-old-model.md:${lineOf(HISTORY_DOC, "The shopper calls")} → sil_learn`,
      `decisions/sds-old-model.md:${lineOf(HISTORY_DOC, "is the store of record")} → profile.json`,
      `decisions/sds-old-model.md:${lineOf(HISTORY_DOC, "is the store of record")} → sil_profile`,
    ]);
  });
});

describe("the NAMED exemption — pinned per (file, needle), and it must still bite", () => {
  const GUARD_LINES = [
    "---",
    "id: guard-doc",
    "title: The retired-token guard",
    "tags: [testing]",
    "---",
    "",
    "The shopper calls `sil_learn` after every search.",
    "",
    "`sil_ping` is still wired into the router.",
  ];
  const GUARD_DOC = docOf("knowledge/guard-doc.md", GUARD_LINES);
  const CORRECTED = docOf("knowledge/corrected.md", [
    "---",
    "id: corrected",
    "title: The corrected doc",
    "tags: [gotcha]",
    "---",
    "",
    "`sil_learn` was deleted 2026-08-24.",
  ]);
  const TABLE: DocsExemption[] = [
    { file: "knowledge/guard-doc.md", needle: "sil_learn", reason: "quotes its own needle list" },
    { file: "knowledge/guard-doc.md", needle: "sil_ping", reason: "quotes the removed example tool" },
    { file: "knowledge/corrected.md", needle: "sil_learn", reason: "rotted — the prose was corrected" },
  ];

  it("AC15 — an exemption is keyed per (file, needle) and is REPORTED once it stops being load-bearing", () => {
    // Pin 1. A per-(file, needle) table is the vacuity class this repo already
    // recorded — it narrows silently to green. Two things stop it: withdrawing
    // each pair and re-scanning (the list self-cleans), and keying on the NEEDLE
    // as well as the file. Keyed per FILE, a doc exempted for one retirement goes
    // blind to the NEXT one — this card's own defect, one level down.
    expect(docsRetiredTokenOffenders([GUARD_DOC, CORRECTED], TABLE)).toEqual([]);
    expect(inertExemptions([GUARD_DOC, CORRECTED], TABLE)).toEqual([TABLE[2]]);
    expect(named(docsRetiredTokenOffenders([GUARD_DOC, CORRECTED], [TABLE[1], TABLE[2]]))).toEqual([
      `knowledge/guard-doc.md:${lineOf(GUARD_LINES, "The shopper calls")} → sil_learn`,
    ]);
  });

  it("every recorded exemption names a REASON and a derived needle (an unexplained pair is an off switch)", () => {
    // Failure mode no other test catches: a pair added with an empty reason, or
    // keyed on a needle the docs side never scans, silences prose while looking
    // deliberate. Neither shows up as a red anywhere else.
    const needles = docsNeedles();
    expect(
      DOCS_EXEMPTIONS.filter((e) => e.reason.trim().length < 20 || !needles.includes(e.needle)).map(
        (e) => `${e.file} → ${e.needle}`,
      ),
    ).toEqual([]);
  });
});
