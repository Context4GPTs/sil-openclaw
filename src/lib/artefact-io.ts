/**
 * Low-level artefact IO + frontmatter format for the sil shopper store.
 *
 * Extracted so BOTH the live store (`profile-store.ts`) and the store-format
 * migrations (`lib/migrations/*`) produce and parse BYTE-IDENTICAL frontmatter
 * without a circular import: the store gates on the migration runner (on-load
 * heal-before-serve), and Migration #1 must serialize into the exact
 * frontmatter-as-truth shape the store reads. Both depend DOWN on this leaf, so
 * the dependency graph stays a DAG (store → runner → registry → migration →
 * artefact-io; store → artefact-io).
 *
 * Atomic single-file writes: tmp sibling → write → rename over target → chmod. A
 * reader sees the old file or the new one, never a half-written one (mirrors
 * `credentials.ts`). Frontmatter is `--- key: value … ---` + an opaque body; a
 * file with malformed/absent frontmatter parses to null (fail-closed read).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

import { DIR_MODE } from "./credentials.js";

/** Owner-only file mode — artefacts are user-scoped, like tokens. The dir mode
 * (`DIR_MODE`, `0o700`) is owned by `credentials.ts` and imported, so the data-home
 * permission lives in exactly one place. */
export const FILE_MODE = 0o600;

export interface Artefact {
  fields: Record<string, string>;
  body: string;
}

/** One-line scalar for a coordinate value: newlines folded to spaces, trimmed. */
function scalar(value: string): string {
  return String(value).replace(/\r?\n/g, " ").trim();
}

export function serializeArtefact(fields: Record<string, string>, body: string): string {
  const fm = Object.entries(fields)
    .map(([k, v]) => k + ": " + scalar(v))
    .join("\n");
  // The store owns frontmatter — strip any block a model prepended to the body so the
  // artefact never stacks two (self-heals a previously double-wrapped file on re-write).
  const clean = stripLeadingFrontmatter(body);
  const b = clean.endsWith("\n") ? clean : clean + "\n";
  return "---\n" + fm + "\n---\n" + b;
}

/** Parse `--- key: value … ---` frontmatter + body. Returns null (⇒ `unreadable`) on
 * a missing open fence, a missing close fence, or an empty frontmatter block — a
 * fail-closed read, never a silent coercion. */
export function parseArtefact(raw: string): Artefact | null {
  if (!raw.startsWith("---")) return null;
  const close = raw.slice(3).match(/\n---[ \t]*\r?\n/);
  if (!close || close.index === undefined) return null;
  const fmRaw = raw.slice(3, 3 + close.index);
  const body = raw.slice(3 + close.index + close[0].length);
  const fields: Record<string, string> = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m && m[2] !== "") fields[m[1] as string] = (m[2] as string).trim();
  }
  if (Object.keys(fields).length === 0) return null;
  return { fields, body };
}

/** Strip a leading `--- … ---` frontmatter block a model may have prepended to a body,
 * reusing `parseArtefact` so ONLY a fence whose content is real frontmatter (≥1
 * `key: value`) is removed — a body opening with a bare `---` thematic break parses to
 * null and is returned untouched. The store owns frontmatter (frontmatter-as-truth), so a
 * model-authored block must never survive into the serialized body and stack a second. */
function stripLeadingFrontmatter(body: string): string {
  const parsed = parseArtefact(body);
  return parsed === null ? body : parsed.body;
}

/** Read + parse one artefact file, or null if absent/unreadable/malformed. */
export function readArtefactFile(path: string): Artefact | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return parseArtefact(raw);
}

/** Atomic single-file write: tmp sibling → write → rename over target → chmod. A
 * reader sees the old file or the new one, never a half-written one. Ensures the
 * containing dir (0700) first. */
export function atomicWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, contents, { mode: FILE_MODE });
  renameSync(tmp, path);
  chmodSync(path, FILE_MODE);
}

/** Write binary bytes atomically, owner-only. */
export function atomicWriteBytes(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, bytes, { mode: FILE_MODE });
  renameSync(tmp, path);
  chmodSync(path, FILE_MODE);
}
