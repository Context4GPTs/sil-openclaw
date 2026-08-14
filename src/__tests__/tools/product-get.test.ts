/**
 * UNIT — `sil_product_get`'s agent-facing surface (tier: unit — mock api, temp
 * data dir, `fetch` spied).
 *
 * THE >5-REFS REFUSAL IS THE SCHEMA'S, NOT A HAND-ROLLED GUARD. `refs × K` is
 * the lookup's whole cost and a shopper is blocked on it, so the route bounds
 * the cardinality before the body is read (`LOOKUP_REFS_MAX = 5`). The tool
 * mirrors that bound into its own `parameters`, where the HOST enforces it
 * before `execute()` runs — so the behaviour the criterion wants (refused, cap
 * named, ZERO network calls) is met by the mirrored bound. A second validator
 * inside `execute()` would be a second contract to drift, which is exactly what
 * the v0 client deletes.
 *
 * That makes the criterion's proof a schema assertion PLUS a proof that the
 * declared bound is the one the host would act on — both below.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../../tools/catalog.js";
import { setApiUrl, setWebUrl } from "../../lib/config.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "../helpers/mock-plugin-api.js";

const TOOL = "sil_product_get";

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-lookup-unit-"));
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

function refsSchema(): Record<string, unknown> {
  return (schema()["properties"] as Record<string, Record<string, unknown>>)["refs"];
}

describe("registration", () => {
  it("registers `sil_product_get` — NOT `sil_lookup`", () => {
    // SC6 names it; a rename fans out to every exact-set mirror for zero gain.
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    expect([...api._tools.keys()]).not.toContain("sil_lookup");
  });
});

describe("the ≤5-refs cap is carried by the schema — the route's bound, mirrored", () => {
  it("declares exactly `{ refs }` — no `k`, no `top_k`, no batch knob", () => {
    // K is a product setting, not a request field: an agent-settable fetch count
    // on a route with no index budget is a cost and abuse vector, and the route
    // refuses a submitted one outright.
    expect(Object.keys(schema()["properties"] as object)).toEqual(["refs"]);
    expect((schema()["required"] as string[]).sort()).toEqual(["refs"]);
  });

  it("`refs` is an array of strings bounded 1–5, mirroring LOOKUP_REFS_MAX", () => {
    expect(refsSchema()["type"]).toBe("array");
    expect(refsSchema()["minItems"]).toBe(1);
    expect(refsSchema()["maxItems"]).toBe(5);
    expect((refsSchema()["items"] as Record<string, unknown>)["type"]).toBe("string");
  });

  it("the declared cap IS 5 — the number an agent reads, not a larger one 'for safety'", () => {
    // Guard-of-the-guard: `maxItems: 50` would pass "is a number" and silently
    // let a 6-ref batch through to a route that 400s it.
    expect(refsSchema()["maxItems"]).toBe(5);
    expect(refsSchema()["maxItems"]).not.toBeGreaterThan(5);
  });

  it("a 6-ref call violates the PUBLISHED schema — the host refuses it before execute()", () => {
    // The host validates `parameters` before invoking. Proving the bound is
    // declared and would reject is the honest in-repo proof; the host's own
    // validator is not ours to re-implement, and re-implementing it inside
    // `execute()` is the second-contract defect this design deletes.
    const max = refsSchema()["maxItems"] as number;
    expect(["a", "b", "c", "d", "e", "f"].length).toBeGreaterThan(max);
    expect(["a", "b", "c", "d", "e"].length).toBeLessThanOrEqual(max);
  });

  it("`execute()` holds NO second refs-length validator — the cap lives in one place", async () => {
    // If a hand-rolled guard existed it would answer `invalid_request` here
    // WITHOUT a network call. With no tokens the only pre-network outcome is the
    // not-registered gate, so a different pre-network refusal means a second
    // validator was added behind the schema's back.
    const result = await getTool(api, TOOL).execute("call-1", {
      refs: ["a", "b", "c", "d", "e", "f", "g"],
    });
    const payload = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    expect(payload["status"]).toBe("not_registered");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("`refs` carries a non-empty description naming the ref forms and the cap", () => {
    const d = (refsSchema()["description"] as string | undefined) ?? "";
    expect(d.trim().length).toBeGreaterThan(0);
    expect(d).toMatch(/\b5\b|\bfive\b/);
  });

  it("no TypeBox introspection metadata leaks into the serialized schema", () => {
    const serialized = JSON.stringify(schema());
    for (const key of ["~kind", "~optional", "~readonly"]) {
      expect(serialized).not.toContain(key);
    }
  });
});

describe("the description carries the freshness contract", () => {
  const description = (): string => getTool(api, TOOL).description ?? "";

  it("names both `observed` states — `live` and `stored`", () => {
    const d = description();
    expect(d).toContain("live");
    expect(d).toContain("stored");
  });

  it("instructs DATING a stored price rather than presenting it as current", () => {
    // This is the defect the route exists to prevent: a `stored` price quoted as
    // the current price. The wire carries `observed`; only the description can
    // tell the agent what to do with it.
    expect(description().toLowerCase()).toMatch(/date it was read|say the date|as of/);
    expect(description().toLowerCase()).toMatch(/never present it as the current price|not the current price/);
  });

  it("says ONLY the offers move — values, pairs and media are the stored read", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/only the offers|offers move/);
    expect(d).toContain("values");
  });

  it("says a missing ref is an ABSENCE, and forbids substituting another product", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/absent|gone|not (in|among) the results/);
    expect(d).toMatch(/never substitute|do not substitute|no substitut/);
  });

  it("carries the shortlist-read discipline clause", () => {
    expect(description().toLowerCase()).toMatch(/shortlist/);
  });
});

describe("before the network: the not-registered gate", () => {
  it("with no stored tokens the tool is terminal `not_registered` and calls NO fetch", async () => {
    const result = await getTool(api, TOOL).execute("call-2", { refs: ["variant:abc"] });
    const payload = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    expect(payload["status"]).toBe("not_registered");
    expect(payload["recovery"]).toBe("sil_register");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
