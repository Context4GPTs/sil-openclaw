/**
 * sil OpenClaw plugin — entry point.
 *
 * A skeleton that registers stub tools so the package loads in an
 * OpenClaw host and demonstrates the "add a tool by copying the existing
 * one" affordance. There is no transport, no persistent service, and no
 * background work — `register()` is strictly synchronous and opens
 * nothing.
 *
 * `register()` MUST stay synchronous and side-effect-free beyond
 * registering tools and logging. The reference adapter
 * (`klodi-plugin/adapters/openclaw`) carries a smoke gate precisely
 * because an eager connection opened in `register()` once held the host's
 * install subprocess event loop open and blocked gateway startup. A
 * skeleton has no transport to open — keep it that way: no timers, no
 * sockets, no unawaited promises here.
 *
 * To add a tool, see `src/tools/examples.ts` (the canonical pattern).
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import {
  applyPluginConfigOverrides,
  getApiUrl,
  getApiUrlSource,
  getSilApiUrl,
  getSilApiUrlSource,
  type SilPluginConfig,
} from "./lib/config.js";
import { registerExampleTools } from "./tools/examples.js";
import { registerIdentityTools } from "./tools/identity.js";

export default definePluginEntry({
  id: "sil",
  name: "sil",
  description:
    "Skeleton OpenClaw plugin — registers stub tools a developer copies"
    + " to add real ones.",
  register(api) {
    applyPluginConfigOverrides(
      api.pluginConfig as SilPluginConfig | undefined,
    );

    registerExampleTools(api);
    registerIdentityTools(api);

    api.logger.info("sil_plugin_loaded", {
      message: "sil plugin registered.",
      api_url: getApiUrl(),
      api_url_source: getApiUrlSource(),
      sil_api_base: getSilApiUrl(),
      sil_api_base_source: getSilApiUrlSource(),
    });
  },
});
