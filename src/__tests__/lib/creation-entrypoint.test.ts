/**
 * UNIT — the creation-entrypoint resolver, probe, and pure finding builder
 * (tier: unit — one temp-dir probe seam aside, no network, no spawn, <100ms).
 *
 * Card: creation-bin-unreachable-on-clawhub-installs — **AC A7, B3, B4**, and the
 * pure half of B1/B2.
 *
 * **The bug this module exists to kill.** `openclaw plugins install` extracts the
 * tarball and links no bins, so the documented bare `sil-openclaw-create-shopper`
 * existed only on the npm-global channel and the creation flow died at its last
 * step. The plugin process is the only party that knows its own root, so it
 * resolves the path and reports it.
 *
 * **The two traps these tests exist to catch, both of which pass a naive suite:**
 *
 * 1. **A cwd-derived root.** `process.cwd()` IS the repo root under vitest, so a
 *    cwd variant is green in CI and broken in production, where cwd is the
 *    agent's workspace. The A7 test below therefore re-imports the module with
 *    the process ACTUALLY chdir'd elsewhere and demands the same absolute path.
 *    That assertion is total: it fails for a cwd root, a PATH lookup, a homedir
 *    root, and a hardcoded install path alike, because it pins the ONE right
 *    answer rather than forbidding a list of wrong mechanisms.
 *      Deliberately NOT a source scan for `process.cwd`: this module's docstring
 *    correctly DISAVOWS cwd by name, so a substring ban would fail the very prose
 *    that documents the fix.
 * 2. **A finding that reports a path it never probed.** The builder is pure — a
 *    function of (path, verdict) — so the tests below hand it a verdict that
 *    CONTRADICTS the filesystem and assert the verdict wins. A builder that
 *    re-probed would "correct" them and the doctor's report could then disagree
 *    with the doctor's own probe.
 *
 * Contract pinned for the implementation (`src/lib/creation-entrypoint.ts`) — as
 * published by expert-developer on the card:
 *   export const CREATION_ENTRYPOINT_RELATIVE = "scripts/create-shopper.mjs";
 *   export const ALLOWLIST_SCRIPT_RELATIVE   = "scripts/allowlist-openclaw.mjs";
 *   export type CreationEntrypointVerdict = "present" | "missing" | "unresolvable";
 *   export function resolveCreationEntrypoint(): string;   // absolute
 *   export function resolveAllowlistScript(): string;      // absolute
 *   export function probeCreationEntrypoint(entrypoint?: string): CreationEntrypointVerdict;
 *   export function buildCreationEntrypointFinding(
 *     entrypoint: string, verdict: CreationEntrypointVerdict,
 *   ): Finding;  // ALWAYS a Finding, never null — a singleton that reports `ok` too
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the module.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWLIST_SCRIPT_RELATIVE,
  CREATION_ENTRYPOINT_RELATIVE,
  buildCreationEntrypointFinding,
  probeCreationEntrypoint,
  resolveAllowlistScript,
  resolveCreationEntrypoint,
  type CreationEntrypointVerdict,
} from "../../lib/creation-entrypoint.js";

/** …/src/__tests__/lib → three levels up is the repo (plugin) root. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const FAILING_VERDICTS: CreationEntrypointVerdict[] = ["missing", "unresolvable"];

/** Running as root bypasses permission bits, so an EACCES fault cannot fire. */
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sil-entrypoint-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* best effort — the EACCES test drops perms */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// AC A7 — the root comes from import.meta.url, and from nothing else.
// ===========================================================================

describe("resolveCreationEntrypoint — the plugin root is derived from import.meta.url", () => {
  it("resolves to the plugin root's scripts/create-shopper.mjs, absolutely", () => {
    const resolved = resolveCreationEntrypoint();
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(join(REPO_ROOT, CREATION_ENTRYPOINT_RELATIVE));
  });

  it("points at a file that really exists in this tree (the path is not a fiction)", () => {
    // Anti-vacuity for the whole file: every assertion below is about a path, so
    // one of them must confirm the path is real. If this fails, the `--spec` form
    // the skill documents is unrunnable and A1 is a lie.
    expect(existsSync(resolveCreationEntrypoint())).toBe(true);
  });

  it("AC A7 — resolves IDENTICALLY from a foreign cwd (never process.cwd())", async () => {
    // THE production-fidelity test. Under vitest, cwd IS the repo root, so a
    // `resolve("scripts/create-shopper.mjs")` implementation passes every other
    // test in this file and then fails in production, where cwd is the agent's
    // workspace. Here the process is REALLY chdir'd (vitest runs a forks pool, so
    // chdir is available) and the module is re-imported so a root computed at
    // module scope is recomputed under the foreign cwd.
    //
    // Pinning the exact expected path — rather than forbidding `process.cwd` —
    // makes this total: a cwd root, a PATH lookup, a homedir root and a hardcoded
    // /usr/lib path all fail it.
    const elsewhere = tempDir();
    const original = process.cwd();
    try {
      process.chdir(elsewhere);
      vi.resetModules();
      const fresh = await import("../../lib/creation-entrypoint.js");
      expect(fresh.resolveCreationEntrypoint()).toBe(
        join(REPO_ROOT, CREATION_ENTRYPOINT_RELATIVE),
      );
      expect(fresh.resolveCreationEntrypoint()).not.toContain(elsewhere);
      // And the sibling resolver rides the same root — founder ruling 2's fix is
      // only as sound as this.
      expect(fresh.resolveAllowlistScript()).toBe(
        join(REPO_ROOT, ALLOWLIST_SCRIPT_RELATIVE),
      );
    } finally {
      process.chdir(original);
    }
  });

  it("proves the chdir seam actually bites — a cwd-derived path WOULD differ there", () => {
    // Guard-of-the-guard: if the foreign cwd happened to be the repo root, the
    // test above would be vacuous — it would pass against a cwd implementation.
    const elsewhere = tempDir();
    const original = process.cwd();
    try {
      process.chdir(elsewhere);
      // What a cwd-derived resolver would have produced there, vs the truth.
      expect(join(process.cwd(), CREATION_ENTRYPOINT_RELATIVE)).not.toBe(
        join(REPO_ROOT, CREATION_ENTRYPOINT_RELATIVE),
      );
    } finally {
      process.chdir(original);
    }
  });

  it("makes NO network call — naming a local path is a local act", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    resolveCreationEntrypoint();
    resolveAllowlistScript();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the ONE literal — the constant every surface is asserted against (AC B7)", () => {
  it("CREATION_ENTRYPOINT_RELATIVE is the shipped script's repo-relative path", () => {
    // This exact string is set-equal against the bundled prose and
    // package.json#bin in skill-bundle-contract.integration.test.ts. If it drifts,
    // that guard is what catches it — but only if the literal here is real.
    expect(CREATION_ENTRYPOINT_RELATIVE).toBe("scripts/create-shopper.mjs");
    expect(ALLOWLIST_SCRIPT_RELATIVE).toBe("scripts/allowlist-openclaw.mjs");
  });

  it("the resolvers are that constant joined to the root — not a second literal", () => {
    // The drift the card exists to make impossible: a doctor that REPORTS one path
    // and PROBES another. One constant, one root, so they cannot disagree.
    expect(resolveCreationEntrypoint().endsWith(CREATION_ENTRYPOINT_RELATIVE)).toBe(true);
    expect(resolveAllowlistScript().endsWith(ALLOWLIST_SCRIPT_RELATIVE)).toBe(true);
  });

  it("both scripts resolve as siblings under one plugin root", () => {
    expect(dirname(resolveCreationEntrypoint())).toBe(dirname(resolveAllowlistScript()));
  });
});

// ===========================================================================
// The probe — a real filesystem read, determinate and total.
// ===========================================================================

describe("probeCreationEntrypoint — a local read, never a spawn or a probe", () => {
  it("reads `present` for a real file", () => {
    const path = join(tempDir(), "create-shopper.mjs");
    writeFileSync(path, "export {};\n");
    expect(probeCreationEntrypoint(path)).toBe("present");
  });

  it("reads `missing` for a path that is not there (the incomplete tarball)", () => {
    expect(probeCreationEntrypoint(join(tempDir(), "nope.mjs"))).toBe("missing");
  });

  it("reads `unresolvable` — NOT `missing` — for a path that exists but is no file", () => {
    // The distinction is the operator's next move: an absent file means the tree
    // shipped incomplete; a directory at that path means something else is wrong.
    const path = join(tempDir(), "create-shopper.mjs");
    mkdirSync(path);
    expect(probeCreationEntrypoint(path)).toBe("unresolvable");
  });

  it.skipIf(AS_ROOT)(
    "reads `unresolvable` — NOT `missing` — when the parent cannot be traversed",
    () => {
      // EACCES is not ENOENT. Reporting "missing" here would send the operator to
      // reinstall a tree whose file is present and merely unreadable.
      const dir = tempDir();
      const nested = join(dir, "scripts");
      mkdirSync(nested);
      const path = join(nested, "create-shopper.mjs");
      writeFileSync(path, "export {};\n");
      chmodSync(nested, 0o000);
      try {
        expect(probeCreationEntrypoint(path)).toBe("unresolvable");
      } finally {
        chmodSync(nested, 0o700);
      }
    },
  );

  it("defaults to the resolved entrypoint, and reads `present` in this real tree", () => {
    expect(probeCreationEntrypoint()).toBe("present");
  });

  it("NEVER throws — a probe that throws takes the whole diagnosis down", () => {
    // The doctor is needed most when the install is broken; an exception out of
    // execute() would replace the diagnosis with a crash.
    const dir = tempDir();
    for (const path of [
      "",
      "\0invalid",
      join(dir, "nope.mjs"),
      join(dir, "a", "deeply", "absent", "path.mjs"),
      dir,
    ]) {
      expect(() => probeCreationEntrypoint(path)).not.toThrow();
    }
  });

  it("makes NO network call — it stays determinate with the network down (AC B6)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    probeCreationEntrypoint();
    probeCreationEntrypoint(join(tempDir(), "nope.mjs"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is synchronous — no promise to await, so no I/O can hide inside it", () => {
    expect(probeCreationEntrypoint()).not.toBeInstanceOf(Promise);
  });

  it("the `missing → present` lifecycle is real (AC B5's filesystem half)", () => {
    // `fixed → re-run → ok` needs the probe to actually change its answer when the
    // operator repairs the tree — not to cache the first verdict.
    const path = join(tempDir(), "create-shopper.mjs");
    expect(probeCreationEntrypoint(path)).toBe("missing");
    writeFileSync(path, "export {};\n");
    expect(probeCreationEntrypoint(path)).toBe("present");
  });
});

// ===========================================================================
// AC B1/B2/B3/B4 — the pure finding builder.
// ===========================================================================

describe("buildCreationEntrypointFinding — a singleton that reports EVERY run", () => {
  it("AC B1 — `present` is info / ok, with nothing to suggest", () => {
    const finding = buildCreationEntrypointFinding("/plugin/scripts/create-shopper.mjs", "present");
    expect(finding.id).toBe("creation.entrypoint_present");
    expect(finding.severity).toBe("info");
    expect(finding.status).toBe("ok");
    expect(finding.suggestedAction).toBeNull();
    expect(finding.appliedAction).toBeNull();
  });

  it.each(FAILING_VERDICTS)("AC B2 — `%s` is a warn (which is what makes healthy false)", (verdict) => {
    const finding = buildCreationEntrypointFinding("/plugin/scripts/create-shopper.mjs", verdict);
    expect(finding.severity).toBe("warn");
    expect(finding.status).toBe("advisory");
    expect(finding.appliedAction).toBeNull();
  });

  it("carries ONE stable id across every verdict — the lifecycle subject (AC B5)", () => {
    // A problem-only finding could not report `fixed → re-run → ok`: the id would
    // simply vanish on the run after the fix, and the consumer could not tell a
    // repaired install from an unchecked one.
    const ids = new Set(
      (["present", ...FAILING_VERDICTS] as CreationEntrypointVerdict[]).map(
        (v) => buildCreationEntrypointFinding("/plugin/scripts/create-shopper.mjs", v).id,
      ),
    );
    expect([...ids]).toEqual(["creation.entrypoint_present"]);
  });

  it("names the subject in its id, like fs.data_dir_writable / identity.tokens_present", () => {
    expect(buildCreationEntrypointFinding("/x/y.mjs", "present").id).toMatch(
      /^creation\.[a-z_]+$/,
    );
  });

  it("is EXACTLY the six flat finding fields — no extras, no undefined", () => {
    // The finding schema is pinned to six flat fields with no extras
    // (advisory.integration AC11); a path riding an extra key would break it — and
    // is exactly why `creationEntrypoint` lives on the REPORT instead.
    for (const verdict of ["present", ...FAILING_VERDICTS] as CreationEntrypointVerdict[]) {
      const finding = buildCreationEntrypointFinding("/x/y.mjs", verdict);
      expect(Object.keys(finding).sort()).toEqual([
        "appliedAction",
        "detected",
        "id",
        "severity",
        "status",
        "suggestedAction",
      ]);
      expect(JSON.parse(JSON.stringify(finding))).toEqual(finding);
    }
  });
});

describe("buildCreationEntrypointFinding — `detected` names the path AND the verdict (AC B3)", () => {
  const ENTRYPOINT = "/opt/plugins/sil/scripts/create-shopper.mjs";

  it.each(["present", ...FAILING_VERDICTS] as CreationEntrypointVerdict[])(
    "names the absolute path it is reporting on, verbatim (%s)",
    (verdict) => {
      // The operator's next move depends entirely on WHICH path is absent.
      expect(buildCreationEntrypointFinding(ENTRYPOINT, verdict).detected).toContain(ENTRYPOINT);
    },
  );

  it("distinguishes missing from unresolvable — never a generic 'creation is broken'", () => {
    const missing = buildCreationEntrypointFinding(ENTRYPOINT, "missing").detected;
    const unresolvable = buildCreationEntrypointFinding(ENTRYPOINT, "unresolvable").detected;
    expect(missing).not.toBe(unresolvable);
    expect(missing.toLowerCase()).toContain("missing");
  });

  it("says something CONCRETE — not merely the path echoed back", () => {
    const detected = buildCreationEntrypointFinding(ENTRYPOINT, "missing").detected;
    expect(detected.replace(ENTRYPOINT, "").trim().length).toBeGreaterThan(20);
  });
});

describe("buildCreationEntrypointFinding — the recovery is runnable on the channel it diagnoses (AC B4)", () => {
  // THE point of founder ruling 2 and of this whole card: advice an operator
  // cannot run teaches them the doctor cannot be trusted. On a plugin-install
  // channel no sil bin is on PATH — but `openclaw` itself always is, which is the
  // card's whole premise.
  const ENTRYPOINT = "/opt/plugins/sil/scripts/create-shopper.mjs";

  it.each(FAILING_VERDICTS)("suggests a recovery at all, for `%s`", (verdict) => {
    const fix = buildCreationEntrypointFinding(ENTRYPOINT, verdict).suggestedAction;
    expect(fix).not.toBeNull();
    expect(fix!.length).toBeGreaterThan(0);
  });

  it.each(FAILING_VERDICTS)("NEVER names a bare sil bin — the very defect this card kills (`%s`)", (verdict) => {
    const fix = buildCreationEntrypointFinding(ENTRYPOINT, verdict).suggestedAction!;
    expect(fix).not.toContain("sil-openclaw-create-shopper");
    expect(fix).not.toContain("sil-openclaw-allowlist");
  });

  it.each(FAILING_VERDICTS)("NEVER prescribes a PATH edit or a global npm install (`%s`)", (verdict) => {
    // "Add it to your PATH" / "npm i -g" would make the ClawHub operator's install
    // work by leaving the supported channel — a workaround dressed as a diagnosis.
    const fix = buildCreationEntrypointFinding(ENTRYPOINT, verdict).suggestedAction!;
    expect(fix).not.toMatch(/\bPATH\b/);
    expect(fix).not.toMatch(/npm\s+(i|install|link)\b/);
  });

  it.each(FAILING_VERDICTS)("names OpenClaw's own plugin install path — the recovery for an incomplete tree (`%s`)", (verdict) => {
    const fix = buildCreationEntrypointFinding(ENTRYPOINT, verdict).suggestedAction!;
    expect(fix).toContain("openclaw plugins install");
  });

  it("suggests NOTHING when the entrypoint is present (no busywork on a healthy install)", () => {
    expect(buildCreationEntrypointFinding(ENTRYPOINT, "present").suggestedAction).toBeNull();
  });
});

describe("buildCreationEntrypointFinding — PURE: the verdict it is handed is the verdict it reports", () => {
  // A builder that re-probed could contradict the caller's own probe, which is the
  // "reports a path it never probed" lie in mirror image: the doctor resolves ONCE
  // and probes ONCE, then reports both. These two tests fail loudly for any
  // implementation that reaches for the filesystem behind the caller's back.

  it("reports `warn` for a REAL, present file when handed `missing`", () => {
    const real = resolveCreationEntrypoint();
    expect(existsSync(real)).toBe(true);
    const finding = buildCreationEntrypointFinding(real, "missing");
    expect(finding.severity).toBe("warn");
    expect(finding.status).toBe("advisory");
  });

  it("reports `ok` for an absent path when handed `present`", () => {
    const absent = join(tempDir(), "definitely-not-here.mjs");
    expect(existsSync(absent)).toBe(false);
    const finding = buildCreationEntrypointFinding(absent, "present");
    expect(finding.severity).toBe("info");
    expect(finding.status).toBe("ok");
  });

  it("makes NO network call and returns synchronously", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const finding = buildCreationEntrypointFinding("/x/y.mjs", "missing");
    expect(finding).not.toBeInstanceOf(Promise);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
