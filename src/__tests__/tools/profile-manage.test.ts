/**
 * UNIT — sil_profile_list / sil_profile_get / sil_profile_remove tools:
 * registration shape + the structured envelope each maps the store outcome to
 * (tier: unit, mock api + temp data dir, no network, no host).
 *
 * Card: list-view-and-remove-local-expert-agents. The pure store-primitive
 * invariants live in `lib/profile-store-manage.test.ts`; here we pin the TOOL
 * boundary — the three management tools that wrap list/read/remove:
 *
 *   sil_profile_list   (no args)      → { status:"ok", experts[], unreadable[] }
 *   sil_profile_get    (agentId)      → ok | not_found | invalid_request
 *   sil_profile_remove (agentId)      → removed | not_found | invalid_request
 *                                       | persistence_failed
 *
 * Adversarial, behaviour-first: the tools must map every store variant to the
 * agreed envelope, and the destructive one (remove) must clear EXACTLY the named
 * expert's dir while a sibling expert's dir survives (the scoped-delete +
 * non-destructiveness criteria at the tool seam). Reads no token (generic
 * shopping is identity-decoupled).
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (mirrors
 * profile-materialize.test.ts:68-80).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/tools/profile.ts#registerProfileTools(api)`:
 *   - registers sil_profile_list (Type.Object({})), sil_profile_get and
 *     sil_profile_remove (Type.Object({agentId})) — agentId required;
 *   - list  → jsonResult({status:"ok", experts, unreadable}), createdAt DESC;
 *   - get   → {status:"ok", agentId, name, persona, playbook?, profilePath,
 *     createdAt} / {status:"not_found", agentId, …recovery} /
 *     {status:"invalid_request", field, message};
 *   - remove→ {status:"removed", agentId} / {status:"not_found", agentId} /
 *     {status:"invalid_request", field} / {status:"persistence_failed", error,
 *     recovery} — and clears only the named expert's dir.
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

/** Materialize an expert via the real store writer (never a hand fixture), so
 * the tools read the genuine on-disk shape. Optionally pin createdAt. */
function makeExpert(
  agentId: string,
  opts: { name?: string; persona?: string; playbook?: string; createdAt?: string } = {},
): void {
  const result = materializeProfile({
    agentId,
    name: opts.name ?? `Expert ${agentId}`,
    persona: opts.persona ?? `Persona for ${agentId}.`,
    ...(opts.playbook !== undefined ? { playbook: opts.playbook } : {}),
  });
  if (!result.ok) throw new Error(`fixture setup failed: ${JSON.stringify(result)}`);
  if (opts.createdAt !== undefined) {
    const manifestPath = join(getAgentArtefactDir(agentId), "profile.json");
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    m["createdAt"] = opts.createdAt;
    writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
  }
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-profile-manage-tool-"));
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
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    // No required args — list takes nothing.
    expect(schema.required ?? []).toEqual([]);
  });

  it("registers sil_profile_get with a required agentId string param", () => {
    const tool = getTool(api, GET);
    expect(tool.name).toBe(GET);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(schema.properties?.["agentId"]?.type).toBe("string");
    expect(schema.required ?? []).toContain("agentId");
  });

  it("registers sil_profile_remove with a required agentId string param", () => {
    const tool = getTool(api, REMOVE);
    expect(tool.name).toBe(REMOVE);
    const schema = tool.parameters as unknown as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(schema.properties?.["agentId"]?.type).toBe("string");
    expect(schema.required ?? []).toContain("agentId");
  });
});

// ===========================================================================
// sil_profile_list
// ===========================================================================

describe("sil_profile_list — ok envelope", () => {
  it("empty store → status ok with empty experts (a normal outcome)", async () => {
    const tool = getTool(api, LIST);
    const payload = payloadOf(await tool.execute("c-1", {}));
    expect(payload["status"]).toBe("ok");
    expect(payload["experts"]).toEqual([]);
    expect(payload["unreadable"]).toEqual([]);
  });

  it("lists every expert (name + hasPlaybook + agentId from the manifest), createdAt DESC", async () => {
    makeExpert("oldest", { name: "Oldest", createdAt: "2026-01-01T00:00:00.000Z" });
    makeExpert("newest", {
      name: "Newest",
      playbook: "pb",
      createdAt: "2026-06-22T00:00:00.000Z",
    });

    const tool = getTool(api, LIST);
    const payload = payloadOf(await tool.execute("c-2", {}));
    expect(payload["status"]).toBe("ok");
    const experts = payload["experts"] as Array<Record<string, unknown>>;
    // Most-recently-created first.
    expect(experts.map((e) => e["agentId"])).toEqual(["newest", "oldest"]);
    expect(experts[0]!["name"]).toBe("Newest");
    expect(experts[0]!["hasPlaybook"]).toBe(true);
    expect(experts[1]!["hasPlaybook"]).toBe(false);
  });

  it("one corrupt manifest → healthy experts still list, broken one in unreadable[]", async () => {
    makeExpert("healthy", { name: "Healthy" });
    makeExpert("broken", { name: "Broken" });
    writeFileSync(join(getAgentArtefactDir("broken"), "profile.json"), "not json {{{");

    const tool = getTool(api, LIST);
    const payload = payloadOf(await tool.execute("c-3", {}));
    expect(payload["status"]).toBe("ok");
    const experts = payload["experts"] as Array<Record<string, unknown>>;
    const unreadable = payload["unreadable"] as Array<Record<string, unknown>>;
    expect(experts.map((e) => e["agentId"])).toEqual(["healthy"]);
    expect(unreadable.map((u) => u["agentId"])).toContain("broken");
  });
});

// ===========================================================================
// sil_profile_get
// ===========================================================================

describe("sil_profile_get — ok envelope (full detail from artefacts)", () => {
  it("returns status ok with name, persona, playbook, profilePath, createdAt", async () => {
    makeExpert("gift-buyer", {
      name: "Gift Buyer",
      persona: "Gifts under €50; check stock.",
      playbook: "Use sil_search then sil_product_get.",
    });
    const tool = getTool(api, GET);
    const payload = payloadOf(await tool.execute("c-4", { agentId: "gift-buyer" }));
    expect(payload["status"]).toBe("ok");
    expect(payload["agentId"]).toBe("gift-buyer");
    expect(payload["name"]).toBe("Gift Buyer");
    expect(payload["persona"]).toBe("Gifts under €50; check stock.");
    expect(payload["playbook"]).toBe("Use sil_search then sil_product_get.");
    expect(payload["profilePath"]).toBe(
      join(getAgentArtefactDir("gift-buyer"), "profile.json"),
    );
    expect(typeof payload["createdAt"]).toBe("string");
  });

  it("omits playbook in the envelope when the expert has none", async () => {
    makeExpert("grocery", { name: "Grocery" });
    const tool = getTool(api, GET);
    const payload = payloadOf(await tool.execute("c-5", { agentId: "grocery" }));
    expect(payload["status"]).toBe("ok");
    expect(payload["playbook"]).toBeUndefined();
    expect(typeof payload["persona"]).toBe("string");
  });
});

describe("sil_profile_get — graceful failures", () => {
  it("unknown id → status not_found naming the agentId, with a list-then-retry recovery hint", async () => {
    makeExpert("exists", {}); // a neighbour, to prove get is scoped
    const tool = getTool(api, GET);
    const payload = payloadOf(await tool.execute("c-6", { agentId: "ghost" }));
    expect(payload["status"]).toBe("not_found");
    expect(payload["agentId"]).toBe("ghost");
    // The recovery hint steers the agent to list, not to re-register.
    expect(payload["recovery"]).toBe("sil_profile_list");
    // No stack trace / raw path leaked — the message is a plain string.
    expect(typeof payload["message"]).toBe("string");
  });

  it.each(["../escape", "gift/buyer", "..", "main", "Gift-Buyer"])(
    "traversal/main/malformed id %j → status invalid_request(field=agentId), reads nothing",
    async (bad) => {
      const tool = getTool(api, GET);
      const payload = payloadOf(await tool.execute("c-7", { agentId: bad }));
      expect(payload["status"]).toBe("invalid_request");
      expect(payload["field"]).toBe("agentId");
      expect(typeof payload["message"]).toBe("string");
    },
  );
});

// ===========================================================================
// sil_profile_remove
// ===========================================================================

describe("sil_profile_remove — clears the target dir, sibling survives (scoped)", () => {
  it("removed → status removed and the target dir is gone; a sibling expert's dir survives", async () => {
    makeExpert("target", { name: "Target", playbook: "doomed" });
    makeExpert("survivor", { name: "Survivor", playbook: "keep me" });
    const targetDir = getAgentArtefactDir("target");
    const survivorDir = getAgentArtefactDir("survivor");
    expect(existsSync(targetDir)).toBe(true);

    const tool = getTool(api, REMOVE);
    const payload = payloadOf(await tool.execute("c-8", { agentId: "target" }));
    expect(payload["status"]).toBe("removed");
    expect(payload["agentId"]).toBe("target");

    // Scoped: target gone, sibling untouched.
    expect(existsSync(targetDir)).toBe(false);
    expect(existsSync(survivorDir)).toBe(true);
    expect(existsSync(join(survivorDir, "profile.json"))).toBe(true);
    expect(existsSync(join(survivorDir, "playbook.md"))).toBe(true);
  });
});

describe("sil_profile_remove — graceful + fail-closed", () => {
  it("unknown id → status not_found (idempotent: a re-run is also not_found), deletes nothing", async () => {
    makeExpert("neighbour", { name: "Neighbour" });
    const tool = getTool(api, REMOVE);

    const first = payloadOf(await tool.execute("c-9", { agentId: "ghost" }));
    expect(first["status"]).toBe("not_found");
    expect(first["agentId"]).toBe("ghost");
    expect(existsSync(getAgentArtefactDir("neighbour"))).toBe(true);

    // Idempotent re-run.
    const second = payloadOf(await tool.execute("c-10", { agentId: "ghost" }));
    expect(second["status"]).toBe("not_found");
  });

  it.each(["../escape", "gift/buyer", "..", "main", "Gift-Buyer"])(
    "traversal/main/malformed id %j → status invalid_request(field=agentId), deletes nothing",
    async (bad) => {
      makeExpert("alpha", { name: "Alpha", playbook: "keep" });
      const tool = getTool(api, REMOVE);
      const payload = payloadOf(await tool.execute("c-11", { agentId: bad }));
      expect(payload["status"]).toBe("invalid_request");
      expect(payload["field"]).toBe("agentId");
      // The real expert is untouched — the bad id deleted nothing.
      expect(existsSync(getAgentArtefactDir("alpha"))).toBe(true);
    },
  );

  it("removed → re-remove of the same id returns not_found (full removed→not_found cycle)", async () => {
    makeExpert("transient", { name: "Transient" });
    const tool = getTool(api, REMOVE);
    expect(payloadOf(await tool.execute("c-12", { agentId: "transient" }))["status"]).toBe(
      "removed",
    );
    expect(payloadOf(await tool.execute("c-13", { agentId: "transient" }))["status"]).toBe(
      "not_found",
    );
  });
});

// ===========================================================================
// Identity boundary — no token side effect across any management tool
// ===========================================================================

describe("management tools — no identity coupling (no token side effect)", () => {
  it("list, get, and remove read/write no token across a full cycle", async () => {
    makeExpert("cycle", { name: "Cycle", playbook: "pb" });
    await getTool(api, LIST).execute("c-14", {});
    await getTool(api, GET).execute("c-15", { agentId: "cycle" });
    await getTool(api, REMOVE).execute("c-16", { agentId: "cycle" });
    expect(existsSync(getTokensPath())).toBe(false);
  });
});
