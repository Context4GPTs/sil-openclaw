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
  getWebPublicUrl,
  setWebPublicUrl,
  applyPluginConfigOverrides,
} from "../../lib/config.js";

let priorSilApiBase: string | undefined;
let priorSilApiUrl: string | undefined;
let priorSilWebPublicUrl: string | undefined;

beforeEach(() => {
  priorSilApiBase = process.env["SIL_API_URL"];
  priorSilApiUrl = process.env["SIL_WEB_URL"];
  priorSilWebPublicUrl = process.env["SIL_WEB_PUBLIC_URL"];
  // Start each test from the pristine default for ALL THREE resolvers.
  setApiUrl("");
  setWebUrl("");
  setWebPublicUrl("");
  delete process.env["SIL_API_URL"];
  delete process.env["SIL_WEB_URL"];
  delete process.env["SIL_WEB_PUBLIC_URL"];
});

afterEach(() => {
  setApiUrl("");
  setWebUrl("");
  setWebPublicUrl("");
  if (priorSilApiBase === undefined) delete process.env["SIL_API_URL"];
  else process.env["SIL_API_URL"] = priorSilApiBase;
  if (priorSilApiUrl === undefined) delete process.env["SIL_WEB_URL"];
  else process.env["SIL_WEB_URL"] = priorSilApiUrl;
  if (priorSilWebPublicUrl === undefined) delete process.env["SIL_WEB_PUBLIC_URL"];
  else process.env["SIL_WEB_PUBLIC_URL"] = priorSilWebPublicUrl;
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

// ---------------------------------------------------------------------------
// sil-web PUBLIC origin (the browser-facing auth_url origin for sil_register).
//
// A THIRD origin seam, distinct from getWebUrl()/getApiUrl(). Its defining
// trait is NOT a hardcoded default like the other two — it FALLS BACK TO
// getWebUrl(): a single-origin deployment sets nothing and the browser origin
// IS the internal origin. It diverges only when a split-network topology
// (local docker staging) sets sil_web_public_url / SIL_WEB_PUBLIC_URL.
//
// Contract this block pins for the implementation (src/lib/config.ts):
//   - getWebPublicUrl(): string   resolves sil_web_public_url → SIL_WEB_PUBLIC_URL
//                                  → getWebUrl()  (the FALLBACK, not a constant)
//   - setWebPublicUrl(url): void  test/override hook (empty string ⇒ unset)
//   - applyPluginConfigOverrides reads `sil_web_public_url` off SilPluginConfig
//     (string, non-empty) and feeds setWebPublicUrl, independently of the others.
// ---------------------------------------------------------------------------

describe("getWebPublicUrl — falls back to getWebUrl() (NOT a hardcoded default)", () => {
  it("with nothing set, equals getWebUrl()'s own default (the fallback)", () => {
    // No public override, no public env, no web override, no web env: the public
    // origin must be EXACTLY getWebUrl()'s resolved value, not a separate constant.
    expect(getWebPublicUrl()).toBe(getWebUrl());
  });

  it("tracks getWebUrl across getWebUrl's OWN env resolution (SIL_WEB_URL set, no public)", () => {
    // The fallback is live, not a snapshot: move getWebUrl via its env layer and
    // the public origin must follow it (since nothing public is set).
    process.env["SIL_WEB_URL"] = "https://internal.example.com";
    expect(new URL(getWebUrl()).origin).toBe("https://internal.example.com");
    expect(getWebPublicUrl()).toBe(getWebUrl());
    expect(new URL(getWebPublicUrl()).origin).toBe("https://internal.example.com");
  });

  it("tracks getWebUrl across getWebUrl's OWN config override (setWebUrl, no public)", () => {
    // Same fallback, driven by the config layer of getWebUrl this time.
    setWebUrl("https://web-config.example.com");
    expect(getWebPublicUrl()).toBe(getWebUrl());
    expect(new URL(getWebPublicUrl()).origin).toBe("https://web-config.example.com");
  });
});

describe("getWebPublicUrl — resolution order (config → env → getWebUrl fallback)", () => {
  it("uses the SIL_WEB_PUBLIC_URL env override when set, INDEPENDENTLY of getWebUrl", () => {
    // Public env set + a DIFFERENT web origin: the public resolver returns its
    // own env value and does NOT inherit the web origin (the whole point of the
    // split — browser origin ≠ internal origin).
    process.env["SIL_WEB_URL"] = "https://internal.example.com";
    process.env["SIL_WEB_PUBLIC_URL"] = "https://public.example.com";
    expect(new URL(getWebPublicUrl()).origin).toBe("https://public.example.com");
    // And it is genuinely independent: getWebUrl stays on its own value.
    expect(new URL(getWebUrl()).origin).toBe("https://internal.example.com");
    expect(getWebPublicUrl()).not.toBe(getWebUrl());
  });

  it("a setWebPublicUrl override beats the env (config wins)", () => {
    process.env["SIL_WEB_PUBLIC_URL"] = "https://env-public.example.com";
    setWebPublicUrl("https://config-public.example.com");
    expect(new URL(getWebPublicUrl()).origin).toBe("https://config-public.example.com");
  });

  it("applyPluginConfigOverrides({ sil_web_public_url }) beats the env (config > env)", () => {
    // Mirror the web/api precedence tests: the pluginConfig override route wins
    // over the env var, exactly as it does for sil_web_url / sil_api_url.
    process.env["SIL_WEB_PUBLIC_URL"] = "https://env-public.example.com";
    applyPluginConfigOverrides({
      sil_web_public_url: "https://config-public.example.com",
    });
    expect(new URL(getWebPublicUrl()).origin).toBe("https://config-public.example.com");
  });

  it("full precedence chain: config > env > getWebUrl fallback, peeled one layer at a time", () => {
    // Establish a getWebUrl baseline so the fallback is a recognizable value.
    setWebUrl("https://web-fallback.example.com");
    process.env["SIL_WEB_PUBLIC_URL"] = "https://env-public.example.com";
    setWebPublicUrl("https://config-public.example.com");

    // 1) config present → config wins.
    expect(new URL(getWebPublicUrl()).origin).toBe("https://config-public.example.com");
    // 2) peel config → env wins.
    setWebPublicUrl("");
    expect(new URL(getWebPublicUrl()).origin).toBe("https://env-public.example.com");
    // 3) peel env → getWebUrl fallback wins (NOT a hardcoded public default).
    delete process.env["SIL_WEB_PUBLIC_URL"];
    expect(getWebPublicUrl()).toBe(getWebUrl());
    expect(new URL(getWebPublicUrl()).origin).toBe("https://web-fallback.example.com");
  });
});

describe("getWebPublicUrl — empty-string tolerance (same invariant as the other keys)", () => {
  it("setWebPublicUrl('') unsets the config layer, falling through to env", () => {
    process.env["SIL_WEB_PUBLIC_URL"] = "https://env-public.example.com";
    setWebPublicUrl("https://config-public.example.com");
    setWebPublicUrl(""); // empty ⇒ unset the config layer
    expect(new URL(getWebPublicUrl()).origin).toBe("https://env-public.example.com");
  });

  it("applyPluginConfigOverrides({ sil_web_public_url: '' }) does NOT clobber a prior value", () => {
    // The empty-string-tolerant invariant the web/api keys have: an empty value
    // in pluginConfig leaves the prior source in place rather than blanking it.
    setWebPublicUrl("https://config-public.example.com");
    applyPluginConfigOverrides({ sil_web_public_url: "" });
    expect(new URL(getWebPublicUrl()).origin).toBe("https://config-public.example.com");
  });

  it("ignores a missing sil_web_public_url (leaves the prior source in place)", () => {
    process.env["SIL_WEB_PUBLIC_URL"] = "https://env-public.example.com";
    // sil_web_public_url absent from pluginConfig → env layer still wins; the
    // other keys in the same call do not perturb the public resolver.
    applyPluginConfigOverrides({ sil_web_url: "https://web.example.com" });
    expect(new URL(getWebPublicUrl()).origin).toBe("https://env-public.example.com");
  });
});

describe("getWebPublicUrl — independent of getApiUrl (three distinct seams)", () => {
  it("does not inherit, and is not inherited by, the sil-api override", () => {
    // The three seams are mutually independent: setting the api origin must not
    // move the public origin, and setting the public origin must not move api.
    setApiUrl("https://sil-api-only.example.com");
    setWebPublicUrl("https://public-only.example.com");
    expect(new URL(getApiUrl()).origin).toBe("https://sil-api-only.example.com");
    expect(new URL(getWebPublicUrl()).origin).toBe("https://public-only.example.com");
  });
});
