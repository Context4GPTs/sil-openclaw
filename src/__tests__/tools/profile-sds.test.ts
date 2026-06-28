/**
 * UNIT — the domain-scoped profile tool seam, end-to-end at the tool boundary
 * (tier: unit, mock api + temp data dir, no network, no host).
 *
 * Card: single-multi-domain-sil-shopper — Slice 1, updated for
 * consolidate-profile-tools-to-the-singleton-surface. This file pins the tool
 * seam's behaviour WITHOUT adding a tool — the surface stays lean (routing is
 * skill-reasoning, NOT a new tool), and after consolidation the four profile
 * verbs take NO caller `agentId` (the store re-scopes to the singleton). It
 * covers the create→shop→cross-niche-reuse spine proven at the registered-tool
 * boundary:
 *
 *   - `registerProfileTools` registers EXACTLY the FOUR profile tools (no
 *     domain-routing tool, and no sil_profile_list — folded into sil_profile_get)
 *     — the lean-surface invariant, companion to manifest-contract's frozen 8-set.
 *   - `sil_profile_materialize` distinguishes CREATE (no domain → no domain echo)
 *     from MINT (with domain → a domain echo).
 *   - A fact captured into the SHARED user_spec while minting niche B is read back
 *     when viewing niche A — the cross-niche reuse signal, at the tool seam.
 *   - `sil_profile_get` distinguishes the no-args overview (Zoom A — domain index,
 *     no bodies) from a per-domain read (slug → the 3 bodies).
 *
 * The schema/envelope mechanics live in profile-materialize.test.ts /
 * profile-manage.test.ts / profile-singleton.test.ts; here the focus is the
 * cross-tool flow.
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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProfileTools } from "../../tools/profile.js";
import {
  createMockPluginApi,
  getTool,
  registeredToolNames,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const MATERIALIZE = "sil_profile_materialize";
const GET = "sil_profile_get";

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

const USER_SPEC_V1 = "# User spec (shared)\n- Ships to Berlin.\nHARD-NO: leather.";
const USER_SPEC_V2 = USER_SPEC_V1 + "\n- Allergic to wool (captured while shopping running).";

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

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-sds-tool-"));
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

describe("the profile surface stays LEAN — exactly four verbs, no sil_profile_list, no domain-routing tool", () => {
  it("registerProfileTools registers EXACTLY the four profile verbs (routing is skill-reasoning, list folded into get)", () => {
    // sil_remember (card: sil-remember-append-memory-tool) is the lightweight
    // per-query memory APPEND verb; sil_profile_list (card:
    // list-view-and-remove-local-expert-agents) was FOLDED into sil_profile_get's
    // no-args Zoom A by the consolidate-profile-tools card. So the group is exactly
    // four — the surface stays lean.
    expect([...registeredToolNames(api)].sort()).toEqual(
      [
        "sil_profile_get",
        "sil_profile_materialize",
        "sil_profile_remove",
        "sil_remember",
      ].sort(),
    );
  });
});

describe("sil_profile_materialize — CREATE (no domain) vs MINT (with domain)", () => {
  it("a create (no domain) returns ok with NO domain echo", async () => {
    const payload = payloadOf(
      await getTool(api, MATERIALIZE).execute("c-1", {
        name: "sil shopper",
        userSpec: USER_SPEC_V1,
      }),
    );
    expect(payload["status"]).toBe("ok");
    // A create did not mint a niche — there is no domain in the envelope.
    expect(payload["domain"]).toBeUndefined();
  });

  it("a mint (with domain) returns ok WITH the minted domain echo", async () => {
    await getTool(api, MATERIALIZE).execute("c-2", {
      name: "sil shopper",
      userSpec: USER_SPEC_V1,
    });
    const payload = payloadOf(
      await getTool(api, MATERIALIZE).execute("c-3", {
        name: "sil shopper",
        userSpec: USER_SPEC_V1,
        domain: CYCLING,
      }),
    );
    expect(payload["status"]).toBe("ok");
    const domain = payload["domain"] as Record<string, unknown> | undefined;
    expect(domain).toBeDefined();
    expect(domain!["slug"]).toBe(CYCLING.slug);
  });
});

describe("cross-niche reuse — a shared-user_spec fact from niche B is reused in niche A (the success signal)", () => {
  it("create → mint cycling → mint running (augmented shared spec) → get cycling returns the augmented spec", async () => {
    const mat = getTool(api, MATERIALIZE);
    // Create the ONE shopper.
    await mat.execute("c-4", { name: "sil shopper", userSpec: USER_SPEC_V1 });
    // Shop niche A (cycling) — pack minted on the fly.
    await mat.execute("c-5", {
      name: "sil shopper",
      userSpec: USER_SPEC_V1,
      domain: CYCLING,
    });
    // Shop niche B (running) in the SAME session — a new standing fact (wool
    // allergy) is captured into the SHARED user_spec alongside the running mint.
    await mat.execute("c-6", {
      name: "sil shopper",
      userSpec: USER_SPEC_V2,
      domain: RUNNING,
    });

    // Viewing niche A surfaces the LATEST shared user_spec — the fact added during
    // niche B is already there, WITHOUT being re-asked. That is the card's signal.
    const cycling = payloadOf(
      await getTool(api, GET).execute("c-7", { domainSlug: "road-cycling" }),
    );
    expect(cycling["status"]).toBe("ok");
    expect(cycling["userSpec"]).toBe(USER_SPEC_V2);
    expect(String(cycling["userSpec"])).toContain("Allergic to wool");
  });
});

describe("sil_profile_get — Zoom A overview (no args) vs per-domain (slug)", () => {
  it("the no-args overview carries the domain index but NO domain bodies; a per-domain read carries the bodies", async () => {
    const mat = getTool(api, MATERIALIZE);
    await mat.execute("c-8", { name: "sil shopper", userSpec: USER_SPEC_V1 });
    await mat.execute("c-9", {
      name: "sil shopper",
      userSpec: USER_SPEC_V1,
      domain: CYCLING,
    });

    const overview = payloadOf(await getTool(api, GET).execute("c-10", {}));
    expect(overview["status"]).toBe("ok");
    const domains = overview["domains"] as Array<Record<string, unknown>>;
    expect(domains.map((d) => d["slug"])).toEqual(["road-cycling"]);
    // The overview is the cheap index — it does not inline the per-domain bodies.
    expect(overview["domainSpec"]).toBeUndefined();

    const domain = payloadOf(
      await getTool(api, GET).execute("c-11", { domainSlug: "road-cycling" }),
    );
    expect(domain["status"]).toBe("ok");
    expect(domain["domainSpec"]).toBe(CYCLING.domainSpec);
  });
});
