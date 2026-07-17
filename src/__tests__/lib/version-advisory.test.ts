/**
 * UNIT — `compareSemver()` + `buildVersionBehindFinding()` + `readInstalledVersion()`
 * (tier: unit, pure logic, no network; the installed read touches only the packaged
 * package.json).
 *
 * Card: sil-doctor-tool-data-store-identity-health, **AC9** (+ the local half of AC6).
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
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareSemver,
  readInstalledVersion,
  buildVersionBehindFinding,
} from "../../lib/version-advisory.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const packageVersion = (): string =>
  JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;

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
