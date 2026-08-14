/**
 * The shared v0 catalog test harness — ONE `fetch` double for the four routes.
 *
 * The pre-v0 suite carried a near-identical `installRouter` in each of its
 * catalog integration files; four copies of a router is four places for the
 * origin/path assertions to drift apart, and the whole point of the four tools
 * being 1:1 with four routes is that they share one origin, one Bearer, one 401
 * choreography and one error envelope. So the double is shared and the routing
 * is BY PATH, exhaustively — an unrouted request lands in `other`, which every
 * "exactly one fetch, to exactly its own path" assertion reads as a failure
 * rather than silently ignoring.
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
/** The catalog origin — all four v0 routes, at their bare paths. */
export const SIL_API = "https://sil-api.test.example.com";

/** The four v0 routes, at the bare paths the architecture pins (no `/api/v1`). */
export const ROUTE_PATH = {
  search: "/catalog/search",
  lookup: "/catalog/lookup",
  stores: "/catalog/stores",
  domains: "/catalog/domains",
} as const;

export type RouteKind = keyof typeof ROUTE_PATH | "refresh" | "other";

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
  domains: Recorded[];
  refresh: Recorded[];
  /** Anything that matched no known path. Always assert this is empty. */
  other: Recorded[];
}

/**
 * Install the double. `reply(kind, nthOfKind, req)` decides each response.
 *
 * `/auth/refresh` is checked FIRST so a future shared path cannot be misrouted
 * onto a catalog bucket, and the catalog paths are matched by their exact bare
 * suffix so `/catalog/search` can never satisfy a `/catalog/stores` assertion.
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

    let kind: RouteKind = "other";
    if (url.includes("/auth/refresh")) kind = "refresh";
    else {
      for (const [name, path] of Object.entries(ROUTE_PATH)) {
        if (url.endsWith(path)) {
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
