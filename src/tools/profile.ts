/**
 * sil shopper profile tools — the frontmatter-as-truth artefact seam.
 *
 * FIVE local verbs over the singleton shopper store ($SIL_DATA_DIR/shopper), each
 * making NO network call and reading no token:
 *
 *   - `sil_profile_materialize { name, userSpec }` — SETUP-ONLY: write user_spec.md
 *     (its frontmatter carries the shopper name). Does NOT mint methods/PRDs.
 *   - `sil_learn { target, domain?, prd?, kind, … }` — the single target+change verb
 *     for the whole method/PRD lifecycle: create mints a NEW doc; write replaces an
 *     existing doc's whole body (reconciled); attach-asset persists image bytes by path.
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
      "SETUP-ONLY: create the one sil shopper by writing its shared user_spec.md — the"
      + " person's cross-niche facts + hard constraints — with the shopper `name` in the"
      + " file's frontmatter (no manifest). Does NOT mint any domain method or PRD (that"
      + " is sil_learn create). Run ONCE at setup; refine later with sil_learn, never a"
      + " re-materialize (it overwrites the whole body). `name` + `userSpec` required and"
      + " non-empty. Local-only, no network. Blank input → invalid_request; write failure"
      + " → persistence_failed.",
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
      "The single target+change verb owning the sil shopper's method/PRD lifecycle."
      + " `target` (user_spec | method | prd) picks WHERE the change lands; `kind`"
      + " (create | write | attach-asset) picks the change. `create` mints a NEW method/"
      + "PRD (not valid for user_spec; errors if one already exists — use write). `write`"
      + " replaces an EXISTING doc's whole body with a reconciled version you author (read"
      + " it first with sil_profile_get and carry every buyer line forward; else not_found)."
      + " `attach-asset` links image bytes. To change anything, WRITE the whole reconciled"
      + " doc — there is no append/amend, so a correction never stacks a contradicting"
      + " line. Local-only, atomic, owner-only, no network; a bad field → invalid_request"
      + " and writes nothing.",
    parameters: Type.Object({
      target: Type.Union(
        [Type.Literal("user_spec"), Type.Literal("method"), Type.Literal("prd")],
        { description: "WHERE the change lands: user_spec | method | prd." },
      ),
      kind: Type.Union(
        [
          Type.Literal("create"),
          Type.Literal("write"),
          Type.Literal("attach-asset"),
        ],
        { description: "The change: create (mint new) | write (replace whole body) | attach-asset." },
      ),
      domain: Type.Optional(
        Type.String({ description: "The domain slug (lower-kebab, not \"main\") — required for method/prd." }),
      ),
      prd: Type.Optional(
        Type.String({ description: "The PRD key <product>-<intent> (lower-kebab) — required for a prd target." }),
      ),
      name: Type.Optional(Type.String({ description: "create method: the human-readable domain name." })),
      body: Type.Optional(Type.String({ description: "create / write: the whole markdown body (mint, or the reconciled replacement)." })),
      product: Type.Optional(Type.String({ description: "create prd: the product type." })),
      intent: Type.Optional(Type.String({ description: "create prd: the use-context (general when context-free)." })),
      title: Type.Optional(Type.String({ description: "create prd: the human-readable job title." })),
      bytes: Type.Optional(Type.String({ description: "attach-asset: the image bytes, base64-encoded." })),
      mime: Type.Optional(Type.String({ description: "attach-asset: image/jpeg | image/png | image/webp | image/gif." })),
      caption: Type.Optional(Type.String({ description: "attach-asset: an optional caption for the markdown link." })),
    }),
    async execute(_callId, params) {
      const spec: LearnSpec = {
        target: (params["target"] as LearnTarget) ?? "method",
        kind: (params["kind"] as LearnKind) ?? "write",
        domain: optString(params["domain"]),
        prd: optString(params["prd"]),
        name: optString(params["name"]),
        body: optString(params["body"]),
        product: optString(params["product"]),
        intent: optString(params["intent"]),
        title: optString(params["title"]),
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
      + " primitive. Returns COORDINATES only (no bodies): the domains learned ({slug,"
      + " name}) and their PRDs ({domain, key, product, intent, title}). All filters"
      + " optional — none = full overview; narrow by domain/product/intent/query. A"
      + " filesystem scan: malformed frontmatter is surfaced in `unreadable`, never"
      + " dropped; healthy siblings still list. Empty store → ok with empty lists. When"
      + " NO domain matches, the result carries `next_step: mint_domain` — the cue to"
      + " mint the niche (sil_learn create) BEFORE shopping. Local-only, no network.",
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
      // The mint trigger. No matching domain came back (an empty store, or a
      // filtered miss on a populated one) — this IS the reuse-before-mint MISS, and
      // it is where a first shop silently stalls: the model finds nothing to reuse
      // and, with no next move in hand, answers a buy-intent off the open web. Carry
      // the next action in the result so the MISS itself points at the mint, the way
      // the catalog tools carry `recovery`. Absent when a domain matched.
      const noMatch = result.domains.length === 0;
      return jsonResult({
        status: "ok",
        domains: result.domains,
        prds: result.prds,
        unreadable: result.unreadable,
        ...(noMatch
          ? {
              next_step: "mint_domain",
              guidance:
                "No learned domain matches this request. To shop this niche, mint"
                + " its domain FIRST: research the buying guide, then sil_learn create"
                + " (target: method). Then shop with sil_search — a buy-intent is"
                + " answered from the sil catalog, never from the open web.",
            }
          : {}),
      });
    },
  });
}

function registerGet(api: PluginAPI): void {
  api.registerTool({
    name: "sil_profile_get",
    label: "Read one sil shopper document (method or PRD)",
    description:
      "Read ONE full body from the sil shopper's store. `domainSlug` alone → the method"
      + " body (buying guide + taste + search vocabulary); `domainSlug` + `prd` → that"
      + " PRD body (requirements + filled preferences). Discover coordinates with"
      + " sil_profile_search first. Missing → not_found; present-but-corrupt frontmatter"
      + " → unreadable (inspect/repair — do NOT overwrite, it may be recoverable), distinct"
      + " from not_found; a bad/traversal/\"main\" slug → invalid_request. Local-only, no"
      + " network.",
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
      "Remove artefacts from the sil shopper's store. `domainSlug` alone removes the"
      + " WHOLE domain subtree (method + all PRDs + assets); `domainSlug` + `prd` removes"
      + " just that ONE PRD (method + siblings survive). Destructive — confirm with the"
      + " user first. A bad/traversal/\"main\" slug → invalid_request (deletes nothing); an"
      + " unregistered domain/PRD → not_found (idempotent); a filesystem failure →"
      + " persistence_failed. Never removes the shopper itself. Local-only, no network.",
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
    | { ok: false; kind: "unreadable"; message: string }
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
  if (result.kind === "unreadable") {
    // A present-but-corrupt artefact — steer the agent to inspect/repair, NEVER re-mint
    // over it (silent data loss on a recoverable artefact). Distinct from not_found.
    api.logger.warn(tool + "_unreadable", {});
    return jsonResult({ status: "unreadable", message: result.message, recovery: "inspect_artefact" });
  }
  api.logger.error(tool + "_persistence_failed", { error: result.error });
  return jsonResult({
    status: "persistence_failed",
    error: result.error,
    message: result.message,
    recovery: result.recovery,
  });
}
