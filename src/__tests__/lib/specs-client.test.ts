/**
 * UNIT — `specsCatalog` HTTP wrapper param→request mapping (tier: unit, `fetch`
 * spied so nothing reaches the network).
 *
 * CARD `sds-specs-client-tool`. Pins the request-construction half of the specs
 * client in isolation (the classifier — the response half — is
 * `specs-classify.test.ts`). `specsCatalog(silApiUrl, token, params)` is the seam
 * where the agent's `{ query, specs }` become the sil-api `SpecsRequest` body and the
 * stored Bearer token becomes the `Authorization` header — the twin of
 * `searchCatalog`, but with NO filter mapping: the body is EXACTLY `{ query, specs }`,
 * forwarded verbatim (the plugin is pure transport for specs).
 *
 * What this file locks down (the request side):
 *   - the URL is the BARE `${silApiUrl}/catalog/specs` — no `/api/v1`, trailing slash
 *     on the base tolerated;
 *   - the method is POST with a JSON content-type and an `Authorization: Bearer
 *     <token>` header;
 *   - the body is EXACTLY `{ query, specs }` — the whole SpecDefinition array forwarded
 *     VERBATIM (all fields: namespace/key/display_name/data_type + optional
 *     description/unit/allowed_values), NEVER reshaped, NEVER spread, NEVER wrapped in
 *     a `filters`/`context`/UCP envelope;
 *   - on a thrown fetch (network/timeout) the wrapper returns `retryable` and the token
 *     never appears in the returned union (the never-leak invariant at the wrapper
 *     boundary; the tool-level log canary is in `tools/specs.test.ts`).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/sil-client.ts`:
 *   specsCatalog(
 *     silApiUrl: string,
 *     token: string,
 *     params: { query: string; specs: SpecDefinition[] },
 *   ): Promise<SpecsOutcome>
 *   It POSTs the body `{ query, specs }` to the bare `/catalog/specs` with the Bearer
 *   header, then returns `classifySpecsResponse(status, body)`. A thrown fetch →
 *   `{ kind: "retryable" }`. The exact param mapping below IS the immutable spec.
 *
 * EXPECT RED today: `specsCatalog` does not exist yet — the import binding is
 * undefined and every call throws "is not a function".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { specsCatalog } from "../../lib/sil-client.js";
import type { SpecDefinition } from "../../lib/sil-client.js";

const SIL_API = "https://sil-api.test.example.com";

// `satisfies SpecDefinition` pins each fixture to the closed request contract without
// widening `data_type` to `string` — a type-only anchor (erased at runtime; no
// assertion changes) that keeps `pnpm typecheck` honest against the real SpecDefinition.

/** One coined spec definition (the request half). All required fields present so the
 * wrapper forwards it verbatim without any read-site drop. */
const SPEC_A = {
  namespace: "product",
  key: "waterproofing",
  display_name: "Waterproofing",
  data_type: "number",
  unit: "mm",
} satisfies SpecDefinition;

const SPEC_B = {
  namespace: "seller",
  key: "handmade",
  display_name: "Handmade",
  data_type: "boolean",
} satisfies SpecDefinition;

const SPEC_C = {
  namespace: "product",
  key: "closure_type",
  display_name: "Closure Type",
  data_type: "enum",
  description: "How the item fastens.",
  allowed_values: ["zip", "velcro", "buckle"],
} satisfies SpecDefinition;

interface Captured {
  url: string;
  method: string;
  bearer: string | null;
  contentType: string | null;
  body: unknown;
}

/** Spy `fetch` and capture the single outbound request, replying 200 with a real
 * (single-resolution) body so the wrapper resolves cleanly. The reply is the BARE
 * sil-api body (`{ resolved }` — top level, no `ucp`/`result` wrapper), the only shape
 * sil-api emits. */
function spyFetch(captured: Captured[]): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      captured.push({
        url: typeof input === "string" ? input : String(input),
        method: (init?.method ?? "GET").toUpperCase(),
        bearer: headers["Authorization"] ?? headers["authorization"] ?? null,
        contentType: headers["content-type"] ?? headers["Content-Type"] ?? null,
        body,
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            resolved: [
              {
                namespace: "product",
                key: "waterproof_rating",
                display_name: "Waterproof Rating",
                data_type: "number",
                unit: "mm",
                is_filterable: true,
                is_comparable: true,
                submitted: { namespace: "product", key: "waterproofing" },
                canonical: { namespace: "product", key: "waterproof_rating" },
                status: "matched",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("specsCatalog — endpoint, method, and auth header", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("POSTs the BARE /catalog/specs path (no /api/v1 anywhere)", async () => {
    await specsCatalog(SIL_API, "tok", { query: "hiking gloves", specs: [SPEC_A] });
    expect(cap).toHaveLength(1);
    expect(new URL(cap[0]!.url).pathname).toBe("/catalog/specs");
    expect(cap[0]!.url).not.toContain("/api/v1");
    expect(cap[0]!.url).toBe(`${SIL_API}/catalog/specs`);
  });

  it("tolerates a trailing slash on the base URL (no double slash)", async () => {
    await specsCatalog(`${SIL_API}/`, "tok", { query: "gloves", specs: [SPEC_A] });
    expect(cap[0]!.url).toBe(`${SIL_API}/catalog/specs`);
    expect(cap[0]!.url).not.toContain("//catalog");
  });

  it("uses POST with a JSON content-type and the stored Bearer token", async () => {
    await specsCatalog(SIL_API, "the-access-token", { query: "gloves", specs: [SPEC_A] });
    expect(cap[0]!.method).toBe("POST");
    expect(cap[0]!.contentType).toMatch(/application\/json/);
    expect(cap[0]!.bearer).toBe("Bearer the-access-token");
  });
});

describe("specsCatalog — body is EXACTLY { query, specs } (pure transport, no filter mapping, no envelope)", () => {
  let cap: Captured[];
  beforeEach(() => {
    cap = [];
    spyFetch(cap);
  });

  it("forwards { query, specs } VERBATIM — whole-body exact, the spec array unchanged", async () => {
    await specsCatalog(SIL_API, "tok", { query: "hiking gloves", specs: [SPEC_A, SPEC_B, SPEC_C] });
    // The strongest single assertion: byte-exact whole body. NO `filters` wrapper (this
    // is NOT search — specs ride the top level), NO reshaping of the definitions.
    expect(cap[0]!.body).toEqual({
      query: "hiking gloves",
      specs: [SPEC_A, SPEC_B, SPEC_C],
    });
  });

  it("carries every SpecDefinition field verbatim — description / unit / allowed_values survive whole", async () => {
    // The enriched-def pass-through: a definition carrying the optional
    // description/unit/allowed_values must reach the wire intact — the backend dedupes
    // on the FULL definition (a `{ namespace, key }` narrow would strand the richer
    // fields the registry uses to match). Pins the whole SPEC_C object survives.
    await specsCatalog(SIL_API, "tok", { query: "gloves", specs: [SPEC_C] });
    const body = cap[0]!.body as Record<string, unknown>;
    expect((body["specs"] as unknown[])[0]).toEqual(SPEC_C);
  });

  it("builds NO UCP envelope and injects NO context (no protocol/version/domain/enrichment/filters)", async () => {
    await specsCatalog(SIL_API, "tok", { query: "gloves", specs: [SPEC_A] });
    const body = cap[0]!.body as Record<string, unknown>;
    for (const forbidden of ["protocol", "version", "domain", "enrichment", "context", "filters", "pagination"]) {
      expect(body[forbidden]).toBeUndefined();
    }
    // The body carries EXACTLY the two keys — nothing else.
    expect(Object.keys(body).sort()).toEqual(["query", "specs"]);
  });

  it("forwards the FULL specs array (never truncates / dedups / reorders it)", async () => {
    await specsCatalog(SIL_API, "tok", { query: "gloves", specs: [SPEC_A, SPEC_B] });
    const specs = (cap[0]!.body as Record<string, unknown>)["specs"] as unknown[];
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual(SPEC_A);
    expect(specs[1]).toEqual(SPEC_B);
  });
});

describe("specsCatalog — transport failure maps to retryable without leaking the token", () => {
  it("a thrown fetch (network/timeout) → retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("simulated network failure"));
    const out = await specsCatalog(SIL_API, "tok", { query: "gloves", specs: [SPEC_A] });
    expect(out.kind).toBe("retryable");
  });

  it("the returned union NEVER carries the access token (privacy at the wrapper boundary)", async () => {
    const SECRET = "wrapper-secret-token";

    // Success path.
    spyFetch([]);
    const ok = await specsCatalog(SIL_API, SECRET, { query: "gloves", specs: [SPEC_A] });
    expect(JSON.stringify(ok)).not.toContain(SECRET);
    vi.restoreAllMocks();

    // Thrown path.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const thrown = await specsCatalog(SIL_API, SECRET, { query: "gloves", specs: [SPEC_A] });
    expect(JSON.stringify(thrown)).not.toContain(SECRET);
  });
});
