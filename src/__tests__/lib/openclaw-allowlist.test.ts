/**
 * UNIT — mergeSilAllowlist() merge core (tier: unit, pure, in-memory, no I/O,
 * no network, no host).
 *
 * Card: install-time-helper-to-allow-list-sil-in-openclaw. The merge core is
 * the pure, typed heart of the operator-run helper that additively + idempotently
 * trusts `sil` in the host OpenClaw config. The architect grounded the design in
 * the REAL `alpine/openclaw:2026.6.9` config schema (Discovery §"schema reality"):
 * there are exactly THREE allow surfaces and NO per-tool-name / global-skill key:
 *
 *   - `plugins.allow`   : string[] of plugin IDs (emptiness fires the auto-load warning)
 *   - `tools.alsoAllow` : string[] of plugin IDs (admits a plugin's tools by id)
 *   - `plugins.entries.<id>` : { enabled, config } (makes the plugin loadable)
 *
 * The skill is admitted WITH the plugin (per-agent `agents.list[i].skills` attach
 * is the host-wiring path's job, NOT this helper's — so the core does NOT touch
 * `agents`). `sil.tools` / `sil.skill` ride in the facts type for the operator
 * log fields; the 2026.6.9 mechanism is plugin-id admission, so the core never
 * enumerates tool names into config.
 *
 * The TWO invariants this suite exists to defend (product-owner): AC4 (additive)
 * and AC6 (idempotent). Every other case is a guard around those two.
 *
 * Contract pinned for the implementation (expert-developer):
 *   export function mergeSilAllowlist(
 *     config: unknown,
 *     sil: SilAllowlistFacts,            // { id: string; tools: string[]; skill: string }
 *   ): { config: OpenClawConfig; changed: boolean }
 *
 * Merge logic (in order, all in-memory on the parsed object):
 *   1. narrow `config` to an object — HARD THROW if not (caller → `failed` outcome);
 *   2. ensure `plugins` / `tools` containers exist (create empty if absent);
 *   3. `plugins.allow`: if absent/empty, SEED with `sil.id` + every key of
 *      `plugins.entries` (the OQ3 rule — never silently un-trust an
 *      auto-loading plugin); then append `sil.id` if absent. If already
 *      non-empty, append `sil.id` if absent. THROW if present-but-not-array.
 *   4. `tools.alsoAllow`: append `sil.id` if absent (create array if absent).
 *   5. `plugins.entries[sil.id]`: set `{ enabled: true, config: {} }` ONLY if the
 *      key is absent; NEVER touch an existing entry.
 *   6. `changed` = OR of the three mutations actually applied.
 *
 * These assertions ARE the spec. Do NOT weaken them to match an implementation.
 * Hermetic: every test builds its own in-memory fixture; no shared state.
 */

import { describe, it, expect } from "vitest";

import {
  mergeSilAllowlist,
  type SilAllowlistFacts,
} from "../../lib/openclaw-allowlist.js";

// sil's real facts (single source of truth in prod is openclaw.plugin.json; the
// unit core takes them as an argument so the test pins behaviour, not wiring).
// `skill` mirrors the real manifest value `openclaw.plugin.json#skills[0]` —
// the bundled skill ships under the sil-unique basename `./sil-shopping` (NOT
// the generic `./skill`) so the host's basename-derived publish name cannot
// collide with another co-installed plugin's `skill/` (the klodi collision the
// rename-bundled-skill card fixes). The merge core never reads `skill` (it is
// an operator-log field only), so the value is inert to behaviour here — but it
// is kept truthful to the shipped manifest so the "real facts" claim holds and
// no stale `./skill` literal survives anywhere in source/test.
const SIL: SilAllowlistFacts = {
  id: "sil",
  tools: [
    "sil_product_get",
    "sil_profile_get",
    "sil_profile_list",
    "sil_profile_materialize",
    "sil_profile_remove",
    "sil_register",
    "sil_search",
    "sil_whoami",
  ],
  skill: "./sil-shopping",
};

/** A different plugin's facts — used to prove the core is sil-agnostic in the
 *  ways that matter (it appends whatever id it's given; clobber tests use sil). */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// AC2 — plugins.allow is non-empty and explicit, includes "sil"
// ---------------------------------------------------------------------------
describe("AC2 — plugins.allow becomes non-empty and explicitly includes sil", () => {
  it("seeds sil into an ABSENT plugins.allow (no plugins block at all)", () => {
    const { config, changed } = mergeSilAllowlist({}, SIL);
    const allow = (config as { plugins: { allow: unknown } }).plugins.allow;
    expect(Array.isArray(allow)).toBe(true);
    expect(allow as string[]).toContain("sil");
    expect((allow as string[]).length).toBeGreaterThan(0);
    expect(changed).toBe(true);
  });

  it("seeds sil into an EMPTY plugins.allow array", () => {
    const input = { plugins: { allow: [] as string[] } };
    const { config, changed } = mergeSilAllowlist(input, SIL);
    const allow = (config as { plugins: { allow: string[] } }).plugins.allow;
    expect(allow).toContain("sil");
    expect(allow.length).toBeGreaterThan(0);
    expect(changed).toBe(true);
  });

  it("the restriction is now ENABLED — plugins.allow is an explicit id array, not left open", () => {
    const { config } = mergeSilAllowlist({}, SIL);
    const allow = (config as { plugins: { allow: string[] } }).plugins.allow;
    // explicit ids only — every element a non-empty string
    for (const id of allow) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// AC1 (core slice) — sil trusted at all three real surfaces after a fresh merge.
// (The full end-to-end AC1 against a file is the integration tier; here we pin
//  the in-memory result the integration test then reads back from disk.)
// ---------------------------------------------------------------------------
describe("AC1 (core) — fresh merge trusts sil at all three real surfaces", () => {
  it("adds sil to plugins.allow, tools.alsoAllow, and creates plugins.entries.sil", () => {
    const { config, changed } = mergeSilAllowlist({}, SIL);
    const c = config as {
      plugins: { allow: string[]; entries: Record<string, unknown> };
      tools: { alsoAllow: string[] };
    };
    expect(c.plugins.allow).toContain("sil");
    expect(c.tools.alsoAllow).toContain("sil");
    expect(c.plugins.entries["sil"]).toEqual({ enabled: true, config: {} });
    expect(changed).toBe(true);
  });

  it("does NOT enumerate the 8 tool NAMES into config — admission is by plugin id only", () => {
    const { config } = mergeSilAllowlist({}, SIL);
    const serialized = JSON.stringify(config);
    // The mechanism is plugin-id admission; tool names must never leak into the
    // written config (no invented `tools.allow` of names — see schema reality).
    for (const toolName of SIL.tools) {
      expect(serialized).not.toContain(toolName);
    }
    const c = config as { tools: { alsoAllow: string[] } };
    expect(c.tools.alsoAllow).toEqual(["sil"]);
  });

  it("does NOT touch agents (skill attach is the host-wiring path's job, not this core)", () => {
    const input = { agents: { list: [{ id: "shopper", skills: ["other"] }] } };
    const { config } = mergeSilAllowlist(clone(input), SIL);
    const c = config as { agents: { list: Array<{ skills: string[] }> } };
    expect(c.agents.list[0]?.skills).toEqual(["other"]);
  });
});

// ---------------------------------------------------------------------------
// AC4 — additive: pre-existing trust survives untouched (THE invariant).
// ---------------------------------------------------------------------------
describe("AC4 — additive: every pre-existing entry survives byte-for-byte", () => {
  it("preserves klodi in plugins.allow / tools.alsoAllow and its plugins.entries config", () => {
    const input = {
      plugins: {
        allow: ["klodi"],
        entries: {
          klodi: { enabled: true, config: { apiKey: "operator-set", region: "eu" } },
        },
      },
      tools: { profile: "coding", alsoAllow: ["klodi"] },
    };
    const { config } = mergeSilAllowlist(clone(input), SIL);
    const c = config as {
      plugins: { allow: string[]; entries: Record<string, unknown> };
      tools: { profile: string; alsoAllow: string[] };
    };
    // klodi preserved at every surface, with sil appended (never inserted ahead).
    expect(c.plugins.allow).toEqual(["klodi", "sil"]);
    expect(c.tools.alsoAllow).toEqual(["klodi", "sil"]);
    // klodi's operator config is byte-identical (never touched).
    expect(c.plugins.entries["klodi"]).toEqual({
      enabled: true,
      config: { apiKey: "operator-set", region: "eu" },
    });
    // unrelated keys (tools.profile) preserved.
    expect(c.tools.profile).toBe("coding");
  });

  it("never reorders an existing allow-list — appends only, at the tail", () => {
    const input = { plugins: { allow: ["alpha", "beta", "gamma"] } };
    const { config } = mergeSilAllowlist(clone(input), SIL);
    const allow = (config as { plugins: { allow: string[] } }).plugins.allow;
    expect(allow).toEqual(["alpha", "beta", "gamma", "sil"]);
  });

  it("leaves an existing plugins.entries.sil entry's operator config UNTOUCHED (no overwrite)", () => {
    const input = {
      plugins: {
        allow: ["sil"],
        entries: {
          sil: { enabled: false, config: { sil_api_url: "https://staging.example" } },
        },
      },
      tools: { alsoAllow: ["sil"] },
    };
    const { config, changed } = mergeSilAllowlist(clone(input), SIL);
    const entry = (config as { plugins: { entries: Record<string, unknown> } })
      .plugins.entries["sil"];
    // The operator's enabled:false + custom config MUST survive — never clobbered
    // to {enabled:true, config:{}}.
    expect(entry).toEqual({
      enabled: false,
      config: { sil_api_url: "https://staging.example" },
    });
    // fully pre-trusted + entry present → nothing to change.
    expect(changed).toBe(false);
  });

  it("preserves an unrelated top-level block (gateway) verbatim", () => {
    const input = {
      gateway: { mode: "local", port: 18789, auth: { mode: "token", token: "t" } },
    };
    const { config } = mergeSilAllowlist(clone(input), SIL);
    const c = config as { gateway: unknown };
    expect(c.gateway).toEqual({
      mode: "local",
      port: 18789,
      auth: { mode: "token", token: "t" },
    });
  });
});

// ---------------------------------------------------------------------------
// AC5 — additive into a populated plugins.allow.
// ---------------------------------------------------------------------------
describe("AC5 — additive into a populated plugins.allow", () => {
  it("['klodi'] becomes ['klodi','sil'] — klodi preserved, sil appended, nothing dropped", () => {
    const input = { plugins: { allow: ["klodi"] } };
    const { config, changed } = mergeSilAllowlist(clone(input), SIL);
    const allow = (config as { plugins: { allow: string[] } }).plugins.allow;
    expect(allow).toEqual(["klodi", "sil"]);
    expect(changed).toBe(true);
  });

  it("does NOT re-seed from plugins.entries when plugins.allow is already non-empty", () => {
    // allow is non-empty (['klodi']) but entries has OTHER ids — the seed rule
    // only applies to an empty/absent allow. A non-empty allow is appended-to,
    // not re-seeded, so memory-core is NOT pulled in here (the operator already
    // chose their explicit list).
    const input = {
      plugins: {
        allow: ["klodi"],
        entries: { klodi: {}, "memory-core": {}, codex: {} },
      },
    };
    const { config } = mergeSilAllowlist(clone(input), SIL);
    const allow = (config as { plugins: { allow: string[] } }).plugins.allow;
    expect(allow).toEqual(["klodi", "sil"]);
    expect(allow).not.toContain("memory-core");
    expect(allow).not.toContain("codex");
  });
});

// ---------------------------------------------------------------------------
// AC6 (core slice) — idempotent: a fully-merged input yields changed:false and
// no mutation. (The "no second .bak / byte-identical file" half is integration.)
// ---------------------------------------------------------------------------
describe("AC6 (core) — idempotent: second merge of an already-merged config is a no-op", () => {
  it("reports changed:false and produces an equal config when sil is already trusted everywhere", () => {
    const merged = mergeSilAllowlist({}, SIL).config;
    const second = mergeSilAllowlist(clone(merged), SIL);
    expect(second.changed).toBe(false);
    expect(second.config).toEqual(merged);
  });

  it("never duplicates sil in plugins.allow or tools.alsoAllow on a re-run", () => {
    const merged = mergeSilAllowlist({}, SIL).config;
    const { config } = mergeSilAllowlist(clone(merged), SIL);
    const c = config as {
      plugins: { allow: string[] };
      tools: { alsoAllow: string[] };
    };
    expect(c.plugins.allow.filter((x) => x === "sil")).toHaveLength(1);
    expect(c.tools.alsoAllow.filter((x) => x === "sil")).toHaveLength(1);
  });

  it("running the merge a THIRD time still changes nothing (stable fixpoint)", () => {
    let cfg = mergeSilAllowlist({}, SIL).config;
    cfg = mergeSilAllowlist(clone(cfg), SIL).config;
    const third = mergeSilAllowlist(clone(cfg), SIL);
    expect(third.changed).toBe(false);
    expect(third.config).toEqual(cfg);
  });

  it("changed:true when sil is in plugins.allow but MISSING from tools.alsoAllow (partial prior state)", () => {
    // Defends against a half-applied prior run: any one missing surface → changed.
    const input = {
      plugins: { allow: ["sil"], entries: { sil: { enabled: true, config: {} } } },
      tools: { alsoAllow: [] as string[] },
    };
    const { config, changed } = mergeSilAllowlist(clone(input), SIL);
    expect(changed).toBe(true);
    expect((config as { tools: { alsoAllow: string[] } }).tools.alsoAllow).toContain("sil");
  });

  it("changed:true when sil is trusted but its plugins.entries entry is MISSING", () => {
    const input = {
      plugins: { allow: ["sil"], entries: {} as Record<string, unknown> },
      tools: { alsoAllow: ["sil"] },
    };
    const { config, changed } = mergeSilAllowlist(clone(input), SIL);
    expect(changed).toBe(true);
    expect((config as { plugins: { entries: Record<string, unknown> } }).plugins.entries["sil"])
      .toEqual({ enabled: true, config: {} });
  });
});

// ---------------------------------------------------------------------------
// AC9 (OQ3) — enabling the restriction never un-trusts an auto-loading plugin.
// ---------------------------------------------------------------------------
describe("AC9 / OQ3 — seeding from plugins.entries never silently excludes a previously-auto-loading plugin", () => {
  it("empty allow + other entries → allow seeded with sil AND every plugins.entries id", () => {
    const input = {
      plugins: {
        allow: [] as string[],
        entries: {
          codex: { enabled: true },
          "memory-core": { enabled: true, config: {} },
        },
      },
    };
    const { config, changed } = mergeSilAllowlist(clone(input), SIL);
    const allow = (config as { plugins: { allow: string[] } }).plugins.allow;
    // Flipping empty (permissive) → non-empty (explicit) must carry the
    // previously-auto-loading plugins with it.
    expect(allow).toContain("sil");
    expect(allow).toContain("codex");
    expect(allow).toContain("memory-core");
    expect(changed).toBe(true);
  });

  it("ABSENT allow + other entries → same OQ3 seeding (codex + memory-core + sil)", () => {
    const input = {
      plugins: {
        entries: { codex: { enabled: true }, "memory-core": { enabled: true } },
      },
    };
    const { config } = mergeSilAllowlist(clone(input), SIL);
    const allow = (config as { plugins: { allow: string[] } }).plugins.allow;
    expect(new Set(allow)).toEqual(new Set(["codex", "memory-core", "sil"]));
  });

  it("reads the pre-existing ids FROM THE CONFIG, never a hardcoded list", () => {
    // A bespoke set of entry ids the helper could not possibly hardcode.
    const input = {
      plugins: {
        allow: [] as string[],
        entries: {
          "acme-widgets": { enabled: true },
          "zeta-9": { enabled: true },
        },
      },
    };
    const { config } = mergeSilAllowlist(clone(input), SIL);
    const allow = (config as { plugins: { allow: string[] } }).plugins.allow;
    expect(allow).toContain("acme-widgets");
    expect(allow).toContain("zeta-9");
    expect(allow).toContain("sil");
  });

  it("does NOT duplicate an id that is already both an entry AND already in allow", () => {
    // Defends the seed against double-counting an id present in both places.
    const input = {
      plugins: {
        allow: ["codex"],
        entries: { codex: { enabled: true } },
      },
    };
    // allow non-empty → append-only path (no re-seed). codex stays single; sil appended.
    const { config } = mergeSilAllowlist(clone(input), SIL);
    const allow = (config as { plugins: { allow: string[] } }).plugins.allow;
    expect(allow.filter((x) => x === "codex")).toHaveLength(1);
    expect(allow).toEqual(["codex", "sil"]);
  });
});

// ---------------------------------------------------------------------------
// Untrusted-shape config — the file is operator-editable. The core narrows
// defensively and FAILS CLOSED (hard throw) on the shapes it must not coerce.
// (Risk: "Untrusted-shape config" + "non-array plugins.allow is a hard error".)
// ---------------------------------------------------------------------------
describe("untrusted-shape config — narrow defensively, fail closed on un-coercible shapes", () => {
  it("THROWS when config is not an object (string)", () => {
    expect(() => mergeSilAllowlist("not-a-config", SIL)).toThrow();
  });

  it("THROWS when config is null", () => {
    expect(() => mergeSilAllowlist(null, SIL)).toThrow();
  });

  it("THROWS when config is an array (JSON arrays are objects but not a config object)", () => {
    expect(() => mergeSilAllowlist([], SIL)).toThrow();
  });

  it("THROWS when config is a number", () => {
    expect(() => mergeSilAllowlist(42, SIL)).toThrow();
  });

  it("THROWS when plugins.allow is present but NOT an array (do not coerce → clobber risk)", () => {
    expect(() =>
      mergeSilAllowlist({ plugins: { allow: "sil" } }, SIL),
    ).toThrow();
  });

  it("THROWS when plugins.allow is an object, not an array", () => {
    expect(() =>
      mergeSilAllowlist({ plugins: { allow: { sil: true } } }, SIL),
    ).toThrow();
  });

  it("THROWS when tools.alsoAllow is present but NOT an array", () => {
    expect(() =>
      mergeSilAllowlist({ tools: { alsoAllow: "sil" } }, SIL),
    ).toThrow();
  });

  it("returns NOTHING usable on a bad-shape throw — the caller cannot act on a half-merge", () => {
    // The card's no-half-write guarantee lives at the FILE boundary (the shell
    // parses fresh + writes via tmp→rename), so the core is free to mutate its
    // argument; what MUST hold here is that an un-coercible shape produces a
    // throw, not a silently-returned partially-merged object the shell would
    // then write. We assert the throw is total — no value escapes.
    let returned: unknown = "sentinel";
    expect(() => {
      returned = mergeSilAllowlist({ plugins: { allow: "sil" } }, SIL);
    }).toThrow();
    expect(returned).toBe("sentinel");
  });

  it("creates an absent plugins container (does not throw on a bare {})", () => {
    const { config } = mergeSilAllowlist({}, SIL);
    const c = config as { plugins: { allow: string[]; entries: Record<string, unknown> } };
    expect(c.plugins).toBeDefined();
    expect(Array.isArray(c.plugins.allow)).toBe(true);
  });

  it("creates an absent tools container with alsoAllow", () => {
    const { config } = mergeSilAllowlist({}, SIL);
    const c = config as { tools: { alsoAllow: string[] } };
    expect(c.tools).toBeDefined();
    expect(Array.isArray(c.tools.alsoAllow)).toBe(true);
    expect(c.tools.alsoAllow).toContain("sil");
  });

  it("creates plugins.entries when absent, preserving an existing plugins block's other keys", () => {
    const input = { plugins: { allow: ["klodi"] } }; // no entries
    const { config } = mergeSilAllowlist(clone(input), SIL);
    const c = config as { plugins: { entries: Record<string, unknown> } };
    expect(c.plugins.entries["sil"]).toEqual({ enabled: true, config: {} });
  });
});

// ---------------------------------------------------------------------------
// Purity — the core does no I/O and does not mutate its input by reference in a
// way that surprises the caller's snapshot. (We assert it returns a config; the
// caller clones via JSON round-trip in the script. We DO require: on a no-op,
// the returned config still deep-equals the input.)
// ---------------------------------------------------------------------------
describe("purity / determinism", () => {
  it("is deterministic — same input twice yields deep-equal output", () => {
    const input = { plugins: { allow: ["klodi"], entries: { klodi: {} } } };
    const a = mergeSilAllowlist(clone(input), SIL);
    const b = mergeSilAllowlist(clone(input), SIL);
    expect(a.config).toEqual(b.config);
    expect(a.changed).toBe(b.changed);
  });

  it("on a no-op (fully merged) returns a config deep-equal to the input", () => {
    const merged = mergeSilAllowlist({}, SIL).config;
    const result = mergeSilAllowlist(clone(merged), SIL);
    expect(result.config).toEqual(merged);
    expect(result.changed).toBe(false);
  });
});
