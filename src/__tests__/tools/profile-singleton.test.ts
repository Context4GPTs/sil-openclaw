/**
 * UNIT — the consolidated SINGLETON profile surface (tier: unit, mock api + temp
 * data dir, no network, no host).
 *
 * Card: consolidate-profile-tools-to-the-singleton-surface. Two coupled changes,
 * both pinned here at the registered-tool boundary:
 *
 *   1. FOLD `sil_profile_list` INTO `sil_profile_get`. The list tool is DELETED;
 *      `sil_profile_get(domainSlug?)` reads at TWO addressing states for the ONE
 *      singleton shopper:
 *        - NO args        ⇒ the shopper top-level (absorbs list): the shared
 *          `userSpec` + the `domains` index + `unreadable[]`. An EMPTY store is
 *          `status:"ok"` empty-is-healthy — NEVER `not_found` (the load-bearing
 *          semantic three skill flows depend on).
 *        - WITH domainSlug ⇒ that domain's three bodies + the shared `userSpec`;
 *          an unknown slug ⇒ `not_found` whose `recovery` names `sil_profile_get`
 *          (NEVER the deleted `sil_profile_list`).
 *   2. DROP the caller-supplied `agentId` from `sil_profile_get` /
 *      `sil_profile_materialize` / `sil_remember` / `sil_profile_remove`. The store
 *      re-scopes to a fixed singleton path — no `agentId` in the keying, so no
 *      caller input reaches the dir join.
 *
 * The DEEP store semantics live in lib/profile-store*.test.ts; here the focus is
 * the agent-facing envelope + the registered schema shapes after consolidation.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the implementation —
 * the surface is rewritten to satisfy them.
 *
 * RED until the consolidation lands: every tool still takes `agentId` today, so a
 * no-`agentId` call resolves an empty id → `invalid_request`, and `sil_profile_list`
 * is still registered. The assertions below flip GREEN only on the slim surface.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { registerProfileTools } from "../../tools/profile.js";
import { getDataDir } from "../../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const MATERIALIZE = "sil_profile_materialize";
const GET = "sil_profile_get";
const REMOVE = "sil_profile_remove";
const REMEMBER = "sil_remember";
const LIST = "sil_profile_list"; // the DELETED tool — referenced only to prove its absence.

/** Every profile tool that survives consolidation — exactly four, no `agentId`. */
const SURVIVING_PROFILE_TOOLS = [GET, MATERIALIZE, REMEMBER, REMOVE] as const;

let dataDir: string;
let priorSilDataDir: string | undefined;
let api: MockPluginAPI;

function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`tool result has no text payload: ${String(text)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Locate the directory holding the singleton shopper's `profile.json`, scanning
 * the data dir (the layout constant `SHOPPER_SUBDIR` is an implementation detail —
 * we never hardcode it). Returns null when no manifest exists yet. */
function findShopperDir(): string | null {
  const root = getDataDir();
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === "profile.json") return dirname(full);
    }
  }
  return null;
}

const USER_SPEC = "# User spec (shared)\n- Ships to Berlin.\nHARD-NO: leather.";
const CYCLING = {
  slug: "road-cycling",
  name: "Road cycling",
  domainSpec: "# Domain spec — cycling\nFit, gearing, geometry.",
  intentSpec: "# Intent spec — cycling\nuse-case, terrain, budget.",
  playbook: "# Taste — cycling\n~€1500; Shimano over SRAM.",
};
const RUNNING = {
  slug: "running-shoes",
  name: "Running shoes",
  domainSpec: "# Domain spec — running\nLast, stack, drop, foam.",
  intentSpec: "# Intent spec — running\nsurface, distance, gait.",
  playbook: "# Taste — running\nUnder €160; neutral foam.",
};

/** Create the singleton shopper — NO `agentId` (the slim surface). */
async function createShopper(): Promise<Record<string, unknown>> {
  return payloadOf(
    await getTool(api, MATERIALIZE).execute("c", { name: "sil shopper", userSpec: USER_SPEC }),
  );
}

/** Mint a niche onto the singleton shopper — NO `agentId`. */
async function mint(domain: typeof CYCLING): Promise<Record<string, unknown>> {
  return payloadOf(
    await getTool(api, MATERIALIZE).execute("m", {
      name: "sil shopper",
      userSpec: USER_SPEC,
      domain,
    }),
  );
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-singleton-tool-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  api = createMockPluginApi();
  registerProfileTools(api);
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

// ===========================================================================
// Slim signatures — the four surviving tools declare NO `agentId`
// ===========================================================================

describe("consolidated surface — the four profile tool schemas declare NO `agentId`", () => {
  it.each(SURVIVING_PROFILE_TOOLS)(
    "%s — its TypeBox parameter schema has no `agentId` property and never requires it",
    (toolName) => {
      const tool = getTool(api, toolName);
      const schema = tool.parameters as unknown as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      // The whole point of the singleton re-scope: `agentId` is no longer a
      // caller-facing param on ANY surviving profile tool.
      expect(schema.properties?.["agentId"]).toBeUndefined();
      expect(schema.required ?? []).not.toContain("agentId");
    },
  );

  it("the deleted `sil_profile_list` tool is NOT registered (folded into sil_profile_get)", () => {
    expect(api._tools.has(LIST)).toBe(false);
  });

  it("registerProfileTools registers EXACTLY the four profile verbs (sil_profile_list gone)", () => {
    expect([...api._tools.keys()].sort()).toEqual(
      [GET, MATERIALIZE, REMEMBER, REMOVE].sort(),
    );
  });
});

// ===========================================================================
// Folded sil_profile_get — Zoom A (no args): absorbs sil_profile_list
// ===========================================================================

describe("sil_profile_get — Zoom A (no args) on an EMPTY store is `ok` empty-is-healthy (NOT not_found)", () => {
  it("an empty store → status ok with `unreadable: []` and NO shopper content — never not_found", async () => {
    // THE load-bearing semantic change of the fold: the no-args zoom adopts list's
    // empty-is-healthy `ok` (the create-collision check + "you haven't set up a
    // shopper yet" framing + the shop-time existence check all depend on it). The
    // old overview's `not_found`-on-empty would regress those three flows.
    const payload = payloadOf(await getTool(api, GET).execute("e-1", {}));
    expect(payload["status"]).toBe("ok");
    expect(payload["status"]).not.toBe("not_found");
    expect(payload["unreadable"]).toEqual([]);
    // No shopper exists yet → no shared user spec, no domains. (The implementer MAY
    // also carry an explicit no-shopper boolean; the load-bearing contract is the
    // empty-is-healthy `ok` + the absence of shopper content.)
    expect(payload["userSpec"] == null).toBe(true);
    expect(((payload["domains"] as unknown[]) ?? []).length).toBe(0);
  });
});

describe("sil_profile_get — Zoom A (no args) with a shopper present carries the overview + unreadable[]", () => {
  it("returns status ok with the shared userSpec, the domains index, unreadable: [], and NO per-domain bodies", async () => {
    await createShopper();
    await mint(CYCLING);

    const payload = payloadOf(await getTool(api, GET).execute("a-1", {}));
    expect(payload["status"]).toBe("ok");
    // The shared userSpec is now available at no-args — a strict GAIN over the old
    // sil_profile_list (which returned only the index).
    expect(payload["userSpec"]).toBe(USER_SPEC);
    const domains = (payload["domains"] as Array<Record<string, unknown>>) ?? [];
    expect(domains.map((d) => d["slug"])).toEqual([CYCLING.slug]);
    // The degraded-directory array carried over from list.
    expect(payload["unreadable"]).toEqual([]);
    // Zoom A is the cheap index — it does NOT inline per-domain bodies.
    expect(payload["domainSpec"]).toBeUndefined();
  });
});

describe("sil_profile_get — Zoom A reports a degraded directory in unreadable[] without aborting the read", () => {
  it("a corrupt shopper manifest → status ok (never not_found, never a throw) with the degraded dir in unreadable[]", async () => {
    // AC: a degraded/legacy-flat/corrupt directory is surfaced inline in
    // `unreadable[]`, never hides a healthy shopper, never aborts the read. Here the
    // "instead of a healthy shopper" variant: the singleton's own manifest is
    // corrupt — the no-args read must still return `ok` and report it, not crash.
    await createShopper();
    await mint(CYCLING);
    const shopperDir = findShopperDir();
    if (shopperDir !== null) {
      writeFileSync(join(shopperDir, "profile.json"), "not json {{{", { mode: 0o600 });
    }

    const result = await getTool(api, GET).execute("d-1", {});
    const payload = payloadOf(result);
    expect(payload["status"]).toBe("ok");
    expect(payload["status"]).not.toBe("not_found");
    const unreadable = (payload["unreadable"] as unknown[]) ?? [];
    expect(unreadable.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Folded sil_profile_get — Zoom C (domainSlug)
// ===========================================================================

describe("sil_profile_get — Zoom C (domainSlug): one domain's three bodies + the shared userSpec", () => {
  it("a KNOWN slug → status ok with domainSpec + intentSpec + playbook AND the shared userSpec", async () => {
    await createShopper();
    await mint(CYCLING);

    const payload = payloadOf(
      await getTool(api, GET).execute("c-1", { domainSlug: CYCLING.slug }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["slug"]).toBe(CYCLING.slug);
    expect(payload["domainSpec"]).toBe(CYCLING.domainSpec);
    expect(payload["intentSpec"]).toBe(CYCLING.intentSpec);
    expect(payload["playbook"]).toBe(CYCLING.playbook);
    expect(payload["userSpec"]).toBe(USER_SPEC);
  });

  it("an UNKNOWN slug → status not_found whose recovery is `sil_profile_get` (NEVER the deleted sil_profile_list)", async () => {
    await createShopper();
    await mint(CYCLING);

    const result = await getTool(api, GET).execute("c-2", { domainSlug: "never-minted" });
    const payload = payloadOf(result);
    expect(payload["status"]).toBe("not_found");
    // The recovery hint MUST re-point to the folded no-args read — a hint naming the
    // deleted tool would route the skill to a nonexistent tool (SKILL.md contract).
    expect(payload["recovery"]).toBe(GET);
    // Belt-and-braces: the deleted tool name must not appear ANYWHERE in the envelope.
    expect(JSON.stringify(payload)).not.toContain(LIST);
  });

  it.each(["../escape", "road/cycling", "..", "main", "Road-Cycling"])(
    "a malformed/traversal/main slug %j → status invalid_request(field=domainSlug), reads nothing",
    async (bad) => {
      await createShopper();
      const payload = payloadOf(
        await getTool(api, GET).execute("c-3", { domainSlug: bad }),
      );
      expect(payload["status"]).toBe("invalid_request");
      expect(payload["field"]).toBe("domainSlug");
    },
  );
});

// ===========================================================================
// Agent-facing copy — descriptions drop `agentId` + `sil_profile_list`
// ===========================================================================

describe("consolidated surface — tool descriptions never instruct `agentId` and never name the deleted sil_profile_list", () => {
  it.each(SURVIVING_PROFILE_TOOLS)(
    "%s — description does not say `agentId` and does not reference sil_profile_list",
    (toolName) => {
      const description = getTool(api, toolName).description ?? "";
      expect(description).not.toContain("agentId");
      expect(description).not.toContain(LIST);
    },
  );

  it("sil_profile_get's description states BOTH zooms — the no-args overview AND the domainSlug pack", () => {
    const description = (getTool(api, GET).description ?? "").toLowerCase();
    // The no-args zoom (shopper identity + shared user spec + domains index)…
    expect(description).toContain("domain");
    expect(/no.{0,12}domainslug|without a .?domainslug|omit/.test(description)).toBe(true);
    // …vs the per-domain zoom.
    expect(description).toContain("domainslug");
  });
});

// ===========================================================================
// sil_profile_remove stays standalone + destructive (not folded into a read/write)
// ===========================================================================

describe("sil_profile_remove — standalone, domain-scoped, destructive (no agentId)", () => {
  it("removes exactly ONE domain leaf; the shopper, shared userSpec, and sibling domains survive", async () => {
    await createShopper();
    await mint(CYCLING);
    await mint(RUNNING);

    const payload = payloadOf(
      await getTool(api, REMOVE).execute("rm-1", { domainSlug: CYCLING.slug }),
    );
    expect(payload["status"]).toBe("removed");
    expect(payload["domainSlug"]).toBe(CYCLING.slug);

    // The sibling domain + the shopper overview survive (artefact-only, scoped).
    const overview = payloadOf(await getTool(api, GET).execute("rm-2", {}));
    expect(overview["status"]).toBe("ok");
    const domains = (overview["domains"] as Array<Record<string, unknown>>) ?? [];
    expect(domains.map((d) => d["slug"])).toEqual([RUNNING.slug]);
    expect(overview["userSpec"]).toBe(USER_SPEC);
  });

  it("its description keeps the destructive / confirm-before-remove framing (the delete verb stays standalone)", () => {
    const description = (getTool(api, REMOVE).description ?? "").toLowerCase();
    expect(description).toContain("destructive");
    expect(/confirm|before removing|irreversible/.test(description)).toBe(true);
  });

  it("a missing domainSlug → status invalid_request(field=domainSlug), no omit-deletes-everything", async () => {
    await createShopper();
    await mint(CYCLING);
    const payload = payloadOf(await getTool(api, REMOVE).execute("rm-3", {}));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domainSlug");
  });
});

// ===========================================================================
// sil_remember and sil_profile_materialize remain TWO distinct tools (#39 split)
// ===========================================================================

describe("consolidated surface — sil_remember and sil_profile_materialize stay separate (the #39 cheap-append / whole-doc split)", () => {
  it("both tools are registered under distinct names — the count drops via sil_profile_list, NOT a remerge", () => {
    expect(api._tools.has(REMEMBER)).toBe(true);
    expect(api._tools.has(MATERIALIZE)).toBe(true);
    expect(REMEMBER).not.toBe(MATERIALIZE);
  });

  it("sil_remember is the cheap APPEND verb; sil_profile_materialize is the whole-doc write — distinct roles", async () => {
    const rememberDesc = (getTool(api, REMEMBER).description ?? "").toLowerCase();
    const materializeDesc = (getTool(api, MATERIALIZE).description ?? "").toLowerCase();
    expect(rememberDesc).toContain("append");
    // The whole-doc materialize must not have been collapsed into an append verb.
    expect(materializeDesc).toContain("atomic");

    // And both work, end-to-end, on the singleton (no agentId): create → remember a fact.
    await createShopper();
    const remembered = payloadOf(
      await getTool(api, REMEMBER).execute("rem-1", { kind: "fact", text: "Shoe size EU 43." }),
    );
    expect(remembered["status"]).toBe("ok");
  });
});
