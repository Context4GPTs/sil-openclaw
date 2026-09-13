/**
 * INTEGRATION — A3: the frozen journey's Brief compiles to the contract's own two
 * bodies, and refuses by name what the catalog would refuse.
 *
 * THE BODIES ARE §3.9's, LIFTED FROM THE CONTRACT — `scripts/contract-examples.mjs`, the
 * same path the pass-through bars use. A body a test author typed here would prove the
 * compiler agrees with that author; an edit to §3.9 moves this bar instead.
 *
 * The Brief is the journey's (sil-stage/e2e/eval/buyer-journey.golden.json): ask 1 after
 * the foot-width answer, and the helmet after its two. Only the REGISTRY is doubled, at
 * the HTTP boundary — the document store, the row parsing, the typing and the refusals
 * are the real ones, so nothing green here is green over a stub.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { writeDocument } from "../lib/doc-store.js";
import { getTool } from "./helpers/mock-plugin-api.js";
import {
  installRouter,
  ok,
  payloadOf,
  seedTokens,
  useShoppingHarness,
  type Recorded,
  type Router,
} from "./helpers/shopping-harness.js";
import { contractAlternate, contractResponse } from "./helpers/shopping-wire.js";

const TOOL = "shopping_brief_compile";
const BOOTS = "product.sports.winter.ski.boots";
const HELMETS = "product.sports.winter.ski.helmets";
const REF = "brief:chamonix";
const ACCESS = "at-live-token";
const REFRESH = "rt-live-token";

/**
 * The registry, as `shopping_domain_get` answers it for the two categories — one read
 * hands back both vocabularies (§3.2). `skill_level` and `sole_norm` are deliberately
 * ABSENT from the boots' keys: they are what the buyer needs and the domain does not
 * hold, and the contract's own body sends them anyway.
 */
const REGISTRY: Record<string, { specs: unknown[]; seller_specs: unknown[] }> = {
  [BOOTS]: {
    specs: [
      { key: "mondo_size", display_name: "Mondopoint size", type: "number", unit: "cm", variant_spec: true, operators: ["eq", "in"] },
      { key: "model_year", display_name: "Model year", type: "number", product_spec: true, operators: ["eq", "in", "gte", "lte"] },
      { key: "flex_index", display_name: "Flex index", type: "number", unit: "flex", operators: ["gte", "lte"] },
      { key: "last_width", display_name: "Last width", type: "number", unit: "mm", operators: ["gte", "lte"] },
      { key: "discipline", display_name: "Discipline", type: "enum", allowed_values: ["alpine", "freeride"], operators: ["eq", "in", "neq", "nin"] },
      { key: "brand", display_name: "Brand", type: "enum", operators: ["eq", "in", "neq", "nin"] },
    ],
    seller_specs: [
      { key: "return_window_days", display_name: "Return window", type: "number", unit: "days", operators: ["gte", "lte"] },
      { key: "duties_included", display_name: "Duties included", type: "boolean", operators: ["eq"] },
    ],
  },
  [HELMETS]: {
    specs: [
      { key: "head_circumference", display_name: "Head circumference", type: "number", unit: "cm", variant_spec: true, operators: ["eq", "in"] },
    ],
    seller_specs: [
      { key: "return_window_days", display_name: "Return window", type: "number", unit: "days", operators: ["gte", "lte"] },
    ],
  },
};

/** The Brief the journey leaves after beat 3 — hard-wrapped, as a model writes it. */
const BRIEF = [
  "## Context",
  "",
  "A week in Chamonix, the second week of February.",
  "",
  "## Items",
  "",
  "| item | domain | status |",
  "|---|---|---|",
  `| ski boots | ${BOOTS} | open |`,
  `| helmet | ${HELMETS} | open |`,
  "",
  "### ski boots",
  "ski boots for the upcoming season, size 27.5, advanced skier, up to 300 euros;",
  "GripWalk soles; resort, a week in Chamonix in February",
  "applies: mondo_size, skill_level, flex_index, last_width, sole_norm, model_year, price",
  "",
  "### helmet",
  "a ski helmet for the same trip, it has to work with my goggles",
  "applies: head_circumference, price",
  "",
  "## Hard constraints",
  "",
  "| domain | key | op | value | unit |",
  "|---|---|---|---|---|",
  `| ${BOOTS} | mondo_size | eq | 27.5 | cm |`,
  `| ${BOOTS} | skill_level | eq | advanced |  |`,
  `| ${BOOTS} | flex_index | gte | 110 | flex |`,
  `| ${BOOTS} | flex_index | lte | 130 | flex |`,
  `| ${BOOTS} | last_width | gte | 100 | mm |`,
  `| ${BOOTS} | last_width | lte | 102 | mm |`,
  `| ${BOOTS} | sole_norm | eq | gripwalk |  |`,
  `| ${BOOTS} | model_year | gte | 2026 |  |`,
  `| ${BOOTS} | price | lte | 300 | EUR |`,
  "| seller | return_window_days | gte | 14 | days |",
  `| ${HELMETS} | head_circumference | eq | 58 | cm |`,
  `| ${HELMETS} | price | lte | 100 | EUR |`,
  "",
  "## Notes / open",
  "",
  "| dimension | why it is open |",
  "|---|---|",
  "| colour | the buyer has no preference |",
].join("\n");

/** The person on disk. Nothing of theirs may reach the compiled body — the address is
 * the agent's `ship_to` to add, and a fact is the Brief's to translate. */
const SHOPPER = [
  "## Who",
  "Skis a week a year.",
  "",
  "## Constraints",
  "Ships to the home address in Greece.",
].join("\n");

const harness = useShoppingHarness("brief-compile");

beforeEach(() => {
  seedTokens(ACCESS, REFRESH);
  expect(writeDocument({ ref: "shopper", mode: "create", name: "Ioannis", body: SHOPPER }).ok).toBe(true);
  expect(writeDocument({ ref: REF, mode: "create", title: "Chamonix", body: BRIEF }).ok).toBe(true);
});

/** The registry double, at the HTTP boundary. An unrouted read lands in `other`. */
function scriptTheRegistry(): Router {
  return installRouter((kind, _nth, req: Recorded) => {
    if (kind !== "domainGet") return ok({});
    const path = decodeURIComponent(req.url.split("/catalog/domains/")[1] ?? "");
    const held = REGISTRY[path];
    if (held === undefined) {
      return { status: 404, body: { error: "not_found", message: `domain "${path}" does not stand` } };
    }
    return ok({ status: "ok", path, guide: "how they are bought", ...held });
  });
}

const compile = async (params: Record<string, unknown>): Promise<Record<string, unknown>> =>
  payloadOf(await getTool(harness.api, TOOL).execute("call-1", params));

describe("A3 — the journey's Brief compiles to the contract's own bodies", () => {
  it("ask 1, after the foot-width answer, is §3.9's first example — byte for byte", async () => {
    const router = scriptTheRegistry();
    expect(await compile({ ref: REF, item: "ski boots" })).toEqual(
      contractResponse(TOOL),
    );
    // ONE registry read, and nothing else: the compile spends no catalog call.
    expect(router.domainGet).toHaveLength(1);
    expect(router.all).toHaveLength(1);
    expect(router.search).toEqual([]);
    expect(router.offers).toEqual([]);
    expect(router.other).toEqual([]);
  });

  it("the same Brief in session 2 answers the same body — which is why session 2 asks nothing", async () => {
    // The compile is a function of the Brief and the registry, never of the session. A
    // body that drifted between sessions would make the warm run re-ask what is settled.
    scriptTheRegistry();
    const first = await compile({ ref: REF, item: "ski boots" });
    const second = await compile({ ref: REF, item: "ski boots" });
    expect(second).toEqual(first);
    expect(second).toEqual(contractResponse(TOOL));
  });

  it("the helmet, after its two answers, is §3.9's second example — the boots' returns row included", async () => {
    // A seller row is the JOB's, not the item's: the same Brief's returns row rides both
    // items' offers calls. Scoping it to the item it was written beside would silently
    // drop the buyer's one seller term from the second item.
    scriptTheRegistry();
    expect(await compile({ ref: REF, item: "helmet" })).toEqual(contractAlternate(TOOL));
  });

  it("a key the domain does not hold is SENT, as written", async () => {
    // Results over refusals. `skill_level` and `sole_norm` are the buyer's needs and the
    // registry holds neither; the search records them and answers them absent from `fit`,
    // so refusing here would cost the whole call for a key research has yet to coin.
    scriptTheRegistry();
    const specs = (await compile({ ref: REF, item: "ski boots" }))["specs"] as Record<string, unknown>[];
    expect(specs).toEqual(
      expect.arrayContaining([
        { key: "skill_level", op: "eq", value: "advanced" },
        { key: "sole_norm", op: "eq", value: "gripwalk" },
      ]),
    );
  });

  it("the Brief's `applies:` line stays in the Brief — it never rides the query", async () => {
    // Beat 3 writes `applies:` INSIDE the item's subsection, so it is prose by position
    // and bookkeeping by meaning. Sent, it reads to the index as words the buyer said —
    // measured live on the creation boot, where the query carried "applies: mondo_size,
    // flex_index, last_width" into the web leg.
    scriptTheRegistry();
    const query = (await compile({ ref: REF, item: "ski boots" }))["query"] as string;
    expect(query).not.toMatch(/applies:/i);
    expect(query).not.toMatch(/mondo_size/);
    // …and the buyer's own words are all still there, to the last clause.
    expect(query).toContain("ski boots for the upcoming season");
    expect(query).toContain("a week in Chamonix in February");
  });

  it("`in` on a key the domain does not hold still sends a LIST, not one long string", async () => {
    // List-ness belongs to the OPERATOR, not to the key: `in` over a comma-separated
    // cell is a list whether or not the registry can type its elements. Shipped as one
    // string, `"gripwalk, alpine"` is a value no listing can ever equal — a row that
    // silently matches nothing, which is exactly what the recorded-not-refused rule
    // exists to avoid.
    expect(writeDocument({ ref: REF, mode: "replace", title: "Chamonix", body: BRIEF.replace("| sole_norm | eq | gripwalk |  |", "| sole_norm | in | gripwalk, alpine |  |") }).ok).toBe(true);
    scriptTheRegistry();
    const specs = (await compile({ ref: REF, item: "ski boots" }))["specs"] as Record<string, unknown>[];
    expect(specs).toContainEqual({ key: "sole_norm", op: "in", value: ["gripwalk", "alpine"] });
  });

  it("the shopper's own document reaches neither body — no `ship_to`, no fact of theirs", async () => {
    // `ship_to` is the AGENT's to add from `## Constraints`, and a fact is the Brief's to
    // translate. A compile that helpfully folded either in would send an address the
    // buyer never chose for this job, under a body that still validates.
    scriptTheRegistry();
    const body = await compile({ ref: REF, item: "ski boots" });
    expect(Object.keys(body).sort()).toEqual([
      "domain",
      "item",
      "query",
      "seller_specs",
      "specs",
      "status",
    ]);
    expect(JSON.stringify(body)).not.toContain("Greece");
  });
});

describe("A3 — what the compile refuses, before any spend", () => {
  it("a malformed row on a KNOWN key is refused naming that key", async () => {
    // `flex_index` is a number the registry holds. "very stiff" is a value its type
    // refuses, and the search would refuse the whole call for it — so the refusal has to
    // name the row the agent must fix, not the request.
    expect(writeDocument({ ref: REF, mode: "replace", title: "Chamonix", body: BRIEF.replace("| flex_index | gte | 110 | flex |", "| flex_index | gte | very stiff | flex |") }).ok).toBe(true);
    scriptTheRegistry();
    const refusal = await compile({ ref: REF, item: "ski boots" });
    expect(refusal["status"]).toBe("invalid_request");
    expect(refusal["message"]).toContain("flex_index");
    expect(refusal["recovery"]).toBe("shopping_doc_write");
  });

  it("an operator the key does not list is refused naming the key", async () => {
    // The other half of "the same refusal the search would give": `mondo_size` takes
    // `eq` and `in`, and a `gte` on it is a row no registry key can answer.
    expect(writeDocument({ ref: REF, mode: "replace", title: "Chamonix", body: BRIEF.replace("| mondo_size | eq | 27.5 | cm |", "| mondo_size | gte | 27.5 | cm |") }).ok).toBe(true);
    scriptTheRegistry();
    const refusal = await compile({ ref: REF, item: "ski boots" });
    expect(refusal["status"]).toBe("invalid_request");
    expect(refusal["message"]).toContain("mondo_size");
  });

  it("money with no currency in its unit cell is refused naming the key", async () => {
    // sil holds no exchange rate, so a bound with no currency is one nothing can test.
    expect(writeDocument({ ref: REF, mode: "replace", title: "Chamonix", body: BRIEF.replace("| price | lte | 300 | EUR |", "| price | lte | 300 |  |") }).ok).toBe(true);
    scriptTheRegistry();
    const refusal = await compile({ ref: REF, item: "ski boots" });
    expect(refusal["status"]).toBe("invalid_request");
    expect(refusal["message"]).toContain("price");
  });

  it("an item whose domain cell is still empty is refused — beat 2 first", async () => {
    // Compiling it would search a category nobody settled, and the answer would read as
    // an ordinary miss.
    expect(writeDocument({ ref: REF, mode: "replace", title: "Chamonix", body: BRIEF.replace(`| helmet | ${HELMETS} | open |`, "| helmet |  | open |") }).ok).toBe(true);
    const router = scriptTheRegistry();
    const refusal = await compile({ ref: REF, item: "helmet" });
    expect(refusal["status"]).toBe("invalid_request");
    expect(refusal["recovery"]).toBe("shopping_domain_search");
    // Refused BEFORE the registry is touched — the refusal costs nothing.
    expect(router.all).toEqual([]);
  });

  it("a Brief that is not there is `not_found`, and an item that is not in it too", async () => {
    const router = scriptTheRegistry();
    expect((await compile({ ref: "brief:no-such-job", item: "ski boots" }))["status"]).toBe("not_found");
    const noItem = await compile({ ref: REF, item: "gloves" });
    expect(noItem["status"]).toBe("not_found");
    expect(noItem["recovery"]).toBe("shopping_doc_read");
    expect(router.all).toEqual([]);
  });

  it("a domain read missing a vocabulary is `retryable`, and the absent field is LOGGED", async () => {
    // Read as a category with no keys, a missing `seller_specs` would type every seller
    // row as one the registry does not hold and ship the Brief's raw strings. The agent
    // gets a status it can retry; the operator gets the field, which is the only part
    // that says where the registry defect is.
    installRouter((kind, _nth, req: Recorded) => {
      if (kind !== "domainGet") return ok({});
      const path = decodeURIComponent(req.url.split("/catalog/domains/")[1] ?? "");
      return ok({ status: "ok", path, guide: "g", specs: REGISTRY[BOOTS]?.specs });
    });
    expect((await compile({ ref: REF, item: "ski boots" }))["status"]).toBe("retryable");
    expect(
      vi.mocked(harness.api.logger.warn).mock.calls.find(
        (c) => c[0] === "shopping_brief_compile_domain_read_incomplete",
      )?.[1],
    ).toEqual({ domain: BOOTS, absent: ["seller_specs"] });
  });

  it("a domain that no longer stands comes back as the registry's own `not_found`", async () => {
    // Passed through, naming the path: the recovery is to read the registry again, not
    // to fix the Brief's rows.
    expect(writeDocument({ ref: REF, mode: "replace", title: "Chamonix", body: BRIEF.replace(HELMETS, "product.sports.winter.ski.goggles") }).ok).toBe(true);
    scriptTheRegistry();
    const refusal = await compile({ ref: REF, item: "helmet" });
    expect(refusal["status"]).toBe("not_found");
    expect(refusal["message"]).toContain("product.sports.winter.ski.goggles");
    expect(refusal["recovery"]).toBe("shopping_domain_search");
  });
});
