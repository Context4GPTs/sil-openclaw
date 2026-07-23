/**
 * INTEGRATION — `sil_create_shopper`: what a failed create may DELETE, and what
 * a failure may SAY.
 *
 * Slice M lands creation inside the plugin process (M2, probe-confirmed): the
 * ten-step exec choreography collapses into host-owned calls —
 * `api.runtime.agent.ensureAgentWorkspace` for the workspace and ONE
 * `api.runtime.config.mutateConfigFile` transaction, last, for the config. This
 * file pins the two contracts that survive that move and the one it creates:
 *
 *   B3 — a shopper's logs carry ONLY what sil authored. The subprocess is gone,
 *        so "no stderr is forwarded" would pass for free; per
 *        `[[vacuity-proof-silence-and-name-assertions]]` silence must be proven,
 *        not assumed. The host double therefore fails with error text carrying a
 *        NONCE and a token-shaped string, and every emitted byte — result,
 *        logger, stdout, stderr — is searched for them.
 *   E9 — creation may delete only what THIS RUN created. Not "what did not
 *        pre-exist" (the code's own `KNOWN GAP`): a pre-existing empty
 *        `shopper/` used to strand this run's `user_spec.md`. What cannot be
 *        removed becomes `residue[]` ⇒ `teardown_failed`, never a green-washed
 *        `persistence_failed`.
 *   A  — the config file is opened for writing exactly once, at the end, so on
 *        every failure path it is byte-identical to its pre-run bytes; and a
 *        SUCCESSFUL create never widens sil's own admission.
 *
 * THE HOST DOUBLE IS NOT A STUB. It drives the real filesystem: it writes the
 * real `openclaw.json` (re-serialised, exactly as `mutateConfigFile` normalises
 * it), enforces the host's own `baseHash` staleness check and the `agents.list`
 * schema rejection the probe observed, and really creates the workspace tree.
 * Signatures are source-verified against `vendor/openclaw`:
 * `src/plugins/runtime/types-core.ts:48-57` (`RuntimeMutateConfigFileParams`),
 * `src/config/mutate.ts:86-94` (`ConfigReplaceResult`), and
 * `src/agents/workspace.ts:692-710` (`ensureAgentWorkspace`).
 *
 * Card: clear-the-clawhub-suspicious-flag-review-findings (slice M — B3, E9,
 * and the config-write criteria).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCreateShopperTools } from "../tools/create-shopper.js";
import { createMockPluginApi, getTool, type MockPluginAPI } from "./helpers/mock-plugin-api.js";

const TOOL = "sil_create_shopper";
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

/** Strings the host emits that must never reach a sil surface. */
const HOST_NONCE = "host-error-stream-must-never-escape-9f3a";
const HOST_TOKEN = "sk-live-AKIA1234567890SECRETTOKEN";
const hostError = (step: string): string =>
  `${step} failed: ${HOST_NONCE} while writing /root/.openclaw/openclaw.json (auth=${HOST_TOKEN})`;

interface HostFaults {
  /** `mutateConfigFile` throws host-authored text instead of writing. */
  configTransaction?: string;
  /** `ensureAgentWorkspace` throws host-authored text instead of creating. */
  workspace?: string;
  /** Mode the created workspace dir is left in (0o500 ⇒ a real EACCES later). */
  workspaceMode?: number;
}

interface HostCalls {
  mutate: number;
  ensureWorkspace: number;
}

let parentDir: string;
let home: string;
let dataDir: string;
let configPath: string;
let workspace: string;
let faults: HostFaults;
let calls: HostCalls;
let api: MockPluginAPI;
let stdoutWrites: string[];
let stderrWrites: string[];
let priorSilDataDir: string | undefined;
let priorHome: string | undefined;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const readConfigRaw = (): string => readFileSync(configPath, "utf8");
const readConfig = (): Record<string, any> => JSON.parse(readConfigRaw());

/** A realistic pre-run host config: other plugins, another agent, unrelated keys. */
function seedConfig(): void {
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        gateway: { mode: "local", port: 18789 },
        tools: { profile: "coding", alsoAllow: ["other_tool"] },
        plugins: {
          allow: ["someone-else"],
          entries: { "someone-else": { enabled: true, config: { k: 1 } } },
        },
        agents: {
          defaults: { model: "x" },
          list: [{ id: "pre-existing-agent", skills: ["unrelated"] }],
        },
        // The REAL host shape (`vendor/openclaw/src/config/types.agents.ts:54-64`
        // AgentRouteBinding) — a fabricated `{agent,bind}` fixture would make the
        // no-steal guard below pass against an implementation that never checks.
        bindings: [
          { type: "route", agentId: "pre-existing-agent", match: { channel: "cli" } },
        ],
        meta: { lastTouchedVersion: "2026.7.1" },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}

/** The host runtime facade — real fs, real validation, real normalisation. */
function makeRuntime(): Record<string, unknown> {
  return {
    version: "2026.7.1",
    config: {
      current: () => JSON.parse(readConfigRaw()),
      mutateConfigFile: async (params: {
        baseHash?: string;
        afterWrite: unknown;
        mutate: (draft: any, ctx: unknown) => unknown;
      }) => {
        calls.mutate += 1;
        const raw = readConfigRaw();
        const previousHash = sha(raw);
        if (params.baseHash !== undefined && params.baseHash !== previousHash) {
          throw new Error("config changed since last load");
        }
        if (faults.configTransaction) throw new Error(faults.configTransaction);
        const draft = JSON.parse(raw);
        const result = await params.mutate(draft, { path: configPath });
        // The host validates INSIDE the transaction and refuses the whole write
        // (probe: `agents.list.0.id: Invalid input: expected string, received number`).
        const list = draft?.agents?.list;
        if (Array.isArray(list)) {
          list.forEach((entry: any, i: number) => {
            if (typeof entry?.id !== "string") {
              throw new Error(
                `Config validation failed: agents.list.${i}.id: Invalid input: expected string, received ${typeof entry?.id}`,
              );
            }
          });
        }
        // `mutateConfigFile` RE-SERIALISES the whole file — a restore can never
        // be byte-identical, which is why the design keeps this the last step.
        const next = JSON.stringify(draft, null, 2) + "\n";
        writeFileSync(configPath, next, { mode: 0o600 });
        return {
          path: configPath,
          previousHash,
          snapshot: { path: configPath, hash: previousHash },
          nextConfig: draft,
          persistedHash: sha(next),
          afterWrite: params.afterWrite,
          followUp: { mode: "auto", requiresRestart: false },
          result,
        };
      },
    },
    agent: {
      resolveAgentDir: (id: string) => join(home, ".openclaw", "agents", id),
      resolveAgentWorkspaceDir: (id: string) => join(home, ".openclaw", `workspace-${id}`),
      ensureAgentWorkspace: async (params?: { dir?: string; ensureBootstrapFiles?: boolean }) => {
        calls.ensureWorkspace += 1;
        if (faults.workspace) throw new Error(faults.workspace);
        const dir = params?.dir ?? join(home, ".openclaw", "workspace-default");
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const paths: Record<string, string> = { dir };
        if (params?.ensureBootstrapFiles) {
          for (const [key, file] of [
            ["agentsPath", "AGENTS.md"],
            ["toolsPath", "TOOLS.md"],
            ["userPath", "USER.md"],
            ["heartbeatPath", "HEARTBEAT.md"],
          ] as const) {
            const p = join(dir, file);
            writeFileSync(p, `# ${file}\n`, { mode: 0o600 });
            paths[key] = p;
          }
        }
        if (faults.workspaceMode !== undefined) chmodSync(dir, faults.workspaceMode);
        return { ...paths, identityPathCreated: false };
      },
    },
  };
}

beforeEach(() => {
  parentDir = mkdtempSync(join(tmpdir(), "sil-create-tool-"));
  home = join(parentDir, "home");
  dataDir = join(home, ".local", "share", "sil");
  configPath = join(parentDir, "openclaw.json");
  workspace = join(home, ".openclaw", "workspace-my-shopper");
  mkdirSync(join(home, ".openclaw"), { recursive: true, mode: 0o700 });
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  priorHome = process.env["HOME"];
  process.env["SIL_DATA_DIR"] = dataDir;
  process.env["HOME"] = home;
  faults = {};
  calls = { mutate: 0, ensureWorkspace: 0 };
  stdoutWrites = [];
  stderrWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdoutWrites.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderrWrites.push(String(chunk));
    return true;
  });
  seedConfig();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  if (priorHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = priorHome;
  try {
    for (const d of [workspace, join(home, ".openclaw"), dataDir, parentDir]) {
      if (existsSync(d)) chmodSync(d, 0o700);
    }
  } catch {
    /* best effort */
  }
  rmSync(parentDir, { recursive: true, force: true });
});

const SPEC = {
  name: "My Shopper",
  persona: "Patient and thorough.",
  userSpec: "Never recommend anything I can't return.",
};

interface CreateResult {
  status: string;
  [k: string]: unknown;
}

async function create(overrides: Record<string, unknown> = {}): Promise<CreateResult> {
  api = createMockPluginApi({ runtime: makeRuntime() });
  registerCreateShopperTools(api);
  const result = await getTool(api, TOOL).execute("call-1", {
    ...SPEC,
    workspace,
    ...overrides,
  });
  expect(result.content).toHaveLength(1);
  expect(result.content[0]?.type).toBe("text");
  return JSON.parse(result.content[0]?.text as string) as CreateResult;
}

/** Every byte the run emitted anywhere a human or log could read it. */
function emitted(result: CreateResult): string {
  const logs = (["info", "warn", "error", "debug"] as const)
    .flatMap((level) => vi.mocked(api.logger[level]).mock.calls)
    .map((call) => JSON.stringify(call))
    .join("\n");
  return [JSON.stringify(result), logs, stdoutWrites.join(""), stderrWrites.join("")].join("\n");
}

const shopperDir = (): string => join(dataDir, "shopper");
const userSpecPath = (): string => join(shopperDir(), "user_spec.md");

// ---------------------------------------------------------------------------
// B3 — the failure line carries only sil-authored text
// ---------------------------------------------------------------------------

describe("B3 — a host-owned failure emits sil-authored text and NOTHING of the host's", () => {
  it("the config transaction being rejected does not leak the host's error text", async () => {
    faults.configTransaction = hostError("mutateConfigFile");
    const result = await create();

    expect(["persistence_failed", "teardown_failed"]).toContain(result.status);
    const corpus = emitted(result);
    expect(corpus, "the host's error message was forwarded verbatim").not.toContain(HOST_NONCE);
    expect(corpus, "a token-shaped string from the host escaped").not.toContain(HOST_TOKEN);
    expect(corpus).not.toContain(faults.configTransaction);
  });

  it("a failing workspace bootstrap does not leak the host's error text either", async () => {
    faults.workspace = hostError("ensureAgentWorkspace");
    const result = await create();

    expect(result.status).not.toBe("created");
    const corpus = emitted(result);
    expect(corpus).not.toContain(HOST_NONCE);
    expect(corpus).not.toContain(HOST_TOKEN);
  });

  it("the token-shaped string appears in NO stream — result, logger, stdout, stderr", async () => {
    faults.configTransaction = hostError("mutateConfigFile");
    const result = await create();
    expect(JSON.stringify(result)).not.toContain(HOST_TOKEN);
    expect(stdoutWrites.join("")).not.toContain(HOST_TOKEN);
    expect(stderrWrites.join("")).not.toContain(HOST_TOKEN);
    for (const level of ["info", "warn", "error", "debug"] as const) {
      expect(JSON.stringify(vi.mocked(api.logger[level]).mock.calls)).not.toContain(HOST_TOKEN);
    }
  });

  it("omission costs no diagnosability — the failure names the step and a re-runnable command", async () => {
    // The positive half. Without it, returning `{status:"persistence_failed"}`
    // and nothing else would satisfy every leak assertion above.
    faults.configTransaction = hostError("mutateConfigFile");
    const result = await create();
    const cause = String(result["cause"] ?? "");
    expect(cause.trim().length, "the failure carries no cause at all").toBeGreaterThan(15);
    expect(cause, "the cause does not name the failing step in sil's own words").toMatch(
      /config|host configuration/i,
    );
    expect(
      /openclaw\s+[a-z][a-z-]*/i.test(JSON.stringify(result)),
      "the result names no command the user can re-run to see the host's own message",
    ).toBe(true);
  });

  it("names no sil bin as the recovery command — those are not on PATH on every channel", async () => {
    faults.configTransaction = hostError("mutateConfigFile");
    const result = await create();
    expect(JSON.stringify(result)).not.toMatch(/sil-openclaw-(create-shopper|allowlist)/);
  });
});

// ---------------------------------------------------------------------------
// A — the config file is written exactly once, last
// ---------------------------------------------------------------------------

describe("A — the config transaction is the last step and the only config write", () => {
  it("a workspace failure leaves openclaw.json byte-identical and never opens the transaction", async () => {
    const before = readConfigRaw();
    faults.workspace = hostError("ensureAgentWorkspace");
    const result = await create();
    expect(result.status).not.toBe("created");
    expect(readConfigRaw()).toBe(before);
    expect(calls.mutate, "the config transaction ran on a failure path").toBe(0);
  });

  it("an invalid_request never touches the host at all — nothing is attempted", async () => {
    const before = readConfigRaw();
    const result = await create({ workspace: "relative-path" });
    expect(result.status).toBe("invalid_request");
    expect(result["field"]).toBe("workspace");
    expect(readConfigRaw()).toBe(before);
    expect(calls.mutate).toBe(0);
    expect(calls.ensureWorkspace, "the workspace was created before validation").toBe(0);
    expect(existsSync(shopperDir()) && existsSync(userSpecPath())).toBe(false);
  });

  it("a rejected transaction leaves openclaw.json byte-identical", async () => {
    const before = readConfigRaw();
    faults.configTransaction = hostError("mutateConfigFile");
    const result = await create();
    expect(result.status).not.toBe("created");
    expect(readConfigRaw()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// E9 — creation deletes only what THIS RUN created
// ---------------------------------------------------------------------------

describe("E9 — teardown removes only this run's own artefacts", () => {
  it("closes the KNOWN GAP — a pre-existing empty shopper/ no longer strands this run's user_spec.md", async () => {
    // The old gate keyed on WHOLE-DIR pre-existence, so an empty `shopper/`
    // that predated the run made teardown skip the leaf it had just written.
    mkdirSync(shopperDir(), { recursive: true, mode: 0o700 });
    expect(readdirSync(shopperDir())).toEqual([]);

    faults.configTransaction = hostError("mutateConfigFile");
    const result = await create();

    expect(result.status).not.toBe("created");
    expect(existsSync(shopperDir()), "teardown deleted a dir it did not create").toBe(true);
    expect(existsSync(userSpecPath()), "this run's user_spec.md was stranded").toBe(false);
  });

  it("removes the workspace tree it created", async () => {
    faults.configTransaction = hostError("mutateConfigFile");
    const result = await create();
    expect(result.status).not.toBe("created");
    expect(existsSync(workspace), "the workspace this run created survived teardown").toBe(false);
  });

  it("a PRE-EXISTING workspace holding the user's files survives byte-identical", async () => {
    mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const mine = join(workspace, "my-notes.md");
    const nested = join(workspace, "sub", "deep.txt");
    mkdirSync(join(workspace, "sub"), { recursive: true, mode: 0o700 });
    writeFileSync(mine, "my own notes", { mode: 0o600 });
    writeFileSync(nested, "deep content", { mode: 0o600 });

    faults.configTransaction = hostError("mutateConfigFile");
    const result = await create();

    expect(result.status).not.toBe("created");
    expect(existsSync(workspace), "teardown removed a dir the user already had").toBe(true);
    expect(readFileSync(mine, "utf8")).toBe("my own notes");
    expect(readFileSync(nested, "utf8")).toBe("deep content");
    // What this run put INTO the reused dir does go.
    expect(existsSync(join(workspace, "SOUL.md"))).toBe(false);
  });

  it.skipIf(AS_ROOT)(
    "cannot remove what it created ⇒ teardown_failed naming the residue, never a green-washed persistence_failed",
    async () => {
      // A REAL filesystem condition, not a stubbed remover: the host hands back
      // a workspace whose own mode is 0500, so writing SOUL.md into it fails
      // AND `rmSync` cannot unlink the bootstrap files the host put there.
      faults.workspaceMode = 0o500;
      const result = await create();

      expect(
        result.status,
        `expected teardown_failed, got ${result.status}: ${JSON.stringify(result)}`,
      ).toBe("teardown_failed");
      const residue = result["residue"] as Array<{ path: string; cause: string }>;
      expect(Array.isArray(residue)).toBe(true);
      expect(residue.length).toBeGreaterThan(0);
      expect(residue.map((r) => r.path)).toContain(workspace);
      for (const r of residue) {
        expect(r.cause.trim().length, "a residue entry carries no cause").toBeGreaterThan(5);
      }
      // Truthful: the residue really is still there.
      expect(existsSync(workspace)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// A — a SUCCESSFUL create never widens sil's own admission
// ---------------------------------------------------------------------------

describe("A — a successful create writes exactly one agent, and no trust key", () => {
  it("completes with status created and one host transaction", async () => {
    const result = await create();
    expect(result.status, JSON.stringify(result)).toBe("created");
    expect(calls.mutate, "creation opened more than one config transaction").toBe(1);
    expect(result["workspace"]).toBe(workspace);
    expect(typeof result["agentId"]).toBe("string");
  });

  it("plugins.allow and tools.alsoAllow are byte-identical to their pre-run values", async () => {
    const before = readConfig();
    const result = await create();
    expect(result.status).toBe("created");
    const after = readConfig();
    expect(after["plugins"]["allow"]).toEqual(before["plugins"]["allow"]);
    expect(after["tools"]["alsoAllow"]).toEqual(before["tools"]["alsoAllow"]);
    expect(after["plugins"]["entries"]).toEqual(before["plugins"]["entries"]);
  });

  it("every pre-existing key survives — only agents.list and bindings may move", async () => {
    const before = readConfig();
    const result = await create();
    expect(result.status).toBe("created");
    const after = readConfig();

    for (const key of Object.keys(before)) {
      if (key === "agents" || key === "bindings") continue;
      expect(after[key], `top-level key ${key} was modified`).toEqual(before[key]);
    }
    for (const key of Object.keys(before["agents"])) {
      if (key === "list") continue;
      expect(after["agents"][key], `agents.${key} was modified`).toEqual(before["agents"][key]);
    }
    // The pre-existing agent is untouched, and exactly one entry was added.
    const beforeList = before["agents"]["list"] as Array<Record<string, unknown>>;
    const afterList = after["agents"]["list"] as Array<Record<string, unknown>>;
    expect(afterList.length).toBe(beforeList.length + 1);
    expect(afterList.find((a) => a["id"] === "pre-existing-agent")).toEqual(beforeList[0]);
    // Every pre-existing binding survives.
    for (const b of before["bindings"] as unknown[]) {
      expect(after["bindings"]).toContainEqual(b);
    }
  });

  it("the new agent carries the sil skill — the attach is part of the same transaction", async () => {
    const result = await create();
    const after = readConfig();
    const entry = (after["agents"]["list"] as Array<Record<string, any>>).find(
      (a) => a["id"] === result["agentId"],
    );
    expect(entry, "the created agent is not in agents.list").toBeDefined();
    expect(JSON.stringify(entry?.["skills"] ?? [])).toContain("sil-shopping");
  });

  it("the workspace really exists on disk afterwards, owner-only", () => {
    return create().then((result) => {
      expect(result.status).toBe("created");
      expect(existsSync(workspace)).toBe(true);
      expect(statSync(workspace).mode & 0o777).toBe(0o700);
      expect(existsSync(userSpecPath()), "the shopper artefact was not written").toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// REHOMED from the deleted bin's suite (`create-shopper.integration.test.ts`).
//
// That file drove `scripts/create-shopper.mjs` as a child process with a
// PATH-shimmed `openclaw`. The bin is gone, so the file is gone — but three
// classes of behaviour it guarded are NOT creation-mechanism details, they are
// the product contract, and they moved into the tool unchanged. Losing them
// would have quietly shrunk the merge gate:
//
//   - the SINGLETON refusal and the agent-id clash (`collision`),
//   - channel binding: spec > env precedence, no route stolen, fail-open,
//   - `invalid_request` naming the FIRST bad field, deterministically.
//
// One class did NOT survive and is deliberately not rehomed: `AC C1`'s
// "shell metacharacters round-trip verbatim / nothing was shell-expanded".
// There is no shell any more — the persona arrives as a typed tool parameter.
// A test asserting that a value which never touches a shell is not
// shell-expanded is a tautology, and `delete-first` forbids keeping it.
// ---------------------------------------------------------------------------

describe("collision — the shopper is a singleton, and an agent is never overwritten", () => {
  it("a shopper already exists ⇒ collision, and the host is never touched", async () => {
    const before = readConfigRaw();
    const first = await create();
    expect(first.status).toBe("created");

    const afterFirst = readConfigRaw();
    const second = await create({ name: "Another Shopper" });

    expect(second.status).toBe("collision");
    expect(String(second["cause"])).toMatch(/one shopper|already exists/i);
    expect(readConfigRaw(), "the refused run still wrote to the host").toBe(afterFirst);
    expect(afterFirst).not.toBe(before); // the FIRST run really did write
  });

  it("the derived agent id already sits in agents.list ⇒ collision, that agent untouched", async () => {
    // `agentId` is derived from `name`, never supplied — seed the id the name
    // derives to, not a fed-in one.
    const cfg = readConfig();
    const taken = { id: "my-shopper", skills: ["someone-elses"], workspace: "/somewhere/else" };
    cfg["agents"]["list"].push(taken);
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
    const before = readConfigRaw();

    const result = await create();

    expect(result.status).toBe("collision");
    expect(String(result["cause"])).toContain("my-shopper");
    expect(readConfigRaw()).toBe(before);
    expect(calls.mutate).toBe(0);
    // The pre-existing agent is byte-identical — never merged into, never renamed.
    expect(readConfig()["agents"]["list"].find((a: any) => a.id === "my-shopper")).toEqual(taken);
  });

  it("a collision writes NO shopper artefact — the refusal is total", async () => {
    await create();
    rmSync(workspace, { recursive: true, force: true });
    const second = await create({ name: "Another Shopper" });
    expect(second.status).toBe("collision");
    expect(existsSync(workspace), "a refused run still bootstrapped a workspace").toBe(false);
  });
});

describe("bind-the-channel — routed when resolvable, never stolen, fail-open when not", () => {
  it("spec.channel is bound, and the result names it", async () => {
    const result = await create({ channel: "telegram" });
    expect(result.status).toBe("created");
    expect(result["boundChannel"]).toBe("telegram");
    const bindings = readConfig()["bindings"] as Array<Record<string, any>>;
    expect(bindings.some((b) => b?.match?.channel === "telegram")).toBe(true);
    expect(result["warnings"]).toEqual([]);
  });

  it("spec.channel WINS over the env channel (precedence: spec > env)", async () => {
    process.env["OPENCLAW_MCP_MESSAGE_CHANNEL"] = "whatsapp";
    try {
      const result = await create({ channel: "telegram" });
      expect(result["boundChannel"]).toBe("telegram");
      const bindings = readConfig()["bindings"] as Array<Record<string, any>>;
      expect(bindings.some((b) => b?.match?.channel === "whatsapp")).toBe(false);
    } finally {
      delete process.env["OPENCLAW_MCP_MESSAGE_CHANNEL"];
    }
  });

  it("the env channel supplies it when the spec omits it", async () => {
    process.env["OPENCLAW_MCP_MESSAGE_CHANNEL"] = "whatsapp";
    try {
      const result = await create();
      expect(result["boundChannel"]).toBe("whatsapp");
    } finally {
      delete process.env["OPENCLAW_MCP_MESSAGE_CHANNEL"];
    }
  });

  it("a channel another agent already owns is NOT stolen — created + a manual-bind warning", async () => {
    // The pre-run config already routes `cli` to `pre-existing-agent`.
    const before = readConfig()["bindings"];
    const result = await create({ channel: "cli" });

    expect(result.status).toBe("created");
    expect(result["boundChannel"]).toBeNull();
    // Every pre-existing binding survives, and no SECOND route to `cli` was
    // minted — the prior owner keeps it, and the new shopper gets no route.
    for (const b of before as unknown[]) expect(readConfig()["bindings"]).toContainEqual(b);
    const cliRoutes = (readConfig()["bindings"] as Array<Record<string, any>>).filter(
      (b) => b?.match?.channel === "cli",
    );
    expect(cliRoutes).toHaveLength(1);
    expect(cliRoutes[0]?.["agentId"]).toBe("pre-existing-agent");
    expect((result["warnings"] as string[]).join(" ")).toMatch(/bind/i);
  });

  it("fail-open: no channel anywhere ⇒ created with a warning, and NO bindings entry", async () => {
    const before = readConfig()["bindings"];
    const result = await create();
    expect(result.status).toBe("created");
    expect(result["boundChannel"]).toBeNull();
    expect(readConfig()["bindings"]).toEqual(before);
    const warnings = result["warnings"] as string[];
    expect(warnings.length).toBeGreaterThan(0);
    // The warning must be actionable, and must name a host command, not a sil bin.
    expect(warnings.join(" ")).toMatch(/openclaw agents bind|\/agent /);
    expect(warnings.join(" ")).not.toMatch(/sil-openclaw-/);
  });

  it("a blank channel is treated as undetermined, never bound as an empty string", async () => {
    const result = await create({ channel: "   " });
    expect(result.status).toBe("created");
    expect(result["boundChannel"]).toBeNull();
    const bindings = readConfig()["bindings"] as Array<Record<string, any>>;
    expect(bindings.some((b) => b?.match?.channel === "" || b?.match?.channel === "   ")).toBe(
      false,
    );
  });
});

describe("invalid_request — every required field is validated, deterministically, first", () => {
  const REQUIRED = ["name", "persona", "userSpec"] as const;

  for (const field of REQUIRED) {
    it(`a blank ${field} ⇒ invalid_request naming ${field}, nothing attempted`, async () => {
      const before = readConfigRaw();
      const result = await create({ [field]: "   " });
      expect(result.status).toBe("invalid_request");
      expect(result["field"]).toBe(field);
      expect(String(result["cause"]).length).toBeGreaterThan(10);
      expect(readConfigRaw()).toBe(before);
      expect(calls.ensureWorkspace).toBe(0);
      expect(calls.mutate).toBe(0);
    });
  }

  it("names the FIRST bad field in a fixed order — the message never depends on object key order", async () => {
    // Two fields bad at once. A validator that iterated `Object.keys(params)`
    // would name whichever the caller happened to serialise first.
    const a = await create({ name: "", persona: "", userSpec: "", workspace: "relative" });
    const b = await create({ userSpec: "", persona: "", name: "", workspace: "relative" });
    expect(a["field"]).toBe(b["field"]);
    expect(a["field"]).toBe("name");
  });

  it("a bad workspace is reported with the RULE it broke, not just the field", async () => {
    const result = await create({ workspace: "~/.openclaw/ws" });
    expect(result.status).toBe("invalid_request");
    expect(result["field"]).toBe("workspace");
    const text = `${String(result["rule"] ?? "")} ${String(result["cause"] ?? "")}`;
    expect(text, "the refusal never says WHY the path was rejected").toMatch(/~|tilde/i);
  });
});
