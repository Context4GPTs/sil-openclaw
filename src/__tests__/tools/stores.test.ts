/**
 * UNIT — `sil_stores`' agent-facing surface, and THE description scan the whole
 * product turns on (tier: unit — mock api, temp data dir, `fetch` spied).
 *
 * `unknown` is not a degraded answer, it is the MAJORITY answer at v0 —
 * `not_serviceable` needs policy evidence sil read, and nothing writes
 * `corpus.purposes = 'policy'` yet, so it is structurally unreachable. An agent
 * that drops `unknown` sellers collapses the shortlist to near-empty WHILE
 * LOOKING LIKE IT FILTERED, and the failure is invisible from outside.
 *
 * Prose is the only carrier of that rule and prose rots (RK5). So the rule is
 * guarded MECHANICALLY here — the shared `honestyExclusionOffenders` scanner,
 * the same module the skill-prose guard imports, so the two can never drift —
 * and the guard's own bite is proved in `lib/honesty-vocabulary.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../../tools/catalog.js";
import { setApiUrl, setWebUrl } from "../../lib/config.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "../helpers/mock-plugin-api.js";
import {
  honestyExclusionOffenders,
  overPromiseOffenders,
} from "../helpers/honesty-vocabulary.js";

const TOOL = "sil_stores";

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-stores-unit-"));
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

/** The tool description PLUS every parameter description — the whole surface an
 * agent reads. A rule enforced on one and not the other is not enforced. */
function agentFacingText(): string {
  const tool = getTool(api, TOOL);
  return [
    tool.description ?? "",
    ...Object.values(props()).map((p) => (p["description"] as string | undefined) ?? ""),
  ].join("\n");
}

describe("registration and schema", () => {
  it("registers `sil_stores` with a description and an object schema", () => {
    expect(getTool(api, TOOL).name).toBe(TOOL);
    expect(description().length).toBeGreaterThan(0);
    expect(schema()["type"]).toBe("object");
  });

  it("takes ONE `ref`, not a batch — the subject is THE pick", () => {
    // A batched stores call would fold several picks' seller sets into one list
    // where `serviceability` no longer says which pick it is about.
    expect(props()["ref"]["type"]).toBe("string");
    expect(props()["ref"]["type"]).not.toBe("array");
    expect((schema()["required"] as string[])).toContain("ref");
  });

  it("declares exactly `{ ref, destination }`", () => {
    expect(Object.keys(props()).sort()).toEqual(["destination", "ref"]);
  });

  it("`destination` is an OPTIONAL alpha-2 string — empty means ship to me", () => {
    expect((schema()["required"] as string[])).not.toContain("destination");
    const re = new RegExp(props()["destination"]["pattern"] as string);
    for (const good of ["DE", "us"]) expect(re.test(good)).toBe(true);
    for (const bad of ["DEU", "Germany", "d"]) expect(re.test(bad)).toBe(false);
  });

  it("every parameter carries a non-empty description", () => {
    const missing = Object.entries(props())
      .filter(([, p]) => ((p["description"] as string | undefined) ?? "").trim().length === 0)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});

describe("THE `unknown` rule — guarded, not just written", () => {
  it("names all three serviceability states", () => {
    const d = description();
    for (const state of ["serviceable", "not_serviceable", "unknown"]) {
      expect(d).toContain(state);
    }
  });

  it("states that `unknown` KEEPS the seller", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/keep (it|the seller)|the seller stays|never a reason to drop/);
  });

  it("frames `unknown` as an ordinary answer, not a degraded one", () => {
    expect(description().toLowerCase()).toMatch(
      /ordinary answer|not a degraded|correct answer|never no/,
    );
  });

  it("contains NO phrase instructing a drop / exclude / filter / skip on an honesty field", () => {
    // The shared scanner, sentence-scoped with a keep/negation allowance so the
    // sentence the product NEEDS ("never a reason to drop a seller: keep it")
    // passes while "drop the unknowns" does not. Its bite is proved in
    // `lib/honesty-vocabulary.test.ts`.
    expect(honestyExclusionOffenders(agentFacingText())).toEqual([]);
  });

  it("does not out-promise the route — no 'ships to you' where the state can be unknown", () => {
    expect(overPromiseOffenders(agentFacingText())).toEqual([]);
  });

  it("guard-of-the-guard: the scan is running over NON-EMPTY text", () => {
    // A scanner pointed at "" returns [] forever. This is what stops the two
    // assertions above from passing because the description went missing.
    expect(agentFacingText().trim().length).toBeGreaterThan(200);
  });
});

describe("the rest of the honesty surface the description must carry", () => {
  it("says `unset` is never zero and never free", () => {
    const d = description().toLowerCase();
    expect(d).toContain("unset");
    expect(d).toMatch(/never zero|not zero/);
    expect(d).toMatch(/never free|not free/);
  });

  it("names BOTH handoff sources and tells the agent to say which it is handing over", () => {
    // `buy_url` is a checkout path; `url` is a listing page. They are different
    // promises to a buyer, and v0's transaction boundary is that URL and nothing
    // past it.
    const d = description();
    expect(d).toContain("buy_url");
    expect(d).toMatch(/\bsource\b/);
    expect(d.toLowerCase()).toMatch(/checkout path|checkout/);
    expect(d.toLowerCase()).toMatch(/listing page/);
    expect(d.toLowerCase()).toMatch(/say which|which one you are handing/);
  });

  it("frames costs as RANGES per currency, and never converts between currencies", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/range/);
    expect(d).toMatch(/per currency|currency/);
  });

  it("carries the pick's-check discipline clause", () => {
    expect(description().toLowerCase()).toMatch(/three states/);
  });
});

describe("before the network", () => {
  it("with no stored tokens the tool is terminal `not_registered` and calls NO fetch", async () => {
    const result = await getTool(api, TOOL).execute("call-1", { ref: "variant:abc" });
    const payload = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    expect(payload["status"]).toBe("not_registered");
    expect(payload["recovery"]).toBe("sil_register");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
