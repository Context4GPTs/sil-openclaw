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
  import type { TObject, TSchema } from "typebox";

  export interface PluginAPI {
    registerTool(tool: ToolDefinition): void;
    /**
     * Register a plugin-owned gateway RPC method, dispatched to paired
     * clients over the already-authenticated `deviceToken` WS. `scope` is
     * the plugin's WHOLE authorization contribution at the transport
     * layer: the host authorizes it BEFORE the handler runs, so the
     * handler implements no scope logic and has no bypass.
     *
     * Declared from `vendor/openclaw` @ 2026.7.2
     * (`src/plugins/plugin-api.types.ts:217`), live-proven on
     * `openclaw/openclaw:2026.7.1` — which is why the manifest floor is
     * `>=2026.7.1`. A host below it is refused by the host's own
     * `checkMinHostVersion`; there is deliberately no
     * `typeof api.registerGatewayMethod === "function"` soft-guard, which
     * would ship a silently search-broken plugin instead of a loud refusal.
     */
    registerGatewayMethod(
      method: string,
      handler: GatewayRequestHandler,
      opts?: { scope?: OperatorScope },
    ): void;
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
    /**
     * The host runtime facade. Only `version` is declared — the running
     * OpenClaw's own version (e.g. `"2026.6.9"`), which is the ONLY
     * source for it: `config.gateway` does not exist, and
     * `config.meta.lastTouchedVersion` is the version that last WROTE the
     * config file, not the one now running. Probed empirically against
     * `alpine/openclaw:2026.6.9` — the host builds this member at
     * `api-builder:122`.
     *
     * Optional because a host that does not supply it must degrade to an
     * INCONCLUSIVE compat check (no finding), never a fabricated verdict.
     *
     * The rest of the facade (`llm`, `system`, `state`, `subagent`, …) is
     * deliberately NOT declared. Add back the exact member a tool needs
     * when it needs it — and only after a probe proves the running host
     * hands it over.
     *
     * `config` and `agent` are declared because `sil_create_shopper`
     * consumes them, and both were live-probed on
     * `openclaw/openclaw:2026.7.1` from a plugin loaded the way we ship
     * (`origin: "config"`, NOT bundled, NOT `trustedOfficialInstall`).
     * They are OPTIONAL because one real load path
     * (`registrationMode: "cli-metadata"`) passes `runtime: {}` — a tool
     * that finds them missing must refuse LOUDLY, never degrade.
     *
     * NOTE: `api.version` (not declared) is the PLUGIN's own version, not
     * the host's — an easy and silent mis-read.
     */
    runtime?: {
      version?: string;
      config?: RuntimeConfigAPI;
      agent?: RuntimeAgentAPI;
    };
  }

  /**
   * The subset of the host config tree sil writes. Everything else stays
   * `unknown` behind the index signature: the draft handed to `mutate` is
   * the user's WHOLE config, and a plugin that models keys it does not own
   * invites itself to rewrite them.
   */
  export interface OpenClawConfigDraft {
    agents?: {
      list?: Array<{
        id?: string;
        name?: string;
        workspace?: string;
        skills?: string[];
      }>;
      [key: string]: unknown;
    };
    bindings?: Array<{
      type?: string;
      agentId?: string;
      match?: { channel?: string };
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }

  /**
   * How the gateway reacts to the write. The caller MUST choose — the host
   * deliberately has no default, so restart behaviour stays explicit.
   * `{ mode: "auto" }` let the host decide, and it reported
   * `requiresRestart: false` for an `agents.list` + `bindings` write.
   */
  export type ConfigWriteAfterWrite =
    | { mode: "auto" }
    | { mode: "restart"; reason: string }
    | { mode: "none"; reason: string };

  export interface RuntimeConfigAPI {
    /** The running config snapshot, defaulted. */
    current(): Record<string, unknown>;
    /**
     * A hash-checked, single-transaction config write. `mutate` receives a
     * draft; whatever it returns comes back as `result`. Probed behaviour
     * that this plugin depends on: the host VALIDATES the mutated config
     * inside the transaction and refuses the whole write on a schema
     * violation, and a `mutate` that THROWS writes nothing at all — which
     * is what lets creation treat this as its single atomic commit.
     */
    mutateConfigFile<T>(params: {
      base?: "runtime" | "source";
      baseHash?: string;
      afterWrite: ConfigWriteAfterWrite;
      mutate: (draft: OpenClawConfigDraft) => T | Promise<T>;
    }): Promise<{ result: T | undefined }>;
  }

  export interface RuntimeAgentAPI {
    /**
     * Create an agent's workspace and (optionally) its bootstrap files.
     * The host owns the whole shape of a workspace, so sil asks for one
     * rather than laying out the host's files itself.
     */
    ensureAgentWorkspace(params?: {
      dir?: string;
      ensureBootstrapFiles?: boolean;
    }): Promise<{ dir: string }>;
  }

  export interface ToolDefinition {
    name: string;
    label: string;
    description: string;
    /**
     * The tool's input JSON-Schema. Registration sites build this with
     * `Type.Object({...})` (a `TObject`, which is the expected runtime shape —
     * `{ type: "object", properties, required }`). The static type is the broader
     * `TObject | TSchema` so callers can still pass a `Type.Object(...)` while
     * tests may introspect the schema's `properties`/`items`/`required` JSON-Schema
     * fields via a cast — TypeBox's `TObject.properties` is `Record<string,
     * TSchema>` (TSchema = `{}`), which a single-step `as` to a `Record<string,
     * Record<string, unknown>>` cannot reach, so the field is typed `TSchema` (the
     * base TypeBox schema) to keep that introspection cast legal without a
     * double-`as`. The host validates real inputs against this schema at call time.
     */
    parameters: TObject | TSchema;
    execute(
      callId: string,
      params: Record<string, unknown>,
    ): Promise<ToolResult>;
  }

  /** The host's closed operator-privilege set
   * (`src/gateway/operator-scopes.ts:4`). `operator.read` is also satisfied by
   * `operator.write` / `operator.admin`. */
  export type OperatorScope =
    | "operator.admin"
    | "operator.read"
    | "operator.write"
    | "operator.approvals"
    | "operator.pairing"
    | "operator.talk.secrets";

  /** Emits ONE protocol response frame. `error`/`meta` are declared but unused
   * here: every sil outcome rides `respond(true, <structured body>)`, because a
   * client reads a method-level error as a TRANSPORT fault worth retrying, and an
   * unknown/expired/foreign reference is not retryable. */
  export type RespondFn = (
    ok: boolean,
    payload?: unknown,
    error?: { code?: string; message?: string },
    meta?: Record<string, unknown>,
  ) => void;

  /** The host hands the handler `{req, params, client, isWebchatConnect, respond,
   * context}`; only the two members sil consumes are declared, per this file's
   * minimal-subset discipline. `client` / `context` / `req` are deliberately
   * absent — transport authz is the host's (it runs the scope check before us)
   * and principal binding is ours (the sil account that stored the page), so
   * reading the socket would be a third, wrong, source of truth. */
  export type GatewayRequestHandler = (opts: {
    params: Record<string, unknown>;
    respond: RespondFn;
  }) => Promise<void> | void;

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
