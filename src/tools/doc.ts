/**
 * The shopper's document tools — four operations over one ref scheme
 * (`shopper` | `brief:<slug>`), local-only, no network and no token. Follows
 * `identity.ts` (the reference group): a `registerXTools(api)` function, a
 * `Type.Object` schema the host validates against, the `jsonResult` envelope, and
 * ALL I/O inside `execute()`.
 */

import type { PluginAPI } from "openclaw/plugin-sdk";
import { Type } from "typebox";

import {
  findDocuments,
  migrateLegacyStore,
  readDocument,
  removeDocument,
  writeDocument,
  type StoreFailure,
} from "../lib/doc-store.js";
import { wiringAdvisories } from "../lib/host-wiring.js";
import { jsonResult } from "../lib/tool-result.js";

/** Narrow an optional string param — `undefined` unless a non-empty string is
 * given, so a filter is never carried as a spurious empty value. */
function optString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function registerDocTools(api: PluginAPI): void {
  registerFind(api);
  registerRead(api);
  registerWrite(api);
  registerRemove(api);
}

/** The store's one-hop migration off the legacy `domains/<slug>` layout, run on
 * first touch of the document surface. Returns `null` — one `existsSync` — on every
 * store already in the flat layout, which is every store after the first call. */
function migrateOnTouch(api: PluginAPI): void {
  const summary = migrateLegacyStore();
  if (summary === null) return;
  api.logger.info("sil_doc_store_migrated", {
    shopping_sections: summary.shoppingSections,
    briefs: summary.briefs,
    failed_count: summary.failed.length,
    failed: summary.failed,
  });
}

function registerFind(api: PluginAPI): void {
  api.registerTool({
    name: "sil_doc_find",
    label: "List the sil shopper's documents",
    description:
      "The index over the sil shopper's own documents on this machine — the shopper"
      + " document (who the buyer is) and their Briefs (one shopping job each, with an"
      + " `## Items` row per thing being bought). COORDINATES ONLY: a ref, a title, a"
      + " status and the item rows — bodies come from sil_doc_read. All filters are"
      + " optional and compose; the bare call answers \"what does this shopper have?\"."
      + " `domain` is a path prefix matched against each Brief's item domains, so"
      + " `product` reaches every item under it. A document with malformed frontmatter"
      + " is reported in `unreadable` and keeps its place, so a corrupt file is never"
      + " mistaken for an absent one. Local-only, no network.",
    parameters: Type.Object({
      kind: Type.Optional(
        Type.String({ description: "Narrow to one kind: shopper | brief." }),
      ),
      domain: Type.Optional(
        Type.String({ description: "A registry domain path — matches Briefs holding an item at or under it." }),
      ),
      status: Type.Optional(
        Type.String({ description: "A Brief's lifecycle: active | done | dropped." }),
      ),
      query: Type.Optional(
        Type.String({ description: "Free-text substring over slugs and titles." }),
      ),
    }),
    async execute(_callId, params) {
      migrateOnTouch(api);
      const result = findDocuments({
        kind: optString(params["kind"]),
        domain: optString(params["domain"]),
        status: optString(params["status"]),
        query: optString(params["query"]),
      });
      if (!result.ok) return mapFailure(api, "sil_doc_find", result);
      api.logger.info("sil_doc_found", {
        brief_count: result.briefs.length,
        has_shopper: result.shopper !== undefined,
        unreadable_count: result.unreadable.length,
      });
      return jsonResult({
        status: "ok",
        ...(result.shopper !== undefined ? { shopper: result.shopper } : {}),
        briefs: result.briefs,
        unreadable: result.unreadable,
        ...wiringAdvisories(api),
      });
    },
  });
}

function registerRead(api: PluginAPI): void {
  api.registerTool({
    name: "sil_doc_read",
    label: "Read one sil shopper document",
    description:
      "Read ONE whole document body plus its frontmatter from the sil shopper's store."
      + " `ref` is \"shopper\" (the person — their body facts, fit, shopping taste,"
      + " constraints and past purchases) or \"brief:<slug>\" (one shopping job — its"
      + " items, buying guide, hard constraints, preferences and open questions)."
      + " Discover refs with sil_doc_find. An absent document answers not_found; a"
      + " present but corrupt one answers unreadable — inspect and repair it, never"
      + " write a fresh document over it, because the buyer's own words may still be"
      + " recoverable. A ref that is not lower-kebab, or names a kind this version does"
      + " not address, answers invalid_request. Local-only, no network.",
    parameters: Type.Object({
      ref: Type.String({
        description: 'The document ref: "shopper" or "brief:<slug>" (lower-kebab, not "main").',
      }),
    }),
    async execute(_callId, params) {
      migrateOnTouch(api);
      const result = readDocument(params["ref"]);
      if (!result.ok) return mapFailure(api, "sil_doc_read", result);
      api.logger.info("sil_doc_read", { doc_kind: result.kind });
      return jsonResult({
        status: "ok",
        ref: result.ref,
        kind: result.kind,
        fields: result.fields,
        body: result.body,
        path: result.path,
        ...wiringAdvisories(api),
      });
    },
  });
}

function registerWrite(api: PluginAPI): void {
  api.registerTool({
    name: "sil_doc_write",
    label: "Write one sil shopper document",
    description:
      "Write ONE document in the sil shopper's store. `body` is always the WHOLE"
      + " reconciled markdown — there is no append and no section patch, so read the"
      + " current document with sil_doc_read, reconcile it in context carrying every"
      + " buyer line forward, and write the whole thing back; that is what stops a"
      + " correction stacking a row that contradicts the one above it. `mode` is"
      + " load-bearing in both directions: create fails if the ref already exists, and"
      + " replace fails if it does not — a mint never clobbers, a write never mints."
      + " Frontmatter travels as fields: `name` for the shopper, `title` and `status`"
      + " for a Brief. Atomic and owner-only; a bad field answers invalid_request and"
      + " writes nothing. Local-only, no network.",
    parameters: Type.Object({
      ref: Type.String({
        description: 'The document ref: "shopper" or "brief:<slug>" (lower-kebab, not "main").',
      }),
      mode: Type.Union([Type.Literal("create"), Type.Literal("replace")], {
        description: "create mints a new document; replace rewrites an existing one.",
      }),
      body: Type.String({
        description: "The WHOLE reconciled markdown body — never a fragment, never a patch.",
      }),
      title: Type.Optional(
        Type.String({ description: "Brief frontmatter: the human-readable job title." }),
      ),
      status: Type.Optional(
        Type.String({ description: "Brief frontmatter: active | done | dropped." }),
      ),
      name: Type.Optional(
        Type.String({ description: "Shopper frontmatter: the buyer's name." }),
      ),
    }),
    async execute(_callId, params) {
      migrateOnTouch(api);
      const result = writeDocument({
        ref: params["ref"],
        mode: params["mode"],
        body: optString(params["body"]),
        title: optString(params["title"]),
        status: optString(params["status"]),
        name: optString(params["name"]),
      });
      if (!result.ok) return mapFailure(api, "sil_doc_write", result);
      // Non-PII markers only — no document body ever reaches a log line.
      api.logger.info("sil_doc_written", { doc_kind: result.kind, mode: result.mode });
      return jsonResult({
        status: "ok",
        ref: result.ref,
        kind: result.kind,
        mode: result.mode,
        path: result.path,
        ...wiringAdvisories(api),
      });
    },
  });
}

function registerRemove(api: PluginAPI): void {
  api.registerTool({
    name: "sil_doc_remove",
    label: "Remove one sil shopper document",
    description:
      "Remove ONE document from the sil shopper's store — never a cascade: nothing"
      + " else is touched, and a link left pointing at the removed document is reported"
      + " by sil_doctor rather than followed. Destructive, so confirm with the buyer"
      + " first. Only a Brief is removable; the shopper document is the person every"
      + " Brief was written from, so it answers invalid_request — correct it with"
      + " sil_doc_write (mode: replace) instead. An already-gone document answers"
      + " not_found, so a repeat call is safe. Local-only, no network.",
    parameters: Type.Object({
      ref: Type.String({
        description: 'The document ref to remove: "brief:<slug>" (lower-kebab, not "main").',
      }),
    }),
    async execute(_callId, params) {
      migrateOnTouch(api);
      const result = removeDocument(params["ref"]);
      if (!result.ok) return mapFailure(api, "sil_doc_remove", result);
      api.logger.info("sil_doc_removed", { doc_kind: result.kind });
      return jsonResult({
        status: "removed",
        ref: result.ref,
        kind: result.kind,
        ...wiringAdvisories(api),
      });
    },
  });
}

/** Map a store failure variant to the canonical structured envelope + a non-PII log. */
function mapFailure(api: PluginAPI, tool: string, result: StoreFailure) {
  if (result.kind === "invalid_request") {
    api.logger.warn(tool + "_invalid_request", { field: result.field });
    return jsonResult({ status: "invalid_request", field: result.field, message: result.message });
  }
  if (result.kind === "not_found") {
    api.logger.info(tool + "_not_found", {});
    return jsonResult({ status: "not_found", message: result.message });
  }
  if (result.kind === "unreadable") {
    // A present-but-corrupt document — steer the agent to inspect/repair, NEVER write
    // over it (silent loss of a recoverable document). Distinct from not_found.
    api.logger.warn(tool + "_unreadable", {});
    return jsonResult({ status: "unreadable", message: result.message, recovery: "inspect_document" });
  }
  api.logger.error(tool + "_persistence_failed", { error: result.error });
  return jsonResult({
    status: "persistence_failed",
    error: result.error,
    message: result.message,
    recovery: result.recovery,
  });
}
