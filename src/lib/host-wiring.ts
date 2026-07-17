/**
 * Host-wiring drift — is sil wired the way it thinks it is?
 *
 * A skill attaches per-agent at `agents.list[i].skills` by its PUBLISHED NAME
 * (`sil-shopping` = the skill-dir basename); tools admit by PLUGIN ID (`sil`).
 * Two different host keys, and conflating them seeded incident #1 — silently,
 * because the host fails a bad skill ref with a warning, not an error.
 *
 * That silence is why this detector exists, and why the wiring advisory rides
 * every `sil_*` result: a mis-wired skill isn't running its own flow, so it
 * cannot carry its own warning. The tools are the only surviving messenger.
 *
 * DETECT ONLY. Everything here reads; nothing writes. In particular this module
 * does NOT import `openclaw-allowlist.ts`: that is a mutation planner which
 * edits its argument IN PLACE (`:100-104`, `:174`, `:193`, `:202`), and the
 * config we are handed is the host's LIVE in-memory tree. Sharing it for a read
 * would silently corrupt host state from a detect-only path. The two share
 * surface knowledge, not an operation.
 *
 * Wiring is read from `api.config` — the tree in force in the RUNNING process —
 * never from `~/.openclaw` on disk. That keeps `filesystemScope` unchanged and,
 * more importantly, reports what is actually running: a fixed-on-disk config
 * that has not been reloaded is STILL mis-wired, so the advisory persisting is
 * truthful, not stale. Hence every fix string names edit + RELOAD.
 */

import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginAPI } from "openclaw/plugin-sdk";

import type { Finding } from "./findings.js";

/** The shipped manifest, resolved relative to this module — two levels up from
 * both `src/lib/` and `dist/lib/`. It ships via `package.json#files`. */
const MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "openclaw.plugin.json",
);

/**
 * sil's own wiring identity, read from the shipped manifest — never hardcoded.
 *
 * The published name rotting into a stale literal is incident #1's exact root
 * (the skill dir was renamed), so both values are derived, and every finding
 * below names these rather than a constant.
 */
export interface SilWiringFacts {
  /** The plugin id — `openclaw.plugin.json#id`. Admits TOOLS. */
  readonly id: string;
  /** The PUBLISHED skill name = `basename(manifest.skills[0])`. Attaches the
   * SKILL. Not the ref (`./sil-shopping`), not the plugin id. */
  readonly skill: string;
}

let cachedFacts: SilWiringFacts | undefined;

/**
 * Read sil's wiring facts from the shipped manifest (module-cached).
 *
 * The one I/O in this module; `detectWiringDrift` itself stays pure. Throws when
 * the manifest is missing or shapeless: that is a broken build, not a runtime
 * state to model — the same call `readInstalledVersion()` makes.
 */
export function readSilWiringFacts(): SilWiringFacts {
  if (cachedFacts !== undefined) return cachedFacts;

  const parsed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const id = (parsed as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${MANIFEST_PATH}: manifest carries no plugin id`);
  }

  const skills = (parsed as { skills?: unknown }).skills;
  const ref = Array.isArray(skills) ? skills[0] : undefined;
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error(`${MANIFEST_PATH}: manifest declares no skill to attach`);
  }

  cachedFacts = { id, skill: basename(ref) };
  return cachedFacts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The string members of `value`, or null when it isn't an array at all. A
 * mixed array yields only its strings — the config is operator-editable, and a
 * detector that throws on junk turns an advisory into an outage. */
function stringsOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((x): x is string => typeof x === "string");
}

/**
 * The running host's version, or `null` when nothing readable is present.
 *
 * `api.runtime.version` is the ONLY source, proven by probe against a live
 * `alpine/openclaw:2026.6.9`. There is deliberately no fallback:
 * `config.gateway` does not exist, and `config.meta.lastTouchedVersion` is the
 * version that last WROTE the config file — reading that as the running host
 * would fabricate a compat verdict for anyone who ran a newer OpenClaw once and
 * downgraded. `null` ⇒ INCONCLUSIVE ⇒ no compat finding, ever.
 */
export function readHostVersion(api: PluginAPI): string | null {
  const version = api.runtime?.version;
  if (typeof version !== "string") return null;
  const trimmed = version.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Detect host-wiring drift. Pure: no I/O, no network, no mutation.
 *
 * `config` is `unknown` because it is the operator-editable OpenClawConfig tree;
 * every read narrows, and nothing here throws. Returns 0..2 findings, each
 * `warn` / `advisory` / `appliedAction: null` — we name a fix, we never apply
 * one.
 *
 * `plugins.allow` is deliberately NOT read. Empty/absent is the permissive
 * default that auto-loads everything (so sil IS allowed — flagging it would fire
 * a false advisory on a correctly-working default install), and a NON-EMPTY
 * allow that omits sil is unreportable by construction: the plugin never loads,
 * so this code never runs. Reporting neither state means reading neither key.
 */
export function detectWiringDrift(config: unknown, facts: SilWiringFacts): Finding[] {
  if (!isRecord(config)) return [];

  const findings: Finding[] = [];
  const misattached = findMisattachedAgents(config, facts);
  if (misattached.length > 0) {
    findings.push(buildSkillMisattachedFinding(misattached, facts));
  }

  const reasons = findUnadmittedReasons(config, facts);
  if (reasons.length > 0) {
    findings.push(buildToolsNotAdmittedFinding(reasons, facts));
  }

  return findings;
}

/**
 * Agents that reached for sil and used the WRONG token: `skills` carries the
 * plugin id but NOT the published name.
 *
 * Both halves are load-bearing. "Lacks the published name" alone is not drift —
 * a host runs many agents and only one is the shopper, so that would fire on
 * every unrelated agent. And an agent carrying BOTH tokens is not drift either:
 * the published name attaches, the skill runs, nothing is degraded.
 */
function findMisattachedAgents(
  config: Record<string, unknown>,
  facts: SilWiringFacts,
): string[] {
  const agents = isRecord(config["agents"]) ? config["agents"] : undefined;
  const list = Array.isArray(agents?.["list"]) ? agents["list"] : [];

  const labels: string[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry: unknown = list[i];
    if (!isRecord(entry)) continue;

    const skills = stringsOf(entry["skills"]);
    if (skills === null) continue;
    if (!skills.includes(facts.id) || skills.includes(facts.skill)) continue;

    // The fix string points at this agent, so it must be legible. An entry with
    // no usable id is operator corruption — the drift is still real, so report
    // it positionally rather than printing `undefined` at the operator.
    const id = entry["id"];
    labels.push(
      typeof id === "string" && id.length > 0 ? id : `agents.list[${i}]`,
    );
  }
  return labels;
}

/**
 * Why sil's tools are filtered, if they are. Two independent causes, folded into
 * ONE finding — AC3/AC11 pin a bare `wiring.tools_not_admitted` id that the
 * doctor and the tool fold must both carry, so it cannot be per-cause suffixed.
 *
 * ENABLE ≠ ADMIT is the false negative this exists for: `enabled: true` means
 * the plugin LOADS, not that its tools are admitted. That is the half-trust
 * state (the agent-creation-engine bug) where the register-time log is the only
 * surface still alive.
 */
function findUnadmittedReasons(
  config: Record<string, unknown>,
  facts: SilWiringFacts,
): string[] {
  const reasons: string[] = [];

  // Only a NON-EMPTY allowlist that omits the id counts: an empty/absent one
  // admits by default, and flagging it would fire on a default install.
  const tools = isRecord(config["tools"]) ? config["tools"] : undefined;
  const alsoAllow = stringsOf(tools?.["alsoAllow"]);
  if (alsoAllow !== null && alsoAllow.length > 0 && !alsoAllow.includes(facts.id)) {
    reasons.push(
      `the plugin id "${facts.id}" is absent from a non-empty \`tools.alsoAllow\``,
    );
  }

  const plugins = isRecord(config["plugins"]) ? config["plugins"] : undefined;
  const entries = isRecord(plugins?.["entries"]) ? plugins["entries"] : undefined;
  const entry = entries?.[facts.id];
  // An ABSENT entry is not drift (the host loads discovered plugins by default);
  // only an explicit `false` is.
  if (isRecord(entry) && entry["enabled"] === false) {
    reasons.push(`\`plugins.entries.${facts.id}.enabled\` is false`);
  }

  return reasons;
}

/**
 * The advisory block to spread onto a `sil_*` SUCCESS payload.
 *
 * PRESENT-ONLY-ON-DRIFT: healthy wiring yields `{}`, so the happy-path payload
 * stays byte-identical to today. Absence of a problem is not a finding, and an
 * always-present key is one consumers start depending on.
 *
 * Additive, never a wrapper: a `sil_search` result carrying an advisory is still
 * the same search result, with the same products in the same order.
 *
 * It recurs on every result while the drift persists — that is the feature, not
 * noise: the misconfiguration it reports is silent by construction, which is
 * exactly how it rotted into incident #1. It self-clears when the fix is IN
 * EFFECT (after the reload), not when the file is merely edited.
 *
 * No I/O on this hot path: `readSilWiringFacts()` is module-cached and warmed at
 * register(), where a broken build correctly fails loud instead of taking down
 * the tool result it was folded into.
 */
export function wiringAdvisories(api: PluginAPI): { advisories?: Finding[] } {
  const drift = detectWiringDrift(api.config, readSilWiringFacts());
  return drift.length === 0 ? {} : { advisories: drift };
}

function buildSkillMisattachedFinding(
  agentLabels: string[],
  facts: SilWiringFacts,
): Finding {
  const agents = agentLabels.join(", ");
  const plural = agentLabels.length > 1;
  return {
    id: "wiring.skill_misattached",
    severity: "warn",
    status: "advisory",
    detected:
      `${plural ? "Agents" : "Agent"} ${agents} attach${plural ? "" : "es"} sil by`
      + ` plugin id "${facts.id}" instead of its published skill name`
      + ` "${facts.skill}". A skill attaches by published name, so the sil skill`
      + ` is NOT running for ${plural ? "these agents" : "that agent"} — its`
      + ` tools still work, which is why this rides the tool result.`,
    suggestedAction:
      `In each listed agent's \`skills\` (${agents}), replace "${facts.id}" with`
      + ` "${facts.skill}", then reload OpenClaw — the edit takes effect on the`
      + ` next reload, and sil never reloads the gateway itself.`,
    appliedAction: null,
  };
}

function buildToolsNotAdmittedFinding(
  reasons: string[],
  facts: SilWiringFacts,
): Finding {
  return {
    id: "wiring.tools_not_admitted",
    severity: "warn",
    status: "advisory",
    detected:
      `sil's tools are not admitted by the running OpenClaw: ${reasons.join("; ")}.`
      + ` The plugin loads, but every sil_* tool stays filtered.`,
    // NEVER an inline `openclaw config set tools.alsoAllow …`: that key is
    // overwrite-only on 2026.6.9, so following such a "fix" would silently
    // un-admit every other plugin already in the array. A fix that breaks klodi
    // to fix sil is not a fix — and the user would discover it later, in a
    // different plugin, with no trail back to us. The shipped bin is additive
    // and idempotent across all three trust surfaces.
    suggestedAction:
      `Run the shipped \`sil-openclaw-allowlist\` bin — it admits "${facts.id}"`
      + ` additively, preserving every other trusted plugin — then reload`
      + ` OpenClaw. The edit takes effect on the next reload, and sil never`
      + ` writes host config or reloads the gateway itself.`,
    appliedAction: null,
  };
}
