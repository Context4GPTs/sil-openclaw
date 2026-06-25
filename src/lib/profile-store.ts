/**
 * sil shopping-expert behaviour-artefact store.
 *
 * The agent-creation engine (the bundled `skill/SKILL.md` procedure driving
 * the OpenClaw host CLI) registers the *wiring* of a new sil-wired agent into
 * the host's own config — the `agents.list[]` entry, the enabled `sil` plugin,
 * the attached `sil` skill. That host-config write is the host agent driving
 * its own `openclaw …` CLI; the plugin never touches `~/.openclaw`.
 *
 * What the plugin DOES own is the agent's *behaviour* layer, materialized into
 * its own disclosed `filesystemScope` — `$SIL_DATA_DIR` (the same directory
 * `lib/credentials.ts` uses for tokens/identity). The created expert runs
 * entirely on Spec-Driven Shopping (SDS): the engine writes the SDS behaviour
 * artefacts there, read by the sil skill at runtime:
 *
 *   $SIL_DATA_DIR/agents/<agentId>/
 *     ├─ domain_spec.md   the SDS DOMAIN SPEC — deep researched niche expertise:
 *     │                   how to buy well, the full mechanics (gearing theory,
 *     │                   frame geometry, the complete bike-fit process…).
 *     │                   REQUIRED at creation; web-refreshed every query.
 *     ├─ intent_spec.md   the SDS INTENT SPEC — the agent-specific decomposition
 *     │                   DIMENSIONS (a PRD-style template) a query must resolve,
 *     │                   derived from domain_spec. REQUIRED at creation. The
 *     │                   per-query intent (dimensions filled in) is EPHEMERAL —
 *     │                   never persisted.
 *     ├─ user_spec.md     the SDS USER SPEC — the user's domain-relevant facts +
 *     │                   hard constraints. REQUIRED at creation (seeded partial
 *     │                   by the ≤10-question setup), AUGMENTED every query.
 *     ├─ playbook.md      the SDS PLAYBOOK — the user's buying TASTE (price
 *     │                   sensitivity, brand, preferences). REQUIRED at creation
 *     │                   (seeded partial), AUGMENTED every query.
 *     └─ profile.json     the strictly-typed manifest the sil skill resolves the
 *                         artefacts from (no filesystem guessing)
 *
 * The persona is NOT a sil artefact: the agent's identity/voice/standing rules
 * are the host workspace `SOUL.md`, written directly via the host CLI by the
 * engine — there is no `persona.md` in this store and no copy step. This store
 * holds only the four SDS BEHAVIOUR artefacts.
 *
 * All FOUR slots are REQUIRED at creation (`domainSpec` + `intentSpec` +
 * `userSpec` + `playbook`) — SDS is the operating model, not an optional layer,
 * so a created expert without all four is a defect (Founder review round 2: all
 * four sil docs are present, non-blank, from creation). They are seeded *partial*
 * (the ≤10-question setup + a quick initial research pass), then lazily
 * AUGMENTED / reinforced on EVERY query — domain_spec web-refreshed, intent_spec
 * dimensions sharpened, user_spec facts and playbook taste reinforced. We keep
 * learning. All four are refine-mutable in place. The per-query intent is NOT a
 * slot here: only the intent_spec *dimension schema* is persisted; the filled
 * dimensions for one request are ephemeral, derived in the conversation.
 *
 * Store boundary: host config + `SOUL.md` (identity/wiring) = host; the four SDS
 * behaviour artefacts = `$SIL_DATA_DIR` via this plugin tool. Identity/tokens
 * already live in `$SIL_DATA_DIR` but stay logically separate (no identity
 * coupling — creating an expert reads/writes no token).
 *
 * Write safety (Product invariant 7): a bad spec writes NOTHING (validate
 * first). Each artefact is written atomically — tmp file → write → rename over
 * target → chmod 0600, dir 0700 (mirroring `credentials.ts`) — so a reader never
 * sees a half-written file. On a mid-write failure the guarantee depends on
 * whether the expert is new: a FRESH create (the dir did not pre-exist) is torn
 * down, leaving no partial directory behind (all-or-nothing); a RE-MATERIALIZE
 * over an existing expert is per-file atomic and dir-preserving — it is NOT a
 * cross-file transaction, so on failure the prior expert is left intact and is
 * never served half-refined (a referenced-but-missing body fails the read closed
 * — see `readAgentProfile`). The catch block below encodes exactly this split.
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

/** Artefact filenames (stable — the sil skill resolves them from profile.json,
 * but the names are also documented so a human can find them). The three SDS
 * *specs* carry the `_spec.md` suffix; `playbook.md` (taste) does not. */
const DOMAIN_SPEC_FILE = "domain_spec.md";
const INTENT_SPEC_FILE = "intent_spec.md";
const USER_SPEC_FILE = "user_spec.md";
const PLAYBOOK_FILE = "playbook.md";
const PROFILE_FILE = "profile.json";

/**
 * The validated spec the engine hands the store. `agentId` is the host agent
 * id (the `agents.list[].id` the host CLI created); the artefact directory is
 * keyed by it so the sil skill can resolve "this agent's behaviour" at runtime.
 */
export interface ProfileSpec {
  /** Host agent id — the directory key. Lower-kebab, not `main` (host-reserved). */
  agentId: string;
  /** Human-readable expert name (recorded in the manifest). */
  name: string;
  /** The SDS domain spec — deep researched niche expertise (how to buy well, the
   * full mechanics), authored at creation and web-refreshed every query. REQUIRED
   * and non-blank: a created expert always carries a domain spec (SDS is the
   * operating model, not an optional layer). */
  domainSpec: string;
  /** The SDS intent spec — the agent-specific decomposition DIMENSIONS (a
   * PRD-style schema) a query must resolve, derived from `domainSpec` at creation.
   * REQUIRED and non-blank. NOTE: this is the *dimension schema only* — the
   * per-query intent (dimensions filled in for one request) is EPHEMERAL and is
   * never passed here or persisted. */
  intentSpec: string;
  /** The SDS user spec — the user's domain-relevant facts + hard constraints.
   * REQUIRED and non-blank (Founder review round 2): present from creation
   * (seeded partial by the ≤10-question setup), then AUGMENTED every query.
   * Per-user + per-expert, local. */
  userSpec: string;
  /** The SDS playbook — the user's buying TASTE (price sensitivity, brand,
   * preferences). REQUIRED and non-blank: present from creation (seeded partial),
   * then AUGMENTED every query. */
  playbook: string;
}

/** The strictly-typed manifest persisted as `profile.json`. The sil skill reads
 * this to locate + load the behaviour artefacts for the active agent. */
export interface ProfileManifest {
  agentId: string;
  name: string;
  /** Absolute path to the SDS domain-spec artefact. REQUIRED — a created expert
   * always has a domain spec; `readManifestFile` gates on it. */
  domainSpecPath: string;
  /** Absolute path to the SDS intent-spec (dimension schema) artefact. REQUIRED —
   * a created expert always has an intent spec; `readManifestFile` gates on it. */
  intentSpecPath: string;
  /** Absolute path to the SDS user-spec artefact. REQUIRED — a created expert
   * always carries a user spec (seeded partial at creation); `readManifestFile`
   * gates on it. */
  userSpecPath: string;
  /** Absolute path to the SDS playbook artefact. REQUIRED — a created expert
   * always carries a buying-taste playbook (seeded partial at creation);
   * `readManifestFile` gates on it. */
  playbookPath: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

/** The discriminated result the store returns — never throws across the
 * boundary; the tool maps each variant to the structured envelope. */
export type MaterializeResult =
  | {
      ok: true;
      agentId: string;
      /** The artefact directory ($SIL_DATA_DIR/agents/<agentId>). */
      dir: string;
      domainSpecPath: string;
      intentSpecPath: string;
      userSpecPath: string;
      playbookPath: string;
      profilePath: string;
    }
  | {
      ok: false;
      kind: "invalid_request";
      /** The offending spec field. */
      field: string;
      message: string;
    }
  | {
      ok: false;
      kind: "persistence_failed";
      /** "<dir>: <cause>" so recovery is actionable. */
      error: string;
      message: string;
    };

/** A host-agent id must be lower-kebab and is never `main` (host-reserved). */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Resolve the per-agent artefact directory under the plugin's data dir. Never
 * hardcoded — `getDataDir()` honors `$SIL_DATA_DIR`/`$XDG_DATA_HOME`.
 *
 * SAFETY: this resolver does NOT guard `agentId` — it joins it as a path segment
 * verbatim. The path-traversal guard lives at the only caller, `materializeProfile`,
 * which validates `agentId` against `AGENT_ID_RE` (lower-kebab, not `main`) BEFORE
 * the join, so a traversal-shaped id (a parent-directory hop, a nested back-step,
 * a bare dot) never reaches here. The guard is
 * placed at the caller (not here) because validation must precede ALL writes for
 * the validate-first / write-nothing-on-bad-input invariant to hold; a guard
 * duplicated here would be redundant for that path. A FUTURE DIRECT CALLER of this
 * exported resolver would bypass the guard — re-run `AGENT_ID_RE` (or route through
 * `materializeProfile`) before trusting the returned path with any filesystem op. */
export function getAgentArtefactDir(agentId: string): string {
  return join(getDataDir(), AGENTS_SUBDIR, agentId);
}

/** True when `s` is a present, non-blank string. */
function nonBlank(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function invalid(field: string, message: string): MaterializeResult {
  return { ok: false, kind: "invalid_request", field, message };
}

/**
 * Materialize the behaviour artefacts for a created sil-wired agent.
 *
 * Validate-first: any invalid field returns `invalid_request` and writes
 * NOTHING. On a write failure, the partial directory is removed and
 * `persistence_failed` is returned with `<dir>: <cause>` — no partial artefact
 * set ever survives (Product invariant 7, atomic outcome).
 */
export function materializeProfile(spec: ProfileSpec): MaterializeResult {
  // --- validate-first (nothing is written until every field is good) ---
  if (!nonBlank(spec.agentId)) {
    return invalid("agentId", "agentId is required and must be non-empty.");
  }
  if (spec.agentId === "main") {
    return invalid("agentId", '"main" is host-reserved and cannot be a sil expert id.');
  }
  if (!AGENT_ID_RE.test(spec.agentId)) {
    return invalid(
      "agentId",
      "agentId must be lower-kebab (a-z, 0-9, hyphen) — got: " + JSON.stringify(spec.agentId),
    );
  }
  if (!nonBlank(spec.name)) {
    return invalid("name", "name is required and must be non-empty.");
  }
  // All FOUR SDS specs are REQUIRED at creation — SDS is the operating model,
  // not an optional layer. A created expert always carries all four (Founder
  // review round 2): they are seeded *partial* at creation, then augmented every
  // query. A present-but-blank or omitted spec is rejected (validate-first; write
  // nothing).
  if (!nonBlank(spec.domainSpec)) {
    return invalid("domainSpec", "domainSpec is required and must be non-empty.");
  }
  if (!nonBlank(spec.intentSpec)) {
    return invalid("intentSpec", "intentSpec is required and must be non-empty.");
  }
  if (!nonBlank(spec.userSpec)) {
    return invalid("userSpec", "userSpec is required and must be non-empty.");
  }
  if (!nonBlank(spec.playbook)) {
    return invalid("playbook", "playbook is required and must be non-empty.");
  }

  const dir = getAgentArtefactDir(spec.agentId);
  const domainSpecPath = join(dir, DOMAIN_SPEC_FILE);
  const intentSpecPath = join(dir, INTENT_SPEC_FILE);
  const userSpecPath = join(dir, USER_SPEC_FILE);
  const playbookPath = join(dir, PLAYBOOK_FILE);
  const profilePath = join(dir, PROFILE_FILE);

  const manifest: ProfileManifest = {
    agentId: spec.agentId,
    name: spec.name,
    domainSpecPath,
    intentSpecPath,
    userSpecPath,
    playbookPath,
    createdAt: new Date().toISOString(),
  };

  // Whether the artefact directory already existed before this call. If it did,
  // it is not ours to delete on failure (it may hold a prior expert's artefacts,
  // or — if the path is occupied by a non-directory — a user's file). We only
  // remove what THIS call created (Product invariant 7: nothing partial, without
  // destroying anything pre-existing).
  const dirPreexisted = existsSync(dir);

  try {
    // Ensure the data home (`$SIL_DATA_DIR`, 0700) exists first — its creation
    // and mode are owned by credentials.ts (the data-dir owner), and this also
    // re-heals it if it was deleted mid-session. Then create the per-agent leaf
    // (`agents/<id>`), which is profile-store's own concern.
    ensureDataDir();
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    atomicWrite(domainSpecPath, spec.domainSpec);
    atomicWrite(intentSpecPath, spec.intentSpec);
    atomicWrite(userSpecPath, spec.userSpec);
    atomicWrite(playbookPath, spec.playbook);
    atomicWrite(profilePath, JSON.stringify(manifest, null, 2) + "\n");
  } catch (err) {
    // Leave nothing partial behind — but only tear down the dir if WE created it.
    if (!dirPreexisted) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Cleanup is best-effort; the original cause is what the caller needs.
      }
    }
    const cause = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "persistence_failed",
      error: dir + ": " + cause,
      message:
        "The shopping-expert behaviour artefacts could NOT be written to the sil"
        + " data directory, so the profile did not stick. Fix the data directory"
        + " (it must be writable — check permissions / free space / that"
        + " $SIL_DATA_DIR is a directory), then create the expert again.",
    };
  }

  return {
    ok: true,
    agentId: spec.agentId,
    dir,
    domainSpecPath,
    intentSpecPath,
    userSpecPath,
    playbookPath,
    profilePath,
  };
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

// ===========================================================================
// Local expert lifecycle — list / view / remove the artefact half.
//
// The manifest (`profile.json`) is the source of truth for "is this a sil
// expert": a directory under `agents/<id>/` with a readable profile.json IS an
// expert; a bare host `agents.list[]` entry without one is not ours to manage.
// The host-config (wiring) half of list/remove is the host agent driving its
// own `openclaw …` CLI — these primitives only ever touch `$SIL_DATA_DIR`.
//
// Each primitive returns a discriminated result and NEVER throws across the
// boundary (mirroring MaterializeResult), so one corrupt manifest or a single
// failed delete degrades only its own outcome — never the whole operation.
// ===========================================================================

/** Resolve the agents subtree root under the plugin's data dir — the parent of
 * every per-agent artefact directory. The deleter asserts a target is strictly
 * a child of this (and never this itself), so a delete can never reach the
 * parent and wipe sibling experts. */
function getAgentsRoot(): string {
  return join(getDataDir(), AGENTS_SUBDIR);
}

/** Re-run the writer's exact `agentId` gate at a DIRECT caller of
 * `getAgentArtefactDir`. Returns `null` when valid; an `invalid_request`
 * variant naming the field otherwise. The gate is identical to
 * `materializeProfile`'s validate-first block (`AGENT_ID_RE` + non-`main`),
 * applied BEFORE any path join, read, or delete so a parent-directory traversal,
 * an absolute path, a bare dot, or `main` never becomes a filesystem path segment. `getAgentArtefactDir`'s SAFETY note
 * mandates exactly this for every direct caller — list does not (it never
 * trusts a caller-supplied id; it reads only ids it discovered on disk), but
 * read and remove DO take a caller id and so call this first. */
function rejectBadAgentId(
  agentId: unknown,
): { ok: false; kind: "invalid_request"; field: "agentId"; message: string } | null {
  if (!nonBlank(agentId)) {
    return invalidAgentId("agentId is required and must be non-empty.");
  }
  if (agentId === "main") {
    return invalidAgentId('"main" is host-reserved and is not a sil expert id.');
  }
  if (!AGENT_ID_RE.test(agentId)) {
    return invalidAgentId(
      "agentId must be lower-kebab (a-z, 0-9, hyphen) — got: " + JSON.stringify(agentId),
    );
  }
  return null;
}

function invalidAgentId(
  message: string,
): { ok: false; kind: "invalid_request"; field: "agentId"; message: string } {
  return { ok: false, kind: "invalid_request", field: "agentId", message };
}

/** One listed expert, summarized from its manifest (no body read — list stays
 * cheap). After Founder review round 2 every created expert carries all four SDS
 * specs (all required + present from creation), so per-slot presence flags would
 * be trivially true for every expert and carry no discriminating signal — the
 * list therefore exposes only the durable identity (agentId + name + createdAt). */
export interface ListedProfile {
  agentId: string;
  name: string;
  createdAt: string;
}

/** A `profile.json` that could not be read or parsed — surfaced inline so one
 * corrupt expert never blinds the user to the healthy ones (Product rule 6). */
export interface UnreadableProfile {
  /** The directory name (best-effort id); the manifest may be unreadable. */
  agentId: string;
  /** Human-readable cause (no token/PII — a parse error or fs error message). */
  error: string;
}

/** `listAgentProfiles()` result — always `ok: true` (an empty/absent store is a
 * normal, successful empty listing, not an error). The `ok` discriminator keeps
 * the shape uniform with the read/remove results so callers narrow identically. */
export interface ListResult {
  ok: true;
  experts: ListedProfile[];
  unreadable: UnreadableProfile[];
}

/** `readAgentProfile(agentId)` result — discriminated, never throws. */
export type ReadResult =
  | {
      ok: true;
      agentId: string;
      name: string;
      /** The SDS domain spec body. Always present for a created expert (required);
       * a referenced-but-missing body fails the read closed (`not_found`). */
      domainSpec: string;
      /** The SDS intent spec (dimension schema) body. Always present for a created
       * expert (required); a referenced-but-missing body fails the read closed. */
      intentSpec: string;
      /** The SDS user spec body. Always present for a created expert (required —
       * seeded partial at creation, augmented every query); a referenced-but-missing
       * body fails the read closed (`not_found`). */
      userSpec: string;
      /** The SDS playbook (taste) body. Always present for a created expert
       * (required — seeded partial at creation, augmented every query); a
       * referenced-but-missing body fails the read closed (`not_found`). */
      playbook: string;
      profilePath: string;
      createdAt: string;
    }
  | { ok: false; kind: "not_found"; agentId: string; message: string }
  | { ok: false; kind: "invalid_request"; field: "agentId"; message: string };

/** `removeAgentArtefacts(agentId)` result — discriminated, never throws. */
export type RemoveResult =
  | { ok: true; agentId: string }
  | { ok: false; kind: "not_found"; agentId: string; message: string }
  | { ok: false; kind: "invalid_request"; field: "agentId"; message: string }
  | {
      ok: false;
      kind: "persistence_failed";
      /** "<dir>: <cause>" so recovery is actionable. */
      error: string;
      message: string;
      recovery: "fix_data_dir";
    };

/** Read + parse one `agents/<id>/profile.json` into a typed manifest, or throw
 * a descriptive error the caller maps to an `unreadable`/`not_found` outcome.
 * A manifest whose JSON parses but is missing the required string fields is
 * treated as corrupt (an interrupted or hand-edited write) — not silently
 * coerced. */
function readManifestFile(profilePath: string): ProfileManifest {
  const raw = readFileSync(profilePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { agentId?: unknown }).agentId !== "string" ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { domainSpecPath?: unknown }).domainSpecPath !== "string" ||
    typeof (parsed as { intentSpecPath?: unknown }).intentSpecPath !== "string" ||
    typeof (parsed as { userSpecPath?: unknown }).userSpecPath !== "string" ||
    typeof (parsed as { playbookPath?: unknown }).playbookPath !== "string" ||
    typeof (parsed as { createdAt?: unknown }).createdAt !== "string"
  ) {
    throw new Error("profile.json is missing required manifest fields");
  }
  return parsed as ProfileManifest;
}

/**
 * Enumerate the materialized experts under each `$SIL_DATA_DIR/agents/<id>/`.
 *
 * The manifest is the source of truth — each `agents/<id>/profile.json` is read
 * and parsed (no dirname guessing). Experts are returned `createdAt` DESC (the
 * just-made expert first, the one the user most likely wants to act on). An
 * absent/empty store yields a normal empty listing. One unreadable or corrupt
 * manifest lands in `unreadable[]` and never aborts the listing — the healthy
 * experts still list. Reads only; never writes, never reads a token.
 */
export function listAgentProfiles(): ListResult {
  const root = getAgentsRoot();
  if (!existsSync(root)) {
    return { ok: true, experts: [], unreadable: [] };
  }

  const experts: ListedProfile[] = [];
  const unreadable: UnreadableProfile[] = [];

  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    // The agents root exists but cannot be enumerated (e.g. EACCES). Surface it
    // as a single degraded entry rather than throwing across the boundary.
    unreadable.push({
      agentId: AGENTS_SUBDIR,
      error: errCause(err),
    });
    return { ok: true, experts, unreadable };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agentId = entry.name;
    const profilePath = join(root, agentId, PROFILE_FILE);
    if (!existsSync(profilePath)) {
      // A directory under agents/ with no manifest is not a (loadable) sil
      // expert — report it degraded so the user sees the residue (e.g. a
      // remove that cleared the manifest but left a stray file).
      unreadable.push({ agentId, error: "no profile.json manifest" });
      continue;
    }
    try {
      const manifest = readManifestFile(profilePath);
      experts.push({
        agentId: manifest.agentId,
        name: manifest.name,
        createdAt: manifest.createdAt,
      });
    } catch (err) {
      unreadable.push({ agentId, error: errCause(err) });
    }
  }

  // Most-recently-created first (Product Flow 1). createdAt is ISO 8601, so a
  // lexical compare is also chronological; fall back to it when Date.parse is
  // NaN (a corrupt-but-parseable date) so the sort is total and stable-ish.
  experts.sort((a, b) => createdAtDesc(a.createdAt, b.createdAt));

  return { ok: true, experts, unreadable };
}

/** Compare two ISO 8601 createdAt strings, most-recent first. */
function createdAtDesc(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    // Lexical fallback keeps the sort total when a timestamp is unparseable.
    return a < b ? 1 : a > b ? -1 : 0;
  }
  return tb - ta;
}

/**
 * Read one expert's full detail — the manifest PLUS the SDS artefact bodies from
 * the files it points at — so the skill can render a complete view.
 *
 * Re-runs the writer's `agentId` gate BEFORE any `join`/read (a traversal-shaped
 * id → `invalid_request`, reading nothing). An unknown id, an absent/unreadable
 * manifest, or an absent body of ANY of the four REQUIRED SDS specs
 * (`domain_spec.md` / `intent_spec.md` / `user_spec.md` / `playbook.md`) →
 * `not_found` (Founder review round 2: all four always exist; a degraded expert
 * is, from the user's view, not viewable). There is no degrade-to-undefined path
 * any more — a referenced-but-missing body of any of the four fails the read
 * closed. Never throws across the boundary; reads only.
 */
export function readAgentProfile(agentId: string): ReadResult {
  const bad = rejectBadAgentId(agentId);
  if (bad) return bad;

  const dir = getAgentArtefactDir(agentId);
  const profilePath = join(dir, PROFILE_FILE);
  if (!existsSync(profilePath)) {
    return notFoundRead(agentId);
  }

  let manifest: ProfileManifest;
  try {
    manifest = readManifestFile(profilePath);
  } catch {
    // A corrupt/half-written manifest is, to the viewer, an expert that cannot
    // be loaded — surface not_found (the skill lists the healthy ones), never a
    // raw parse error across the boundary.
    return notFoundRead(agentId);
  }

  // All FOUR SDS spec bodies are REQUIRED for a created expert — they gate the
  // read fail-closed (the role the persona body played pre-SDS). A manifest that
  // points at a domain_spec.md / intent_spec.md / user_spec.md / playbook.md whose
  // body is gone (a partial write, a hand-deleted file) is, to the viewer, an
  // expert that cannot be loaded. This is the per-file-atomic, NOT-cross-file-
  // transactional safety boundary: a partial write degrades to a fail-closed
  // not_found, never a coherent-but-incomplete expert (Founder review round 2:
  // all four are present from creation, so none degrades to absence).
  let domainSpec: string;
  let intentSpec: string;
  let userSpec: string;
  let playbook: string;
  try {
    domainSpec = readFileSync(manifest.domainSpecPath, "utf8");
    intentSpec = readFileSync(manifest.intentSpecPath, "utf8");
    userSpec = readFileSync(manifest.userSpecPath, "utf8");
    playbook = readFileSync(manifest.playbookPath, "utf8");
  } catch {
    return notFoundRead(agentId);
  }

  return {
    ok: true,
    agentId: manifest.agentId,
    name: manifest.name,
    domainSpec,
    intentSpec,
    userSpec,
    playbook,
    profilePath,
    createdAt: manifest.createdAt,
  };
}

function notFoundRead(agentId: string): ReadResult {
  return {
    ok: false,
    kind: "not_found",
    agentId,
    message: 'No sil expert "' + agentId + '" — list your experts to see which exist.',
  };
}

/**
 * Remove one expert's behaviour-artefact directory — the sil-side half of a
 * clean removal (the host-wiring half is the skill's `openclaw` CLI step; the
 * plugin cannot write `~/.openclaw`).
 *
 * Fail-closed and scoped to exactly the named expert:
 *   - re-runs the writer's `agentId` gate ITSELF (never trusts the caller) — a
 *     bad/`main`/traversal-shaped id → `invalid_request`, deletes NOTHING;
 *   - asserts the resolved target is strictly UNDER `getDataDir()/agents/` and
 *     is NOT the `agents/` parent, so a delete can never escape the subtree or
 *     wipe sibling experts;
 *   - recursively delete the single validated leaf dir.
 *
 * Absent target → `not_found` (idempotent — a re-run after a partial host-CLI
 * failure is safe). A genuine delete failure (e.g. EACCES) →
 * `persistence_failed` with `<dir>: <cause>`. Never throws across the boundary.
 */
export function removeAgentArtefacts(agentId: string): RemoveResult {
  const bad = rejectBadAgentId(agentId);
  if (bad) return bad;

  const dir = getAgentArtefactDir(agentId);

  // Defence in depth beyond the id gate: assert the resolved path is strictly a
  // child of the agents root and never the root itself. Deleting the parent
  // directory would wipe every sibling expert — refuse it even if some future
  // change to the gate let a separator-bearing id through.
  const root = getAgentsRoot();
  if (dirname(dir) !== root || dir === root) {
    return invalidAgentId(
      "agentId resolves outside the agents subtree — refusing to delete: " +
        JSON.stringify(agentId),
    );
  }

  if (!existsSync(dir)) {
    return {
      ok: false,
      kind: "not_found",
      agentId,
      message:
        'No sil expert "' + agentId + '" to remove (already gone) — list your'
        + " experts to see which exist. A re-run is safe (idempotent).",
    };
  }

  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    return {
      ok: false,
      kind: "persistence_failed",
      error: dir + ": " + errCause(err),
      message:
        "The expert's behaviour artefacts could NOT be removed from the sil data"
        + " directory. Fix the data directory (it must be writable — check"
        + " permissions), then remove the expert again.",
      recovery: "fix_data_dir",
    };
  }

  return { ok: true, agentId };
}

/** Extract a human-readable cause from an unknown thrown value (never PII). */
function errCause(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
