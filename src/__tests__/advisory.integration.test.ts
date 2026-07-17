/**
 * INTEGRATION — the host-wiring + gateway-compat advisories on all three real
 * surfaces (tier: integration; the real `register()`, the real tool `execute()`s,
 * the real `sil_doctor`, a real temp `$SIL_DATA_DIR`).
 *
 * Card: self-upgrade-detect-host-wiring-advisory — **AC2, AC3, AC6, AC7, AC11–AC14**.
 *
 * **Drift is driven by handing the mock api a crafted `config` tree** — that IS the
 * production seam. `api.config` is the FULL OpenClawConfig the host hands the plugin
 * at load (`src/types/openclaw.d.ts:26-35`), so a config literal here is the same
 * datum production reads. Nothing about the wiring path is stubbed: the detector,
 * the fold, the doctor rows, and the register warn are all real.
 *
 * **The only thing mocked is `fetch`** — and only because `sil_doctor`'s OWN
 * ClawHub probe (sil-doctor's `version.plugin_behind`) would otherwise hit the live
 * network. This card issues **zero** outbound requests of its own; several tests
 * below assert exactly that.
 *
 * **Why three surfaces, and why they are not interchangeable** (the reachability
 * matrix — this is load-bearing spec, not trivia):
 *
 *   | drift state                        | loads? | sil_* callable? | only live surface |
 *   |------------------------------------|--------|-----------------|-------------------|
 *   | skill attached by id `sil`         | yes    | YES             | tool fold + doctor|
 *   | `tools.alsoAllow` omits `sil`      | yes    | no              | register-time log |
 *   | non-empty `plugins.allow` omits it | NO     | no              | none — unreportable|
 *
 * A mis-wired skill is not running its own flow, so it cannot carry its own warning
 * — the tools are the only surviving messenger. And `sil_doctor` is itself a sil
 * tool, so the drift that filters sil's tools filters the doctor too: that state's
 * ONLY carrier is the register-time `logger.warn` (AC13).
 *
 * **The four catches an end-to-end assertion misses**, each pinned explicitly below:
 *   - **AC12** — `api.config` is the host's LIVE tree. Every surface is asserted
 *     deep-equal before/after AND driven once against a DEEPLY FROZEN config, and
 *     `mergeSilAllowlist` is spied to prove it is never reached for (it mutates its
 *     argument in place by design — `openclaw-allowlist.ts:100-104, :174, :193, :202`).
 *   - **AC6** — the happy path has NO `advisories` key at all; the drifted payload
 *     MINUS `advisories` is deep-equal to the healthy payload. Present-only-on-drift
 *     is what keeps today's payloads byte-identical.
 *   - **AC14** — `api.config` can hold OTHER plugins' credentials. The secret-bearing
 *     fixture plants three, in three different blocks, and every finding + every log
 *     line is scanned for all three.
 *   - **rule 10** — the HOME decoy: a HEALTHY `~/.openclaw/openclaw.json` on disk
 *     next to a DRIFTED `api.config` must still advise. We report the EFFECTIVE
 *     (running) wiring, never the INTENDED (on-disk) wiring — a file read would
 *     green-wash a fix that has not been reloaded yet.
 *
 * Contract pinned for the implementation (expert-developer):
 *   - Every `sil_*` SUCCESS payload gains `advisories: Finding[]` **iff** wiring
 *     drift exists; on a healthy host the key is ABSENT (never `[]`, never `null`).
 *     Error envelopes are NOT folded (MVP).
 *   - `sil_doctor` contributes the same `wiring.*` findings to its `findings[]`
 *     (NOT an `advisories` key) plus `version.gateway_compat`; report shape unchanged.
 *   - Compat surfaces on `sil_doctor` ONLY — never on a tool fold.
 *   - `register()` logs exactly one `sil_plugin_wiring_drift` warn on drift, and
 *     nothing on a clean config. It stays synchronous and opens nothing.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginAPI } from "openclaw/plugin-sdk";

import { registerCatalogTools } from "../tools/catalog.js";
import { registerDoctorTools } from "../tools/doctor.js";
import { registerIdentityTools } from "../tools/identity.js";
import { registerProfileTools } from "../tools/profile.js";
import { sortFindings, type Finding } from "../lib/findings.js";
import * as allowlist from "../lib/openclaw-allowlist.js";
import { setApiUrl, setWebUrl } from "../lib/config.js";
import { getTokensPath } from "../lib/credentials.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

// The real entry, captured the way index.test.ts captures it — AC13 drives the
// FULL real register(), not a hand-rolled stand-in.
let capturedRegisterFn: ((api: PluginAPI) => void) | null = null;
vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: vi.fn((entry: { register: (api: PluginAPI) => void }) => {
    capturedRegisterFn = entry.register;
    return entry;
  }),
}));

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------------------------------------------------------------------
// Facts + fixtures, DERIVED from the shipped manifest / package.json. A literal
// here would let the test agree with a detector that hardcodes the same literal,
// and would rot silently the day the skill dir is renamed (incident #1's root).
// ---------------------------------------------------------------------------

const manifest = (): { id: string; skills: string[] } =>
  JSON.parse(readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"));

const packageJson = (): {
  openclaw: { compat: { minGatewayVersion: string } };
} => JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

const PLUGIN_ID = manifest().id;
/** The PUBLISHED skill name = the skill-dir basename, NOT the ref, NOT the id. */
const SKILL_NAME = basename(manifest().skills[0]!);
/** Our declared gateway floor, e.g. ">=2026.4.15" → "2026.4.15". */
const REQUIRED_HOST = packageJson().openclaw.compat.minGatewayVersion.replace(/^>=\s*/, "");

/** Below/above any plausible calendar floor, so neither tracks the shipped value. */
const HOST_TOO_OLD = "0.0.1";
const HOST_FINE = "9999.0.0";

const SKILL_MISATTACHED = "wiring.skill_misattached";
const TOOLS_NOT_ADMITTED = "wiring.tools_not_admitted";
const GATEWAY_COMPAT = "version.gateway_compat";
/** The structured marker AC13's register-time warn rides on. */
const WIRING_WARN_MARKER = "sil_plugin_wiring_drift";

type Config = Record<string, unknown>;

/**
 * The host version rides `api.runtime.version` — NOT the config tree. Probed
 * against a live `alpine/openclaw:2026.6.9` and re-verified independently by qa:
 * `config.gateway` does not exist, and `config.meta.lastTouchedVersion` is the
 * version that last WROTE the config file, not the one now running. So the wiring
 * config and the host version are two separate api surfaces here, exactly as they
 * are in production.
 */
const hostRuntime = (version?: string): Record<string, unknown> | undefined =>
  version === undefined ? undefined : { version };

/** Fully healthy: skill by published name, plugin enabled, tools admitted, and a
 * PERMISSIVE (empty) `plugins.allow` — the auto-load-everything default, which is
 * NOT drift (AC9's trap, re-pinned end-to-end here). */
const healthyConfig = (): Config => ({
  agents: { list: [{ id: "shopper", skills: [SKILL_NAME] }] },
  tools: { alsoAllow: [PLUGIN_ID] },
  plugins: { allow: [], entries: { [PLUGIN_ID]: { enabled: true, config: {} } } },
});

/** Incident #1: `skills: ["sil"]` where `["sil-shopping"]` was meant. */
const misattachedConfig = (): Config => ({
  ...healthyConfig(),
  agents: { list: [{ id: "shopper", skills: [PLUGIN_ID] }] },
});

/** Half-trust: enabled, but a non-empty `tools.alsoAllow` omits us. */
const unadmittedConfig = (): Config => ({
  ...healthyConfig(),
  tools: { alsoAllow: ["klodi"] },
});

/** Every WIRING drift at once — the AC7 fixture. Compat drift is driven
 * separately, via the runtime host version. */
const allDriftConfig = (): Config => ({
  agents: { list: [{ id: "shopper", skills: [PLUGIN_ID] }] },
  tools: { alsoAllow: ["klodi"] },
  plugins: { allow: [], entries: { [PLUGIN_ID]: { enabled: true, config: {} } } },
});

// The three planted secrets, in the three places `api.config` really carries them.
const PLUGIN_SECRET = "sk-live-klodi-PLUGIN-SECRET-NEVER-SURFACE";
const GATEWAY_SECRET = "gateway-bearer-SECRET-NEVER-SURFACE";
const AGENT_SECRET = "agent-env-OPENAI-SECRET-NEVER-SURFACE";
const ALL_SECRETS = [PLUGIN_SECRET, GATEWAY_SECRET, AGENT_SECRET];

/** Maximum drift AND maximum adjacent secrecy. Every drift fires, so every code
 * path that builds a string runs — while three other tenants' credentials sit one
 * key away from the facts we DO emit. */
const secretBearingConfig = (): Config => ({
  agents: {
    list: [
      { id: "shopper", skills: [PLUGIN_ID], env: { OPENAI_API_KEY: AGENT_SECRET } },
    ],
  },
  tools: { alsoAllow: ["klodi"] },
  plugins: {
    allow: [],
    entries: {
      [PLUGIN_ID]: { enabled: true, config: {} },
      klodi: { enabled: true, config: { apiKey: PLUGIN_SECRET } },
    },
  },
  gateway: { auth: { token: GATEWAY_SECRET } },
  meta: { lastTouchedVersion: "9999.0.0" },
});

// ---------------------------------------------------------------------------
// The fetch double. `sil_doctor`'s ClawHub probe is the ONLY thing that would go
// out; this card adds nothing. Every test stubs it — a live call in CI is a hard
// failure, not a flake.
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The probe answers, and reports us current (so sil-doctor's own version finding
 * stays silent and cannot be confused with THIS card's compat finding). */
function probeUpToDate(): void {
  const installed = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
  fetchSpy.mockImplementation(async () =>
    jsonResponse({ package: { name: "@4gpts/sil", latestVersion: installed, tags: { latest: installed } } }),
  );
}

/** The network is DOWN. AC2: the local checks are the floor and always run. */
function probeUnreachable(): void {
  fetchSpy.mockRejectedValue(new Error("ENETDOWN — the network is down"));
}

/** sil-api answers a real, EMPTY catalog search — a success, not an error. */
function catalogEmptyOk(): void {
  fetchSpy.mockImplementation(async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/catalog/search")) return jsonResponse({ products: [] });
    return jsonResponse({ package: { name: "@4gpts/sil", latestVersion: null, tags: {} } });
  });
}

// ---------------------------------------------------------------------------
// Data dir + HOME. HOME is redirected so the rule-10 decoy below is hermetic and
// so nothing can touch the developer's real ~/.openclaw.
// ---------------------------------------------------------------------------

let parentDir: string;
let dataDir: string;
let homeDir: string;
let priorEnv: Record<string, string | undefined> = {};

function writeTokensFile(): void {
  const path = getTokensPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ access_token: "at", refresh_token: "rt" }), { mode: 0o600 });
}

/** relpath → mode + content hash. Proves an absence of writes (bytes AND modes). */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const st = lstatSync(full);
      if (entry.isDirectory()) {
        out[relative(root, full)] = `dir:${st.mode & 0o777}`;
        walk(full);
      } else {
        out[relative(root, full)] =
          `file:${st.mode & 0o777}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`;
      }
    }
  };
  walk(root);
  return out;
}

beforeAll(async () => {
  await import("../index.js");
});

beforeEach(() => {
  parentDir = mkdtempSync(join(tmpdir(), "sil-advisory-test-"));
  dataDir = join(parentDir, "data");
  homeDir = join(parentDir, "home");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  for (const key of ["SIL_DATA_DIR", "XDG_DATA_HOME", "HOME", "SIL_WEB_URL", "SIL_API_URL"]) {
    priorEnv[key] = process.env[key];
  }
  process.env["SIL_DATA_DIR"] = dataDir;
  process.env["HOME"] = homeDir;
  delete process.env["XDG_DATA_HOME"];
  setWebUrl("https://sil-web.test.example.com");
  setApiUrl("https://sil-api.test.example.com");
  fetchSpy = vi.spyOn(globalThis, "fetch");
  probeUpToDate();
});

afterEach(() => {
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  priorEnv = {};
  setWebUrl("");
  setApiUrl("");
  vi.restoreAllMocks();
  rmSync(parentDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Running the real surfaces.
// ---------------------------------------------------------------------------

interface DoctorReport {
  status: string;
  healthy: boolean;
  dataDir: string;
  installedVersion: string;
  counts: { info: number; warn: number; critical: number };
  findings: Finding[];
}

type Payload = Record<string, unknown> & { advisories?: Finding[] };

/** Every registered group, on ONE api — the way `register()` wires them, so a fold
 * that only reaches one group is caught. */
function registerAll(api: PluginAPI): void {
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerProfileTools(api);
  registerDoctorTools(api);
}

let lastApi: MockPluginAPI;

/** `hostVersion` omitted ⇒ the api carries NO runtime, which is the honest
 * default: the compat check is inconclusive and emits nothing. */
async function runTool(
  name: string,
  params: Record<string, unknown>,
  config: Config,
  hostVersion?: string,
): Promise<Payload> {
  const api = createMockPluginApi({ config, runtime: hostRuntime(hostVersion) });
  lastApi = api;
  registerAll(api);
  const result = await getTool(api, name).execute("call-1", params);
  expect(result.content).toHaveLength(1);
  return JSON.parse(result.content[0]?.text as string) as Payload;
}

async function runDoctor(config: Config, hostVersion?: string): Promise<DoctorReport> {
  return (await runTool("sil_doctor", {}, config, hostVersion)) as unknown as DoctorReport;
}

/**
 * The four real `sil_*` success paths this file drives — one per tool group, so
 * "EVERY `sil_*` result" (AC3) is proven across the whole surface rather than on
 * one convenient tool. Each is a genuine success against real state: no stub
 * asserts a stubbed response here.
 */
const SUCCESS_PATHS: Array<{
  tool: string;
  params: Record<string, unknown>;
  /** Real state the success needs, beyond a temp data dir. */
  setup?: () => void;
}> = [
  // profile — an empty store is `status: ok`, zero network.
  { tool: "sil_profile_search", params: {} },
  // identity — `already_registered` short-circuits on stored tokens, zero network.
  { tool: "sil_register", params: {}, setup: writeTokensFile },
  // catalog — an empty match IS a success (`status: ok, products: []`).
  { tool: "sil_search", params: { query: "chair" }, setup: () => { writeTokensFile(); catalogEmptyOk(); } },
];

const advisoryIds = (payload: Payload): string[] => (payload.advisories ?? []).map((a) => a.id).sort();
const findingIds = (report: DoctorReport): string[] => report.findings.map((f) => f.id);
const wiringFindings = (report: DoctorReport): Finding[] =>
  report.findings.filter((f) => f.id.startsWith("wiring."));

/** Every string a run emitted: the payload AND every logger call. A leak hides in
 * a log line just as easily as in a field. */
function emittedStrings(payload: unknown): string {
  const logs = (["info", "warn", "error", "debug"] as const)
    .flatMap((level) => vi.mocked(lastApi.logger[level]).mock.calls)
    .map((call) => JSON.stringify(call))
    .join("\n");
  return JSON.stringify(payload) + "\n" + logs;
}

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// ===========================================================================
// AC3 — skill wired by id → advisory on EVERY sil_* result AND on sil_doctor
// ===========================================================================

describe("AC3 — skill attached by id: the tools are the only surviving messenger", () => {
  for (const { tool, params, setup } of SUCCESS_PATHS) {
    it(`${tool} folds the wiring advisory into its SUCCESS result`, async () => {
      setup?.();
      const payload = await runTool(tool, params, misattachedConfig());

      expect(payload["status"]).toBe(tool === "sil_register" ? "already_registered" : "ok");
      expect(advisoryIds(payload)).toEqual([SKILL_MISATTACHED]);
    });

    it(`${tool}'s advisory is warn + advisory + appliedAction null, with the exact fix`, async () => {
      setup?.();
      const payload = await runTool(tool, params, misattachedConfig());
      const advisory = payload.advisories![0]!;

      expect(advisory.severity).toBe("warn");
      expect(advisory.status).toBe("advisory");
      expect(advisory.appliedAction).toBeNull();
      // The exact one-line fix: replace the id with the published name, in THAT
      // agent's skills — plus how it takes effect (rule 3 + rule 10).
      expect(advisory.suggestedAction).toContain(SKILL_NAME);
      expect(advisory.suggestedAction).toContain(PLUGIN_ID);
      expect(advisory.suggestedAction).toContain("shopper");
      expect(advisory.suggestedAction!.toLowerCase()).toContain("reload");
    });

    it(`${tool}'s OWN payload is unchanged and complete — the advisory is additive only`, async () => {
      // Rule 7: a result carrying an advisory is still, byte-for-byte, the same
      // result. The advisory is a sibling block — never a wrapper, never a re-rank,
      // never a substitute for data the caller asked for.
      setup?.();
      const healthy = await runTool(tool, params, healthyConfig());
      setup?.();
      const drifted = await runTool(tool, params, misattachedConfig());

      const { advisories, ...rest } = drifted;
      expect(advisories).toBeDefined();
      expect(rest).toEqual(healthy);
    });
  }

  it("sil_doctor reports the SAME finding, with the same id — byte-identical across surfaces", async () => {
    // AC3: "the finding is byte-identical whichever surface carries it". Both read
    // the EFFECTIVE wiring from the same `api.config`, so anything else would mean
    // two detectors — i.e. two things to drift apart.
    const payload = await runTool("sil_profile_search", {}, misattachedConfig());
    const report = await runDoctor(misattachedConfig());

    const fromTool = payload.advisories!.find((a) => a.id === SKILL_MISATTACHED);
    const fromDoctor = report.findings.find((f) => f.id === SKILL_MISATTACHED);
    expect(fromDoctor).toBeDefined();
    expect(fromDoctor).toEqual(fromTool);
  });

  it("the doctor carries wiring findings in `findings[]` — NOT in an `advisories` key", async () => {
    // The doctor's product IS the findings array; a second parallel channel on the
    // same report would be two places to look and two places to drift.
    const report = await runDoctor(misattachedConfig());
    expect(findingIds(report)).toContain(SKILL_MISATTACHED);
    expect(report).not.toHaveProperty("advisories");
  });

  it("the advisory RECURS on every call while the drift persists — recurrence is the feature", async () => {
    // OQ3: no fire-once, no cooldown, no "acknowledged" state. A persistent silent
    // misconfiguration is exactly what a fire-once advisory lets rot — and this one
    // was silent enough to cause incident #1. A cooldown here is a documented
    // regression, not a cleanup.
    const first = await runTool("sil_profile_search", {}, misattachedConfig());
    const second = await runTool("sil_profile_search", {}, misattachedConfig());
    const third = await runTool("sil_profile_search", {}, misattachedConfig());
    expect(advisoryIds(first)).toEqual([SKILL_MISATTACHED]);
    expect(advisoryIds(second)).toEqual([SKILL_MISATTACHED]);
    expect(advisoryIds(third)).toEqual([SKILL_MISATTACHED]);
  });

  it("compat NEVER rides a tool result — it is a doctor-only question (the catalogue)", async () => {
    // A gateway-compat gap answers a question nobody asked mid-`sil_search`. The
    // fold is earned by the self-carry paradox, which applies ONLY to wiring.
    const payload = await runTool("sil_profile_search", {}, allDriftConfig());
    expect(advisoryIds(payload)).not.toContain(GATEWAY_COMPAT);
    for (const advisory of payload.advisories ?? []) {
      expect(advisory.id.startsWith("wiring.")).toBe(true);
    }
  });
});

// ===========================================================================
// AC2 — gateway compat, with no network needed
// ===========================================================================

describe("AC2 — gateway compat gap → advisory, purely local", () => {
  it("a host BELOW our declared floor → a warn advisory naming required vs running", async () => {
    const report = await runDoctor(healthyConfig(), HOST_TOO_OLD);
    const compat = report.findings.find((f) => f.id === GATEWAY_COMPAT);

    expect(compat).toBeDefined();
    expect(compat!.severity).toBe("warn");
    expect(compat!.status).toBe("advisory");
    expect(compat!.appliedAction).toBeNull();
    expect(compat!.detected).toContain(REQUIRED_HOST);
    expect(compat!.detected).toContain(HOST_TOO_OLD);
    expect(compat!.suggestedAction!.toLowerCase()).toContain("openclaw");
  });

  it("STILL fires with the network DOWN — compat is not coupled to the remote channel", async () => {
    // The card's sharpest degradation rule: the local checks are the floor and
    // ALWAYS run. sil-doctor's ClawHub probe failing must not take compat (or the
    // wiring advisory) down with it — a diagnosis that fails when the network does
    // is worthless precisely when it is needed.
    probeUnreachable();
    const report = await runDoctor(allDriftConfig(), HOST_TOO_OLD);

    expect(findingIds(report)).toContain(GATEWAY_COMPAT);
    expect(findingIds(report)).toContain(SKILL_MISATTACHED);
    // ...and the remote-only finding is omitted, never fabricated (sil-doctor's AC6c).
    expect(findingIds(report)).not.toContain("version.plugin_behind");
    expect(report.status).toBe("ok");
  });

  it("a host AT or ABOVE the floor → NO compat finding", async () => {
    for (const version of [REQUIRED_HOST, HOST_FINE]) {
      const report = await runDoctor(healthyConfig(), version);
      expect(findingIds(report), version).not.toContain(GATEWAY_COMPAT);
    }
  });

  it("an UNREADABLE host version → NO compat finding (inconclusive, never fabricated)", async () => {
    // `readHostVersion` → null: the host supplied no runtime version. Not
    // hypothetical — one real load path registers plugins with `runtime: {}`.
    // Never "your host is too old" from a failed read, never a silent green dressed
    // up as a real check.
    const report = await runDoctor(healthyConfig());

    expect(findingIds(report)).not.toContain(GATEWAY_COMPAT);
    expect(report.status).toBe("ok");
  });

  it("NEVER fabricates a verdict from `meta.lastTouchedVersion` (config provenance, not the host)", async () => {
    // The trap sitting one key from the wiring we DO read: `meta.lastTouchedVersion`
    // is semver-shaped, lives on every real config, and means "which version last
    // WROTE this file". A doctor reading it would tell a user who ran a newer
    // OpenClaw once and downgraded that their host is fine.
    const report = await runDoctor({
      ...healthyConfig(),
      meta: { lastTouchedVersion: HOST_FINE, lastTouchedAt: "2026-07-17T09:59:47.329Z" },
    });
    expect(findingIds(report)).not.toContain(GATEWAY_COMPAT);
  });

  it("is NOT VACUOUS — the doctor's compat row does fire on the same code path", async () => {
    // Guards the whole describe block: a compat row wired to nothing would satisfy
    // every silence assertion above.
    const report = await runDoctor(healthyConfig(), HOST_TOO_OLD);
    expect(findingIds(report)).toContain(GATEWAY_COMPAT);
  });
});

// ===========================================================================
// AC6 — healthy → silence, on every surface
// ===========================================================================

describe("AC6 — a healthy host is SILENT everywhere (absence of a problem is not a finding)", () => {
  for (const { tool, params, setup } of SUCCESS_PATHS) {
    it(`${tool} carries NO advisories key at all — the payload is byte-identical to today's`, async () => {
      // Not `advisories: []`, not `advisories: null` — ABSENT. Present-only-on-drift
      // is what makes "the happy-path payload is unchanged" literally true.
      setup?.();
      const payload = await runTool(tool, params, healthyConfig());
      expect(payload).not.toHaveProperty("advisories");
      expect(Object.keys(payload)).not.toContain("advisories");
    });
  }

  it("sil_doctor reports no wiring and no compat finding on a healthy host", async () => {
    const report = await runDoctor(healthyConfig());
    expect(wiringFindings(report)).toEqual([]);
    expect(findingIds(report)).not.toContain(GATEWAY_COMPAT);
  });

  it("nothing this card contributes is above `info` on a healthy host", async () => {
    const report = await runDoctor(healthyConfig());
    const ours = report.findings.filter(
      (f) => f.id.startsWith("wiring.") || f.id === GATEWAY_COMPAT,
    );
    expect(ours).toEqual([]);
  });

  it("register() logs NO warning on a clean config", async () => {
    const api = createMockPluginApi({ config: healthyConfig() });
    lastApi = api;
    capturedRegisterFn!(api);
    expect(api.logger.warn).not.toHaveBeenCalled();
  });

  it("AC9 end-to-end — an EMPTY `plugins.allow` is permissive, and stays silent", async () => {
    // The auto-load-everything default: sil IS allowed. Flagging it would fire a
    // false advisory on a correctly-working default install — on every sil_* result,
    // forever. This is the easiest false positive in the card to ship.
    const payload = await runTool("sil_profile_search", {}, healthyConfig());
    const report = await runDoctor(healthyConfig());
    expect(payload).not.toHaveProperty("advisories");
    expect(wiringFindings(report)).toEqual([]);
  });

  it("AC9 end-to-end — an ABSENT `plugins` block is likewise permissive, and stays silent", async () => {
    const config: Config = {
      agents: { list: [{ id: "shopper", skills: [SKILL_NAME] }] },
      tools: { alsoAllow: [PLUGIN_ID] },
      gateway: { version: HOST_FINE },
    };
    const payload = await runTool("sil_profile_search", {}, config);
    expect(payload).not.toHaveProperty("advisories");
    expect(wiringFindings(await runDoctor(config))).toEqual([]);
  });

  it("the silence holds REGARDLESS of plugin-version drift (that family is sil-doctor's)", async () => {
    // Architect 2026-07-17: this card's silence must not depend on the version datum
    // that moved to sil-doctor. A `version.plugin_behind` info riding alongside is
    // NOT a violation of this AC.
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ package: { name: "@4gpts/sil", latestVersion: "9999.0.0", tags: { latest: "9999.0.0" } } }),
    );
    const report = await runDoctor(healthyConfig());

    expect(findingIds(report)).toContain("version.plugin_behind");
    expect(wiringFindings(report)).toEqual([]);
    expect(findingIds(report)).not.toContain(GATEWAY_COMPAT);
  });

  it("is NOT VACUOUS — the same surfaces DO speak when the host is drifted", async () => {
    // Without this, an implementation that folds nothing anywhere passes every
    // silence assertion in this block.
    const payload = await runTool("sil_profile_search", {}, allDriftConfig());
    const report = await runDoctor(allDriftConfig());
    expect(payload.advisories!.length).toBeGreaterThan(0);
    expect(wiringFindings(report).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC13 — the register-time warn: the tools-filtered state's ONLY carrier
// ===========================================================================

describe("AC13 — register() is the only live surface when sil's tools are filtered", () => {
  it("logs EXACTLY ONE structured wiring warning on a drifted config", async () => {
    const api = createMockPluginApi({ config: unadmittedConfig() });
    lastApi = api;
    capturedRegisterFn!(api);

    const warns = vi.mocked(api.logger.warn).mock.calls;
    expect(warns).toHaveLength(1);
    expect(warns[0]![0]).toBe(WIRING_WARN_MARKER);
  });

  it("the warn carries the SAME wiring finding — id, fix, and the bin (AC4's audience)", async () => {
    // In this state NO agent-facing surface exists — `sil_doctor` is a sil tool, so
    // the drift that filters sil's tools filters the doctor too. The operator
    // reading gateway logs (because their sil tools do nothing) is the only reader
    // left, and they must get the same six fields and the same exact one-line fix.
    const api = createMockPluginApi({ config: unadmittedConfig() });
    lastApi = api;
    capturedRegisterFn!(api);

    const emitted = JSON.stringify(vi.mocked(api.logger.warn).mock.calls[0]);
    expect(emitted).toContain(TOOLS_NOT_ADMITTED);
    expect(emitted).toContain("sil-openclaw-allowlist");
    expect(emitted.toLowerCase()).not.toContain("config set");
  });

  it("still logs exactly ONE warning when SEVERAL drifts are present", async () => {
    const api = createMockPluginApi({ config: allDriftConfig() });
    lastApi = api;
    capturedRegisterFn!(api);

    const warns = vi.mocked(api.logger.warn).mock.calls;
    expect(warns).toHaveLength(1);
    expect(warns[0]![0]).toBe(WIRING_WARN_MARKER);
    const emitted = JSON.stringify(warns[0]);
    expect(emitted).toContain(TOOLS_NOT_ADMITTED);
    expect(emitted).toContain(SKILL_MISATTACHED);
  });

  it("completes SYNCHRONOUSLY and opens NOTHING — no timer, no socket (the install-hang guard)", () => {
    // The register() invariant: an open handle holds the host's install subprocess
    // event loop open and blocks `&& exec openclaw gateway`. A config read + a
    // logger.warn opens neither — but only if it stays that way.
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const immediateSpy = vi.spyOn(
      globalThis as unknown as { setImmediate: (...a: unknown[]) => unknown },
      "setImmediate",
    );
    try {
      const api = createMockPluginApi({ config: allDriftConfig() });
      lastApi = api;
      const returned = capturedRegisterFn!(api);

      expect(returned).toBeUndefined();
      expect(timeoutSpy).not.toHaveBeenCalled();
      expect(intervalSpy).not.toHaveBeenCalled();
      expect(immediateSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      timeoutSpy.mockRestore();
      intervalSpy.mockRestore();
      immediateSpy.mockRestore();
    }
  });

  it("still registers the full tool set and still logs `sil_plugin_loaded` on a drifted config", async () => {
    // The advisory is additive at register time too: a drifted host is a WARNING,
    // never a refusal to load. Breaking load here would turn a fixable wiring typo
    // into a dead plugin.
    const api = createMockPluginApi({ config: allDriftConfig() });
    lastApi = api;
    capturedRegisterFn!(api);

    const declared: string[] = JSON.parse(
      readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"),
    ).contracts.tools;
    expect([...api._tools.keys()].sort()).toEqual([...declared].sort());
    expect(api.logger.info).toHaveBeenCalledWith("sil_plugin_loaded", expect.anything());
  });

  it("never throws on a corrupt host config — a bad config must not wedge gateway startup", () => {
    // register() throwing is fail-closed for an unusable DATA DIR (that is correct).
    // An operator typo in an unrelated config block is NOT that: the host rejects a
    // plugin whose register() throws, so a throw here turns a wiring advisory into
    // an outage — the exact inversion of a detect-and-surface card.
    for (const config of [
      {},
      { agents: "nope" },
      { agents: { list: "nope" } },
      { agents: { list: [null] } },
      { plugins: { entries: "nope" } },
      { tools: { alsoAllow: "sil" } },
    ] as Config[]) {
      const api = createMockPluginApi({ config });
      expect(() => capturedRegisterFn!(api), JSON.stringify(config)).not.toThrow();
    }
  });
});

// ===========================================================================
// AC12 — the host's LIVE config object is never mutated in memory
// ===========================================================================

describe("AC12 — `api.config` is the host's live tree, and we never write to it", () => {
  it("is deep-equal before and after EVERY surface (doctor, tool fold, register)", async () => {
    const config = allDriftConfig();
    const before = structuredClone(config);

    const api = createMockPluginApi({ config });
    lastApi = api;
    capturedRegisterFn!(api);
    expect(config).toEqual(before);

    registerAll(api);
    await getTool(api, "sil_profile_search").execute("call-1", {});
    expect(config).toEqual(before);

    await getTool(api, "sil_doctor").execute("call-2", {});
    expect(config).toEqual(before);
  });

  it("survives a DEEPLY FROZEN config on every surface — an in-place edit would throw", async () => {
    // The structural counterpart to deep-equal: ESM is strict, so a write to a frozen
    // object throws rather than silently no-op'ing. This is what would catch
    // `mergeSilAllowlist` being reached for — its very first act on a config missing
    // `plugins`/`tools` is to CREATE them (`openclaw-allowlist.ts:127`, `:136`).
    const config = deepFreeze(allDriftConfig());
    const api = createMockPluginApi({ config });
    lastApi = api;

    expect(() => capturedRegisterFn!(api)).not.toThrow();
    registerAll(api);
    await expect(getTool(api, "sil_profile_search").execute("call-1", {})).resolves.toBeDefined();
    await expect(getTool(api, "sil_doctor").execute("call-2", {})).resolves.toBeDefined();
  });

  it("`mergeSilAllowlist` is NEVER invoked from any detection path", async () => {
    // The card's sharpest trap. The merge core shares SURFACE KNOWLEDGE with the
    // detector, not an operation: it is a mutation planner that edits its argument
    // in place by design. Reusing it for a read would silently corrupt the host's
    // live state from a detect-only path — and would look like a tidy DRY win in
    // review. A read-only sibling inspector is the correct shape.
    const spy = vi.spyOn(allowlist, "mergeSilAllowlist");
    const config = allDriftConfig();

    const api = createMockPluginApi({ config });
    lastApi = api;
    capturedRegisterFn!(api);
    registerAll(api);
    await getTool(api, "sil_profile_search").execute("call-1", {});
    await getTool(api, "sil_doctor").execute("call-2", {});

    expect(spy).not.toHaveBeenCalled();
  });

  it("repeated detection is idempotent — the config never drifts across runs", async () => {
    const config = allDriftConfig();
    const before = structuredClone(config);
    for (let i = 0; i < 3; i += 1) {
      await runTool("sil_profile_search", {}, config);
      await runDoctor(config);
    }
    expect(config).toEqual(before);
  });
});

// ===========================================================================
// AC7 — the detect-only posture + the audit scope
// ===========================================================================

describe("AC7 — detect and surface only: nothing is applied, nothing outside the scope is touched", () => {
  it("EVERY finding this card emits carries `appliedAction: null` (nothing is ever fixed)", async () => {
    // There is no safe-auto-fix posture available to this card by construction: we
    // cannot write host config, so `fixed` / `fix_failed` / `needs_confirmation` are
    // unreachable. An advisory that says "fixed" is a lie about a mutation that
    // never happened — the honesty rail.
    const report = await runDoctor(allDriftConfig(), HOST_TOO_OLD);
    const ours = report.findings.filter(
      (f) => f.id.startsWith("wiring.") || f.id === GATEWAY_COMPAT,
    );
    // Both families present: wiring AND compat.
    expect(ours.map((f) => f.id)).toContain(GATEWAY_COMPAT);
    expect(ours.length).toBeGreaterThan(1);
    for (const finding of ours) {
      expect(finding.appliedAction).toBeNull();
      expect(finding.status).toBe("advisory");
    }

    const payload = await runTool("sil_profile_search", {}, allDriftConfig());
    for (const advisory of payload.advisories!) {
      expect(advisory.appliedAction).toBeNull();
      expect(advisory.status).toBe("advisory");
    }
  });

  it("rule 10 — reports the EFFECTIVE (running) wiring, NOT a healthy file on disk", async () => {
    // The decoy: `~/.openclaw/openclaw.json` says the wiring is perfect; `api.config`
    // — the tree in force in the RUNNING process — says it is mis-wired. A file read
    // would green-wash a fix that has not been reloaded yet, which is the exact
    // false-green this repo bans. The advisory MUST still fire.
    const openclawDir = join(homeDir, ".openclaw");
    mkdirSync(openclawDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(openclawDir, "openclaw.json"), JSON.stringify(healthyConfig()), { mode: 0o600 });

    const payload = await runTool("sil_profile_search", {}, misattachedConfig());
    expect(advisoryIds(payload)).toEqual([SKILL_MISATTACHED]);
  });

  it("rule 10 — a DRIFTED file on disk does NOT manufacture an advisory either", async () => {
    // The mirror image, and the half that catches a file read the test above cannot:
    // an implementation reading `~/.openclaw` would fire here, on a running process
    // whose EFFECTIVE wiring is healthy. The product question is "is my skill
    // actually running?", and it is.
    const openclawDir = join(homeDir, ".openclaw");
    mkdirSync(openclawDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(openclawDir, "openclaw.json"), JSON.stringify(allDriftConfig()), { mode: 0o600 });

    const payload = await runTool("sil_profile_search", {}, healthyConfig());
    const report = await runDoctor(healthyConfig());
    expect(payload).not.toHaveProperty("advisories");
    expect(wiringFindings(report)).toEqual([]);
  });

  it("the host config file is BYTE-IDENTICAL after every surface runs", async () => {
    const openclawDir = join(homeDir, ".openclaw");
    mkdirSync(openclawDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(openclawDir, "openclaw.json"), JSON.stringify(allDriftConfig()), { mode: 0o600 });
    const before = snapshot(homeDir);

    const config = allDriftConfig();
    const api = createMockPluginApi({ config });
    lastApi = api;
    capturedRegisterFn!(api);
    registerAll(api);
    await getTool(api, "sil_profile_search").execute("call-1", {});
    await getTool(api, "sil_doctor").execute("call-2", {});

    // No write, no chmod, no new file, and nothing under $HOME touched at all —
    // so `security.filesystemScope` needs no widening (OQ1).
    expect(snapshot(homeDir)).toEqual(before);
  });

  it("the wiring modules reach for no installer, no child process, and no host config file", async () => {
    // The audit-scope half a behavioural assertion cannot reach: the manifest
    // declares `noChildProcess` + `noInstallScripts`, and this card's whole premise
    // is that the plugin can't be its own installer and doesn't try. A source scan
    // is the honest guard for "this code CANNOT do X", rather than "it happened not
    // to today".
    for (const file of ["src/lib/host-wiring.ts", "src/lib/version-advisory.ts"]) {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      for (const forbidden of [
        "child_process",
        "execSync",
        "spawnSync",
        ".openclaw/",
        "homedir",
        "npm install",
      ]) {
        expect(source, `${file} must not reference ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

// ===========================================================================
// AC11 — the finding shape, and the doctor's existing sort
// ===========================================================================

describe("AC11 — six flat fields, folded into the doctor's existing deterministic order", () => {
  it("every finding this card contributes is EXACTLY the six fields — no extras, no sub-object", async () => {
    // Zero schema change (PO invariant 8 + sil-doctor's domain-agnostic invariant #4).
    // Version numbers and the fix ride `detected` / `suggestedAction` as STRINGS —
    // no structured `advisory: { required, running }` sub-object.
    const report = await runDoctor(allDriftConfig(), HOST_TOO_OLD);
    const ours = report.findings.filter(
      (f) => f.id.startsWith("wiring.") || f.id === GATEWAY_COMPAT,
    );
    expect(ours.map((f) => f.id)).toContain(GATEWAY_COMPAT);
    for (const finding of ours) {
      expect(Object.keys(finding).sort(), finding.id).toEqual([
        "appliedAction",
        "detected",
        "id",
        "severity",
        "status",
        "suggestedAction",
      ]);
    }
  });

  it("the folded advisories on a tool result carry the same six fields", async () => {
    const payload = await runTool("sil_profile_search", {}, allDriftConfig());
    for (const advisory of payload.advisories!) {
      expect(Object.keys(advisory).sort(), advisory.id).toEqual([
        "appliedAction",
        "detected",
        "id",
        "severity",
        "status",
        "suggestedAction",
      ]);
    }
  });

  it("the report stays sorted (severity desc, id asc) with our findings folded in", async () => {
    const report = await runDoctor(allDriftConfig(), HOST_TOO_OLD);
    expect(report.findings).toEqual(sortFindings(report.findings));
  });

  it("our warns sort ABOVE the store/identity `info` findings, alongside them in ONE array", async () => {
    const report = await runDoctor(allDriftConfig(), HOST_TOO_OLD);
    const firstInfo = report.findings.findIndex((f) => f.severity === "info");
    const ourIndices = report.findings
      .map((f, i) => (f.id.startsWith("wiring.") || f.id === GATEWAY_COMPAT ? i : -1))
      .filter((i) => i >= 0);

    expect(ourIndices.length).toBeGreaterThan(0);
    for (const i of ourIndices) expect(i).toBeLessThan(firstInfo);
  });

  it("sil_doctor's report SHAPE is unchanged — this card adds no report key", async () => {
    const report = await runDoctor(allDriftConfig(), HOST_TOO_OLD);
    expect(Object.keys(report).sort()).toEqual([
      "counts",
      "dataDir",
      "findings",
      "healthy",
      "installedVersion",
      "status",
    ]);
  });

  it("the roll-ups count our findings — `healthy: false` is the truth on a drifted host", async () => {
    // The severity call has teeth here: `warn` means `healthy` flips. A mis-wired
    // skill genuinely IS a degradation, and a `healthy: true` beside a dead skill is
    // exactly what trains consumers to ignore the roll-up.
    const drifted = await runDoctor(allDriftConfig(), HOST_TOO_OLD);
    expect(drifted.counts.warn).toBeGreaterThanOrEqual(wiringFindings(drifted).length);
    expect(drifted.healthy).toBe(false);

    const healthy = await runDoctor(healthyConfig());
    expect(healthy.healthy).toBe(true);
  });
});

// ===========================================================================
// AC14 — no host-config value leaks, and the local path makes no network call
// ===========================================================================

describe("AC14 — `api.config` is the WHOLE config tree, and none of it may escape", () => {
  it("no finding field and no log line carries another plugin's credential", async () => {
    // The second-highest, least obvious risk in the card: `api.config` is not a
    // sil-scoped slice, it is the whole OpenClawConfig — it can hold other tenants'
    // credentials one key away from the facts we DO emit. Findings carry only
    // DERIVED facts (agent id, membership booleans, the fix string), never a config
    // fragment. Scanned across the doctor report, the tool payload, and every log.
    const config = secretBearingConfig();

    const report = await runDoctor(config, HOST_TOO_OLD);
    for (const secret of ALL_SECRETS) {
      expect(emittedStrings(report), secret).not.toContain(secret);
    }

    const payload = await runTool("sil_profile_search", {}, config);
    for (const secret of ALL_SECRETS) {
      expect(emittedStrings(payload), secret).not.toContain(secret);
    }
  });

  it("the register-time warn carries no config value either", async () => {
    const api = createMockPluginApi({ config: secretBearingConfig() });
    lastApi = api;
    capturedRegisterFn!(api);

    const emitted = emittedStrings(null);
    for (const secret of ALL_SECRETS) expect(emitted, secret).not.toContain(secret);
    // Non-vacuity: the warn DID fire on this config — the scan above is scanning
    // something real, not an empty string.
    expect(vi.mocked(api.logger.warn)).toHaveBeenCalledWith(
      WIRING_WARN_MARKER,
      expect.anything(),
    );
  });

  it("does not dump adjacent keys even while naming the agent it must name (rule 9)", async () => {
    // The agent id IS a wiring fact and is required by the fix string. The agent's
    // `env` block sitting beside it is NOT — a naive implementation that serializes
    // the whole agent entry to name it leaks in the same breath as it helps.
    const payload = await runTool("sil_profile_search", {}, secretBearingConfig());
    const advisory = payload.advisories!.find((a) => a.id === SKILL_MISATTACHED)!;

    expect(advisory.detected).toContain("shopper");
    expect(JSON.stringify(advisory)).not.toContain(AGENT_SECRET);
    expect(JSON.stringify(advisory)).not.toContain("OPENAI_API_KEY");
  });

  it("the wiring + compat path issues ZERO network calls", async () => {
    // This card is 100% local — a stronger property than "no network on the hot
    // path", and one that falls out of the design rather than being engineered. Two
    // surfaces that make no request of their own prove it: register(), and a profile
    // read (local-only by contract).
    const api = createMockPluginApi({ config: allDriftConfig() });
    lastApi = api;
    capturedRegisterFn!(api);
    registerAll(api);
    await getTool(api, "sil_profile_search").execute("call-1", {});

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("`networkEndpoints` is untouched by this card — it adds no outbound surface", () => {
    // The ClawHub entry is sil-doctor's (founder ruling, §8.3 CLOSED). This card
    // adds none: if a detection ever needed a host, THIS assertion is the one that
    // must be argued with first, in a security declaration a reviewer audits.
    const endpoints: string[] = JSON.parse(
      readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"),
    ).security.networkEndpoints;
    expect([...endpoints].sort()).toEqual([
      "https://clawhub.ai",
      "https://sil-api.4gpts.com",
      "https://sil.4gpts.com",
    ]);
  });
});
