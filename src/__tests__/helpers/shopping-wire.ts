/**
 * The shopping wire, as the suite sees it: the agent contract's OWN examples, the
 * committed artifacts they are graded against, and the refusal bodies the routes emit.
 *
 * WHY THE CONTRACT'S EXAMPLES AND NOT HAND-BUILT ONES. A pass-through claim is only
 * worth the body it is proved on: a fixture a test author invented proves the plugin
 * copies that author's object. `scripts/contract-examples.mjs` lifts these out of
 * `agent-contract.md` itself, and every one of them is validated against the committed
 * response artifact under Ajv 2020 strict before any pass-through assertion runs.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(HERE, "..", "..", "..", "schema");
const EXAMPLES = join(HERE, "..", "fixtures", "contract-examples.json");

/** The seven, in the contract's own order (§3.1–§3.7). */
export const SHOPPING_TOOLS = [
  "shopping_domain_search",
  "shopping_domain_get",
  "shopping_domain_create",
  "shopping_search",
  "shopping_product_get",
  "shopping_offers",
  "shopping_seller_get",
] as const;

export type ShoppingToolName = (typeof SHOPPING_TOOLS)[number];
export type SchemaSide = "request" | "response";

interface ContractExample {
  response: Record<string, unknown>;
  /** §3.4's second worked body — the warm answer for the same ask. */
  alternate?: Record<string, unknown>;
  request?: Record<string, unknown>;
}

const examples = (): Record<string, ContractExample> =>
  JSON.parse(readFileSync(EXAMPLES, "utf8")) as Record<string, ContractExample>;

/** The committed artifact's bytes, parsed. Fresh per call. */
export function artifact(tool: ShoppingToolName, side: SchemaSide): Record<string, unknown> {
  const stem = tool.slice("shopping_".length).replaceAll("_", "-");
  return JSON.parse(
    readFileSync(join(SCHEMA_DIR, `shopping-${stem}-${side}.schema.json`), "utf8"),
  ) as Record<string, unknown>;
}

/** The artifact as the host receives it: the three FILE annotations stripped. */
export function artifactParameters(tool: ShoppingToolName): Record<string, unknown> {
  const schema = artifact(tool, "request");
  for (const annotation of ["$schema", "$id", "title"]) delete schema[annotation];
  return schema;
}

/** The contract's own 200 body for this tool. Fresh clone per call — a test that
 * mutates it must not poison the next. */
export function contractResponse(tool: ShoppingToolName): Record<string, unknown> {
  return clone(example(tool).response);
}

/** §3.4's warm answer, or §3.3's mint request — the second worked body of a section. */
export function contractAlternate(tool: ShoppingToolName): Record<string, unknown> {
  const alternate = example(tool).alternate;
  if (alternate === undefined) throw new Error(`§ for ${tool} carries one example only`);
  return clone(alternate);
}

export function contractRequest(tool: ShoppingToolName): Record<string, unknown> {
  const request = example(tool).request;
  if (request === undefined) throw new Error(`§ for ${tool} shows no request`);
  return clone(request);
}

function example(tool: ShoppingToolName): ContractExample {
  const found = examples()[tool];
  if (found === undefined) throw new Error(`contract-examples.json holds no ${tool}`);
  return found;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Ajv 2020 in STRICT mode against the committed artifact. Strict is the point: it
 * refuses a schema keyword the artifact should not carry as loudly as it refuses a body
 * the artifact does not admit, so a mangled copy cannot pass by being permissive.
 * Returns the errors, so a red names the field.
 */
export function artifactErrors(
  tool: ShoppingToolName,
  side: SchemaSide,
  body: unknown,
): string[] {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(artifact(tool, side));
  if (validate(body)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
}

/* ── the refusal bodies, as sil-api's error handler emits them ─────────────────
 * `{ error, message }` and nothing else — there is no `statusCode` member on this
 * wire. PINNED AS LITERALS, never derived from the sibling: what they prove is that
 * the agent's whole recourse to a refusal reaches it unrewritten, so a message
 * computed from the same source as the assertion would prove nothing.
 * ──────────────────────────────────────────────────────────────────────────── */

export const SEARCH_400 = {
  error: "invalid_request",
  message: 'domain "product.sports.winter.ski.boots" is not in the registry — mint it first',
} as const;

export const SPEC_400 = {
  error: "invalid_request",
  message: 'spec "flex_index": operator "in" needs an enum key, not a number',
} as const;

export const DOMAIN_GET_404 = {
  error: "not_found",
  message: 'domain "product.sports.winter.ski.boots.freeride" does not stand',
} as const;

export const MINT_409 = {
  error: "domain_exists",
  message: 'domain "product.sports.winter.ski.boots" already exists',
} as const;

/**
 * The auth plugin's shared bodies — the SAME four across every route, the registry read
 * included: it registers inside the auth plugin's guarded scope, so an unauthenticated
 * read is refused before the registry is reached. `error` is the machine-readable code
 * (there is no `reason` field on the wire; the plugin's `reason` is lifted FROM `error`).
 */
export const AUTH = {
  unauthorized: { error: "unauthorized", message: "Authentication required" },
  userNotProvisioned: { error: "user_not_provisioned", message: "User is not provisioned" },
  principalMismatch: {
    error: "principal_mismatch",
    message: "Principal does not match the authenticated subject",
  },
  serviceUnavailable: {
    error: "service_unavailable",
    message: "Authentication temporarily unavailable",
  },
} as const;
