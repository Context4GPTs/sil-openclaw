/**
 * Reading + SCOPING primitives for the `sil-shopping` bundle, shared by the two
 * files that guard its prose — `skill-bundle-contract.integration.test.ts` (the
 * load-bearing contract) and `three-step-loop.integration.test.ts` (the loop).
 * Same reason as `honesty-vocabulary.ts` and `per-niche-expert.ts`: one module,
 * so the two surfaces carrying the same rule cannot drift apart.
 *
 * SCOPING IS THE POINT. A corpus-wide `probe` + `not licensed` pair passes on the
 * very wording the guards reject, because both strings already sit three lines
 * apart in different paragraphs. Everything here narrows the window a rule is
 * allowed to be satisfied in: a statement, a file, or one beat's own section.
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
// Loop sections — the scope every loop bar is asserted inside.
// ===========================================================================

/** The loop's sections, in order. The NAME is part of the contract: the agent routes
 * on it, and a renamed section is one it cannot find. Matched CASE-SENSITIVELY —
 * `find`, `price` and `open` are ordinary English words, and a case-insensitive scan
 * would hand a section to whichever paragraph happened to use the verb first. */
export const LOOP_SECTIONS = ["OPEN", "GATHER", "FIND", "PRICE", "DECIDE"] as const;
export type LoopSection = (typeof LOOP_SECTIONS)[number];

export interface LoopSectionBody {
  /** Bundle-relative path of the file whose heading opens the section. */
  file: string;
  heading: string;
  /** The heading line plus everything under it, to the next same-or-higher heading. */
  body: string;
}

/**
 * Map section → the prose that owns it, derived from HEADINGS on disk.
 *
 * THE ONE FORMAT CONTRACT this helper imposes: each section is opened by a markdown
 * heading naming it in upper case. That makes "the decision lives in the step that
 * owns it" a checkable claim rather than a corpus-wide grep.
 *
 * THE MOST SPECIFIC heading wins, and equally-specific ones concatenate: GATHER is
 * deliberately written in two files (the category, then the brief), while a heading
 * naming several sections is an index whose body would otherwise swallow them all.
 *
 * `examples/` is EXCLUDED. A worked run DEMONSTRATING a step is not the reference
 * that STATES its discipline: the agent loads the reference at the moment of use and
 * may never open the example.
 */
export function loopSections(): Map<LoopSection, LoopSectionBody> {
  const candidates = new Map<LoopSection, Array<LoopSectionBody & { breadth: number }>>();
  for (const rel of bundleFiles().filter((p) => !p.startsWith("examples/"))) {
    const lines = read(rel).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const h = /^(#{1,6})\s+(.*)$/.exec(lines[i] as string);
      if (!h) continue;
      const level = (h[1] as string).length;
      const heading = h[2] as string;
      const named = LOOP_SECTIONS.filter((name) => new RegExp(`\\b${name}\\b`).test(heading));
      if (named.length === 0) continue;
      let end = i + 1;
      while (end < lines.length) {
        const next = /^(#{1,6})\s+/.exec(lines[end] as string);
        if (next && (next[1] as string).length <= level) break;
        end += 1;
      }
      const body = lines.slice(i, end).join("\n");
      for (const name of named) {
        const list = candidates.get(name) ?? [];
        list.push({ file: rel, heading, body, breadth: named.length });
        candidates.set(name, list);
      }
    }
  }

  const found = new Map<LoopSection, LoopSectionBody>();
  for (const [name, list] of candidates) {
    const breadth = Math.min(...list.map((c) => c.breadth));
    const best = list.filter((c) => c.breadth === breadth);
    found.set(name, {
      file: (best[0] as LoopSectionBody).file,
      heading: (best[0] as LoopSectionBody).heading,
      body: best.map((c) => c.body).join("\n"),
    });
  }
  return found;
}

/** The section's own prose, or a LOUD throw. Never "" — an empty scope makes every
 * `unsatisfied()` bar below it pass vacuously, which is worse than a red. */
export function sectionBody(name: LoopSection): string {
  const section = loopSections().get(name);
  if (section === undefined) {
    throw new Error(
      `no bundle heading opens the ${name} section (expected a markdown heading naming`
        + ` "${name}") — found: ${[...loopSections().keys()].join(", ") || "none"}`,
    );
  }
  return section.body;
}

/** The section, cut into statements. */
export const sectionStatements = (name: LoopSection): string[] =>
  splitStatements(sectionBody(name));
