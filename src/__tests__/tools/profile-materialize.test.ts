/**
 * UNIT — sil_profile_materialize tool: registration shape + the structured
 * envelope it maps each store outcome to (tier: unit, mock api + temp data dir,
 * no network, no host).
 *
 * Card: single-multi-domain-sil-shopper — Slice 1, updated for
 * consolidate-profile-tools-to-the-singleton-surface. The tool stays ONE tool
 * (`sil_profile_materialize`) with an OPTIONAL `domain` object — the 8-tool
 * manifest is FROZEN. The consolidation DROPS the caller-supplied `agentId`: the
 * store re-scopes to the singleton, so the params are now the agent-level fields
 * + an optional domain pack, with NO `agentId`:
 *
 *   { name, userSpec, domain?: { slug, name, domainSpec, intentSpec, playbook } }
 *
 *   - NO domain  ⇒ create the shopper (shared user_spec + `domains: {}`);
 *   - WITH domain ⇒ lazily mint domains/<slug>/* + a shared-user_spec rewrite +
 *     an upsert into `domains[slug]`, one atomic call.
 *
 * The pure store invariants live in lib/profile-store*.test.ts; here we pin the
 * TOOL boundary: the schema (name/userSpec required; domain optional; NO `agentId`;
 * NO top-level domainSpec/intentSpec/playbook), and the ok / invalid_request
 * envelopes for both a create and a mint.
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
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProfileTools } from "../../tools/profile.js";
import { getTokensPath } from "../../lib/credentials.js";
import {
  getShopperArtefactDir,
  getDomainArtefactDir,
} from "../../lib/profile-store.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const TOOL = "sil_profile_materialize";

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

const USER_SPEC = "# User spec (shared)\n- Ships to Berlin.\nHARD-NO: leather (ethics).";

/** Create the singleton shopper (no domain, no agentId). */
const CREATE = {
  name: "sil shopper",
  userSpec: USER_SPEC,
};

const DOMAIN = {
  slug: "road-cycling",
  name: "Road cycling",
  domainSpec: "# Domain spec — road cycling\nFit, gearing, geometry.",
  intentSpec: "# Intent spec — cycling\nuse-case, terrain, budget, timeline.",
  playbook: "# Taste — cycling\n~€1500; Shimano over SRAM.",
};

/** Mint a niche onto the shopper. */
const MINT = { ...CREATE, domain: DOMAIN };

function readManifest(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(getShopperArtefactDir(), "profile.json"), "utf8"),
  ) as Record<string, unknown>;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-materialize-tool-"));
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

describe("sil_profile_materialize — registration shape (singleton: agent-level fields + an optional domain pack, NO agentId)", () => {
  it("requires name/userSpec; domain is OPTIONAL; NO agentId, NO top-level domainSpec/intentSpec/playbook", () => {
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, { type?: string; properties?: Record<string, unknown> }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");

    const props = Object.keys(schema.properties ?? {});
    expect(props).toEqual(expect.arrayContaining(["name", "userSpec", "domain"]));
    // The singleton re-scope drops the caller-supplied agentId entirely.
    expect(props).not.toContain("agentId");
    // The flat per-niche specs left the top level — they live inside `domain` now.
    expect(props).not.toContain("domainSpec");
    expect(props).not.toContain("intentSpec");
    expect(props).not.toContain("playbook");
    expect(props).not.toContain("persona");

    // Only the two agent-level fields are required — domain is optional, agentId is gone.
    expect(schema.required).toEqual(expect.arrayContaining(["name", "userSpec"]));
    expect(schema.required ?? []).not.toContain("agentId");
    expect(schema.required ?? []).not.toContain("domain");
  });

  it("the optional `domain` object declares slug/name/domainSpec/intentSpec/playbook", () => {
    const tool = getTool(api, TOOL);
    const schema = tool.parameters as unknown as {
      properties?: Record<string, { type?: string; properties?: Record<string, unknown> }>;
    };
    const domain = schema.properties?.["domain"];
    expect(domain?.type).toBe("object");
    const nested = Object.keys(domain?.properties ?? {});
    expect(nested).toEqual(
      expect.arrayContaining(["slug", "name", "domainSpec", "intentSpec", "playbook"]),
    );
  });
});

describe("sil_profile_materialize — create the shopper (no domain): ok envelope + agent-level files", () => {
  it("returns status ok and writes ONLY user_spec.md + profile.json (domains:{}), no domains/ dir", async () => {
    const tool = getTool(api, TOOL);
    const payload = payloadOf(await tool.execute("c-1", { ...CREATE }));
    expect(payload["status"]).toBe("ok");

    const dir = getShopperArtefactDir();
    expect(payload["userSpecPath"]).toBe(join(dir, "user_spec.md"));
    expect(payload["profilePath"]).toBe(join(dir, "profile.json"));
    expect(existsSync(join(dir, "user_spec.md"))).toBe(true);
    expect(existsSync(join(dir, "domains"))).toBe(false);
    // The flat per-niche artefacts never appear at the agent level.
    expect(existsSync(join(dir, "domain_spec.md"))).toBe(false);
    expect(readManifest()["domains"]).toEqual({});
  });

  it("reads no token (behaviour-artefact half only)", async () => {
    const tool = getTool(api, TOOL);
    await tool.execute("c-2", { ...CREATE });
    expect(existsSync(getTokensPath())).toBe(false);
  });
});

describe("sil_profile_materialize — mint a niche (with domain): ok envelope + the pack lands under domains/<slug>/", () => {
  it("returns status ok with the minted domain echo, and writes the pack + upserts domains[slug]", async () => {
    const tool = getTool(api, TOOL);
    // Create the shopper first, then mint.
    await tool.execute("c-3", { ...CREATE });
    const payload = payloadOf(await tool.execute("c-4", { ...MINT }));
    expect(payload["status"]).toBe("ok");

    const domainDir = getDomainArtefactDir(DOMAIN.slug);
    expect(existsSync(join(domainDir, "domain_spec.md"))).toBe(true);
    expect(existsSync(join(domainDir, "intent_spec.md"))).toBe(true);
    expect(existsSync(join(domainDir, "playbook.md"))).toBe(true);
    expect(readFileSync(join(domainDir, "domain_spec.md"), "utf8")).toBe(DOMAIN.domainSpec);

    // The envelope echoes the minted domain entry (slug + the three per-domain paths).
    const domain = payload["domain"] as Record<string, unknown> | undefined;
    expect(domain).toBeDefined();
    expect(domain!["slug"]).toBe(DOMAIN.slug);
    expect(domain!["domainSpecPath"]).toBe(join(domainDir, "domain_spec.md"));

    // The manifest's domains map registers it.
    const domains = (readManifest()["domains"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(domains)).toEqual([DOMAIN.slug]);
  });
});

describe("sil_profile_materialize — invalid spec → invalid_request envelope, writes nothing", () => {
  it("missing userSpec → invalid_request(field=userSpec), no artefact dir", async () => {
    const tool = getTool(api, TOOL);
    const { userSpec: _u, ...noUser } = CREATE;
    const payload = payloadOf(await tool.execute("c-5", { ...noUser }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("userSpec");
    expect(existsSync(getShopperArtefactDir())).toBe(false);
  });

  it("a traversal-shaped domain.slug → invalid_request(field=domain.slug), no domain pack", async () => {
    const tool = getTool(api, TOOL);
    await tool.execute("c-8", { ...CREATE }); // shopper exists
    const payload = payloadOf(
      await tool.execute("c-9", { ...MINT, domain: { ...DOMAIN, slug: "../escape" } }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domain.slug");
    expect(existsSync(join(getShopperArtefactDir(), "domains"))).toBe(false);
  });

  it("a blank domain.domainSpec → invalid_request(field=domain.domainSpec), no domain pack", async () => {
    const tool = getTool(api, TOOL);
    await tool.execute("c-10", { ...CREATE });
    const payload = payloadOf(
      await tool.execute("c-11", { ...MINT, domain: { ...DOMAIN, domainSpec: "   " } }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domain.domainSpec");
    expect(existsSync(join(getShopperArtefactDir(), "domains"))).toBe(false);
  });
});
