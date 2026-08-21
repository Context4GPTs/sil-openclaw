/**
 * Reading + SCOPING primitives for the `sil-shopping` bundle, shared by the two
 * files that guard its prose — `skill-bundle-contract.integration.test.ts` (the
 * load-bearing contract) and `eight-beat-loop.integration.test.ts` (the beats).
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
// Beat sections — the scope every eight-beat bar is asserted inside.
// ===========================================================================

/** The eight beats of `SIL-DOMAINS-AND-SPECS.md` §5, in order. The NAME is part of
 * the contract: an agent routes on it, and a renamed beat is a beat it cannot find. */
export const BEAT_NAMES = [
  "BRIEF",
  "DOMAIN",
  "FILL",
  "ASK",
  "SEARCH",
  "REFLECT",
  "FEEDBACK",
  "VERDICT",
] as const;

export interface BeatSection {
  /** Bundle-relative path of the file whose heading opens the beat. */
  file: string;
  heading: string;
  /** The heading line plus everything under it, to the next same-or-higher heading. */
  body: string;
}

/**
 * Map beat number → the section that owns it, derived from HEADINGS on disk.
 *
 * THE ONE FORMAT CONTRACT this helper imposes: each beat is opened by a markdown
 * heading naming `Beat <n>`. That is already the bundle's own convention, and it is
 * what makes "the decision lives at the beat that owns it" a checkable claim rather
 * than a corpus-wide grep.
 *
 * THE MOST SPECIFIC heading wins. `# Beats 3 (FILL), 4 (ASK), 7 and 8` is a FILE
 * index whose section runs to EOF, so taking it would hand beat 3 the whole file —
 * and the C7 bar, which forbids an ask inside FILL, would read beat 4's own prose as
 * its offender. So each beat keeps only the sections naming the FEWEST beats, and
 * several equally-specific sections (a beat discussed in two references) concatenate.
 *
 * `examples/` is EXCLUDED. A worked run DEMONSTRATING a beat is not the reference
 * that STATES its discipline: the agent loads the reference at the moment of use and
 * may never open the example. Without this the walkthrough — one file naming all
 * eight beats — would satisfy every beat-scoped bar on its own.
 */
export function beatSections(): Map<number, BeatSection> {
  const candidates = new Map<number, Array<BeatSection & { breadth: number }>>();
  for (const rel of bundleFiles().filter((p) => !p.startsWith("examples/"))) {
    const lines = read(rel).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const h = /^(#{1,6})\s+(.*)$/.exec(lines[i] as string);
      if (!h) continue;
      const level = (h[1] as string).length;
      const heading = h[2] as string;
      // A PLURAL heading is a beat LIST — `# Beats 3 (FILL), 4 (ASK), 7 and 8` repeats
      // no "Beat" before the later numbers, so anchoring on the word would read it as
      // beat 3 alone, at breadth 1, and it would tie with (and swallow) beat 3's own
      // section. Every bare 1–8 in a plural heading is one of its beats.
      const numbers = /\bbeats\b/i.test(heading)
        ? [...new Set([...heading.matchAll(/\b([1-8])\b/g)].map((m) => Number(m[1])))]
        : [...new Set([...heading.matchAll(/\bbeat\s+([1-8])\b/gi)].map((m) => Number(m[1])))];
      if (numbers.length === 0) continue;
      let end = i + 1;
      while (end < lines.length) {
        const next = /^(#{1,6})\s+/.exec(lines[end] as string);
        if (next && (next[1] as string).length <= level) break;
        end += 1;
      }
      const body = lines.slice(i, end).join("\n");
      for (const n of numbers) {
        const list = candidates.get(n) ?? [];
        list.push({ file: rel, heading, body, breadth: numbers.length });
        candidates.set(n, list);
      }
    }
  }

  const found = new Map<number, BeatSection>();
  for (const [n, list] of candidates) {
    const breadth = Math.min(...list.map((c) => c.breadth));
    const best = list.filter((c) => c.breadth === breadth);
    found.set(n, {
      file: (best[0] as BeatSection).file,
      heading: (best[0] as BeatSection).heading,
      body: best.map((c) => c.body).join("\n"),
    });
  }
  return found;
}

/** The beat's own section, or a LOUD throw. Never "" — an empty scope makes every
 * `unsatisfied()` bar below it pass vacuously, which is worse than a red. */
export function beatBody(n: number): string {
  const section = beatSections().get(n);
  if (section === undefined) {
    throw new Error(
      `no bundle heading opens beat ${n} (expected a markdown heading naming "Beat ${n}") —`
        + ` found: ${[...beatSections().keys()].sort((a, b) => a - b).join(", ") || "none"}`,
    );
  }
  return section.body;
}

/** Bundle-relative path of the file that owns a beat — so a bar can name WHERE a
 * decision must live without hardcoding a filename the next rename invalidates. */
export function beatFile(n: number): string {
  const section = beatSections().get(n);
  if (section === undefined) throw new Error(`no bundle heading opens beat ${n}`);
  return section.file;
}

/** The beat's section, cut into statements. */
export const beatStatements = (n: number): string[] => splitStatements(beatBody(n));
