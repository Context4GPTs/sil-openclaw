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
 * that holds MANY domains and routes by domain at shop time. The store keeps a
 * SHARED, agent-level user spec (the one person) plus a per-domain pack that is
 * minted LAZILY on the first shop in a niche:
 *
 *   $SIL_DATA_DIR/agents/<shopperId>/
 *     ├─ user_spec.md            SHARED, agent-level — the one person: addresses,
 *     │                          sizes, allergy/ethics HARD constraints, budget
 *     │                          psychology. Read by EVERY domain's shop loop, so a
 *     │                          fact captured while shopping niche A is reused in
 *     │                          niche B without being re-asked. Overwritten
 *     │                          (full-body) on every materialize call.
 *     ├─ profile.json            the strictly-typed manifest the sil skill resolves
 *     │                          artefacts from — identity + userSpecPath + a
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
 * agent dir, the shared user_spec, and sibling domains survive; a failed re-mint
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
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import { DIR_MODE, ensureDataDir, getDataDir } from "./credentials.js";

/** Owner-only file mode — the artefacts are user-scoped, like tokens. The dir
 * mode (`DIR_MODE`, `0o700`) is owned by `credentials.ts` (the data-dir owner)
 * and imported, so the data-home permission lives in exactly one place. */
const FILE_MODE = 0o600;

/** The sub-tree under `$SIL_DATA_DIR` that holds per-agent behaviour artefacts. */
const AGENTS_SUBDIR = "agents";

/** The sub-tree under an agent dir that holds the per-domain packs. */
const DOMAINS_SUBDIR = "domains";

/** Artefact filenames (stable — the sil skill resolves them from profile.json,
 * but the names are also documented so a human can find them). The shared user
 * spec sits at the agent level; the three SDS pack files sit under each domain. */
const USER_SPEC_FILE = "user_spec.md";
const DOMAIN_SPEC_FILE = "domain_spec.md";
const INTENT_SPEC_FILE = "intent_spec.md";
const PLAYBOOK_FILE = "playbook.md";
const PROFILE_FILE = "profile.json";

/** A complete per-domain pack — the niche artefacts, minted lazily on first shop. */
export interface DomainPackSpec {
  /** The domain slug — keys the `domains/<slug>/` leaf. Lower-kebab, not `main`
   * (host-reserved). A NEW filesystem path segment: guarded exactly like agentId. */
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
 * The validated spec the engine hands the store. `agentId` is the host agent id
 * (the `agents.list[].id` the host CLI created); the artefact directory is keyed
 * by it. `userSpec` is the SHARED, agent-level user spec — REQUIRED non-blank on
 * EVERY call (create AND mint), overwritten full-body each time. `domain` is the
 * OPTIONAL per-domain pack: absent ⇒ create the shopper; present ⇒ mint/refresh
 * that niche.
 */
export interface ProfileSpec {
  /** Host agent id — the directory key. Lower-kebab, not `main` (host-reserved). */
  agentId: string;
  /** Human-readable shopper name (recorded in the manifest). */
  name: string;
  /** The SHARED, agent-level user spec — the one person's standing facts + hard
   * constraints that carry across every niche. REQUIRED non-blank on every call;
   * overwritten full-body so a cross-niche fact surfaced during a mint persists. */
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
  agentId: string;
  name: string;
  /** Absolute path to the SHARED, agent-level user-spec artefact. REQUIRED —
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
 * (`"domain.slug"`, `"domain.domainSpec"`, …) so the agent-level `name` is never
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
      agentId: string;
      /** The artefact directory ($SIL_DATA_DIR/agents/<agentId>). */
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
 * `{ kind, domain?, text, hard? }` plus the `agentId` every `sil_profile_*` tool
 * carries (the plugin has no ambient agent identity). `kind:"fact"` is something
 * true about the PERSON (carries across every niche → the agent-level user spec);
 * `kind:"taste"` is how they like to buy in THIS niche (→ the active domain's
 * playbook). `hard` qualifies a FACT only; `domain` selects the niche for a TASTE. */
export interface RememberSpec {
  /** Host agent id — the artefact-dir key. Lower-kebab, not `main`. Guarded. */
  agentId: string;
  /** `"fact"` → agent-level `user_spec.md`; `"taste"` → active domain `playbook.md`. */
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
      agentId: string;
      kind: "fact" | "taste";
      /** Absolute path of the body file the entry was appended to. */
      target: string;
      /** The resolved domain slug — present ONLY for a taste. */
      domain?: string;
    }
  | InvalidRequest
  | { ok: false; kind: "not_found"; agentId: string; message: string }
  | {
      ok: false;
      kind: "persistence_failed";
      /** "<path>: <cause>" so recovery is actionable (never a token/PII). */
      error: string;
      message: string;
      recovery: "fix_data_dir";
    };

/** A host-agent id / domain slug must be lower-kebab and is never `main`
 * (host-reserved). Both are joined as filesystem path segments, so both share
 * this guard. */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Resolve the per-agent artefact directory under the plugin's data dir. Never
 * hardcoded — `getDataDir()` honors `$SIL_DATA_DIR`/`$XDG_DATA_HOME`.
 *
 * SAFETY: this resolver does NOT guard `agentId` — it joins it as a path segment
 * verbatim. Every caller validates `agentId` with `rejectBadSegment` (`AGENT_ID_RE`
 * + non-`main`) BEFORE the join, so a traversal-shaped id never reaches here. A
 * FUTURE DIRECT CALLER would bypass the guard — re-validate before trusting the
 * returned path with any filesystem op. */
export function getAgentArtefactDir(agentId: string): string {
  return join(getDataDir(), AGENTS_SUBDIR, agentId);
}

/** Resolve a per-domain pack directory under an agent dir. Mirrors
 * `getAgentArtefactDir`'s SAFETY contract for the NEW path segment: `slug` is
 * joined verbatim, so every caller MUST validate it with `rejectBadSegment`
 * (`AGENT_ID_RE` + non-`main`) BEFORE the join. `agentId` is validated too — a
 * direct caller must guard BOTH segments. */
export function getDomainArtefactDir(agentId: string, slug: string): string {
  return join(getAgentArtefactDir(agentId), DOMAINS_SUBDIR, slug);
}

/** True when `s` is a present, non-blank string. */
function nonBlank(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function invalid(field: string, message: string): InvalidRequest {
  return { ok: false, kind: "invalid_request", field, message };
}

/** Validate one path-segment field (agentId or a slug) the SAME way at every
 * caller: present + non-blank, never `main`, lower-kebab. Returns `null` when
 * valid, an `invalid_request` naming the field otherwise — applied BEFORE any
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
 * Validate-first (deterministic field order: `agentId` → `name` → `userSpec` →,
 * when `domain` is present, `domain.slug` → `domain.name` → `domain.domainSpec` →
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
  const badId = rejectBadSegment(spec.agentId, "agentId");
  if (badId) return badId;
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
    // The slug is a NEW filesystem path segment — guard it exactly like agentId
    // BEFORE any join. All five pack fields are REQUIRED non-blank.
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

  const dir = getAgentArtefactDir(spec.agentId);
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
    leaf = getDomainArtefactDir(spec.agentId, domain.slug);
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
    agentId: spec.agentId,
    name: spec.name,
    userSpecPath,
    createdAt,
    domains,
  };

  // Whether the agent dir already existed. A fresh CREATE that fails is torn down
  // whole (all-or-nothing); a MINT never tears down the agent dir (it holds the
  // shared user_spec + sibling domains) — only the fresh leaf, and only if it is
  // ours.
  const dirPreexisted = existsSync(dir);

  try {
    // Ensure the data home (`$SIL_DATA_DIR`, 0700) exists first — its creation and
    // mode are owned by credentials.ts — then the per-agent leaf.
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
    return { ok: true, agentId: spec.agentId, dir, userSpecPath, profilePath, domain: entry };
  }
  return { ok: true, agentId: spec.agentId, dir, userSpecPath, profilePath };
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

function notFoundRemember(agentId: string, message: string): RememberResult {
  return { ok: false, kind: "not_found", agentId, message };
}

/**
 * Append ONE typed learning to the shopper's behaviour artefacts — the cheap
 * per-query persist path (the card's reason to exist). Unlike `materializeProfile`
 * (whole-doc overwrite), this NEVER reads or re-serializes the body: a `kind:"fact"`
 * lands at the EOF of the agent-level `user_spec.md`, a `kind:"taste"` at the EOF of
 * the active domain's `playbook.md`.
 *
 * Validate-first (deterministic field order: `agentId` → `text` → the routing
 * category errors → a taste's explicit `domain` shape): any bad field returns
 * `invalid_request` naming it and writes NOTHING.
 *   - `kind:"fact"` carrying a `domain` → `invalid_request(domain)` (a fact is
 *     agent-level).
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
  const badId = rejectBadSegment(spec.agentId, "agentId");
  if (badId) return badId;
  if (!nonBlank(spec.text)) {
    return invalid("text", "text is required and must be non-empty.");
  }
  // Routing category errors — fail fast, write nothing.
  if (spec.kind === "fact" && spec.domain !== undefined) {
    return invalid(
      "domain",
      "a fact is agent-level (it carries across every niche) — drop `domain`, or use kind:\"taste\".",
    );
  }
  if (spec.kind === "taste" && spec.hard === true) {
    return invalid(
      "hard",
      "taste is always soft/bendable — a hard taste is a contradiction; mark `hard` on FACTS only.",
    );
  }
  // A taste's explicit domain slug is a NEW filesystem path segment — guard its
  // SHAPE (field `domain`) BEFORE any resolve/read.
  if (spec.kind === "taste" && spec.domain !== undefined) {
    const badSlug = rejectBadSegment(spec.domain, "domain");
    if (badSlug) return badSlug;
  }

  const profilePath = join(getAgentArtefactDir(spec.agentId), PROFILE_FILE);
  const manifest = tryReadManifest(profilePath);
  if (manifest === null) {
    return notFoundRemember(
      spec.agentId,
      'No sil shopper "' + spec.agentId + '" to remember for — create it first with sil_profile_materialize.',
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
        spec.agentId,
        'Shopper "' + spec.agentId + '" has no domains yet — mint the niche first via sil_profile_materialize.',
      );
    } else {
      return invalid(
        "domain",
        'Shopper "' + spec.agentId + '" has ' + slugs.length + " domains (" + slugs.join(", ")
          + ") — name the `domain` to remember a taste in (omitting it is ambiguous).",
      );
    }
    const entry = manifest.domains[slug];
    if (entry === undefined) {
      return notFoundRemember(
        spec.agentId,
        'No domain "' + slug + '" on shopper "' + spec.agentId + '" — mint it first via sil_profile_materialize.',
      );
    }
    target = entry.playbookPath;
    resolvedDomain = slug;
  }

  // Fail-closed existence gate — append NEVER resurrects a seed-less doc.
  if (!existsSync(target)) {
    return notFoundRemember(
      spec.agentId,
      'The target artefact for "' + spec.agentId + '" is missing — re-materialize the shopper/domain before remembering.',
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
    agentId: spec.agentId,
    kind: spec.kind,
    target,
    ...(resolvedDomain !== undefined ? { domain: resolvedDomain } : {}),
  };
}

// ===========================================================================
// Shopper / domain lifecycle — list / view / remove the artefact half.
//
// The manifest (`profile.json`) is the source of truth: a directory under
// `agents/<id>/` with a readable profile.json IS the shopper, and its `domains`
// map is the authoritative niche index. The host-config (wiring) half of
// list/remove is the host agent driving its own `openclaw …` CLI — these
// primitives only ever touch `$SIL_DATA_DIR`.
//
// Each primitive returns a discriminated result and NEVER throws across the
// boundary, so one corrupt manifest or a single failed delete degrades only its
// own outcome — never the whole operation.
// ===========================================================================

/** Resolve the agents subtree root — the parent of every per-agent dir. */
function getAgentsRoot(): string {
  return join(getDataDir(), AGENTS_SUBDIR);
}

/** A domain summarized for an index view — no body read, no paths (list/overview
 * stay cheap). */
export interface DomainSummary {
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** One listed shopper, summarized from its manifest plus its domain index. */
export interface ListedShopper {
  agentId: string;
  name: string;
  createdAt: string;
  domains: DomainSummary[];
}

/** A `profile.json` that could not be read or parsed — surfaced inline so one
 * corrupt shopper never blinds the user to a healthy one. */
export interface UnreadableProfile {
  /** The directory name (best-effort id); the manifest may be unreadable. */
  agentId: string;
  /** Human-readable cause (no token/PII — a parse error or fs error message). */
  error: string;
}

/** `listAgentProfiles()` result — always `ok: true` (an empty/absent store is a
 * normal, successful empty listing, not an error). */
export interface ListResult {
  ok: true;
  shoppers: ListedShopper[];
  unreadable: UnreadableProfile[];
}

/** `readAgentProfile(agentId, slug?)` result — discriminated, never throws.
 *
 * One success variant covers BOTH the overview (no slug → `domains` index, no
 * bodies) and the per-domain read (slug → `slug` + the three bodies). The
 * per-domain-only fields are optional and present only for a per-domain read; the
 * tool decides what to expose in each envelope. `domains` (the index) is always
 * populated so an overview read can list it. */
export type ReadResult =
  | {
      ok: true;
      agentId: string;
      name: string;
      /** The SHARED, agent-level user-spec body. Present for both reads; a
       * referenced-but-missing body fails the read closed (`not_found`). */
      userSpec: string;
      /** The domain index (always populated). The overview view exposes this. */
      domains: DomainSummary[];
      profilePath: string;
      createdAt: string;
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
  | { ok: false; kind: "not_found"; agentId: string; message: string }
  | InvalidRequest;

/** `removeAgentArtefacts(agentId, slug)` result — discriminated, never throws. */
export type RemoveResult =
  | { ok: true; agentId: string; domainSlug: string }
  | { ok: false; kind: "not_found"; agentId: string; message: string }
  | InvalidRequest
  | {
      ok: false;
      kind: "persistence_failed";
      /** "<dir>: <cause>" so recovery is actionable. */
      error: string;
      message: string;
      recovery: "fix_data_dir";
    };

/** Read + parse one `agents/<id>/profile.json` into a typed manifest, or throw a
 * descriptive error the caller maps to an `unreadable`/`not_found` outcome. A
 * manifest whose JSON parses but is missing the required fields (identity +
 * userSpecPath + createdAt + a `domains` object) is treated as corrupt — not
 * silently coerced. */
function readManifestFile(profilePath: string): ProfileManifest {
  const raw = readFileSync(profilePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { agentId?: unknown }).agentId !== "string" ||
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

/**
 * Enumerate the materialized shopper(s) under each `$SIL_DATA_DIR/agents/<id>/`.
 *
 * The manifest is the source of truth — each `agents/<id>/profile.json` is read
 * and parsed (no dirname guessing) into a shopper identity + its domain index.
 * Shoppers are returned `createdAt` DESC. An absent/empty store yields a normal
 * empty listing. One unreadable or corrupt manifest lands in `unreadable[]` and
 * never aborts the listing. Reads only; never writes, never reads a token.
 */
export function listAgentProfiles(): ListResult {
  const root = getAgentsRoot();
  if (!existsSync(root)) {
    return { ok: true, shoppers: [], unreadable: [] };
  }

  const shoppers: ListedShopper[] = [];
  const unreadable: UnreadableProfile[] = [];

  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    unreadable.push({ agentId: AGENTS_SUBDIR, error: errCause(err) });
    return { ok: true, shoppers, unreadable };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agentId = entry.name;
    const profilePath = join(root, agentId, PROFILE_FILE);
    if (!existsSync(profilePath)) {
      unreadable.push({ agentId, error: "no profile.json manifest" });
      continue;
    }
    try {
      const manifest = readManifestFile(profilePath);
      shoppers.push({
        agentId: manifest.agentId,
        name: manifest.name,
        createdAt: manifest.createdAt,
        domains: toDomainSummaries(manifest),
      });
    } catch (err) {
      unreadable.push({ agentId, error: errCause(err) });
    }
  }

  // Most-recently-created shopper first. createdAt is ISO 8601, so a lexical
  // compare is also chronological; fall back to it when Date.parse is NaN.
  shoppers.sort((a, b) => createdAtDesc(a.createdAt, b.createdAt));

  return { ok: true, shoppers, unreadable };
}

/** Compare two ISO 8601 createdAt strings, most-recent first. */
function createdAtDesc(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    return a < b ? 1 : a > b ? -1 : 0;
  }
  return tb - ta;
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
 * Read the shopper overview OR one domain's full pack.
 *
 * Re-runs the writer's `agentId` gate BEFORE any `join`/read (a traversal-shaped
 * id → `invalid_request`); a present-but-bad `domainSlug` is guarded the same way
 * (`field:"domainSlug"`). Fail-closed: an unknown id, an absent/corrupt manifest,
 * or a missing SHARED user-spec body → `not_found`. With a slug: a slug NOT in the
 * `domains` map (manifest-gated — an orphaned leaf is invisible) OR any of the 3
 * referenced domain bodies missing → `not_found` (never a half pack). A freshly-
 * created shopper with `domains: {}` is HEALTHY — the overview reads back `ok`
 * with an empty index, never `not_found`. Never throws; reads only.
 */
export function readAgentProfile(agentId: string, domainSlug?: string): ReadResult {
  const badId = rejectBadSegment(agentId, "agentId");
  if (badId) return badId;

  const wantsDomain = nonBlank(domainSlug);
  if (wantsDomain) {
    const badSlug = rejectBadSegment(domainSlug, "domainSlug");
    if (badSlug) return badSlug;
  }

  const dir = getAgentArtefactDir(agentId);
  const profilePath = join(dir, PROFILE_FILE);
  if (!existsSync(profilePath)) {
    return notFoundRead(agentId);
  }

  let manifest: ProfileManifest;
  try {
    manifest = readManifestFile(profilePath);
  } catch {
    return notFoundRead(agentId);
  }

  // The SHARED user-spec body gates BOTH reads fail-closed — a manifest pointing at
  // a user_spec.md whose body is gone is, to the viewer, a shopper that cannot load.
  let userSpec: string;
  try {
    userSpec = readFileSync(manifest.userSpecPath, "utf8");
  } catch {
    return notFoundRead(agentId);
  }

  const domains = toDomainSummaries(manifest);

  if (!wantsDomain) {
    return {
      ok: true,
      agentId: manifest.agentId,
      name: manifest.name,
      userSpec,
      domains,
      profilePath,
      createdAt: manifest.createdAt,
    };
  }

  // Per-domain: manifest-gated — a slug not in the map (incl. an orphaned on-disk
  // leaf) is not_found, never a filesystem guess.
  const entry = manifest.domains[domainSlug as string];
  if (entry === undefined) {
    return notFoundRead(agentId);
  }

  let domainSpec: string;
  let intentSpec: string;
  let playbook: string;
  try {
    domainSpec = readFileSync(entry.domainSpecPath, "utf8");
    intentSpec = readFileSync(entry.intentSpecPath, "utf8");
    playbook = readFileSync(entry.playbookPath, "utf8");
  } catch {
    return notFoundRead(agentId);
  }

  return {
    ok: true,
    agentId: manifest.agentId,
    name: manifest.name,
    userSpec,
    domains,
    profilePath,
    createdAt: entry.createdAt,
    slug: entry.slug,
    domainSpec,
    intentSpec,
    playbook,
    updatedAt: entry.updatedAt,
  };
}

function notFoundRead(agentId: string): ReadResult {
  return {
    ok: false,
    kind: "not_found",
    agentId,
    message: 'No sil shopper "' + agentId + '" — list your shoppers to see which exist.',
  };
}

/**
 * Remove exactly ONE of the shopper's domain packs — the sil-side half of a clean
 * domain removal (the host-wiring half, if any, is the skill's `openclaw` CLI
 * step; the plugin cannot write `~/.openclaw`).
 *
 * Fail-closed and scoped to one domain leaf:
 *   - re-runs the `agentId` gate AND the `domainSlug` gate (never trusts the
 *     caller) — a bad/`main`/traversal/missing slug → `invalid_request`
 *     (`field:"domainSlug"`), deletes NOTHING (no omit-deletes-everything trap);
 *   - asserts the resolved leaf is strictly UNDER `<agentDir>/domains/` and is NOT
 *     that parent, so a delete can never escape the subtree or wipe a sibling;
 *   - manifest-gated: an unregistered slug → `not_found` (idempotent);
 *   - removes the single leaf, THEN rewrites `profile.json` to de-register
 *     `domains[slug]` — the shopper and the SHARED user_spec survive.
 *
 * A genuine delete/rewrite failure → `persistence_failed` with `<dir>: <cause>`.
 * Never throws across the boundary.
 */
export function removeAgentArtefacts(agentId: string, domainSlug: string): RemoveResult {
  const badId = rejectBadSegment(agentId, "agentId");
  if (badId) return badId;
  const badSlug = rejectBadSegment(domainSlug, "domainSlug");
  if (badSlug) return badSlug;

  const agentDir = getAgentArtefactDir(agentId);
  const domainsRoot = join(agentDir, DOMAINS_SUBDIR);
  const leaf = getDomainArtefactDir(agentId, domainSlug);

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

  const profilePath = join(agentDir, PROFILE_FILE);
  const manifest = tryReadManifest(profilePath);
  // Manifest-gated: an unregistered (or absent) domain is already gone.
  if (manifest === null || !(domainSlug in manifest.domains)) {
    return {
      ok: false,
      kind: "not_found",
      agentId,
      message:
        'No domain "' + domainSlug + '" on shopper "' + agentId + '" to remove (already'
        + " gone) — list the shopper's domains to see which exist. A re-run is safe.",
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

  return { ok: true, agentId, domainSlug };
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
