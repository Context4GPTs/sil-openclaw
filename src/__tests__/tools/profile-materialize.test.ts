/**
 * UNIT — sil_profile_materialize tool: registration shape + the structured
 * envelope it maps each store outcome to (tier: unit, mock api + temp data dir,
 * no network, no host).
 *
 * Card: create-a-valid-sil-wired-openclaw-agent-profile (founder steer). The
 * pure artefact-writer invariants live in `lib/profile-store.test.ts`; here we
 * pin the TOOL boundary:
 *   - the tool registers as `sil_profile_materialize` with a TypeBox object
 *     schema carrying agentId / name / persona (required) + playbook (optional);
 *   - a valid spec returns the `ok` envelope with the artefact paths and the
 *     artefacts actually land under $SIL_DATA_DIR/agents/<agentId>/;
 *   - an invalid field returns the `invalid_request` envelope naming the field
 *     and writes nothing;
 *   - the tool makes NO host-config write and reads NO token (no coupling) —
 *     it is the behaviour-artefact half only.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - src/tools/profile.ts#registerProfileTools(api) registers a
 *     `sil_profile_materialize` tool (Type.Object{agentId,name,persona,playbook?});
 *   - execute() returns a jsonResult mapping the store result to
 *     {status:"ok",…paths} / {status:"invalid_request",field,message} /
 *     {status:"persistence_failed",error,message,recovery}.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProfileTools } from "../../tools/profile.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";
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

const GOOD_PARAMS = {
  agentId: "gift-buyer",
  name: "Gift Buyer",
  persona: "You specialise in gifts under €50.",
  playbook: "Use sil_search to browse, sil_product_get to re-check stock.",
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-profile-tool-"));
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

describe("sil_profile_materialize — registration shape", () => {
  it("registers a sil_profile_materialize tool with a TypeBox object schema", () => {
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["agentId", "name", "persona", "playbook"]),
    );
    // agentId, name, persona are required; playbook is optional.
    expect(schema.required).toEqual(
      expect.arrayContaining(["agentId", "name", "persona"]),
    );
    expect(schema.required ?? []).not.toContain("playbook");
  });
});

describe("sil_profile_materialize — valid spec materializes the artefacts (ok envelope)", () => {
  it("returns status ok with the artefact paths, and the artefacts land under $SIL_DATA_DIR/agents/<id>/", async () => {
    const tool = getTool(api, TOOL);
    const payload = payloadOf(await tool.execute("call-1", { ...GOOD_PARAMS }));

    expect(payload["status"]).toBe("ok");
    expect(payload["agentId"]).toBe(GOOD_PARAMS.agentId);

    const expectedDir = join(getDataDir(), "agents", GOOD_PARAMS.agentId);
    expect(payload["dir"]).toBe(expectedDir);
    expect(payload["personaPath"]).toBe(join(expectedDir, "persona.md"));
    expect(payload["playbookPath"]).toBe(join(expectedDir, "playbook.md"));
    expect(payload["profilePath"]).toBe(join(expectedDir, "profile.json"));

    expect(existsSync(join(expectedDir, "persona.md"))).toBe(true);
    expect(existsSync(join(expectedDir, "playbook.md"))).toBe(true);
    expect(existsSync(join(expectedDir, "profile.json"))).toBe(true);
  });

  it("omits playbookPath when no playbook is supplied", async () => {
    const tool = getTool(api, TOOL);
    const { playbook: _omit, ...noPlaybook } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("call-2", { ...noPlaybook }));

    expect(payload["status"]).toBe("ok");
    expect(payload["playbookPath"]).toBeUndefined();
    const expectedDir = join(getDataDir(), "agents", GOOD_PARAMS.agentId);
    expect(existsSync(join(expectedDir, "playbook.md"))).toBe(false);
  });

  it("makes no host-config write and reads no token (behaviour-artefact half only)", async () => {
    const tool = getTool(api, TOOL);
    await tool.execute("call-3", { ...GOOD_PARAMS });
    // No token side effect — creation is identity-decoupled.
    expect(existsSync(getTokensPath())).toBe(false);
  });
});

describe("sil_profile_materialize — invalid spec returns invalid_request, writes nothing", () => {
  it("blank persona → invalid_request naming the field, no artefact dir", async () => {
    const tool = getTool(api, TOOL);
    const payload = payloadOf(
      await tool.execute("call-4", { ...GOOD_PARAMS, persona: "" }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("persona");
    expect(typeof payload["message"]).toBe("string");
    expect(existsSync(join(getDataDir(), "agents", GOOD_PARAMS.agentId))).toBe(false);
  });

  it("missing agentId → invalid_request(field=agentId), no write", async () => {
    const tool = getTool(api, TOOL);
    const { agentId: _drop, ...noId } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("call-5", { ...noId }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("agentId");
  });

  it('reserved "main" agentId → invalid_request(field=agentId), no write', async () => {
    const tool = getTool(api, TOOL);
    const payload = payloadOf(
      await tool.execute("call-6", { ...GOOD_PARAMS, agentId: "main" }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("agentId");
    expect(existsSync(join(getDataDir(), "agents", "main"))).toBe(false);
  });
});
