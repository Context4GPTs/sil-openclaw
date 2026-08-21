/**
 * INTEGRATION — the whole v0 journey over ONE scripted `fetch`: a cold category
 * refused, READ, researched, minted, searched, shortlisted and handed off.
 *
 *   sil_search (400, unregistered) → sil_domain_find (matches: []) →
 *     sil_domain_create → sil_search → sil_product_get → sil_stores
 *     → one handoff URL
 *
 * THE READ IS PART OF THE CHAIN, and that is this file's newest claim. Before it
 * existed the cold start ran refusal → mint, so the only thing standing between
 * an empty shelf and a permanent, un-undoable global write was the agent's
 * judgement. The read is what turns that into a step: the mint is entered only
 * after a discovery read named nothing to adopt.
 *
 * SCOPE, deliberately. This is the TOOL CHAIN, not the agent. What the agent
 * SAYS — the mint announcement, the veto's three buckets, the dating of a
 * `stored` price — is not testable in this repo at any tier: it belongs to the
 * skill card and to sil-stage. There is no e2e tier here and none is invented
 * (CLAUDE.md: one `vitest run` is the whole gate). Nor can this file prove the
 * agent WAITED for the read; what it proves is that the tools compose that way
 * and that no tool performs another's job.
 *
 * What IS testable, and what this file exists to prove:
 *   - the tools compose into a terminating journey with no extra call and no
 *     tool standing in for another;
 *   - each hop calls exactly its own route, once — and the read and the mint,
 *     which share a PATH, are told apart by their VERB;
 *   - the journey ENDS at one URL that came out of a sil tool result — every
 *     product, price, seller and URL presented is traceable to a tool response,
 *     never to anything the plugin invented.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../tools/catalog.js";
import { setApiUrl, setWebUrl } from "../lib/config.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "./helpers/mock-plugin-api.js";
import {
  SIL_API,
  SIL_WEB,
  installRouter,
  ok,
  payloadOf,
  seedTokens,
  type Router,
} from "./helpers/v0-harness.js";
import {
  GOLDEN_HOSTS,
  GOLDEN_REFS,
  SEARCH_400,
  clone,
  domainFindEmpty,
  mintGolden,
  resultGolden,
  storeFor,
  storesGolden,
} from "./helpers/v0-wire.js";

const DOMAIN = "product.sports.winter.ski.boots";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-v0-journey-"));
  priorDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl(SIL_WEB);
  setApiUrl(SIL_API);
  api = createMockPluginApi();
  registerCatalogTools(api);
  seedTokens(ACCESS, REFRESH);
});

afterEach(() => {
  vi.restoreAllMocks();
  setWebUrl("");
  setApiUrl("");
  if (priorDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

/**
 * The scripted wire, in journey order. The FIRST search is refused (the category
 * is cold); every search after the mint succeeds. Nothing else is scripted, so a
 * tool reaching a route it should not reach lands in `other` and fails loudly.
 */
function scriptTheJourney(): Router {
  return installRouter((kind, nth) => {
    if (kind === "search") {
      return nth === 0 ? { status: 400, body: SEARCH_400.unknownDomain } : ok(resultGolden());
    }
    // The read answers with the MINT SIGNAL: the registry genuinely holds
    // nothing for this ask, and says so completely (`capped: false`). That is
    // the only answer that licenses the mint below.
    if (kind === "domainFind") return ok(domainFindEmpty());
    if (kind === "domains") return ok(mintGolden());
    if (kind === "lookup") return ok(resultGolden());
    if (kind === "stores") return ok(storesGolden());
    return ok({});
  });
}

const call = async (
  tool: string,
  params: Record<string, unknown>,
  callId: string,
): Promise<Record<string, unknown>> => payloadOf(await getTool(api, tool).execute(callId, params));

describe("the cold-start journey terminates at one handoff URL", () => {
  it("runs beat A → E, each tool once per beat, ending at a URL that came from sil", async () => {
    const router = scriptTheJourney();

    // Beat A — the front door refuses. The refusal is a ROUTING SIGNAL, and on
    // this wire it is ambiguous by design: an unregistered domain and a rejected
    // predicate carry the same `invalid_request`. So it routes to the read, not
    // to the mint.
    const refused = await call("sil_search", { domain: DOMAIN, query: "ski boots", n: 8 }, "j1");
    expect(refused["status"]).toBe("invalid_request");
    expect(refused["message"]).toContain("mint it first");

    // Beat A′ — the READ, in the buyer's own words. `matches: []` beside
    // `capped: false` is a real answer and the one thing that licenses the write
    // below; anything else (a match to adopt, a bounded list, a failed read)
    // ends the cold start here.
    const read = await call("sil_domain_find", { q: "ski boots" }, "j2");
    expect(read["status"]).toBe("ok");
    expect(read["matches"]).toEqual([]);
    expect(read["capped"]).toBe(false);
    // The read touched the registry's READ verb and nothing else — the write is
    // still un-entered at this point in the journey.
    expect(router.domains).toEqual([]);

    // Beat A″ — the mint, at the path the agent actually meant, now that the
    // read has named nothing to adopt. (The research that produces `guide` is
    // the agent's web work, outside the tool surface.)
    const minted = await call(
      "sil_domain_create",
      {
        path: DOMAIN,
        guide: "Ski boots are bought by fit first: last width, then flex, then shell shape.",
        specs: [{ key: "flex_index", display_name: "Flex index", data_type: "number", unit: "index" }],
      },
      "j3",
    );
    expect(minted["status"]).toBe("ok");
    expect(minted["path"]).toBe(DOMAIN);
    expect(minted["validated_at"]).toBeNull();

    // Beat B — the same path, re-searched. Never a shallower or re-spelled one.
    const results = await call(
      "sil_search",
      { domain: DOMAIN, query: "ski boots", n: 8, predicates: [{ key: "flex_index", op: "gte", value: 110 }] },
      "j4",
    );
    expect(results["status"]).toBe("ok");
    const shortlist = (results["results"] as Record<string, unknown>[]).map((r) => r["ref"] as string);
    expect(shortlist).toEqual([GOLDEN_REFS.catalog, GOLDEN_REFS.web]);

    // Beat C — the shortlist re-read, by the refs sil returned, ≤5.
    expect(shortlist.length).toBeLessThanOrEqual(5);
    const reread = await call("sil_product_get", { refs: shortlist }, "j5");
    expect(reread["status"]).toBe("ok");

    // Beat D — the pick's sellers. The pick is a ref sil returned, not a
    // product the agent named.
    const pick = shortlist[0];
    const stores = await call("sil_stores", { ref: pick, destination: "DE" }, "j6");
    expect(stores["status"]).toBe("ok");

    // Beat E — one URL, named for what it is.
    const chosen = storeFor(stores, GOLDEN_HOSTS.serviceable);
    const handoff = chosen["handoff"] as Record<string, unknown>;
    expect(typeof handoff["url"]).toBe("string");
    expect(["buy_url", "url"]).toContain(handoff["source"]);

    // Each route hit exactly as many times as the journey has beats on it, and
    // nothing reached an unrouted path.
    expect(router.search).toHaveLength(2);
    expect(router.domainFind).toHaveLength(1);
    expect(router.domains).toHaveLength(1);
    expect(router.lookup).toHaveLength(1);
    expect(router.stores).toHaveLength(1);
    expect(router.refresh).toEqual([]);
    expect(router.other).toEqual([]);
    expect(router.all).toHaveLength(6);
    // The two `/catalog/domains` calls are ONE read and ONE write, told apart by
    // the verb — never two of either.
    expect(router.domainFind[0].method).toBe("GET");
    expect(router.domains[0].method).toBe("POST");
  });

  it("every URL, price and seller presented came out of a sil tool result", async () => {
    // The rule that outranks the journey: a product, price, seller or buy URL
    // that did not come out of a sil tool call never enters the shortlist. The
    // plugin's half of that is that it invents none of them — every string the
    // agent can act on must be traceable to the wire body.
    scriptTheJourney();
    await call("sil_search", { domain: DOMAIN, query: "ski boots", n: 8 }, "k1");
    await call(
      "sil_domain_create",
      { path: DOMAIN, guide: "g", specs: [] },
      "k2",
    );
    const results = await call("sil_search", { domain: DOMAIN, query: "ski boots", n: 8 }, "k3");
    const stores = await call("sil_stores", { ref: GOLDEN_REFS.catalog, destination: "DE" }, "k4");

    const wireStrings = new Set<string>();
    const walk = (value: unknown): void => {
      if (typeof value === "string") wireStrings.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(resultGolden());
    walk(storesGolden());

    const presented: string[] = [];
    for (const entry of stores["stores"] as Record<string, unknown>[]) {
      presented.push((entry["handoff"] as Record<string, string>)["url"]);
      presented.push((entry["seller"] as Record<string, string>)["host"]);
      presented.push((entry["offer"] as Record<string, string>)["price"]);
    }
    for (const result of results["results"] as Record<string, unknown>[]) {
      presented.push(result["ref"] as string);
      for (const offer of result["offers"] as Record<string, string>[]) {
        presented.push(offer["url"], offer["price"]);
      }
    }
    expect(presented.filter((s) => !wireStrings.has(s))).toEqual([]);
    expect(presented.length).toBeGreaterThan(10);
  });
});

describe("no tool stands in for another, across the whole journey", () => {
  it("`sil_search` never mints, even when the domain is refused", async () => {
    // `sil_search(create_domain_if_missing)` is the forbidden flag. A search that
    // auto-minted would hide a permanent global write inside a read.
    const router = scriptTheJourney();
    await call("sil_search", { domain: DOMAIN, query: "ski boots", n: 8 }, "m1");
    expect(router.domains).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("`sil_search` never re-reads offers — that is `sil_product_get`'s route", async () => {
    const router = scriptTheJourney();
    await call("sil_search", { domain: DOMAIN, query: "q", n: 3 }, "m2a");
    await call("sil_search", { domain: DOMAIN, query: "q", n: 3 }, "m2b");
    expect(router.lookup).toEqual([]);
  });

  it("`sil_product_get` never reads sellers — that is `sil_stores`' route", async () => {
    const router = scriptTheJourney();
    await call("sil_product_get", { refs: [GOLDEN_REFS.catalog] }, "m3");
    expect(router.stores).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("`sil_stores` never searches — one tool, one route, one request", async () => {
    const router = scriptTheJourney();
    await call("sil_stores", { ref: GOLDEN_REFS.catalog, destination: "DE" }, "m4");
    expect(router.search).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("`sil_domain_create` performs NO read of its own — the read is the agent's step", async () => {
    // Read-before-mint is a DISCIPLINE the agent follows across two tool calls,
    // never a pre-check the mint runs for itself. A mint that silently read first
    // would make the discipline unobservable — the agent could skip it and the
    // chain would look identical — and it would hide a second round trip inside
    // the one call that cannot be undone.
    const router = scriptTheJourney();
    await call("sil_domain_create", { path: DOMAIN, guide: "g", specs: [] }, "m5");
    expect(router.search).toEqual([]);
    expect(router.domainFind).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("`sil_domain_find` never mints — the read and the write share a path, not a verb", async () => {
    // The inverse, and the more dangerous direction: a read that reached the
    // POST would coin a category as a side effect of looking one up, with no
    // undo and nothing downstream able to detect it.
    const router = scriptTheJourney();
    await call("sil_domain_find", { q: "ski boots" }, "m6");
    expect(router.domains).toEqual([]);
    expect(router.domainFind).toHaveLength(1);
    expect(router.all).toHaveLength(1);
  });
});

describe("a fenced domain's first search is a FENCE, not an empty catalog", () => {
  it("every predicate reports `applied: false` and results come back `maturity: web`", async () => {
    // `handlers/search.ts:10-14` — a freshly minted domain has
    // `validated_at IS NULL`, so the catalog leg does not execute at all. The
    // agent must be able to tell that apart from "sil holds nothing", and the
    // only way it can is if both signals cross intact.
    const fenced = clone(resultGolden());
    const results = fenced["results"] as Record<string, unknown>[];
    fenced["results"] = [results[1]]; // the `web` one only
    fenced["predicates"] = [
      { key: "flex_index", applied: false },
      { key: "brand", applied: false },
    ];
    installRouter((kind) => {
      if (kind === "domains") return ok(mintGolden());
      if (kind === "search") return ok(clone(fenced));
      return ok({});
    });

    await call("sil_domain_create", { path: DOMAIN, guide: "g", specs: [] }, "f1");
    const payload = await call("sil_search", { domain: DOMAIN, query: "boots", n: 8 }, "f2");

    expect(payload["status"]).toBe("ok");
    expect((payload["predicates"] as { applied: unknown }[]).every((p) => p.applied === false)).toBe(
      true,
    );
    expect((payload["results"] as Record<string, unknown>[]).map((r) => r["maturity"])).toEqual([
      "web",
    ]);
    // A fence is not an error and not an empty answer — the results are real.
    expect((payload["results"] as unknown[]).length).toBeGreaterThan(0);
  });
});
