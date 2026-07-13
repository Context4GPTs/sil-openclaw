/**
 * UNIT — sil_search tool: registration shape + the client-side ≥1-input guard +
 * the token-log canary (tier: unit, mock api + temp data dir, `fetch` spied so
 * nothing reaches the network).
 *
 * Covers the unit-tier acceptance criteria that live at the TOOL boundary (the
 * request-mapping + classifier pure pieces are pinned in
 * `lib/search-client.test.ts` and `lib/search-classify.test.ts`; the full wired
 * pipeline + the three-distinct-outcomes taxonomy are the integration tier's job
 * in `catalog-search.integration.test.ts`). Here we assert:
 *
 *   - the tool-registration shape (a `sil_search` tool with a typed parameter
 *     object: `query` + optional `category`/`price_min`/`price_max`/`cursor`/`limit`);
 *   - the CLIENT-SIDE ≥1-input guard the tool owns: a request with neither a
 *     non-empty `query` nor any filter (`{}`, or a whitespace-only `query` with no
 *     filter) returns a structured validation error naming the missing input and
 *     makes ZERO network calls (sil-api's `empty_search_input` 400 is the
 *     authoritative backstop, but the cheap client guard saves the round-trip);
 *   - a filter-only request (e.g. `category` alone, no `query`) is ACCEPTED (UCP
 *     browse) and DOES reach the network — the guard must not over-reject;
 *   - the not-registered short-circuit: no tokens.json → terminal `not_registered`
 *     (recovery `sil_register`), ZERO network;
 *   - the token-log canary: on every path the stored token never appears in any
 *     logger call at any level.
 *
 * Hermetic via the `SIL_DATA_DIR` temp-dir override and the config-reset
 * machinery mirrored from the sil_whoami / sil_register unit tests.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - src/tools/catalog.ts#registerCatalogTools(api) registers a `sil_search`
 *     tool whose parameters are a Type.Object with `query` (optional) plus
 *     optional `category`, `price_min`, `price_max`, `cursor`, `limit`;
 *   - execute() returns a jsonResult; with neither query nor a filter it returns
 *     a structured validation error and calls no fetch; with a filter only it
 *     proceeds; with no tokens.json it returns a terminal not_registered hint and
 *     calls no fetch.
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

const TOOL = "sil_search";

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

/** Seed a valid token pair so the search proceeds past the not-registered guard. */
function seedTokens(access = "stored-at", refresh = "stored-rt"): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getTokensPath(),
    JSON.stringify({ access_token: access, refresh_token: refresh }),
    { mode: 0o600 },
  );
}

/** A 200 real (empty-match) body, so a forwarded request resolves cleanly. The
 * FLAT sil-api shape (`{ products, pagination }` — top level, no `result` wrapper),
 * the only shape sil-api emits. */
function okEnvelopeFetch(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        products: [],
        pagination: { has_next_page: false },
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

/** Spy `fetch`, reply 200 empty-match, and capture the parsed request body of the
 * single outbound call into `captured[0]`. Used by the `readSearchParams`
 * narrowing tests, which assert a wrong-typed param is DROPPED before it reaches
 * the wire body (the read-site guard, exercised through the real tool execute). */
function captureBodyFetch(captured: unknown[]): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation((_input: unknown, init?: RequestInit) => {
    if (typeof init?.body === "string") {
      try {
        captured.push(JSON.parse(init.body));
      } catch {
        captured.push(init.body);
      }
    } else {
      captured.push(null);
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          products: [],
          pagination: { has_next_page: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-search-unit-"));
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

describe("sil_search — tool registration shape", () => {
  it("registers a sil_search tool with a typed query + optional filter/pagination params", () => {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const tool = getTool(api, TOOL);
    expect(tool.name).toBe(TOOL);
    expect(tool.label.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
    // A TypeBox object whose properties include the simplified search inputs.
    expect((tool.parameters as { type?: unknown }).type).toBe("object");
    const props = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    const keys = Object.keys(props);
    for (const expected of ["query", "category", "price_min", "price_max", "cursor", "limit"]) {
      expect(keys).toContain(expected);
    }
  });
});

/**
 * Card `add-ship-to-filter-args-to-the-sil-search-tool`: the schema gains
 * optional serviceability/localization params, each with a self-describing
 * per-field `description` (agents read field descriptions independently of the
 * tool description, so each must stand alone). Shapes pinned to the architect's
 * immutable contract + the Shopify Global-Catalog extension
 * (`vendor/shopify/docs/agents/catalog/global-catalog-extension.md:26-33`):
 *   - `ship_to`     : object { country (required), region?, postal_code? }
 *   - `condition`   : array of strings
 *   - `available`   : boolean
 * All are `Type.Optional` — the whole param is omittable; `country` is
 * required only WITHIN the ship_to object.
 *
 * Card `replace-ships-from-with-local-merchants` DELETED `ships_from` end-to-end
 * (live correlation tests settled it is the wrong lever) — so this block no longer
 * declares or shapes a `ships_from` param. Its absence is asserted explicitly in
 * the "ships_from is GONE" block below; `local_merchants` (the boolean bias that
 * replaces it) is in its own block further down.
 */
describe("sil_search — schema exposes the new optional filter params (shapes + per-field descriptions)", () => {
  function searchProps(): Record<string, Record<string, unknown>> {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as {
      properties?: Record<string, Record<string, unknown>>;
    };
    return params.properties ?? {};
  }

  it("declares ship_to / condition / available as properties", () => {
    const keys = Object.keys(searchProps());
    for (const expected of ["ship_to", "condition", "available"]) {
      expect(keys).toContain(expected);
    }
  });

  it("ship_to is an object whose `country` is required, with optional region + postal_code", () => {
    const shipTo = searchProps()["ship_to"];
    expect(shipTo).toBeDefined();
    expect(shipTo!["type"]).toBe("object");
    const sub = (shipTo!["properties"] ?? {}) as Record<string, unknown>;
    for (const k of ["country", "region", "postal_code"]) {
      expect(Object.keys(sub)).toContain(k);
    }
    // `country` is required WITHIN the object (the override needs a destination);
    // region/postal_code are optional refinements.
    expect(shipTo!["required"]).toEqual(["country"]);
  });

  it("condition is an array of strings", () => {
    const condition = searchProps()["condition"];
    expect(condition).toBeDefined();
    expect(condition!["type"]).toBe("array");
    const items = (condition!["items"] ?? {}) as Record<string, unknown>;
    expect(items["type"]).toBe("string");
  });

  it("available is a boolean", () => {
    const available = searchProps()["available"];
    expect(available).toBeDefined();
    expect(available!["type"]).toBe("boolean");
  });

  it("each new param carries a non-empty, self-describing `description`", () => {
    const props = searchProps();
    for (const k of ["ship_to", "condition", "available"]) {
      expect(props[k]).toBeDefined();
      const desc = props[k]!["description"];
      expect(typeof desc).toBe("string");
      expect((desc as string).length).toBeGreaterThan(0);
    }
  });

  it("the ship_to field description repeats the empty=registered-default / override framing (agents read field descriptions in isolation)", () => {
    // The architect's contract: the per-field description must stand alone, since
    // an agent may read it without the tool description. It must convey BOTH that
    // omitting it uses the registered/default address AND that it is an override.
    const shipTo = searchProps()["ship_to"];
    expect(shipTo).toBeDefined();
    const desc = String(shipTo!["description"] ?? "").toLowerCase();
    expect(desc).toMatch(/default|registered|omit|leave.*empty|absent/);
    expect(desc).toMatch(/override|different|else|another/);
  });
});

/**
 * RE-SPEC (founder directive 2026-06-11) — the TIGHTENED, Shopify-grounded contract
 * both the plugin and sil-api's `@sil/schemas` (`ShipTo`/`ShipFrom`) enforce
 * IDENTICALLY. The prior cycle shipped a THIN contract: `ship_to.country` was a bare
 * `Type.String()` with no `pattern`, so the plugin forwarded free text like
 * `"United States"` or `region: "Bavaria"` and sil-api's closed schema 400'd it — a
 * fail-late mismatch the agent could not recover from. The fix pins the format into
 * the SCHEMA (a `pattern` both sides validate), so the plugin rejects bad FORMAT
 * client-side instead of fail-late at sil-api.
 *
 * These read the `pattern` straight off the registered tool's `parameters`
 * JSON-schema (the same introspection the shape tests above use; TypeBox
 * `Type.String({ pattern })` puts `pattern` on the property node, and nested object
 * props are reachable via `props.ship_to.properties.country.pattern` — probe-verified
 * for this repo's typebox build). The patterns mirror `@sil/schemas` byte-for-byte:
 *   - country (ships_to + ships_from) : ^[A-Za-z]{2}$        (ISO 3166-1 alpha-2)
 *   - region                          : ^[A-Za-z0-9]{1,3}$   (ISO 3166-2 subdivision)
 *   - postal_code (single self-contained pattern: length-cap lookahead + structural,
 *     so the sibling can mirror it from the same directive text — no separate
 *     minLength/maxLength keyword to keep in lockstep):
 *       ^(?=[A-Za-z0-9 -]{2,12}$)[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$
 */
describe("sil_search — schema pins the tightened format patterns (both sides enforce identically)", () => {
  const COUNTRY_PATTERN = "^[A-Za-z]{2}$";
  const REGION_PATTERN = "^[A-Za-z0-9]{1,3}$";
  const POSTAL_PATTERN = "^(?=[A-Za-z0-9 -]{2,12}$)[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$";

  function searchProps(): Record<string, Record<string, unknown>> {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as {
      properties?: Record<string, Record<string, unknown>>;
    };
    return params.properties ?? {};
  }

  function shipToSub(): Record<string, Record<string, unknown>> {
    const shipTo = searchProps()["ship_to"];
    expect(shipTo).toBeDefined();
    return (shipTo!["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  }

  it("ship_to.country carries the ISO 3166-1 alpha-2 pattern `^[A-Za-z]{2}$`", () => {
    expect(shipToSub()["country"]!["pattern"]).toBe(COUNTRY_PATTERN);
  });

  it("ship_to.region carries the ISO 3166-2 subdivision pattern `^[A-Za-z0-9]{1,3}$`", () => {
    expect(shipToSub()["region"]!["pattern"]).toBe(REGION_PATTERN);
  });

  it("ship_to.postal_code carries the bounded postal pattern (length-cap + structural)", () => {
    expect(shipToSub()["postal_code"]!["pattern"]).toBe(POSTAL_PATTERN);
  });

  it("the alpha-2 country pattern actually ACCEPTS 2-letter codes and REJECTS country names (the pattern is enforceable, not decorative)", () => {
    // Compile the schema's own pattern and exercise it — a pattern that is present
    // but wrong (e.g. too loose) would pass the string-equality checks above yet
    // fail to reject `"United States"`. This proves the pinned pattern is the right
    // one, not just a present one.
    const re = new RegExp(shipToSub()["country"]!["pattern"] as string);
    for (const ok of ["US", "us", "DE", "gb"]) expect(re.test(ok), `accept ${ok}`).toBe(true);
    for (const bad of ["United States", "USA", "U", "germany", ""]) expect(re.test(bad), `reject ${bad}`).toBe(false);
  });

  it("the region pattern ACCEPTS subdivision codes and REJECTS place names (`California`, `Βαυαρία`)", () => {
    const re = new RegExp(shipToSub()["region"]!["pattern"] as string);
    for (const ok of ["CA", "NY", "BY", "97"]) expect(re.test(ok), `accept ${ok}`).toBe(true);
    for (const bad of ["California", "Βαυαρία", "NYC1", "ny "]) expect(re.test(bad), `reject ${bad}`).toBe(false);
  });

  it("the postal pattern ACCEPTS real national formats and REJECTS prose / injection / overlong", () => {
    const re = new RegExp(shipToSub()["postal_code"]!["pattern"] as string);
    for (const ok of ["94107", "EC1A 1BB", "K1A 0B1", "10001"]) expect(re.test(ok), `accept ${ok}`).toBe(true);
    for (const bad of ["San Francisco, CA, 94107", "94107; DROP TABLE", "1234567890123", "EC1A  1BB", " 94107", "Βαυαρία"]) {
      expect(re.test(bad), `reject ${bad}`).toBe(false);
    }
  });
});

/**
 * THE LOAD-BEARING DELIVERABLE (card Intent + handoff contract #6): the tool
 * `description` is the only lever that steers the agent off the redundant
 * `sil_whoami` round-trip. These assertions pin the two required steering phrases
 * so a future edit cannot silently delete the round-trip-avoidance contract.
 * Asserted against the registered `description` string — the same surface the
 * agent reads and the same pattern the suite already uses for tool strings.
 */
describe("sil_search — description encodes the empty=registered-default steering contract (load-bearing)", () => {
  function description(): string {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    return getTool(api, TOOL).description;
  }

  it("states that leaving ship_to empty/absent uses the user's REGISTERED DEFAULT address, resolved server-side by sil-api", () => {
    const d = description().toLowerCase();
    // The empty=registered-default contract: it must name the registered/default
    // address as what an omitted ship_to resolves to, server-side.
    expect(d).toMatch(/registered|default/);
    expect(d).toMatch(/address/);
    // And tie that resolution to the server / sil-api (not the plugin/agent).
    expect(d).toMatch(/server|sil-api|sil api/);
  });

  it("explicitly steers the agent AWAY from calling sil_whoami merely to populate ship_to (names the anti-pattern)", () => {
    // The headline: the description must name `sil_whoami` and tell the agent NOT
    // to call it just to fetch an address to resubmit. This is the exact waste the
    // card exists to kill; a vague description leaves the agent reflexively
    // round-tripping. The negative framing ("do not"/"don't"/"never"/"no need")
    // must co-occur with the sil_whoami reference.
    const d = description();
    expect(d).toMatch(/sil_whoami/);
    expect(d.toLowerCase()).toMatch(/do not|don't|never|no need|avoid|without/);
  });

  it("frames ship_to as an OVERRIDE — supplied only to ship to a DIFFERENT destination, not as a required input", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/ship_to/);
    expect(d).toMatch(/override|different|else|another destination|elsewhere/);
  });

  it("documents condition and available each as optional filters by what they constrain (no implied prior tool call)", () => {
    const d = description().toLowerCase();
    // product condition / availability — each named. (`ships_from` is GONE — its
    // absence from the tool description is asserted in the "ships_from is GONE" block.)
    expect(d).toMatch(/condition/);
    expect(d).toMatch(/new|used|secondhand|condition/);
    expect(d).toMatch(/available|availability|unavailable|in stock|out of stock/);
  });
});

/**
 * RE-SPEC (founder directive 2026-06-11) — the tool description is the LOAD-BEARING
 * control surface that makes the agent send STANDARD CODES, never free text. The
 * prior thin description told the agent the alpha-2 shape only in passing; the
 * re-spec demands an explicit "send standard ISO codes, not natural-language place
 * names" steer plus per-field FORMAT instructions, so the agent never sends
 * `country: "United States"` or `region: "California"` (which the tightened schema
 * now rejects client-side — a worse, opaque UX than just sending the code).
 *
 * These ADD to the two steering-phrase assertions above (which stay verbatim — empty
 * ship_to ⇒ registered default server-side; do NOT call sil_whoami). They do NOT
 * re-assert those; they pin the NEW format-language the re-spec introduces.
 */
describe("sil_search — description steers the agent to ISO CODES, not free text (re-spec)", () => {
  function description(): string {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    return getTool(api, TOOL).description;
  }

  it("contains an explicit 'send standard ISO codes, not free text / natural-language place names' steer", () => {
    const d = description().toLowerCase();
    // It must name ISO/standard CODES as the required form AND name the anti-form
    // (free text / place names / country names) the agent must NOT send.
    expect(d).toMatch(/iso|standard code|2-letter|two-letter|alpha-2|alpha 2/);
    expect(d).toMatch(/not.*(free text|name|place|natural)|never.*(name|free text)|code.*not.*name/);
  });

  it("states the country format: a 2-letter ISO 3166-1 alpha-2 code, with example codes (US/GB/DE)", () => {
    const d = description();
    // The country format instruction must name the alpha-2 standard AND show codes
    // (not country names) as the example, so the agent copies the right shape.
    expect(d.toLowerCase()).toMatch(/alpha-2|alpha 2|3166-1|two-letter|2-letter/);
    expect(d).toMatch(/\bUS\b|\bGB\b|\bDE\b/); // example CODES, not "United States"
  });

  it("states the region format: an ISO 3166-2 subdivision CODE (e.g. CA/NY/BY), not a place name", () => {
    const d = description();
    expect(d.toLowerCase()).toMatch(/3166-2|subdivision|region code/);
    // Names the code form and example codes — and that it is NOT a place name.
    expect(d).toMatch(/\bCA\b|\bNY\b|\bBY\b/);
    expect(d.toLowerCase()).toMatch(/not.*(place|name|free text)|code.*not.*name/);
  });

  it("states the condition values are exactly new / secondhand (lowercase)", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/new/);
    expect(d).toMatch(/secondhand/);
  });
});

/**
 * RE-SPEC: per-field `description` self-describes its FORMAT (agents read field
 * descriptions independently of the tool description). The thin contract's per-field
 * descriptions named the alpha-2 shape loosely; the re-spec requires each field's
 * own description to carry the exact format language so an agent reading only the
 * field still sends a code, not a name.
 */
describe("sil_search — each location field's per-field description self-describes its format (re-spec)", () => {
  function searchProps(): Record<string, Record<string, unknown>> {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as {
      properties?: Record<string, Record<string, unknown>>;
    };
    return params.properties ?? {};
  }
  function shipToSub(): Record<string, Record<string, unknown>> {
    return (searchProps()["ship_to"]!["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  }

  it("ship_to.country field description names the 2-letter ISO 3166-1 alpha-2 code form (a code, not a country name)", () => {
    const desc = String(shipToSub()["country"]!["description"] ?? "");
    expect(desc.toLowerCase()).toMatch(/alpha-2|alpha 2|3166-1|2-letter|two-letter/);
    expect(desc).toMatch(/\bUS\b|\bGB\b|\bDE\b/);
  });

  it("ship_to.region field description names the ISO 3166-2 subdivision code form (a code, not a place name)", () => {
    const desc = String(shipToSub()["region"]!["description"] ?? "");
    expect(desc.toLowerCase()).toMatch(/3166-2|subdivision|region code|code/);
    expect(desc).toMatch(/\bCA\b|\bNY\b|\bBY\b/);
    expect(desc.toLowerCase()).toMatch(/not.*(place|name)|code.*not.*name/);
  });

  it("condition field description names exactly the new / secondhand value set", () => {
    const desc = String(searchProps()["condition"]!["description"] ?? "").toLowerCase();
    expect(desc).toMatch(/new/);
    expect(desc).toMatch(/secondhand/);
  });
});

/**
 * Card `replace-ships-from-with-local-merchants` (epic `local-merchants-2026-06`):
 * `sil_search` gains a `local_merchants` OPTIONAL BOOLEAN that biases results toward
 * shops based in the user's own country — best-effort, server-ranked. The plugin
 * owns ONLY the surface: the param shape + the agent-facing per-field description.
 *
 * The DESCRIPTION is the entire behavioral deliverable (an LLM is the only consumer;
 * it reads the field description to decide when to set the flag and what it can
 * promise). Three load-bearing facts MUST be unmistakable (Discovery "Behavioral
 * framing", AC[unit]):
 *   (a) BEST-EFFORT BIAS, never a filter/guarantee that every result is local;
 *   (b) issue the `query` in the USER'S LANGUAGE to surface local shops;
 *   (c) the agent passes NO country and must NOT call sil_whoami — sil resolves the
 *       user's country server-side from their registered address.
 * Asserted against the registered `parameters` JSON-schema (the same introspection
 * the shape tests above use; `Type.Optional(Type.Boolean({ description }))` puts the
 * description on the property node).
 */
describe("sil_search — schema exposes `local_merchants` as an optional boolean with a per-field description", () => {
  function searchProps(): Record<string, Record<string, unknown>> {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as {
      properties?: Record<string, Record<string, unknown>>;
    };
    return params.properties ?? {};
  }
  /** The `local_merchants` per-field description string (the deliverable). */
  function localMerchantsDesc(): string {
    const prop = searchProps()["local_merchants"];
    expect(prop, "local_merchants must be a registered param").toBeDefined();
    return String(prop!["description"] ?? "");
  }

  it("declares `local_merchants` as a property", () => {
    expect(Object.keys(searchProps())).toContain("local_merchants");
  });

  it("`local_merchants` is typed as a boolean (a plain bool bias, NOT a { country } object)", () => {
    const prop = searchProps()["local_merchants"];
    expect(prop).toBeDefined();
    expect(prop!["type"]).toBe("boolean");
    // It must NOT be an object carrying a country — a country arg would re-create the
    // identity round-trip this epic exists to delete (Discovery "Why a boolean bias").
    expect(prop!["type"]).not.toBe("object");
    expect(prop!["properties"]).toBeUndefined();
  });

  it("`local_merchants` is OPTIONAL — omittable from the call (NOT in the schema's required set)", () => {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as { required?: unknown };
    const required = Array.isArray(params.required) ? (params.required as string[]) : [];
    expect(required).not.toContain("local_merchants");
  });

  it("`local_merchants` carries a non-empty, self-describing per-field description", () => {
    expect(localMerchantsDesc().length).toBeGreaterThan(0);
  });

  it("fact (a): the description frames it as a BEST-EFFORT BIAS, not a guaranteed filter — and explicitly disclaims exclusivity", () => {
    const d = localMerchantsDesc().toLowerCase();
    // It must name the SOFT-bias mechanic …
    expect(d).toMatch(/bias|nudge|prefer|toward|favou?r/);
    // … AND carry the explicit disclaimer that it is NOT a filter / NOT a guarantee
    // and does NOT make every result local (the lesson that killed ships_from — the
    // surface must be honest so the agent never inherits a false promise).
    expect(d).toMatch(/not a filter|does not restrict|do not restrict|doesn't restrict|not.*guarantee|no guarantee|not exclusiv|may still appear|won't be detected|will not be detected/);
  });

  it("fact (b): the description offers issuing the `query` in the local/country's language as an OPTIONAL tactic to surface local shops", () => {
    const d = localMerchantsDesc().toLowerCase();
    expect(d).toMatch(/language/);
    expect(d).toMatch(/query/);
    // The concrete steer: a country-language query surfaces local shops — but framed
    // as an OPTIONAL tactic, never a forced override of a language the user
    // deliberately chose (the reframe that answers the locale-forcing concern).
    expect(d).toMatch(/that country'?s language|the local language|country'?s language/);
    expect(d).toMatch(/optional|may also|you may|never overriding|deliberately chose/);
  });

  it("fact (c): the description says the agent passes NO country and must NOT call sil_whoami (sil resolves it server-side)", () => {
    const d = localMerchantsDesc();
    // Names the anti-pattern (sil_whoami) and forbids it …
    expect(d).toMatch(/sil_whoami/);
    expect(d.toLowerCase()).toMatch(/do not|don'?t|never|no need|without|no country/);
    // … and says the country is resolved server-side (so the agent owns no such fact).
    expect(d.toLowerCase()).toMatch(/server.side|sil resolves|resolved by sil|registered address/);
  });

  it("the `local_merchants` copy never promises EXCLUSIVITY — the soft-bias framing is unmistakable (forbidden-words check)", () => {
    // AC[unit]: it must NOT use "only"/"filter"/"restrict to"/"guarantee" in a way
    // that promises results are exclusively local. The honest disclaimer NEEDS those
    // words in NEGATED form ("NOT a filter", "does NOT restrict results to them",
    // "does NOT guarantee every result is local"), so we must NOT flag a promissory
    // phrase that is part of a NEGATED clause. Strategy: blank out negated spans
    // first (a negation word through the end of its clause), THEN look for any
    // remaining BARE promissory claim. This catches "guarantees every result is
    // local" while allowing "does NOT guarantee every result is local".
    const raw = localMerchantsDesc().toLowerCase();
    // Remove negated clauses: a negation token ("not"/"no"/"never"/"n't"/"without")
    // up to the next clause boundary (— , . ; : or end). This neutralizes the honest
    // disclaimers so only affirmative (promissory) claims remain to be judged.
    const affirmativeOnly = raw.replace(
      /(?:\bnot\b|\bno\b|\bnever\b|n't|\bwithout\b)[^—.,;:]*/g,
      " ",
    );
    const promissory = [
      /\bonly local\b/,
      /\ball (the )?results? (are|will be) local/,
      /\bexclusively local\b/,
      /\bguarantee(d|s)?\b[^—.,;:]*\blocal\b/,
      /\brestricts? (results? )?to\b/,
      /\bfilters? (results? )?to (only )?local\b/,
      /\ball (of )?(the )?(sellers?|shops?|merchants?) (are|will be) local/,
    ];
    for (const p of promissory) {
      expect(affirmativeOnly, `must not promise exclusivity via ${p}`).not.toMatch(p);
    }
    // And the disclaimer is affirmatively present (so an impl can't pass by simply
    // omitting all framing — the soft-bias caveat MUST be stated). Checked on the
    // RAW copy (the negation IS the disclaimer we want to see).
    expect(raw).toMatch(/not a filter|does not restrict|do not restrict|not.*guarantee|no guarantee|may still appear|won'?t be detected|not exclusiv/);
  });
});

/**
 * Card `replace-ships-from-with-local-merchants`: the tool-LEVEL description steers
 * the agent on `local_merchants` (best-effort local bias + query-in-user's-language)
 * and contains NO sentence describing `ships_from` (AC[unit]). The tool description is
 * a distinct surface from the per-field one; both must be clean of the deleted lever.
 */
describe("sil_search — tool-level description steers on local_merchants and is free of ships_from", () => {
  function description(): string {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    return getTool(api, TOOL).description;
  }

  it("the tool description mentions `local_merchants` and frames it as a (best-effort) local bias", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/local_merchants/);
    expect(d).toMatch(/local|domestic|home.country/);
  });

  it("the tool description steers the agent to query in the user's language for local shops", () => {
    const d = description().toLowerCase();
    expect(d).toMatch(/language/);
  });

  it("the tool description contains NO `ships_from` sentence (the deleted lever is gone from the agent-facing prose)", () => {
    expect(description()).not.toMatch(/ships_from/i);
  });
});

/**
 * CARD `surface-product-url-and-specs-in-catalog-tools` (epic
 * `catalog-product-contract-2026-06`) — the RED unit ceiling for the `sil_search`
 * tool DESCRIPTION (AC[unit] ×2). The description is the ONLY control surface that
 * steers the LLM to the right field for the right intent — the wire already carries
 * `url` (view the page), `seller.links` (dig into seller policies), and
 * `checkout_url` (buy), but an LLM only learns WHICH field maps to WHICH intent from
 * the description string. So the three verbs are pinned here, the same description-
 * only discipline the `ship_to` steering and the `local_merchants` framing use.
 *
 * The product gap these assertions close: today every result is "a buy button with
 * nothing to evaluate before buying" — the description names only id/title/price/
 * availability/checkout_url/source. After this card the description must teach the
 * THREE actions distinctly:
 *   - VIEW   — product/variant `url` opens the PAGE to learn more (NOT a purchase);
 *   - DIG IN — `seller.links` follow seller policies/info (refund/shipping policy);
 *   - BUY    — `checkout_url` is the variant permalink that commits the purchase.
 *
 * EXPECT RED today: the current `sil_search` description (catalog.ts ~line 97) carries
 * none of `url` / `seller.links` / the view-vs-buy distinction — the projection is the
 * lean six and the description matches it. These assert the agent-facing prose, the
 * same surface the agent reads; `tsc` cannot verify a description's CONTENT, so the
 * unit tier owns it (mirrors `tool-schema-contract.unit.test.ts` reading `.description`).
 */
describe("sil_search — description teaches the three verbs: view (url) / dig-in (seller.links) / buy (checkout_url) [card surface-product-url]", () => {
  function description(): string {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    return getTool(api, TOOL).description;
  }

  it("names product/variant `url` as the VIEW / learn-more action — opening the PAGE, NOT buying", () => {
    // AC[unit]: `url` = open the PAGE to view / learn more (NOT buy). The agent must
    // know that handing the user a `url` shows them the page; it is not a purchase.
    const d = description();
    // The field is named …
    expect(d).toMatch(/\burl\b/);
    const dl = d.toLowerCase();
    // … and tied to a VIEW / open-the-page / learn-more intent (not a purchase verb).
    expect(dl).toMatch(/view|open the page|learn more|page to|product page|see (the|more)/);
  });

  it("names `seller.links` (or seller policy links) as the DIG-IN action — following seller policies / info", () => {
    // AC[unit]: `seller.links` = follow for seller policies / info (the dig-in verb,
    // e.g. "what's their return policy?"). The agent must know this is where it
    // follows a seller's policy/info link, distinct from viewing the product page.
    const d = description();
    // The seller-links surface is named (either the dotted key or "seller" + "links").
    expect(d).toMatch(/seller\.links|seller[^.]*links|links[^.]*seller/i);
    const dl = d.toLowerCase();
    // … tied to seller policies / info (refund/shipping/return policy, terms, etc.).
    expect(dl).toMatch(/polic|seller info|return|refund|shipping|terms/);
  });

  it("keeps `checkout_url` distinct as the BUY action — the variant permalink that commits a purchase", () => {
    // AC[unit]: `checkout_url` = buy (the variant permalink). The existing buy verb
    // must remain unambiguous as the ONE field that commits a purchase, so the agent
    // never confuses it with the new view/dig-in fields.
    const d = description();
    expect(d).toMatch(/checkout_url/);
    const dl = d.toLowerCase();
    expect(dl).toMatch(/buy|purchase|acquire|checkout/);
  });

  it("states that a variant's `url` and its `checkout_url` are DIFFERENT targets (view the page vs commit the purchase)", () => {
    // AC[unit] #2: the headline distinction. A variant has BOTH a `url` (the page —
    // view) and a `checkout_url` (the permalink — buy); the description must keep them
    // DIFFERENT so the agent does not hand back `checkout_url` for a "show me / learn
    // more" intent, nor stall on `url` when the user said "buy". This is the exact
    // mis-fire the description exists to prevent (it is the only control surface).
    const d = description();
    // Both targets must be named in the prose so the contrast is statable.
    expect(d).toMatch(/\burl\b/);
    expect(d).toMatch(/checkout_url/);
    const dl = d.toLowerCase();
    // The description must explicitly contrast them — a "url is NOT checkout_url",
    // "different", "distinct", or "view … vs … buy" framing. A description that names
    // both but never contrasts them leaves the agent free to conflate the two.
    expect(dl).toMatch(
      /url[^.]*not[^.]*checkout_url|checkout_url[^.]*not[^.]*url|differ|distinct|whereas|rather than|view[^.]*(buy|purchase|checkout)|(buy|purchase)[^.]*(view|page|learn)/,
    );
  });
});

/**
 * Card `replace-ships-from-with-local-merchants`: `ships_from` is GONE end-to-end —
 * no schema param, and a stray `ships_from` argument is NOT silently accepted (the
 * closed schema / params narrowing drops it before the wire). AC[unit] +
 * AC[integration] (the wire-absence half is also pinned in the integration suites).
 */
describe("sil_search — ships_from is GONE from the schema (no param, the agent can no longer pass it)", () => {
  function searchProps(): Record<string, Record<string, unknown>> {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as {
      properties?: Record<string, Record<string, unknown>>;
    };
    return params.properties ?? {};
  }

  it("the schema has NO `ships_from` property (closed against it)", () => {
    expect(Object.keys(searchProps())).not.toContain("ships_from");
  });

  it("a stray `ships_from` argument is DROPPED — it never reaches the wire body", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    // A drifted on-disk call still passes `ships_from`; the params narrowing must
    // drop it (the schema no longer knows the key), so it appears NOWHERE in the body
    // — not at the top level and not under `filters`.
    await getTool(api, TOOL).execute("c1", { query: "chair", ships_from: { country: "US" } });

    const body = bodies[0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("ships_from");
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("ships_from");
    expect(JSON.stringify(body)).not.toContain("ships_from");
  });
});

describe("sil_search — client-side ≥1-input guard (reject empty BEFORE any network)", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A token IS present (so the guard, not the not-registered path, is what
    // rejects); fetch fails loudly if the guard lets an empty request through.
    seedTokens();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("empty request must not hit the network"));
    api = createMockPluginApi();
    registerCatalogTools(api);
  });

  it("a bare {} → structured validation error, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", {}));
    expect(fetchSpy).not.toHaveBeenCalled();
    // A distinct, actionable validation error naming the missing input.
    expect(payload["status"]).not.toBe("ok");
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).toMatch(/query|filter/);
    expect(blob).toMatch(/status|error|invalid/);
  });

  it("a whitespace-only query with NO filter → validation error, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "   " }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).not.toBe("ok");
    expect(JSON.stringify(payload).toLowerCase()).toMatch(/query|filter/);
  });

  it("an empty-string query with NO filter → validation error, ZERO network calls", async () => {
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).not.toBe("ok");
  });

  it("a bare { local_merchants: true } STILL rejects empty_search_input — the bias is a REFINEMENT, not an input (hasUsableInput untouched)", async () => {
    // Card AC: `local_merchants` biases an EXISTING search; it does not constitute
    // one (exactly as `ships_from` was, exactly as `cursor`/`limit` are). A request
    // whose ONLY content is `local_merchants: true` must be rejected client-side with
    // `empty_search_input` and make ZERO network calls — proof the implementation did
    // NOT touch `hasUsableInput` to let the flag through.
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { local_merchants: true }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("empty_search_input");
  });
});

describe("sil_search — the guard does NOT over-reject a valid filter-only browse", () => {
  it("a filter-only request (category, no query) PROCEEDS to the network (UCP browse)", async () => {
    seedTokens();
    const fetchSpy = okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { category: "Furniture" }));

    // The guard must NOT reject a filter-only browse — it reaches the network.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload["status"]).toBe("ok");
  });

  it("a price-filter-only request (price_min, no query/category) PROCEEDS to the network", async () => {
    seedTokens();
    const fetchSpy = okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { price_min: 5000 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * `readSearchParams` (catalog.ts) narrows the untrusted, host-provided params.
 * Card AC[unit]: a field of the WRONG type at the read site (a drifted on-disk
 * call) is DROPPED — treated as absent — never coerced, mirroring the existing
 * `readIds` discipline (no `any`, no unchecked cast). A dropped field must not
 * reach the wire body. Exercised through the real tool execute with a
 * body-capturing fetch spy (tool-boundary unit: mock api + temp dir + spied
 * fetch). A real `query` rides alongside so the request clears the input guard
 * and the malformed filter's ABSENCE in the body is observable.
 */
describe("sil_search — readSearchParams drops wrong-typed new filter args (narrowing, no coercion)", () => {
  it("`available` as a string is dropped (not coerced to a boolean) — no filters.available on the wire", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    // `available: "true"` is the wrong type. It must NOT become filters.available.
    await getTool(api, TOOL).execute("c1", { query: "chair", available: "true" });

    const body = bodies[0] as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("available");
  });

  it("`condition` as a non-array (bare string) is dropped — no filters.condition on the wire", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", condition: "new" });

    const body = bodies[0] as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("condition");
  });

  it("`ship_to` as a primitive (string) is dropped — no filters.ships_to on the wire", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", ship_to: "US" });

    const body = bodies[0] as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("ships_to");
    expect(filters).not.toHaveProperty("ship_to");
  });

  it("a valid `available: false` STILL survives the read site (the drop is type-driven, not value-driven)", async () => {
    // Guards against an over-eager narrowing that drops false along with the
    // wrong-typed cases. false is a VALID boolean and must reach the wire.
    seedTokens();
    const bodies: unknown[] = [];
    captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair", available: false });

    const body = bodies[0] as Record<string, unknown>;
    const filters = (body["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).toHaveProperty("available", false);
  });
});

describe("sil_search — not registered (no tokens.json) short-circuit", () => {
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
    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).not.toBe("ok");
    expect(payload["products"]).toBeUndefined();
    expect(JSON.stringify(payload)).toContain("sil_register");
  });

  it("does NOT crash and resolves promptly when not registered", async () => {
    const result = await getTool(api, TOOL).execute("c1", { query: "chair" });
    expect(result).toBeTypeOf("object");
    expect(result.content[0]?.text).toBeTypeOf("string");
  });
});

describe("sil_search — token never logged (leak-canary)", () => {
  it("on the SUCCESS path, no logger call carries the access token", async () => {
    seedTokens("leak-canary-access", "leak-canary-refresh");
    okEnvelopeFetch();
    const api = createMockPluginApi();
    registerCatalogTools(api);

    await getTool(api, TOOL).execute("c1", { query: "chair" });

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

    await getTool(api, TOOL).execute("c1", { query: "chair" });

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

    const blob = JSON.stringify(payloadOf(await getTool(api, TOOL).execute("c1", { query: "chair" })));
    expect(blob).not.toContain("secret-access-token");
    expect(blob).not.toContain("secret-refresh-token");
    expect(blob).not.toMatch(/Bearer/i);
    expect(blob).not.toMatch(/authorization/i);
  });
});

/**
 * CARD `sds-forward-specs-contract` (epic `spec-driven-shopping-redesign`, Phase 2)
 * — the RED unit floor for the `specs` param at the TOOL boundary: the SCHEMA shape
 * (AC-A1), the description steer (AC-A1), the `invalid_spec` client-side rejection
 * (AC-P4), the empty-vs-malformed split + `exists` validity (AC-A2), and specs-as-
 * usable-input (AC-A3).
 *
 * `sil_search` gains an OPTIONAL `specs: SpecPredicate[]` — a CLOSED shape over an
 * OPEN vocabulary: `{ ns, key, op, value?, unit?, hard? }`. `ns`/`key` carry NO enum
 * and NO pattern (enumerating a `ns.key` is the central schema the design FORBIDS —
 * [[sds-specs-vocabulary-is-bottom-up]]); `op` is exactly the seven literals; `value`
 * is optional in the SCHEMA (an `exists` carries none) — the op↔value validity is a
 * READ-SITE rule (`readSpecs`), the established flat-schema + read-site-enforcement
 * idiom (`readSearchParams`/`ship_to`, NOT a new pattern). A malformed predicate
 * rejects the WHOLE request client-side with code `invalid_spec`, ZERO network — the
 * `invalid_filter`/`ship_to` twin.
 *
 * EXPECT RED today: the schema has no `specs` property, the description names no
 * `specs` steer, and the tool neither validates nor forwards `specs` — so a malformed
 * predicate is silently ignored (no `invalid_spec`) and a specs-only request is
 * rejected as `empty_search_input` (not counted as usable input).
 */
describe("sil_search — schema exposes `specs` as an optional closed-shape / open-vocabulary array (AC-A1)", () => {
  function searchProps(): Record<string, Record<string, unknown>> {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as {
      properties?: Record<string, Record<string, unknown>>;
    };
    return params.properties ?? {};
  }
  /** The `specs` array's per-item object schema node. */
  function specItemProps(): Record<string, Record<string, unknown>> {
    const specs = searchProps()["specs"];
    expect(specs, "specs must be a registered param").toBeDefined();
    const items = (specs!["items"] ?? {}) as Record<string, unknown>;
    return (items["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  }
  /** Collect the literal values `op` allows, from whichever JSON-schema encoding
   * TypeBox emits for a union-of-literals (`enum`, or `anyOf`/`oneOf` of `const`). */
  function opLiterals(): string[] {
    const op = specItemProps()["op"];
    expect(op, "spec item must have an `op`").toBeDefined();
    if (Array.isArray(op!["enum"])) return (op!["enum"] as unknown[]).map(String);
    const union = (op!["anyOf"] ?? op!["oneOf"]) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(union)) {
      return union
        .map((m) => (m["const"] !== undefined ? m["const"] : Array.isArray(m["enum"]) ? (m["enum"] as unknown[])[0] : undefined))
        .filter((v): v is unknown => v !== undefined)
        .map(String);
    }
    return [];
  }

  it("declares `specs` as an optional array of objects (NOT in the required set)", () => {
    const specs = searchProps()["specs"];
    expect(specs).toBeDefined();
    expect(specs!["type"]).toBe("array");
    const items = (specs!["items"] ?? {}) as Record<string, unknown>;
    expect(items["type"]).toBe("object");

    const api = createMockPluginApi();
    registerCatalogTools(api);
    const params = getTool(api, TOOL).parameters as { required?: unknown };
    const required = Array.isArray(params.required) ? (params.required as string[]) : [];
    expect(required).not.toContain("specs");
  });

  it("each predicate has props ns / key / op / value / unit / hard", () => {
    const keys = Object.keys(specItemProps());
    for (const k of ["ns", "key", "op", "value", "unit", "hard"]) {
      expect(keys).toContain(k);
    }
  });

  it("ns and key are OPEN strings — NO enum, NO pattern (enumerating a ns.key is the schema the design forbids)", () => {
    // The load-bearing open-vocabulary guard: a `ns`/`key` enum or pattern would be
    // the central spec registry the bottom-up design deliberately refuses. They are
    // two SEPARATE plain-string wire fields, never a dotted string, never constrained.
    for (const field of ["ns", "key"]) {
      const node = specItemProps()[field];
      expect(node, `${field} must exist`).toBeDefined();
      expect(node!["type"]).toBe("string");
      expect(node!["enum"]).toBeUndefined();
      expect(node!["pattern"]).toBeUndefined();
    }
  });

  it("op is a union of EXACTLY the seven operators {eq,neq,gte,lte,in,nin,exists}", () => {
    expect(new Set(opLiterals())).toEqual(
      new Set(["eq", "neq", "gte", "lte", "in", "nin", "exists"]),
    );
  });

  it("unit is an optional string and hard is an optional boolean", () => {
    expect(specItemProps()["unit"]!["type"]).toBe("string");
    expect(specItemProps()["hard"]!["type"]).toBe("boolean");
  });

  it("value is present but NOT required within a predicate (an `exists` carries none — op↔value is a read-site rule)", () => {
    const specs = searchProps()["specs"];
    const items = (specs!["items"] ?? {}) as Record<string, unknown>;
    const req = Array.isArray(items["required"]) ? (items["required"] as string[]) : [];
    // `value` is schema-optional (validity is enforced at readSpecs, not the schema).
    expect(req).not.toContain("value");
    expect(req).not.toContain("unit");
    expect(req).not.toContain("hard");
  });
});

describe("sil_search — description steers `specs` as the open long-tail channel + prefer-a-dedicated-param (AC-A1)", () => {
  function description(): string {
    const api = createMockPluginApi();
    registerCatalogTools(api);
    return getTool(api, TOOL).description;
  }

  it("names `specs` as the structured channel for the OPEN long-tail (attributes with no dedicated param)", () => {
    const d = description();
    expect(d).toMatch(/specs/);
    const dl = d.toLowerCase();
    // It is the channel for structured requirements that have no dedicated param —
    // the additive long-tail (capacity, rating, delivery days, …).
    expect(dl).toMatch(/structured|requirement|attribute|long.tail|no dedicated/);
  });

  it("states PREFER A DEDICATED PARAM over a `specs` predicate for the same attribute, listing the reserved attributes", () => {
    // Business rule 1 as a description steer (NOT a tool guard — the open-vocabulary
    // design forbids a hardcoded ns.key→param map). The prose must tell the agent to
    // route price/category/condition/availability/destination to their dedicated
    // params and NOT double-constrain via a specs predicate.
    const d = description();
    const dl = d.toLowerCase();
    expect(dl).toMatch(/prefer|instead of|rather than|do not use.*specs|not.*specs.*dedicated/);
    // The reserved attributes with dedicated params are named so the agent knows the gap.
    expect(dl).toMatch(/price/);
    expect(dl).toMatch(/categor/);
    expect(dl).toMatch(/condition/);
    expect(dl).toMatch(/availab/);
    expect(dl).toMatch(/ship_to|destination|deliver/);
  });
});

describe("sil_search — a MALFORMED predicate rejects the whole request client-side with `invalid_spec`, ZERO network (AC-P4)", () => {
  let api: MockPluginAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A token IS present, so the read-site validation (not the not-registered path)
    // is what rejects; fetch fails loudly if a malformed spec slips to the wire.
    seedTokens();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("a malformed spec must not hit the network"));
    api = createMockPluginApi();
    registerCatalogTools(api);
  });

  /** Each entry: a label + the malformed predicate. A real `query` rides alongside so
   * the request would ITSELF be valid — proving the malformed predicate rejects the
   * WHOLE request (mirrors invalid_filter / ship_to), not merely an empty one. */
  const MALFORMED: Array<[string, Record<string, unknown>]> = [
    ["op outside the seven", { ns: "product", key: "x", op: "contains", value: "y" }],
    ["blank ns", { ns: "", key: "x", op: "eq", value: 1 }],
    ["blank key", { ns: "product", key: "", op: "eq", value: 1 }],
    ["missing ns", { key: "x", op: "eq", value: 1 }],
    ["value-op with NO value (eq)", { ns: "product", key: "x", op: "eq" }],
    ["in with a NON-array value", { ns: "product", key: "x", op: "in", value: "medium" }],
    ["nin with a NON-array value", { ns: "product", key: "x", op: "nin", value: "medium" }],
    ["gte with a NON-number value", { ns: "product", key: "x", op: "gte", value: "big" }],
    ["lte with a NON-number value", { ns: "product", key: "x", op: "lte", value: "small" }],
    ["exists CARRYING a value", { ns: "product", key: "x", op: "exists", value: 5 }],
  ];

  for (const [label, predicate] of MALFORMED) {
    it(`rejects (${label}) → invalid_request/invalid_spec, ZERO network`, async () => {
      const payload = payloadOf(
        await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [predicate] }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(payload["status"]).toBe("invalid_request");
      expect(payload["error"]).toBe("invalid_spec");
    });
  }

  it("rejects even when the malformed predicate is the SECOND entry (validates the whole list, names the offender)", async () => {
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "gloves",
        specs: [
          { ns: "product", key: "waterproof_rating", op: "gte", value: 10000 },
          { ns: "product", key: "color", op: "in", value: "red" }, // in ⇒ array; malformed
        ],
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("invalid_spec");
    // The message must name the offending predicate so the agent can fix it (mirrors
    // invalid_filter naming `ship_to.country`). The offender is index 1 / its key.
    expect(JSON.stringify(payload)).toMatch(/color|1|spec/i);
  });

  it("is DISTINCT from invalid_filter — a malformed spec is `invalid_spec`, not the ship_to `invalid_filter` code", async () => {
    // The read arm carries a `code` so the right envelope fires. A malformed spec must
    // never be mislabelled as a location-filter problem.
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [{ ns: "product", key: "x", op: "eq" }] }),
    );
    expect(payload["error"]).toBe("invalid_spec");
    expect(payload["error"]).not.toBe("invalid_filter");
  });
});

describe("sil_search — empty vs malformed specs split; `exists`-without-value is VALID; non-array dropped (AC-A2)", () => {
  it("a benign `specs: []` alongside a real query is NOT invalid_spec — it PROCEEDS and forwards NO filters.specs", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    const fetchSpy = captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { query: "gloves", specs: [] }));

    expect(fetchSpy).toHaveBeenCalledTimes(1); // proceeded, not rejected
    expect(payload["status"]).toBe("ok");
    const filters = ((bodies[0] as Record<string, unknown>)["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("specs"); // empty ⇒ no-op omit
  });

  it("`specs: []` as the request's ONLY content falls to `empty_search_input` (empty specs are no usable input), ZERO network", async () => {
    seedTokens();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("empty specs is no usable input — must not hit the network"));
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(await getTool(api, TOOL).execute("c1", { specs: [] }));

    expect(fetchSpy).not.toHaveBeenCalled();
    // NOT invalid_spec (nothing is malformed) — it is the existing empty-input guard.
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["error"]).toBe("empty_search_input");
  });

  it("an `exists` predicate with NO value is VALID (not invalid_spec) — it proceeds and rides filters.specs", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    const fetchSpy = captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        query: "tent",
        specs: [{ ns: "product", key: "waterproof_rating", op: "exists" }],
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload["status"]).toBe("ok");
    const filters = ((bodies[0] as Record<string, unknown>)["filters"] ?? {}) as Record<string, unknown>;
    expect(filters["specs"]).toEqual([{ ns: "product", key: "waterproof_rating", op: "exists" }]);
  });

  it("a `specs` that is NOT an array is DROPPED (treated absent), not coerced — with a query it proceeds and forwards no filters.specs", async () => {
    seedTokens();
    const bodies: unknown[] = [];
    const fetchSpy = captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    // A drifted on-disk call passes a non-array `specs`; the read site drops it (the
    // `readIds` discipline), never rejecting as invalid_spec and never coercing.
    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", { query: "gloves", specs: "not-an-array" }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload["status"]).toBe("ok");
    expect(payload["error"]).not.toBe("invalid_spec");
    const filters = ((bodies[0] as Record<string, unknown>)["filters"] ?? {}) as Record<string, unknown>;
    expect(filters).not.toHaveProperty("specs");
  });
});

describe("sil_search — a non-empty well-formed `specs` COUNTS as usable input (AC-A3)", () => {
  it("a specs-only request (no query, no dedicated filter) PROCEEDS to the network — a spec is a real constraint, not a refinement", async () => {
    // The counterpart to the `local_merchants`/`cursor`/`limit` refinements (which do
    // NOT constitute a search): a well-formed spec renders + filters, so it is a real
    // input. `hasUsableInput` must count it — RED today (specs is ignored, so a
    // specs-only request is rejected as empty_search_input and never reaches fetch).
    seedTokens();
    const bodies: unknown[] = [];
    const fetchSpy = captureBodyFetch(bodies);
    const api = createMockPluginApi();
    registerCatalogTools(api);

    const payload = payloadOf(
      await getTool(api, TOOL).execute("c1", {
        specs: [{ ns: "product", key: "capacity_gb", op: "gte", value: 512 }],
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload["status"]).toBe("ok");
    // And the predicate rode the wire under the one namespaced key.
    const filters = ((bodies[0] as Record<string, unknown>)["filters"] ?? {}) as Record<string, unknown>;
    expect(filters["specs"]).toEqual([{ ns: "product", key: "capacity_gb", op: "gte", value: 512 }]);
  });
});
