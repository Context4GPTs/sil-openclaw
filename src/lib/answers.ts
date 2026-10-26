/**
 * Every `ok` answer a sil tool gave the agent, kept for the paired screen to read back by
 * the host's `callId` (`sil.answer`). In memory and evicted lazily on write: `register()`
 * opens no timer, and nothing of the buyer's rests on disk.
 */

import type { PluginAPI } from "openclaw/plugin-sdk/plugin-entry";

import { hasTokens, readConfig } from "./credentials.js";
import { logScreen } from "./screen-log.js";

/** A run reads about fifteen answers; prices are point-in-time, so they never outlive this. */
const RETENTION_MS = 15 * 60_000;
const MAX_ANSWERS = 64;

/** Operator log only: every miss answers the screen one body. */
export type AnswerMiss = "unknown" | "expired" | "principal_mismatch";

interface Kept {
  principal: string;
  sessionId: string | undefined;
  body: Record<string, unknown>;
  expiresAtMs: number;
}

const answers = new Map<string, Kept>();

/** The sil account holding a LIVE session: sign-out unlinks the tokens and keeps the config. */
export function signedInPrincipal(): string | undefined {
  const id = hasTokens() ? readConfig()?.user?.id : undefined;
  return id === undefined || id.length === 0 ? undefined : id;
}

/** A side effect of a tool's `ok` path; the agent's result is unchanged. */
export function keepAnswer(
  api: PluginAPI,
  callId: string,
  sessionId: string | undefined,
  body: Record<string, unknown>,
): void {
  const principal = signedInPrincipal();
  if (principal === undefined) {
    logScreen(api, "info", "answer_skipped", { callId, reason: "no_principal" });
    return;
  }
  const now = Date.now();
  for (const [id, kept] of answers) if (kept.expiresAtMs <= now) answers.delete(id);
  while (answers.size >= MAX_ANSWERS) {
    const oldest = answers.keys().next();
    if (oldest.done === true) break;
    answers.delete(oldest.value);
  }
  answers.set(callId, { principal, sessionId, body, expiresAtMs: now + RETENTION_MS });
}

/** Pure: a read never evicts or consumes, so a screen reload re-reads the same answer. */
export function readAnswer(
  callId: string,
  principal: string,
): { body: Record<string, unknown> } | { miss: AnswerMiss } {
  const kept = answers.get(callId);
  if (kept === undefined) return { miss: "unknown" };
  if (kept.expiresAtMs <= Date.now()) return { miss: "expired" };
  if (kept.principal !== principal) return { miss: "principal_mismatch" };
  return { body: kept.body };
}

/** The conversation of the principal's latest agent call — what the screen is showing. */
export function latestSession(principal: string): string | undefined {
  const now = Date.now();
  let latest: string | undefined;
  for (const kept of answers.values()) {
    if (kept.principal === principal && kept.expiresAtMs > now && kept.sessionId !== undefined) {
      latest = kept.sessionId;
    }
  }
  return latest;
}
