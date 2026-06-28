/**
 * INTEGRATION — the allowlist helper SCRIPT, end-to-end against a real temp
 * `openclaw.json` (tier: integration — spawns `scripts/allowlist-openclaw.mjs`
 * as a child process, real fs reads/writes, real exit codes; no mocked fs, no
 * stubs of sil's own logic).
 *
 * Card: install-time-helper-to-allow-list-sil-in-openclaw. The script is the
 * thin I/O shell around the pure `mergeSilAllowlist` core (unit-tested in
 * `lib/openclaw-allowlist.test.ts`). This suite pins the BLACK-BOX, file-level
 * behaviours the architect tagged `[integration]` — verifiable purely by
 * inspecting the host config + the helper's stdout/stderr markers + exit code:
 *
 *   AC1 — sil trusted at all three real surfaces in the WRITTEN file.
 *   AC3 — the result satisfies the host's no-warning precondition
 *         (non-empty plugins.allow that contains "sil").
 *   AC6 — idempotent: a second run is byte-identical + creates NO new .bak +
 *         emits the `unchanged` marker + exit 0.
 *   AC7 — bad result fails closed: an `openclaw config validate` that rejects
 *         the merge reverts the file from .bak to the exact pre-run bytes,
 *         emits a `failed` marker naming the cause, exits non-zero.
 *   AC8 — config-path precedence (OPENCLAW_CONFIG_PATH wins) + missing-config
 *         fail-closed (no write, no parent dir created, structured error, exit 1).
 *
 * The script imports the COMPILED lib (`dist/lib/openclaw-allowlist.js`), so the
 * suite builds the lib once in beforeAll FROM THE CURRENT SOURCE — never relying
 * on a possibly-stale dist (a stale dist would silently test old logic). The
 * build is the same `tsc -p tsconfig.build.json` the script's `dist` import needs.
 *
 * The two invariants this suite defends (product-owner): AC6 (idempotent) and the
 * additive half of AC1 (klodi survives). Every other case guards those two.
 *
 * These assertions ARE the spec. Do NOT weaken them to match the script.
 * Hermetic: each test gets its own mkdtemp dir + its own config fixture; full
 * teardown in afterEach. NO shared state, NO order dependence.
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
const SCRIPT = join(REPO_ROOT, "scripts", "allowlist-openclaw.mjs");

// sil's real facts (asserted against, sourced from the manifest the script reads).
const SIL_ID = "sil";
const SIL_TOOLS = [
  "sil_product_get",
  "sil_profile_get",
  "sil_profile_list",
  "sil_profile_materialize",
  "sil_profile_remove",
  "sil_register",
  "sil_remember",
  "sil_search",
  "sil_whoami",
] as const;

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Spawn the helper script with an explicit env (no inheritance of the test
 * runner's OPENCLAW_* / HOME unless we set it). Captures status + streams. */
function runHelper(env: Record<string, string>): RunResult {
  try {
    const stdout = execFileSync("node", [SCRIPT], {
      env: { ...baseEnv(), ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
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

/** A minimal, hermetic base env: PATH for `node`, and HOME pointed at a
 * guaranteed-empty dir so the ~/.openclaw fallback never resolves a real file
 * on the developer's machine. OPENCLAW_* are deliberately UNSET here — each
 * test sets exactly the precedence knob it exercises. */
let emptyHome: string;
function baseEnv(): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: emptyHome,
  };
}

/** Parse the single NDJSON marker the script emits on the given stream text. */
function parseMarker(streamText: string): Record<string, unknown> {
  const line = streamText.trim().split("\n").filter(Boolean).at(-1) ?? "";
  return JSON.parse(line) as Record<string, unknown>;
}

/** A fresh config where sil is discovered but trusted nowhere. */
function freshConfig(): unknown {
  return {
    gateway: { mode: "local", port: 18789 },
    tools: { profile: "coding", alsoAllow: [] as string[] },
    plugins: { allow: [] as string[], entries: {} as Record<string, unknown> },
    meta: { lastTouchedVersion: "2026.6.9" },
  };
}

let workdir: string;
let configPath: string;

beforeAll(() => {
  // The script imports dist/lib/openclaw-allowlist.js — build the lib from the
  // CURRENT source so the integration tier exercises what the dev actually
  // wrote, never a stale dist. Fails loud if the build breaks. We invoke the
  // TypeScript compiler's real JS entry (node_modules/.bin/tsc is a shell
  // wrapper that `node` cannot run directly).
  execFileSync("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!existsSync(join(REPO_ROOT, "dist", "lib", "openclaw-allowlist.js"))) {
    throw new Error("build did not emit dist/lib/openclaw-allowlist.js — script import would 404");
  }
}, 60_000);

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "sil-allowlist-it-"));
  emptyHome = mkdtempSync(join(tmpdir(), "sil-allowlist-home-"));
  configPath = join(workdir, "openclaw.json");
});

afterEach(() => {
  for (const d of [workdir, emptyHome]) {
    try {
      chmodSync(d, 0o700);
    } catch {
      /* best effort */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

function writeConfig(value: unknown): void {
  writeFileSync(configPath, JSON.stringify(value, null, 2) + "\n");
}

function readConfig(): {
  plugins: { allow: string[]; entries: Record<string, unknown> };
  tools: { alsoAllow: string[]; profile?: string };
  [k: string]: unknown;
} {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

// ---------------------------------------------------------------------------
// AC1 / AC3 — fresh merge trusts sil at all three surfaces; result satisfies
// the host's no-warning precondition.
// ---------------------------------------------------------------------------
describe("AC1 / AC3 — fresh merge writes sil into all three surfaces (no-warning precondition met)", () => {
  it("writes sil into plugins.allow, tools.alsoAllow, and plugins.entries.sil", () => {
    writeConfig(freshConfig());
    const r = runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    expect(r.status).toBe(0);

    const c = readConfig();
    expect(c.plugins.allow).toContain(SIL_ID);
    expect(c.tools.alsoAllow).toContain(SIL_ID);
    expect(c.plugins.entries[SIL_ID]).toEqual({ enabled: true, config: {} });
  });

  it("AC3 — written plugins.allow is non-empty AND contains sil (host suppresses the warning)", () => {
    writeConfig(freshConfig());
    runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    const c = readConfig();
    expect(c.plugins.allow.length).toBeGreaterThan(0);
    expect(c.plugins.allow).toContain(SIL_ID);
  });

  it("emits the `sil_allowlist_merged` info marker on stdout with the operator fields", () => {
    writeConfig(freshConfig());
    const r = runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    const m = parseMarker(r.stdout);
    expect(m["event"]).toBe("sil_allowlist_merged");
    expect(m["level"]).toBe("info");
    expect(m["plugin"]).toBe(SIL_ID);
    expect(m["tools_added"]).toBe(SIL_TOOLS.length);
    expect(m["skill_added"]).toBe(true);
    expect(typeof m["plugins_allow_size"]).toBe("number");
    expect(m["plugins_allow_size"] as number).toBeGreaterThan(0);
  });

  it("does NOT enumerate the 8 tool NAMES into the written config (plugin-id admission only)", () => {
    writeConfig(freshConfig());
    runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    const raw = readFileSync(configPath, "utf8");
    for (const t of SIL_TOOLS) {
      expect(raw).not.toContain(t);
    }
    expect(readConfig().tools.alsoAllow).toEqual([SIL_ID]);
  });

  it("creates a single `.bak` (single-slot) on the first changed write", () => {
    writeConfig(freshConfig());
    const before = readFileSync(configPath, "utf8");
    runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    expect(existsSync(configPath + ".bak")).toBe(true);
    // The .bak holds the exact pre-run bytes.
    expect(readFileSync(configPath + ".bak", "utf8")).toBe(before);
    // No .bak.1 rotation slot is created (single overwrite slot only).
    expect(existsSync(configPath + ".bak.1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC1 additive (file level) — pre-existing klodi survives a real write.
// ---------------------------------------------------------------------------
describe("AC1 additive — pre-existing trust survives a real file write", () => {
  it("preserves klodi at every surface and appends sil after it", () => {
    writeConfig({
      tools: { profile: "coding", alsoAllow: ["klodi"] },
      plugins: {
        allow: ["klodi"],
        entries: { klodi: { enabled: true, config: { apiKey: "operator-set" } } },
      },
    });
    const r = runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    expect(r.status).toBe(0);
    const c = readConfig();
    expect(c.plugins.allow).toEqual(["klodi", "sil"]);
    expect(c.tools.alsoAllow).toEqual(["klodi", "sil"]);
    expect(c.plugins.entries["klodi"]).toEqual({
      enabled: true,
      config: { apiKey: "operator-set" },
    });
    expect(c.tools.profile).toBe("coding");
  });

  it("OQ3 — empty allow + other entries: written allow carries sil AND the prior plugins (codex, memory-core)", () => {
    writeConfig({
      tools: { alsoAllow: [] as string[] },
      plugins: {
        allow: [] as string[],
        entries: { codex: { enabled: true }, "memory-core": { enabled: true } },
      },
    });
    runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    const allow = readConfig().plugins.allow;
    expect(allow).toContain("sil");
    expect(allow).toContain("codex");
    expect(allow).toContain("memory-core");
  });
});

// ---------------------------------------------------------------------------
// AC6 — idempotent: second run byte-identical, no new .bak, `unchanged` marker.
// ---------------------------------------------------------------------------
describe("AC6 — idempotent: a second run changes nothing and rewrites nothing", () => {
  it("second run leaves the file BYTE-IDENTICAL, creates NO new .bak, emits `unchanged`, exits 0", () => {
    writeConfig(freshConfig());

    // First run: merges + writes + creates .bak.
    const r1 = runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    expect(r1.status).toBe(0);
    const afterFirst = readFileSync(configPath, "utf8");
    // Remove the first .bak so we can detect whether the SECOND run writes one.
    rmSync(configPath + ".bak", { force: true });

    // Second run: no-op.
    const r2 = runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    expect(r2.status).toBe(0);

    // File untouched (byte-identical) — no shape change, no reorder, no dup.
    expect(readFileSync(configPath, "utf8")).toBe(afterFirst);
    // No new .bak created on the idempotent run.
    expect(existsSync(configPath + ".bak")).toBe(false);
    // Distinct `unchanged` marker, exit 0.
    const m = parseMarker(r2.stdout);
    expect(m["event"]).toBe("sil_allowlist_unchanged");
    expect(m["level"]).toBe("info");
    expect(m["plugin"]).toBe(SIL_ID);
  });

  it("a third run is still a no-op (stable fixpoint)", () => {
    writeConfig(freshConfig());
    runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    const settled = readFileSync(configPath, "utf8");
    runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    const r3 = runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    expect(r3.status).toBe(0);
    expect(parseMarker(r3.stdout)["event"]).toBe("sil_allowlist_unchanged");
    expect(readFileSync(configPath, "utf8")).toBe(settled);
  });

  it("never duplicates sil across runs (single sil in each allow surface)", () => {
    writeConfig(freshConfig());
    runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    const c = readConfig();
    expect(c.plugins.allow.filter((x) => x === SIL_ID)).toHaveLength(1);
    expect(c.tools.alsoAllow.filter((x) => x === SIL_ID)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC7 — bad result fails closed and reverts from .bak.
//
// We put a FAKE `openclaw` binary on PATH (a shim) that reports {valid:false}.
// This is a test double of the EXTERNAL binary boundary (permitted — it is not
// stubbing sil's own logic), letting us drive the validate-reject path
// deterministically without the real gateway image.
// ---------------------------------------------------------------------------
describe("AC7 — validate-reject reverts from .bak and fails closed", () => {
  /** Create a PATH dir containing an `openclaw` shim with the given behaviour. */
  function shimDir(script: string): string {
    const bin = mkdtempSync(join(tmpdir(), "sil-allowlist-bin-"));
    const exe = join(bin, "openclaw");
    writeFileSync(exe, script, { mode: 0o755 });
    return bin;
  }

  it("reverts to the EXACT pre-run bytes, emits `failed` with the cause, exits non-zero", () => {
    const original = freshConfig();
    writeConfig(original);
    const preRun = readFileSync(configPath, "utf8");

    // Shim: always reports the merged config invalid.
    const bin = shimDir(
      "#!/usr/bin/env bash\n"
        + 'echo \'{"valid":false,"error":"shim: config rejected for test"}\'\n'
        + "exit 0\n",
    );

    const r = runHelper({
      OPENCLAW_CONFIG_PATH: configPath,
      PATH: `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
    });

    rmSync(bin, { recursive: true, force: true });

    // Fail closed: non-zero exit.
    expect(r.status).not.toBe(0);
    // File reverted to the EXACT pre-run bytes — never left half-merged.
    expect(readFileSync(configPath, "utf8")).toBe(preRun);
    // Structured `failed` marker on stderr naming the cause.
    const m = parseMarker(r.stderr);
    expect(m["event"]).toBe("sil_allowlist_merge_failed");
    expect(m["level"]).toBe("error");
    expect(typeof m["cause"]).toBe("string");
    expect(String(m["cause"]).length).toBeGreaterThan(0);
  });

  it("when the openclaw binary VALIDATES the config, the merge is kept (write survives)", () => {
    writeConfig(freshConfig());
    const bin = shimDir(
      "#!/usr/bin/env bash\n" + 'echo \'{"valid":true}\'\n' + "exit 0\n",
    );
    const r = runHelper({
      OPENCLAW_CONFIG_PATH: configPath,
      PATH: `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
    });
    rmSync(bin, { recursive: true, force: true });

    expect(r.status).toBe(0);
    expect(parseMarker(r.stdout)["event"]).toBe("sil_allowlist_merged");
    expect(readConfig().plugins.allow).toContain(SIL_ID);
  });
});

// ---------------------------------------------------------------------------
// AC8 — config-path precedence + missing-config fail-closed.
// ---------------------------------------------------------------------------
describe("AC8 — path precedence and missing-config fail-closed", () => {
  it("OPENCLAW_CONFIG_PATH takes precedence over the ~/.openclaw default", () => {
    // Write a fresh config at the EXPLICIT path.
    writeConfig(freshConfig());

    // Also place a decoy config at the HOME default — it must NOT be touched.
    const homeOpenclaw = join(emptyHome, ".openclaw");
    mkdirSync(homeOpenclaw, { recursive: true });
    const decoyPath = join(homeOpenclaw, "openclaw.json");
    const decoy = JSON.stringify({ plugins: { allow: ["DECOY"] } }, null, 2) + "\n";
    writeFileSync(decoyPath, decoy);

    const r = runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    expect(r.status).toBe(0);

    // The explicit path got sil; the decoy is byte-unchanged.
    expect(readConfig().plugins.allow).toContain(SIL_ID);
    expect(readFileSync(decoyPath, "utf8")).toBe(decoy);
  });

  it("OPENCLAW_CONFIG_PATH takes precedence over OPENCLAW_STATE_DIR", () => {
    writeConfig(freshConfig());

    const stateDir = join(workdir, "state");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "openclaw.json");
    const stateCfg = JSON.stringify({ plugins: { allow: ["STATE-DECOY"] } }, null, 2) + "\n";
    writeFileSync(statePath, stateCfg);

    const r = runHelper({
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_STATE_DIR: stateDir,
    });
    expect(r.status).toBe(0);
    expect(readConfig().plugins.allow).toContain(SIL_ID);
    // The state-dir candidate was lower precedence → untouched.
    expect(readFileSync(statePath, "utf8")).toBe(stateCfg);
  });

  it("falls back to OPENCLAW_STATE_DIR/openclaw.json when OPENCLAW_CONFIG_PATH is unset", () => {
    const stateDir = join(workdir, "state");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "openclaw.json");
    writeFileSync(statePath, JSON.stringify(freshConfig(), null, 2) + "\n");

    const r = runHelper({ OPENCLAW_STATE_DIR: stateDir });
    expect(r.status).toBe(0);
    const c = JSON.parse(readFileSync(statePath, "utf8")) as {
      plugins: { allow: string[] };
    };
    expect(c.plugins.allow).toContain(SIL_ID);
  });

  it("missing config at every resolvable path → fail closed (exit 1, structured error, NO write, NO parent dir)", () => {
    const missingPath = join(workdir, "nonexistent", "openclaw.json");
    const missingState = join(workdir, "no-state");

    const r = runHelper({
      OPENCLAW_CONFIG_PATH: missingPath,
      OPENCLAW_STATE_DIR: missingState,
      // HOME is the guaranteed-empty dir → no ~/.openclaw/openclaw.json either.
    });

    expect(r.status).not.toBe(0);
    const m = parseMarker(r.stderr);
    expect(m["event"]).toBe("sil_allowlist_merge_failed");
    expect(m["level"]).toBe("error");
    // The error must point the operator at starting the gateway once.
    expect(String(m["cause"]).toLowerCase()).toContain("gateway");
    // No file fabricated at the missing path, and NO parent dir tree created
    // (creating one would mask the misconfiguration).
    expect(existsSync(missingPath)).toBe(false);
    expect(existsSync(join(workdir, "nonexistent"))).toBe(false);
    expect(existsSync(missingState)).toBe(false);
  });

  it("config that is not valid JSON → fail closed (exit 1, structured error, file untouched)", () => {
    writeFileSync(configPath, "{ this is : not json,, }\n");
    const before = readFileSync(configPath, "utf8");
    const r = runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["event"]).toBe("sil_allowlist_merge_failed");
    // The malformed file is left exactly as-is (no partial write, no .bak churn).
    expect(readFileSync(configPath, "utf8")).toBe(before);
    expect(existsSync(configPath + ".bak")).toBe(false);
  });

  it("a present-but-non-array plugins.allow → fail closed (no coercion, exit 1, file untouched)", () => {
    // The merge core throws AllowlistShapeError; the shell maps it to `failed`.
    writeConfig({ plugins: { allow: "sil" } });
    const before = readFileSync(configPath, "utf8");
    const r = runHelper({ OPENCLAW_CONFIG_PATH: configPath });
    expect(r.status).not.toBe(0);
    expect(parseMarker(r.stderr)["event"]).toBe("sil_allowlist_merge_failed");
    expect(readFileSync(configPath, "utf8")).toBe(before);
    expect(existsSync(configPath + ".bak")).toBe(false);
  });
});
