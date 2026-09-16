import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import { getWebUrl, getWebUrlSource, getApiUrl } from "../lib/config.js";
import {
  clearTokens,
  getTokensPath,
  hasTokens,
  readConfig,
  readTokens,
  writeConfig,
  writeTokens,
} from "../lib/credentials.js";
import { wiringAdvisories } from "../lib/host-wiring.js";
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
  stripTrailingSlash,
  type ClaimOutcome,
  type Identity,
  type IdentityOutcome,
} from "../lib/sil-client.js";
import { jsonResult } from "../lib/tool-result.js";

export function registerIdentityTools(api: PluginAPI): void {
  registerRegister(api);
  registerWhoami(api);
}

/**
 * All of registration's I/O lives in execute(): a fresh call mints PKCE, returns
 * the link at once, and arms ONE bounded background poll of the claim endpoint,
 * which persists the token pair on its only success. A claim 404 is the normal
 * pre-open state and keeps polling; every other terminal persists nothing and is
 * learnt by calling sil_register again.
 */
function registerRegister(api: PluginAPI): void {
  api.registerTool({
    name: "sil_register",
    label: "Register on sil",
    description:
      "Hand the buyer a link that opens. `open` is the whole link: show it on its"
      + " own line so nothing breaks it, and let the buyer open it themselves. The"
      + " plugin polls in the background and stores the credentials once they"
      + " finish, so call sil_register again to confirm — it answers"
      + " already_registered. A buyer who is already registered gets that answer"
      + " straight away: carry on with what they asked for, nothing is offered and"
      + " nothing is created.",
    parameters: Type.Object({}),
    async execute() {
      // 1 — already registered: short-circuit, no mint, no poll, no overwrite.
      // Nothing is offered or created here (contract §3.10): the agent carries on.
      if (hasTokens()) {
        const config = readConfig();
        return jsonResult({
          status: "already_registered",
          user: config?.user ?? null,
          // Folded here but NOT onto `awaiting_browser`: that one is a hand-off
          // whose whole job is to get one link in front of the buyer.
          ...wiringAdvisories(api),
        });
      }

      // A fresh attempt clears any prior in-process persist-failure marker, so a
      // stale one cannot make a later genuine `not_registered` read as
      // `persistence_failed`.
      clearPersistFailure();

      // 2 — mint PKCE. The verifier stays in this closure (never on disk).
      const sessionId = newSessionId();
      const verifier = newVerifier();
      const challenge = deriveChallenge(verifier);
      const webUrl = getWebUrl();

      // 3 — the session rides in the PATH: every OpenClaw host masks the value of
      // a query parameter named `session`, so a `?session=` link reaches the buyer
      // as `session=***` and sil-web answers invalid_session. Opening this link is
      // what creates the pending session server-side; the plugin does not pre-POST.
      const open =
        `${stripTrailingSlash(webUrl)}/authorize/${sessionId}`
        + `?code_challenge=${challenge}`;

      // 4 — fire-and-forget bounded poll. Not awaited: execute() returns now.
      // The poll step persists on success inside its own awaited tick, so the
      // files are on disk before the loop settles; the verifier is captured here
      // and never leaves memory.
      startPoll({
        intervalMs: POLL_INTERVAL_MS,
        deadlineMs: POLL_DEADLINE_MS,
        poll: () => claimStep(webUrl, sessionId, verifier),
        onDone: (result) => handleDone(api, sessionId, result),
      });

      api.logger.info("sil_register_started", { session_id: sessionId });

      return jsonResult({
        status: "awaiting_browser",
        open,
        // The steer is a SEPARATE line above the link, so the link line stays
        // exactly `<open>` — one atomic target a greedy chat auto-linker captures
        // whole rather than truncating mid-URL.
        message: BROWSER_STEER_HUMAN + "\n" + presentAuthLink(open),
        // Built from the same negative clause as `message`, so an agent relaying
        // it cannot paraphrase back to a generic "a browser".
        instructions:
          "Share the link with the buyer and tell them to "
          + BROWSER_STEER_AGENT
          + " The plugin is polling in the background — once they finish signing"
          + " in, call sil_register again to confirm (it will report"
          + " already_registered).",
      });
    },
  });
}

/**
 * A live read, never a poll. The 401 recovery is the SHARED `refreshAndRetryOnce`
 * every `shopping_*` call uses, so the tools cannot drift apart: at most one
 * refresh and one retry per call, and a freshly-rotated token still rejected is
 * structurally dead — clear the pair, never refresh twice. Identity PII rides the
 * result and is never logged; tokens reach neither.
 */
function registerWhoami(api: PluginAPI): void {
  api.registerTool({
    name: "sil_whoami",
    label: "Who am I on sil",
    description:
      "The buyer's name, country and the addresses on file, read live from sil"
      + " with the credentials sil_register stored — a stale session token is"
      + " refreshed once and the read retried. Use it to know where the buyer is:"
      + " never ask them for what this answers. If they are not registered, or the"
      + " session is past refreshing, the result names the recovery (sil_register).",
    parameters: Type.Object({}),
    async execute() {
      // 1 — no tokens on disk is the SAME state for a never-registered buyer and
      // for one whose token write failed in this process, so the in-process marker
      // is the only thing that tells the two apart.
      const stored = readTokens();
      if (stored === null) {
        const failure = getPersistFailure();
        return failure !== null ? persistenceFailed(failure) : notRegistered();
      }

      // A staging/self-host web origin is legitimate, so it is surfaced and warned
      // about, never rejected — a wrong one is then diagnosable before anything 404s.
      const webOrigin = getWebUrl();
      const webOriginSource = getWebUrlSource();
      if (webOriginSource !== "default") {
        api.logger.warn("sil_whoami_web_origin_override", {
          web_origin: webOrigin,
          web_origin_source: webOriginSource,
        });
      }
      const originBlock = {
        web_origin: webOrigin,
        web_origin_source: webOriginSource,
      };

      // 2 — read identity; on a 401 refresh-and-retry ONCE, shared with every
      // `shopping_*` call so the recovery cannot drift between tools.
      const first = await fetchIdentity(getApiUrl(), stored.access_token);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => fetchIdentity(getApiUrl(), accessToken),
      );
      switch (recovered.kind) {
        case "result":
          // Logs-only, never a payload field: a session thrashing through silent
          // 401 recoveries is invisible otherwise.
          if (recovered.refreshed) api.logger.info("sil_whoami_refreshed", {});
          return identityOutcomeToResult(api, recovered.outcome, originBlock);
        case "must_reregister":
          // Clear the known-dead pair so its stale presence cannot block the
          // sil_register recovery; an empty re-read has nothing to clear.
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

/** The resolved sil-web origin and where it came from. Strings only. */
interface OriginBlock {
  web_origin: string;
  web_origin_source: string;
}

/** Map a non-401 identity outcome to the agent-facing result. The origin block
 * rides the SUCCESS payload only — pre-failure diagnosis is its whole point. */
function identityOutcomeToResult(
  api: PluginAPI,
  outcome: IdentityOutcome,
  originBlock: OriginBlock,
) {
  switch (outcome.kind) {
    case "ok":
      return identityResult(api, outcome.identity, originBlock);
    case "forbidden":
      // A token that maps to no account is structurally dead, so clear it or the
      // sil_register recovery answers `already_registered` and strands the buyer.
      // EXACT equality: `principal_mismatch` can be transient and must survive.
      api.logger.warn("sil_whoami_forbidden", { reason: outcome.reason });
      if (outcome.reason === "user_not_provisioned") clearTokens();
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

/** Success: `identity` carries the buyer's name, country (when the read has one)
 * and addresses — no token, no Bearer header. */
function identityResult(
  api: PluginAPI,
  identity: Identity,
  originBlock: OriginBlock,
) {
  return jsonResult({
    status: "ok",
    identity,
    ...originBlock,
    ...wiringAdvisories(api),
  });
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

/**
 * Auth succeeded but the token write failed. Distinct from `not_registered`
 * because the recovery differs: a bare "run sil_register" fails to persist again
 * and loops, so `error` names the path and cause to fix first.
 */
function persistenceFailed(error: string) {
  return jsonResult({
    status: "persistence_failed",
    message:
      "Registration authenticated but the credentials could NOT be written to"
      + " disk, so it did not stick. Fix the data directory (it must be writable"
      + " — check permissions / free space / that $SIL_DATA_DIR is a directory),"
      + " then run sil_register again.",
    error,
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

/** The terminal step shape carried through the poller to `onDone`. `persist_failed`
 * is not a `ClaimOutcome["kind"]`: the claim succeeded and the write did not. */
interface ClaimStep extends Record<string, unknown> {
  done: boolean;
  outcome?: ClaimOutcome["kind"] | "persist_failed";
  user_id?: string;
  error?: string;
}

/**
 * The only thing that tells a failed token write apart from a never-registered
 * buyer — both leave no `tokens.json`. In-process on purpose: the failure mode IS
 * an unwritable data dir, so an on-disk sentinel would fail to write too, and
 * after a restart `not_registered` is the true state.
 */
let _persistFailure: string | null = null;

function setPersistFailure(error: string): void {
  _persistFailure = error;
}

function getPersistFailure(): string | null {
  return _persistFailure;
}

function clearPersistFailure(): void {
  _persistFailure = null;
}

/**
 * One poll step: claim, then map the outcome to the loop's done/continue signal.
 * A 404 `not_found` is the normal state BEFORE the buyer opens the link (the
 * session row is inserted server-side then), so it keeps polling like `pending`
 * and a session that never appears settles as `timeout`. The success is persisted
 * HERE, inside the awaited tick, so the files land before the loop settles.
 */
async function claimStep(
  webUrl: string,
  sessionId: string,
  verifier: string,
): Promise<ClaimStep> {
  const outcome: ClaimOutcome = await claimSession(webUrl, sessionId, verifier);
  switch (outcome.kind) {
    case "pending":
    case "retryable":
    case "not_found":
      return { done: false };
    case "success":
      // ONLY the persist calls are wrapped — a wider catch could mislabel a
      // genuine claim success. A write failure is TERMINAL: re-polling cannot make
      // the data dir writable and the claim is single-use, so a throw reaching the
      // poller's catch would end the run as a misleading timeout.
      try {
        await writeTokens({
          access_token: outcome.access_token,
          refresh_token: outcome.refresh_token,
        });
        await writeConfig({ user: outcome.user });
      } catch (err) {
        const error = `${getTokensPath()}: ${describeCause(err)}`;
        setPersistFailure(error);
        return { done: true, outcome: "persist_failed", error };
      }
      return { done: true, outcome: "success", user_id: outcome.user.id };
    case "expired":
    case "already_claimed":
    case "invalid_request":
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

  // At error, alone among the terminals: an operator must see a persist failure
  // rather than read it as a buyer who abandoned the flow.
  if (step.outcome === "persist_failed") {
    api.logger.error("sil_register_persist_failed", {
      session_id: sessionId,
      error: typeof step.error === "string" ? step.error : "",
    });
    return;
  }

  if ("timedOut" in step && step.timedOut === true) {
    api.logger.info("sil_register_timeout", { session_id: sessionId });
    return;
  }

  // `invalid_request` is WARN: this client cannot produce a malformed claim, so it
  // signals contract drift rather than a buyer outcome. The rest are routine.
  const outcome = typeof step.outcome === "string" ? step.outcome : "unknown";
  const marker = `sil_register_${outcome}`;
  if (outcome === "invalid_request") {
    api.logger.warn(marker, { session_id: sessionId });
  } else {
    api.logger.info(marker, { session_id: sessionId });
  }
}

/** The errno first, then the message: an operator scanning a log line reads
 * EACCES/ENOSPC before the prose. An fs error names paths only, never a token. */
function describeCause(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

/** Angle brackets are the RFC-3986 convention that bounds a URL, so a greedy chat
 * auto-linker captures the WHOLE span instead of stopping at a separator. The
 * caller puts it on its own line so no prose can be folded into the link. */
function presentAuthLink(open: string): string {
  return `<${open}>`;
}

/**
 * Auth0 sets its session cookie on its own domain and an embedded webview
 * partitions it, so the link dead-ends there. The host exposes no surface signal
 * to detect that, so the steer ships unconditionally — and ONE negative clause
 * feeds both copies, so an agent relaying it cannot drop the half that matters.
 */
const BROWSER_STEER_NEGATIVE =
  "your device's default browser (Safari, Chrome, …), not this app's"
  + " built-in / in-app browser";

/** Human-facing lead line — the line ABOVE the atomic link in `message`. */
const BROWSER_STEER_HUMAN = `Open this link in ${BROWSER_STEER_NEGATIVE}:`;

/** Agent-facing steer — embedded mid-sentence in `instructions` (lower-cased lead
 * so it reads naturally after "tell them to …"). */
const BROWSER_STEER_AGENT = `open the link in ${BROWSER_STEER_NEGATIVE}.`;
