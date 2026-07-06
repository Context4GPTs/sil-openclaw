/**
 * INTEGRATION — the one-tap create-shopper BIN, end-to-end against a real temp
 * host (tier: integration — spawns `scripts/create-shopper.mjs` as a child
 * process, real fs reads/writes, real exit codes, real `materializeProfile` +
 * the real `sil-openclaw-allowlist` bin; the ONLY test double is a PATH-shimmed
 * `openclaw` binary, the EXTERNAL host CLI boundary — never a stub of sil's own
 * logic, per `.claude/rules/complete-work-is-stub-free.md`).
 *
 * Card: one-tap-shopper-create-via-a-single-wrapper-bin. The bin collapses the
 * nine-step agent-driven host-CLI choreography into ONE shipped operator `bin`
 * (a sibling of `sil-openclaw-allowlist`) that runs it atomically + fail-closed.
 * This suite pins the LOAD-BEARING invariant — the FOUR-OUTCOME taxonomy and its
 * exact state effects — as a black box over the bin's `{ status, … }` JSON result
 * and the observable filesystem (temp `openclaw.json` + temp `$SIL_DATA_DIR` +
 * the workspace dir):
 *
 *   created            — a valid spec + no shopper + a validating host config ⇒
 *                        host agent added, SOUL.md carries the persona, the sil
 *                        artefacts materialized (shared user_spec.md + profile.json
 *                        with an EMPTY `domains: {}` map), the sil skill attached,
 *                        `sil` admitted at ALL THREE allow surfaces, exit 0, the
 *                        result carries name + agentId.
 *   invalid_request    — a bad/blank/malformed spec ⇒ NOTHING attempted (validate-
 *                        first runs ahead of every host command); names the field.
 *   collision          — a singleton violation OR an agentId clash ⇒ NOTHING
 *                        written; `openclaw agents add` never runs; DISTINCT from
 *                        persistence_failed (different recovery).
 *   persistence_failed — a step fails AFTER writes begin ⇒ whole-file snapshot-
 *                        restore returns the host to its EXACT pre-run state (no
 *                        orphan agent entry / workspace dir / shopper dir / residual
 *                        trust edit; a co-installed peer's trust survives); carries
 *                        path + cause; NEVER declares created.
 *
 * Plus: creation is LOCAL + OFFLINE (reads no token, calls no `sil_whoami`, makes
 * no network call) and the markers NEVER leak the persona/userSpec text.
 *
 * The bin imports the COMPILED libs (`dist/lib/profile-store.js`) and shells the
 * `sil-openclaw-allowlist` bin (which imports `dist/lib/openclaw-allowlist.js`), so
 * beforeAll builds dist FROM THE CURRENT SOURCE — never a possibly-stale dist (a
 * stale dist silently tests old logic). The build is the same `tsc -p
 * tsconfig.build.json` the bin's `../dist` import needs.
 *
 * THE fake `openclaw` shim is a faithful test double of the EXTERNAL host CLI: it
 * answers `agents list` / `agents add` / `config set` / `config validate` (and the
 * nested allowlist bin's internal `config validate`) with the MINIMAL real fs effect
 * a later step reads — the bin checks `agents list`/`agents add` only by EXIT CODE
 * and re-reads the config FILE, so the shim's job is to mutate `openclaw.json` +
 * bootstrap the workspace, not to fake output shapes. A per-run `OPENCLAW_SHIM_FAIL`
 * knob injects a non-zero/invalid result at a chosen step.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the bin.
 * Hermetic: each test gets its own mkdtemp dirs + config fixture; full teardown in
 * afterEach. NO shared state, NO order dependence.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root of the checkout under test (…/src/__tests__ → root). */
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "create-shopper.mjs");

const SIL_ID = "sil";
/** Running as root bypasses filesystem permission bits, so the chmod-based
 * "unwritable $SIL_DATA_DIR" fault-injection cannot fire — skip it there. */
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

// Distinctive secrets planted in persona/userSpec — the bin must NEVER echo them
// into its stdout/stderr markers (no PII/secret leakage).
const PERSONA_SECRET = "PERSONA-SECRET-b3a1f7";
const USERSPEC_SECRET = "USERSPEC-SECRET-9c2d0e";

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface Spec {
  agentId: string;
  name: string;
  workspace: string;
  persona: string;
  userSpec: string;
}

/**
 * The fake `openclaw` host CLI — a CommonJS script (a bare `openclaw` file with a
 * node shebang runs as CJS: no `.mjs` extension, no package.json in its temp dir).
 * It is a test double of the EXTERNAL binary boundary, NOT a stub of sil's logic.
 *
 * Contract (matches what the bin actually needs — the bin reads `agents list`/
 * `agents add` only by exit code, then re-reads the config FILE):
 *   agents list --json     → exit 0 (empty output is fine)               [fail: agents-list]
 *   agents add <id> …      → append {id,skills:[]} to agents.list, mkdir
 *                            the --workspace dir + bootstrap SOUL.md/AGENTS.md, exit 0
 *                                                                        [fail: agents-add]
 *   config set <path> <v>  → apply the set to openclaw.json, exit 0      [fail: config-set]
 *   config validate --json → {valid:true,path}                          [fail: config-validate
 *                            ⇒ {valid:false,path,issues,error}, exit 0]
 * Every invocation's argv is appended to $OPENCLAW_SHIM_LOG so a test can prove
 * WHICH host commands ran (e.g. "agents add NEVER ran" on a collision).
 */
const OPENCLAW_SHIM = String.raw`#!/usr/bin/env node
"use strict";
const { readFileSync, writeFileSync, mkdirSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");

const argv = process.argv.slice(2);
const cfgPath = process.env.OPENCLAW_CONFIG_PATH;
const fails = (process.env.OPENCLAW_SHIM_FAIL || "").split(",").filter(Boolean);
const logPath = process.env.OPENCLAW_SHIM_LOG;
if (logPath) { try { appendFileSync(logPath, argv.join(" ") + "\n"); } catch (e) {} }

function readCfg() { return JSON.parse(readFileSync(cfgPath, "utf8")); }
function writeCfg(c) { writeFileSync(cfgPath, JSON.stringify(c, null, 2) + "\n"); }
function die(msg) { process.stderr.write("shim: " + msg + "\n"); process.exit(1); }

// Set a value at a dotted path that may contain "[N]" index segments, e.g.
// "agents.list[0].skills" or "plugins.entries.sil.enabled".
function setPath(obj, path, val) {
  const parts = [];
  for (const seg of path.split(".")) {
    const m = seg.match(/^([^\[]+)\[(\d+)\]$/);
    if (m) { parts.push(m[1]); parts.push(Number(m[2])); }
    else { parts.push(seg); }
  }
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === undefined || cur[k] === null) {
      cur[k] = typeof parts[i + 1] === "number" ? [] : {};
    }
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = val;
}

const a0 = argv[0];
const a1 = argv[1];

if (a0 === "agents" && a1 === "list") {
  if (fails.includes("agents-list")) die("agents list forced failure");
  let list = [];
  try { const c = readCfg(); if (c.agents && Array.isArray(c.agents.list)) list = c.agents.list; } catch (e) {}
  process.stdout.write(JSON.stringify({ agents: list.map((x) => ({ id: x && x.id })) }) + "\n");
  process.exit(0);
}

if (a0 === "agents" && a1 === "add") {
  if (fails.includes("agents-add")) die("agents add forced failure");
  const id = argv[2];
  const wsIdx = argv.indexOf("--workspace");
  const ws = wsIdx >= 0 ? argv[wsIdx + 1] : null;
  const c = readCfg();
  if (!c.agents || typeof c.agents !== "object") c.agents = {};
  if (!Array.isArray(c.agents.list)) c.agents.list = [];
  c.agents.list.push({ id: id, skills: [] });
  writeCfg(c);
  if (ws) {
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "SOUL.md"), "# placeholder soul (host bootstrap)\n");
    writeFileSync(join(ws, "AGENTS.md"), "# placeholder agents (host bootstrap)\n");
  }
  process.stdout.write(JSON.stringify({ id: id, workspace: ws }) + "\n");
  process.exit(0);
}

if (a0 === "config" && a1 === "set") {
  if (fails.includes("config-set")) die("config set forced failure");
  const path = argv[2];
  const rawVal = argv[3];
  let val;
  try { val = JSON.parse(rawVal); } catch (e) { val = rawVal; }
  const c = readCfg();
  setPath(c, path, val);
  writeCfg(c);
  process.exit(0);
}

if (a0 === "config" && a1 === "validate") {
  if (fails.includes("config-validate")) {
    process.stdout.write(JSON.stringify({ valid: false, path: cfgPath, issues: ["shim: forced invalid config"], error: "shim forced the config invalid" }) + "\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ valid: true, path: cfgPath }) + "\n");
  process.exit(0);
}

// Any other subcommand: no-op success (logged above).
process.exit(0);
`;

// ---------------------------------------------------------------------------
// Per-test temp state.
// ---------------------------------------------------------------------------
let workdir: string; // holds openclaw.json + the workspace dir
let dataDir: string; // $SIL_DATA_DIR
let binDir: string; // holds the `openclaw` shim
let emptyHome: string; // guaranteed-empty HOME so no real ~/.openclaw resolves
let logPath: string; // shim invocation log
let configPath: string;

beforeAll(() => {
  // The bin imports dist/lib/profile-store.js and shells the allowlist bin
  // (dist/lib/openclaw-allowlist.js) — build the libs from the CURRENT source so
  // the integration tier exercises what the dev wrote, never a stale dist. We
  // invoke the TypeScript compiler's real JS entry (node_modules/.bin/tsc is a
  // shell wrapper `node` cannot run directly).
  execFileSync("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const rel of ["dist/lib/profile-store.js", "dist/lib/openclaw-allowlist.js"]) {
    if (!existsSync(join(REPO_ROOT, rel))) {
      throw new Error(`build did not emit ${rel} — the bin's import would 404`);
    }
  }
}, 120_000);

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "sil-create-it-"));
  dataDir = mkdtempSync(join(tmpdir(), "sil-create-data-"));
  binDir = mkdtempSync(join(tmpdir(), "sil-create-bin-"));
  emptyHome = mkdtempSync(join(tmpdir(), "sil-create-home-"));
  configPath = join(workdir, "openclaw.json");
  logPath = join(workdir, "shim-invocations.log");
  writeFileSync(join(binDir, "openclaw"), OPENCLAW_SHIM, { mode: 0o755 });
});

afterEach(() => {
  for (const d of [workdir, dataDir, binDir, emptyHome]) {
    try {
      chmodSync(d, 0o700);
    } catch {
      /* best effort — the unwritable-datadir test drops perms */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** A fresh host config: sil discovered, trusted nowhere; no agents yet. */
function freshConfig(): Record<string, unknown> {
  return {
    gateway: { mode: "local", port: 18789 },
    tools: { profile: "coding", alsoAllow: [] as string[] },
    plugins: { allow: [] as string[], entries: {} as Record<string, unknown> },
    meta: { lastTouchedVersion: "2026.6.9" },
  };
}

/** A host config where a co-installed peer (`klodi`) is ALREADY trusted at every
 * surface — the additive/teardown invariant subject. */
function klodiConfig(): Record<string, unknown> {
  return {
    gateway: { mode: "local", port: 18789 },
    tools: { profile: "coding", alsoAllow: ["klodi"] },
    plugins: {
      allow: ["klodi"],
      entries: { klodi: { enabled: true, config: { apiKey: "operator-set" } } },
    },
    meta: { lastTouchedVersion: "2026.6.9" },
  };
}

function writeConfig(value: unknown): void {
  writeFileSync(configPath, JSON.stringify(value, null, 2) + "\n");
}

function readConfig(): Record<string, any> {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

/** A valid, endorsed spec (secrets planted in persona/userSpec). */
function validSpec(overrides: Partial<Spec> = {}): Spec {
  const agentId = overrides.agentId ?? "my-shopper";
  return {
    agentId,
    name: overrides.name ?? "My Shopper",
    workspace: overrides.workspace ?? join(workdir, `workspace-${agentId}`),
    persona: overrides.persona ?? `A careful generalist buyer. ${PERSONA_SECRET}`,
    userSpec: overrides.userSpec ?? `Ships to Athens; UK size 10; ${USERSPEC_SECRET}`,
  };
}

interface RunOpts {
  spec?: Spec;
  /** Raw stdin body — bypasses `spec` to feed malformed JSON. */
  stdin?: string;
  /** Pass the spec via a `--spec <path>` file instead of stdin. */
  viaSpecFile?: boolean;
  /** OPENCLAW_SHIM_FAIL knob(s). */
  fail?: string[];
  /** Override the resolved config env (for the "no config" fail-closed case). */
  env?: Record<string, string>;
}

/** Spawn the bin as a child process with a hermetic, explicit env. */
function runBin(opts: RunOpts = {}): RunResult {
  const args = [SCRIPT];
  let input = "";
  if (opts.stdin !== undefined) {
    input = opts.stdin;
  } else if (opts.spec) {
    if (opts.viaSpecFile) {
      const specPath = join(workdir, "spec.json");
      writeFileSync(specPath, JSON.stringify(opts.spec));
      args.push("--spec", specPath);
    } else {
      input = JSON.stringify(opts.spec);
    }
  }

  const env: Record<string, string> = {
    PATH: `${binDir}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
    HOME: emptyHome,
    OPENCLAW_CONFIG_PATH: configPath,
    SIL_DATA_DIR: dataDir,
    OPENCLAW_SHIM_LOG: logPath,
    ...(opts.fail && opts.fail.length ? { OPENCLAW_SHIM_FAIL: opts.fail.join(",") } : {}),
    ...(opts.env ?? {}),
  };

  try {
    const stdout = execFileSync("node", args, {
      input,
      env,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: e.status ?? 1,
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
    };
  }
}

/** Parse the single NDJSON marker the bin emits on the given stream. */
function parseMarker(streamText: string): Record<string, any> {
  const line = streamText.trim().split("\n").filter(Boolean).at(-1) ?? "";
  return JSON.parse(line) as Record<string, any>;
}

/** Full text of the shim invocation log (empty string if the shim never ran). */
function shimLog(): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

const shopperDir = () => join(dataDir, "shopper");
const profileJsonPath = () => join(shopperDir(), "profile.json");
const userSpecPath = () => join(shopperDir(), "user_spec.md");

/** Seed a pre-existing SINGLETON shopper (valid manifest + shared user spec) so the
 * bin's `readAgentProfile()` pre-flight returns a named overview ⇒ collision. */
function seedExistingShopper(): void {
  mkdirSync(shopperDir(), { recursive: true });
  writeFileSync(userSpecPath(), "# Existing shopper user spec\nships to Berlin\n");
  writeFileSync(
    profileJsonPath(),
    JSON.stringify(
      {
        name: "Existing Shopper",
        userSpecPath: userSpecPath(),
        createdAt: "2026-01-01T00:00:00.000Z",
        domains: {},
      },
      null,
      2,
    ) + "\n",
  );
}

// ===========================================================================
// created — the happy path: every surface wired, exit 0, identity returned.
// ===========================================================================
describe("created — one valid run wires every surface and returns the identity", () => {
  it("exits 0 with status:created and the result carries name + agentId (so the agent can open it)", () => {
    writeConfig(freshConfig());
    const spec = validSpec();
    const r = runBin({ spec });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["event"]).toBe("sil_shopper_created");
    expect(m["status"]).toBe("created");
    expect(m["name"]).toBe(spec.name);
    expect(m["agentId"]).toBe(spec.agentId);
    // No failure marker on stderr for a clean create.
    expect(r.stderr.includes("sil_shopper_create_failed")).toBe(false);
  });

  it("materializes the sil artefacts — shared user_spec.md + profile.json with an EMPTY domains map (healthy)", () => {
    writeConfig(freshConfig());
    const spec = validSpec();
    const r = runBin({ spec });
    expect(r.status).toBe(0);

    expect(existsSync(profileJsonPath())).toBe(true);
    const manifest = JSON.parse(readFileSync(profileJsonPath(), "utf8"));
    expect(manifest.name).toBe(spec.name);
    // A fresh shopper has NO domains — an empty map is healthy, not a deficiency.
    expect(manifest.domains).toEqual({});
    expect(existsSync(userSpecPath())).toBe(true);
    expect(readFileSync(userSpecPath(), "utf8")).toContain(USERSPEC_SECRET);
    // No per-domain packs authored at create.
    expect(existsSync(join(shopperDir(), "domains"))).toBe(false);
  });

  it("writes the persona into the workspace SOUL.md (host workspace, not a sil artefact)", () => {
    writeConfig(freshConfig());
    const spec = validSpec();
    const r = runBin({ spec });
    expect(r.status).toBe(0);

    const soul = join(spec.workspace, "SOUL.md");
    expect(existsSync(soul)).toBe(true);
    expect(readFileSync(soul, "utf8")).toContain(PERSONA_SECRET);
    // The persona lives in exactly one place — never a sil persona.md.
    expect(existsSync(join(shopperDir(), "persona.md"))).toBe(false);
  });

  it("admits sil at ALL THREE allow surfaces AND attaches the skill + enables the plugin", () => {
    writeConfig(freshConfig());
    const spec = validSpec();
    const r = runBin({ spec });
    expect(r.status).toBe(0);

    const c = readConfig();
    // Trust — the three surfaces the shipped allowlist bin merges. The third
    // surface's invariant is that sil is ENABLED there; the entry's exact object
    // shape ({enabled:true} vs {enabled:true,config:{}}) is incidental — the create
    // bin sets `enabled` via `config set` first, then the allowlist merges
    // idempotently over that pre-existing entry (never clobbering it).
    expect(c.plugins.allow).toContain(SIL_ID);
    expect(c.tools.alsoAllow).toContain(SIL_ID);
    expect(c.plugins.entries[SIL_ID]).toBeTruthy();
    expect(c.plugins.entries[SIL_ID].enabled).toBe(true);
    // Wiring — the host agent exists with the sil skill attached.
    const agent = c.agents.list.find((a: any) => a.id === spec.agentId);
    expect(agent).toBeTruthy();
    expect(agent.skills).toEqual([SIL_ID]);
  });

  it("carries a warnings array (empty on a config with no web-capability gap)", () => {
    writeConfig(freshConfig());
    const r = runBin({ spec: validSpec() });
    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(Array.isArray(m["warnings"])).toBe(true);
    expect(m["warnings"]).toEqual([]);
  });
});

// ===========================================================================
// created — additive: a co-installed peer survives; the shopper is added beside it.
// ===========================================================================
describe("created — additive: a co-installed peer (klodi) keeps its trust", () => {
  it("appends sil at every surface while klodi's pre-existing trust is preserved", () => {
    writeConfig(klodiConfig());
    const r = runBin({ spec: validSpec() });
    expect(r.status).toBe(0);

    const c = readConfig();
    expect(c.plugins.allow).toContain("klodi");
    expect(c.plugins.allow).toContain(SIL_ID);
    expect(c.tools.alsoAllow).toContain("klodi");
    expect(c.tools.alsoAllow).toContain(SIL_ID);
    // klodi's operator-set config is untouched.
    expect(c.plugins.entries["klodi"]).toEqual({
      enabled: true,
      config: { apiKey: "operator-set" },
    });
  });
});

// ===========================================================================
// created — the web-capability gap is a WARNING, never a hard-fail (SA ruling).
// ===========================================================================
describe("created — a web-capability gap warns but never blocks (bare sil_search still works)", () => {
  it("still reaches created, carrying a non-empty warnings entry naming the gap", () => {
    const cfg = freshConfig() as any;
    // agents.defaults is present but grants NO web/fetch/browse/http capability.
    cfg.agents = { defaults: { tools: { profile: "coding", alsoAllow: [] } } };
    writeConfig(cfg);
    const r = runBin({ spec: validSpec() });
    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    expect(Array.isArray(m["warnings"])).toBe(true);
    expect((m["warnings"] as string[]).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// invalid_request — validate-first: a bad/blank field ⇒ NOTHING attempted.
// ===========================================================================
describe("invalid_request — validate-first refuses a bad/blank spec, attempting NOTHING", () => {
  const REQUIRED: ReadonlyArray<keyof Spec> = [
    "agentId",
    "name",
    "workspace",
    "persona",
    "userSpec",
  ];

  for (const field of REQUIRED) {
    it(`a MISSING \`${field}\` ⇒ invalid_request naming it, non-zero exit, nothing written, no host command run`, () => {
      writeConfig(freshConfig());
      const spec = validSpec();
      const partial = { ...spec };
      delete (partial as Record<string, unknown>)[field];
      const preConfig = readFileSync(configPath, "utf8");

      const r = runBin({ stdin: JSON.stringify(partial) });

      expect(r.status).not.toBe(0);
      const m = parseMarker(r.stderr);
      expect(m["event"]).toBe("sil_shopper_create_failed");
      expect(m["status"]).toBe("invalid_request");
      // The failure names the offending field (in `field` or the cause text).
      const namesField =
        m["field"] === field || String(m["cause"] ?? "").includes(field);
      expect(namesField, `expected the failure to name '${field}'`).toBe(true);

      // NOTHING attempted: validate-first runs ahead of EVERY host command.
      expect(shimLog()).toBe("");
      // NOTHING written: config byte-identical, no shopper dir, no workspace.
      expect(readFileSync(configPath, "utf8")).toBe(preConfig);
      expect(existsSync(shopperDir())).toBe(false);
      expect(existsSync(spec.workspace)).toBe(false);
    });

    it(`a BLANK (whitespace) \`${field}\` ⇒ invalid_request, nothing attempted`, () => {
      writeConfig(freshConfig());
      const spec = validSpec();
      const r = runBin({ spec: { ...spec, [field]: "   " } as Spec });
      expect(r.status).not.toBe(0);
      expect(parseMarker(r.stderr)["status"]).toBe("invalid_request");
      expect(shimLog()).toBe("");
      expect(existsSync(shopperDir())).toBe(false);
    });
  }

  it("rejects a host-reserved agentId `main` (never a shopper named main)", () => {
    writeConfig(freshConfig());
    const r = runBin({ spec: validSpec({ agentId: "main" }) });
    expect(r.status).not.toBe(0);
    const m = parseMarker(r.stderr);
    expect(m["status"]).toBe("invalid_request");
    expect(shimLog()).toBe("");
  });

  it("rejects a non-lower-kebab agentId (path-segment shape guard)", () => {
    writeConfig(freshConfig());
    const r = runBin({ spec: validSpec({ agentId: "My_Shopper!" }) });
    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("invalid_request");
    expect(shimLog()).toBe("");
  });
});

// ===========================================================================
// invalid_request — malformed/unparseable input fails closed (mirrors the
// allowlist helper's "config is not valid JSON → fail closed").
// ===========================================================================
describe("invalid_request — malformed/unparseable spec fails closed", () => {
  it("garbage stdin JSON ⇒ non-zero, structured error, nothing attempted, nothing written", () => {
    writeConfig(freshConfig());
    const preConfig = readFileSync(configPath, "utf8");
    const r = runBin({ stdin: "{ this is : not json,, }" });
    expect(r.status).not.toBe(0);
    const m = parseMarker(r.stderr);
    expect(m["event"]).toBe("sil_shopper_create_failed");
    expect(m["status"]).toBe("invalid_request");
    expect(shimLog()).toBe("");
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    expect(existsSync(shopperDir())).toBe(false);
  });

  it("an empty stdin body ⇒ invalid_request, nothing attempted", () => {
    writeConfig(freshConfig());
    const r = runBin({ stdin: "" });
    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("invalid_request");
    expect(shimLog()).toBe("");
  });

  it("a JSON array (not an object) ⇒ invalid_request, nothing attempted", () => {
    writeConfig(freshConfig());
    const r = runBin({ stdin: JSON.stringify(["not", "an", "object"]) });
    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("invalid_request");
    expect(shimLog()).toBe("");
  });

  it("an unreadable --spec file ⇒ invalid_request, nothing attempted", () => {
    writeConfig(freshConfig());
    const args = [SCRIPT, "--spec", join(workdir, "does-not-exist.json")];
    let status = 0;
    let stderr = "";
    try {
      execFileSync("node", args, {
        input: "",
        env: {
          PATH: `${binDir}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
          HOME: emptyHome,
          OPENCLAW_CONFIG_PATH: configPath,
          SIL_DATA_DIR: dataDir,
          OPENCLAW_SHIM_LOG: logPath,
        },
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const e = err as { status?: number; stderr?: Buffer | string };
      status = e.status ?? 1;
      stderr = (e.stderr ?? "").toString();
    }
    expect(status).not.toBe(0);
    expect(parseMarker(stderr)["status"]).toBe("invalid_request");
    expect(shimLog()).toBe("");
  });
});

// ===========================================================================
// collision — the singleton invariant + the agentId clash. DISTINCT from
// persistence_failed; `openclaw agents add` NEVER runs; nothing written.
// ===========================================================================
describe("collision — a shopper already exists (singleton): refuse, write nothing, never add", () => {
  it("a pre-existing sil shopper ⇒ status:collision, `agents add` never runs, config byte-identical", () => {
    writeConfig(freshConfig());
    seedExistingShopper();
    const preConfig = readFileSync(configPath, "utf8");
    const preProfile = readFileSync(profileJsonPath(), "utf8");

    const r = runBin({ spec: validSpec() });

    expect(r.status).not.toBe(0);
    const m = parseMarker(r.stderr);
    expect(m["event"]).toBe("sil_shopper_create_failed");
    // DISTINCT literal — never green-washed into persistence_failed.
    expect(m["status"]).toBe("collision");
    expect(m["status"]).not.toBe("persistence_failed");

    // `openclaw agents add` NEVER ran (the singleton gate precedes the add).
    expect(shimLog()).not.toContain("agents add");
    // Nothing written: config byte-identical AND the existing shopper untouched.
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    expect(readFileSync(profileJsonPath(), "utf8")).toBe(preProfile);
  });

  it("a second run AFTER a successful created hits the same singleton gate (never a duplicate shopper)", () => {
    writeConfig(freshConfig());
    const first = runBin({ spec: validSpec() });
    expect(first.status).toBe(0);
    expect(parseMarker(first.stdout)["status"]).toBe("created");

    // Second run — same singleton, now populated by the first create.
    rmSync(logPath, { force: true });
    const second = runBin({ spec: validSpec({ agentId: "my-shopper-2", name: "Second" }) });
    expect(second.status).not.toBe(0);
    expect(parseMarker(second.stderr)["status"]).toBe("collision");
    expect(shimLog()).not.toContain("agents add");
  });
});

describe("collision — an agentId clash refuses without overwriting the existing agent", () => {
  it("the proposed agentId already in agents.list ⇒ collision, existing agent untouched, no shopper dir", () => {
    const cfg = freshConfig() as any;
    cfg.agents = { list: [{ id: "my-shopper", skills: ["other"], workspace: "/pre/existing" }] };
    writeConfig(cfg);
    const preConfig = readFileSync(configPath, "utf8");

    const r = runBin({ spec: validSpec({ agentId: "my-shopper" }) });

    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("collision");
    // Never overwrote the existing agent, never minted a shopper dir.
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    expect(existsSync(shopperDir())).toBe(false);
  });
});

// ===========================================================================
// persistence_failed — a step fails AFTER writes begin ⇒ snapshot-restore
// leaves the host at its EXACT pre-run state; NEVER declares created.
// ===========================================================================
describe("persistence_failed — snapshot-restore teardown leaves the host byte-identical to pre-run", () => {
  it("a rejected `config validate` ⇒ persistence_failed(path+cause); openclaw.json byte-identical; no orphans; peer survives", () => {
    writeConfig(klodiConfig());
    const preConfig = readFileSync(configPath, "utf8");
    const spec = validSpec();

    const r = runBin({ spec, fail: ["config-validate"] });

    expect(r.status).not.toBe(0);
    const m = parseMarker(r.stderr);
    expect(m["status"]).toBe("persistence_failed");
    // Never declares created on a failed run.
    expect(m["status"]).not.toBe("created");
    expect(r.stdout.includes("sil_shopper_created")).toBe(false);
    // Actionable path + cause.
    expect(typeof m["path"]).toBe("string");
    expect(typeof m["cause"]).toBe("string");
    expect(String(m["cause"]).length).toBeGreaterThan(0);

    // The host is byte-identical to its pre-run state — every mutation reversed.
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    // No orphan sil shopper dir, no orphan workspace dir.
    expect(existsSync(shopperDir())).toBe(false);
    expect(existsSync(spec.workspace)).toBe(false);
    // The co-installed peer's trust survived the teardown untouched.
    const c = readConfig();
    expect(c.plugins.allow).toEqual(["klodi"]);
    expect(c.tools.alsoAllow).toEqual(["klodi"]);
    // sil was fully unwound — it is trusted at NO surface.
    expect(c.plugins.allow).not.toContain(SIL_ID);
    expect(c.tools.alsoAllow).not.toContain(SIL_ID);
    expect(c.plugins.entries[SIL_ID]).toBeUndefined();
    // No orphan .bak left by the nested allowlist bin.
    expect(existsSync(configPath + ".bak")).toBe(false);
  });

  it("a failed `openclaw agents add` ⇒ persistence_failed, nothing partial, never created", () => {
    writeConfig(freshConfig());
    const preConfig = readFileSync(configPath, "utf8");
    const spec = validSpec();

    const r = runBin({ spec, fail: ["agents-add"] });

    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("persistence_failed");
    expect(r.stdout.includes("sil_shopper_created")).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    expect(existsSync(shopperDir())).toBe(false);
    expect(existsSync(spec.workspace)).toBe(false);
  });

  it("a failed `config set` (skill-attach, step 8) ⇒ persistence_failed; teardown reverts; no orphans", () => {
    // Step 8 (attach the sil skill via `openclaw config set …`) is the one enumerated
    // fault-injection point the round-1 review flagged as never exercised. It fails
    // AFTER agents-add + SOUL.md + materialize wrote — so the teardown path here has
    // real accumulated state to unwind (host agent entry + shopper dir + workspace),
    // proving the snapshot-restore reverts every earlier mutation, not just the config.
    writeConfig(freshConfig());
    const preConfig = readFileSync(configPath, "utf8");
    const spec = validSpec();

    const r = runBin({ spec, fail: ["config-set"] });

    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("persistence_failed");
    expect(r.stdout.includes("sil_shopper_created")).toBe(false);
    // The skill-attach did run (writes had begun) — proving this exercises the
    // step-8 teardown branch, not a pre-flight refusal.
    expect(shimLog()).toContain("config set");
    // Whole-file snapshot-restore returned the host to its EXACT pre-run bytes,
    // and removed the shopper dir + workspace this run created.
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    expect(existsSync(shopperDir())).toBe(false);
    expect(existsSync(spec.workspace)).toBe(false);
  });

  it("a failed allow-list admission (non-zero) ⇒ persistence_failed — NEVER a green created over filtered tools", () => {
    // Isolate the step-9 allowlist failure WITHOUT touching `config validate`: a
    // non-array `plugins.allow` makes the merge core throw AllowlistShapeError, so
    // the shelled `sil-openclaw-allowlist` bin exits non-zero. The create bin must
    // NOT declare `created` over still-filtered sil_* tools — it tears down instead.
    const cfg = freshConfig() as any;
    cfg.plugins.allow = "sil"; // a string, not an array — the shape the allowlist core rejects
    writeConfig(cfg);
    const preConfig = readFileSync(configPath, "utf8");
    const spec = validSpec();

    const r = runBin({ spec });

    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("persistence_failed");
    expect(r.stdout.includes("sil_shopper_created")).toBe(false);
    // Snapshot-restore reverted every earlier mutation (the malformed config is
    // restored EXACTLY — teardown never "fixes" it, only reverts to pre-run).
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    expect(existsSync(shopperDir())).toBe(false);
    expect(existsSync(spec.workspace)).toBe(false);
  });

  it.skipIf(AS_ROOT)(
    "a failed sil-artefact materialize (unwritable $SIL_DATA_DIR) ⇒ persistence_failed, host restored",
    () => {
      writeConfig(freshConfig());
      const preConfig = readFileSync(configPath, "utf8");
      const spec = validSpec();
      // Drop write permission on $SIL_DATA_DIR so materialize's mkdir of the shopper
      // leaf fails AFTER the host agent + SOUL.md were written (a mid-choreography fault).
      chmodSync(dataDir, 0o500);

      const r = runBin({ spec });

      // Restore perms so afterEach can clean up regardless of the assertion outcome.
      chmodSync(dataDir, 0o700);

      expect(r.status).not.toBe(0);
      expect(parseMarker(r.stderr)["status"]).toBe("persistence_failed");
      expect(r.stdout.includes("sil_shopper_created")).toBe(false);
      expect(readFileSync(configPath, "utf8")).toBe(preConfig);
      expect(existsSync(shopperDir())).toBe(false);
      expect(existsSync(spec.workspace)).toBe(false);
    },
  );
});

// ===========================================================================
// teardown_failed — the LOUDER honesty-rail outcome. When snapshot-restore itself
// cannot revert (EBUSY/permission/disk-full analog), the bin MUST surface the
// residue and NEVER green-wash it into `persistence_failed` — the trust hinge the
// discovery council spent the most ink on ("a teardown that cannot fully revert is
// a distinct louder outcome, never a green-washed persistence_failed").
// ===========================================================================
describe("teardown_failed — a non-revertable teardown surfaces residue, never a green-washed persistence_failed", () => {
  it.skipIf(AS_ROOT)(
    "an unwritable config dir fails BOTH the trust merge AND its rollback ⇒ teardown_failed(residue), no green-wash, no leak",
    () => {
      // Realistic fault: the host config directory is read-only. Every in-place
      // config overwrite (agents add / config set) still works, and the workspace +
      // shopper artefacts land in a SEPARATE writable dir (under $SIL_DATA_DIR) — so
      // the whole choreography runs and mutates openclaw.json. Then step 9 (the
      // shelled `sil-openclaw-allowlist` bin) fails: its `.bak` copy needs a NEW file
      // in the read-only dir → EACCES. Teardown then tries to snapshot-restore
      // openclaw.json — its atomic tmp write ALSO needs a NEW file in the read-only
      // dir → EACCES → the config mutation is un-revertable → residue. The workspace
      // + shopper-dir removals (writable dir) DO succeed, so the residue is exactly
      // the one thing teardown could not undo: the config file.
      writeConfig(freshConfig());
      const preRunConfig = readFileSync(configPath, "utf8");
      // Keep the workspace + artefacts OUT of the config dir so agents-add/SOUL.md/
      // materialize all succeed — only the config dir is unwritable.
      const spec = validSpec({ workspace: join(dataDir, "ws-teardown-fail") });
      // Pre-create the shim log so the read-only dir doesn't suppress it (an existing
      // file stays appendable); lets us prove writes began.
      writeFileSync(logPath, "");

      // Make the config directory read-only AFTER all setup writes are in place.
      chmodSync(workdir, 0o500);
      const r = runBin({ spec });
      // Restore perms so afterEach can clean up regardless of assertion outcome.
      chmodSync(workdir, 0o700);

      expect(r.status).not.toBe(0);
      const m = parseMarker(r.stderr);
      expect(m["event"]).toBe("sil_shopper_create_failed");
      // The LOUDER fifth outcome — NOT the four-value collapse.
      expect(m["status"]).toBe("teardown_failed");
      expect(m["status"]).not.toBe("persistence_failed");
      expect(m["status"]).not.toBe("created");
      // Never green-washed: no success marker anywhere.
      expect(r.stdout.includes("sil_shopper_created")).toBe(false);

      // The residue names WHAT could not be reverted — a populated {path, cause} list.
      expect(Array.isArray(m["residue"])).toBe(true);
      expect((m["residue"] as unknown[]).length).toBeGreaterThan(0);
      for (const entry of m["residue"] as Array<Record<string, unknown>>) {
        expect(typeof entry["path"]).toBe("string");
        expect((entry["path"] as string).length).toBeGreaterThan(0);
        expect(typeof entry["cause"]).toBe("string");
        expect((entry["cause"] as string).length).toBeGreaterThan(0);
      }
      // The un-revertable config file is the surfaced residue.
      expect(
        (m["residue"] as Array<Record<string, unknown>>).some((e) => e["path"] === configPath),
      ).toBe(true);
      // The residue is TRUTHFUL, not a spurious claim: the host really was left
      // un-reverted. The failed restore means openclaw.json keeps the mid-run
      // mutations (the agents.list entry + skill + plugin/trust from steps 5–8), so
      // it is NOT byte-identical to its pre-run snapshot — teardown_failed reflects
      // real un-restored state, never a green-washed "nothing left" over dirty state.
      expect(readFileSync(configPath, "utf8")).not.toBe(preRunConfig);
      // The louder outcome voices that the host was NOT returned to pre-run state.
      expect(typeof m["note"]).toBe("string");
      expect((m["note"] as string).length).toBeGreaterThan(0);
      // Writes had begun before the fault — this is a genuine mid-choreography failure,
      // not a pre-flight refusal.
      expect(shimLog()).toContain("agents add");

      // Even on the loudest failure path, the persona/userSpec text never leaks.
      expect(r.stdout).not.toContain(PERSONA_SECRET);
      expect(r.stdout).not.toContain(USERSPEC_SECRET);
      expect(r.stderr).not.toContain(PERSONA_SECRET);
      expect(r.stderr).not.toContain(USERSPEC_SECRET);
    },
  );
});

// ===========================================================================
// Teardown removes ONLY what THIS run created — a pre-existing workspace dir with
// operator files survives (mirrors materializeProfile's !preexisted discipline).
// ===========================================================================
describe("teardown removes only what THIS run created", () => {
  it("a PRE-EXISTING workspace dir (with an operator file) survives a persistence_failed teardown", () => {
    writeConfig(freshConfig());
    const spec = validSpec();
    // The operator created the workspace before the run, with their own file in it.
    mkdirSync(spec.workspace, { recursive: true });
    const operatorFile = join(spec.workspace, "OPERATOR_NOTES.md");
    writeFileSync(operatorFile, "do not delete me\n");

    const r = runBin({ spec, fail: ["config-validate"] });

    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("persistence_failed");
    // The bin must NOT nuke a workspace dir it did not create — the operator file survives.
    expect(existsSync(operatorFile)).toBe(true);
    expect(readFileSync(operatorFile, "utf8")).toBe("do not delete me\n");
  });
});

// ===========================================================================
// Local + offline — no token read, no sil_whoami, no network; a co-installed
// peer's allow-list entries survive teardown (already asserted above; here we
// pin the offline invariant explicitly).
// ===========================================================================
describe("local + offline — creation reads no token, calls no sil_whoami, makes no network call", () => {
  it("reaches created in a fully hermetic env with NO tokens.json present, and writes no identity artefact", () => {
    writeConfig(freshConfig());
    // No tokens.json seeded under $SIL_DATA_DIR and no reachable sil server.
    const r = runBin({ spec: validSpec() });

    expect(r.status).toBe(0);
    expect(parseMarker(r.stdout)["status"]).toBe("created");
    // Creation writes NO identity artefacts — only the shopper behaviour store.
    expect(existsSync(join(dataDir, "tokens.json"))).toBe(false);
    expect(existsSync(join(shopperDir(), "tokens.json"))).toBe(false);

    // The only host commands run are the offline agent/config choreography — never
    // an identity/register/whoami/network subcommand.
    const log = shimLog();
    for (const forbidden of ["whoami", "register", "identity", "login", "auth"]) {
      expect(log.includes(forbidden), `shim saw a forbidden '${forbidden}' subcommand`).toBe(false);
    }
    // The commands it DID run are exactly the create choreography.
    expect(log).toContain("agents list");
    expect(log).toContain("agents add");
    expect(log).toContain("config validate");
  });
});

// ===========================================================================
// No PII/secret leakage — the markers never carry the persona/userSpec text.
// ===========================================================================
describe("no PII/secret leakage — the markers never echo the persona or userSpec text", () => {
  it("neither stdout nor stderr contains the persona/userSpec secrets, on created OR on failure", () => {
    writeConfig(freshConfig());

    const ok = runBin({ spec: validSpec() });
    expect(ok.status).toBe(0);
    expect(ok.stdout).not.toContain(PERSONA_SECRET);
    expect(ok.stdout).not.toContain(USERSPEC_SECRET);

    // A forced failure carries a path + cause — still never the persona/userSpec.
    const fail = runBin({ spec: validSpec({ agentId: "leak-check" }), fail: ["config-validate"] });
    expect(fail.status).not.toBe(0);
    expect(fail.stderr).not.toContain(PERSONA_SECRET);
    expect(fail.stderr).not.toContain(USERSPEC_SECRET);
  });
});

// ===========================================================================
// Input channels — the --spec <path> fallback works alongside stdin.
// ===========================================================================
describe("input channels — the spec arrives via stdin (primary) OR a --spec file (fallback)", () => {
  it("a --spec <path> file drives an identical created outcome (no stdin needed)", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ agentId: "spec-file-shopper", name: "Spec File Shopper" });
    const r = runBin({ spec, viaSpecFile: true });
    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    expect(m["agentId"]).toBe("spec-file-shopper");
    expect(existsSync(profileJsonPath())).toBe(true);
  });
});

// ===========================================================================
// Precondition — no resolvable host openclaw.json ⇒ fail closed, nothing created.
// ===========================================================================
describe("precondition — no resolvable host config fails closed", () => {
  it("no config at any resolvable path ⇒ persistence_failed/precondition, non-zero, nothing created", () => {
    // Do NOT write openclaw.json; point every resolution knob at empty/missing dirs.
    const missingConfig = join(workdir, "nonexistent", "openclaw.json");
    const r = runBin({
      spec: validSpec(),
      env: {
        // Override the base env's OPENCLAW_CONFIG_PATH with a missing path, and use
        // an empty state dir + empty HOME so no candidate resolves.
        OPENCLAW_CONFIG_PATH: missingConfig,
        OPENCLAW_STATE_DIR: join(workdir, "no-state"),
      },
    });
    expect(r.status).not.toBe(0);
    const m = parseMarker(r.stderr);
    expect(m["status"]).toBe("persistence_failed");
    expect(r.stdout.includes("sil_shopper_created")).toBe(false);
    // Nothing fabricated, nothing created.
    expect(existsSync(missingConfig)).toBe(false);
    expect(existsSync(shopperDir())).toBe(false);
  });
});
