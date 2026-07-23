/**
 * INTEGRATION — `sil.search_results`, the whole seam (tier: integration).
 *
 * The REAL plugin entry: `register()` wires the tool groups AND the gateway
 * method, `sil_search` runs through the real sil-client against a mocked `fetch`
 * (the host/network boundary — the only thing doubled), the page lands in the
 * real store, and the real handler answers a real `respond`. Nothing about the
 * delivery leg is stubbed.
 *
 * WHY A NEW FILE AND NOT `catalog-search.integration.test.ts`. That file's 3325
 * lines assert an envelope this card does not change; it is NOT re-pointed, added
 * to, or trimmed. A red over there is a regression in the unchanged path, and the
 * whole point of the additive re-scope is that its assertions still stand.
 *
 * WHAT IS LOAD-BEARING HERE. The FIRST describe block. `sil_search`'s tool result
 * must be byte-identical with and without this card's machinery in play, because
 * that single property is what keeps Telegram, WhatsApp and a plain CLI
 * untouched. Everything below it is the new pull surface; that block is the
 * promise to every channel that is not Studio.
 *
 * Criteria: A1, A2, A4, A5 (the envelope + what gets stored), B1, B2, B3 (the
 * resolve), C1–C4 + C7 (the uniform, non-leaky failure), D3 (many searches in one
 * run), F1 (a >12 KB page round-tripping byte-identically over a leg with no
 * model surface at all).
 *
 * THESE ASSERTIONS ARE THE SPEC. Never loosen an exact set, and never relax the
 * byte-identity comparisons — they are the contract two siblings meet at.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, rmSync as rmFile } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI } from "openclaw/plugin-sdk";

import { registerCatalogTools } from "../tools/catalog.js";
import { setWebUrl, setApiUrl } from "../lib/config.js";
import { getDataDir, getTokensPath } from "../lib/credentials.js";
import {
  RETENTION_MS,
  MAX_ENTRIES,
  getSearchResult,
  __resetSearchResultsStore,
} from "../lib/search-results-store.js";
import {
  createMockPluginApi,
  getTool,
  getGatewayMethod,
  registeredGatewayMethodNames,
  callGatewayMethod,
  type GatewayResponseFrame,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

const TOOL = "sil_search";
const METHOD = "sil.search_results";
const SIL_WEB = "https://sil-web.test.example.com";
const SIL_API = "https://sil-api.test.example.com";
const ACCOUNT_A = "user-a";
const ACCOUNT_B = "user-b";

let capturedRegisterFn: ((api: PluginAPI) => void) | null = null;

// Stub ONLY the ambient SDK entry shim — the OpenClaw runtime provides it and it
// is unresolvable outside a host. Everything else runs for real.
vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: vi.fn((entry: { register: (api: PluginAPI) => void }) => {
    capturedRegisterFn = entry.register;
    return entry;
  }),
}));

beforeAll(async () => {
  await import("../index.js");
});

// ---------------------------------------------------------------------------
// Fixtures — the REAL sil-api wire shape
// ---------------------------------------------------------------------------

/** One real `SilCatalogProduct`: a required `source`, and a variant with a
 * non-empty `checkout_url` + an `availability` object. Anti-false-green — a
 * `{stub:true}` echo carries none of these, so nothing here can pass against a
 * placeholder. */
function wireProduct(n: number): Record<string, unknown> {
  return {
    id: `gid://product/${n}`,
    title: `Ergonomic Task Chair ${n}`,
    description: { plain: `A height-adjustable task chair, model ${n}.` },
    price_range: {
      min: { amount: 100_000 + n, currency: "USD" },
      max: { amount: 200_000 + n, currency: "USD" },
    },
    variants: [
      {
        id: `gid://variant/${n}-1`,
        title: `Ergonomic Task Chair ${n} — Graphite`,
        description: { plain: `A height-adjustable task chair, model ${n}.` },
        price: { amount: 100_000 + n, currency: "USD" },
        availability: { available: true, status: "in_stock" },
        checkout_url: `https://buy.example.com/chair-${n}`,
      },
    ],
    source: `merchant-${n % 7}`,
  };
}

function searchEnvelope(
  products: unknown[],
  pagination: unknown = { has_next_page: false },
): unknown {
  return { products, pagination };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let dataDir: string;
let priorSilDataDir: string | undefined;

interface Recorded {
  url: string;
  method: string;
}

type Reply = { status: number; body: unknown } | "network-error";

/** URL-routing fetch double, cloned from the catalog-search suite's convention.
 * Records every outbound request so "the resolve leg makes NO network call" is
 * assertable by COUNT, not by hope. */
function installRouter(
  reply: (kind: "search" | "refresh" | "other", nthOfKind: number) => Reply,
): { all: Recorded[]; search: Recorded[] } {
  const all: Recorded[] = [];
  const search: Recorded[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const req: Recorded = { url, method: (init?.method ?? "GET").toUpperCase() };
      all.push(req);

      let kind: "search" | "refresh" | "other";
      if (url.includes("/auth/refresh")) kind = "refresh";
      else if (url.includes("/catalog/search")) kind = "search";
      else kind = "other";

      let nthOfKind = all.length - 1;
      if (kind === "search") {
        search.push(req);
        nthOfKind = search.length - 1;
      }

      const r = reply(kind, nthOfKind);
      if (r === "network-error") return Promise.reject(new Error("simulated network failure"));
      return Promise.resolve(
        new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  );

  return { all, search };
}

/** The raw JSON text of a tool result — the BYTES the channel carries. */
function rawOf(result: { content: { text?: string }[] }): string {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("no tool payload");
  return text;
}

function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  return JSON.parse(rawOf(result)) as Record<string, unknown>;
}

function seedTokens(access = "stored-at", refresh = "stored-rt"): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getTokensPath(), JSON.stringify({ access_token: access, refresh_token: refresh }), {
    mode: 0o600,
  });
}

function seedAccount(id: string): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ user: { id, name: `User ${id}` } }), {
    mode: 0o600,
  });
}

/** A fully registered plugin: real tool groups AND the real gateway method. */
function registerPlugin(): MockPluginAPI {
  const api = createMockPluginApi();
  capturedRegisterFn!(api);
  return api;
}

/** The single response frame a well-behaved handler emits. Asserting the COUNT
 * is what catches a handler that responds never (a client hung forever) or twice
 * (a protocol violation) — never assert only the last frame. */
function soleFrame(frames: GatewayResponseFrame[]): GatewayResponseFrame {
  expect(frames).toHaveLength(1);
  return frames[0]!;
}

function bodyOf(frames: GatewayResponseFrame[]): Record<string, unknown> {
  const frame = soleFrame(frames);
  // Every outcome rides a SUCCESSFUL response carrying a structured body;
  // `ok:false` is used for nothing, because a client reads a method-level error
  // as a retryable transport fault and none of these are retryable.
  expect(frame.ok).toBe(true);
  return frame.payload as Record<string, unknown>;
}

function logBlob(api: MockPluginAPI): string {
  return [api.logger.info, api.logger.warn, api.logger.error, api.logger.debug]
    .flatMap((fn) => vi.mocked(fn).mock.calls.map((c) => JSON.stringify(c)))
    .join("\n");
}

/**
 * Nothing was buffered under `callId` — asserted THREE ways, because the
 * client-visible one alone is not enough.
 *
 * The handler fails closed on a throw (correctly — an opaque gateway error would
 * leave a shopper's item spinning forever). That catch also MASKS a defect: a
 * page stored from a non-`ok` outcome has no `products`, so the handler throws
 * reading `products.length` and answers the uniform not-found — the exact body a
 * clean miss produces. A wire-only assertion therefore passes against an
 * implementation that stores every outcome. So we also read the store directly,
 * and demand the miss was a genuine `unknown` rather than a swallowed failure.
 */
async function expectNothingStored(
  api: MockPluginAPI,
  callId: string,
  principal: string = ACCOUNT_A,
): Promise<void> {
  expect(getSearchResult(callId, principal)).toBeNull();

  vi.mocked(api.logger.info).mockClear();
  vi.mocked(api.logger.error).mockClear();
  const body = bodyOf(await callGatewayMethod(api, METHOD, { callId }));
  expect(body["status"]).toBe("not_found");

  const blob = logBlob(api);
  expect(blob).toContain("unknown");
  expect(blob).not.toContain("sil_search_results_failed");
  expect(blob).not.toContain("sil_search_results_hit");
}

/** Run one `ok` search and hand back everything the assertions need. */
async function runSearch(
  api: MockPluginAPI,
  callId: string,
  products: unknown[],
  params: Record<string, unknown> = { query: "office chair" },
): Promise<{ raw: string; payload: Record<string, unknown> }> {
  const result = await getTool(api, TOOL).execute(callId, params);
  return { raw: rawOf(result), payload: payloadOf(result) };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-searchres-int-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl(SIL_WEB);
  setApiUrl(SIL_API);
  __resetSearchResultsStore();
  seedTokens();
  seedAccount(ACCOUNT_A);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  __resetSearchResultsStore();
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

// ===========================================================================
// A1 — THE LOAD-BEARING GUARD: the envelope every channel gets is UNCHANGED
// ===========================================================================

describe("A1 — the sil_search envelope is byte-identical, with or without this card", () => {
  it("returns the SAME BYTES whether or not the gateway method is registered", () => {
    // The whole promise of the additive re-scope. A plugin whose tool result
    // changes shape when a client happens to be able to pull it is not
    // channel-agnostic — Telegram, WhatsApp and a plain CLI must not be able to
    // tell this card shipped.
    return (async () => {
      installRouter((kind) =>
        kind === "search"
          ? { status: 200, body: searchEnvelope([wireProduct(1), wireProduct(2)]) }
          : { status: 500, body: {} },
      );

      // WITH — the full real register(): tools + `sil.search_results`.
      const withMethod = registerPlugin();
      expect(registeredGatewayMethodNames(withMethod).has(METHOD)).toBe(true);
      const a = await runSearch(withMethod, "call_with", []);

      // WITHOUT — only the tool group, exactly the surface a host that never
      // reaches the gateway registration path presents.
      const withoutMethod = createMockPluginApi();
      registerCatalogTools(withoutMethod);
      expect(registeredGatewayMethodNames(withoutMethod).size).toBe(0);
      const b = await runSearch(withoutMethod, "call_without", []);

      expect(a.raw).toBe(b.raw);
    })();
  });

  it("carries the FULL products body — no result_ref, no reference, no digest", () => {
    // The mutation this kills is the ORIGINAL (superseded) premise: replacing the
    // body with a reference. The agent still receives every product, so nothing
    // about what it can truthfully say changes.
    return (async () => {
      installRouter((kind) =>
        kind === "search"
          ? { status: 200, body: searchEnvelope([wireProduct(1), wireProduct(2), wireProduct(3)]) }
          : { status: 500, body: {} },
      );
      const api = registerPlugin();
      const { payload, raw } = await runSearch(api, "call_1", []);

      expect(payload["status"]).toBe("ok");
      const products = payload["products"] as Record<string, unknown>[];
      expect(products).toHaveLength(3);
      // Real projected products, not placeholders.
      expect(products[0]!["id"]).toBe("gid://product/1");
      expect((products[0]!["variant"] as Record<string, unknown>)["checkout_url"]).toBe(
        "https://buy.example.com/chair-1",
      );
      // Nothing was ADDED to the envelope.
      expect(payload).not.toHaveProperty("result_ref");
      expect(payload).not.toHaveProperty("callId");
      expect(payload).not.toHaveProperty("call_id");
      expect(payload).not.toHaveProperty("expires_at");
      expect(raw).not.toContain("result_ref");
    })();
  });

  it("the envelope's top-level key set is exactly what the outcome carries — nothing extra", () => {
    return (async () => {
      installRouter((kind) =>
        kind === "search"
          ? { status: 200, body: searchEnvelope([wireProduct(1)], { has_next_page: false }) }
          : { status: 500, body: {} },
      );
      const api = registerPlugin();
      const { payload } = await runSearch(api, "call_1", []);

      // `advisories` rides host-wiring drift and is outside this card's control,
      // so it is tolerated — but no OTHER key may appear.
      const allowed = new Set(["status", "products", "cursor", "specs_status", "advisories"]);
      for (const key of Object.keys(payload)) {
        expect(allowed.has(key)).toBe(true);
      }
    })();
  });

  it("the bytes do not drift as the store fills — the side effect never leaks into the return", () => {
    // A store write that mutated the page it was handed (or that returned
    // something the envelope then folded in) would show up as a byte difference
    // between the first search of a session and a later identical one.
    return (async () => {
      installRouter((kind) =>
        kind === "search"
          ? { status: 200, body: searchEnvelope([wireProduct(1), wireProduct(2)]) }
          : { status: 500, body: {} },
      );
      const api = registerPlugin();

      const first = await runSearch(api, "call_first", []);
      for (let i = 0; i < MAX_ENTRIES + 5; i += 1) {
        await runSearch(api, `call_fill_${i}`, []);
      }
      const later = await runSearch(api, "call_later", []);

      expect(later.raw).toBe(first.raw);
    })();
  });
});

// ===========================================================================
// A2 / A4 / A5 — what gets stored, and what does not
// ===========================================================================

describe("what the ok path stores (A2, A4, A5)", () => {
  it("stores EXACTLY the page — the envelope minus `advisories` — under the host callId", async () => {
    // Host-misconfiguration guidance is operator/agent copy, not product data; a
    // client rendering a grid must never receive it. The comparison is on BYTES,
    // so a reordered or re-wrapped page fails too.
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([wireProduct(1), wireProduct(2)]) }
        : { status: 500, body: {} },
    );
    // A drifting host config so `wiringAdvisories` actually folds something on —
    // otherwise this assertion is vacuous.
    const api = createMockPluginApi({
      config: { agents: { list: [{ id: "shopper", skills: ["sil"] }] } },
    });
    capturedRegisterFn!(api);

    const { payload } = await runSearch(api, "call_1", []);
    expect(payload).toHaveProperty("advisories"); // premise of this test

    const body = bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_1" }));
    expect(body).not.toHaveProperty("advisories");

    const expected = { ...payload };
    delete expected["advisories"];
    expect(JSON.stringify(body)).toBe(JSON.stringify(expected));
  });

  it("an EMPTY match is stored and resolves as a genuine `{status:'ok', products:[]}` (A4)", async () => {
    // An empty match is a SUCCESS. If it stored nothing, a client would resolve
    // the uniform not-found and render a delivery failure for what is actually an
    // honest "0 results".
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([]) } : { status: 500, body: {} },
    );
    const api = registerPlugin();

    const { payload } = await runSearch(api, "call_empty", []);
    expect(payload["products"]).toEqual([]);

    const body = bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_empty" }));
    expect(body["status"]).toBe("ok");
    expect(body["products"]).toEqual([]);
  });

  it.each([
    ["invalid_request (client-side empty input)", { status: 200, body: searchEnvelope([]) }, {}],
    ["invalid_request (sil-api 400)", { status: 400, body: { error: "bad_query", message: "no" } }, { query: "x" }],
    ["retryable (sil-api 500)", { status: 500, body: {} }, { query: "x" }],
    ["forbidden (403)", { status: 403, body: { reason: "principal_mismatch" } }, { query: "x" }],
  ])("stores NOTHING on a non-ok outcome — %s (A5)", async (_label, reply, params) => {
    // These envelopes steer the AGENT's recovery and carry no product data to
    // deliver. A store write here would make an error resolvable as if it were
    // results.
    installRouter((kind) => (kind === "search" ? (reply as Reply) : { status: 500, body: {} }));
    const api = registerPlugin();

    const { payload } = await runSearch(api, "call_nonok", [], params);
    expect(payload["status"]).not.toBe("ok");

    expectNothingStored(api, "call_nonok");
  });

  it("stores NOTHING when the tool short-circuits as not_registered (zero network)", async () => {
    rmFile(getTokensPath(), { force: true });
    const rec = installRouter(() => ({ status: 500, body: {} }));
    const api = registerPlugin();

    const { payload } = await runSearch(api, "call_unreg", []);
    expect(payload["status"]).toBe("not_registered");
    expect(rec.all).toHaveLength(0);

    // Re-seed a session so the resolve is not refused for lack of a principal —
    // the point is that the page was never stored, not that we cannot look.
    seedTokens();
    seedAccount(ACCOUNT_A);
    expectNothingStored(api, "call_unreg");
  });
});

// ===========================================================================
// B1 / B2 / B3 / F1 — resolving the reference
// ===========================================================================

describe("resolving a stored page (B1, B2, B3, F1)", () => {
  it("responds with the EXACT stored page over a leg with no network, no timer, no model", async () => {
    const rec = installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([wireProduct(1), wireProduct(2)]) }
        : { status: 500, body: {} },
    );
    const api = registerPlugin();
    const { payload } = await runSearch(api, "call_1", []);
    expect(rec.all).toHaveLength(1);

    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const body = bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_1" }));

    // The delivery leg re-queries NOTHING: not sil-api, not the transcript, not
    // `chat.history`. A resolver that re-ran the search would show up here as a
    // second recorded request — and would also hand back a DIFFERENT page.
    expect(rec.all).toHaveLength(1);
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(body["products"]).toEqual(payload["products"]);
  });

  it("is DETERMINISTIC — two calls in the window return byte-identical payloads", async () => {
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([wireProduct(1), wireProduct(2)]) }
        : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, "call_1", []);

    const one = bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_1" }));
    const two = bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_1" }));
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });

  it("re-resolves after a resolve — a remount, reload or reconnect gets its page back (B2)", async () => {
    // A consume-on-read store passes the first assertion above and blanks the
    // shopper's screen the moment the client refreshes.
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, "call_1", []);

    for (let i = 0; i < 4; i += 1) {
      const body = bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_1" }));
      expect(body["status"]).toBe("ok");
      expect((body["products"] as unknown[])).toHaveLength(1);
    }
  });

  it("addresses the page by the EXACT host callId the client saw on the tool frame (B3)", async () => {
    // The live-validated join (2026-07-23): `execute()`'s first argument and the
    // wire's `data.itemId` are the same string. Any plugin-side prefixing,
    // hashing or re-minting breaks it — and would break it silently, since the
    // plugin would still resolve its OWN key just fine.
    const HOST_CALL_ID = "call_FSW68ywnbj8V6pZ5U8avz9Sn";
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, HOST_CALL_ID, []);

    const body = bodyOf(await callGatewayMethod(api, METHOD, { callId: HOST_CALL_ID }));
    expect(body["status"]).toBe("ok");
  });

  it("round-trips a >12 KB page BYTE-IDENTICALLY (F1)", async () => {
    // Above the point at which the transcript path silently drops cards. The
    // guarantee is about the DELIVERY leg: the page reaches the client without
    // passing through a model turn, a transcript entry, or any host projection of
    // the tool result — so it is immune to a provider that omits `data.result`, to
    // a per-provider transcript cap, and to transcript rewriting alike.
    const many = Array.from({ length: 60 }, (_, i) => wireProduct(i));
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope(many) } : { status: 500, body: {} },
    );
    const api = registerPlugin();
    const { payload } = await runSearch(api, "call_big", []);

    const stored = { ...payload };
    delete stored["advisories"];
    const storedJson = JSON.stringify(stored);
    // The test proves its own premise: a page that is not actually large would
    // make this a round-trip of nothing in particular.
    expect(storedJson.length).toBeGreaterThan(12 * 1024);
    expect((payload["products"] as unknown[])).toHaveLength(60);

    const body = bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_big" }));
    expect(JSON.stringify(body)).toBe(storedJson);
  });
});

// ===========================================================================
// D3 — many searches in one run, each independently resolvable
// ===========================================================================

describe("D3 — every intermediate search in a run stays resolvable", () => {
  it("resolves EACH of many searches by its own callId, with no cross-talk and no overwrite", async () => {
    // The criterion carrying the card's actual purpose. A single-slot "latest
    // result" store passes every single-search test in this file and fails here —
    // a client must be able to visualize every intermediate search in a run, not
    // just the last.
    const RUN_SEARCHES = 10;
    installRouter((kind, nth) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([wireProduct(nth * 100), wireProduct(nth * 100 + 1)]) }
        : { status: 500, body: {} },
    );
    const api = registerPlugin();

    const expected = new Map<string, string>();
    for (let i = 0; i < RUN_SEARCHES; i += 1) {
      const { payload } = await runSearch(api, `call_${i}`, [], { query: `search ${i}` });
      expected.set(`call_${i}`, JSON.stringify(payload["products"]));
    }

    // Resolve OUT OF ORDER — a store that returned "the most recent" would pass a
    // sequential walk and fail this.
    for (const callId of [...expected.keys()].reverse()) {
      const body = bodyOf(await callGatewayMethod(api, METHOD, { callId }));
      expect(JSON.stringify(body["products"])).toBe(expected.get(callId));
    }

    // Every page is distinct — no two callIds resolved to the same products.
    expect(new Set(expected.values()).size).toBe(RUN_SEARCHES);
  });
});

// ===========================================================================
// C1 / C2 / C3 / C4 — one uniform, non-leaky failure
// ===========================================================================

describe("the failure paths are ONE body on the wire (C1, C2, C3, C4)", () => {
  /** The canonical not-found body, read off the simplest cause. */
  async function notFoundBody(api: MockPluginAPI): Promise<string> {
    return JSON.stringify(bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_never" })));
  }

  it("an unknown callId is a STRUCTURED failure, never an ok-shaped empty page (C1)", async () => {
    const api = registerPlugin();
    const body = bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_never" }));

    // The distinction a client depends on: an unresolvable reference must not be
    // indistinguishable from a genuine empty match, or it renders a silent empty
    // grid for what is actually a delivery failure.
    expect(body["status"]).not.toBe("ok");
    expect(body).not.toHaveProperty("products");
    // Machine-readable — a stable code, not prose to parse.
    expect(typeof body["error"]).toBe("string");
    expect((body["error"] as string).length).toBeGreaterThan(0);
  });

  it("an EXPIRED callId returns the identical body to an unknown one (C2)", async () => {
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, "call_1", []);
    // It resolves before the window closes...
    expect(bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_1" }))["status"]).toBe("ok");

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + RETENTION_MS + 1);

    // ...and afterwards is byte-identical to a callId that never existed. No
    // distinct `expired` code, no field, no shape tell that a page ever did.
    const expired = JSON.stringify(bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_1" })));
    expect(expired).toBe(await notFoundBody(api));
  });

  it("a WRONG-PRINCIPAL callId returns the identical body — never the page, never a `forbidden` tell (C3)", async () => {
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, "call_1", []);

    // The shopper re-registers as a different sil account on the same box.
    seedAccount(ACCOUNT_B);

    const frames = await callGatewayMethod(api, METHOD, { callId: "call_1" });
    const body = bodyOf(frames);
    expect(JSON.stringify(body)).toBe(await notFoundBody(api));
    // Emphatically not account A's shopping.
    expect(JSON.stringify(frames)).not.toContain("gid://product/1");
    expect(JSON.stringify(frames)).not.toContain("checkout_url");
  });

  it("clearing the session strands the pages it produced (C4)", async () => {
    // A result belongs to the identity that produced it, not to the machine. A
    // store keyed only by process or device survives a logout and hands the next
    // person the last one's shopping.
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, "call_1", []);

    rmFile(getTokensPath(), { force: true });

    const frames = await callGatewayMethod(api, METHOD, { callId: "call_1" });
    expect(bodyOf(frames)["status"]).toBe("not_found");
    expect(JSON.stringify(frames)).not.toContain("gid://product/1");
  });

  it("ALL FOUR causes are one and the same body — unknown, expired, foreign, no-session", async () => {
    // The single strongest statement of C1–C4: collect every failure the wire can
    // produce and assert the set of distinct bodies has exactly ONE member. A
    // caller cannot tell "not yours" from "never existed" from "expired" from
    // "logged out", so no failure leaks the existence of a page.
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );

    const bodies = new Set<string>();

    // (1) unknown
    {
      const api = registerPlugin();
      bodies.add(JSON.stringify(bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_x" }))));
    }
    // (2) expired
    {
      __resetSearchResultsStore();
      const api = registerPlugin();
      await runSearch(api, "call_exp", []);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + RETENTION_MS + 1);
      bodies.add(JSON.stringify(bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_exp" }))));
      vi.useRealTimers();
    }
    // (3) wrong principal
    {
      __resetSearchResultsStore();
      seedAccount(ACCOUNT_A);
      const api = registerPlugin();
      await runSearch(api, "call_foreign", []);
      seedAccount(ACCOUNT_B);
      bodies.add(
        JSON.stringify(bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_foreign" }))),
      );
    }
    // (4) no live session
    {
      __resetSearchResultsStore();
      seedTokens();
      seedAccount(ACCOUNT_A);
      const api = registerPlugin();
      await runSearch(api, "call_logout", []);
      rmFile(getTokensPath(), { force: true });
      bodies.add(
        JSON.stringify(bodyOf(await callGatewayMethod(api, METHOD, { callId: "call_logout" }))),
      );
    }

    expect(bodies.size).toBe(1);
  });

  it("distinguishes the causes in the OPERATOR LOG, where it is safe to (C3)", async () => {
    // The other half of C3: an operator debugging a delivery complaint must be
    // able to tell the causes apart. That distinction lives in the log and ONLY
    // in the log — the wire body above is one for all four.
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, "call_1", []);
    seedAccount(ACCOUNT_B);
    await callGatewayMethod(api, METHOD, { callId: "call_1" });
    await callGatewayMethod(api, METHOD, { callId: "call_never" });

    const blob = logBlob(api);
    expect(blob).toContain("principal_mismatch");
    expect(blob).toContain("unknown");
  });
});

// ===========================================================================
// Malformed input
// ===========================================================================

describe("malformed input is a distinct, structured invalid_request", () => {
  it.each([
    ["missing callId", {}],
    ["empty callId", { callId: "" }],
    ["numeric callId", { callId: 42 }],
    ["null callId", { callId: null }],
    ["array callId", { callId: ["call_1"] }],
    ["object callId", { callId: { id: "call_1" } }],
  ])("responds invalid_request for %s — one frame, never a throw", async (_label, params) => {
    const api = registerPlugin();
    const frames = await callGatewayMethod(api, METHOD, params as Record<string, unknown>);
    const body = bodyOf(frames);

    expect(body["status"]).toBe("invalid_request");
    expect(typeof body["error"]).toBe("string");
    // Distinct from the not-found taxonomy: a malformed request is the CALLER's
    // bug and is worth telling them about; an unresolvable reference is not.
    expect(body["status"]).not.toBe("not_found");
  });

  it("an extra unexpected param is ignored, not an error", async () => {
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, "call_1", []);

    const body = bodyOf(
      await callGatewayMethod(api, METHOD, { callId: "call_1", unexpected: "ignore me" }),
    );
    expect(body["status"]).toBe("ok");
  });
});

// ===========================================================================
// C7 — the plugin never observes, probes, or depends on a listener
// ===========================================================================

describe("C7 — behaviour never varies with client presence", () => {
  it("stores the page even when NO gateway method is registered at all", async () => {
    // A plain OpenClaw CLI host, an unpaired Studio, a dropped socket. The search
    // behaves exactly as today, the page is buffered, nothing errors, and no
    // listener is probed — a client that pairs inside the window resolves it.
    installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );
    const toolsOnly = createMockPluginApi();
    registerCatalogTools(toolsOnly);
    expect(registeredGatewayMethodNames(toolsOnly).size).toBe(0);

    const { payload } = await runSearch(toolsOnly, "call_1", []);
    expect(payload["status"]).toBe("ok");

    // A client pairs afterwards — the page is there, in the same process.
    const paired = registerPlugin();
    const body = bodyOf(await callGatewayMethod(paired, METHOD, { callId: "call_1" }));
    expect(body["status"]).toBe("ok");
  });

  it("the search path makes EXACTLY ONE request and never invokes the handler", async () => {
    const rec = installRouter((kind) =>
      kind === "search" ? { status: 200, body: searchEnvelope([wireProduct(1)]) } : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, "call_1", []);

    // No listener probe, no readiness check, no second leg.
    expect(rec.all).toHaveLength(1);
    // And nothing on the search path emitted a resolve marker.
    expect(logBlob(api)).not.toContain("sil_search_results_hit");
  });
});

// ===========================================================================
// Registration shape + operator-log privacy
// ===========================================================================

describe("registration shape (C5) and log privacy", () => {
  it("register() declares EXACTLY ONE gateway method, at scope operator.read", () => {
    const api = registerPlugin();

    // A gateway method is not manifest-declarable — the host's `contracts`
    // vocabulary has no key for one — so REGISTRATION IS THE DECLARATION and this
    // set is the only drift surface a second, undeclared method would appear on.
    expect([...registeredGatewayMethodNames(api)]).toEqual([METHOD]);
    // The scope is the plugin's whole contribution at the transport layer: the
    // host authorizes it BEFORE the handler runs. The plugin implements no scope
    // logic of its own, and this test deliberately does NOT simulate the host's
    // check — asserting a mocked gate proves nothing.
    expect(getGatewayMethod(api, METHOD).opts?.scope).toBe("operator.read");
  });

  it("registering the gateway method does not change the tool set (still 11)", () => {
    const api = registerPlugin();
    expect([...api._tools.keys()].sort()).toEqual([
      "sil_doctor",
      "sil_learn",
      "sil_product_get",
      "sil_profile_get",
      "sil_profile_materialize",
      "sil_profile_remove",
      "sil_profile_search",
      "sil_register",
      "sil_search",
      "sil_specs",
      "sil_whoami",
    ]);
    // The method is NOT a tool and must never leak into the tool surface.
    expect([...api._tools.keys()]).not.toContain(METHOD);
  });

  it("the hit log carries {found, count} and NO product data", async () => {
    installRouter((kind) =>
      kind === "search"
        ? { status: 200, body: searchEnvelope([wireProduct(1), wireProduct(2)]) }
        : { status: 500, body: {} },
    );
    const api = registerPlugin();
    await runSearch(api, "call_1", []);
    vi.mocked(api.logger.info).mockClear();

    await callGatewayMethod(api, METHOD, { callId: "call_1" });

    expect(api.logger.info).toHaveBeenCalledWith(
      "sil_search_results_hit",
      expect.objectContaining({ found: true, count: 2 }),
    );
    const blob = logBlob(api);
    // No product, no price, no checkout_url, no id material, no token.
    expect(blob).not.toContain("checkout_url");
    expect(blob).not.toContain("gid://product");
    expect(blob).not.toContain("buy.example.com");
    expect(blob).not.toContain("stored-at");
    expect(blob).not.toContain("stored-rt");
  });

  it("a miss logs no product vocabulary either", async () => {
    const api = registerPlugin();
    await callGatewayMethod(api, METHOD, { callId: "call_never" });
    const blob = logBlob(api);
    expect(blob).not.toContain("checkout_url");
    expect(blob).not.toContain("gid://product");
  });
});
