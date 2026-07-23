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
import type {
  GatewayRequestHandler,
  OperatorScope,
  PluginAPI,
  RespondFn,
  ToolDefinition,
} from "openclaw/plugin-sdk";

/** One `registerGatewayMethod` registration, exactly as the plugin passed it —
 * handler AND options. The options are recorded because the declared `scope` IS
 * the plugin's whole authorization contribution at the transport layer (the host
 * enforces it before the handler runs), so a test must be able to read it back
 * without invoking anything.
 *
 * The types are the PRODUCTION ones (`src/types/openclaw.d.ts`), not local
 * look-alikes: a double that re-declares the surface it doubles cannot fail to
 * compile when that surface drifts — and method-parameter bivariance means a
 * divergence in the closed `OperatorScope` union would pass `tsc` in silence. */
export interface RegisteredGatewayMethod {
  handler: GatewayRequestHandler;
  opts?: { scope?: OperatorScope };
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

    /**
     * Source-verified against the host clone at `vendor/openclaw`
     * (`src/plugins/registry-registrars-network.ts:38-63`,
     * `plugin-api.types.ts:217`): the key is the TRIMMED name, an empty name
     * registers nothing, and a collision is FIRST-WINS — the host keeps the
     * incumbent handler and drops the newcomer. Those three lines decide WHICH
     * handler answers, so every assertion reading `_gatewayMethods` depends on
     * them; a last-wins double would report a second registration as success.
     *
     * NOT modelled: on collision the host also pushes a load diagnostic. That is
     * host-owned operator surface, not a plugin contract, and this double has
     * nowhere faithful to put it.
     */
    registerGatewayMethod(
      method: string,
      handler: GatewayRequestHandler,
      opts?: { scope?: OperatorScope },
    ): void {
      const trimmed = method.trim();
      if (!trimmed || gatewayMethods.has(trimmed)) return;
      gatewayMethods.set(trimmed, { handler, ...(opts !== undefined ? { opts } : {}) });
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
  const respond: RespondFn = (ok, payload, error, meta) => {
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
