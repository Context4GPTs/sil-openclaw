/**
 * UNIT — sil_profile_get / sil_profile_remove tool boundary after the
 * consolidate-profile-tools-to-the-singleton-surface fold (tier: unit, mock api +
 * temp data dir, no network, no host).
 *
 * `sil_profile_list` is DELETED (folded into sil_profile_get's no-args Zoom A —
 * pinned in profile-singleton.test.ts) and the caller-supplied `agentId` is dropped
 * from every profile verb. The two surviving lifecycle reads/writes are:
 *
 *   sil_profile_get    ({ domainSlug? })
 *        - no slug ⇒ shopper overview (Zoom A — see profile-singleton.test.ts)
 *        - slug    ⇒ that domain's 3 bodies + the shared user_spec
 *   sil_profile_remove ({ domainSlug })  — domainSlug REQUIRED: remove ONE domain
 *        pack (artefact-only), NOT the shopper. No omit-deletes-everything.
 *
 * The pure store-primitive invariants live in lib/profile-store-manage.test.ts;
 * here we pin the TOOL boundary — registration shapes (NO agentId) + the structured
 * per-domain / remove envelopes, and that remove clears exactly the named domain
 * leaf while a sibling survives.
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
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProfileTools } from "../../tools/profile.js";
import {
  materializeProfile,
  getShopperArtefactDir,
  getDomainArtefactDir,
  type ProfileSpec,
} from "../../lib/profile-store.js";
import { getTokensPath } from "../../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const GET = "sil_profile_get";
const REMOVE = "sil_profile_remove";

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

const USER_SPEC = "# User spec (shared)\n- Ships to Berlin.\nHARD-NO: leather.";

function pack(slug: string, name: string): NonNullable<ProfileSpec["domain"]> {
  return {
    slug,
    name,
    domainSpec: `# Domain spec — ${name}\nResearched mechanics.`,
    intentSpec: `# Intent spec — ${name}\nDecomposition dimensions.`,
    playbook: `# Taste — ${name}\nSeeded preferences.`,
  };
}

/** Create the singleton shopper, then mint each (slug → name) domain via the
 * real store (no agentId). */
function makeShopper(
  domains: ReadonlyArray<readonly [string, string]> = [],
): void {
  const created = materializeProfile({ name: "sil shopper", userSpec: USER_SPEC });
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
  for (const [slug, name] of domains) {
    const r = materializeProfile({ name: "sil shopper", userSpec: USER_SPEC, domain: pack(slug, name) });
    if (!r.ok) throw new Error(`mint ${slug} failed: ${JSON.stringify(r)}`);
  }
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-manage-tool-"));
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
// Registration shape — NO agentId on either surviving tool
// ===========================================================================

describe("management tools — registration shape (no caller agentId)", () => {
  it("registers sil_profile_get with an OPTIONAL domainSlug and NO agentId", () => {
    const tool = getTool(api, GET);
    expect(tool.name).toBe(GET);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(schema.properties?.["domainSlug"]?.type).toBe("string");
    expect(schema.properties?.["agentId"]).toBeUndefined();
    // domainSlug is optional — get with no slug returns the shopper overview (Zoom A).
    expect(schema.required ?? []).not.toContain("domainSlug");
    expect(schema.required ?? []).not.toContain("agentId");
  });

  it("registers sil_profile_remove with domainSlug REQUIRED and NO agentId (no omit-deletes-everything)", () => {
    const tool = getTool(api, REMOVE);
    expect(tool.name).toBe(REMOVE);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(schema.properties?.["domainSlug"]?.type).toBe("string");
    expect(schema.properties?.["agentId"]).toBeUndefined();
    expect(schema.required ?? []).toContain("domainSlug");
    expect(schema.required ?? []).not.toContain("agentId");
  });
});

// ===========================================================================
// sil_profile_get — per-domain (the no-args overview is pinned in profile-singleton)
// ===========================================================================

describe("sil_profile_get — per-domain (domainSlug): the 3 bodies + the shared user_spec", () => {
  it("returns status ok with domainSpec + intentSpec + playbook AND the shared user_spec", async () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    const payload = payloadOf(
      await getTool(api, GET).execute("c-6", { domainSlug: "road-cycling" }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["slug"]).toBe("road-cycling");
    expect(payload["domainSpec"]).toBe("# Domain spec — Road cycling\nResearched mechanics.");
    expect(payload["intentSpec"]).toBe("# Intent spec — Road cycling\nDecomposition dimensions.");
    expect(payload["playbook"]).toBe("# Taste — Road cycling\nSeeded preferences.");
    expect(payload["userSpec"]).toBe(USER_SPEC);
  });
});

describe("sil_profile_get — graceful failures (recovery re-pointed to sil_profile_get)", () => {
  it("an unknown domainSlug → status not_found whose recovery is sil_profile_get (never sil_profile_list)", async () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    const payload = payloadOf(
      await getTool(api, GET).execute("c-7", { domainSlug: "never-minted" }),
    );
    expect(payload["status"]).toBe("not_found");
    expect(payload["recovery"]).toBe("sil_profile_get");
    expect(JSON.stringify(payload)).not.toContain("sil_profile_list");
  });

  it.each(["../escape", "shop/per", "..", "main", "Road-Cycling"])(
    "a traversal/main domainSlug %j → status invalid_request(field=domainSlug)",
    async (bad) => {
      makeShopper([["road-cycling", "Road cycling"]]);
      const payload = payloadOf(
        await getTool(api, GET).execute("c-9", { domainSlug: bad }),
      );
      expect(payload["status"]).toBe("invalid_request");
      expect(payload["field"]).toBe("domainSlug");
    },
  );
});

// ===========================================================================
// sil_profile_remove — one domain pack, scoped
// ===========================================================================

describe("sil_profile_remove — clears one domain leaf, sibling + shopper survive (scoped)", () => {
  it("removed → status removed; the target leaf is gone; a sibling domain + the shopper survive", async () => {
    makeShopper([
      ["road-cycling", "Road cycling"],
      ["running-shoes", "Running shoes"],
    ]);
    expect(existsSync(getDomainArtefactDir("road-cycling"))).toBe(true);

    const payload = payloadOf(
      await getTool(api, REMOVE).execute("c-10", { domainSlug: "road-cycling" }),
    );
    expect(payload["status"]).toBe("removed");
    expect(payload["domainSlug"]).toBe("road-cycling");

    expect(existsSync(getDomainArtefactDir("road-cycling"))).toBe(false);
    expect(existsSync(getDomainArtefactDir("running-shoes"))).toBe(true);
    // The shopper + the shared user_spec survive (artefact-only removal).
    expect(existsSync(join(getShopperArtefactDir(), "user_spec.md"))).toBe(true);
  });
});

describe("sil_profile_remove — required slug, idempotent, fail-closed", () => {
  it("a MISSING domainSlug → status invalid_request(field=domainSlug), deletes nothing", async () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    // Omit domainSlug entirely — the tool must refuse, never fall through to a
    // whole-shopper delete.
    const payload = payloadOf(await getTool(api, REMOVE).execute("c-11", {}));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domainSlug");
    expect(existsSync(getDomainArtefactDir("road-cycling"))).toBe(true);
    expect(existsSync(getShopperArtefactDir())).toBe(true);
  });

  it("absent slug → status not_found (idempotent: a re-run is also not_found), deletes nothing", async () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    const first = payloadOf(
      await getTool(api, REMOVE).execute("c-12", { domainSlug: "never-minted" }),
    );
    expect(first["status"]).toBe("not_found");
    expect(existsSync(getDomainArtefactDir("road-cycling"))).toBe(true);
    const second = payloadOf(
      await getTool(api, REMOVE).execute("c-13", { domainSlug: "never-minted" }),
    );
    expect(second["status"]).toBe("not_found");
  });

  it.each(["../escape", "road/cycling", "..", "main", "Road-Cycling"])(
    "a traversal/main domainSlug %j → status invalid_request(field=domainSlug), deletes nothing",
    async (bad) => {
      makeShopper([["road-cycling", "Road cycling"]]);
      const payload = payloadOf(
        await getTool(api, REMOVE).execute("c-14", { domainSlug: bad }),
      );
      expect(payload["status"]).toBe("invalid_request");
      expect(payload["field"]).toBe("domainSlug");
      expect(existsSync(getDomainArtefactDir("road-cycling"))).toBe(true);
    },
  );
});

// ===========================================================================
// Identity boundary — no token side effect across any management tool
// ===========================================================================

describe("management tools — no identity coupling (no token side effect)", () => {
  it("get and remove read/write no token across a full cycle", async () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    await getTool(api, GET).execute("c-15", {});
    await getTool(api, GET).execute("c-16", { domainSlug: "road-cycling" });
    await getTool(api, REMOVE).execute("c-17", { domainSlug: "road-cycling" });
    expect(existsSync(getTokensPath())).toBe(false);
  });
});
