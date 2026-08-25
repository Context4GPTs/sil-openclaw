/**
 * The retired-vocabulary needle list and its TWO corpus rules, in one module so
 * the bundle scan and the docs scan can never become two different lists.
 *
 * The bundle is prose the agent ACTS on: a retired token there is EXPUNGED
 * (blanket forbid). `docs/` is prose the agent LEARNS from, and learning needs
 * the record of what changed: a retired token there is DISAVOWED — legal where
 * it is buried in its own sentence, illegal where it is asserted.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { REPO_ROOT } from "./skill-bundle.js";

// Tokens retired by the single-shopper + SDS-redesign pivots. Matched
// CASE-INSENSITIVELY (each body is lowered, not the needle), so entries MUST be
// lower-case — pinned by a guard-of-the-guard in the bundle contract test.
export const RETIRED_TOKENS = [
  "profile.json", "domain_spec", "intent_spec", "playbook", "sil_remember",
  "sil_ping", "sil_echo", "rubric", "manage_domains",
  "refine_shopper", "sil_specs", "canonical",
  "sil_profile", "sil_learn", "method.md", "prd", "domainslug", "six-beat",
];

/** The bundle rule: a blanket forbid, no allowance, every needle. */
export const retiredTokenOffenders = (body: string): string[] => {
  const lower = body.toLowerCase();
  return RETIRED_TOKENS.filter((t) => lower.includes(t));
};

/** Pin 2 — the RECORDED exclusion set. The derivation below subtracts silently,
 * so without this literal a new live identifier containing a needle switches it
 * off across all of `docs/` with no red. */
export const DOCS_EXCLUDED_NEEDLES = ["canonical", "method.md", "prd", "domainslug"];

/** The retirement verbs the corpus already uses, FROZEN. Residue is cleared by a
 * named exemption, never by another word here — a vocabulary tuned until the
 * corpus goes green is fitted to one snapshot and grows invisibly. */
export const DISAVOWAL_VOCABULARY = [
  "deleted", "retired", "replaced", "renamed", "removed", "superseded",
  "no longer", "used to", "legacy", "could not", "precedent", "previously",
] as const;

export interface DocFile {
  /** docs-relative path, e.g. `knowledge/INDEX.md`. */
  path: string;
  body: string;
}

export interface DocOffender {
  file: string;
  needle: string;
  /** 1-based line of the needle occurrence, so a red names where to look. */
  line: number;
  text: string;
}

export interface DocsExemption {
  file: string;
  needle: string;
  reason: string;
}

export interface NeedleExclusion {
  needle: string;
  /** Repo-relative live-source files that contain it — the attribution that
   * separates a derivation from a hand list wearing its clothes. */
  files: string[];
}

const LIVE_SOURCE = join(REPO_ROOT, "src");

const liveSourceFiles = (): string[] =>
  (readdirSync(LIVE_SOURCE, { recursive: true }) as string[])
    .filter((rel) => !rel.split(/[\\/]/)[0]?.startsWith("__tests__"))
    .filter((rel) => statSync(join(LIVE_SOURCE, rel)).isFile());

/** Layer 1 — a needle whose string occurs in LIVE source is not a docs needle:
 * docs must be able to document live code. Self-healing, so deleting the legacy
 * store migration puts three needles back to work with no edit here. */
export function docsNeedleExclusions(): NeedleExclusion[] {
  const sources = liveSourceFiles().map((rel) => ({
    rel: posix.join("src", rel.split(/[\\/]/).join("/")),
    body: readFileSync(join(LIVE_SOURCE, rel), "utf8").toLowerCase(),
  }));
  return RETIRED_TOKENS.map((needle) => ({
    needle,
    files: sources.filter((s) => s.body.includes(needle)).map((s) => s.rel),
  })).filter((e) => e.files.length > 0);
}

export function docsNeedles(): string[] {
  const excluded = new Set(docsNeedleExclusions().map((e) => e.needle));
  return RETIRED_TOKENS.filter((t) => !excluded.has(t));
}

/** The named exemptions, keyed per `(file, needle)` — never per file, or a doc
 * exempted for one retirement goes blind to the next. Test-side because `docs/`
 * is gitignored: a marker inside a doc reaches no PR diff, a literal here does.
 * Each pair is re-proved by `inertExemptions()` (Pin 1). */
export const DOCS_EXEMPTIONS: DocsExemption[] = [
  {
    file: "knowledge/skill-prose-drift-guard-disavowal-discipline.md",
    needle: "sil_profile",
    reason: "the guard's own doc — it must quote the needle list, as data, to exist at all",
  },
  {
    file: "knowledge/skill-prose-drift-guard-disavowal-discipline.md",
    needle: "rubric",
    reason: "quoted as the worked example of case-insensitive matching (`Rubric`, `RUBRIC`)",
  },
  {
    file: "knowledge/skill-prose-drift-guard-disavowal-discipline.md",
    needle: "domain_spec",
    reason: "quoted as the counter-example to prefix-shortening a needle with live underscores",
  },
  {
    file: "knowledge/skill-prose-drift-guard-disavowal-discipline.md",
    needle: "profile.json",
    reason: "quoted as the needle whose subject is gone forever, the blanket-forbid case",
  },
  {
    file: "knowledge/skill-prose-drift-guard-disavowal-discipline.md",
    needle: "sil_remember",
    reason: "part of the measured `.mdx` escape proof — the payload IS two needles",
  },
  {
    file: "knowledge/adding-a-sil-tool-fans-out-to-exact-set-mirrors.md",
    needle: "sil_ping",
    reason: "the fan-out measurement record — the re-introduction the exact sets catch",
  },
  {
    file: "knowledge/adding-a-sil-tool-fans-out-to-exact-set-mirrors.md",
    needle: "sil_echo",
    reason: "the fan-out measurement record — the re-introduction the exact sets catch",
  },
  {
    file: "knowledge/adding-a-sil-tool-fans-out-to-exact-set-mirrors.md",
    needle: "sil_specs",
    reason: "names the card that measured the removal direction; without it the table is folklore",
  },
  {
    file: "knowledge/adding-a-sil-tool-fans-out-to-exact-set-mirrors.md",
    needle: "sil_remember",
    reason: "names the card that set the add-only standard; without it the table is folklore",
  },
];

/** Fenced blocks are BLANKED, not stripped — in `docs/` a fence quotes an
 * artefact rather than instructing, and blanking keeps every later offset and
 * line number true. */
const maskFences = (body: string): string =>
  body.replace(/```[\s\S]*?(?:```|$)/g, (m) => m.replace(/[^\n]/g, " "));

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/;
/** A statement: one frontmatter key, one bullet, one table ROW (never a cell),
 * one paragraph, one sentence. Finer than the bundle's `splitStatements` at the
 * frontmatter and paragraph seams — a `tags:` line four lines above the prose
 * must not bury it. */
const BODY_BOUNDARY = /(?<=[.!?])\s+|\n[ \t]*\r?\n\s*|\n[ \t]*(?:[-*+][ \t]|\|)/g;
/** Frontmatter splits per key AND per sentence: a `title:` here runs to hundreds
 * of words, so key-scope alone would let one `deleted` at its end bury an
 * assertion at its start. */
const KEY_BOUNDARY = /(?<=[.!?])\s+|\r?\n(?=[A-Za-z_][\w-]*:)/g;

interface Unit {
  start: number;
  text: string;
}

function cut(text: string, offset: number, boundary: RegExp): Unit[] {
  const units: Unit[] = [];
  const re = new RegExp(boundary.source, boundary.flags);
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    units.push({ start: offset + cursor, text: text.slice(cursor, m.index) });
    cursor = m.index + m[0].length;
  }
  units.push({ start: offset + cursor, text: text.slice(cursor) });
  return units.filter((u) => u.text.trim().length > 0);
}

function unitsOf(masked: string): Unit[] {
  const fm = FRONTMATTER.exec(masked);
  if (fm === null) return cut(masked, 0, BODY_BOUNDARY);
  const head = fm[0];
  return [
    ...cut(head, 0, KEY_BOUNDARY),
    ...cut(masked.slice(head.length), head.length, BODY_BOUNDARY),
  ];
}

const lineAt = (body: string, index: number): number =>
  body.slice(0, index).split("\n").length;

const frontmatterTags = (body: string): string =>
  (/^tags:\s*(.+)$/m.exec(FRONTMATTER.exec(body)?.[0] ?? "")?.[1] ?? "").toLowerCase();

const docId = (file: DocFile): string =>
  /^id:\s*(.+)$/m.exec(FRONTMATTER.exec(file.body)?.[0] ?? "")?.[1]?.trim()
  ?? posix.basename(file.path, ".md");

const HISTORY_ONLY = "history-only";
const hasMarker = (text: string): boolean =>
  new RegExp(`(^|[^\\w-])${HISTORY_ONLY}([^\\w-]|$)`).test(text);

/** Layer 2 — a doc that is history in its ENTIRETY is exempt wholesale, but only
 * when the marker ALSO appears in its INDEX row: the exemption is earned by being
 * announced where the next agent decides whether to open the doc. Fail-closed —
 * no INDEX row in the corpus means no exemption. */
function historyOnly(file: DocFile, corpus: DocFile[]): boolean {
  if (!hasMarker(frontmatterTags(file.body))) return false;
  const index = posix.join(dirname(file.path) === "." ? "" : dirname(file.path), "INDEX.md");
  const row = corpus
    .find((f) => f.path === index)
    ?.body.split("\n")
    .find((l) => l.includes(`[[${docId(file)}]]`));
  return row !== undefined && hasMarker(row.toLowerCase());
}

/**
 * The docs rule: every mention of a derived needle must bury it inside its own
 * statement. Offenders carry file → needle → line so a red names the prose to fix.
 */
export function docsRetiredTokenOffenders(
  corpus: DocFile[],
  exemptions: readonly DocsExemption[] = DOCS_EXEMPTIONS,
): DocOffender[] {
  const needles = docsNeedles();
  const offenders: DocOffender[] = [];
  for (const file of corpus) {
    if (!file.path.endsWith(".md")) continue; // the floor guard owns non-prose files
    if (historyOnly(file, corpus)) continue;
    const masked = maskFences(file.body);
    for (const unit of unitsOf(masked)) {
      const lower = unit.text.toLowerCase();
      if (DISAVOWAL_VOCABULARY.some((v) => lower.includes(v))) continue;
      for (const needle of needles) {
        const at = lower.indexOf(needle);
        if (at < 0) continue;
        if (exemptions.some((e) => e.file === file.path && e.needle === needle)) continue;
        offenders.push({
          file: file.path,
          needle,
          line: lineAt(masked, unit.start + at),
          text: unit.text.trim(),
        });
      }
    }
  }
  return offenders;
}

/** Pin 1 — exemptions whose pair no longer offends with the exemption withdrawn.
 * A per-(file, needle) table is the vacuity class that narrows silently to green;
 * this is what makes it self-cleaning instead. */
export function inertExemptions(
  corpus: DocFile[],
  exemptions: readonly DocsExemption[] = DOCS_EXEMPTIONS,
): DocsExemption[] {
  const raw = docsRetiredTokenOffenders(corpus, []);
  return exemptions.filter(
    (e) => !raw.some((o) => o.file === e.file && o.needle === e.needle),
  );
}
