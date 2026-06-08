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
