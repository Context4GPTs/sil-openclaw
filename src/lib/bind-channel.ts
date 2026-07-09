/**
 * Resolve the channel to bind a newly-created shopper to, at create time.
 *
 * The create bin (`scripts/create-shopper.mjs`) has no session context — a plugin
 * tool receives only `(callId, params)`, and the bin is a subprocess the agent
 * spawns — so the "current channel" must arrive out-of-band, from two sources in
 * precedence order:
 *
 *   1. `spec.channel`                   — the explicit operator/skill override (and
 *                                         the test seam); highest priority.
 *   2. `OPENCLAW_MCP_MESSAGE_CHANNEL`   — the host's current message channel, set on
 *                                         a live turn (`"telegram"` in a Telegram
 *                                         session), blank/absent otherwise.
 *
 * The first non-blank source wins. When NEITHER resolves, `null` is the fail-open
 * "undetermined channel" trigger: the bin skips the bind and surfaces a manual-bind
 * hint — a channel that can't be auto-routed is a missing convenience, never a
 * failed create.
 *
 * Pure and total: no I/O, no host, no throw. A non-string or whitespace-only value
 * is treated as absent (folds into `null`), so the bin never fails on a malformed
 * or blank channel — that too degrades to the fail-open hint.
 */
export interface BindChannelSources {
  specChannel?: string | null;
  envChannel?: string | null;
}

export function resolveBindChannel(sources: BindChannelSources): string | null {
  return normalizeChannel(sources.specChannel) ?? normalizeChannel(sources.envChannel);
}

/** A present, non-blank string trimmed of surrounding whitespace, else `null`. */
function normalizeChannel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
