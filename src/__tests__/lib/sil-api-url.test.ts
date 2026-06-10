/**
 * UNIT — sil-api origin resolution (tier: unit, no network).
 *
 * `sil_whoami` calls TWO distinct services on TWO distinct origins
 * (architect "two-origin reality"): identity-read on **sil-api**, token
 * refresh on **sil-web**. The plugin's existing `getWebUrl()` resolves the
 * sil-web origin (used by `refreshStoredTokens`); this card adds a SECOND,
 * INDEPENDENT resolver `getApiUrl()` for the sil-api origin.
 *
 * The keys must not be conflated: `getApiUrl()` resolves the NEW
 * `sil_api_url` pluginConfig key / `SIL_API_URL` env / a sil-api default,
 * NEVER overloading `sil_web_url` (which is semantically sil-web's). A
 * silent overload would point the identity read at sil-web (404/wrong host).
 *
 * Resolution order mirrors `getWebUrl` exactly: pluginConfig override → env
 * var → default.
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/config.ts`:
 *   - getApiUrl(): string                  resolves sil_api_url → SIL_API_URL → default
 *   - setApiUrl(url: string): void         test/override hook (empty string ⇒ unset)
 *   - applyPluginConfigOverrides reads `sil_api_url` off SilPluginConfig
 *     (string, non-empty) and feeds setApiUrl, independently of sil_web_url.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  getApiUrl,
  setApiUrl,
  getWebUrl,
  setWebUrl,
  applyPluginConfigOverrides,
} from "../../lib/config.js";

let priorSilApiBase: string | undefined;
let priorSilApiUrl: string | undefined;

beforeEach(() => {
  priorSilApiBase = process.env["SIL_API_URL"];
  priorSilApiUrl = process.env["SIL_WEB_URL"];
  // Start each test from the pristine default for BOTH resolvers.
  setApiUrl("");
  setWebUrl("");
  delete process.env["SIL_API_URL"];
  delete process.env["SIL_WEB_URL"];
});

afterEach(() => {
  setApiUrl("");
  setWebUrl("");
  if (priorSilApiBase === undefined) delete process.env["SIL_API_URL"];
  else process.env["SIL_API_URL"] = priorSilApiBase;
  if (priorSilApiUrl === undefined) delete process.env["SIL_WEB_URL"];
  else process.env["SIL_WEB_URL"] = priorSilApiUrl;
});

describe("getApiUrl — resolution order (pluginConfig → env → default)", () => {
  it("uses the SIL_API_URL env override when set", () => {
    process.env["SIL_API_URL"] = "https://api.staging.example.com";
    expect(new URL(getApiUrl()).origin).toBe("https://api.staging.example.com");
  });

  it("a pluginConfig override (setApiUrl) beats the env (config wins)", () => {
    process.env["SIL_API_URL"] = "https://env.example.com";
    setApiUrl("https://config.example.com");
    expect(new URL(getApiUrl()).origin).toBe("https://config.example.com");
  });

  it("falls back to a documented sil-api default when nothing is overridden", () => {
    const origin = new URL(getApiUrl()).origin;
    // Not the staging/config hosts — a real https default origin.
    expect(origin).not.toBe("https://config.example.com");
    expect(origin).not.toBe("https://env.example.com");
    expect(origin.startsWith("https://")).toBe(true);
  });

  it("an empty-string override does NOT clobber to blank (empty ⇒ unset)", () => {
    process.env["SIL_API_URL"] = "https://env.example.com";
    setApiUrl("https://config.example.com");
    setApiUrl(""); // empty means "unset the config layer", fall back to env
    expect(new URL(getApiUrl()).origin).toBe("https://env.example.com");
  });
});

describe("getApiUrl — distinct from getWebUrl (sil-api ≠ sil-web origin)", () => {
  it("resolves the sil-api origin INDEPENDENTLY of the sil-web sil_web_url key", () => {
    // The two-origin invariant: setting the sil-web origin must NOT move the
    // sil-api origin, and vice-versa. Overloading one key for both is the
    // silent-wrong-host bug this resolver exists to prevent.
    process.env["SIL_WEB_URL"] = "https://sil-web.example.com";
    process.env["SIL_API_URL"] = "https://sil-api.example.com";
    expect(new URL(getWebUrl()).origin).toBe("https://sil-web.example.com");
    expect(new URL(getApiUrl()).origin).toBe("https://sil-api.example.com");
  });

  it("setting only the sil-web origin leaves getApiUrl on its own default", () => {
    setWebUrl("https://sil-web-only.example.com");
    expect(new URL(getWebUrl()).origin).toBe("https://sil-web-only.example.com");
    // sil-api resolver untouched — must not inherit sil-web's override.
    expect(new URL(getApiUrl()).origin).not.toBe("https://sil-web-only.example.com");
  });
});

describe("applyPluginConfigOverrides — wires sil_api_url independently", () => {
  it("applies sil_api_url from pluginConfig to getApiUrl", () => {
    applyPluginConfigOverrides({ sil_api_url: "https://api.fromconfig.example.com" });
    expect(new URL(getApiUrl()).origin).toBe("https://api.fromconfig.example.com");
  });

  it("applies sil_web_url and sil_api_url to their OWN resolvers (no crosstalk)", () => {
    applyPluginConfigOverrides({
      sil_web_url: "https://web.fromconfig.example.com",
      sil_api_url: "https://api.fromconfig.example.com",
    });
    expect(new URL(getWebUrl()).origin).toBe("https://web.fromconfig.example.com");
    expect(new URL(getApiUrl()).origin).toBe("https://api.fromconfig.example.com");
  });

  it("ignores a missing/empty sil_api_url (leaves the prior source in place)", () => {
    process.env["SIL_API_URL"] = "https://env.example.com";
    applyPluginConfigOverrides({ sil_web_url: "https://web.example.com" });
    // sil_api_url absent from pluginConfig → env layer still wins.
    expect(new URL(getApiUrl()).origin).toBe("https://env.example.com");
  });
});
