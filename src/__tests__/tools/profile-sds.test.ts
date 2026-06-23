/**
 * UNIT — the SDS tool seam after the five-artefact reframe (tier: unit, mock api
 * + temp data dir, no network, no host).
 *
 * Card: spec-driven-shopping-sds-for-created-experts — Founder review round 2
 * (PR #33 bounced a SECOND time). The pure store invariants live in
 * `lib/profile-store-sds.test.ts`; here we pin the TOOL boundary after the
 * reframe — WITHOUT adding a new tool (the 8-tool manifest is FROZEN;
 * manifest-contract stays green unchanged). The round-2 correction: ALL FOUR sil
 * specs are REQUIRED (present non-blank from creation, seeded partial then
 * augmented per-query) — userSpec + playbook are no longer lazy/optional:
 *
 *   sil_profile_materialize — drops `persona` entirely (the persona is the host
 *     SOUL.md, written by the engine via the host CLI). REQUIRES domainSpec +
 *     intentSpec + userSpec + playbook (all four). The ok envelope returns all four
 *     paths. A missing or present-but-blank spec → invalid_request naming it.
 *   sil_profile_get         — the ok envelope returns the domainSpec / intentSpec /
 *     userSpec / playbook bodies (no persona; all four always present).
 *   sil_profile_list        — the summary lists experts. With all four specs
 *     required+present, hasUserSpec / hasPlaybook would be trivially true and carry
 *     no signal — so we pin the durable list shape (the expert is listed), not a
 *     no-signal flag.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (mirrors
 * profile-materialize.test.ts / profile-manage.test.ts).
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
  "# Domain spec — road cycling (deep)\nFit mechanics (stack/reach, saddle"
  + " setback, crank length), gearing theory, frame geometry, the full fitting"
  + " process. Trade-offs noted.";
const INTENT_SPEC =
  "# Intent spec — decomposition dimensions\nuse-case, terrain, budget, timeline,"
  + " compatibility, performance priorities, aesthetics.";
const USER_SPEC =
  "# User spec\nFacts: inseam 81cm, endurance geometry.\nHARD-NO: rim brakes; over 9kg.";
const PLAYBOOK = "# Buying taste\nBudget ~€1500; brand-agnostic.";

/** A full create — all four REQUIRED specs (round-2: none is lazy/optional). */
const GOOD_PARAMS = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  domainSpec: DOMAIN_SPEC,
  intentSpec: INTENT_SPEC,
  userSpec: USER_SPEC,
  playbook: PLAYBOOK,
};

/** The minimum valid create. After Founder review round 2, all four sil specs are
 * REQUIRED + present from creation — so the minimum create IS the full four-spec
 * create. Kept as a named alias for call-site legibility. */
const MIN_PARAMS = GOOD_PARAMS;

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

describe("sil_profile_materialize — schema: persona GONE, ALL FOUR specs REQUIRED (round-2)", () => {
  it("declares NO persona param; domainSpec + intentSpec + userSpec + playbook are ALL required", () => {
    const tool = getTool(api, MATERIALIZE);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");

    // Persona left the store — there is no persona param.
    expect(schema.properties?.["persona"]).toBeUndefined();
    expect(schema.required ?? []).not.toContain("persona");

    // All four specs exist as strings AND are in the required gate (round-2:
    // userSpec + playbook are no longer optional — they are present from creation).
    expect(schema.properties?.["domainSpec"]?.type).toBe("string");
    expect(schema.properties?.["intentSpec"]?.type).toBe("string");
    expect(schema.properties?.["userSpec"]?.type).toBe("string");
    expect(schema.properties?.["playbook"]?.type).toBe("string");
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "agentId",
        "name",
        "domainSpec",
        "intentSpec",
        "userSpec",
        "playbook",
      ]),
    );
  });
});

describe("sil_profile_materialize — ok envelope returns the spec paths; no persona.md lands", () => {
  it("returns domainSpecPath + intentSpecPath (+ userSpecPath/playbookPath), and the artefacts land — never persona.md", async () => {
    const tool = getTool(api, MATERIALIZE);
    const payload = payloadOf(await tool.execute("c-1", { ...GOOD_PARAMS }));
    expect(payload["status"]).toBe("ok");

    const dir = join(getDataDir(), "agents", GOOD_PARAMS.agentId);
    expect(payload["domainSpecPath"]).toBe(join(dir, "domain_spec.md"));
    expect(payload["intentSpecPath"]).toBe(join(dir, "intent_spec.md"));
    expect(payload["userSpecPath"]).toBe(join(dir, "user_spec.md"));
    expect(payload["playbookPath"]).toBe(join(dir, "playbook.md"));
    // Persona left the store — no personaPath, no persona.md.
    expect(payload["personaPath"]).toBeUndefined();
    expect(existsSync(join(dir, "persona.md"))).toBe(false);

    expect(readFileSync(join(dir, "domain_spec.md"), "utf8")).toBe(DOMAIN_SPEC);
    expect(readFileSync(join(dir, "intent_spec.md"), "utf8")).toBe(INTENT_SPEC);
    expect(readFileSync(join(dir, "user_spec.md"), "utf8")).toBe(USER_SPEC);
    expect(readFileSync(join(dir, "playbook.md"), "utf8")).toBe(PLAYBOOK);
  });

  it("a create returns ALL FOUR spec paths and lands all four files (round-2: none is lazily absent)", async () => {
    const tool = getTool(api, MATERIALIZE);
    const payload = payloadOf(await tool.execute("c-2", { ...MIN_PARAMS }));
    expect(payload["status"]).toBe("ok");
    expect(payload["domainSpecPath"]).toBeDefined();
    expect(payload["intentSpecPath"]).toBeDefined();
    expect(payload["userSpecPath"]).toBeDefined();
    expect(payload["playbookPath"]).toBeDefined();
    const dir = join(getDataDir(), "agents", GOOD_PARAMS.agentId);
    expect(existsSync(join(dir, "user_spec.md"))).toBe(true);
    expect(existsSync(join(dir, "playbook.md"))).toBe(true);
  });
});

describe("sil_profile_materialize — a missing/blank REQUIRED spec → invalid_request, writes nothing", () => {
  it("omitted domainSpec → invalid_request(field=domainSpec), no artefact dir", async () => {
    const tool = getTool(api, MATERIALIZE);
    const { domainSpec: _d, ...noDomain } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("c-3", { ...noDomain }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domainSpec");
    expect(existsSync(getAgentArtefactDir(GOOD_PARAMS.agentId))).toBe(false);
  });

  it("omitted intentSpec → invalid_request(field=intentSpec), no artefact dir", async () => {
    const tool = getTool(api, MATERIALIZE);
    const { intentSpec: _i, ...noIntent } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("c-4", { ...noIntent }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("intentSpec");
    expect(existsSync(getAgentArtefactDir(GOOD_PARAMS.agentId))).toBe(false);
  });

  it("omitted userSpec → invalid_request(field=userSpec), no artefact dir (round-2: user_spec is REQUIRED)", async () => {
    const tool = getTool(api, MATERIALIZE);
    const { userSpec: _u, ...noUser } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("c-4u", { ...noUser }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("userSpec");
    expect(existsSync(getAgentArtefactDir(GOOD_PARAMS.agentId))).toBe(false);
  });

  it("omitted playbook → invalid_request(field=playbook), no artefact dir (round-2: playbook is REQUIRED)", async () => {
    const tool = getTool(api, MATERIALIZE);
    const { playbook: _p, ...noPlaybook } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("c-4p", { ...noPlaybook }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("playbook");
    expect(existsSync(getAgentArtefactDir(GOOD_PARAMS.agentId))).toBe(false);
  });

  it("blank domainSpec → invalid_request(field=domainSpec), no artefact dir", async () => {
    const tool = getTool(api, MATERIALIZE);
    const payload = payloadOf(
      await tool.execute("c-5", { ...GOOD_PARAMS, domainSpec: "   " }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domainSpec");
    expect(typeof payload["message"]).toBe("string");
    expect(existsSync(getAgentArtefactDir(GOOD_PARAMS.agentId))).toBe(false);
  });

  it("blank intentSpec → invalid_request(field=intentSpec), no artefact dir", async () => {
    const tool = getTool(api, MATERIALIZE);
    const payload = payloadOf(
      await tool.execute("c-6", { ...GOOD_PARAMS, intentSpec: "" }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("intentSpec");
    expect(existsSync(getAgentArtefactDir(GOOD_PARAMS.agentId))).toBe(false);
  });
});

describe("sil_profile_get — ok envelope returns the four spec bodies, no persona", () => {
  it("returns domainSpec + intentSpec + userSpec + playbook bodies; carries no persona", async () => {
    await getTool(api, MATERIALIZE).execute("c-7", { ...GOOD_PARAMS });
    const payload = payloadOf(
      await getTool(api, GET).execute("c-8", { agentId: GOOD_PARAMS.agentId }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["domainSpec"]).toBe(DOMAIN_SPEC);
    expect(payload["intentSpec"]).toBe(INTENT_SPEC);
    expect(payload["userSpec"]).toBe(USER_SPEC);
    expect(payload["playbook"]).toBe(PLAYBOOK);
    // Persona is no longer a stored artefact — the envelope carries none.
    expect(payload["persona"]).toBeUndefined();
  });

  it("a created expert returns ALL FOUR bodies in the envelope (round-2: none is absent at creation)", async () => {
    await getTool(api, MATERIALIZE).execute("c-9", { ...MIN_PARAMS });
    const payload = payloadOf(
      await getTool(api, GET).execute("c-10", { agentId: GOOD_PARAMS.agentId }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["domainSpec"]).toBe(DOMAIN_SPEC);
    expect(payload["intentSpec"]).toBe(INTENT_SPEC);
    expect(payload["userSpec"]).toBe(USER_SPEC);
    expect(payload["playbook"]).toBe(PLAYBOOK);
  });
});

describe("sil_profile_list — lists every created expert (name + agentId from the manifest)", () => {
  it("lists each created expert with its manifest name + agentId — the durable list shape", async () => {
    // Round-2: with all four specs required+present, hasUserSpec / hasPlaybook
    // would be trivially true for EVERY created expert and carry no discriminating
    // signal — so we do NOT assert them. The durable behaviour the list must hold
    // is: every created expert is enumerated with its manifest name + agentId.
    await getTool(api, MATERIALIZE).execute("c-11", { ...GOOD_PARAMS });
    await getTool(api, MATERIALIZE).execute("c-12", {
      ...GOOD_PARAMS,
      agentId: "second-expert",
      name: "Second Expert",
    });

    const payload = payloadOf(await getTool(api, LIST).execute("c-13", {}));
    expect(payload["status"]).toBe("ok");
    const experts = payload["experts"] as Array<Record<string, unknown>>;
    const byId = new Map(experts.map((e) => [e["agentId"], e]));
    expect(byId.has(GOOD_PARAMS.agentId)).toBe(true);
    expect(byId.has("second-expert")).toBe(true);
    expect(byId.get(GOOD_PARAMS.agentId)!["name"]).toBe(GOOD_PARAMS.name);
    expect(byId.get("second-expert")!["name"]).toBe("Second Expert");
  });
});
