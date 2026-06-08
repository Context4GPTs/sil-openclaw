/**
 * Generic bounded interval-with-deadline poll loop.
 *
 * Lifecycle (the whole reason this is its own module — so the timer behaviour is
 * unit-testable with fake timers, in isolation from the claim taxonomy):
 *   - `startPoll` arms a `setInterval` and returns a handle with `stop()`.
 *   - Each tick calls the injected `poll()` step. It returns `{ done: false }`
 *     to keep polling or `{ done: true, ... }` to terminate.
 *   - The FIRST terminal step stops the loop and fires `onDone` EXACTLY once
 *     with that step result.
 *   - If the overall deadline passes with no terminal step, the loop stops and
 *     fires `onDone` with a synthetic timeout result `{ done, timedOut, outcome:
 *     "timeout" }`, so no run ends in silence.
 *   - The interval timer is cleared on EVERY exit path (terminal, deadline,
 *     explicit `stop()`). The architect's "poll loop leak" risk: a missed
 *     `clearInterval` leaks a timer per `sil_register` call in a reused process.
 *     `vi.getTimerCount()` must be 0 after any exit — enforced by poller.test.ts.
 *
 * The loop is deliberately GENERIC over the step result: it knows only `done`.
 * The claim-status → done mapping lives in the caller (the tool), keeping the
 * HTTP taxonomy (sil-client) and the timer lifecycle (here) independently
 * testable. No system event / wake is fired — the declared OpenClaw SDK has no
 * such member; success is observed by the credential file landing on disk.
 */

/** Poll cadence: how often a tick fires a `poll()` step. ~3s (architect default). */
export const POLL_INTERVAL_MS = 3_000;
/** Overall budget: must not outlive sil-web's 30-min session TTL. ~30 min. */
export const POLL_DEADLINE_MS = 30 * 60 * 1_000;

/** Minimal contract a `poll()` step must satisfy. `done:false` → keep polling;
 * `done:true` (plus any caller-defined fields) → terminate. */
export interface PollStepResult {
  done: boolean;
  [key: string]: unknown;
}

/** What `onDone` receives: either the terminal step result, or the synthetic
 * timeout the poller injects on deadline exhaustion. */
export type PollDoneResult =
  | PollStepResult
  | { done: true; timedOut: true; outcome: "timeout" };

/** Handle to a running poll; `stop()` is idempotent and clears the timer. */
export interface PollHandle {
  stop(): void;
}

export interface StartPollOptions {
  /** Milliseconds between `poll()` ticks. */
  intervalMs: number;
  /** Overall budget; the loop stops and reports a timeout once it elapses. */
  deadlineMs: number;
  /** One poll step. Injected so tests script results without a network. */
  poll: () => Promise<PollStepResult>;
  /** Fired exactly once when the loop reaches any terminal state. */
  onDone: (result: PollDoneResult) => void;
  /** Monotonic clock; injectable so deadline tests don't depend on Date.now. */
  now?: () => number;
}

/**
 * Arm the bounded poll. Returns immediately with a handle — the caller (the
 * tool's `execute`) does NOT await it; that is what keeps the tool non-blocking.
 */
export function startPoll(opts: StartPollOptions): PollHandle {
  const now = opts.now ?? Date.now;
  const startedAt = now();

  let settled = false;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  // Single exit point: clear the timer once, fire onDone once. Every terminal
  // branch routes through here so a timer can never be left armed.
  const settle = (result: PollDoneResult): void => {
    if (settled) return;
    settled = true;
    clearTimer();
    opts.onDone(result);
  };

  const tick = async (): Promise<void> => {
    if (settled) return;
    // Deadline check FIRST: if the budget is spent, stop before another poll.
    if (now() - startedAt >= opts.deadlineMs) {
      settle({ done: true, timedOut: true, outcome: "timeout" });
      return;
    }
    // Skip overlapping ticks — a slow poll step must not stack a second
    // in-flight call on the next interval.
    if (inFlight) return;

    inFlight = true;
    let result: PollStepResult;
    try {
      result = await opts.poll();
    } catch {
      // A throw from the injected step is treated as non-terminal: the
      // sil-client wrapper already maps network errors to a retryable result,
      // so this is belt-and-braces; let the next tick (within budget) retry.
      result = { done: false };
    } finally {
      inFlight = false;
    }

    if (settled) return; // a concurrent stop() landed during the await.
    if (result.done) settle(result);
  };

  timer = setInterval(() => void tick(), opts.intervalMs);

  return {
    stop(): void {
      if (settled) return;
      settled = true;
      clearTimer();
    },
  };
}
