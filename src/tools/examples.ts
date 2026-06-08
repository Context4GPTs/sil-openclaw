/**
 * Example stub tools: sil_ping, sil_echo.
 *
 * THIS FILE IS THE PATTERN A DEVELOPER COPIES TO ADD A REAL TOOL.
 *
 * Both tools are deliberately the *same shape* — a `Type.Object({...})`
 * parameter schema and an `execute` that returns `stubResult(name,
 * params)`. They differ only in name and parameter schema, never in
 * structure, so "the existing pattern" is demonstrably a pattern and not
 * a single example. To add a tool:
 *
 *   1. add an `api.registerTool({...})` call below (or in a new
 *      `registerXTools(api)` group),
 *   2. wire that group into `register()` in `src/index.ts`,
 *   3. add the tool's `name` to `openclaw.plugin.json#contracts.tools`.
 *
 * Step 3 is load-bearing: the manifest↔code drift-guard test fails if the
 * registered names and the manifest names disagree, which is what makes
 * the three-step pattern self-enforcing.
 *
 * Each `execute` does no I/O — no network, no timer, no filesystem. A
 * real tool swaps `stubResult(...)` for `jsonResult(<real payload>)`
 * once it has a backend to call.
 */

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import { stubResult } from "../lib/tool-result.js";

export function registerExampleTools(api: PluginAPI): void {
  registerPing(api);
  registerEcho(api);
}

function registerPing(api: PluginAPI): void {
  api.registerTool({
    name: "sil_ping",
    label: "Ping",
    description:
      "Liveness check. Takes no arguments and returns a stub payload"
      + " confirming the plugin's tools are registered and invocable.",
    parameters: Type.Object({}),
    async execute(_callId, params) {
      return stubResult("sil_ping", params);
    },
  });
}

function registerEcho(api: PluginAPI): void {
  api.registerTool({
    name: "sil_echo",
    label: "Echo",
    description:
      "Echo the supplied message back inside a stub payload. Demonstrates"
      + " that a typed parameter round-trips from request to response.",
    parameters: Type.Object({
      message: Type.String({
        description: "Text echoed back verbatim in the stub payload.",
      }),
    }),
    async execute(_callId, params) {
      return stubResult("sil_echo", params);
    },
  });
}
