/**
 * The absolute path of the shipped tool-admission script, for prose that tells an
 * operator to run it. A bare bin name is on PATH only for an npm-global install, and
 * the host publishes plugin skills as SYMLINKS — node normalizes a `..` hop LEXICALLY,
 * so `cat <skilldir>/../scripts/x` succeeds on the exact string `node` rejects. This
 * process's own `import.meta.url` is the only sound root: never cwd, PATH or $HOME.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWLIST_SCRIPT_RELATIVE = "scripts/allowlist-openclaw.mjs";

/** Two levels up reaches the plugin root from both `src/lib/` and `dist/lib/`. */
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveAllowlistScript(): string {
  return join(PLUGIN_ROOT, ALLOWLIST_SCRIPT_RELATIVE);
}
