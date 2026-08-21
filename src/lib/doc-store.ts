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
  writeFileSync,
} from "node:fs";
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

/** PRESENT but unparseable. Never conflated with `not_found`: an agent that reads
 * "absent" over a corrupt document re-mints and the buyer's own words are gone. */
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

// ===========================================================================
// Refs — the only addressing scheme, and the only caller-supplied path segment.
// ===========================================================================

interface ResolvedRef {
  ref: string;
  kind: DocKind;
  slug?: string;
  path: string;
}

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

export function findDocuments(query: FindQuery = {}): FindResult | InvalidRequest {
  if (nonBlank(query.kind) && !(DOC_KINDS as readonly string[]).includes(query.kind)) {
    return invalid("kind", "kind must be one of " + DOC_KINDS.join(" | ") + ".");
  }
  if (nonBlank(query.status) && !(BRIEF_STATUSES as readonly string[]).includes(query.status)) {
    return invalid("status", "status must be one of " + BRIEF_STATUSES.join(" | ") + ".");
  }
  const q = nonBlank(query.query) ? query.query.toLowerCase() : undefined;
  // A legacy file the migration could not parse is surfaced here, unfiltered: only the
  // doc TOOLS migrate, so without this the one file the transform cannot fix is
  // invisible to the read-only surfaces that exist to report it (`sil_doctor`).
  const unreadableDocs: Array<{ id: string; error: string }> = scanLegacyTree().corrupt.map(
    (path) => ({ id: relative(getShopperArtefactDir(), path), error: LEGACY_UNREADABLE_ERROR }),
  );
  const result: FindResult = { ok: true, briefs: [], unreadable: unreadableDocs };

  // The shopper carries no domain and no status, so either filter excludes it rather
  // than matching it vacuously.
  const wantShopper =
    (!nonBlank(query.kind) || query.kind === "shopper")
    && !nonBlank(query.domain)
    && !nonBlank(query.status);
  if (wantShopper) {
    const path = join(getShopperArtefactDir(), USER_SPEC_FILE);
    if (existsSync(path)) {
      const parsed = readArtefactFile(path);
      if (parsed === null) {
        unreadableDocs.push({ id: "shopper", error: USER_SPEC_FILE + " has malformed or absent frontmatter" });
      } else {
        const name = parsed.fields["name"] ?? "";
        // A shopper document that cannot say who it is degraded, not healthy — the
        // same verdict `readShopperIdentity` reaches, reported once, here.
        if (!nonBlank(name)) {
          unreadableDocs.push({ id: "shopper", error: USER_SPEC_FILE + " frontmatter carries no name" });
        }
        if (q === undefined || ("shopper " + name).toLowerCase().includes(q)) {
          result.shopper = { ref: "shopper", name, path };
        }
      }
    }
  }

  if (nonBlank(query.kind) && query.kind !== "brief") return result;

  const briefsDir = join(getShopperArtefactDir(), BRIEFS_SUBDIR);
  if (!existsSync(briefsDir)) return result;
  for (const file of readdirSync(briefsDir).filter((f) => f.endsWith(".md")).sort()) {
    const path = join(briefsDir, file);
    const parsed = readArtefactFile(path);
    const slug = file.replace(/\.md$/, "");
    if (parsed === null) {
      unreadableDocs.push({ id: "brief:" + slug, error: "brief has malformed or absent frontmatter" });
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
    if (nonBlank(query.status) && coord.status !== query.status) continue;
    if (nonBlank(query.domain) && !coord.items.some((i) => domainMatches(i.domain, query.domain as string))) {
      continue;
    }
    if (q !== undefined && !(coord.slug + " " + coord.title).toLowerCase().includes(q)) continue;
    result.briefs.push(coord);
  }
  return result;
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
  if (!existsSync(target.path)) {
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

  const existing = existsSync(target.path) ? readArtefactFile(target.path) : null;
  if (mode === "create" && existsSync(target.path)) {
    return invalid(
      "mode",
      "A document already exists at " + JSON.stringify(target.ref) + " — read it"
        + " (sil_doc_read), reconcile it in full, and write it back with mode: replace."
        + " create only mints, it never overwrites.",
    );
  }
  if (mode === "replace") {
    if (!existsSync(target.path)) {
      return notFound(
        "No document at " + JSON.stringify(target.ref) + " to replace — mint it with"
          + " mode: create first (replace rewrites an existing document, it never mints).",
      );
    }
    if (existing === null) return unreadable(target.path);
  }

  const built = target.kind === "shopper"
    ? shopperFields(spec, existing)
    : briefFields(spec, existing, target.slug as string);
  if (!built.ok) return built;

  try {
    ensureDataDir();
    atomicWrite(target.path, serializeArtefact(built.fields, spec.body));
  } catch (err) {
    return persistenceFailed(target.path, err);
  }
  return { ok: true, ref: target.ref, kind: target.kind, mode, path: target.path };
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
  if (!existsSync(target.path)) {
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
  if (!existsSync(userSpecPath)) return { ok: true, unreadable: [] };
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
  /** Files that will not parse. Never guessed at, never deleted — reported instead. */
  corrupt: string[];
}

/** Walk the legacy tree read-only. Empty on every store already in the flat layout,
 * at the cost of one `existsSync`. */
function scanLegacyTree(): LegacyScan {
  const root = join(getShopperArtefactDir(), LEGACY_DOMAINS_SUBDIR);
  const scan: LegacyScan = { root, methods: [], prds: [], corrupt: [] };
  if (!existsSync(root)) return scan;
  for (const slug of legacyDirs(root)) {
    const methodPath = join(root, slug, LEGACY_METHOD_FILE);
    const method = readArtefactFile(methodPath);
    if (method !== null) scan.methods.push({ slug, path: methodPath, body: method.body });
    else if (existsSync(methodPath)) scan.corrupt.push(methodPath);
    const prdsDir = join(root, slug, LEGACY_PRDS_SUBDIR);
    if (!existsSync(prdsDir)) continue;
    for (const file of readdirSync(prdsDir).filter((f) => f.endsWith(".md")).sort()) {
      const path = join(prdsDir, file);
      const prd = readArtefactFile(path);
      if (prd === null) {
        scan.corrupt.push(path);
        continue;
      }
      scan.prds.push({ domainSlug: slug, key: file.replace(/\.md$/, ""), path, fields: prd.fields, body: prd.body });
    }
  }
  return scan;
}

const LEGACY_UNREADABLE_ERROR =
  "a pre-0.5 file with malformed or absent frontmatter — the migration left it in place"
  + " for repair rather than guess at it";

/** Migrate a legacy store in one hop, or return `null` when there is nothing to do. */
export function migrateLegacyStore(): MigrationSummary | null {
  const { root, methods, prds, corrupt } = scanLegacyTree();
  if (methods.length === 0 && prds.length === 0 && corrupt.length === 0) return null;

  const failed: Array<{ path: string; error: string }> = corrupt.map((path) => ({
    path,
    error: LEGACY_UNREADABLE_ERROR,
  }));
  const shoppingSections = migrateMethods(methods, failed);
  const briefs = migratePrds(prds, failed);
  pruneLegacyTree(root);
  return { shoppingSections, briefs, failed };
}

function legacyDirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
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
  const migrated: LegacyMethod[] = [];
  for (const m of methods) {
    if (new RegExp("^###\\s+" + m.slug + "\\s*$", "m").test(body)) {
      migrated.push(m); // already carried over by an interrupted earlier run
      continue;
    }
    body = appendShoppingSection(body, m.slug, m.body);
    migrated.push(m);
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
  for (const m of migrated) dropLegacyFile(m.path, failed);
  return migrated.length;
}

/** Insert `### <slug>` at the END of `## Shopping`, minting the section when absent. */
function appendShoppingSection(body: string, slug: string, methodBody: string): string {
  const block = "### " + slug + "\n" + methodBody.trim() + "\n";
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "## Shopping");
  if (start < 0) {
    return body.replace(/\n*$/, "\n\n") + "## Shopping\n\n" + block;
  }
  const after = lines.slice(start + 1).findIndex((l) => /^##\s/.test(l));
  const at = after < 0 ? lines.length : start + 1 + after;
  return [...lines.slice(0, at), block, ...lines.slice(at)].join("\n");
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

/** Flat briefs, so two domains' PRDs can collide on one slug; the suffix keeps both. */
function freeBriefSlug(base: string): string | null {
  const root = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (root === "" || root === "main") return null;
  for (let n = 1; n <= 50; n += 1) {
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
 * irreplaceable, so a domain that still holds them keeps its directory. */
function pruneLegacyTree(legacyRoot: string): void {
  for (const slug of legacyDirs(legacyRoot)) {
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
