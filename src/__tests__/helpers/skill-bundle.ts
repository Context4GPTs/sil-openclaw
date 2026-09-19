/**
 * Reading + SCOPING primitives for the `sil-shopping` bundle, shared by the two
 * files that guard its prose — `skill-bundle-contract.integration.test.ts` (the
 * load-bearing contract) and `skill-rules.integration.test.ts` (the rules).
 * Same reason as `honesty-vocabulary.ts` and `per-niche-expert.ts`: one module,
 * so the two surfaces carrying the same rule cannot drift apart.
 *
 * SCOPING IS THE POINT. A corpus-wide `probe` + `not licensed` pair passes on the
 * very wording the guards reject, because both strings already sit three lines
 * apart in different paragraphs. Everything here narrows the window a rule is
 * allowed to be satisfied in: a statement, a file, or one heading's own section.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** …/src/__tests__/helpers → the checkout root. */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const BUNDLE = join(REPO_ROOT, "sil-shopping");

export const read = (rel: string): string => readFileSync(join(BUNDLE, rel), "utf8");
export const skillSrc = (): string => read("SKILL.md");

/** Every FILE on disk, unfiltered — the floor test proves nothing escapes the
 * `.md` scan. A hand-maintained table silently misses a new bundle file, which is
 * how a drift guard rots into a vacuous green. */
export const bundleEntries = (): string[] =>
  (readdirSync(BUNDLE, { recursive: true }) as string[]).filter((p) =>
    statSync(join(BUNDLE, p)).isFile(),
  );

export const bundleFiles = (): string[] => bundleEntries().filter((p) => p.endsWith(".md"));
export const bundleCorpus = (): string => bundleFiles().map(read).join("\n");

export function frontmatter(): { name: string; description: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(skillSrc());
  if (!m) throw new Error("SKILL.md: no parseable --- frontmatter block");
  const [, fm, body] = m;
  return {
    name: /^name:\s*["']?(.+?)["']?\s*$/m.exec(fm)?.[1] ?? "",
    description: /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim() ?? "",
    body: body ?? "",
  };
}

/** The router's table rows — what the agent matches an intent against. */
export const routingRows = (): string[] =>
  frontmatter()
    .body.split("\n")
    .filter((line) => line.trimStart().startsWith("|"));

/** Cut text into STATEMENTS — one bullet, one table row, one sentence. The bundle
 * is hard-wrapped, so a LINE is not a statement; a bullet or a row is. */
export const splitStatements = (text: string): string[] =>
  text
    .split(/\n\s*(?:[-*+]\s|\|)|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/** Every statement in the bundle, cut PER FILE — a unit that straddled a file
 * boundary could pair one file's claim with the next file's denial. */
export const statements = (): string[] => bundleFiles().flatMap((rel) => splitStatements(read(rel)));

/** `[]` when some candidate satisfies the rule, else the candidates themselves — so
 * a red PRINTS the statements the writer has to fix, not "0 is not greater than 0". */
export const unsatisfied = (candidates: string[], rule: (s: string) => boolean): string[] =>
  candidates.some(rule) ? [] : candidates;

// ===========================================================================
// Sections — the scope a prose bar is asserted inside.
// ===========================================================================

/** The fallback document, by path: the mint discipline is the whole of what it says,
 * so the file IS the scope. */
export const MINT = "references/mint.md";

/**
 * SKILL.md's own headings, by the short name the bars call them. The HEADING is part
 * of the contract — the agent reads the file top-down and finds a rule under the
 * heading that frames it — so a renamed one throws here rather than quietly widening
 * the scope of every bar beneath it.
 */
export const SKILL_SECTIONS = {
  reading: "Start by reading",
  tools: "The tools",
  using: "Using sil well",
  seller: "Don't take a seller's word",
  traps: "Common traps",
  pick: "Showing a pick",
} as const;
export type SkillSection = keyof typeof SKILL_SECTIONS;

const HEADINGS = (body: string): string[] =>
  body.split(/\r?\n/).flatMap((l) => /^#{1,6}\s+(.*)$/.exec(l)?.[1] ?? []);

/**
 * One file's section: the heading line plus everything under it, to the next
 * same-or-higher heading.
 *
 * Throws rather than returning "" — an empty scope makes every `unsatisfied()` bar
 * below it pass vacuously, which is worse than a red. The throw prints the headings
 * the file actually has, so a rename is one read to fix.
 */
export function section(rel: string, heading: string): string {
  const lines = read(rel).split(/\r?\n/);
  const open = new RegExp(`^(#{1,6})\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const start = lines.findIndex((l) => open.test(l));
  if (start < 0) {
    throw new Error(
      `${rel}: no heading opens "${heading}" — found: ${HEADINGS(read(rel)).join(" · ")}`,
    );
  }
  const level = (/^(#+)/.exec(lines[start] as string)?.[1] as string).length;
  let end = start + 1;
  while (end < lines.length && !new RegExp(`^#{1,${level}}\\s`).test(lines[end] as string)) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

export const skillSection = (name: SkillSection): string =>
  section("SKILL.md", SKILL_SECTIONS[name]);

export const skillSectionStatements = (name: SkillSection): string[] =>
  splitStatements(skillSection(name));

export const mintStatements = (): string[] => splitStatements(read(MINT));

/**
 * SKILL.md above its first `##` — the three things that carry the job. Scoped apart
 * from the rest of the file because it is the frame the agent reads everything else
 * under: a claim about what sil SHIPS that slides down into a tip is a claim the
 * agent meets after it has already decided how to work.
 */
export function skillPreamble(): string {
  const body = frontmatter().body;
  const cut = body.search(/^##\s+/m);
  if (cut <= 0) {
    throw new Error("SKILL.md: nothing above the first `## ` heading — the preamble that"
      + " frames the file is gone, and every bar scoped to it would pass over nothing");
  }
  return body.slice(0, cut);
}

export const preambleStatements = (): string[] => splitStatements(skillPreamble());
