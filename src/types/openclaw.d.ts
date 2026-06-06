/**
 * OpenClaw Plugin SDK type declarations.
 *
 * These types are provided by the OpenClaw runtime at load time — they
 * are NOT an npm dependency, so this ambient declaration is the only
 * place the plugin's TypeScript sees the SDK surface.
 * See: https://docs.openclaw.ai/plugins/sdk-overview
 *
 * This is the *minimal* subset the skeleton's stub tools touch, lifted
 * from the reference adapter (`klodi-plugin/adapters/openclaw/src/types/
 * openclaw.d.ts`). The SDK surface the skeleton does not use —
 * `registerService` / `ServiceDefinition`, `registerHttpRoute` /
 * `HttpRouteDescriptor`, `runtime` / `RuntimeAPI` / `SystemAPI`, and the
 * wake-event plumbing — is intentionally dropped: a skeleton declares no
 * service, owns no HTTP route, and pushes no system events. Add back the
 * exact member a tool needs the moment a tool needs it, so the type
 * surface always tracks what the code actually consumes.
 */

declare module "openclaw/plugin-sdk" {
  import type { TObject } from "@sinclair/typebox";

  export interface PluginAPI {
    registerTool(tool: ToolDefinition): void;
    logger: PluginLogger;
    /**
     * The full OpenClawConfig tree (plain object). Top-level keys like
     * `agents`, `plugins`, etc. are walked by dot-path. NOT plugin-scoped
     * — do not read plugin-specific settings from here; use
     * `pluginConfig` instead.
     *
     * `unknown` is deliberate: the SDK does not model every key, so
     * callers must narrow via `typeof` checks at the read site.
     */
    config: Record<string, unknown>;
    /**
     * Plugin-scoped config populated from the user's
     * `plugins.<id>.config.*` block, validated at load time against this
     * plugin's `configSchema` in `openclaw.plugin.json`. Absent when the
     * user never wrote a scoped block. Always the correct source for
     * plugin-specific overrides.
     */
    pluginConfig?: Record<string, unknown>;
  }

  export interface ToolDefinition {
    name: string;
    label: string;
    description: string;
    parameters: TObject;
    execute(
      callId: string,
      params: Record<string, unknown>,
    ): Promise<ToolResult>;
  }

  export interface ToolResult {
    content: ToolContent[];
    isError?: boolean;
  }

  export interface ToolContent {
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }

  export interface PluginLogger {
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
    debug(message: string, data?: Record<string, unknown>): void;
  }

  export type PluginRegisterFn = (api: PluginAPI) => void | Promise<void>;
}

declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { PluginRegisterFn } from "openclaw/plugin-sdk";

  export interface PluginEntry {
    id: string;
    name: string;
    description: string;
    register: PluginRegisterFn;
  }

  export function definePluginEntry(entry: PluginEntry): PluginEntry;
}
