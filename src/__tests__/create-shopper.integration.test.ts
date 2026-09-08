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
 *                        artefacts materialized (shared user_spec.md whose frontmatter
 *                        carries the name — frontmatter-as-truth, no manifest, no
 *                        domain minted at create), the sil skill attached,
 *                        `sil` admitted at ALL THREE allow surfaces, exit 0, the
 *                        result carries the friendly `name` + the DERIVED `agentId`
 *                        (`agentId = deriveAgentId(name)` — no longer a spec input;
 *                        an empty/`main` slug folds SILENTLY to `sil-shopper`).
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
 * dist is built FROM THE CURRENT SOURCE — never a possibly-stale dist (a stale dist
 * silently tests old logic). That build is `globalSetup`'s (`helpers/build-dist.ts`):
 * once per run, installed by rename, so no bin ever reads a half-emitted module.
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
  beforeEach,
  afterEach,
} from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  openSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveAgentId } from "../lib/derive-agent-id.js";
import { resolveCreationEntrypoint } from "../lib/creation-entrypoint.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root of the checkout under test (…/src/__tests__ → root). */
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "create-shopper.mjs");

const SIL_ID = "sil";
/** The bundled skill's PUBLISHED name = the basename of the manifest's skills
 * ref (`./sil-shopping` → `sil-shopping`) — the key the host attaches a skill by
 * in the agent's `skills` array. Single-sourced from openclaw.plugin.json so a skill
 * rename tracks here automatically, and so this pins the create bin against the
 * manifest rather than a second literal. It is the skill NAME, NEVER the plugin
 * id `sil` — attaching the plugin id is the total skill-load failure this card
 * kills (the host looks up a skill named `sil`, finds none, `sil-shopping` never
 * loads). */
const SIL_SKILL = basename(
  (
    JSON.parse(
      readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"),
    ) as { skills: string[] }
  ).skills[0]!,
);
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
  /** Non-null only if the child was KILLED — i.e. it never terminated on its own. */
  signal: NodeJS.Signals | null;
}

/** Hard bound on a single bin run (~1 s in practice). Not a latency budget — a hang
 * detector, so a bin that waits on an open handle fails the run instead of wedging it. */
const RUN_TIMEOUT_MS = 20_000;

/** The endorsed create-shopper spec. `agentId` is NOT a field — the bin derives it
 * from `name` (`deriveAgentId`), so the user authors ONE friendly display name. */
interface Spec {
  name: string;
  workspace: string;
  persona: string;
  userSpec: string;
  /** Optional current-channel override for the step-10 bind (fail-open when absent). */
  channel?: string;
}

/**
 * The fake `openclaw` host CLI — a CommonJS script (a bare `openclaw` file with a
 * node shebang runs as CJS: no `.mjs` extension, no package.json in its temp dir).
 * It is a test double of the EXTERNAL binary boundary, NOT a stub of sil's logic.
 *
 * Contract (matches what the bin actually needs — the bin reads `agents list`/
 * `agents add` only by exit code, then re-reads the config FILE):
 *   agents list --json     → exit 0 (empty output is fine)               [fail: agents-list]
 *   agents add <id> …      → append {id,skills:[]} to agents.list — or, on an ENTRIES
 *                            host (OPENCLAW_SHIM_ROSTER=entries), write
 *                            agents.entries[<id>] = {skills:[]} instead; mkdir the
 *                            --workspace dir + bootstrap SOUL.md/AGENTS.md, exit 0
 *                                                                        [fail: agents-add]
 *   config set <path> <v>  → apply the set to openclaw.json, exit 0      [fail: config-set;
 *                            fail: config-set-literal ⇒ write the WHOLE path as ONE
 *                            literal key and still exit 0 — the silent misattach a host
 *                            that cannot parse the path performs]
 *   config get <path> --json → the value at <path>, or `null`. The attach read-back.
 *   config validate --json → {valid:true,path}                          [fail: config-validate
 *                            ⇒ {valid:false,path,issues,error}, exit 0]
 *   agents bind --agent <id> --bind <ch> --json
 *                          → push {type:route,agentId,match:{channel}} to bindings[]
 *                            + report {added:[ch]}; if <ch> is already bound to a
 *                            DIFFERENT agent, write NOTHING + report {conflicts:[…]}
 *                            (no --force, no auto-steal); ALWAYS exits 0 — the bin
 *                            reads the JSON verdict, never the exit code.  [fail:
 *                            bind-fail ⇒ persist the partial route but report a
 *                            NON-verifying verdict {added:[],updated:[],conflicts:[]}
 *                            — the "verdict says nothing applied ⇒ revert" case]
 *   agents bindings [--agent <id>] --json
 *                          → the bindings[] array as [{agentId,match,description}]
 *                            (filtered by --agent); the bind read-back / verify.
 *                            [read-back knob: OPENCLAW_SHIM_BINDINGS_EMPTY=1 ⇒ "[]"
 *                            even though the route was written — the "route absent on
 *                            read-back ⇒ unverifiable ⇒ revert the partial write" case]
 * config-validate fail knobs: `config-validate` (always fail) OR
 *   OPENCLAW_SHIM_VALIDATE_FAIL_BOUND_NTH=<N> ⇒ fail the Nth validate that sees a
 *   NON-EMPTY bindings[] (robust to the allowlist bin's own validate, which runs
 *   BEFORE the bind with bindings[] still empty). N=2 targets the final step-11
 *   validate while the step-10 bind-verify validate (N=1) passes — the "verified
 *   route, later step fails, teardown reverses the live route" case.
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

// Split a config path into segments: dots, "[N]" indexes, and the bracket-QUOTED
// keys 2026.8.1+ needs for hyphenated agent ids — "agents.list[0].skills",
// "plugins.entries.sil.enabled", 'agents.entries["my-shopper"].skills'.
function pathParts(path) {
  const parts = [];
  const seg = /\[(\d+)\]|\["([^"]*)"\]|\['([^']*)'\]|([^.\[\]]+)/g;
  let m;
  while ((m = seg.exec(path)) !== null) {
    if (m[1] !== undefined) parts.push(Number(m[1]));
    else parts.push(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]);
  }
  return parts;
}

function setPath(obj, path, val) {
  const parts = pathParts(path);
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

function getPath(obj, path) {
  let cur = obj;
  for (const k of pathParts(path)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return cur;
}

const a0 = argv[0];
const a1 = argv[1];

if (a0 === "agents" && a1 === "list") {
  if (fails.includes("agents-list")) die("agents list forced failure");
  let ids = [];
  try {
    const roster = readCfg().agents || {};
    if (roster.entries && typeof roster.entries === "object") ids = Object.keys(roster.entries);
    else if (Array.isArray(roster.list)) ids = roster.list.map((x) => x && x.id);
  } catch (e) {}
  process.stdout.write(JSON.stringify({ agents: ids.map((id) => ({ id: id })) }) + "\n");
  process.exit(0);
}

if (a0 === "agents" && a1 === "add") {
  if (fails.includes("agents-add")) die("agents add forced failure");
  const id = argv[2];
  const wsIdx = argv.indexOf("--workspace");
  const ws = wsIdx >= 0 ? argv[wsIdx + 1] : null;
  const c = readCfg();
  if (!c.agents || typeof c.agents !== "object") c.agents = {};
  // 2026.8.1+ keeps the roster as a MAP keyed by id; <=2026.7.1 as an ARRAY. A live
  // host has exactly one of the two, never both.
  if (process.env.OPENCLAW_SHIM_ROSTER === "entries") {
    if (!c.agents.entries || typeof c.agents.entries !== "object") c.agents.entries = {};
    c.agents.entries[id] = { skills: [] };
  } else {
    if (!Array.isArray(c.agents.list)) c.agents.list = [];
    c.agents.list.push({ id: id, skills: [] });
  }
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
  // A host that cannot parse the path writes it as ONE literal key and still exits 0.
  if (fails.includes("config-set-literal")) c[path] = val;
  else setPath(c, path, val);
  writeCfg(c);
  process.exit(0);
}

if (a0 === "config" && a1 === "get") {
  const v = getPath(readCfg(), argv[2]);
  process.stdout.write(JSON.stringify(v === undefined ? null : v) + "\n");
  process.exit(0);
}

if (a0 === "agents" && a1 === "bind") {
  const agIdx = argv.indexOf("--agent");
  const agentId = agIdx >= 0 ? argv[agIdx + 1] : null;
  const bIdx = argv.indexOf("--bind");
  const channel = bIdx >= 0 ? argv[bIdx + 1] : null;
  const c = readCfg();
  if (!Array.isArray(c.bindings)) c.bindings = [];
  const existing = c.bindings.find((b) => b && b.match && b.match.channel === channel);
  // A channel already routed to a DIFFERENT agent conflicts — write NOTHING, keep the
  // prior owner. No --force, no auto-steal. Still exits 0 (verdict, not exit code).
  if (existing && existing.agentId !== agentId) {
    process.stdout.write(JSON.stringify({ agentId, added: [], updated: [], skipped: [], conflicts: [channel + " (agent=" + existing.agentId + ")"] }) + "\n");
    process.exit(0);
  }
  if (existing && existing.agentId === agentId) {
    process.stdout.write(JSON.stringify({ agentId, added: [], updated: [channel], skipped: [], conflicts: [] }) + "\n");
    process.exit(0);
  }
  if (fails.includes("bind-fail")) {
    // A partial write that does NOT verify: persist the route (so there is a partial
    // binding to revert) but report NOTHING applied — empty added+updated, no conflict.
    // The bind exits 0 regardless, so the bin must reject this on the JSON verdict.
    c.bindings.push({ type: "route", agentId: agentId, match: { channel: channel } });
    writeCfg(c);
    process.stdout.write(JSON.stringify({ agentId, added: [], updated: [], skipped: [], conflicts: [] }) + "\n");
    process.exit(0);
  }
  c.bindings.push({ type: "route", agentId: agentId, match: { channel: channel } });
  writeCfg(c);
  process.stdout.write(JSON.stringify({ agentId, added: [channel], updated: [], skipped: [], conflicts: [] }) + "\n");
  process.exit(0);
}

if (a0 === "agents" && a1 === "bindings") {
  // The unverifiable-bind knob: the route was written, but the read-back doesn't
  // reflect it ⇒ the bin cannot verify ⇒ it reverts the partial write.
  if (process.env.OPENCLAW_SHIM_BINDINGS_EMPTY === "1") { process.stdout.write("[]\n"); process.exit(0); }
  let list = [];
  try { const c = readCfg(); if (Array.isArray(c.bindings)) list = c.bindings; } catch (e) {}
  const agIdx = argv.indexOf("--agent");
  const agentId = agIdx >= 0 ? argv[agIdx + 1] : null;
  const filtered = agentId ? list.filter((b) => b && b.agentId === agentId) : list;
  process.stdout.write(JSON.stringify(filtered.map((b) => ({ agentId: b.agentId, match: b.match, description: b.description || "" }))) + "\n");
  process.exit(0);
}

if (a0 === "config" && a1 === "validate") {
  let hasRoute = false;
  try { const c = readCfg(); hasRoute = Array.isArray(c.bindings) && c.bindings.length > 0; } catch (e) {}
  const failBoundNth = Number(process.env.OPENCLAW_SHIM_VALIDATE_FAIL_BOUND_NTH || "0");
  let boundN = 0;
  if (hasRoute && failBoundNth > 0) {
    const counterPath = cfgPath + ".vcount";
    try { boundN = Number(readFileSync(counterPath, "utf8")) || 0; } catch (e) { boundN = 0; }
    boundN += 1;
    try { writeFileSync(counterPath, String(boundN)); } catch (e) {}
  }
  if (fails.includes("config-validate") || (failBoundNth > 0 && hasRoute && boundN === failBoundNth)) {
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

/** A valid, endorsed spec (secrets planted in persona/userSpec). Channel-less by
 * default — the fail-open "undetermined channel" baseline; pass `channel` to drive
 * the step-10 bind. */
function validSpec(overrides: Partial<Spec> = {}): Spec {
  const name = overrides.name ?? "My Shopper";
  const spec: Spec = {
    name,
    workspace: overrides.workspace ?? join(workdir, `workspace-${deriveAgentId(name)}`),
    persona: overrides.persona ?? `A careful generalist buyer. ${PERSONA_SECRET}`,
    userSpec: overrides.userSpec ?? `Ships to Athens; UK size 10; ${USERSPEC_SECRET}`,
  };
  if (overrides.channel !== undefined) spec.channel = overrides.channel;
  return spec;
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
  /** Redirect the child's stdout/stderr to real FILES instead of pipes. */
  toFiles?: boolean;
}

/** The hermetic, explicit env every spawn of the bin runs under. */
function binEnv(opts: RunOpts = {}): Record<string, string> {
  return {
    PATH: `${binDir}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
    HOME: emptyHome,
    OPENCLAW_CONFIG_PATH: configPath,
    SIL_DATA_DIR: dataDir,
    OPENCLAW_SHIM_LOG: logPath,
    ...(opts.fail && opts.fail.length ? { OPENCLAW_SHIM_FAIL: opts.fail.join(",") } : {}),
    ...(opts.env ?? {}),
  };
}

/** `[SCRIPT, …]` plus the stdin body, per the chosen input channel. */
function binArgs(opts: RunOpts): { args: string[]; input: string } {
  const args = [SCRIPT];
  if (opts.stdin !== undefined) return { args, input: opts.stdin };
  if (!opts.spec) return { args, input: "" };
  if (!opts.viaSpecFile) return { args, input: JSON.stringify(opts.spec) };
  const specPath = join(workdir, "spec.json");
  writeFileSync(specPath, JSON.stringify(opts.spec));
  args.push("--spec", specPath);
  return { args, input: "" };
}

/** Spawn the bin as a child process with a hermetic, explicit env. */
function runBin(opts: RunOpts = {}): RunResult {
  const { args, input } = binArgs(opts);
  const env = binEnv(opts);

  const outPath = join(workdir, "bin-stdout.txt");
  const errPath = join(workdir, "bin-stderr.txt");
  const fds = opts.toFiles ? [openSync(outPath, "w"), openSync(errPath, "w")] : null;

  // `spawnSync`, never `execFileSync`: the latter returns ONLY stdout on success, so
  // the whole success path was blind to a child that crashed and still exited 0 — the
  // diagnostic hole this card's root cause hid behind for a day.
  // `process.execPath`, never the bare "node": the ClawHub-channel tests below hand
  // this an env whose PATH holds ONLY the `openclaw` shim, and a PATH lookup for the
  // interpreter itself would fail there for a reason unrelated to what they prove.
  try {
    const r = spawnSync(process.execPath, args, {
      input,
      env,
      encoding: "utf8",
      stdio: fds ? ["pipe", fds[0]!, fds[1]!] : ["pipe", "pipe", "pipe"],
      timeout: RUN_TIMEOUT_MS,
      // Generous: the >64 KB-marker test emits ~500 KB. An ENOBUFS truncation would
      // read exactly like the marker truncation under test.
      maxBuffer: 32 * 1024 * 1024,
    });
    if (r.error && (r.error as NodeJS.ErrnoException).code !== "ETIMEDOUT") {
      throw new Error(`spawning the bin failed outright: ${r.error.message}`);
    }
    return {
      status: r.status ?? 1,
      stdout: fds ? readFileSync(outPath, "utf8") : (r.stdout ?? ""),
      stderr: fds ? readFileSync(errPath, "utf8") : (r.stderr ?? ""),
      signal: r.signal,
    };
  } finally {
    for (const fd of fds ?? []) closeSync(fd);
  }
}

/** Run the bin with a real PTY on fd 1/2 (util-linux `script`). A terminal merges the
 * two streams, so this returns ONE `merged` text — never split it back apart. */
function runBinOnPty(spec: Spec): { status: number; signal: NodeJS.Signals | null; merged: string } {
  const specPath = join(workdir, "pty-spec.json");
  writeFileSync(specPath, JSON.stringify(spec));
  const command = [process.execPath, SCRIPT, "--spec", specPath].map((a) => `'${a}'`).join(" ");
  const r = spawnSync("script", ["-q", "-e", "-c", command, "/dev/null"], {
    env: binEnv(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw new Error(`spawning \`script\` failed outright: ${r.error.message}`);
  // The pty line discipline maps \n → \r\n; that \r is the terminal's, not the bin's.
  return { status: r.status ?? 1, signal: r.signal, merged: (r.stdout ?? "").replace(/\r\n/g, "\n") };
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
const userSpecPath = () => join(shopperDir(), "user_spec.md");

/** Seed a pre-existing SINGLETON shopper — user_spec.md whose FRONTMATTER carries the
 * shopper name — so the bin's `readShopperIdentity()` pre-flight sees a named shopper
 * ⇒ collision. Frontmatter-as-truth: there is NO profile.json manifest. */
function seedExistingShopper(): void {
  mkdirSync(shopperDir(), { recursive: true });
  writeFileSync(
    userSpecPath(),
    "---\nname: Existing Shopper\n---\n# Existing shopper user spec\nships to Berlin\n",
  );
}

// ===========================================================================
// created — the happy path: every surface wired, exit 0, identity returned.
// ===========================================================================
describe("created — one valid run wires every surface and returns the identity", () => {
  it("exits 0 with status:created; the result carries the friendly name + the DERIVED agentId", () => {
    writeConfig(freshConfig());
    const spec = validSpec(); // name "My Shopper" ⇒ derived agentId "my-shopper"
    const r = runBin({ spec });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["event"]).toBe("sil_shopper_created");
    expect(m["status"]).toBe("created");
    // The friendly display name rides back verbatim …
    expect(m["name"]).toBe("My Shopper");
    // … and the agentId is the lower-kebab id DERIVED from it — a concrete literal,
    // never echoed from an input (agentId is no longer a spec field).
    expect(m["agentId"]).toBe("my-shopper");
  });

  it("materializes the sil artefacts — shared user_spec.md (frontmatter name), NO manifest, NO domains at create", () => {
    writeConfig(freshConfig());
    const spec = validSpec();
    const r = runBin({ spec });
    expect(r.status).toBe(0);

    // Frontmatter-as-truth: the shopper name lives in user_spec.md's own frontmatter.
    expect(existsSync(userSpecPath())).toBe(true);
    const userSpec = readFileSync(userSpecPath(), "utf8");
    expect(userSpec.startsWith("---")).toBe(true);
    expect(userSpec).toMatch(new RegExp("name:\\s*" + spec.name));
    expect(userSpec).toContain(USERSPEC_SECRET);
    // No profile.json manifest anywhere; no per-domain packs authored at create.
    expect(existsSync(join(shopperDir(), "profile.json"))).toBe(false);
    expect(existsSync(join(shopperDir(), "domains"))).toBe(false);
  });

  it("writes the persona into SOUL.md AND appends the sil creed (identity-level reinforcement)", () => {
    writeConfig(freshConfig());
    const spec = validSpec();
    const r = runBin({ spec });
    expect(r.status).toBe(0);

    const soul = join(spec.workspace, "SOUL.md");
    expect(existsSync(soul)).toBe(true);
    const soulText = readFileSync(soul, "utf8");
    // The persona survives verbatim — the creed is APPENDED after it, never a replacement.
    expect(soulText).toContain(PERSONA_SECRET);
    // The sil creed is baked into SOUL.md at IDENTITY level (a philosophy, not a rulebook —
    // the mechanics live in the attached skill). Tolerant markers, not whole sentences:
    // its heading, the `explore first` mantra, memory via the shopper's own documents,
    // and the one distinction that matters — the catalog is where you buy, the web is
    // where you learn. The memory marker moved `sil_learn` → `sil_doc_read`: a creed
    // that names a deleted tool teaches the shopper an unreachable move at identity
    // level, which is the loudest possible place to be wrong.
    expect(soulText).toContain("## The sil way");
    expect(soulText).toMatch(/explore first/i);
    expect(soulText).toContain("sil_doc_read");
    expect(soulText).not.toContain("sil_learn");
    expect(soulText).toMatch(/catalog is where you buy/i);
    // The persona + creed live in exactly one place — never a sil persona.md.
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
    // Wiring — the host agent exists with the sil skill attached BY ITS PUBLISHED
    // NAME (`sil-shopping` = manifest skills basename), the key the host resolves a
    // skill by — NEVER the plugin id `sil` (attaching the plugin id is the bug this
    // card kills: the host finds no skill named `sil` and `sil-shopping` never loads).
    const agent = c.agents.list.find((a: any) => a.id === deriveAgentId(spec.name));
    expect(agent).toBeTruthy();
    expect(agent.skills).toEqual([SIL_SKILL]);
  });

  it("sets NO per-agent tools policy on the shopper — it inherits the host defaults (no deny, no profile override)", () => {
    writeConfig(freshConfig());
    const spec = validSpec();
    const r = runBin({ spec });
    expect(r.status).toBe(0);

    const c = readConfig();
    // The shopper inherits the host's default toolset untouched. There is NO per-agent
    // tools.deny (an fs-mutator deny is inert while codex's own shell stays open, by
    // design — it reads the shopper's skill files and writes regardless) and NO
    // tools.profile override — only the sil skill is attached to the agent entry.
    const idx = c.agents.list.findIndex((a: any) => a.id === deriveAgentId(spec.name));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(c.agents.list[idx].tools?.deny).toBeUndefined();
    expect(c.agents.list[idx].tools?.profile).toBeUndefined();
    // The global default is untouched (freshConfig ships `coding`).
    expect(c.tools.profile).toBe("coding");
  });

  it("carries an EMPTY warnings array when the channel binds cleanly (no manual-bind hint)", () => {
    // With a resolvable channel that binds + verifies, the manual-bind hint is absent —
    // a clean bind is the happy path, so it rides no warning.
    writeConfig(freshConfig());
    const r = runBin({ spec: validSpec({ channel: "telegram" }) });
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
// invalid_request — validate-first: a bad/blank field ⇒ NOTHING attempted.
// ===========================================================================
describe("invalid_request — validate-first refuses a bad/blank spec, attempting NOTHING", () => {
  const REQUIRED: ReadonlyArray<keyof Spec> = [
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

  // NOTE: there is NO invalid_request for a bad/reserved/non-kebab agentId anymore —
  // agentId is no longer a spec input. Slugify + the sil-shopper fallback GUARANTEE a
  // conforming id, so that entire user-facing failure mode is gone (BR5). The former
  // `main` and non-kebab agentId-INPUT rejections are REPLACED by the derive-side
  // fallbacks below (a name slugging to `main`/empty folds to sil-shopper, still created).
});

// ===========================================================================
// derive — agentId is DERIVED from the friendly display name (no agentId input).
// The single friendly `name` is the ONLY identity the user supplies; the bin
// derives `agentId = deriveAgentId(name)` and the id never surfaces as a second
// thing they had to author. Empty/`main` slugs fold to `sil-shopper`, SILENTLY.
// ===========================================================================
describe("derive — the agentId is slugified from the display name (no agentId input)", () => {
  it("name → derived lower-kebab id round-trips into the result, agents.list, AND the skill attach", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ name: "My Shopper" });
    const r = runBin({ spec });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    // Result carries the DERIVED id as a concrete literal (proves the derivation).
    expect(m["agentId"]).toBe("my-shopper");
    // The SAME id keys the new agents.list entry, and the sil skill is attached to it.
    const c = readConfig();
    const agent = c.agents.list.find((a: any) => a.id === "my-shopper");
    expect(agent, "expected an agents.list entry keyed by the derived id").toBeTruthy();
    expect(agent.skills).toEqual([SIL_SKILL]);
  });

  it('an emoji-only name (empty slug) folds to the sil-shopper fallback — created, never ""', () => {
    writeConfig(freshConfig());
    const spec = validSpec({ name: "🛍️" });
    const r = runBin({ spec });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    expect(m["agentId"]).toBe("sil-shopper");
    // The host never sees an empty id — the fallback lands in agents.list, not "".
    const c = readConfig();
    expect(c.agents.list.some((a: any) => a.id === "sil-shopper")).toBe(true);
    expect(c.agents.list.some((a: any) => a.id === "")).toBe(false);
  });

  it("a punctuation-only name (empty slug) folds to the sil-shopper fallback — created", () => {
    writeConfig(freshConfig());
    const r = runBin({ spec: validSpec({ name: "!!!" }) });
    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    expect(m["agentId"]).toBe("sil-shopper");
  });

  it("a name whose slug is the reserved `main` folds to sil-shopper — created, never `main`", () => {
    writeConfig(freshConfig());
    const r = runBin({ spec: validSpec({ name: "Main" }) });
    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    expect(m["agentId"]).toBe("sil-shopper");
    expect(m["agentId"]).not.toBe("main");
    // The host-reserved id is never added as an agent.
    const c = readConfig();
    expect(c.agents.list.some((a: any) => a.id === "main")).toBe(false);
  });

  it("the friendly name is stored verbatim AND returned DISTINCT from the derived id", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ name: "My Shopper" });
    const r = runBin({ spec });
    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    // The one friendly display name is preserved — verbatim in the result …
    expect(m["name"]).toBe("My Shopper");
    // … and verbatim in user_spec.md frontmatter (frontmatter-as-truth) …
    const userSpec = readFileSync(userSpecPath(), "utf8");
    expect(userSpec).toMatch(/name:\s*My Shopper/);
    // … while the derived id is a DISTINCT value (the user authored one name, not two).
    expect(m["agentId"]).toBe("my-shopper");
    expect(m["name"]).not.toBe(m["agentId"]);
  });

  it("the empty/main fallback is SILENT — status is exactly created with NO warnings entry for it (BR4)", () => {
    // A resolvable channel binds + verifies, so the ONLY thing that could add a warning
    // is the id fallback. BR4: the fallback adds NONE — a deterministic derivation is
    // not a convenience that failed to fire. warnings must be exactly [].
    writeConfig(freshConfig());
    const r = runBin({ spec: validSpec({ name: "Main", channel: "telegram" }) });
    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    expect(m["agentId"]).toBe("sil-shopper");
    // Silent fallback: the bind was clean, so warnings is empty — no id-fallback notice.
    expect(Array.isArray(m["warnings"])).toBe(true);
    expect(m["warnings"]).toEqual([]);
    // The bind still worked with the fallback id (nothing about the id blocks it).
    expect(m["boundChannel"]).toBe("telegram");
    // The fallback minted no new status — the taxonomy is unchanged.
    expect(m["status"]).not.toBe("invalid_request");
  });

  it("a STRAY `agentId` key in a hand-fed spec is IGNORED (not read, not rejected) — Q2", () => {
    // The user-facing contract is "agentId is not an input." A stray key must neither be
    // honored (the derived id from `name` wins) NOR rejected (no back-compat reject path).
    writeConfig(freshConfig());
    const strayed = { ...validSpec({ name: "My Shopper" }), agentId: "totally-different" };
    const r = runBin({ stdin: JSON.stringify(strayed) });
    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    // Derived from `name`, NOT taken from the stray key.
    expect(m["agentId"]).toBe("my-shopper");
    expect(m["agentId"]).not.toBe("totally-different");
    const c = readConfig();
    expect(c.agents.list.some((a: any) => a.id === "totally-different")).toBe(false);
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
    const preUserSpec = readFileSync(userSpecPath(), "utf8");

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
    expect(readFileSync(userSpecPath(), "utf8")).toBe(preUserSpec);
  });

  it("a second run AFTER a successful created hits the same singleton gate (never a duplicate shopper)", () => {
    writeConfig(freshConfig());
    const first = runBin({ spec: validSpec() });
    expect(first.status).toBe(0);
    expect(parseMarker(first.stdout)["status"]).toBe("created");

    // Second run — a DIFFERENT name (⇒ a different derived id), yet the singleton gate
    // (keyed on the shopper store, not the id) still catches it before any add.
    rmSync(logPath, { force: true });
    const second = runBin({ spec: validSpec({ name: "Second" }) });
    expect(second.status).not.toBe(0);
    expect(parseMarker(second.stderr)["status"]).toBe("collision");
    expect(shimLog()).not.toContain("agents add");
  });
});

describe("collision — an agentId clash on the DERIVED id refuses without overwriting the existing agent", () => {
  it("the id the name DERIVES to already sits in agents.list (no shopper yet) ⇒ collision, existing agent untouched, no shopper dir", () => {
    // Seed the clash on `deriveAgentId("My Shopper")` = "my-shopper" — the DERIVED id,
    // not an input id (agentId is no longer fed in). A pre-existing non-shopper agent on
    // that id must block the create fail-closed (BR7).
    const cfg = freshConfig() as any;
    cfg.agents = { list: [{ id: deriveAgentId("My Shopper"), skills: ["other"], workspace: "/pre/existing" }] };
    writeConfig(cfg);
    const preConfig = readFileSync(configPath, "utf8");

    const r = runBin({ spec: validSpec({ name: "My Shopper" }) });

    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("collision");
    // Never overwrote the existing agent, never minted a shopper dir.
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    expect(existsSync(shopperDir())).toBe(false);
  });
});

// ===========================================================================
// The 2026.8.1+ roster shape. Every test above drives the <=2026.7.1
// `agents.list` ARRAY; `openclaw agents add` on a migrated host writes an
// `agents.entries` MAP keyed by id instead, and the skill must attach at the
// bracket-QUOTED `agents.entries["<id>"].skills` — a bare dot-path splits a
// hyphenated id. The two shapes never coexist on a live host, so these runs
// carry NO agents.list at all. Creation was fail-closed-broken on every 2026.8.1+
// gateway until the bin read both shapes; nothing here re-drives the array.
// ===========================================================================

/** A host whose `openclaw agents add` writes the 2026.8.1+ roster map. */
const ENTRIES_HOST = { OPENCLAW_SHIM_ROSTER: "entries" };

describe("entries roster (2026.8.1+) — the skill lands where a migrated host looks", () => {
  it('attaches at agents.entries["<id>"].skills, never as a literal bracketed key', () => {
    writeConfig(freshConfig());
    // A HYPHENATED id on purpose: it is the id a bare dot-path would split into
    // `executive` / `shopper`, which is why the entries key is bracket-quoted.
    const spec = validSpec({ name: "Executive Shopper" });
    const r = runBin({ spec, env: ENTRIES_HOST });

    expect(r.status).toBe(0);
    expect(parseMarker(r.stdout)["status"]).toBe("created");

    const c = readConfig();
    expect(c.agents.entries["executive-shopper"].skills).toEqual([SIL_SKILL]);
    // The silent misattach this pins shut: the path landing as ONE literal key
    // (`agents['entries["executive-shopper"]']`, or the whole path at the root).
    expect(Object.keys(c.agents).filter((k) => k.includes("["))).toEqual([]);
    expect(Object.keys(c).filter((k) => k.includes("["))).toEqual([]);
    // A migrated host grew no array — the bin must not have fabricated one.
    expect(c.agents.list).toBeUndefined();
  });

  it("the DERIVED id already keys agents.entries ⇒ collision, existing agent untouched, never added over", () => {
    // The list-shape twin of this test seeds `agents.list`; on a migrated host the
    // clash source is the MAP's keys, and a bin reading only the array sees an empty
    // roster and overwrites the operator's agent.
    const cfg = freshConfig() as any;
    cfg.agents = {
      entries: { [deriveAgentId("My Shopper")]: { skills: ["other"], workspace: "/pre/existing" } },
    };
    writeConfig(cfg);
    const preConfig = readFileSync(configPath, "utf8");

    const r = runBin({ spec: validSpec({ name: "My Shopper" }), env: ENTRIES_HOST });

    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["status"]).toBe("collision");
    expect(shimLog()).not.toContain("agents add");
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    expect(existsSync(shopperDir())).toBe(false);
  });

  it("a `config set` that exits 0 having written the WRONG key ⇒ persistence_failed, never created over an unattached skill", () => {
    // The read-back's reason for existing. A host that cannot parse the path writes
    // one literal key and exits 0; every later gate — the allowlist merge, `config
    // validate` — passes over it, so WITHOUT the read-back this run declares `created`
    // with the skill attached nowhere. That is the failure the whole fix exists to stop.
    writeConfig(freshConfig());
    const preConfig = readFileSync(configPath, "utf8");
    const spec = validSpec({ name: "Executive Shopper" });

    const r = runBin({ spec, env: ENTRIES_HOST, fail: ["config-set-literal"] });

    expect(r.status).not.toBe(0);
    const m = parseMarker(r.stderr);
    expect(m["status"]).toBe("persistence_failed");
    expect(r.stdout.includes("sil_shopper_created")).toBe(false);
    // The read-back ran, and the cause names the skill that never stuck.
    expect(shimLog()).toContain("config get");
    expect(String(m["cause"])).toContain(SIL_SKILL);
    // Teardown reverted the literal key and everything else this run wrote.
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    expect(existsSync(shopperDir())).toBe(false);
    expect(existsSync(spec.workspace)).toBe(false);
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

    // BOTH streams of BOTH runs: until this card `runBin` hardcoded `stderr: ""` on
    // the success path, so this check could only ever see half the output.
    const ok = runBin({ spec: validSpec() });
    expect(ok.status).toBe(0);
    for (const stream of [ok.stdout, ok.stderr]) {
      expect(stream).not.toContain(PERSONA_SECRET);
      expect(stream).not.toContain(USERSPEC_SECRET);
    }

    // A forced failure carries a path + cause — still never the persona/userSpec.
    const fail = runBin({ spec: validSpec({ name: "Leak Check" }), fail: ["config-validate"] });
    expect(fail.status).not.toBe(0);
    for (const stream of [fail.stdout, fail.stderr]) {
      expect(stream).not.toContain(PERSONA_SECRET);
      expect(stream).not.toContain(USERSPEC_SECRET);
    }
  });
});

// ===========================================================================
// Input channels — the --spec <path> fallback works alongside stdin.
// ===========================================================================
describe("input channels — the spec arrives via stdin (primary) OR a --spec file (fallback)", () => {
  it("a --spec <path> file drives an identical created outcome (no stdin needed)", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ name: "Spec File Shopper" });
    const r = runBin({ spec, viaSpecFile: true });
    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    // agentId is DERIVED from the name even on the --spec-file path.
    expect(m["agentId"]).toBe("spec-file-shopper");
    expect(existsSync(userSpecPath())).toBe(true);
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

// ===========================================================================
// bind-the-channel — creating a shopper from a channel session re-routes THAT
// channel to the new shopper by DEFAULT, FAIL-OPEN. The route lives in
// openclaw.json `bindings[]` (the same whole-file teardown anchor), so every
// reversal is the existing snapshot-restore — no orphaned routing ever survives.
//
// The five behaviours pinned here (the card's acceptance criteria):
//   1. bound-on-create   — a resolvable channel binds + VERIFIES ⇒ created, route
//                          present, config valid, `boundChannel` named, NO warning.
//   2. fail-open         — no resolvable channel ⇒ created(exit 0) + manual-bind
//                          warning + NO bindings[] entry (bind never attempted).
//   3. unverifiable      — bind can't be verified ⇒ partial route reverted, config
//                          valid, STILL created + warning (never a torn-down shopper).
//   4. conflict/no-steal — channel already owned ⇒ no --force, prior owner kept,
//                          created + warning.
//   5. whole-create revert — a VERIFIED route then a later step fails ⇒ the whole-
//                          create teardown restores openclaw.json BYTE-IDENTICAL.
//
// THESE ASSERTIONS ARE THE SPEC. Do NOT weaken them to match the bin.
// ===========================================================================

/** The `<agentId> → <channel>` route the shim persists into `bindings[]`, or undefined. */
function routeFor(bindings: unknown, agentId: string, channel: string): any {
  return (Array.isArray(bindings) ? bindings : []).find(
    (b: any) => b && b.agentId === agentId && b.match && b.match.channel === channel,
  );
}

/** Does any created warning name the manual-bind fallback? (intent, not exact copy) */
function hasManualBindWarning(warnings: unknown): boolean {
  return (
    Array.isArray(warnings) && warnings.some((w) => typeof w === "string" && /\bbind\b/i.test(w))
  );
}

describe("bind-the-channel — a resolvable channel binds the new shopper by default (verified)", () => {
  it("spec.channel supplied ⇒ created, route present in bindings[], config valid, boundChannel named, NO manual-bind warning", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ channel: "telegram" });

    const r = runBin({ spec });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    // The route was actually written into openclaw.json bindings[] …
    const route = routeFor(readConfig().bindings, deriveAgentId(spec.name), "telegram");
    expect(route, "expected a bindings[] route <shopper> → telegram").toBeTruthy();
    expect(route.match.channel).toBe("telegram");
    expect(route.agentId).toBe(deriveAgentId(spec.name));
    // … the bind WRITE was actually issued against the host …
    expect(shimLog()).toContain("agents bind --agent");
    // … the created result NAMES the bound channel (honesty rail: reported ⇒ verified) …
    expect(m["boundChannel"]).toBe("telegram");
    // … and carries NO manual-bind warning (a verified bind never warns).
    expect(m["warnings"]).toEqual([]);
  });

  it("OPENCLAW_MCP_MESSAGE_CHANNEL supplies the channel when spec omits it (env auto-detect path)", () => {
    writeConfig(freshConfig());
    const spec = validSpec(); // no spec.channel — the env is the only source

    const r = runBin({ spec, env: { OPENCLAW_MCP_MESSAGE_CHANNEL: "telegram" } });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    expect(routeFor(readConfig().bindings, deriveAgentId(spec.name), "telegram")).toBeTruthy();
    expect(m["boundChannel"]).toBe("telegram");
    expect(m["warnings"]).toEqual([]);
  });

  it("spec.channel WINS over the env channel (precedence: spec > env) — only the spec channel is bound", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ channel: "telegram" });

    const r = runBin({ spec, env: { OPENCLAW_MCP_MESSAGE_CHANNEL: "whatsapp" } });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["boundChannel"]).toBe("telegram");
    expect(routeFor(readConfig().bindings, deriveAgentId(spec.name), "telegram")).toBeTruthy();
    // The env channel was NOT bound — spec took precedence, and there is no second route.
    expect(routeFor(readConfig().bindings, deriveAgentId(spec.name), "whatsapp")).toBeFalsy();
  });
});

describe("bind-the-channel — fail-open: an undetermined channel still creates (warning, no routing)", () => {
  it("no spec.channel and no env channel ⇒ created(exit 0) + manual-bind warning + NO bindings[] entry, bind never attempted", () => {
    writeConfig(freshConfig());
    const spec = validSpec(); // no channel anywhere

    const r = runBin({ spec });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    // Fail-open: the shopper is real, but the channel could not be auto-routed.
    expect(hasManualBindWarning(m["warnings"]), "expected a manual-bind warning").toBe(true);
    // The hint must (a) name the shopper and (b) name a concrete one-command manual
    // step — never imply a broken create (product business rules).
    const hint = (m["warnings"] as string[]).find((w) => /\bbind\b/i.test(w)) ?? "";
    expect(hint).toContain(deriveAgentId(spec.name));
    expect(hint).toMatch(/agents bind|\/agent/i);
    // No routing written, and the bind was never even attempted (no channel to bind).
    expect(readConfig().bindings ?? []).toEqual([]);
    expect(shimLog()).not.toContain("agents bind --agent");
    // boundChannel is NOT claimed when nothing was bound (honesty rail).
    expect(m["boundChannel"] ?? null).toBeNull();
  });

  it("a blank/whitespace spec.channel with no env ⇒ treated as undetermined (fail-open warning, no routing)", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ channel: "   " });

    const r = runBin({ spec });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    expect(hasManualBindWarning(m["warnings"])).toBe(true);
    expect(readConfig().bindings ?? []).toEqual([]);
    expect(shimLog()).not.toContain("agents bind --agent");
    expect(m["boundChannel"] ?? null).toBeNull();
  });
});

describe("bind-the-channel — an unverifiable bind reverts the partial route (fail-open + honesty rail)", () => {
  it("the bind verdict reports NOTHING applied (bind-fail) ⇒ partial route reverted, config valid, created + warning, NO bindings[]", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ channel: "telegram" });

    const r = runBin({ spec, fail: ["bind-fail"] });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    // Never a torn-down shopper over a convenience shortfall.
    expect(m["status"]).toBe("created");
    // The bind WAS attempted (proving this exercises the revert path) …
    expect(shimLog()).toContain("agents bind --agent");
    // … but the unverifiable partial route was reverted — none survives.
    expect(readConfig().bindings ?? []).toEqual([]);
    // … the honesty rail holds: a warning, and NO claimed boundChannel.
    expect(hasManualBindWarning(m["warnings"])).toBe(true);
    expect(m["boundChannel"] ?? null).toBeNull();
  });

  it("the read-back does NOT show the route (write didn't stick) ⇒ reverted, created + warning, NO bindings[]", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ channel: "telegram" });

    // The write reports success but the read-back is empty — the bin must not trust
    // the write alone; it verifies via read-back and reverts when the route is absent.
    const r = runBin({ spec, env: { OPENCLAW_SHIM_BINDINGS_EMPTY: "1" } });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    expect(shimLog()).toContain("agents bind --agent");
    expect(readConfig().bindings ?? []).toEqual([]);
    expect(hasManualBindWarning(m["warnings"])).toBe(true);
    expect(m["boundChannel"] ?? null).toBeNull();
  });
});

describe("bind-the-channel — a conflicting channel is NOT stolen (no --force; prior owner kept)", () => {
  it("channel already bound to another agent ⇒ created + manual-bind warning, no steal, prior binding intact, shopper gets NO route", () => {
    const cfg = freshConfig() as any;
    cfg.bindings = [{ type: "route", agentId: "other-agent", match: { channel: "telegram" } }];
    writeConfig(cfg);
    const spec = validSpec({ channel: "telegram" });

    const r = runBin({ spec });

    expect(r.status).toBe(0);
    const m = parseMarker(r.stdout);
    expect(m["status"]).toBe("created");
    // No steal: the bin never passes --force, and never claims the channel.
    expect(shimLog()).not.toContain("--force");
    expect(m["boundChannel"] ?? null).toBeNull();
    expect(hasManualBindWarning(m["warnings"])).toBe(true);
    // The prior owner's route survives EXACTLY; the shopper got NO route.
    const bindings = readConfig().bindings;
    expect(routeFor(bindings, "other-agent", "telegram")).toBeTruthy();
    expect(routeFor(bindings, deriveAgentId(spec.name), "telegram")).toBeFalsy();
    expect(bindings).toEqual([
      { type: "route", agentId: "other-agent", match: { channel: "telegram" } },
    ]);
  });
});

describe("bind-the-channel — a VERIFIED route is reversed by whole-create teardown (no orphaned routing)", () => {
  it("channel bound + verified, then a LATER step fails ⇒ openclaw.json byte-identical to pre-run, no route left pointing at the absent shopper", () => {
    // The bind at step 10 persists + VERIFIES (its own bind-verify validate passes),
    // then the FINAL step-11 validate is the one that fails — a failure strictly AFTER
    // a live, verified route. The shim's OPENCLAW_SHIM_VALIDATE_FAIL_BOUND_NTH=2 fails
    // only the 2nd validate that SEES a non-empty bindings[] (N=1 = the bind-verify,
    // which passes; N=2 = the final validate, which fails) — so the route genuinely
    // survives into teardown and the whole-file snapshot-restore must reverse it.
    writeConfig(freshConfig());
    const preConfig = readFileSync(configPath, "utf8");
    const spec = validSpec({ channel: "telegram" });

    const r = runBin({ spec, env: { OPENCLAW_SHIM_VALIDATE_FAIL_BOUND_NTH: "2" } });

    expect(r.status).not.toBe(0);
    const m = parseMarker(r.stderr);
    expect(m["status"]).toBe("persistence_failed");
    expect(r.stdout.includes("sil_shopper_created")).toBe(false);
    // The bind WRITE was applied this run — a real post-bind failure, not a pre-bind one.
    expect(shimLog()).toContain("agents bind --agent");
    // Whole-file snapshot-restore returned openclaw.json byte-identical to pre-run …
    expect(readFileSync(configPath, "utf8")).toBe(preConfig);
    // … leaving NO orphaned route pointing at the now-absent shopper.
    expect(readConfig().bindings ?? []).toEqual([]);
    expect(existsSync(shopperDir())).toBe(false);
    expect(existsSync(spec.workspace)).toBe(false);
  });
});

// ===========================================================================
// Card: creation-bin-unreachable-on-clawhub-installs — AC A1/A5 and C1.
//
// THE CLAWHUB CHANNEL'S TESTABLE ESSENCE IS "the sil bins are not on PATH".
// `openclaw plugins install` extracts the tarball and links nothing, so the bare
// `sil-openclaw-create-shopper` the skill used to document simply did not exist and
// creation died at its last step. We reproduce exactly that property — PATH holds
// ONLY the `openclaw` shim — and drive the documented form
// `node <absolute entrypoint> --spec <file>` through it.
//
// This is NOT a claim to have tested a real ClawHub install. This repo has no
// host-load gate; true channel parity and agent path-following are closed by a
// companion card in the sil-stage sibling, which boots alpine/openclaw and installs
// the packed tarball via `openclaw plugins install --link`. What IS proved here is
// the defining property, which is what the bug turned on.
//
// `openclaw` itself STAYS on PATH deliberately: create-shopper.mjs shells it
// (`execFileSync("openclaw", …)`), and `openclaw` is always on PATH on every
// channel — which is precisely why the pre-0.3.8 design worked everywhere. An
// EMPTY PATH would fail for that unrelated reason and would prove nothing.
// ===========================================================================

/**
 * The ClawHub channel: `openclaw` and `node` reachable, every sil bin absent.
 *
 * The interpreter's own directory is on PATH deliberately — the `openclaw` shim's
 * `#!/usr/bin/env node` shebang needs it, and on a real host node is obviously
 * present (OpenClaw runs on it). The ONE property being reproduced is that no sil
 * bin was linked, which is exactly what `openclaw plugins install` does not do.
 * The `command -v` test below proves that property really holds here rather than
 * assuming it — if a global `npm i -g sil-openclaw` ever put the bin in node's bin
 * dir on this machine, that test fails loudly instead of quietly making this whole
 * block vacuous.
 */
const clawhubChannelEnv = (): Record<string, string> => ({
  PATH: `${binDir}:${dirname(process.execPath)}`,
});

describe("AC A1/A5 — the documented entrypoint runs with the sil bins OFF PATH", () => {
  it("the bare bin name really IS unreachable in this env (the channel is reproduced)", () => {
    // ANTI-VACUITY, and the most important assertion in this block: if the sil bins
    // were somehow still resolvable here, every test below would pass without ever
    // reproducing the bug. Proven by asking a shell to resolve the exact command the
    // skill used to document. 127 is "command not found".
    let status = 0;
    let stderr = "";
    try {
      execFileSync("/bin/sh", ["-c", "sil-openclaw-create-shopper --help"], {
        env: clawhubChannelEnv(),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const e = err as { status?: number; stderr?: Buffer | string };
      status = e.status ?? 1;
      stderr = (e.stderr ?? "").toString();
    }
    expect(status).toBe(127);
    expect(stderr.toLowerCase()).toContain("not found");

    // …while `openclaw` — the thing the bin legitimately shells — still resolves.
    expect(() =>
      execFileSync("/bin/sh", ["-c", "command -v openclaw"], {
        env: clawhubChannelEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    ).not.toThrow();
  });

  it("AC A1 — `node <entrypoint> --spec <file>` CREATES the shopper on that channel", () => {
    // The regression test for the whole card: this is the exact form the skill now
    // documents, run under the exact channel property that broke it.
    writeConfig(freshConfig());
    const spec = validSpec();
    const r = runBin({ spec, viaSpecFile: true, env: clawhubChannelEnv() });

    expect(parseMarker(r.stdout)["status"]).toBe("created");
    expect(r.status).toBe(0);
    // Never a shell failure, and never the MODULE_NOT_FOUND the naive `../scripts/…`
    // fix would have traded it for — the same silent-late failure at the same step.
    const emitted = r.stdout + r.stderr;
    expect(emitted).not.toContain("command not found");
    expect(emitted).not.toContain("MODULE_NOT_FOUND");
    expect(emitted).not.toContain("Cannot find module");
  });

  it("G9 — on that same channel the shopper lands in the FLAT store, and no marker names a domain pack or PRD", () => {
    // G9's third clause ("still loads under `node` with the sil bins off PATH") is
    // the block above; this is its first two, asserted on the SAME channel so the
    // criterion is closed in one place rather than split across two harnesses.
    //
    // The bin now writes through `writeDocument({ ref: "shopper", mode: "create" })`.
    // Two things could regress silently: a shopper written into the layout the
    // migration exists to leave behind, and a marker that still calls the write
    // `sil_profile_materialize` — an operator grepping for that name finds a tool
    // that no longer exists, on the channel where diagnosis is hardest.
    writeConfig(freshConfig());
    const spec = validSpec();
    const r = runBin({ spec, viaSpecFile: true, env: clawhubChannelEnv() });
    expect(r.status).toBe(0);

    expect(existsSync(userSpecPath())).toBe(true);
    expect(existsSync(join(shopperDir(), "domains"))).toBe(false);
    expect(existsSync(join(shopperDir(), "profile.json"))).toBe(false);

    const emitted = (r.stdout + r.stderr).toLowerCase();
    expect(
      ["method.md", "prds", "domain pack", "sil_learn", "sil_profile"].filter((t) =>
        emitted.includes(t),
      ),
    ).toEqual([]);
    // Guard-of-the-guard: the run really did emit its marker, so the scan above ran
    // over something. An empty stdout passes every `includes` check ever written.
    expect(parseMarker(r.stdout)["status"]).toBe("created");
  });

  it("AC A5 — the entrypoint the PLUGIN resolves is the one that runs (loadable by node)", () => {
    // Closes the loop the card is built on: the path `sil_doctor` reports as
    // `creationEntrypoint` is spawned here for real. Reachability asserted by an
    // actual `node` load — never `existsSync`, which is the proven trap: `cat
    // <skilldir>/../scripts/x` exits 0 while `node` throws MODULE_NOT_FOUND on the
    // IDENTICAL string, because node's path.resolve normalizes `..` lexically, before
    // the filesystem. A real run also proves the static `../dist/lib/*.js` imports
    // resolve — the bin is not standalone and must stay in-tree.
    writeConfig(freshConfig());
    const resolved = resolveCreationEntrypoint();
    expect(resolved).toBe(SCRIPT);

    const specPath = join(workdir, "resolved-spec.json");
    const spec = validSpec();
    writeFileSync(specPath, JSON.stringify(spec));

    const stdout = execFileSync(process.execPath, [resolved, "--spec", specPath], {
      env: {
        ...clawhubChannelEnv(),
        HOME: emptyHome,
        OPENCLAW_CONFIG_PATH: configPath,
        SIL_DATA_DIR: dataDir,
        OPENCLAW_SHIM_LOG: logPath,
      },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    expect(parseMarker(stdout)["status"]).toBe("created");
    expect(existsSync(userSpecPath())).toBe(true);
  });

  it("runs identically from a FOREIGN cwd — no PATH, no cwd, no linking (AC A2)", () => {
    // Production cwd is the agent's workspace, not the plugin root. Static ESM
    // specifiers resolve against the MODULE file, so an absolute invocation is sound
    // from anywhere — the property that lets ONE documented command serve both
    // channels with no conditional branch.
    writeConfig(freshConfig());
    const spec = validSpec();
    const specPath = join(workdir, "cwd-spec.json");
    writeFileSync(specPath, JSON.stringify(spec));

    const stdout = execFileSync(process.execPath, [SCRIPT, "--spec", specPath], {
      cwd: emptyHome,
      env: {
        ...clawhubChannelEnv(),
        HOME: emptyHome,
        OPENCLAW_CONFIG_PATH: configPath,
        SIL_DATA_DIR: dataDir,
        OPENCLAW_SHIM_LOG: logPath,
      },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(parseMarker(stdout)["status"]).toBe("created");
  });
});

// ===========================================================================
// AC C1 — the spec travels as a FILE, so shell quoting is never in the path.
// ===========================================================================

describe("AC C1 — shell metacharacters round-trip verbatim via --spec", () => {
  // Persona and userSpec are free-form, model-authored prose: apostrophes and quotes
  // are the NORM, not the edge case. The heredoc form mangled them into unparseable
  // stdin, which surfaced as `invalid_request` — so the flow did not merely fail, it
  // failed while BLAMING THE USER for a spec that was fine.
  const NASTY_PERSONA = [
    `A buyer who says "it's fine" and won't budge.`,
    "Runs `rm -rf /` jokes; $HOME is not a place; $(whoami) neither.",
    "Backticks: `` and 'single' and \"double\" quotes.",
    "Costs $5.00 — 100% sure. 50%的中文. Emoji 🛍️.",
    "A trailing backslash \\ and a semicolon; then | a pipe && an and.",
  ].join("\n");
  const NASTY_USERSPEC = [
    "Ships to O'Brien's Café, 12 King's Rd.",
    'Allergic to "tree nuts"; NEVER buy $(cat /etc/passwd).',
    "Budget: $200-$400. Size `M`. #hash & ampersand.",
    "Newline-separated\nrules > with > angles < and back\\slashes.",
  ].join("\n");

  it("creates the shopper and lands the bytes VERBATIM in SOUL.md and user_spec.md", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ persona: NASTY_PERSONA, userSpec: NASTY_USERSPEC });
    const r = runBin({ spec, viaSpecFile: true, env: clawhubChannelEnv() });

    // It succeeds — `invalid_request` here would be the taxonomy lying about whose
    // fault it is.
    expect(parseMarker(r.stdout)["status"]).toBe("created");

    const soul = readFileSync(join(spec.workspace, "SOUL.md"), "utf8");
    expect(soul).toContain(NASTY_PERSONA);

    const userSpec = readFileSync(userSpecPath(), "utf8");
    expect(userSpec).toContain(NASTY_USERSPEC);
  });

  it("NOTHING was shell-expanded or executed — the bytes are data, never code", () => {
    // The failure this catches is not "it crashed" but "it silently ran": a spec that
    // travels through a shell can have `$(…)` substituted or `$HOME` expanded, and the
    // user's persona would be quietly rewritten — or worse.
    writeConfig(freshConfig());
    const spec = validSpec({ persona: NASTY_PERSONA, userSpec: NASTY_USERSPEC });
    runBin({ spec, viaSpecFile: true, env: clawhubChannelEnv() });

    const written =
      readFileSync(join(spec.workspace, "SOUL.md"), "utf8")
      + readFileSync(userSpecPath(), "utf8");
    // The literals survive UNEXPANDED …
    expect(written).toContain("$(whoami)");
    expect(written).toContain("$HOME");
    expect(written).toContain("$(cat /etc/passwd)");
    // … and their expansions are nowhere to be seen.
    expect(written).not.toContain("root:x:0:0");
    expect(written).not.toContain(emptyHome);
  });

  it("a persona that is ONLY quotes still creates (the pathological case)", () => {
    writeConfig(freshConfig());
    const spec = validSpec({ persona: `'"'"'`, userSpec: `"'\`$\\` });
    const r = runBin({ spec, viaSpecFile: true, env: clawhubChannelEnv() });
    expect(parseMarker(r.stdout)["status"]).toBe("created");
    expect(readFileSync(join(spec.workspace, "SOUL.md"), "utf8")).toContain(`'"'"'`);
  });
});

// ===========================================================================
// THE OUTPUT CONTRACT — exactly ONE complete NDJSON line on the correct stream,
// the other stream byte-empty, and the exit code that line claims. Card:
// create-shopper-bin-dies-on-its-exit-path (`docs/decisions/create-shopper-bin.md`
// §3). Content and code are pinned TOGETHER on purpose: "no crash banner" and
// "the other stream is empty" both pass for free against a bin that emits nothing.
// ===========================================================================

/** The `created` marker echoes an unbounded `name` ~5× (name, agentId, and agentId twice
 * more in the manual-bind warning), so 64 KiB of it makes the line ~328 KB — 5× a Linux
 * pipe buffer. Measured on the pre-fix bin: truncated 10/10 at this size (still exit 0,
 * no trailing newline), 2/6 at 50 k, 0/6 at 20 k. Bounded above too: the derived agentId
 * goes to `openclaw agents add` as ONE argv element, and Linux caps that at
 * MAX_ARG_STRLEN (32 pages) — past it the bin fails closed with `persistence_failed` and
 * never reaches `emitCreated`, testing E2BIG instead of the pipe. 2× headroom either way. */
const OVERFLOW_NAME_LEN = 65_536;

/** The tails Node prints when it dies of an uncaught exception — the exact bytes that
 * made `parseMarker` throw `Unexpected token 'N', "Node.js v24.19.0"`. */
function assertNoCrashDump(...streams: string[]): void {
  for (const text of streams) {
    expect(text).not.toContain("Node.js v");
    expect(text).not.toMatch(/^\s+at .+:\d+:\d+/m);
    expect(text).not.toContain("throw er;");
  }
}

/** The non-empty lines a stream carries. */
function lines(text: string): string[] {
  return text.split("\n").filter(Boolean);
}

describe("output contract — one whole line, one empty stream, the exit code it claims", () => {
  it("created: stdout is EXACTLY one \\n-terminated created line, stderr is byte-empty, exit 0", () => {
    writeConfig(freshConfig());

    const r = runBin({ spec: validSpec() });

    expect(r.status).toBe(0);
    expect(r.signal).toBeNull();
    // Byte-empty, not "carries no failure marker": until this card, runBin hardcoded
    // `stderr: ""` on the success path, so a child that dumped a stack and still
    // exited 0 was invisible to every assertion in this file.
    expect(r.stderr).toBe("");
    expect(r.stdout.endsWith("\n")).toBe(true);
    expect(lines(r.stdout)).toHaveLength(1);
    // Parsed from the WHOLE stream, not `parseMarker`'s last line — anything else on
    // stdout is a contract violation, not something to skip past.
    const m = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(m["event"]).toBe("sil_shopper_created");
    expect(m["status"]).toBe("created");
    assertNoCrashDump(r.stdout, r.stderr);
  });

  it("invalid_request: stderr is EXACTLY one line naming the field, stdout byte-empty, exit 1", () => {
    writeConfig(freshConfig());

    const r = runBin({ spec: { ...validSpec(), name: "   " } });

    expect(r.status).toBe(1);
    expect(r.signal).toBeNull();
    expect(r.stdout).toBe("");
    expect(r.stderr.endsWith("\n")).toBe(true);
    expect(lines(r.stderr)).toHaveLength(1);
    const m = JSON.parse(r.stderr) as Record<string, unknown>;
    expect(m["event"]).toBe("sil_shopper_create_failed");
    expect(m["status"]).toBe("invalid_request");
    expect(m["field"]).toBe("name");
    // The measured symptom: Node's dump landing AFTER the bin's own line, which made
    // `parseMarker` take the banner as the marker and throw on 'N'.
    assertNoCrashDump(r.stdout, r.stderr);
  });

  it("a created marker past the pipe buffer still arrives WHOLE — on a pipe, a file, and a pty", () => {
    const spec = validSpec({ name: "N".repeat(OVERFLOW_NAME_LEN) });
    // The derived agentId is as long as the name, so the default workspace path would
    // be ENAMETOOLONG. The bin never puts the id in a path; this fixture must not either.
    spec.workspace = join(workdir, "overflow-workspace");

    writeConfig(freshConfig());
    const onPipe = runBin({ spec });

    expect(onPipe.status).toBe(0);
    expect(onPipe.stderr).toBe("");
    // Anti-vacuity: the whole point is a line the pipe buffer cannot hold in one go.
    // If the bin ever bounds the echoed `name`, this is the assertion that should fail.
    expect(onPipe.stdout.length).toBeGreaterThan(64 * 1024);
    expect(lines(onPipe.stdout)).toHaveLength(1);
    expect((JSON.parse(onPipe.stdout) as Record<string, unknown>)["name"]).toBe(spec.name);

    // A file redirect and a terminal are the other two channels the shipped bin runs
    // on (`node <creationEntrypoint>` from an agent's bash tool, or by hand).
    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    writeConfig(freshConfig());
    const toFile = runBin({ spec, toFiles: true });

    expect(toFile.status).toBe(0);
    expect(toFile.stderr).toBe("");
    expect(lines(toFile.stdout)).toHaveLength(1);
    expect((JSON.parse(toFile.stdout) as Record<string, unknown>)["name"]).toBe(spec.name);

    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    writeConfig(freshConfig());
    // Anti-vacuity for the channel itself: prove `script` really hands the child a tty,
    // or this leg silently re-tests the pipe.
    const ttyProbe = spawnSync(
      "script",
      ["-q", "-e", "-c", `'${process.execPath}' -e 'process.stdout.write(String(process.stdout.isTTY))'`, "/dev/null"],
      { env: binEnv(), encoding: "utf8", timeout: RUN_TIMEOUT_MS },
    );
    expect(ttyProbe.stdout.trim()).toBe("true");

    const onPty = runBinOnPty(spec);

    expect(onPty.status).toBe(0);
    expect(lines(onPty.merged)).toHaveLength(1);
    expect((JSON.parse(onPty.merged) as Record<string, unknown>)["name"]).toBe(spec.name);

    assertNoCrashDump(onPipe.stdout, onPipe.stderr, toFile.stdout, toFile.stderr, onPty.merged);
  }, 60_000);

  it("every terminal outcome exits on its own — never killed, never waiting on a handle", () => {
    // The hang the `process.exitCode` + natural-exit direction invites. For the sole
    // caller — a synchronous bash tool — a bin that never returns is worse than a
    // wrong exit code, and no other test here would notice: `runBin`'s timeout kills
    // it and every assertion then reads a plain non-zero status.
    const outcomes: Array<[string, () => RunResult, number]> = [
      ["created", () => runBin({ spec: validSpec() }), 0],
      ["invalid_request", () => runBin({ stdin: "" }), 1],
      ["collision", () => { seedExistingShopper(); return runBin({ spec: validSpec() }); }, 1],
      ["persistence_failed", () => runBin({ spec: validSpec(), fail: ["agents-add"] }), 1],
    ];

    for (const [label, run, expected] of outcomes) {
      rmSync(dataDir, { recursive: true, force: true });
      mkdirSync(dataDir, { recursive: true });
      writeConfig(freshConfig());

      const r = run();

      expect(r.signal, `${label}: the bin was KILLED, so it never terminated on its own`).toBeNull();
      expect(r.status, `${label}: exit code must match the marker's claim`).toBe(expected);
      // Anti-vacuity: a bin that emitted nothing would satisfy both of the above.
      const marker = JSON.parse(expected === 0 ? r.stdout : r.stderr) as Record<string, unknown>;
      expect(marker["status"]).toBe(label);
      assertNoCrashDump(r.stdout, r.stderr);
    }
  }, 60_000);
});
