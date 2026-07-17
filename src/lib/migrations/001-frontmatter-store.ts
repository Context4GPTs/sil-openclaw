/**
 * Migration #1 — 0.3.x legacy pack → 0.4.x frontmatter-as-truth (store version 1).
 *
 * The 0.4.0 redesign ([[spec-driven-shopping-redesign]]) dropped `profile.json` and
 * the `domain_spec`/`intent_spec`/`playbook` triple for a frontmatter-as-truth store
 * with NO back-compat, so a pre-existing 0.3.x store read `unreadable` and the shopper
 * vanished (incident #2). This hop RESURRECTS such a store: it folds the legacy
 * `profile.json` `name` + the frontmatter-LESS legacy `user_spec.md` body into ONE
 * frontmatter-as-truth `user_spec.md`, and folds each domain's legacy triple into a
 * `method.md`, then deletes the legacy bytes.
 *
 * Legacy PRE-state (v0.3.9):
 *   $SIL_DATA_DIR/shopper/
 *     ├─ user_spec.md            frontmatter-LESS body; the name lived in profile.json
 *     ├─ profile.json            { name, userSpecPath, createdAt, domains: { <slug>: { name, … } } }
 *     └─ domains/<slug>/{ domain_spec.md, intent_spec.md, playbook.md }   frontmatter-less
 *
 * Preservation floor (the shopper survives ⇔ BOTH): `user_spec.md` present with a
 * non-blank frontmatter `name` == the legacy name, AND the legacy `user_spec` body
 * preserved. The redesign-deleted triple has no faithful forward representation, so we
 * NEVER fabricate methods/PRDs from it — we preserve its three bodies verbatim under
 * stable headings (the strongest honest option) and invent nothing.
 *
 * The constants below are FROZEN to this historical transition on purpose — a migration
 * is an immutable snapshot of one format move, so it must not track live store constants
 * (importing them would also cycle: store → runner → registry → this).
 */

import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { readArtefactFile, serializeArtefact, atomicWrite } from "../artefact-io.js";
import type { Migration } from "./types.js";

const SHOPPER = "shopper";
const DOMAINS = "domains";
const USER_SPEC = "user_spec.md";
const METHOD = "method.md";
const PROFILE_JSON = "profile.json";
const LEGACY_TRIPLE = ["domain_spec.md", "intent_spec.md", "playbook.md"] as const;

/** The legacy 0.3.9 manifest — only the fields this migration reads are narrowed. */
interface LegacyManifest {
  name?: unknown;
  domains?: Record<string, { name?: unknown } | undefined>;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readBody(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Fold the three legacy per-domain bodies losslessly under stable `## ` headings —
 * each raw body survives VERBATIM as a substring (this is per-domain DATA, preserved,
 * never re-derived). Absent files contribute an empty section (still lossless). */
function mergeDomainBodies(guide: string, intent: string, playbook: string): string {
  return (
    "## Domain guide\n" + guide +
    "\n## Intent dimensions\n" + intent +
    "\n## Playbook\n" + playbook
  );
}

export const migration001: Migration = {
  version: 1,
  description: "0.3.x legacy pack (profile.json + domain_spec/intent_spec/playbook) → frontmatter-as-truth store",

  detectApplicable(dataDir: string): boolean {
    // The unambiguous legacy signature. Absent ⇒ already-new-format or fresh/empty —
    // record the version, transform nothing (never rewrites correct artefacts, never
    // fabricates for the empty case).
    return existsSync(join(dataDir, SHOPPER, PROFILE_JSON));
  },

  apply(dataDir: string): void {
    const shopper = join(dataDir, SHOPPER);
    const profilePath = join(shopper, PROFILE_JSON);

    let manifest: LegacyManifest;
    try {
      manifest = JSON.parse(readFileSync(profilePath, "utf8")) as LegacyManifest;
    } catch (err) {
      throw new Error("legacy profile.json is unparseable — cannot migrate: " + errCause(err));
    }
    const name = manifest.name;
    if (!nonBlank(name)) {
      // Legacy materialize always wrote a non-blank name, so a blank/missing one is
      // genuine corruption — surface it, NEVER fabricate a name.
      throw new Error("legacy profile.json carries no shopper name — refusing to fabricate one");
    }

    // The preservation floor: legacy name → frontmatter, legacy body preserved.
    const legacyUserBody = readBody(join(shopper, USER_SPEC));
    atomicWrite(join(shopper, USER_SPEC), serializeArtefact({ name }, legacyUserBody));

    const now = new Date().toISOString();
    const domains = manifest.domains ?? {};
    for (const slug of Object.keys(domains)) {
      const domainDir = join(shopper, DOMAINS, slug);
      const entryName = domains[slug]?.name;
      const domainName = nonBlank(entryName) ? entryName : slug;
      const merged = mergeDomainBodies(
        readBody(join(domainDir, LEGACY_TRIPLE[0])),
        readBody(join(domainDir, LEGACY_TRIPLE[1])),
        readBody(join(domainDir, LEGACY_TRIPLE[2])),
      );
      atomicWrite(
        join(domainDir, METHOD),
        serializeArtefact({ domain: slug, name: domainName, updated_at: now }, merged),
      );
      for (const legacy of LEGACY_TRIPLE) rmSync(join(domainDir, legacy), { force: true });
    }

    rmSync(profilePath, { force: true });
  },

  verify(dataDir: string): string | null {
    const shopper = join(dataDir, SHOPPER);
    if (existsSync(join(shopper, PROFILE_JSON))) {
      return "legacy profile.json still present after migration";
    }
    const userSpec = readArtefactFile(join(shopper, USER_SPEC));
    if (userSpec === null) {
      return "user_spec.md is missing or has unparseable frontmatter after migration";
    }
    if (!nonBlank(userSpec.fields["name"])) {
      return "user_spec.md frontmatter carries no shopper name after migration";
    }
    const domainsRoot = join(shopper, DOMAINS);
    if (existsSync(domainsRoot)) {
      for (const entry of readdirSync(domainsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const domainDir = join(domainsRoot, entry.name);
        for (const legacy of LEGACY_TRIPLE) {
          if (existsSync(join(domainDir, legacy))) {
            return 'legacy ' + legacy + ' still present in domain "' + entry.name + '" after migration';
          }
        }
        const method = readArtefactFile(join(domainDir, METHOD));
        if (method === null) {
          return 'method.md for domain "' + entry.name + '" is missing or unparseable after migration';
        }
        if (!nonBlank(method.fields["name"])) {
          return 'method.md for domain "' + entry.name + '" carries no name after migration';
        }
      }
    }
    return null;
  },
};

function errCause(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
