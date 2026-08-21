/**
 * UNIT — `sil_domain_find`'s agent-facing surface (tier: unit — mock api, temp
 * data dir, `fetch` spied).
 *
 * THE READ IS WHAT MAKES THE MINT SAFE, so this tool's surface carries an unusual
 * weight: it is the only door through which an agent can learn that a category
 * already stands before it performs v0's ONE permanent, un-undoable global write.
 * Three properties of the surface decide whether that works, and all three are
 * pinned here:
 *
 *   - THE QUERYSTRING IS THE CONTRACT. `?q=` and `?path=` are different
 *     questions, exactly one per call, and an EMITTED `q=` is a different request
 *     from an OMITTED `q` (the route answers "`q` must not be shorter than 1
 *     character" for the first and "you sent neither" for the second). So the URL
 *     must carry only the keys actually present, and it must be built with
 *     `URLSearchParams` — a string-concatenated value could inject a second
 *     parameter and turn a discovery read into a probe of the attacker's path.
 *
 *   - `q` CARRIES PROSE, NOT A PATH. The route matches `q` against each domain's
 *     path text AND its guide, which is the only way a buyer's ask reaches
 *     `product.sports.winter.ski.boots`. A `q` that inherited the path pattern
 *     would be refused BY THE HOST — "ski boots" has a space — and the discovery
 *     door would be silently dead while every other test stayed green.
 *
 *   - NOTHING IS REFUSED LOCALLY. The route names the offending parameter in its
 *     own message; a second validator here would only be a surface to drift, and
 *     it would fire exclusively on the agent-error path where the route's named
 *     message beats a synthesized one. Both/neither go on the wire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../../tools/catalog.js";
import { setApiUrl, setWebUrl, getApiUrl } from "../../lib/config.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "../helpers/mock-plugin-api.js";
import {
  honestyExclusionOffenders,
  overPromiseOffenders,
  overTriggerOffenders,
} from "../helpers/honesty-vocabulary.js";
import { domainFindGolden } from "../helpers/v0-wire.js";

const TOOL = "sil_domain_find";
const API = "https://sil-api.test.example.com";

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;

/** The spied global, typed — `.mock.calls[n][0]` is the URL the tool built. */
const fetchSpy = (): ReturnType<typeof vi.mocked<typeof globalThis.fetch>> =>
  vi.mocked(globalThis.fetch);

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-find-unit-"));
  priorDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setApiUrl(API);
  setWebUrl("https://sil-web.test.example.com");
  vi.spyOn(globalThis, "fetch");
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

/** Seed a token pair so the tool proceeds past the not-registered gate. */
function seedTokens(): void {
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(getTokensPath(), JSON.stringify({ access_token: "at", refresh_token: "rt" }), {
    mode: 0o600,
  });
}

/** Answer every call with one 200, so the tool reaches the wire and stops. */
function answerOk(body: unknown = domainFindGolden()): void {
  fetchSpy().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

/** The URL of the nth outbound request, as the tool built it. */
function urlOf(nth = 0): URL {
  const raw = fetchSpy().mock.calls[nth]?.[0];
  if (raw === undefined) throw new Error(`no request at index ${nth}`);
  return new URL(String(raw));
}

/** Run the tool and hand back the URL it called. */
async function callWith(params: Record<string, unknown>): Promise<URL> {
  seedTokens();
  answerOk();
  await getTool(api, TOOL).execute("call-1", params);
  return urlOf();
}

describe("registration and schema", () => {
  it("registers `sil_domain_find` with a description and an object schema", () => {
    expect(getTool(api, TOOL).name).toBe(TOOL);
    expect(description().length).toBeGreaterThan(0);
    expect(getTool(api, TOOL).label ?? "").not.toBe("");
    expect(schema()["type"]).toBe("object");
  });

  it("declares exactly `{ q, path }`, and NEITHER is required", () => {
    // Both optional is what lets the ROUTE own the both/neither refusal. Making
    // either required would move that refusal into the host, which answers with
    // a schema pointer that names no parameter.
    expect(Object.keys(props()).sort()).toEqual(["path", "q"]);
    expect(schema()).not.toHaveProperty("required");
  });

  it("`q` is a 1–200 string — the bound the route's own matcher is costed at", () => {
    expect(props()["q"]["type"]).toBe("string");
    expect(props()["q"]["minLength"]).toBe(1);
    expect(props()["q"]["maxLength"]).toBe(200);
  });

  it("`q` carries NO pattern — a buyer's ask is prose, and prose has spaces", () => {
    // The trap this forecloses: copying `path`'s registry pattern onto `q` makes
    // the host refuse "ski boots" before the route is reached. The discovery
    // door would be dead while every other assertion on this surface stayed
    // green — and discovery is the only mode that can license a mint.
    expect(props()["q"]).not.toHaveProperty("pattern");
    expect(props()["q"]).not.toHaveProperty("enum");
  });

  it("`path` carries the same registry pattern `sil_search`'s `domain` does", () => {
    const searchDomain = (
      (getTool(api, "sil_search").parameters as unknown as Record<string, unknown>)[
        "properties"
      ] as Record<string, Record<string, unknown>>
    )["domain"];
    // One pattern, three tools. A probe whose grammar differs from search's lets
    // an agent probe a path it can then never search — and the route's `::ltree`
    // cast is only unreachable-by-construction because the pattern holds.
    expect(props()["path"]["pattern"]).toBe(searchDomain["pattern"]);
    expect(props()["path"]["maxLength"]).toBe(255);
  });

  it("declares NO knob the route refuses — no limit, no cursor, no validated filter", () => {
    // `GET /catalog/domains` refuses `limit` / `after` / `validated` BY NAME
    // rather than ignoring them. A knob declared here that the route rejects
    // reads to the agent as a capability, and every call using it 400s.
    const declared = Object.keys(props());
    const refused = ["limit", "after", "validated", "cursor", "n", "k", "top_k", "page"];
    expect(declared.filter((p) => refused.includes(p))).toEqual([]);
  });

  it("every parameter carries a non-empty description", () => {
    const missing = Object.entries(props())
      .filter(([, p]) => ((p["description"] as string | undefined) ?? "").trim().length === 0)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});

describe("the clauses the description must carry", () => {
  it("states that exactly ONE of `q` or `path` travels per call", () => {
    const d = description();
    expect(d).toMatch(/exactly one of|one of .*(q|path).*(q|path)|never both/i);
    expect(d).toContain("q");
    expect(d).toContain("path");
  });

  it("says `q` carries the buyer's OWN WORDS, not a path guess", () => {
    // The whole reason the discovery mode exists: `q` is matched against a
    // domain's guide as well as its path text, so a path-shaped guess misses
    // exactly the domains the read was built to surface.
    const d = description().toLowerCase();
    expect(d).toMatch(/own words|buyer'?s? (own )?(words|ask)|what the buyer asked/);
  });

  it("says an EMPTY `matches` is what licenses the mint, and names the mint tool", () => {
    const d = description();
    expect(d).toMatch(/matches/);
    expect(d).toMatch(/\[\]|empty|nothing/i);
    expect(d).toContain("sil_domain_create");
  });

  it("says `exists` is STATED — never inferred from a guide or a vocabulary", () => {
    const d = description();
    expect(d).toMatch(/exists/);
    expect(d.toLowerCase()).toMatch(/stated|never infer|not inferred|do not infer|read it/);
  });

  it("says what `capped` means — the answer was bounded, so the mint is NOT licensed", () => {
    // Dropping this one clause alone re-creates the exact defect the route
    // exists to prevent: minting while the standing path sat just past the bound.
    const d = description();
    expect(d).toMatch(/capped/);
    expect(d.toLowerCase()).toMatch(/narrow|again|more|past the|not complete/);
  });

  it("does not claim a general capability — a tool named `_find` is the one at risk", () => {
    // `/\bfind\s+any(?:thing)?\b/` is a banned over-trigger and this tool is
    // literally named `sil_domain_find`.
    expect(overTriggerOffenders(description())).toEqual([]);
  });

  it("out-promises nothing and frames no honesty field as an exclusion", () => {
    // A fenced domain (`validated_at: null`) is RETURNED and adopted like any
    // other; prose that reads as "skip the unvalidated ones" would undo the
    // route's own decision one layer up.
    expect(overPromiseOffenders(description())).toEqual([]);
    expect(honestyExclusionOffenders(description())).toEqual([]);
  });

  it("guard-of-the-guard: the description is substantial enough for the scans above", () => {
    expect(description().trim().length).toBeGreaterThan(200);
  });
});

describe("before the network", () => {
  it("with no stored tokens the tool is terminal `not_registered` and calls NO fetch", async () => {
    const result = await getTool(api, TOOL).execute("call-1", { q: "ski boots" });
    const payload = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    expect(payload["status"]).toBe("not_registered");
    expect(payload["recovery"]).toBe("sil_register");
    expect(fetchSpy()).not.toHaveBeenCalled();
  });

  it("the unauthenticated refusal carries NO empty match list the agent could act on", async () => {
    // A `matches: []` on a failure would license a mint off a call that never
    // reached the registry — BR-2's shape, at the tool boundary.
    const result = await getTool(api, TOOL).execute("call-2", { q: "ski boots" });
    const payload = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("matches");
    expect(payload).not.toHaveProperty("capped");
  });
});

describe("the querystring is the contract", () => {
  it("`q` alone emits exactly `?q=<value>` and NO `path` key", async () => {
    const url = await callWith({ q: "ski boots" });
    expect(url.origin + url.pathname).toBe(`${getApiUrl()}/catalog/domains`);
    expect([...url.searchParams.keys()]).toEqual(["q"]);
    expect(url.searchParams.get("q")).toBe("ski boots");
    expect(url.searchParams.has("path")).toBe(false);
  });

  it("`path` alone emits exactly `?path=<value>` and NO `q` key", async () => {
    const url = await callWith({ path: "product.sports.winter.ski.boots" });
    expect([...url.searchParams.keys()]).toEqual(["path"]);
    expect(url.searchParams.get("path")).toBe("product.sports.winter.ski.boots");
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("NEITHER emits NO query parameters at all — an empty `q=` is a different request", async () => {
    // The route answers "`q` must not be shorter than 1 character" for `?q=` and
    // "you sent neither" for no parameters. Both are 400s, and they are the
    // agent's whole recourse — a plugin that emitted `q=` would trade the one
    // message that diagnoses the real mistake for one that diagnoses a
    // fabricated one.
    const url = await callWith({});
    expect([...url.searchParams.keys()]).toEqual([]);
    expect(url.search).toBe("");
  });

  it("BOTH are forwarded — the plugin refuses nothing locally", async () => {
    // The route's 400 names the offender ("you sent both"); a local refusal would
    // have to invent its own message, which would then differ from the route's.
    const url = await callWith({ q: "ski boots", path: "product.sports.winter.ski.boots" });
    expect([...url.searchParams.keys()].sort()).toEqual(["path", "q"]);
    expect(url.searchParams.get("q")).toBe("ski boots");
    expect(url.searchParams.get("path")).toBe("product.sports.winter.ski.boots");
  });

  it("the value is URL-ENCODED, never concatenated", async () => {
    const url = await callWith({ q: "50/50 boots & poles, 130 flex?" });
    expect(url.searchParams.get("q")).toBe("50/50 boots & poles, 130 flex?");
    expect([...url.searchParams.keys()]).toEqual(["q"]);
  });

  it("a `q` that LOOKS like a second parameter cannot become one", async () => {
    // The concatenation trap, stated as an attack: `&path=` inside the ask must
    // arrive as part of the ask, never as a probe of somebody else's path — a
    // probe answers a different question and can never license a mint.
    const url = await callWith({ q: "boots&path=product.evil.node" });
    expect([...url.searchParams.keys()]).toEqual(["q"]);
    expect(url.searchParams.get("q")).toBe("boots&path=product.evil.node");
    expect(url.searchParams.has("path")).toBe(false);
  });

  it("an empty-string `q` is forwarded AS an empty `q=` — the plugin drops no key it was given", async () => {
    // The host's `minLength: 1` makes this unreachable in production, which is
    // exactly why it is asserted: the plugin must not start filling or dropping
    // keys on its own account, because a dropped key silently converts one
    // route message into another.
    const url = await callWith({ q: "" });
    expect([...url.searchParams.keys()]).toEqual(["q"]);
    expect(url.searchParams.get("q")).toBe("");
    expect(url.search).toBe("?q=");
  });

  it("calls the BARE path on the sil-api origin — no `/api/v1`, no trailing slash", async () => {
    const url = await callWith({ q: "ski boots" });
    expect(url.pathname).toBe("/catalog/domains");
    expect(url.toString()).not.toContain("/api/v1");
    expect(url.origin).toBe(API);
  });

  it("issues exactly ONE request per call", async () => {
    await callWith({ q: "ski boots" });
    expect(fetchSpy()).toHaveBeenCalledTimes(1);
  });
});
