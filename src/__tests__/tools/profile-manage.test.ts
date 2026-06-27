/**
 * UNIT — sil_profile_list / sil_profile_get / sil_profile_remove tools after the
 * single-multi-domain shopper reshape (tier: unit, mock api + temp data dir, no
 * network, no host).
 *
 * Card: single-multi-domain-sil-shopper — Slice 1. The lifecycle tools shift from
 * "experts" to "DOMAINS" semantics (same 4 tool NAMES — manifest-contract stays
 * green untouched):
 *
 *   sil_profile_list   (no args)              → { status:"ok", shoppers[], unreadable[] }
 *   sil_profile_get    ({ agentId, domainSlug? })
 *        - no slug ⇒ shopper overview (identity + shared user_spec + domain index)
 *        - slug    ⇒ that domain's 3 bodies + the shared user_spec
 *   sil_profile_remove ({ agentId, domainSlug })  — domainSlug REQUIRED: remove ONE
 *        domain pack (artefact-only), NOT the shopper. No omit-deletes-everything.
 *
 * The pure store-primitive invariants live in lib/profile-store-manage.test.ts;
 * here we pin the TOOL boundary — registration shapes + the structured envelopes,
 * and that remove clears exactly the named domain leaf while a sibling survives.
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
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProfileTools } from "../../tools/profile.js";
import {
  materializeProfile,
  getAgentArtefactDir,
  type ProfileSpec,
} from "../../lib/profile-store.js";
import { getTokensPath } from "../../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const LIST = "sil_profile_list";
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

const SHOPPER = "sil-shopper";
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

/** Create the shopper, then mint each (slug → name) domain via the real store. */
function makeShopper(
  agentId: string,
  domains: ReadonlyArray<readonly [string, string]> = [],
): void {
  const created = materializeProfile({ agentId, name: `Shopper ${agentId}`, userSpec: USER_SPEC });
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
  for (const [slug, name] of domains) {
    const r = materializeProfile({
      agentId,
      name: `Shopper ${agentId}`,
      userSpec: USER_SPEC,
      domain: pack(slug, name),
    });
    if (!r.ok) throw new Error(`mint ${slug} failed: ${JSON.stringify(r)}`);
  }
}

function domainDir(slug: string, agentId = SHOPPER): string {
  return join(getAgentArtefactDir(agentId), "domains", slug);
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
// Registration shape
// ===========================================================================

describe("management tools — registration shape", () => {
  it("registers sil_profile_list with a no-arg TypeBox object schema", () => {
    const tool = getTool(api, LIST);
    expect(tool.name).toBe(LIST);
    const schema = tool.parameters as unknown as { type?: string; required?: string[] };
    expect(schema.type).toBe("object");
    expect(schema.required ?? []).toEqual([]);
  });

  it("registers sil_profile_get with a required agentId + an OPTIONAL domainSlug", () => {
    const tool = getTool(api, GET);
    expect(tool.name).toBe(GET);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(schema.properties?.["agentId"]?.type).toBe("string");
    expect(schema.properties?.["domainSlug"]?.type).toBe("string");
    expect(schema.required ?? []).toContain("agentId");
    // domainSlug is optional — get with no slug returns the shopper overview.
    expect(schema.required ?? []).not.toContain("domainSlug");
  });

  it("registers sil_profile_remove with BOTH agentId and domainSlug required (no omit-deletes-everything)", () => {
    const tool = getTool(api, REMOVE);
    expect(tool.name).toBe(REMOVE);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(schema.properties?.["agentId"]?.type).toBe("string");
    expect(schema.properties?.["domainSlug"]?.type).toBe("string");
    expect(schema.required ?? []).toContain("agentId");
    expect(schema.required ?? []).toContain("domainSlug");
  });
});

// ===========================================================================
// sil_profile_list
// ===========================================================================

describe("sil_profile_list — ok envelope", () => {
  it("empty store → status ok with empty shoppers (a normal outcome)", async () => {
    const payload = payloadOf(await getTool(api, LIST).execute("c-1", {}));
    expect(payload["status"]).toBe("ok");
    expect(payload["shoppers"]).toEqual([]);
    expect(payload["unreadable"]).toEqual([]);
  });

  it("a shopper with N domains → its identity + domain index (slug/name) from the map", async () => {
    makeShopper(SHOPPER, [
      ["road-cycling", "Road cycling"],
      ["running-shoes", "Running shoes"],
    ]);
    const payload = payloadOf(await getTool(api, LIST).execute("c-2", {}));
    expect(payload["status"]).toBe("ok");
    const shoppers = payload["shoppers"] as Array<Record<string, unknown>>;
    const shopper = shoppers.find((s) => s["agentId"] === SHOPPER);
    expect(shopper).toBeDefined();
    const domains = shopper!["domains"] as Array<Record<string, unknown>>;
    expect(domains.map((d) => d["slug"]).sort()).toEqual(["road-cycling", "running-shoes"]);
  });

  it("an empty-`domains` shopper still lists (status ok, empty domain list — NOT not_found)", async () => {
    makeShopper(SHOPPER, []);
    const payload = payloadOf(await getTool(api, LIST).execute("c-3", {}));
    expect(payload["status"]).toBe("ok");
    const shoppers = payload["shoppers"] as Array<Record<string, unknown>>;
    const shopper = shoppers.find((s) => s["agentId"] === SHOPPER);
    expect(shopper).toBeDefined();
    expect(shopper!["domains"]).toEqual([]);
  });

  it("one corrupt manifest → healthy shopper still lists, broken one in unreadable[]", async () => {
    makeShopper("healthy", [["a-niche", "A niche"]]);
    makeShopper("broken", []);
    writeFileSync(join(getAgentArtefactDir("broken"), "profile.json"), "not json {{{");

    const payload = payloadOf(await getTool(api, LIST).execute("c-4", {}));
    expect(payload["status"]).toBe("ok");
    const shoppers = payload["shoppers"] as Array<Record<string, unknown>>;
    const unreadable = payload["unreadable"] as Array<Record<string, unknown>>;
    expect(shoppers.map((s) => s["agentId"])).toEqual(["healthy"]);
    expect(unreadable.map((u) => u["agentId"])).toContain("broken");
  });
});

// ===========================================================================
// sil_profile_get — overview vs per-domain
// ===========================================================================

describe("sil_profile_get — overview (no domainSlug): identity + shared user_spec + domain index", () => {
  it("returns status ok with the identity, the shared user_spec, and the domain index", async () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    const payload = payloadOf(await getTool(api, GET).execute("c-5", { agentId: SHOPPER }));
    expect(payload["status"]).toBe("ok");
    expect(payload["agentId"]).toBe(SHOPPER);
    expect(payload["userSpec"]).toBe(USER_SPEC);
    const domains = payload["domains"] as Array<Record<string, unknown>>;
    expect(domains.map((d) => d["slug"])).toEqual(["road-cycling"]);
  });
});

describe("sil_profile_get — per-domain (domainSlug): the 3 bodies + the shared user_spec", () => {
  it("returns status ok with domainSpec + intentSpec + playbook AND the shared user_spec", async () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    const payload = payloadOf(
      await getTool(api, GET).execute("c-6", { agentId: SHOPPER, domainSlug: "road-cycling" }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["slug"]).toBe("road-cycling");
    expect(payload["domainSpec"]).toBe("# Domain spec — Road cycling\nResearched mechanics.");
    expect(payload["intentSpec"]).toBe("# Intent spec — Road cycling\nDecomposition dimensions.");
    expect(payload["playbook"]).toBe("# Taste — Road cycling\nSeeded preferences.");
    expect(payload["userSpec"]).toBe(USER_SPEC);
  });
});

describe("sil_profile_get — graceful failures", () => {
  it("unknown agentId → status not_found with a list-then-retry recovery hint", async () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    const payload = payloadOf(await getTool(api, GET).execute("c-7", { agentId: "ghost" }));
    expect(payload["status"]).toBe("not_found");
    expect(payload["agentId"]).toBe("ghost");
    expect(payload["recovery"]).toBe("sil_profile_list");
  });

  it.each(["../escape", "shop/per", "..", "main", "Sil-Shopper"])(
    "a traversal/main agentId %j → status invalid_request(field=agentId)",
    async (bad) => {
      const payload = payloadOf(await getTool(api, GET).execute("c-8", { agentId: bad }));
      expect(payload["status"]).toBe("invalid_request");
      expect(payload["field"]).toBe("agentId");
    },
  );

  it("a traversal domainSlug → status invalid_request(field=domainSlug)", async () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    const payload = payloadOf(
      await getTool(api, GET).execute("c-9", { agentId: SHOPPER, domainSlug: "../escape" }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domainSlug");
  });
});

// ===========================================================================
// sil_profile_remove — one domain pack, scoped
// ===========================================================================

describe("sil_profile_remove — clears one domain leaf, sibling + shopper survive (scoped)", () => {
  it("removed → status removed; the target leaf is gone; a sibling domain + the shopper survive", async () => {
    makeShopper(SHOPPER, [
      ["road-cycling", "Road cycling"],
      ["running-shoes", "Running shoes"],
    ]);
    expect(existsSync(domainDir("road-cycling"))).toBe(true);

    const payload = payloadOf(
      await getTool(api, REMOVE).execute("c-10", { agentId: SHOPPER, domainSlug: "road-cycling" }),
    );
    expect(payload["status"]).toBe("removed");
    expect(payload["domainSlug"]).toBe("road-cycling");

    expect(existsSync(domainDir("road-cycling"))).toBe(false);
    expect(existsSync(domainDir("running-shoes"))).toBe(true);
    // The shopper + the shared user_spec survive (artefact-only removal).
    expect(existsSync(join(getAgentArtefactDir(SHOPPER), "user_spec.md"))).toBe(true);
  });
});

describe("sil_profile_remove — required slug, idempotent, fail-closed", () => {
  it("a MISSING domainSlug → status invalid_request(field=domainSlug), deletes nothing", async () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    // Omit domainSlug entirely — the tool must refuse, never fall through to a
    // whole-shopper delete.
    const payload = payloadOf(await getTool(api, REMOVE).execute("c-11", { agentId: SHOPPER }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domainSlug");
    expect(existsSync(domainDir("road-cycling"))).toBe(true);
    expect(existsSync(getAgentArtefactDir(SHOPPER))).toBe(true);
  });

  it("absent slug → status not_found (idempotent: a re-run is also not_found), deletes nothing", async () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    const first = payloadOf(
      await getTool(api, REMOVE).execute("c-12", { agentId: SHOPPER, domainSlug: "never-minted" }),
    );
    expect(first["status"]).toBe("not_found");
    expect(existsSync(domainDir("road-cycling"))).toBe(true);
    const second = payloadOf(
      await getTool(api, REMOVE).execute("c-13", { agentId: SHOPPER, domainSlug: "never-minted" }),
    );
    expect(second["status"]).toBe("not_found");
  });

  it.each(["../escape", "road/cycling", "..", "main", "Road-Cycling"])(
    "a traversal/main domainSlug %j → status invalid_request(field=domainSlug), deletes nothing",
    async (bad) => {
      makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
      const payload = payloadOf(
        await getTool(api, REMOVE).execute("c-14", { agentId: SHOPPER, domainSlug: bad }),
      );
      expect(payload["status"]).toBe("invalid_request");
      expect(payload["field"]).toBe("domainSlug");
      expect(existsSync(domainDir("road-cycling"))).toBe(true);
    },
  );
});

// ===========================================================================
// Identity boundary — no token side effect across any management tool
// ===========================================================================

describe("management tools — no identity coupling (no token side effect)", () => {
  it("list, get, and remove read/write no token across a full cycle", async () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    await getTool(api, LIST).execute("c-15", {});
    await getTool(api, GET).execute("c-16", { agentId: SHOPPER, domainSlug: "road-cycling" });
    await getTool(api, REMOVE).execute("c-17", { agentId: SHOPPER, domainSlug: "road-cycling" });
    expect(existsSync(getTokensPath())).toBe(false);
  });
});
