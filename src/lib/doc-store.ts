/**
 * The sil shopper's document store — one FLAT, kind-tagged tree under
 * `$SIL_DATA_DIR/shopper`, frontmatter-as-truth, and a full scan is the only index.
 * `ref := "shopper" | "brief:<slug>"`; `shopper` is a compile-time constant, so the
 * Brief slug is the ONE caller-supplied path segment and it is guarded before any join.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, relative } from "node:path";
import { randomBytes } from "node:crypto";

import { DIR_MODE, ensureDataDir, getDataDir } from "./credentials.js";

/** Owner-only file mode, mirroring `credentials.ts` (which owns `DIR_MODE`). */
const FILE_MODE = 0o600;

const SHOPPER_SUBDIR = "shopper";
const BRIEFS_SUBDIR = "briefs";
const USER_SPEC_FILE = "user_spec.md";

/** The one legacy layout this store migrates off (§4.8, one hop off one baseline). */
const LEGACY_DOMAINS_SUBDIR = "domains";
const LEGACY_METHOD_FILE = "method.md";
const LEGACY_PRDS_SUBDIR = "prds";

/** A slug becomes a filesystem path segment, so it is lower-kebab and never `main`
 * (host-reserved) — checked before any join, never after. */
const SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;

/** A Brief's lifecycle, and the closed set the `status` filter matches against. */
const BRIEF_STATUSES = ["active", "done", "dropped"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

/** The v0 ref kinds. `thing` / `collection` are specified but have no writer yet, so
 * they are `invalid_request` rather than an empty kind nobody can populate. */
const DOC_KINDS = ["shopper", "brief"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export type WriteMode = "create" | "replace";

// ===========================================================================
// Result variants — the store never throws across the tool boundary.
// ===========================================================================

export interface InvalidRequest {
  ok: false;
  kind: "invalid_request";
  field: string;
  message: string;
}

interface NotFound {
  ok: false;
  kind: "not_found";
  message: string;
}

/** NOT KNOWN TO BE ABSENT — a document that will not parse, a store directory the OS
 * will not list, or a path the OS would not let us stat at all. Never conflated with
 * `not_found`: an agent that reads "absent" over a corrupt document re-mints and the
 * buyer's own words are gone. */
interface Unreadable {
  ok: false;
  kind: "unreadable";
  message: string;
}

interface PersistenceFailed {
  ok: false;
  kind: "persistence_failed";
  /** "<path>: <cause>" so recovery is actionable (never a token/PII). */
  error: string;
  message: string;
  recovery: "fix_data_dir";
}

export type StoreFailure = InvalidRequest | NotFound | Unreadable | PersistenceFailed;

function invalid(field: string, message: string): InvalidRequest {
  return { ok: false, kind: "invalid_request", field, message };
}

function notFound(message: string): NotFound {
  return { ok: false, kind: "not_found", message };
}

function unreadable(path: string): Unreadable {
  return {
    ok: false,
    kind: "unreadable",
    message:
      path + ": the document is present but corrupt (malformed or absent frontmatter)"
        + " — inspect / repair, do NOT overwrite (it may still be recoverable).",
  };
}

function persistenceFailed(path: string, err: unknown): PersistenceFailed {
  return {
    ok: false,
    kind: "persistence_failed",
    error: path + ": " + errCause(err),
    message:
      "The shopper's documents could NOT be written to the sil data directory, so the"
      + " change did not stick. Fix the data directory (it must be writable — check"
      + " permissions / free space / that $SIL_DATA_DIR is a directory), then try again.",
    recovery: "fix_data_dir",
  };
}

function nonBlank(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function errCause(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `readdirSync` throws where the probe already settled presence — EACCES, or a
 * directory present as a FILE (the read is ENOTDIR). Every listing goes through here
 * so a broken tree is REPORTED, never thrown at a tool. */
function listDir(dir: string): { entries: Dirent[]; error: string | null } {
  try {
    return { entries: readdirSync(dir, { withFileTypes: true }), error: null };
  } catch (err) {
    return { entries: [], error: errCause(err) };
  }
}

function listingError(cause: string): string {
  return "the directory could not be listed: " + cause
    + " — repair it by hand (it may be unreadable, or a file where a directory belongs)";
}

/** ONE primitive for every gate that decides absence. `existsSync` is a boolean over a
 * stat that swallows every errno, so its `false` means ENOENT *or* "I was not allowed to
 * look" — the conflation `Unreadable` forbids. A throw here leaves presence UNKNOWN, and
 * unknown is stated, never guessed as absence. */
type Presence =
  | { state: "present" }
  | { state: "absent" }
  | { state: "unknown"; error: string };

function probe(path: string): Presence {
  try {
    statSync(path);
    return { state: "present" };
  } catch (err) {
    // ENOENT alone is proof of absence (a dangling symlink included). `throwIfNoEntry`
    // is NOT the classifier: it also swallows ENOTDIR, which is a broken tree.
    return (err as NodeJS.ErrnoException).code === "ENOENT"
      ? { state: "absent" }
      : { state: "unknown", error: errCause(err) };
  }
}

function presenceError(cause: string): string {
  return "presence could not be determined: " + cause
    + " — repair it by hand (it may be unreadable, or a file where a directory belongs)";
}

/** An unsettled presence as a verb-facing variant — `unreadable`, never `not_found`. */
function storeUnreadable(path: string, error: string): Unreadable {
  return {
    ok: false,
    kind: "unreadable",
    message: path + ": " + error
      + ". The document may still be on disk, so do NOT mint a fresh one over it.",
  };
}

/** The root as `findDocuments` alone needs it: the whole store sits behind this one
 * directory, so its fault is reported once for every query. Enumeration IS the operation
 * here — the ref-addressed verbs probe the path they were asked about instead. */
function shopperDirError(): string | null {
  const dir = getShopperArtefactDir();
  const at = probe(dir);
  if (at.state === "absent") return null;
  if (at.state === "unknown") return presenceError(at.error);
  const { error } = listDir(dir);
  return error === null ? null : listingError(error);
}

/** Names only, `.md` only, sorted — a scan's stable order. A DIRECTORY named `x.md`
 * is kept, so it reads `unreadable` rather than vanishing from the index. */
function markdownNames(entries: Dirent[]): string[] {
  return entries.filter((e) => e.name.endsWith(".md")).map((e) => e.name).sort();
}

// ===========================================================================
// Refs — the only addressing scheme, and the only caller-supplied path segment.
// ===========================================================================

/** Discriminated on `kind`: the shopper is a singleton with no slug, a Brief always
 * carries one. Nothing downstream asserts a slug the compiler cannot see. */
type ResolvedRef =
  | { ref: "shopper"; kind: "shopper"; path: string }
  | { ref: string; kind: "brief"; slug: string; path: string };

/** Validate a caller-supplied path segment BEFORE any join, so a traversal, a
 * separator, an absolute path, uppercase, or `main` never becomes one. */
function rejectBadSegment(value: unknown, field: string): InvalidRequest | null {
  if (!nonBlank(value)) {
    return invalid(field, field + " is required and must be non-empty.");
  }
  if (value === "main") {
    return invalid(field, '"main" is host-reserved and cannot be a ' + field + ".");
  }
  if (!SEGMENT_RE.test(value)) {
    return invalid(
      field,
      field + " must be lower-kebab (a-z, 0-9, hyphen) — got: " + JSON.stringify(value),
    );
  }
  return null;
}

const REF_GRAMMAR = 'ref must be "shopper" or "brief:<slug>"';

/** Resolve `ref` to a kind + an absolute path. Every doc verb starts here. */
export function resolveRef(value: unknown): ResolvedRef | InvalidRequest {
  if (!nonBlank(value)) return invalid("ref", REF_GRAMMAR + " — got an empty ref.");
  if (value === "shopper") {
    return { ref: "shopper", kind: "shopper", path: join(getShopperArtefactDir(), USER_SPEC_FILE) };
  }
  const sep = value.indexOf(":");
  if (sep < 0) {
    return invalid("ref", REF_GRAMMAR + " — got: " + JSON.stringify(value) + ".");
  }
  const kind = value.slice(0, sep);
  const slug = value.slice(sep + 1);
  if (kind !== "brief") {
    // `thing:` / `collection:` are named by the spec but have no writer at v0 —
    // answering `not_found` would read as "yours is missing" rather than "not yet".
    return invalid(
      "ref",
      REF_GRAMMAR + " — " + JSON.stringify(kind) + " is not an addressable kind at v0.",
    );
  }
  const bad = rejectBadSegment(slug, "ref");
  if (bad) return bad;
  return { ref: value, kind: "brief", slug, path: briefPath(slug) };
}

/** The SINGLETON shopper's document directory. `getDataDir()` honours
 * `$SIL_DATA_DIR` / `$XDG_DATA_HOME`, so nothing here is hardcoded. */
export function getShopperArtefactDir(): string {
  return join(getDataDir(), SHOPPER_SUBDIR);
}

/** SAFETY: `slug` must have passed `rejectBadSegment` before this join. */
function briefPath(slug: string): string {
  return join(getShopperArtefactDir(), BRIEFS_SUBDIR, slug + ".md");
}

// ===========================================================================
// Frontmatter serialize / parse — coordinates are single-line scalars, the body is
// opaque markdown. A malformed file parses to null and reads `unreadable`.
// ===========================================================================

interface Artefact {
  fields: Record<string, string>;
  body: string;
}

function scalar(value: string): string {
  return String(value).replace(/\r?\n/g, " ").trim();
}

function serializeArtefact(fields: Record<string, string>, body: string): string {
  const fm = Object.entries(fields)
    .map(([k, v]) => k + ": " + scalar(v))
    .join("\n");
  // The store owns frontmatter — strip any block a model prepended to the body so a
  // document never stacks two (self-heals a previously double-wrapped file on re-write).
  const clean = stripLeadingFrontmatter(body);
  const b = clean.endsWith("\n") ? clean : clean + "\n";
  return "---\n" + fm + "\n---\n" + b;
}

/** Null (⇒ `unreadable`) on a missing open fence, a missing close fence, or an empty
 * frontmatter block — a fail-closed read, never a silent coercion. */
function parseArtefact(raw: string): Artefact | null {
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

/** Reuses `parseArtefact` so only a fence whose content is REAL frontmatter is
 * removed — a body opening with a `---` thematic break is returned untouched. */
function stripLeadingFrontmatter(body: string): string {
  const parsed = parseArtefact(body);
  return parsed === null ? body : parsed.body;
}

function readArtefactFile(path: string): Artefact | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return parseArtefact(raw);
}

/** Atomic single-file write: tmp sibling → write → rename over target → chmod. A
 * reader sees the old file or the new one, never a half-written one. */
function atomicWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, contents, { mode: FILE_MODE });
  renameSync(tmp, path);
  chmodSync(path, FILE_MODE);
}

// ===========================================================================
// `## Items` — the Brief's scope, fan-out and completion, parsed out of the body
// the scan already loaded (§4.8: a Brief carries many domains, so its domain filter
// cannot be a frontmatter scalar).
// ===========================================================================

export interface ItemRow {
  item: string;
  domain: string;
  status: string;
}

function sectionBody(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

function parseItems(body: string): ItemRow[] {
  const rows: ItemRow[] = [];
  for (const line of sectionBody(body, "## Items").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const [item = "", domain = "", status = ""] = cells;
    if (item === "" || /^:?-{2,}:?$/.test(item)) continue; // the separator row
    if (item.toLowerCase() === "item" && domain.toLowerCase() === "domain") continue; // header
    rows.push({ item, domain, status });
  }
  return rows;
}

/** Nearest-wins prefix match, the ancestor rule the whole design reuses: `product`
 * matches `product.apparel`, and never `production`. */
function domainMatches(itemDomain: string, filter: string): boolean {
  return itemDomain === filter || itemDomain.startsWith(filter + ".");
}

// ===========================================================================
// sil_doc_find — the index, and the only discovery path. COORDINATES ONLY.
// ===========================================================================

export interface FindQuery {
  kind?: string;
  domain?: string;
  status?: string;
  query?: string;
}

export interface BriefCoord {
  ref: string;
  slug: string;
  title: string;
  status: string;
  items: ItemRow[];
  path: string;
  updated_at: string;
}

export interface ShopperCoord {
  ref: "shopper";
  name: string;
  path: string;
}

export interface FindResult {
  ok: true;
  /** Present iff a shopper document exists and the filters admit it. */
  shopper?: ShopperCoord;
  briefs: BriefCoord[];
  unreadable: Array<{ id: string; error: string }>;
}

/** The query once validated: a filter is absent or a real value, so neither finder
 * re-checks blankness. `q` is lowercased once, here. */
interface FindFilters {
  kind: string | undefined;
  domain: string | undefined;
  status: string | undefined;
  q: string | undefined;
}

/** Entries accumulate across both finders in scan order — legacy, shopper, Briefs. */
type UnreadableDocs = Array<{ id: string; error: string }>;

export function findDocuments(query: FindQuery = {}): FindResult | InvalidRequest {
  if (nonBlank(query.kind) && !(DOC_KINDS as readonly string[]).includes(query.kind)) {
    return invalid("kind", "kind must be one of " + DOC_KINDS.join(" | ") + ".");
  }
  if (nonBlank(query.status) && !(BRIEF_STATUSES as readonly string[]).includes(query.status)) {
    return invalid("status", "status must be one of " + BRIEF_STATUSES.join(" | ") + ".");
  }
  const rootError = shopperDirError();
  // Filters never suppress this: the whole store is behind that one directory, so an
  // empty result here would read as "this shopper has nothing" for every query.
  if (rootError !== null) {
    return { ok: true, briefs: [], unreadable: [{ id: SHOPPER_SUBDIR, error: rootError }] };
  }
  const filters = normalizeFilters(query);
  // A legacy file the migration could not parse is surfaced here, unfiltered: only the
  // doc TOOLS migrate, so without this the one file the transform cannot fix is
  // invisible to the read-only surfaces that exist to report it (`sil_doctor`).
  const unreadable: UnreadableDocs = scanLegacyTree().corrupt.map(({ path, error }) => ({
    id: relative(getShopperArtefactDir(), path),
    error,
  }));
  const shopper = findShopper(filters, unreadable);
  const briefs =
    filters.kind !== undefined && filters.kind !== "brief" ? [] : findBriefs(filters, unreadable);
  return { ok: true, ...(shopper !== undefined ? { shopper } : {}), briefs, unreadable };
}

function normalizeFilters(query: FindQuery): FindFilters {
  return {
    kind: nonBlank(query.kind) ? query.kind : undefined,
    domain: nonBlank(query.domain) ? query.domain : undefined,
    status: nonBlank(query.status) ? query.status : undefined,
    q: nonBlank(query.query) ? query.query.toLowerCase() : undefined,
  };
}

/** The singleton. It carries no domain and no status, so either filter excludes it
 * rather than matching it vacuously. */
function findShopper(filters: FindFilters, unreadable: UnreadableDocs): ShopperCoord | undefined {
  const wanted =
    (filters.kind === undefined || filters.kind === "shopper")
    && filters.domain === undefined
    && filters.status === undefined;
  if (!wanted) return undefined;
  const path = join(getShopperArtefactDir(), USER_SPEC_FILE);
  const at = probe(path);
  if (at.state === "absent") return undefined;
  if (at.state === "unknown") {
    unreadable.push({ id: "shopper", error: presenceError(at.error) });
    return undefined;
  }
  const parsed = readArtefactFile(path);
  if (parsed === null) {
    unreadable.push({ id: "shopper", error: USER_SPEC_FILE + " has malformed or absent frontmatter" });
    return undefined;
  }
  const name = parsed.fields["name"] ?? "";
  // A shopper document that cannot say who it is is degraded, not healthy — the same
  // verdict `readShopperIdentity` reaches, reported once, here. Still a coordinate:
  // the person exists, and hiding them would read as "no shopper".
  if (!nonBlank(name)) {
    unreadable.push({ id: "shopper", error: USER_SPEC_FILE + " frontmatter carries no name" });
  }
  if (filters.q !== undefined && !("shopper " + name).toLowerCase().includes(filters.q)) {
    return undefined;
  }
  return { ref: "shopper", name, path };
}

function findBriefs(filters: FindFilters, unreadable: UnreadableDocs): BriefCoord[] {
  const dir = join(getShopperArtefactDir(), BRIEFS_SUBDIR);
  const at = probe(dir);
  if (at.state === "absent") return [];
  if (at.state === "unknown") {
    unreadable.push({ id: BRIEFS_SUBDIR, error: presenceError(at.error) });
    return [];
  }
  const listing = listDir(dir);
  if (listing.error !== null) {
    unreadable.push({ id: BRIEFS_SUBDIR, error: listingError(listing.error) });
    return [];
  }
  const briefs: BriefCoord[] = [];
  for (const file of markdownNames(listing.entries)) {
    const path = join(dir, file);
    const parsed = readArtefactFile(path);
    const slug = file.replace(/\.md$/, "");
    if (parsed === null) {
      unreadable.push({ id: "brief:" + slug, error: "brief has malformed or absent frontmatter" });
      continue;
    }
    const coord: BriefCoord = {
      ref: "brief:" + slug,
      slug,
      title: parsed.fields["title"] ?? slug,
      status: parsed.fields["status"] ?? "",
      items: parseItems(parsed.body),
      path,
      updated_at: parsed.fields["updated_at"] ?? "",
    };
    if (admits(filters, coord)) briefs.push(coord);
  }
  return briefs;
}

function admits(filters: FindFilters, coord: BriefCoord): boolean {
  if (filters.status !== undefined && coord.status !== filters.status) return false;
  const domain = filters.domain;
  if (domain !== undefined && !coord.items.some((i) => domainMatches(i.domain, domain))) return false;
  return filters.q === undefined || (coord.slug + " " + coord.title).toLowerCase().includes(filters.q);
}

// ===========================================================================
// sil_doc_read — one whole body + frontmatter.
// ===========================================================================

export type ReadDocResult =
  | {
      ok: true;
      ref: string;
      kind: DocKind;
      fields: Record<string, string>;
      body: string;
      path: string;
    }
  | InvalidRequest
  | NotFound
  | Unreadable;

export function readDocument(ref: unknown): ReadDocResult {
  const target = resolveRef(ref);
  if ("ok" in target) return target;
  const at = probe(target.path);
  if (at.state === "unknown") return storeUnreadable(target.path, presenceError(at.error));
  if (at.state === "absent") {
    return notFound(
      "No document at " + JSON.stringify(target.ref) + " — list what exists with"
        + " sil_doc_find, or write it with sil_doc_write (mode: create).",
    );
  }
  const parsed = readArtefactFile(target.path);
  if (parsed === null) return unreadable(target.path);
  return {
    ok: true,
    ref: target.ref,
    kind: target.kind,
    fields: parsed.fields,
    body: parsed.body,
    path: target.path,
  };
}

// ===========================================================================
// sil_doc_write — the WHOLE reconciled markdown. create fails if the ref exists,
// replace fails if it does not: a mint never clobbers, a write never mints.
// ===========================================================================

export interface WriteSpec {
  ref: unknown;
  mode: unknown;
  body?: string;
  /** Brief frontmatter. */
  title?: string;
  status?: string;
  /** Shopper frontmatter. */
  name?: string;
}

export type WriteDocResult =
  | { ok: true; ref: string; kind: DocKind; mode: WriteMode; path: string }
  | InvalidRequest
  | NotFound
  | Unreadable
  | PersistenceFailed;

export function writeDocument(spec: WriteSpec): WriteDocResult {
  const target = resolveRef(spec.ref);
  if ("ok" in target) return target;
  if (spec.mode !== "create" && spec.mode !== "replace") {
    return invalid("mode", "mode must be create (mint a new document) or replace (rewrite an existing one).");
  }
  const mode: WriteMode = spec.mode;
  if (!nonBlank(spec.body)) {
    return invalid("body", "body is required — it is the WHOLE reconciled markdown, never a fragment.");
  }
  if (nonBlank(spec.status) && !(BRIEF_STATUSES as readonly string[]).includes(spec.status)) {
    return invalid("status", "status must be one of " + BRIEF_STATUSES.join(" | ") + ".");
  }

  const preflight = preflightMode(target, mode);
  if (!preflight.ok) return preflight;

  const built = target.kind === "shopper"
    ? shopperFields(spec, preflight.existing)
    : briefFields(spec, preflight.existing, target.slug);
  if (!built.ok) return built;

  try {
    ensureDataDir();
    atomicWrite(target.path, serializeArtefact(built.fields, spec.body));
  } catch (err) {
    return persistenceFailed(target.path, err);
  }
  return { ok: true, ref: target.ref, kind: target.kind, mode, path: target.path };
}

/** The mode gate, and the only read of what is already on disk: create fails if the
 * ref exists, replace fails if it does not — and replace over a corrupt document is
 * refused, because reconciling needs the words that are still in there. Both guarantees
 * need presence SETTLED, so an unsettled one abstains rather than guesses. */
function preflightMode(
  target: ResolvedRef,
  mode: WriteMode,
): { ok: true; existing: Artefact | null } | InvalidRequest | NotFound | Unreadable {
  const at = probe(target.path);
  if (at.state === "unknown") return storeUnreadable(target.path, presenceError(at.error));
  const present = at.state === "present";
  if (mode === "create") {
    if (!present) return { ok: true, existing: null };
    return invalid(
      "mode",
      "A document already exists at " + JSON.stringify(target.ref) + " — read it"
        + " (sil_doc_read), reconcile it in full, and write it back with mode: replace."
        + " create only mints, it never overwrites.",
    );
  }
  if (!present) {
    return notFound(
      "No document at " + JSON.stringify(target.ref) + " to replace — mint it with"
        + " mode: create first (replace rewrites an existing document, it never mints).",
    );
  }
  const existing = readArtefactFile(target.path);
  if (existing === null) return unreadable(target.path);
  return { ok: true, existing };
}

type BuiltFields = { ok: true; fields: Record<string, string> } | InvalidRequest;

/** The shopper's `name` — required at mint, carried forward on every replace so a
 * body rewrite can never anonymise the person. */
function shopperFields(spec: WriteSpec, existing: Artefact | null): BuiltFields {
  const name = nonBlank(spec.name) ? spec.name : existing?.fields["name"];
  if (!nonBlank(name)) {
    return invalid("name", "name is required when writing the shopper document.");
  }
  return { ok: true, fields: { name } };
}

function briefFields(spec: WriteSpec, existing: Artefact | null, slug: string): BuiltFields {
  const title = nonBlank(spec.title) ? spec.title : existing?.fields["title"];
  if (!nonBlank(title)) {
    return invalid("title", "title is required when writing a Brief.");
  }
  const status = nonBlank(spec.status) ? spec.status : (existing?.fields["status"] ?? "active");
  return { ok: true, fields: { slug, title, status, updated_at: new Date().toISOString() } };
}

// ===========================================================================
// sil_doc_remove — one document, never a cascade.
// ===========================================================================

export type RemoveDocResult =
  | { ok: true; ref: string; kind: DocKind; path: string }
  | InvalidRequest
  | NotFound
  | Unreadable
  | PersistenceFailed;

export function removeDocument(ref: unknown): RemoveDocResult {
  const target = resolveRef(ref);
  if ("ok" in target) return target;
  if (target.kind === "shopper") {
    // The person is not a document you delete: every Brief was compiled from these
    // facts, and nothing else on disk can reproduce them. Rewrite it with sil_doc_write.
    return invalid(
      "ref",
      "The shopper document is never removed — it is the person every Brief was"
        + " written from. Correct it with sil_doc_write (mode: replace) instead.",
    );
  }
  const at = probe(target.path);
  if (at.state === "unknown") return storeUnreadable(target.path, presenceError(at.error));
  if (at.state === "absent") {
    return notFound("No document at " + JSON.stringify(target.ref) + " to remove (already gone).");
  }
  try {
    rmSync(target.path, { force: true });
  } catch (err) {
    return persistenceFailed(target.path, err);
  }
  return { ok: true, ref: target.ref, kind: target.kind, path: target.path };
}

// ===========================================================================
// readShopperIdentity — the singleton pre-flight ("does a shopper exist?"), used by
// the create-shopper bin and sil_doctor. Empty-is-healthy; a malformed user_spec is
// `unreadable` (inconclusive), never a fabricated "no shopper".
// ===========================================================================

export interface ShopperIdentity {
  ok: true;
  name?: string;
  unreadable: Array<{ id: string; error: string }>;
}

export function readShopperIdentity(): ShopperIdentity {
  const userSpecPath = join(getShopperArtefactDir(), USER_SPEC_FILE);
  const at = probe(userSpecPath);
  // Inconclusive, not empty — the create-shopper bin reads an empty answer as "no
  // shopper yet" and would mint a second person over the one it could not see.
  if (at.state === "unknown") {
    return { ok: true, unreadable: [{ id: USER_SPEC_FILE, error: presenceError(at.error) }] };
  }
  if (at.state === "absent") return { ok: true, unreadable: [] };
  const parsed = readArtefactFile(userSpecPath);
  if (parsed === null) {
    return {
      ok: true,
      unreadable: [{ id: USER_SPEC_FILE, error: "user_spec.md has malformed or absent frontmatter" }],
    };
  }
  const name = parsed.fields["name"];
  if (!nonBlank(name)) {
    return {
      ok: true,
      unreadable: [{ id: USER_SPEC_FILE, error: "user_spec.md frontmatter carries no name" }],
    };
  }
  return { ok: true, name, unreadable: [] };
}

// ===========================================================================
// The one-hop migration off `domains/<slug>/{method.md, prds/*.md}` (§4.8). Probe,
// transform, verify — then delete the source. ONE hop off ONE baseline, so there is
// no registry, no version marker and no ordering: the absence of the legacy tree IS
// the completion marker. Asset bytes are never deleted.
// ===========================================================================

export interface MigrationSummary {
  shoppingSections: number;
  briefs: number;
  failed: Array<{ path: string; error: string }>;
}

interface LegacyMethod {
  slug: string;
  path: string;
  body: string;
}

interface LegacyPrd {
  domainSlug: string;
  key: string;
  path: string;
  fields: Record<string, string>;
  body: string;
}

interface LegacyScan {
  root: string;
  methods: LegacyMethod[];
  prds: LegacyPrd[];
  /** What the scan could not read — a file that will not parse, a directory that will
   * not list. Never guessed at, never deleted; reported with its cause instead. */
  corrupt: Array<{ path: string; error: string }>;
}

/** Walk the legacy tree read-only. Empty on every store already in the flat layout,
 * at the cost of one `existsSync`. */
function scanLegacyTree(): LegacyScan {
  const root = join(getShopperArtefactDir(), LEGACY_DOMAINS_SUBDIR);
  const scan: LegacyScan = { root, methods: [], prds: [], corrupt: [] };
  if (!existsSync(root)) return scan;
  const domains = legacyDirs(root);
  if (domains.error !== null) {
    scan.corrupt.push({ path: root, error: listingError(domains.error) });
    return scan;
  }
  for (const slug of domains.names) scanLegacyDomain(root, slug, scan);
  return scan;
}

function scanLegacyDomain(root: string, slug: string, scan: LegacyScan): void {
  const methodPath = join(root, slug, LEGACY_METHOD_FILE);
  const method = readArtefactFile(methodPath);
  if (method !== null) scan.methods.push({ slug, path: methodPath, body: method.body });
  else if (existsSync(methodPath)) scan.corrupt.push({ path: methodPath, error: LEGACY_UNREADABLE_ERROR });

  const prdsDir = join(root, slug, LEGACY_PRDS_SUBDIR);
  if (!existsSync(prdsDir)) return;
  const listing = listDir(prdsDir);
  if (listing.error !== null) {
    scan.corrupt.push({ path: prdsDir, error: listingError(listing.error) });
    return;
  }
  for (const file of markdownNames(listing.entries)) {
    const path = join(prdsDir, file);
    const prd = readArtefactFile(path);
    if (prd === null) {
      scan.corrupt.push({ path, error: LEGACY_UNREADABLE_ERROR });
      continue;
    }
    scan.prds.push({ domainSlug: slug, key: file.replace(/\.md$/, ""), path, fields: prd.fields, body: prd.body });
  }
}

const LEGACY_UNREADABLE_ERROR =
  "a pre-0.5 file with malformed or absent frontmatter — the migration left it in place"
  + " for repair rather than guess at it";

/** Migrate a legacy store in one hop, or return `null` when there is nothing to do. */
export function migrateLegacyStore(): MigrationSummary | null {
  const { root, methods, prds, corrupt } = scanLegacyTree();
  if (methods.length === 0 && prds.length === 0 && corrupt.length === 0) return null;

  const failed = [...corrupt];
  const shoppingSections = migrateMethods(methods, failed);
  const briefs = migratePrds(prds, failed);
  pruneLegacyTree(root);
  return { shoppingSections, briefs, failed };
}

function legacyDirs(root: string): { names: string[]; error: string | null } {
  const { entries, error } = listDir(root);
  return { names: entries.filter((d) => d.isDirectory()).map((d) => d.name).sort(), error };
}

/** Each `method.md` becomes a `## Shopping` `### <slug>` section on the shopper
 * document — the taste it held; the guide and vocabulary are the registry's now. */
function migrateMethods(methods: LegacyMethod[], failed: Array<{ path: string; error: string }>): number {
  if (methods.length === 0) return 0;
  const path = join(getShopperArtefactDir(), USER_SPEC_FILE);
  const existing = readArtefactFile(path);
  if (existing === null) {
    // No shopper to hang the sections on. Fabricating one would invent a person, so
    // the methods stay on disk, reported, for a human.
    for (const m of methods) failed.push({ path: m.path, error: "no readable user_spec.md to migrate into" });
    return 0;
  }
  let body = existing.body;
  for (const m of methods) {
    // Skipped only when an interrupted earlier run already carried this one over —
    // same predicate as the drop gate, so appending and deleting cannot disagree.
    if (!carriesMethod(body, m)) body = appendShoppingSection(body, shoppingSection(m));
  }
  try {
    atomicWrite(path, serializeArtefact(existing.fields, body));
  } catch (err) {
    failed.push({ path, error: errCause(err) });
    return 0;
  }
  const verified = readArtefactFile(path);
  if (verified === null) {
    failed.push({ path, error: "the migrated user_spec.md did not read back" });
    return 0;
  }
  let landed = 0;
  for (const m of methods) {
    if (!carriesMethod(verified.body, m)) {
      failed.push({
        path: m.path,
        error: "its taste did not land under `### " + m.slug + "` in `## Shopping` —"
          + " left in place rather than deleted unverified",
      });
      continue;
    }
    dropLegacyFile(m.path, failed);
    landed += 1;
  }
  return landed;
}

/** One method in its migrated form: headings demoted two levels, because a `## ` inside
 * the body would otherwise close the `## Shopping` scope the section now sits in. */
function shoppingSection(m: LegacyMethod): string {
  const demoted = m.body
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/^#{1,6}(?=\s)/gm, (h) => "#".repeat(Math.min(6, h.length + 2)));
  return "### " + m.slug + "\n" + demoted;
}

/** Has THIS method's text landed under its own heading inside `## Shopping`? The unit of
 * a migration is the SECTION, not the file — a `user_spec.md` that merely re-parses
 * proves nothing, and a source deleted unverified is unrecoverable. Structural: a legacy
 * directory name is compared, never compiled into a pattern. */
function carriesMethod(body: string, m: LegacyMethod): boolean {
  return sectionBody(body, "## Shopping").includes(shoppingSection(m));
}

/** Insert a section at the END of `## Shopping`, minting the section when absent. */
function appendShoppingSection(body: string, section: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "## Shopping");
  if (start < 0) {
    return body.replace(/\n*$/, "\n\n") + "## Shopping\n\n" + section + "\n";
  }
  const after = lines.slice(start + 1).findIndex((l) => /^##\s/.test(l));
  const at = after < 0 ? lines.length : start + 1 + after;
  return [...lines.slice(0, at), section + "\n", ...lines.slice(at)].join("\n");
}

/** Each PRD becomes a one-row-`## Items` Brief. The legacy domain slug is a LOCAL
 * coinage, not a registry path, so the domain cell is left empty — unclassified is a
 * legal state and beat 2 resolves it against the real registry. */
function migratePrds(prds: LegacyPrd[], failed: Array<{ path: string; error: string }>): number {
  let count = 0;
  for (const prd of prds) {
    const slug = freeBriefSlug(prd.domainSlug + "-" + prd.key);
    if (slug === null) {
      failed.push({ path: prd.path, error: "no free brief slug for " + prd.domainSlug + "/" + prd.key });
      continue;
    }
    const item = prd.fields["product"] ?? prd.key;
    const title = prd.fields["title"] ?? prd.key;
    const fields: Record<string, string> = {
      slug,
      title,
      status: "active",
      updated_at: prd.fields["updated_at"] ?? new Date().toISOString(),
    };
    const body = "## Items\n"
      + "| item | domain | status |\n|---|---|---|\n"
      + "| " + item + " |  | open |\n\n"
      + "### " + item + "\n" + prd.body.trim() + "\n";
    const path = briefPath(slug);
    try {
      atomicWrite(path, serializeArtefact(fields, body));
    } catch (err) {
      failed.push({ path, error: errCause(err) });
      continue;
    }
    if (readArtefactFile(path) === null) {
      failed.push({ path, error: "the migrated Brief did not read back" });
      continue;
    }
    dropLegacyFile(prd.path, failed);
    count += 1;
  }
  return count;
}

/** Suffixes tried before giving up: past this the store is pathological, and renaming
 * on to `-51` serves nobody — the PRD is reported and left where the buyer can see it. */
const MAX_BRIEF_SLUG_ATTEMPTS = 50;

/** Flat briefs, so two domains' PRDs can collide on one slug; the suffix keeps both. */
function freeBriefSlug(base: string): string | null {
  const root = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (root === "" || root === "main") return null;
  for (let n = 1; n <= MAX_BRIEF_SLUG_ATTEMPTS; n += 1) {
    const slug = n === 1 ? root : root + "-" + n;
    if (!existsSync(briefPath(slug))) return slug;
  }
  return null;
}

function dropLegacyFile(path: string, failed: Array<{ path: string; error: string }>): void {
  try {
    rmSync(path, { force: true });
  } catch (err) {
    failed.push({ path, error: errCause(err) });
  }
}

/** Remove only what is EMPTY. `assets/` bytes have no home in the flat store and are
 * irreplaceable, so a domain that still holds them keeps its directory. A root that
 * will not list prunes nothing — the scan already reported it, and the surviving tree
 * makes the next call re-run the hop rather than swallow the failure. */
function pruneLegacyTree(legacyRoot: string): void {
  for (const slug of legacyDirs(legacyRoot).names) {
    rmdirIfEmpty(join(legacyRoot, slug, LEGACY_PRDS_SUBDIR));
    rmdirIfEmpty(join(legacyRoot, slug));
  }
  rmdirIfEmpty(legacyRoot);
}

function rmdirIfEmpty(dir: string): void {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // A non-empty or unremovable directory is left exactly as it is.
  }
}
