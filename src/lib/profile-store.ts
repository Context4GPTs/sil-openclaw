/**
 * sil shopper behaviour-artefact store — the single multi-domain shopper layout.
 *
 * The agent-creation engine (the bundled `sil-shopping/SKILL.md` procedure driving
 * the OpenClaw host CLI) registers the *wiring* of the one sil shopper into the
 * host's own config — the `agents.list[]` entry, the enabled `sil` plugin, the
 * attached `sil` skill. That host-config write is the host agent driving its own
 * `openclaw …` CLI; the plugin never touches `~/.openclaw`.
 *
 * What the plugin DOES own is the shopper's *behaviour* layer, materialized into
 * its own disclosed `filesystemScope` — `$SIL_DATA_DIR` (the same directory
 * `lib/credentials.ts` uses for tokens/identity). There is ONE persistent shopper
 * (a SINGLETON), so its artefacts live under a fixed, compile-time-constant
 * sub-directory — NOT a caller-supplied key. The store keeps a SHARED user spec
 * (the one person) plus a per-domain pack that is minted LAZILY on the first shop
 * in a niche:
 *
 *   $SIL_DATA_DIR/shopper/
 *     ├─ user_spec.md            SHARED — the one person: addresses, sizes,
 *     │                          allergy/ethics HARD constraints, budget
 *     │                          psychology. Read by EVERY domain's shop loop, so a
 *     │                          fact captured while shopping niche A is reused in
 *     │                          niche B without being re-asked. Overwritten
 *     │                          (full-body) on every materialize call.
 *     ├─ profile.json            the strictly-typed manifest the sil skill resolves
 *     │                          artefacts from — name + userSpecPath + a
 *     │                          slug-keyed `domains` MAP (the source of truth; no
 *     │                          filesystem guessing). `domains: {}` is the HEALTHY
 *     │                          state of a freshly-created shopper.
 *     └─ domains/<slug>/
 *         ├─ domain_spec.md      per-domain: deep researched niche expertise.
 *         ├─ intent_spec.md      per-domain: the decomposition DIMENSIONS a query
 *         │                      must resolve (the dimension SCHEMA only — the
 *         │                      per-query intent is ephemeral, never persisted).
 *         └─ playbook.md         per-domain: the user's buying TASTE for THIS niche.
 *
 * The persona is NOT a sil artefact: the shopper's identity/voice/standing rules
 * are the host workspace `SOUL.md`, written directly via the host CLI by the
 * engine — there is no `persona.md` here and no copy step. This store holds only
 * the SHARED user spec and the per-domain SDS packs.
 *
 * `sil_profile_materialize` stays ONE tool with an OPTIONAL `domain` pack:
 *   - no `domain`  ⇒ CREATE the shopper: write the shared `user_spec.md` + a
 *     `profile.json` with `domains: {}`. NO `domains/` dir is created yet.
 *   - with `domain` ⇒ lazily MINT/refresh that niche: write
 *     `domains/<slug>/{domain_spec,intent_spec,playbook}.md`, overwrite the shared
 *     `user_spec.md`, and upsert `domains[slug]` — one atomic call. Persisting a
 *     cross-niche fact surfaced in the same query is therefore native.
 *
 * Write safety: a bad spec writes NOTHING (validate-first). Each artefact is
 * written atomically — tmp file → write → rename over target → chmod 0600, dir
 * 0700 (mirroring `credentials.ts`) — so a reader never sees a half-written file.
 * Write order on a mint is `domains/<slug>/* → shared user_spec → profile.json
 * LAST`, so a crash never leaves a registered-but-absent pack: the worst outcome
 * is an ORPHANED, unreferenced `domains/<slug>/` leaf, which readers gate out via
 * the manifest (fail-closed). On a mid-write failure the teardown is keyed on
 * MANIFEST MEMBERSHIP, NOT filesystem pre-existence: a failed FIRST mint of a NEW
 * domain (slug ∉ the existing `domains` map) tears down ONLY that fresh leaf — the
 * shopper dir, the shared user_spec, and sibling domains survive; a failed re-mint
 * of an EXISTING domain is dir-preserving (the prior pack is left intact and is
 * never served half-refined — a referenced-but-missing body fails the read closed,
 * see `readAgentProfile`). A leaf we did not create (the path was already occupied)
 * is never torn down.
 */

import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import { DIR_MODE, ensureDataDir, getDataDir } from "./credentials.js";

/** Owner-only file mode — the artefacts are user-scoped, like tokens. The dir
 * mode (`DIR_MODE`, `0o700`) is owned by `credentials.ts` (the data-dir owner)
 * and imported, so the data-home permission lives in exactly one place. */
const FILE_MODE = 0o600;

/** The fixed, compile-time-constant sub-tree under `$SIL_DATA_DIR` that holds the
 * ONE shopper's behaviour artefacts. The product is a SINGLETON, so this is a
 * constant — NOT caller input — which makes the shopper path segment un-spoofable
 * (no caller-controlled `agentId` traversal vector). */
const SHOPPER_SUBDIR = "shopper";

/** The sub-tree under the shopper dir that holds the per-domain packs. */
const DOMAINS_SUBDIR = "domains";

/** Artefact filenames (stable — the sil skill resolves them from profile.json,
 * but the names are also documented so a human can find them). The shared user
 * spec sits at the shopper level; the three SDS pack files sit under each domain. */
const USER_SPEC_FILE = "user_spec.md";
const DOMAIN_SPEC_FILE = "domain_spec.md";
const INTENT_SPEC_FILE = "intent_spec.md";
const PLAYBOOK_FILE = "playbook.md";
const PROFILE_FILE = "profile.json";

/** A complete per-domain pack — the niche artefacts, minted lazily on first shop. */
export interface DomainPackSpec {
  /** The domain slug — keys the `domains/<slug>/` leaf. Lower-kebab, not `main`
   * (host-reserved). A caller-supplied filesystem path segment: guarded before any
   * join. */
  slug: string;
  /** Human-readable domain name (recorded in the manifest entry). */
  name: string;
  /** The SDS domain spec — deep researched niche expertise (how to buy well, the
   * full mechanics). REQUIRED non-blank. Materialized as `domain_spec.md`. */
  domainSpec: string;
  /** The SDS intent spec — the agent-specific decomposition DIMENSIONS a query must
   * resolve, derived from the domain spec. REQUIRED non-blank. The dimension SCHEMA
   * only (the per-query intent is ephemeral). Materialized as `intent_spec.md`. */
  intentSpec: string;
  /** The SDS playbook — the user's buying TASTE for THIS niche. REQUIRED non-blank.
   * Materialized as `playbook.md`. */
  playbook: string;
}

/**
 * The validated spec the engine hands the store. The artefact directory is the
 * fixed SINGLETON path (no caller-supplied key). `userSpec` is the SHARED user
 * spec — REQUIRED non-blank on EVERY call (create AND mint), overwritten full-body
 * each time. `domain` is the OPTIONAL per-domain pack: absent ⇒ create the shopper;
 * present ⇒ mint/refresh that niche.
 */
export interface ProfileSpec {
  /** Human-readable shopper name (recorded in the manifest). */
  name: string;
  /** The SHARED user spec — the one person's standing facts + hard constraints that
   * carry across every niche. REQUIRED non-blank on every call; overwritten
   * full-body so a cross-niche fact surfaced during a mint persists. */
  userSpec: string;
  /** The OPTIONAL per-domain pack. Absent ⇒ create the shopper (no `domains/`
   * dir). Present ⇒ lazily mint/refresh `domains/<slug>/*` and upsert the map. */
  domain?: DomainPackSpec;
}

/** One registered domain in the manifest's `domains` map — the source of truth the
 * sil skill reads to resolve a niche's pack (no filesystem guessing). */
export interface DomainEntry {
  slug: string;
  name: string;
  /** Absolute path to the per-domain `domain_spec.md`. */
  domainSpecPath: string;
  /** Absolute path to the per-domain `intent_spec.md`. */
  intentSpecPath: string;
  /** Absolute path to the per-domain `playbook.md`. */
  playbookPath: string;
  /** ISO 8601 — when this domain was first minted (preserved across re-mints). */
  createdAt: string;
  /** ISO 8601 — when this domain's pack was last (re-)minted. */
  updatedAt: string;
}

/** The strictly-typed manifest persisted as `profile.json`. The sil skill reads
 * this to locate the shared user spec + resolve each domain's pack. */
export interface ProfileManifest {
  name: string;
  /** Absolute path to the SHARED user-spec artefact. REQUIRED —
   * `readManifestFile` gates on it. */
  userSpecPath: string;
  /** ISO 8601 creation timestamp of the shopper. */
  createdAt: string;
  /** The slug-keyed domain map — the source of truth. `{}` is the HEALTHY state
   * of a freshly-created shopper that has not shopped yet. */
  domains: Record<string, DomainEntry>;
}

/** A structured invalid-request outcome, shared across every store primitive. The
 * `field` is the offending field — the DOTTED name for nested domain fields
 * (`"domain.slug"`, `"domain.domainSpec"`, …) so the shopper-level `name` is never
 * confused with `domain.name`. */
export interface InvalidRequest {
  ok: false;
  kind: "invalid_request";
  field: string;
  message: string;
}

/** The discriminated result the writer returns — never throws across the
 * boundary; the tool maps each variant to the structured envelope. `domain` is
 * echoed (the upserted `DomainEntry`) ONLY for a mint, never for a create. */
export type MaterializeResult =
  | {
      ok: true;
      /** The artefact directory ($SIL_DATA_DIR/shopper). */
      dir: string;
      /** Absolute path to the SHARED user-spec artefact. */
      userSpecPath: string;
      /** Absolute path to the manifest. */
      profilePath: string;
      /** The upserted domain entry — present ONLY for a mint. */
      domain?: DomainEntry;
    }
  | InvalidRequest
  | {
      ok: false;
      kind: "persistence_failed";
      /** "<dir>: <cause>" so recovery is actionable. */
      error: string;
      message: string;
    };

/** One typed learning the cheap per-query persist path appends — the founder's
 * `{ kind, domain?, text, hard? }`. `kind:"fact"` is something true about the
 * PERSON (carries across every niche → the shared user spec); `kind:"taste"` is how
 * they like to buy in THIS niche (→ the active domain's playbook). `hard` qualifies
 * a FACT only; `domain` selects the niche for a TASTE. */
export interface RememberSpec {
  /** `"fact"` → the shared `user_spec.md`; `"taste"` → active domain `playbook.md`. */
  kind: "fact" | "taste";
  /** The ONE short learning to append. REQUIRED non-blank; well under PIPE_BUF. */
  text: string;
  /** TASTE only — the niche to append to. Omitted ⇒ resolve the single domain
   * (0 → not_found, 2+ → invalid_request). A FACT carrying a `domain` is a
   * category error (`invalid_request`). */
  domain?: string;
  /** FACT only — marks an inviolable user-spec hard constraint (reject-at-pick).
   * A `hard:true` TASTE is a contradiction (`invalid_request`). */
  hard?: boolean;
}

/** The stable, case-insensitive marker the shop loop's reject-at-pick rule greps
 * to find an appended hard constraint (e.g. `- [hard] never leather`). */
const HARD_MARKER = "[hard]";

/** The discriminated result `appendProfileEntry` returns — never throws across the
 * boundary; the tool maps each variant to the `jsonResult` envelope. */
export type RememberResult =
  | {
      ok: true;
      kind: "fact" | "taste";
      /** Absolute path of the body file the entry was appended to. */
      target: string;
      /** The resolved domain slug — present ONLY for a taste. */
      domain?: string;
    }
  | InvalidRequest
  | { ok: false; kind: "not_found"; message: string }
  | {
      ok: false;
      kind: "persistence_failed";
      /** "<path>: <cause>" so recovery is actionable (never a token/PII). */
      error: string;
      message: string;
      recovery: "fix_data_dir";
    };

/** A domain slug must be lower-kebab and is never `main` (host-reserved). It is
 * joined as a filesystem path segment, so it carries this guard. (The shopper dir
 * segment is the un-spoofable constant `SHOPPER_SUBDIR` — it needs no guard.) */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Resolve the SINGLETON shopper artefact directory under the plugin's data dir.
 * Never hardcoded — `getDataDir()` honors `$SIL_DATA_DIR`/`$XDG_DATA_HOME`.
 *
 * SAFETY: the shopper segment is the compile-time constant `SHOPPER_SUBDIR`, NOT
 * caller input, so there is no path-traversal vector here (nothing to spoof). The
 * only caller-supplied segment in the store is the domain `slug` — see
 * `getDomainArtefactDir`, which every caller guards before the join. */
export function getShopperArtefactDir(): string {
  return join(getDataDir(), SHOPPER_SUBDIR);
}

/** Resolve a per-domain pack directory under the singleton shopper dir.
 *
 * SAFETY: `slug` is the ONLY caller-supplied path segment in the store. It is
 * joined verbatim here, so every caller MUST validate it with `rejectBadSegment`
 * (`AGENT_ID_RE` + non-`main`) BEFORE the join. A FUTURE DIRECT CALLER would bypass
 * that guard — re-validate `slug` before trusting the returned path with any
 * filesystem op. */
export function getDomainArtefactDir(slug: string): string {
  return join(getShopperArtefactDir(), DOMAINS_SUBDIR, slug);
}

/** True when `s` is a present, non-blank string. */
function nonBlank(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function invalid(field: string, message: string): InvalidRequest {
  return { ok: false, kind: "invalid_request", field, message };
}

/** Validate the domain-slug path-segment field the SAME way at every caller:
 * present + non-blank, never `main`, lower-kebab. Returns `null` when valid, an
 * `invalid_request` naming the field otherwise — applied BEFORE any
 * join/read/delete so a parent-directory traversal, an absolute path, a bare dot,
 * or `main` never becomes a filesystem path segment. */
function rejectBadSegment(value: unknown, field: string): InvalidRequest | null {
  if (!nonBlank(value)) {
    return invalid(field, field + " is required and must be non-empty.");
  }
  if (value === "main") {
    return invalid(field, '"main" is host-reserved and cannot be a ' + field + ".");
  }
  if (!AGENT_ID_RE.test(value)) {
    return invalid(
      field,
      field + " must be lower-kebab (a-z, 0-9, hyphen) — got: " + JSON.stringify(value),
    );
  }
  return null;
}

/**
 * Materialize the shopper / a domain pack.
 *
 * Validate-first (deterministic field order: `name` → `userSpec` →, when `domain`
 * is present, `domain.slug` → `domain.name` → `domain.domainSpec` →
 * `domain.intentSpec` → `domain.playbook`): any invalid field returns
 * `invalid_request` naming it and writes NOTHING.
 *
 * - no `domain`  ⇒ write the shared `user_spec.md` + `profile.json` (`domains: {}`);
 *   no `domains/` dir.
 * - with `domain` ⇒ write `domains/<slug>/*` → overwrite the shared `user_spec.md`
 *   → write `profile.json` LAST (upsert `domains[slug]`; preserve `createdAt` on a
 *   re-mint, advance `updatedAt`). `domain` is echoed in the ok result.
 */
export function materializeProfile(spec: ProfileSpec): MaterializeResult {
  // --- validate-first (nothing is written until every field is good) ---
  if (!nonBlank(spec.name)) {
    return invalid("name", "name is required and must be non-empty.");
  }
  // The SHARED user spec is REQUIRED non-blank on EVERY call — create AND mint —
  // so a mint can never blank out the one person's standing facts/constraints.
  if (!nonBlank(spec.userSpec)) {
    return invalid("userSpec", "userSpec is required and must be non-empty.");
  }

  const domain = spec.domain;
  if (domain !== undefined) {
    // The slug is the caller-supplied filesystem path segment — guard it BEFORE any
    // join. All five pack fields are REQUIRED non-blank.
    const badSlug = rejectBadSegment(domain.slug, "domain.slug");
    if (badSlug) return badSlug;
    if (!nonBlank(domain.name)) {
      return invalid("domain.name", "domain.name is required and must be non-empty.");
    }
    if (!nonBlank(domain.domainSpec)) {
      return invalid("domain.domainSpec", "domain.domainSpec is required and must be non-empty.");
    }
    if (!nonBlank(domain.intentSpec)) {
      return invalid("domain.intentSpec", "domain.intentSpec is required and must be non-empty.");
    }
    if (!nonBlank(domain.playbook)) {
      return invalid("domain.playbook", "domain.playbook is required and must be non-empty.");
    }
  }

  const dir = getShopperArtefactDir();
  const userSpecPath = join(dir, USER_SPEC_FILE);
  const profilePath = join(dir, PROFILE_FILE);

  // The manifest is the source of truth: read what is already on disk so a mint is
  // an UPSERT (the createdAt of the shopper and of any existing domain is
  // preserved) rather than a clobber. A corrupt/absent manifest is treated as a
  // fresh shopper — re-materialize heals it.
  const existing = tryReadManifest(profilePath);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const domains: Record<string, DomainEntry> = existing ? { ...existing.domains } : {};

  // Per-mint state, resolved BEFORE the write so the catch block knows whether the
  // failed leaf is ours to tear down (manifest membership) and whether the path
  // pre-existed (never delete a path we did not create).
  let leaf = "";
  let entry: DomainEntry | undefined;
  let domainIsNew = false;
  let leafPreexisted = false;

  if (domain !== undefined) {
    leaf = getDomainArtefactDir(domain.slug);
    const prior = domains[domain.slug];
    domainIsNew = prior === undefined;
    leafPreexisted = existsSync(leaf);
    const now = new Date().toISOString();
    entry = {
      slug: domain.slug,
      name: domain.name,
      domainSpecPath: join(leaf, DOMAIN_SPEC_FILE),
      intentSpecPath: join(leaf, INTENT_SPEC_FILE),
      playbookPath: join(leaf, PLAYBOOK_FILE),
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    domains[domain.slug] = entry;
  }

  const manifest: ProfileManifest = {
    name: spec.name,
    userSpecPath,
    createdAt,
    domains,
  };

  // Whether the shopper dir already existed. A fresh CREATE that fails is torn down
  // whole (all-or-nothing); a MINT never tears down the shopper dir (it holds the
  // shared user_spec + sibling domains) — only the fresh leaf, and only if it is
  // ours.
  const dirPreexisted = existsSync(dir);

  try {
    // Ensure the data home (`$SIL_DATA_DIR`, 0700) exists first — its creation and
    // mode are owned by credentials.ts — then the shopper leaf.
    ensureDataDir();
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    if (domain !== undefined && entry !== undefined) {
      // Write order: the domain pack FIRST, the shared user_spec, the manifest
      // LAST — so a crash before the manifest write leaves only an orphaned,
      // unreferenced leaf (invisible to readers), never a registered-but-absent
      // pack.
      mkdirSync(leaf, { recursive: true, mode: DIR_MODE });
      atomicWrite(entry.domainSpecPath, domain.domainSpec);
      atomicWrite(entry.intentSpecPath, domain.intentSpec);
      atomicWrite(entry.playbookPath, domain.playbook);
    }
    atomicWrite(userSpecPath, spec.userSpec);
    atomicWrite(profilePath, JSON.stringify(manifest, null, 2) + "\n");
  } catch (err) {
    if (domain !== undefined) {
      // MINT teardown — keyed on manifest membership, NOT filesystem pre-existence:
      // tear down ONLY a fresh leaf this call created for a NEW domain. A re-mint of
      // an EXISTING domain is dir-preserving (the prior pack survives), and a leaf
      // path already occupied (the test's blocking file) is never our leaf to remove.
      if (domainIsNew && !leafPreexisted) {
        try {
          rmSync(leaf, { recursive: true, force: true });
        } catch {
          // Cleanup is best-effort; the original cause is what the caller needs.
        }
      }
    } else if (!dirPreexisted) {
      // Fresh CREATE — leave nothing partial behind, but only if WE created the dir.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
    const cause = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "persistence_failed",
      error: dir + ": " + cause,
      message:
        "The shopper behaviour artefacts could NOT be written to the sil data"
        + " directory, so the change did not stick. Fix the data directory (it must"
        + " be writable — check permissions / free space / that $SIL_DATA_DIR is a"
        + " directory), then try again.",
    };
  }

  if (domain !== undefined && entry !== undefined) {
    return { ok: true, dir, userSpecPath, profilePath, domain: entry };
  }
  return { ok: true, dir, userSpecPath, profilePath };
}

/** Atomic single-file write: tmp sibling → write → rename over target → chmod.
 * Mirrors the token/identity write in `credentials.ts` so a half-written
 * artefact never appears (a reader sees the old file or the new one). */
function atomicWrite(path: string, contents: string): void {
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, contents, { mode: FILE_MODE });
  renameSync(tmp, path);
  chmodSync(path, FILE_MODE);
}

function notFoundRemember(message: string): RememberResult {
  return { ok: false, kind: "not_found", message };
}

/**
 * Append ONE typed learning to the shopper's behaviour artefacts — the cheap
 * per-query persist path (the card's reason to exist). Unlike `materializeProfile`
 * (whole-doc overwrite), this NEVER reads or re-serializes the body: a `kind:"fact"`
 * lands at the EOF of the shared `user_spec.md`, a `kind:"taste"` at the EOF of the
 * active domain's `playbook.md`.
 *
 * Validate-first (deterministic field order: `text` → the routing category errors →
 * a taste's explicit `domain` shape): any bad field returns `invalid_request`
 * naming it and writes NOTHING.
 *   - `kind:"fact"` carrying a `domain` → `invalid_request(domain)` (a fact is
 *     shopper-level).
 *   - `kind:"taste"` carrying `hard:true` → `invalid_request(hard)` (taste is soft).
 *
 * Active-domain resolution (taste only): explicit `domain` slug → else the single
 * registered domain → 0 domains → `not_found` → 2+ domains → `invalid_request(domain)`
 * (ambiguous — never a silent write to the wrong niche).
 *
 * Fail-closed existence gate — append NEVER creates a file: an unknown shopper (no
 * manifest), a missing `user_spec.md` body, an unregistered domain, or a registered
 * domain whose `playbook.md` body is gone → `not_found` (no lone-bullet seed-less
 * doc is ever born via append).
 *
 * The write is `appendFileSync(target, "\n- …", { flag: "a", mode: FILE_MODE })` —
 * O_APPEND lands the entry at EOF atomically per write (POSIX), so concurrent
 * appenders never lose an entry. The entry is `"\n"`-prefixed (O_APPEND does not
 * read the prior terminator) and is ONE short learning, well under PIPE_BUF (~4 KB),
 * so the per-write atomicity holds. A hard fact carries the `[hard]` marker so the
 * shop loop's reject-at-pick rule can grep it. No manifest rewrite — the entry is
 * already visible to `readAgentProfile` via `userSpecPath` / `playbookPath`. The
 * `mode` option only applies on file creation, and the gate guarantees the target
 * already exists, so the file's `0600` mode (set at materialize) is preserved.
 */
export function appendProfileEntry(spec: RememberSpec): RememberResult {
  // --- validate-first (nothing is written until every field is good) ---
  if (!nonBlank(spec.text)) {
    return invalid("text", "text is required and must be non-empty.");
  }
  // Routing category errors — fail fast, write nothing.
  if (spec.kind === "fact" && spec.domain !== undefined) {
    return invalid(
      "domain",
      "a fact is shopper-level (it carries across every niche) — drop `domain`, or use kind:\"taste\".",
    );
  }
  if (spec.kind === "taste" && spec.hard === true) {
    return invalid(
      "hard",
      "taste is always soft/bendable — a hard taste is a contradiction; mark `hard` on FACTS only.",
    );
  }
  // A taste's explicit domain slug is the caller-supplied filesystem path segment —
  // guard its SHAPE (field `domain`) BEFORE any resolve/read.
  if (spec.kind === "taste" && spec.domain !== undefined) {
    const badSlug = rejectBadSegment(spec.domain, "domain");
    if (badSlug) return badSlug;
  }

  const profilePath = join(getShopperArtefactDir(), PROFILE_FILE);
  const manifest = tryReadManifest(profilePath);
  if (manifest === null) {
    return notFoundRemember(
      "No sil shopper to remember for — create it first with sil_profile_materialize.",
    );
  }

  // Resolve the target body file (and, for a taste, the active domain).
  let target: string;
  let resolvedDomain: string | undefined;
  if (spec.kind === "fact") {
    target = manifest.userSpecPath;
  } else {
    const slugs = Object.keys(manifest.domains);
    let slug: string;
    if (spec.domain !== undefined) {
      slug = spec.domain;
    } else if (slugs.length === 1) {
      slug = slugs[0] as string;
    } else if (slugs.length === 0) {
      return notFoundRemember(
        "The shopper has no domains yet — mint the niche first via sil_profile_materialize.",
      );
    } else {
      return invalid(
        "domain",
        "The shopper has " + slugs.length + " domains (" + slugs.join(", ")
          + ") — name the `domain` to remember a taste in (omitting it is ambiguous).",
      );
    }
    const entry = manifest.domains[slug];
    if (entry === undefined) {
      return notFoundRemember(
        'No domain "' + slug + '" on the shopper — mint it first via sil_profile_materialize.',
      );
    }
    target = entry.playbookPath;
    resolvedDomain = slug;
  }

  // Fail-closed existence gate — append NEVER resurrects a seed-less doc.
  if (!existsSync(target)) {
    return notFoundRemember(
      "The target artefact is missing — re-materialize the shopper/domain before remembering.",
    );
  }

  // O_APPEND write — one short entry at EOF, "\n"-prefixed. A hard fact is marked
  // unambiguously so the reject-at-pick rule can grep it.
  const mark = spec.kind === "fact" && spec.hard === true ? HARD_MARKER + " " : "";
  const line = "\n- " + mark + spec.text.trim();
  try {
    appendFileSync(target, line, { flag: "a", mode: FILE_MODE });
  } catch (err) {
    return {
      ok: false,
      kind: "persistence_failed",
      error: target + ": " + errCause(err),
      message:
        "The remembered entry could NOT be appended to the sil data directory, so it"
        + " did not stick. Fix the data directory (it must be writable — check"
        + " permissions / free space / that the target is a file, not a directory),"
        + " then try again.",
      recovery: "fix_data_dir",
    };
  }

  return {
    ok: true,
    kind: spec.kind,
    target,
    ...(resolvedDomain !== undefined ? { domain: resolvedDomain } : {}),
  };
}

// ===========================================================================
// Shopper / domain lifecycle — read / remove the artefact half.
//
// The manifest (`profile.json`) is the source of truth: the singleton shopper dir
// with a readable profile.json IS the shopper, and its `domains` map is the
// authoritative niche index. The host-config (wiring) half of remove is the host
// agent driving its own `openclaw …` CLI — these primitives only ever touch
// `$SIL_DATA_DIR`.
//
// Each primitive returns a discriminated result and NEVER throws across the
// boundary, so one corrupt manifest or a single failed delete degrades only its
// own outcome — never the whole operation.
// ===========================================================================

/** A domain summarized for an index view — no body read, no paths (overview stays
 * cheap). */
export interface DomainSummary {
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** A `profile.json` (or its referenced body) that could not be read or parsed —
 * surfaced inline on the no-args read so a degraded directory never blinds the
 * user to a healthy state nor aborts the read. */
export interface UnreadableProfile {
  /** The shopper sub-dir name (best-effort id); the manifest may be unreadable. */
  id: string;
  /** Human-readable cause (no token/PII — a parse error or fs error message). */
  error: string;
}

/** `readAgentProfile(slug?)` result — discriminated, never throws.
 *
 * One success variant covers BOTH the no-args overview (Zoom A — `domains` index +
 * `unreadable[]`, empty-is-healthy) and the per-domain read (slug → `slug` + the
 * three bodies). When NO shopper exists (or its directory is degraded) the overview
 * is still `ok` (empty-is-healthy) with the breakage surfaced in `unreadable[]` and
 * `name`/content absent — NEVER `not_found`. The per-domain-only fields are present
 * only for a per-domain read; the tool decides what to expose in each envelope. */
export type ReadResult =
  | {
      ok: true;
      /** The shopper name — present ONLY when a shopper exists and its manifest
       * loaded. Absent on an empty or degraded store (the empty-is-healthy signal). */
      name?: string;
      /** The SHARED user-spec body. The body for a per-domain read and a healthy
       * overview; `""` for an empty/degraded store. */
      userSpec: string;
      /** The domain index (always present; `[]` for an empty store). */
      domains: DomainSummary[];
      /** Degraded directories surfaced inline — `[]` when healthy. */
      unreadable: UnreadableProfile[];
      profilePath: string;
      /** Present only when a shopper exists. */
      createdAt?: string;
      /** Per-domain only: the requested domain slug. */
      slug?: string;
      /** Per-domain only: the SDS domain-spec body. */
      domainSpec?: string;
      /** Per-domain only: the SDS intent-spec body. */
      intentSpec?: string;
      /** Per-domain only: the SDS playbook body. */
      playbook?: string;
      /** Per-domain only: the domain's last-mint timestamp. */
      updatedAt?: string;
    }
  | { ok: false; kind: "not_found"; message: string }
  | InvalidRequest;

/** `removeAgentArtefacts(slug)` result — discriminated, never throws. */
export type RemoveResult =
  | { ok: true; domainSlug: string }
  | { ok: false; kind: "not_found"; message: string }
  | InvalidRequest
  | {
      ok: false;
      kind: "persistence_failed";
      /** "<dir>: <cause>" so recovery is actionable. */
      error: string;
      message: string;
      recovery: "fix_data_dir";
    };

/** Read + parse the singleton `shopper/profile.json` into a typed manifest, or
 * throw a descriptive error the caller maps to an `unreadable`/`not_found` outcome.
 * A manifest whose JSON parses but is missing the required fields (name +
 * userSpecPath + createdAt + a `domains` object) is treated as corrupt — not
 * silently coerced. */
function readManifestFile(profilePath: string): ProfileManifest {
  const raw = readFileSync(profilePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { userSpecPath?: unknown }).userSpecPath !== "string" ||
    typeof (parsed as { createdAt?: unknown }).createdAt !== "string" ||
    typeof (parsed as { domains?: unknown }).domains !== "object" ||
    (parsed as { domains?: unknown }).domains === null ||
    Array.isArray((parsed as { domains?: unknown }).domains)
  ) {
    throw new Error("profile.json is missing required manifest fields");
  }
  return parsed as ProfileManifest;
}

/** Read the manifest if it exists and parses; `null` otherwise. Used by the
 * upsert/de-register paths that must merge with whatever is already on disk. */
function tryReadManifest(profilePath: string): ProfileManifest | null {
  if (!existsSync(profilePath)) return null;
  try {
    return readManifestFile(profilePath);
  } catch {
    return null;
  }
}

/** Project a manifest's `domains` map to the cheap summary index, ordered by
 * first-mint time (then slug) so the index is deterministic. */
function toDomainSummaries(manifest: ProfileManifest): DomainSummary[] {
  return Object.values(manifest.domains)
    .map((d) => ({ slug: d.slug, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt }))
    .sort((a, b) => createdAtAsc(a.createdAt, b.createdAt) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Compare two ISO 8601 createdAt strings, oldest first. */
function createdAtAsc(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return ta - tb;
}

/**
 * Read the shopper overview (Zoom A, no args) OR one domain's full pack (slug).
 *
 * Zoom A (no slug) is the folded listing — it ABSORBS the old standalone listing
 * surface: an empty store, or a freshly-created shopper with `domains: {}`, reads `ok`
 * (empty-is-healthy) with an empty `domains` index and `unreadable: []` — NEVER
 * `not_found` (the create-collision check + the "you haven't set up a shopper yet"
 * framing + the shop-time existence check all depend on it). A corrupt manifest, or
 * a degraded shopper directory, is surfaced inline in `unreadable[]` and never
 * aborts the read nor downgrades to `not_found`.
 *
 * Per-domain (slug given) guards the `domainSlug` BEFORE any `join`/read (a
 * traversal-shaped slug → `invalid_request(field=domainSlug)`). Fail-closed: an
 * absent/corrupt manifest, a missing SHARED user-spec body, a slug NOT in the
 * `domains` map (manifest-gated — an orphaned leaf is invisible), or any of the 3
 * referenced domain bodies missing → `not_found` (never a half pack). Never throws;
 * reads only.
 */
export function readAgentProfile(domainSlug?: string): ReadResult {
  const wantsDomain = nonBlank(domainSlug);
  if (wantsDomain) {
    const badSlug = rejectBadSegment(domainSlug, "domainSlug");
    if (badSlug) return badSlug;
  }

  const dir = getShopperArtefactDir();
  const profilePath = join(dir, PROFILE_FILE);

  if (!wantsDomain) {
    // --- Zoom A: the no-args overview (folded listing, empty-is-healthy) ---
    if (!existsSync(profilePath)) {
      // Empty store — a normal, healthy empty outcome.
      return { ok: true, userSpec: "", domains: [], unreadable: [], profilePath };
    }
    let manifest: ProfileManifest;
    try {
      manifest = readManifestFile(profilePath);
    } catch (err) {
      // Corrupt manifest — degraded, surfaced inline, never not_found / never throws.
      return {
        ok: true,
        userSpec: "",
        domains: [],
        unreadable: [{ id: SHOPPER_SUBDIR, error: errCause(err) }],
        profilePath,
      };
    }
    let userSpec: string;
    try {
      userSpec = readFileSync(manifest.userSpecPath, "utf8");
    } catch (err) {
      // The shared user-spec body is gone — the shopper cannot fully load; surface
      // the breakage as degraded rather than hiding it or aborting the read.
      return {
        ok: true,
        userSpec: "",
        domains: [],
        unreadable: [{ id: SHOPPER_SUBDIR, error: errCause(err) }],
        profilePath,
      };
    }
    return {
      ok: true,
      name: manifest.name,
      userSpec,
      domains: toDomainSummaries(manifest),
      unreadable: [],
      profilePath,
      createdAt: manifest.createdAt,
    };
  }

  // --- Per-domain read (slug given) — fail-closed ---
  if (!existsSync(profilePath)) {
    return notFoundRead();
  }
  let manifest: ProfileManifest;
  try {
    manifest = readManifestFile(profilePath);
  } catch {
    return notFoundRead();
  }

  // The SHARED user-spec body gates the read fail-closed — a manifest pointing at a
  // user_spec.md whose body is gone is, to the viewer, a shopper that cannot load.
  let userSpec: string;
  try {
    userSpec = readFileSync(manifest.userSpecPath, "utf8");
  } catch {
    return notFoundRead();
  }

  // Manifest-gated — a slug not in the map (incl. an orphaned on-disk leaf) is
  // not_found, never a filesystem guess.
  const entry = manifest.domains[domainSlug as string];
  if (entry === undefined) {
    return notFoundRead();
  }

  let domainSpec: string;
  let intentSpec: string;
  let playbook: string;
  try {
    domainSpec = readFileSync(entry.domainSpecPath, "utf8");
    intentSpec = readFileSync(entry.intentSpecPath, "utf8");
    playbook = readFileSync(entry.playbookPath, "utf8");
  } catch {
    return notFoundRead();
  }

  return {
    ok: true,
    name: manifest.name,
    userSpec,
    domains: toDomainSummaries(manifest),
    unreadable: [],
    profilePath,
    createdAt: entry.createdAt,
    slug: entry.slug,
    domainSpec,
    intentSpec,
    playbook,
    updatedAt: entry.updatedAt,
  };
}

function notFoundRead(): ReadResult {
  return {
    ok: false,
    kind: "not_found",
    message:
      "No such domain on the sil shopper — call sil_profile_get with no domainSlug to see"
      + " what the shopper has (its shared user spec + the domains it has learned).",
  };
}

/**
 * Remove exactly ONE of the shopper's domain packs — the sil-side half of a clean
 * domain removal (the host-wiring half, if any, is the skill's `openclaw` CLI
 * step; the plugin cannot write `~/.openclaw`).
 *
 * Fail-closed and scoped to one domain leaf:
 *   - re-runs the `domainSlug` gate (never trusts the caller) — a bad/`main`/
 *     traversal/missing slug → `invalid_request` (`field:"domainSlug"`), deletes
 *     NOTHING (no omit-deletes-everything trap);
 *   - asserts the resolved leaf is strictly UNDER `<shopperDir>/domains/` and is NOT
 *     that parent, so a delete can never escape the subtree or wipe a sibling;
 *   - manifest-gated: an unregistered slug → `not_found` (idempotent);
 *   - removes the single leaf, THEN rewrites `profile.json` to de-register
 *     `domains[slug]` — the shopper and the SHARED user_spec survive.
 *
 * A genuine delete/rewrite failure → `persistence_failed` with `<dir>: <cause>`.
 * Never throws across the boundary.
 */
export function removeAgentArtefacts(domainSlug: string): RemoveResult {
  const badSlug = rejectBadSegment(domainSlug, "domainSlug");
  if (badSlug) return badSlug;

  const shopperDir = getShopperArtefactDir();
  const domainsRoot = join(shopperDir, DOMAINS_SUBDIR);
  const leaf = getDomainArtefactDir(domainSlug);

  // Defence in depth beyond the slug gate: the leaf must be a STRICT child of the
  // domains root and never the root itself — deleting the parent would wipe every
  // sibling domain.
  if (dirname(leaf) !== domainsRoot || leaf === domainsRoot) {
    return invalid(
      "domainSlug",
      "domainSlug resolves outside the domains subtree — refusing to delete: " +
        JSON.stringify(domainSlug),
    );
  }

  const profilePath = join(shopperDir, PROFILE_FILE);
  const manifest = tryReadManifest(profilePath);
  // Manifest-gated: an unregistered (or absent) domain is already gone.
  if (manifest === null || !(domainSlug in manifest.domains)) {
    return {
      ok: false,
      kind: "not_found",
      message:
        'No domain "' + domainSlug + '" on the sil shopper to remove (already gone) —'
        + " call sil_profile_get with no domainSlug to see which domains exist. A"
        + " re-run is safe.",
    };
  }

  // Remove the leaf FIRST; only de-register once the bytes are actually gone, so a
  // failed delete never leaves the map pointing at a still-present pack.
  try {
    rmSync(leaf, { recursive: true, force: true });
  } catch (err) {
    return persistenceFailedRemove(leaf, err);
  }

  const nextDomains: Record<string, DomainEntry> = {};
  for (const [slug, entry] of Object.entries(manifest.domains)) {
    if (slug !== domainSlug) nextDomains[slug] = entry;
  }
  const updated: ProfileManifest = { ...manifest, domains: nextDomains };
  try {
    atomicWrite(profilePath, JSON.stringify(updated, null, 2) + "\n");
  } catch (err) {
    return persistenceFailedRemove(profilePath, err);
  }

  return { ok: true, domainSlug };
}

function persistenceFailedRemove(path: string, err: unknown): RemoveResult {
  return {
    ok: false,
    kind: "persistence_failed",
    error: path + ": " + errCause(err),
    message:
      "The domain's behaviour artefacts could NOT be removed from the sil data"
      + " directory. Fix the data directory (it must be writable — check"
      + " permissions), then remove the domain again.",
    recovery: "fix_data_dir",
  };
}

/** Extract a human-readable cause from an unknown thrown value (never PII). */
function errCause(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
