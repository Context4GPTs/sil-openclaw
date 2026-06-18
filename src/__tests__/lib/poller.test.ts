/**
 * UNIT — bounded poll loop (tier: unit, fake timers, no network).
 *
 * Architect Risk #3 (poll-loop leak / unbounded polling) + the product
 * "silent terminal stall" risk. The poller is a bounded
 * interval-with-deadline loop: it calls a `poll` step on each tick, stops
 * on the first TERMINAL step result, stops when the overall deadline is
 * reached, and — the invariant that matters most — leaves NO live timer
 * behind on EITHER exit path. A loop with no deadline runs forever (the
 * session expires at 30 min → infinite 410s) and leaks one timer per
 * `sil_register` call in a reused host process.
 *
 * Driven entirely with vitest fake timers so we can advance the clock
 * deterministically and assert "no timer remains" via
 * `vi.getTimerCount()`. No real time, no network — the `poll` step is a
 * test double returning canned outcomes.
 *
 * Contract this file pins for the implementation (expert-developer),
 * per the In-Dev handoff (`src/lib/poller.ts`):
 *   - startPoll(opts): { stop(): void } and a way to await completion.
 *     We pin behavior through a `poll` callback + `onDone` callback
 *     (or a returned promise). The `poll` callback returns:
 *       { done: false }  → keep polling (another tick is scheduled)
 *       { done: true, ... } → terminal; the loop stops, timer cleared
 *     opts carry { intervalMs, deadlineMs, poll, onDone }.
 * (As with sil-client, if the dev inlines this into identity.ts, export
 * `startPoll` so this isolation test binds. The bounded-loop / no-leak
 * BEHAVIOR is the immutable spec, not the file.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { startPoll } from "../../lib/poller.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("startPoll — bounded interval loop", () => {
  it("calls poll repeatedly at the interval while the step says continue", async () => {
    const poll = vi.fn().mockResolvedValue({ done: false });
    startPoll({ intervalMs: 1000, deadlineMs: 60_000, poll, onDone: vi.fn() });

    // Let the loop schedule + run a few ticks.
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stops on the FIRST terminal poll result and reports it via onDone", async () => {
    const onDone = vi.fn();
    // Two continues, then a terminal success.
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValue({ done: true, outcome: "success" });

    startPoll({ intervalMs: 1000, deadlineMs: 60_000, poll, onDone });
    await vi.advanceTimersByTimeAsync(5000);

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ done: true, outcome: "success" }),
    );
  });

  it("does NOT keep polling after a terminal result (loop truly stops)", async () => {
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValue({ done: true, outcome: "expired" });

    startPoll({ intervalMs: 1000, deadlineMs: 60_000, poll, onDone: vi.fn() });
    await vi.advanceTimersByTimeAsync(3000);
    const callsAtStop = poll.mock.calls.length;

    // Advance far past — no further polls may fire.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll.mock.calls.length).toBe(callsAtStop);
  });
});

describe("startPoll — deadline / budget exhaustion", () => {
  it("stops at the deadline when every step says continue (never unbounded)", async () => {
    const onDone = vi.fn();
    const poll = vi.fn().mockResolvedValue({ done: false }); // never terminal

    startPoll({ intervalMs: 1000, deadlineMs: 10_000, poll, onDone });
    // Advance well past the deadline.
    await vi.advanceTimersByTimeAsync(30_000);

    const callsAtDeadline = poll.mock.calls.length;
    // Further advancing must not produce more polls — the loop is bounded.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll.mock.calls.length).toBe(callsAtDeadline);
  });

  it("reports a terminal TIMEOUT via onDone when the budget is exhausted", async () => {
    const onDone = vi.fn();
    const poll = vi.fn().mockResolvedValue({ done: false });

    startPoll({ intervalMs: 1000, deadlineMs: 5000, poll, onDone });
    await vi.advanceTimersByTimeAsync(20_000);

    // The agent must learn the flow ended — no silent stall. The exact
    // shape is the impl's call; assert SOME terminal timeout signal fired.
    expect(onDone).toHaveBeenCalledTimes(1);
    const arg = onDone.mock.calls[0]![0] as { timedOut?: boolean; outcome?: string };
    expect(arg.timedOut === true || arg.outcome === "timeout").toBe(true);
  });
});

describe("startPoll — no timer leak (the core invariant)", () => {
  it("leaves NO live timer after a terminal result", async () => {
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValue({ done: true, outcome: "success" });

    startPoll({ intervalMs: 1000, deadlineMs: 60_000, poll, onDone: vi.fn() });
    await vi.advanceTimersByTimeAsync(5000);

    // After a terminal stop, the loop must hold zero timers — a leftover
    // interval/timeout would hang a reused host process.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves NO live timer after deadline exhaustion", async () => {
    const poll = vi.fn().mockResolvedValue({ done: false });

    startPoll({ intervalMs: 1000, deadlineMs: 5000, poll, onDone: vi.fn() });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop() cancels the loop and clears its timer (no further polls)", async () => {
    const poll = vi.fn().mockResolvedValue({ done: false });
    const handle = startPoll({
      intervalMs: 1000,
      deadlineMs: 60_000,
      poll,
      onDone: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2000);
    const callsAtStop = poll.mock.calls.length;
    handle.stop();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll.mock.calls.length).toBe(callsAtStop);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a retryable step keeps the loop alive within budget (5xx is not terminal)", async () => {
    // A transient failure returns {done:false} and the loop continues —
    // the budget, not the blip, governs termination.
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ done: false }) // 5xx → retry
      .mockResolvedValueOnce({ done: false }) // 5xx → retry
      .mockResolvedValue({ done: true, outcome: "success" });

    const onDone = vi.fn();
    startPoll({ intervalMs: 1000, deadlineMs: 60_000, poll, onDone });
    await vi.advanceTimersByTimeAsync(5000);

    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ done: true, outcome: "success" }),
    );
    expect(poll.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe("startPoll — fix C: the persist-failure terminal is a RETURNED done:true, never a throw", () => {
  // FIX C, architect risk "poller retry semantics drift" (card line 151). The
  // poller is GENERIC over the step result — it knows only `done`. Fix C
  // classifies a token-PERSIST failure as a TERMINAL inside `claimStep` (a
  // RETURNED `{ done:true, outcome:"persist_failed", error }`), NOT as a thrown
  // error that reaches the poller's catch. The poller MUST NOT change: these two
  // assertions pin both halves of that invariant, so a future refactor that
  // tried to "handle persistence in the poller" (reclassifying a throw as
  // terminal) would break them.
  //
  // These are REGRESSION GUARDS of the generic loop's contract — they hold
  // against the current poller and must keep holding through fix C (the fix
  // touches claimStep + the tool, never poller.ts).

  it("a step that THROWS is still treated as NON-terminal (done:false) — the loop keeps polling, NOT a terminal", async () => {
    // The current catch maps a thrown step to { done:false } (a genuine claim
    // network blip → retry within budget). Fix C must NOT make a throw terminal:
    // a thrown step keeps the loop alive. (The persist failure is terminal
    // because claimStep RETURNS it, not because the poller caught a throw.)
    const onDone = vi.fn();
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("EACCES: permission denied")) // a throw
      .mockRejectedValueOnce(new Error("transient network blip"))
      .mockResolvedValue({ done: true, outcome: "success" });

    startPoll({ intervalMs: 1000, deadlineMs: 60_000, poll, onDone });
    await vi.advanceTimersByTimeAsync(5000);

    // The throwing ticks did NOT settle the loop — it kept polling and only the
    // later RETURNED terminal settled it.
    expect(poll.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ done: true, outcome: "success" }),
    );
  });

  it("a step that RETURNS { done:true, outcome:'persist_failed', error } settles terminally exactly once, with the error carried to onDone, and leaves no timer", async () => {
    // The shape fix C's claimStep returns on a write failure. The generic poller
    // must settle on it like any other terminal — fire onDone EXACTLY once with
    // the full step result (including the `error` carrying path+cause), stop
    // polling, and leak no timer.
    const onDone = vi.fn();
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ done: false }) // one claim tick first
      .mockResolvedValue({
        done: true,
        outcome: "persist_failed",
        error: "/unwritable/dir/tokens.json: EACCES",
      });

    startPoll({ intervalMs: 1000, deadlineMs: 60_000, poll, onDone });
    await vi.advanceTimersByTimeAsync(5000);

    const callsAtSettle = poll.mock.calls.length;
    expect(onDone).toHaveBeenCalledTimes(1);
    // The full step result — outcome AND the descriptive error — reaches onDone
    // (handleDone needs the error to log path+cause loudly).
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        done: true,
        outcome: "persist_failed",
        error: "/unwritable/dir/tokens.json: EACCES",
      }),
    );

    // Truly terminal: no further polling, no leaked timer.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll.mock.calls.length).toBe(callsAtSettle);
    expect(vi.getTimerCount()).toBe(0);
  });
});
