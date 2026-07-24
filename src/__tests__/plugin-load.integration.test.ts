/**
 * INTEGRATION — host-load proof, downgraded from e2e (tier: integration).
 *
 * The card's e2e "host reports the plugin loaded/active" criterion is
 * DOWNGRADED per the architect's handoff: no Docker host in this env, so
 * the load proof is "import the entry, invoke the captured register()
 * against a mock api, assert no-throw + the `sil_plugin_loaded` marker
 * fires." A full dockerized publish-shape smoke is a follow-up card.
 *
 * The distinction from index.test.ts: that file asserts the entry
 * contract narrowly (sync register, the single load marker, config
 * precedence). This file runs the ENTIRE real register path end-to-end —
 * real entry module, real tool registration, real config resolution, real
 * marker — with only the ambient SDK shim
 * (`openclaw/plugin-sdk/plugin-entry`) stubbed, because
 * that module is provided by the OpenClaw runtime, not an npm package,
 * and cannot be resolved outside a host. That is the closest a no-Docker
 * env gets to "the host loaded it without error."
 *
 * This file imports the TS source entry (`../index.js`) unconditionally,
 * so every register-path assertion exercises CURRENT source — never a
 * stale `dist/` that happens to sit on the checkout. The proof that the
 * COMPILED `dist/index.js` loads and registers lives in
 * `compiled-artifact-load.integration.test.ts`, which builds a fresh dist
 * in its own `beforeAll`. Here the captured register() is driven against a
 * real in-memory mock api.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   the default export of the entry is produced by definePluginEntry,
 *   and running its register(api) against a mock api completes without
 *   throwing and logs `sil_plugin_loaded` exactly once.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI } from "openclaw/plugin-sdk";
import { getDataDir } from "../lib/credentials.js";
import { createMockPluginApi } from "./helpers/mock-plugin-api.js";

let capturedRegisterFn: ((api: PluginAPI) => void) | null = null;

// Stub ONLY the ambient SDK entry shim — everything else (the entry
// module, the tool group, config, tool-result) runs for real.
vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: vi.fn((entry: { register: (api: PluginAPI) => void }) => {
    capturedRegisterFn = entry.register;
    return entry;
  }),
}));

beforeAll(async () => {
  // Import the CURRENT source entry — unconditionally. The ambient SDK
  // import inside it is satisfied by the vi.mock above. This file never
  // reads `dist/`, so a stale/mismatched build on the checkout can neither
  // inject a phantom tool nor mask a source/manifest regression here. The
  // compiled-artifact proof (fresh-built dist) lives in its own file.
  await import("../index.js");
});

// File-scoped hermetic data dir. Once register() creates the data dir
// (this card's change), EVERY register() call in this file would otherwise
// touch the real $SIL_DATA_DIR / ~/.local/share/sil. Point all of them at a
// throwaway temp dir so no test pollutes the real filesystem. The
// specialized describe blocks below set their OWN $SIL_DATA_DIR in their own
// beforeEach (which runs after this one), so they still control their target.
let fileTempDataDir: string;
let filePriorSilDataDir: string | undefined;

beforeEach(() => {
  fileTempDataDir = mkdtempSync(join(tmpdir(), "sil-load-file-"));
  filePriorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = fileTempDataDir;
});

afterEach(() => {
  if (filePriorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = filePriorSilDataDir;
  rmSync(fileTempDataDir, { recursive: true, force: true });
});

describe("plugin load (no-Docker downgrade of the e2e host-load criterion)", () => {
  it("imports the entry module without throwing (captures a register fn)", () => {
    expect(capturedRegisterFn).toBeTypeOf("function");
  });

  it("runs the FULL real register() against a mock api without throwing", () => {
    const api = createMockPluginApi();
    expect(() => capturedRegisterFn!(api)).not.toThrow();
  });

  it("registers at least one tool through the real register path", () => {
    // End-to-end: the real tool group ran and populated the api.
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    expect(api._tools.size).toBeGreaterThan(0);
  });

  it("emits the `sil_plugin_loaded` marker exactly once", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    const markerCalls = vi
      .mocked(api.logger.info)
      .mock.calls.filter(([marker]) => marker === "sil_plugin_loaded");
    expect(markerCalls).toHaveLength(1);
  });
});

describe("plugin load — data dir is created by the FULL real register() (card integration)", () => {
  // The integration the product ACs imply (architect handoff §6, final
  // bullet): the ENTIRE real register() path, under a fresh temp
  // $SIL_DATA_DIR, creates the data dir, still fires `sil_plugin_loaded`
  // exactly once, and leaves the tool set unchanged — proving the creation
  // rides alongside the existing load contract, not in place of it.
  // Real temp dir, no fs mocking.
  let parentDir: string;
  let target: string;
  let priorSilDataDir: string | undefined;
  let priorXdg: string | undefined;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), "sil-load-datadir-"));
    target = join(parentDir, "data");
    priorSilDataDir = process.env["SIL_DATA_DIR"];
    priorXdg = process.env["XDG_DATA_HOME"];
    process.env["SIL_DATA_DIR"] = target;
  });

  afterEach(() => {
    if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
    else process.env["SIL_DATA_DIR"] = priorSilDataDir;
    if (priorXdg === undefined) delete process.env["XDG_DATA_HOME"];
    else process.env["XDG_DATA_HOME"] = priorXdg;
    rmSync(parentDir, { recursive: true, force: true });
  });

  it("creates the resolved data dir (0700) as a side effect of registering", () => {
    expect(existsSync(target)).toBe(false); // precondition: clean machine
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    expect(existsSync(target)).toBe(true);
    expect(statSync(target).isDirectory()).toBe(true);
    // eslint-disable-next-line no-bitwise
    expect(statSync(target).mode & 0o777).toBe(0o700);
  });

  it("still fires `sil_plugin_loaded` exactly once AND leaves the tool set unchanged", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    const markerCalls = vi
      .mocked(api.logger.info)
      .mock.calls.filter(([marker]) => marker === "sil_plugin_loaded");
    expect(markerCalls).toHaveLength(1);
    // The full real tool set — the data-dir creation does not add/drop a tool.
    // 11 tools after the sil-doctor-tool-data-store-identity-health card added
    // sil_doctor (report-first data-store/identity/version health) in the new
    // doctor group.
    expect([...api._tools.keys()].sort()).toEqual([
      "sil_doctor",
      "sil_learn",
      "sil_product_get",
      "sil_profile_get",
      "sil_profile_materialize",
      "sil_profile_remove",
      "sil_profile_search",
      "sil_register",
      "sil_search",
      "sil_specs",
      "sil_whoami",
    ]);
  });

  it("surfaces WHERE the guaranteed home is via a `data_dir` field on the load marker", () => {
    // Product §3: the dir-ensured fact rides the existing `sil_plugin_loaded`
    // info line as a single `data_dir` field (the resolved path) — NOT a new
    // `sil_data_dir_ensured` event. So an installer can see the home at load.
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    expect(api.logger.info).toHaveBeenCalledWith(
      "sil_plugin_loaded",
      expect.objectContaining({ data_dir: target }),
    );
    // No separate success event for the guaranteed-success path (log noise).
    const ensuredEvents = vi
      .mocked(api.logger.info)
      .mock.calls.filter(([marker]) => marker === "sil_data_dir_ensured");
    expect(ensuredEvents).toHaveLength(0);
  });
});

describe("plugin load — an uncreatable data dir is a LOUD, fail-closed terminal (AC5)", () => {
  // AC5 (integration tier): when the resolved data dir cannot be created,
  // register() must FAIL CLOSED — throw out of register() (the host rejects
  // the plugin) AND emit a structured `sil_plugin_data_dir_failed` error log
  // naming the path + OS cause (no token/PII). The failure must NOT be
  // swallowed, and no partial dir may be left behind.
  //
  // The failure is induced production-faithfully (the register-claim FIX-C
  // repro): a regular FILE sits where the data dir's parent should be, so the
  // recursive mkdir throws ENOTDIR — a real, un-fakeable filesystem failure
  // carrying the path + cause. NO fs mocking, NO logic stubbing.
  let parentDir: string;
  let blockerFile: string;
  let unwritableDataDir: string;
  let priorSilDataDir: string | undefined;
  let priorXdg: string | undefined;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), "sil-datadir-fail-"));
    blockerFile = join(parentDir, "blocker");
    writeFileSync(blockerFile, "i am a file, not a directory");
    // A child of a regular file → mkdirSync(recursive) throws ENOTDIR.
    unwritableDataDir = join(blockerFile, "sil-data");
    priorSilDataDir = process.env["SIL_DATA_DIR"];
    priorXdg = process.env["XDG_DATA_HOME"];
    process.env["SIL_DATA_DIR"] = unwritableDataDir;
  });

  afterEach(() => {
    if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
    else process.env["SIL_DATA_DIR"] = priorSilDataDir;
    if (priorXdg === undefined) delete process.env["XDG_DATA_HOME"];
    else process.env["XDG_DATA_HOME"] = priorXdg;
    rmSync(parentDir, { recursive: true, force: true });
  });

  it("register() THROWS (fail-closed) on an uncreatable data dir", () => {
    // Sanity: the resolver points where we expect, and that path is uncreatable.
    expect(getDataDir()).toBe(unwritableDataDir);
    const api = createMockPluginApi();
    // A guaranteed home that silently isn't there is the exact failure this
    // card exists to kill — register() must refuse to load, not continue.
    expect(() => capturedRegisterFn!(api)).toThrow();
  });

  it("logs a structured `sil_plugin_data_dir_failed` error naming the path + OS cause", () => {
    const api = createMockPluginApi();
    try {
      capturedRegisterFn!(api);
    } catch {
      // Expected — we assert on the log emitted BEFORE the rethrow.
    }
    const failCalls = vi
      .mocked(api.logger.error)
      .mock.calls.filter(([marker]) => marker === "sil_plugin_data_dir_failed");
    // The failure is observable at error level, NOT swallowed.
    expect(failCalls).toHaveLength(1);
    const [, payload] = failCalls[0]!;
    const detail = JSON.stringify(payload);
    // Names the failing path...
    expect(detail).toContain(unwritableDataDir);
    // ...and the OS cause (ENOTDIR), so the operator can act (fix_data_dir).
    expect(detail).toContain("ENOTDIR");
    // No token/PII vocabulary on this registration-time log.
    expect(detail).not.toContain("access_token");
    expect(detail).not.toContain("refresh_token");
  });

  it("does NOT swallow the failure into a `sil_plugin_loaded` success marker", () => {
    const api = createMockPluginApi();
    try {
      capturedRegisterFn!(api);
    } catch {
      /* expected */
    }
    // Fail-closed means the load marker for SUCCESS must not fire when the
    // home could not be guaranteed — the throw precedes it.
    const loaded = vi
      .mocked(api.logger.info)
      .mock.calls.filter(([marker]) => marker === "sil_plugin_loaded");
    expect(loaded).toHaveLength(0);
  });

  it("leaves NO partial data dir behind (the blocker is still a file)", () => {
    const api = createMockPluginApi();
    try {
      capturedRegisterFn!(api);
    } catch {
      /* expected */
    }
    // The blocker path stays a regular file — nothing half-created it into
    // a dir, and the (impossible) data dir does not exist.
    expect(statSync(blockerFile).isFile()).toBe(true);
    expect(existsSync(unwritableDataDir)).toBe(false);
  });
});

const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

describe.skipIf(AS_ROOT)(
  "plugin load — an uncreatable data dir registers NOTHING: no tool, and no gateway method (AC10)",
  () => {
    // The half 0.4.5 added and nothing pinned. `register()` now hands the host a
    // SECOND surface (`sil.search_results`), and under the new `onStartup: true`
    // posture it runs on the gateway's boot path. `ensureDataDir()` throws BEFORE
    // any `registerXTools`/`registerSearchResultsMethod` call, so the fail-closed
    // terminal must leave the api COMPLETELY untouched — a half-registered plugin
    // would hand a paired client a gateway method backed by a store whose home
    // does not exist.
    //
    // The fault is injected with REAL filesystem permissions (a `0o500` containing
    // dir ⇒ EACCES on the recursive mkdir), never a synthetic production hook: a
    // hook would test the hook. It is deliberately a DIFFERENT errno from the AC5
    // block's ENOTDIR blocker-file, which is what makes the log assertion below
    // non-vacuous — a `cause` hardcoded to "ENOTDIR" passes there and fails here.
    // Root bypasses permission bits, hence the skip guard.
    let containingDir: string;
    let targetDataDir: string;
    let priorSilDataDir: string | undefined;
    let priorXdg: string | undefined;

    beforeEach(() => {
      containingDir = mkdtempSync(join(tmpdir(), "sil-datadir-ro-"));
      targetDataDir = join(containingDir, "sil-data");
      chmodSync(containingDir, 0o500);
      priorSilDataDir = process.env["SIL_DATA_DIR"];
      priorXdg = process.env["XDG_DATA_HOME"];
      process.env["SIL_DATA_DIR"] = targetDataDir;
    });

    afterEach(() => {
      if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
      else process.env["SIL_DATA_DIR"] = priorSilDataDir;
      if (priorXdg === undefined) delete process.env["XDG_DATA_HOME"];
      else process.env["XDG_DATA_HOME"] = priorXdg;
      chmodSync(containingDir, 0o700);
      rmSync(containingDir, { recursive: true, force: true });
    });

    it("register() throws EACCES and registers NOTHING — not one tool, not the gateway method", () => {
      // A null captured register would ALSO throw (TypeError) and leave the api
      // empty, which would make both assertions below vacuous. Pin the premise.
      expect(capturedRegisterFn).toBeTypeOf("function");
      expect(getDataDir()).toBe(targetDataDir);

      const api = createMockPluginApi();
      // The throw is the OS one, not an incidental harness error.
      expect(() => capturedRegisterFn!(api)).toThrow(/EACCES/);

      expect([...api._tools.keys()]).toEqual([]);
      expect([...api._gatewayMethods.keys()]).toEqual([]);
    });

    it("logs `sil_plugin_data_dir_failed` naming the path + the REAL OS cause, with no credential vocabulary", () => {
      const api = createMockPluginApi();
      try {
        capturedRegisterFn!(api);
      } catch {
        // Expected — the log is emitted before the rethrow.
      }
      const failCalls = vi
        .mocked(api.logger.error)
        .mock.calls.filter(([marker]) => marker === "sil_plugin_data_dir_failed");
      expect(failCalls).toHaveLength(1);
      const detail = JSON.stringify(failCalls[0]![1]);
      expect(detail).toContain(targetDataDir);
      // EACCES, not ENOTDIR: the cause is read off the OS error, never a literal.
      expect(detail).toContain("EACCES");
      // Registration-time log: no credential material, on the loudest path.
      expect(detail).not.toContain("access_token");
      expect(detail).not.toContain("refresh_token");
      expect(detail).not.toContain("Bearer");
    });

    it("is NOT VACUOUS — the SAME register() populates both surfaces once the dir is creatable", () => {
      // Without this, "registers nothing" is satisfied by any throw at all —
      // including a broken harness that never reaches the plugin. Same captured
      // register, same api factory, only the directory mode changes.
      chmodSync(containingDir, 0o700);

      const api = createMockPluginApi();
      expect(() => capturedRegisterFn!(api)).not.toThrow();
      expect(api._tools.size).toBeGreaterThan(0);
      // Count only — the method NAME is pinned by the single exact-set carrier in
      // `search-results-method.integration.test.ts`; a second name mirror here
      // would only add a place to forget to bump.
      expect(api._gatewayMethods.size).toBe(1);
    });
  },
);

describe("plugin load — the register path is SOURCE-authoritative, immune to a stale on-disk dist (AC3)", () => {
  // The masked-regression instance the card exists to kill. PRE-FIX this file
  // PREFERRED a prebuilt dist/index.js (`existsSync(DIST_ENTRY) ? import(dist)
  // : import(src)`), so an old-correct `dist/` could mask a genuine
  // source/manifest regression — the `preversion` gate would PASS while source
  // was broken (the worse of the two failure modes). The fix imports
  // `../index.js` UNCONDITIONALLY (see beforeAll), so the register path
  // exercised across THIS whole file is current source; the set it registers
  // must equal openclaw.plugin.json#contracts.tools regardless of whatever
  // `dist/` sits on the checkout.
  //
  // Set-equality is keyed to contracts.tools read AT RUNTIME (a manifest read,
  // not a hardcoded literal) so this pin never becomes a 7th tool-set fan-out
  // mirror — it self-updates with the manifest. RED-capability: with the
  // pre-fix dist-preference + a mismatched `dist/index.js` planted,
  // capturedRegisterFn would be sourced from that dist and this set would
  // diverge from the manifest; the sibling compiled-artifact-load proof
  // demonstrates the live plant→wipe flip in-process.
  function manifestToolNames(): string[] {
    const manifest = JSON.parse(
      readFileSync(new URL("../../openclaw.plugin.json", import.meta.url), "utf8"),
    ) as { contracts?: { tools?: unknown } };
    const tools = manifest.contracts?.tools;
    if (!Array.isArray(tools)) {
      throw new Error("openclaw.plugin.json#contracts.tools is not an array");
    }
    return tools as string[];
  }

  it("registers EXACTLY the manifest tool set from CURRENT source (no on-disk dist masks it)", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    expect([...api._tools.keys()].sort()).toEqual([...manifestToolNames()].sort());
  });

  it("does NOT resurrect the since-deleted sil_profile_list (an old-correct dist can no longer mask a source regression)", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    expect([...api._tools.keys()]).not.toContain("sil_profile_list");
    expect(api._tools.size).toBe(manifestToolNames().length);
  });
});
