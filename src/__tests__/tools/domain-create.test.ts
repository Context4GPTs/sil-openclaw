/**
 * UNIT — `sil_domain_create`'s agent-facing surface (tier: unit — mock api, temp
 * data dir, `fetch` spied).
 *
 * This tool performs v0's ONE registry write, and the write is PERMANENT: no
 * delete route, no upsert, and an existing path is refused rather than changed.
 * Two failure modes follow, and both are description-carried:
 *
 *   - minting a near-path variant to route around a 409 forks the taxonomy for
 *     every sil shopper, forever;
 *   - minting from the model's priors instead of from research produces a guide
 *     nothing downstream can detect as wrong.
 *
 * So the four clauses the card names — NEW-nodes-only, research-first,
 * never-to-change-what-exists, global-visibility — are asserted here, and the
 * `data_type` union is asserted to stay OPEN because a closed one produces a
 * schema-path 400 that never names the offending spec KEY.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../../tools/catalog.js";
import { setApiUrl, setWebUrl } from "../../lib/config.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "../helpers/mock-plugin-api.js";
import { overTriggerOffenders } from "../helpers/honesty-vocabulary.js";

const TOOL = "sil_domain_create";

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-mint-unit-"));
  priorDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setApiUrl("https://sil-api.test.example.com");
  setWebUrl("https://sil-web.test.example.com");
  fetchSpy = vi.spyOn(globalThis, "fetch");
  api = createMockPluginApi();
  registerCatalogTools(api);
});

afterEach(() => {
  vi.restoreAllMocks();
  setApiUrl("");
  setWebUrl("");
  if (priorDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function schema(): Record<string, unknown> {
  return getTool(api, TOOL).parameters as unknown as Record<string, unknown>;
}

function props(): Record<string, Record<string, unknown>> {
  return schema()["properties"] as Record<string, Record<string, unknown>>;
}

const description = (): string => getTool(api, TOOL).description ?? "";

describe("registration and schema", () => {
  it("registers `sil_domain_create` with a description and an object schema", () => {
    expect(getTool(api, TOOL).name).toBe(TOOL);
    expect(description().length).toBeGreaterThan(0);
    expect(schema()["type"]).toBe("object");
  });

  it("declares exactly `{ path, guide, specs }`, all three required", () => {
    expect(Object.keys(props()).sort()).toEqual(["guide", "path", "specs"]);
    expect((schema()["required"] as string[]).sort()).toEqual(["guide", "path", "specs"]);
  });

  it("`path` carries the same registry pattern `sil_search`'s `domain` does", () => {
    const searchDomain = (
      (getTool(api, "sil_search").parameters as unknown as Record<string, unknown>)[
        "properties"
      ] as Record<string, Record<string, unknown>>
    )["domain"];
    // One pattern, two tools. A mint whose path grammar differs from search's
    // lets an agent coin a path it can then never search.
    expect(props()["path"]["pattern"]).toBe(searchDomain["pattern"]);
    expect(props()["path"]["maxLength"]).toBe(255);
  });

  it("`guide` is a required, bounded 1–4096 string — the research's only output", () => {
    expect(props()["guide"]["type"]).toBe("string");
    expect(props()["guide"]["minLength"]).toBe(1);
    expect(props()["guide"]["maxLength"]).toBe(4096);
  });

  it("`specs` is an array capped at 50, mirroring MINT_SPECS_MAX", () => {
    expect(props()["specs"]["type"]).toBe("array");
    expect(props()["specs"]["maxItems"]).toBe(50);
  });

  it("a spec declares the route's seven fields, with `key`/`display_name`/`data_type` required", () => {
    const item = props()["specs"]["items"] as Record<string, unknown>;
    const itemProps = item["properties"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(itemProps).sort()).toEqual([
      "allowed_values",
      "data_type",
      "description",
      "display_name",
      "key",
      "level",
      "unit",
      "value_set",
    ]);
    expect((item["required"] as string[]).sort()).toEqual(["data_type", "display_name", "key"]);
  });

  it("`data_type` stays a PLAIN STRING — a closed union would hide the offending spec key", () => {
    // A TypeBox union rejects with a schema-path message ("/specs/1/data_type")
    // that never names the KEY, and the agent's entire recourse to an
    // all-or-nothing mint failure is the message. The route makes the same
    // choice for the same reason; mirroring it keeps the refusal the route's.
    const itemProps = (props()["specs"]["items"] as Record<string, unknown>)[
      "properties"
    ] as Record<string, Record<string, unknown>>;
    expect(itemProps["data_type"]["type"]).toBe("string");
    expect(itemProps["data_type"]).not.toHaveProperty("enum");
    expect(itemProps["data_type"]).not.toHaveProperty("anyOf");
    expect(itemProps["data_type"]).not.toHaveProperty("oneOf");
  });

  it("every parameter carries a non-empty description", () => {
    const missing = Object.entries(props())
      .filter(([, p]) => ((p["description"] as string | undefined) ?? "").trim().length === 0)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});

describe("the four clauses the description must carry", () => {
  it("NEW nodes only", () => {
    expect(description()).toMatch(/\bNEW\b/);
    expect(description().toLowerCase()).toMatch(/new (category|node|domain)/);
  });

  it("research the category first — on how it is BOUGHT, never on products", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/research|reading up|read up/);
    expect(d).toMatch(/bought|buying guide|how .* is (actually )?bought/);
    expect(d).toMatch(/never on products|not on products/);
  });

  it("never call it to change what exists", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/never call this to change|not to change what exists|never .* change or extend/);
  });

  it("what you write is GLOBAL — every sil shopper sees it", () => {
    expect(description().toLowerCase()).toMatch(/global|every sil shopper|all shoppers/);
  });

  it("forbids minting a near-path variant to route around a refusal", () => {
    // The permanent-damage move: two nodes for one category, vocabulary split
    // forever, and no tool can delete a domain.
    expect(description().toLowerCase()).toMatch(
      /near-path|route around|different or shallower|variant to route/,
    );
  });

  it("says a refusal means the category is already there — re-issue the search on the SAME path", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/already there|already exists/);
    expect(d).toMatch(/same path/);
  });

  it("states the provisional/web-first expectation a fresh node carries", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/provisional|until sil validates|not yet validated/);
    expect(d).toMatch(/from the web|web while/);
  });

  it("does not claim a general capability", () => {
    // "reading up on the web" is the research path and must NOT be confused with
    // an over-broad "search the web" trigger.
    expect(overTriggerOffenders(description())).toEqual([]);
  });

  it("guard-of-the-guard: the description is substantial enough for the scans above", () => {
    expect(description().trim().length).toBeGreaterThan(200);
  });
});

describe("before the network", () => {
  it("with no stored tokens the tool is terminal `not_registered` and calls NO fetch", async () => {
    const result = await getTool(api, TOOL).execute("call-1", {
      path: "product.sports.winter.ski.boots",
      guide: "How ski boots are bought.",
      specs: [],
    });
    const payload = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    expect(payload["status"]).toBe("not_registered");
    expect(payload["recovery"]).toBe("sil_register");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a global registry write NEVER happens on an unauthenticated call", async () => {
    // The most consequential zero-network assertion on the surface: the mint is
    // the only write the product cannot undo.
    await getTool(api, TOOL).execute("call-2", {
      path: "product.x",
      guide: "g",
      specs: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
