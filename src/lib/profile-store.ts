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
 * `lib/credentials.ts` uses for tokens/identity). Per the founder steer
 * (2026-06-22) the engine writes a fixed, minimal set of artefacts there that
 * power the created expert's behaviour, read by the sil skill at runtime:
 *
 *   $SIL_DATA_DIR/agents/<agentId>/
 *     ├─ persona.md     the shopping persona/instructions (host-natural —
 *     │                 same shape as a workspace SOUL.md; the skill copies it
 *     │                 into the agent workspace SOUL.md and re-reads it at
 *     │                 session start)
 *     ├─ playbook.md    the generated domain sub-skill (host-natural — same
 *     │                 shape as a SKILL.md body; loaded by the sil skill at
 *     │                 session start). OPTIONAL — written only when supplied.
 *     ├─ domain.md      the SDS domain spec — the niche's researched decision-
 *     │                 dimensions and how they trade off (last/width/volume,
 *     │                 terrain, gait…), converged at creation. OPTIONAL —
 *     │                 written only when supplied.
 *     ├─ user.md        the SDS user spec — this user's standing niche-relevant
 *     │                 attributes + hard constraints, captured on first shop
 *     │                 and reused. OPTIONAL — written only when supplied.
 *     └─ profile.json   the strictly-typed manifest the sil skill resolves the
 *                       artefacts from (no filesystem guessing)
 *
 * The four behaviour bodies are four INDEPENDENT optional-or-required slots,
 * NOT one blended file: persona (required) + playbook + domain spec + user spec
 * (each optional, absent-is-fine). They have distinct lifecycles — persona +
 * playbook + domain spec are authored at creation; the user spec is captured on
 * first shop; all four are refine-mutable in place. The intent spec is NOT a
 * slot here: it is per-request and ephemeral, derived in the conversation and
 * never persisted.
 *
 * Store boundary: host config = wiring; `$SIL_DATA_DIR` = behaviour artefacts.
 * Identity/tokens already live in `$SIL_DATA_DIR` but stay logically separate
 * (no identity coupling — creating an expert reads/writes no token).
 *
 * Writes are atomic and all-or-nothing (Product invariant 7): a bad spec
 * writes NOTHING (validate first), and a mid-write failure leaves no partial
 * artefact directory behind. The atomic write mirrors `credentials.ts` —
 * tmp file → write → rename over target → chmod 0600, dir 0700.
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

import { getDataDir } from "./credentials.js";

/** Owner-only file/dir modes — the artefacts are user-scoped, like tokens. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** The sub-tree under `$SIL_DATA_DIR` that holds per-agent behaviour artefacts. */
const AGENTS_SUBDIR = "agents";

/** Artefact filenames (stable — the sil skill resolves them from profile.json,
 * but the names are also documented so a human can find them). */
const PERSONA_FILE = "persona.md";
const PLAYBOOK_FILE = "playbook.md";
const DOMAIN_FILE = "domain.md";
const USER_FILE = "user.md";
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
  /** The shopping persona/instructions — non-empty. */
  persona: string;
  /** The generated domain sub-skill playbook — optional, non-blank when present. */
  playbook?: string;
  /** The SDS domain spec — the niche's researched decision-dimensions and how
   * they trade off, converged at creation. Optional, non-blank when present
   * (same discipline as `playbook`): an absent domain spec is a valid state, a
   * present-but-blank one is rejected. */
  domainSpec?: string;
  /** The SDS user spec — this user's standing niche-relevant attributes + hard
   * constraints, captured on first shop and reused. Optional, non-blank when
   * present (same discipline as `playbook`). Per-user + per-expert, local. */
  userSpec?: string;
}

/** The strictly-typed manifest persisted as `profile.json`. The sil skill reads
 * this to locate + load the behaviour artefacts for the active agent. */
export interface ProfileManifest {
  agentId: string;
  name: string;
  /** Absolute path to the persona artefact. */
  personaPath: string;
  /** Absolute path to the playbook artefact, when one was materialized. */
  playbookPath?: string;
  /** Absolute path to the SDS domain-spec artefact, when one was materialized.
   * Absent on a pre-SDS expert — a valid state (mirrors `playbookPath`), NOT a
   * field `readManifestFile` requires. */
  domainSpecPath?: string;
  /** Absolute path to the SDS user-spec artefact, when one was materialized.
   * Absent until first-shop capture — a valid state (mirrors `playbookPath`). */
  userSpecPath?: string;
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
      personaPath: string;
      playbookPath?: string;
      domainSpecPath?: string;
      userSpecPath?: string;
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
 * the join, so `../escape`, `a/../b`, `.`, etc. never reach here. The guard is
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
  if (!nonBlank(spec.persona)) {
    return invalid("persona", "persona is required and must be non-empty.");
  }
  // playbook is optional, but if present it must be non-blank (an empty string
  // would materialize a useless artefact — reject it loudly rather than write it).
  if (spec.playbook !== undefined && !nonBlank(spec.playbook)) {
    return invalid("playbook", "playbook, when provided, must be non-empty.");
  }
  // domainSpec / userSpec are the two SDS slots — optional, but present-but-blank
  // is rejected exactly like playbook (a blank spec is not a spec; write nothing).
  if (spec.domainSpec !== undefined && !nonBlank(spec.domainSpec)) {
    return invalid("domainSpec", "domainSpec, when provided, must be non-empty.");
  }
  if (spec.userSpec !== undefined && !nonBlank(spec.userSpec)) {
    return invalid("userSpec", "userSpec, when provided, must be non-empty.");
  }

  const dir = getAgentArtefactDir(spec.agentId);
  const personaPath = join(dir, PERSONA_FILE);
  const playbookPath = spec.playbook !== undefined ? join(dir, PLAYBOOK_FILE) : undefined;
  const domainSpecPath = spec.domainSpec !== undefined ? join(dir, DOMAIN_FILE) : undefined;
  const userSpecPath = spec.userSpec !== undefined ? join(dir, USER_FILE) : undefined;
  const profilePath = join(dir, PROFILE_FILE);

  const manifest: ProfileManifest = {
    agentId: spec.agentId,
    name: spec.name,
    personaPath,
    ...(playbookPath ? { playbookPath } : {}),
    ...(domainSpecPath ? { domainSpecPath } : {}),
    ...(userSpecPath ? { userSpecPath } : {}),
    createdAt: new Date().toISOString(),
  };

  // Whether the artefact directory already existed before this call. If it did,
  // it is not ours to delete on failure (it may hold a prior expert's artefacts,
  // or — if the path is occupied by a non-directory — a user's file). We only
  // remove what THIS call created (Product invariant 7: nothing partial, without
  // destroying anything pre-existing).
  const dirPreexisted = existsSync(dir);

  try {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    atomicWrite(personaPath, spec.persona);
    if (playbookPath && spec.playbook !== undefined) {
      atomicWrite(playbookPath, spec.playbook);
    }
    if (domainSpecPath && spec.domainSpec !== undefined) {
      atomicWrite(domainSpecPath, spec.domainSpec);
    }
    if (userSpecPath && spec.userSpec !== undefined) {
      atomicWrite(userSpecPath, spec.userSpec);
    }
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
    personaPath,
    ...(playbookPath ? { playbookPath } : {}),
    ...(domainSpecPath ? { domainSpecPath } : {}),
    ...(userSpecPath ? { userSpecPath } : {}),
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
 * applied BEFORE any `join`/`read`/`rm` so a `../`, `/`, `.`, or `main` never
 * becomes a filesystem path segment. `getAgentArtefactDir`'s SAFETY note
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
 * cheap). The boolean flags are read straight off the manifest's `*Path` fields
 * (no artefact-body read), so the skill can flag a specialized / SDS-equipped
 * expert at a glance: `hasPlaybook` a domain sub-skill, `hasDomainSpec` a
 * researched domain spec, `hasUserSpec` a captured user spec. */
export interface ListedProfile {
  agentId: string;
  name: string;
  hasPlaybook: boolean;
  hasDomainSpec: boolean;
  hasUserSpec: boolean;
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
      persona: string;
      playbook?: string;
      /** The SDS domain spec body, when one was materialized (optional, like
       * `playbook` — absent is a valid state, never makes the expert unviewable). */
      domainSpec?: string;
      /** The SDS user spec body, when one was captured (optional, like `playbook`). */
      userSpec?: string;
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
    typeof (parsed as { personaPath?: unknown }).personaPath !== "string" ||
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
        hasPlaybook: manifest.playbookPath !== undefined,
        hasDomainSpec: manifest.domainSpecPath !== undefined,
        hasUserSpec: manifest.userSpecPath !== undefined,
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
 * Read one expert's full detail — the manifest PLUS the persona/playbook bodies
 * from the files it points at — so the skill can render a complete view.
 *
 * Re-runs the writer's `agentId` gate BEFORE any `join`/read (a traversal-shaped
 * id → `invalid_request`, reading nothing). An unknown id, an absent/unreadable
 * manifest, or an absent persona body → `not_found` (a degraded expert is, from
 * the user's view, not viewable). Never throws across the boundary; reads only.
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

  let persona: string;
  try {
    persona = readFileSync(manifest.personaPath, "utf8");
  } catch {
    // Manifest present but its persona body is gone (a partial removal, or a
    // hand-deleted file) — the expert is not viewable.
    return notFoundRead(agentId);
  }

  let playbook: string | undefined;
  if (manifest.playbookPath !== undefined) {
    try {
      playbook = readFileSync(manifest.playbookPath, "utf8");
    } catch {
      // The playbook is optional detail; its absence does not make the expert
      // unviewable. Render the rest without it.
      playbook = undefined;
    }
  }

  // The two SDS bodies degrade EXACTLY like playbook: optional, absent-is-fine,
  // and a referenced-but-missing body never makes the expert unviewable. The
  // expert remains coherent on persona alone — a half-written domain/user spec
  // (manifest points at it, file gone) reads back as "no spec", never as a
  // broken expert. This is the per-file-atomic, NOT-cross-file-transactional
  // safety boundary: a partial write degrades to absence, it does not brick.
  let domainSpec: string | undefined;
  if (manifest.domainSpecPath !== undefined) {
    try {
      domainSpec = readFileSync(manifest.domainSpecPath, "utf8");
    } catch {
      domainSpec = undefined;
    }
  }

  let userSpec: string | undefined;
  if (manifest.userSpecPath !== undefined) {
    try {
      userSpec = readFileSync(manifest.userSpecPath, "utf8");
    } catch {
      userSpec = undefined;
    }
  }

  return {
    ok: true,
    agentId: manifest.agentId,
    name: manifest.name,
    persona,
    ...(playbook !== undefined ? { playbook } : {}),
    ...(domainSpec !== undefined ? { domainSpec } : {}),
    ...(userSpec !== undefined ? { userSpec } : {}),
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
 *   - `rmSync(dir, { recursive, force })` the single leaf dir.
 *
 * Absent target → `not_found` (idempotent — a re-run after a partial host-CLI
 * failure is safe). A genuine `rmSync` failure (e.g. EACCES) →
 * `persistence_failed` with `<dir>: <cause>`. Never throws across the boundary.
 */
export function removeAgentArtefacts(agentId: string): RemoveResult {
  const bad = rejectBadAgentId(agentId);
  if (bad) return bad;

  const dir = getAgentArtefactDir(agentId);

  // Defence in depth beyond the id gate: assert the resolved path is strictly a
  // child of the agents root and never the root itself. A `rmSync` of the
  // parent would wipe every sibling expert — refuse it even if some future
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
