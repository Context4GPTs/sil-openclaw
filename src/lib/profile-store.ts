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

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { DIR_MODE, ensureDataDir, getDataDir } from "./credentials.js";
import {
  atomicWrite,
  atomicWriteBytes,
  readArtefactFile,
  serializeArtefact,
} from "./artefact-io.js";
import { ensureStoreMigrated } from "./migrations/runner.js";
import type { MigrationFailed } from "./migrations/types.js";

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

/** A file that is PRESENT but parses to null (malformed/absent frontmatter) — the
 * rich read must NOT conflate this with an absent file (`not_found`), or a corrupt
 * but recoverable artefact gets silently re-minted over. Fail-closed, matching the
 * scan paths (`searchProfileFrontmatter`, `readShopperIdentity`). */
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
      path + ": the artefact is present but corrupt (malformed or absent frontmatter)"
        + " — inspect / repair, do NOT overwrite (it may still be recoverable).",
  };
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

/** Count the shopper's learned domains (dir entries under shopper/domains, 0 when absent).
 * The `sil_store_migrated` breadcrumb reports it on the rare on-load heal — not a hot path. */
export function countShopperDomains(): number {
  const domainsRoot = join(getShopperArtefactDir(), DOMAINS_SUBDIR);
  if (!existsSync(domainsRoot)) return 0;
  return readdirSync(domainsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
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
 *
 * NOT migration-gated. Unlike the four serve-path primitives, materialize is SETUP: it
 * writes a NEW shopper's user_spec, never serving stale legacy data. Gating it would
 * (a) stamp the store-format marker at plain setup and (b) hijack the create-shopper
 * bin's `persistence_failed` taxonomy on an unwritable data dir. The create-shopper bin
 * can never reach materialize on a LEGACY store anyway — its `readShopperIdentity`
 * pre-flight reads a frontmatter-less legacy user_spec as `unreadable` and aborts — so a
 * legacy store heals via the first serve-path tool touch, never through setup.
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
// sil_learn — the single target+change verb. `create` mints a NEW method/PRD;
// `write` replaces an existing doc's whole body (reconciled); `attach-asset`
// persists image bytes. The model reads current (sil_profile_get), reconciles in
// context, and writes the whole doc back — no surgical bullet ops, so a correction
// can never stack a contradicting line.
// ===========================================================================

export type LearnKind = "create" | "write" | "attach-asset";
export type LearnTarget = "user_spec" | "method" | "prd";

export interface LearnSpec {
  target: LearnTarget;
  kind: LearnKind;
  domain?: string;
  prd?: string;
  /** create: mint a new doc (+ coordinates for a new prd). write: the reconciled
   * whole body that replaces an existing doc. */
  name?: string;
  body?: string;
  product?: string;
  intent?: string;
  title?: string;
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
  | Unreadable
  | PersistenceFailed
  | MigrationFailed;

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
  const migrated = ensureStoreMigrated();
  if (!migrated.ok) return migrated;
  switch (spec.kind) {
    case "create":
      return learnCreate(spec);
    case "write":
      return learnWrite(spec);
    case "attach-asset":
      return learnAttachAsset(spec);
    default:
      return invalid("kind", "kind must be one of create|write|attach-asset.");
  }
}

/** `create` mints a NEW method or PRD body atomically — the file IS the registration
 * (no manifest). Refuses if one already exists at these coordinates (→ use `write` to
 * replace it), so a mint never silently clobbers. NOT valid for user_spec (that is
 * materialize; refine it with `write`). */
function learnCreate(spec: LearnSpec): LearnResult {
  if (spec.target === "user_spec") {
    return invalid(
      "target",
      "create is not valid for user_spec — the shopper's shared spec is written by"
        + " sil_profile_materialize (setup), then refined with kind:write.",
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
    if (existsSync(path)) {
      return invalid(
        "kind",
        'a method already exists for domain "' + slug + '" — use kind:write to replace its'
          + " body (create only mints a new one, it never overwrites).",
      );
    }
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
  if (existsSync(path)) {
    return invalid(
      "kind",
      'a PRD "' + prd + '" already exists in domain "' + slug + '" — use kind:write to'
        + " replace its body (create only mints a new one, it never overwrites).",
    );
  }
  const fields = {
    key: prd,
    product: spec.product as string,
    intent: spec.intent as string,
    title: spec.title as string,
    domain: slug,
    created_at: now,
    updated_at: now,
  };
  try {
    atomicWrite(path, serializeArtefact(fields, spec.body as string));
  } catch (err) {
    return persistenceFailed(path, err);
  }
  return { ok: true, kind: "create", target: "prd", domain: slug, prd, path };
}

/** `write` replaces the WHOLE body of an EXISTING method / PRD / user_spec with a
 * reconciled version — the model reads current (`sil_profile_get`), reconciles in
 * context, and writes the whole doc back. Frontmatter coordinates + `created_at` are
 * preserved and `updated_at` bumps (user_spec carries no timestamp). Fail-closed on a
 * missing doc (`not_found` — write never mints, that is create) and on a present-but-
 * corrupt one (`unreadable` — inspect / repair, never clobber a recoverable artefact). */
function learnWrite(spec: LearnSpec): LearnResult {
  if (!nonBlank(spec.body)) return invalid("body", "body is required and must be non-empty.");
  const target = resolveTarget(spec);
  if ("ok" in target) return target;
  const existing = readArtefactFile(target.path);
  if (existing === null) {
    if (existsSync(target.path)) return unreadable(target.path);
    return notFound(
      "The target " + target.label + " does not exist — mint it with kind:create first"
        + " (write replaces an existing doc, it never mints).",
    );
  }
  return writeArtefactBody(target, existing.fields, spec.body as string, "write");
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

  // Idempotent link on the asset PATH (not the caption): if `assets/<hash>.<ext>` is
  // already referenced in the target, skip the body write — no second link line, no
  // updated_at churn. The bytes were re-written above (identical-hash overwrite, a
  // benign no-op), so a re-attach under any caption is a body no-op that still
  // reports ok + assetPath.
  const res = existing.body.includes("](" + assetRel + ")")
    ? okAttach(target)
    : writeArtefactBody(
        target,
        existing.fields,
        existing.body.replace(/\n*$/, "\n")
          + "![" + (nonBlank(spec.caption) ? (spec.caption as string).trim() : "") + "](" + assetRel + ")\n",
        "attach-asset",
      );
  if (!res.ok) return res;
  return { ...res, assetPath: assetRel };
}

/** The success envelope for an attach-asset that wrote no body (idempotent re-link)
 * — mirrors `writeArtefactBody`'s ok shape without the re-serialize / timestamp bump. */
function okAttach(target: ResolvedTarget): LearnResult {
  return {
    ok: true,
    kind: "attach-asset",
    target: target.label,
    ...(target.domain !== undefined ? { domain: target.domain } : {}),
    ...(target.prd !== undefined ? { prd: target.prd } : {}),
    path: target.path,
  };
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

export function searchProfileFrontmatter(query: SearchQuery = {}): SearchResult | MigrationFailed {
  const migrated = ensureStoreMigrated();
  if (!migrated.ok) return migrated;
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
  | Unreadable
  | InvalidRequest
  | MigrationFailed;

export function readArtefactBody(domainSlug: string, prd?: string): ReadResult {
  const migrated = ensureStoreMigrated();
  if (!migrated.ok) return migrated;
  const badSlug = rejectBadSegment(domainSlug, "domainSlug");
  if (badSlug) return badSlug;

  if (nonBlank(prd)) {
    const badPrd = rejectBadSegment(prd, "prd");
    if (badPrd) return badPrd;
    const path = join(getDomainArtefactDir(domainSlug), PRDS_SUBDIR, prd + ".md");
    // Split absent from corrupt: an absent file is not_found, a present-but-unparseable
    // one is unreadable (never conflated — the agent must not re-mint over a corrupt PRD).
    if (!existsSync(path)) return notFound('No PRD "' + prd + '" in domain "' + domainSlug + '".');
    const parsed = readArtefactFile(path);
    if (parsed === null) return unreadable(path);
    return { ok: true, target: "prd", domain: domainSlug, prd, fields: parsed.fields, body: parsed.body, path };
  }

  const path = join(getDomainArtefactDir(domainSlug), METHOD_FILE);
  if (!existsSync(path)) {
    return notFound('No method for domain "' + domainSlug + '" — mint it with sil_learn create.');
  }
  const parsed = readArtefactFile(path);
  if (parsed === null) return unreadable(path);
  return { ok: true, target: "method", domain: domainSlug, fields: parsed.fields, body: parsed.body, path };
}

// ===========================================================================
// sil_profile_remove — whole domain subtree, or one PRD. Fail-closed + escape guard.
// ===========================================================================

export type RemoveResult =
  | { ok: true; domainSlug: string; prd?: string }
  | NotFound
  | InvalidRequest
  | PersistenceFailed
  | MigrationFailed;

export function removeArtefact(domainSlug: string, prd?: string): RemoveResult {
  const migrated = ensureStoreMigrated();
  if (!migrated.ok) return migrated;
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
