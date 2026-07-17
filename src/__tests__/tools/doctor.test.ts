/**
 * UNIT — the doctor's two pure seams: the report assembler (**AC7**) and the
 * decode-only JWT `exp` decoder (**AC8**). Tier: unit — no fs, no network,
 * <100ms. The fs-backed end-to-end behaviour lives in
 * `src/__tests__/doctor.integration.test.ts`.
 *
 * Card: sil-doctor-tool-data-store-identity-health.
 *
 * **Why the expiry decoder is the one non-obvious call.** `StoredTokens` is
 * `{ access_token, refresh_token }` — there is NO stored `exp`, so "expired" is not
 * a field on disk. The decoder base64url-decodes the JWT payload segment and reads
 * ONLY the `exp` claim: no signature verify (this is a health HINT, not an auth
 * decision — real verification is server-side on the next authed call) and no
 * network (the token path is nowhere near the doctor's one outbound probe).
 *
 * The two failure modes this file exists to catch:
 *
 * 1. **A fabricated expiry.** An opaque (non-JWT) or `exp`-less token must read
 *    INCONCLUSIVE — never "expired". Fabricating expiry sends a working user to
 *    re-register for nothing.
 * 2. **A leak.** The decoder's return value is `boolean | null` BY CONTRACT so it
 *    is structurally incapable of carrying token bytes or any other claim. The
 *    tests below hand it a JWT whose payload carries a decoy `sub` and assert the
 *    derived boolean is all that comes back.
 *
 * Contract pinned for the implementation (expert-developer) — src/tools/doctor.ts
 * exports both seams so they are testable without fs OR network:
 *
 *   export function isAccessTokenExpired(accessToken: string): boolean | null;
 *     — true = expired, false = not expired, null = INCONCLUSIVE (not a 3-segment
 *       JWT / undecodable payload / no numeric `exp`). Never throws. No network.
 *       Extracts ONLY `exp`.
 *   export interface DoctorReport {
 *     status: "ok"; healthy: boolean; dataDir: string; installedVersion: string;
 *     counts: { info: number; warn: number; critical: number };
 *     findings: Finding[];
 *   }
 *   export function buildDoctorReport(input: {
 *     dataDir: string; installedVersion: string; findings: Finding[];
 *   }): DoctorReport;
 *     — pure assembler: rolls up `healthy` + `counts` from the findings it is
 *       given. Never invents a finding.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { jsonResult } from "../../lib/tool-result.js";
import type { Finding, Severity } from "../../lib/findings.js";
import { isAccessTokenExpired, buildDoctorReport } from "../../tools/doctor.js";

// ---------------------------------------------------------------------------
// JWT fixtures — real base64url, built here so no dependency and no live token.
// ---------------------------------------------------------------------------

const b64url = (obj: unknown): string =>
  Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");

/** A structurally real 3-segment JWT with the given payload. The signature is a
 * placeholder — the decoder MUST NOT verify it (decode-only, by contract). */
const jwt = (payload: Record<string, unknown>): string =>
  [b64url({ alg: "HS256", typ: "JWT" }), b64url(payload), "c2ln"].join(".");

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** A decoy claim planted in every fixture payload: if ANY claim other than the
 * derived boolean escaped the decoder, this string is what would leak. */
const DECOY_CLAIM = "decoy-subject-must-never-escape";

const jwtExpiring = (expSec: number): string =>
  jwt({ exp: expSec, sub: DECOY_CLAIM, email: "leaky@example.com" });

const finding = (id: string, severity: Severity): Finding => ({
  id,
  severity,
  status: "ok",
  detected: "d",
  suggestedAction: null,
  appliedAction: null,
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// AC8 — the token-expiry decoder is pure, offline, and leak-free.
// ===========================================================================

describe("isAccessTokenExpired — a JWT with a numeric `exp` (the determinate cases)", () => {
  it("signals EXPIRED for an `exp` in the past", () => {
    expect(isAccessTokenExpired(jwtExpiring(nowSec() - 3600))).toBe(true);
  });

  it("signals NOT expired for an `exp` in the future", () => {
    expect(isAccessTokenExpired(jwtExpiring(nowSec() + 3600))).toBe(false);
  });

  it("distinguishes the two by seconds, not milliseconds (the unit trap)", () => {
    // `exp` is UNIX SECONDS. Comparing it against Date.now() (milliseconds)
    // without dividing makes every real token look expired ~1000x over —
    // a fabricated expiry for every registered user. A token expiring in one
    // hour is NOT expired; one that expired an hour ago IS.
    expect(isAccessTokenExpired(jwtExpiring(nowSec() + 3600))).toBe(false);
    expect(isAccessTokenExpired(jwtExpiring(nowSec() - 3600))).toBe(true);
    // And a far-future token is likewise not expired (guards the inverse bug:
    // multiplying Date.now() instead of dividing exp).
    expect(isAccessTokenExpired(jwtExpiring(nowSec() + 86_400 * 365))).toBe(false);
  });

  it("does NOT verify the signature — a bogus signature still decodes (decode-only)", () => {
    // A health HINT, not an auth decision. If this ever started verifying, an
    // unverifiable-but-unexpired token would be misreported.
    const tampered = jwt({ exp: nowSec() + 3600, sub: DECOY_CLAIM })
      .replace(/\.[^.]+$/, ".not-a-real-signature");
    expect(isAccessTokenExpired(tampered)).toBe(false);
  });
});

describe("isAccessTokenExpired — INCONCLUSIVE, never a fabricated expiry", () => {
  // Every one of these must read null (inconclusive). The cardinal sin is
  // returning `true` (expired) for a token the decoder simply cannot read —
  // that sends a working user to re-register for nothing.
  const inconclusive: Array<[string, string]> = [
    ["an opaque non-JWT token", "sil_opaque_token_abc123"],
    ["an empty string", ""],
    ["a single segment", "onlyonesegment"],
    ["two segments (no payload/sig split)", "aGVhZGVy.cGF5bG9hZA"],
    ["four segments", "a.b.c.d"],
    ["a JWT whose payload is not base64url", "aGVhZGVy.!!!not-base64!!!.c2ln"],
    ["a JWT whose payload is not JSON", ["aGVhZGVy", Buffer.from("not json", "utf8").toString("base64url"), "c2ln"].join(".")],
    ["a JWT payload that is a JSON array, not an object", ["aGVhZGVy", b64url([1, 2, 3]), "c2ln"].join(".")],
    ["a JWT payload that is JSON null", ["aGVhZGVy", b64url(null), "c2ln"].join(".")],
    ["a JWT with no `exp` claim", jwt({ sub: DECOY_CLAIM, iat: nowSec() })],
    ["a JWT whose `exp` is a string", jwt({ exp: "1700000000", sub: DECOY_CLAIM })],
    ["a JWT whose `exp` is null", jwt({ exp: null, sub: DECOY_CLAIM })],
    ["a JWT whose `exp` is NaN-ish", jwt({ exp: "not-a-number" })],
    ["a JWT whose `exp` is an object", jwt({ exp: { at: 123 } })],
    ["empty segments", ".."],
    ["whitespace", "   "],
  ];

  for (const [label, token] of inconclusive) {
    it(`reads INCONCLUSIVE (null) for ${label} — never "expired"`, () => {
      expect(isAccessTokenExpired(token)).toBeNull();
    });
  }

  it("never throws on ANY of the malformed inputs (the doctor must not crash)", () => {
    // The doctor never throws across the tool boundary; a decoder that throws on
    // a weird token takes the WHOLE diagnosis down — exactly when it is needed.
    for (const [, token] of inconclusive) {
      expect(() => isAccessTokenExpired(token)).not.toThrow();
    }
  });
});

describe("isAccessTokenExpired — leak-free and offline (the top risk)", () => {
  it("returns ONLY a boolean or null — structurally incapable of carrying a claim", () => {
    // The no-leak guarantee is enforced by the RETURN TYPE, not by discipline:
    // there is no field for a token byte or a claim to ride out on.
    for (const token of [
      jwtExpiring(nowSec() - 10),
      jwtExpiring(nowSec() + 10),
      "opaque",
    ]) {
      const result = isAccessTokenExpired(token);
      expect(result === true || result === false || result === null).toBe(true);
    }
  });

  it("the returned value serializes to no token bytes and no claim value", () => {
    const token = jwtExpiring(nowSec() - 10);
    const serialized = JSON.stringify(isAccessTokenExpired(token));
    expect(serialized).not.toContain(DECOY_CLAIM);
    expect(serialized).not.toContain("leaky@example.com");
    expect(serialized).not.toContain(token);
    // Not even a base64url segment of it.
    expect(serialized).not.toContain(token.split(".")[1] as string);
  });

  it("makes NO network call (AC8: the decoder is strictly local)", () => {
    // The ClawHub probe is the doctor's ONLY outbound request and it is nowhere
    // near the token path. A decoder that phoned home would be sending token
    // material over the wire.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    isAccessTokenExpired(jwtExpiring(nowSec() - 10));
    isAccessTokenExpired(jwtExpiring(nowSec() + 10));
    isAccessTokenExpired("opaque-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is synchronous — no promise to await, so no I/O can hide inside it", () => {
    const result = isAccessTokenExpired(jwtExpiring(nowSec() + 10));
    expect(result).not.toBeInstanceOf(Promise);
  });
});

// ===========================================================================
// AC7 — finding/report shape is exactly the founder's six fields + roll-ups.
// ===========================================================================

const REPORT_KEYS = [
  "counts",
  "dataDir",
  "findings",
  "healthy",
  "installedVersion",
  "status",
];

const build = (findings: Finding[]) =>
  buildDoctorReport({
    dataDir: "/tmp/sil-data",
    installedVersion: "0.4.2",
    findings,
  });

describe("buildDoctorReport — the envelope payload shape", () => {
  it("carries exactly the six DoctorReport keys — no extras", () => {
    expect(Object.keys(build([])).sort()).toEqual(REPORT_KEYS);
  });

  it("`status` is always \"ok\" — the CALL always succeeds (report-first)", () => {
    // Even a critical finding is a SUCCESSFUL diagnosis. `status` is the call's
    // outcome, not the store's health — `healthy` is the store's health.
    expect(build([]).status).toBe("ok");
    expect(build([finding("fs.data_dir_writable", "critical")]).status).toBe("ok");
  });

  it("reports the dataDir and a non-empty installedVersion it was given", () => {
    const report = build([]);
    expect(report.dataDir).toBe("/tmp/sil-data");
    expect(report.installedVersion).toBe("0.4.2");
    expect(report.installedVersion.length).toBeGreaterThan(0);
  });

  it("returns the findings it was given — it never invents one (no fabrication)", () => {
    // PO invariant 3: absence of a problem is not a finding. A healthy store's
    // assembler output is an EMPTY array, not a synthesized "all good" entry.
    expect(build([]).findings).toEqual([]);
    const one = finding("identity.tokens_present", "info");
    expect(build([one]).findings).toEqual([one]);
  });
});

describe("buildDoctorReport — `healthy` is true IFF no finding exceeds `info`", () => {
  const cases: Array<[string, Severity[], boolean]> = [
    ["no findings at all", [], true],
    ["a single info", ["info"], true],
    ["several infos", ["info", "info", "info"], true],
    ["a single warn", ["warn"], false],
    ["a single critical", ["critical"], false],
    ["info + warn", ["info", "warn"], false],
    ["info + critical", ["info", "critical"], false],
    ["warn + critical", ["warn", "critical"], false],
    ["all three", ["info", "warn", "critical"], false],
  ];

  for (const [label, severities, expected] of cases) {
    it(`${label} → healthy: ${expected}`, () => {
      const findings = severities.map((s, i) => finding(`check.${i}`, s));
      expect(build(findings).healthy).toBe(expected);
    });
  }

  it("an `info` advisory does NOT flip healthy — the version advisory is not a degradation", () => {
    // The exact regression AC4 guards: if a newer published version made the
    // report unhealthy, EVERY install goes permanently yellow the moment we
    // publish and the `healthy` signal is worthless.
    const versionAdvisory: Finding = {
      id: "version.plugin_behind",
      severity: "info",
      status: "advisory",
      detected: "installed 0.4.2, latest 0.5.0",
      suggestedAction: "update via OpenClaw",
      appliedAction: null,
    };
    expect(build([versionAdvisory]).healthy).toBe(true);
  });

  it("`healthy` reads SEVERITY, not status — a `fixed` warn still reports unhealthy this run", () => {
    // severity and status are orthogonal. A perms problem that was auto-fixed
    // this run was still a real problem; the roll-up must not be driven by the
    // lifecycle field.
    const fixed: Finding = {
      id: "fs.mode:tokens.json",
      severity: "warn",
      status: "fixed",
      detected: "mode 0644",
      suggestedAction: null,
      appliedAction: "chmod 0600",
    };
    expect(build([fixed]).healthy).toBe(false);
  });
});

describe("buildDoctorReport — `counts` matches the findings exactly", () => {
  it("counts an empty report as all zeroes", () => {
    expect(build([]).counts).toEqual({ info: 0, warn: 0, critical: 0 });
  });

  it("counts each severity independently (2 info, 3 warn, 1 critical)", () => {
    const findings = [
      finding("a", "info"),
      finding("b", "info"),
      finding("c", "warn"),
      finding("d", "warn"),
      finding("e", "warn"),
      finding("f", "critical"),
    ];
    expect(build(findings).counts).toEqual({ info: 2, warn: 3, critical: 1 });
  });

  it("counts sum to the findings length — nothing is dropped from the roll-up", () => {
    const findings = [
      finding("a", "info"),
      finding("b", "warn"),
      finding("c", "critical"),
      finding("d", "info"),
    ];
    const report = build(findings);
    const { info, warn, critical } = report.counts;
    expect(info + warn + critical).toBe(report.findings.length);
  });

  it("counts carry exactly the three severity keys", () => {
    expect(Object.keys(build([]).counts).sort()).toEqual([
      "critical",
      "info",
      "warn",
    ]);
  });
});

describe("buildDoctorReport — rides the standard jsonResult envelope (AC7)", () => {
  it("serializes to ONE text content part whose text parses back to the report", () => {
    const report = build([finding("identity.tokens_present", "info")]);
    const result = jsonResult(report);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(JSON.parse(result.content[0]?.text as string)).toEqual(report);
  });

  it("is a plain JSON-serializable object — no class, no undefined-valued keys", () => {
    // A consumer (the skill, the sibling advisory, a dashboard) reads this over
    // the wire. An `undefined` value silently vanishes through JSON.stringify,
    // which would make `suggestedAction: undefined` masquerade as an absent key
    // instead of the contracted explicit `null`.
    const report = build([finding("a", "info")]);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
