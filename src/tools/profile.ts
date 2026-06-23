/**
 * sil shopping-expert profile tools.
 *
 * `sil_profile_materialize` is the plugin's half of the agent-creation engine:
 * it writes the created expert's *SDS behaviour* artefacts (the required domain
 * spec + intent-spec dimension schema, the lazy user spec + playbook taste, and
 * a typed manifest) into the plugin's own data directory (`$SIL_DATA_DIR`, the
 * disclosed `filesystemScope`). The persona is NOT written here — the agent's
 * identity/voice is the host workspace `SOUL.md`, written directly via the host
 * CLI. The *wiring* half — the host `agents.list[]` entry, the enabled `sil`
 * plugin, the attached `sil` skill, the `SOUL.md` — is the host agent driving
 * its own `openclaw …` CLI under the bundled `skill/SKILL.md` procedure; the
 * plugin never writes `~/.openclaw` (`security.noChildProcess: true`, host
 * config is outside `filesystemScope`).
 *
 * Why a tool (not skill-driven `write`-tool prose): the host agent's only way
 * to invoke plugin code is a registered tool, and a plugin write buys
 * host-validated typed inputs, the structured-error envelope, and ATOMIC
 * all-or-nothing writes — all of which serve the goal's primary correctness
 * bar (a created expert that actually shops). The artefact write lives here;
 * the host-config write stays host-CLI.
 *
 * This follows `identity.ts` (the reference group): a `registerXTools(api)`
 * function, a `Type.Object` schema the host validates inputs against, the
 * `jsonResult` success/structured-error envelope, and ALL I/O inside
 * `execute()` (register() opens nothing).
 */

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import {
  listAgentProfiles,
  materializeProfile,
  readAgentProfile,
  removeAgentArtefacts,
  type ProfileSpec,
} from "../lib/profile-store.js";
import { jsonResult } from "../lib/tool-result.js";

export function registerProfileTools(api: PluginAPI): void {
  registerMaterialize(api);
  registerList(api);
  registerGet(api);
  registerRemove(api);
}

function registerMaterialize(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_materialize",
    label: "Materialize a sil shopping-expert's SDS behaviour artefacts",
    description:
      "Write a created sil shopping expert's SDS behaviour artefacts into the sil"
      + " data directory: the REQUIRED domain spec (deep researched niche"
      + " expertise — how to buy well, the full mechanics), the REQUIRED intent"
      + " spec (the agent-specific decomposition dimensions a query must resolve,"
      + " derived from the domain spec), the LAZY user spec (the user's"
      + " domain-relevant facts + hard constraints) and LAZY playbook (the user's"
      + " buying taste), and a typed manifest the sil skill reads at runtime to"
      + " load them. The persona is NOT written here — it is the host workspace"
      + " SOUL.md, written via the host CLI. Re-run it over the SAME agentId to"
      + " refine an expert in place or lazily capture user spec / taste (it"
      + " overwrites the bodies atomically). Call this AFTER the host agent has"
      + " been created (openclaw agents add) and BEFORE openclaw config validate."
      + " It does NOT touch the host OpenClaw config — the plugin enable + skill"
      + " attach are driven by the host CLI, not this tool. Writes are atomic: an"
      + " invalid spec writes nothing, and a write failure leaves nothing partial.",
    parameters: Type.Object({
      agentId: Type.String({
        description:
          "The host agent id the expert was created under (agents.list[].id),"
          + " lower-kebab; not \"main\" (host-reserved). Keys the artefact dir.",
      }),
      name: Type.String({
        description: "The human-readable expert name (recorded in the manifest).",
      }),
      domainSpec: Type.String({
        description:
          "The SDS domain spec — deep researched niche expertise: how to buy well"
          + " in the niche and its full mechanics (for cycling: gearing theory,"
          + " frame geometry, the complete bike-fit process). Researched by the"
          + " agent itself (web + knowledge), not interrogated from the user."
          + " REQUIRED, non-empty. Materialized as domain_spec.md; web-refreshed"
          + " every query.",
      }),
      intentSpec: Type.String({
        description:
          "The SDS intent spec — the agent-specific decomposition DIMENSIONS (a"
          + " PRD-style template) a shopping query must resolve, derived from the"
          + " domain spec (for cycling: use-case, terrain, budget, timeline,"
          + " compatibility, performance priorities, aesthetics). REQUIRED,"
          + " non-empty. This is the dimension SCHEMA only — the per-query intent"
          + " (dimensions filled in) is ephemeral and is never stored. Materialized"
          + " as intent_spec.md.",
      }),
      userSpec: Type.Optional(
        Type.String({
          description:
            "The SDS user spec — the user's domain-relevant facts + hard"
            + " constraints (body measurements, climate, the rules they never"
            + " break). LAZY: starts absent and is captured incrementally"
            + " per-query on demand. Materialized as user_spec.md (per-user,"
            + " per-expert, local). Omit at creation and when re-materializing"
            + " without changing it.",
        }),
      ),
      playbook: Type.Optional(
        Type.String({
          description:
            "The SDS playbook — the user's buying TASTE (price sensitivity, brand"
            + " preferences, general taste). LAZY: starts absent and is captured"
            + " incrementally per-query on demand. Materialized as playbook.md."
            + " Omit at creation and when re-materializing without changing it.",
        }),
      ),
    }),
    async execute(_callId, params) {
      // The host validates `params` against the schema above before we run, but
      // narrow at the read site (the SDK types params as Record<string,unknown>)
      // and let the store do the real, structured-error validation.
      const spec: ProfileSpec = {
        agentId: typeof params["agentId"] === "string" ? params["agentId"] : "",
        name: typeof params["name"] === "string" ? params["name"] : "",
        domainSpec: typeof params["domainSpec"] === "string" ? params["domainSpec"] : "",
        intentSpec: typeof params["intentSpec"] === "string" ? params["intentSpec"] : "",
        ...(typeof params["userSpec"] === "string"
          ? { userSpec: params["userSpec"] }
          : {}),
        ...(typeof params["playbook"] === "string"
          ? { playbook: params["playbook"] }
          : {}),
      };

      const result = materializeProfile(spec);

      if (result.ok) {
        api.logger.info("sil_profile_materialized", {
          agent_id: result.agentId,
          has_user_spec: result.userSpecPath !== undefined,
          has_playbook: result.playbookPath !== undefined,
        });
        return jsonResult({
          status: "ok",
          agentId: result.agentId,
          dir: result.dir,
          domainSpecPath: result.domainSpecPath,
          intentSpecPath: result.intentSpecPath,
          ...(result.userSpecPath ? { userSpecPath: result.userSpecPath } : {}),
          ...(result.playbookPath ? { playbookPath: result.playbookPath } : {}),
          profilePath: result.profilePath,
        });
      }

      if (result.kind === "invalid_request") {
        api.logger.warn("sil_profile_invalid_request", { field: result.field });
        return jsonResult({
          status: "invalid_request",
          field: result.field,
          message: result.message,
        });
      }

      // persistence_failed — the path + cause are in `error` (never a token/PII).
      api.logger.error("sil_profile_persistence_failed", { error: result.error });
      return jsonResult({
        status: "persistence_failed",
        error: result.error,
        message: result.message,
        recovery: "fix_data_dir",
      });
    },
  });
}

/**
 * `sil_profile_list` — enumerate the user's sil shopping experts (read-only).
 *
 * The artefact store is the source of truth for "what is a sil expert" (a
 * readable `agents/<id>/profile.json`), not the host agent list. Returns each
 * expert summarized from its manifest, most-recently-created first, plus an
 * `unreadable[]` bucket so one corrupt manifest never blinds the user to the
 * rest. An empty store is a normal `ok` outcome (like an empty `sil_search`).
 */
function registerList(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_list",
    label: "List the user's sil shopping experts",
    description:
      "List the sil shopping experts the user has created — read-only, no"
      + " arguments. Sourced from the sil data directory's artefact store (each"
      + " agents/<id>/profile.json is the authoritative \"is a sil expert\""
      + " signal — a bare host agent without one is not listed). Returns the"
      + " experts most-recently-created first, each with its agentId, name,"
      + " whether the user has yet captured a SDS user spec (facts) or a playbook"
      + " (buying taste) for it, and createdAt. Every expert carries the required"
      + " domain spec + intent spec, so those are not flagged. An empty store is"
      + " a normal, successful empty listing — not an error. One unreadable or"
      + " corrupt manifest is reported inline in `unreadable` and never aborts"
      + " the listing. Reads no token and writes nothing.",
    parameters: Type.Object({}),
    async execute(_callId, _params) {
      const { experts, unreadable } = listAgentProfiles();
      api.logger.info("sil_profile_listed", {
        expert_count: experts.length,
        unreadable_count: unreadable.length,
      });
      return jsonResult({
        status: "ok",
        experts,
        unreadable,
      });
    },
  });
}

/**
 * `sil_profile_get` — view one expert's full detail (read-only).
 *
 * Re-runs the writer's `agentId` gate before any read (a traversal-shaped id →
 * `invalid_request`). Returns the manifest plus the SDS artefact bodies so the
 * skill can render a complete view. An unknown or unloadable expert →
 * `not_found` (the skill lists the healthy experts) — never a stack trace or a
 * raw path. Reads no token and writes nothing.
 */
function registerGet(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_get",
    label: "View one sil shopping expert's detail",
    description:
      "Show one sil shopping expert's full detail — read-only. Pass its"
      + " `agentId`. Returns the expert's name, its SDS domain spec and intent"
      + " spec (always present), its user spec (facts) and playbook (buying taste)"
      + " when the user has captured them, the manifest path, and createdAt, read"
      + " from the artefact store so the agent can summarize the expert. The"
      + " persona is not here — it is the host workspace SOUL.md. An unknown"
      + " expert returns `not_found` (list the experts to see which exist) — never"
      + " a stack trace or a raw path. A malformed/traversal id returns"
      + " `invalid_request`. Reads no token and writes nothing.",
    parameters: Type.Object({
      agentId: Type.String({
        description:
          "The expert's host agent id (lower-kebab, e.g. \"gift-buyer\"; not"
          + " \"main\"). Keys the artefact directory the detail is read from.",
      }),
    }),
    async execute(_callId, params) {
      const agentId = typeof params["agentId"] === "string" ? params["agentId"] : "";
      const result = readAgentProfile(agentId);

      if (result.ok) {
        api.logger.info("sil_profile_viewed", {
          agent_id: result.agentId,
          has_user_spec: result.userSpec !== undefined,
          has_playbook: result.playbook !== undefined,
        });
        return jsonResult({
          status: "ok",
          agentId: result.agentId,
          name: result.name,
          domainSpec: result.domainSpec,
          intentSpec: result.intentSpec,
          ...(result.userSpec !== undefined ? { userSpec: result.userSpec } : {}),
          ...(result.playbook !== undefined ? { playbook: result.playbook } : {}),
          profilePath: result.profilePath,
          createdAt: result.createdAt,
        });
      }

      if (result.kind === "invalid_request") {
        api.logger.warn("sil_profile_get_invalid_request", { field: result.field });
        return jsonResult({
          status: "invalid_request",
          field: result.field,
          message: result.message,
        });
      }

      // not_found — a normal outcome; steer the agent to list-then-retry.
      api.logger.info("sil_profile_get_not_found", { agent_id: result.agentId });
      return jsonResult({
        status: "not_found",
        agentId: result.agentId,
        message: result.message,
        recovery: "sil_profile_list",
      });
    },
  });
}

/**
 * `sil_profile_remove` — remove one expert's behaviour artefacts (the sil-side
 * half of a clean removal).
 *
 * This is the ARTEFACT half ONLY. The host-wiring half (the `agents.list[]`
 * entry) is the skill's `openclaw agents remove <agentId>` CLI step, which the
 * skill runs FIRST — the plugin cannot write `~/.openclaw` (`noChildProcess`).
 *
 * Fail-closed: re-runs the `agentId` gate itself, deletes only the single
 * validated leaf directory under `agents/`, and deletes NOTHING on a bad id.
 * Absent target → `not_found` (idempotent — safe to re-run after a partial host
 * failure). A genuine `rmSync` failure → `persistence_failed`. Reads no token.
 */
function registerRemove(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_remove",
    label: "Remove a sil shopping expert's behaviour artefacts",
    description:
      "Remove one sil shopping expert's behaviour artefacts from the sil data"
      + " directory (its agents/<id>/ directory). This is the SIL-SIDE half of"
      + " removal only — the host wiring (the agents.list[] entry) is removed"
      + " separately by the host CLI, which the skill runs FIRST (this plugin"
      + " cannot write the host config). Pass the `agentId`. Scoped to exactly"
      + " that one expert: a malformed/traversal/\"main\" id returns"
      + " `invalid_request` and deletes nothing; an unknown id returns"
      + " `not_found` (idempotent — safe to re-run after a partial failure); a"
      + " genuine filesystem failure returns `persistence_failed`. Confirm with"
      + " the user before removing — it is destructive and irreversible.",
    parameters: Type.Object({
      agentId: Type.String({
        description:
          "The expert's host agent id (lower-kebab, e.g. \"gift-buyer\"; not"
          + " \"main\"). Keys the artefact directory to remove. Exactly one"
          + " expert is affected.",
      }),
    }),
    async execute(_callId, params) {
      const agentId = typeof params["agentId"] === "string" ? params["agentId"] : "";
      const result = removeAgentArtefacts(agentId);

      if (result.ok) {
        api.logger.info("sil_profile_removed", { agent_id: result.agentId });
        return jsonResult({
          status: "removed",
          agentId: result.agentId,
        });
      }

      if (result.kind === "invalid_request") {
        api.logger.warn("sil_profile_remove_invalid_request", { field: result.field });
        return jsonResult({
          status: "invalid_request",
          field: result.field,
          message: result.message,
        });
      }

      if (result.kind === "not_found") {
        api.logger.info("sil_profile_remove_not_found", { agent_id: result.agentId });
        return jsonResult({
          status: "not_found",
          agentId: result.agentId,
          message: result.message,
          recovery: "sil_profile_list",
        });
      }

      // persistence_failed — the path + cause are in `error` (never a token/PII).
      api.logger.error("sil_profile_remove_persistence_failed", { error: result.error });
      return jsonResult({
        status: "persistence_failed",
        error: result.error,
        message: result.message,
        recovery: result.recovery,
      });
    },
  });
}
