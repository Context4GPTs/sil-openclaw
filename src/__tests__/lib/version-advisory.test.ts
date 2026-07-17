/**
 * UNIT — `compareSemver()` + `buildVersionBehindFinding()` + `readInstalledVersion()`
 * + `probeLatestVersion()`'s BOUND (tier: unit; pure logic, no network — the installed
 * read touches only the packaged package.json, and the probe is driven through its
 * injected `fetch` seam with no socket ever opened).
 *
 * Card: sil-doctor-tool-data-store-identity-health, **AC9 + AC6c** (+ the local half
 * of AC6).
 * `src/lib/version-advisory.ts` is created by THIS card and owns the plugin-version
 * datum end-to-end (founder ruling, OQ4/OQ6). The sibling
 * `self-upgrade-detect-host-wiring-advisory` will ADD `buildGatewayCompatFinding()`
 * to this same file and REUSE `compareSemver` — it must never re-derive it.
 *
 * The two things this file exists to catch:
 *
 * 1. **The fail-QUIET semver trap.** `"0.4.10" < "0.4.9"` lexicographically. This
 *    repo is at 0.4.x TODAY and hits 0.4.10 within a few patches. A string compare
 *    would then decide the user is up to date and SUPPRESS the advisory — silently,
 *    forever, with a green suite. Fail-quiet is the worst direction, so the exact
 *    trap pair is pinned as a literal.
 * 2. **A fabricated verdict** (PO invariant 6). Three states must emit NOTHING:
 *    up-to-date, installed NEWER than published (a local/dev build — never advise a
 *    downgrade), and `latest === null` (probe failed/offline). Silence is the honest
 *    degradation; "you are current" and "you are behind" are both lies when the
 *    probe never answered.
 * 3. **An UNBOUNDED probe.** The doctor is needed most when the network is sick, so
 *    the probe must be bounded by a deadline the DOCTOR owns — not by the transport's
 *    goodwill. An `AbortController` alone bounds nothing: aborting a socket that
 *    blackholes the connection and ignores the signal hangs the diagnosis forever.
 *    The integration suite's stalling fakes all honour `abort`, so they exercise only
 *    that half and stay green against a probe with no deadline of its own — this file
 *    owns the other half (see the `probeLatestVersion` block at the bottom).
 *
 * Contract pinned for the implementation (expert-developer) —
 * src/lib/version-advisory.ts:
 *
 *   export function compareSemver(a: string, b: string): number;
 *     — semver PRECEDENCE (numeric triple, prerelease ranks below its release).
 *       Returns <0 when a<b, >0 when a>b, 0 when equal. Sign only — magnitude is
 *       not part of the contract, so tests assert the sign, never the value.
 *   export function readInstalledVersion(): string;
 *     — the packaged package.json#version, read via import.meta.url. NEVER a
 *       hardcoded constant (it would drift silently the moment `pnpm version` runs
 *       — a stub, per complete-work-is-stub-free).
 *   export function buildVersionBehindFinding(
 *     installed: string, latest: string | null,
 *   ): Finding | null;
 *     — EXACTLY ONE `version.plugin_behind` Finding (`info` + `advisory`,
 *       `appliedAction: null`) iff installed < latest; otherwise `null`.
 *       Pure: no fs, no network.
 *   export function probeLatestVersion(
 *     fetchImpl?: FetchLike, timeoutMs?: number,
 *   ): Promise<string | null>;
 *     — resolves the latest published version, or `null` on ANY failure. RESOLVES
 *       within `timeoutMs` no matter what the transport does — including a transport
 *       that never settles and ignores the abort signal entirely.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareSemver,
  readInstalledVersion,
  buildVersionBehindFinding,
  buildGatewayCompatFinding,
  probeLatestVersion,
  type FetchLike,
} from "../../lib/version-advisory.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const packageJson = (): {
  version: string;
  openclaw: { compat: { pluginApi: string; minGatewayVersion: string } };
} => JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

const packageVersion = (): string => packageJson().version;

/** Sign of a comparator result — the contract is the SIGN, not the magnitude, so
 * an implementation returning -1/0/1 and one returning a numeric difference both
 * pass. Pinning the literal value would be testing an implementation detail. */
const sign = (n: number): number => (n < 0 ? -1 : n > 0 ? 1 : 0);

describe("compareSemver — numeric precedence, NOT string compare (the fail-quiet trap)", () => {
  it("ranks 0.4.10 ABOVE 0.4.9 (the exact trap this repo hits at 0.4.10)", () => {
    // Lexicographically "0.4.10" < "0.4.9" — a string compare reports the user is
    // current and SUPPRESSES the advisory. The literal pair from AC9, kept exact.
    expect(sign(compareSemver("0.4.10", "0.4.9"))).toBe(1);
    expect(sign(compareSemver("0.4.9", "0.4.10"))).toBe(-1);
  });

  it("ranks 0.10.0 ABOVE 0.9.0 (the same trap one component to the left)", () => {
    expect(sign(compareSemver("0.10.0", "0.9.0"))).toBe(1);
    expect(sign(compareSemver("0.9.0", "0.10.0"))).toBe(-1);
  });

  it("ranks each component independently, major > minor > patch", () => {
    expect(sign(compareSemver("1.0.0", "0.99.99"))).toBe(1);
    expect(sign(compareSemver("0.5.0", "0.4.99"))).toBe(1);
    expect(sign(compareSemver("0.4.3", "0.4.2"))).toBe(1);
    expect(sign(compareSemver("1.2.3", "2.0.0"))).toBe(-1);
  });

  it("reports 0 for equal versions", () => {
    expect(compareSemver("0.4.2", "0.4.2")).toBe(0);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });

  it("is antisymmetric — swapping the arguments flips the sign, for every pair", () => {
    const pairs: Array<[string, string]> = [
      ["0.4.10", "0.4.9"],
      ["0.10.0", "0.9.0"],
      ["1.0.0", "0.99.99"],
      ["2.0.0", "1.2.3"],
      ["0.4.2", "0.4.2"],
      ["1.0.0-rc.1", "1.0.0"],
    ];
    for (const [a, b] of pairs) {
      // `sign(-x)` rather than `-sign(x)`: negating a 0 yields -0, and toBe uses
      // Object.is, where -0 !== +0. That is a quirk of the assertion, not of the
      // comparator — the contract is the SIGN.
      expect(sign(compareSemver(a, b))).toBe(sign(-compareSemver(b, a)));
    }
  });

  it("ranks a prerelease BELOW its own release (1.0.0-rc.1 < 1.0.0)", () => {
    // Per semver precedence. Load-bearing in the honest direction: an installed
    // 1.0.0-rc.1 against a published 1.0.0 IS behind and must advise.
    expect(sign(compareSemver("1.0.0-rc.1", "1.0.0"))).toBe(-1);
    expect(sign(compareSemver("1.0.0", "1.0.0-rc.1"))).toBe(1);
  });

  it("ranks prereleases of the same release against each other numerically", () => {
    expect(sign(compareSemver("1.0.0-rc.2", "1.0.0-rc.1"))).toBe(1);
    expect(sign(compareSemver("1.0.0-alpha", "1.0.0-beta"))).toBe(-1);
  });

  it("is transitive across the whole ladder (a total order, no cycles)", () => {
    // Ascending by construction; every earlier entry must rank below every later
    // one. Catches a comparator that is right pairwise but not consistent.
    const ascending = [
      "0.4.9",
      "0.4.10",
      "0.9.0",
      "0.10.0",
      "1.0.0-alpha",
      "1.0.0-rc.1",
      "1.0.0-rc.2",
      "1.0.0",
      "1.0.1",
      "1.2.3",
      "2.0.0",
    ];
    for (let i = 0; i < ascending.length; i++) {
      for (let j = i + 1; j < ascending.length; j++) {
        expect(
          sign(compareSemver(ascending[i] as string, ascending[j] as string)),
        ).toBe(-1);
      }
    }
  });

  it("touches no filesystem and no network (pure) — usable from any context", () => {
    // Purity is asserted structurally by the module's own source in the
    // no-hardcode test below; here we simply pin that it is synchronous and
    // returns a number (an async/IO-bearing comparator could not).
    expect(typeof compareSemver("1.0.0", "1.0.0")).toBe("number");
  });
});

describe("readInstalledVersion — the packaged package.json, never a constant (AC6)", () => {
  it("returns the shipped package.json#version, non-empty", () => {
    const version = readInstalledVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
    expect(version).toBe(packageVersion());
  });

  it("returns a parseable semver that compareSemver can rank", () => {
    expect(compareSemver(readInstalledVersion(), "0.0.0")).toBeGreaterThan(0);
  });

  it("does NOT hardcode the version — the source carries no version literal", () => {
    // The anti-stub guard the card names explicitly: "a hardcoded version
    // constant … is a stub and fails review", and it drifts silently the moment
    // `pnpm version` runs (the suite would stay green while the doctor lies).
    // Asserting equality with package.json above is NOT enough — a hardcoded
    // "0.4.2" satisfies it today and rots tomorrow. So: the module's own source
    // must not contain the current version as a literal.
    const source = readFileSync(
      join(REPO_ROOT, "src", "lib", "version-advisory.ts"),
      "utf8",
    );
    expect(source).not.toContain(packageVersion());
  });
});

describe("buildVersionBehindFinding — drift-only: exactly one finding, iff behind", () => {
  it("installed OLDER than latest → exactly one version.plugin_behind finding", () => {
    const finding = buildVersionBehindFinding("0.4.2", "0.5.0");
    expect(finding).not.toBeNull();
    expect(finding!.id).toBe("version.plugin_behind");
  });

  it("the finding is `info` + `advisory` + appliedAction null (never a degradation, never acts)", () => {
    // Severity is URGENCY, and being a release behind is not a degradation: the
    // plugin works exactly as well the minute after a newer one publishes. If
    // this ever became `warn`, EVERY install goes permanently yellow the moment
    // we publish and `healthy` is worthless (AC4 depends on this).
    const finding = buildVersionBehindFinding("0.4.2", "0.5.0")!;
    expect(finding.severity).toBe("info");
    expect(finding.status).toBe("advisory");
    expect(finding.appliedAction).toBeNull();
  });

  it("`detected` names BOTH the installed and the latest version (AC6a)", () => {
    const finding = buildVersionBehindFinding("0.4.2", "0.5.0")!;
    expect(finding.detected).toContain("0.4.2");
    expect(finding.detected).toContain("0.5.0");
  });

  it("`suggestedAction` points at OpenClaw's own update path — the doctor never updates", () => {
    // Invariant 5: the doctor installs nothing and CANNOT (it can't hot-swap its
    // own running code). Its suggestedAction IS the prompt, and it must name the
    // host's trusted path rather than an install command of our own.
    const finding = buildVersionBehindFinding("0.4.2", "0.5.0")!;
    expect(finding.suggestedAction).not.toBeNull();
    expect(finding.suggestedAction!.toLowerCase()).toContain("openclaw");
    // Never an imperative to run our own installer / a raw registry fetch.
    expect(finding.suggestedAction!.toLowerCase()).not.toContain("npm install");
    expect(finding.suggestedAction!.toLowerCase()).not.toContain("curl");
  });

  it("carries exactly the founder's six flat fields — no extra keys, no sub-object", () => {
    // PO invariant #4 + the architect's rejected-alternatives: NO structured
    // `advisory: {installed, latest}` sub-object. Version numbers ride `detected`
    // as a string so the sibling's host-wiring advisory shares the shape verbatim.
    const finding = buildVersionBehindFinding("0.4.2", "0.5.0")!;
    expect(Object.keys(finding).sort()).toEqual([
      "appliedAction",
      "detected",
      "id",
      "severity",
      "status",
      "suggestedAction",
    ]);
  });

  it("emits NOTHING when the versions are EQUAL (up to date — silence is healthy)", () => {
    expect(buildVersionBehindFinding("0.4.2", "0.4.2")).toBeNull();
  });

  it("emits NOTHING when installed is NEWER than published (a dev build — never advise a downgrade)", () => {
    // A local/unpublished build is the maintainer's everyday state. An advisory
    // here would tell them to "update" DOWNWARD — actively wrong.
    expect(buildVersionBehindFinding("0.5.0", "0.4.2")).toBeNull();
    expect(buildVersionBehindFinding("1.0.0", "0.9.9")).toBeNull();
  });

  it("emits NOTHING when latest is null (probe failed/offline — invariant 6)", () => {
    // Never "you are current" (a false green on a real update) and never "you are
    // behind" (a false alarm from a failed read). Unknown is not a state we
    // invent a value for.
    expect(buildVersionBehindFinding("0.4.2", null)).toBeNull();
  });

  it("does NOT fabricate a verdict from the fail-quiet trap pair (0.4.9 installed, 0.4.10 published)", () => {
    // The end-to-end consequence of the semver trap, at the finding level: a
    // string compare returns null here (thinks 0.4.9 > 0.4.10) and the user
    // never learns an update exists.
    const finding = buildVersionBehindFinding("0.4.9", "0.4.10");
    expect(finding).not.toBeNull();
    expect(finding!.detected).toContain("0.4.10");
  });

  it("advises when a prerelease install is behind its own release", () => {
    const finding = buildVersionBehindFinding("1.0.0-rc.1", "1.0.0");
    expect(finding).not.toBeNull();
  });

  it("is pure — repeated calls yield an equal finding and no accumulated state", () => {
    const a = buildVersionBehindFinding("0.4.2", "0.5.0");
    const b = buildVersionBehindFinding("0.4.2", "0.5.0");
    expect(a).toEqual(b);
  });
});

// ===========================================================================
// AC6c — the probe's BOUND. The doctor owns the deadline; the transport does
// not get a vote.
// ===========================================================================

/** A ClawHub package-detail body, per the shipped CLI's own response schema
 * (`ApiV1PackageResponseSchema`; the CLI resolves `latestVersion ?? tags.latest`). */
const clawhubBody = (latestVersion: string): unknown => ({
  package: { name: "@4gpts/sil", latestVersion, tags: { latest: latestVersion } },
  owner: { handle: "4gpts" },
});

/** A channel that answers immediately with `latest`. */
const okChannel =
  (latest: string): FetchLike =>
  async () => ({ ok: true, status: 200, json: async () => clawhubBody(latest) });

/**
 * THE transport this block exists for: it never settles, and it **never listens
 * for `abort`**. The second half is the entire point. Every stalling fake in
 * `doctor.integration.test.ts` registers an `abort` listener and rejects from it
 * — i.e. it VOLUNTEERS to stop, so it passes just as happily against a probe
 * that only aborts and never bounds itself. A real blackholed host (a dropped
 * SYN, a load balancer swallowing the connection, a captive portal) does not
 * volunteer, and `AbortController` cannot make it.
 */
const blackhole: FetchLike = () => new Promise<never>(() => {});

describe("probeLatestVersion — bounded by a DEADLINE, not merely by an abort", () => {
  it("resolves null within the deadline against a channel that never settles AND ignores the signal", async () => {
    // The exact regression this guards: `return await request` (no
    // `Promise.race`) hands the bound to the transport, and this transport never
    // gives it back — the diagnosis hangs forever. `await request` fails this
    // test by blowing the 10s suite timeout, which is the correct, loud outcome.
    const started = Date.now();

    await expect(probeLatestVersion(blackhole, 300)).resolves.toBeNull();

    const elapsed = Date.now() - started;
    // The null came FROM the deadline (timers never fire early), so it is a
    // bound — not a probe that happens to give up on its own.
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("is not vacuous — the same probe returns a REAL version from a channel that answers", async () => {
    // Without this, a `probeLatestVersion` that simply `return null`ed would pass
    // every assertion above. `null` must mean "bounded/failed", never "always".
    await expect(probeLatestVersion(okChannel("9.9.9"), 300)).resolves.toBe("9.9.9");
  });

  it("still ABORTS the signal, so a well-behaved transport releases its socket", async () => {
    // The deadline is the bound; the abort is the courtesy. Both halves ship —
    // resolving the race without aborting would leak a live socket per run.
    let signal: AbortSignal | undefined;
    const watched: FetchLike = (_url, init) => {
      signal = init.signal;
      return new Promise<never>(() => {});
    };

    await expect(probeLatestVersion(watched, 300)).resolves.toBeNull();

    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(true);
  });

  it("does NOT wait for the deadline when the channel answers promptly", async () => {
    // A race won by the deadline on every run would make `sil_doctor` cost its
    // full timeout each time. With a 30s deadline, an implementation that awaits
    // it fails by suite timeout rather than passing slowly.
    const started = Date.now();

    await expect(probeLatestVersion(okChannel("9.9.9"), 30_000)).resolves.toBe("9.9.9");

    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("clears the deadline timer once the request wins — no dangling handle", async () => {
    // A 30s timer left armed after `execute()` returns holds the host's event
    // loop open — the same class of failure as the register()-opens-nothing
    // invariant, one layer down.
    vi.useFakeTimers();
    try {
      await expect(probeLatestVersion(okChannel("9.9.9"), 30_000)).resolves.toBe("9.9.9");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ===========================================================================
// Card: self-upgrade-detect-host-wiring-advisory — **AC10** (+ AC2's local half).
//
// `buildGatewayCompatFinding()` is the ONE function that card adds to this file.
// It answers a genuinely different question from `buildVersionBehindFinding` — not
// "am I current?" (installed vs published, a ClawHub probe) but "is my HOST new
// enough for me?" (the running gateway vs our own declared `package.json#openclaw.
// compat`). It is **100% local**: no probe, no network, no `networkEndpoints` entry.
// That is why the two share a file and share `compareSemver` — and why nothing here
// re-derives the comparator, the installed read, or the probe (sil-doctor's AC9
// owns all three; re-testing them here would fork the contract).
//
// The two things this block exists to catch:
//
// 1. **A FABRICATED verdict.** An unreadable host version (`readHostVersion` → null)
//    or a range shape the parser does not fully understand must yield NO finding —
//    never a guess in either direction. A partial semver-range parser that guesses is
//    strictly worse than no check: it tells a working install to "update OpenClaw",
//    which the user cannot un-learn. Fail CLOSED to inconclusive.
// 2. **A STRING-COMPARE compat check.** The same fail-quiet trap the block above
//    pins, one datum over: lexicographically "2026.4.9" > "2026.4.15", so a string
//    compare silently passes a host that is genuinely too old. Calendar versions hit
//    this every single month, not eventually.
//
// Contract pinned for the implementation (expert-developer):
//
//   export function buildGatewayCompatFinding(
//     hostVersion: string | null,
//     requiredRange?: string,   // defaults to the shipped
//                               // package.json#openclaw.compat.minGatewayVersion
//   ): Finding | null;
//     — EXACTLY ONE `version.gateway_compat` Finding (`warn` + `advisory`,
//       `appliedAction: null`) iff the host is BELOW the required range; otherwise
//       `null`. Reuses `compareSemver`. No network, no host, no fabrication.
// ===========================================================================

/** The plugin's OWN declared floor, read from the shipped manifest — never a
 * literal. `pnpm version` and a compat bump must not be able to rot this file into
 * agreeing with a stale check. */
const requiredRange = (): string => packageJson().openclaw.compat.minGatewayVersion;

/** The bare version inside a `>=X.Y.Z` range. */
const requiredVersion = (): string => requiredRange().replace(/^>=\s*/, "");

/** Below/above ANY plausible calendar-versioned floor, so neither depends on the
 * shipped range's actual value. */
const ANCIENT_HOST = "0.0.1";
const FUTURE_HOST = "9999.0.0";

describe("buildGatewayCompatFinding — host below our floor → advise, else silence (AC10)", () => {
  it("host BELOW the required range → exactly one version.gateway_compat finding", () => {
    const finding = buildGatewayCompatFinding("2026.4.14", ">=2026.4.15");
    expect(finding).not.toBeNull();
    expect(finding!.id).toBe("version.gateway_compat");
  });

  it("is `warn` + `advisory` + `appliedAction: null` (degraded, but we never act)", () => {
    // `warn`, not `info`: unlike a version-behind, this install may genuinely not
    // run — that IS a degradation and `healthy: false` is the truth. And not
    // `critical`: by sil-doctor's ladder that means the core path is broken, and a
    // plugin broken enough to qualify could not run a tool to say so.
    const finding = buildGatewayCompatFinding("2026.4.14", ">=2026.4.15")!;
    expect(finding.severity).toBe("warn");
    expect(finding.status).toBe("advisory");
    expect(finding.appliedAction).toBeNull();
  });

  it("`detected` names BOTH the required and the running version (AC2)", () => {
    const finding = buildGatewayCompatFinding("2026.4.14", ">=2026.4.15")!;
    expect(finding.detected).toContain("2026.4.15");
    expect(finding.detected).toContain("2026.4.14");
  });

  it("`suggestedAction` directs the user to update OpenClaw — the plugin ships no installer", () => {
    // The plugin cannot be its own installer (noChildProcess + noInstallScripts +
    // read-only api.config + it cannot hot-swap its own running code). It points at
    // OpenClaw's own trusted update path and stops.
    const finding = buildGatewayCompatFinding("2026.4.14", ">=2026.4.15")!;
    expect(finding.suggestedAction).not.toBeNull();
    expect(finding.suggestedAction!.toLowerCase()).toContain("openclaw");
    expect(finding.suggestedAction!.toLowerCase()).not.toContain("npm install");
    expect(finding.suggestedAction!.toLowerCase()).not.toContain("curl");
  });

  it("carries exactly the six flat fields — no extra keys, no `advisory` sub-object", () => {
    const finding = buildGatewayCompatFinding("2026.4.14", ">=2026.4.15")!;
    expect(Object.keys(finding).sort()).toEqual([
      "appliedAction",
      "detected",
      "id",
      "severity",
      "status",
      "suggestedAction",
    ]);
  });

  it("host EXACTLY AT the required version → NO finding (`>=` includes the floor)", () => {
    // The off-by-one that would fire a permanent false advisory on the single most
    // common supported host: the one that is exactly at our declared floor.
    expect(buildGatewayCompatFinding("2026.4.15", ">=2026.4.15")).toBeNull();
  });

  it("host ABOVE the required version → NO finding", () => {
    expect(buildGatewayCompatFinding("2026.6.9", ">=2026.4.15")).toBeNull();
    expect(buildGatewayCompatFinding("2027.1.0", ">=2026.4.15")).toBeNull();
  });

  it("uses semver PRECEDENCE, not string compare (2026.4.9 IS below 2026.4.15)", () => {
    // Lexicographically "2026.4.9" > "2026.4.15", so a string compare decides this
    // too-old host is fine and stays SILENT — fail-quiet, on a host that may not run
    // us at all. Calendar versions cross this boundary every month.
    const finding = buildGatewayCompatFinding("2026.4.9", ">=2026.4.15");
    expect(finding).not.toBeNull();
    expect(finding!.detected).toContain("2026.4.9");
  });

  it("ranks the major component first (2025.x is below 2026.4.15)", () => {
    expect(buildGatewayCompatFinding("2025.12.31", ">=2026.4.15")).not.toBeNull();
  });
});

describe("buildGatewayCompatFinding — fails CLOSED to inconclusive, never a verdict (AC10)", () => {
  it("an UNREADABLE host version (null) → NO finding", () => {
    // `readHostVersion(api)` returns null when the running host's version is not
    // reachable in `api.config` / the SDK shim. Unknown is not a state we invent a
    // value for: no "your host is too old" (a false alarm), no silent "you're fine"
    // dressed up as a real check.
    expect(buildGatewayCompatFinding(null, ">=2026.4.15")).toBeNull();
    expect(buildGatewayCompatFinding(null)).toBeNull();
  });

  it("an UNPARSEABLE host version → NO finding", () => {
    for (const host of ["", "unknown", "2026.4", "v2026.4.15", "latest", "2026.04.15-nightly+x y"]) {
      expect(buildGatewayCompatFinding(host, ">=2026.4.15"), host).toBeNull();
    }
  });

  it("ANY range shape other than a single `>=X.Y.Z` → NO finding (the parser refuses to guess)", () => {
    // We ship a ~20-line tuple compare rather than a `semver` dependency, because
    // every range we declare is a single `>=X.Y.Z`. The whole licence for that is
    // that it fails closed on everything else: a caret/tilde/OR/range-pair parsed
    // "approximately" is how a working host gets told to update. If we ever declare
    // one of these for real, the parser grows to meet it FIRST — this test going red
    // is the signal, and loosening it to `toContain` would hide exactly that.
    const ancient = "0.0.1";
    for (const range of [
      "^2026.4.15",
      "~2026.4.15",
      ">2026.4.15",
      "<=2026.4.15",
      "=2026.4.15",
      "2026.4.15",
      ">=2026.4.15 <2027.0.0",
      ">=2026.4.15 || >=2025.1.0",
      ">=2026.x",
      ">=2026.4",
      ">=",
      "",
      "*",
      "latest",
    ]) {
      expect(buildGatewayCompatFinding(ancient, range), range).toBeNull();
    }
  });

  it("a PRERELEASE or non-numeric floor → NO finding (unparsed ⇒ inconclusive)", () => {
    expect(buildGatewayCompatFinding("0.0.1", ">=2026.4.15-rc.1")).toBeNull();
    expect(buildGatewayCompatFinding("0.0.1", ">=abc.def.ghi")).toBeNull();
  });

  it("is NOT VACUOUS — the same call path DOES fire for a real `>=` floor", () => {
    // Without this, a `buildGatewayCompatFinding` that simply `return null`ed would
    // pass every assertion in this describe block, and the compat check would be
    // dead code that never speaks in production while the suite stays green.
    expect(buildGatewayCompatFinding("0.0.1", ">=2026.4.15")).not.toBeNull();
  });
});

describe("buildGatewayCompatFinding — the floor comes from the SHIPPED manifest (AC10)", () => {
  it("defaults to package.json#openclaw.compat.minGatewayVersion", () => {
    // Derived, never hardcoded: `pnpm version` / a compat bump must move the check,
    // not silently drift from it. `package.json` is the source of truth that
    // `sync-version.mjs` mirrors OUTWARD, and it always ships in an npm tarball.
    const finding = buildGatewayCompatFinding(ANCIENT_HOST);
    expect(finding).not.toBeNull();
    expect(finding!.id).toBe("version.gateway_compat");
    expect(finding!.detected).toContain(requiredVersion());
    expect(finding!.detected).toContain(ANCIENT_HOST);
  });

  it("the shipped floor is a single `>=X.Y.Z` — the exact shape the parser supports", () => {
    // The gate on the no-`semver`-dependency call: the moment a declared range stops
    // being a bare `>=`, the parser fails closed and the compat check goes SILENT.
    // This asserts the premise still holds, so that silence can never be a surprise.
    expect(requiredRange()).toMatch(/^>=\d+\.\d+\.\d+$/);
  });

  it("a host at the shipped floor is silent; a far-future host is silent", () => {
    expect(buildGatewayCompatFinding(requiredVersion())).toBeNull();
    expect(buildGatewayCompatFinding(FUTURE_HOST)).toBeNull();
  });
});

describe("buildGatewayCompatFinding — local, pure, and never a network call (AC2/AC14)", () => {
  it("issues NO network request — it must still fire with the network down", () => {
    // AC2's teeth: the compat check must not be coupled to any remote channel. This
    // card has none at all — its two detections are 100% local, so the plugin-behind
    // probe going dark must not take compat down with it.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      buildGatewayCompatFinding("2026.4.14", ">=2026.4.15");
      buildGatewayCompatFinding(null);
      buildGatewayCompatFinding(ANCIENT_HOST);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("is synchronous — a compat verdict needs no await", () => {
    expect(buildGatewayCompatFinding("2026.4.14", ">=2026.4.15")).not.toBeInstanceOf(Promise);
  });

  it("is deterministic — repeated calls yield an equal finding and no accumulated state", () => {
    expect(buildGatewayCompatFinding("2026.4.14", ">=2026.4.15")).toEqual(
      buildGatewayCompatFinding("2026.4.14", ">=2026.4.15"),
    );
  });
});
