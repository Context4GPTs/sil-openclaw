/**
 * The runnable paths of the plugin's shipped operator scripts — resolved from
 * this module's own location, because the agent cannot derive them.
 *
 * WHY THIS EXISTS: a bare bin name (`sil-openclaw-create-shopper`) is on PATH
 * only when a global npm-style install links it. `openclaw plugins install` just
 * extracts the tarball and links nothing, so on that channel the documented
 * creation command did not exist and the flow died at its last step.
 *
 * WHY NOT "resolve it from the skill file's location": the host publishes plugin
 * skills as SYMLINKS into its config tree and hands the agent the symlink path
 * deliberately. Node's `path.resolve()` normalizes `..` LEXICALLY, before
 * touching the filesystem, so a `<skilldir>/../scripts/x` hop is erased and the
 * loader looks beside the symlink, not beside the real file. `cat` and `ls`
 * succeed on the exact string `node` rejects with MODULE_NOT_FOUND — a trap that
 * hand-testing certifies as working. The plugin process's own `import.meta.url`
 * is the ONLY sound root, so the plugin reports the path and the agent runs it.
 *
 * The root derivation mirrors `version-advisory.ts` — two levels up reaches the
 * plugin root from both `src/lib/` and `dist/lib/`. Never cwd (production cwd is
 * the agent's workspace, and cwd passes every test run from the repo root), never
 * PATH, never the user's home, never a hardcoded install path.
 *
 * This module spawns nothing: reachability is a filesystem read. Naming a path is
 * not running it, which is what keeps `security.noChildProcess` true.
 */

import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Finding } from "./findings.js";

/**
 * THE literal. `sil_doctor` reports this path and probes this path, the skill
 * prose documents it, and `package.json#bin` maps it — one constant, so the
 * reported path and the probed path cannot drift. A doctor that certifies a path
 * it never probed is the same class of lie this module exists to kill.
 */
export const CREATION_ENTRYPOINT_RELATIVE = "scripts/create-shopper.mjs";

/** The creation entrypoint's sibling. It lives here for the same reason and by
 * the same root: `wiring.tools_not_admitted` used to hand ClawHub operators a
 * bare bin name too — doctor's own advice, unrunnable on the channel it
 * diagnoses. One root derivation, one place. */
export const ALLOWLIST_SCRIPT_RELATIVE = "scripts/allowlist-openclaw.mjs";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveCreationEntrypoint(): string {
  return join(PLUGIN_ROOT, CREATION_ENTRYPOINT_RELATIVE);
}

export function resolveAllowlistScript(): string {
  return join(PLUGIN_ROOT, ALLOWLIST_SCRIPT_RELATIVE);
}

/** What a local read can honestly establish about the entrypoint. */
export type CreationEntrypointVerdict = "present" | "missing" | "unresolvable";

/**
 * Probe the entrypoint — a local `stat`, so it stays determinate with the
 * network down.
 *
 * `unresolvable` is not padding: ENOENT means the tarball shipped incomplete,
 * while an unreadable parent or a non-file at the path means something else is
 * wrong with the tree. They are the same severity but not the same sentence, and
 * the operator's next move depends on which one it is.
 */
export function probeCreationEntrypoint(
  entrypoint: string = resolveCreationEntrypoint(),
): CreationEntrypointVerdict {
  try {
    return statSync(entrypoint).isFile() ? "present" : "unresolvable";
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT"
      ? "missing"
      : "unresolvable";
  }
}

/**
 * A singleton subsystem check, so it reports EVERY run and says `ok` when
 * healthy — `fixed → re-run → ok` needs the id to still be there after the fix.
 * Hence a `Finding`, never `Finding | null`: an advisory-only builder could not
 * tell "reachable" from "never checked".
 *
 * Pure — the caller does the I/O and hands in the verdict. That is what makes the
 * no-bare-bin guarantee cheap to assert totally, over every verdict.
 *
 * `warn`, not `critical`: by the doctor's ladder critical means the core path is
 * broken, and a plugin that broken could not run a tool to say so. The plugin
 * runs fine here — one flow cannot. `warn` is also the load-bearing half: it is
 * what makes `healthy` false.
 */
export function buildCreationEntrypointFinding(
  entrypoint: string,
  verdict: CreationEntrypointVerdict,
): Finding {
  const id = "creation.entrypoint_present";

  if (verdict === "present") {
    return {
      id,
      severity: "info",
      status: "ok",
      detected: `The shopper-creation entrypoint ${entrypoint} is present and runnable.`,
      suggestedAction: null,
      appliedAction: null,
    };
  }

  return {
    id,
    severity: "warn",
    status: "advisory",
    detected:
      verdict === "missing"
        ? `The shopper-creation entrypoint ${entrypoint} is missing, so creating`
          + " a shopper would fail at its last step."
        : `The shopper-creation entrypoint ${entrypoint} could not be read as a`
          + " file, so creating a shopper would fail at its last step.",
    // Never a bare bin name and never a PATH edit: this diagnoses an incomplete
    // plugin tree, and the recovery must be runnable on the channel it is being
    // read on. `openclaw` itself is always on PATH — that is the whole premise.
    suggestedAction:
      "Reinstall the sil plugin through OpenClaw's own plugin install path (for"
      + " example `openclaw plugins install @4gpts/sil`), then reload — the"
      + " plugin tree is incomplete. sil never reinstalls itself.",
    appliedAction: null,
  };
}
