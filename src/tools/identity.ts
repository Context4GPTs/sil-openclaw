/**
 * Identity tools for the sil plugin.
 *
 * `sil_register` is the real browser-based registration tool (the first tool to
 * replace a stub). It follows the klodi register pattern, adapted to sil-web's
 * PKCE contract and to this skeleton's constraints (no NATS, no system-event
 * wake — the declared SDK has neither).
 *
 * `execute()` flow (ALL I/O lives here — `register()` opens nothing):
 *   1. Already-registered short-circuit. If `tokens.json` exists, return
 *      `{ status: "already_registered", user }` — mint nothing, poll nothing,
 *      overwrite nothing. (Presence-based, not freshness-based: refresh is SC7.)
 *   2. Mint PKCE in-process. session_id (UUID), verifier (base64url 32 bytes),
 *      challenge = S256(verifier). The verifier is held ONLY in the poll step
 *      closure below — it never touches disk.
 *   3. Build the auth URL `<apiUrl>/authorize?session=<id>&code_challenge=<chal>`.
 *      The plugin does NOT pre-POST to sil-web: the pending session row is
 *      INSERTed server-side when the USER's browser opens this URL.
 *   4. Start a fire-and-forget bounded poll of the claim endpoint, then return
 *      promptly with `{ status: "awaiting_browser", auth_url, session_id }`.
 *   5. On the poll's terminal success, persist tokens.json + config.json
 *      atomically. Other terminals (expired / already_claimed / not_found /
 *      timeout) persist nothing; the agent learns the outcome by re-calling
 *      sil_register (→ already_registered) or sil_whoami.
 *
 * register() must stay synchronous and side-effect-free beyond registering the
 * tool — no fetch, no timer, no unawaited promise here. The poll timer is armed
 * inside execute(), never at register time.
 */

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import { getApiUrl, getSilApiUrl } from "../lib/config.js";
import {
  clearTokens,
  hasTokens,
  readConfig,
  readTokens,
  writeConfig,
  writeTokens,
} from "../lib/credentials.js";
import { deriveChallenge, newSessionId, newVerifier } from "../lib/pkce.js";
import {
  POLL_DEADLINE_MS,
  POLL_INTERVAL_MS,
  startPoll,
  type PollDoneResult,
} from "../lib/poller.js";
import {
  claimSession,
  fetchIdentity,
  refreshAndRetryOnce,
  type ClaimOutcome,
  type Identity,
  type IdentityOutcome,
} from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";

export function registerIdentityTools(api: PluginAPI): void {
  registerRegister(api);
  registerWhoami(api);
}

function registerRegister(api: PluginAPI): void {
  api.registerTool({
    name: "sil_register",
    label: "Register on sil",
    description:
      "Start browser-based registration on sil. Returns an auth URL for the"
      + " user to open in a browser. The plugin polls the session in the"
      + " background until registration completes (then it stores credentials"
      + " locally), the link expires, or the attempt times out. Call this tool"
      + " again afterwards to confirm registration completed.",
    parameters: Type.Object({}),
    async execute() {
      // 1 — already registered: short-circuit, no mint, no poll, no overwrite.
      if (hasTokens()) {
        const config = readConfig();
        return jsonResult({
          status: "already_registered",
          user: config?.user ?? null,
        });
      }

      // 2 — mint PKCE. The verifier stays in this closure (never on disk).
      const sessionId = newSessionId();
      const verifier = newVerifier();
      const challenge = deriveChallenge(verifier);
      const apiUrl = getApiUrl();

      // 3 — build the auth URL. Opening it (by the user's browser) is what
      // creates the pending session server-side; the plugin does not pre-POST.
      const authUrl =
        `${stripTrailingSlash(apiUrl)}/authorize`
        + `?session=${sessionId}&code_challenge=${challenge}`;

      // 4 — fire-and-forget bounded poll. Not awaited: execute() returns now.
      // The poll step maps each claim outcome to the loop's done/continue
      // signal AND performs persistence on success (so the atomic write
      // completes inside the awaited tick, before onDone fires); the verifier
      // is captured here and never leaves memory.
      startPoll({
        intervalMs: POLL_INTERVAL_MS,
        deadlineMs: POLL_DEADLINE_MS,
        poll: () => claimStep(apiUrl, sessionId, verifier),
        onDone: (result) => handleDone(api, sessionId, result),
      });

      api.logger.info("sil_register_started", { session_id: sessionId });

      return jsonResult({
        status: "awaiting_browser",
        message: `Open this URL in a browser to register: ${authUrl}`,
        auth_url: authUrl,
        session_id: sessionId,
        instructions:
          "Share the auth URL with the user. The plugin is polling in the"
          + " background — once the user finishes signing in, call sil_register"
          + " again to confirm (it will report already_registered).",
      });
    },
  });
}

/**
 * `sil_whoami` — read the registered user's live identity (name + addresses)
 * from sil-api with the stored Bearer token, refreshing transparently on an
 * expired access token.
 *
 * execute() flow (ALL I/O here; register() opens nothing, arms no timer —
 * whoami is a synchronous request/response, NOT a poll):
 *   1. Read tokens.json. Absent → terminal `not_registered` (run sil_register),
 *      ZERO network calls (nothing to authenticate with).
 *   2. fetchIdentity(sil-api, access_token), then route the outcome through the
 *      SHARED `refreshAndRetryOnce` choreography — the SAME path sil_search and
 *      sil_product_get use, so 401 recovery is uniform across every
 *      sil-api-calling tool (factored so the three cannot drift apart; FLAG-10).
 *      The helper owns the bounded refresh-and-retry-once: on a 401 it refreshes
 *      ONCE via sil-web (rotates tokens.json), re-reads the rotated pair, and
 *      retries the read ONCE; a non-401 first outcome passes straight through.
 *   3. Map the helper's discriminant to the agent-facing result:
 *        result            → ok / forbidden / retryable mapped as usual (the first
 *                            non-401, OR the retry's non-401 outcome);
 *        must_reregister    → terminal (clear tokens on invalid_grant);
 *        second_unauthorized→ terminal + clear tokens (a freshly-rotated token still
 *                            rejected is structurally dead — NEVER a second refresh);
 *        retryable          → terminal transient ("try again").
 *      At most one refresh + one retry per call (structural in the helper).
 *
 * Privacy: the access/refresh tokens and the Bearer header never reach a log
 * line or the result; identity PII (name, addresses) is in the result (the
 * point) but never logged. Logs carry only non-credential status markers.
 */
function registerWhoami(api: PluginAPI): void {
  api.registerTool({
    name: "sil_whoami",
    label: "Who am I on sil",
    description:
      "Return the registered user's identity (name and addresses) from sil,"
      + " using the credentials stored by sil_register. If the access token has"
      + " expired it is refreshed transparently and the read is retried. If you"
      + " are not registered, or the session has fully expired, the result names"
      + " the recovery action (run sil_register).",
    parameters: Type.Object({}),
    async execute() {
      // 1 — not registered: terminal, zero network calls.
      const stored = readTokens();
      if (stored === null) {
        return notRegistered();
      }

      // 2 — read identity; on a 401 refresh-and-retry ONCE via the shared
      // choreography (the SAME `refreshAndRetryOnce` path sil_search /
      // sil_product_get use — 401 recovery is uniform across every
      // sil-api-calling tool, factored so the three cannot drift apart).
      const first = await fetchIdentity(getSilApiUrl(), stored.access_token);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => fetchIdentity(getSilApiUrl(), accessToken),
      );
      switch (recovered.kind) {
        case "result":
          // The first non-401 outcome, OR the retry's non-401 outcome (ok /
          // forbidden / retryable) — mapped to its terminal/transient/success result.
          return identityOutcomeToResult(api, recovered.outcome);
        case "must_reregister":
          // The refresh token is dead (invalid_grant) → clear the now-known-dead
          // pair so the user's sil_register recovery is not blocked by stale
          // presence; a TOCTOU empty re-read (no_stored_tokens) has nothing to clear.
          if (recovered.reason === "invalid_grant") clearTokens();
          api.logger.info("sil_whoami_must_reregister", { cause: recovered.reason });
          return mustReregister();
        case "second_unauthorized":
          // A freshly-rotated token STILL rejected is structurally dead — terminal,
          // never another refresh. Clear the dead pair.
          clearTokens();
          api.logger.info("sil_whoami_must_reregister", { cause: "retry_unauthorized" });
          return mustReregister();
        case "retryable":
          api.logger.info("sil_whoami_refresh_retryable", {});
          return transient();
      }
    },
  });
}

/** Map a non-401 identity outcome to the agent-facing result. (401 is handled
 * inline by the refresh path; it never reaches here.) */
function identityOutcomeToResult(api: PluginAPI, outcome: IdentityOutcome) {
  switch (outcome.kind) {
    case "ok":
      return identityResult(outcome.identity);
    case "forbidden":
      api.logger.warn("sil_whoami_forbidden", { reason: outcome.reason });
      return forbidden(outcome.reason);
    case "retryable":
      api.logger.info("sil_whoami_retryable", {});
      return transient();
    case "unauthorized":
      // Unreachable in practice (the caller intercepts 401), but the switch is
      // exhaustive so a future refactor can't silently drop a variant.
      return mustReregister();
  }
}

/** Success: the identity payload ONLY — no token, no Bearer header. */
function identityResult(identity: Identity) {
  return jsonResult({ status: "ok", identity });
}

/** Not registered: a distinct, actionable outcome naming the recovery tool. No
 * identity fields (name/addresses) so the agent can't mistake it for a read. */
function notRegistered() {
  return jsonResult({
    status: "not_registered",
    message:
      "Not registered on sil. Run sil_register to authenticate, then call"
      + " sil_whoami again.",
    recovery: "sil_register",
  });
}

/** Terminal: the session is fully expired (refresh rejected). Re-register. */
function mustReregister() {
  return jsonResult({
    status: "must_reregister",
    message:
      "Your sil session has expired. Run sil_register to sign in again, then"
      + " call sil_whoami again.",
    recovery: "sil_register",
  });
}

/** Terminal-but-distinct: the token is valid but the user isn't provisioned (or
 * a principal mismatch). Refreshing would not help — guide the right recovery. */
function forbidden(reason: string) {
  const message =
    reason === "user_not_provisioned"
      ? "Your sil account is not fully set up. Complete onboarding (run"
        + " sil_register) and try again."
      : "sil rejected this request (" + reason + "). Run sil_register to"
        + " re-establish your session, then try again.";
  return jsonResult({ status: "forbidden", reason, message, recovery: "sil_register" });
}

/** Transient: a network/5xx blip — try again, NOT a re-register (false terminal). */
function transient() {
  return jsonResult({
    status: "retryable",
    message: "sil is temporarily unavailable. Please try sil_whoami again.",
  });
}

/** The terminal step shape carried through the poller to `onDone`. */
interface ClaimStep extends Record<string, unknown> {
  done: boolean;
  outcome?: ClaimOutcome["kind"];
  user_id?: string;
}

/**
 * One poll step: claim, then map the outcome to the loop's done/continue signal.
 * `pending`/`retryable` keep the loop alive (`done:false`). A successful claim
 * is persisted HERE — tokens.json + config.json written atomically inside this
 * awaited tick — so the files are on disk before the loop settles; the step then
 * carries only the user_id forward (the tokens never travel past this closure).
 * Other terminals (expired / already_claimed / not_found) persist nothing.
 */
async function claimStep(
  apiUrl: string,
  sessionId: string,
  verifier: string,
): Promise<ClaimStep> {
  const outcome: ClaimOutcome = await claimSession(apiUrl, sessionId, verifier);
  switch (outcome.kind) {
    case "pending":
    case "retryable":
      return { done: false };
    case "success":
      await writeTokens({
        access_token: outcome.access_token,
        refresh_token: outcome.refresh_token,
      });
      await writeConfig({ user: outcome.user });
      return { done: true, outcome: "success", user_id: outcome.user.id };
    case "expired":
    case "already_claimed":
    case "not_found":
      return { done: true, outcome: outcome.kind };
  }
}

/**
 * Record a structured log on every terminal so no outcome is silent. Tokens are
 * already persisted (in `claimStep`) and are NEVER logged — the success case
 * logs only the user id.
 */
function handleDone(
  api: PluginAPI,
  sessionId: string,
  result: PollDoneResult,
): void {
  const step = result as ClaimStep;

  if (step.outcome === "success") {
    api.logger.info("sil_register_claimed", {
      session_id: sessionId,
      user_id: typeof step.user_id === "string" ? step.user_id : "",
    });
    return;
  }

  if ("timedOut" in step && step.timedOut === true) {
    api.logger.info("sil_register_timeout", { session_id: sessionId });
    return;
  }

  // expired / already_claimed / not_found — log the terminal so the outcome is
  // never silent; the agent learns it on its next sil_register / sil_whoami.
  const outcome = typeof step.outcome === "string" ? step.outcome : "unknown";
  const marker = `sil_register_${outcome}`;
  if (outcome === "not_found") {
    api.logger.warn(marker, { session_id: sessionId });
  } else {
    api.logger.info(marker, { session_id: sessionId });
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
