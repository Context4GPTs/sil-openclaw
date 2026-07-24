/**
 * The runnable path of the plugin's one shipped operator script — resolved from
 * this module's own location, because the agent cannot derive it.
 *
 * WHY THIS EXISTS: a bare bin name is on PATH only when a global npm-style
 * install links it. `openclaw plugins install` just extracts the tarball and
 * links nothing, so on that channel a documented bare-name command does not
 * exist at all. `sil_doctor`'s `wiring.tools_not_admitted` used to hand ClawHub
 * operators exactly that — doctor's own advice, unrunnable on the channel it
 * diagnoses.
 *
 * WHY NOT "resolve it from the skill file's location": the host publishes plugin
 * skills as SYMLINKS into its config tree and hands the agent the symlink path
 * deliberately. Node's `path.resolve()` normalizes `..` LEXICALLY, before
 * touching the filesystem, so a `<skilldir>/../scripts/x` hop is erased and the
 * loader looks beside the symlink, not beside the real file. `cat` and `ls`
 * succeed on the exact string `node` rejects with MODULE_NOT_FOUND — a trap that
 * hand-testing certifies as working. The plugin process's own `import.meta.url`
 * is the ONLY sound root, so the plugin reports the path and the operator runs it.
 *
 * The root derivation mirrors `version-advisory.ts` — two levels up reaches the
 * plugin root from both `src/lib/` and `dist/lib/`. Never cwd (production cwd is
 * the agent's workspace, and cwd passes every test run from the repo root), never
 * PATH, never the user's home, never a hardcoded install path.
 *
 * Shopper CREATION no longer needs any of this: it is `sil_create_shopper`, an
 * ordinary tool the agent calls by name. Admission is the one act that must
 * still happen from outside the plugin — a plugin that is not admitted cannot
 * run a tool to admit itself — so the allowlist script, and this resolver,
 * survive for it alone.
 *
 * This module spawns nothing: reachability is a filesystem read. Naming a path is
 * not running it, which is what keeps `security.noChildProcess` true.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWLIST_SCRIPT_RELATIVE = "scripts/allowlist-openclaw.mjs";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveAllowlistScript(): string {
  return join(PLUGIN_ROOT, ALLOWLIST_SCRIPT_RELATIVE);
}
