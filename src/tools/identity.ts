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
 *      atomically. Other terminals (expired / already_claimed / invalid_request /
 *      timeout) persist nothing; the agent learns the outcome by re-calling
 *      sil_register (→ already_registered) or sil_whoami. A claim 404 (`not_found`)
 *      is NOT a terminal — it is the normal pre-session early state and keeps the
 *      poll ticking; a session that never appears ends as `timeout` at the deadline.
 *
 * register() must stay synchronous and side-effect-free beyond registering the
 * tool — no fetch, no timer, no unawaited promise here. The poll timer is armed
 * inside execute(), never at register time.
 */

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

      // A fresh registration attempt clears any prior in-process persist-failure
      // marker: this process is starting over, so a stale marker from an earlier
      // failed attempt must not make a later genuine `not_registered` (or this
      // attempt's own outcome) masquerade as `persistence_failed`. (FIX C.)
      clearPersistFailure();

      // 2 — mint PKCE. The verifier stays in this closure (never on disk).
      const sessionId = newSessionId();
      const verifier = newVerifier();
      const challenge = deriveChallenge(verifier);
      // The sil-WEB origin (auth authority) — this is what the auth URL is built
      // from. The local was historically misnamed `apiUrl`; it is the web origin.
      const webUrl = getWebUrl();

      // 3 — build the auth URL. Opening it (by the user's browser) is what
      // creates the pending session server-side; the plugin does not pre-POST.
      const authUrl =
        `${stripTrailingSlash(webUrl)}/authorize`
        + `?session=${sessionId}&code_challenge=${challenge}`;

      // 4 — fire-and-forget bounded poll. Not awaited: execute() returns now.
      // The poll step maps each claim outcome to the loop's done/continue
      // signal AND performs persistence on success (so the atomic write
      // completes inside the awaited tick, before onDone fires); the verifier
      // is captured here and never leaves memory.
      startPoll({
        intervalMs: POLL_INTERVAL_MS,
        deadlineMs: POLL_DEADLINE_MS,
        poll: () => claimStep(webUrl, sessionId, verifier),
        onDone: (result) => handleDone(api, sessionId, result),
      });

      api.logger.info("sil_register_started", { session_id: sessionId });

      return jsonResult({
        status: "awaiting_browser",
        // Present the auth URL as ONE atomic, unbreakable link: on its own line,
        // angle-bracket wrapped, so a greedy chat auto-linker captures the WHOLE
        // URL (the `&code_challenge` included) instead of truncating at the `&`
        // and 400-ing `invalid_code_challenge`. `auth_url` below stays the
        // canonical, UNWRAPPED machine field agents parse. (FIX A.)
        message:
          "Open this URL in a browser to register:\n"
          + presentAuthLink(authUrl),
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
      // 1 — not registered: terminal, zero network calls. If THIS process saw a
      // token-persist failure (auth succeeded but the write failed), surface the
      // distinct `persistence_failed` state instead — the no-tokens.json state on
      // disk is identical for both, so the in-process marker is the only signal
      // that tells them apart (FIX C; cold-restart correctly degrades to
      // not_registered — see the persistence_failed/notRegistered helpers).
      const stored = readTokens();
      if (stored === null) {
        const failure = getPersistFailure();
        return failure !== null ? persistenceFailed(failure) : notRegistered();
      }

      // B (origin visibility): resolve the sil-WEB origin (the origin the
      // registration link is built from) + its source, surface it on the success
      // payload so a wrong/staging origin is diagnosable BEFORE anything 404s,
      // and emit a single warn when the source is non-default. Warn-only — a
      // staging/self-host origin is legitimate, so it is NEVER rejected. Scope is
      // the WEB origin only; the sil-api read origin is out of scope. (FIX B.)
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

      // 2 — read identity; on a 401 refresh-and-retry ONCE via the shared
      // choreography (the SAME `refreshAndRetryOnce` path sil_search /
      // sil_product_get use — 401 recovery is uniform across every
      // sil-api-calling tool, factored so the three cannot drift apart).
      const first = await fetchIdentity(getApiUrl(), stored.access_token);
      const recovered = await refreshAndRetryOnce(
        first,
        (o): boolean => o.kind === "unauthorized",
        (accessToken) => fetchIdentity(getApiUrl(), accessToken),
      );
      switch (recovered.kind) {
        case "result":
          // The first non-401 outcome, OR the retry's non-401 outcome (ok /
          // forbidden / retryable) — mapped to its terminal/transient/success result.
          // On a silent recovery (`refreshed`: a 401 was healed by the refresh+retry)
          // emit the operator marker so a thrashing session is visible in logs —
          // logs-only, no token material, NOT a payload field (the agent never sees it).
          if (recovered.refreshed) api.logger.info("sil_whoami_refreshed", {});
          return identityOutcomeToResult(api, recovered.outcome, originBlock);
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

/** The web-origin visibility block attached to the success payload (FIX B):
 * the resolved sil-web origin + its source, so a wrong/staging origin is
 * diagnosable. Strings only — never any token material. */
interface OriginBlock {
  web_origin: string;
  web_origin_source: string;
}

/** Map a non-401 identity outcome to the agent-facing result. (401 is handled
 * inline by the refresh path; it never reaches here.) The origin block rides the
 * SUCCESS payload (the point is pre-failure diagnosis); the terminal/transient
 * envelopes don't carry it. */
function identityOutcomeToResult(
  api: PluginAPI,
  outcome: IdentityOutcome,
  originBlock: OriginBlock,
) {
  switch (outcome.kind) {
    case "ok":
      return identityResult(outcome.identity, originBlock);
    case "forbidden":
      // Decision B — the dead-token clear is UNIFORM across all three sil-api tools.
      // `sil_whoami` is the tool that is legible TODAY; an agent that diagnoses the
      // 403 via whoami, follows `recovery:"sil_register"`, and hits
      // `already_registered` is stranded identically to the catalog path. So clear on
      // `user_not_provisioned` HERE too (the held token maps to no account on this
      // backend; a refresh cannot help — structurally dead, like the invalid_grant
      // clear above). Gated on EXACT equality: `principal_mismatch` / unknown reasons
      // can be transient and must stay recoverable, so they keep the legible forbidden
      // envelope WITHOUT a destructive clear (AC9 clears, AC10 does not).
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

/** Success: the identity payload + the web-origin visibility block (FIX B) —
 * no token, no Bearer header. The origin block (strings only) lets the agent
 * relay the resolved origin + its source so a wrong origin is diagnosable. */
function identityResult(identity: Identity, originBlock: OriginBlock) {
  return jsonResult({ status: "ok", identity, ...originBlock });
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
 * Registered-but-persistence-failed (FIX C): auth succeeded in THIS process but
 * the token write failed, so nothing reached disk. DISTINCT from `not_registered`
 * because the recovery differs — the user must FIX THE DATA DIR (the path + cause
 * name what to fix), THEN re-register; a bare "run sil_register" would just fail
 * to persist again, looping. `error` carries the "<path>: <cause>" from the
 * in-process marker. No identity fields (the tokens never landed).
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
 * is FIX C's new terminal: auth succeeded but the token write failed — distinct
 * from the wire terminals (it is not a `ClaimOutcome["kind"]`) and from a
 * `timeout`. `error` carries the "<path>: <cause>" for the loud log + whoami. */
interface ClaimStep extends Record<string, unknown> {
  done: boolean;
  outcome?: ClaimOutcome["kind"] | "persist_failed";
  user_id?: string;
  error?: string;
}

/**
 * In-process persist-failure marker (FIX C). A failed token write leaves NO
 * `tokens.json` on disk — exactly the state a never-registered user has — so the
 * two are indistinguishable from disk alone. This module-level marker is the only
 * signal that tells `sil_whoami` "auth succeeded in THIS process but persistence
 * failed" apart from a bare `not_registered`. It is intentionally in-process only:
 * the failure mode IS an unwritable data dir, so an on-disk sentinel would fail to
 * write for the same reason — and after a cold restart `not_registered` is the
 * TRUE state (no creds exist), with a re-run of `sil_register` re-surfacing the
 * write failure loudly. Set by `claimStep` on the persist_failed terminal; reset
 * on a fresh `sil_register` start so a stale marker can't mislabel a later genuine
 * not_registered (and resettable in tests via that same fresh-start path).
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
 * `pending`/`retryable`/`not_found` keep the loop alive (`done:false`). The 404
 * `not_found` is the NORMAL pre-session early state (the session row is INSERTed
 * server-side only when the user opens the auth URL), so it keeps polling exactly
 * like `pending`, bounded by the 30-min deadline — a session that never appears
 * settles as `timeout`, never as `not_found`. A successful claim is persisted
 * HERE — tokens.json + config.json written atomically inside this awaited tick —
 * so the files are on disk before the loop settles; the step then carries only
 * the user_id forward (the tokens never travel past this closure). The terminals
 * (expired / already_claimed / invalid_request) persist nothing.
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
    case "not_found":
      return { done: false };
    case "success":
      // Persist the bearer pair + identity. FIX C: wrap ONLY the persist calls
      // (never the whole step — a too-wide catch could mislabel a genuine claim
      // success). A write failure (unwritable / missing-and-uncreatable / full
      // $SIL_DATA_DIR) is TERMINAL, not transient: re-polling the claim cannot
      // make the data dir writable, and the claim is single-use server-side. So
      // return a descriptive `persist_failed` terminal (path + cause) and set the
      // in-process marker — instead of letting the throw reach the poller's catch,
      // which would swallow it as a retry and end the run as a misleading timeout.
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

  // FIX C: a token-persist failure is logged LOUDLY at error — the most severe
  // terminal, distinct from the routine info/warn terminals — carrying the path +
  // cause (in `step.error`) so an operator sees persistence failed, NOT that the
  // user abandoned the flow. The tokens never reached disk, so there is no token
  // material to leak; only the session id + the path/cause error are logged.
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

  // expired / already_claimed / invalid_request — log the terminal so the outcome
  // is never silent; the agent learns it on its next sil_register / sil_whoami.
  // `invalid_request` logs at WARN: a malformed claim request is unreachable from
  // this client today, so it signals a contract-drift bug, not a user outcome —
  // make it loud (the genuine `expired`/`already_claimed` are routine, at info).
  const outcome = typeof step.outcome === "string" ? step.outcome : "unknown";
  const marker = `sil_register_${outcome}`;
  if (outcome === "invalid_request") {
    api.logger.warn(marker, { session_id: sessionId });
  } else {
    api.logger.info(marker, { session_id: sessionId });
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Render an errno-style cause from a caught (unknown) persist error, for the
 * loud log + whoami `persistence_failed` state (FIX C). A Node fs error carries
 * a `.code` (EACCES/ENOSPC/ENOTDIR/ENOENT…) and a `.message` that already names
 * the code and the human cause ("not a directory") — surface the code first
 * (prominent for an operator) then the full message. Carries NO token material:
 * an fs error names paths/errnos only, and the tokens never reached this point.
 */
function describeCause(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

/**
 * Present an auth URL as a single atomic link target for a human-rendered chat
 * surface: angle-bracket wrapped (`<…>`). The angle brackets are the RFC-3986 /
 * Markdown convention that bounds a URL so a greedy auto-linker captures the
 * WHOLE span — including the `&code_challenge=…` query param — instead of
 * terminating the link at the first `&` (the reported production break that
 * dropped `code_challenge` and 400-ed `invalid_code_challenge`). The caller puts
 * the returned token on its OWN line so no surrounding prose can be folded into
 * the link. Pure (no I/O) — the [unit] seam for the atomic-link contract. The
 * structured `auth_url` field is the UNWRAPPED canonical URL; this is the
 * human-presentation form only, and it carries the same params byte-for-byte (it
 * never re-encodes, never adds the verifier).
 */
function presentAuthLink(authUrl: string): string {
  return `<${authUrl}>`;
}
