/**
 * sil shopper profile tools — the frontmatter-as-truth artefact seam.
 *
 * FIVE local verbs over the singleton shopper store ($SIL_DATA_DIR/shopper), each
 * making NO network call and reading no token:
 *
 *   - `sil_profile_materialize { name, userSpec }` — SETUP-ONLY: write user_spec.md
 *     (its frontmatter carries the shopper name). Does NOT mint methods/PRDs.
 *   - `sil_learn { target, domain?, prd?, kind, … }` — the single target+change verb
 *     for the whole method/PRD lifecycle: create mints a whole doc; append/amend/
 *     retract refine in place; attach-asset persists image bytes by path.
 *   - `sil_profile_search { domain?, product?, intent?, query? }` — query artefact
 *     FRONTMATTER (coordinates only, no bodies); the discovery / reuse-before-mint
 *     primitive. Malformed frontmatter surfaces in `unreadable`, never dropped.
 *   - `sil_profile_get { domainSlug, prd? }` — the rich read (one whole body).
 *   - `sil_profile_remove { domainSlug, prd? }` — remove a whole domain, or one PRD.
 *
 * This follows `identity.ts` (the reference group): a `registerXTools(api)` function,
 * a `Type.Object` schema the host validates inputs against, the `jsonResult`
 * success/structured-error envelope, and ALL I/O inside `execute()` (register() opens
 * nothing). The persona is NOT written here — it is the host workspace SOUL.md.
 */

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import {
  learnArtefact,
  materializeProfile,
  readArtefactBody,
  removeArtefact,
  searchProfileFrontmatter,
  type LearnKind,
  type LearnSpec,
  type LearnTarget,
} from "../lib/profile-store.js";
import { jsonResult } from "../lib/tool-result.js";

/** Narrow a host-validated param to a string, defaulting to "" so the store does the
 * real, structured-error validation (validate-first / write-nothing). */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Narrow an optional string param — `undefined` unless a non-empty string is given,
 * so a selector is never carried as a spurious empty value. */
function optString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function registerProfileTools(api: PluginAPI): void {
  registerMaterialize(api);
  registerLearn(api);
  registerSearch(api);
  registerGet(api);
  registerRemove(api);
}

function registerMaterialize(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_materialize",
    label: "Set up the sil shopper",
    description:
      "SETUP-ONLY: create the one sil shopper by writing its shared user spec into the"
      + " sil data directory. Writes user_spec.md — the person's standing facts + hard"
      + " constraints (addresses, sizes, allergy/ethics rules, budget psychology) that"
      + " carry across EVERY niche — with the shopper `name` in the file's own"
      + " frontmatter (there is NO manifest; the frontmatter IS the source of truth)."
      + " It does NOT mint any domain method or PRD — that is sil_learn create. `name`"
      + " and `userSpec` are both REQUIRED. Run this ONCE at setup: post-setup user-spec"
      + " refinement is sil_learn (append/amend), NEVER a re-materialize (a re-run"
      + " overwrites the whole body, discarding what sil_learn added). Makes no network"
      + " call and reads no token. The"
      + " persona is NOT written here — it is the host workspace SOUL.md. A blank"
      + " name/userSpec returns invalid_request and writes nothing; a write failure"
      + " returns persistence_failed.",
    parameters: Type.Object({
      name: Type.String({
        description: "The human-readable shopper name (recorded in user_spec.md frontmatter).",
      }),
      userSpec: Type.String({
        description:
          "The shared user spec — the one person's cross-domain facts + hard"
          + " constraints. REQUIRED, non-empty. Read by every domain's shop loop, so a"
          + " fact captured in one niche is reused in another without re-asking.",
      }),
    }),
    async execute(_callId, params) {
      const result = materializeProfile({
        name: asString(params["name"]),
        userSpec: asString(params["userSpec"]),
      });
      if (result.ok) {
        api.logger.info("sil_profile_materialized", {});
        return jsonResult({ status: "ok", dir: result.dir, userSpecPath: result.userSpecPath });
      }
      return mapFailure(api, "sil_profile_materialize", result);
    },
  });
}

function registerLearn(api: PluginAPI): void {
  api.registerTool({
    name: "sil_learn",
    label: "Teach the sil shopper (create or refine a method / PRD)",
    description:
      "The single target+change verb that owns the whole method/PRD lifecycle for the"
      + " sil shopper — create a whole doc, or refine one in place. `target` selects"
      + " WHERE the change lands: `user_spec` (the shared person spec, no selector),"
      + " `method` (needs `domain`), or `prd` (needs `domain` + `prd`, the"
      + " <product>-<intent> key). `kind` selects the change: `create` mints a whole"
      + " method (domain, name, body) or PRD (domain, prd, product, intent, title,"
      + " body) — NOT valid for user_spec; `append` adds one `- text` bullet under a"
      + " named `## section` (fail-closed if that heading is absent) else at EOF;"
      + " `amend` replaces the single bullet matching `from` with `to` (an ambiguous"
      + " 2+ match is refused); `retract` removes the single bullet matching `from`;"
      + " `attach-asset` persists image `bytes` (base64 + `mime`) into the domain's"
      + " assets and links them by relative path. `hard` marks an inviolable"
      + " constraint — valid only on append to user_spec or prd. append/amend/retract/"
      + " attach-asset require the target to already exist (else not_found). Makes no"
      + " network call and reads no token; writes are atomic + owner-only. A bad field"
      + " returns invalid_request and writes nothing.",
    parameters: Type.Object({
      target: Type.Union(
        [Type.Literal("user_spec"), Type.Literal("method"), Type.Literal("prd")],
        { description: "WHERE the change lands: user_spec | method | prd." },
      ),
      kind: Type.Union(
        [
          Type.Literal("create"),
          Type.Literal("append"),
          Type.Literal("amend"),
          Type.Literal("retract"),
          Type.Literal("attach-asset"),
        ],
        { description: "The change: create | append | amend | retract | attach-asset." },
      ),
      domain: Type.Optional(
        Type.String({ description: "The domain slug (lower-kebab, not \"main\") — required for method/prd." }),
      ),
      prd: Type.Optional(
        Type.String({ description: "The PRD key <product>-<intent> (lower-kebab) — required for a prd target." }),
      ),
      name: Type.Optional(Type.String({ description: "create method: the human-readable domain name." })),
      body: Type.Optional(Type.String({ description: "create: the whole markdown body to mint." })),
      product: Type.Optional(Type.String({ description: "create prd: the product type." })),
      intent: Type.Optional(Type.String({ description: "create prd: the use-context (general when context-free)." })),
      title: Type.Optional(Type.String({ description: "create prd: the human-readable job title." })),
      text: Type.Optional(Type.String({ description: "append: the one bullet to add." })),
      from: Type.Optional(Type.String({ description: "amend/retract: the exact bullet text to match (single occurrence)." })),
      to: Type.Optional(Type.String({ description: "amend: the replacement bullet text." })),
      section: Type.Optional(Type.String({ description: "append/amend/retract: the `## section` to scope to." })),
      hard: Type.Optional(
        Type.Boolean({ description: "append to user_spec/prd only: mark an inviolable constraint the shop loop rejects against." }),
      ),
      bytes: Type.Optional(Type.String({ description: "attach-asset: the image bytes, base64-encoded." })),
      mime: Type.Optional(Type.String({ description: "attach-asset: image/jpeg | image/png | image/webp | image/gif." })),
      caption: Type.Optional(Type.String({ description: "attach-asset: an optional caption for the markdown link." })),
    }),
    async execute(_callId, params) {
      const spec: LearnSpec = {
        target: (params["target"] as LearnTarget) ?? "method",
        kind: (params["kind"] as LearnKind) ?? "append",
        domain: optString(params["domain"]),
        prd: optString(params["prd"]),
        name: optString(params["name"]),
        body: optString(params["body"]),
        product: optString(params["product"]),
        intent: optString(params["intent"]),
        title: optString(params["title"]),
        text: optString(params["text"]),
        from: optString(params["from"]),
        to: optString(params["to"]),
        section: optString(params["section"]),
        hard: params["hard"] === true ? true : undefined,
        bytes: optString(params["bytes"]),
        mime: optString(params["mime"]),
        caption: optString(params["caption"]),
      };
      const result = learnArtefact(spec);
      if (result.ok) {
        // Non-PII markers only — no artefact body/text is ever logged.
        api.logger.info("sil_learned", {
          kind: result.kind,
          target: result.target,
          domain_slug: result.domain,
          prd: result.prd,
        });
        return jsonResult({
          status: "ok",
          kind: result.kind,
          target: result.target,
          ...(result.domain !== undefined ? { domain: result.domain } : {}),
          ...(result.prd !== undefined ? { prd: result.prd } : {}),
          path: result.path,
          ...(result.assetPath !== undefined ? { assetPath: result.assetPath } : {}),
        });
      }
      return mapFailure(api, "sil_learn", result);
    },
  });
}

function registerSearch(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_search",
    label: "Search what the sil shopper knows (domains + PRDs)",
    description:
      "Query the sil shopper's artefact FRONTMATTER — the discovery / reuse-before-mint"
      + " primitive. Returns COORDINATES only (no document bodies): the domains the"
      + " shopper has learned ({slug, name}) and its PRDs ({domain, key, product,"
      + " intent, title, …}). All filters are optional — pass none for the full"
      + " overview, or narrow by `domain` / `product` / `intent` / a free-text"
      + " `query`. This is a filesystem SCAN, not an index read; a domain or PRD whose"
      + " frontmatter is malformed is SKIPPED and surfaced in `unreadable` (never"
      + " silently dropped, never half-read) while healthy siblings still list. An"
      + " empty store returns ok with empty domains/prds (healthy). Makes no network"
      + " call and reads no token.",
    parameters: Type.Object({
      domain: Type.Optional(Type.String({ description: "Filter to one domain slug." })),
      product: Type.Optional(Type.String({ description: "Filter PRDs by product type." })),
      intent: Type.Optional(Type.String({ description: "Filter PRDs by intent (use-context)." })),
      query: Type.Optional(Type.String({ description: "Free-text substring match over the coordinates." })),
    }),
    async execute(_callId, params) {
      const result = searchProfileFrontmatter({
        domain: optString(params["domain"]),
        product: optString(params["product"]),
        intent: optString(params["intent"]),
        query: optString(params["query"]),
      });
      api.logger.info("sil_profile_searched", {
        domain_count: result.domains.length,
        prd_count: result.prds.length,
        unreadable_count: result.unreadable.length,
      });
      return jsonResult({
        status: "ok",
        domains: result.domains,
        prds: result.prds,
        unreadable: result.unreadable,
      });
    },
  });
}

function registerGet(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_get",
    label: "Read one sil shopper document (method or PRD)",
    description:
      "Read ONE full body from the sil shopper's store — the rich read. With a"
      + " `domainSlug` only, returns that domain's method body (its buying guide +"
      + " taste + search vocabulary); with `domainSlug` + `prd`, returns that PRD's"
      + " body (its requirements + filled preferences). Use sil_profile_search first"
      + " to discover which domains/PRDs exist (coordinates), then this to read one in"
      + " full. A missing method/PRD returns not_found; a malformed/traversal/\"main\""
      + " slug returns invalid_request. Makes no network call and reads no token.",
    parameters: Type.Object({
      domainSlug: Type.String({
        description: "The domain slug to read (lower-kebab, not \"main\"). REQUIRED.",
      }),
      prd: Type.Optional(
        Type.String({ description: "OPTIONAL. A PRD key to read that PRD's body instead of the method." }),
      ),
    }),
    async execute(_callId, params) {
      const result = readArtefactBody(asString(params["domainSlug"]), optString(params["prd"]));
      if (result.ok) {
        api.logger.info("sil_profile_read", { target: result.target, domain_slug: result.domain, prd: result.prd });
        return jsonResult({
          status: "ok",
          target: result.target,
          domain: result.domain,
          ...(result.prd !== undefined ? { prd: result.prd } : {}),
          fields: result.fields,
          body: result.body,
          path: result.path,
        });
      }
      return mapFailure(api, "sil_profile_get", result);
    },
  });
}

function registerRemove(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_remove",
    label: "Remove a sil shopper domain, or one of its PRDs",
    description:
      "Remove artefacts from the sil shopper's store — the SIL-SIDE half only. With a"
      + " `domainSlug` only, removes the WHOLE domain subtree (method + all PRDs +"
      + " assets); with `domainSlug` + `prd`, removes just that ONE PRD (the method and"
      + " sibling PRDs survive). Scoped and fail-closed: a malformed/traversal/\"main\""
      + " slug returns invalid_request and deletes nothing; an unregistered domain/PRD"
      + " returns not_found (idempotent — safe to re-run); a genuine filesystem failure"
      + " returns persistence_failed. Never removes the shopper itself (that is a host"
      + " concern). Confirm with the user before removing — it is destructive. Makes no"
      + " network call and reads no token.",
    parameters: Type.Object({
      domainSlug: Type.String({
        description: "The domain slug to remove from (lower-kebab, not \"main\"). REQUIRED.",
      }),
      prd: Type.Optional(
        Type.String({ description: "OPTIONAL. A PRD key to remove just that PRD instead of the whole domain." }),
      ),
    }),
    async execute(_callId, params) {
      const result = removeArtefact(asString(params["domainSlug"]), optString(params["prd"]));
      if (result.ok) {
        api.logger.info("sil_profile_removed", { domain_slug: result.domainSlug, prd: result.prd });
        return jsonResult({
          status: "removed",
          domainSlug: result.domainSlug,
          ...(result.prd !== undefined ? { prd: result.prd } : {}),
        });
      }
      return mapFailure(api, "sil_profile_remove", result);
    },
  });
}

/** Map a store failure variant to the canonical structured envelope + a non-PII log. */
function mapFailure(
  api: PluginAPI,
  tool: string,
  result:
    | { ok: false; kind: "invalid_request"; field: string; message: string }
    | { ok: false; kind: "not_found"; message: string }
    | { ok: false; kind: "persistence_failed"; error: string; message: string; recovery: "fix_data_dir" },
) {
  if (result.kind === "invalid_request") {
    api.logger.warn(tool + "_invalid_request", { field: result.field });
    return jsonResult({ status: "invalid_request", field: result.field, message: result.message });
  }
  if (result.kind === "not_found") {
    api.logger.info(tool + "_not_found", {});
    return jsonResult({ status: "not_found", message: result.message });
  }
  api.logger.error(tool + "_persistence_failed", { error: result.error });
  return jsonResult({
    status: "persistence_failed",
    error: result.error,
    message: result.message,
    recovery: result.recovery,
  });
}
