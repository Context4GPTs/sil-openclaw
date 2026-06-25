#!/usr/bin/env node
/**
 * Install-time helper: trust `sil` in the host OpenClaw config.
 *
 * Operator-invoked (NEVER an npm lifecycle hook — `openclaw.plugin.json#
 * security.noInstallScripts: true` is a shipped guarantee that the package
 * runs nothing automatically; an operator explicitly running this is the
 * opposite of an install hook and honours it). This is a standalone script in
 * the same class as `scripts/release.mjs` — it is NOT the plugin process, so
 * the plugin's `~/.openclaw`-write boundary does not apply to it.
 *
 * What it does: resolve the host `openclaw.json`, read sil's facts from the
 * shipped manifest (single source of truth), call the pure `mergeSilAllowlist`
 * core, and — only when something changed — write a `.bak` then atomically
 * (tmp → rename) write the merged config back, preserving the file's existing
 * mode (host config is operator-readable, NOT a 0600 credential). When the
 * `openclaw` binary is on PATH it runs `openclaw config validate --json` as a
 * best-effort post-write guard and reverts from `.bak` if the merged config is
 * rejected — so a bad result fails closed and never leaves the host half-merged.
 *
 * Config-path precedence (first existing wins):
 *   1. $OPENCLAW_CONFIG_PATH
 *   2. $OPENCLAW_STATE_DIR/openclaw.json
 *   3. ~/.openclaw/openclaw.json
 * None resolves → fail closed (structured error + non-zero exit), create no
 * parent dir (that would mask a misconfiguration; the operator must start the
 * gateway once so it writes its own base config).
 *
 * Three distinct structured outcomes, in sil's `snake_case_marker` log style
 * (here as plain NDJSON on stdout/stderr — the script runs outside the
 * gateway, so there is no `api.logger`). No PII, no secrets:
 *   - sil_allowlist_merged     (info,  stdout) — a fresh merge was written
 *   - sil_allowlist_unchanged  (info,  stdout) — idempotent no-op, nothing written
 *   - sil_allowlist_merge_failed (error, stderr) — fail-closed, nothing left half-done
 *
 * All real merge logic lives in the typed lib (`src/lib/openclaw-allowlist.ts`,
 * compiled to `dist/lib/openclaw-allowlist.js`). This shell is thin I/O only.
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { mergeSilAllowlist, AllowlistShapeError } from "../dist/lib/openclaw-allowlist.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = resolve(ROOT, "openclaw.plugin.json");

/** Emit one structured NDJSON line in sil's marker style: `{event, level, ...}`. */
function logMarker(stream, level, event, fields) {
  const line = JSON.stringify({ event, level, ...fields });
  stream.write(line + "\n");
}

const logInfo = (event, fields) => logMarker(process.stdout, "info", event, fields ?? {});
const logError = (event, fields) => logMarker(process.stderr, "error", event, fields ?? {});

/** Resolve the host config path by precedence; first existing file wins.
 * Returns the resolved path, or null if none exists (caller fails closed). */
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

/** Read sil's facts from the shipped manifest — the single source of truth.
 * id / tools / skill are never re-hardcoded in this script. */
function readSilFacts() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const id = manifest.id;
  const tools = Array.isArray(manifest.contracts?.tools) ? manifest.contracts.tools : [];
  const skill = Array.isArray(manifest.skills) ? (manifest.skills[0] ?? "") : "";
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`manifest ${MANIFEST_PATH} has no usable "id"`);
  }
  return { id, tools, skill };
}

/** Atomic single-file write: tmp sibling → write → rename over target,
 * PRESERVING the source file's existing mode (host config is operator-readable,
 * NOT a 0600 credential — mirrors `src/lib/profile-store.ts:321-327` minus the
 * hardcoded mode). A reader sees either the old file or the new one, never a
 * half-written one; a crash before rename leaves the original untouched. */
function atomicWrite(path, contents, mode) {
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, contents, { mode });
  renameSync(tmp, path);
}

/** Best-effort `openclaw config validate --json` guard. Returns:
 *   { ran: false }                 — binary absent / not invokable (skip, keep write)
 *   { ran: true, valid: boolean, cause?: string }
 * Never throws across the boundary — a non-zero exit from the binary is read
 * from its stdout `.valid`, and an un-parseable response is treated as invalid. */
function validateConfig(path) {
  let raw;
  try {
    raw = execFileSync("openclaw", ["config", "validate", "--json"], {
      env: { ...process.env, OPENCLAW_CONFIG_PATH: path },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // ENOENT → binary not on PATH: skip validation (the script must run
    // pre-gateway-boot). Any other spawn failure also means we can't validate;
    // the atomic write + .bak revert remains the real safety net, so we treat a
    // failed *spawn* as "not run" (keep the write) rather than "invalid".
    if (err && err.code === "ENOENT") return { ran: false };
    // The binary ran but exited non-zero — capture its stdout if any so we can
    // read a structured verdict; otherwise treat as invalid (fail closed).
    const stdout = typeof err?.stdout === "string" ? err.stdout : "";
    if (stdout) {
      raw = stdout;
    } else {
      return { ran: true, valid: false, cause: "openclaw config validate exited non-zero" };
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.valid === true) return { ran: true, valid: true };
    const cause =
      (parsed && (parsed.error || parsed.message))
      || "openclaw config validate reported valid !== true";
    return { ran: true, valid: false, cause: String(cause) };
  } catch {
    return { ran: true, valid: false, cause: "openclaw config validate returned non-JSON" };
  }
}

function main() {
  const configPath = resolveConfigPath();
  if (configPath === null) {
    logError("sil_allowlist_merge_failed", {
      path: null,
      cause:
        "no OpenClaw config found at OPENCLAW_CONFIG_PATH, "
        + "$OPENCLAW_STATE_DIR/openclaw.json, or ~/.openclaw/openclaw.json — "
        + "start the OpenClaw gateway once so it writes its base config, then re-run",
    });
    process.exit(1);
  }

  const sil = readSilFacts();

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    logError("sil_allowlist_merge_failed", {
      path: configPath,
      cause: "config is not valid JSON: " + (err?.message ?? String(err)),
    });
    process.exit(1);
  }

  let result;
  try {
    result = mergeSilAllowlist(parsed, sil);
  } catch (err) {
    const cause =
      err instanceof AllowlistShapeError
        ? err.message
        : "merge failed: " + (err?.message ?? String(err));
    logError("sil_allowlist_merge_failed", { path: configPath, cause });
    process.exit(1);
  }

  if (!result.changed) {
    logInfo("sil_allowlist_unchanged", { plugin: sil.id });
    process.exit(0);
  }

  // Something changed → back up, atomically write, then best-effort validate.
  const mode = statSync(configPath).mode & 0o777;
  const bakPath = configPath + ".bak";
  copyFileSync(configPath, bakPath);

  const serialized = JSON.stringify(result.config, null, 2) + "\n";
  atomicWrite(configPath, serialized, mode);

  const validation = validateConfig(configPath);
  if (validation.ran && !validation.valid) {
    // Revert to the exact pre-run bytes; leave the host in its pre-run state.
    copyFileSync(bakPath, configPath);
    logError("sil_allowlist_merge_failed", {
      path: configPath,
      cause: validation.cause ?? "openclaw config validate rejected the merged config",
    });
    process.exit(1);
  }

  const allowSize = Array.isArray(result.config.plugins?.allow)
    ? result.config.plugins.allow.length
    : 0;
  logInfo("sil_allowlist_merged", {
    plugin: sil.id,
    tools_added: sil.tools.length,
    skill_added: sil.skill.length > 0,
    plugins_allow_size: allowSize,
    validated: validation.ran,
    path: configPath,
  });
  process.exit(0);
}

main();
