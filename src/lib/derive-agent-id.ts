/**
 * Derive a shopper's host `agentId` from its ONE friendly display `name`.
 *
 * Onboarding used to make the user invent TWO names for one shopper — a lower-kebab
 * `agentId` AND a friendly display `name`. The id is pure host plumbing (a workspace
 * path segment, the `/agent <id>` switch handle, the channel-bind target) the user
 * should never author. `create-shopper` now takes only the `name`; the bin derives the
 * id here, so the id never surfaces as a second thing the user has to get right.
 *
 * The slug: NFKD-normalize + strip combining marks (so `Café`/`Málaga` keep their base
 * letters — `cafe`, `malaga` — instead of splitting mid-word on the accent) → lowercase
 * → collapse each run of non-`[a-z0-9]` to a single hyphen → trim edge hyphens. An empty
 * slug (emoji-only / punctuation-only name) OR the host-reserved `main` both fold to the
 * `sil-shopper` fallback — the display `name` the user chose stays intact; only the
 * plumbing id falls back, silently.
 *
 * Pure and total: no I/O, no host, no throw. For ANY string the result satisfies the
 * postcondition `AGENT_ID_RE` (`^[a-z0-9][a-z0-9-]*$`) and is never `main` — so the bin
 * needs no runtime re-validation of the derived id.
 */

/** The lower-kebab shopper-id shape — never `main` (host-reserved). The postcondition
 * every `deriveAgentId` result satisfies; also the bin's documented DERIVED shape. */
export const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Fallback id when the slug is empty or lands on the host-reserved `main`. */
const FALLBACK_AGENT_ID = "sil-shopper";

/** The one host-reserved id a derived slug must never become. */
const RESERVED_AGENT_ID = "main";

export function deriveAgentId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" || slug === RESERVED_AGENT_ID ? FALLBACK_AGENT_ID : slug;
}
