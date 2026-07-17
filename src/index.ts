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
 * registering tools, ensuring the data dir, and logging. The reference
 * adapter (`klodi-plugin/adapters/openclaw`) carries a smoke gate
 * precisely because an eager connection opened in `register()` once held
 * the host's install subprocess event loop open and blocked gateway
 * startup. Keep it that way: all I/O lives inside a tool's `execute()` —
 * no timers, no sockets, no unawaited promises here. The one synchronous
 * `mkdirSync` (via `ensureDataDir()`) is exempt: it returns immediately
 * and holds no resource open.
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
import { ensureDataDir, getDataDir } from "./lib/credentials.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerDoctorTools } from "./tools/doctor.js";
import { registerIdentityTools } from "./tools/identity.js";
import { registerProfileTools } from "./tools/profile.js";

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

    // Guarantee the data home exists from the instant register() returns — not
    // lazily on first write — so tokens, config, and SDS profile artefacts have
    // one consistent home from load. One-shot synchronous mkdir (recursive,
    // 0700): it returns immediately and holds no resource open, so the
    // register()-stays-synchronous / opens-nothing invariant is preserved.
    //
    // Fail-closed: an uncreatable home (parent unwritable, path occupied by a
    // file → ENOTDIR, no space) is logged LOUDLY and DISTINCTLY (the path + OS
    // cause, no token/PII) then RETHROWN — the host rejects a plugin whose
    // register() throws, which is the correct outcome for an unusable data home.
    // A guaranteed home that silently isn't there is the exact failure this
    // guard exists to kill; we do NOT swallow it or fall back to another dir.
    let dataDir: string;
    try {
      dataDir = ensureDataDir();
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      api.logger.error("sil_plugin_data_dir_failed", {
        message:
          "sil could NOT create its data directory at registration, so tokens,"
          + " config, and profiles have no home. Fix the data directory (it must"
          + " be writable — check permissions / free space / that $SIL_DATA_DIR"
          + " is a directory), then reload the plugin.",
        data_dir: getDataDir(),
        cause,
      });
      throw err;
    }

    registerIdentityTools(api);
    registerCatalogTools(api);
    registerProfileTools(api);
    registerDoctorTools(api);

    api.logger.info("sil_plugin_loaded", {
      message: "sil plugin registered.",
      data_dir: dataDir,
      api_url: getWebUrl(),
      api_url_source: getWebUrlSource(),
      sil_api_url: getApiUrl(),
      sil_api_url_source: getApiUrlSource(),
    });
  },
});
