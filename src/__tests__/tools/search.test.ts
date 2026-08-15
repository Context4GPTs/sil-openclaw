/**
 * UNIT — `sil_search`'s agent-facing surface: the parameter schema and the two
 * things that happen before any network call (tier: unit — mock api, temp data
 * dir, `fetch` spied so nothing escapes).
 *
 * THE SCHEMA IS THE VALIDATOR. Every bound here MIRRORS the route's own
 * (`packages/schemas/src/search.ts`), so a rejection is the route's rule stated
 * once more where the host can enforce it for free — never a second hand-rolled
 * validator, which is the divergence surface the v0 client deletes. The host
 * validates `parameters` before `execute()` runs, so `n: 0` or a 33rd predicate
 * is refused with ZERO network calls by construction.
 *
 * The wired pipeline, the outcome taxonomy and the buffer side effect are
 * `catalog-search.integration.test.ts`'s job. Descriptions are scanned for the
 * honesty/over-trigger/retired vocabulary across ALL four tools in
 * `tool-schema-contract.unit.test.ts`; what is asserted here is only what is
 * specific to `sil_search`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../../tools/catalog.js";
import { setApiUrl, setWebUrl } from "../../lib/config.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "../helpers/mock-plugin-api.js";

const TOOL = "sil_search";

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-search-unit-"));
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

/** The published JSON-schema — the exact object the host serializes for the agent. */
function schema(): Record<string, unknown> {
  return getTool(api, TOOL).parameters as unknown as Record<string, unknown>;
}

function props(): Record<string, Record<string, unknown>> {
  return schema()["properties"] as Record<string, Record<string, unknown>>;
}

function required(): string[] {
  return (schema()["required"] as string[] | undefined) ?? [];
}

describe("registration", () => {
  it("registers `sil_search` with a label, a description and an object schema", () => {
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    expect((tool.label ?? "").length).toBeGreaterThan(0);
    expect((tool.description ?? "").length).toBeGreaterThan(0);
    expect(schema()["type"]).toBe("object");
  });
});

describe("the parameter schema mirrors the route's own bounds", () => {
  it("declares exactly `{ domain, query, n, predicates, destination }` — nothing else", () => {
    // `additionalProperties: false` on the route means every extra key is a 400.
    // A parameter the route does not accept is a tool that cannot succeed.
    expect(Object.keys(props()).sort()).toEqual([
      "destination",
      "domain",
      "n",
      "predicates",
      "query",
    ]);
  });

  it("`domain`, `query` and `n` are REQUIRED; `predicates` and `destination` are not", () => {
    expect(required().sort()).toEqual(["domain", "n", "query"]);
  });

  it("`n` is required with NO default — a silently-defaulted spend is the plugin deciding", () => {
    // The web leg fetches candidates, so `n` is a spend knob. The agent chooses.
    expect(required()).toContain("n");
    expect(props()["n"]).not.toHaveProperty("default");
  });

  it("`n` is an integer bounded 1–50, mirroring SEARCH_N_MAX", () => {
    expect(props()["n"]["type"]).toBe("integer");
    expect(props()["n"]["minimum"]).toBe(1);
    expect(props()["n"]["maximum"]).toBe(50);
  });

  it("`domain` carries the registry's ltree pattern, and it ACCEPTS/REJECTS the right paths", () => {
    const pattern = props()["domain"]["pattern"];
    expect(typeof pattern).toBe("string");
    const re = new RegExp(pattern as string);
    for (const good of ["product", "product.sports", "product.sports.winter.ski.boots", "a_b.c1"]) {
      expect({ path: good, ok: re.test(good) }).toEqual({ path: good, ok: true });
    }
    for (const bad of ["Product.Sports", "product..boots", ".product", "product.", "ski boots", ""]) {
      expect({ path: bad, ok: re.test(bad) }).toEqual({ path: bad, ok: false });
    }
    expect(props()["domain"]["maxLength"]).toBe(255);
  });

  it("`query` is a bounded string 1–512 — an empty query is refused by the schema", () => {
    expect(props()["query"]["type"]).toBe("string");
    expect(props()["query"]["minLength"]).toBe(1);
    expect(props()["query"]["maxLength"]).toBe(512);
  });

  it("`predicates` is an array capped at 32, mirroring the route", () => {
    expect(props()["predicates"]["type"]).toBe("array");
    expect(props()["predicates"]["maxItems"]).toBe(32);
  });

  it("a predicate declares `{ key, op, value, currency }` with the seven ops, closed", () => {
    const item = props()["predicates"]["items"] as Record<string, unknown>;
    const itemProps = item["properties"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(itemProps).sort()).toEqual(["currency", "key", "op", "value"]);
    // The op union is the ONLY closed part of the predicate contract; the key
    // vocabulary is deliberately open (an out-of-vocabulary key is `applied:
    // false`, a named gap — never an error).
    const serialized = JSON.stringify(item["properties"]);
    for (const op of ["eq", "neq", "gte", "lte", "in", "nin", "exists"]) {
      expect(serialized).toContain(`"${op}"`);
    }
  });

  it("`destination` is a bare ISO 3166-1 alpha-2 string — `ship_to` is gone", () => {
    expect(props()["destination"]["type"]).toBe("string");
    const pattern = props()["destination"]["pattern"];
    expect(typeof pattern).toBe("string");
    const re = new RegExp(pattern as string);
    for (const good of ["DE", "us", "Gb"]) expect(re.test(good)).toBe(true);
    for (const bad of ["USA", "D", "United States", "de-DE", ""]) expect(re.test(bad)).toBe(false);
  });

  it("`destination` is OPTIONAL — empty means ship to me, resolved server-side", () => {
    expect(required()).not.toContain("destination");
  });

  it("every declared parameter carries a non-empty `description`", () => {
    // Parameter semantics live in the parameter's own description (R6.2.4) —
    // that is what keeps the tool description short enough to survive a
    // pick-time read under context pressure.
    const missing = Object.entries(props())
      .filter(([, p]) => typeof p["description"] !== "string" || (p["description"] as string).trim().length === 0)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("no TypeBox introspection metadata leaks into the serialized schema", () => {
    const serialized = JSON.stringify(schema());
    for (const key of ["~kind", "~optional", "~readonly"]) {
      expect(serialized).not.toContain(key);
    }
  });
});

describe("the description carries what only it can carry", () => {
  const description = (): string => getTool(api, TOOL).description ?? "";

  it("names the registry refusal's ONE recovery — `sil_domain_create`, at the same path", () => {
    // Both search 400s carry the identical `error: "invalid_request"`, so the
    // envelope cannot discriminate them and the plugin refuses to substring-match
    // the sibling's prose. That makes THIS sentence the agent's only machine-
    // independent route out of a cold category. Nothing else guards it.
    const d = description();
    expect(d).toContain("sil_domain_create");
    expect(d).toMatch(/registr(y|ies)|registered|unregistered/i);
  });

  it("the `domain` PARAMETER's own description names the remedy too", () => {
    // A parameter description is read in isolation, at the moment the agent is
    // choosing what to put in that field — which is exactly where a refused path
    // gets guessed shallower instead of minted. Softening this one to "the
    // registry tool" leaves the tool description technically compliant while
    // deleting the pointer at the point of use.
    expect(props()["domain"]["description"]).toContain("sil_domain_create");
  });

  it("the `domain` description forbids guessing a shallower path around the refusal", () => {
    // The permanent-damage move: two nodes for one category, split forever.
    expect((props()["domain"]["description"] as string).toLowerCase()).toMatch(
      /shallower|guessing|route around|near-path/,
    );
  });

  it("never reports the refusal as sil having nothing, and never as a retry", () => {
    const d = description().toLowerCase();
    expect(d).not.toMatch(/sil has no products|nothing (was )?found|no results exist/);
    expect(d).not.toMatch(/try again|retry the search/);
  });

  it("carries the ≤4-calls / widen-soft-only / never-relax-a-hard-row discipline", () => {
    const d = description();
    expect(d).toMatch(/\b4\b|\bfour\b/);
    expect(d).toMatch(/widen/i);
    expect(d.toLowerCase()).toMatch(/hard (requirement|row)[^.]*never relaxed|never relax/);
  });

  it("tells the agent to present in the order returned and not to re-rank", () => {
    expect(description()).toMatch(/order returned/i);
    expect(description()).toMatch(/re-?rank/i);
  });

  it("names the three veto inputs so the agent can compute it", () => {
    const d = description();
    expect(d).toContain("unset");
    expect(d).toContain("applied");
    expect(d).toContain("maturity");
  });

  it("names both maturities and says a `web` result's values are honestly unset", () => {
    const d = description();
    expect(d).toContain("catalog");
    expect(d).toContain("web");
  });

  it("scopes the trigger to sil's catalog in ONE registry domain", () => {
    expect(description()).toMatch(/one (registry )?domain|a single (registry )?domain/i);
  });
});

describe("before the network: the not-registered gate", () => {
  it("with no stored tokens the tool is terminal `not_registered` and calls NO fetch", async () => {
    const result = await getTool(api, TOOL).execute("call-1", {
      domain: "product.sports.winter.ski.boots",
      query: "stiff boots",
      n: 5,
    });
    const payload = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    expect(payload["status"]).toBe("not_registered");
    expect(payload["recovery"]).toBe("sil_register");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the not-registered envelope is not framed as retryable", async () => {
    const result = await getTool(api, TOOL).execute("call-2", {
      domain: "product.x",
      query: "q",
      n: 1,
    });
    const payload = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    expect(payload["status"]).not.toBe("retryable");
  });
});
