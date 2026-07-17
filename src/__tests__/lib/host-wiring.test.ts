/**
 * UNIT — `detectWiringDrift()` + `readSilWiringFacts()` + `readHostVersion()`
 * (tier: unit; pure config literals, zero I/O, zero network, no host present).
 *
 * Card: self-upgrade-detect-host-wiring-advisory — **AC4, AC8, AC9** (+ the
 * `readHostVersion` seam AC2/AC10 depend on).
 *
 * This is the incident-#1 detector. A skill attaches per-agent at
 * `agents.list[i].skills` by its **published name** (`sil-shopping` = the skill-dir
 * basename); tools admit by **plugin id** (`sil` in `tools.alsoAllow`). They are two
 * different host keys, and conflating them is what seeded incident #1 — silently,
 * because the host fails a bad skill ref with a warning, not an error.
 *
 * The four things this file exists to catch:
 *
 * 1. **The empty-allow FALSE POSITIVE (AC9).** An empty/absent `plugins.allow` is
 *    the permissive default that auto-loads every discovered plugin
 *    (`openclaw-allowlist.ts:4-7`, `:36-40`, `:164-175`) — sil **is** allowed, so it
 *    is **not** drift. Flagging it fires a false advisory on a correctly-working
 *    default install. This is the easiest false positive in the card to ship.
 * 2. **The enable≠admit FALSE NEGATIVE.** `plugins.entries.sil.enabled === true`
 *    does NOT mean sil's tools are admitted — that is the half-trust state (the
 *    agent-creation-engine bug: plugin loads, tools stay filtered). A detector that
 *    treats "enabled" as evidence of admission goes silent in exactly the state
 *    `wiring.tools_not_admitted` exists for.
 * 3. **A HARDCODED id/skill name.** Every `detectWiringDrift` test below drives
 *    SYNTHETIC facts (`ALIEN`) alongside the real ones, and asserts the findings
 *    name the synthetic values. A detector with `"sil"` / `"sil-shopping"` baked in
 *    passes the real-facts tests and fails the alien ones — which is the point: the
 *    published name must come from the shipped manifest, never a literal that drifts
 *    the day the skill dir is renamed (the rename card is incident #1's root).
 * 4. **A fix string that BREAKS the host.** `tools.alsoAllow` is overwrite-only on
 *    2026.6.9, so an inline `openclaw config set tools.alsoAllow …` clobbers every
 *    other admitted plugin. A "fix" that breaks klodi to fix sil is not a fix (AC4).
 *
 * Contract pinned for the implementation (expert-developer) — src/lib/host-wiring.ts:
 *
 *   export interface SilWiringFacts { readonly id: string; readonly skill: string }
 *     — `id`    = the plugin id (`openclaw.plugin.json#id` → "sil").
 *     — `skill` = the PUBLISHED skill name = `basename(manifest.skills[0])` →
 *       "sil-shopping". NOT the ref "./sil-shopping", NOT the plugin id.
 *
 *   export function readSilWiringFacts(): SilWiringFacts;
 *     — reads the SHIPPED `openclaw.plugin.json` (module-cached), never hardcodes.
 *       The one I/O in this module; `detectWiringDrift` itself stays pure. Mirrors
 *       `version-advisory.ts`'s pure-core + `readInstalledVersion()` split.
 *
 *   export function detectWiringDrift(config: unknown, facts: SilWiringFacts): Finding[];
 *     — PURE: no fs, no network, no mutation of `config` (it is the host's LIVE
 *       in-memory tree). `config` is `unknown` because it is operator-editable —
 *       narrow with `typeof` / `Array.isArray` at every step, and NEVER throw.
 *       Returns 0..2 findings, each `severity: "warn"`, `status: "advisory"`,
 *       `appliedAction: null`.
 *
 *   export function readHostVersion(api: PluginAPI): string | null;
 *     — the running host's version, or `null` when nothing readable is present.
 *       `null` ⇒ the compat check is INCONCLUSIVE and emits NO finding. Never
 *       throws, never fabricates.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectWiringDrift,
  readSilWiringFacts,
  readHostVersion,
  type SilWiringFacts,
} from "../../lib/host-wiring.js";
import { createMockPluginApi } from "../helpers/mock-plugin-api.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const manifest = (): { id: string; skills: string[] } =>
  JSON.parse(readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"));

// ---------------------------------------------------------------------------
// Facts. `REAL` mirrors the shipped manifest; `ALIEN` shares NO substring with
// it, so any hardcoded "sil" / "sil-shopping" in the detector fails loudly.
// ---------------------------------------------------------------------------

const REAL: SilWiringFacts = { id: "sil", skill: "sil-shopping" };
const ALIEN: SilWiringFacts = { id: "zeta", skill: "zeta-buying" };

const SKILL_MISATTACHED = "wiring.skill_misattached";
const TOOLS_NOT_ADMITTED = "wiring.tools_not_admitted";

const ids = (config: unknown, facts: SilWiringFacts = REAL): string[] =>
  detectWiringDrift(config, facts).map((f) => f.id).sort();

const only = (config: unknown, id: string, facts: SilWiringFacts = REAL) => {
  const found = detectWiringDrift(config, facts).filter((f) => f.id === id);
  expect(found).toHaveLength(1);
  return found[0]!;
};

/** An agent entry as the host writes it (`openclaw agents add` → `{id, skills}`;
 * `create-shopper.mjs` then sets `agents.list[i].skills`). */
const agent = (id: string, skills: unknown): Record<string, unknown> => ({ id, skills });

/** A fully HEALTHY config for the given facts: skill attached by published name,
 * plugin enabled, tools admitted, permissive (empty) `plugins.allow`. */
const healthy = (facts: SilWiringFacts = REAL): Record<string, unknown> => ({
  agents: { list: [agent("shopper", [facts.skill])] },
  tools: { alsoAllow: [facts.id] },
  plugins: { allow: [], entries: { [facts.id]: { enabled: true, config: {} } } },
});

// ===========================================================================
// AC8 — the drift set, exactly
// ===========================================================================

describe("detectWiringDrift — skill attached by ID instead of PUBLISHED NAME (AC8/AC3)", () => {
  it("flags an agent whose `skills` carries the plugin id and lacks the published name", () => {
    // Incident #1, verbatim: `skills: ["sil"]` where `["sil-shopping"]` was meant.
    const config = {
      ...healthy(),
      agents: { list: [agent("shopper", [REAL.id])] },
    };
    expect(ids(config)).toEqual([SKILL_MISATTACHED]);
  });

  it("is `warn` + `advisory` + `appliedAction: null` — it names a fix, it never applies one", () => {
    const finding = only(
      { ...healthy(), agents: { list: [agent("shopper", [REAL.id])] } },
      SKILL_MISATTACHED,
    );
    expect(finding.severity).toBe("warn");
    expect(finding.status).toBe("advisory");
    expect(finding.appliedAction).toBeNull();
  });

  it("carries exactly the six flat fields — no extra keys, no `advisory` sub-object", () => {
    const finding = only(
      { ...healthy(), agents: { list: [agent("shopper", [REAL.id])] } },
      SKILL_MISATTACHED,
    );
    expect(Object.keys(finding).sort()).toEqual([
      "appliedAction",
      "detected",
      "id",
      "severity",
      "status",
      "suggestedAction",
    ]);
  });

  it("`suggestedAction` names the EXACT edit — both tokens, and the agent it lands on (AC3)", () => {
    // "your wiring is wrong" without the exact edit is noise that costs a support
    // round-trip. The fix string is the only thing standing in for the mutation we
    // refuse to make (invariant 3).
    const finding = only(
      { ...healthy(), agents: { list: [agent("beta-shopper", [REAL.id])] } },
      SKILL_MISATTACHED,
    );
    expect(finding.suggestedAction).not.toBeNull();
    const fix = finding.suggestedAction!;
    expect(fix).toContain(REAL.skill);
    expect(fix).toContain(REAL.id);
    expect(fix).toContain("beta-shopper");
  });

  it("`suggestedAction` names that the edit takes effect on the next OpenClaw RELOAD (AC8, rule 3/10)", () => {
    // `api.config` is the wiring in force in the RUNNING process. An operator who
    // edits the file, sees the advisory persist, and distrusts it is worse off than
    // with no advisory: the fix is only complete if it says how it takes effect.
    const finding = only(
      { ...healthy(), agents: { list: [agent("shopper", [REAL.id])] } },
      SKILL_MISATTACHED,
    );
    expect(finding.suggestedAction!.toLowerCase()).toContain("reload");
  });

  it("`detected` names the mis-wired agent, so the operator knows WHICH one", () => {
    const finding = only(
      { ...healthy(), agents: { list: [agent("beta-shopper", [REAL.id])] } },
      SKILL_MISATTACHED,
    );
    expect(finding.detected).toContain("beta-shopper");
  });

  it("emits exactly ONE finding when SEVERAL agents are mis-wired, naming each", () => {
    // The id is bare (`wiring.skill_misattached`), not per-agent-suffixed — AC8/AC11
    // pin the exact id, and AC3 requires the doctor and the tool fold to carry the
    // SAME id. So multiple drifted agents fold into one finding that names them all;
    // dropping one silently would leave a mis-wired agent un-diagnosed forever.
    const config = {
      ...healthy(),
      agents: {
        list: [
          agent("shopper-a", [REAL.id]),
          agent("shopper-b", [REAL.skill]),
          agent("shopper-c", [REAL.id, "other-skill"]),
        ],
      },
    };
    const drift = detectWiringDrift(config, REAL).filter((f) => f.id === SKILL_MISATTACHED);
    expect(drift).toHaveLength(1);
    expect(drift[0]!.detected).toContain("shopper-a");
    expect(drift[0]!.detected).toContain("shopper-c");
  });

  it("NAMES NOTHING FROM THE MANIFEST ITSELF — the detector is fact-driven, never hardcoded", () => {
    // The anti-hardcode proof. Same drift, ALIEN facts: a detector with "sil" /
    // "sil-shopping" baked in reports nothing here (or reports the wrong tokens),
    // and the published name silently rots the day the skill dir is renamed — which
    // is exactly incident #1's root.
    const config = {
      ...healthy(ALIEN),
      agents: { list: [agent("zeta-agent", [ALIEN.id])] },
    };
    const finding = only(config, SKILL_MISATTACHED, ALIEN);
    expect(finding.suggestedAction).toContain(ALIEN.skill);
    expect(finding.suggestedAction).toContain(ALIEN.id);
    expect(finding.detected).toContain("zeta-agent");
    // And it must not smuggle sil's own names into an alien-facts run.
    expect(finding.detected + finding.suggestedAction).not.toContain("sil-shopping");
  });
});

describe("detectWiringDrift — tools not admitted: the half-trust state (AC8/AC4)", () => {
  it("flags a NON-EMPTY `tools.alsoAllow` that omits the plugin id", () => {
    const config = {
      ...healthy(),
      tools: { alsoAllow: ["klodi", "other-plugin"] },
    };
    expect(ids(config)).toEqual([TOOLS_NOT_ADMITTED]);
  });

  it("STILL flags it when the plugin is ENABLED — enable ≠ admit (the false-negative trap)", () => {
    // The exact agent-creation-engine bug: `plugins.entries.sil.enabled === true`
    // (the plugin loads) while a non-empty `tools.alsoAllow` omits it (every sil
    // tool stays filtered). An implementation that reads `enabled` as evidence of
    // admission goes silent in precisely the state this finding exists for — and
    // the register-time log is the ONLY surface alive there.
    const config = {
      agents: { list: [agent("shopper", [REAL.skill])] },
      tools: { alsoAllow: ["klodi"] },
      plugins: { allow: [], entries: { [REAL.id]: { enabled: true, config: {} } } },
    };
    expect(ids(config)).toEqual([TOOLS_NOT_ADMITTED]);
  });

  it("flags `plugins.entries.<id>.enabled === false` — a disabled entry admits nothing (AC8)", () => {
    const config = {
      ...healthy(),
      plugins: { allow: [], entries: { [REAL.id]: { enabled: false, config: {} } } },
    };
    expect(ids(config)).toContain(TOOLS_NOT_ADMITTED);
  });

  it("is `warn` + `advisory` + `appliedAction: null`, with exactly the six flat fields", () => {
    const finding = only({ ...healthy(), tools: { alsoAllow: ["klodi"] } }, TOOLS_NOT_ADMITTED);
    expect(finding.severity).toBe("warn");
    expect(finding.status).toBe("advisory");
    expect(finding.appliedAction).toBeNull();
    expect(Object.keys(finding).sort()).toEqual([
      "appliedAction",
      "detected",
      "id",
      "severity",
      "status",
      "suggestedAction",
    ]);
  });

  it("AC4 — `suggestedAction` names the shipped `sil-openclaw-allowlist` bin", () => {
    // The bin is additive + idempotent across all three trust surfaces. It is the
    // ONLY fix we may name.
    const finding = only({ ...healthy(), tools: { alsoAllow: ["klodi"] } }, TOOLS_NOT_ADMITTED);
    expect(finding.suggestedAction).not.toBeNull();
    expect(finding.suggestedAction!).toContain("sil-openclaw-allowlist");
  });

  it("AC4 — `suggestedAction` NEVER names an inline `openclaw config set` (it would clobber klodi)", () => {
    // `config set tools.alsoAllow` is OVERWRITE-ONLY on 2026.6.9: following that
    // "fix" silently un-admits every other plugin already in the array. A fix that
    // breaks klodi to fix sil is not a fix — and a user only discovers it later,
    // in a different plugin, with no trail back to us.
    const finding = only({ ...healthy(), tools: { alsoAllow: ["klodi"] } }, TOOLS_NOT_ADMITTED);
    const fix = finding.suggestedAction!.toLowerCase();
    expect(fix).not.toContain("config set");
    expect(fix).not.toContain("alsoallow");
  });

  it("AC4 — the fix names the RELOAD too (edit + reload, or the advisory is incomplete)", () => {
    const finding = only({ ...healthy(), tools: { alsoAllow: ["klodi"] } }, TOOLS_NOT_ADMITTED);
    expect(finding.suggestedAction!.toLowerCase()).toContain("reload");
  });

  it("names NO config VALUE from the surrounding tree — only derived wiring facts (rule 9)", () => {
    // `api.config` is the WHOLE OpenClawConfig; the admitted list can name another
    // operator's plugins, and adjacent blocks can hold their secrets. The finding
    // reports THAT sil is unadmitted, never a dump of what else is.
    const finding = only(
      {
        ...healthy(),
        tools: { alsoAllow: ["klodi-internal-plugin-name"] },
        plugins: {
          allow: [],
          entries: {
            [REAL.id]: { enabled: true, config: {} },
            klodi: { enabled: true, config: { apiKey: "SECRET-VALUE-NEVER-EMIT" } },
          },
        },
      },
      TOOLS_NOT_ADMITTED,
    );
    const emitted = JSON.stringify(finding);
    expect(emitted).not.toContain("SECRET-VALUE-NEVER-EMIT");
    expect(emitted).not.toContain("klodi-internal-plugin-name");
  });

  it("is fact-driven — an ALIEN id drives the same detection", () => {
    const config = { ...healthy(ALIEN), tools: { alsoAllow: ["klodi"] } };
    expect(ids(config, ALIEN)).toEqual([TOOLS_NOT_ADMITTED]);
  });
});

// ===========================================================================
// AC9 — no false positive on a permissive or correct config
// ===========================================================================

describe("detectWiringDrift — silence on a healthy config (AC9/AC6, rule 6)", () => {
  it("returns NO finding for a fully healthy config", () => {
    expect(detectWiringDrift(healthy(), REAL)).toEqual([]);
  });

  it("AC9 — an EMPTY `plugins.allow` is PERMISSIVE, not drift (the false-positive trap)", () => {
    // An empty/absent `plugins.allow` is the auto-load-everything default under
    // which sil IS allowed (`openclaw-allowlist.ts:4-7`, `:36-40`, `:164-175`).
    // Flagging it fires a false advisory on a correctly-working default install —
    // on EVERY sil_* result, forever, since recurrence is the feature. This is the
    // easiest false positive in the card to ship.
    expect(detectWiringDrift({ ...healthy(), plugins: { allow: [] } }, REAL)).toEqual([]);
  });

  it("AC9 — an ABSENT `plugins.allow` is likewise permissive, not drift", () => {
    expect(
      detectWiringDrift(
        {
          agents: { list: [agent("shopper", [REAL.skill])] },
          tools: { alsoAllow: [REAL.id] },
          plugins: { entries: { [REAL.id]: { enabled: true, config: {} } } },
        },
        REAL,
      ),
    ).toEqual([]);
  });

  it("AC9 — an entirely ABSENT `plugins` block is permissive, not drift", () => {
    expect(
      detectWiringDrift(
        {
          agents: { list: [agent("shopper", [REAL.skill])] },
          tools: { alsoAllow: [REAL.id] },
        },
        REAL,
      ),
    ).toEqual([]);
  });

  it("a NON-EMPTY `plugins.allow` that omits the id is NOT reported — it is unreportable by construction", () => {
    // The plugin never loads in that state, so nothing it ships can speak (the
    // reachability matrix). Emitting a finding here would be theatre: the code path
    // cannot run. Do not write code chasing it — it is the parked §6b core track.
    expect(
      detectWiringDrift({ ...healthy(), plugins: { allow: ["klodi"], entries: {} } }, REAL),
    ).toEqual([]);
  });

  it("a NON-EMPTY `plugins.allow` that INCLUDES the id is healthy — still no finding", () => {
    expect(
      detectWiringDrift(
        {
          ...healthy(),
          plugins: {
            allow: ["klodi", REAL.id],
            entries: { [REAL.id]: { enabled: true, config: {} } },
          },
        },
        REAL,
      ),
    ).toEqual([]);
  });

  it("an agent with NO sil skill at all is NOT drift (the fan-out false positive)", () => {
    // The killer FP: a host runs many agents and only one is the shopper. "Lacks
    // the published name" cannot itself be drift, or every unrelated agent fires an
    // advisory. Drift is the agent that reached for sil and used the WRONG token.
    const config = {
      ...healthy(),
      agents: {
        list: [
          agent("shopper", [REAL.skill]),
          agent("coder", ["some-other-skill"]),
          agent("writer", []),
        ],
      },
    };
    expect(detectWiringDrift(config, REAL)).toEqual([]);
  });

  it("an agent carrying BOTH the id and the published name is NOT drift — the skill runs", () => {
    // `["sil", "sil-shopping"]`: the published name attaches, the skill is alive,
    // nothing is degraded. Absence of a problem is not a finding (rule 6).
    const config = {
      ...healthy(),
      agents: { list: [agent("shopper", [REAL.skill, REAL.id])] },
    };
    expect(detectWiringDrift(config, REAL)).toEqual([]);
  });

  it("an EMPTY/ABSENT `tools.alsoAllow` is not flagged — only a NON-EMPTY one that omits the id (AC4/AC8)", () => {
    // QA NOTE — the one arm the card pins by wording rather than by evidence.
    // AC4 and AC8 both qualify this drift as "absent from a **NON-EMPTY**
    // `tools.alsoAllow`", so that is the spec encoded here. It is the conservative
    // direction (a false advisory on a default install is the named risk class).
    // Counter-evidence worth the dev's Step-0 probe: `mergeSilAllowlist` seeds an
    // empty `plugins.allow` with every known plugin id before appending sil (the
    // OQ3 guard against un-trusting others), but does NOT do the same for an empty
    // `tools.alsoAllow` — it just appends sil. That asymmetry reads as "empty
    // alsoAllow admits nothing", which would make this state real drift. If the
    // probe confirms that, the card moves first and this test moves with it.
    // Do NOT flip it silently in either direction.
    expect(detectWiringDrift({ ...healthy(), tools: { alsoAllow: [] } }, REAL)).toEqual([]);
    expect(
      detectWiringDrift(
        {
          agents: { list: [agent("shopper", [REAL.skill])] },
          plugins: { allow: [], entries: { [REAL.id]: { enabled: true, config: {} } } },
        },
        REAL,
      ),
    ).toEqual([]);
  });
});

// ===========================================================================
// AC8 — purity, non-mutation, and hostile input
// ===========================================================================

describe("detectWiringDrift — pure, non-mutating, and unthrowable (AC8/AC12)", () => {
  it("leaves the config DEEP-EQUAL to its pre-call value", () => {
    // `api.config` is the host's LIVE in-memory tree, not a copy. The sharpest trap
    // in the card is reaching for `mergeSilAllowlist` to do this read: it is a
    // mutation planner that edits its argument in place (`openclaw-allowlist.ts`
    // :100-104, :174, :193, :202) — calling it here would silently corrupt host
    // state from a detect-only path, the precise inversion of this card's invariant.
    const config = { ...healthy(), tools: { alsoAllow: ["klodi"] } };
    const before = structuredClone(config);
    detectWiringDrift(config, REAL);
    expect(config).toEqual(before);
  });

  it("does not mutate even a DEEPLY FROZEN config — an in-place edit would throw", () => {
    // The structural counterpart to deep-equal: ESM runs strict, so any write to a
    // frozen object throws a TypeError instead of silently no-op'ing. This catches
    // a mutation that deep-equal could miss (e.g. one that writes then restores).
    const deepFreeze = <T>(value: T): T => {
      if (value !== null && typeof value === "object") {
        Object.values(value as Record<string, unknown>).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const config = deepFreeze({
      agents: { list: [agent("shopper", [REAL.id])] },
      tools: { alsoAllow: ["klodi"] },
      plugins: { allow: [], entries: {} },
    });
    expect(() => detectWiringDrift(config, REAL)).not.toThrow();
    expect(ids(config)).toEqual([SKILL_MISATTACHED, TOOLS_NOT_ADMITTED].sort());
  });

  it("issues NO network call (the card is 100% local — AC2/AC14)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      detectWiringDrift({ ...healthy(), tools: { alsoAllow: ["klodi"] } }, REAL);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("is deterministic — repeated calls yield an equal result and accumulate no state", () => {
    const config = { ...healthy(), tools: { alsoAllow: ["klodi"] } };
    expect(detectWiringDrift(config, REAL)).toEqual(detectWiringDrift(config, REAL));
  });

  it("never throws on an operator-corrupted config, whatever the shape", () => {
    // The config is operator-editable and arrives as `unknown` — every read must
    // narrow with typeof/Array.isArray. A detector that throws here takes down the
    // tool result it was folded into, turning an advisory into an outage.
    const hostile: unknown[] = [
      null,
      undefined,
      42,
      "a string config",
      [],
      {},
      { agents: null },
      { agents: "nope" },
      { agents: { list: "not-an-array" } },
      { agents: { list: [null, 7, "x"] } },
      { agents: { list: [{ id: "a", skills: "sil" }] } },
      { agents: { list: [{ id: "a", skills: [null, 3, {}] }] } },
      { agents: { list: [{ skills: [REAL.id] }] } },
      { tools: "nope" },
      { tools: { alsoAllow: "sil" } },
      { tools: { alsoAllow: [null, 3] } },
      { plugins: "nope" },
      { plugins: { allow: "sil" } },
      { plugins: { entries: "nope" } },
      { plugins: { entries: { sil: null } } },
      { plugins: { entries: { sil: "enabled" } } },
      { plugins: { entries: { sil: { enabled: "yes" } } } },
    ];
    for (const config of hostile) {
      expect(() => detectWiringDrift(config, REAL), JSON.stringify(config)).not.toThrow();
      for (const finding of detectWiringDrift(config, REAL)) {
        expect(finding.severity).toBe("warn");
        expect(finding.status).toBe("advisory");
        expect(finding.appliedAction).toBeNull();
      }
    }
  });

  it("an agent entry with a mis-attached skill but NO usable id still reports legibly", () => {
    // `agents.list[i].id` is what the fix string points at. An entry without one is
    // operator corruption — the finding must still fire (the drift is real) and
    // must not print `undefined` at the operator.
    const config = { agents: { list: [{ skills: [REAL.id] }] }, tools: { alsoAllow: [REAL.id] } };
    const drift = detectWiringDrift(config, REAL).filter((f) => f.id === SKILL_MISATTACHED);
    expect(drift).toHaveLength(1);
    expect(drift[0]!.detected).not.toContain("undefined");
    expect(drift[0]!.suggestedAction).not.toContain("undefined");
  });
});

// ===========================================================================
// readSilWiringFacts — the published name comes from the manifest, not a literal
// ===========================================================================

describe("readSilWiringFacts — the shipped manifest is the single source (incident #1's root)", () => {
  it("reports the manifest's plugin id", () => {
    expect(readSilWiringFacts().id).toBe(manifest().id);
  });

  it("reports the PUBLISHED skill name = basename(manifest.skills[0]) — not the ref, not the id", () => {
    // A skill attaches by its published name, which IS the skill-dir basename. The
    // two adjacent wrong answers are exactly incident #1's shape: attaching the ref
    // ("./sil-shopping") or the plugin id ("sil"). Derived from the manifest here,
    // never asserted against a literal, so a skill-dir rename can't rot this test
    // into agreeing with a stale detector.
    const facts = readSilWiringFacts();
    expect(facts.skill).toBe(basename(manifest().skills[0]!));
    expect(facts.skill).not.toBe(manifest().skills[0]);
    expect(facts.skill).not.toContain("/");
    expect(facts.skill).not.toBe(facts.id);
  });

  it("is usable as-is: the facts it returns detect real drift against a real-shaped config", () => {
    // Non-vacuity: facts that parse but are wrong (id and skill swapped, say) would
    // pass the field assertions above and detect nothing in production.
    const facts = readSilWiringFacts();
    const config = {
      agents: { list: [agent("shopper", [facts.id])] },
      tools: { alsoAllow: [facts.id] },
      plugins: { allow: [], entries: { [facts.id]: { enabled: true, config: {} } } },
    };
    expect(ids(config, facts)).toEqual([SKILL_MISATTACHED]);
  });
});

// ===========================================================================
// readHostVersion — the compat check's seam (AC2/AC10's `null` arm)
// ===========================================================================

describe("readHostVersion — the running host's version, or an honest null", () => {
  // SOURCE = `api.runtime.version`, and nothing else. This block originally pinned
  // `config.gateway.version` / `config.meta.version` — the card's NAMED CANDIDATES,
  // flagged here as an empirical question the Step-0 probe owed an answer to. The
  // probe ran against a live `alpine/openclaw:2026.6.9` and DISPROVED both; these
  // expectations moved with the evidence, exactly as this block's own caveat
  // pre-authorized. Re-verified independently by qa against the same image:
  //
  //   - `config.gateway` DOES NOT EXIST. A default host writes exactly
  //     `{"tools":…,"meta":{"lastTouchedVersion","lastTouchedAt"}}`.
  //   - `config.meta.version` DOES NOT EXIST. The real key is
  //     `meta.lastTouchedVersion` — and it is CONFIG-FILE PROVENANCE ("which
  //     version last wrote this file"), NOT the running host. Reading it would
  //     fabricate a compat verdict for anyone who ran a newer OpenClaw once and
  //     downgraded. AC10 forbids exactly that, so it is pinned shut below.
  //   - `api.runtime` is a real pass-through member the host builds
  //     (`api-builder-CX43eAAh.js:122` → `runtime: params.runtime`), which is what
  //     licenses re-adding it to the shim — evidence, never speculation.
  //
  // What did NOT move, and must not: the seam. `null` ⇒ no compat finding, ever.
  const withHost = (version: unknown) =>
    createMockPluginApi({ runtime: { version } as Record<string, unknown> });

  it("reads the running host's version from `api.runtime.version`", () => {
    expect(readHostVersion(withHost("2026.6.9"))).toBe("2026.6.9");
  });

  it("returns null when the host supplies no runtime at all (INCONCLUSIVE, never a guess)", () => {
    // Not hypothetical: one real load path (`registrationMode: "cli-metadata"`,
    // `loader-CUGwG1IR.js:2630`) passes `runtime: {}`, so a plugin genuinely does
    // get registered with no host version available.
    expect(readHostVersion(createMockPluginApi({}))).toBeNull();
    expect(readHostVersion(createMockPluginApi({ runtime: {} }))).toBeNull();
  });

  it("NEVER reads `config.meta.lastTouchedVersion` — that is the config's provenance, not the host", () => {
    // The fabrication trap, pinned shut. `lastTouchedVersion` is one rename away
    // from the `meta.version` this test originally guessed at, it is semver-shaped,
    // and on a real host it is RIGHT THERE next to the wiring we do read — so an
    // implementation reaching one key further looks correct and is not. Its value is
    // "which version last WROTE this file": a user who ran a newer OpenClaw once and
    // downgraded would be told their host is fine when it is not.
    const api = createMockPluginApi({
      config: { meta: { lastTouchedVersion: "9999.0.0", lastTouchedAt: "2026-07-17T09:59:47.329Z" } },
    });
    expect(readHostVersion(api)).toBeNull();
  });

  it("does not fall back to `config.gateway.version` — a dead key on the pinned host", () => {
    // Coding a fallback to a key that does not exist is speculation the card bars
    // ("re-add … ONLY if the probe proves it exists"). If a future host grows one,
    // the probe re-runs and this moves — deliberately, not by accident.
    expect(readHostVersion(createMockPluginApi({ config: { gateway: { version: "9999.0.0" } } }))).toBeNull();
  });

  it("returns null for a non-string version rather than coercing one", () => {
    // A coerced `String(2026)` would fabricate a host version and, through
    // `compareSemver`, a compat verdict — the exact fabrication AC10 forbids.
    for (const version of [2026, null, "", "   ", {}, [], true]) {
      expect(readHostVersion(withHost(version)), JSON.stringify(version)).toBeNull();
    }
  });

  it("never throws on a hostile api surface", () => {
    for (const runtime of [undefined, {}, { version: 7 }, { version: {} }] as (
      | Record<string, unknown>
      | undefined
    )[]) {
      expect(() =>
        readHostVersion(createMockPluginApi(runtime === undefined ? {} : { runtime })),
      ).not.toThrow();
    }
    expect(() =>
      readHostVersion(createMockPluginApi({ config: { meta: 7 } as Record<string, unknown> })),
    ).not.toThrow();
  });

  it("reads only in memory — no network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      readHostVersion(withHost("2026.6.9"));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
