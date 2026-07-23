/**
 * The search-results delivery buffer.
 *
 * `sil_search` returns its full page to the agent exactly as it always has —
 * this store is a pure SIDE EFFECT on the `ok` path, invisible to every
 * channel. It exists because the host's projection of a tool result is not a
 * dependable transport for structured data: under codex `data.result` is absent
 * from every frame, and the transcript that would otherwise carry it is both
 * provider-capped and rewritten under context pressure as a run grows. A client
 * that wants to render an intermediate search therefore needs its own way to
 * fetch it — `sil.search_results` (see `../gateway/search-results.ts`) reads
 * this map and answers over the paired `deviceToken` WS.
 *
 * The key is the HOST's `callId`, verbatim — never prefixed, hashed, or
 * re-minted. `execute()` receives it BEFORE any I/O, so a page can never be
 * orphaned by a failing search. A client joins on
 * `data.toolCallId ?? data.itemId`, in that order: the id is the same string on
 * every frame, but the FIELD NAME differs per family (`session.tool` carries
 * only `toolCallId`, the `agent`/`stream:"item"` frames only `itemId`) and on
 * the non-codex path `itemId` is `tool:`-prefixed — see
 * `docs/decisions/search-results-pull-surface.md`. Because that id is visible to
 * anyone who can see the frames, knowledge of a `callId` is NOT evidence of
 * entitlement: the principal check below is the only gate that matters.
 *
 * In-memory, by choice. Process death is the strongest retention ceiling
 * available and costs nothing; an on-disk buffer would put prices, seller
 * identity, and `checkout_url` at rest, widen the plugin's declared filesystem
 * scope, and — with no timers allowed — leave the last pages there forever once
 * the user stops searching.
 *
 * TIMER-FREE, and that is load-bearing: `register()` must stay synchronous and
 * open nothing, so eviction is lazy on write. Reads are pure — they never
 * evict, never reorder, and never consume, because a client remount or reload
 * re-resolves the same page and a one-shot read would blank the shopper's
 * screen on the first refresh.
 */

import type { SearchProduct, SpecStatus } from "./sil-client.js";

/**
 * The stored page — EXACTLY the shape a client's decoder accepts, and a strict
 * subset of the agent-facing envelope. No `advisories`: host-misconfiguration
 * guidance is operator/agent copy, not product data.
 */
export interface SearchResultPage {
  status: "ok";
  products: SearchProduct[];
  cursor?: string;
  specs_status?: SpecStatus[];
}

/** Why a lookup missed. OPERATOR-LOG ONLY — all three answer the client with
 * one byte-identical not-found body, so a caller cannot tell "not yours" apart
 * from "never existed" from "expired". */
export type SearchResultMiss = "unknown" | "expired" | "principal_mismatch";

/**
 * Fifteen minutes. A search result is point-in-time — price, availability, and
 * `checkout_url` are exactly the fields a shopper must re-fetch before buying —
 * so this is long enough for the settle edge, a client reload, a reconnect, and
 * a short step-away, and short enough that nothing renders as stale truth. It
 * is a delivery buffer, not scrollback and not history.
 */
export const RETENTION_MS = 15 * 60_000;

/**
 * Sized against a whole RUN, not a single request: a real run issues 5–10 tool
 * calls and a client must be able to render EVERY intermediate search in it,
 * not just the last — so a "latest result" slot (or anything near the ≤4-call
 * fan-out one shopper request makes) would evict an early search before the run
 * ends. 32 leaves several runs' worth of headroom at a worst case of roughly
 * 32 × ~51 KB ≈ 1.6 MB, which is nothing against the gateway's own 25 MB frame
 * ceiling. Retention is a CEILING, not a guarantee: past it the product answer
 * is always the same — run a fresh search.
 */
export const MAX_ENTRIES = 32;

interface StoredEntry {
  principal: string;
  page: SearchResultPage;
  expiresAtMs: number;
}

const entries = new Map<string, StoredEntry>();

/** Store one `ok` page under the host's `callId`, bound to the sil account that
 * produced it. An empty principal is refused: a page has an owner or it is
 * unreachable, and an ownerless entry would only burn capacity. */
export function putSearchResult(
  callId: string,
  page: SearchResultPage,
  principal: string,
): void {
  if (principal.length === 0) return;
  evict();
  entries.set(callId, { principal, page, expiresAtMs: Date.now() + RETENTION_MS });
}

/** The stored page, or `null` for every miss — unknown, expired, and foreign are
 * ONE outcome to the caller. Pure: no eviction, no reordering, no consumption,
 * so a client remount re-resolves the same page and a foreign probe cannot deny
 * the owner theirs. */
export function getSearchResult(callId: string, principal: string): SearchResultPage | null {
  return lookup(callId, principal).page;
}

/** The miss cause, for the OPERATOR LOG only (criterion C3) — never the wire.
 * A separate query rather than a richer return, because the wire path must not
 * be able to reach the cause by accident: reading it is a deliberate call. */
export function searchResultMiss(callId: string, principal: string): SearchResultMiss | null {
  return lookup(callId, principal).miss;
}

/** Reset for tests. Production never calls this — the process IS the lifetime. */
export function __resetSearchResultsStore(): void {
  entries.clear();
}

function lookup(
  callId: string,
  principal: string,
): { page: SearchResultPage | null; miss: SearchResultMiss | null } {
  const entry = entries.get(callId);
  if (entry === undefined) return { page: null, miss: "unknown" };
  if (entry.expiresAtMs <= Date.now()) return { page: null, miss: "expired" };
  // An empty principal is the anonymous bucket, and there is no legitimate
  // anonymous owner — it must not match, not even an entry stored under one.
  if (principal.length === 0 || entry.principal !== principal) {
    return { page: null, miss: "principal_mismatch" };
  }
  return { page: entry.page, miss: null };
}

/** Lazy eviction, run on every write: drop what has expired, then trim to
 * capacity oldest-first. `Map` preserves insertion order and reads never touch
 * it, so "oldest" is insertion order — deliberately not LRU-on-read, which
 * would make a read mutate the store. */
function evict(): void {
  const now = Date.now();
  for (const [callId, entry] of entries) {
    if (entry.expiresAtMs <= now) entries.delete(callId);
  }
  // `>=` because this runs BEFORE the `set`, so the store never exceeds the
  // ceiling. Re-writing an existing `callId` can trim one entry it did not need
  // to; a `callId` is unique per tool call, so that branch is unreachable in
  // practice and guarding it would cost more than it saves.
  while (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done === true) return;
    entries.delete(oldest.value);
  }
}
