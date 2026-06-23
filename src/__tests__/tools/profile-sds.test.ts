/**
 * UNIT — the SDS tool seam: the two new optional params + envelope fields the
 * profile tools carry for the domain-spec / user-spec layers (tier: unit, mock
 * api + temp data dir, no network, no host).
 *
 * Card: spec-driven-shopping-sds-for-created-experts. The pure store invariants
 * for domain.md/user.md live in `lib/profile-store-sds.test.ts`; here we pin the
 * TOOL boundary — that the three profile tools surface the two new SDS layers
 * WITHOUT adding a new tool (the 8-tool manifest is FROZEN; manifest-contract
 * stays green unchanged):
 *
 *   sil_profile_materialize — schema gains domainSpec? + userSpec? (optional
 *     Type.String); the ok envelope returns domainSpecPath / userSpecPath;
 *     a present-but-blank domainSpec/userSpec → invalid_request naming the field.
 *   sil_profile_get         — the ok envelope returns the domainSpec / userSpec
 *     bodies (absent-is-fine, like playbook).
 *   sil_profile_list        — the summary MAY flag presence
 *     (hasDomainSpec / hasUserSpec) — cheap manifest flags, no body read.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (mirrors
 * profile-materialize.test.ts / profile-manage.test.ts).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/tools/profile.ts`:
 *   - registerMaterialize adds `domainSpec` + `userSpec` as Type.Optional(
 *     Type.String(...)) params, narrows them in execute(), and returns
 *     {domainSpecPath?, userSpecPath?} on the ok envelope;
 *   - registerGet returns {domainSpec?, userSpec?} on the ok envelope;
 *   - registerList flags {hasDomainSpec, hasUserSpec} per expert.
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
import { getDataDir } from "../../lib/credentials.js";
import { getAgentArtefactDir } from "../../lib/profile-store.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const MATERIALIZE = "sil_profile_materialize";
const GET = "sil_profile_get";
const LIST = "sil_profile_list";

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

const DOMAIN_SPEC =
  "# Domain spec — road cycling\nDimensions: fit (stack/reach), groupset tier,"
  + " rim depth vs crosswind, gearing range. Trade-offs noted.";
const USER_SPEC =
  "# User spec\nSoft: endurance geometry, ~€1500.\nHARD-NO: rim brakes; over 9kg.";

const GOOD_PARAMS = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  persona: "You are a road-cycling buyer. Prefer endurance geometry.",
  playbook: "Map budget to price params. Rank by comfort, then weight.",
  domainSpec: DOMAIN_SPEC,
  userSpec: USER_SPEC,
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-profile-sds-tool-"));
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

describe("sil_profile_materialize — schema carries the two NEW optional SDS params", () => {
  it("declares domainSpec and userSpec as optional string params (not required)", () => {
    const tool = getTool(api, MATERIALIZE);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    // The two new params exist as strings…
    expect(schema.properties?.["domainSpec"]?.type).toBe("string");
    expect(schema.properties?.["userSpec"]?.type).toBe("string");
    // …and are OPTIONAL — never added to the required gate (a pre-SDS expert
    // carries neither; back-compat optionality, not a new mandatory field).
    expect(schema.required ?? []).not.toContain("domainSpec");
    expect(schema.required ?? []).not.toContain("userSpec");
    // The original required set is unchanged.
    expect(schema.required).toEqual(
      expect.arrayContaining(["agentId", "name", "persona"]),
    );
  });
});

describe("sil_profile_materialize — ok envelope returns the two new paths; artefacts land", () => {
  it("returns domainSpecPath + userSpecPath, and domain.md + user.md land under agents/<id>/", async () => {
    const tool = getTool(api, MATERIALIZE);
    const payload = payloadOf(await tool.execute("c-1", { ...GOOD_PARAMS }));
    expect(payload["status"]).toBe("ok");

    const dir = join(getDataDir(), "agents", GOOD_PARAMS.agentId);
    expect(payload["domainSpecPath"]).toBe(join(dir, "domain.md"));
    expect(payload["userSpecPath"]).toBe(join(dir, "user.md"));
    expect(existsSync(join(dir, "domain.md"))).toBe(true);
    expect(existsSync(join(dir, "user.md"))).toBe(true);
    expect(readFileSync(join(dir, "domain.md"), "utf8")).toBe(DOMAIN_SPEC);
    expect(readFileSync(join(dir, "user.md"), "utf8")).toBe(USER_SPEC);
  });

  it("omits domainSpecPath / userSpecPath when neither param is supplied (a pre-SDS create)", async () => {
    const tool = getTool(api, MATERIALIZE);
    const { domainSpec: _d, userSpec: _u, ...noSds } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("c-2", { ...noSds }));
    expect(payload["status"]).toBe("ok");
    expect(payload["domainSpecPath"]).toBeUndefined();
    expect(payload["userSpecPath"]).toBeUndefined();
    const dir = join(getDataDir(), "agents", GOOD_PARAMS.agentId);
    expect(existsSync(join(dir, "domain.md"))).toBe(false);
    expect(existsSync(join(dir, "user.md"))).toBe(false);
  });
});

describe("sil_profile_materialize — present-but-blank SDS param → invalid_request, writes nothing", () => {
  it("blank domainSpec → invalid_request(field=domainSpec), no artefact dir", async () => {
    const tool = getTool(api, MATERIALIZE);
    const payload = payloadOf(
      await tool.execute("c-3", { ...GOOD_PARAMS, domainSpec: "   " }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domainSpec");
    expect(typeof payload["message"]).toBe("string");
    expect(existsSync(getAgentArtefactDir(GOOD_PARAMS.agentId))).toBe(false);
  });

  it("blank userSpec → invalid_request(field=userSpec), no artefact dir", async () => {
    const tool = getTool(api, MATERIALIZE);
    const payload = payloadOf(
      await tool.execute("c-4", { ...GOOD_PARAMS, userSpec: "" }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("userSpec");
    expect(existsSync(getAgentArtefactDir(GOOD_PARAMS.agentId))).toBe(false);
  });
});

describe("sil_profile_get — ok envelope returns the domainSpec + userSpec bodies", () => {
  it("returns domainSpec + userSpec bodies when the expert has them", async () => {
    await getTool(api, MATERIALIZE).execute("c-5", { ...GOOD_PARAMS });
    const payload = payloadOf(
      await getTool(api, GET).execute("c-6", { agentId: GOOD_PARAMS.agentId }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["domainSpec"]).toBe(DOMAIN_SPEC);
    expect(payload["userSpec"]).toBe(USER_SPEC);
  });

  it("omits domainSpec / userSpec in the envelope when the expert has neither (absent-is-fine)", async () => {
    const { domainSpec: _d, userSpec: _u, ...noSds } = GOOD_PARAMS;
    await getTool(api, MATERIALIZE).execute("c-7", { ...noSds });
    const payload = payloadOf(
      await getTool(api, GET).execute("c-8", { agentId: GOOD_PARAMS.agentId }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["domainSpec"]).toBeUndefined();
    expect(payload["userSpec"]).toBeUndefined();
    // The rest is still there.
    expect(typeof payload["persona"]).toBe("string");
  });
});

describe("sil_profile_list — summary flags SDS-layer presence (hasDomainSpec / hasUserSpec)", () => {
  it("flags hasDomainSpec + hasUserSpec true for an SDS expert, false for a bare one", async () => {
    await getTool(api, MATERIALIZE).execute("c-9", { ...GOOD_PARAMS });
    const { domainSpec: _d, userSpec: _u, ...noSds } = GOOD_PARAMS;
    await getTool(api, MATERIALIZE).execute("c-10", {
      ...noSds,
      agentId: "bare-expert",
      name: "Bare Expert",
    });

    const payload = payloadOf(await getTool(api, LIST).execute("c-11", {}));
    expect(payload["status"]).toBe("ok");
    const experts = payload["experts"] as Array<Record<string, unknown>>;
    const sds = experts.find((e) => e["agentId"] === GOOD_PARAMS.agentId)!;
    const bare = experts.find((e) => e["agentId"] === "bare-expert")!;

    expect(sds["hasDomainSpec"]).toBe(true);
    expect(sds["hasUserSpec"]).toBe(true);
    expect(bare["hasDomainSpec"]).toBe(false);
    expect(bare["hasUserSpec"]).toBe(false);
  });
});
