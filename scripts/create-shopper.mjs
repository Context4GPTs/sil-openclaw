#!/usr/bin/env node
/**
 * Operator bin: create the user's ONE sil-wired shopper in a single atomic run.
 *
 * This is Change 3 of the onboarding-ux plan — it collapses the nine-step,
 * agent-driven host-CLI choreography (`agent_creation_engine.md`) into ONE shipped
 * package `bin`, a sibling of `scripts/allowlist-openclaw.mjs`. Like that bin it is
 * a standalone operator script — NOT the plugin process — so the plugin's
 * "never write host config / `noChildProcess: true`" guarantees do not bind it; it
 * legitimately drives `openclaw …` via `execFileSync`.
 *
 * It runs POST-endorsement: the interview (`brainstorm_interview.md`) owns the
 * consent gate; this bin executes an already-assembled, already-endorsed spec
 * non-interactively. It never prompts, never re-runs the interview.
 *
 * Input — ONE JSON object `{ agentId, name, workspace, persona, userSpec, channel? }`,
 * read from stdin (primary) or `--spec <path>` (fallback). Passing multiline
 * persona/userSpec as JSON dodges shell-arg escaping. Unparseable/blank input →
 * `invalid_request`, nothing attempted. `channel` is OPTIONAL — the current-channel
 * override for the step-10 bind; absent/blank is fail-open, never invalid_request.
 *
 * Choreography (validate-first, then atomic, fail-closed):
 *   1. validate the spec           — bad/blank field ⇒ invalid_request, nothing attempted
 *   2. resolve the host config     — none ⇒ persistence_failed (precondition), nothing written
 *   3. singleton + agentId pre-flight — a shopper OR the agentId already exists ⇒ collision;
 *      an INCONCLUSIVE read (degraded store / CLI error) fails closed — never fabricates
 *      a "no shopper" verdict, never proceeds to `agents add`
 *   4. snapshot openclaw.json      — the whole-file teardown anchor, taken BEFORE step 5
 *   5. openclaw agents add         — create the real agents.list entry + workspace bootstrap
 *   6. write <workspace>/SOUL.md   — the persona (atomic tmp→rename); never a sil artefact
 *   7. materializeProfile          — REUSED; SETUP-ONLY { name, userSpec } ⇒ shared
 *                                    user_spec.md (its frontmatter carries the name);
 *                                    NO manifest, no domain minted at create
 *   8. attach the sil skill + enable the sil plugin (openclaw config set --strict-json)
 *   9. sil-openclaw-allowlist      — REUSED whole; additive/idempotent/atomic three-surface
 *                                    trust merge (plugins.allow + tools.alsoAllow + plugins.entries.sil)
 *  10. bind the current channel    — FAIL-OPEN convenience, NOT fail-closed: resolve the channel
 *                                    (spec.channel > OPENCLAW_MCP_MESSAGE_CHANNEL), bind + VERIFY
 *                                    from the JSON verdict (never the exit code), keep a verified
 *                                    route, revert an unverifiable one; an undetermined/unverifiable
 *                                    channel degrades to a manual-bind hint — it NEVER fails creation
 *  11. openclaw config validate    — success keys off `.valid`, never an `ok` field
 *  12. one { status, … } JSON result; exit 0 ONLY on `created`.
 *
 * Teardown on ANY failure after step 5 = whole-file snapshot-restore of
 * openclaw.json (reverses the agents.list entry + skill + plugin + trust in ONE
 * atomic op, superseding the allowlist bin's inner `.bak`), plus removal of the
 * workspace dir (only if WE created it) and the singleton shopper dir (only if it
 * did not pre-exist — the singleton pre-flight guarantees it was ours). This
 * returns the host to its EXACT pre-run state, so a co-installed `klodi` that was
 * trusted pre-run stays trusted. A teardown that CANNOT fully revert is a distinct,
 * LOUDER outcome (`teardown_failed`) that names the residue — never a green-washed
 * `persistence_failed`.
 *
 * The step-10 channel bind is the ONE step that never routes into teardown: it is
 * fail-open by design (a convenience, not a precondition), so it self-reverts a bad
 * bind in place and continues. Because a VERIFIED route lives in openclaw.json, the
 * step-4 snapshot restore reverses it FOR FREE if any earlier-or-later step then
 * fails — no `agents unbind`, no bind-specific teardown code.
 *
 * Outcome taxonomy (four terminal, + the louder teardown_failed), in sil's
 * `snake_case_marker` NDJSON style (no api.logger outside the gateway). No PII, no
 * secrets — the persona/userSpec text is NEVER logged:
 *   - created            (info,  stdout) — carries name + agentId + workspace [+ warnings]
 *   - invalid_request    (error, stderr) — bad/blank spec; nothing attempted; names the field
 *   - collision          (error, stderr) — singleton / agentId clash; nothing written
 *   - persistence_failed (error, stderr) — a step failed after writes began; teardown fully
 *                                          reverted; nothing partial; names path + cause
 *   - teardown_failed    (error, stderr) — teardown could NOT fully revert; names the residue
 *
 * All real write/merge logic lives in the typed libs (`materializeProfile` from
 * `dist/lib/profile-store.js`, the `sil-openclaw-allowlist` bin). This shell is
 * thin choreography + teardown only — it re-implements none of it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  materializeProfile,
  readShopperIdentity,
  getShopperArtefactDir,
} from "../dist/lib/profile-store.js";
import { resolveBindChannel } from "../dist/lib/bind-channel.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The sibling operator bin that performs the additive, self-validating trust merge. */
const ALLOWLIST_BIN = resolve(ROOT, "scripts", "allowlist-openclaw.mjs");
/** The shipped plugin manifest — the single source of truth for sil's facts (id,
 * skill name), read the same way `scripts/allowlist-openclaw.mjs` reads it. */
const MANIFEST_PATH = resolve(ROOT, "openclaw.plugin.json");

/** A shopper id path-segment shape — lower-kebab, never `main` (host-reserved). */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const CREATED_EVENT = "sil_shopper_created";
const FAILED_EVENT = "sil_shopper_create_failed";

/** Emit one structured NDJSON line in sil's marker style: `{event, level, ...}`. */
function logMarker(stream, level, event, fields) {
  stream.write(JSON.stringify({ event, level, ...fields }) + "\n");
}

/** Terminal success emit — one `created` object on stdout, exit 0. */
function emitCreated(fields) {
  logMarker(process.stdout, "info", CREATED_EVENT, { status: "created", ...fields });
  process.exit(0);
}

/** Terminal failure emit — one object on stderr carrying the taxonomy `status`,
 * exit 1. Never carries persona/userSpec text. */
function emitFailure(status, fields) {
  logMarker(process.stderr, "error", FAILED_EVENT, { status, ...fields });
  process.exit(1);
}

/** True when `s` is a present, non-blank string. */
function nonBlank(s) {
  return typeof s === "string" && s.trim().length > 0;
}

/** Human-readable cause from an unknown thrown value (never PII). */
function errCause(err) {
  return err instanceof Error ? err.message : String(err);
}

/** Atomic single-file write: tmp sibling → write → rename over target, preserving
 * the given mode. A reader sees the old file or the new one, never a half-written
 * one (mirrors `allowlist-openclaw.mjs` / `profile-store.ts`). */
function atomicWrite(path, contents, mode) {
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, contents, mode !== undefined ? { mode } : undefined);
  renameSync(tmp, path);
}

/** Resolve the host config path by precedence (first existing wins) — identical to
 * `allowlist-openclaw.mjs` so every subprocess agrees on ONE config file. Returns
 * the resolved path, or null if none exists (caller fails closed). */
function resolveConfigPath() {
  const candidates = [];
  if (process.env["OPENCLAW_CONFIG_PATH"]) {
    candidates.push(process.env["OPENCLAW_CONFIG_PATH"]);
  }
  if (process.env["OPENCLAW_STATE_DIR"]) {
    candidates.push(join(process.env["OPENCLAW_STATE_DIR"], "openclaw.json"));
  }
  candidates.push(join(homedir(), ".openclaw", "openclaw.json"));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Read the raw spec text — `--spec <path>` if present, else stdin (fd 0). Returns
 * `{ raw }` or `{ error }` (a structured cause, never the spec contents). */
function readSpecRaw() {
  const argv = process.argv.slice(2);
  const specIdx = argv.indexOf("--spec");
  if (specIdx >= 0) {
    const path = argv[specIdx + 1];
    if (!path) return { error: "--spec requires a file path argument" };
    try {
      return { raw: readFileSync(path, "utf8") };
    } catch (err) {
      return { error: "could not read --spec file: " + errCause(err) };
    }
  }
  try {
    return { raw: readFileSync(0, "utf8") };
  } catch (err) {
    return { error: "could not read the spec from stdin: " + errCause(err) };
  }
}

/** Validate the endorsed spec — deterministic field order (agentId → name →
 * workspace → persona → userSpec). Returns `{ field, message }` on the FIRST bad
 * field, or null when the whole spec is good. Writes/attempts nothing. `channel`
 * is deliberately NOT validated: it is an optional fail-open convenience, so an
 * absent/blank/malformed channel is never invalid_request — it folds to `null` in
 * `resolveBindChannel` and degrades to a manual-bind hint at step 10. */
function validateSpec(spec) {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    return {
      field: "spec",
      message: "spec must be a JSON object with { agentId, name, workspace, persona, userSpec, channel? }.",
    };
  }
  if (!nonBlank(spec.agentId)) {
    return { field: "agentId", message: "agentId is required and must be non-empty." };
  }
  if (spec.agentId === "main") {
    return { field: "agentId", message: '"main" is host-reserved and cannot be an agentId.' };
  }
  if (!AGENT_ID_RE.test(spec.agentId)) {
    return {
      field: "agentId",
      message: "agentId must be lower-kebab (a-z, 0-9, hyphen) — got: " + JSON.stringify(spec.agentId),
    };
  }
  if (!nonBlank(spec.name)) {
    return { field: "name", message: "name is required and must be non-empty." };
  }
  if (!nonBlank(spec.workspace)) {
    return { field: "workspace", message: "workspace is required and must be non-empty." };
  }
  if (!nonBlank(spec.persona)) {
    return { field: "persona", message: "persona is required and must be non-empty." };
  }
  if (!nonBlank(spec.userSpec)) {
    return { field: "userSpec", message: "userSpec is required and must be non-empty." };
  }
  return null;
}

/** Run `openclaw <args>` pinned to the resolved config. Returns
 * `{ ok, stdout, stderr, code }` — never throws across the boundary. */
function runOpenclaw(args, configPath) {
  try {
    const stdout = execFileSync("openclaw", args, {
      env: { ...process.env, OPENCLAW_CONFIG_PATH: configPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "", code: 0 };
  } catch (err) {
    return {
      ok: false,
      stdout: typeof err?.stdout === "string" ? err.stdout : "",
      stderr: typeof err?.stderr === "string" ? err.stderr : "",
      code: err?.code,
    };
  }
}

/** Read + parse the host config JSON, or null on any read/parse failure. */
function readConfig(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

/** Resolve the sil SKILL's published name to attach at `agents.list[i].skills`,
 * single-sourced from the shipped manifest (mirrors `allowlist-openclaw.mjs`'s
 * `readSilFacts`). A skill attaches by its PUBLISHED name = the skill-dir basename
 * = `basename(openclaw.plugin.json#skills[0])` (`sil-shopping`) — NOT the plugin id
 * (`sil`), which is the tools/trust key. The per-agent attach is the ONLY skill
 * surface (no global skill allow-list), so the plugin id here loads no skill at
 * all. Fail-closed: an unreadable manifest or a blank/absent `skills[0]` returns
 * `{ error }` so the create errors rather than attaching `[""]`. */
function readSkillAttachName() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (err) {
    return { error: "the shipped manifest " + MANIFEST_PATH + " is not readable/parseable JSON: " + errCause(err) };
  }
  const ref = Array.isArray(manifest.skills) ? manifest.skills[0] : undefined;
  if (!nonBlank(ref)) {
    return { error: "the shipped manifest " + MANIFEST_PATH + " declares no skills[0] — cannot resolve the sil skill name to attach" };
  }
  const name = basename(ref);
  if (!nonBlank(name)) {
    return { error: "the shipped manifest skills[0] " + JSON.stringify(ref) + " has no usable basename" };
  }
  return { name };
}

/** The agentId path-segment ids already registered in the host config's
 * `agents.list` — the authoritative, shim-independent clash source. */
function existingAgentIds(config) {
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  return list.map((a) => a?.id).filter((id) => typeof id === "string");
}

/** The index of `agentId` in `agents.list`, or -1 (used to target the skill attach). */
function agentIndex(config, agentId) {
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  return list.findIndex((a) => a?.id === agentId);
}

/** Best-effort web-capability check (SA ruling: warn, never hard-fail). The shopper
 * lazily mints/refreshes a domain over the web (inherited from `agents.defaults`);
 * bare `sil_search` works without it. Warn ONLY when `agents.defaults` is present
 * yet names no web/fetch capability — never fabricate a gap on an absent defaults
 * block (the host may grant web by other means). */
function webCapabilityWarnings(config) {
  const defaults = config?.agents?.defaults;
  if (defaults === undefined || defaults === null || typeof defaults !== "object") return [];
  const json = JSON.stringify(defaults).toLowerCase();
  const WEB_TOKENS = ["web", "fetch", "browse", "http"];
  if (WEB_TOKENS.some((t) => json.includes(t))) return [];
  return [
    "the created shopper inherits its tool profile from agents.defaults, which does not appear to"
      + " grant a web/fetch tool — a domain cannot be lazily minted or web-refreshed without it"
      + " (bare sil_search still works). Confirm agents.defaults grants a web capability.",
  ];
}

/** True iff `openclaw config validate --json` reported `{valid:true}`. The host
 * writes its verdict to stdout even on a non-zero exit, so read stdout, never the
 * exit code (fail closed if it is not JSON). */
function configValidates(stdout) {
  try {
    const verdict = JSON.parse(stdout);
    return verdict !== null && verdict.valid === true;
  } catch {
    return false;
  }
}

/** True iff `openclaw agents bind --json` reported the channel APPLIED — landed in
 * `added` or `updated`, with an EMPTY `conflicts`. `agents bind` exits 0 even on a
 * conflict or an empty `--bind`, so the JSON verdict — never the exit code — is the
 * source of truth (the same discipline the bin applies to `config validate.valid`). */
function bindApplied(stdout) {
  let v;
  try {
    v = JSON.parse(stdout);
  } catch {
    return false;
  }
  if (v === null || typeof v !== "object") return false;
  const added = Array.isArray(v.added) ? v.added : [];
  const updated = Array.isArray(v.updated) ? v.updated : [];
  const conflicts = Array.isArray(v.conflicts) ? v.conflicts : [];
  return (added.length > 0 || updated.length > 0) && conflicts.length === 0;
}

/** True iff the `openclaw agents bindings --json` read-back (an ARRAY of
 * `{agentId, match:{channel}}`) actually shows the route `<channel> → <agentId>`.
 * This is the honesty rail: a bind is only "verified" once the read-back proves the
 * write stuck — issuing the write is not the same as the next message reaching it. */
function bindingPresent(stdout, agentId, channel) {
  let v;
  try {
    v = JSON.parse(stdout);
  } catch {
    return false;
  }
  if (!Array.isArray(v)) return false;
  return v.some((b) => b?.agentId === agentId && b?.match?.channel === channel);
}

/** The fail-open manual-bind hint appended to `created` warnings when the channel
 * could not be auto-routed (undetermined) or the bind could not be verified. It
 * states the shopper WAS created, names the one-command manual bind, and never
 * implies a broken create — a convenience that didn't fire, not an error. */
function manualBindHint(agentId, channel) {
  const target = channel ? `the "${channel}" channel` : "the current channel";
  return (
    `the shopper "${agentId}" was created but ${target} was not auto-routed to it. `
    + `To route it manually, run: openclaw agents bind --agent ${agentId} --bind <channel> `
    + `(or switch in-chat with /agent ${agentId}). The shopper is fully created and ready.`
  );
}

/**
 * Whole-file snapshot-restore teardown. Reverses everything this run created and
 * returns the residue it could NOT revert (empty ⇒ clean, host at exact pre-run
 * state). Each step is best-effort/idempotent so one failure never aborts the rest.
 */
function teardown({ configPath, snapshot, mode, bakPreexisted, workspace, workspacePreexisted, shopperDirPreexisted }) {
  const residue = [];

  // 1. Restore openclaw.json to its exact pre-run bytes — reverses the agents.list
  //    entry, the skill attach, the plugin enable, AND the trust merge in one op.
  if (snapshot !== null && configPath) {
    try {
      atomicWrite(configPath, snapshot, mode);
    } catch (err) {
      residue.push({ path: configPath, cause: "could not restore openclaw.json: " + errCause(err) });
    }
    // Remove the allowlist bin's inner `.bak` if it did not pre-exist this run.
    const bakPath = configPath + ".bak";
    if (!bakPreexisted && existsSync(bakPath)) {
      try {
        rmSync(bakPath, { force: true });
      } catch {
        // A lingering .bak is cosmetic — not host state; do not escalate to residue.
      }
    }
  }

  // 2. Remove the workspace dir ONLY if WE created it (never a pre-existing one).
  if (workspace && !workspacePreexisted) {
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch (err) {
      residue.push({ path: workspace, cause: "could not remove the workspace dir: " + errCause(err) });
    }
  }

  // 3. Remove the singleton shopper dir ONLY if it did not pre-exist (the singleton
  //    pre-flight guarantees it was ours this run).
  // KNOWN GAP (narrow): this keys on WHOLE-DIR pre-existence, not on the leaf we
  //    wrote. If `shopper/` pre-existed but held no readable user_spec.md, the
  //    singleton read passes ("no shopper") yet `shopperDirPreexisted` is true, so a
  //    post-materialize failure leaves THIS run's user_spec.md un-removed and does NOT
  //    surface as residue → `teardown_failed`. Extremely narrow (normal operation
  //    never leaves an empty `shopper/`). To close it, key this removal on "we wrote
  //    user_spec.md this run".
  if (!shopperDirPreexisted) {
    const shopperDir = getShopperArtefactDir();
    try {
      rmSync(shopperDir, { recursive: true, force: true });
    } catch (err) {
      residue.push({ path: shopperDir, cause: "could not remove the shopper dir: " + errCause(err) });
    }
  }

  return residue;
}

function main() {
  // --- 1. Read + validate the endorsed spec (validate-first, nothing attempted) ---
  const specRaw = readSpecRaw();
  if (specRaw.error) {
    emitFailure("invalid_request", { field: "spec", cause: specRaw.error });
  }
  let spec;
  try {
    spec = JSON.parse(specRaw.raw);
  } catch (err) {
    emitFailure("invalid_request", {
      field: "spec",
      cause: "the spec is not valid JSON: " + errCause(err),
    });
  }
  const bad = validateSpec(spec);
  if (bad) {
    emitFailure("invalid_request", { field: bad.field, cause: bad.message });
  }
  const { agentId, name, workspace, persona, userSpec, channel } = spec;

  // --- 2. Resolve the host config (precondition — nothing written yet) ---
  const configPath = resolveConfigPath();
  if (configPath === null) {
    emitFailure("persistence_failed", {
      path: null,
      cause:
        "no OpenClaw config found at OPENCLAW_CONFIG_PATH, $OPENCLAW_STATE_DIR/openclaw.json, or "
        + "~/.openclaw/openclaw.json — start the OpenClaw gateway once so it writes its base config, then re-run",
    });
  }
  const preConfig = readConfig(configPath);
  if (preConfig === null) {
    emitFailure("persistence_failed", {
      path: configPath,
      cause: "the host openclaw.json is not readable/parseable JSON — fix it, then re-run",
    });
  }

  // --- 2b. Resolve the sil skill's published name to attach (shipped manifest is the
  //     single source of truth) — a packaging defect fails closed BEFORE any host
  //     write, so nothing is attempted. Reused at step 8. ---
  const skill = readSkillAttachName();
  if (skill.error) {
    emitFailure("persistence_failed", { path: MANIFEST_PATH, cause: skill.error });
  }
  const skillAttachName = skill.name;

  // --- 3. Singleton + agentId pre-flight (nothing written; inconclusive → fail closed) ---
  // The sil artefact store is the source of truth for "a shopper exists": user_spec.md
  // present + its frontmatter `name` reads (frontmatter-as-truth, no manifest).
  const overview = readShopperIdentity();
  if (Array.isArray(overview.unreadable) && overview.unreadable.length > 0) {
    // A degraded store is INCONCLUSIVE — never fabricate a "no shopper" verdict.
    emitFailure("persistence_failed", {
      path: getShopperArtefactDir(),
      cause: "the sil shopper store is degraded (" + overview.unreadable.map((u) => u.error).join("; ")
        + ") — cannot confirm the singleton; failing closed",
    });
  }
  if (nonBlank(overview.name)) {
    emitFailure("collision", {
      cause:
        "a shopper already exists — a user has exactly ONE shopper. Shop a new niche (it lazily mints a"
        + " domain on the spot) or refine the existing shopper; never mint a second shopper.",
    });
  }
  // Run the host-native agent list (ordered before the add) — a CLI error is
  // inconclusive and fails closed; the config file is the authoritative clash source.
  const listRes = runOpenclaw(["agents", "list", "--json"], configPath);
  if (!listRes.ok) {
    emitFailure("persistence_failed", {
      path: configPath,
      cause: "could not list host agents (`openclaw agents list --json` failed) — failing closed",
    });
  }
  if (existingAgentIds(preConfig).includes(agentId)) {
    emitFailure("collision", {
      cause: "the agentId " + JSON.stringify(agentId)
        + " already exists in the host agents.list — refusing to overwrite an existing agent's persona or wiring.",
    });
  }

  // --- 4. Snapshot openclaw.json (the teardown anchor) BEFORE the first mutation ---
  const snapshot = readFileSync(configPath, "utf8");
  const mode = statSync(configPath).mode & 0o777;
  const bakPreexisted = existsSync(configPath + ".bak");
  const workspacePreexisted = existsSync(workspace);
  const shopperDirPreexisted = existsSync(getShopperArtefactDir());
  const teardownCtx = {
    configPath,
    snapshot,
    mode,
    bakPreexisted,
    workspace,
    workspacePreexisted,
    shopperDirPreexisted,
  };

  /** Unwind everything and emit the honest terminal outcome: persistence_failed
   * when teardown fully reverted, the LOUDER teardown_failed when it could not. */
  const failAndTeardown = (path, cause) => {
    const residue = teardown(teardownCtx);
    if (residue.length > 0) {
      emitFailure("teardown_failed", {
        path,
        cause,
        residue,
        note: "teardown could NOT fully revert — the host was NOT returned to its pre-run state; the residue above remains",
      });
    }
    emitFailure("persistence_failed", { path, cause });
  };

  // --- 5. Create the host agent shell (workspace bootstrap: SOUL.md, AGENTS.md, …) ---
  const addRes = runOpenclaw(
    ["agents", "add", agentId, "--workspace", workspace, "--non-interactive", "--json"],
    configPath,
  );
  if (!addRes.ok) {
    failAndTeardown(configPath, "`openclaw agents add` failed: " + (addRes.stderr || "non-zero exit"));
  }

  // --- 6. Write the persona into the workspace SOUL.md (host CLI has no writer) ---
  const soulPath = join(workspace, "SOUL.md");
  try {
    atomicWrite(soulPath, persona.endsWith("\n") ? persona : persona + "\n");
  } catch (err) {
    failAndTeardown(soulPath, "could not write SOUL.md: " + errCause(err));
  }

  // --- 7. Materialize the shared user spec — REUSED lib; NO domain at create ---
  const mat = materializeProfile({ name, userSpec });
  if (!mat.ok) {
    const path = mat.kind === "persistence_failed" ? (mat.error?.split(":")[0] ?? getShopperArtefactDir()) : getShopperArtefactDir();
    failAndTeardown(path, "sil_profile_materialize " + mat.kind + ": " + (mat.message ?? mat.error ?? "failed"));
  }

  // --- 8. Attach the sil skill + enable the sil plugin (value-mode, --strict-json) ---
  const postAddConfig = readConfig(configPath);
  const idx = agentIndex(postAddConfig, agentId);
  if (idx < 0) {
    failAndTeardown(configPath, "the created agent " + JSON.stringify(agentId) + " is not in agents.list after `openclaw agents add`");
  }
  // Attach the skill by its PUBLISHED name (`sil-shopping`), NOT the plugin id
  // (`sil`) — a skill and the plugin are two distinct host keys, and the per-agent
  // attach is the only skill surface, so the plugin id here would load no skill.
  const skillRes = runOpenclaw(
    ["config", "set", `agents.list[${idx}].skills`, JSON.stringify([skillAttachName]), "--strict-json"],
    configPath,
  );
  if (!skillRes.ok) {
    failAndTeardown(configPath, "attaching the sil skill failed: " + (skillRes.stderr || "non-zero exit"));
  }
  const enableRes = runOpenclaw(
    ["config", "set", "plugins.entries.sil.enabled", "true", "--strict-json"],
    configPath,
  );
  if (!enableRes.ok) {
    failAndTeardown(configPath, "enabling the sil plugin failed: " + (enableRes.stderr || "non-zero exit"));
  }

  // --- 9. Admit sil at the three allow surfaces — REUSED whole allowlist bin ---
  let allowlistOk = true;
  let allowlistCause = "";
  try {
    execFileSync(process.execPath, [ALLOWLIST_BIN], {
      env: { ...process.env, OPENCLAW_CONFIG_PATH: configPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    allowlistOk = false;
    allowlistCause = typeof err?.stderr === "string" && err.stderr.trim().length > 0
      ? err.stderr.trim()
      : "non-zero exit";
  }
  if (!allowlistOk) {
    // A failed admission leaves the sil_* tools filtered — NEVER a green `created`.
    failAndTeardown(configPath, "the sil-openclaw-allowlist admission helper failed: " + allowlistCause);
  }

  // --- 10. Bind the current channel to the new shopper (FAIL-OPEN convenience) ---
  // Route the channel the user is talking on to the new shopper by default, so their
  // next message reaches it with no manual bind. This step NEVER fails creation: an
  // undetermined channel, a conflict (already owned by another agent — no auto-steal),
  // or an unverifiable bind all degrade to a manual-bind hint. The bind lands in
  // openclaw.json `bindings[]`, so a VERIFIED route is reversed for free by the
  // step-4 snapshot if a later step tears the whole create down.
  const bindWarnings = [];
  // The channel the route was VERIFIED-bound to (null ⇒ nothing bound). It rides in
  // `created` as the honesty rail: a bound channel is named ONLY when the read-back +
  // config validate confirm it — issuing the write is never enough.
  let boundChannel = null;
  const channelToBind = resolveBindChannel({
    specChannel: channel,
    envChannel: process.env["OPENCLAW_MCP_MESSAGE_CHANNEL"],
  });
  if (channelToBind === null) {
    bindWarnings.push(manualBindHint(agentId, null));
  } else {
    // Snapshot BEFORE the bind so an unverifiable write reverts to a valid config —
    // never falling through to the fail-closed step-11 validate (which would tear
    // down a fully-created shopper over a convenience shortfall).
    const bindSnapshot = readFileSync(configPath, "utf8");
    const bindRes = runOpenclaw(["agents", "bind", "--agent", agentId, "--bind", channelToBind, "--json"], configPath);
    const readBack = runOpenclaw(["agents", "bindings", "--agent", agentId, "--json"], configPath);
    const bindValidateRes = runOpenclaw(["config", "validate", "--json"], configPath);
    const verified =
      bindRes.ok
      && bindApplied(bindRes.stdout)
      && readBack.ok
      && bindingPresent(readBack.stdout, agentId, channelToBind)
      && configValidates(bindValidateRes.stdout);
    if (verified) {
      boundChannel = channelToBind;
    } else {
      // Revert JUST the route (config back to its pre-bind valid state) and degrade
      // to the manual-bind hint. A failed revert is still fail-open: a well-formed
      // bind is validation-safe, so step 11 certifies the config either way.
      try {
        atomicWrite(configPath, bindSnapshot, mode);
      } catch {
        // best-effort — never escalate a convenience revert into a torn-down create
      }
      bindWarnings.push(manualBindHint(agentId, channelToBind));
    }
  }

  // --- 11. Validate with the host's OWN check — success keys off `.valid` ---
  // The shim/host writes its structured verdict to stdout even on a non-zero exit,
  // so read stdout regardless of the exit code (fail closed if it is not JSON).
  const validateRes = runOpenclaw(["config", "validate", "--json"], configPath);
  let verdict = null;
  try {
    verdict = JSON.parse(validateRes.stdout);
  } catch {
    verdict = null;
  }
  if (verdict === null || verdict.valid !== true) {
    const issues = verdict && verdict.issues !== undefined ? JSON.stringify(verdict.issues) : undefined;
    const cause = verdict && (verdict.error || verdict.message)
      ? String(verdict.error || verdict.message)
      : "`openclaw config validate` did not return valid: true";
    failAndTeardown(configPath, issues ? cause + " — issues: " + issues : cause);
  }

  // --- 12. Declare created — carry the identity + the bound channel (honesty rail) ---
  const warnings = [...webCapabilityWarnings(readConfig(configPath) ?? postAddConfig), ...bindWarnings];
  emitCreated({ name, agentId, workspace, boundChannel, warnings });
}

main();
