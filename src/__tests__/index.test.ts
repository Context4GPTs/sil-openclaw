/**
 * UNIT — plugin entry contract (tier: unit, mock api, no I/O).
 *
 * Mirrors the reference adapter's `index.test.ts`: `definePluginEntry`
 * is mocked to capture the `register` callback, then we drive that
 * callback with a mock plugin api and assert the registration contract.
 *
 * Covers the card's "Plugin loads correctly" unit criteria:
 *   - register(api) completes synchronously without throwing and emits
 *     EXACTLY ONE `sil_plugin_loaded` info-log marker;
 *   - register(api) opens no socket, arms no timer, starts no
 *     long-lived resource — it returns and does not hold the event loop
 *     open (the klodi install-hang failure mode, architect Risk #2);
 *   - the pluginConfig override path: a non-empty `sil_web_url` override
 *     is applied; an empty string is ignored; a value sitting on
 *     `api.config` (the WRONG, non-plugin-scoped source) is ignored.
 *
 * Also pins the lib helper the architect's strategy calls out at the
 * unit tier — `jsonResult` shape — and `applyPluginConfigOverrides`
 * precedence, co-located here because they share the config-reset
 * machinery and the entry contract is what wires them together.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - default export of src/index.ts is the value returned by
 *     definePluginEntry({ id, name, description, register });
 *   - register(api) wires the real tool groups (so register() populates
 *     the api with tools), applies pluginConfig overrides, and logs
 *     `sil_plugin_loaded` once;
 *   - src/lib/config.ts exports applyPluginConfigOverrides, getWebUrl,
 *     getWebUrlSource, setWebUrl (env-fallback override pattern);
 *   - src/lib/tool-result.ts exports jsonResult(data).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import type { PluginAPI } from "openclaw/plugin-sdk";

interface CapturedEntry {
  id: string;
  name: string;
  description: string;
  register: (api: PluginAPI) => void;
}

let capturedRegisterFn: ((api: PluginAPI) => void) | null = null;
// The whole entry is captured into a closure variable (not read from
// definePluginEntry.mock.calls) because beforeEach's vi.clearAllMocks()
// wipes the call history recorded during the one-shot beforeAll import —
// but a closure variable survives the reset. Same reason the reference
// adapter keeps `capturedRegisterFn` at module scope.
let capturedEntry: CapturedEntry | null = null;

vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: vi.fn((entry: CapturedEntry) => {
    capturedEntry = entry;
    capturedRegisterFn = entry.register;
    return entry;
  }),
}));

import {
  applyPluginConfigOverrides,
  getWebUrl,
  getWebUrlSource,
  setWebUrl,
} from "../lib/config.js";
import { jsonResult } from "../lib/tool-result.js";
import { createMockPluginApi } from "./helpers/mock-plugin-api.js";

beforeAll(async () => {
  // Importing the entry module runs definePluginEntry, capturing register.
  await import("../index.js");
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset module-level config state so each test starts at "default".
  setWebUrl("");
  delete process.env["SIL_WEB_URL"];
});

describe("plugin entry — registration contract", () => {
  it("captures a register function from definePluginEntry", () => {
    // beforeEach clears definePluginEntry's call history, but the
    // captured register fn survives across resets (closure variable).
    expect(capturedRegisterFn).toBeTypeOf("function");
  });

  it("calls definePluginEntry with non-empty id, name, and description", () => {
    // Read from the closure capture, not definePluginEntry.mock.calls:
    // beforeEach's clearAllMocks() wipes the call recorded at import time.
    expect(capturedEntry).not.toBeNull();
    expect(capturedEntry!.id.length).toBeGreaterThan(0);
    expect(capturedEntry!.name.length).toBeGreaterThan(0);
    expect(capturedEntry!.description.length).toBeGreaterThan(0);
  });

  it("wires the real tool groups into register() — registers exactly the real tool set", () => {
    // register() runs the real tool groups (no mock), so it populates the
    // api with exactly the real tools and NO example stub. This pins the
    // wiring AND the card's "absence" goal: sil_ping / sil_echo gone.
    // sil_profile_materialize (agent-creation engine, card:
    // create-a-valid-sil-wired-openclaw-agent-profile) and the local expert
    // lifecycle sil_profile_list / sil_profile_get / sil_profile_remove (card:
    // list-view-and-remove-local-expert-agents) join the set.
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    expect([...api._tools.keys()].sort()).toEqual([
      "sil_product_get",
      "sil_profile_get",
      "sil_profile_list",
      "sil_profile_materialize",
      "sil_profile_remove",
      "sil_register",
      "sil_search",
      "sil_whoami",
    ]);
  });

  it("completes synchronously without throwing", () => {
    const api = createMockPluginApi();
    // A throw here means register() is not safe to call at load — the
    // host rejects the plugin. Assert it returns cleanly.
    expect(() => capturedRegisterFn!(api)).not.toThrow();
  });

  it("logs `sil_plugin_loaded` EXACTLY ONCE", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    const loadedCalls = vi
      .mocked(api.logger.info)
      .mock.calls.filter(([marker]) => marker === "sil_plugin_loaded");
    expect(loadedCalls).toHaveLength(1);
  });

  it("includes observability fields on the load marker", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    expect(api.logger.info).toHaveBeenCalledWith(
      "sil_plugin_loaded",
      expect.objectContaining({
        api_url: expect.any(String),
        api_url_source: expect.any(String),
      }),
    );
  });
});

describe("plugin entry — opens no long-lived resource (install-hang guard)", () => {
  // Architect Risk #2 / klodi smoke-plugin-load.sh:261 — a timer or
  // socket armed in register() holds the install subprocess's event
  // loop open and blocks `&& exec openclaw gateway`. The skeleton has
  // no transport, but a careless dev could add a keep-alive. These
  // spies catch it at the unit tier, cheaply.
  let timeoutSpy: ReturnType<typeof vi.spyOn>;
  let intervalSpy: ReturnType<typeof vi.spyOn>;
  let immediateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    intervalSpy = vi.spyOn(globalThis, "setInterval");
    // setImmediate is Node-global; guard in case the env lacks it.
    immediateSpy = vi.spyOn(
      globalThis as unknown as { setImmediate: (...a: unknown[]) => unknown },
      "setImmediate",
    );
  });

  afterEach(() => {
    timeoutSpy.mockRestore();
    intervalSpy.mockRestore();
    immediateSpy.mockRestore();
  });

  it("arms no timer (setTimeout/setInterval/setImmediate) during register()", () => {
    const api = createMockPluginApi();
    capturedRegisterFn!(api);
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(immediateSpy).not.toHaveBeenCalled();
  });

  it("opens no network socket — global fetch is never called during register()", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("register() must not open a socket"));
    try {
      const api = createMockPluginApi();
      capturedRegisterFn!(api);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("plugin entry — pluginConfig override precedence", () => {
  it("applies a non-empty `sil_web_url` override from pluginConfig", () => {
    const api = createMockPluginApi({
      pluginConfig: { sil_web_url: "https://api.staging.example.com" },
    });
    capturedRegisterFn!(api);
    expect(getWebUrl()).toBe("https://api.staging.example.com");
    expect(getWebUrlSource()).toBe("config");
  });

  it("ignores an empty-string override (falls back to env/default)", () => {
    const api = createMockPluginApi({ pluginConfig: { sil_web_url: "" } });
    capturedRegisterFn!(api);
    expect(getWebUrl()).not.toBe("");
    expect(getWebUrlSource()).not.toBe("config");
  });

  it("ignores `sil_web_url` sitting on api.config (only pluginConfig is plugin-scoped)", () => {
    // The #1 config footgun: reading the FULL OpenClawConfig tree
    // (api.config) instead of the plugin-scoped api.pluginConfig.
    const api = createMockPluginApi({
      config: { sil_web_url: "https://wrong-source.example.com" },
      pluginConfig: {},
    });
    capturedRegisterFn!(api);
    expect(getWebUrl()).not.toBe("https://wrong-source.example.com");
  });
});

describe("applyPluginConfigOverrides — unit precedence", () => {
  beforeEach(() => {
    setWebUrl("");
    delete process.env["SIL_WEB_URL"];
  });

  it("is a no-op for undefined pluginConfig", () => {
    applyPluginConfigOverrides(undefined);
    expect(getWebUrlSource()).toBe("default");
  });

  it("applies a non-empty string override", () => {
    applyPluginConfigOverrides({ sil_web_url: "https://x.example.com" });
    expect(getWebUrl()).toBe("https://x.example.com");
    expect(getWebUrlSource()).toBe("config");
  });

  it("ignores a non-string override (defensive runtime narrowing)", () => {
    // The pluginConfig ultimately comes off a JSON file on disk that
    // could be hand-edited between schema validation and load — a
    // number where a string is expected must not poison the value.
    applyPluginConfigOverrides({
      sil_web_url: 123 as unknown as string,
    });
    expect(getWebUrlSource()).toBe("default");
  });

  it("falls back to the SIL_WEB_URL env var when no override is set", () => {
    process.env["SIL_WEB_URL"] = "https://env.example.com";
    expect(getWebUrl()).toBe("https://env.example.com");
    expect(getWebUrlSource()).toBe("env");
  });

  it("override beats env (config source wins over env)", () => {
    process.env["SIL_WEB_URL"] = "https://env.example.com";
    applyPluginConfigOverrides({ sil_web_url: "https://override.example.com" });
    expect(getWebUrl()).toBe("https://override.example.com");
    expect(getWebUrlSource()).toBe("config");
  });
});

describe("jsonResult — tool-result shape", () => {
  it("wraps data in a single text content block with pretty JSON", () => {
    const data = { id: "abc", n: 1500, active: true };
    const result = jsonResult(data);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(result.content[0]!.text).toBe(JSON.stringify(data, null, 2));
    expect(result.isError).toBeUndefined();
  });

  it("handles arrays, null, and primitives", () => {
    expect(jsonResult([1, 2, 3]).content[0]!.text).toBe(
      JSON.stringify([1, 2, 3], null, 2),
    );
    expect(jsonResult(null).content[0]!.text).toBe("null");
    expect(jsonResult("hello").content[0]!.text).toBe('"hello"');
    expect(jsonResult(42).content[0]!.text).toBe("42");
  });
});
