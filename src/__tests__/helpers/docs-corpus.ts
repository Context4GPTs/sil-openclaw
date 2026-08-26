/**
 * Reading primitives for `docs/**`, mirroring `skill-bundle.ts` for the bundle.
 * Rooted at a CHECKOUT (not at `docs/`) and parameterised because `docs/` is
 * gitignored: absence is normal in a card worktree, so it must be drivable.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { REPO_ROOT } from "./skill-bundle.js";
import type { DocFile } from "./retired-tokens.js";

export const DOCS_ROOT = join(REPO_ROOT, "docs");

/** Extensions a docs entry may carry WITHOUT being prose. Empty today (37/37 are
 * `.md`); `docs/design/` may earn one, which is the deliberate decision the floor
 * exists to force — and it costs a visible diff line. */
export const DOCS_NONPROSE_EXTENSIONS: string[] = [];

const docsDir = (root: string): string => join(root, "docs");

export const docsPresent = (root: string = REPO_ROOT): boolean => {
  const dir = docsDir(root);
  return existsSync(dir) && statSync(dir).isDirectory();
};

/** Every FILE on disk, unfiltered — a hand list misses the next format silently.
 * THROWS on an absent or empty tree rather than returning `[]`: every scan over
 * this corpus is `toEqual([])`, so an empty read is a pass that read nothing. */
export function docsEntries(root: string = REPO_ROOT): string[] {
  const dir = docsDir(root);
  if (!docsPresent(root)) throw new Error(`no docs corpus: ${dir} does not exist`);
  const entries = (readdirSync(dir, { recursive: true }) as string[])
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .map((rel) => rel.split(/[\\/]/).join("/"))
    .sort();
  if (entries.length === 0) throw new Error(`no docs corpus: ${dir} holds no files`);
  return entries;
}

export function docsFiles(root: string = REPO_ROOT): DocFile[] {
  const dir = docsDir(root);
  const files = docsEntries(root)
    .filter((rel) => rel.endsWith(".md"))
    .map((path) => ({ path, body: readFileSync(join(dir, path), "utf8") }));
  if (files.length === 0) throw new Error(`no docs corpus: ${dir} holds no .md prose`);
  return files;
}

/** The file-set floor: a docs entry that is neither prose nor a declared
 * non-prose format escapes the sieve entirely (this repo has measured that
 * escape via a `.mdx`). */
export const docsEntryFloorOffenders = (entries: string[]): string[] =>
  entries.filter(
    (rel) => !rel.endsWith(".md") && !DOCS_NONPROSE_EXTENSIONS.includes(posix.extname(rel)),
  );
