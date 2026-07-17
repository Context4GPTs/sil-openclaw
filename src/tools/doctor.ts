/**
 * `sil_doctor` — report-first diagnosis of the plugin's `$SIL_DATA_DIR`-scoped
 * state.
 *
 * The product is the findings array, not the fixes: a run that fixes nothing is
 * a complete, successful run. Mutation is a bounded side-effect — the ONLY
 * writes are the two safe auto-fixes (tighten a too-open mode, create the
 * missing data dir), both under `getDataDir()`. Destructive fixes (anything that
 * mutates the BYTES of an existing artefact, including clearing a corrupt
 * `tokens.json`) are surfaced as `needs_confirmation` and never run: delete-first
 * does not apply to user data.
 *
 * Every diagnosis is derived from local state and completes with the network
 * down — a doctor is needed MOST when things are broken, and "broken" often
 * includes the network. The one outbound request is the latest-version probe
 * (bounded + fail-soft to silence); no sil-api/sil-web call, and NO token
 * rotation — a diagnosis must have no auth side-effects.
 *
 * `register()` opens nothing: the probe lives inside `execute()` like every
 * other I/O.
 *
 * No finding field may ever carry token bytes, a JWT claim value, or user PII.
 * Token health is metadata only: present / mode / parses / expired.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join, relative } from "node:path";

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import {
  DIR_MODE,
  getConfigPath,
  getDataDir,
  getTokensPath,
  hasTokens,
  readConfig,
  readTokens,
} from "../lib/credentials.js";
import { sortFindings, type Finding, type Severity } from "../lib/findings.js";
import {
  readShopperIdentity,
  searchProfileFrontmatter,
} from "../lib/profile-store.js";
import { jsonResult } from "../lib/tool-result.js";
import {
  buildVersionBehindFinding,
  probeLatestVersion,
  readInstalledVersion,
  type FetchLike,
} from "../lib/version-advisory.js";

/** Owner-only file mode. `DIR_MODE` (0o700) is owned by `credentials.ts` and
 * imported; the file mode is private per-module there and in `profile-store.ts`,
 * so this mirrors that pattern rather than exporting a fourth copy. */
const FILE_MODE = 0o600;

/** An interrupted atomic write leaves `<path>.<hex>.tmp` behind
 * (`profile-store.ts`'s tmp → rename). The hex length is not pinned: it is a
 * detail of one call site's `randomBytes(n)`, and an orphan is an orphan.
 * Bytes on disk ⇒ surfaced, never deleted. */
const STALE_TMP_RE = /\.[0-9a-f]+\.tmp$/;

const REREGISTER_HINT = "Run `sil_register` to re-register this install.";

export interface DoctorReport {
  /** Always `"ok"`: a failed CHECK is a finding, never a failed call — the
   * diagnosis IS the payload, so the sicker the install, the more this tool has
   * to say. The lone exception is a corrupt install, where
   * `readInstalledVersion()` throws rather than report on a build that cannot be
   * identified. */
  status: "ok";
  /** No finding severity above `info`. */
  healthy: boolean;
  /** Resolved `$SIL_DATA_DIR` — a path, never a secret. */
  dataDir: string;
  /** Report CONTEXT, not a finding: WHICH install is being diagnosed. Local, so
   * never conditional on the probe. */
  installedVersion: string;
  counts: { info: number; warn: number; critical: number };
  findings: Finding[];
}

export function registerDoctorTools(
  api: PluginAPI,
  // The probe's seam. Defaulted to global `fetch`, so production wiring is a
  // bare `registerDoctorTools(api)`; a test drives up-to-date / newer /
  // erroring / STALLING channels through it without a live network.
  fetchImpl: FetchLike = fetch,
): void {
  api.registerTool({
    name: "sil_doctor",
    label: "Diagnose sil",
    description:
      "Diagnose this sil install: check the local data directory, file"
      + " permissions, stored identity/token health, and behaviour artefacts,"
      + " and report whether a newer sil plugin is published. Returns a"
      + " machine-readable findings array. Safe permission fixes apply"
      + " automatically; anything that could lose data is only reported, never"
      + " run. Never reads out or logs token contents, and never updates"
      + " anything itself.",
    parameters: Type.Object({}),
    async execute() {
      const dataDir = getDataDir();
      const findings: Finding[] = [];

      const dir = checkDataDir(dataDir);
      findings.push(...dir.findings);
      if (dir.usable) {
        findings.push(...walkDataDir(dataDir));
        findings.push(...checkStore());
      }
      findings.push(...checkIdentity());

      const installedVersion = readInstalledVersion();
      const behind = buildVersionBehindFinding(
        installedVersion,
        await probeLatestVersion(fetchImpl),
      );
      if (behind !== null) findings.push(behind);

      return jsonResult(buildDoctorReport({ dataDir, installedVersion, findings }));
    },
  });
}

/** Roll-ups the consumer would otherwise re-derive, over a deterministic order.
 * Pure: it never invents a finding, it only rolls up the ones it is handed. */
export function buildDoctorReport(input: {
  dataDir: string;
  installedVersion: string;
  findings: Finding[];
}): DoctorReport {
  const { dataDir, installedVersion, findings } = input;
  const sorted = sortFindings(findings);
  const counts = { info: 0, warn: 0, critical: 0 };
  for (const f of sorted) counts[f.severity] += 1;
  return {
    status: "ok",
    healthy: counts.warn === 0 && counts.critical === 0,
    dataDir,
    installedVersion,
    counts,
    findings: sorted,
  };
}

// ===========================================================================
// Filesystem hygiene
// ===========================================================================

/** The data dir gates every other filesystem check: an unwritable or
 * non-directory home means no artefact and no token can EVER persist. */
function checkDataDir(dataDir: string): { findings: Finding[]; usable: boolean } {
  const id = "fs.data_dir_writable";

  if (!existsSync(dataDir)) {
    // Creating a missing container dir is safe: idempotent, loses nothing.
    try {
      mkdirSync(dataDir, { recursive: true, mode: DIR_MODE });
      return {
        findings: [{
          id,
          severity: "info",
          status: "fixed",
          detected: `The sil data directory ${dataDir} was missing.`,
          suggestedAction: null,
          appliedAction: `Created ${dataDir} (mode 0700).`,
        }, checkDataDirMode(dataDir)],
        usable: true,
      };
    } catch (err) {
      return {
        findings: [{
          id,
          severity: "critical",
          status: "fix_failed",
          detected:
            `The sil data directory ${dataDir} is missing and could not be`
            + ` created: ${causeOf(err)}`,
          suggestedAction:
            `Create ${dataDir} yourself (owner-only, mode 0700), or point`
            + " $SIL_DATA_DIR at a writable location.",
          appliedAction: null,
        }],
        usable: false,
      };
    }
  }

  if (!statSync(dataDir).isDirectory()) {
    return {
      findings: [{
        id,
        severity: "critical",
        status: "advisory",
        detected:
          `The sil data directory path ${dataDir} exists but is not a`
          + " directory, so no token or artefact can be stored.",
        suggestedAction:
          `Move or remove the file at ${dataDir}, or point $SIL_DATA_DIR at a`
          + " writable directory.",
        appliedAction: null,
      }],
      usable: false,
    };
  }

  // Prove writability the way the store actually writes — an atomic tmp file —
  // rather than trusting the mode bits (a read-only mount passes a mode check).
  const probe = join(dataDir, `.doctor.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(probe, "", { mode: FILE_MODE });
    unlinkSync(probe);
  } catch (err) {
    return {
      findings: [{
        id,
        severity: "critical",
        status: "advisory",
        detected:
          `The sil data directory ${dataDir} is not writable, so every token`
          + ` and artefact write would fail: ${causeOf(err)}`,
        suggestedAction:
          `Make ${dataDir} writable by its owner (mode 0700), or point`
          + " $SIL_DATA_DIR at a writable directory.",
        appliedAction: null,
      }, checkDataDirMode(dataDir)],
      // The dir is readable, so the remaining checks still diagnose usefully —
      // they just may not be able to fix anything.
      usable: true,
    };
  }

  return {
    findings: [{
      id,
      severity: "info",
      status: "ok",
      detected: `The sil data directory ${dataDir} is present and writable.`,
      suggestedAction: null,
      appliedAction: null,
    }, checkDataDirMode(dataDir)],
    usable: true,
  };
}

/**
 * The data dir's OWN mode — the highest-value dir check in the tool, because this
 * is the container holding `tokens.json`. Nothing else covers it: the enumerated
 * walk only ever checks the *entries* it reads out of this dir, and `mkdirSync`
 * on an ALREADY-EXISTING dir is a no-op that never chmods — so a pre-existing
 * 0755 dir (an untarred backup, an older install's umask, another tool's mkdir)
 * would otherwise survive forever behind a `healthy: true`.
 *
 * A singleton, like `fs.data_dir_writable`: one fixed path with a lifecycle, so
 * it carries a stable id and reports `ok` when healthy — `fixed → re-run → ok`.
 *
 * `stat`, NOT `lstat` — deliberately the opposite of the walk, and NOT a
 * containment hole. `chmod` follows symlinks unconditionally and Node exposes no
 * `lchmodSync` on Linux (it is `undefined`), so `lstat` here could not prevent
 * the follow — it would only change what we REPORT. It buys zero containment and
 * costs convergence: a symlink's own mode is always 0777, so `lstat` would read
 * 0777, tighten, have `chmod` follow to the target anyway, then read 0777 again
 * next run and re-report `fixed` FOREVER — a non-idempotent lie that breaks the
 * `fixed → re-run → ok` guarantee this singleton exists to provide. `stat` makes
 * detect and fix agree on the same inode, so it is strictly better on both axes.
 *
 * Nor is following an escape: `getDataDir()` IS the sandbox root (it returns the
 * env override verbatim, no `realpath`), so if the operator made it an
 * indirection, the target IS the directory the plugin stores everything in. The
 * trust boundary is `$SIL_DATA_DIR` itself — anyone who can set it can point it
 * at the target directly, no symlink needed. The entry-walk's `lstat`+skip rule
 * is what actually carries containment: entry symlinks are NOT operator-declared.
 */
function checkDataDirMode(dataDir: string): Finding {
  const id = "fs.data_dir_mode";
  const mode = statSync(dataDir).mode & 0o777;
  return tightenMode({
    id,
    path: dataDir,
    mode,
    expected: DIR_MODE,
    detected:
      `The sil data directory ${dataDir} is mode ${oct(mode)} — readable beyond`
      + " its owner. It holds this install's stored credentials and behaviour"
      + ` artefacts, so it must be owner-only ${oct(DIR_MODE)}.`,
  }) ?? {
    id,
    severity: "info",
    status: "ok",
    detected: `The sil data directory ${dataDir} is owner-only (mode ${oct(mode)}).`,
    suggestedAction: null,
    appliedAction: null,
  };
}

/**
 * Walk `$SIL_DATA_DIR` for too-open modes and orphaned tmp files.
 *
 * Enumerated ⇒ emits ONLY on a problem: a healthy store with 200 artefacts
 * yields zero findings, not 200 `ok` ones.
 *
 * `lstat`, never `stat`: a symlink under the data dir is REPORTED, never
 * chmod'd-through — chmod follows the link and would mutate a file outside
 * `$SIL_DATA_DIR`.
 */
function walkDataDir(dataDir: string): Finding[] {
  const findings: Finding[] = [];
  // tokens.json has its own stable `identity.tokens_perms` check. Without this
  // exclusion the walk claims the same mode twice — and, running first, it
  // would fix the file before the singleton looked, so the singleton would
  // report `ok` on the very run that fixed it and the fix would vanish from
  // its own `appliedAction`.
  const tokensPath = getTokensPath();

  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (err) {
      findings.push({
        id: `fs.unreadable_dir:${rel(dataDir, dir)}`,
        severity: "warn",
        status: "advisory",
        detected: `Could not list ${dir}: ${causeOf(err)}`,
        suggestedAction: "Check the directory's permissions and ownership.",
        appliedAction: null,
      });
      return;
    }

    for (const entry of entries.sort()) {
      const path = join(dir, entry);
      let stats: Stats;
      try {
        stats = lstatSync(path);
      } catch {
        // This repo MANUFACTURES this race: the store's own atomic writes create
        // `<path>.<hex>.tmp` and rename it away, and the shopper can be writing
        // while the agent self-diagnoses. An entry that vanished between readdir
        // and lstat is not a finding — and must never throw out of execute().
        continue;
      }

      if (stats.isSymbolicLink()) {
        findings.push({
          id: `fs.symlink:${rel(dataDir, path)}`,
          severity: "warn",
          status: "advisory",
          detected:
            `${path} is a symlink. sil never creates symlinks under its data`
            + " directory, and its permissions are neither audited nor fixed"
            + " through it (a chmod would follow the link outside $SIL_DATA_DIR).",
          suggestedAction:
            "Replace the symlink with a real file or directory if sil should"
            + " manage it.",
          appliedAction: null,
        });
        continue;
      }

      if (stats.isDirectory()) {
        findings.push(...checkMode(dataDir, path, stats.mode, DIR_MODE));
        visit(path);
        continue;
      }

      if (!stats.isFile()) continue;
      if (path === tokensPath) continue;

      findings.push(...checkMode(dataDir, path, stats.mode, FILE_MODE));
      if (STALE_TMP_RE.test(entry)) {
        findings.push({
          id: `fs.stale_tmp:${rel(dataDir, path)}`,
          severity: "warn",
          status: "advisory",
          detected:
            `${path} is an orphaned temporary file left by an interrupted`
            + " atomic write.",
          // Bytes on disk ⇒ destructive to remove ⇒ the doctor only reports it.
          suggestedAction:
            "Safe to delete once you have confirmed nothing else is writing"
            + " it — sil does not delete artefact bytes itself.",
          appliedAction: null,
        });
      }
    }
  };

  visit(dataDir);
  return findings;
}

/**
 * The tighten-only mode fix — the one place the invariant lives, for all three
 * mode checks (enumerated walk, tokens.json, the data dir itself).
 *
 * Too-open means bits set OUTSIDE the expected mask — not merely `!== expected`.
 * That distinction IS the invariant: a stricter mode (0400 file, 0500 dir) is not
 * a problem, and "fixing" it to 0600/0700 would WIDEN it — a security regression
 * dressed up as a fix. The fix is `mode & expected`, which can only ever CLEAR
 * bits.
 *
 * `null` = already within the mask. The caller decides what that silence means:
 * an enumerated check emits nothing, a singleton emits its stable `ok`.
 */
function tightenMode(input: {
  id: string;
  path: string;
  /** Already masked to 0o777 — the caller needs it to write `detected` anyway. */
  mode: number;
  expected: number;
  detected: string;
}): Finding | null {
  const { id, path, mode, expected, detected } = input;
  if ((mode & ~expected & 0o777) === 0) return null;

  const tightened = mode & expected;
  try {
    chmodSync(path, tightened);
    return {
      id,
      severity: "warn",
      status: "fixed",
      detected,
      suggestedAction: null,
      appliedAction: `Tightened ${path} from ${oct(mode)} to ${oct(tightened)}.`,
    };
  } catch (err) {
    // An un-applied fix is NEVER green-washed as `fixed`.
    return {
      id,
      severity: "warn",
      status: "fix_failed",
      detected: `${detected} Tightening it failed: ${causeOf(err)}`,
      suggestedAction: `Run \`chmod ${oct(tightened)} ${path}\` yourself.`,
      appliedAction: null,
    };
  }
}

/** Enumerated ⇒ silence when healthy: 200 clean artefacts emit zero findings. */
function checkMode(
  dataDir: string,
  path: string,
  rawMode: number,
  expected: number,
): Finding[] {
  const mode = rawMode & 0o777;
  const finding = tightenMode({
    id: `fs.mode:${rel(dataDir, path)}`,
    path,
    mode,
    expected,
    detected:
      `${path} is mode ${oct(mode)}, which is more permissive than the`
      + ` owner-only ${oct(expected)} sil requires.`,
  });
  return finding === null ? [] : [finding];
}

// ===========================================================================
// Identity / token health — metadata only, offline, never a token byte
// ===========================================================================

function checkIdentity(): Finding[] {
  const findings: Finding[] = [];
  const tokensPath = getTokensPath();

  if (!hasTokens()) {
    // A valid state, not an error: bare `sil_search` works unregistered.
    findings.push({
      id: "identity.tokens_present",
      severity: "info",
      status: "advisory",
      detected: "This install is not registered — no tokens.json is stored.",
      suggestedAction:
        "Run `sil_register` to register, if you want personalised results.",
      appliedAction: null,
    });
    return findings;
  }

  findings.push({
    id: "identity.tokens_present",
    severity: "info",
    status: "ok",
    detected: "This install is registered — tokens.json is present.",
    suggestedAction: null,
    appliedAction: null,
  });

  // tokens.json is a SINGLETON artefact, so its mode carries a STABLE id every
  // run — that is what makes the fix's idempotence observable to a consumer:
  // `fixed → re-run → ok` needs the same id to still be there. The enumerated
  // `fs.mode:` walk could not provide that: it emits only on a problem, so it
  // would report nothing at all on the run after the fix.
  findings.push(...checkTokensPerms(tokensPath));

  // A file that parses as JSON but carries no `access_token` is corrupt too:
  // there is nothing to authenticate with, and nothing to decode an expiry from.
  const stored = readTokens();
  if (stored === null || typeof stored.access_token !== "string") {
    // Clearing it would mutate bytes ⇒ destructive ⇒ surfaced, never auto-run.
    findings.push({
      id: "identity.tokens_parse",
      severity: "warn",
      status: "needs_confirmation",
      detected:
        `${tokensPath} is present but could not be parsed as stored`
        + " credentials. Authenticated calls will fail until it is replaced.",
      suggestedAction:
        `${REREGISTER_HINT} That replaces ${tokensPath}. sil does not clear or`
        + " overwrite it automatically — it may still be recoverable.",
      appliedAction: null,
    });
    return findings;
  }

  findings.push({
    id: "identity.tokens_parse",
    severity: "info",
    status: "ok",
    detected: `${tokensPath} parses as stored credentials.`,
    suggestedAction: null,
    appliedAction: null,
  });
  findings.push(expiryFinding(isAccessTokenExpired(stored.access_token)));
  findings.push(configFinding());
  return findings;
}

/** The stable singleton counterpart to the enumerated `fs.mode:` walk — same
 * tighten-only rule, same fix, but it reports `ok` when healthy so the
 * `fixed → re-run → ok` transition stays observable on one id. */
function checkTokensPerms(tokensPath: string): Finding[] {
  const id = "identity.tokens_perms";
  const mode = lstatSync(tokensPath).mode & 0o777;
  const tightened = tightenMode({
    id,
    path: tokensPath,
    mode,
    expected: FILE_MODE,
    detected:
      `${tokensPath} is mode ${oct(mode)} — readable beyond its owner. Stored`
      + " credentials must be owner-only.",
  });
  return [tightened ?? {
    id,
    severity: "info",
    status: "ok",
    detected: `${tokensPath} is owner-only (mode ${oct(mode)}).`,
    suggestedAction: null,
    appliedAction: null,
  }];
}

/**
 * Decode-only JWT `exp`: `true` = expired, `false` = not expired, `null` =
 * INCONCLUSIVE (not a 3-segment JWT / undecodable payload / no numeric `exp`).
 *
 * NO signature verification (this is a health hint, not an auth decision — real
 * verification is server-side on the next authed call) and NO network.
 *
 * `StoredTokens` carries no `exp` of its own, so "expired" has to come from the
 * token itself. The `boolean | null` return is deliberate: it is structurally
 * incapable of carrying token bytes or any claim other than the derived answer.
 *
 * Never throws, and never fabricates expiry — an opaque token reads `null`.
 */
export function isAccessTokenExpired(accessToken: string): boolean | null {
  const segments = accessToken.split(".");
  if (segments.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    const exp = (payload as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    return exp * 1_000 <= Date.now();
  } catch {
    return null;
  }
}

function expiryFinding(expired: boolean | null): Finding {
  const id = "identity.token_expiry";
  if (expired === true) {
    // `warn`, not `critical`: a stored refresh token means the next authed call
    // self-heals. The offline doctor won't network-refresh to confirm.
    return {
      id,
      severity: "warn",
      status: "advisory",
      detected: "The stored access token has expired.",
      suggestedAction:
        "Authenticated tools refresh automatically on their next call. If they"
        + ` keep failing: ${REREGISTER_HINT}`,
      appliedAction: null,
    };
  }
  return {
    id,
    severity: "info",
    status: "ok",
    detected:
      expired === false
        ? "The stored access token has not expired."
        : "The stored access token carries no readable expiry; sil cannot tell"
          + " offline whether it is still valid, and will refresh it on demand.",
    suggestedAction: null,
    appliedAction: null,
  };
}

function configFinding(): Finding {
  const id = "identity.config_parse";
  const configPath = getConfigPath();
  if (existsSync(configPath) && readConfig() === null) {
    return {
      id,
      severity: "warn",
      status: "needs_confirmation",
      detected:
        `${configPath} is present but could not be parsed, so the stored user`
        + " identity is unreadable.",
      suggestedAction:
        `${REREGISTER_HINT} That rewrites ${configPath}. sil does not overwrite`
        + " it automatically.",
      appliedAction: null,
    };
  }
  return {
    id,
    severity: "info",
    status: "ok",
    detected: existsSync(configPath)
      ? `${configPath} parses as the stored user identity.`
      : `No ${configPath} is stored.`,
    suggestedAction: null,
    appliedAction: null,
  };
}

// ===========================================================================
// Behaviour-artefact store
// ===========================================================================

/** Consume the store's OWN fail-closed `unreadable[]` surfacing — never re-parse
 * the artefacts, never aggregate entries away, and never overwrite one. Each
 * entry becomes exactly one finding. */
function checkStore(): Finding[] {
  return [
    ...readShopperIdentity().unreadable,
    ...searchProfileFrontmatter().unreadable,
  ].map(({ id, error }) => ({
    id: `store.unreadable:${id}`,
    severity: "warn" as Severity,
    status: "advisory" as const,
    // Name the artefact AND the corruption — this is what a human reads to go
    // repair the file. The store's own error text describes only the corruption.
    detected: `${id}: ${error}`,
    suggestedAction:
      "Inspect and repair the artefact by hand — sil never overwrites a corrupt"
      + " artefact, because it may still be recoverable.",
    appliedAction: null,
  }));
}

// ===========================================================================

/** The OS cause, never a token or PII — mirrors the store's
 * `persistence_failed.error` discipline. */
function causeOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function oct(mode: number): string {
  return `0${mode.toString(8).padStart(3, "0")}`;
}

function rel(dataDir: string, path: string): string {
  return relative(dataDir, path) || ".";
}
