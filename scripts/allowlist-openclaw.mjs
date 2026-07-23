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
 * mode (host config is operator-readable, NOT a 0600 credential).
 *
 * It runs NOTHING. It used to shell out to `openclaw config validate --json` as
 * a post-write guard; that call is gone, because a shipped file that starts a
 * subprocess is what ClawHub's scanner reads, and no manifest declaration
 * changes its verdict. The guard was best-effort anyway — it skipped silently
 * whenever the binary was off PATH, which is precisely the pre-gateway-boot
 * case this script exists for. The `.bak` plus the atomic tmp→rename write are
 * the real safety net: the merge is additive and idempotent, and the operator
 * can restore the backup this script names in its own success line.
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

  const allowSize = Array.isArray(result.config.plugins?.allow)
    ? result.config.plugins.allow.length
    : 0;
  logInfo("sil_allowlist_merged", {
    plugin: sil.id,
    tools_added: sil.tools.length,
    skill_added: sil.skill.length > 0,
    plugins_allow_size: allowSize,
    path: configPath,
    backup: bakPath,
  });
  process.exit(0);
}

main();
