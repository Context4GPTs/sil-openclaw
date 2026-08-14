/**
 * The v0 wire, as the suite sees it: the checked-in goldens plus the smallest
 * hand-built bodies the structural-gate tests need.
 *
 * WHY BOTH. The goldens are the honest link to `@sil/schemas` (wire types are
 * MIRRORED, never imported — `src/__tests__/fixtures/README.md` carries the
 * provenance and the Ajv-strict validation). They are what the pass-through and
 * fidelity criteria run against, because only a body sil-services actually emits
 * can prove the plugin does not eat a field.
 *
 * The builders exist for the OPPOSITE job — deliberately malformed bodies, one
 * mutation at a time, to prove the structural gate bites. Those cannot come from
 * a golden by definition. Every builder starts FROM the golden and mutates a
 * clone, so a builder can never drift into a shape the route would not produce.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const read = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

/**
 * `sil-services` `dev` @ `6a2b5ba`'s own wire-spec instance, byte-for-byte.
 * Fresh clone per call — a test that mutates it must not poison the next.
 */
export function resultGolden(): Record<string, unknown> {
  return read("catalog-result-response.golden.json") as Record<string, unknown>;
}

export function storesGolden(): Record<string, unknown> {
  return read("catalog-stores-response.golden.json") as Record<string, unknown>;
}

/** The mint's 200, which the route builds by hand — three fields, no more. */
export function mintGolden(): Record<string, unknown> {
  return {
    path: "product.sports.winter.ski.boots",
    validated_at: null,
    specs: ["flex_index", "last_width_mm", "brand"],
  };
}

/** A deep clone, so a mutation in one test cannot reach another. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The golden with one top-level key deleted — A1's four-key gate. */
export function resultMissing(key: string): Record<string, unknown> {
  const body = resultGolden();
  delete body[key];
  return body;
}

/** The golden with `mutate` applied to `results[0]` — A1's per-result gate. */
export function resultWithResult0(
  mutate: (result: Record<string, unknown>) => void,
): Record<string, unknown> {
  const body = resultGolden();
  mutate((body["results"] as Record<string, unknown>[])[0]);
  return body;
}

/** A genuinely EMPTY answer: no results, but a complete, well-formed envelope. */
export function resultEmpty(): Record<string, unknown> {
  return {
    results: [],
    sources: {},
    predicates: [{ key: "flex_index", applied: false }],
    report: { searches: 1, fetched: 0, blocked: 0 },
  };
}

/** The stores golden with one top-level key deleted. */
export function storesMissing(key: string): Record<string, unknown> {
  const body = storesGolden();
  delete body[key];
  return body;
}

/** The stores golden with `mutate` applied to `stores[0]`. */
export function storesWithStore0(
  mutate: (store: Record<string, unknown>) => void,
): Record<string, unknown> {
  const body = storesGolden();
  mutate((body["stores"] as Record<string, unknown>[])[0]);
  return body;
}

/** The store entry for `host`, or a legible throw naming what IS present. */
export function storeFor(body: Record<string, unknown>, host: string): Record<string, unknown> {
  const stores = body["stores"] as Record<string, unknown>[];
  const found = stores.find((s) => (s["seller"] as { host: string }).host === host);
  if (found === undefined) {
    const hosts = stores.map((s) => (s["seller"] as { host: string }).host).join(", ");
    throw new Error(`no store for "${host}". Present: ${hosts || "(none)"}`);
  }
  return found;
}

/** The result carrying `ref`, or undefined — the lookup miss is an ABSENCE. */
export function resultFor(
  body: Record<string, unknown>,
  ref: string,
): Record<string, unknown> | undefined {
  return (body["results"] as Record<string, unknown>[]).find((r) => r["ref"] === ref);
}

/** The two refs the result golden carries — one catalog, one web. */
export const GOLDEN_REFS = {
  catalog: "variant:0198f2a1-4c3d-7000-8000-0000000000a1",
  web: "url:https://backcountry.com/lange-lx-130",
} as const;

/** The three sellers the stores golden carries, one per serviceability state. */
export const GOLDEN_HOSTS = {
  serviceable: "evo.com",
  unknown: "backcountry.com",
  not_serviceable: "alpinshop.example",
} as const;

/**
 * The two search 400s, verbatim from `handlers/search.ts` (`:87` and the grammar
 * message `@sil/db` raises). BOTH carry `error: "invalid_request"` — the wire has
 * no machine discriminator, which is the whole point of pinning them here.
 */
export const SEARCH_400 = {
  unknownDomain: {
    error: "invalid_request",
    message: 'domain "product.sports.winter.ski.boots" is not in the registry — mint it first',
  },
  predicateGrammar: {
    error: "invalid_request",
    message: 'predicate "flex_index": operator "in" needs an enum spec, not a number',
  },
} as const;

/** `handlers/stores.ts:52` — no destination anywhere. */
export const STORES_400_NO_DESTINATION = {
  error: "invalid_request",
  message:
    "no destination — pass `destination` (ISO 3166-1 alpha-2) or set a default country " +
    "on your account. Serviceability is meaningless without one.",
} as const;

/** `handlers/stores.ts:73` — a well-formed ref that resolves to nothing. */
export const STORES_404 = {
  error: "not_found",
  message: 'ref "variant:0198f2a1-4c3d-7000-8000-00000000dead" is not in the catalog',
} as const;

/** `handlers/domains.ts:50` — the mint's one refusal that is not a failure. */
export const MINT_409 = {
  error: "domain_exists",
  message: 'domain "product.sports.winter.ski.boots" already exists',
} as const;

/**
 * The auth plugin's shared bodies, verbatim from `middleware/auth.ts` — the SAME
 * four across all four routes. `error` is the machine-readable code (there is no
 * `reason` field on the wire; the plugin's `reason` is lifted FROM `error`).
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
