/**
 * sil shopping-expert profile tools.
 *
 * `sil_profile_materialize` is the plugin's half of the agent-creation engine:
 * it writes the created expert's *behaviour* artefacts (persona + optional
 * domain sub-skill playbook + a typed manifest) into the plugin's own data
 * directory (`$SIL_DATA_DIR`, the disclosed `filesystemScope`). The *wiring*
 * half — the host `agents.list[]` entry, the enabled `sil` plugin, the attached
 * `sil` skill — is the host agent driving its own `openclaw …` CLI under the
 * bundled `skill/SKILL.md` procedure; the plugin never writes `~/.openclaw`
 * (`security.noChildProcess: true`, host config is outside `filesystemScope`).
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

import { materializeProfile, type ProfileSpec } from "../lib/profile-store.js";
import { jsonResult } from "../lib/tool-result.js";

export function registerProfileTools(api: PluginAPI): void {
  registerMaterialize(api);
}

function registerMaterialize(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_materialize",
    label: "Materialize a sil shopping-expert's behaviour artefacts",
    description:
      "Write a created sil shopping expert's behaviour artefacts into the sil"
      + " data directory: the persona/instructions, an optional generated domain"
      + " sub-skill (playbook), and a typed manifest the sil skill reads at"
      + " runtime to load them. Call this AFTER the host agent has been created"
      + " (openclaw agents add) and BEFORE openclaw config validate. It does NOT"
      + " touch the host OpenClaw config — the plugin enable + skill attach are"
      + " driven by the host CLI, not this tool. Writes are atomic: an invalid"
      + " spec writes nothing, and a write failure leaves nothing partial.",
    parameters: Type.Object({
      agentId: Type.String({
        description:
          "The host agent id the expert was created under (agents.list[].id),"
          + " lower-kebab; not \"main\" (host-reserved). Keys the artefact dir.",
      }),
      name: Type.String({
        description: "The human-readable expert name (recorded in the manifest).",
      }),
      persona: Type.String({
        description:
          "The shopping persona/instructions — the expert's expertise, tone, and"
          + " standing rules. Non-empty. Materialized as persona.md and copied"
          + " into the agent workspace SOUL.md by the skill.",
      }),
      playbook: Type.Optional(
        Type.String({
          description:
            "The generated domain sub-skill: how this expert shops on sil (which"
            + " sil_* tool for which intent, refinement rules). Materialized as"
            + " playbook.md and loaded by the sil skill at session start. Omit"
            + " when the expert needs no domain playbook.",
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
        persona: typeof params["persona"] === "string" ? params["persona"] : "",
        ...(typeof params["playbook"] === "string"
          ? { playbook: params["playbook"] }
          : {}),
      };

      const result = materializeProfile(spec);

      if (result.ok) {
        api.logger.info("sil_profile_materialized", {
          agent_id: result.agentId,
          has_playbook: result.playbookPath !== undefined,
        });
        return jsonResult({
          status: "ok",
          agentId: result.agentId,
          dir: result.dir,
          personaPath: result.personaPath,
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
