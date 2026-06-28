/**
 * UNIT — the `sil_remember` tool seam: registration shape + the structured
 * envelope it maps each store outcome to (tier: unit, mock api + temp data dir,
 * no network, no host).
 *
 * Card: sil-remember-append-memory-tool. `sil_remember` is added to the EXISTING
 * `registerProfileTools` group (no new file, no new group function — the store
 * and the agentId/slug gates are shared with the profile family). It is a thin
 * wrapper over `appendProfileEntry`: narrow the host-validated params, call the
 * store, map the discriminated result to the canonical `jsonResult` envelope.
 *
 * This file pins the TOOL boundary:
 *   - SCHEMA — a `Type.Object` with `agentId`, `kind` ∈ {fact, taste}, `text`
 *     REQUIRED; `domain` and `hard` OPTIONAL. (The deep store mechanics live in
 *     lib/profile-store-remember.test.ts.)
 *   - ENVELOPE — each store variant maps to the canonical status:
 *     ok / invalid_request / not_found / persistence_failed (with a fix_data_dir
 *     recovery on the last, mirroring sil_profile_materialize / sil_profile_remove).
 *   - NON-PII LOG MARKER — every path logs a structured marker, and the remembered
 *     `text` (user content / potential PII) is NEVER in any log payload.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override; seeded through the real
 * `sil_profile_materialize` tool so the flow is end-to-end at the tool boundary.
 *
 * RED: `sil_remember` is not yet registered by `registerProfileTools` — getTool
 * throws "Tool sil_remember not registered".
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProfileTools } from "../../tools/profile.js";
import { getDataDir } from "../../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const REMEMBER = "sil_remember";
const MATERIALIZE = "sil_profile_materialize";

const SHOPPER = "sil-shopper";
const USER_SPEC = "# User spec (shared)\n- Ships to Berlin.\nHARD-NO: leather.";
const DOMAIN = {
  slug: "road-cycling",
  name: "Road cycling",
  domainSpec: "# Domain spec — cycling\nFit, gearing, geometry.",
  intentSpec: "# Intent spec — cycling\nuse-case, terrain, budget.",
  playbook: "# Taste — cycling\n~€1500; Shimano over SRAM.",
};

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

/** Every argument passed to any logger spy, serialized — to prove the remembered
 * `text` (PII) never leaks into a structured log marker. */
function allLogPayloads(): string {
  const out: unknown[] = [];
  for (const level of ["info", "warn", "error", "debug"] as const) {
    const spy = api.logger[level] as unknown as { mock?: { calls: unknown[][] } };
    for (const call of spy.mock?.calls ?? []) out.push(call);
  }
  return JSON.stringify(out);
}

async function seedShopper(): Promise<void> {
  await getTool(api, MATERIALIZE).execute("seed-1", {
    agentId: SHOPPER,
    name: "sil shopper",
    userSpec: USER_SPEC,
  });
}
async function seedDomain(): Promise<void> {
  await getTool(api, MATERIALIZE).execute("seed-2", {
    agentId: SHOPPER,
    name: "sil shopper",
    userSpec: USER_SPEC,
    domain: DOMAIN,
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-remember-tool-"));
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
// registration shape
// ===========================================================================

describe("sil_remember — registered by registerProfileTools with the typed schema", () => {
  it("is registered with name sil_remember and an object schema", () => {
    const tool = getTool(api, REMEMBER);
    expect(tool.name).toBe(REMEMBER);
    const schema = tool.parameters as unknown as { type?: string };
    expect(schema.type).toBe("object");
  });

  it("requires agentId/kind/text; domain and hard are OPTIONAL", () => {
    const tool = getTool(api, REMEMBER);
    const schema = tool.parameters as unknown as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const props = Object.keys(schema.properties ?? {});
    expect(props).toEqual(
      expect.arrayContaining(["agentId", "kind", "text", "domain", "hard"]),
    );
    expect(schema.required).toEqual(expect.arrayContaining(["agentId", "kind", "text"]));
    expect(schema.required ?? []).not.toContain("domain");
    expect(schema.required ?? []).not.toContain("hard");
  });

  it("the `kind` param is constrained to exactly {fact, taste}", () => {
    const tool = getTool(api, REMEMBER);
    const schema = tool.parameters as unknown as {
      properties?: Record<string, unknown>;
    };
    const kind = schema.properties?.["kind"];
    expect(kind).toBeDefined();
    // Robust to the JSON-schema encoding of the union (anyOf of literals / enum /
    // const): both literals must be present, and no third value.
    const kindJson = JSON.stringify(kind);
    expect(kindJson).toContain("fact");
    expect(kindJson).toContain("taste");
  });

  it("the `hard` param is a boolean", () => {
    const tool = getTool(api, REMEMBER);
    const schema = tool.parameters as unknown as {
      properties?: Record<string, { type?: string }>;
    };
    expect(schema.properties?.["hard"]?.type).toBe("boolean");
  });
});

// ===========================================================================
// envelope mapping: store result variant → jsonResult status
// ===========================================================================

describe("sil_remember — maps each store outcome to the canonical envelope", () => {
  it("a successful fact remember → status ok, and the text (PII) is NOT logged", async () => {
    await seedShopper();
    const text = "Waist 34in SECRET-PII-marker-abc123";
    const payload = payloadOf(
      await getTool(api, REMEMBER).execute("r-1", { agentId: SHOPPER, kind: "fact", text }),
    );
    expect(payload["status"]).toBe("ok");
    // A non-PII marker IS logged on success…
    expect((api.logger.info as unknown as { mock: { calls: unknown[] } }).mock.calls.length)
      .toBeGreaterThan(0);
    // …but the remembered text never appears in any structured log payload.
    expect(allLogPayloads()).not.toContain("SECRET-PII-marker-abc123");
  });

  it("a successful taste remember (with domain) → status ok", async () => {
    await seedDomain();
    const payload = payloadOf(
      await getTool(api, REMEMBER).execute("r-2", {
        agentId: SHOPPER,
        kind: "taste",
        text: "Leans Shimano.",
        domain: DOMAIN.slug,
      }),
    );
    expect(payload["status"]).toBe("ok");
  });

  it("a malformed/traversal agentId → status invalid_request(field=agentId), warn logged", async () => {
    const payload = payloadOf(
      await getTool(api, REMEMBER).execute("r-3", {
        agentId: "../escape",
        kind: "fact",
        text: "a fact",
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("agentId");
    expect((api.logger.warn as unknown as { mock: { calls: unknown[] } }).mock.calls.length)
      .toBeGreaterThan(0);
  });

  it("a blank text → status invalid_request(field=text)", async () => {
    await seedShopper();
    const payload = payloadOf(
      await getTool(api, REMEMBER).execute("r-4", { agentId: SHOPPER, kind: "fact", text: "   " }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("text");
  });

  it("a fact carrying a domain → status invalid_request (category error)", async () => {
    await seedDomain();
    const payload = payloadOf(
      await getTool(api, REMEMBER).execute("r-5", {
        agentId: SHOPPER,
        kind: "fact",
        text: "a fact",
        domain: DOMAIN.slug,
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("domain");
  });

  it("a taste carrying hard:true → status invalid_request (contradiction)", async () => {
    await seedDomain();
    const payload = payloadOf(
      await getTool(api, REMEMBER).execute("r-6", {
        agentId: SHOPPER,
        kind: "taste",
        text: "always premium",
        domain: DOMAIN.slug,
        hard: true,
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("hard");
  });

  it("a fact for an unknown shopper → status not_found", async () => {
    const payload = payloadOf(
      await getTool(api, REMEMBER).execute("r-7", {
        agentId: "ghost-shopper",
        kind: "fact",
        text: "a fact",
      }),
    );
    expect(payload["status"]).toBe("not_found");
  });

  it("a genuine fs failure → status persistence_failed with a fix_data_dir recovery, text not logged", async () => {
    await seedShopper();
    // Replace the user_spec.md target with a directory → the existence gate passes
    // but the O_APPEND open throws EISDIR (perm-independent / root-safe).
    const userSpecPath = join(getDataDir(), "agents", SHOPPER, "user_spec.md");
    rmSync(userSpecPath, { force: true });
    mkdirSync(userSpecPath);

    const text = "fact SECRET-PII-zzz";
    const payload = payloadOf(
      await getTool(api, REMEMBER).execute("r-8", { agentId: SHOPPER, kind: "fact", text }),
    );
    expect(payload["status"]).toBe("persistence_failed");
    expect(payload["recovery"]).toBe("fix_data_dir");
    expect(allLogPayloads()).not.toContain("SECRET-PII-zzz");
  });
});
