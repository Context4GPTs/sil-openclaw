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
 *     └─ profile.json   the strictly-typed manifest the sil skill resolves the
 *                       artefacts from (no filesystem guessing)
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
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
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
 * hardcoded — `getDataDir()` honors `$SIL_DATA_DIR`/`$XDG_DATA_HOME`. */
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

  const dir = getAgentArtefactDir(spec.agentId);
  const personaPath = join(dir, PERSONA_FILE);
  const playbookPath = spec.playbook !== undefined ? join(dir, PLAYBOOK_FILE) : undefined;
  const profilePath = join(dir, PROFILE_FILE);

  const manifest: ProfileManifest = {
    agentId: spec.agentId,
    name: spec.name,
    personaPath,
    ...(playbookPath ? { playbookPath } : {}),
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
