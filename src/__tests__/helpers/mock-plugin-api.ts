/**
 * Mock PluginAPI factory for testing tool registration and the plugin
 * entry contract. Captures registered tools into a Map for assertion.
 *
 * Lifted from the reference adapter
 * `klodi-plugin/adapters/openclaw/src/__tests__/helpers/mock-plugin-api.ts`,
 * trimmed to what the sil skeleton's tests touch: tool registration,
 * gateway-method registration, the logger spies (so we can assert the
 * `sil_plugin_loaded` marker), and the `config` / `pluginConfig`
 * surfaces (so config-override tests can drive the two distinct sources
 * OpenClaw injects).
 *
 * Production OpenClaw injects `config` as the FULL OpenClawConfig tree
 * (plain object — top-level keys like `agents`, `plugins`, etc.) and
 * `pluginConfig` as the plugin-scoped block validated against
 * `openclaw.plugin.json#configSchema`. Neither has a `.get()` method —
 * code that reaches for `api.config.get(...)` is reading the wrong
 * surface, and this double mirrors that plain-object shape so such a
 * mistake fails loudly here.
 *
 * The `service`/`runtime` surfaces from the reference are intentionally
 * dropped: the skeleton registers no long-lived service and the
 * "register opens nothing" criterion is asserted by spying on timers,
 * not by a runtime double.
 */

import { vi } from "vitest";
import type { PluginAPI, ToolDefinition } from "openclaw/plugin-sdk";

/**
 * The gateway-method surface, mirrored from the host EXACTLY as the plugin
 * consumes it. Declared locally rather than imported from
 * `src/types/openclaw.d.ts` on purpose: this double must be usable BEFORE the
 * production declaration lands (it is what turns the register-path mirrors green
 * when `register()` starts calling `registerGatewayMethod`), so it cannot depend
 * on it.
 *
 * Source-verified against the host clone at `vendor/openclaw`:
 *   - `PluginAPI.registerGatewayMethod(method, handler, opts?: {scope?: OperatorScope})`
 *     — `src/plugins/plugin-api.types.ts:217`
 *   - `RespondFn = (ok, payload?, error?, meta?) => void`
 *     — `src/gateway/server-methods/shared-types.ts:86`
 *   - `OperatorScope` is a CLOSED set — `src/gateway/operator-scopes.ts:4`. Typed
 *     closed here too, so a typo'd scope is a compile error, not a silent
 *     runtime-only mismatch against a host that would reject it.
 *
 * The handler options carry `req` / `client` / `isWebchatConnect` / `context` in
 * the host; only `params` + `respond` are modelled, matching the minimal-subset
 * discipline `src/types/openclaw.d.ts` states — the plugin deliberately does not
 * read the transport surfaces (the host owns transport authz; the plugin owns
 * principal binding). A double that handed them over would let a handler quietly
 * grow a dependency the production type forbids.
 */
export type MockOperatorScope =
  | "operator.admin"
  | "operator.read"
  | "operator.write"
  | "operator.approvals"
  | "operator.pairing"
  | "operator.talk.secrets";

export type MockRespondFn = (
  ok: boolean,
  payload?: unknown,
  error?: { code?: string; message?: string },
  meta?: Record<string, unknown>,
) => void;

export type MockGatewayRequestHandler = (opts: {
  params: Record<string, unknown>;
  respond: MockRespondFn;
}) => Promise<void> | void;

/** One `registerGatewayMethod` registration, exactly as the plugin passed it —
 * handler AND options. The options are recorded because the declared `scope` IS
 * the plugin's whole authorization contribution at the transport layer (the host
 * enforces it before the handler runs), so a test must be able to read it back
 * without invoking anything. */
export interface RegisteredGatewayMethod {
  handler: MockGatewayRequestHandler;
  opts?: { scope?: MockOperatorScope };
}

export interface MockPluginAPI extends PluginAPI {
  _tools: Map<string, ToolDefinition>;
  _gatewayMethods: Map<string, RegisteredGatewayMethod>;
}

export interface CreateMockPluginApiOptions {
  pluginConfig?: Record<string, unknown>;
  config?: Record<string, unknown>;
  /**
   * The host runtime facade. Only `version` is consumed today (the RUNNING
   * OpenClaw's own version — `readHostVersion`'s single source). Probed against
   * a live `alpine/openclaw:2026.6.9`: the host passes this straight through at
   * `api-builder:122`, and it is the ONLY source for the host version —
   * `config.gateway` does not exist, and `config.meta.lastTouchedVersion` is the
   * version that last WROTE the config file, not the one now running.
   *
   * OMITTED BY DEFAULT, on purpose: a host that supplies no runtime version must
   * degrade to an INCONCLUSIVE compat check (no finding), never a fabricated
   * verdict — and one real load path (`registrationMode: "cli-metadata"`) passes
   * `runtime: {}`, so absent is a state production genuinely reaches.
   */
  runtime?: Record<string, unknown>;
}

export function createMockPluginApi(
  options: CreateMockPluginApiOptions = {},
): MockPluginAPI {
  const tools = new Map<string, ToolDefinition>();
  const gatewayMethods = new Map<string, RegisteredGatewayMethod>();

  return {
    _tools: tools,
    _gatewayMethods: gatewayMethods,

    registerTool(tool: ToolDefinition): void {
      tools.set(tool.name, tool);
    },

    registerGatewayMethod(
      method: string,
      handler: MockGatewayRequestHandler,
      opts?: { scope?: MockOperatorScope },
    ): void {
      gatewayMethods.set(method, { handler, ...(opts !== undefined ? { opts } : {}) });
    },

    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },

    config: options.config ?? {},
    pluginConfig: options.pluginConfig ?? {},
    // Absent unless a test asks for it — the double must not hand every caller a
    // host version production would not have.
    ...(options.runtime !== undefined ? { runtime: options.runtime } : {}),
  } as unknown as MockPluginAPI;
}

/** Retrieve a registered tool by name. Throws (listing what IS
 * registered) if not found — a missing tool name should produce a
 * legible failure, not an undefined-deref three lines later. */
export function getTool(api: MockPluginAPI, name: string): ToolDefinition {
  const tool = api._tools.get(name);
  if (!tool) {
    const registered = [...api._tools.keys()].join(", ") || "(none)";
    throw new Error(
      `Tool "${name}" not registered. Registered tools: ${registered}`,
    );
  }
  return tool;
}

/** The set of tool names registered against the mock api. The drift
 * guard set-compares this against `openclaw.plugin.json#contracts.tools`. */
export function registeredToolNames(api: MockPluginAPI): Set<string> {
  return new Set(api._tools.keys());
}

/** Retrieve a registered gateway method by name. Mirrors {@link getTool}: throws
 * (listing what IS registered) rather than handing back an undefined a caller
 * then derefs three lines later. A gateway method is NOT manifest-declarable —
 * registration IS the declaration — so this accessor is the only place a test can
 * observe that the plugin declared one at all. */
export function getGatewayMethod(
  api: MockPluginAPI,
  name: string,
): RegisteredGatewayMethod {
  const method = api._gatewayMethods.get(name);
  if (!method) {
    const registered = [...api._gatewayMethods.keys()].join(", ") || "(none)";
    throw new Error(
      `Gateway method "${name}" not registered. Registered gateway methods: ${registered}`,
    );
  }
  return method;
}

/** The set of gateway-method names registered against the mock api. Exact-set
 * guards use this the way {@link registeredToolNames} guards the tool surface —
 * a gateway method has no manifest mirror to drift against, so this set IS the
 * only drift surface an undeclared second method would show up on. */
export function registeredGatewayMethodNames(api: MockPluginAPI): Set<string> {
  return new Set(api._gatewayMethods.keys());
}

/** One protocol response frame, exactly as `respond` emitted it. */
export interface GatewayResponseFrame {
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string };
  meta?: Record<string, unknown>;
}

/**
 * Invoke a registered gateway method and capture the response frames the client
 * would receive.
 *
 * The host's plugin adapter is modelled FAITHFULLY rather than approximated
 * (`adaptPluginGatewayMethodHandler`,
 * `vendor/openclaw/src/plugins/registry-registrars-network.ts:26-38`): a handler
 * that never calls `respond` but RETURNS a non-undefined value still emits
 * `respond(true, result)`. Modelling it matters in both directions — it stops a
 * returning handler from failing a test it would pass in production, and it keeps
 * the genuinely broken case (responds never, returns undefined) observable as
 * ZERO frames, which is a client left hanging forever. Assert the frame count,
 * never just the last frame.
 */
export async function callGatewayMethod(
  api: MockPluginAPI,
  name: string,
  params: Record<string, unknown>,
): Promise<GatewayResponseFrame[]> {
  const { handler } = getGatewayMethod(api, name);
  const frames: GatewayResponseFrame[] = [];
  const respond: MockRespondFn = (ok, payload, error, meta) => {
    frames.push({
      ok,
      ...(payload !== undefined ? { payload } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(meta !== undefined ? { meta } : {}),
    });
  };
  const result = (await handler({ params, respond })) as unknown;
  if (frames.length === 0 && result !== undefined) {
    respond(true, result);
  }
  return frames;
}
