/**
 * INTEGRATION — the load-bearing CONTRACT of the sil-shopping skill bundle
 * (reads real files + real registration code). Replaces the deleted 1341-line
 * skill-content test, which pinned nearly every prose CLAUSE and so stayed
 * green through a live behavioral bug (the shopper never minting a domain).
 * Guards only what breaks the product if it drifts — discoverability, the
 * published name, the tool set, cross-links, the retired vocabulary, and the
 * mint-first/catalog-of-record forcing function — deriving facts from source,
 * never restating prose wording.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIdentityTools } from "../tools/identity.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { registerProfileTools } from "../tools/profile.js";
import { registerDoctorTools } from "../tools/doctor.js";
import {
  createMockPluginApi,
  registeredToolNames,
} from "./helpers/mock-plugin-api.js";
import { perNicheExpertOffenders } from "./helpers/per-niche-expert.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLE = join(REPO_ROOT, "sil-shopping");
const CORE_TOOLS = ["sil_register", "sil_whoami", "sil_search", "sil_product_get"];
// Tokens retired by the single-shopper + SDS-redesign pivots — no path, no doc,
// no compat alias may resurrect them anywhere in the bundle. Each names a thing
// that is GONE, so a blanket forbid is right: nothing legitimately disavows them
// by name (unlike `expert`, which a corrected doc DOES name to bury it — that one
// needs the retro-allowance scan below, never a blanket forbid).
//   `domain_spec`/`intent_spec` keep their UNDERSCORE deliberately: the live
//   vocabulary "intent"/"domain" must never trip this guard.
//   `profile.json` is gone FOREVER — the store is frontmatter-as-truth and the
//   versioned-store-migrations card was abandoned, so nothing will resurrect it.
// Matched CASE-INSENSITIVELY (each body is lowered, not the needle), so a
// Title-cased prose reintroduction (`Rubric`) fails too. Entries MUST therefore
// be lower-case — pinned by a guard-of-the-guard below, because an upper-case
// needle would never match a lowered body and would sit here silently vacuous.
const RETIRED_TOKENS = [
  "profile.json", "domain_spec", "intent_spec", "playbook", "sil_remember",
  "sil_profile_list", "sil_ping", "sil_echo", "rubric", "manage_domains",
  "refine_shopper",
];

const read = (rel: string): string => readFileSync(join(BUNDLE, rel), "utf8");
const skillSrc = (): string => read("SKILL.md");
// The scanned file set is DERIVED from disk, never hardcoded: a hand-maintained
// table silently misses a new bundle file, which is how a drift guard rots into a
// vacuous green. `bundleEntries` is unfiltered so the floor test below can prove
// nothing on disk escapes the `.md` scan.
const bundleEntries = (): string[] =>
  (readdirSync(BUNDLE, { recursive: true }) as string[]).filter((p) =>
    statSync(join(BUNDLE, p)).isFile(),
  );
const bundleFiles = (): string[] => bundleEntries().filter((p) => p.endsWith(".md"));
const bundleCorpus = (): string => bundleFiles().map(read).join("\n");
const manifest = (): { skills?: unknown } =>
  JSON.parse(readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"));

function frontmatter(): { name: string; description: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(skillSrc());
  if (!m) throw new Error("SKILL.md: no parseable --- frontmatter block");
  const [, fm, body] = m;
  return {
    name: /^name:\s*["']?(.+?)["']?\s*$/m.exec(fm)?.[1] ?? "",
    description: /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim() ?? "",
    body,
  };
}

// Every register group, so the "named in the bundle" guard below covers the WHOLE
// surface. A new group omitted here does not fail — it silently narrows the guard,
// which is worse than a red: the tool ships undocumented and the test still passes.
function registeredTools(): string[] {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerProfileTools(api);
  registerDoctorTools(api);
  return [...registeredToolNames(api)];
}

describe("sil-shopping skill bundle — load-bearing contract (not prose)", () => {
  it("SKILL.md exists with parseable frontmatter and a non-empty body", () => {
    expect(existsSync(join(BUNDLE, "SKILL.md"))).toBe(true);
    expect(skillSrc().startsWith("---")).toBe(true);
    expect(frontmatter().body.trim().length).toBeGreaterThan(0);
  });

  it("frontmatter name is the published skill name 'sil-shopping' (distinct from plugin id 'sil') with a non-empty description", () => {
    const fm = frontmatter();
    expect(fm.name).toBe("sil-shopping");
    expect(fm.name).not.toBe("sil");
    expect(fm.description.length).toBeGreaterThan(0);
  });

  it("manifest skills[0] basename agrees with the SKILL.md frontmatter name", () => {
    const skills = manifest().skills as string[];
    expect(Array.isArray(skills)).toBe(true);
    expect(basename(skills[0])).toBe(frontmatter().name);
  });

  it("every registered tool name appears somewhere in the skill bundle", () => {
    const corpus = bundleCorpus();
    expect(registeredTools().filter((n) => !corpus.includes(n))).toEqual([]);
  });

  it("the four core tools are named in SKILL.md itself (the always-loaded router)", () => {
    const src = skillSrc();
    expect(CORE_TOOLS.filter((t) => !src.includes(t))).toEqual([]);
  });

  it("every references/ and examples/ link in the bundle resolves to a real file", () => {
    const paths = [
      ...bundleCorpus().matchAll(/(?:references|examples)\/[\w./-]+\.md/g),
    ].map((m) => m[0]);
    expect(paths.length).toBeGreaterThan(0);
    expect([...new Set(paths)].filter((p) => !existsSync(join(BUNDLE, p)))).toEqual([]);
  });

  it("the drift scan covers EVERY file on disk — no bundle file escapes it", () => {
    // The floor that keeps every corpus-driven guard honest. Without it a silent
    // shrink of the scanned set (a file renamed to .mdx, moved, or added in a new
    // format) narrows the retired-token + per-niche-expert scans to a smaller
    // corpus and they keep passing — green over prose nobody checks. A non-.md
    // bundle file must force a deliberate decision here, not slip through.
    const all = bundleEntries();
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((p) => !p.endsWith(".md"))).toEqual([]);
    expect(bundleFiles()).toContain("SKILL.md");
  });

  it("every RETIRED_TOKENS needle is lower-case (the body is lowered, not the needle)", () => {
    // Guard-of-the-guard: an upper-case needle can never match the lowered body,
    // so it would sit in the list looking protective while matching nothing.
    expect(RETIRED_TOKENS.filter((t) => t !== t.toLowerCase())).toEqual([]);
  });

  it("no retired vocabulary token survives anywhere in the bundle", () => {
    // Offenders carry their file so a red names the drift's location, not just
    // that the bundle is dirty somewhere.
    const offenders: string[] = [];
    for (const rel of bundleFiles()) {
      const body = read(rel);
      const lower = body.toLowerCase();
      for (const t of RETIRED_TOKENS) if (lower.includes(t)) offenders.push(`${rel} → ${t}`);
      for (const ctx of perNicheExpertOffenders(body)) offenders.push(`${rel}: …${ctx}…`);
    }
    expect(offenders).toEqual([]);
  });

  it("SKILL.md pins the mint-first, catalog-of-record forcing function", () => {
    const src = skillSrc();
    expect(src).toContain("mint_domain"); // the mint trigger
    expect(src).toContain("checkout_url"); // picks come from the sil catalog
    expect(src).toMatch(/open[ -]web/i); // never sourced from the open web
  });
});
