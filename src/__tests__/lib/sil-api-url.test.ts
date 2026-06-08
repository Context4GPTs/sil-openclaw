/**
 * UNIT — sil-api origin resolution (tier: unit, no network).
 *
 * `sil_whoami` calls TWO distinct services on TWO distinct origins
 * (architect "two-origin reality"): identity-read on **sil-api**, token
 * refresh on **sil-web**. The plugin's existing `getApiUrl()` resolves the
 * sil-web origin (used by `refreshStoredTokens`); this card adds a SECOND,
 * INDEPENDENT resolver `getSilApiUrl()` for the sil-api origin.
 *
 * The keys must not be conflated: `getSilApiUrl()` resolves the NEW
 * `sil_api_base` pluginConfig key / `SIL_API_BASE` env / a sil-api default,
 * NEVER overloading `sil_api_url` (which is semantically sil-web's). A
 * silent overload would point the identity read at sil-web (404/wrong host).
 *
 * Resolution order mirrors `getApiUrl` exactly: pluginConfig override → env
 * var → default.
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/config.ts`:
 *   - getSilApiUrl(): string                  resolves sil_api_base → SIL_API_BASE → default
 *   - setSilApiUrl(url: string): void         test/override hook (empty string ⇒ unset)
 *   - applyPluginConfigOverrides reads `sil_api_base` off SilPluginConfig
 *     (string, non-empty) and feeds setSilApiUrl, independently of sil_api_url.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  getSilApiUrl,
  setSilApiUrl,
  getApiUrl,
  setApiUrl,
  applyPluginConfigOverrides,
} from "../../lib/config.js";

let priorSilApiBase: string | undefined;
let priorSilApiUrl: string | undefined;

beforeEach(() => {
  priorSilApiBase = process.env["SIL_API_BASE"];
  priorSilApiUrl = process.env["SIL_API_URL"];
  // Start each test from the pristine default for BOTH resolvers.
  setSilApiUrl("");
  setApiUrl("");
  delete process.env["SIL_API_BASE"];
  delete process.env["SIL_API_URL"];
});

afterEach(() => {
  setSilApiUrl("");
  setApiUrl("");
  if (priorSilApiBase === undefined) delete process.env["SIL_API_BASE"];
  else process.env["SIL_API_BASE"] = priorSilApiBase;
  if (priorSilApiUrl === undefined) delete process.env["SIL_API_URL"];
  else process.env["SIL_API_URL"] = priorSilApiUrl;
});

describe("getSilApiUrl — resolution order (pluginConfig → env → default)", () => {
  it("uses the SIL_API_BASE env override when set", () => {
    process.env["SIL_API_BASE"] = "https://api.staging.example.com";
    expect(new URL(getSilApiUrl()).origin).toBe("https://api.staging.example.com");
  });

  it("a pluginConfig override (setSilApiUrl) beats the env (config wins)", () => {
    process.env["SIL_API_BASE"] = "https://env.example.com";
    setSilApiUrl("https://config.example.com");
    expect(new URL(getSilApiUrl()).origin).toBe("https://config.example.com");
  });

  it("falls back to a documented sil-api default when nothing is overridden", () => {
    const origin = new URL(getSilApiUrl()).origin;
    // Not the staging/config hosts — a real https default origin.
    expect(origin).not.toBe("https://config.example.com");
    expect(origin).not.toBe("https://env.example.com");
    expect(origin.startsWith("https://")).toBe(true);
  });

  it("an empty-string override does NOT clobber to blank (empty ⇒ unset)", () => {
    process.env["SIL_API_BASE"] = "https://env.example.com";
    setSilApiUrl("https://config.example.com");
    setSilApiUrl(""); // empty means "unset the config layer", fall back to env
    expect(new URL(getSilApiUrl()).origin).toBe("https://env.example.com");
  });
});

describe("getSilApiUrl — distinct from getApiUrl (sil-api ≠ sil-web origin)", () => {
  it("resolves the sil-api origin INDEPENDENTLY of the sil-web sil_api_url key", () => {
    // The two-origin invariant: setting the sil-web origin must NOT move the
    // sil-api origin, and vice-versa. Overloading one key for both is the
    // silent-wrong-host bug this resolver exists to prevent.
    process.env["SIL_API_URL"] = "https://sil-web.example.com";
    process.env["SIL_API_BASE"] = "https://sil-api.example.com";
    expect(new URL(getApiUrl()).origin).toBe("https://sil-web.example.com");
    expect(new URL(getSilApiUrl()).origin).toBe("https://sil-api.example.com");
  });

  it("setting only the sil-web origin leaves getSilApiUrl on its own default", () => {
    setApiUrl("https://sil-web-only.example.com");
    expect(new URL(getApiUrl()).origin).toBe("https://sil-web-only.example.com");
    // sil-api resolver untouched — must not inherit sil-web's override.
    expect(new URL(getSilApiUrl()).origin).not.toBe("https://sil-web-only.example.com");
  });
});

describe("applyPluginConfigOverrides — wires sil_api_base independently", () => {
  it("applies sil_api_base from pluginConfig to getSilApiUrl", () => {
    applyPluginConfigOverrides({ sil_api_base: "https://api.fromconfig.example.com" });
    expect(new URL(getSilApiUrl()).origin).toBe("https://api.fromconfig.example.com");
  });

  it("applies sil_api_url and sil_api_base to their OWN resolvers (no crosstalk)", () => {
    applyPluginConfigOverrides({
      sil_api_url: "https://web.fromconfig.example.com",
      sil_api_base: "https://api.fromconfig.example.com",
    });
    expect(new URL(getApiUrl()).origin).toBe("https://web.fromconfig.example.com");
    expect(new URL(getSilApiUrl()).origin).toBe("https://api.fromconfig.example.com");
  });

  it("ignores a missing/empty sil_api_base (leaves the prior source in place)", () => {
    process.env["SIL_API_BASE"] = "https://env.example.com";
    applyPluginConfigOverrides({ sil_api_url: "https://web.example.com" });
    // sil_api_base absent from pluginConfig → env layer still wins.
    expect(new URL(getSilApiUrl()).origin).toBe("https://env.example.com");
  });
});
