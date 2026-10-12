/** Reading primitives for the `sil-shopping` bundle. */

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
