/**
 * INTEGRATION — `sil_stores` wired end to end over a mocked `fetch`.
 *
 * THIS IS THE FILE THE PRODUCT TURNS ON. `/catalog/stores` fails closed:
 * `not_serviceable` is a positive claim requiring policy evidence sil actually
 * read, and at v0 nothing writes `corpus.purposes = 'policy'`, so `unknown` is
 * the MAJORITY answer and `not_serviceable` is structurally unreachable. A
 * consumer that drops `unknown` sellers collapses the shortlist to near-empty
 * while looking like it filtered — invisible from outside, undetectable
 * downstream, and it undoes the route's whole design one layer up.
 *
 * So every seller the route sent must arrive, carrying everything it carried,
 * with no marker the agent could read as permission to drop it. That is what is
 * asserted below against the checked-in stores golden, which holds all three
 * serviceability states in one body precisely so a test cannot pass by only
 * ever seeing the easy one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogTools } from "../tools/catalog.js";
import { setApiUrl, setWebUrl, getApiUrl } from "../lib/config.js";
import { readTokens } from "../lib/credentials.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "./helpers/mock-plugin-api.js";
import {
  SIL_API,
  SIL_WEB,
  bearerToken,
  installRouter,
  logBlob,
  ok,
  payloadOf,
  rotated,
  seedTokens,
} from "./helpers/v0-harness.js";
import {
  AUTH,
  GOLDEN_HOSTS,
  STORES_400_NO_DESTINATION,
  STORES_404,
  clone,
  storeFor,
  storesGolden,
  storesMissing,
} from "./helpers/v0-wire.js";

const TOOL = "sil_stores";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";
const REF = "variant:0198f2a1-4c3d-7000-8000-0000000000a1";

let api: MockPluginAPI;
let dataDir: string;
let priorDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-v0-stores-"));
  priorDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  setWebUrl(SIL_WEB);
  setApiUrl(SIL_API);
  api = createMockPluginApi();
  registerCatalogTools(api);
});

afterEach(() => {
  vi.restoreAllMocks();
  setWebUrl("");
  setApiUrl("");
  if (priorDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

async function run(
  params: Record<string, unknown> = { ref: REF, destination: "DE" },
  callId = "call-1",
): Promise<Record<string, unknown>> {
  return payloadOf(await getTool(api, TOOL).execute(callId, params));
}

describe("A8 — one route, one request", () => {
  it("POSTs `/catalog/stores` with `{ ref, destination }` and a Bearer, exactly once", async () => {
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "stores" ? ok(storesGolden()) : ok({})));
    await run();
    expect(router.stores).toHaveLength(1);
    expect(router.stores[0].url).toBe(`${getApiUrl()}/catalog/stores`);
    expect(router.stores[0].body).toEqual({ ref: REF, destination: "DE" });
    expect(bearerToken(router.stores[0])).toBe(ACCESS);
    expect(router.search).toEqual([]);
    expect(router.lookup).toEqual([]);
    expect(router.domains).toEqual([]);
    expect(router.other).toEqual([]);
  });

  it("with no `destination` the key is OMITTED — the route resolves the user's default", async () => {
    // "Ship to me" is an omitted key. The plugin must not call `sil_whoami` to
    // fill it, and must not send an empty string that fails the route's pattern.
    seedTokens(ACCESS, REFRESH);
    const router = installRouter((kind) => (kind === "stores" ? ok(storesGolden()) : ok({})));
    await run({ ref: REF });
    expect(router.stores[0].body).toEqual({ ref: REF });
    // …and it certainly did not go ask.
    expect(router.other).toEqual([]);
    expect(router.all).toHaveLength(1);
  });

  it("the token never reaches a log line or the result", async () => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "stores" ? ok(storesGolden()) : ok({})));
    const payload = await run();
    expect(logBlob(api)).not.toContain(ACCESS);
    expect(JSON.stringify(payload)).not.toContain(ACCESS);
  });
});

describe("THE `unknown` rule — the seller is kept, whole", () => {
  beforeEach(() => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "stores" ? ok(storesGolden()) : ok({})));
  });

  it("all three serviceability states arrive, in the route's order, none dropped", async () => {
    const payload = await run();
    expect((payload["stores"] as Record<string, unknown>[]).map((s) => s["serviceability"])).toEqual(
      ["serviceable", "unknown", "not_serviceable"],
    );
  });

  it("the `unknown` seller keeps its offer, its fulfillment, its values AND its handoff", async () => {
    const entry = storeFor(await run(), GOLDEN_HOSTS.unknown);
    expect(entry["serviceability"]).toBe("unknown");
    expect(entry["offer"]).toBeTypeOf("object");
    expect((entry["offer"] as Record<string, unknown>)["price"]).toBe("529.000000");
    expect(entry["fulfillment"]).toEqual([]);
    expect(entry["values"]).toBeTypeOf("object");
    expect(entry["handoff"]).toEqual({
      url: "https://backcountry.com/cart/lange-lx-120",
      source: "buy_url",
    });
  });

  it("no seller carries an exclusion / filter / deprioritisation marker", async () => {
    const wire = storesGolden();
    const payload = await run();
    (payload["stores"] as Record<string, unknown>[]).forEach((entry, i) => {
      const wireEntry = (wire["stores"] as Record<string, unknown>[])[i];
      expect(Object.keys(entry).sort()).toEqual(Object.keys(wireEntry).sort());
      for (const banned of ["excluded", "filtered", "usable", "deprioritised", "rank", "hidden"]) {
        expect(entry).not.toHaveProperty(banned);
      }
    });
  });

  it("the whole body crosses VERBATIM — deep-equal against the golden", async () => {
    const payload = await run();
    const { status: _s, advisories: _a, ...body } = payload;
    expect(body).toEqual(storesGolden());
  });

  it("a body where EVERY seller is `unknown` still returns every seller", async () => {
    // The realistic v0 shape: nothing writes policy evidence, so this is what a
    // typical answer looks like. A consumer that filtered would return zero.
    const wire = storesGolden();
    for (const entry of wire["stores"] as Record<string, unknown>[]) {
      entry["serviceability"] = "unknown";
      delete entry["policy_evidence"];
    }
    installRouter((kind) => (kind === "stores" ? ok(clone(wire)) : ok({})));
    const payload = await run(undefined, "call-all-unknown");
    expect(payload["status"]).toBe("ok");
    expect((payload["stores"] as unknown[]).length).toBe(3);
  });

  it("an additive server field on a seller reaches the agent", async () => {
    const wire = storesGolden();
    (wire["stores"] as Record<string, unknown>[])[1]["sil_future_field"] = "additive";
    installRouter((kind) => (kind === "stores" ? ok(clone(wire)) : ok({})));
    const entry = storeFor(await run(undefined, "call-additive"), GOLDEN_HOSTS.unknown);
    expect(entry["sil_future_field"]).toBe("additive");
  });
});

describe("`unset` is stated, never zero and never free", () => {
  beforeEach(() => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "stores" ? ok(storesGolden()) : ok({})));
  });

  it("cost / free_threshold arrive as `{}` — not a zero range, not an absent key", async () => {
    const payload = await run();
    for (const host of Object.values(GOLDEN_HOSTS)) {
      const entry = storeFor(payload, host);
      expect(entry).toHaveProperty("cost");
      expect(entry).toHaveProperty("free_threshold");
      expect(entry["cost"]).toEqual({});
      expect(entry["free_threshold"]).toEqual({});
    }
  });

  it("return-window / restocking-fee / charged_currency arrive as `{state:'unset'}`", async () => {
    const entry = storeFor(await run(), GOLDEN_HOSTS.serviceable);
    expect(entry["charged_currency"]).toEqual({ state: "unset" });
    const values = entry["values"] as Record<string, unknown>;
    expect(values["return_window_days"]).toEqual({ state: "unset" });
    expect(values["restocking_fee"]).toEqual({ state: "unset" });
  });

  it("an `unset` entry carries `state` and NOTHING else — no value-shaped null", async () => {
    const entry = storeFor(await run(), GOLDEN_HOSTS.unknown);
    const values = entry["values"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(values["return_window_days"])).toEqual(["state"]);
  });
});

describe("the handoff names its own promise", () => {
  beforeEach(() => {
    seedTokens(ACCESS, REFRESH);
    installRouter((kind) => (kind === "stores" ? ok(storesGolden()) : ok({})));
  });

  it("EVERY seller's handoff carries both `url` and `source`", async () => {
    const payload = await run();
    for (const entry of payload["stores"] as Record<string, unknown>[]) {
      const handoff = entry["handoff"] as Record<string, unknown>;
      expect(typeof handoff["url"]).toBe("string");
      expect((handoff["url"] as string).length).toBeGreaterThan(0);
      expect(["buy_url", "url"]).toContain(handoff["source"]);
    }
  });

  it("both sources appear — a checkout path and a listing page are different promises", async () => {
    const payload = await run();
    const sources = (payload["stores"] as Record<string, unknown>[]).map(
      (s) => (s["handoff"] as Record<string, unknown>)["source"],
    );
    expect(new Set(sources)).toEqual(new Set(["buy_url", "url"]));
  });

  it("`url` is never copied into `buy_url` to manufacture a checkout promise", async () => {
    const entry = storeFor(await run(), GOLDEN_HOSTS.serviceable);
    const offer = entry["offer"] as Record<string, unknown>;
    expect(offer).not.toHaveProperty("buy_url");
    expect(entry["handoff"]).toEqual({ url: offer["url"], source: "url" });
  });
});

describe("the two refusals that are NOT serviceability answers", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it("no destination anywhere → an `invalid_request` that ASKS for one", async () => {
    // "You did not say where you are" and "we never read this seller's policy"
    // are different gaps with different remedies. The route refuses rather than
    // answering `unknown` for everyone, and the tool must not soften that into
    // an empty or all-unknown answer.
    installRouter((kind) =>
      kind === "stores" ? { status: 400, body: STORES_400_NO_DESTINATION } : ok({}),
    );
    const payload = await run({ ref: REF });
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["message"]).toBe(STORES_400_NO_DESTINATION.message);
    expect(payload).not.toHaveProperty("stores");
    expect(payload).not.toHaveProperty("destination");
  });

  it("the no-destination refusal is distinguishable from EVERY serviceability answer", async () => {
    installRouter((kind) =>
      kind === "stores" ? { status: 400, body: STORES_400_NO_DESTINATION } : ok({}),
    );
    const refusal = await run({ ref: REF }, "call-refusal");
    vi.restoreAllMocks();
    installRouter((kind) => (kind === "stores" ? ok(storesGolden()) : ok({})));
    const answer = await run(undefined, "call-answer");
    expect(refusal["status"]).not.toBe(answer["status"]);
    expect(refusal["status"]).toBe("invalid_request");
    expect(answer["status"]).toBe("ok");
  });

  it("A5 — a 404 is `not_found`: no `recovery`, not retryable, and no empty seller list", async () => {
    // A 200-with-`stores: []` would read as "nobody sells this", which is a lie
    // by omission — the route declines to send it and the plugin must not
    // manufacture it.
    installRouter((kind) => (kind === "stores" ? { status: 404, body: STORES_404 } : ok({})));
    const payload = await run({ ref: "variant:0198f2a1-4c3d-7000-8000-00000000dead" });
    expect(payload["status"]).toBe("not_found");
    expect(payload["message"]).toBe(STORES_404.message);
    expect(payload).not.toHaveProperty("recovery");
    expect(payload).not.toHaveProperty("stores");
    expect(payload["status"]).not.toBe("retryable");
  });

  it("a 404 does NOT clear the stored tokens — auth was fine", async () => {
    installRouter((kind) => (kind === "stores" ? { status: 404, body: STORES_404 } : ok({})));
    await run({ ref: "variant:gone" });
    expect(readTokens()?.access_token).toBe(ACCESS);
  });

  it("A1 at the tool — a 200 missing `sources` is `retryable`, never `ok`", async () => {
    installRouter((kind) => (kind === "stores" ? ok(storesMissing("sources")) : ok({})));
    const payload = await run();
    expect(payload["status"]).toBe("retryable");
    expect(payload).not.toHaveProperty("stores");
  });
});

describe("the shared auth arms", () => {
  beforeEach(() => seedTokens(ACCESS, REFRESH));

  it("A9 — a first 401 recovers silently through the shared choreography", async () => {
    const router = installRouter((kind, nth) => {
      if (kind === "stores") return nth === 0 ? { status: 401, body: AUTH.unauthorized } : ok(storesGolden());
      if (kind === "refresh") return rotated("at-rotated", "rt-rotated");
      return ok({});
    });
    const payload = await run();
    expect(payload["status"]).toBe("ok");
    expect(router.refresh).toHaveLength(1);
    expect(bearerToken(router.stores[1])).toBe("at-rotated");
  });

  it("403 `user_not_provisioned` clears; `principal_mismatch` does not; 503 is retryable", async () => {
    installRouter((kind) =>
      kind === "stores" ? { status: 403, body: AUTH.principalMismatch } : ok({}),
    );
    expect((await run(undefined, "call-a"))["reason"]).toBe("principal_mismatch");
    expect(readTokens()?.access_token).toBe(ACCESS);

    vi.restoreAllMocks();
    installRouter((kind) =>
      kind === "stores" ? { status: 503, body: AUTH.serviceUnavailable } : ok({}),
    );
    expect((await run(undefined, "call-b"))["status"]).toBe("retryable");
    expect(readTokens()?.access_token).toBe(ACCESS);

    vi.restoreAllMocks();
    installRouter((kind) =>
      kind === "stores" ? { status: 403, body: AUTH.userNotProvisioned } : ok({}),
    );
    expect((await run(undefined, "call-c"))["reason"]).toBe("user_not_provisioned");
    expect(readTokens()).toBeNull();
  });
});
