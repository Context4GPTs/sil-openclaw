/**
 * INTEGRATION — `sil_doctor` end-to-end against a REAL `$SIL_DATA_DIR` (tier:
 * integration; real fs, real fixtures, real fault injection, the real `execute()`).
 *
 * Card: sil-doctor-tool-data-store-identity-health — **AC1–AC6c + AC10**.
 *
 * **The ONLY thing mocked is `fetch`** — the host/network boundary, and the doctor's
 * one outbound request (the unauthed ClawHub GET; founder ruling, OQ6). Every other
 * seam is real: a real temp data dir, real perms, real malformed artefacts, the real
 * `profile-store` `unreadable[]` surfacing, the real `credentials` module. Nothing
 * here is stubbed (complete-work-is-stub-free): the faults are genuine EACCES /
 * ENOTDIR conditions produced on a real filesystem.
 *
 * **The ClawHub wire shape is NOT invented.** It is transcribed from the shipped
 * `clawhub@0.22.0` CLI's own route + response schema (`dist/schema/routes.js`
 * `ApiRoutes.packages = "/api/v1/packages"`; `dist/schema/packages.js`
 * `ApiV1PackageResponseSchema = { package: { name, family, latestVersion: string|null?,
 * tags: unknown, … } | null, owner }`), with `DEFAULT_REGISTRY = "https://clawhub.ai"`
 * and an OPTIONAL auth token (`getOptionalAuthToken`) — i.e. a public unauthed GET is
 * the real contract, exactly as the founder ruled. The CLI resolves the latest as
 * `package.latestVersion ?? tags.latest`, so the fixture carries both, in agreement.
 * If ClawHub's contract ever moves, THIS is the file to correct — do not "fix" a red
 * by loosening it into a shape ClawHub does not serve.
 *
 * **The anti-false-green rails**, since a doctor that lies is worse than none:
 *   - Every version assertion for the three SILENT states asserts an ABSENCE
 *     explicitly (`no finding whose id starts "version."`), never merely a green run.
 *   - The stalling-probe test asserts the probe's `AbortSignal` was actually ABORTED
 *     and the run finished well inside a bound — a doctor with no timeout hangs the
 *     suite rather than passing it.
 *   - Every leak assertion scans the WHOLE serialized report AND every logger call,
 *     for the token bytes, the refresh token, and a decoy JWT claim.
 *   - The healthy-store test snapshots the entire tree (bytes + modes) and asserts it
 *     is byte-identical afterwards — which also catches a leaked atomic-write tmp.
 *
 * Contract pinned for the implementation (expert-developer):
 *   - `registerDoctorTools(api)` (src/tools/doctor.ts) registers `sil_doctor`,
 *     `parameters: Type.Object({})`, and is SYNCHRONOUS + opens nothing + runs NO
 *     check (all work is inside `execute`).
 *   - `execute(callId, {})` returns `jsonResult(DoctorReport)` and NEVER throws.
 *   - The probe routes through global `fetch` by default (so this file's spy is the
 *     real boundary and the real timeout/abort logic is exercised, not mocked away).
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  lstatSync,
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { registerDoctorTools } from "../tools/doctor.js";
import { getDataDir, getTokensPath } from "../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

const TOOL = "sil_doctor";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** chmod-based fault injection is meaningless as root (root bypasses every
 * permission bit), so those tests skip rather than false-pass. */
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

const INSTALLED = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
).version as string;

/** The manifest's DECLARED outbound surface — the probe must target one of these
 * and nothing else. Derived, never hardcoded: the test cannot drift from the
 * security declaration a reviewer audits. */
const declaredEndpoints = (): string[] =>
  JSON.parse(readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"))
    .security.networkEndpoints as string[];

// ---------------------------------------------------------------------------
// Token fixtures. The decoy claim + the token bytes are what a leak looks like.
// ---------------------------------------------------------------------------

const b64url = (obj: unknown): string =>
  Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");

const DECOY_CLAIM = "decoy-subject-must-never-escape";
const REFRESH_TOKEN = "refresh-token-must-never-escape";

/** A structurally real JWT access token with the given `exp` (UNIX seconds). */
const jwtToken = (expSec: number): string =>
  [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ exp: expSec, sub: DECOY_CLAIM, email: "leaky@example.com" }),
    "c2lnbmF0dXJl",
  ].join(".");

const nowSec = (): number => Math.floor(Date.now() / 1000);
const FRESH_TOKEN = (): string => jwtToken(nowSec() + 3600);
const EXPIRED_TOKEN = (): string => jwtToken(nowSec() - 3600);

// ---------------------------------------------------------------------------
// The ClawHub fetch double (see the header for the schema's provenance).
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

let requests: CapturedRequest[] = [];

/** A realistic ClawHub package-detail body, per `ApiV1PackageResponseSchema`. */
function clawhubBody(latestVersion: string | null): unknown {
  return {
    package: {
      name: "@4gpts/sil",
      displayName: "sil",
      family: "code-plugin",
      channel: "stable",
      isOfficial: false,
      summary: "sil commerce plugin for OpenClaw",
      ownerHandle: "4gpts",
      createdAt: 1_700_000_000,
      updatedAt: 1_800_000_000,
      latestVersion,
      // The CLI resolves `latestVersion ?? tags.latest`; a real body carries
      // both, in agreement. Kept consistent so this fixture never teaches the
      // parser something ClawHub would not actually serve.
      tags: latestVersion === null ? {} : { latest: latestVersion },
    },
    owner: { handle: "4gpts", displayName: "4gpts" },
  };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Install a `fetch` double, capturing every outbound request. */
function installFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      requests.push({ url, init });
      return handler(url, init);
    },
  );
}

/** The channel reports `version` as the latest published. */
const probeReturns = (version: string | null): void => {
  installFetch(async () => jsonResponse(clawhubBody(version)));
};

/** The channel is up: it reports exactly what we have installed (no drift). */
const probeUpToDate = (): void => probeReturns(INSTALLED);

// ---------------------------------------------------------------------------
// Data-dir fixtures.
// ---------------------------------------------------------------------------

let parentDir: string;
let dataDir: string;
let priorSilDataDir: string | undefined;
let priorXdg: string | undefined;

const shopperDir = (): string => join(getDataDir(), "shopper");
const domainDir = (slug: string): string =>
  join(shopperDir(), "domains", slug);

/** A well-formed artefact: `--- key: value --- body`, written owner-only like
 * the store itself writes it. */
function writeArtefact(
  path: string,
  fields: Record<string, string>,
  body = "Prose body.\n",
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fm = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  writeFileSync(path, `---\n${fm}\n---\n${body}`, { mode: 0o600 });
}

/** A HEALTHY domain — must produce no finding of any kind. */
function seedHealthyDomain(slug = "coffee"): void {
  writeArtefact(join(domainDir(slug), "method.md"), {
    name: slug,
    updated_at: "2026-07-17",
  });
  writeArtefact(join(domainDir(slug), "prds", "beans-daily.md"), {
    key: "beans-daily",
    product: "beans",
    intent: "daily",
    title: "Daily beans",
    updated_at: "2026-07-17",
  });
}

/** A CORRUPT artefact: real bytes on disk, no parseable frontmatter. The store
 * surfaces it as `unreadable`; the doctor must lift it into a finding and must
 * NOT rewrite it. */
const CORRUPT_BYTES = "this file has no frontmatter fence at all\njust prose\n";

function seedCorruptDomain(slug = "broken"): string {
  const path = join(domainDir(slug), "method.md");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, CORRUPT_BYTES, { mode: 0o600 });
  return path;
}

function writeTokensFile(tokens: unknown, mode = 0o600): string {
  const path = getTokensPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(
    path,
    typeof tokens === "string" ? tokens : JSON.stringify(tokens),
    { mode },
  );
  chmodSync(path, mode); // writeFileSync honours umask; force the exact mode.
  return path;
}

const modeBits = (path: string): number => statSync(path).mode & 0o777;

/** A recursive snapshot of the tree: relpath → mode + content hash. Proves "no
 * writes" (bytes AND modes AND the absence of a leaked tmp file). */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      const st = lstatSync(full);
      if (entry.isDirectory()) {
        out[rel] = `dir:${st.mode & 0o777}`;
        walk(full);
      } else if (entry.isSymbolicLink()) {
        out[rel] = `link:${st.mode & 0o777}`;
      } else {
        const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
        out[rel] = `file:${st.mode & 0o777}:${hash}`;
      }
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// Running the real tool.
// ---------------------------------------------------------------------------

interface Finding {
  id: string;
  severity: "info" | "warn" | "critical";
  status: string;
  detected: string;
  suggestedAction: string | null;
  appliedAction: string | null;
}

interface DoctorReport {
  status: string;
  healthy: boolean;
  dataDir: string;
  installedVersion: string;
  counts: { info: number; warn: number; critical: number };
  findings: Finding[];
}

let api: MockPluginAPI;
let rawResult: unknown;

/** Drive the REAL tool through the REAL registration path, and assert the
 * standard envelope on every single run (AC3/AC5: never throws, always the
 * jsonResult envelope). Returns the parsed report. */
async function runDoctor(): Promise<DoctorReport> {
  api = createMockPluginApi();
  registerDoctorTools(api);
  const result = await getTool(api, TOOL).execute("call-1", {});
  rawResult = result;
  expect(result.content).toHaveLength(1);
  expect(result.content[0]?.type).toBe("text");
  return JSON.parse(result.content[0]?.text as string) as DoctorReport;
}

const findingsWithPrefix = (r: DoctorReport, prefix: string): Finding[] =>
  r.findings.filter((f) => f.id.startsWith(prefix));

const versionFindings = (r: DoctorReport): Finding[] =>
  findingsWithPrefix(r, "version.");

/** Every string the run emitted: the whole report AND every logger call. A leak
 * hides in a log line just as easily as in a field. */
function emittedStrings(report: DoctorReport): string {
  const logs = (["info", "warn", "error", "debug"] as const)
    .flatMap((level) => vi.mocked(api.logger[level]).mock.calls)
    .map((call) => JSON.stringify(call))
    .join("\n");
  return JSON.stringify(report) + "\n" + JSON.stringify(rawResult) + "\n" + logs;
}

/** The universal privacy rail: no token material, anywhere. */
function expectNoSecrets(report: DoctorReport, accessToken?: string): void {
  const emitted = emittedStrings(report);
  expect(emitted).not.toContain(REFRESH_TOKEN);
  expect(emitted).not.toContain(DECOY_CLAIM);
  expect(emitted).not.toContain("leaky@example.com");
  expect(emitted).not.toContain("access_token");
  expect(emitted).not.toContain("refresh_token");
  if (accessToken !== undefined) {
    expect(emitted).not.toContain(accessToken);
    // Not even a single segment of the JWT (a partial leak is still a leak).
    for (const segment of accessToken.split(".")) {
      if (segment.length > 8) expect(emitted).not.toContain(segment);
    }
  }
}

beforeEach(() => {
  parentDir = mkdtempSync(join(tmpdir(), "sil-doctor-test-"));
  dataDir = join(parentDir, "data");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  priorXdg = process.env["XDG_DATA_HOME"];
  process.env["SIL_DATA_DIR"] = dataDir;
  requests = [];
  rawResult = undefined;
  // Default channel: reachable and up to date. EVERY test has fetch stubbed —
  // a live ClawHub call in CI is a hard failure, not a flake.
  probeUpToDate();
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  if (priorXdg === undefined) delete process.env["XDG_DATA_HOME"];
  else process.env["XDG_DATA_HOME"] = priorXdg;
  vi.restoreAllMocks();
  try {
    chmodSync(parentDir, 0o700);
    if (existsSync(dataDir) && lstatSync(dataDir).isDirectory()) {
      chmodSync(dataDir, 0o700);
    }
  } catch {
    /* best-effort: restore perms so the cleanup below can recurse */
  }
  rmSync(parentDir, { recursive: true, force: true });
});

// ===========================================================================
// AC10 — wiring preserves the register() invariant.
// ===========================================================================

describe("AC10 — register() opens nothing and runs NO check", () => {
  it("registers sil_doctor synchronously, with an empty parameter schema", () => {
    const local = createMockPluginApi();
    const returned = registerDoctorTools(local);
    // Synchronous: a promise here would be an unawaited side-effect at register
    // time — the exact thing that once held the host's install subprocess event
    // loop open and blocked gateway startup.
    expect(returned).not.toBeInstanceOf(Promise);
    const tool = getTool(local, TOOL);
    expect(tool.name).toBe(TOOL);
    // Report-first: no args. Safe fixes auto-apply, destructive ones are
    // report-only, so there is nothing to parameterize (MVP).
    expect(tool.parameters).toEqual({ type: "object", properties: {} });
  });

  it("opens NO timer and NO socket at register time", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    registerDoctorTools(createMockPluginApi());
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    // The ClawHub probe must live inside execute(). A probe fired at register
    // time opens a socket during the host's install subprocess — the invariant
    // this whole rule exists for.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs NO check at register time — it does not even touch the data dir", () => {
    // Proof by observable side-effect: point the data dir at a path that does
    // not exist. A doctor that ran ANY check at register time would probe /
    // create / stat it. Registration must be inert.
    const missing = join(parentDir, "never-created");
    process.env["SIL_DATA_DIR"] = missing;
    registerDoctorTools(createMockPluginApi());
    expect(existsSync(missing)).toBe(false);
    expect(requests).toEqual([]);
  });

  it("does not throw at register time even when the data dir is unusable", () => {
    // ENOTDIR: the data-dir path is occupied by a FILE. register() must still
    // be inert — the diagnosis (and the critical finding) belongs to execute().
    const occupied = join(parentDir, "occupied");
    writeFileSync(occupied, "i am a file, not a dir");
    process.env["SIL_DATA_DIR"] = occupied;
    expect(() => registerDoctorTools(createMockPluginApi())).not.toThrow();
  });
});

// ===========================================================================
// AC1 — `unreadable` artefact → finding, never dropped, never clobbered.
// ===========================================================================

describe("AC1 — a malformed artefact surfaces as exactly one finding, never clobbered", () => {
  it("lifts a corrupt method.md into exactly ONE store.unreadable finding", async () => {
    const corrupt = seedCorruptDomain("broken");
    const report = await runDoctor();
    const unreadable = findingsWithPrefix(report, "store.unreadable");
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.id).toBe("store.unreadable:broken");
    expect(unreadable[0]!.severity).toBe("warn");
    // Report-only: the doctor offers no auto-fix and never re-mints over it.
    expect(unreadable[0]!.status).toBe("advisory");
    expect(unreadable[0]!.appliedAction).toBeNull();
    // `detected` must name the artefact and the corruption — it is what a human
    // reads to go repair the file.
    expect(unreadable[0]!.detected).toContain("broken");
    expect(unreadable[0]!.suggestedAction).not.toBeNull();
    expect(existsSync(corrupt)).toBe(true);
  });

  it("NEVER overwrites or removes the corrupt file (delete-first does not apply to user data)", async () => {
    const corrupt = seedCorruptDomain("broken");
    const before = snapshot(dataDir);
    await runDoctor();
    // Byte-identical, mode-identical, still present. This mirrors the store's
    // own contract: inspect / repair, do NOT overwrite — it may still be
    // recoverable.
    expect(readFileSync(corrupt, "utf8")).toBe(CORRUPT_BYTES);
    expect(snapshot(dataDir)).toEqual(before);
  });

  it("healthy sibling artefacts produce NO finding (per-path checks emit only on a problem)", async () => {
    seedHealthyDomain("coffee");
    seedHealthyDomain("shoes");
    seedCorruptDomain("broken");
    const report = await runDoctor();
    const unreadable = findingsWithPrefix(report, "store.unreadable");
    // Exactly one — the corrupt one. A healthy store with 200 artefacts must
    // emit ZERO findings, not 200 `ok` ones.
    expect(unreadable.map((f) => f.id)).toEqual(["store.unreadable:broken"]);
  });

  it("surfaces EVERY unreadable entry — two corrupt artefacts are never aggregated into one", async () => {
    seedCorruptDomain("broken-one");
    seedCorruptDomain("broken-two");
    const report = await runDoctor();
    const ids = findingsWithPrefix(report, "store.unreadable")
      .map((f) => f.id)
      .sort();
    // PO invariant 2: each entry lifts into EXACTLY one finding, never
    // aggregated away, never silently dropped.
    expect(ids).toEqual(["store.unreadable:broken-one", "store.unreadable:broken-two"]);
  });

  it("surfaces a malformed user_spec.md too (the shopper-identity read)", async () => {
    const path = join(shopperDir(), "user_spec.md");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, "no frontmatter here\n", { mode: 0o600 });
    const report = await runDoctor();
    expect(findingsWithPrefix(report, "store.unreadable")).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toBe("no frontmatter here\n");
  });

  it("an unreadable artefact makes the store unhealthy but never throws", async () => {
    seedCorruptDomain("broken");
    const report = await runDoctor();
    expect(report.status).toBe("ok"); // the CALL succeeded
    expect(report.healthy).toBe(false); // the STORE is degraded
  });
});

// ===========================================================================
// AC2a/AC2b/AC2c/AC2d — identity & token health.
// ===========================================================================

describe("AC2a — not registered is informational, not an error", () => {
  it("emits an `info` identity finding naming sil_register when tokens.json is absent", async () => {
    expect(existsSync(getTokensPath())).toBe(false);
    const report = await runDoctor();
    const identity = findingsWithPrefix(report, "identity.");
    expect(identity.length).toBeGreaterThan(0);
    const present = identity.find((f) => f.id === "identity.tokens_present");
    expect(present).toBeDefined();
    // Not-registered is a VALID state — bare sil_search still works.
    expect(present!.severity).toBe("info");
    expect(JSON.stringify(present)).toContain("sil_register");
  });

  it("a not-registered store is still HEALTHY", async () => {
    const report = await runDoctor();
    expect(report.healthy).toBe(true);
  });

  it("reads and emits no token contents when there is no token", async () => {
    const report = await runDoctor();
    expectNoSecrets(report);
  });
});

/**
 * **tokens.json's mode is a SINGLETON check, not part of the enumerated walk.**
 * The card is ambiguous here (the checks table routes file modes to the recursive
 * `fs.mode:<relpath>` walk; AC2b + the architect's addendum require a stable id), so
 * this file settles it — and the singleton is the reading that satisfies EVERYTHING:
 *
 *  - **AC2b's letter**: "a re-run yields `status: ok`". Only a check that emits a
 *    stable finding every run can transition `fixed → ok`. An enumerated check just
 *    vanishes, and the architect's addendum says so explicitly: "AC2b's idempotence
 *    guarantee rests on [singleton checks] — `fixed → re-run → ok` needs the same id
 *    to still be there."
 *  - **The emit rule**: it makes ENUMERATED per-path checks problem-only so a healthy
 *    store with 200 artefacts emits zero findings, not 200 `ok` ones. tokens.json is
 *    not one of 200 — it is ONE fixed, always-the-same path, exactly like the
 *    `fs.data_dir_writable` singleton the architect lists as emitting a stable `ok`.
 *    So a singleton here does not violate the rule; it IS the rule's second case.
 *  - **Ordering** (the implementation's own argument for excluding tokens.json from
 *    the walk): the walk running first would fix the file before a singleton looked,
 *    so the singleton would report `ok` on the very run that fixed it and the fix
 *    would vanish from its own `appliedAction`.
 *
 * One check must own this path. If the walk's tokens.json exclusion stays (it
 * should), the singleton must exist — otherwise a too-open tokens.json is checked by
 * NOBODY, which is the highest-security-value fix in the tool silently going missing.
 */
const TOKENS_PERMS = "identity.tokens_perms";

describe("AC2b — too-open token perms auto-fix, and the fix STICKS (idempotence)", () => {
  it.skipIf(AS_ROOT)(
    "auto-tightens a 0644 tokens.json to 0600 and records the applied action",
    async () => {
      const path = writeTokensFile(
        { access_token: FRESH_TOKEN(), refresh_token: REFRESH_TOKEN },
        0o644,
      );
      expect(modeBits(path)).toBe(0o644);

      const report = await runDoctor();

      // The fix actually ran on the real filesystem — not just reported.
      expect(modeBits(path)).toBe(0o600);
      const perms = report.findings.find((f) => f.id === TOKENS_PERMS);
      expect(perms).toBeDefined();
      expect(perms!.status).toBe("fixed");
      expect(perms!.severity).toBe("warn");
      // appliedAction must record exactly what ran — it is the audit trail.
      expect(perms!.appliedAction).not.toBeNull();
      expect(perms!.appliedAction).toContain("0600");
    },
  );

  it.skipIf(AS_ROOT)(
    "a re-run yields the SAME id at status `ok` — the consumer's proof the fix stuck (AC2b)",
    async () => {
      const path = writeTokensFile(
        { access_token: FRESH_TOKEN(), refresh_token: REFRESH_TOKEN },
        0o644,
      );
      const first = await runDoctor(); // run 1 — fixes it
      expect(first.findings.find((f) => f.id === TOKENS_PERMS)!.status).toBe("fixed");

      const second = await runDoctor(); // run 2 — must be inert

      expect(modeBits(path)).toBe(0o600);
      // The `fixed → re-run → ok` transition, on the SAME stable id — AC2b's
      // literal guarantee, and the whole point of the singleton.
      const perms = second.findings.find((f) => f.id === TOKENS_PERMS);
      expect(perms).toBeDefined();
      expect(perms!.status).toBe("ok");
      expect(perms!.appliedAction).toBeNull();
      // Re-running re-applies NOTHING, anywhere — no second chmod claimed.
      expect(second.findings.filter((f) => f.status === "fixed")).toEqual([]);
      expect(second.findings.filter((f) => f.appliedAction !== null)).toEqual([]);
      expect(second.healthy).toBe(true);
    },
  );

  it.skipIf(AS_ROOT)(
    "SOMETHING owns the token's mode — a too-open tokens.json is never checked by nobody",
    async () => {
      // The hole this guards: if the enumerated walk EXCLUDES tokens.json (it
      // should — see the ordering argument above) and the singleton it defers to
      // is missing, a world-readable credential file is silently never detected
      // OR fixed. That is the single highest-security-value fix in the tool, and
      // its absence is invisible to every other assertion here.
      const path = writeTokensFile(
        { access_token: FRESH_TOKEN(), refresh_token: REFRESH_TOKEN },
        0o644,
      );
      const report = await runDoctor();
      // Exactly ONE check owns it: reported once, never double-reported.
      const owners = report.findings.filter(
        (f) => f.id === TOKENS_PERMS || f.id === "fs.mode:tokens.json",
      );
      expect(owners).toHaveLength(1);
      expect(modeBits(path)).toBe(0o600);
    },
  );

  it.skipIf(AS_ROOT)("only ever TIGHTENS — an already-0600 token is never widened", async () => {
    const path = writeTokensFile(
      { access_token: FRESH_TOKEN(), refresh_token: REFRESH_TOKEN },
      0o600,
    );
    const report = await runDoctor();
    // A "fix" must never become a security regression. 0600 in, 0600 out.
    expect(modeBits(path)).toBe(0o600);
    expect(report.findings.filter((f) => f.appliedAction !== null)).toEqual([]);
    expect(report.healthy).toBe(true);
  });

  it.skipIf(AS_ROOT)("never widens a mode that is TIGHTER than required (0400 stays 0400)", async () => {
    // The inverse over-reach: an implementation that "normalizes" to 0600 would
    // LOOSEN a 0400 file. Tighten-only means tighten-only.
    const path = writeTokensFile(
      { access_token: FRESH_TOKEN(), refresh_token: REFRESH_TOKEN },
      0o400,
    );
    await runDoctor();
    expect(modeBits(path) & 0o077).toBe(0); // still owner-only…
    expect(modeBits(path) & 0o200).toBe(0); // …and not re-granted write
  });

  it.skipIf(AS_ROOT)("emits no token bytes while reporting the perms problem", async () => {
    const accessToken = FRESH_TOKEN();
    writeTokensFile({ access_token: accessToken, refresh_token: REFRESH_TOKEN }, 0o644);
    const report = await runDoctor();
    expectNoSecrets(report, accessToken);
  });
});

describe("AC2c — a corrupt token is surfaced, NEVER auto-cleared", () => {
  it("emits a warn finding with a re-register hint for unparseable JSON", async () => {
    writeTokensFile("{not valid json at all", 0o600);
    const report = await runDoctor();
    const parse = report.findings.find((f) => f.id === "identity.tokens_parse");
    expect(parse).toBeDefined();
    expect(parse!.severity).toBe("warn");
    expect(parse!.suggestedAction).not.toBeNull();
    expect(parse!.suggestedAction).toContain("sil_register");
  });

  it("is report-only: needs_confirmation, appliedAction null, and the BYTES are untouched", async () => {
    // Clearing a corrupt tokens.json mutates the bytes of an existing artefact
    // ⇒ DESTRUCTIVE ⇒ never auto-run (AC3a). The file may still be recoverable.
    const raw = '{"access_token": "truncated-mid-writ';
    const path = writeTokensFile(raw, 0o600);
    const report = await runDoctor();
    const parse = report.findings.find((f) => f.id === "identity.tokens_parse")!;
    expect(parse.status).toBe("needs_confirmation");
    expect(parse.appliedAction).toBeNull();
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(raw);
  });

  it("treats a JSON object with no access_token as corrupt, and still never clears it", async () => {
    const raw = JSON.stringify({ refresh_token: REFRESH_TOKEN });
    const path = writeTokensFile(raw, 0o600);
    const report = await runDoctor();
    expect(report.findings.some((f) => f.id === "identity.tokens_parse")).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(raw);
    expectNoSecrets(report);
  });

  it("emits no token bytes from the corrupt file", async () => {
    writeTokensFile(
      JSON.stringify({ access_token: "corrupt-but-secret-" + DECOY_CLAIM }),
      0o600,
    );
    const report = await runDoctor();
    // A "helpful" doctor that echoed the unparseable file's contents to help you
    // debug it would leak the token on exactly the path where it is malformed.
    expect(emittedStrings(report)).not.toContain(DECOY_CLAIM);
  });
});

describe("AC2d — an expired token yields a re-register hint, never the token", () => {
  it("emits a warn advisory naming sil_register, with appliedAction null", async () => {
    writeTokensFile(
      { access_token: EXPIRED_TOKEN(), refresh_token: REFRESH_TOKEN },
      0o600,
    );
    const report = await runDoctor();
    const expiry = report.findings.find((f) => f.id === "identity.token_expiry");
    expect(expiry).toBeDefined();
    // warn, not critical: a present refresh_token means sil_whoami self-heals on
    // the next authed call — degraded, not broken.
    expect(expiry!.severity).toBe("warn");
    expect(expiry!.status).toBe("advisory");
    expect(expiry!.appliedAction).toBeNull();
    expect(expiry!.suggestedAction).toContain("sil_register");
  });

  it("emits neither the token nor ANY of its claims (the top risk)", async () => {
    const accessToken = EXPIRED_TOKEN();
    writeTokensFile({ access_token: accessToken, refresh_token: REFRESH_TOKEN }, 0o600);
    const report = await runDoctor();
    expectNoSecrets(report, accessToken);
  });

  it("a FRESH token produces no expiry problem", async () => {
    const accessToken = FRESH_TOKEN();
    writeTokensFile({ access_token: accessToken, refresh_token: REFRESH_TOKEN }, 0o600);
    const report = await runDoctor();
    expect(
      report.findings.filter(
        (f) => f.id === "identity.token_expiry" && f.status !== "ok",
      ),
    ).toEqual([]);
    expect(report.healthy).toBe(true);
    expectNoSecrets(report, accessToken);
  });

  it("an OPAQUE (non-JWT) token is never reported as expired (no fabricated expiry)", async () => {
    // Inconclusive ⇒ ok/skip. Fabricating expiry sends a working user to
    // re-register for nothing.
    writeTokensFile(
      { access_token: "sil_opaque_token_not_a_jwt", refresh_token: REFRESH_TOKEN },
      0o600,
    );
    const report = await runDoctor();
    expect(
      report.findings.filter(
        (f) => f.id === "identity.token_expiry" && f.status !== "ok",
      ),
    ).toEqual([]);
    expect(report.healthy).toBe(true);
  });

  it("never rotates or refreshes the token — a diagnosis has NO auth side-effects", async () => {
    const path = writeTokensFile(
      { access_token: EXPIRED_TOKEN(), refresh_token: REFRESH_TOKEN },
      0o600,
    );
    const before = readFileSync(path, "utf8");
    await runDoctor();
    expect(readFileSync(path, "utf8")).toBe(before);
    // The ONLY outbound request is the ClawHub probe — never sil-web/sil-api.
    for (const req of requests) {
      expect(req.url).not.toContain("/auth/refresh");
      expect(req.url).not.toContain("sil-api");
      expect(req.url).not.toContain("sil.4gpts.com");
    }
  });
});

// ===========================================================================
// AC3a/AC3b — fix posture: safe auto-applies, destructive is gated, failures
// are never green-washed.
// ===========================================================================

describe("AC3a — a safe dir-mode fix auto-applies", () => {
  it.skipIf(AS_ROOT)("auto-tightens a too-open shopper dir to 0700 and records it", async () => {
    seedHealthyDomain("coffee");
    chmodSync(shopperDir(), 0o755);
    const report = await runDoctor();
    expect(modeBits(shopperDir())).toBe(0o700);
    const fixed = report.findings.filter((f) => f.status === "fixed");
    expect(fixed.length).toBeGreaterThan(0);
    expect(fixed.some((f) => f.appliedAction?.includes("0700"))).toBe(true);
  });

  it.skipIf(AS_ROOT)("auto-tightens a too-open artefact FILE to 0600", async () => {
    seedHealthyDomain("coffee");
    const method = join(domainDir("coffee"), "method.md");
    chmodSync(method, 0o644);
    await runDoctor();
    expect(modeBits(method)).toBe(0o600);
  });

  it.skipIf(AS_ROOT)("never chmods THROUGH a symlink (the data-dir escape)", async () => {
    // A symlink inside the data dir pointing OUTSIDE it, if chmod'd, mutates an
    // external file's mode. The walk must lstat and the fix must SKIP symlinks.
    const outsider = join(parentDir, "outside-target.txt");
    writeFileSync(outsider, "not ours", { mode: 0o644 });
    symlinkSync(outsider, join(getDataDir(), "escape-link"));

    await runDoctor();

    // The external file's mode is untouched — the doctor's writes are scoped to
    // getDataDir() and never follow a link out of it.
    expect(modeBits(outsider)).toBe(0o644);
    expect(lstatSync(join(getDataDir(), "escape-link")).isSymbolicLink()).toBe(true);
  });

  it.skipIf(AS_ROOT)("never chmods a symlink's TARGET even when the target is inside the data dir", async () => {
    seedHealthyDomain("coffee");
    const method = join(domainDir("coffee"), "method.md");
    chmodSync(method, 0o600);
    symlinkSync(method, join(getDataDir(), "inside-link"));
    await runDoctor();
    // Reached only via lstat on the link itself — the real file keeps its mode
    // and is fixed (if at all) on its own path, once.
    expect(modeBits(method)).toBe(0o600);
  });
});

describe("AC3a — a DESTRUCTIVE fix is never auto-run", () => {
  it("surfaces the corrupt-token clear as needs_confirmation with nothing applied", async () => {
    const raw = "{corrupt";
    const path = writeTokensFile(raw, 0o600);
    const report = await runDoctor();
    const gated = report.findings.filter((f) => f.status === "needs_confirmation");
    expect(gated.length).toBeGreaterThan(0);
    for (const f of gated) expect(f.appliedAction).toBeNull();
    // The bytes are the assertion that matters: nothing ran.
    expect(readFileSync(path, "utf8")).toBe(raw);
  });

  it("never deletes a corrupt artefact — it is surfaced, not repaired", async () => {
    const corrupt = seedCorruptDomain("broken");
    await runDoctor();
    expect(existsSync(corrupt)).toBe(true);
    expect(readFileSync(corrupt, "utf8")).toBe(CORRUPT_BYTES);
  });

  it("never deletes an orphaned atomic-write tmp file (bytes on disk are user data)", async () => {
    // A `.tmp` orphan from an interrupted atomic write is surfaced as safe-to-
    // delete, never auto-deleted (PO destructive boundary). The name mirrors what
    // the store ACTUALLY leaves behind — `<path>.<12 hex>.tmp`, i.e.
    // randomBytes(6).toString("hex") (profile-store.ts atomicWrite) — so the
    // fixture is a real orphan, not an invented one.
    const orphan = join(shopperDir(), "user_spec.md.a1b2c3d4e5f6.tmp");
    mkdirSync(dirname(orphan), { recursive: true, mode: 0o700 });
    writeFileSync(orphan, "half-written bytes", { mode: 0o600 });
    const report = await runDoctor();
    expect(existsSync(orphan)).toBe(true);
    expect(readFileSync(orphan, "utf8")).toBe("half-written bytes");
    const stale = findingsWithPrefix(report, "fs.stale_tmp");
    expect(stale.length).toBeGreaterThan(0);
    for (const f of stale) expect(f.appliedAction).toBeNull();
  });
});

describe("AC3b — a failed safe fix is NEVER green-washed as fixed", () => {
  it.skipIf(AS_ROOT)(
    "reports fix_failed (not fixed) when the safe create-the-data-dir fix EACCESes",
    async () => {
      // A genuine EACCES: the data dir is absent and its parent is read-only, so
      // the ONE safe fix the doctor would attempt here (create the missing
      // container dir) cannot run. This is the honesty rail — an un-applied fix
      // must never be reported as applied (mirrors create-shopper.mjs's
      // teardown_failed discipline).
      const missing = join(parentDir, "readonly-parent", "data");
      mkdirSync(dirname(missing), { recursive: true, mode: 0o700 });
      chmodSync(dirname(missing), 0o500);
      process.env["SIL_DATA_DIR"] = missing;
      try {
        const report = await runDoctor();

        expect(existsSync(missing)).toBe(false); // the fix really did fail
        expect(report.findings.some((f) => f.status === "fix_failed")).toBe(true);
        // NOTHING may claim success while the dir is still absent.
        expect(report.findings.filter((f) => f.status === "fixed")).toEqual([]);
        expect(report.healthy).toBe(false);
        // The envelope still returns — a broken data dir is diagnosed, not thrown.
        expect(report.status).toBe("ok");
      } finally {
        chmodSync(dirname(missing), 0o700);
      }
    },
  );

  it.skipIf(AS_ROOT)("surfaces the failure cause WITHOUT secrets", async () => {
    const missing = join(parentDir, "readonly-parent-2", "data");
    mkdirSync(dirname(missing), { recursive: true, mode: 0o700 });
    chmodSync(dirname(missing), 0o500);
    process.env["SIL_DATA_DIR"] = missing;
    try {
      const report = await runDoctor();
      const failed = report.findings.find((f) => f.status === "fix_failed")!;
      // The operator needs the OS cause to act on it — "<path>: <cause>", the
      // store's existing persistence_failed discipline.
      expect(failed.detected.length).toBeGreaterThan(0);
      expect(failed.suggestedAction).not.toBeNull();
      expectNoSecrets(report);
    } finally {
      chmodSync(dirname(missing), 0o700);
    }
  });
});

// ===========================================================================
// AC5 — an unusable data dir is critical, and still never throws.
// ===========================================================================

describe("AC5 — unwritable / not-a-directory data dir is `critical`", () => {
  it("emits a critical finding when $SIL_DATA_DIR is a FILE (ENOTDIR) — no root needed", async () => {
    // Root-immune fault: the path is occupied by a regular file, so no store
    // artefact or token could ever persist. Systemic ⇒ critical.
    const occupied = join(parentDir, "occupied-by-a-file");
    writeFileSync(occupied, "i am a file");
    process.env["SIL_DATA_DIR"] = occupied;

    const report = await runDoctor();

    expect(report.counts.critical).toBeGreaterThan(0);
    const critical = report.findings.find((f) => f.severity === "critical")!;
    expect(critical.suggestedAction).not.toBeNull();
    expect(critical.appliedAction).toBeNull(); // it cannot fix this
    expect(report.healthy).toBe(false);
    expect(report.status).toBe("ok"); // still a clean envelope — never throws
    // Untouched: the doctor did not "repair" the path by deleting the file.
    expect(readFileSync(occupied, "utf8")).toBe("i am a file");
  });

  it.skipIf(AS_ROOT)("emits a critical finding when $SIL_DATA_DIR is not writable", async () => {
    chmodSync(dataDir, 0o500);
    try {
      const report = await runDoctor();
      expect(report.counts.critical).toBeGreaterThan(0);
      expect(report.healthy).toBe(false);
      expect(report.status).toBe("ok");
    } finally {
      chmodSync(dataDir, 0o700);
    }
  });

  it("still reports the installed version and returns the full envelope on a broken dir", async () => {
    const occupied = join(parentDir, "occupied-2");
    writeFileSync(occupied, "file");
    process.env["SIL_DATA_DIR"] = occupied;
    const report = await runDoctor();
    // AC6: the installed version is LOCAL and was never in doubt — a broken data
    // dir does not suppress the first datum an operator needs.
    expect(report.installedVersion).toBe(INSTALLED);
    expect(report.dataDir).toBe(occupied);
  });
});

// ===========================================================================
// AC4 — a healthy store returns a clean result and performs no writes.
// ===========================================================================

/** The canonical HEALTHY store: 0700 data dir, owner-only unexpired token,
 * clean artefacts. */
function seedHealthyStore(): void {
  chmodSync(dataDir, 0o700);
  writeTokensFile({ access_token: FRESH_TOKEN(), refresh_token: REFRESH_TOKEN }, 0o600);
  seedHealthyDomain("coffee");
  writeArtefact(join(shopperDir(), "user_spec.md"), { name: "Ada" });
}

describe("AC4 — a healthy, current store is clean, quiet, and write-free", () => {
  it("returns healthy:true with NOTHING above informational", async () => {
    seedHealthyStore();
    const report = await runDoctor();
    expect(report.healthy).toBe(true);
    expect(report.counts.warn).toBe(0);
    expect(report.counts.critical).toBe(0);
    expect(report.findings.filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("performs NO writes — the tree is byte- and mode-identical afterwards", async () => {
    seedHealthyStore();
    const before = snapshot(dataDir);
    await runDoctor();
    // Also proves the data-dir writability probe cleaned up its own tmp file:
    // a leaked tmp would appear here (and would be a fs.stale_tmp finding next
    // run — the doctor manufacturing its own disease).
    expect(snapshot(dataDir)).toEqual(before);
  });

  it("applies no fix on a healthy store (appliedAction is null throughout)", async () => {
    seedHealthyStore();
    const report = await runDoctor();
    expect(report.findings.filter((f) => f.appliedAction !== null)).toEqual([]);
    expect(report.findings.filter((f) => f.status === "fixed")).toEqual([]);
  });

  it("stays healthy across ALL THREE probe outcomes — up-to-date, newer, and probe-failed", async () => {
    // An available update is not a degradation, and a failed probe is not a
    // fault of the store. If either flipped `healthy`, every install goes
    // permanently yellow the moment we publish (or go offline).
    seedHealthyStore();

    probeUpToDate();
    expect((await runDoctor()).healthy).toBe(true);

    probeReturns("99.0.0"); // newer available
    const behind = await runDoctor();
    expect(behind.healthy).toBe(true);
    expect(versionFindings(behind)).toHaveLength(1); // the advisory IS there…
    expect(behind.counts.warn).toBe(0); // …and it is not a warning

    installFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await runDoctor()).healthy).toBe(true);
  });

  it("emits no secrets on the healthy path either", async () => {
    seedHealthyStore();
    const report = await runDoctor();
    expectNoSecrets(report);
  });

  it("sorts findings deterministically (severity desc, then id asc)", async () => {
    // The consumer-visible half of AC7b, on the REAL execute() output: a
    // dashboard renders stably and a run-to-run diff is meaningful.
    seedCorruptDomain("zzz-broken");
    seedCorruptDomain("aaa-broken");
    const report = await runDoctor();
    const rank = { critical: 0, warn: 1, info: 2 } as const;
    for (let i = 1; i < report.findings.length; i++) {
      const prev = report.findings[i - 1]!;
      const cur = report.findings[i]!;
      const bySeverity = rank[prev.severity] - rank[cur.severity];
      if (bySeverity !== 0) expect(bySeverity).toBeLessThan(0);
      else expect(prev.id <= cur.id).toBe(true);
    }
  });

  it("two consecutive runs of a healthy store produce an IDENTICAL report", async () => {
    // Determinism end-to-end: same store, same answer. A run-to-run diff that
    // is noisy by construction is worthless to the consumer.
    seedHealthyStore();
    const first = await runDoctor();
    const second = await runDoctor();
    expect(second).toEqual(first);
  });
});

// ===========================================================================
// AC6 / AC6a / AC6b / AC6c — the plugin-version datum.
// ===========================================================================

describe("AC6 — the installed version is UNCONDITIONAL report context", () => {
  it("reports the shipped package.json#version on a healthy run", async () => {
    seedHealthyStore();
    const report = await runDoctor();
    expect(report.installedVersion).toBe(INSTALLED);
    expect(report.installedVersion.length).toBeGreaterThan(0);
  });

  it("reports it as a top-level field, NOT as a finding", async () => {
    seedHealthyStore();
    const report = await runDoctor();
    // It is the same KIND of datum as dataDir: which install am I diagnosing,
    // not what is wrong with it.
    expect(report.installedVersion).toBe(INSTALLED);
    expect(versionFindings(report)).toEqual([]);
  });

  it("reports it even when the probe FAILS (it is local and was never in doubt)", async () => {
    installFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const report = await runDoctor();
    expect(report.installedVersion).toBe(INSTALLED);
  });

  it("reports it even when the network is entirely absent (no fetch at all)", async () => {
    installFetch(async () => {
      throw new Error("ENOTFOUND clawhub.ai");
    });
    const report = await runDoctor();
    expect(report.installedVersion).toBe(INSTALLED);
  });

  it("reports it on a BROKEN store too — the first datum of any bug report", async () => {
    seedCorruptDomain("broken");
    chmodSync(dataDir, 0o700);
    const report = await runDoctor();
    expect(report.installedVersion).toBe(INSTALLED);
  });
});

describe("AC6a — a newer published version → exactly one info advisory that never acts", () => {
  it("emits exactly ONE version.plugin_behind finding on the six-field schema", async () => {
    probeReturns("99.0.0");
    const report = await runDoctor();
    const version = versionFindings(report);
    expect(version).toHaveLength(1);
    expect(version[0]!.id).toBe("version.plugin_behind");
    expect(Object.keys(version[0]!).sort()).toEqual([
      "appliedAction",
      "detected",
      "id",
      "severity",
      "status",
      "suggestedAction",
    ]);
  });

  it("is info + advisory + appliedAction null, and `healthy` stays true", async () => {
    probeReturns("99.0.0");
    const report = await runDoctor();
    const version = versionFindings(report)[0]!;
    expect(version.severity).toBe("info");
    expect(version.status).toBe("advisory");
    expect(version.appliedAction).toBeNull();
    expect(report.healthy).toBe(true);
  });

  it("`detected` names BOTH the installed and the latest version", async () => {
    probeReturns("99.0.0");
    const version = versionFindings(await runDoctor())[0]!;
    expect(version.detected).toContain(INSTALLED);
    expect(version.detected).toContain("99.0.0");
  });

  it("`suggestedAction` points at OpenClaw's own update path", async () => {
    probeReturns("99.0.0");
    const version = versionFindings(await runDoctor())[0]!;
    expect(version.suggestedAction).not.toBeNull();
    expect(version.suggestedAction!.toLowerCase()).toContain("openclaw");
  });

  it("installs NOTHING and writes NOTHING while advising", async () => {
    seedHealthyStore();
    probeReturns("99.0.0");
    const before = snapshot(dataDir);
    const report = await runDoctor();
    expect(versionFindings(report)).toHaveLength(1);
    // The doctor cannot hot-swap its own running code and must not try: no
    // install, no host-config write, no process spawn, no prompt.
    expect(snapshot(dataDir)).toEqual(before);
    expect(report.findings.filter((f) => f.appliedAction !== null)).toEqual([]);
  });

  it("reads the latest from `tags.latest` when `latestVersion` is absent (the CLI's own fallback)", async () => {
    // ClawHub's CLI resolves `package.latestVersion ?? tags.latest`; a body that
    // only carries the tag is a real shape, not a hypothetical.
    installFetch(async () =>
      jsonResponse({
        package: {
          name: "@4gpts/sil",
          displayName: "sil",
          family: "code-plugin",
          channel: "stable",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 2,
          tags: { latest: "99.0.0" },
        },
        owner: { handle: "4gpts" },
      }),
    );
    const report = await runDoctor();
    expect(versionFindings(report)).toHaveLength(1);
    expect(versionFindings(report)[0]!.detected).toContain("99.0.0");
  });
});

describe("AC6b — no finding when there is no drift, and none fabricated", () => {
  it("emits NO version.* finding when the installed version is up to date", async () => {
    probeUpToDate();
    const report = await runDoctor();
    // Asserted as an explicit ABSENCE, not inferred from a green run.
    expect(versionFindings(report)).toEqual([]);
  });

  it("emits NO version.* finding for a DEV build (installed newer than published)", async () => {
    // The maintainer's everyday state. An advisory here would advise a
    // DOWNGRADE — actively wrong.
    probeReturns("0.0.1");
    const report = await runDoctor();
    expect(versionFindings(report)).toEqual([]);
  });

  it("never advises a downgrade in ANY field", async () => {
    probeReturns("0.0.1");
    const report = await runDoctor();
    const emitted = JSON.stringify(report);
    expect(emitted).not.toContain("0.0.1");
    expect(emitted.toLowerCase()).not.toContain("downgrade");
  });

  it("emits no `inconclusive` / `unknown` version finding — silence is the healthy state", async () => {
    probeUpToDate();
    const report = await runDoctor();
    expect(versionFindings(report)).toEqual([]);
    // A finding ABOUT NOTHING is noise on every run; absence means "no update
    // indicated", which is honest either way.
    expect(JSON.stringify(report).toLowerCase()).not.toContain("inconclusive");
  });
});

describe("AC6c — the probe is bounded, fail-soft, and SILENT on failure", () => {
  const failures: Array<[string, () => void]> = [
    [
      "a network throw",
      () =>
        installFetch(async () => {
          throw new TypeError("fetch failed");
        }),
    ],
    ["a 404", () => installFetch(async () => jsonResponse({ package: null }, 404))],
    ["a 500", () => installFetch(async () => jsonResponse({ error: "boom" }, 500))],
    [
      "an unparseable body",
      () =>
        installFetch(
          async () => new Response("<html>not json</html>", { status: 200 }),
        ),
    ],
    [
      "a 200 with a null package",
      () => installFetch(async () => jsonResponse({ package: null, owner: null })),
    ],
    [
      "a 200 with no version anywhere",
      () =>
        installFetch(async () =>
          jsonResponse({
            package: { name: "@4gpts/sil", tags: {} },
            owner: null,
          }),
        ),
    ],
    [
      "an absurd version string",
      () => installFetch(async () => jsonResponse(clawhubBody("not-a-version"))),
    ],
  ];

  for (const [label, arrange] of failures) {
    it(`emits NO version.* finding on ${label} — never "current", never "behind"`, async () => {
      arrange();
      const report = await runDoctor();
      expect(versionFindings(report)).toEqual([]);
      // …and it is not a hard failure: the full local report still returns.
      expect(report.status).toBe("ok");
      expect(report.installedVersion).toBe(INSTALLED);
    });
  }

  it("a failed probe still lets EVERY other check report normally", async () => {
    // The identity of the tool: a doctor is needed MOST when things are broken,
    // and "broken" often includes the network.
    seedCorruptDomain("broken");
    writeTokensFile({ access_token: EXPIRED_TOKEN(), refresh_token: REFRESH_TOKEN }, 0o600);
    installFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const report = await runDoctor();

    expect(findingsWithPrefix(report, "store.unreadable")).toHaveLength(1);
    expect(report.findings.some((f) => f.id === "identity.token_expiry")).toBe(true);
    expect(versionFindings(report)).toEqual([]);
    expect(report.installedVersion).toBe(INSTALLED);
  });

  it("never throws when the probe rejects", async () => {
    installFetch(async () => {
      throw new Error("total network failure");
    });
    await expect(runDoctor()).resolves.toBeDefined();
  });

  it("is BOUNDED: a STALLING channel is aborted and the report still returns", async () => {
    // The top new risk, and the one an erroring fake cannot catch: a fetch with
    // no timeout hangs the doctor forever against a blackholed host. The fake
    // NEVER resolves on its own — the ONLY way this test passes is if the
    // implementation aborts it. (A `fetch` with no AbortSignal fails here by
    // timing out the test, which is the correct, loud outcome.)
    let sawSignal: AbortSignal | undefined;
    installFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          sawSignal = init?.signal ?? undefined;
          if (!sawSignal) return; // no signal ⇒ hangs ⇒ test times out (correctly)
          sawSignal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );

    const started = Date.now();
    const report = await runDoctor();
    const elapsed = Date.now() - started;

    // The probe carried a real AbortSignal, and it really fired.
    expect(sawSignal).toBeDefined();
    expect(sawSignal!.aborted).toBe(true);
    // Bounded well inside the suite's 10s timeout — a user-invoked diagnostic
    // must not sit on a blackholed socket.
    expect(elapsed).toBeLessThan(8_000);
    // Fail-soft to SILENCE, with the full local report intact.
    expect(versionFindings(report)).toEqual([]);
    expect(report.status).toBe("ok");
    expect(report.installedVersion).toBe(INSTALLED);
  });

  it("a stalling channel does not block the local diagnosis either", async () => {
    seedCorruptDomain("broken");
    installFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const report = await runDoctor();
    expect(findingsWithPrefix(report, "store.unreadable")).toHaveLength(1);
  });
});

// ===========================================================================
// The probe's declared, minimal, unauthenticated outbound surface.
// ===========================================================================

describe("the ClawHub probe — one declared host, no credentials, nothing else", () => {
  it("makes exactly ONE outbound request per run", async () => {
    seedHealthyStore();
    await runDoctor();
    expect(requests).toHaveLength(1);
  });

  it("targets a host DECLARED in openclaw.plugin.json#security.networkEndpoints", async () => {
    await runDoctor();
    const declared = declaredEndpoints();
    const origin = new URL(requests[0]!.url).origin;
    // Derived from the manifest, so the test cannot drift from the security
    // declaration a reviewer audits. An undeclared outbound host is a contract
    // violation, not a detail.
    expect(declared.map((e) => new URL(e).origin)).toContain(origin);
  });

  it("the manifest declares the ClawHub endpoint — the founder-accepted third host", async () => {
    const declared = declaredEndpoints();
    // Two (sil-api, sil-web) become three. A deliberate, declared security-
    // surface change: it must not land silently, and it must not grow further.
    expect(declared).toHaveLength(3);
    expect(declared.some((e) => e.includes("clawhub"))).toBe(true);
  });

  it("is a bare GET — no Authorization header, no cookie, no credentials", async () => {
    await runDoctor();
    const { init } = requests[0]!;
    const method = (init?.method ?? "GET").toUpperCase();
    expect(method).toBe("GET");
    const headers = new Headers(init?.headers ?? {});
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
  });

  it("carries NO token, NO PII, and NO store contents on the wire", async () => {
    const accessToken = FRESH_TOKEN();
    writeTokensFile({ access_token: accessToken, refresh_token: REFRESH_TOKEN }, 0o600);
    writeArtefact(join(shopperDir(), "user_spec.md"), { name: "Ada" });

    await runDoctor();

    const onTheWire = JSON.stringify(requests);
    expect(onTheWire).not.toContain(accessToken);
    expect(onTheWire).not.toContain(REFRESH_TOKEN);
    expect(onTheWire).not.toContain(DECOY_CLAIM);
    expect(onTheWire).not.toContain("Ada");
    // A bare public GET for a version string carries no body at all.
    expect(requests[0]!.init?.body ?? null).toBeNull();
  });

  it("does not follow a redirect off the declared host", async () => {
    // A probe that chases a 302 to an arbitrary origin silently widens the
    // declared outbound surface.
    await runDoctor();
    const redirect = requests[0]!.init?.redirect;
    expect(redirect === undefined || redirect === "error" || redirect === "manual").toBe(
      true,
    );
  });

  it("names the package by its ClawHub identity (@4gpts/sil), not the npm name", async () => {
    // The bare id `sil` is unclaimable (already owned); we publish to ClawHub as
    // @4gpts/sil. Probing `sil-openclaw` (the npm name) would read a DIFFERENT
    // package's version — a wrong answer that still looks green.
    await runDoctor();
    const url = decodeURIComponent(requests[0]!.url);
    expect(url).toContain("@4gpts/sil");
  });
});
