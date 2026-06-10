/**
 * INTEGRATION — cross-tool 401 parity (tier: integration).
 *
 * THE structural guard against FLAG-10 re-entry. The card's deliverable is that
 * `sil_search`, `sil_product_get`, and `sil_whoami` present the IDENTICAL 401
 * choreography — one transparent refresh via `refreshStoredTokens()`, one retry of
 * the original read, and the same terminal/transient/ok envelope CLASS for each of
 * the four refresh sub-outcomes (retry-ok, second-401, invalid_grant, refresh-5xx).
 * The divergence the goal forbids re-enters the moment a fourth tool copies
 * catalog's OLD terminal branch instead of the shared path — so parity is enforced
 * here by a real shared-behaviour assertion that FAILS if any one tool drifts, not
 * left to reviewer vigilance.
 *
 * This is deliberately NOT three independent per-tool suites (those live in
 * whoami / catalog-search / catalog-lookup integration). Here we drive the SAME
 * scenario through all three tools in one test and assert their observable 401
 * behaviour is the same — the equality IS the assertion. A tool whose 401 stayed
 * terminal (no refresh) shows refresh.length 0 where the others show 1, or maps a
 * recovered 401 to a re-register where the others map to ok — and the parity check
 * fails.
 *
 * The ONLY thing mocked is `fetch`. Real `sil-client` + `credentials` +
 * `refreshStoredTokens`, real `SIL_DATA_DIR` token seeding — stub-free, exactly as
 * the per-tool suites. The fetch double routes the THREE sil-api read endpoints
 * (`/identity` GET, `/catalog/search`, `/catalog/lookup`) plus the sil-web
 * `/auth/refresh` leg, and exposes per-tool read + refresh call counts.
 *
 * EXPECT RED until all three tools route 401 through the shared
 * `refreshAndRetryOnce` helper: against current code `sil_whoami` already
 * refreshes (refresh.length 1, recovered-ok) but the two catalog tools are
 * terminal (refresh.length 0, re-register) — so the per-sub-outcome parity sets
 * have size > 1 and these tests fail. GREEN only once catalog 401 matches whoami.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../tools/catalog.js";
import { registerIdentityTools } from "../tools/identity.js";
import { setWebUrl, setApiUrl } from "../lib/config.js";
import { getDataDir, getTokensPath, readTokens } from "../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

const SIL_WEB = "https://sil-web.test.example.com"; // refresh origin
const SIL_API = "https://sil-api.test.example.com"; // read origin (all three reads)

/** A real identity envelope (sil_whoami's ok shape). */
function identityEnvelope(): unknown {
  return {
    protocol: "ucp",
    version: "0.1",
    domain: "identity",
    result: {
      name: "Ada Lovelace",
      addresses: [{ line1: "12 Analytical Engine Way", city: "London", country: "GB" }],
    },
  };
}

/** A real search envelope with one product (sil_search's ok shape). FLAT shape
 * (`{ ucp, products, pagination }` — top level, no `result` wrapper;
 * `withUcpMeta(body)`), the only shape sil-api emits. */
function searchEnvelope(): unknown {
  return {
    ucp: { version: "0.1", status: "success" },
    products: [
      {
        id: "gid://product/a",
        title: "Aeron Chair",
        source: "herman-miller",
        variants: [
          {
            id: "gid://variant/a1",
            title: "Aeron Chair — Graphite",
            price: { amount: 159900, currency: "USD" },
            availability: { available: true, status: "in_stock" },
            checkout_url: "https://buy.example.com/aeron-a1",
          },
        ],
      },
    ],
    pagination: { has_next_page: false },
  };
}

/** A real lookup envelope with one product (sil_product_get's ok shape). FLAT shape
 * (`{ ucp, products }` — top level, no `result` wrapper; `withUcpMeta(body)`), the
 * only shape sil-api emits. */
function lookupEnvelope(): unknown {
  return {
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
            title: "Aeron Chair — Graphite",
            price: { amount: 159900, currency: "USD" },
            availability: { available: true, status: "in_stock" },
            checkout_url: "https://buy.example.com/aeron-a1",
            inputs: [{ id: "gid://product/a", match: "featured" }],
          },
        ],
      },
    ],
  };
}

let dataDir: string;
let priorSilDataDir: string | undefined;

/** One recorded outbound request. */
interface Recorded {
  url: string;
  method: string;
  bearer: string | null;
  body: unknown;
}

type Reply = { status: number; body: unknown } | "network-error";
type ReadKind = "identity" | "search" | "lookup";
type Kind = ReadKind | "refresh" | "other";

/** What a recording double returns to the caller. */
interface Buckets {
  all: Recorded[];
  read: Recorded[]; // the tool's sil-api read endpoint (identity|search|lookup)
  refresh: Recorded[]; // the sil-web /auth/refresh leg
}

/**
 * A URL-routing fetch double covering all three sil-api read endpoints + the
 * sil-web refresh leg. `readKind` selects which read endpoint THIS tool uses, so
 * the `read` bucket counts only that tool's reads (the parity assertion compares
 * read + refresh counts across tools). `replyRead(nthRead)` and
 * `replyRefresh(nthRefresh)` drive the two legs independently.
 */
function installRouter(
  readKind: ReadKind,
  replyRead: (nthRead: number) => Reply,
  replyRefresh: (nthRefresh: number) => Reply,
): Buckets {
  const all: Recorded[] = [];
  const read: Recorded[] = [];
  const refresh: Recorded[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const bearer = headers["Authorization"] ?? headers["authorization"] ?? null;
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const req: Recorded = { url, method, bearer, body };
      all.push(req);

      let kind: Kind;
      if (url.includes("/auth/refresh")) kind = "refresh";
      else if (url.includes("/catalog/search")) kind = "search";
      else if (url.includes("/catalog/lookup")) kind = "lookup";
      else if (url.includes("/identity")) kind = "identity";
      else kind = "other";

      let r: Reply;
      if (kind === "refresh") {
        refresh.push(req);
        r = replyRefresh(refresh.length - 1);
      } else if (kind === readKind) {
        read.push(req);
        r = replyRead(read.length - 1);
      } else {
        // A read endpoint that is NOT this tool's, or an unexpected URL — a tool
        // must hit ONLY its own read endpoint + refresh. Fail loudly.
        return Promise.reject(
          new Error(`unexpected fetch to ${url} (kind=${kind}) for readKind=${readKind}`),
        );
      }

      if (r === "network-error") {
        return Promise.reject(new Error("simulated network failure"));
      }
      return Promise.resolve(
        new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  );

  return { all, read, refresh };
}

/** Parse a ToolResult payload. */
function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("no tool payload");
  return JSON.parse(text) as Record<string, unknown>;
}

/** Seed a stored token pair so each tool proceeds to its read. */
function seedTokens(access: string, refresh: string): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: access, refresh_token: refresh }),
    { mode: 0o600 },
  );
}

/** The ok-shape envelope a given tool's read endpoint returns on success. */
function okEnvelopeFor(readKind: ReadKind): unknown {
  if (readKind === "identity") return identityEnvelope();
  if (readKind === "search") return searchEnvelope();
  return lookupEnvelope();
}

/** Register the right tool group and return the tool name for a given read kind. */
function setupTool(readKind: ReadKind): { api: MockPluginAPI; tool: string } {
  const api = createMockPluginApi();
  if (readKind === "identity") {
    registerIdentityTools(api);
    return { api, tool: "sil_whoami" };
  }
  registerCatalogTools(api);
  return { api, tool: readKind === "search" ? "sil_search" : "sil_product_get" };
}

/** Invoke a tool with the call args its schema requires. */
function callArgs(readKind: ReadKind): Record<string, unknown> {
  if (readKind === "search") return { query: "chair" };
  if (readKind === "lookup") return { ids: ["gid://product/a"] };
  return {}; // whoami takes no params
}

/** The per-tool silent-success operator marker each tool MUST emit on a recovered
 * 401 (review-round-1 fix; card line 161). The marker name is tool-specific but
 * the BEHAVIOUR (emit exactly once on silent recovery) must be uniform — that
 * uniformity is what this parity guard pins so the seam cannot drift per-tool. */
function refreshedMarkerFor(readKind: ReadKind): string {
  if (readKind === "search") return "sil_search_refreshed";
  if (readKind === "lookup") return "sil_product_get_refreshed";
  return "sil_whoami_refreshed";
}

/** Count `api.logger.info(marker, …)` calls whose first positional arg is `marker`. */
function infoMarkerCount(api: MockPluginAPI, marker: string): number {
  return vi
    .mocked(api.logger.info)
    .mock.calls.filter((c) => c[0] === marker).length;
}

/** One observation of a tool's 401 behaviour under a given refresh-leg scenario. */
interface Observation {
  readKind: ReadKind;
  status: unknown;
  hasRecoveryHint: boolean;
  readCount: number;
  refreshCount: number;
  tokensCleared: boolean;
  /** How many times THIS tool emitted its own `<tool>_refreshed` operator marker
   * (review-round-1 fix). 1 on a recovered 401, 0 otherwise — folded into the
   * anti-divergence guard so the restored seam cannot disappear per-tool again. */
  refreshedMarkerCount: number;
}

/**
 * Drive a SINGLE refresh-leg scenario through ALL THREE tools and return one
 * Observation per tool. `replyRead(readKind, nthRead)` makes the first read 401
 * and lets the caller return each tool's OWN ok envelope on the retry; `replyRefresh`
 * decides the refresh-leg outcome. Each tool runs in its own fresh token seed +
 * fetch double so the runs are independent.
 */
async function observeAllTools(
  replyRead: (readKind: ReadKind, nthRead: number) => Reply,
  replyRefresh: (nthRefresh: number) => Reply,
): Promise<Observation[]> {
  const kinds: ReadKind[] = ["identity", "search", "lookup"];
  const out: Observation[] = [];
  for (const readKind of kinds) {
    // Fresh seed per tool (the prior tool's run may have cleared tokens).
    rmSync(getTokensPath(), { force: true });
    seedTokens("expired-at", "valid-rt");
    const rec = installRouter(readKind, (nthRead) => replyRead(readKind, nthRead), replyRefresh);
    const { api, tool } = setupTool(readKind);
    const payload = payloadOf(await getTool(api, tool).execute("c1", callArgs(readKind)));
    out.push({
      readKind,
      status: payload["status"],
      hasRecoveryHint: payload["recovery"] === "sil_register",
      readCount: rec.read.length,
      refreshCount: rec.refresh.length,
      tokensCleared: !existsSync(getTokensPath()),
      refreshedMarkerCount: infoMarkerCount(api, refreshedMarkerFor(readKind)),
    });
    vi.restoreAllMocks();
  }
  return out;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-parity-int-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl(SIL_WEB);
  setApiUrl(SIL_API);
});

afterEach(() => {
  vi.restoreAllMocks();
  setWebUrl("");
  setApiUrl("");
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_API_URL"];
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("cross-tool 401 parity — all three tools share ONE refresh-and-retry-once choreography", () => {
  it("sub-outcome retry-ok: every tool refreshes once, retries once, and returns a NORMAL ok result (no tool dead-ends)", async () => {
    // AC[integration]: identical scenario (expired token → 401 → good refresh →
    // retry ok) through search / product_get / whoami. All three must look the
    // same: exactly 1 refresh, exactly 2 reads, status ok, NO recovery hint. The
    // retry returns each tool's OWN ok envelope (via okEnvelopeFor).
    const observed = await observeAllTools(
      (readKind, nthRead) =>
        nthRead === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: okEnvelopeFor(readKind) },
      () => ({ status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } }),
    );

    // PARITY: every tool maps the recovered 401 to ok, with identical call counts.
    for (const o of observed) {
      expect(o.status).toBe("ok");
      expect(o.hasRecoveryHint).toBe(false);
      expect(o.refreshCount).toBe(1); // exactly one refresh
      expect(o.readCount).toBe(2); // failed read + one retry
      // OBSERVABILITY-SEAM PARITY (review-round-1 fix; card line 161): every tool
      // emits its own `<tool>_refreshed` operator marker EXACTLY ONCE on this
      // silent-recovery path — the seam restored uniformly across all three. Folded
      // into THIS anti-divergence guard so the marker cannot drift/disappear
      // per-tool again (the same FLAG-10 failure mode, applied to logging). RED
      // until all three tools emit the marker via the helper's `refreshed:true`.
      expect(o.refreshedMarkerCount).toBe(1);
    }
    // The equality across tools IS the guard: collapse each dimension to a set.
    expect(new Set(observed.map((o) => o.status)).size).toBe(1);
    expect(new Set(observed.map((o) => o.refreshCount)).size).toBe(1);
    expect(new Set(observed.map((o) => o.readCount)).size).toBe(1);
    // The marker-emission behaviour is uniform across tools (all 1). A tool that
    // silently recovered WITHOUT emitting its marker would show 0 here while the
    // others show 1 — set size 2, and the seam has drifted. Pin it to size 1.
    expect(new Set(observed.map((o) => o.refreshedMarkerCount)).size).toBe(1);
  });

  it("sub-outcome second-401: every tool refreshes EXACTLY once, retries once, then terminates re-register (no tool storms)", async () => {
    // AC[integration]: a freshly-rotated token still 401 is terminal for ALL three
    // — exactly 1 refresh, exactly 2 reads, status must_reregister with the hint.
    const observed = await observeAllTools(
      () => ({ status: 401, body: { error: "unauthorized" } }), // read ALWAYS 401
      () => ({ status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } }),
    );

    for (const o of observed) {
      expect(o.status).toBe("must_reregister");
      expect(o.hasRecoveryHint).toBe(true);
      expect(o.refreshCount).toBe(1); // exactly one refresh, NEVER a second
      expect(o.readCount).toBe(2); // initial + exactly one retry
    }
    expect(new Set(observed.map((o) => o.status)).size).toBe(1);
    expect(new Set(observed.map((o) => o.refreshCount)).size).toBe(1);
    expect(new Set(observed.map((o) => o.readCount)).size).toBe(1);
  });

  it("sub-outcome invalid_grant: every tool refreshes once, does NOT retry, terminates re-register, and clears tokens", async () => {
    // AC[integration]: a dead refresh token. ALL three: 1 refresh, NO retry (1
    // read), status must_reregister + hint, tokens.json cleared.
    const observed = await observeAllTools(
      () => ({ status: 401, body: { error: "unauthorized" } }),
      () => ({ status: 401, body: { error: "invalid_grant" } }),
    );

    for (const o of observed) {
      expect(o.status).toBe("must_reregister");
      expect(o.hasRecoveryHint).toBe(true);
      expect(o.refreshCount).toBe(1);
      expect(o.readCount).toBe(1); // the original 401 only — NO retry without a rotated token
      expect(o.tokensCleared).toBe(true);
    }
    expect(new Set(observed.map((o) => o.status)).size).toBe(1);
    expect(new Set(observed.map((o) => o.readCount)).size).toBe(1);
    expect(new Set(observed.map((o) => o.tokensCleared)).size).toBe(1);
  });

  it("sub-outcome refresh-5xx: every tool surfaces TRANSIENT retryable with NO re-register hint, does NOT retry, keeps tokens", async () => {
    // AC[integration]: a refresh-leg 5xx is a blip, not a dead session, for ALL
    // three — status retryable, NO hint, 1 refresh, NO retry (1 read), tokens kept.
    const observed = await observeAllTools(
      () => ({ status: 401, body: { error: "unauthorized" } }),
      () => ({ status: 503, body: { error: "unavailable" } }),
    );

    for (const o of observed) {
      expect(o.status).toBe("retryable");
      expect(o.hasRecoveryHint).toBe(false); // a refresh blip is NOT a dead session
      expect(o.refreshCount).toBe(1);
      expect(o.readCount).toBe(1); // NO retry — no rotated token
      expect(o.tokensCleared).toBe(false); // the pair may be fine
    }
    expect(new Set(observed.map((o) => o.status)).size).toBe(1);
    expect(new Set(observed.map((o) => o.hasRecoveryHint)).size).toBe(1);
    expect(new Set(observed.map((o) => o.tokensCleared)).size).toBe(1);
  });

  it("the FLAG-10 regression canary: a tool whose 401 stayed terminal (no refresh) breaks parity (refreshCount diverges from the others)", async () => {
    // This is the explicit anti-divergence assertion the card requires: if any one
    // tool does NOT refresh on a 401 (the old terminal catalog branch), its
    // refreshCount is 0 while the refreshing tools' is 1 — so the cross-tool set
    // has size 2 and this fails. With all three on the shared helper, the set
    // collapses to {1}. (Against current code, the two catalog tools are terminal
    // and whoami refreshes — so this is RED until catalog adopts the shared path.)
    const observed = await observeAllTools(
      (readKind, nthRead) =>
        nthRead === 0
          ? { status: 401, body: { error: "unauthorized" } }
          : { status: 200, body: okEnvelopeFor(readKind) },
      () => ({ status: 200, body: { access_token: "rotated-at", refresh_token: "rotated-rt" } }),
    );

    // Every tool must have attempted the refresh — the FLAG-10 divergence is
    // precisely "one tool refreshes, another doesn't". One shared refresh count.
    for (const o of observed) {
      expect(o.refreshCount).toBe(1);
    }
    expect(new Set(observed.map((o) => o.refreshCount)).size).toBe(1);
    // And every tool retried exactly once after the refresh (2 reads) — the second
    // structural half of the shared choreography.
    for (const o of observed) {
      expect(o.readCount).toBe(2);
    }
    expect(new Set(observed.map((o) => o.readCount)).size).toBe(1);
  });
});
