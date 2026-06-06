/**
 * INTEGRATION — host-load proof, downgraded from e2e (tier: integration).
 *
 * The card's e2e "host reports the plugin loaded/active" criterion is
 * DOWNGRADED per the architect's handoff: no Docker host in this env, so
 * the load proof is "import the entry, invoke the captured register()
 * against a mock api, assert no-throw + the `sil_plugin_loaded` marker
 * fires." A full dockerized publish-shape smoke is a follow-up card.
 *
 * The distinction from index.test.ts: that file mocks the tool group
 * (registerExampleTools) to isolate the WIRING. This file runs the
 * ENTIRE real register path end-to-end — real entry module, real tool
 * registration, real config resolution, real marker — with only the
 * ambient SDK shim (`openclaw/plugin-sdk/plugin-entry`) stubbed, because
 * that module is provided by the OpenClaw runtime, not an npm package,
 * and cannot be resolved outside a host. That is the closest a no-Docker
 * env gets to "the host loaded it without error."
 *
 * If a built dist/index.js exists it is preferred (proves the COMPILED
 * artifact loads); otherwise the TS source entry is used. Either way the
 * captured register() is driven against a real in-memory mock api.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   the default export of the entry is produced by definePluginEntry,
 *   and running its register(api) against a mock api completes without
 *   throwing and logs `sil_plugin_loaded` exactly once.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginAPI } from "openclaw/plugin-sdk";
import { createMockPluginApi } from "./helpers/mock-plugin-api.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "index.js");

let capturedRegisterFn: ((api: PluginAPI) => void) | null = null;
let loadedFrom: "dist" | "src" = "src";

// Stub ONLY the ambient SDK entry shim — everything else (the entry
// module, the tool group, config, tool-result) runs for real.
vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: vi.fn((entry: { register: (api: PluginAPI) => void }) => {
    capturedRegisterFn = entry.register;
    return entry;
  }),
}));

beforeAll(async () => {
  // Prefer the built artifact if it exists; the ambient SDK import in it
  // is satisfied by the vi.mock above. Fall back to the TS source entry.
  if (existsSync(DIST_ENTRY)) {
    loadedFrom = "dist";
    await import(/* @vite-ignore */ DIST_ENTRY);
  } else {
    loadedFrom = "src";
    await import("../index.js");
  }
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

  it("records which artifact was loaded (dist preferred, src fallback)", () => {
    // Not an assertion on behavior — a visible breadcrumb so the test
    // log says whether the COMPILED entry or the source was exercised.
    expect(["dist", "src"]).toContain(loadedFrom);
  });
});
