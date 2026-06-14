/**
 * UNIT — sil_product_get tool: registration shape + the client-side non-empty-ids
 * guard + the not-registered short-circuit + the token-log canary (tier: unit,
 * mock api + temp data dir, `fetch` spied so nothing reaches the network).
 *
 * Covers the unit-tier acceptance criteria that live at the TOOL boundary (the
 * request-mapping + classifier pure pieces are pinned in `lib/lookup-client.test.ts`
 * and `lib/lookup-classify.test.ts`; the full wired pipeline + the unfound-is-success
 * + three-distinct-failures taxonomy are the integration tier's job in
 * `catalog-lookup.integration.test.ts`). Here we assert:
 *
 *   - the tool-registration shape (a `sil_product_get` tool whose parameters are a
 *     TypeBox object with an `ids` array of strings);
 *   - the CLIENT-SIDE non-empty-ids guard the tool owns: a request with an empty
 *     `ids` array (or no `ids`) returns a structured validation error naming the
 *     missing input and makes ZERO network calls (sil-api's `minItems:1` schema 400
 *     is the authoritative backstop, but the cheap client guard saves the
 *     round-trip);
 *   - the not-registered short-circuit: no tokens.json → terminal `not_registered`
 *     (recovery `sil_register`), ZERO network (mirrors sil_search / sil_whoami);
 *   - the token-log canary: on every path the stored token never appears in any
 *     logger call at any level.
 *
 * Hermetic via the `SIL_DATA_DIR` temp-dir override and the config-reset machinery
 * mirrored from the sil_search unit test.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - src/tools/catalog.ts#registerCatalogTools(api) ALSO registers a
 *     `sil_product_get` tool whose parameters are a Type.Object with an `ids`
 *     Type.Array(Type.String());
 *   - execute() returns a jsonResult; with an empty (or missing) `ids` it returns a
 *     structured validation error and calls no fetch; with no tokens.json it returns
 *     a terminal not_registered hint and calls no fetch.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../../tools/catalog.js";
import { setWebUrl, setApiUrl } from "../../lib/config.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const TOOL = "sil_product_get";

let dataDir: string;
let priorSilDataDir: string | undefined;

/** Parse a ToolResult's JSON payload. */
function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`tool result has no text payload: ${String(text)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Seed a valid token pair so the lookup proceeds past the not-registered guard. */
function seedTokens(access = "stored-at", refresh = "stored-rt"): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: access, refresh_token: refresh }),
    { mode: 0o600 },
  );
}

/** A 200 real lookup envelope (one product whose featured variant carries the
 * required `inputs`), so a forwarded request resolves cleanly to `ok`. The FLAT
 * sil-api shape (`{ ucp, products }` — top level, no `result` wrapper;
 * `withUcpMeta(body)`), the only shape sil-api emits. */
function okEnvelopeFetch(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        ucp: { version: "0.1", status: "success" },
        products: [
          {
            id: "gid://product/a",
            title: "Aeron Chair",
            description: { plain: "An ergonomic office chair." },
            price_range: { min: { amount: 159900, currency: "USD" }, max: { amount: 159900, currency: "USD" } },
            source: "herman-miller",
            variants: [
              {
                id: "gid://variant/a1",
                title: "Aeron Chair — Graphite, Size B",
                price: { amount: 159900, currency: "USD" },
                availability: { available: true, status: "in_stock" },
                checkout_url: "https://buy.example.com/aeron-a1",
                inputs: [{ id: "gid://product/a", match: "featured" }],
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

/** Collect every argument to every logger level, serialized. */
function logBlob(api: MockPluginAPI): string {
  return [api.logger.info, api.logger.warn, api.logger.error, api.logger.debug]
    .flatMap((fn) => vi.mocked(fn).mock.calls.map((c) => JSON.stringify(c)))
    .join("\n");
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-product-get-unit-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("sil_product_get — tool registration shape", () => {
  it("registers a sil_product_get tool with a typed `ids` array-of-strings param", () => {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    expect(tool.label.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
    // A TypeBox object whose `ids` property is an array of strings.
    expect((tool.parameters as { type?: unknown }).type).toBe("object");
    const props = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toContain("ids");
    const ids = props["ids"] as { type?: unknown; items?: { type?: unknown } };
    expect(ids.type).toBe("array");
    expect(ids.items?.type).toBe("string");
  });

  it("is registered ALONGSIDE sil_search in the same catalog group (both present)", () => {
    // The card's reuse constraint: sil_product_get is a SECOND call inside
    // registerCatalogTools — registering it must not displace sil_search.
    const api = createMockPluginApi();
    registerCatalogTools(api);
    expect(() => getTool(api, "sil_search")).not.toThrow();
    expect(() => getTool(api, TOOL)).not.toThrow();
  });
});

describe("sil_product_get — client-side non-empty-ids guard (reject empty BEFORE any network)", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A token IS present (so the guard, not the not-registered path, is what
    // rejects); fetch fails loudly if the guard lets an empty request through.
    seedTokens();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("empty ids must not hit the network"));
    api = createMockPluginApi();
    registerCatalogTools(api);
  });

  it("an empty ids array → structured validation error naming the missing input, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: [] }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).not.toBe("ok");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/id/);
    expect(blob).toMatch(/status|error|invalid/);
  });

  it("a missing ids key → validation error, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).not.toBe("ok");
    expect(JSON.stringify(payload).toLowerCase()).toMatch(/id/);
  });

  it("the validation error is NOT a re-register hint (auth is fine; the input is the problem)", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { ids: [] }));
    expect(payload["recovery"]).not.toBe("sil_register");
  });
});

describe("sil_product_get — a non-empty ids request PROCEEDS to the network", () => {
  it("a request with one id reaches the network (the guard does not over-reject)", async () => {
    seedTokens();
    const fetchSpy = okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload["status"]).toBe("ok");
  });
});

describe("sil_product_get — not registered (no tokens.json) short-circuit", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // No tokens seeded. fetch fails loudly if the tool calls it.
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("not-registered must not hit the network"));
    api = createMockPluginApi();
    registerCatalogTools(api);
  });

  it("makes NO sil-api call and names sil_register as the recovery", async () => {
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).not.toBe("ok");
    // No products field so the agent can't mistake it for an all-missed success.
    expect(payload["products"]).toBeUndefined();
    expect(JSON.stringify(payload)).toContain("sil_register");
  });

  it("does NOT crash and resolves promptly when not registered", async () => {
    const result = await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] });
    expect(result).toBeTypeOf("object");
    expect(result.content[0]?.text).toBeTypeOf("string");
  });
});

describe("sil_product_get — token never logged (leak-canary)", () => {
  it("on the SUCCESS path, no logger call carries the access token", async () => {
    seedTokens("leak-canary-access", "leak-canary-refresh");
    okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] });

    const blob = logBlob(api);
    expect(blob).not.toContain("leak-canary-access");
    expect(blob).not.toContain("leak-canary-refresh");
    expect(blob).not.toMatch(/Bearer/i);
  });

  it("on a 401 (non-success) path, no logger call carries the access token", async () => {
    seedTokens("leak-canary-access-2", "leak-canary-refresh-2");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] });

    const blob = logBlob(api);
    expect(blob).not.toContain("leak-canary-access-2");
    expect(blob).not.toContain("leak-canary-refresh-2");
    expect(blob).not.toMatch(/Bearer/i);
  });

  it("the success result does NOT echo the access token or Authorization header", async () => {
    seedTokens("secret-access-token", "secret-refresh-token");
    okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const blob = JSON.stringify(
      payloadOf(await getTool(api, TOOL).execute("c1", { ids: ["gid://product/a"] })),
    );
    expect(blob).not.toContain("secret-access-token");
    expect(blob).not.toContain("secret-refresh-token");
    expect(blob).not.toMatch(/Bearer/i);
    expect(blob).not.toMatch(/authorization/i);
  });
});

/**
 * CARD `surface-product-url-and-specs-in-catalog-tools` (epic
 * `catalog-product-contract-2026-06`) — the RED unit ceiling for the
 * `sil_product_get` tool DESCRIPTION (AC[unit] #3, the consistency property). The
 * two catalog tools must present ONE vocabulary to the agent: `sil_product_get`
 * carries the SAME view (`url`) / dig-in (`seller.links`) / buy (`checkout_url`)
 * distinction `sil_search` teaches — so an agent learns one catalog vocabulary and
 * carries an item from a search result into a lookup without the field meanings
 * shifting. A divergent description (one tool teaches the verbs, the other does not)
 * is a defect: the agent would mis-fire on the tool whose description stayed lean.
 *
 * EXPECT RED today: the current `sil_product_get` description (catalog.ts ~line 388)
 * names "description plus its featured purchasable variant (id, title, price,
 * availability, checkout_url, options)" — it carries no `url` (view) and no
 * `seller.links` (dig-in), and never contrasts `url` with `checkout_url`. Asserted
 * against the registered `.description` string, the same surface the agent reads and
 * the same pattern the existing description tests use.
 */
describe("sil_product_get — description carries the SAME view (url) / dig-in (seller.links) / buy (checkout_url) vocabulary as sil_search [card surface-product-url]", () => {
  function description(): string {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    return getTool(api, TOOL).description;
  }

  it("names product/variant `url` as the VIEW / learn-more action — opening the PAGE, NOT buying", () => {
    const d = description();
    expect(d).toMatch(/\burl\b/);
    const dl = d.toLowerCase();
    expect(dl).toMatch(/view|open the page|learn more|page to|product page|see (the|more)/);
  });

  it("names `seller.links` (or seller policy links) as the DIG-IN action — following seller policies / info", () => {
    const d = description();
    expect(d).toMatch(/seller\.links|seller[^.]*links|links[^.]*seller/i);
    const dl = d.toLowerCase();
    expect(dl).toMatch(/polic|seller info|return|refund|shipping|terms/);
  });

  it("keeps `checkout_url` distinct as the BUY action — the variant permalink that commits a purchase", () => {
    const d = description();
    expect(d).toMatch(/checkout_url/);
    const dl = d.toLowerCase();
    expect(dl).toMatch(/buy|purchase|acquire|checkout/);
  });

  it("states that a variant's `url` and its `checkout_url` are DIFFERENT targets (view the page vs commit the purchase)", () => {
    // The same headline distinction sil_search pins — pinned here too so the two
    // tools do NOT present divergent field vocabularies to the agent.
    const d = description();
    expect(d).toMatch(/\burl\b/);
    expect(d).toMatch(/checkout_url/);
    const dl = d.toLowerCase();
    expect(dl).toMatch(
      /url[^.]*not[^.]*checkout_url|checkout_url[^.]*not[^.]*url|differ|distinct|whereas|rather than|view[^.]*(buy|purchase|checkout)|(buy|purchase)[^.]*(view|page|learn)/,
    );
  });
});
