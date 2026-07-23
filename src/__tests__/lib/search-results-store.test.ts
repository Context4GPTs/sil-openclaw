/**
 * UNIT — the search-results delivery buffer (tier: unit, pure module, no I/O).
 *
 * The store `sil_search` writes each `ok` page into and `sil.search_results`
 * reads back out of. It is a DELIVERY BUFFER, not scrollback and not history:
 * bounded by a product-chosen retention window and an entry ceiling, in-memory,
 * process-local, and TIMER-FREE (the plugin's `register()` opens nothing, so a
 * sweep timer is not available to it — eviction is lazy on write).
 *
 * Criteria pinned here: D1 (15-minute retention as a PRODUCT bound), D2 (capacity
 * ceiling + a fresh process holds nothing), B2 (a read NEVER evicts), A3/B3 (the
 * key is the host `callId` verbatim), and the principal gate from C3/C4/C6 —
 * including the split that makes C3 work: the miss CAUSE is reachable only by a
 * deliberate second call (`searchResultMiss`), so the wire path cannot leak it by
 * accident.
 *
 * The wire-level half of C3 — that all four failure causes are byte-identical to
 * a CLIENT — is not provable here (this module has no wire); it is pinned in
 * `search-results-method.integration.test.ts` against the real handler.
 *
 * THESE ASSERTIONS ARE THE SPEC. A red here is the implementation, never the
 * matcher — in particular, never widen the retention boundary and never loosen
 * the principal gate to make one pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { SearchResultPage } from "../../lib/search-results-store.js";
import {
  RETENTION_MS,
  MAX_ENTRIES,
  putSearchResult,
  getSearchResult,
  searchResultMiss,
  __resetSearchResultsStore,
} from "../../lib/search-results-store.js";

/** A real projected search page — the exact shape a client's decoder accepts
 * (`{status:"ok", products:[...], cursor?, specs_status?}`) with a genuine
 * `SearchProduct`: product identity + provenance plus the nested featured variant
 * carrying a non-empty `checkout_url`. Anti-false-green: a store that hands back a
 * placeholder rather than what it was given cannot satisfy the deep-equality
 * assertions below. */
function page(
  label: string,
  extra: { cursor?: string; specs_status?: { ns: string; key: string; applied: boolean }[] } = {},
): SearchResultPage {
  return {
    status: "ok",
    products: [
      {
        id: `gid://product/${label}`,
        title: `Product ${label}`,
        source: "shop",
        variant: {
          id: `gid://variant/${label}-1`,
          title: `Product ${label} — Default`,
          price: { amount: 4999, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: `https://buy.example.com/${label}`,
        },
      },
    ],
    ...(extra.cursor !== undefined ? { cursor: extra.cursor } : {}),
    ...(extra.specs_status !== undefined ? { specs_status: extra.specs_status } : {}),
  };
}

const PRINCIPAL = "user-42";

beforeEach(() => {
  __resetSearchResultsStore();
});

afterEach(() => {
  __resetSearchResultsStore();
  vi.useRealTimers();
});

// ===========================================================================
// The two product bounds are named constants, not magic numbers
// ===========================================================================

describe("retention + capacity are declared bounds (D1, D2)", () => {
  it("RETENTION_MS is FIFTEEN MINUTES — the product decision, not an arbitrary TTL", () => {
    // D1 is a product bound with a stated reason: long enough for the settle
    // edge, a client reload, a reconnect and a short step-away; short enough that
    // a shopper is never rendered a grid of prices that are no longer true
    // (price / availability / checkout_url are exactly the fields sil_product_get's
    // own contract says to re-fetch before buying). Changing this number is a
    // PRODUCT decision — it does not get quietly tuned to make a test pass.
    expect(RETENTION_MS).toBe(15 * 60_000);
  });

  it("MAX_ENTRIES is a real ceiling comfortably above one run's search count (D3)", () => {
    // The bound must hold every search a real 5–10-tool-call run can produce —
    // not merely the <=4-call Beat-4 fan-out for a single shopper request. A
    // ceiling at or below that fan-out would evict an early search before the run
    // ends, which is precisely the failure D3 exists to forbid.
    expect(Number.isInteger(MAX_ENTRIES)).toBe(true);
    expect(MAX_ENTRIES).toBeGreaterThanOrEqual(16);
  });
});

// ===========================================================================
// A3 / B3 — the key is the host callId, VERBATIM
// ===========================================================================

describe("the key is the host callId, verbatim (A3, B3)", () => {
  it("round-trips a page under the EXACT callId string the host produced", () => {
    // The real shape codex hands execute() — and the same string the client sees
    // as `data.itemId` on the tool identity frames (live-validated 2026-07-23).
    // The two siblings meet at this value with NO translation table on either
    // side, so any plugin-side prefixing, hashing or re-minting breaks the join.
    const callId = "call_FSW68ywnbj8V6pZ5U8avz9Sn";
    const stored = page("a");
    putSearchResult(callId, stored, PRINCIPAL);
    expect(getSearchResult(callId, PRINCIPAL)).toEqual(stored);
  });

  it("does NOT resolve a callId that merely CONTAINS the stored one (no prefix/suffix matching)", () => {
    putSearchResult("call_abc", page("a"), PRINCIPAL);
    expect(getSearchResult("call_abc_extra", PRINCIPAL)).toBeNull();
    expect(getSearchResult("prefix_call_abc", PRINCIPAL)).toBeNull();
    expect(getSearchResult("call_ab", PRINCIPAL)).toBeNull();
  });

  it("treats callIds case-sensitively — host ids are opaque, not normalized", () => {
    putSearchResult("call_AbC", page("a"), PRINCIPAL);
    expect(getSearchResult("call_abc", PRINCIPAL)).toBeNull();
    expect(getSearchResult("call_AbC", PRINCIPAL)).not.toBeNull();
  });

  it("returns the page BY VALUE-EQUALITY, preserving cursor and specs_status siblings", () => {
    // `cursor` and `specs_status` are siblings of `products` on the page the
    // client decodes; a store that keeps only `products` silently strips the
    // pagination handle and the honesty rail.
    const stored = page("a", {
      cursor: "opaque-cursor-token",
      specs_status: [{ ns: "product", key: "capacity_gb", applied: false }],
    });
    putSearchResult("call_1", stored, PRINCIPAL);
    expect(getSearchResult("call_1", PRINCIPAL)).toEqual(stored);
  });

  it("an unknown callId is a MISS, never another entry's page", () => {
    putSearchResult("call_1", page("a"), PRINCIPAL);
    putSearchResult("call_2", page("b"), PRINCIPAL);
    expect(getSearchResult("call_never_stored", PRINCIPAL)).toBeNull();
    expect(searchResultMiss("call_never_stored", PRINCIPAL)).toBe("unknown");
  });
});

// ===========================================================================
// D1 — retention, at the boundary
// ===========================================================================

describe("retention expires the entry (D1)", () => {
  it("still resolves ONE MILLISECOND before the window closes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    putSearchResult("call_1", page("a"), PRINCIPAL);

    vi.setSystemTime(Date.now() + RETENTION_MS - 1);
    expect(getSearchResult("call_1", PRINCIPAL)).not.toBeNull();
  });

  it("does NOT resolve once exactly RETENTION_MS has elapsed (the ceiling is inclusive)", () => {
    // "Given a page stored at time T, when T + 15 minutes elapses, then that
    // callId no longer resolves." Retention is a CEILING — at the boundary the
    // page is gone, and the product answer past it is always the same: run a
    // fresh search.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    putSearchResult("call_1", page("a"), PRINCIPAL);

    vi.setSystemTime(Date.now() + RETENTION_MS);
    expect(getSearchResult("call_1", PRINCIPAL)).toBeNull();
    expect(searchResultMiss("call_1", PRINCIPAL)).toBe("expired");
  });

  it("expires WITHOUT any intervening write — a read-only client still sees the bound", () => {
    // The store is timer-free (register() opens nothing), so eviction is lazy on
    // write. That must NOT mean an entry stays resolvable forever in a session
    // where nothing else is ever stored: the READ has to honour the window too.
    // A store that only expires on `put` passes every other test in this file
    // and leaves stale prices resolvable indefinitely.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    putSearchResult("call_1", page("a"), PRINCIPAL);

    vi.setSystemTime(Date.now() + RETENTION_MS + 60_000);
    expect(getSearchResult("call_1", PRINCIPAL)).toBeNull();
  });

  it("expires per-entry — a later search survives an earlier one's expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    putSearchResult("call_early", page("early"), PRINCIPAL);

    vi.setSystemTime(Date.now() + 10 * 60_000);
    putSearchResult("call_late", page("late"), PRINCIPAL);

    // +10 more minutes: the first is 20 min old (gone), the second 10 min (alive).
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(getSearchResult("call_early", PRINCIPAL)).toBeNull();
    expect(getSearchResult("call_late", PRINCIPAL)).toEqual(page("late"));
  });
});

// ===========================================================================
// B2 — a read NEVER evicts
// ===========================================================================

describe("a read never evicts (B2)", () => {
  it("resolves the SAME page repeatedly inside the window", () => {
    // A client remount, a reload, or a reconnect re-resolves the same callId. A
    // consume-on-read ("take") store passes a single-read test and then blanks
    // the shopper's screen on their first refresh.
    const stored = page("a");
    putSearchResult("call_1", stored, PRINCIPAL);

    for (let i = 0; i < 5; i += 1) {
      expect(getSearchResult("call_1", PRINCIPAL)).toEqual(stored);
    }
  });

  it("a MISSED read does not disturb the entries that ARE stored", () => {
    putSearchResult("call_1", page("a"), PRINCIPAL);
    expect(getSearchResult("call_unknown", PRINCIPAL)).toBeNull();
    expect(getSearchResult("call_1", PRINCIPAL)).toEqual(page("a"));
  });

  it("a read by the WRONG principal does not evict the rightful owner's page", () => {
    // Fail-closed must not also be destructive: a foreign probe that wiped the
    // entry would let anyone who can see a callId deny the owner their results.
    putSearchResult("call_1", page("a"), PRINCIPAL);
    expect(getSearchResult("call_1", "someone-else")).toBeNull();
    expect(getSearchResult("call_1", PRINCIPAL)).toEqual(page("a"));
  });

  it("reading does NOT reorder the store — a read cannot change what eviction drops", () => {
    // Reads are pure. If a read promoted its entry (LRU-on-read), the read would
    // MUTATE the store, and a client that merely LOOKED at an old page could
    // silently evict a newer one the shopper is still using.
    for (let i = 0; i < MAX_ENTRIES; i += 1) {
      putSearchResult(`call_${i}`, page(String(i)), PRINCIPAL);
    }
    // Touch the oldest entry repeatedly, then overflow by one.
    for (let i = 0; i < 3; i += 1) {
      expect(getSearchResult("call_0", PRINCIPAL)).not.toBeNull();
    }
    putSearchResult("call_overflow", page("overflow"), PRINCIPAL);

    // Still the OLDEST-STORED that goes, exactly as if it had never been read.
    expect(getSearchResult("call_0", PRINCIPAL)).toBeNull();
    expect(getSearchResult("call_1", PRINCIPAL)).not.toBeNull();
  });
});

// ===========================================================================
// C3 / C4 / C6 — the principal gate is the ONLY gate that matters
// ===========================================================================

describe("principal scoping (C3, C4, C6)", () => {
  it("a different principal gets a MISS, never the stored page", () => {
    // The key is the HOST's callId, not a plugin-minted secret — it is visible to
    // anyone who can see the tool frames. So knowledge of a callId is NOT evidence
    // of entitlement, and principal-scoping is the whole gate.
    const stored = page("a");
    putSearchResult("call_1", stored, PRINCIPAL);

    const foreign = getSearchResult("call_1", "user-99");
    expect(foreign).toBeNull();
    expect(JSON.stringify(foreign)).not.toContain("gid://product/a");
    expect(JSON.stringify(foreign)).not.toContain("checkout_url");
  });

  it("the SAME principal resolves — a second paired device of one shopper is not locked out", () => {
    // Principal is the sil ACCOUNT, not the machine or the socket, so a shopper's
    // second paired client resolves their own results fine.
    putSearchResult("call_1", page("a"), PRINCIPAL);
    expect(getSearchResult("call_1", PRINCIPAL)).toEqual(page("a"));
  });

  it("the principal is compared EXACTLY — no prefix, case, or whitespace slack", () => {
    putSearchResult("call_1", page("a"), "user-42");
    expect(getSearchResult("call_1", "user-4")).toBeNull();
    expect(getSearchResult("call_1", "user-420")).toBeNull();
    expect(getSearchResult("call_1", "USER-42")).toBeNull();
    expect(getSearchResult("call_1", " user-42 ")).toBeNull();
  });

  it("re-registering as another account strands the first account's pages (C4)", () => {
    // A result belongs to the identity that produced it, not to the machine. A
    // store keyed only by process or device would survive an account switch and
    // hand account B account A's shopping.
    putSearchResult("call_1", page("a"), "account-a");
    expect(getSearchResult("call_1", "account-b")).toBeNull();
    expect(getSearchResult("call_1", "account-a")).not.toBeNull();
  });

  it("an EMPTY principal never resolves — not even against an entry stored under one", () => {
    // Fail-closed on the anonymous bucket. A store that accepted a falsy principal
    // (`readConfig()?.user?.id ?? ""` on both sides) would let every
    // credential-less reader into every credential-less writer's page. There is no
    // legitimate anonymous owner: a page has an owner or it is unreachable.
    putSearchResult("call_1", page("a"), "");
    expect(getSearchResult("call_1", "")).toBeNull();
    expect(getSearchResult("call_1", PRINCIPAL)).toBeNull();
  });

  it("an empty principal cannot READ a legitimately-owned page either", () => {
    putSearchResult("call_1", page("a"), PRINCIPAL);
    expect(getSearchResult("call_1", "")).toBeNull();
  });

  it("two principals can hold the SAME callId without cross-talk", () => {
    // Defensive: callIds are the host's, so a collision across accounts in one
    // process is conceivable. Neither owner ever sees the other's page.
    putSearchResult("call_shared", page("mine"), "user-a");
    putSearchResult("call_shared", page("yours"), "user-b");
    expect(getSearchResult("call_shared", "user-b")).toEqual(page("yours"));
    expect(getSearchResult("call_shared", "user-a")).toBeNull();
  });
});

// ===========================================================================
// C3 — the miss cause exists for the OPERATOR LOG, off the read path
// ===========================================================================

describe("miss causes are named for the operator log (C3)", () => {
  it("names unknown / expired / principal_mismatch distinctly", () => {
    // C3 splits this deliberately: an operator must be able to tell the causes
    // apart in the log to debug a delivery complaint, while a CALLER must not.
    // The store owns the naming; the handler owns collapsing them to one wire
    // body (pinned in the integration file).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));

    putSearchResult("call_expired", page("x"), PRINCIPAL);
    vi.setSystemTime(Date.now() + RETENTION_MS + 1);
    // Asserted BEFORE any further write: eviction is lazy-on-write, so the very
    // next `put` reclaims this entry and its cause degrades to `unknown`. That
    // degradation is log-only and harmless — all causes are one body on the wire
    // — but the ordering here is load-bearing for the assertion.
    expect(searchResultMiss("call_expired", PRINCIPAL)).toBe("expired");

    putSearchResult("call_foreign", page("y"), PRINCIPAL);
    expect(searchResultMiss("call_foreign", "other")).toBe("principal_mismatch");
    expect(searchResultMiss("call_missing", PRINCIPAL)).toBe("unknown");
  });

  it("the cause is reachable ONLY by a deliberate second call — the read itself never carries it", () => {
    // The wire path calls `getSearchResult`, which returns a page or null and
    // NOTHING else. That is what makes a leak of the cause onto the wire an act
    // rather than an accident: a handler has to go out of its way to ask.
    putSearchResult("call_1", page("a"), PRINCIPAL);
    expect(getSearchResult("call_gone", PRINCIPAL)).toBeNull();
    expect(getSearchResult("call_1", "stranger")).toBeNull();
  });

  it("a HIT names no miss cause — a page and a cause are mutually exclusive", () => {
    putSearchResult("call_1", page("a"), PRINCIPAL);
    expect(getSearchResult("call_1", PRINCIPAL)).not.toBeNull();
    expect(searchResultMiss("call_1", PRINCIPAL)).toBeNull();
  });

  it("asking for the cause does not evict, consume, or reorder anything", () => {
    // The operator-log query runs on the SAME path a client just missed on; it
    // must be as pure as the read.
    putSearchResult("call_1", page("a"), PRINCIPAL);
    searchResultMiss("call_1", "stranger");
    searchResultMiss("call_unknown", PRINCIPAL);
    expect(getSearchResult("call_1", PRINCIPAL)).toEqual(page("a"));
  });
});

// ===========================================================================
// D2 / D3 — the capacity ceiling
// ===========================================================================

describe("capacity ceiling (D2, D3)", () => {
  it("holds MAX_ENTRIES pages, every one of them resolvable", () => {
    for (let i = 0; i < MAX_ENTRIES; i += 1) {
      putSearchResult(`call_${i}`, page(String(i)), PRINCIPAL);
    }
    for (let i = 0; i < MAX_ENTRIES; i += 1) {
      expect(getSearchResult(`call_${i}`, PRINCIPAL)).toEqual(page(String(i)));
    }
  });

  it("evicts the OLDEST-STORED entry when the ceiling is exceeded — the store is BOUNDED", () => {
    // An unbounded store is the mutation this forbids: memory grows without limit
    // across a long session.
    for (let i = 0; i < MAX_ENTRIES; i += 1) {
      putSearchResult(`call_${i}`, page(String(i)), PRINCIPAL);
    }
    putSearchResult("call_overflow", page("overflow"), PRINCIPAL);

    expect(getSearchResult("call_0", PRINCIPAL)).toBeNull();
    expect(getSearchResult("call_overflow", PRINCIPAL)).toEqual(page("overflow"));
    // Everything between the evicted head and the new tail survives — eviction
    // trims to the ceiling, it does not clear the store.
    for (let i = 1; i < MAX_ENTRIES; i += 1) {
      expect(getSearchResult(`call_${i}`, PRINCIPAL)).toEqual(page(String(i)));
    }
  });

  it("an evicted callId is INDISTINGUISHABLE from a never-stored one", () => {
    for (let i = 0; i < MAX_ENTRIES + 1; i += 1) {
      putSearchResult(`call_${i}`, page(String(i)), PRINCIPAL);
    }
    // Never a partial page and never another search's page — the same uniform
    // miss a callId that was never stored produces, cause included.
    expect(getSearchResult("call_0", PRINCIPAL)).toBeNull();
    expect(searchResultMiss("call_0", PRINCIPAL)).toBe(
      searchResultMiss("call_never_stored", PRINCIPAL),
    );
  });

  it("a REAL RUN's worth of searches all stay resolvable at once (D3 — the card's purpose)", () => {
    // The criterion carrying the card's actual purpose: a client must be able to
    // visualize EVERY intermediate search in a run, not just the last. Twelve is
    // past both the <=4-call Beat-4 fan-out for one shopper request and the 5–10
    // intermediate calls a real run produces. A single-slot "latest result" store
    // passes every single-search test in this file and fails right here.
    const RUN_SEARCHES = 12;
    for (let i = 0; i < RUN_SEARCHES; i += 1) {
      putSearchResult(`call_run_${i}`, page(`run${i}`), PRINCIPAL);
    }
    for (let i = 0; i < RUN_SEARCHES; i += 1) {
      expect(getSearchResult(`call_run_${i}`, PRINCIPAL)).toEqual(page(`run${i}`));
    }
  });
});

// NOTE (deliberate omission): there is no test that lazy-on-write expiry
// reclaims capacity. It cannot be written non-vacuously through this module's
// surface — expired entries are always the OLDEST, so a plain trim-to-ceiling
// sheds exactly the same entries an expiry-drop would, and reads already refuse
// anything past its window. The difference is resident memory only, which no
// assertion here can observe. A test asserting it would pass against both
// implementations and read as coverage it does not provide.

// ===========================================================================
// D2 — a fresh process holds nothing (retention is a ceiling, not a guarantee)
// ===========================================================================

describe("the store is process-local (D2)", () => {
  it("a FRESH module instance resolves nothing a previous instance stored", async () => {
    // "Given a store at its capacity bound, OR A PLUGIN RESTART, when a
    // previously-stored callId is resolved, then it yields the SAME uniform
    // failure." Process death IS the retention ceiling — that is the strongest
    // bound available and the reason this store is in-memory rather than on disk
    // (commerce data at rest, plus a GC problem no timer-free design can solve).
    putSearchResult("call_1", page("a"), PRINCIPAL);
    expect(getSearchResult("call_1", PRINCIPAL)).not.toBeNull();

    vi.resetModules();
    const fresh = await import("../../lib/search-results-store.js");

    expect(fresh.getSearchResult("call_1", PRINCIPAL)).toBeNull();
    expect(fresh.searchResultMiss("call_1", PRINCIPAL)).toBe("unknown");
  });
});
