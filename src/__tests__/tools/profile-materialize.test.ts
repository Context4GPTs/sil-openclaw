/**
 * UNIT — sil_profile_materialize tool: registration shape + the structured
 * envelope it maps each store outcome to (tier: unit, mock api + temp data dir,
 * no network, no host).
 *
 * Card: spec-driven-shopping-sds-for-created-experts — Founder review round 1
 * (PR #33 bounced). After the SDS reframe the tool no longer carries `persona`
 * (the persona is the host SOUL.md, written by the engine via the host CLI). It
 * REQUIRES domainSpec + intentSpec; userSpec + playbook are optional (lazy). The
 * pure artefact-writer invariants live in `lib/profile-store.test.ts` /
 * `lib/profile-store-sds.test.ts`; here we pin the TOOL boundary:
 *   - the tool registers as `sil_profile_materialize` with a TypeBox object
 *     schema carrying agentId / name / domainSpec / intentSpec (required) +
 *     userSpec / playbook (optional) — and NO persona;
 *   - a valid spec returns the `ok` envelope with the artefact paths and the
 *     artefacts actually land under $SIL_DATA_DIR/agents/<agentId>/;
 *   - an invalid field returns the `invalid_request` envelope naming the field
 *     and writes nothing;
 *   - the tool makes NO host-config write and reads NO token (no coupling) —
 *     it is the behaviour-artefact half only.
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
  domainSpec: "# Gift-buying domain spec\nDimensions: recipient, occasion, budget, taste.",
  intentSpec: "# Intent spec — dimensions\nrecipient, occasion, budget, timeline, taste.",
  userSpec: "# User spec\nBuys for partner.\nHARD-NO: nothing over €50.",
  playbook: "# Buying taste\nValue-conscious.",
};

/** The minimum valid create — the two required specs only. */
const MIN_PARAMS = {
  agentId: "gift-buyer",
  name: "Gift Buyer",
  domainSpec: GOOD_PARAMS.domainSpec,
  intentSpec: GOOD_PARAMS.intentSpec,
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
  it("registers a sil_profile_materialize tool with a TypeBox object schema (no persona; domain+intent required)", () => {
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["agentId", "name", "domainSpec", "intentSpec", "userSpec", "playbook"]),
    );
    // Persona left the store — it is not a tool param.
    expect(Object.keys(schema.properties ?? {})).not.toContain("persona");
    // agentId, name, domainSpec, intentSpec are required; userSpec + playbook are not.
    expect(schema.required).toEqual(
      expect.arrayContaining(["agentId", "name", "domainSpec", "intentSpec"]),
    );
    expect(schema.required ?? []).not.toContain("userSpec");
    expect(schema.required ?? []).not.toContain("playbook");
    expect(schema.required ?? []).not.toContain("persona");
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
    expect(payload["domainSpecPath"]).toBe(join(expectedDir, "domain_spec.md"));
    expect(payload["intentSpecPath"]).toBe(join(expectedDir, "intent_spec.md"));
    expect(payload["profilePath"]).toBe(join(expectedDir, "profile.json"));
    // Persona is no longer materialized into the store.
    expect(payload["personaPath"]).toBeUndefined();

    expect(existsSync(join(expectedDir, "domain_spec.md"))).toBe(true);
    expect(existsSync(join(expectedDir, "intent_spec.md"))).toBe(true);
    expect(existsSync(join(expectedDir, "profile.json"))).toBe(true);
    expect(existsSync(join(expectedDir, "persona.md"))).toBe(false);
  });

  it("omits userSpecPath / playbookPath for a min create (the lazy slots fill later)", async () => {
    const tool = getTool(api, TOOL);
    const payload = payloadOf(await tool.execute("call-2", { ...MIN_PARAMS }));

    expect(payload["status"]).toBe("ok");
    expect(payload["userSpecPath"]).toBeUndefined();
    expect(payload["playbookPath"]).toBeUndefined();
    const expectedDir = join(getDataDir(), "agents", GOOD_PARAMS.agentId);
    expect(existsSync(join(expectedDir, "user_spec.md"))).toBe(false);
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
  it("missing domainSpec (required) → invalid_request naming the field, no artefact dir", async () => {
    const tool = getTool(api, TOOL);
    const { domainSpec: _d, ...noDomain } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("call-4", { ...noDomain }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domainSpec");
    expect(typeof payload["message"]).toBe("string");
    expect(existsSync(join(getDataDir(), "agents", GOOD_PARAMS.agentId))).toBe(false);
  });

  it("missing intentSpec (required) → invalid_request naming the field, no artefact dir", async () => {
    const tool = getTool(api, TOOL);
    const { intentSpec: _i, ...noIntent } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("call-5", { ...noIntent }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("intentSpec");
    expect(existsSync(join(getDataDir(), "agents", GOOD_PARAMS.agentId))).toBe(false);
  });

  it("missing agentId → invalid_request(field=agentId), no write", async () => {
    const tool = getTool(api, TOOL);
    const { agentId: _drop, ...noId } = GOOD_PARAMS;
    const payload = payloadOf(await tool.execute("call-6", { ...noId }));
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("agentId");
  });

  it('reserved "main" agentId → invalid_request(field=agentId), no write', async () => {
    const tool = getTool(api, TOOL);
    const payload = payloadOf(
      await tool.execute("call-7", { ...GOOD_PARAMS, agentId: "main" }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("agentId");
    expect(existsSync(join(getDataDir(), "agents", "main"))).toBe(false);
  });
});
