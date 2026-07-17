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
import { CREATION_ENTRYPOINT_RELATIVE } from "../lib/creation-entrypoint.js";
import { buildDoctorReport } from "../tools/doctor.js";
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

// ===========================================================================
// Card: creation-bin-unreachable-on-clawhub-installs — the prose is the third
// surface, and the only one that can actually drift.
//
// `sil_doctor` REPORTS the entrypoint and PROBES it from ONE constant, so the
// reported path and the probed path cannot disagree by construction. The prose is
// what the agent actually obeys, and nothing binds it to that constant but these
// tests. This bug's entire lifetime was underwritten by a GREEN guard
// (`package-manifest.integration.test.ts:238` pinned the bin map while the flow
// using it was dead), which is the failure mode this block exists to foreclose.
// ===========================================================================

const ENGINE = "references/agent_creation_engine.md";
const engineSrc = (): string => read(ENGINE);

/** The fenced code blocks — what the agent COPIES, as opposed to prose about it.
 * Command-shape assertions belong here: the prose legitimately DISCUSSES the traps
 * (a `../scripts/…` hop, a heredoc) in order to disavow them by name, so scanning
 * the whole document for those constructs would fail the very words that document
 * the fix. */
const engineCodeBlocks = (): string =>
  [...engineSrc().matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");

const pkgBin = (): Record<string, string> =>
  (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    bin: Record<string, string>;
  }).bin;

describe("creation entrypoint — the surfaces that can actually drift (AC B7)", () => {
  it("AC B7 — the doc names the REAL DoctorReport field that carries the path", () => {
    // THE drift guard, retargeted to the drift this design can actually suffer.
    //
    // B7 as written asks the prose to name `scripts/create-shopper.mjs` and pins that
    // literal equal to the constant + the bin map. The shipped design does not put a
    // path in the prose at all — it documents `node "<creationEntrypoint>"`, where the
    // value comes from sil_doctor at runtime. That is STRONGER than B7 hoped for
    // (E and D are one value, not two strings asserted equal), and pinning the path
    // into prose would ADD a fourth surface that goes stale on the next rename while
    // guarding nothing.
    //
    // But the binding did not vanish — it MOVED, from the path to the FIELD NAME. If
    // the report's key is ever renamed, the doc still says `creationEntrypoint`, the
    // agent reads a field that does not exist, and creation dies at exactly the step
    // this card is fixing, silently, on both channels. Nothing else guards that.
    //
    // Derived by VALUE, never by restating the key: plant a sentinel path in a real
    // report and ask which top-level key came back carrying it. A rename makes `key`
    // the NEW name and forces the doc to follow.
    const SENTINEL = "/sentinel-root/scripts/create-shopper.mjs";
    const report = buildDoctorReport({
      dataDir: "/tmp/sil-data",
      installedVersion: "0.0.0",
      creationEntrypoint: SENTINEL,
      findings: [],
    });
    const key = Object.entries(report).find(([, v]) => v === SENTINEL)?.[0];
    expect(key).toBeDefined();
    expect(engineSrc()).toContain(key!);
  });

  it("package.json#bin maps the resolver's SAME path (the bin is retained for npm-global users)", () => {
    // "Out of scope" keeps the bin entry: it costs nothing and still serves the
    // npm-global channel. It is simply no longer the DOCUMENTED invocation. Asserting
    // it against the same constant is what stops a future cleanup from "restoring"
    // the bare bin name in the prose.
    expect(pkgBin()["sil-openclaw-create-shopper"]?.replace(/^\.\//, "")).toBe(
      CREATION_ENTRYPOINT_RELATIVE,
    );
  });

  it("the constant is a real, non-vacuous scripts/*.mjs path (guard-of-the-guard)", () => {
    // Three surfaces asserted equal to an empty string would pass forever.
    expect(CREATION_ENTRYPOINT_RELATIVE).toMatch(/^scripts\/[a-z][a-z0-9-]*\.mjs$/);
    expect(existsSync(join(REPO_ROOT, CREATION_ENTRYPOINT_RELATIVE))).toBe(true);
  });
});

describe("the documented creation command is channel-independent (AC A2/A3/A4)", () => {
  it("AC A4 — the doc sources the path from sil_doctor's creationEntrypoint", () => {
    // The POSITIVE pin, and the load-bearing one: the agent has no other sound source.
    // The host publishes plugin skills as SYMLINKS and hands the agent the symlink
    // path, so there IS no plugin-root datum in its context.
    const src = engineSrc();
    expect(src).toContain("sil_doctor");
    expect(src).toContain("creationEntrypoint");
  });

  it("AC A3 — the documented command runs node against that path, by absolute path", () => {
    expect(engineCodeBlocks()).toMatch(/node\s+"<creationEntrypoint>"/);
  });

  it("AC A3 — NO bundled prose names a bare sil bin anywhere", () => {
    // The defect itself. `openclaw plugins install` links no bins, so both names
    // reach PATH only through a global npm-style install. Bundle-wide, and not even
    // as a disavowal: a model lifts the shortest thing that looks like a command, and
    // a name-free disavowal (which the doc now does) carries the warning just as well.
    const offenders: string[] = [];
    for (const rel of bundleFiles()) {
      for (const bin of ["sil-openclaw-create-shopper", "sil-openclaw-allowlist"]) {
        if (read(rel).includes(bin)) offenders.push(`${rel} → ${bin}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("AC A4 — no documented command derives the path from the skill file's own location", () => {
    // The falsified fix direction. `node <skilldir>/../scripts/x` throws
    // MODULE_NOT_FOUND on the exact string `cat` reads happily: node's path.resolve
    // normalizes `..` LEXICALLY, before the filesystem, so the symlink hop is erased.
    // Scoped to code blocks BY DESIGN — the prose names this trap to warn about it.
    expect(engineCodeBlocks()).not.toMatch(/\.\.\//);
    expect(engineCodeBlocks()).not.toMatch(/readlink|dirname|\$\(dirname/);
  });

  it("AC A2 — ONE invocation serves both channels: no channel-conditional branch", () => {
    // "If you installed via X do A, else B" is how a fix becomes a fork that only one
    // channel ever exercises.
    const src = engineSrc().toLowerCase();
    expect(src).not.toContain("clawhub");
    expect(src).not.toContain("npm install");
    expect(src).not.toContain("npm i -g");
  });
});

describe("the spec is fed by file, never by shell quoting (AC C2/C3)", () => {
  it("AC C2 — the documented input form is --spec <path>", () => {
    expect(engineCodeBlocks()).toContain("--spec");
  });

  it("AC C2 — NO heredoc or stdin form survives as an alternative", () => {
    // Delete-first: the heredoc is REMOVED, not left beside the new form. Two
    // documented forms means the model picks the quoting-fragile one half the time —
    // and a mangled heredoc reaches the bin as unparseable stdin, so it fails as
    // `invalid_request` and the agent BLAMES THE USER for a spec that was fine.
    //
    // The heredoc OPERATOR, not the word: the prose says "as a file, not a heredoc",
    // which is correct and must not be punished. stdin stays in the bin (founder
    // ruling 3) — the DOC is the single-form contract.
    expect(engineCodeBlocks()).not.toMatch(/<<-?\s*['"]?\w+/);
    expect(engineSrc()).not.toContain("stdin");
  });

  it("AC C3 — the doc instructs an owner-only spec file that is removed after the run", () => {
    // `--spec <path>` writes the user's home address, sizes, and allergy/ethics rules
    // to disk where stdin left nothing at rest. The agent owns that file's lifecycle:
    // the bin never deletes an input it does not own (founder ruling 3).
    const src = engineSrc();
    expect(src).toMatch(/0600|umask 077/);
    expect(engineCodeBlocks()).toMatch(/rm -f|rm "/);
  });
});
