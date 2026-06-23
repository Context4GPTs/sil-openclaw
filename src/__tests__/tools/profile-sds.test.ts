/**
 * UNIT — the SDS tool seam after the five-artefact reframe (tier: unit, mock api
 * + temp data dir, no network, no host).
 *
 * Card: spec-driven-shopping-sds-for-created-experts — Founder review round 1
 * (PR #33 bounced). The pure store invariants live in
 * `lib/profile-store-sds.test.ts`; here we pin the TOOL boundary after the
 * reframe — WITHOUT adding a new tool (the 8-tool manifest is FROZEN;
 * manifest-contract stays green unchanged):
 *
 *   sil_profile_materialize — drops `persona` entirely (the persona is the host
 *     SOUL.md, written by the engine via the host CLI). REQUIRES domainSpec +
 *     intentSpec; userSpec + playbook are optional (lazy). The ok envelope returns
 *     domainSpecPath / intentSpecPath (+ userSpecPath / playbookPath when present).
 *     A missing or present-but-blank required spec → invalid_request naming it.
 *   sil_profile_get         — the ok envelope returns the domainSpec / intentSpec /
 *     userSpec / playbook bodies (no persona; lazy slots absent-is-fine).
 *   sil_profile_list        — the summary flags presence (hasUserSpec /
 *     hasPlaybook) — cheap manifest flags, no body read.
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

/** A full create. */
const GOOD_PARAMS = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  domainSpec: DOMAIN_SPEC,
  intentSpec: INTENT_SPEC,
  userSpec: USER_SPEC,
  playbook: PLAYBOOK,
};

/** The minimum valid create — the two required specs only. */
const MIN_PARAMS = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  domainSpec: DOMAIN_SPEC,
  intentSpec: INTENT_SPEC,
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

describe("sil_profile_materialize — schema: persona GONE, domainSpec + intentSpec REQUIRED", () => {
  it("declares NO persona param; domainSpec + intentSpec are required; userSpec + playbook are optional", () => {
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

    // The two required specs exist as strings AND are in the required gate.
    expect(schema.properties?.["domainSpec"]?.type).toBe("string");
    expect(schema.properties?.["intentSpec"]?.type).toBe("string");
    expect(schema.required).toEqual(
      expect.arrayContaining(["agentId", "name", "domainSpec", "intentSpec"]),
    );

    // The two lazy specs exist as strings but are NOT required.
    expect(schema.properties?.["userSpec"]?.type).toBe("string");
    expect(schema.properties?.["playbook"]?.type).toBe("string");
    expect(schema.required ?? []).not.toContain("userSpec");
    expect(schema.required ?? []).not.toContain("playbook");
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

  it("a min create (required specs only) omits userSpecPath / playbookPath — the lazy slots fill later", async () => {
    const tool = getTool(api, MATERIALIZE);
    const payload = payloadOf(await tool.execute("c-2", { ...MIN_PARAMS }));
    expect(payload["status"]).toBe("ok");
    expect(payload["domainSpecPath"]).toBeDefined();
    expect(payload["intentSpecPath"]).toBeDefined();
    expect(payload["userSpecPath"]).toBeUndefined();
    expect(payload["playbookPath"]).toBeUndefined();
    const dir = join(getDataDir(), "agents", GOOD_PARAMS.agentId);
    expect(existsSync(join(dir, "user_spec.md"))).toBe(false);
    expect(existsSync(join(dir, "playbook.md"))).toBe(false);
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

  it("a min-create expert omits userSpec / playbook in the envelope (lazy slots absent-is-fine)", async () => {
    await getTool(api, MATERIALIZE).execute("c-9", { ...MIN_PARAMS });
    const payload = payloadOf(
      await getTool(api, GET).execute("c-10", { agentId: GOOD_PARAMS.agentId }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["domainSpec"]).toBe(DOMAIN_SPEC);
    expect(payload["intentSpec"]).toBe(INTENT_SPEC);
    expect(payload["userSpec"]).toBeUndefined();
    expect(payload["playbook"]).toBeUndefined();
  });
});

describe("sil_profile_list — summary flags lazy-slot presence (hasUserSpec / hasPlaybook)", () => {
  it("flags hasUserSpec + hasPlaybook true for a full expert, false for a min-create one", async () => {
    await getTool(api, MATERIALIZE).execute("c-11", { ...GOOD_PARAMS });
    await getTool(api, MATERIALIZE).execute("c-12", {
      ...MIN_PARAMS,
      agentId: "bare-expert",
      name: "Bare Expert",
    });

    const payload = payloadOf(await getTool(api, LIST).execute("c-13", {}));
    expect(payload["status"]).toBe("ok");
    const experts = payload["experts"] as Array<Record<string, unknown>>;
    const full = experts.find((e) => e["agentId"] === GOOD_PARAMS.agentId)!;
    const bare = experts.find((e) => e["agentId"] === "bare-expert")!;

    expect(full["hasUserSpec"]).toBe(true);
    expect(full["hasPlaybook"]).toBe(true);
    expect(bare["hasUserSpec"]).toBe(false);
    expect(bare["hasPlaybook"]).toBe(false);
  });
});
