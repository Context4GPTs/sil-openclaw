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
import { Type } from "@sinclair/typebox";

import { getApiUrl } from "../lib/config.js";
import {
  hasTokens,
  readConfig,
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
import { claimSession, type ClaimOutcome } from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";

export function registerIdentityTools(api: PluginAPI): void {
  registerRegister(api);
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
