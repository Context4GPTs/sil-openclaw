/**
 * `shopping_brief_compile` — beats 3 to 5: the Brief's own rows as the two calls they
 * make, `specs` for the search and `seller_specs` for the offers. Local reads plus ONE
 * registry read; it writes nothing, searches nothing, and never restates `## Notes / open`.
 */

import type { PluginAPI, ToolResult } from "openclaw/plugin-sdk";
import { Value } from "typebox/value";

import { requestSchema, responseSchema } from "../lib/artifacts.js";
import { docFailureResult } from "../lib/doc-result.js";
import {
  domainMatches,
  itemProse,
  parseItems,
  parseSpecRows,
  readDocument,
  type SpecRow,
} from "../lib/doc-store.js";
import { wiringAdvisoryBlocks } from "../lib/host-wiring.js";
import {
  DOMAIN_GET_ROUTE,
  callRoute,
  transient,
  type ShoppingCall,
} from "../lib/shopping-call.js";
import { jsonResult } from "../lib/tool-result.js";

const TOOL = "shopping_brief_compile";

/** Read once at load, like every other artifact: an unreadable one is a broken build,
 * and a refusal must not cost two disk reads to phrase. */
const RESPONSE_ARTIFACT = responseSchema(TOOL);

/** The registry read, under THIS tool's name: the log marker and the recovery hint name
 * the tool the agent called, never the route behind it. */
const DOMAIN_READ: ShoppingCall = {
  ...DOMAIN_GET_ROUTE,
  name: TOOL,
  refusalRecovery: "shopping_domain_search",
};

/** `price` is a key every domain has without the read listing it (contract §3.4):
 * money, `gte` and `lte`, and its currency is required. */
const PRICE: RegistryKey = { type: "money", operators: ["gte", "lte"] };

/** A key the registry does not hold: no type to check a cell against, so each one
 * travels as the buyer wrote it. */
const UNTYPED: RegistryKey = { type: "", operators: [] };

const OPERATORS = ["eq", "neq", "gte", "lte", "in", "nin"];
const DECIMAL = /^-?\d+(\.\d+)?$/;
const AMOUNT = /^\d+(\.\d+)?$/;
const CURRENCY = /^[A-Z]{3}$/;

/** One key as the registry holds it — what types the value and what bounds the operator. */
interface RegistryKey {
  readonly type: string;
  readonly unit?: string;
  readonly allowedValues?: readonly string[];
  readonly operators: readonly string[];
}

type Vocabulary = ReadonlyMap<string, RegistryKey>;

/** One row of the compiled body, exactly as `shopping_search` takes it. */
interface Spec {
  key: string;
  op: string;
  value: unknown;
  currency?: string;
}

type Compiled =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; result: ToolResult };

export function registerBriefCompileTool(api: PluginAPI): void {
  api.registerTool({
    name: TOOL,
    label: "Compile a Brief item into its two calls",
    description:
      "Beats 3 to 5, the Brief as the calls it makes: name a Brief and one of its"
      + " `## Items` rows, and get back that item's settled `domain`, its own subsection"
      + " prose as `query`, the `## Hard constraints` and `## Preferences` rows whose"
      + " domain is the item's or an ancestor as `specs`, and the rows under `seller` as"
      + " `seller_specs` — hard rows first, each value typed by the key the domain read"
      + " holds. The two go to two tools. Send `domain`, `query` and `specs` to"
      + " shopping_search, adding `n` and `ship_to`; send `seller_specs` to"
      + " shopping_offers at beat 6 with the shortlisted variant ids and the same"
      + " `ship_to`, which is the address label the buyer's `## Constraints` names and"
      + " otherwise nothing at all. `query` is the buyer's words alone — the `applies:`"
      + " line beat 3 writes in the same subsection stays in the Brief and never rides"
      + " it. Send the rows as they came back: a widening is an"
      + " edit to the Brief and a second compile, never a row rewritten by hand. A row"
      + " the registry cannot take — an operator the key does not list, a value its type"
      + " refuses, a wrong unit, money with no currency — is refused by name here, before"
      + " any spend; a key the registry does not hold travels as written, and the search"
      + " records it. An item whose domain cell is still empty is invalid_request: settle"
      + " it at beat 2 first. One registry read, nothing written, nothing searched.",
    parameters: requestSchema(TOOL),
    async execute(_callId, params) {
      const compiled = await compile(api, params);
      if (!compiled.ok) return compiled.result;
      return jsonResult(compiled.body, ...wiringAdvisoryBlocks(api));
    },
  });
}

async function compile(api: PluginAPI, params: Record<string, unknown>): Promise<Compiled> {
  const asked = typeof params["item"] === "string" ? params["item"].trim() : "";
  if (asked === "") {
    return refuse(
      api,
      "invalid_request",
      "`item` is required — it names one `## Items` row by its label.",
    );
  }

  const doc = readDocument(params["ref"]);
  if (!doc.ok) return { ok: false, result: docFailureResult(api, TOOL, doc) };
  if (doc.kind !== "brief") {
    return refuse(
      api,
      "invalid_request",
      'Only a Brief compiles to a search — `ref` must be "brief:<slug>".',
    );
  }

  const item = parseItems(doc.body).find((r) => r.item.toLowerCase() === asked.toLowerCase());
  if (item === undefined) {
    return refuse(
      api,
      "not_found",
      `No \`## Items\` row labelled ${JSON.stringify(asked)} in ${JSON.stringify(doc.ref)}`
        + " — read the Brief with shopping_doc_read and use a row's own label.",
      "shopping_doc_read",
    );
  }
  if (item.domain === "") {
    return refuse(
      api,
      "invalid_request",
      `The \`## Items\` row ${JSON.stringify(item.item)} carries no domain yet, and a search`
        + " needs one. Settle it at beat 2, then compile again.",
      "shopping_domain_search",
    );
  }
  const query = queryFrom(itemProse(doc.body, item.item));
  if (query === "") {
    return refuse(
      api,
      "invalid_request",
      `The \`## Items\` row ${JSON.stringify(item.item)} carries no prose of its own, and that`
        + " prose IS the search query. Write it at beat 1, then compile again.",
      "shopping_doc_write",
    );
  }

  const scoped = scopeRows(parseSpecRows(doc.body), item.domain);
  if ("blank" in scoped) {
    const fault = "carries no domain, so nothing says which item it is an ask for";
    return refuse(api, "invalid_request", rowRefusal(scoped.blank, fault), "shopping_doc_write");
  }
  return await compileScoped(api, { item: item.item, domain: item.domain, query }, scoped);
}

/**
 * The item's subsection as the search takes it: one line, and only the buyer's words.
 * Beat 3 writes an `applies:` bookkeeping line into that same subsection — it stays in
 * the Brief and never rides the query, where it reads as words the buyer said. The rest
 * is folded, because the Brief is hard-wrapped and a query on the wire is one line.
 */
function queryFrom(prose: string): string {
  return prose
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:[-*+]\s*)?applies:/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Scoped {
  product: SpecRow[];
  seller: SpecRow[];
}

interface Head {
  item: string;
  domain: string;
  query: string;
}

async function compileScoped(api: PluginAPI, head: Head, scoped: Scoped): Promise<Compiled> {
  // ONE read: the domain hands back both vocabularies, product and seller (§3.2).
  const read = await readVocabulary(api, head.domain);
  if (!read.ok) return read;

  const specs = compileRows(scoped.product, read.product);
  if ("refusal" in specs) {
    return refuse(api, "invalid_request", specs.refusal, "shopping_doc_write");
  }
  const sellerSpecs = compileRows(scoped.seller, read.seller);
  if ("refusal" in sellerSpecs) {
    return refuse(api, "invalid_request", sellerSpecs.refusal, "shopping_doc_write");
  }

  const body = {
    status: "ok",
    item: head.item,
    domain: head.domain,
    query: head.query,
    specs: specs.rows,
    seller_specs: sellerSpecs.rows,
  };
  const rejected = artifactErrors(body);
  if (rejected !== null) {
    return refuse(
      api,
      "invalid_request",
      `The Brief compiles to a body the catalog would refuse: ${rejected}.`,
      "shopping_doc_write",
    );
  }
  api.logger.info(`${TOOL}_compiled`, {
    spec_count: specs.rows.length,
    seller_spec_count: sellerSpecs.rows.length,
  });
  return { ok: true, body };
}

/**
 * The ancestor-or-self rule, and the seller root beside it. A row for another item's
 * domain is not this item's ask; a row with no domain at all is a Brief beat 3 left
 * unfinished, and guessing its scope is how one item's ask reaches another's search.
 */
function scopeRows(rows: SpecRow[], itemDomain: string): Scoped | { blank: SpecRow } {
  const scoped: Scoped = { product: [], seller: [] };
  for (const row of rows) {
    if (row.domain === "") return { blank: row };
    if (domainMatches(row.domain, "seller")) scoped.seller.push(row);
    else if (domainMatches(itemDomain, row.domain)) scoped.product.push(row);
  }
  return scoped;
}

type VocabularyRead =
  | { ok: true; product: Vocabulary; seller: Vocabulary }
  | { ok: false; result: ToolResult };

/** Both vocabularies of one category, from one read: `specs` for the product rows and
 * `seller_specs` for the seller rows, base and branch (§3.2). */
async function readVocabulary(api: PluginAPI, path: string): Promise<VocabularyRead> {
  const read = await callRoute(api, DOMAIN_READ, { path });
  if (read.kind === "refused") return { ok: false, result: read.result };
  const specs = read.body["specs"];
  const sellerSpecs = read.body["seller_specs"];
  // Both lists are required of the read. A 200 missing one is a broken contract, not a
  // category with no keys: read as empty it would type every row of that side as one
  // the registry does not hold, and send the Brief's own strings as values. The agent
  // gets `retryable`; the operator gets the field that was absent, which is the only
  // part that says WHERE to look.
  if (!Array.isArray(specs) || !Array.isArray(sellerSpecs)) {
    api.logger.warn(`${TOOL}_domain_read_incomplete`, {
      domain: path,
      absent: [
        ...(Array.isArray(specs) ? [] : ["specs"]),
        ...(Array.isArray(sellerSpecs) ? [] : ["seller_specs"]),
      ],
    });
    return { ok: false, result: transient(TOOL) };
  }
  return { ok: true, product: toVocabulary(specs), seller: toVocabulary(sellerSpecs) };
}

function toVocabulary(specs: unknown[]): Vocabulary {
  const keys = new Map<string, RegistryKey>();
  for (const entry of specs) {
    if (entry === null || typeof entry !== "object") continue;
    const spec = entry as Record<string, unknown>;
    const key = spec["key"];
    const type = spec["type"];
    const operators = spec["operators"];
    if (typeof key !== "string" || typeof type !== "string" || !Array.isArray(operators)) continue;
    keys.set(key, {
      type,
      ...(typeof spec["unit"] === "string" ? { unit: spec["unit"] } : {}),
      ...(Array.isArray(spec["allowed_values"])
        ? {
            allowedValues: spec["allowed_values"].filter(
              (v): v is string => typeof v === "string",
            ),
          }
        : {}),
      operators: operators.filter((o): o is string => typeof o === "string"),
    });
  }
  return keys;
}

function compileRows(
  rows: SpecRow[],
  vocabulary: Vocabulary,
): { rows: Spec[] } | { refusal: string } {
  const specs: Spec[] = [];
  for (const row of rows) {
    const spec = compileRow(row, vocabulary);
    if (typeof spec === "string") return { refusal: spec };
    specs.push(spec);
  }
  return { rows: specs };
}

/** One row as the wire takes it, or the refusal naming what the Brief has to fix. */
function compileRow(row: SpecRow, vocabulary: Vocabulary): Spec | string {
  if (row.key === "") return rowRefusal(row, "names no key");
  if (!OPERATORS.includes(row.op)) {
    return rowRefusal(row, `states no operator sil takes (${OPERATORS.join(", ")})`);
  }
  if (row.value === "") return rowRefusal(row, "states no value");

  const held = row.key === "price" ? PRICE : vocabulary.get(row.key);
  // A key the registry does not hold travels as written — the search records it and
  // answers it absent from `fit` — but list-ness is the OPERATOR's, not the key's, so
  // `in`/`nin` still splits the cell. Untyped, every element is the buyer's own string.
  if (held === undefined) {
    const value = typedValues(row, UNTYPED);
    return typeof value === "string" ? value : { key: row.key, op: row.op, value: value.value };
  }

  if (!held.operators.includes(row.op)) {
    return rowRefusal(row, `takes ${held.operators.join(", ")}, never "${row.op}"`);
  }
  return typedSpec(row, held);
}

function typedSpec(row: SpecRow, held: RegistryKey): Spec | string {
  if (held.type === "money") {
    // The unit cell IS the currency on a money row: the registry holds money without a
    // unit, because the currency travels per value and sil converts nothing.
    if (!CURRENCY.test(row.unit)) {
      return rowRefusal(row, "is money, so its unit cell must be an ISO 4217 code (EUR, USD)");
    }
    const amount = typedValues(row, held);
    if (typeof amount === "string") return amount;
    return { key: row.key, op: row.op, value: amount.value, currency: row.unit };
  }
  if (row.unit !== "" && row.unit !== held.unit) {
    return rowRefusal(
      row,
      held.unit === undefined
        ? `is held without a unit, so the unit cell must be empty, not "${row.unit}"`
        : `is held in ${held.unit}, never in "${row.unit}"`,
    );
  }
  const value = typedValues(row, held);
  return typeof value === "string" ? value : { key: row.key, op: row.op, value: value.value };
}

/** The row's value, typed — a list from the comma-separated cell for `in` / `nin`, a
 * single value otherwise. */
function typedValues(row: SpecRow, held: RegistryKey): { value: unknown } | string {
  if (row.op !== "in" && row.op !== "nin") return typedValue(row, held, row.value);
  const cells = row.value.split(",").map((c) => c.trim()).filter((c) => c !== "");
  if (cells.length === 0) return rowRefusal(row, "states no value");
  const values: unknown[] = [];
  for (const cell of cells) {
    const typed = typedValue(row, held, cell);
    if (typeof typed === "string") return typed;
    values.push(typed.value);
  }
  return { value: values };
}

/** One cell, by the key's own type. A refusal comes back as a string, which is why a
 * typed value is always boxed — an enum's value is a string too. */
function typedValue(row: SpecRow, held: RegistryKey, cell: string): { value: unknown } | string {
  switch (held.type) {
    case "number":
      if (DECIMAL.test(cell)) return { value: Number(cell) };
      return rowRefusal(row, `is a number, and "${cell}" is not one`);
    case "money":
      if (AMOUNT.test(cell)) return { value: cell };
      return rowRefusal(row, `is money, and "${cell}" is not an amount`);
    case "boolean":
      if (cell === "true" || cell === "false") return { value: cell === "true" };
      return rowRefusal(row, `is a boolean, and "${cell}" is neither true nor false`);
    case "enum":
      if (held.allowedValues === undefined) return { value: cell };
      if (held.allowedValues.includes(cell)) return { value: cell };
      return rowRefusal(row, `takes one of ${held.allowedValues.join(", ")}, never "${cell}"`);
    default:
      // A type this plugin does not know yet: the cell travels as the buyer wrote it
      // rather than coerced into a shape nothing asked for.
      return { value: cell };
  }
}

function rowRefusal(row: SpecRow, fault: string): string {
  const where = row.hard ? "## Hard constraints" : "## Preferences";
  const named = row.key === "" ? `A \`${where}\` row` : `\`${where}\` row "${row.key}"`;
  return `${named} ${fault}. Fix the row in the Brief, then compile again.`;
}

/** The compiled body against its own artifact — the last gate before the agent sends
 * it. A Brief can hold more rows, or a longer query, than the wire takes. */
function artifactErrors(body: unknown): string | null {
  if (Value.Check(RESPONSE_ARTIFACT, body)) return null;
  return [...Value.Errors(RESPONSE_ARTIFACT, body)]
    .slice(0, 3)
    .map((e) => `${e.instancePath || "/"} ${e.message}`)
    .join("; ");
}

function refuse(
  api: PluginAPI,
  status: "invalid_request" | "not_found",
  message: string,
  recovery?: string,
): { ok: false; result: ToolResult } {
  api.logger.info(`${TOOL}_${status}`, {});
  return {
    ok: false,
    result: jsonResult({
      status,
      message,
      ...(recovery !== undefined ? { recovery } : {}),
    }),
  };
}
