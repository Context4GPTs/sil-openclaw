/**
 * Plugin-config resolution and overrides for the sil plugin.
 *
 * The plugin talks to TWO distinct sil services, each with its OWN origin
 * resolved at call time from three sources, in order:
 *
 *   sil-WEB (auth authority — claim + token refresh):
 *     1. `api.pluginConfig.sil_web_url`  2. `SIL_WEB_URL`  3. `DEFAULT_WEB_URL`
 *   sil-API (commerce/identity reads — `sil_whoami`):
 *     1. `api.pluginConfig.sil_api_url`  2. `SIL_API_URL`  3. `DEFAULT_API_URL`
 *
 * The two-origin reality is load-bearing (see the sil-whoami card): refresh
 * is on sil-web (the only holder of the Auth0 client secret), the identity
 * read is on sil-api (the Fastify domain service). They are different
 * services and likely different origins, so they get DISTINCT keys — never
 * overload `sil_web_url` for the sil-api read. Every future plugin tool that
 * calls a sil-api domain (fulfillment/payments/loyalty) shares `sil_api_url`.
 *
 * This mirrors the reference adapter's `lib/paths.ts` override pattern
 * (`klodi-plugin/adapters/openclaw`): the override and env routes coexist so
 * tests can drive isolation via env (the cheapest knob) while deployments
 * configure via OpenClaw's pluginConfig surface (the discoverable knob). No
 * on-disk state, no filesystem paths.
 */

// sil-web origin (auth authority). Used by refreshStoredTokens / claim.
const DEFAULT_WEB_URL = "https://sil.4gpts.com";

// sil-api origin (domain reads). Pinned to the deployed sil-api Railway service
// at `sil-api.4gpts.com`. Deployments may still override via `sil_api_url` /
// `SIL_API_URL` (or point at the same origin if a single gateway fronts both
// services); tests + staging set it explicitly through the override chain.
const DEFAULT_API_URL = "https://sil-api.4gpts.com";

let _webUrl: string | null = null;
let _apiUrl: string | null = null;

export type ConfigSource = "config" | "env" | "default";

/**
 * Plugin-scoped config schema. Mirrors `openclaw.plugin.json#configSchema`
 * 1:1. OpenClaw validates the user's `plugins.sil.config.*` block against
 * that schema before delivering it as `api.pluginConfig`, so the field
 * types are guaranteed by the time we receive this object — but the file
 * lives on disk and could be edited between validation and load, so the
 * read site (`applyPluginConfigOverrides`) still narrows defensively.
 *
 * If you add a key here, add it to `openclaw.plugin.json` too — the
 * schema file is authoritative for the user-facing surface.
 */
export interface SilPluginConfig {
  sil_web_url?: string;
  sil_api_url?: string;
}

export function setWebUrl(url: string): void {
  _webUrl = url === "" ? null : url;
}

export function getWebUrl(): string {
  return _webUrl ?? process.env["SIL_WEB_URL"] ?? DEFAULT_WEB_URL;
}

export function getWebUrlSource(): ConfigSource {
  if (_webUrl !== null) return "config";
  if (process.env["SIL_WEB_URL"]) return "env";
  return "default";
}

export function setApiUrl(url: string): void {
  _apiUrl = url === "" ? null : url;
}

/**
 * Resolve the sil-API origin (the identity/commerce read service), distinct
 * from `getWebUrl()` (sil-web). `sil_whoami` posts its identity read here.
 */
export function getApiUrl(): string {
  return _apiUrl ?? process.env["SIL_API_URL"] ?? DEFAULT_API_URL;
}

export function getApiUrlSource(): ConfigSource {
  if (_apiUrl !== null) return "config";
  if (process.env["SIL_API_URL"]) return "env";
  return "default";
}

/**
 * Apply plugin-scoped config overrides from `api.pluginConfig`. OpenClaw
 * populates this object from `plugins.sil.config.*` after validation
 * against `openclaw.plugin.json#configSchema`. Reading from `api.config`
 * instead would silently ignore the user's overrides — that tree is the
 * FULL OpenClawConfig, not the plugin's scoped block.
 *
 * Idempotent and empty-string-tolerant: an empty or missing value leaves
 * the prior source in place rather than clobbering it to a blank.
 */
export function applyPluginConfigOverrides(
  pluginConfig: SilPluginConfig | undefined,
): void {
  if (!pluginConfig) return;

  // Defensive runtime narrowing despite the typed parameter: the SDK's
  // PluginAPI.pluginConfig is `Record<string, unknown>` because the SDK
  // cannot know each plugin's schema, so callers cast to SilPluginConfig
  // at the boundary. The cast trusts a JSON file on disk — keep the guard.
  const { sil_web_url, sil_api_url } = pluginConfig;
  if (typeof sil_web_url === "string" && sil_web_url.length > 0) {
    setWebUrl(sil_web_url);
  }
  if (typeof sil_api_url === "string" && sil_api_url.length > 0) {
    setApiUrl(sil_api_url);
  }
}
