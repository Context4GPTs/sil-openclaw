/**
 * Plugin-version currency — read what is installed, ask ClawHub what is
 * published, and say so. Nothing else.
 *
 * The doctor NEVER acts on the version it reports: it installs nothing, writes
 * no host config, spawns no process, and prompts nobody. It also cannot — a
 * plugin can't hot-swap its own running code. It names OpenClaw's own update
 * path and stops.
 *
 * The ClawHub GET is the doctor's ONLY outbound request: unauthenticated,
 * bounded by an explicit timeout + abort, carrying no token, no PII, and no
 * store contents. It FAILS SOFT TO SILENCE — a probe that is unreachable, slow,
 * non-200, or unparseable yields `null`, which yields no finding at all. Never
 * "you are current" (a false green on a real update), never "you are behind" (a
 * false alarm from a failed read). Unknown is not a state we invent a value for.
 *
 * This module is `lib/` because the self-upgrade card adds
 * `buildGatewayCompatFinding()` here, reusing `compareSemver` — a genuinely
 * different datum (running host vs our declared compat range; local, no probe).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Finding } from "./findings.js";

/**
 * The published-version authority. A doctor running inside OpenClaw is a
 * ClawHub install, so ClawHub — not npm — is the authority that matches how the
 * user would actually update, which is the whole point of the advisory. We
 * publish the same tarball to both, under this name on ClawHub (`sil` is
 * unclaimable). Declared in `openclaw.plugin.json#networkEndpoints`.
 */
const CLAWHUB_ORIGIN = "https://clawhub.ai";
const CLAWHUB_PACKAGE_NAME = "@4gpts/sil";
const CLAWHUB_PACKAGE_URL =
  `${CLAWHUB_ORIGIN}/api/v1/packages/${encodeURIComponent(CLAWHUB_PACKAGE_NAME)}`;

/** A blackholed registry must never stall a diagnosis — the doctor is needed
 * most when things are broken, and "broken" often includes the network. */
const PROBE_TIMEOUT_MS = 3_000;

/** Semver core + optional prerelease/build. We only ever compare strings we or
 * the registry published, so this is a shape guard, not a validator. */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** The packaged `package.json`, resolved relative to this module — two levels up
 * from both `src/lib/` and `dist/lib/`. `package.json#version` is the single
 * source of truth (`sync-version.mjs` mirrors it into the manifest), so a
 * hardcoded constant would silently drift the moment `pnpm version` runs. */
const PACKAGE_JSON_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "package.json",
);

/**
 * The minimal `fetch` shape the probe needs — the seam that lets a test drive an
 * up-to-date / newer / erroring / STALLING channel without a live network. A
 * probe hardwired to global `fetch` makes the timeout branch untestable and
 * drags live ClawHub into CI. Global `fetch` satisfies this structurally.
 */
export type FetchLike = (
  input: string,
  init: { signal: AbortSignal; headers: Record<string, string>; redirect: "error" },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * The installed version, read locally on every run.
 *
 * Throws when the packaged `package.json` is missing or carries no version: that
 * is a broken build, not a runtime state to model — which is why the report's
 * `installedVersion` is `string`, never `string | null`.
 */
export function readInstalledVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(
      `${PACKAGE_JSON_PATH}: package.json carries no version string`,
    );
  }
  return version;
}

interface SemverParts {
  core: [number, number, number];
  prerelease: string[];
}

function parseSemver(version: string): SemverParts | null {
  const m = SEMVER_RE.exec(version.trim());
  if (m === null) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] === undefined ? [] : m[4].split("."),
  };
}

/** Compare two dot-separated prerelease identifiers per semver §11: numeric
 * identifiers rank below alphanumeric ones and compare numerically; a shorter
 * prerelease ranks below an otherwise-equal longer one. */
function comparePrerelease(a: string[], b: string[]): number {
  // Absent prerelease outranks any present one (1.0.0 > 1.0.0-rc.1).
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Semver PRECEDENCE, not string compare: `"0.4.10" < "0.4.9"` lexicographically
 * is a real trap this repo hits at 0.4.10, and it would silently SUPPRESS the
 * advisory — fail-quiet, the worst direction. Build metadata is ignored (§10).
 *
 * Returns <0 / 0 / >0. An unparseable version sorts as equal, so a garbage
 * "latest" fails soft to silence rather than into the report.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === null || pb === null) return 0;

  for (let i = 0; i < 3; i += 1) {
    const d = pa.core[i] - pb.core[i];
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * The latest published version, or `null` on ANY failure (unreachable, aborted
 * past the timeout, non-200, unparseable, absurd body).
 *
 * A bare public GET for a version string: no `Authorization`, no token, no PII,
 * no store contents. `redirect: "error"` keeps it pinned to the ONE declared
 * host — a probe that follows a redirect off ClawHub is out of contract.
 */
export async function probeLatestVersion(
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<string | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // The deadline RESOLVES the race — it does not merely abort the signal.
  // Aborting alone would leave the bound in the transport's hands: a channel
  // that blackholes the connection and ignores the signal would hang the whole
  // diagnosis forever, and the doctor is needed most when the network is sick.
  // We still abort, so a well-behaved fetch releases its socket promptly.
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  const request = (async (): Promise<string | null> => {
    const res = await fetchImpl(CLAWHUB_PACKAGE_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      redirect: "error",
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const latest = (body as { package?: { latestVersion?: unknown } })
      ?.package?.latestVersion;
    // The registry's string is used for ONE comparison and ONE report string —
    // never a path, never a URL to follow, never eval'd, never written to disk.
    return typeof latest === "string" && SEMVER_RE.test(latest.trim())
      ? latest.trim()
      : null;
  })().catch(() => null); // Any failure is silence — and never an unhandled
                          // rejection when the deadline already won the race.

  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The drift-only advisory: a finding IFF installed < latest.
 *
 * Three states emit nothing — up to date, installed NEWER than published (a
 * local/dev build; never advise a downgrade), and `latest === null` (probe
 * failed/offline). Silence honestly means "no update indicated". The installed
 * version still reports as `DoctorReport.installedVersion` — that fact is local
 * and was never in doubt.
 *
 * `info` severity: being a release behind is not a degradation — the installed
 * plugin works exactly as well the minute after a newer one publishes as the
 * minute before. Anything higher turns every install permanently yellow the
 * moment we publish, and the `healthy` roll-up stops meaning anything.
 */
export function buildVersionBehindFinding(
  installed: string,
  latest: string | null,
): Finding | null {
  if (latest === null) return null;
  if (compareSemver(installed, latest) >= 0) return null;

  return {
    id: "version.plugin_behind",
    severity: "info",
    status: "advisory",
    detected:
      `A newer sil plugin is published: installed ${installed}, latest ${latest}.`,
    suggestedAction:
      "Update via OpenClaw's own plugin update path (for example"
      + ` \`openclaw plugins update ${CLAWHUB_PACKAGE_NAME}\`), then reload the`
      + " plugin. sil never updates itself.",
    appliedAction: null,
  };
}
