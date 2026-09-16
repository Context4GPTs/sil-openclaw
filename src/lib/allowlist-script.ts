/**
 * The absolute path of the shipped tool-admission script, for prose telling an operator to
 * run it: a bare bin name reaches PATH only on an npm-global install, and node normalizes a
 * `..` hop through the host's skill SYMLINK lexically. `import.meta.url` is the sound root.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWLIST_SCRIPT_RELATIVE = "scripts/allowlist-openclaw.mjs";

/** Two levels up reaches the plugin root from both `src/lib/` and `dist/lib/`. */
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveAllowlistScript(): string {
  return join(PLUGIN_ROOT, ALLOWLIST_SCRIPT_RELATIVE);
}
