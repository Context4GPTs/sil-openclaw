/**
 * sil shopper profile tools — the single multi-domain shopper seam.
 *
 * `sil_profile_materialize` is the plugin's half of the agent-creation engine and
 * the lazy domain-mint path: it writes the SHARED, agent-level user spec and, when
 * a `domain` pack is supplied, that niche's SDS artefacts
 * (`domains/<slug>/{domain_spec,intent_spec,playbook}.md`) into the plugin's own
 * data directory (`$SIL_DATA_DIR`, the disclosed `filesystemScope`). It stays ONE
 * tool with an OPTIONAL `domain`: no `domain` ⇒ create the one shopper; with
 * `domain` ⇒ lazily mint/refresh a niche AND persist any cross-niche fact captured
 * into the shared user spec — one atomic call. The persona is NOT written here —
 * the shopper's identity/voice is the host workspace `SOUL.md`. The wiring half
 * (the host `agents.list[]` entry, the enabled `sil` plugin, the attached skill,
 * the `SOUL.md`) is the host agent driving its own `openclaw …` CLI; the plugin
 * never writes `~/.openclaw` (`security.noChildProcess: true`).
 *
 * Domain classification / routing at shop time stays SKILL-REASONING — there is no
 * routing tool. The surface is the same four profile tools; the skill reads
 * `profile.json.domains` (via `sil_profile_list` / `sil_profile_get`) to pick or
 * lazily mint a niche.
 *
 * This follows `identity.ts` (the reference group): a `registerXTools(api)`
 * function, a `Type.Object` schema the host validates inputs against, the
 * `jsonResult` success/structured-error envelope, and ALL I/O inside `execute()`
 * (register() opens nothing).
 */

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import {
  appendProfileEntry,
  listAgentProfiles,
  materializeProfile,
  readAgentProfile,
  removeAgentArtefacts,
  type ProfileSpec,
  type RememberSpec,
} from "../lib/profile-store.js";
import { jsonResult } from "../lib/tool-result.js";

/** Narrow a host-validated param to a string, defaulting to "" so the store does
 * the real, structured-error validation (validate-first / write-nothing). */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function registerProfileTools(api: PluginAPI): void {
  registerMaterialize(api);
  registerList(api);
  registerGet(api);
  registerRemove(api);
  registerRemember(api);
}

function registerMaterialize(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_materialize",
    label: "Materialize the sil shopper / mint a domain pack",
    description:
      "Write the one sil shopper's behaviour artefacts into the sil data directory."
      + " ONE tool, two modes. WITHOUT a `domain`: create the shopper — write the"
      + " SHARED, agent-level user spec (the one person's standing facts + hard"
      + " constraints that carry across every niche) and a manifest with an empty"
      + " domains map. WITH a `domain`: lazily mint or refresh that niche on first"
      + " shop — write its domain spec (deep researched niche expertise), intent"
      + " spec (the decomposition dimensions a query must resolve) and playbook (the"
      + " niche buying taste) under domains/<slug>/, AND overwrite the shared user"
      + " spec (so a cross-niche fact surfaced in the same query is persisted) — all"
      + " in one atomic call that upserts domains[slug]. `userSpec` is REQUIRED on"
      + " every call (pass the full updated body — it overwrites atomically). The"
      + " persona is NOT written here — it is the host workspace SOUL.md. Re-run with"
      + " the SAME { agentId, domain.slug } to refresh a niche in place. Does NOT"
      + " touch the host OpenClaw config. Writes are atomic: an invalid spec writes"
      + " nothing, and a write failure leaves nothing partial (a failed new-domain"
      + " mint tears down only that fresh leaf; the shopper and siblings survive).",
    parameters: Type.Object({
      agentId: Type.String({
        description:
          "The host agent id of the shopper (agents.list[].id), lower-kebab; not"
          + " \"main\" (host-reserved). Keys the artefact dir.",
      }),
      name: Type.String({
        description: "The human-readable shopper name (recorded in the manifest).",
      }),
      userSpec: Type.String({
        description:
          "The SHARED, agent-level user spec — the one person's domain-relevant"
          + " facts + hard constraints (addresses, sizes, allergy/ethics rules they"
          + " never break, budget psychology) that carry across EVERY niche."
          + " REQUIRED, non-empty on every call. Materialized as user_spec.md and"
          + " read by every domain's shop loop, so a fact captured while shopping one"
          + " niche is reused in another without being re-asked. On any augment, pass"
          + " the full updated body — it overwrites atomically.",
      }),
      domain: Type.Optional(
        Type.Object(
          {
            slug: Type.String({
              description:
                "The domain slug, lower-kebab; not \"main\". Keys domains/<slug>/."
                + " Reuse the slug of an existing matching niche before minting a new"
                + " one (the skill dedups; the store enforces only shape).",
            }),
            name: Type.String({
              description: "The human-readable domain name (e.g. \"Road cycling\").",
            }),
            domainSpec: Type.String({
              description:
                "The SDS domain spec — deep researched niche expertise: how to buy"
                + " well in the niche and its full mechanics. REQUIRED, non-empty."
                + " Materialized as domains/<slug>/domain_spec.md; web-refreshed every"
                + " query.",
            }),
            intentSpec: Type.String({
              description:
                "The SDS intent spec — the decomposition DIMENSIONS a shopping query"
                + " in this niche must resolve (use-case, budget, compatibility…),"
                + " derived from the domain spec. REQUIRED, non-empty. The dimension"
                + " SCHEMA only — the per-query intent is ephemeral. Materialized as"
                + " domains/<slug>/intent_spec.md.",
            }),
            playbook: Type.String({
              description:
                "The SDS playbook — the user's buying TASTE for THIS niche (price"
                + " band, brand leanings, niche-mechanical preferences). REQUIRED,"
                + " non-empty. Materialized as domains/<slug>/playbook.md. On a"
                + " per-query augment, pass the full updated body.",
            }),
          },
          {
            description:
              "OPTIONAL per-domain pack. Omit to create/refresh the shopper only;"
              + " include to lazily mint or refresh a niche.",
          },
        ),
      ),
    }),
    async execute(_callId, params) {
      // The host validates `params` against the schema above before we run, but
      // narrow at the read site (the SDK types params as Record<string,unknown>)
      // and let the store do the real, structured-error validation.
      const rawDomain = params["domain"];
      let domain: ProfileSpec["domain"];
      if (typeof rawDomain === "object" && rawDomain !== null) {
        const d = rawDomain as Record<string, unknown>;
        domain = {
          slug: asString(d["slug"]),
          name: asString(d["name"]),
          domainSpec: asString(d["domainSpec"]),
          intentSpec: asString(d["intentSpec"]),
          playbook: asString(d["playbook"]),
        };
      }

      const spec: ProfileSpec = {
        agentId: asString(params["agentId"]),
        name: asString(params["name"]),
        userSpec: asString(params["userSpec"]),
        ...(domain ? { domain } : {}),
      };

      const result = materializeProfile(spec);

      if (result.ok) {
        api.logger.info("sil_profile_materialized", {
          agent_id: result.agentId,
          domain_slug: result.domain?.slug,
        });
        const payload: Record<string, unknown> = {
          status: "ok",
          agentId: result.agentId,
          dir: result.dir,
          userSpecPath: result.userSpecPath,
          profilePath: result.profilePath,
        };
        if (result.domain) payload["domain"] = result.domain;
        return jsonResult(payload);
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
 * `sil_profile_list` — enumerate the shopper(s) and each one's domain index
 * (read-only, no args). The artefact store is the source of truth (a readable
 * `agents/<id>/profile.json`). An empty store, or a shopper with `domains: {}`, is
 * a normal `ok` outcome (a shopper that has not shopped yet). One corrupt manifest
 * lands in `unreadable[]` and never aborts the listing.
 */
function registerList(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_list",
    label: "List the sil shopper's domains",
    description:
      "List the sil shopper(s) and each one's domains — read-only, no arguments."
      + " Sourced from the sil data directory's artefact store (each"
      + " agents/<id>/profile.json is the authoritative shopper signal; its domains"
      + " map is the niche index). Returns each shopper's agentId, name and createdAt"
      + " plus its domains (slug, name, createdAt, updatedAt). A shopper with no"
      + " domains yet still lists, with an empty domain list — that is healthy, not"
      + " an error; so is an empty store. One unreadable or corrupt manifest is"
      + " reported inline in `unreadable` and never aborts the listing. Reads no"
      + " token and writes nothing.",
    parameters: Type.Object({}),
    async execute(_callId, _params) {
      const { shoppers, unreadable } = listAgentProfiles();
      api.logger.info("sil_profile_listed", {
        shopper_count: shoppers.length,
        unreadable_count: unreadable.length,
      });
      return jsonResult({ status: "ok", shoppers, unreadable });
    },
  });
}

/**
 * `sil_profile_get` — view the shopper overview OR one domain's pack (read-only).
 *
 * With no `domainSlug`: the shopper overview (identity + the SHARED user spec + the
 * domain index, no bodies). With a `domainSlug`: that domain's three bodies + the
 * SHARED user spec. Re-runs the `agentId` gate (and a slug gate) before any read.
 * An unknown/unloadable shopper or domain → `not_found`; a malformed/traversal id
 * or slug → `invalid_request`. Reads no token and writes nothing.
 */
function registerGet(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_get",
    label: "View the sil shopper overview or one domain",
    description:
      "Show the sil shopper's detail — read-only. Pass `agentId`. WITHOUT a"
      + " `domainSlug`: the shopper overview — its name, the SHARED user spec (the"
      + " one person's facts + hard constraints) and the domain index (each niche's"
      + " slug/name/timestamps), no per-domain bodies. WITH a `domainSlug`: that"
      + " one domain's pack — its domain spec, intent spec and playbook (buying"
      + " taste) PLUS the SHARED user spec. The persona is not here — it is the host"
      + " workspace SOUL.md. A freshly-created shopper with no domains is healthy"
      + " (the overview returns ok with an empty domain index). An unknown shopper"
      + " or an unminted/unloadable domain returns `not_found` (list to see what"
      + " exists). A malformed/traversal id or slug returns `invalid_request`. Reads"
      + " no token and writes nothing.",
    parameters: Type.Object({
      agentId: Type.String({
        description:
          "The shopper's host agent id (lower-kebab; not \"main\"). Keys the"
          + " artefact directory the detail is read from.",
      }),
      domainSlug: Type.Optional(
        Type.String({
          description:
            "OPTIONAL. A domain slug to view that niche's pack; omit for the shopper"
            + " overview (identity + shared user spec + domain index).",
        }),
      ),
    }),
    async execute(_callId, params) {
      const agentId = asString(params["agentId"]);
      const rawSlug = params["domainSlug"];
      const domainSlug = typeof rawSlug === "string" ? rawSlug : undefined;
      const result = readAgentProfile(agentId, domainSlug);

      if (result.ok) {
        if (result.slug !== undefined) {
          // Per-domain read — the niche's three bodies + the shared user spec.
          api.logger.info("sil_profile_viewed", {
            agent_id: result.agentId,
            domain_slug: result.slug,
          });
          return jsonResult({
            status: "ok",
            agentId: result.agentId,
            name: result.name,
            slug: result.slug,
            userSpec: result.userSpec,
            domainSpec: result.domainSpec,
            intentSpec: result.intentSpec,
            playbook: result.playbook,
            profilePath: result.profilePath,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          });
        }
        // Overview — identity + shared user spec + the domain index (no bodies).
        api.logger.info("sil_profile_viewed", { agent_id: result.agentId });
        return jsonResult({
          status: "ok",
          agentId: result.agentId,
          name: result.name,
          userSpec: result.userSpec,
          domains: result.domains,
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
 * `sil_profile_remove` — remove ONE of the shopper's domain packs (artefact half).
 *
 * `domainSlug` is REQUIRED — there is no omit-deletes-everything trap; removing the
 * whole shopper is a host concern, not this tool. Removes exactly the one
 * `domains/<slug>/` leaf and de-registers it from the manifest; the shopper and the
 * SHARED user spec survive. Re-runs the gates itself, deletes NOTHING on a bad/
 * missing slug. Absent (unregistered) slug → `not_found` (idempotent). A genuine
 * `rmSync`/rewrite failure → `persistence_failed`. Reads no token.
 */
function registerRemove(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_remove",
    label: "Remove one of the sil shopper's domains",
    description:
      "Remove ONE of the sil shopper's domain packs from the sil data directory"
      + " (its domains/<slug>/ directory) — the SIL-SIDE artefact half only. Pass"
      + " BOTH `agentId` and `domainSlug`; `domainSlug` is REQUIRED — this never"
      + " deletes the whole shopper (decommissioning the shopper is a host concern)."
      + " Scoped to exactly that one domain: the shopper, the SHARED user spec, and"
      + " every sibling domain survive. A malformed/traversal/\"main\" or missing"
      + " slug returns `invalid_request` and deletes nothing; an unregistered slug"
      + " returns `not_found` (idempotent — safe to re-run after a partial failure);"
      + " a genuine filesystem failure returns `persistence_failed`. Confirm with the"
      + " user before removing — it is destructive and irreversible.",
    parameters: Type.Object({
      agentId: Type.String({
        description:
          "The shopper's host agent id (lower-kebab; not \"main\"). Keys the"
          + " artefact directory the domain is removed from.",
      }),
      domainSlug: Type.String({
        description:
          "The domain slug to remove (lower-kebab; not \"main\"). REQUIRED —"
          + " exactly one domain pack is affected; the shopper itself is not.",
      }),
    }),
    async execute(_callId, params) {
      const agentId = asString(params["agentId"]);
      const domainSlug = asString(params["domainSlug"]);
      const result = removeAgentArtefacts(agentId, domainSlug);

      if (result.ok) {
        api.logger.info("sil_profile_removed", {
          agent_id: result.agentId,
          domain_slug: result.domainSlug,
        });
        return jsonResult({
          status: "removed",
          agentId: result.agentId,
          domainSlug: result.domainSlug,
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

/**
 * `sil_remember` — the lightweight per-query APPEND memory verb.
 *
 * Appends ONE typed learning without re-emitting the whole document — the cheap
 * path the model actually takes under load (vs. the heavy whole-doc
 * `sil_profile_materialize` round-trip). `kind:"fact"` (something true about the
 * person) lands in the agent-level `user_spec.md` and carries across every niche;
 * `kind:"taste"` (how they like to buy in this niche) lands in the active domain's
 * `playbook.md`. `hard:true` marks an inviolable user-spec constraint (FACT only);
 * `domain` selects the niche for a TASTE (omitted ⇒ the single registered domain).
 *
 * Thin over `appendProfileEntry`: narrow the host-validated params, call the store,
 * map the discriminated result to the canonical envelope. The remembered `text` is
 * user content — it is NEVER written to a log payload (only non-PII markers are).
 */
function registerRemember(api: PluginAPI): void {
  api.registerTool({
    name: "sil_remember",
    label: "Remember one fact or taste for the sil shopper",
    description:
      "Append ONE typed learning to the sil shopper's behaviour artefacts — the"
      + " CHEAP per-query persistence path (no whole-doc round-trip). Use this every"
      + " query to capture something the interaction surfaced, in the open (never"
      + " silently). `kind:\"fact\"` records something true about the PERSON (a"
      + " measurement, a size, an address, an allergy/ethics rule) — it appends to the"
      + " agent-level user spec and carries across EVERY niche; set `hard:true` to mark"
      + " an INVIOLABLE constraint (a reject-at-pick rule, FACTS only). `kind:\"taste\"`"
      + " records how the person likes to BUY in a niche (price band, brand leaning) —"
      + " it appends to that niche's buying-taste playbook; pass `domain` to select the"
      + " niche (omit it only when the shopper has exactly one). ONE discrete learning"
      + " per call — two facts and a taste are three calls. Append-only and accretive:"
      + " it never rewrites or de-duplicates the doc — a contradiction or a full"
      + " refine/overwrite stays the whole-doc sil_profile_materialize path. Makes NO"
      + " network call and reads no token; writes one short line via O_APPEND. A"
      + " malformed/traversal/\"main\" agentId, a blank text, a fact carrying a domain,"
      + " or a taste carrying hard:true returns invalid_request and writes nothing; an"
      + " unknown shopper / unminted domain / missing body returns not_found (mint it"
      + " first); a genuine write failure returns persistence_failed.",
    parameters: Type.Object({
      agentId: Type.String({
        description:
          "The shopper's host agent id (agents.list[].id), lower-kebab; not \"main\""
          + " (host-reserved). Keys the artefact directory the entry is appended to.",
      }),
      kind: Type.Union([Type.Literal("fact"), Type.Literal("taste")], {
        description:
          "\"fact\" → the agent-level user spec (true about the person; carries across"
          + " niches). \"taste\" → the active domain's buying-taste playbook (how they"
          + " buy in THIS niche).",
      }),
      text: Type.String({
        description:
          "The ONE short learning to record (a single discrete fact or taste). Keep it"
          + " to one entry — it is appended verbatim as a markdown bullet.",
      }),
      domain: Type.Optional(
        Type.String({
          description:
            "TASTE only — the domain slug (lower-kebab; not \"main\") to append the"
            + " taste to. Omit ONLY when the shopper has exactly one domain (it"
            + " resolves automatically); with 2+ domains, omitting it is ambiguous and"
            + " returns invalid_request. Ignored / a category error on a fact.",
        }),
      ),
      hard: Type.Optional(
        Type.Boolean({
          description:
            "FACT only — true marks an INVIOLABLE user-spec constraint (an allergy, an"
            + " ethics rule, an age gate) the shop loop rejects candidates against."
            + " Taste is always soft, so hard:true on a taste is a contradiction"
            + " (invalid_request).",
        }),
      ),
    }),
    async execute(_callId, params) {
      // Host-validated against the schema above; narrow at the read site (the SDK
      // types params as Record<string,unknown>) and let the store do the real,
      // structured-error validation. Only carry domain/hard when meaningfully set
      // so a fact never carries a spurious `domain: undefined`.
      const kind: RememberSpec["kind"] = params["kind"] === "taste" ? "taste" : "fact";
      const rawDomain = params["domain"];
      const domain = typeof rawDomain === "string" ? rawDomain : undefined;
      const hard = params["hard"] === true ? true : undefined;

      const spec: RememberSpec = {
        agentId: asString(params["agentId"]),
        kind,
        text: asString(params["text"]),
        ...(domain !== undefined ? { domain } : {}),
        ...(hard !== undefined ? { hard } : {}),
      };

      const result = appendProfileEntry(spec);

      if (result.ok) {
        // Non-PII marker only — the remembered `text` is user content and is never
        // logged.
        api.logger.info("sil_remembered", {
          agent_id: result.agentId,
          kind: result.kind,
          domain_slug: result.domain,
        });
        return jsonResult({
          status: "ok",
          agentId: result.agentId,
          kind: result.kind,
          ...(result.domain !== undefined ? { domain: result.domain } : {}),
        });
      }

      if (result.kind === "invalid_request") {
        api.logger.warn("sil_remember_invalid_request", { field: result.field });
        return jsonResult({
          status: "invalid_request",
          field: result.field,
          message: result.message,
        });
      }

      if (result.kind === "not_found") {
        api.logger.info("sil_remember_not_found", { agent_id: result.agentId });
        return jsonResult({
          status: "not_found",
          agentId: result.agentId,
          message: result.message,
          recovery: "sil_profile_materialize",
        });
      }

      // persistence_failed — the path + cause are in `error` (never a token/PII).
      api.logger.error("sil_remember_persistence_failed", { error: result.error });
      return jsonResult({
        status: "persistence_failed",
        error: result.error,
        message: result.message,
        recovery: result.recovery,
      });
    },
  });
}
