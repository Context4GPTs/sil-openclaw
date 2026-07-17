/**
 * The ordered store-format migration registry.
 *
 * `MIGRATIONS` is ascending and CONTIGUOUS from version 1 — the runner advances a
 * store one hop at a time through it, so a gap or a duplicate would silently skip or
 * re-run a transform. `CURRENT_STORE_VERSION` is the top of the chain: the version a
 * fully-migrated store records. Append the next migration as `002-…`, add it here, and
 * `CURRENT_STORE_VERSION` advances automatically.
 */

import type { Migration } from "./types.js";
import { migration001 } from "./001-frontmatter-store.js";

export const MIGRATIONS: readonly Migration[] = [migration001];

export const CURRENT_STORE_VERSION: number = MIGRATIONS.at(-1)?.version ?? 0;
