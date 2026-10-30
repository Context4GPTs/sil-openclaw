/**
 * What the plugin answers a paired screen (contract §4): `sil.answer` reads back an answer
 * the agent got; `sil.call` runs a read or a forget as the signed-in buyer. Not tools: they
 * never reach the model. The host checks `operator.read` before either handler runs; the
 * plugin checks the one thing it cannot — that the sil account signed in owns the answer.
 */

import { randomUUID } from "node:crypto";

import type { PluginAPI, RespondFn } from "openclaw/plugin-sdk/plugin-entry";

import { latestSession, readAnswer, signedInPrincipal } from "../lib/answers.js";
import { readHostVersion } from "../lib/host-wiring.js";
import { logScreen } from "../lib/screen-log.js";
import { callRoute, type CallResult, type RefusalBody } from "../lib/shopping-call.js";
import type { Caller } from "../lib/sil-client.js";
import { readInstalledVersion } from "../lib/version-advisory.js";
import { SHOPPING_TOOLS, type ShoppingToolName } from "../tools/catalog.js";

export const ANSWER_METHOD = "sil.answer";
export const CALL_METHOD = "sil.call";

/** Unknown ≡ expired ≡ another account's ≡ signed out: one body, and never a method error,
 * which a screen reads as a transport fault and retries forever. */
const NOT_FOUND = {
  status: "not_found",
  message: "Nothing to show for this: ask the agent again.",
} as const;

const SCREEN_TOOLS: ReadonlySet<ShoppingToolName> = new Set([
  "shopping_product_get",
  "shopping_offers",
  "shopping_seller_get",
  "shopping_domain_get",
  "shopping_content",
  "shopping_user_read",
  "shopping_user_forget",
]);

/** sil reads three products an answer; a screen's Compare asks for up to ten. */
const PRODUCT_IDS_MAX = 10;
const PRODUCT_IDS_PER_READ = 3;

/** sil's record tells the buyer's taps from the agent's calls by this model. */
const SCREEN_MODEL = "studio/buyer";

/** sil-api's rules for `sil-tool-call-id` and `sil-session-id`. */
const REQUEST_ID = /^[\x21-\x7E]{1,256}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refusals whose recovery is signing in again: on a screen that is signed out. */
const SIGNED_OUT: ReadonlySet<RefusalBody["status"]> = new Set([
  "not_registered",
  "must_reregister",
  "forbidden",
]);

type Run = Omit<Caller, "toolCallId" | "model" | "sessionId">;

export function registerScreenMethods(api: PluginAPI): void {
  const openclawVersion = readHostVersion(api);
  const run: Run = {
    pluginVersion: readInstalledVersion(),
    ...(openclawVersion !== null ? { openclawVersion } : {}),
  };
  api.registerGatewayMethod(
    ANSWER_METHOD,
    ({ params, respond }) => guarded(api, respond, () => answer(api, params, respond)),
    { scope: "operator.read" },
  );
  api.registerGatewayMethod(
    CALL_METHOD,
    ({ params, respond }) => guarded(api, respond, () => call(api, run, params, respond)),
    { scope: "operator.read" },
  );
}

async function guarded(
  api: PluginAPI,
  respond: RespondFn,
  handle: () => Promise<void> | void,
): Promise<void> {
  try {
    await handle();
  } catch (err) {
    logScreen(api, "error", "failed", {
      error_type: err instanceof Error ? err.name : typeof err,
      cause: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? "") : "",
    });
    respond(true, NOT_FOUND);
  }
}

function answer(api: PluginAPI, params: Record<string, unknown>, respond: RespondFn): void {
  const callId = params["callId"];
  if (typeof callId !== "string" || callId.length === 0) {
    invalid(api, respond, "sil.answer takes a non-empty string `callId`.");
    return;
  }
  const principal = signedInPrincipal();
  const read = principal === undefined ? { miss: "no_principal" } : readAnswer(callId, principal);
  if ("miss" in read) {
    logScreen(api, "info", "answer_miss", { callId, reason: read.miss });
    respond(true, NOT_FOUND);
    return;
  }
  logScreen(api, "info", "answer_hit", { callId });
  respond(true, read.body);
}

async function call(
  api: PluginAPI,
  run: Run,
  params: Record<string, unknown>,
  respond: RespondFn,
): Promise<void> {
  const parsed = parseCall(params);
  if ("invalid" in parsed) {
    invalid(api, respond, parsed.invalid);
    return;
  }
  const { tool, reads, requestId } = parsed;
  const principal = signedInPrincipal();
  if (principal === undefined) {
    logScreen(api, "info", "call_refused", { requestId, tool: tool.name, reason: "no_principal" });
    respond(true, NOT_FOUND);
    return;
  }
  // sil-api requires a conversation UUID: the one the screen shows, else the one the agent
  // last answered in, else the screen's own.
  const caller: Caller = {
    ...run,
    toolCallId: requestId,
    model: SCREEN_MODEL,
    sessionId: parsed.sessionId ?? latestSession(principal) ?? randomUUID(),
  };
  const answered = await readAll(api, tool, reads, caller);
  if (answered.kind === "refused") {
    const { status } = answered.body;
    logScreen(api, "info", "call_refused", { requestId, tool: tool.name, reason: status });
    respond(true, SIGNED_OUT.has(status) ? NOT_FOUND : answered.body);
    return;
  }
  logScreen(api, "info", "call_answered", { requestId, tool: tool.name, reads: reads.length });
  respond(true, answered.body);
}

type ScreenTool = (typeof SHOPPING_TOOLS)[number];

interface ParsedCall {
  tool: ScreenTool;
  reads: Record<string, unknown>[];
  requestId: string;
  sessionId: string | undefined;
}

function parseCall(params: Record<string, unknown>): ParsedCall | { invalid: string } {
  const { tool: name, args, requestId, sessionId } = params;
  const tool = SHOPPING_TOOLS.find((t) => t.name === name && SCREEN_TOOLS.has(t.name));
  if (tool === undefined) return { invalid: `sil.call runs only ${[...SCREEN_TOOLS].join(", ")}.` };
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { invalid: "sil.call takes `args`, the tool's arguments as an object." };
  }
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
    return { invalid: "sil.call takes `requestId`, 1–256 printable characters, no spaces." };
  }
  if (sessionId !== undefined && (typeof sessionId !== "string" || !SESSION_ID.test(sessionId))) {
    return { invalid: "sil.call takes `sessionId`, when sent, as a UUID." };
  }
  const body = args as Record<string, unknown>;
  // A tap erases the rows it names; everything goes only on the buyer's word to the agent.
  if (tool.name === "shopping_user_forget" && !namesRowsOnly(body)) {
    return { invalid: "shopping_user_forget from a screen takes `ids` only." };
  }
  const reads = tool.name === "shopping_product_get" ? productReads(body) : [body];
  if (reads === null) {
    return { invalid: `shopping_product_get takes \`ids\`, 1–${PRODUCT_IDS_MAX} strings.` };
  }
  return { tool, reads, requestId, sessionId };
}

function namesRowsOnly(args: Record<string, unknown>): boolean {
  const ids = args["ids"];
  return Object.keys(args).length === 1 && Array.isArray(ids) && ids.length > 0;
}

/** The reads at once — the refresh they may share is single-flight — the product reads'
 * `products` joined in order, and the first refusal answering for all. */
async function readAll(
  api: PluginAPI,
  tool: ScreenTool,
  reads: Record<string, unknown>[],
  caller: Caller,
): Promise<CallResult> {
  if (reads.length === 1) return callRoute(api, tool, reads[0] ?? {}, caller);
  const called = await Promise.all(reads.map((read) => callRoute(api, tool, read, caller)));
  const refused = called.find((c) => c.kind === "refused");
  if (refused !== undefined) return refused;
  const products = called.flatMap((c) => {
    const page = c.body["products"];
    return Array.isArray(page) ? page : [];
  });
  return { kind: "ok", body: { status: "ok", products } };
}

/** The ids cut into the threes sil reads, or null when they are not 1–10 strings. */
function productReads(args: Record<string, unknown>): Record<string, unknown>[] | null {
  const ids = args["ids"];
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > PRODUCT_IDS_MAX) return null;
  if (!ids.every((id) => typeof id === "string" && id.length > 0)) return null;
  const reads: Record<string, unknown>[] = [];
  for (let at = 0; at < ids.length; at += PRODUCT_IDS_PER_READ) {
    reads.push({ ...args, ids: ids.slice(at, at + PRODUCT_IDS_PER_READ) });
  }
  return reads;
}

function invalid(api: PluginAPI, respond: RespondFn, message: string): void {
  logScreen(api, "info", "invalid", { message });
  respond(true, { status: "invalid_request", message });
}
