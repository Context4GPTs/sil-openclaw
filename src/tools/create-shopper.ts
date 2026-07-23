/**
 * `sil_create_shopper` — create the user's ONE sil-wired shopper, in-process.
 *
 * This replaces a shipped operator bin that drove the host `openclaw` CLI
 * through `execFileSync`. That exec was the whole of ClawHub's
 * `suspicious.dangerous_exec`, and no manifest declaration moves a
 * deterministic scanner — only removing the call site does. Every step it
 * shelled out for is a host call available in-process, so the ten-step
 * choreography collapses into two: the host bootstraps the workspace, and ONE
 * hash-checked `mutateConfigFile` transaction commits the config.
 *
 * ORDER IS THE SAFETY ARGUMENT. The config transaction is LAST and is the only
 * config write. Everything that can fail happens before it, so on every failure
 * path `openclaw.json` is never opened for writing and is byte-identical by
 * construction — there is no config half of teardown to get wrong. (It could
 * not be restored anyway: `mutateConfigFile` re-serialises the whole file, so a
 * write-then-undo is never byte-identical.)
 *
 * WHAT IT DELETES. Only what THIS RUN created — never "what did not pre-exist",
 * the proxy whose leak the old bin documented as a `KNOWN GAP`. A reused
 * workspace is snapshotted before the host touches it, so a failed create takes
 * back exactly the entries it added and leaves the user's own files alone.
 *
 * WHAT IT SAYS. Only what sil authored. Host error text is caught and dropped,
 * never interpolated: a host message may carry a token, an absolute path, or a
 * config fragment, and a denylist over someone else's format is a guess.
 * Diagnosability is preserved by naming a command the operator can re-run to
 * read the host's own message — never a sil bin, which is not on PATH on every
 * install channel.
 *
 * WHAT IT DOES NOT DO. It writes no admission key. `plugins.allow`,
 * `tools.alsoAllow` and `plugins.entries.sil` are untouched, because a tool of
 * the sil plugin cannot run unless sil is already admitted — the write the
 * scanner rated a privilege escalation was unreachable when it mattered and a
 * no-op when it did not. Admission stays an operator act, before creation.
 */

import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import type { OpenClawConfigDraft, PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import { resolveBindChannel } from "../lib/bind-channel.js";
import { deriveAgentId } from "../lib/derive-agent-id.js";
import {
  getShopperArtefactDir,
  materializeProfile,
  readShopperIdentity,
} from "../lib/profile-store.js";
import { jsonResult } from "../lib/tool-result.js";
import { confineWorkspace } from "../lib/workspace-confinement.js";
import { readSilWiringFacts } from "../lib/host-wiring.js";

/**
 * The sil creed appended to every shopper's SOUL.md after its persona — a soul,
 * not a rulebook. It carries the mantra (explore first), the loop in three
 * lines, and the one distinction that matters (the catalog is where you buy,
 * the web is where you learn), so the shopper's character carries the method.
 */
const SOUL_SIL_RULES =
  "\n## The sil way\n\n"
  + "You are a spec-driven shopper, and your mantra is **explore first**: before you buy"
  + " in a niche, you learn how it is really bought.\n\n"
  + "The loop, in three lines:\n"
  + "1. **Learn the domain** — the first time you shop a niche, explore it on the web,"
  + " research how it is bought, and remember what you find (`sil_learn`).\n"
  + "2. **Know the person** — reuse the sizes, tastes, and limits you already hold; ask"
  + " only what you genuinely cannot infer.\n"
  + "3. **Find the thing** — search the sil catalog, weigh what comes back against what"
  + " you learned, and say why your pick fits.\n\n"
  + "The **sil catalog is where you buy; the open web is where you learn.** Research a"
  + " niche freely and often, but the products you recommend always come from the"
  + " catalog. Keep what you learn so tomorrow's shop starts smarter than today's.\n";

const SOUL_FILE = "SOUL.md";
const USER_SPEC_FILE = "user_spec.md";

export type CreateShopperResult =
  | {
      status: "created";
      name: string;
      agentId: string;
      workspace: string;
      boundChannel: string | null;
      warnings: string[];
    }
  | { status: "invalid_request"; field: string; rule?: string; cause: string }
  | { status: "collision"; cause: string; recovery: string }
  | { status: "persistence_failed"; path: string | null; cause: string; recovery: string }
  | {
      status: "teardown_failed";
      path: string | null;
      cause: string;
      recovery: string;
      residue: Array<{ path: string; cause: string }>;
      note: string;
    };

/**
 * The command the operator can run to read the host's OWN message about a
 * failed step. This is what makes dropping host error text cost no
 * diagnosability — and it is deliberately an `openclaw` subcommand, never a sil
 * bin: `openclaw plugins install` links no bins, so a sil bin name is absent on
 * the very channel most likely to be broken.
 */
export function buildRecoveryHint(step: "config" | "workspace"): string {
  return step === "config"
    ? "Run `openclaw config validate` to see the host's own message about the"
      + " rejected change, fix what it names, then ask to create the shopper again."
    : "Run `openclaw doctor` to see the host's own message about that directory,"
      + " fix what it names, then ask to create the shopper again.";
}

/** Raised inside the config transaction so the host writes nothing. */
class AgentIdTakenError extends Error {}

/** What THIS RUN created, so teardown can take back exactly that. */
interface RunArtefacts {
  workspace: string;
  /** The workspace tree did not exist before this run — remove it whole. */
  workspaceCreated: boolean;
  /** Top-level entries present in a REUSED workspace before we touched it. */
  workspaceEntriesBefore: string[];
  soulWritten: boolean;
  userSpecWritten: boolean;
  /** `shopper/` did not exist before this run. */
  shopperDirCreated: boolean;
}

/** Atomic single-file write: tmp sibling → rename over target. A reader sees
 * the old file or the new one, never a half-written one. */
function atomicWrite(path: string, contents: string): void {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, contents, { mode: 0o600 });
  renameSync(tmp, path);
}

/** The errno code, never the OS message — enough to act on, nothing to leak. */
function errnoOf(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : "unknown error";
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * Remove exactly what this run created, and report what would not go.
 *
 * Best-effort per step, so one stubborn path never aborts the rest. A residue
 * entry is the honest outcome: it becomes `teardown_failed`, which is louder
 * than `persistence_failed` precisely because the machine was NOT returned to
 * its prior state.
 */
function teardown(made: RunArtefacts): Array<{ path: string; cause: string }> {
  const residue: Array<{ path: string; cause: string }> = [];
  const remove = (path: string, recursive: boolean): void => {
    try {
      rmSync(path, { recursive, force: true });
    } catch (err) {
      residue.push({ path, cause: `could not be removed (${errnoOf(err)})` });
    }
  };

  if (made.workspaceCreated) {
    remove(made.workspace, true);
  } else {
    // A reused workspace: take back the entries that appeared while we were
    // working — our SOUL.md and whatever the host bootstrapped — and nothing
    // the user already had. Pre-existing entries are never candidates.
    const before = new Set(made.workspaceEntriesBefore);
    for (const entry of listDir(made.workspace)) {
      if (!before.has(entry)) remove(join(made.workspace, entry), true);
    }
  }

  const shopperDir = getShopperArtefactDir();
  if (made.shopperDirCreated) {
    remove(shopperDir, true);
  } else if (made.userSpecWritten) {
    // THE KNOWN GAP, CLOSED. The old gate keyed on whole-dir pre-existence, so
    // a `shopper/` that already existed (empty, from an interrupted run) made
    // teardown skip the leaf it had just written. Key on the file we wrote.
    remove(join(shopperDir, USER_SPEC_FILE), false);
  }

  return residue;
}

export function registerCreateShopperTools(api: PluginAPI): void {
  api.registerTool({
    name: "sil_create_shopper",
    label: "Create the sil shopper",
    description:
      "Create the user's ONE sil shopper, after they have explicitly endorsed the"
      + " draft — never before. Writes exactly three things: the shopper's workspace"
      + " directory (bootstrapped by the host, with the endorsed persona as its"
      + " SOUL.md), the shared user_spec.md in sil's own data directory, and ONE new"
      + " entry in the host's agent list with the sil-shopping skill attached. It"
      + " changes no other host setting — in particular it never widens which plugins"
      + " or tools are allowed. A failure removes what this run created and reports"
      + " what it could not remove. `name`, `workspace`, `persona` and `userSpec` are"
      + " required and non-empty; `workspace` must be an absolute path under the"
      + " user's home. A second shopper is refused: there is exactly one.",
    parameters: Type.Object({
      name: Type.String({
        description:
          "The human-readable shopper name the user endorsed. The host agent id is"
          + " derived from it — the user never invents an id.",
      }),
      workspace: Type.String({
        description:
          "Absolute path to the shopper's own workspace directory, under the user's"
          + " home. Must not contain \"~\" (nothing expands it) and must not sit"
          + " inside sil's data directory.",
      }),
      persona: Type.String({
        description:
          "The endorsed persona — who the shopper is, its voice and standing rules."
          + " Written to the workspace SOUL.md.",
      }),
      userSpec: Type.String({
        description:
          "The shared cross-niche facts and hard constraints that hold in every"
          + " niche. Written to user_spec.md; reused by every later shop.",
      }),
      channel: Type.Optional(
        Type.String({
          description:
            "Optional: the channel this conversation is on, routed to the new shopper"
            + " so the user's next message reaches it. A convenience — if it cannot be"
            + " routed, creation still succeeds and says so.",
        }),
      ),
    }),
    async execute(_callId, params) {
      return jsonResult(await createShopper(api, params));
    },
  });
}

async function createShopper(
  api: PluginAPI,
  params: Record<string, unknown>,
): Promise<CreateShopperResult> {
  // --- 1. Validate first, in a deterministic field order. Nothing attempted. ---
  const name = params["name"];
  if (typeof name !== "string" || name.trim().length === 0) {
    return { status: "invalid_request", field: "name", cause: "name is required and must be non-empty." };
  }
  const confined = confineWorkspace(params["workspace"]);
  if (!confined.ok) {
    return {
      status: "invalid_request",
      field: confined.rejection.field,
      rule: confined.rejection.rule,
      cause: confined.rejection.cause,
    };
  }
  const workspace = confined.path;
  const persona = params["persona"];
  if (typeof persona !== "string" || persona.trim().length === 0) {
    return { status: "invalid_request", field: "persona", cause: "persona is required and must be non-empty." };
  }
  const userSpec = params["userSpec"];
  if (typeof userSpec !== "string" || userSpec.trim().length === 0) {
    return { status: "invalid_request", field: "userSpec", cause: "userSpec is required and must be non-empty." };
  }
  // The derivation's postcondition guarantees a conforming id (an empty or
  // `main` slug folds to `sil-shopper`), so the id is never a failure mode.
  const agentId = deriveAgentId(name);

  // --- 2. The host surfaces this tool needs. Absent ⇒ refuse loudly. ---
  const config = api.runtime?.config;
  const agent = api.runtime?.agent;
  if (config === undefined || agent === undefined) {
    return {
      status: "persistence_failed",
      path: null,
      cause:
        "this OpenClaw host does not expose the config and workspace APIs sil needs"
        + " to create a shopper, so nothing was attempted.",
      recovery:
        "Upgrade OpenClaw to 2026.7.1 or newer, then ask to create the shopper again.",
    };
  }

  // --- 3. Singleton + agent-id pre-flight. Nothing written yet. ---
  const identity = readShopperIdentity();
  if (identity.unreadable.length > 0) {
    // A degraded store is INCONCLUSIVE — never fabricate a "no shopper" verdict.
    return {
      status: "persistence_failed",
      path: getShopperArtefactDir(),
      cause:
        "sil cannot tell whether a shopper already exists, because what it has"
        + " stored could not be read. Nothing was attempted.",
      recovery:
        "Run `openclaw doctor` — sil_doctor lists each unreadable artefact so you"
        + " can repair it, then ask to create the shopper again.",
    };
  }
  if (typeof identity.name === "string" && identity.name.trim().length > 0) {
    return {
      status: "collision",
      cause:
        "a shopper already exists — a user has exactly ONE shopper, and it learns"
        + " every new niche on the spot.",
      recovery:
        "Shop a new niche with the existing shopper (it mints the domain itself),"
        + " or refine it. Never mint a second shopper.",
    };
  }
  if (existingAgentIds(config.current()).includes(agentId)) {
    return {
      status: "collision",
      cause: `the host already has an agent called "${agentId}", and sil will not overwrite it.`,
      recovery: "Choose a different shopper name, then ask to create it again.",
    };
  }

  const made: RunArtefacts = {
    workspace,
    workspaceCreated: !existsSync(workspace),
    workspaceEntriesBefore: listDir(workspace),
    soulWritten: false,
    userSpecWritten: false,
    shopperDirCreated: !existsSync(getShopperArtefactDir()),
  };

  /** Unwind, then report the honest outcome — the louder one when it could not. */
  const failAndTeardown = (
    path: string | null,
    cause: string,
    recovery: string,
  ): CreateShopperResult => {
    const residue = teardown(made);
    if (residue.length > 0) {
      return {
        status: "teardown_failed",
        path,
        cause,
        recovery,
        residue,
        note:
          "sil could NOT undo everything it had created, so the machine is not back"
          + " in the state it started in. Each path above is still there.",
      };
    }
    return { status: "persistence_failed", path, cause, recovery };
  };

  // --- 4. The workspace: the host owns its whole shape, so ask for one. ---
  try {
    await agent.ensureAgentWorkspace({ dir: workspace, ensureBootstrapFiles: true });
  } catch {
    // The host's message is dropped, never forwarded: it may carry a token, an
    // absolute path, or a config fragment. The recovery hint names the command
    // that shows it.
    return failAndTeardown(
      workspace,
      `sil could not create the shopper's workspace directory ${workspace}.`,
      buildRecoveryHint("workspace"),
    );
  }

  // --- 5. The persona, plus the standing creed. ---
  const soulPath = join(workspace, SOUL_FILE);
  try {
    atomicWrite(soulPath, (persona.endsWith("\n") ? persona : `${persona}\n`) + SOUL_SIL_RULES);
    made.soulWritten = true;
  } catch (err) {
    return failAndTeardown(
      soulPath,
      `sil could not write the shopper's persona to ${soulPath} (${errnoOf(err)}).`,
      buildRecoveryHint("workspace"),
    );
  }

  // --- 6. The shared user spec. Setup only — no domain is minted here. ---
  const materialized = materializeProfile({ name, userSpec });
  if (!materialized.ok) {
    return failAndTeardown(
      getShopperArtefactDir(),
      "sil could not write the shopper's shared user spec to its data directory.",
      buildRecoveryHint("workspace"),
    );
  }
  made.userSpecWritten = true;

  // --- 7. ONE config transaction — the last step, and the only config write. ---
  const channel = resolveBindChannel({
    specChannel: typeof params["channel"] === "string" ? params["channel"] : undefined,
    envChannel: process.env["OPENCLAW_MCP_MESSAGE_CHANNEL"],
  });
  const skill = readSilWiringFacts().skill;

  let boundChannel: string | null = null;
  try {
    const committed = await config.mutateConfigFile<string | null>({
      // The AUTHORED file, not the env-resolved runtime tree — writing the
      // resolved tree back would bake expanded env values into the user's file.
      base: "source",
      afterWrite: { mode: "auto" },
      mutate: (draft) => {
        // Re-checked HERE, not just in the pre-flight: this is the only read
        // the host serialises against its own write, and the host does NOT
        // reject a duplicate agent id for us (probed).
        if (existingAgentIds(draft).includes(agentId)) throw new AgentIdTakenError(agentId);

        const agents = (draft.agents ??= {});
        const list = (agents.list = Array.isArray(agents.list) ? agents.list : []);
        list.push({ id: agentId, name, workspace, skills: [skill] });

        if (channel === null) return null;
        const bindings = (draft.bindings = Array.isArray(draft.bindings) ? draft.bindings : []);
        // Never steal a route another agent already owns.
        if (bindings.some((b) => b?.match?.channel === channel)) return null;
        bindings.push({ type: "route", agentId, match: { channel } });
        return channel;
      },
    });
    boundChannel = committed.result ?? null;
  } catch (err) {
    if (err instanceof AgentIdTakenError) {
      // Lost the race between the pre-flight and the commit. The host wrote
      // nothing, so this is still a clean refusal — after teardown.
      const residue = teardown(made);
      return residue.length > 0
        ? {
            status: "teardown_failed",
            path: null,
            cause: `the host already has an agent called "${agentId}", and sil will not overwrite it.`,
            recovery: "Choose a different shopper name, then ask to create it again.",
            residue,
            note:
              "sil could NOT undo everything it had created, so the machine is not back"
              + " in the state it started in. Each path above is still there.",
          }
        : {
            status: "collision",
            cause: `the host already has an agent called "${agentId}", and sil will not overwrite it.`,
            recovery: "Choose a different shopper name, then ask to create it again.",
          };
    }
    return failAndTeardown(
      null,
      "sil could not write the shopper into the host configuration, so the host"
      + " rejected the change and nothing was saved to it.",
      buildRecoveryHint("config"),
    );
  }

  const warnings: string[] = [];
  if (boundChannel === null) {
    warnings.push(
      `The shopper "${agentId}" was created, but this conversation's channel was not`
      + ` routed to it. To route it, run: openclaw agents bind --agent ${agentId}`
      + " --bind <channel> (or switch in-chat with /agent " + agentId + ")."
      + " The shopper is fully created and ready either way.",
    );
  }
  return { status: "created", name, agentId, workspace, boundChannel, warnings };
}

/** The agent ids already registered in a config tree — the authoritative,
 * shim-independent clash source. */
function existingAgentIds(config: OpenClawConfigDraft | Record<string, unknown>): string[] {
  const agents = (config as OpenClawConfigDraft).agents;
  const list = Array.isArray(agents?.list) ? agents.list : [];
  return list.map((entry) => entry?.id).filter((id): id is string => typeof id === "string");
}
