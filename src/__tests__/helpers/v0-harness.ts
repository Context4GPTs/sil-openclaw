/**
 * The shared v0 catalog test harness — ONE `fetch` double for the five routes.
 *
 * The pre-v0 suite carried a near-identical `installRouter` in each of its
 * catalog integration files; four copies of a router is four places for the
 * origin/path assertions to drift apart, and the whole point of the tools being
 * 1:1 with the routes is that they share one origin, one Bearer, one 401
 * choreography and one error envelope. So the double is shared and the routing
 * is exhaustive — an unrouted request lands in `other`, which every "exactly one
 * fetch, to exactly its own path" assertion reads as a failure rather than
 * silently ignoring.
 *
 * ROUTING IS BY METHOD **AND** PATHNAME, because `/catalog/domains` is the first
 * sil-api path served by two verbs: `GET` is the read (`domainFind`), `POST` is
 * the mint (`domains`). Path alone cannot express that, and the two cheap
 * alternatives are both wrong:
 *
 *   - matching the raw URL by suffix drops the read entirely —
 *     `…/catalog/domains?q=ski+boots` does not END WITH `/catalog/domains`, so
 *     it lands in `other` and reads as an unrouted request;
 *   - loosening the suffix match to ignore the querystring is worse — the read
 *     and the mint would then share ONE bucket, silently disarming the mint's
 *     "exactly ONE write is attempted" bar and its `nthOfKind` sequencing.
 *
 * So the verb branch goes BEFORE the `ROUTE_PATH` loop, and `ROUTE_PATH` stays a
 * 1:1 name→path map (it cannot express two kinds on one path). The split is what
 * makes "a discovery read never performs the un-undoable global write" a
 * STRUCTURAL assertion rather than a narrated one: a read that used the wrong
 * verb lands in the mint bucket, and a mint that used the wrong verb lands in
 * the read bucket. Both directions fail loudly.
 *
 * `fetch` is the ONLY thing mocked. The real sil-client, the real credentials
 * module, the real `refreshAndRetryOnce` and the real tools run above it.
 */

import { vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";
import type { MockPluginAPI } from "./mock-plugin-api.js";

/** The auth origin. Every catalog assertion pins it as the host that must NOT be hit. */
export const SIL_WEB = "https://sil-web.test.example.com";
/** The catalog origin — every v0 route, at its bare path. */
export const SIL_API = "https://sil-api.test.example.com";

/**
 * The four POST-with-a-body routes, at the bare paths the architecture pins (no
 * `/api/v1`). A 1:1 name→path map, which is exactly why the GET read is NOT in
 * it: `/catalog/domains` carries two kinds, and one map key cannot hold both.
 */
export const ROUTE_PATH = {
  search: "/catalog/search",
  lookup: "/catalog/lookup",
  stores: "/catalog/stores",
  domains: "/catalog/domains",
} as const;

/**
 * `GET /catalog/domains` — the registry read, sharing the mint's path. Kept as
 * its own constant beside `ROUTE_PATH` rather than inside it so the read and the
 * mint can never collapse into one bucket by a careless map edit.
 */
export const DOMAIN_FIND_ROUTE = { method: "GET", path: "/catalog/domains" } as const;

export type RouteKind = keyof typeof ROUTE_PATH | "domainFind" | "refresh" | "other";

/** One recorded outbound request. */
export interface Recorded {
  url: string;
  method: string;
  bearer: string | null;
  body: unknown;
  hasBody: boolean;
}

export type Reply = { status: number; body: unknown } | "network-error";

export interface Router {
  /** Every request, in order — the set an "exactly one fetch" assertion reads. */
  all: Recorded[];
  search: Recorded[];
  lookup: Recorded[];
  stores: Recorded[];
  /** `POST /catalog/domains` — the MINT bucket, and only the mint. */
  domains: Recorded[];
  /** `GET /catalog/domains` — the READ bucket. Never the same list as `domains`. */
  domainFind: Recorded[];
  refresh: Recorded[];
  /** Anything that matched no known path. Always assert this is empty. */
  other: Recorded[];
}

/**
 * Install the double. `reply(kind, nthOfKind, req)` decides each response.
 *
 * `/auth/refresh` is checked FIRST so a future shared path cannot be misrouted
 * onto a catalog bucket. Then the verb split on `/catalog/domains`. Then the
 * four bare paths, matched on the PATHNAME (never the raw URL) so a querystring
 * cannot make a known route look unrouted.
 */
export function installRouter(
  reply: (kind: RouteKind, nthOfKind: number, req: Recorded) => Reply,
): Router {
  const router: Router = {
    all: [],
    search: [],
    lookup: [],
    stores: [],
    domains: [],
    domainFind: [],
    refresh: [],
    other: [],
  };

  vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const bearer = headers["Authorization"] ?? headers["authorization"] ?? null;
    const method = (init?.method ?? "GET").toUpperCase();
    const hasBody = init?.body !== undefined && init?.body !== null;
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const req: Recorded = { url, method, bearer, body, hasBody };
    router.all.push(req);

    const path = pathnameOf(url);
    let kind: RouteKind = "other";
    if (url.includes("/auth/refresh")) kind = "refresh";
    else if (method === DOMAIN_FIND_ROUTE.method && path.endsWith(DOMAIN_FIND_ROUTE.path)) {
      kind = "domainFind";
    } else {
      for (const [name, routePath] of Object.entries(ROUTE_PATH)) {
        if (path.endsWith(routePath)) {
          kind = name as keyof typeof ROUTE_PATH;
          break;
        }
      }
    }

    const bucket = router[kind];
    bucket.push(req);
    const nthOfKind = bucket.length - 1;

    const r = reply(kind, nthOfKind, req);
    if (r === "network-error") return Promise.reject(new Error("simulated network failure"));
    return Promise.resolve(
      new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  return router;
}

/**
 * The path half of a request URL, querystring and fragment removed. Split by
 * hand rather than through `new URL` so a relative or malformed URL a broken
 * client emitted is still ROUTED (into `other`) instead of throwing inside the
 * double — a fetch double that throws reports the wrong defect.
 */
function pathnameOf(url: string): string {
  return url.split("#")[0].split("?")[0];
}

/**
 * The request's querystring, parsed. Read the KEYS, not just the values: an
 * emitted `q=` and an omitted `q` are DIFFERENT requests to `/catalog/domains`
 * (the route answers "`q` must not be shorter than 1 character" for the first
 * and "you sent neither" for the second), so a test that only reads values
 * cannot tell them apart.
 */
export function queryOf(req: Recorded): URLSearchParams {
  const [, search = ""] = req.url.split("#")[0].split("?");
  return new URLSearchParams(search);
}

/** Parse a ToolResult's single text part as JSON. */
export function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("no tool payload");
  return JSON.parse(text) as Record<string, unknown>;
}

/** Seed a stored token pair so a tool proceeds past the not-registered gate. */
export function seedTokens(access: string, refresh: string): void {
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(getTokensPath(), JSON.stringify({ access_token: access, refresh_token: refresh }), {
    mode: 0o600,
  });
}

/** The Bearer value on a recorded request, scheme stripped. */
export function bearerToken(req: Recorded): string | null {
  return req.bearer === null ? null : req.bearer.replace(/^Bearer\s+/i, "");
}

/** Every argument to every logger level, serialized — the token-privacy scan. */
export function logBlob(api: MockPluginAPI): string {
  return [api.logger.info, api.logger.warn, api.logger.error, api.logger.debug]
    .flatMap((fn) => vi.mocked(fn).mock.calls.map((c) => JSON.stringify(c)))
    .join("\n");
}

/** How many `logger.info(marker, …)` calls used `marker` as their first argument. */
export function infoMarkerCount(api: MockPluginAPI, marker: string): number {
  return vi.mocked(api.logger.info).mock.calls.filter((c) => c[0] === marker).length;
}

/** A 200 reply carrying `body`. */
export const ok = (body: unknown): Reply => ({ status: 200, body });

/** The refresh leg's success — a rotated pair, so a retry can carry the new token. */
export const rotated = (access: string, refresh: string): Reply =>
  ok({ access_token: access, refresh_token: refresh });
