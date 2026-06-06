/**
 * Plugin-config resolution and overrides for the sil plugin.
 *
 * The skeleton resolves a single setting — the backend API URL — at call
 * time from three sources, in order:
 *
 *   1. plugin-config override (`api.pluginConfig.sil_api_url`)
 *   2. `SIL_API_URL` env var
 *   3. `DEFAULT_API_URL`
 *
 * This mirrors the reference adapter's `lib/paths.ts` override pattern
 * (`klodi-plugin/adapters/openclaw`), trimmed to one key: the override
 * and env routes coexist so tests can drive isolation via env (the
 * cheapest knob) while deployments configure via OpenClaw's pluginConfig
 * surface (the discoverable knob). No on-disk state, no filesystem
 * paths — a stub plugin reads no real config, this only demonstrates the
 * resolution shape a real tool would build on.
 */

// Notional default for the skeleton — the stub tools never call it.
// A real tool would point this at the product backend, or source it from
// a shared catalog the way the reference adapter does.
const DEFAULT_API_URL = "https://sil.4gpts.com";

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
  sil_api_url?: string;
}

export function setApiUrl(url: string): void {
  _apiUrl = url === "" ? null : url;
}

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
  const { sil_api_url } = pluginConfig;
  if (typeof sil_api_url === "string" && sil_api_url.length > 0) {
    setApiUrl(sil_api_url);
  }
}
