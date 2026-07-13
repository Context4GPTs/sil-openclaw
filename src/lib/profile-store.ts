/**
 * sil shopper behaviour-artefact store — frontmatter-as-truth, no manifest.
 *
 * There is ONE persistent shopper (a SINGLETON). Its artefacts live under a fixed,
 * compile-time-constant sub-tree of the plugin's disclosed `filesystemScope`
 * (`$SIL_DATA_DIR`, the same home `lib/credentials.ts` uses for tokens/identity):
 *
 *   $SIL_DATA_DIR/shopper/
 *     ├─ user_spec.md            the person — FRONTMATTER carries the shopper `name`;
 *     │                          its presence IS "a shopper exists". Written by setup.
 *     └─ domains/<slug>/
 *          ├─ method.md          frontmatter { domain, name, updated_at } + body
 *          ├─ prds/
 *          │    └─ <product>-<intent>.md   frontmatter { key, product, intent, title,
 *          │                               domain, created_at, updated_at } + body
 *          └─ assets/
 *               └─ <content-hash>.<ext>    image bytes, owner-only, linked by path
 *
 * There is NO `profile.json` manifest: the **frontmatter IS the source of truth**,
 * discovered by scanning the filesystem, so there is no second index layer to keep
 * in sync. Crash-safety is free from atomic rename (tmp → rename → chmod 0600, dir
 * 0700): a file is whole or absent. A file with malformed/absent frontmatter is
 * SKIPPED and surfaced as `unreadable` (fail-closed read), never half-read and never
 * silently dropped. `slug` and `prdKey` are the only caller-supplied path segments;
 * both carry the lower-kebab / non-`main` guard BEFORE any join. The persona is NOT a
 * sil artefact — it is the host workspace SOUL.md, written by the host CLI.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

import { DIR_MODE, ensureDataDir, getDataDir } from "./credentials.js";

/** Owner-only file mode — artefacts are user-scoped, like tokens. The dir mode
 * (`DIR_MODE`, `0o700`) is owned by `credentials.ts` and imported, so the data-home
 * permission lives in exactly one place. */
const FILE_MODE = 0o600;

/** Fixed, compile-time-constant sub-tree under `$SIL_DATA_DIR` that holds the ONE
 * shopper's behaviour artefacts. A SINGLETON, so this is a constant — NOT caller
 * input — which makes the shopper path segment un-spoofable. */
const SHOPPER_SUBDIR = "shopper";
const DOMAINS_SUBDIR = "domains";
const PRDS_SUBDIR = "prds";
const ASSETS_SUBDIR = "assets";

const USER_SPEC_FILE = "user_spec.md";
const METHOD_FILE = "method.md";

/** A domain slug / PRD key must be lower-kebab and never `main` (host-reserved). Both
 * are joined as filesystem path segments, so they carry this guard before any join. */
const SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;

/** The stable marker the shop loop's reject-at-pick rule greps for an inviolable
 * constraint (e.g. `- [hard] never leather`). */
const HARD_MARKER = "[hard]";

/** attach-asset limits: ~8 MB decoded, image MIME allowlist → file extension. */
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MIME_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// ===========================================================================
// Shared result variants — the store never throws across the tool boundary.
// ===========================================================================

export interface InvalidRequest {
  ok: false;
  kind: "invalid_request";
  /** The offending field (dotted for nested), or a discriminant like
   * `ambiguous_match`. */
  field: string;
  message: string;
}

interface NotFound {
  ok: false;
  kind: "not_found";
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

function invalid(field: string, message: string): InvalidRequest {
  return { ok: false, kind: "invalid_request", field, message };
}

function notFound(message: string): NotFound {
  return { ok: false, kind: "not_found", message };
}

function persistenceFailed(path: string, err: unknown): PersistenceFailed {
  return {
    ok: false,
    kind: "persistence_failed",
    error: path + ": " + errCause(err),
    message:
      "The shopper behaviour artefacts could NOT be written to the sil data directory,"
      + " so the change did not stick. Fix the data directory (it must be writable —"
      + " check permissions / free space / that $SIL_DATA_DIR is a directory), then"
      + " try again.",
    recovery: "fix_data_dir",
  };
}

function nonBlank(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function errCause(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Validate a caller-supplied path segment the SAME way at every call site: present +
 * non-blank, never `main`, lower-kebab — applied BEFORE any join/read/delete so a
 * traversal, an absolute path, a bare dot, or `main` never becomes a path segment. */
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

// ===========================================================================
// Path resolvers — the shopper segment is a constant; only slug/prd are input.
// ===========================================================================

/** The SINGLETON shopper artefact directory under the plugin's data dir. Never
 * hardcoded — `getDataDir()` honors `$SIL_DATA_DIR`/`$XDG_DATA_HOME`. The shopper
 * segment is the constant `SHOPPER_SUBDIR`, so there is no traversal vector here. */
export function getShopperArtefactDir(): string {
  return join(getDataDir(), SHOPPER_SUBDIR);
}

/** A per-domain directory under the singleton shopper dir. SAFETY: `slug` is a
 * caller-supplied path segment — every caller MUST `rejectBadSegment` it BEFORE this
 * join. */
export function getDomainArtefactDir(slug: string): string {
  return join(getShopperArtefactDir(), DOMAINS_SUBDIR, slug);
}

// ===========================================================================
// Frontmatter serialize / parse — coordinates are single-line scalars; the body is
// opaque prose. `parseArtefact` returns null on a malformed/absent-frontmatter file
// so a corrupt leaf reads `unreadable`, never half-read.
// ===========================================================================

interface Artefact {
  fields: Record<string, string>;
  body: string;
}

/** One-line scalar for a coordinate value: newlines folded to spaces, trimmed. */
function scalar(value: string): string {
  return String(value).replace(/\r?\n/g, " ").trim();
}

function serializeArtefact(fields: Record<string, string>, body: string): string {
  const fm = Object.entries(fields)
    .map(([k, v]) => k + ": " + scalar(v))
    .join("\n");
  const b = body.endsWith("\n") ? body : body + "\n";
  return "---\n" + fm + "\n---\n" + b;
}

/** Parse `--- key: value … ---` frontmatter + body. Returns null (⇒ `unreadable`) on
 * a missing open fence, a missing close fence, or an empty frontmatter block — a
 * fail-closed read, never a silent coercion. */
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

/** Read + parse one artefact file, or null if absent/unreadable/malformed. */
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
 * reader sees the old file or the new one, never a half-written one (mirrors
 * `credentials.ts`). Ensures the containing dir (0700) first. */
function atomicWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, contents, { mode: FILE_MODE });
  renameSync(tmp, path);
  chmodSync(path, FILE_MODE);
}

/** Write binary bytes atomically, owner-only. */
function atomicWriteBytes(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, bytes, { mode: FILE_MODE });
  renameSync(tmp, path);
  chmodSync(path, FILE_MODE);
}

// ===========================================================================
// materializeProfile — SETUP-ONLY. Write user_spec.md (frontmatter name); no
// manifest, no domains. Re-run overwrites the shared user spec atomically.
// ===========================================================================

export interface ProfileSpec {
  name: string;
  userSpec: string;
}

export type MaterializeResult =
  | { ok: true; dir: string; userSpecPath: string }
  | InvalidRequest
  | PersistenceFailed;

/**
 * Materialize the ONE shopper — write `user_spec.md` whose FRONTMATTER carries the
 * shopper `name` and whose body is the shared user spec. SETUP-ONLY: it mints no
 * method/PRD (that is `sil_learn create`) and writes no manifest. Validate-first: a
 * blank `name`/`userSpec` returns `invalid_request` and writes nothing.
 */
export function materializeProfile(spec: ProfileSpec): MaterializeResult {
  if (!nonBlank(spec.name)) return invalid("name", "name is required and must be non-empty.");
  if (!nonBlank(spec.userSpec)) {
    return invalid("userSpec", "userSpec is required and must be non-empty.");
  }
  const dir = getShopperArtefactDir();
  const userSpecPath = join(dir, USER_SPEC_FILE);
  try {
    ensureDataDir();
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    atomicWrite(userSpecPath, serializeArtefact({ name: spec.name }, spec.userSpec));
  } catch (err) {
    return persistenceFailed(dir, err);
  }
  return { ok: true, dir, userSpecPath };
}

// ===========================================================================
// readShopperIdentity — the singleton pre-flight ("does a shopper exist?"). Used by
// the create-shopper operator bin. Empty-is-healthy; a malformed user_spec surfaces
// as `unreadable` (inconclusive), never a fabricated "no shopper".
// ===========================================================================

export interface ShopperIdentity {
  ok: true;
  /** Present iff a shopper exists (user_spec.md present + frontmatter `name` reads). */
  name?: string;
  /** Degraded artefacts surfaced inline — `[]` when healthy. */
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
// sil_learn — the single target+change verb. `create` mints a whole method/PRD;
// `append`/`amend`/`retract` refine in place; `attach-asset` persists image bytes.
// ===========================================================================

export type LearnKind = "create" | "append" | "amend" | "retract" | "attach-asset";
export type LearnTarget = "user_spec" | "method" | "prd";

export interface LearnSpec {
  target: LearnTarget;
  kind: LearnKind;
  domain?: string;
  prd?: string;
  /** create: whole-body mint (+ coordinates for a new prd). */
  name?: string;
  body?: string;
  product?: string;
  intent?: string;
  title?: string;
  /** append/amend/retract change fields. */
  text?: string;
  from?: string;
  to?: string;
  section?: string;
  hard?: boolean;
  /** attach-asset. */
  bytes?: string;
  mime?: string;
  caption?: string;
}

export type LearnResult =
  | {
      ok: true;
      kind: LearnKind;
      target: LearnTarget;
      domain?: string;
      prd?: string;
      path: string;
      /** attach-asset only — the relative asset path linked into the target. */
      assetPath?: string;
    }
  | InvalidRequest
  | NotFound
  | PersistenceFailed;

/** A resolved target artefact + its human label. */
interface ResolvedTarget {
  path: string;
  label: LearnTarget;
  domain?: string;
  prd?: string;
}

/** Resolve the target artefact file, guarding the selectors first. Returns an
 * `InvalidRequest` when a required selector is missing/bad. */
function resolveTarget(spec: LearnSpec): ResolvedTarget | InvalidRequest {
  if (spec.target === "user_spec") {
    return { path: join(getShopperArtefactDir(), USER_SPEC_FILE), label: "user_spec" };
  }
  const badDomain = rejectBadSegment(spec.domain, "domain");
  if (badDomain) return badDomain;
  const slug = spec.domain as string;
  if (spec.target === "method") {
    return { path: join(getDomainArtefactDir(slug), METHOD_FILE), label: "method", domain: slug };
  }
  // prd
  const badPrd = rejectBadSegment(spec.prd, "prd");
  if (badPrd) return badPrd;
  const prd = spec.prd as string;
  return {
    path: join(getDomainArtefactDir(slug), PRDS_SUBDIR, prd + ".md"),
    label: "prd",
    domain: slug,
    prd,
  };
}

export function learnArtefact(spec: LearnSpec): LearnResult {
  switch (spec.kind) {
    case "create":
      return learnCreate(spec);
    case "append":
      return learnAppend(spec);
    case "amend":
    case "retract":
      return learnAmendRetract(spec);
    case "attach-asset":
      return learnAttachAsset(spec);
    default:
      return invalid("kind", "kind must be one of create|append|amend|retract|attach-asset.");
  }
}

/** `create` mints a whole method or PRD body atomically — the file IS the
 * registration (no manifest). NOT valid for user_spec (that is materialize). */
function learnCreate(spec: LearnSpec): LearnResult {
  if (spec.target === "user_spec") {
    return invalid(
      "target",
      "create is not valid for user_spec — the shopper's shared spec is written by"
        + " sil_profile_materialize (setup), then refined with append/amend/retract.",
    );
  }
  if (!nonBlank(spec.body)) return invalid("body", "body is required and must be non-empty.");

  const badDomain = rejectBadSegment(spec.domain, "domain");
  if (badDomain) return badDomain;
  const slug = spec.domain as string;
  const now = new Date().toISOString();

  if (spec.target === "method") {
    if (!nonBlank(spec.name)) return invalid("name", "name is required for a method.");
    const path = join(getDomainArtefactDir(slug), METHOD_FILE);
    const fields = { domain: slug, name: spec.name as string, updated_at: now };
    try {
      atomicWrite(path, serializeArtefact(fields, spec.body as string));
    } catch (err) {
      return persistenceFailed(path, err);
    }
    return { ok: true, kind: "create", target: "method", domain: slug, path };
  }

  // prd
  const badPrd = rejectBadSegment(spec.prd, "prd");
  if (badPrd) return badPrd;
  const prd = spec.prd as string;
  for (const f of ["product", "intent", "title"] as const) {
    if (!nonBlank(spec[f])) return invalid(f, f + " is required for a prd.");
  }
  const path = join(getDomainArtefactDir(slug), PRDS_SUBDIR, prd + ".md");
  // Preserve created_at on a re-mint; advance updated_at.
  const prior = readArtefactFile(path);
  const createdAt = prior?.fields["created_at"] ?? now;
  const fields = {
    key: prd,
    product: spec.product as string,
    intent: spec.intent as string,
    title: spec.title as string,
    domain: slug,
    created_at: createdAt,
    updated_at: now,
  };
  try {
    atomicWrite(path, serializeArtefact(fields, spec.body as string));
  } catch (err) {
    return persistenceFailed(path, err);
  }
  return { ok: true, kind: "create", target: "prd", domain: slug, prd, path };
}

/** `hard` is valid only on append to user_spec / prd — a method carries no hard
 * constraints (they are the person's, or the job's). */
function rejectHardMisuse(spec: LearnSpec): InvalidRequest | null {
  if (spec.hard === true && spec.target === "method") {
    return invalid(
      "hard",
      "hard is valid only on append to user_spec or prd — a method carries no hard"
        + " constraints (they belong to the person or the job).",
    );
  }
  return null;
}

/** append — add `- <text>` (or `- [hard] <text>`) under `## <section>` when given
 * (fail-closed if that heading is absent), else at EOF. The target must already
 * exist → not_found (never resurrects a seed-less doc). */
function learnAppend(spec: LearnSpec): LearnResult {
  const badHard = rejectHardMisuse(spec);
  if (badHard) return badHard;
  if (!nonBlank(spec.text)) return invalid("text", "text is required and must be non-empty.");

  const target = resolveTarget(spec);
  if ("ok" in target) return target;
  const existing = readArtefactFile(target.path);
  if (existing === null) {
    return notFound(
      "The target " + target.label + " does not exist — create it first (append never"
        + " resurrects a seed-less doc).",
    );
  }

  const mark = spec.hard === true ? HARD_MARKER + " " : "";
  const bullet = "- " + mark + (spec.text as string).trim();

  let body: string;
  if (nonBlank(spec.section)) {
    const inserted = insertUnderSection(existing.body, spec.section as string, bullet);
    if (inserted === null) {
      const sections = listSections(existing.body);
      return invalid(
        "section",
        'no "## ' + spec.section + '" heading in the ' + target.label + "; existing sections: "
          + (sections.length > 0 ? sections.join(", ") : "(none)"),
      );
    }
    body = inserted;
  } else {
    body = existing.body.replace(/\n*$/, "\n") + bullet + "\n";
  }

  return writeArtefactBody(target, existing.fields, body, "append");
}

/** amend/retract — exact single-occurrence bullet match on `from`; 0 → not_found,
 * 2+ → invalid_request(ambiguous_match). A `[hard]` marker is preserved on amend. */
function learnAmendRetract(spec: LearnSpec): LearnResult {
  if (!nonBlank(spec.from)) return invalid("from", "from is required and must be non-empty.");
  if (spec.kind === "amend" && !nonBlank(spec.to)) {
    return invalid("to", "to is required for amend.");
  }

  const target = resolveTarget(spec);
  if ("ok" in target) return target;
  const existing = readArtefactFile(target.path);
  if (existing === null) {
    return notFound("The target " + target.label + " does not exist — nothing to change.");
  }

  const from = (spec.from as string).trim();
  const lines = existing.body.split("\n");
  const matches: number[] = [];
  const scoped = nonBlank(spec.section)
    ? sectionLineRange(lines, spec.section as string)
    : { start: 0, end: lines.length };
  for (let i = scoped.start; i < scoped.end; i++) {
    const parsed = parseBullet(lines[i] as string);
    if (parsed && parsed.text.trim() === from) matches.push(i);
  }
  if (matches.length === 0) {
    return notFound('No bullet matching "' + from + '" in the ' + target.label + ".");
  }
  if (matches.length > 1) {
    return invalid(
      "ambiguous_match",
      "the text matches " + matches.length + " bullets — refine `from` (or scope with"
        + " `section`) so it matches exactly one; refusing an ambiguous multi-write.",
    );
  }

  const idx = matches[0] as number;
  if (spec.kind === "retract") {
    lines.splice(idx, 1);
  } else {
    const parsed = parseBullet(lines[idx] as string)!;
    const mark = parsed.hard ? HARD_MARKER + " " : "";
    lines[idx] = parsed.indent + "- " + mark + (spec.to as string).trim();
  }
  return writeArtefactBody(target, existing.fields, lines.join("\n"), spec.kind);
}

/** attach-asset — persist image bytes into `domains/<slug>/assets/<hash>.<ext>`
 * (owner-only, content-hash = free dedup), then link them into the target by a
 * RELATIVE markdown path. Per-domain only (user_spec is rejected). */
function learnAttachAsset(spec: LearnSpec): LearnResult {
  if (spec.target === "user_spec") {
    return invalid("target", "assets are per-domain — attach to a method or prd, not user_spec.");
  }
  if (!nonBlank(spec.bytes)) return invalid("bytes", "bytes (base64) is required.");
  const ext = MIME_EXT[spec.mime ?? ""];
  if (ext === undefined) {
    return invalid("mime", "mime must be one of image/jpeg, image/png, image/webp, image/gif.");
  }
  const buf = Buffer.from(spec.bytes as string, "base64");
  if (buf.length === 0) return invalid("bytes", "bytes did not decode to a non-empty image.");
  if (buf.length > MAX_ASSET_BYTES) {
    return invalid("bytes", "image exceeds the " + MAX_ASSET_BYTES + "-byte cap.");
  }

  const target = resolveTarget(spec);
  if ("ok" in target) return target;
  const existing = readArtefactFile(target.path);
  if (existing === null) {
    return notFound(
      "The target " + target.label + " does not exist — create it before attaching an asset.",
    );
  }

  const slug = target.domain as string;
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const filename = hash + "." + ext;
  const assetRel = ASSETS_SUBDIR + "/" + filename;
  const assetAbs = join(getDomainArtefactDir(slug), ASSETS_SUBDIR, filename);

  // Bytes FIRST (content-hashed → a mid-failure leaves only a benign, dedup-safe
  // orphan), then the path-link into the target.
  try {
    atomicWriteBytes(assetAbs, buf);
  } catch (err) {
    return persistenceFailed(assetAbs, err);
  }
  const caption = nonBlank(spec.caption) ? (spec.caption as string).trim() : "";
  const link = "![" + caption + "](" + assetRel + ")";
  const body = existing.body.replace(/\n*$/, "\n") + link + "\n";
  const res = writeArtefactBody(target, existing.fields, body, "attach-asset");
  if (!res.ok) return res;
  return { ...res, assetPath: assetRel };
}

/** Re-serialize a method/PRD with a bumped `updated_at`; user_spec carries no
 * timestamp. Atomic. */
function writeArtefactBody(
  target: ResolvedTarget,
  fields: Record<string, string>,
  body: string,
  kind: LearnKind,
): LearnResult {
  const nextFields = { ...fields };
  if (target.label !== "user_spec") nextFields["updated_at"] = new Date().toISOString();
  try {
    atomicWrite(target.path, serializeArtefact(nextFields, body));
  } catch (err) {
    return persistenceFailed(target.path, err);
  }
  return {
    ok: true,
    kind,
    target: target.label,
    ...(target.domain !== undefined ? { domain: target.domain } : {}),
    ...(target.prd !== undefined ? { prd: target.prd } : {}),
    path: target.path,
  };
}

// --- section/bullet helpers -------------------------------------------------

interface Bullet {
  indent: string;
  hard: boolean;
  text: string;
}

/** Parse a markdown bullet line (`- text` / `- [hard] text`), or null. */
function parseBullet(line: string): Bullet | null {
  const m = /^(\s*)-\s+(\[hard\]\s+)?(.*)$/.exec(line);
  if (!m) return null;
  return { indent: m[1] as string, hard: m[2] !== undefined, text: m[3] as string };
}

/** All `## <section>` heading texts present in a body (for a fail-closed message). */
function listSections(body: string): string[] {
  return body
    .split("\n")
    .map((l) => /^##\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => (m[1] as string).trim());
}

/** The [start,end) line range of a `## <section>` body (heading exclusive, up to the
 * next `## ` heading or EOF). `start === -1` when the heading is absent. */
function sectionLineRange(lines: string[], section: string): { start: number; end: number } {
  const target = section.trim();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.*)$/.exec(lines[i] as string);
    if (m && (m[1] as string).trim() === target) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return { start: 0, end: 0 };
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] as string)) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Insert `bullet` at the end of `## <section>` (before the next heading, after the
 * section's last non-blank line), or null when the heading is absent. */
function insertUnderSection(body: string, section: string, bullet: string): string | null {
  if (!listSections(body).includes(section.trim())) return null;
  const lines = body.split("\n");
  const range = sectionLineRange(lines, section);
  let at = range.end;
  while (at > range.start && (lines[at - 1] as string).trim() === "") at--;
  lines.splice(at, 0, bullet);
  return lines.join("\n");
}

// ===========================================================================
// sil_profile_search — the frontmatter-as-truth discovery primitive. Returns
// COORDINATES only (no bodies). Malformed frontmatter is SKIPPED + surfaced as
// `unreadable`, never a silent drop; healthy siblings survive.
// ===========================================================================

export interface SearchQuery {
  domain?: string;
  product?: string;
  intent?: string;
  query?: string;
}

export interface DomainCoord {
  slug: string;
  name: string;
}

export interface PrdCoord {
  domain: string;
  key: string;
  product: string;
  intent: string;
  title: string;
  path: string;
  updated_at: string;
}

export interface SearchResult {
  ok: true;
  domains: DomainCoord[];
  prds: PrdCoord[];
  unreadable: Array<{ id: string; error: string }>;
}

export function searchProfileFrontmatter(query: SearchQuery = {}): SearchResult {
  const domainsRoot = join(getShopperArtefactDir(), DOMAINS_SUBDIR);
  const domains: DomainCoord[] = [];
  const prds: PrdCoord[] = [];
  const unreadable: Array<{ id: string; error: string }> = [];

  let slugs: string[] = [];
  if (existsSync(domainsRoot)) {
    slugs = readdirSync(domainsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  }

  for (const slug of slugs) {
    const methodPath = join(domainsRoot, slug, METHOD_FILE);
    if (!existsSync(methodPath)) continue; // a dir with no method is not a domain yet
    const method = readArtefactFile(methodPath);
    if (method === null) {
      unreadable.push({ id: slug, error: "method.md has malformed or absent frontmatter" });
      continue;
    }
    domains.push({ slug, name: method.fields["name"] ?? slug });

    const prdsDir = join(domainsRoot, slug, PRDS_SUBDIR);
    if (!existsSync(prdsDir)) continue;
    const prdFiles = readdirSync(prdsDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    for (const file of prdFiles) {
      const prdPath = join(prdsDir, file);
      const prd = readArtefactFile(prdPath);
      if (prd === null) {
        unreadable.push({
          id: slug + "/" + PRDS_SUBDIR + "/" + file,
          error: "prd has malformed frontmatter",
        });
        continue;
      }
      prds.push({
        domain: slug,
        key: prd.fields["key"] ?? file.replace(/\.md$/, ""),
        product: prd.fields["product"] ?? "",
        intent: prd.fields["intent"] ?? "",
        title: prd.fields["title"] ?? "",
        path: prdPath,
        updated_at: prd.fields["updated_at"] ?? "",
      });
    }
  }

  const q = nonBlank(query.query) ? (query.query as string).toLowerCase() : undefined;
  const filteredDomains = domains.filter(
    (d) => (!nonBlank(query.domain) || d.slug === query.domain)
      && (q === undefined || (d.slug + " " + d.name).toLowerCase().includes(q)),
  );
  const filteredPrds = prds.filter(
    (p) => (!nonBlank(query.domain) || p.domain === query.domain)
      && (!nonBlank(query.product) || p.product === query.product)
      && (!nonBlank(query.intent) || p.intent === query.intent)
      && (q === undefined
        || (p.key + " " + p.product + " " + p.intent + " " + p.title).toLowerCase().includes(q)),
  );

  return { ok: true, domains: filteredDomains, prds: filteredPrds, unreadable };
}

// ===========================================================================
// sil_profile_get — the RICH read (one whole body). method vs PRD; fail-closed.
// ===========================================================================

export type ReadResult =
  | {
      ok: true;
      target: "method" | "prd";
      domain: string;
      prd?: string;
      fields: Record<string, string>;
      body: string;
      path: string;
    }
  | NotFound
  | InvalidRequest;

export function readArtefactBody(domainSlug: string, prd?: string): ReadResult {
  const badSlug = rejectBadSegment(domainSlug, "domainSlug");
  if (badSlug) return badSlug;

  if (nonBlank(prd)) {
    const badPrd = rejectBadSegment(prd, "prd");
    if (badPrd) return badPrd;
    const path = join(getDomainArtefactDir(domainSlug), PRDS_SUBDIR, prd + ".md");
    const parsed = readArtefactFile(path);
    if (parsed === null) {
      return notFound('No PRD "' + prd + '" in domain "' + domainSlug + '".');
    }
    return { ok: true, target: "prd", domain: domainSlug, prd, fields: parsed.fields, body: parsed.body, path };
  }

  const path = join(getDomainArtefactDir(domainSlug), METHOD_FILE);
  const parsed = readArtefactFile(path);
  if (parsed === null) {
    return notFound('No method for domain "' + domainSlug + '" — mint it with sil_learn create.');
  }
  return { ok: true, target: "method", domain: domainSlug, fields: parsed.fields, body: parsed.body, path };
}

// ===========================================================================
// sil_profile_remove — whole domain subtree, or one PRD. Fail-closed + escape guard.
// ===========================================================================

export type RemoveResult =
  | { ok: true; domainSlug: string; prd?: string }
  | NotFound
  | InvalidRequest
  | PersistenceFailed;

export function removeArtefact(domainSlug: string, prd?: string): RemoveResult {
  const badSlug = rejectBadSegment(domainSlug, "domainSlug");
  if (badSlug) return badSlug;

  const shopperDir = getShopperArtefactDir();
  const domainsRoot = join(shopperDir, DOMAINS_SUBDIR);
  const domainLeaf = getDomainArtefactDir(domainSlug);

  // Defence in depth beyond the slug gate: the leaf must be a STRICT child of the
  // domains root — never the root itself (deleting it wipes every sibling).
  if (dirname(domainLeaf) !== domainsRoot || domainLeaf === domainsRoot) {
    return invalid(
      "domainSlug",
      "domainSlug resolves outside the domains subtree — refusing to delete: " + JSON.stringify(domainSlug),
    );
  }

  if (nonBlank(prd)) {
    const badPrd = rejectBadSegment(prd, "prd");
    if (badPrd) return badPrd;
    const prdPath = join(domainLeaf, PRDS_SUBDIR, prd + ".md");
    if (!existsSync(prdPath)) {
      return notFound('No PRD "' + prd + '" in domain "' + domainSlug + '" to remove (already gone).');
    }
    try {
      rmSync(prdPath, { force: true });
    } catch (err) {
      return persistenceFailed(prdPath, err);
    }
    return { ok: true, domainSlug, prd };
  }

  if (!existsSync(domainLeaf)) {
    return notFound('No domain "' + domainSlug + '" on the shopper to remove (already gone). A re-run is safe.');
  }
  try {
    rmSync(domainLeaf, { recursive: true, force: true });
  } catch (err) {
    return persistenceFailed(domainLeaf, err);
  }
  return { ok: true, domainSlug };
}
