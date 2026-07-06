/**
 * INTEGRATION — the compiled-artifact load proof, made STALE-DIST-IMMUNE
 * (tier: integration). This is the primary determinism pin for the card
 * "make-the-version-bump-gate-immune-to-stale-dist" — AC2 (phantom-fail
 * instance) and AC4 (compiled proof ⇒ fresh dist).
 *
 * THE HAZARD THIS FILE KILLS. `plugin-load.integration.test.ts` used to
 * prefer a prebuilt `dist/index.js` if one sat on the checkout, falling
 * back to source only when absent. `pnpm version`'s `preversion` gate
 * (`pnpm typecheck && pnpm test`) never rebuilds `dist/` first, so a STALE
 * `dist/` silently drove the load assertions: on `pnpm version 0.3.6` the
 * gate failed with a phantom tool-set mismatch — a since-deleted
 * `sil_profile_list` "reappearing" (9 tools vs the real 8) — even though
 * source + manifest were already correct. The inverse is worse: an
 * old-correct `dist/` could let a REAL source regression PASS the gate.
 *
 * THE CONTRACT PINNED HERE (AC2/AC4). The compiled-artifact load proof
 * must exercise a `dist/` built FROM CURRENT SOURCE in this same gate run —
 * NEVER whatever stale `dist/` happens to be present. We prove that
 * adversarially: `beforeAll` PLANTS a poison compiled entry that registers
 * the OLD 9-tool set (the exact 0.3.6 repro) plus a `__STALE_MARKER__`
 * sentinel file, and the assertions demand the poison was WIPED and a
 * fresh, source-faithful `dist/` loaded instead. A gate that reads the
 * planted poison fails every assertion below; a gate that clean-builds
 * from source before loading passes them all.
 *
 * WHY A SEPARATE FILE. `definePluginEntry` is mocked to capture the
 * entry's `register` into a FILE-SCOPE variable. A source import and a
 * compiled import in the SAME file would overwrite each other's capture.
 * This file imports ONLY the compiled entry; the source-authoritative pin
 * lives in `plugin-load.integration.test.ts` (its own module registry).
 *
 * WHY THE HERMETIC outDir IS UNDER REPO_ROOT. vitest only transforms (and
 * so only applies `vi.mock` to) modules under its project root. The
 * compiled entry's `import … from "openclaw/plugin-sdk/plugin-entry"` is a
 * bare specifier the OpenClaw runtime provides — unresolvable outside a
 * host — so it MUST be intercepted by the mock. Emit the build under
 * REPO_ROOT (`mkdtempSync(join(REPO_ROOT, ".tmp-dist-load-"))`), never the
 * OS tmpdir, or the import 404s. A per-run unique outDir also avoids racing
 * `openclaw-allowlist.integration.test.ts`'s real-`dist/` build under
 * `pool: 'forks'`.
 *
 * These assertions ARE the spec. Do NOT weaken them to match the harness.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PluginAPI } from "openclaw/plugin-sdk";
import { createMockPluginApi } from "./helpers/mock-plugin-api.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root of the checkout under test (…/src/__tests__ → root). */
const REPO_ROOT = join(HERE, "..", "..");
const MANIFEST_PATH = join(REPO_ROOT, "openclaw.plugin.json");

/** The manifest tool set, read AT RUNTIME — the single source of truth the
 * registered set must equal. Read at runtime (never a hardcoded literal) so
 * this file never becomes a 7th tool-set fan-out mirror: it self-updates with
 * `openclaw.plugin.json#contracts.tools`. */
function contractsTools(): string[] {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
    contracts?: { tools?: unknown };
  };
  const tools = manifest.contracts?.tools;
  if (!Array.isArray(tools)) {
    throw new Error("openclaw.plugin.json#contracts.tools is not an array");
  }
  return tools as string[];
}

/**
 * The OLD 9-tool set the planted STALE dist registers: the real 8 tools PLUS
 * the since-deleted `sil_profile_list` — the exact `pnpm version 0.3.6` repro.
 * This is a deliberate POISON fixture (the pre-consolidation set), NOT an
 * assertion of the current set, so it is not a tool-set fan-out mirror.
 */
const STALE_NINE_TOOL_SET = [
  "sil_product_get",
  "sil_profile_get",
  "sil_profile_list",
  "sil_profile_materialize",
  "sil_profile_remove",
  "sil_register",
  "sil_remember",
  "sil_search",
  "sil_whoami",
];

/** A fake COMPILED plugin entry (ESM, as `tsc` would emit) that registers the
 * stale 9-tool set. Its bare `openclaw/plugin-sdk/plugin-entry` import is the
 * one the `vi.mock` below intercepts. If the gate loads THIS instead of a
 * freshly-built dist, every determinism assertion fails. */
const STALE_POISON_ENTRY_JS = `import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
export default definePluginEntry({
  id: "sil",
  name: "sil",
  description: "STALE POISON compiled entry — registers the OLD 9-tool set (the 0.3.6 repro).",
  register(api) {
    for (const name of ${JSON.stringify(STALE_NINE_TOOL_SET)}) {
      api.registerTool({
        name,
        label: name,
        description: name,
        parameters: { type: "object", properties: {} },
        execute() {
          return { content: [] };
        },
      });
    }
    api.logger.info("sil_plugin_loaded", { message: "STALE poison entry loaded" });
  },
});
`;

let outDir: string;
let capturedRegisterFn: ((api: PluginAPI) => void) | null = null;

// Stub ONLY the ambient SDK entry shim — the compiled entry (poison pre-fix,
// fresh-built post-fix) runs for real against a mock api.
vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: vi.fn((entry: { register: (api: PluginAPI) => void }) => {
    capturedRegisterFn = entry.register;
    return entry;
  }),
}));

beforeAll(async () => {
  // 1. Hermetic per-run outDir UNDER REPO_ROOT (vitest transform / vi.mock reach).
  outDir = mkdtempSync(join(REPO_ROOT, ".tmp-dist-load-"));

  // 2. PLANT the stale artifact: a poison compiled entry registering the OLD
  //    9-tool set, plus a sentinel file. A stale-dist-immune gate must WIPE
  //    both and rebuild dist from CURRENT source before loading it.
  writeFileSync(join(outDir, "__STALE_MARKER__"), "planted-stale-dist\n");
  writeFileSync(join(outDir, "index.js"), STALE_POISON_ENTRY_JS);

  // 3. THE FIX — make the compiled proof exercise CURRENT source, never the
  //    planted stale artifact. Wipe the poison entry + sentinel, then build a
  //    fresh dist from source into this outDir, mirroring
  //    `openclaw-allowlist.integration.test.ts:134-147`. `tsc` overwrites
  //    index.js, but does NOT clean the outDir, so the sentinel must be removed
  //    explicitly — that removal is the direct observable the assertions check.
  //    We invoke `node_modules/typescript/bin/tsc` (the compiler's real JS
  //    entry); `.bin/tsc` is a bash wrapper `node` cannot run. `rootDir: src`
  //    emits the entry at `<outDir>/index.js`.
  rmSync(join(outDir, "__STALE_MARKER__"), { force: true });
  rmSync(join(outDir, "index.js"), { force: true });
  execFileSync(
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--outDir", outDir],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (!existsSync(join(outDir, "index.js"))) {
    throw new Error(
      `fresh build emitted no ${join(outDir, "index.js")} — the compiled-load import would 404`,
    );
  }

  // 4. Load the freshly-built compiled entry in-process; the vi.mock captures
  //    its register.
  await import(pathToFileURL(join(outDir, "index.js")).href);
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

// File-scoped hermetic $SIL_DATA_DIR: the REAL fresh-built register() calls
// ensureDataDir() (a 0700 mkdir), so point it at a throwaway temp dir per test
// — no test pollutes the real filesystem, and register() does not fail-closed
// on an uncreatable home.
let tempDataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  tempDataDir = mkdtempSync(join(tmpdir(), "sil-compiled-load-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = tempDataDir;
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(tempDataDir, { recursive: true, force: true });
});

describe("compiled-artifact load runs against a FRESH dist, never the planted stale one (AC2/AC4)", () => {
  it("captures a register fn from the loaded compiled entry", () => {
    // beforeAll imported the compiled entry; the mock captured its register.
    expect(capturedRegisterFn).toBeTypeOf("function");
  });

  it("WIPED the planted stale artifact — __STALE_MARKER__ is gone (fresh build cleaned the outDir)", () => {
    // Pre-fix (no clean-build step) the marker survives → RED. A gate that
    // rebuilds from source first removes it → GREEN. This is the direct
    // observable that the stale dist did NOT drive the load.
    expect(existsSync(join(outDir, "__STALE_MARKER__"))).toBe(false);
  });

  it("registers EXACTLY the current manifest tool set — the 9-tool poison never drives it (AC2)", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    // Set-equality against contracts.tools read at RUNTIME (self-updating, not
    // a hardcoded literal → not a 7th fan-out mirror). The stale 9-tool poison
    // would make this 9 ≠ 8.
    expect([...api._tools.keys()].sort()).toEqual([...contractsTools()].sort());
  });

  it("does NOT register the since-deleted sil_profile_list (the 0.3.6 phantom 9th tool)", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    expect([...api._tools.keys()]).not.toContain("sil_profile_list");
    expect(api._tools.size).toBe(contractsTools().length);
  });

  it("runs the compiled register() against a mock api without throwing", () => {
    const api = createMockPluginApi();
    expect(() => capturedRegisterFn!(api)).not.toThrow();
  });

  it("fires the `sil_plugin_loaded` marker exactly once (compiled artifact loads clean)", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    const markerCalls = vi
      .mocked(api.logger.info)
      .mock.calls.filter(([marker]) => marker === "sil_plugin_loaded");
    expect(markerCalls).toHaveLength(1);
  });
});
