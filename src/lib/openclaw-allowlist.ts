/**
 * Pure, typed merge core for trusting `sil` in a host OpenClaw config.
 *
 * On install OpenClaw discovers `sil` as a non-bundled plugin, but with an
 * empty `plugins.allow` it warns that discovered plugins may auto-load
 * unrestricted. This module computes the additive, idempotent edit that
 * closes that warning by trusting `sil` at the THREE real allow surfaces of
 * the `alpine/openclaw:2026.6.9` config schema:
 *
 *   - `plugins.allow`     string[] of plugin IDs   — emptiness fires the warning
 *   - `tools.alsoAllow`   string[] of plugin IDs   — admits a plugin's tools by
 *                                                    ID (NO per-tool-name key
 *                                                    exists; this is how all of
 *                                                    sil's tools become un-filtered)
 *   - `plugins.entries.sil`  { enabled, config }    — makes sil loadable/exposing
 *
 * There is no global skill allow-list — a skill attaches per-agent via
 * `agents.list[i].skills`, which is the host-wiring path's job, NOT this
 * helper's. `sil.tools` / `sil.skill` are carried in the facts type only for
 * the operator log fields; the merge never enumerates tool names into config,
 * because on 2026.6.9 the mechanism is plugin-ID admission.
 *
 * This module is pure (no I/O). The config arrives as `unknown` because the
 * file is operator-editable and may be any shape; every read narrows with
 * `typeof` / `Array.isArray` before use. A present-but-wrong-typed allow array
 * is a hard error (we never coerce — that risks clobbering operator state).
 *
 * Invariants (the two the suite exists to defend):
 *   - ADDITIVE: a pre-existing entry is never removed, reordered, or
 *     overwritten — sil's IDs are only ever appended; an existing
 *     `plugins.entries.sil` is left untouched.
 *   - IDEMPOTENT: `changed` is computed from set membership, so a second run
 *     finds nothing missing and reports `changed: false` (the I/O shell then
 *     writes nothing).
 *
 * OQ3 — enabling the restriction must never silently un-trust a plugin the
 * permissive empty-list default was auto-loading. So when `plugins.allow` is
 * empty/absent, we seed it with every ID already recorded under
 * `plugins.entries` (the host's own record of installed plugins) before
 * appending `sil`. The seed IDs are read from the live config, never hardcoded.
 */

/** sil's own facts, read by the I/O shell from the shipped manifest — never
 * re-hardcoded. `tools` and `skill` feed the operator log; the merge itself
 * only uses `id` (plugin-ID admission on 2026.6.9). */
export interface SilAllowlistFacts {
  /** The plugin ID — `"sil"`. The single value admitted at all three surfaces. */
  readonly id: string;
  /** The plugin's tool names, for the operator log's `tools_added` count. */
  readonly tools: readonly string[];
  /** The plugin's skill ref (e.g. `"./skill"`), for the operator log. */
  readonly skill: string;
}

/** A plugin enable entry under `plugins.entries.<id>`. */
export interface PluginEntry {
  enabled: boolean;
  config: Record<string, unknown>;
  [key: string]: unknown;
}

/** The slice of the OpenClaw config this helper reads and writes. Other keys
 * (`gateway`, `agents`, `meta`, …) are preserved verbatim via the index
 * signature — we only ever touch the three allow surfaces. */
export interface OpenClawConfig {
  plugins?: {
    allow?: string[];
    entries?: Record<string, PluginEntry | unknown>;
    [key: string]: unknown;
  };
  tools?: {
    alsoAllow?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Thrown when the operator-editable config has a shape we refuse to coerce
 * (a non-object root, or a present-but-non-array allow surface). The I/O shell
 * maps this to the `sil_allowlist_merge_failed` outcome — fail closed, never
 * silently overwrite operator state. */
export class AllowlistShapeError extends Error {
  override readonly name = "AllowlistShapeError";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Append `id` to `arr` if absent. Returns true iff a mutation occurred —
 * append-only, so order is preserved and pre-existing entries are byte-stable. */
function appendIfAbsent(arr: string[], id: string): boolean {
  if (arr.includes(id)) return false;
  arr.push(id);
  return true;
}

/**
 * Compute the additive, idempotent merge that trusts `sil` in the given config.
 *
 * Mutates a copy is NOT what we do — we mutate the passed object in place (the
 * I/O shell parses fresh per run, so there is no aliasing hazard) and return it
 * for ergonomics. All three merges happen in-memory before the shell does its
 * single atomic write, so a crash mid-merge can never half-write the file.
 *
 * @throws AllowlistShapeError if `config` is not an object, or if any of
 *   `plugins.allow`, `tools.alsoAllow`, `plugins.entries` is present but the
 *   wrong type (non-array / non-object) — we refuse to coerce.
 */
export function mergeSilAllowlist(
  config: unknown,
  sil: SilAllowlistFacts,
): { config: OpenClawConfig; changed: boolean } {
  if (!isPlainObject(config)) {
    throw new AllowlistShapeError(
      "OpenClaw config root must be a JSON object, got: "
        + (config === null ? "null" : Array.isArray(config) ? "array" : typeof config),
    );
  }

  // --- Narrow / create the `plugins` container -------------------------------
  if (config["plugins"] !== undefined && !isPlainObject(config["plugins"])) {
    throw new AllowlistShapeError(
      "config.plugins must be an object when present, got: " + typeof config["plugins"],
    );
  }
  if (config["plugins"] === undefined) config["plugins"] = {};
  const plugins = config["plugins"] as Record<string, unknown>;

  // --- Narrow / create the `tools` container ---------------------------------
  if (config["tools"] !== undefined && !isPlainObject(config["tools"])) {
    throw new AllowlistShapeError(
      "config.tools must be an object when present, got: " + typeof config["tools"],
    );
  }
  if (config["tools"] === undefined) config["tools"] = {};
  const tools = config["tools"] as Record<string, unknown>;

  // --- Narrow `plugins.entries` (read-only for the OQ3 seed) -----------------
  if (plugins["entries"] !== undefined && !isPlainObject(plugins["entries"])) {
    throw new AllowlistShapeError(
      "config.plugins.entries must be an object when present, got: "
        + typeof plugins["entries"],
    );
  }
  const entries = isPlainObject(plugins["entries"])
    ? (plugins["entries"] as Record<string, unknown>)
    : undefined;

  // --- 1. plugins.allow ------------------------------------------------------
  // A present-but-non-array allow is a hard error: coercing it would silently
  // discard whatever the operator put there.
  if (plugins["allow"] !== undefined && !Array.isArray(plugins["allow"])) {
    throw new AllowlistShapeError(
      "config.plugins.allow must be an array when present, got: " + typeof plugins["allow"],
    );
  }
  // Every element must be a string — a mixed array is operator corruption we
  // refuse to silently propagate.
  const existingAllow = plugins["allow"] as unknown[] | undefined;
  if (existingAllow && existingAllow.some((x) => typeof x !== "string")) {
    throw new AllowlistShapeError("config.plugins.allow must contain only strings");
  }
  let allowChanged = false;
  if (!existingAllow || existingAllow.length === 0) {
    // Empty/absent → flipping from permissive (auto-loads everything) to
    // explicit (allow-list enforced) would un-trust every other installed
    // plugin. Seed with sil + every ID the host already records under
    // `plugins.entries`, so enabling the restriction never silently excludes a
    // previously auto-loading plugin (OQ3). Seed IDs come from the live config.
    const seed = [sil.id, ...(entries ? Object.keys(entries) : [])];
    const deduped: string[] = [];
    for (const id of seed) appendIfAbsent(deduped, id);
    plugins["allow"] = deduped;
    allowChanged = true;
  } else {
    // Non-empty → append sil only; the other trusted IDs stay, in order (AC5).
    allowChanged = appendIfAbsent(existingAllow as string[], sil.id);
  }

  // --- 2. tools.alsoAllow ----------------------------------------------------
  if (tools["alsoAllow"] !== undefined && !Array.isArray(tools["alsoAllow"])) {
    throw new AllowlistShapeError(
      "config.tools.alsoAllow must be an array when present, got: "
        + typeof tools["alsoAllow"],
    );
  }
  const existingAlsoAllow = tools["alsoAllow"] as unknown[] | undefined;
  if (existingAlsoAllow && existingAlsoAllow.some((x) => typeof x !== "string")) {
    throw new AllowlistShapeError("config.tools.alsoAllow must contain only strings");
  }
  if (existingAlsoAllow === undefined) tools["alsoAllow"] = [];
  const alsoAllowChanged = appendIfAbsent(tools["alsoAllow"] as string[], sil.id);

  // --- 3. plugins.entries.<id> -----------------------------------------------
  // Set the enable entry ONLY when absent — never overwrite an operator's
  // existing `enabled`/`config` (AC4). Create the entries container if needed.
  if (plugins["entries"] === undefined) plugins["entries"] = {};
  const entriesObj = plugins["entries"] as Record<string, unknown>;
  let entryChanged = false;
  if (!(sil.id in entriesObj)) {
    entriesObj[sil.id] = { enabled: true, config: {} } satisfies PluginEntry;
    entryChanged = true;
  }

  return {
    config: config as OpenClawConfig,
    changed: allowChanged || alsoAllowChanged || entryChanged,
  };
}
