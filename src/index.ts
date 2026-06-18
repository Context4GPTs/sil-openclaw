/**
 * sil OpenClaw plugin — entry point.
 *
 * A UCP commerce plugin for sil. It registers its real tool groups —
 * identity (`sil_register`, `sil_whoami`) and catalog (`sil_search`,
 * `sil_product_get`) — so they load in an OpenClaw host. There is no
 * transport, no persistent service, and no background work at register
 * time — `register()` is strictly synchronous and opens nothing.
 *
 * `register()` MUST stay synchronous and side-effect-free beyond
 * registering tools and logging. The reference adapter
 * (`klodi-plugin/adapters/openclaw`) carries a smoke gate precisely
 * because an eager connection opened in `register()` once held the host's
 * install subprocess event loop open and blocked gateway startup. Keep it
 * that way: all I/O lives inside a tool's `execute()` — no timers, no
 * sockets, no unawaited promises here.
 *
 * To add a tool, see `src/tools/identity.ts` (the reference group — it
 * sets the `jsonResult` success shape and structured-error envelope every
 * real tool follows).
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import {
  applyPluginConfigOverrides,
  getWebUrl,
  getWebUrlSource,
  getApiUrl,
  getApiUrlSource,
  type SilPluginConfig,
} from "./lib/config.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerIdentityTools } from "./tools/identity.js";

export default definePluginEntry({
  id: "sil",
  name: "sil",
  description:
    "sil commerce plugin for OpenClaw — register on sil, read your identity,"
    + " and search and look up products in the sil catalog.",
  register(api) {
    applyPluginConfigOverrides(
      api.pluginConfig as SilPluginConfig | undefined,
    );

    registerIdentityTools(api);
    registerCatalogTools(api);

    api.logger.info("sil_plugin_loaded", {
      message: "sil plugin registered.",
      api_url: getWebUrl(),
      api_url_source: getWebUrlSource(),
      sil_api_url: getApiUrl(),
      sil_api_url_source: getApiUrlSource(),
    });
  },
});
